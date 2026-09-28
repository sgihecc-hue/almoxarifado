-- Integracao 28/09/2026: as saidas do almox passaram a ser registradas em
-- almox_movimentos (migrations 202609281300xx). Sem este ramo o relatorio de
-- Movimentacoes nao mostraria saida em lote, estorno, baixa por vencimento e
-- emprestimo do almox. Saida Direta fica de fora (ja vem de warehouse_dispatches).
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
    se.unit_price * se.quantity::numeric AS total_value,
    se.supplier_name AS origin_or_destination,
    se.invoice_number,
    se.afm_number,
    se.batch_number,
    se.expiry_date,
    se.notes,
    se.created_by,
    NULL::text AS source_table,
    'stock_entries'::text AS source_kind,
    se.anulada_em IS NULL AS is_active
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
            WHEN ri.item_type = 'pharmacy'::text THEN COALESCE(( SELECT string_agg(DISTINCT et.batch_number, '; '::text) AS string_agg
               FROM stock_movements m
                 JOIN expiry_tracking et ON et.id = m.expiry_tracking_id
              WHERE m.request_id = r.id AND m.item_id = ri.pharmacy_item_id AND m.direction = 'out'::text), ( SELECT et2.batch_number
               FROM expiry_tracking et2
              WHERE et2.id = ri.expiry_tracking_id))
            ELSE COALESCE(( SELECT string_agg(l.value ->> 'lote'::text, '; '::text) AS string_agg
               FROM jsonb_array_elements(
                    CASE
                        WHEN jsonb_typeof(ri.almox_lotes) = 'array'::text THEN ri.almox_lotes
                        ELSE '[]'::jsonb
                    END) l(value)
              WHERE NULLIF(btrim(l.value ->> 'lote'::text), ''::text) IS NOT NULL), NULLIF(btrim(ri.almox_batch_number), ''::text))
        END AS batch_number,
        CASE
            WHEN ri.item_type = 'pharmacy'::text THEN COALESCE(( SELECT min(et.expiry_date) AS min
               FROM stock_movements m
                 JOIN expiry_tracking et ON et.id = m.expiry_tracking_id
              WHERE m.request_id = r.id AND m.item_id = ri.pharmacy_item_id AND m.direction = 'out'::text), ( SELECT et2.expiry_date
               FROM expiry_tracking et2
              WHERE et2.id = ri.expiry_tracking_id))
            ELSE COALESCE(( SELECT min((l.value ->> 'validade'::text)::date) AS min
               FROM jsonb_array_elements(
                    CASE
                        WHEN jsonb_typeof(ri.almox_lotes) = 'array'::text THEN ri.almox_lotes
                        ELSE '[]'::jsonb
                    END) l(value)
              WHERE (l.value ->> 'validade'::text) ~ '^\d{4}-\d{2}-\d{2}$'::text), ri.almox_expiry_date)
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
     LEFT JOIN warehouse_items wi4 ON wi4.id = pli.warehouse_item_id
