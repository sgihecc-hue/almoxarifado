-- N10 (auditoria 28/09/2026): relatorios multi-estoque da farmacia.
--  * mes no fuso America/Bahia (antes date_trunc em UTC: saida do dia 31 depois
--    das 21h caia no mes seguinte);
--  * custo: unit_cost do movimento, senao ultimo preco de compra, senao price
--    (price esta vazio em todo o cadastro da farmacia: custo e valor parado
--    saiam R$ 0,00 sempre);
--  * v_consumo_global: tira SOLICITACAO (reposicao CAF -> satelite) e a
--    transferencia entre estoques internos, que so mudam o item de lugar
--    dentro da farmacia (contavam o mesmo consumo duas vezes);
--  * v_consumo_por_local e v_perdas ganham item_type NO FIM (a tela filtra so
--    farmacia; antes misturava a saida avulsa do almoxarifado).
-- Teste (transacao desfeita, setembro/farmacia): consumo global 49.936 -> 30.769 un,
-- custo R$ 0,00 -> R$ 2.110,39; valor parado R$ 0,00 -> R$ 146.456,95; perdas R$ 0 -> R$ 61,01.
-- So leitura; CREATE OR REPLACE mantem dono e permissoes.

create or replace view public.v_consumo_global as
 SELECT date_trunc('month'::text, (m.performed_at AT TIME ZONE 'America/Bahia'::text))::date AS mes,
    m.item_id,
    m.item_type,
    sum(m.quantity) AS qtd_total,
    sum(m.quantity::numeric * COALESCE(m.unit_cost, pi.last_purchase_price, wi.last_purchase_price, pi.price, wi.price, 0::numeric)) AS custo_total
   FROM stock_movements m
     LEFT JOIN pharmacy_items pi ON pi.id = m.item_id AND m.item_type = 'pharmacy'::text
     LEFT JOIN warehouse_items wi ON wi.id = m.item_id AND m.item_type = 'warehouse'::text
  WHERE m.direction = 'out'::text
    AND (m.movement_type = ANY (ARRAY['PRESCRICAO'::text, 'SAIDA_AVULSA'::text, 'TRANSFERENCIA'::text]))
    AND NOT (m.movement_type = 'TRANSFERENCIA'::text AND m.destino_tipo = 'estoque_interno'::text)
  GROUP BY (date_trunc('month'::text, (m.performed_at AT TIME ZONE 'America/Bahia'::text))::date), m.item_id, m.item_type;

create or replace view public.v_consumo_por_local as
 SELECT m.source_location_id,
    l.name AS location_name,
    date_trunc('month'::text, (m.performed_at AT TIME ZONE 'America/Bahia'::text))::date AS mes,
    m.movement_type,
    sum(m.quantity) AS qtd_total,
    sum(m.quantity::numeric * COALESCE(m.unit_cost, pi.last_purchase_price, wi.last_purchase_price, pi.price, wi.price, 0::numeric)) AS custo_total,
    m.item_type
   FROM stock_movements m
     JOIN stock_locations l ON l.id = m.source_location_id
     LEFT JOIN pharmacy_items pi ON pi.id = m.item_id AND m.item_type = 'pharmacy'::text
     LEFT JOIN warehouse_items wi ON wi.id = m.item_id AND m.item_type = 'warehouse'::text
  WHERE m.direction = 'out'::text
  GROUP BY m.source_location_id, l.name, (date_trunc('month'::text, (m.performed_at AT TIME ZONE 'America/Bahia'::text))::date), m.movement_type, m.item_type;

create or replace view public.v_consumo_por_prontuario as
 SELECT m.medical_record_number,
    date_trunc('month'::text, (m.performed_at AT TIME ZONE 'America/Bahia'::text))::date AS mes,
    m.item_id,
    m.item_type,
    pi.name AS item_name,
    sum(m.quantity) AS qtd_total,
    avg(COALESCE(m.unit_cost, pi.last_purchase_price, pi.price)) AS custo_medio,
    sum(m.quantity::numeric * COALESCE(m.unit_cost, pi.last_purchase_price, pi.price, 0::numeric)) AS custo_total
   FROM stock_movements m
     LEFT JOIN pharmacy_items pi ON pi.id = m.item_id AND m.item_type = 'pharmacy'::text
  WHERE m.movement_type = 'PRESCRICAO'::text AND m.medical_record_number IS NOT NULL
  GROUP BY m.medical_record_number, (date_trunc('month'::text, (m.performed_at AT TIME ZONE 'America/Bahia'::text))::date), m.item_id, m.item_type, pi.name;

create or replace view public.v_consumo_por_usuario as
 SELECT m.performed_by AS user_id,
    u.full_name AS user_name,
    date_trunc('month'::text, (m.performed_at AT TIME ZONE 'America/Bahia'::text))::date AS mes,
    m.movement_type,
    m.item_type,
    count(*) AS movimentos,
    sum(m.quantity) AS qtd_total,
    sum(m.quantity::numeric * COALESCE(m.unit_cost, pi.last_purchase_price, wi.last_purchase_price, pi.price, wi.price, 0::numeric)) AS custo_total
   FROM stock_movements m
     LEFT JOIN users u ON u.id = m.performed_by
     LEFT JOIN pharmacy_items pi ON pi.id = m.item_id AND m.item_type = 'pharmacy'::text
     LEFT JOIN warehouse_items wi ON wi.id = m.item_id AND m.item_type = 'warehouse'::text
  WHERE m.direction = 'out'::text
  GROUP BY m.performed_by, u.full_name, (date_trunc('month'::text, (m.performed_at AT TIME ZONE 'America/Bahia'::text))::date), m.movement_type, m.item_type;

create or replace view public.v_perdas as
 SELECT date_trunc('month'::text, (m.performed_at AT TIME ZONE 'America/Bahia'::text))::date AS mes,
    m.source_location_id,
    m.reason,
    sum(m.quantity) AS qtd_total,
    sum(m.quantity::numeric * COALESCE(m.unit_cost, pi.last_purchase_price, wi.last_purchase_price, pi.price, wi.price, 0::numeric)) AS valor_perdido,
    m.item_type
   FROM stock_movements m
     LEFT JOIN pharmacy_items pi ON pi.id = m.item_id AND m.item_type = 'pharmacy'::text
     LEFT JOIN warehouse_items wi ON wi.id = m.item_id AND m.item_type = 'warehouse'::text
  WHERE m.movement_type = 'SAIDA_AVULSA'::text AND (m.reason = ANY (ARRAY['quebra'::text, 'vencimento'::text]))
  GROUP BY (date_trunc('month'::text, (m.performed_at AT TIME ZONE 'America/Bahia'::text))::date), m.source_location_id, m.reason, m.item_type;

create or replace view public.v_valor_parado as
 SELECT s.location_id,
    l.name AS location_name,
    s.item_type,
    sum(s.quantity::numeric * COALESCE(pi.last_purchase_price, wi.last_purchase_price, pi.price, wi.price, 0::numeric)) AS valor_parado
   FROM item_stocks s
     JOIN stock_locations l ON l.id = s.location_id
     LEFT JOIN pharmacy_items pi ON pi.id = s.item_id AND s.item_type = 'pharmacy'::text
     LEFT JOIN warehouse_items wi ON wi.id = s.item_id AND s.item_type = 'warehouse'::text
  GROUP BY s.location_id, l.name, s.item_type;
