-- =====================================================================
-- Devolução de medicamento: só a ENFERMAGEM registra; a FARMÁCIA confirma.
-- Decisão de 16/09/2026 (Adonias).
--
-- Antes: a tela deixava a farmácia lançar a devolução já confirmada e
-- pré-preenchia o setor de origem com o setor de quem registrava — 61% das
-- 396 devoluções ficaram com origem "Farmácia ..." em vez do posto. O fluxo
-- de pendentes (enfermagem envia, farmácia confirma) existia mas não
-- funcionava: a confirmação não tinha permissão de UPDATE (status ficava
-- 'pending' sem erro) e dava entrada sem lote, podendo lançar duas vezes.
--
-- Agora tudo passa por duas funções, cada uma numa transação:
--   farmacia_devolucao_enviar     — só enfermagem; status 'pending'
--   farmacia_devolucao_confirmar  — só farmácia; lote + saldo + movimento
-- e a view v_farmacia_devolucoes alimenta o relatório.
--
-- Só farmácia (itens pharmacy). Não toca no almoxarifado.
-- =====================================================================

-- 1. Setores considerados enfermagem (origem válida e quem pode registrar).
create table if not exists public.farmacia_setores_enfermagem (
  department_id uuid primary key references public.departments(id) on delete cascade,
  incluido_em   timestamptz not null default now(),
  observacao    text
);
alter table public.farmacia_setores_enfermagem enable row level security;
drop policy if exists "setores_enfermagem_select" on public.farmacia_setores_enfermagem;
create policy "setores_enfermagem_select" on public.farmacia_setores_enfermagem
  for select to authenticated using (true);
revoke all on public.farmacia_setores_enfermagem from anon;
revoke insert, update, delete, truncate on public.farmacia_setores_enfermagem from authenticated;

insert into public.farmacia_setores_enfermagem (department_id, observacao)
select d.id, 'Definido por Adonias em 16/09/2026'
from public.departments d
where d.name in ('Unidade de Internação', 'Posto Térreo', 'Posto 1º Andar', 'Posto 2º Andar', 'Coordenação de Enfermagem')
on conflict (department_id) do nothing;

