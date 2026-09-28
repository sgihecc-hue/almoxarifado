-- D4 (auditoria 28/09/2026): Historico Global buscava NO NAVEGADOR sobre as 500
-- linhas mais recentes (~17h de movimento): qualquer evento mais antigo "nao
-- existia" na busca. A busca passa a ir ao banco: coluna nova NO FIM,
-- busca_texto (id, tabela, acao, usuario, nome do item e o conteudo), filtrada com ilike.
-- security_invoker e permissoes mantidos (CREATE OR REPLACE). So leitura.

create or replace view public.v_global_audit_log as
 SELECT al.created_at AS ts,
    al.changed_by AS actor_id,
    u.full_name AS actor_name,
    'audit'::text AS origem,
    al.action,
    al.table_name AS entity,
    al.record_id AS entity_id,
    jsonb_build_object('old_data', al.old_data, 'new_data', al.new_data) AS details,
    concat_ws(' '::text, al.record_id::text, al.table_name, al.action, u.full_name, jsonb_build_object('old_data', al.old_data, 'new_data', al.new_data)::text) AS busca_texto
   FROM audit_logs al
     LEFT JOIN users u ON u.id = al.changed_by
UNION ALL
 SELECT sm.performed_at AS ts,
    sm.performed_by AS actor_id,
    u.full_name AS actor_name,
    'stock'::text AS origem,
    sm.movement_type AS action,
    'stock_movement'::text AS entity,
    sm.id AS entity_id,
    jsonb_build_object('item_id', sm.item_id, 'item_type', sm.item_type, 'quantity', sm.quantity, 'direction', sm.direction, 'movement_type', sm.movement_type, 'source_location_id', sm.source_location_id, 'target_location_id', sm.target_location_id, 'unit_cost', sm.unit_cost, 'reason', sm.reason, 'reason_detail', sm.reason_detail, 'notes', sm.notes, 'destino_tipo', sm.destino_tipo, 'destino_nome', sm.destino_nome, 'request_id', sm.request_id, 'dispensation_id', sm.dispensation_id, 'patient_id', sm.patient_id, 'medical_record_number', sm.medical_record_number) AS details,
    concat_ws(' '::text, sm.id::text, sm.movement_type, u.full_name, sm.destino_nome, sm.medical_record_number, sm.reason, sm.notes, sm.item_id::text, COALESCE(pi.name, wi.name)) AS busca_texto
   FROM stock_movements sm
     LEFT JOIN users u ON u.id = sm.performed_by
     LEFT JOIN pharmacy_items pi ON pi.id = sm.item_id AND sm.item_type = 'pharmacy'::text
     LEFT JOIN warehouse_items wi ON wi.id = sm.item_id AND sm.item_type = 'warehouse'::text;
