-- Movimentação Diária: passa a ser um EXTRATO por movimento, com saldo antes,
-- quantidade movimentada e saldo depois — a pedido.
--
-- O saldo é reconstruído ANCORADO no saldo ATUAL (item_stocks) andando para
-- trás pelos movimentos. Assim fica fiel mesmo tendo havido ajustes fora de
-- movimento (zeragem/recontagem): o saldo dos movimentos recentes bate com o
-- estoque real de hoje.
--
-- Retorno mudou de forma, então DROP antes.
DROP FUNCTION IF EXISTS public.farmacia_movimentacao_diaria(text, date, date, text);

CREATE OR REPLACE FUNCTION public.farmacia_movimentacao_diaria(
  p_location_code text,
  p_inicio date,
  p_fim date,
  p_classe text DEFAULT NULL
)
RETURNS TABLE(
  dia date,
  momento timestamptz,
  item_id uuid,
  item_name text,
  medication_class text,
  tipo text,
  saldo_antes bigint,
  movimentado bigint,
  saldo_depois bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $$
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
    select m.id, m.item_id, m.performed_at, m.movement_type, m.quantity,
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
    (coalesce(a.quantity, 0) - c.delta_apos)::bigint as saldo_depois
  from calc c
  join public.pharmacy_items pi on pi.id = c.item_id
  left join atual a on a.item_id = c.item_id
  where c.delta < 0   -- só as SAÍDAS
    and (c.performed_at at time zone 'America/Bahia')::date between p_inicio and p_fim
    and (p_classe is null or pi.medication_class = p_classe)
  order by c.performed_at desc;
$$;

GRANT EXECUTE ON FUNCTION public.farmacia_movimentacao_diaria(text, date, date, text) TO authenticated;
