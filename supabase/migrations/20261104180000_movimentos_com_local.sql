-- Rafaela 04/11: "ta aparecendo as saidas da farmacia no meu almox".
-- A Satelite Terreo usa o catalogo do almox (item_type='warehouse'), entao as
-- saidas avulsas dela (1.294 em outubro) entravam no relatorio de Movimentacoes
-- e nas Estatisticas de Consumo do almox. As duas views ganham a coluna
-- local_id (estoque de onde saiu/entrou) para as telas do almox filtrarem.
-- Feito em cima do pg_get_viewdef, so acrescentando a coluna no fim de cada ramo.
do $mig$
declare
  d text;
begin
  d := pg_get_viewdef('public.v_inventory_movements'::regclass);
  if d like '%local_id%' then raise notice 'v_inventory_movements ja tem local_id'; else
    d := regexp_replace(d, 'AS is_active(\s+FROM \(+stock_entries se)', 'AS is_active, se.location_id AS local_id\1');
    d := regexp_replace(d, 'AS is_active(\s+FROM \(+warehouse_dispatches wd)', 'AS is_active, NULL::uuid AS local_id\1');
    d := regexp_replace(d, 'AS is_active(\s+FROM \(+request_items ri)', 'AS is_active, r.source_location_id AS local_id\1');
    d := regexp_replace(d, 'AS is_active(\s+FROM \(+pharmacy_loan_items pli)', 'AS is_active, NULL::uuid AS local_id\1');
    d := regexp_replace(d, 'AS is_active(\s+FROM \(+stock_movements sm)', 'AS is_active, CASE WHEN sm.direction = ''in'' THEN sm.target_location_id ELSE sm.source_location_id END AS local_id\1');
    d := regexp_replace(d, 'AS is_active(\s+FROM \(+almox_movimentos am)', 'AS is_active, NULL::uuid AS local_id\1');
    if (length(d) - length(replace(d, 'AS local_id', ''))) / length('AS local_id') <> 6 then
      raise exception 'v_inventory_movements: esperava 6 ramos com local_id';
    end if;
    execute 'create or replace view public.v_inventory_movements as ' || d;
  end if;

  d := pg_get_viewdef('public.v_warehouse_consumption'::regclass);
  if d like '%local_id%' then raise notice 'v_warehouse_consumption ja tem local_id'; else
    d := regexp_replace(d, 'AS destino_texto(\s+FROM \(+request_items ri)', 'AS destino_texto, r.source_location_id AS local_id\1');
    d := regexp_replace(d, 'AS destino_texto(\s+FROM \(+stock_movements sm)', 'AS destino_texto, sm.source_location_id AS local_id\1');
    d := regexp_replace(d, 'AS destino_texto(\s+FROM warehouse_consumption_entries wce)', 'AS destino_texto, NULL::uuid AS local_id\1');
    d := regexp_replace(d, 'AS destino_texto(\s+FROM \(+warehouse_dispatches wd)', 'AS destino_texto, NULL::uuid AS local_id\1');
    if (length(d) - length(replace(d, 'AS local_id', ''))) / length('AS local_id') <> 4 then
      raise exception 'v_warehouse_consumption: esperava 4 ramos com local_id';
    end if;
    execute 'create or replace view public.v_warehouse_consumption as ' || d;
  end if;
end
$mig$;
