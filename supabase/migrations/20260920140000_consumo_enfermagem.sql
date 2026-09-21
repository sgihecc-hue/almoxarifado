-- FASE 2 — consumo da enfermagem por paciente e por kit.
-- Spec: docs/superpowers/specs/2026-09-20-kits-enfermagem-design.md
--
-- Pra dizer "o paciente X consumiu 10 gazes" nao basta saber que ele levou 5
-- kits: e preciso saber a composicao DAQUELE kit NAQUELE dia. Se a composicao
-- mudar depois, a conta feita com a composicao atual reescreveria o passado.
-- Por isso o pedido passa a guardar a composicao usada (request_kit_items).
--
-- Feito agora porque ainda nao existe nenhum pedido de kit gravado: nao ha
-- historico pra corrigir.
--
-- ALMOXARIFADO INTOCADO: tabela nova, view nova e a RPC criada ontem, que so a
-- enfermagem usa. Nada existente e alterado.

create table public.request_kit_items (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.requests(id) on delete cascade,
  kit_id uuid references public.kits(id),
  warehouse_item_id uuid references public.warehouse_items(id),
  item_name text not null,
  quantity_por_kit integer not null check (quantity_por_kit > 0),
  created_at timestamptz not null default now()
);
create index request_kit_items_request on public.request_kit_items (request_id);
create unique index request_kit_items_unico on public.request_kit_items
  (request_id, kit_id, warehouse_item_id);

alter table public.request_kit_items enable row level security;
create policy "request_kit_items_read" on public.request_kit_items
  for select to authenticated using (true);

