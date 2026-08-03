-- Movimentação Diária (farmácia): o que saiu por dispensação, por dia, num
-- estoque (satélite). Fonte: pharmacy_dispensation_items + pharmacy_dispensations
-- (só concluídas). Agrupa por dia + item. Filtro opcional por classe.
-- SECURITY DEFINER: agrega tabelas com RLS e devolve só o resumo.
CREATE OR REPLACE FUNCTION public.farmacia_movimentacao_diaria(
  p_location_code text,
  p_inicio date,
  p_fim date,
  p_classe text DEFAULT NULL
)
RETURNS TABLE(
  dia date,
  item_id uuid,
  item_name text,
  medication_class text,
  quantidade bigint,
  dispensacoes bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $$
  select
    (d.created_at at time zone 'America/Bahia')::date as dia,
    di.item_id,
    pi.name as item_name,
    pi.medication_class,
    sum(di.quantity)::bigint as quantidade,
    count(distinct d.id)::bigint as dispensacoes
  from public.pharmacy_dispensation_items di
  join public.pharmacy_dispensations d on d.id = di.dispensation_id
  join public.pharmacy_items pi on pi.id = di.item_id
  join public.stock_locations l on l.id = d.source_location_id
  where l.code = p_location_code
    and d.status = 'completed'
    and (d.created_at at time zone 'America/Bahia')::date between p_inicio and p_fim
    and (p_classe is null or pi.medication_class = p_classe)
  group by 1, 2, 3, 4
  order by dia desc, item_name;
$$;

GRANT EXECUTE ON FUNCTION public.farmacia_movimentacao_diaria(text, date, date, text) TO authenticated;
