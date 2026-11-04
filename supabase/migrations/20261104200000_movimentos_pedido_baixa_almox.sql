-- Correcao de 20261104180000_movimentos_com_local.
-- O ramo de pedidos usava r.source_location_id como local. So que pedido de
-- material dos postos vem marcado com origem Satelite Terreo (padrao do setor)
-- e quem atende e da baixa e o ALMOXARIFADO (deduct_stock_on_request_delivered
-- sempre abate warehouse_items, exceto pedido de enfermagem). Resultado: 84
-- pedidos / 190 linhas que sairam do almox sumiram da Movimentacao e do
-- Consumo do almox. Regra agora = mesma regra da baixa: pedido de material que
-- nao e de enfermagem conta no ALMOX; o resto segue com source_location_id.
do $$
declare
  v_def text;
  v_novo text;
  v_expr constant text :=
    'CASE WHEN ((r.type = ''warehouse''::text) AND (NOT (EXISTS (SELECT 1 FROM request_kits rk_l WHERE (rk_l.request_id = r.id)))) '
    || 'AND (NOT (EXISTS (SELECT 1 FROM request_item_patients rip_l WHERE (rip_l.request_id = r.id))))) '
    || 'THEN ''ad02bf13-ab91-42e0-bfe7-b2e5bbb01e40''::uuid ELSE r.source_location_id END AS local_id';
  v_view text;
begin
  foreach v_view in array array['v_inventory_movements', 'v_warehouse_consumption']
  loop
    v_def := pg_get_viewdef(('public.' || v_view)::regclass);
    if (select count(*) from regexp_matches(v_def, 'r\.source_location_id AS local_id', 'g')) <> 1 then
      raise exception '%: esperava 1 ocorrencia de r.source_location_id AS local_id', v_view;
    end if;
    v_novo := replace(v_def, 'r.source_location_id AS local_id', v_expr);
    execute format('create or replace view public.%I as %s', v_view, v_novo);
  end loop;
end $$;