-- RPC: mesma da fase 1, agora gravando tambem a composicao usada -------------
create or replace function public.criar_pedido_enfermagem(
  p_department_id uuid,
  p_kits jsonb default '[]'::jsonb,
  p_avulsos jsonb default '[]'::jsonb,
  p_priority text default 'medium',
  p_justification text default null,
  p_notes text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_uid uuid := auth.uid();
  v_role text;
  v_sat uuid;
  v_dept_loc uuid;
  v_req uuid;
  v_req_num integer;
  k jsonb; pac jsonb; a jsonb;
  v_kit uuid; v_kit_name text; v_kit_qtd integer; v_kit_total integer := 0;
  v_pat uuid; v_pat_name text; v_qtd integer;
  v_item uuid; v_item_name text; v_item_unit text;
  v_total_itens integer := 0;
begin
  if v_uid is null then raise exception 'Usuario nao autenticado.'; end if;

  select role into v_role from public.users where id = v_uid;
  if coalesce(v_role,'') not in ('administrador','gestor','atendente','solicitante','admin','manager') then
    raise exception 'Sem permissao para criar pedido de enfermagem.';
  end if;

  select id into v_sat from public.stock_locations where code = 'SAT_T';
  if v_sat is null then raise exception 'Estoque Satelite Terreo (SAT_T) nao encontrado.'; end if;

  if p_department_id is null then raise exception 'Setor solicitante e obrigatorio.'; end if;
  select default_warehouse_location_id into v_dept_loc from public.departments where id = p_department_id;
  if v_dept_loc is distinct from v_sat then
    raise exception 'Este setor nao e atendido pela Satelite Terreo.';
  end if;

  if (p_kits is null or jsonb_array_length(p_kits) = 0)
     and (p_avulsos is null or jsonb_array_length(p_avulsos) = 0) then
    raise exception 'Pedido sem kit e sem item avulso.';
  end if;

  insert into public.requests(type, status, priority, requester_id, department_id,
    justification, notes, source_location_id, needs_receipt_confirmation)
  values ('warehouse', 'pending', coalesce(nullif(btrim(coalesce(p_priority,'')),''),'medium'),
    v_uid, p_department_id, nullif(btrim(coalesce(p_justification,'')),''),
    nullif(btrim(coalesce(p_notes,'')),''), v_sat, false)
  returning id, request_number into v_req, v_req_num;

  create temporary table tmp_itens(item_id uuid primary key, quantity integer not null)
    on commit drop;

  for k in select value from jsonb_array_elements(coalesce(p_kits,'[]'::jsonb))
  loop
    v_kit := (k->>'kit_id')::uuid;
    if v_kit is null then raise exception 'Kit sem identificacao.'; end if;
    select name into v_kit_name from public.kits where id = v_kit and is_active;
    if v_kit_name is null then raise exception 'Kit nao encontrado ou inativo.'; end if;

    v_kit_qtd := 0;
    for pac in select value from jsonb_array_elements(coalesce(k->'pacientes','[]'::jsonb))
    loop
      v_pat := (pac->>'patient_id')::uuid;
      v_qtd := (pac->>'quantity')::integer;
      if v_pat is null then raise exception 'Kit % sem paciente.', v_kit_name; end if;
      if v_qtd is null or v_qtd <= 0 then raise exception 'Quantidade invalida no kit %.', v_kit_name; end if;
      select full_name into v_pat_name from public.patients where id = v_pat;
      if v_pat_name is null then raise exception 'Paciente nao encontrado.'; end if;

      insert into public.request_kits(request_id, kit_id, kit_name, patient_id, patient_name, quantity)
      values (v_req, v_kit, v_kit_name, v_pat, v_pat_name, v_qtd);
      v_kit_qtd := v_kit_qtd + v_qtd;
    end loop;
    if v_kit_qtd = 0 then raise exception 'Kit % sem paciente.', v_kit_name; end if;
    v_kit_total := v_kit_total + v_kit_qtd;

    if exists (select 1 from public.kit_items where kit_id = v_kit and item_type <> 'warehouse') then
      raise exception 'Kit % tem item que nao e material. Nesta versao o kit so leva material.', v_kit_name;
    end if;

    -- Composicao usada neste pedido (fotografia). O mesmo kit pode aparecer
    -- duas vezes no pedido; a segunda nao regrava a fotografia.
    insert into public.request_kit_items(request_id, kit_id, warehouse_item_id, item_name, quantity_por_kit)
    select v_req, v_kit, ki.warehouse_item_id, w.name, ki.quantity
      from public.kit_items ki join public.warehouse_items w on w.id = ki.warehouse_item_id
     where ki.kit_id = v_kit and ki.item_type = 'warehouse'
    on conflict (request_id, kit_id, warehouse_item_id) do nothing;

    insert into tmp_itens(item_id, quantity)
    select ki.warehouse_item_id, ki.quantity * v_kit_qtd
      from public.kit_items ki
     where ki.kit_id = v_kit and ki.item_type = 'warehouse'
    on conflict (item_id) do update set quantity = tmp_itens.quantity + excluded.quantity;
  end loop;

  for a in select value from jsonb_array_elements(coalesce(p_avulsos,'[]'::jsonb))
  loop
    v_item := (a->>'item_id')::uuid;
    v_pat  := (a->>'patient_id')::uuid;
    v_qtd  := (a->>'quantity')::integer;
    if v_item is null then raise exception 'Item avulso sem identificacao.'; end if;
    if v_pat is null then raise exception 'Item avulso sem paciente.'; end if;
    if v_qtd is null or v_qtd <= 0 then raise exception 'Quantidade invalida em um item avulso.'; end if;

    select name, unit into v_item_name, v_item_unit from public.warehouse_items where id = v_item;
    if v_item_name is null then raise exception 'Item de material nao encontrado.'; end if;
    select full_name into v_pat_name from public.patients where id = v_pat;
    if v_pat_name is null then raise exception 'Paciente nao encontrado.'; end if;

    insert into public.request_item_patients(request_id, warehouse_item_id, item_name,
      patient_id, patient_name, quantity)
    values (v_req, v_item, v_item_name, v_pat, v_pat_name, v_qtd);

    insert into tmp_itens(item_id, quantity) values (v_item, v_qtd)
    on conflict (item_id) do update set quantity = tmp_itens.quantity + excluded.quantity;
  end loop;

  insert into public.request_items(request_id, item_type, warehouse_item_id, item_name, quantity, unit)
  select v_req, 'warehouse', t.item_id, w.name, t.quantity, w.unit
    from tmp_itens t join public.warehouse_items w on w.id = t.item_id;
  get diagnostics v_total_itens = row_count;

  update public.request_item_patients rip
     set request_item_id = ri.id
    from public.request_items ri
   where ri.request_id = v_req
     and rip.request_id = v_req
     and ri.warehouse_item_id = rip.warehouse_item_id;

  return jsonb_build_object('request_id', v_req, 'request_number', v_req_num,
    'itens', v_total_itens, 'kits', v_kit_total);
end $function$;

-- View do relatorio: uma linha por (pedido, paciente, item) -------------------
-- Kit: quantidade = kits do paciente x composicao gravada no pedido.
-- Avulso: a propria quantidade da linha.
create or replace view public.v_consumo_enfermagem as
select
  r.id                      as request_id,
  r.request_number          as numero,
  r.created_at              as data,
  r.delivered_at            as entregue_em,
  r.status                  as status,
  d.name                    as setor,
  'kit'::text               as origem,
  rk.kit_name               as kit,
  rk.patient_id             as paciente_id,
  rk.patient_name           as paciente,
  p.medical_record_number   as prontuario,
  rki.warehouse_item_id     as item_id,
  rki.item_name             as item,
  w.unit                    as unidade,
  rk.quantity               as kits,
  rk.quantity * rki.quantity_por_kit as quantidade
from public.request_kits rk
join public.requests r on r.id = rk.request_id
left join public.departments d on d.id = r.department_id
left join public.patients p on p.id = rk.patient_id
join public.request_kit_items rki
  on rki.request_id = rk.request_id and rki.kit_id = rk.kit_id
left join public.warehouse_items w on w.id = rki.warehouse_item_id

union all

select
  r.id, r.request_number, r.created_at, r.delivered_at, r.status,
  d.name, 'avulso'::text, null::text,
  rip.patient_id, rip.patient_name, p.medical_record_number,
  rip.warehouse_item_id, rip.item_name, w.unit,
  null::integer, rip.quantity
from public.request_item_patients rip
join public.requests r on r.id = rip.request_id
left join public.departments d on d.id = r.department_id
left join public.patients p on p.id = rip.patient_id
left join public.warehouse_items w on w.id = rip.warehouse_item_id;

grant select on public.v_consumo_enfermagem to authenticated;

-- Contagem de KITS separada da de itens. Em v_consumo_enfermagem a coluna
-- "kits" se repete em cada linha de item do mesmo kit (e a quantidade daquele
-- kit, nao uma parcela): somar aquela coluna multiplicaria o numero de kits
-- pelo tamanho da composicao. Quem conta kit usa esta view.
create or replace view public.v_kits_enfermagem as
select
  r.id                    as request_id,
  r.request_number        as numero,
  r.created_at            as data,
  r.delivered_at          as entregue_em,
  r.status                as status,
  d.name                  as setor,
  rk.kit_id               as kit_id,
  rk.kit_name             as kit,
  rk.patient_id           as paciente_id,
  rk.patient_name         as paciente,
  p.medical_record_number as prontuario,
  rk.quantity             as kits
from public.request_kits rk
join public.requests r on r.id = rk.request_id
left join public.departments d on d.id = r.department_id
left join public.patients p on p.id = rk.patient_id;

grant select on public.v_kits_enfermagem to authenticated;