UNION ALL
 SELECT sm.id AS movement_id,
        CASE sm.direction
            WHEN 'in'::text THEN 'entrada'::text
            ELSE 'saida'::text
        END AS direction,
        CASE sm.movement_type
            WHEN 'PRESCRICAO'::text THEN 'Dispensação'::text
            WHEN 'SAIDA_AVULSA'::text THEN
            CASE
                WHEN sm.destino_tipo = ANY (ARRAY['unidade_externa'::text, 'fornecedor'::text]) THEN 'Saída avulsa externa'::text
                ELSE 'Saída avulsa'::text
            END
            WHEN 'DEVOLUCAO_INT'::text THEN 'Devolução interna'::text
            WHEN 'AJUSTE'::text THEN
            CASE
                WHEN sm.dispensation_id IS NOT NULL AND sm.direction = 'in'::text THEN 'Estorno de dispensação'::text
                ELSE 'Ajuste'::text
            END
            WHEN 'TRANSFERENCIA'::text THEN 'Transferência para setor'::text
            ELSE initcap(replace(sm.movement_type, '_'::text, ' '::text))
        END AS subtype,
    sm.performed_at AS movement_date,
    sm.item_id,
    sm.item_type,
    COALESCE(wi5.code, pi5.code) AS item_code,
    COALESCE(wi5.name, pi5.name) AS item_name,
    COALESCE(wi5.unit, pi5.unit) AS unit,
    sm.quantity::numeric AS quantity,
    COALESCE(sm.unit_cost, wi5.last_purchase_price, pi5.last_purchase_price, wi5.price, pi5.price)::numeric AS unit_price,
    sm.quantity::numeric * COALESCE(sm.unit_cost, wi5.last_purchase_price, pi5.last_purchase_price, wi5.price, pi5.price)::numeric AS total_value,
    COALESCE(NULLIF(btrim(sm.destino_nome), ''::text),
        CASE
            WHEN sm.medical_record_number IS NOT NULL THEN 'Prontuário '::text || sm.medical_record_number
            ELSE NULL::text
        END, sm.reason) AS origin_or_destination,
    NULL::text AS invoice_number,
    NULL::text AS afm_number,
    et5.batch_number,
    et5.expiry_date,
    COALESCE(sm.notes, sm.reason_detail) AS notes,
    sm.performed_by AS created_by,
    COALESCE(sm.dispensation_id, sm.return_id, sm.transfer_id, sm.id)::text AS source_table,
    'stock_movement'::text AS source_kind,
    true AS is_active
   FROM stock_movements sm
     LEFT JOIN warehouse_items wi5 ON wi5.id = sm.item_id AND sm.item_type = 'warehouse'::text
     LEFT JOIN pharmacy_items pi5 ON pi5.id = sm.item_id AND sm.item_type = 'pharmacy'::text
     LEFT JOIN expiry_tracking et5 ON et5.id = sm.expiry_tracking_id
  WHERE sm.movement_type <> ALL (ARRAY['SOLICITACAO'::text, 'ENTRADA_NF'::text])
    AND NOT (sm.movement_type = 'TRANSFERENCIA'::text AND sm.destino_tipo = 'estoque_interno'::text)
UNION ALL
 SELECT am.id AS movement_id,
        CASE am.direcao WHEN 'in'::text THEN 'entrada'::text ELSE 'saida'::text END AS direction,
        CASE am.origem
            WHEN 'saida_lote'::text THEN COALESCE('Saída em lote - '::text || NULLIF(am.motivo, ''::text), 'Saída em lote'::text)
            WHEN 'estorno_almox'::text THEN 'Estorno'::text
            WHEN 'vencimento'::text THEN 'Baixa por vencimento'::text
            WHEN 'emprestimo'::text THEN 'Empréstimo'::text
            WHEN 'cancelamento_emprestimo'::text THEN 'Cancelamento de empréstimo'::text
            ELSE initcap(replace(am.origem, '_'::text, ' '::text))
        END AS subtype,
    am.realizado_em AS movement_date,
    am.item_id,
    'warehouse'::text AS item_type,
    wi6.code AS item_code,
    wi6.name AS item_name,
    wi6.unit,
    am.quantidade::numeric AS quantity,
    COALESCE(wi6.last_purchase_price, wi6.price)::numeric AS unit_price,
    am.quantidade::numeric * COALESCE(wi6.last_purchase_price, wi6.price)::numeric AS total_value,
    COALESCE(NULLIF(btrim(am.destino_nome), ''::text), am.motivo) AS origin_or_destination,
    NULL::text AS invoice_number,
    NULL::text AS afm_number,
    et6.batch_number,
    et6.expiry_date,
    COALESCE(am.observacao, am.motivo_detalhe) AS notes,
    am.realizado_por AS created_by,
    COALESCE(am.referencia_id, am.id)::text AS source_table,
    'almox_movimento'::text AS source_kind,
    true AS is_active
   FROM almox_movimentos am
     LEFT JOIN warehouse_items wi6 ON wi6.id = am.item_id
     LEFT JOIN expiry_tracking et6 ON et6.id = am.expiry_tracking_id
  -- Saida Direta e seu estorno ja vem do ramo warehouse_dispatch
  WHERE am.origem <> ALL (ARRAY['saida_direta'::text, 'estorno_saida_direta'::text]);
