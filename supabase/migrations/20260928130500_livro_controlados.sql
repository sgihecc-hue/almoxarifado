-- =============================================================================
-- LIVRO DE CONTROLADOS (auditoria 28/09/2026 — C7, M10)
--
-- C7: a tela nunca abria. Pedia colunas que nao existem em stock_movements
--     (created_at, reference_number, balance_after), juntava pharmacy_items e
--     expiry_tracking por relacao inexistente (PGRST200), trazia as 2000
--     movimentacoes MAIS ANTIGAS de tudo e filtrava no navegador. Abrir livro
--     tambem falhava: livros_controlados nao tem numero_livro/RT/textos.
--     Agora:
--       * livro_controlados_movimentos(): filtra por lista/item/periodo NO
--         BANCO, pagina, traz lote/validade/local/historico e o SALDO apos
--         cada movimento (ancorado no saldo atual: saldo atual menos o que
--         aconteceu depois). Transferencias entre estoques da propria
--         farmacia nao entram (nao mudam o saldo do estabelecimento).
--       * livros_controlados ganha as colunas que a tela grava.
-- M10: fn_log_controlled usava is_controlled (falso em TODOS os itens) e o
--     livro/BMPO usavam medication_class — Morfina 1mg/mL, Morfina 0,1mg/mL,
--     Fenobarbital e Carbonato de Litio ficavam fora de um dos dois; Mirtazapina
--     e Acido Valproico (C1) tem subclasse mas classe "uso geral".
--     Criterio unico: fn_item_controlado = tem subclasse da Portaria 344
--     OU classe 'controlados' OR is_controlled.
--     fn_set_livro_seq fazia MAX+1 sem trava (dois movimentos simultaneos
--     pegavam o mesmo numero). Agora trava por livro (advisory lock) e numera
--     por LIVRO (A1/A2, A3/B1/B2, C1/C2/C4/C5, C3) — hoje cada livro so tem uma
--     subclasse em uso, entao a numeracao existente continua do mesmo ponto.
-- =============================================================================

create or replace function public.fn_livro_grupo(p_subclasse text)
returns text
language sql immutable set search_path to 'public', 'pg_temp' as $f$
  select case upper(coalesce(p_subclasse,''))
           when 'A1' then 'A1_A2' when 'A2' then 'A1_A2'
           when 'A3' then 'A3_B1_B2' when 'B1' then 'A3_B1_B2' when 'B2' then 'A3_B1_B2'
           when 'C1' then 'C1_C2_C4_C5' when 'C2' then 'C1_C2_C4_C5' when 'C4' then 'C1_C2_C4_C5' when 'C5' then 'C1_C2_C4_C5'
           when 'C3' then 'C3'
           else null end
$f$;

create or replace function public.fn_item_controlado(p_item uuid)
returns boolean
language sql stable security definer set search_path to 'public', 'pg_temp' as $f$
  select coalesce((select p.controlled_subclass is not null
                          or p.medication_class = 'controlados'
                          or coalesce(p.is_controlled, false)
                     from public.pharmacy_items p where p.id = p_item), false)
$f$;
revoke execute on function public.fn_item_controlado(uuid) from public, anon;
grant execute on function public.fn_item_controlado(uuid) to authenticated;

create or replace function public.fn_log_controlled()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $f$
begin
  if new.item_type = 'pharmacy' and public.fn_item_controlado(new.item_id) then
    insert into public.controlled_log(movement_id) values (new.id);
  end if;
  return new;
end $f$;

create index if not exists stock_movements_livro_seq on public.stock_movements (livro_seq) where livro_seq is not null;

create or replace function public.fn_set_livro_seq()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $f$
declare
  v_grupo text;
  v_seq integer;
begin
  if new.item_type <> 'pharmacy' then return new; end if;
  select case when p.controlled_subclass is not null then public.fn_livro_grupo(p.controlled_subclass)
              when p.medication_class = 'controlados' or coalesce(p.is_controlled,false) then 'SEM_LISTA'
              else null end
    into v_grupo
    from public.pharmacy_items p where p.id = new.item_id;
  if v_grupo is null or v_grupo = 'SEM_LISTA' then return new; end if;

  -- um numerador por livro, sem corrida
  perform pg_advisory_xact_lock(hashtext('livro_seq:' || v_grupo));
  select coalesce(max(m.livro_seq), 0) + 1 into v_seq
    from public.stock_movements m
    join public.pharmacy_items p on p.id = m.item_id
   where m.livro_seq is not null
     and public.fn_livro_grupo(p.controlled_subclass) = v_grupo;
  new.livro_seq := v_seq;
  return new;
