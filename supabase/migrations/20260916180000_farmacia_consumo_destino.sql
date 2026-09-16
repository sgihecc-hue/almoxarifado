-- =====================================================================
-- Relatório de consumo da farmácia: destino certo + lista de destinos da CAF.
-- Pedido da Andressa (CAF) em 16/09/2026: filtrar o relatório pelos setores
-- que já receberam algo da CAF — um, vários ou todos —, e todo setor que
-- receber pela primeira vez entra sozinho na lista.
--
-- 1) Correção: para saída ligada a pedido, o destino é o SETOR SOLICITANTE
--    (requests.department_id), quem recebe. A view usava primeiro
--    destination_department_id (o setor SOLICITADO, quem entrega = a CAF):
--    1.186 saídas apareciam com destino "CAF". Conferido pela entrada no
--    estoque: em 193 de 193 pedidos o material entrou no satélite do
--    department_id.
-- 2) v_farmacia_destinos_caf: todo destino que já recebeu da CAF, em todo o
--    histórico (é view: setor novo aparece sozinho).
--
-- Só farmácia. Mesmas colunas de v_farmacia_consumo, na mesma ordem.
-- =====================================================================
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
    COALESCE(sm.destino_tipo,
        CASE WHEN d.name IS NOT NULL OR pd.sector IS NOT NULL THEN 'setor_interno'::text END) AS destino_tipo,
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
     LEFT JOIN departments d ON d.id = COALESCE(r.department_id, r.destination_department_id)
  WHERE sm.item_type = 'pharmacy'::text AND sm.direction = 'out'::text;

create or replace view public.v_farmacia_destinos_caf with (security_invoker = on) as
select
  c.destino,
  case when bool_or(c.destino_tipo in ('unidade_externa', 'fornecedor')) then 'Unidades externas'
       else 'Setores do hospital' end as grupo,
  count(*)::int      as saidas,
  min(c.data)        as primeira_saida,
  max(c.data)        as ultima_saida
from public.v_farmacia_consumo c
where c.estoque_codigo = 'CAF'
  and c.destino is not null
  and btrim(c.destino) <> ''
group by c.destino;

revoke all on public.v_farmacia_destinos_caf from anon;
grant select on public.v_farmacia_destinos_caf to authenticated;
