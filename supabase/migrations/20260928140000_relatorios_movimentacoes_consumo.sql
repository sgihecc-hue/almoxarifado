-- RELATORIOS (auditoria 28/09/2026): Movimentacoes e Consumo do almoxarifado.
--
-- v_inventory_movements (tela Relatorios > Movimentacoes):
--   N2  valor da linha de entrada = quantidade x preco unitario SEMPRE.
--       invoice_total_value e o TOTAL DA NF repetido em cada linha da nota; o
--       COALESCE antigo somava o total da nota uma vez por item (entradas
--       infladas ~7x: R$ 5,33 mi na view x R$ 705 mil reais).
--   N4  entrada anulada (stock_entries.anulada_em preenchido) passa a vir com
--       is_active = false (antes era sempre true e contava no total).
--   N3  entra o livro-razao stock_movements, que a view nao lia: dispensacoes
--       (PRESCRICAO), saidas avulsas do almox e da farmacia, devolucoes
--       internas, estornos, ajustes e transferencias para setor.
--       Fica de fora o que JA esta na view por outra fonte (conferido no banco):
--         SOLICITACAO -> ja vem de request_items (ramo "Solicitacao");
--         ENTRADA_NF  -> espelho de stock_entries (241 = 241 linhas);
--         TRANSFERENCIA para estoque_interno -> par saida/entrada entre
--           estoques da propria farmacia (nao e consumo nem entrada).
--       warehouse_dispatches NAO gera stock_movements (conferido: 0 casos),
--       entao nao ha duplicidade com o ramo "warehouse_dispatch".
--
-- v_warehouse_consumption (Estatisticas de Consumo - Almoxarifado):
--   N6  inclui a Saida Direta concluida (warehouse_dispatches status completed).
--   D5  data do consumo no fuso America/Bahia (antes ::date em UTC: saida
--       depois das 21h caia no dia seguinte).
--       saida avulsa: LEFT JOIN no setor (antes o JOIN por nome descartava a
--       linha se o setor fosse renomeado).
--   Coluna nova NO FIM: destino_texto (setor digitado / tipo da saida direta).
--
-- So leitura: nenhum dado de estoque e alterado. Permissoes e dono das views
-- sao mantidos pelo CREATE OR REPLACE.

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
    AND NOT (sm.movement_type = 'TRANSFERENCIA'::text AND sm.destino_tipo = 'estoque_interno'::text);

create or replace view public.v_warehouse_consumption as
 SELECT ri.id AS source_id,
    ri.warehouse_item_id AS item_id,
    COALESCE(ri.supplied_quantity, ri.approved_quantity, ri.quantity)::numeric AS quantity,
    r.department_id,
    (COALESCE(r.delivered_at, r.updated_at) AT TIME ZONE 'America/Bahia'::text)::date AS consumption_date,
    'solicitacao'::text AS origem,
    COALESCE(( SELECT string_agg(l.value ->> 'lote'::text, '; '::text) AS string_agg
           FROM jsonb_array_elements(
                CASE
                    WHEN jsonb_typeof(ri.almox_lotes) = 'array'::text THEN ri.almox_lotes
                    ELSE '[]'::jsonb
                END) l(value)
          WHERE NULLIF(btrim(l.value ->> 'lote'::text), ''::text) IS NOT NULL), NULLIF(btrim(ri.almox_batch_number), ''::text)) AS lote,
    COALESCE(( SELECT min((l.value ->> 'validade'::text)::date) AS min
           FROM jsonb_array_elements(
                CASE
                    WHEN jsonb_typeof(ri.almox_lotes) = 'array'::text THEN ri.almox_lotes
                    ELSE '[]'::jsonb
                END) l(value)
          WHERE (l.value ->> 'validade'::text) ~ '^\d{4}-\d{2}-\d{2}$'::text), ri.almox_expiry_date) AS validade,
    NULL::text AS destino_texto
   FROM request_items ri
     JOIN requests r ON r.id = ri.request_id
  WHERE r.type = 'warehouse'::text AND (r.status = ANY (ARRAY['delivered'::text, 'completed'::text])) AND ri.warehouse_item_id IS NOT NULL AND COALESCE(ri.supplied_quantity, ri.approved_quantity, ri.quantity) > 0
UNION ALL
 SELECT sm.id AS source_id,
    sm.item_id,
    sm.quantity::numeric AS quantity,
    d.id AS department_id,
    (sm.performed_at AT TIME ZONE 'America/Bahia'::text)::date AS consumption_date,
    'avulsa'::text AS origem,
    et.batch_number AS lote,
    et.expiry_date AS validade,
    sm.destino_nome AS destino_texto
   FROM stock_movements sm
     LEFT JOIN departments d ON d.name = sm.destino_nome
     LEFT JOIN expiry_tracking et ON et.id = sm.expiry_tracking_id
  WHERE sm.item_type = 'warehouse'::text AND sm.direction = 'out'::text AND sm.destino_tipo = 'setor_interno'::text
UNION ALL
 SELECT wce.id AS source_id,
    wce.item_id,
    wce.quantity::numeric AS quantity,
    wce.department_id,
    wce.date AS consumption_date,
    'manual'::text AS origem,
    NULL::text AS lote,
    NULL::date AS validade,
    NULL::text AS destino_texto
   FROM warehouse_consumption_entries wce
UNION ALL
 SELECT wdi.id AS source_id,
    wdi.item_id,
    wdi.quantity::numeric AS quantity,
    wd.destination_department_id AS department_id,
    (wd.created_at AT TIME ZONE 'America/Bahia'::text)::date AS consumption_date,
    'saida_direta'::text AS origem,
    NULL::text AS lote,
    NULL::date AS validade,
    concat_ws(' - '::text,
        CASE wd.dispatch_type
            WHEN 'consumo'::text THEN 'Consumo interno'::text
            WHEN 'emprestimo'::text THEN 'Empréstimo'::text
            WHEN 'doacao'::text THEN 'Doação'::text
            WHEN 'permuta'::text THEN 'Permuta'::text
            WHEN 'transferencia'::text THEN 'Transferência'::text
            WHEN 'vencimento'::text THEN 'Vencimento'::text
            ELSE 'Outro'::text
        END, NULLIF(btrim(wd.destination_department_text), ''::text)) AS destino_texto
   FROM warehouse_dispatches wd
     JOIN warehouse_dispatch_items wdi ON wdi.dispatch_id = wd.id
  WHERE wd.status = 'completed'::text AND wdi.item_id IS NOT NULL AND wdi.quantity > 0;
