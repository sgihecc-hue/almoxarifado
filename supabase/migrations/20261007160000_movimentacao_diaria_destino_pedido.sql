-- 07/10/2026: pedido da Andressa. Ver o que a CAF mandou para cada satelite
-- (data, quantidade, lote, validade) e exportar. A Movimentacao Diaria ja
-- trazia as saidas por atendimento de pedido, mas sem destino nem numero do
-- pedido. Acrescenta: pedido, destino e responsavel (quem registrou).
DROP FUNCTION IF EXISTS public.farmacia_movimentacao_diaria(text, date, date, text);

CREATE OR REPLACE FUNCTION public.farmacia_movimentacao_diaria(p_location_code text, p_inicio date, p_fim date, p_classe text DEFAULT NULL::text)
 RETURNS TABLE(dia date, momento timestamp with time zone, item_id uuid, item_name text, medication_class text, tipo text,
               saldo_antes bigint, movimentado bigint, saldo_depois bigint, lote text, validade date,
               pedido integer, destino text, responsavel text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  with loc as (
    select id from public.stock_locations where code = p_location_code
  ),
  atual as (
    select s.item_id, s.quantity
    from public.item_stocks s, loc
    where s.item_type = 'pharmacy' and s.location_id = loc.id
  ),
  movs as (
    select m.id, m.item_id, m.performed_at, m.movement_type, m.quantity, m.expiry_tracking_id,
           m.request_id, m.linked_movement_id, m.destino_nome, m.performed_by,
           case when m.direction = 'in' then m.quantity else -m.quantity end as delta
    from public.stock_movements m, loc
    where m.item_type = 'pharmacy'
      and ( (m.direction = 'out' and m.source_location_id = loc.id)
         or (m.direction = 'in'  and m.target_location_id = loc.id) )
  ),
  calc as (
    select mv.*,
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
    et.expiry_date as validade,
    r.request_number::integer as pedido,
    coalesce(rl.name, ll.name, nullif(c.destino_nome, '')) as destino,
    u.full_name as responsavel
  from calc c
  left join public.expiry_tracking et on et.id = c.expiry_tracking_id
  join public.pharmacy_items pi on pi.id = c.item_id
  left join atual a on a.item_id = c.item_id
  left join public.requests r on r.id = c.request_id
  left join public.stock_locations rl on rl.id = r.target_location_id
  left join public.stock_movements lm on lm.id = c.linked_movement_id
  left join public.stock_locations ll on ll.id = lm.target_location_id
  left join public.users u on u.id = c.performed_by
  where c.delta < 0
    and (c.performed_at at time zone 'America/Bahia')::date between p_inicio and p_fim
    and (p_classe is null or pi.medication_class = p_classe)
  order by c.performed_at desc, c.id;
$function$;

REVOKE ALL ON FUNCTION public.farmacia_movimentacao_diaria(text, date, date, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.farmacia_movimentacao_diaria(text, date, date, text) TO authenticated, service_role;
