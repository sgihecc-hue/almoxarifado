-- ALMOXARIFADO: consumo médio diário calculado das saídas reais + ponto de
-- ressuprimento. NÃO afeta farmácia — só lê tabelas (para agregação) e a
-- coluna nova é criada apenas em warehouse_items.
--
-- Fórmula (definida pelo usuário):
--   Ponto de Ressuprimento = (consumo/dia × prazo de reposição) + estoque mínimo
--   consumo/dia = saídas dos últimos 30 dias ÷ 30
--
-- O estoque mínimo continua sendo o warehouse_items.min_stock digitado à mão.
-- O prazo de reposição é warehouse_items.lead_time_days.

-- 1) Fallback manual: consumo diário informado, usado SÓ quando o item ainda
--    não tem saídas registradas (itens novos). un/dia.
ALTER TABLE public.warehouse_items
  ADD COLUMN IF NOT EXISTS avg_daily_consumption numeric;

COMMENT ON COLUMN public.warehouse_items.avg_daily_consumption IS
  'Consumo médio diário informado (un/dia). Usado apenas quando não há saídas nos últimos 30 dias (o cálculo automático tem prioridade).';

-- 2) Consumo diário CALCULADO dos últimos 30 dias, por item de almox.
--    Fontes de saída:
--      a) solicitações de almox entregues/concluídas (canal principal);
--      b) saídas diretas concluídas;
--      c) estornos (warehouse_request_returns) entram NEGATIVO — devolveram ao
--         estoque, então reduzem o consumo líquido.
--    SECURITY DEFINER: agrega tabelas com RLS (requests/request_items) e
--    devolve só o número de consumo, sem expor linha a linha.
CREATE OR REPLACE FUNCTION public.warehouse_consumo_diario()
RETURNS TABLE(item_id uuid, qtd_30d numeric, consumo_dia numeric)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $$
  WITH base AS (
    -- a) solicitações entregues
    SELECT ri.warehouse_item_id AS iid,
           coalesce(ri.supplied_quantity, ri.quantity, 0)::numeric AS q
      FROM request_items ri
      JOIN requests r ON r.id = ri.request_id
     WHERE r.type = 'warehouse'
       AND r.status IN ('delivered','completed')
       AND ri.warehouse_item_id IS NOT NULL
       AND coalesce(r.delivered_at, r.completed_at, r.received_at)
             >= now() - interval '30 days'

    UNION ALL
    -- b) saídas diretas concluídas
    SELECT di.item_id AS iid, di.quantity::numeric
      FROM warehouse_dispatch_items di
      JOIN warehouse_dispatches d ON d.id = di.dispatch_id
     WHERE d.status = 'completed'
       AND d.created_at >= now() - interval '30 days'

    UNION ALL
    -- c) estornos devolvem ao estoque => consumo líquido menor
    SELECT wrr.warehouse_item_id AS iid, -wrr.quantity::numeric
      FROM warehouse_request_returns wrr
     WHERE wrr.warehouse_item_id IS NOT NULL
       AND wrr.returned_at >= now() - interval '30 days'
  )
  SELECT iid AS item_id,
         sum(q) AS qtd_30d,
         round(sum(q) / 30.0, 2) AS consumo_dia
    FROM base
   WHERE iid IS NOT NULL
   GROUP BY iid
  HAVING sum(q) > 0;
$$;

GRANT EXECUTE ON FUNCTION public.warehouse_consumo_diario() TO authenticated;
