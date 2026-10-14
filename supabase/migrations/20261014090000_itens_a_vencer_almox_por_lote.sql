-- Itens a Vencer do ALMOXARIFADO vazio (grupo SISTEMA ALMOXARIFADO, 13/10/2026).
--
-- Causa: o ramo 'warehouse' da view lia warehouse_items.expiry_date, campo
-- unico e velho do cadastro. O inventario de 09/10 refez os lotes reais em
-- expiry_tracking (local ALMOX) e o cadastro ficou sem validade no periodo:
-- 9 lotes vencendo em ate 6 meses e a tela dizia "nenhum item".
--
-- Fix: o ramo do almox passa a ler os lotes do local ALMOX. Continua UMA linha
-- por item (o lote que vence primeiro) e expiry_tracking_id = warehouse_items.id,
-- porque as telas e warehouse_expiry_resolutions usam esse id. location_id agora
-- e o do ALMOX (antes null). Ramo da farmacia: identico ao anterior.
create or replace view public.v_itens_a_vencer as
 SELECT et.id AS expiry_tracking_id,
    et.item_id,
    'pharmacy'::text AS item_type,
    pi.name AS item_name,
    pi.medication_class,
    et.batch_number,
    et.expiry_date,
    et.current_quantity,
    pi.price AS unit_cost,
    round(et.current_quantity::numeric * COALESCE(pi.price, 0::numeric), 2) AS estimated_value,
        CASE
            WHEN et.expiry_date <= (CURRENT_DATE + '1 mon'::interval) THEN '1m'::text
            WHEN et.expiry_date <= (CURRENT_DATE + '3 mons'::interval) THEN '3m'::text
            ELSE '6m'::text
        END AS color_band,
    et.location_id
   FROM expiry_tracking et
     JOIN pharmacy_items pi ON pi.id = et.item_id
  WHERE et.current_quantity > 0 AND et.expiry_date > CURRENT_DATE AND et.expiry_date <= (CURRENT_DATE + '6 mons'::interval)
UNION ALL
 SELECT wi.id AS expiry_tracking_id,
    wi.id AS item_id,
    'warehouse'::text AS item_type,
    wi.name AS item_name,
    NULL::text AS medication_class,
    lt.batch_number,
    lt.expiry_date,
    lt.current_quantity,
    wi.price AS unit_cost,
    round(lt.current_quantity::numeric * COALESCE(wi.price, 0::numeric), 2) AS estimated_value,
        CASE
            WHEN lt.expiry_date <= (CURRENT_DATE + '1 mon'::interval) THEN '1m'::text
            WHEN lt.expiry_date <= (CURRENT_DATE + '3 mons'::interval) THEN '3m'::text
            ELSE '6m'::text
        END AS color_band,
    lt.location_id
   FROM ( SELECT DISTINCT ON (e.item_id) e.item_id, e.batch_number, e.expiry_date, e.current_quantity, e.location_id
           FROM expiry_tracking e
             JOIN stock_locations l ON l.id = e.location_id AND l.code = 'ALMOX'
          WHERE e.current_quantity > 0 AND e.expiry_date > CURRENT_DATE AND e.expiry_date <= (CURRENT_DATE + '6 mons'::interval)
          ORDER BY e.item_id, e.expiry_date, e.id) lt
     JOIN warehouse_items wi ON wi.id = lt.item_id
  WHERE wi.is_active = true;
