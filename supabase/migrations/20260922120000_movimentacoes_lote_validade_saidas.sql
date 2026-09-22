-- RELATORIO DE MOVIMENTACOES: saidas passam a exportar lote e validade.
--
-- Queixa (22/09/2026): "relatorios nao estao exportando lote e validade".
-- Causa: em v_inventory_movements o ramo das SAIDAS POR SOLICITACAO tinha
-- lote e validade FIXOS em NULL. Nos ultimos 30 dias, 0 de 2.129 saidas
-- vinham com lote — o dado existia, so nunca foi puxado.
--
-- Agora:
--   farmacia -> lote(s) do livro-razao (stock_movements da solicitacao); se o
--               item saiu de dois lotes, "A; B", e a validade mais proxima.
--               Sem movimento com lote, cai no lote do item do pedido.
--   material -> lote(s) informados no atendimento (almox_lotes /
--               almox_batch_number). O almox so informa lote em ~6% dos
--               atendimentos; nos demais continua vazio porque o dado nao existe.
--   despacho do almox -> segue vazio: a tabela nao guarda lote.
--
-- So o ramo das solicitacoes muda; colunas, tipos e ordem da view sao os
-- mesmos (CREATE OR REPLACE exige). Nenhum dado de estoque e alterado.
-- O indice em stock_movements(request_id) evita varrer o livro por linha.

create index if not exists stock_movements_request on public.stock_movements (request_id)
  where request_id is not null;

create or replace view public.v_inventory_movements as
 SELECT se.id AS movement_id,
    'entrada'::text AS direction,
    COALESCE(se.acquisition_type, 'Compra'::text) AS subtype,
    se.created_at AS movement_date,
    se.item_id,
    se.item_type,
    COALESCE(wi.code, pi.code) AS item_code,
    COALESCE(wi.name, pi.name) AS item_name,
    COALESCE(wi.unit, pi.unit) AS unit,
    se.quantity::numeric AS quantity,
    se.unit_price::numeric AS unit_price,
    COALESCE(se.invoice_total_value, se.unit_price * se.quantity::numeric) AS total_value,
    se.supplier_name AS origin_or_destination,
    se.invoice_number,
    se.afm_number,
    se.batch_number,
    se.expiry_date,
    se.notes,
    se.created_by,
    NULL::text AS source_table,
    'stock_entries'::text AS source_kind,
    true AS is_active
   FROM stock_entries se
     LEFT JOIN warehouse_items wi ON wi.id = se.item_id AND se.item_type = 'warehouse'::text
     LEFT JOIN pharmacy_items pi ON pi.id = se.item_id AND se.item_type = 'pharmacy'::text
UNION ALL
 SELECT wdi.id AS movement_id,
    'saida'::text AS direction,
        CASE wd.dispatch_type
            WHEN 'consumo'::text THEN 'Consumo interno'::text
            WHEN 'emprestimo'::text THEN 'Empréstimo'::text
            WHEN 'doacao'::text THEN 'Doação'::text
            WHEN 'permuta'::text THEN 'Permuta'::text
            WHEN 'transferencia'::text THEN 'Transferência'::text
            ELSE 'Outro'::text
        END AS subtype,
    wd.created_at AS movement_date,
    wdi.item_id,
    'warehouse'::text AS item_type,
    wi2.code AS item_code,
    wi2.name AS item_name,
    wi2.unit,
    wdi.quantity::numeric AS quantity,
    wi2.last_purchase_price::numeric AS unit_price,
    wdi.quantity::numeric * COALESCE(wi2.last_purchase_price, 0::numeric) AS total_value,
    COALESCE(d.name, wd.destination_department_text) AS origin_or_destination,
    NULL::text AS invoice_number,
    NULL::text AS afm_number,
    NULL::text AS batch_number,
    NULL::date AS expiry_date,
    wd.notes,
    wd.created_by,
    wd.id::text AS source_table,
    'warehouse_dispatch'::text AS source_kind,
    wd.status = 'completed'::text AS is_active
   FROM warehouse_dispatches wd
     JOIN warehouse_dispatch_items wdi ON wdi.dispatch_id = wd.id
     LEFT JOIN warehouse_items wi2 ON wi2.id = wdi.item_id
     LEFT JOIN departments d ON d.id = wd.destination_department_id
