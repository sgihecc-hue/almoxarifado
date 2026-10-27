-- Estoque minimo da farmacia (Cris, 27/10/2026): consumo medio diario x 45 dias
-- (prazo medio ate receber). Consumo = dispensacao ao paciente (PRESCRICAO,
-- qualquer estoque) menos o que voltou (devolucao interna e estorno de
-- dispensacao), nos ultimos p_dias. Solicitacao CAF -> satelite NAO e consumo
-- (so muda o remedio de lugar).
create or replace function public.farmacia_consumo_diario(p_dias integer default 90)
returns table(item_id uuid, qtd_periodo numeric, consumo_dia numeric)
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  with base as (
    select m.item_id,
           case
             when m.direction = 'out' and m.movement_type = 'PRESCRICAO' then m.quantity::numeric
             when m.direction = 'in' and m.movement_type = 'DEVOLUCAO_INT' then -m.quantity::numeric
             when m.direction = 'in' and m.movement_type = 'AJUSTE' and m.dispensation_id is not null then -m.quantity::numeric
             else 0
           end as q
      from public.stock_movements m
     where m.item_type = 'pharmacy'
       and m.performed_at >= now() - make_interval(days => greatest(coalesce(p_dias, 90), 1))
  )
  select item_id, sum(q) as qtd_periodo, round(sum(q) / greatest(coalesce(p_dias, 90), 1), 2) as consumo_dia
    from base
   where item_id is not null
   group by item_id
  having sum(q) > 0;
$function$;

grant execute on function public.farmacia_consumo_diario(integer) to authenticated;
