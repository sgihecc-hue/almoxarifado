-- N9 (auditoria 28/09/2026): Movimentacao Diaria da farmacia cortava em 1000
-- linhas (teto do PostgREST, tambem nas RPCs). A tela passa a paginar com
-- .range(); para a paginacao nao pular/repetir linha a ordem precisa ser
-- estavel: desempate por id do movimento. Mesma assinatura, mesmo retorno,
-- mesmas permissoes (CREATE OR REPLACE). So leitura.

CREATE OR REPLACE FUNCTION public.farmacia_movimentacao_diaria(p_location_code text, p_inicio date, p_fim date, p_classe text DEFAULT NULL::text)
 RETURNS TABLE(dia date, momento timestamp with time zone, item_id uuid, item_name text, medication_class text, tipo text, saldo_antes bigint, movimentado bigint, saldo_depois bigint, lote text, validade date)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
  order by c.performed_at desc, c.id;
$function$
;
