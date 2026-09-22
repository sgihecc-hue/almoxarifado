-- RELATORIOS: lote e validade no Consumo do almoxarifado e na Movimentacao
-- Diaria da farmacia (pedido do Adonias, 22/09/2026: "tanto farmacia quanto
-- almox").
--
-- 1. v_warehouse_consumption ganha lote e validade NO FIM (create or replace
--    view so aceita colunas novas no fim):
--      solicitacao -> lote(s) informados no atendimento (almox_lotes /
--                     almox_batch_number); vazio quando o almox nao informou;
--      avulsa      -> lote do movimento (stock_movements.expiry_tracking_id);
--      manual      -> nao tem lote.
-- 2. farmacia_movimentacao_diaria devolve lote e validade de cada saida (lote
--    do proprio movimento no livro-razao). Mudou o tipo de retorno, entao
--    DROP + CREATE; atributos e permissoes iguais aos de producao.
--
-- Nenhum dado de estoque e alterado: sao so leituras.

create or replace view public.v_warehouse_consumption as
 SELECT ri.id AS source_id,
    ri.warehouse_item_id AS item_id,
    COALESCE(ri.supplied_quantity, ri.approved_quantity, ri.quantity)::numeric AS quantity,
    r.department_id,
    COALESCE(r.delivered_at, r.updated_at)::date AS consumption_date,
    'solicitacao'::text AS origem,
    COALESCE((SELECT string_agg(l.value ->> 'lote'::text, '; '::text) FROM jsonb_array_elements(CASE WHEN jsonb_typeof(ri.almox_lotes) = 'array'::text THEN ri.almox_lotes ELSE '[]'::jsonb END) l(value)
               WHERE NULLIF(btrim(l.value ->> 'lote'::text), ''::text) IS NOT NULL),
             NULLIF(btrim(ri.almox_batch_number), ''::text)) AS lote,
    COALESCE((SELECT min((l.value ->> 'validade'::text)::date) FROM jsonb_array_elements(CASE WHEN jsonb_typeof(ri.almox_lotes) = 'array'::text THEN ri.almox_lotes ELSE '[]'::jsonb END) l(value)
               WHERE (l.value ->> 'validade'::text) ~ '^\d{4}-\d{2}-\d{2}$'::text),
             ri.almox_expiry_date) AS validade
   FROM request_items ri
     JOIN requests r ON r.id = ri.request_id
  WHERE r.type = 'warehouse'::text AND (r.status = ANY (ARRAY['delivered'::text, 'completed'::text])) AND ri.warehouse_item_id IS NOT NULL AND COALESCE(ri.supplied_quantity, ri.approved_quantity, ri.quantity) > 0
UNION ALL
 SELECT sm.id AS source_id,
    sm.item_id,
    sm.quantity::numeric AS quantity,
    d.id AS department_id,
    sm.performed_at::date AS consumption_date,
    'avulsa'::text AS origem,
    et.batch_number AS lote,
    et.expiry_date AS validade
   FROM stock_movements sm
     JOIN departments d ON d.name = sm.destino_nome
     LEFT JOIN expiry_tracking et ON et.id = sm.expiry_tracking_id
  WHERE sm.item_type = 'warehouse'::text AND sm.direction = 'out'::text AND sm.destino_tipo = 'setor_interno'::text
UNION ALL
 SELECT wce.id AS source_id,
    wce.item_id,
    wce.quantity::numeric AS quantity,
    wce.department_id,
    wce.date AS consumption_date,
    'manual'::text AS origem,
    NULL::text AS lote,
    NULL::date AS validade
   FROM warehouse_consumption_entries wce;

drop function if exists public.farmacia_movimentacao_diaria(text, date, date, text);
create function public.farmacia_movimentacao_diaria(
  p_location_code text, p_inicio date, p_fim date, p_classe text default null)
returns table(dia date, momento timestamp with time zone, item_id uuid, item_name text,
              medication_class text, tipo text, saldo_antes bigint, movimentado bigint,
              saldo_depois bigint, lote text, validade date)
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  with loc as (
    select id from public.stock_locations where code = p_location_code
  ),
  -- saldo atual do item NESTE local (âncora)
  atual as (
    select s.item_id, s.quantity
    from public.item_stocks s, loc
    where s.item_type = 'pharmacy' and s.location_id = loc.id
  ),
  -- todos os movimentos de farmácia que AFETAM este local, com delta assinado
  -- (entrada = +qtd; saída = -qtd)
  movs as (
    select m.id, m.item_id, m.performed_at, m.movement_type, m.quantity, m.expiry_tracking_id,
           case when m.direction = 'in' then m.quantity else -m.quantity end as delta
    from public.stock_movements m, loc
    where m.item_type = 'pharmacy'
      and ( (m.direction = 'out' and m.source_location_id = loc.id)
         or (m.direction = 'in'  and m.target_location_id = loc.id) )
  ),
  calc as (
    select mv.*,
      -- soma dos deltas dos movimentos POSTERIORES a este (mesmo item)
      coalesce(sum(mv.delta) over (
        partition by mv.item_id order by mv.performed_at, mv.id
        rows between 1 following and unbounded following
      ), 0) as delta_apos
    from movs mv
  )
  select
    (c.performed_at at time zone 'America/Bahia')::date as dia,
    c.performed_at as momento,
    c.item_id,
    pi.name as item_name,
    pi.medication_class,
    c.movement_type as tipo,
    (coalesce(a.quantity, 0) - c.delta_apos - c.delta)::bigint as saldo_antes,
    c.quantity::bigint as movimentado,
    (coalesce(a.quantity, 0) - c.delta_apos)::bigint as saldo_depois,
    et.batch_number as lote,
    et.expiry_date as validade
  from calc c
  left join public.expiry_tracking et on et.id = c.expiry_tracking_id
  join public.pharmacy_items pi on pi.id = c.item_id
  left join atual a on a.item_id = c.item_id
  where c.delta < 0   -- só as SAÍDAS
    and (c.performed_at at time zone 'America/Bahia')::date between p_inicio and p_fim
    and (p_classe is null or pi.medication_class = p_classe)
  order by c.performed_at desc;
$function$;
grant execute on function public.farmacia_movimentacao_diaria(text, date, date, text) to anon, authenticated, service_role;
