-- Auditoria 28/09/2026 (aplicada na VPS no mesmo dia, antes do conserto completo):
-- pedido do almox concluido por ATENDENTE e Saida Direta de atendente nao
-- baixavam estoque. Os gatilhos rodavam como quem clicava (SECURITY INVOKER) e a
-- policy de UPDATE de warehouse_items so aceita admin/administrador/gestor ->
-- o UPDATE afetava 0 linhas sem erro. Ex.: cânula traqueostomia nº 8 (#49799,
-- 25/09) e colchao casca de ovo (12 pedidos desde 23/09) sem baixa.
-- Teste em transacao desfeita com o Anderson: saldo 2 -> 2 antes, 2 -> 1 depois.
alter function public.deduct_stock_on_request_delivered() security definer;
alter function public.deduct_stock_on_request_delivered() set search_path = public, pg_temp;
alter function public.deduct_warehouse_stock() security definer;
alter function public.deduct_warehouse_stock() set search_path = public, pg_temp;