create or replace function public.fn_eh_enfermagem(p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  select exists (
    select 1
    from public.users u
    join public.farmacia_setores_enfermagem s on s.department_id = u.department_id
    where u.id = p_uid and coalesce(u.is_active, true)
  )
$fn$;
revoke all on function public.fn_eh_enfermagem(uuid) from public, anon;
grant execute on function public.fn_eh_enfermagem(uuid) to authenticated;

-- 2. Enfermagem envia a devolução (fica pendente até a farmácia receber).
create or replace function public.farmacia_devolucao_enviar(
  p_origem_department_id uuid,
  p_target_location_id   uuid,
  p_returned_at          date,
  p_motivo               text,
  p_observacao           text,
  p_patient_name         text,
  p_prontuario           text,
  p_itens                jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_uid    uuid := auth.uid();
  v_id     uuid;
  v_numero int;
  v_it     jsonb;
  v_item   uuid;
  v_qtd    int;
  v_lote   text;
  v_val    date;
  v_n      int := 0;
begin
  if v_uid is null then
    raise exception 'Usuario nao autenticado.';
  end if;
  if not public.fn_eh_enfermagem(v_uid) then
    raise exception 'Somente a enfermagem registra devolucao. A farmacia confirma o recebimento na aba Pendentes.';
  end if;
  if not exists (select 1 from public.farmacia_setores_enfermagem where department_id = p_origem_department_id) then
    raise exception 'Selecione o posto/setor de origem da devolucao.';
  end if;
  if not exists (select 1 from public.stock_locations
                 where id = p_target_location_id and (code = 'CAF' or code like 'SAT%')) then
    raise exception 'Estoque de destino invalido.';
  end if;
  if coalesce(p_motivo, '') not in ('melhora_clinica','suspensao_medica','erro_dispensacao','alta_paciente',
                                    'obito','troca_terapeutica','recusa_paciente','sem_acesso_venoso',
                                    'encontrado_posto','outro') then
    raise exception 'Selecione o motivo da devolucao.';
  end if;
  if p_returned_at is not null and p_returned_at > (now() at time zone 'America/Bahia')::date then
    raise exception 'A data da devolucao nao pode ser futura.';
  end if;
  if p_itens is null or jsonb_typeof(p_itens) <> 'array' or jsonb_array_length(p_itens) = 0 then
    raise exception 'Adicione ao menos um item.';
  end if;

  insert into public.stock_returns (
    target_location_id, returned_by_user_id, returned_at, department_id,
    patient_name, patient_prontuario, return_reason, observacao, return_status)
  values (
    p_target_location_id, v_uid,
    coalesce((p_returned_at::text || ' 12:00:00 America/Bahia')::timestamptz, now()),
    p_origem_department_id,
    nullif(btrim(p_patient_name), ''), nullif(btrim(p_prontuario), ''),
    p_motivo, nullif(btrim(p_observacao), ''), 'pending')
  returning id, return_number into v_id, v_numero;

  for v_it in select value from jsonb_array_elements(p_itens) loop
    v_item := nullif(v_it->>'item_id', '')::uuid;
    v_qtd  := nullif(v_it->>'quantity', '')::int;
    v_lote := nullif(btrim(v_it->>'batch_number'), '');
    v_val  := nullif(v_it->>'expiry_date', '')::date;
    if v_item is null or not exists (select 1 from public.pharmacy_items where id = v_item) then
      raise exception 'Item invalido na devolucao.';
    end if;
    if v_qtd is null or v_qtd <= 0 then
      raise exception 'Quantidade deve ser maior que zero.';
    end if;
    if v_lote is null or v_val is null then
      raise exception 'Informe lote e validade de cada item.';
    end if;
    insert into public.stock_return_items (return_id, item_id, item_type, quantity, batch_number, expiry_date)
    values (v_id, v_item, 'pharmacy', v_qtd, v_lote, v_val);
    v_n := v_n + 1;
  end loop;

  return jsonb_build_object('id', v_id, 'numero', v_numero, 'itens', v_n);
end $fn$;
revoke all on function public.farmacia_devolucao_enviar(uuid, uuid, date, text, text, text, text, jsonb) from public, anon;
grant execute on function public.farmacia_devolucao_enviar(uuid, uuid, date, text, text, text, text, jsonb) to authenticated;

-- 3. Farmácia confirma o recebimento, item a item.
create or replace function public.farmacia_devolucao_confirmar(
  p_return_id   uuid,
  p_itens       jsonb,
  p_divergencia text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_uid   uuid := auth.uid();
  v_role  text;
  v_ret   public.stock_returns%rowtype;
  v_item  record;
  v_conf  int;
  v_div   boolean := false;
  v_et    uuid;
  v_preco numeric;
  v_total int := 0;
begin
  if v_uid is null then
    raise exception 'Usuario nao autenticado.';
  end if;
  select role into v_role from public.users where id = v_uid and coalesce(is_active, true);
  if coalesce(v_role, '') not in ('atendente','gestor','administrador','admin','pharmacist') then
    raise exception 'Somente a farmacia confirma o recebimento de devolucoes.';
  end if;

  select * into v_ret from public.stock_returns where id = p_return_id for update;
  if not found then
    raise exception 'Devolucao nao encontrada.';
  end if;
  if v_ret.return_status <> 'pending' then
    raise exception 'Esta devolucao ja foi confirmada.';
  end if;

  for v_item in select * from public.stock_return_items where return_id = p_return_id order by id loop
    select nullif(e->>'confirmed_quantity', '')::int into v_conf
    from jsonb_array_elements(coalesce(p_itens, '[]'::jsonb)) e
    where e->>'id' = v_item.id::text
    limit 1;
    if v_conf is null then
      raise exception 'Informe a quantidade recebida de todos os itens.';
    end if;
    if v_conf < 0 or v_conf > v_item.quantity then
      raise exception 'Quantidade recebida invalida: deve ficar entre 0 e %.', v_item.quantity;
    end if;
    if v_conf <> v_item.quantity then
      v_div := true;
    end if;

    v_et := null;
    if v_conf > 0 then
      select id into v_et from public.expiry_tracking
       where item_id = v_item.item_id
         and location_id = v_ret.target_location_id
         and upper(btrim(batch_number)) = upper(btrim(v_item.batch_number))
       limit 1
       for update;
      if v_et is not null then
        update public.expiry_tracking
           set current_quantity = coalesce(current_quantity, 0) + v_conf,
               expiry_date = coalesce(v_item.expiry_date, expiry_date)
         where id = v_et;
      else
        insert into public.expiry_tracking (item_id, batch_number, expiry_date, initial_quantity,
                                            current_quantity, location_id, created_by)
        values (v_item.item_id, v_item.batch_number, v_item.expiry_date, v_conf, v_conf,
                v_ret.target_location_id, v_uid)
        returning id into v_et;
      end if;

      select price into v_preco from public.pharmacy_items where id = v_item.item_id;
      insert into public.stock_movements (item_id, item_type, movement_type, direction, quantity, unit_cost,
                                          target_location_id, return_id, performed_by, expiry_tracking_id)
      values (v_item.item_id, 'pharmacy', 'DEVOLUCAO_INT', 'in', v_conf, v_preco,
              v_ret.target_location_id, p_return_id, v_uid, v_et);
      v_total := v_total + v_conf;
    end if;

    update public.stock_return_items
       set confirmed_quantity = v_conf, expiry_tracking_id = v_et
     where id = v_item.id;
  end loop;

  if v_div and length(btrim(coalesce(p_divergencia, ''))) < 5 then
    raise exception 'A quantidade recebida difere da enviada: descreva a divergencia.';
  end if;

  update public.stock_returns
     set return_status = 'confirmed', confirmed_by = v_uid, confirmed_at = now(),
         divergence_notes = nullif(btrim(p_divergencia), '')
   where id = p_return_id;

  return jsonb_build_object('id', p_return_id, 'recebido', v_total, 'divergencia', v_div);
end $fn$;
revoke all on function public.farmacia_devolucao_confirmar(uuid, jsonb, text) from public, anon;
grant execute on function public.farmacia_devolucao_confirmar(uuid, jsonb, text) to authenticated;

-- 4. Gravação só pelas funções acima.
drop policy if exists "stock_returns_insert" on public.stock_returns;
drop policy if exists "stock_return_items_insert" on public.stock_return_items;
revoke insert, update, delete, truncate on public.stock_returns from anon, authenticated;
revoke insert, update, delete, truncate on public.stock_return_items from anon, authenticated;

-- 5. Base do relatório: uma linha por item devolvido.
create or replace view public.v_farmacia_devolucoes with (security_invoker = on) as
select
  i.id,
  r.id                 as devolucao_id,
  r.return_number      as numero,
  r.returned_at        as data,
  r.created_at         as registrado_em,
  r.return_status      as status,
  case when s.department_id is not null then dep.name else 'Origem não informada' end as origem,
  dep.name             as setor_gravado,
  lt.code              as estoque_codigo,
  lt.name              as estoque,
  pi.id                as item_id,
  pi.name              as item,
  pi.code              as codigo,
  pi.unit              as unidade,
  pi.medication_class  as classe,
  i.quantity           as quantidade_enviada,
  i.confirmed_quantity as quantidade_recebida,
  case
    when r.return_status = 'confirmed' then coalesce(i.confirmed_quantity, i.quantity)
    else 0
  end                  as quantidade_entrada,
  coalesce(i.batch_number, mv.batch_number) as lote,
  coalesce(i.expiry_date, mv.expiry_date)   as validade,
  r.return_reason      as motivo,
  r.observacao,
  r.divergence_notes   as divergencia,
  r.patient_prontuario as prontuario,
  r.patient_name       as paciente,
  ub.full_name         as registrado_por,
  uc.full_name         as confirmado_por,
  r.confirmed_at       as confirmado_em
from public.stock_return_items i
join public.stock_returns r on r.id = i.return_id
join public.pharmacy_items pi on pi.id = i.item_id
left join public.departments dep on dep.id = r.department_id
left join public.farmacia_setores_enfermagem s on s.department_id = r.department_id
left join public.stock_locations lt on lt.id = r.target_location_id
left join public.users ub on ub.id = r.returned_by_user_id
left join public.users uc on uc.id = r.confirmed_by
left join lateral (
  select et.batch_number, et.expiry_date
  from public.stock_movements m
  join public.expiry_tracking et on et.id = m.expiry_tracking_id
  where m.return_id = r.id and m.item_id = i.item_id
  limit 1
) mv on true
where i.item_type = 'pharmacy';