UNION ALL
 SELECT ri.id AS movement_id,
    'saida'::text AS direction,
    'Solicitação'::text AS subtype,
    COALESCE(r.delivered_at, r.completed_at, r.updated_at) AS movement_date,
    COALESCE(ri.warehouse_item_id, ri.pharmacy_item_id) AS item_id,
    ri.item_type,
    COALESCE(wi3.code, pi3.code) AS item_code,
    COALESCE(wi3.name, pi3.name, ri.item_name) AS item_name,
    COALESCE(wi3.unit, pi3.unit, ri.unit) AS unit,
    COALESCE(ri.supplied_quantity, ri.approved_quantity, ri.quantity)::numeric AS quantity,
    COALESCE(wi3.last_purchase_price, pi3.last_purchase_price)::numeric AS unit_price,
    COALESCE(ri.supplied_quantity, ri.approved_quantity, ri.quantity)::numeric * COALESCE(wi3.last_purchase_price, pi3.last_purchase_price, 0::numeric) AS total_value,
    COALESCE(d2.name, r.department) AS origin_or_destination,
    NULL::text AS invoice_number,
    NULL::text AS afm_number,
        CASE
            WHEN ri.item_type = 'pharmacy'::text THEN COALESCE(
              (SELECT string_agg(DISTINCT et.batch_number, '; '::text) FROM stock_movements m JOIN expiry_tracking et ON et.id = m.expiry_tracking_id WHERE m.request_id = r.id AND m.item_id = ri.pharmacy_item_id AND m.direction = 'out'::text),
              (SELECT et2.batch_number FROM expiry_tracking et2 WHERE et2.id = ri.expiry_tracking_id))
            ELSE COALESCE(
              (SELECT string_agg(l.value ->> 'lote'::text, '; '::text) FROM jsonb_array_elements(CASE WHEN jsonb_typeof(ri.almox_lotes) = 'array'::text THEN ri.almox_lotes ELSE '[]'::jsonb END) l(value)
                WHERE NULLIF(btrim(l.value ->> 'lote'::text), ''::text) IS NOT NULL),
              NULLIF(btrim(ri.almox_batch_number), ''::text))
        END AS batch_number,
        CASE
            WHEN ri.item_type = 'pharmacy'::text THEN COALESCE(
              (SELECT min(et.expiry_date) FROM stock_movements m JOIN expiry_tracking et ON et.id = m.expiry_tracking_id WHERE m.request_id = r.id AND m.item_id = ri.pharmacy_item_id AND m.direction = 'out'::text),
              (SELECT et2.expiry_date FROM expiry_tracking et2 WHERE et2.id = ri.expiry_tracking_id))
            ELSE COALESCE(
              (SELECT min((l.value ->> 'validade'::text)::date) FROM jsonb_array_elements(CASE WHEN jsonb_typeof(ri.almox_lotes) = 'array'::text THEN ri.almox_lotes ELSE '[]'::jsonb END) l(value)
                WHERE (l.value ->> 'validade'::text) ~ '^\d{4}-\d{2}-\d{2}$'::text),
              ri.almox_expiry_date::date)
        END AS expiry_date,
    r.justification AS notes,
    r.delivered_by AS created_by,
    r.id::text AS source_table,
    'request'::text AS source_kind,
    r.status = ANY (ARRAY['delivered'::text, 'completed'::text]) AS is_active
   FROM request_items ri
     JOIN requests r ON r.id = ri.request_id
     LEFT JOIN warehouse_items wi3 ON wi3.id = ri.warehouse_item_id
     LEFT JOIN pharmacy_items pi3 ON pi3.id = ri.pharmacy_item_id
     LEFT JOIN departments d2 ON d2.id = r.department_id
  WHERE r.status = ANY (ARRAY['delivered'::text, 'completed'::text])
UNION ALL
 SELECT pli.id AS movement_id,
        CASE pli.direction
            WHEN 'enviando'::text THEN 'saida'::text
            ELSE 'entrada'::text
        END AS direction,
        CASE
            WHEN pli.direction = 'enviando'::text THEN
            CASE pl.enviando_type
                WHEN 'emprestimo'::text THEN 'Empréstimo'::text
                WHEN 'devolucao_emprestimo'::text THEN 'Devolução de empréstimo'::text
                WHEN 'troca_validade'::text THEN 'Troca de validade'::text
                WHEN 'permuta'::text THEN 'Permuta'::text
                WHEN 'consignacao'::text THEN 'Consignação'::text
                WHEN 'doacao'::text THEN 'Doação'::text
                ELSE 'Outro'::text
            END
            ELSE
            CASE pl.recebendo_type
                WHEN 'emprestimo'::text THEN 'Empréstimo'::text
                WHEN 'devolucao_emprestimo'::text THEN 'Devolução de empréstimo'::text
                WHEN 'troca_validade'::text THEN 'Troca de validade'::text
                WHEN 'permuta'::text THEN 'Permuta'::text
                WHEN 'consignacao'::text THEN 'Consignação'::text
                WHEN 'doacao'::text THEN 'Doação'::text
                ELSE 'Outro'::text
            END
        END AS subtype,
    pl.created_at AS movement_date,
    COALESCE(pli.pharmacy_item_id, pli.warehouse_item_id) AS item_id,
        CASE
            WHEN pli.warehouse_item_id IS NOT NULL THEN 'warehouse'::text
            ELSE 'pharmacy'::text
        END AS item_type,
    COALESCE(pli.codigo_simpas, pi4.code, wi4.code) AS item_code,
    COALESCE(pli.item_description, pi4.name, wi4.name) AS item_name,
    COALESCE(pli.unit, pi4.unit, wi4.unit) AS unit,
    pli.quantity,
    pli.unit_price,
    pli.quantity * COALESCE(pli.unit_price, 0::numeric) AS total_value,
        CASE pli.direction
            WHEN 'enviando'::text THEN pl.destino
            ELSE pl.origem
        END AS origin_or_destination,
    NULL::text AS invoice_number,
    NULL::text AS afm_number,
    pli.batch_number,
    pli.validity_date AS expiry_date,
    pli.observation AS notes,
    pl.created_by,
    pl.id::text AS source_table,
    'pharmacy_loan'::text AS source_kind,
    pl.status = 'completed'::text AS is_active
   FROM pharmacy_loan_items pli
     JOIN pharmacy_loans pl ON pl.id = pli.loan_id
     LEFT JOIN pharmacy_items pi4 ON pi4.id = pli.pharmacy_item_id
     LEFT JOIN warehouse_items wi4 ON wi4.id = pli.warehouse_item_id;
