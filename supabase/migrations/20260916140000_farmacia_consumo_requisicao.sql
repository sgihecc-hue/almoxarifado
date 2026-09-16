-- =====================================================================
-- Relatório de consumo da farmácia: separa REQUISIÇÃO de PRESCRIÇÃO.
-- Pedido da farmácia em 16/09/2026: a dispensação é feita por prescrição ou
-- por requisição, mas as duas gravam a saída de estoque como PRESCRICAO; só
-- pharmacy_dispensations.tipo guarda a diferença. A view passa a devolver
-- tipo = 'REQUISICAO' nesses casos, e o destino cai no setor da requisição
-- (pharmacy_dispensations.sector) quando não há outro.
--
-- Só farmácia. Mesmas colunas, na mesma ordem. Nenhum dado é alterado.
-- =====================================================================
-- security_invoker precisa ser repetido: CREATE OR REPLACE sem WITH zera a opção.
create or replace view public.v_farmacia_consumo with (security_invoker = on) as
 SELECT sm.id,
    sm.performed_at AS data,
        CASE
            WHEN sm.movement_type = 'PRESCRICAO'::text AND pd.tipo = 'requisicao'::text THEN 'REQUISICAO'::text
            ELSE sm.movement_type
        END AS tipo,
    sm.quantity AS quantidade,
    sm.unit_cost AS custo_unitario,
    round(COALESCE(sm.unit_cost, 0::numeric) * sm.quantity::numeric, 2) AS custo_total,
    sl.code AS estoque_codigo,
    sl.name AS estoque,
    pi.id AS item_id,
    pi.name AS item,
    pi.code AS codigo,
    pi.unit AS unidade,
    pi.presentation AS apresentacao,
    pi.medication_class AS classe,
    pi.is_controlled AS controlado,
    pi.controlled_class AS classe_controlado,
    pi.is_mav AS alta_vigilancia,
    pi.is_talidomida AS talidomida,
    pi.padronizado,
    COALESCE(sm.destino_nome, d.name, pd.sector) AS destino,
    sm.destino_tipo,
    sm.medical_record_number AS prontuario,
    pd.patient_name AS paciente,
    sm.prescription_date AS data_prescricao,
    et.batch_number AS lote,
    et.expiry_date AS validade,
    sm.performed_by AS usuario_id,
    u.full_name AS usuario
   FROM stock_movements sm
     JOIN pharmacy_items pi ON pi.id = sm.item_id
     LEFT JOIN stock_locations sl ON sl.id = sm.source_location_id
     LEFT JOIN expiry_tracking et ON et.id = sm.expiry_tracking_id
     LEFT JOIN users u ON u.id = sm.performed_by
     LEFT JOIN pharmacy_dispensations pd ON pd.id = sm.dispensation_id
     LEFT JOIN requests r ON r.id = sm.request_id
     LEFT JOIN departments d ON d.id = COALESCE(r.destination_department_id, r.department_id)
  WHERE sm.item_type = 'pharmacy'::text AND sm.direction = 'out'::text;
