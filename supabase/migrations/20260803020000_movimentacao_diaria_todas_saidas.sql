-- Movimentação Diária: passa a mostrar TODAS as saídas do estoque por dia
-- (não só dispensações), a pedido. Fonte: stock_movements (livro-razão), com
-- o tipo de cada saída — Dispensação, Quebra/Avulsa, Solicitação, Ajuste.
-- Empréstimos (pharmacy_loans) são tabela à parte e não geram stock_movement,
-- então não entram aqui.
--
-- O retorno mudou de forma (ganhou "tipo"), então precisa DROP antes.
DROP FUNCTION IF EXISTS public.farmacia_movimentacao_diaria(text, date, date, text);

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
  tipo text,
  quantidade bigint,
  ocorrencias bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $$
  select
    (m.performed_at at time zone 'America/Bahia')::date as dia,
    m.item_id,
    pi.name as item_name,
    pi.medication_class,
    m.movement_type as tipo,
    sum(m.quantity)::bigint as quantidade,
    count(*)::bigint as ocorrencias
  from public.stock_movements m
  join public.pharmacy_items pi on pi.id = m.item_id
  join public.stock_locations l on l.id = m.source_location_id
  where m.item_type = 'pharmacy'
    and m.direction = 'out'
    and l.code = p_location_code
    and (m.performed_at at time zone 'America/Bahia')::date between p_inicio and p_fim
    and (p_classe is null or pi.medication_class = p_classe)
  group by 1, 2, 3, 4, 5
  order by dia desc, item_name;
$$;

GRANT EXECUTE ON FUNCTION public.farmacia_movimentacao_diaria(text, date, date, text) TO authenticated;
