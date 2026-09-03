-- Estatisticas de Consumo - Almoxarifado sempre mostrava 0 items / R$0,00,
-- pra qualquer item e qualquer periodo. Causa: a tela le de
-- warehouse_consumption_entries, uma tabela de lancamento MANUAL (tela
-- "Gestao de Consumo" do admin) que nunca foi usada — 0 linhas desde que
-- existe. O consumo real do almoxarifado nunca passou por ali:
--
-- 1) A GRANDE maioria (2615 itens, 319.709 unidades) sai quando uma
--    solicitacao e entregue — o trigger deduct_stock_on_request_delivered()
--    debita direto warehouse_items.current_stock, sem deixar rastro em
--    nenhuma tabela de historico.
-- 2) Saida avulsa/quebra (735 movimentos, 33.383 unidades) fica em
--    stock_movements (destino_tipo='setor_interno', direction='out') —
--    tela "Quebras e Avarias".
-- 3) O lancamento manual (warehouse_consumption_entries) existe e pode vir
--    a ser usado (o item picker dele tinha o mesmo bug de categoria ja
--    corrigido) — mantido na uniao pra nao ficar orfao se alguem usar.
--
-- Esta view reconstrói consumo real unindo as 3 fontes. Read-only, nao
-- altera nenhuma tabela nem trigger existente.

create or replace view public.v_warehouse_consumption as
select
  ri.id as source_id,
  ri.warehouse_item_id as item_id,
  coalesce(ri.supplied_quantity, ri.approved_quantity, ri.quantity)::numeric as quantity,
  r.department_id,
  coalesce(r.delivered_at, r.updated_at)::date as consumption_date,
  'solicitacao'::text as origem
from request_items ri
join requests r on r.id = ri.request_id
where r.type = 'warehouse'
  and r.status in ('delivered', 'completed')
  and ri.warehouse_item_id is not null
  and coalesce(ri.supplied_quantity, ri.approved_quantity, ri.quantity) > 0

union all

select
  sm.id as source_id,
  sm.item_id,
  sm.quantity::numeric,
  d.id as department_id,
  sm.performed_at::date as consumption_date,
  'avulsa'::text as origem
from stock_movements sm
join departments d on d.name = sm.destino_nome
where sm.item_type = 'warehouse'
  and sm.direction = 'out'
  and sm.destino_tipo = 'setor_interno'

union all

select
  wce.id as source_id,
  wce.item_id,
  wce.quantity::numeric,
  wce.department_id,
  wce.date as consumption_date,
  'manual'::text as origem
from warehouse_consumption_entries wce;