end $f$;

-- Colunas que a tela de abertura/encerramento grava
alter table public.livros_controlados
  add column if not exists numero_livro integer,
  add column if not exists termo_abertura_texto text,
  add column if not exists termo_encerramento_texto text,
  add column if not exists responsavel_tecnico_nome text,
  add column if not exists responsavel_tecnico_crf text;

-- Farmaceutico (RT) tambem consulta o livro
drop policy if exists livros_select on public.livros_controlados;
create policy livros_select on public.livros_controlados for select to authenticated
  using (auth_user_role() = any (array['administrador','gestor','atendente','pharmacist']));

-- ---------------------------------------------------------------------------
create or replace function public.livro_controlados_movimentos(
  p_lista text,
  p_item_id uuid default null,
  p_de date default null,
  p_ate date default null,
  p_limite integer default 50,
  p_offset integer default 0)
returns table(
  id uuid, performed_at timestamptz, livro_seq integer, movement_type text, direction text,
  quantity integer, item_id uuid, item_nome text, item_codigo text, subclasse text,
  lote text, validade date, local_codigo text, historico text, saldo_depois bigint, total bigint)
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $f$
begin
  perform public.fn_saidas_exigir_operador('farmacia');
  if p_lista not in ('A1_A2','A3_B1_B2','C1_C2_C4_C5','C3','antimicrobianos') then
    raise exception 'Lista invalida: %', p_lista;
  end if;

  return query
  with itens as (
    select p.id, p.name, p.code, p.controlled_subclass
      from public.pharmacy_items p
     where (p_item_id is null or p.id = p_item_id)
       and case when p_lista = 'antimicrobianos' then p.medication_class = 'antimicrobianos'
                else public.fn_livro_grupo(p.controlled_subclass) = p_lista end
  ),
  movs as (
    select m.*,
           case when m.direction = 'in' then m.quantity else -m.quantity end as delta
      from public.stock_movements m
      join itens i on i.id = m.item_id
     where m.item_type = 'pharmacy'
       -- transferencias internas (CAF <-> satelites) nao mudam o saldo do estabelecimento
       and not (m.movement_type = 'TRANSFERENCIA'
                and (m.direction = 'in' or m.destino_tipo = 'estoque_interno'
                     or m.transfer_id is not null or m.linked_movement_id is not null))
       and not (m.movement_type = 'DEVOLUCAO_INT' and m.reason_detail = 'Estorno de transferencia')
  ),
  atual as (
    select s.item_id, sum(s.quantity)::bigint as q
      from public.item_stocks s join itens i on i.id = s.item_id
     where s.item_type = 'pharmacy'
     group by s.item_id
  ),
  comsaldo as (
    select mv.*,
           coalesce(a.q, 0)
             - coalesce(sum(mv.delta) over (partition by mv.item_id order by mv.performed_at desc, mv.id desc
                                            rows between unbounded preceding and 1 preceding), 0) as saldo
      from movs mv left join atual a on a.item_id = mv.item_id
  ),
  filtrado as (
    select c.* from comsaldo c
     where (p_de is null or c.performed_at >= (p_de::timestamp at time zone 'America/Bahia'))
       and (p_ate is null or c.performed_at < ((p_ate + 1)::timestamp at time zone 'America/Bahia'))
  )
  select f.id, f.performed_at, f.livro_seq, f.movement_type, f.direction, f.quantity,
         f.item_id, i.name, i.code, i.controlled_subclass,
         e.batch_number, e.expiry_date, l.code,
         nullif(concat_ws(' · ',
           case when f.medical_record_number is not null then 'Prontuario ' || f.medical_record_number end,
           case when f.dispensation_id is not null then 'Dispensacao' end,
           f.reason, f.reason_detail, f.destino_nome, f.notes, f.historico), '') as historico,
         f.saldo::bigint,
         count(*) over ()::bigint
    from filtrado f
    join itens i on i.id = f.item_id
    left join public.expiry_tracking e on e.id = f.expiry_tracking_id
    left join public.stock_locations l on l.id = coalesce(f.source_location_id, f.target_location_id)
   order by f.performed_at asc, f.id asc
   limit greatest(1, least(coalesce(p_limite, 50), 500))
   offset greatest(0, coalesce(p_offset, 0));
end $f$;
revoke execute on function public.livro_controlados_movimentos(text, uuid, date, date, integer, integer) from public, anon;
grant execute on function public.livro_controlados_movimentos(text, uuid, date, date, integer, integer) to authenticated;
