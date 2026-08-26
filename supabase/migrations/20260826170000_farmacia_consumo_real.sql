-- Relatorio de consumo da FARMACIA — fonte de dados real.
--
-- POR QUE ESTA VIEW EXISTE:
-- a tela /reports/pharmacy-consumption lia a tabela consumption_entries, que
-- previa digitacao manual do consumo por setor. Ninguem nunca digitou: ela tem
-- ZERO linhas. Enquanto isso o sistema passou a registrar cada saida sozinho
-- em stock_movements. O relatorio abria, funcionava e mostrava nada — que para
-- quem usa e indistinguivel de "o relatorio nao existe".
--
-- Esta view expoe o consumo que de fato aconteceu, uma linha por movimento de
-- saida, ja com todas as dimensoes que a farmacia pode querer filtrar.
--
-- SO SAIDAS: direction='out' e item_type='pharmacy'. Entradas, devolucoes e
-- ajustes de sinal positivo nao sao consumo.
--
-- TRANSFERENCIA entre estoques aparece com a sua propria etiqueta e NAO deve
-- ser somada ao consumo assistencial: o material nao saiu da farmacia, so
-- mudou de lugar. Quem filtra decide se quer inclui-la.
--
-- DESTINO: stock_movements.destino_nome so e preenchido em parte dos casos.
-- Para as solicitacoes, o destino verdadeiro esta no setor da requisicao —
-- por isso o coalesce. Dispensacao por prescricao nao tem setor: o destino e o
-- paciente, e a coluna fica nula de proposito (nao inventar "setor" ali).
--
-- PERMISSAO: security_invoker=on. Diferente das views do almoxarifado, aqui a
-- RLS de stock_movements DEVE valer — o relatorio carrega prontuario e nome de
-- paciente, dado sensivel sob LGPD. Quem nao pode ver o movimento nao ve a
-- linha.

create or replace view public.v_farmacia_consumo
with (security_invoker = on) as
select
  sm.id,
  sm.performed_at                      as data,
  sm.movement_type                     as tipo,
  sm.quantity                          as quantidade,
  sm.unit_cost                         as custo_unitario,
  round(coalesce(sm.unit_cost, 0) * sm.quantity, 2) as custo_total,

  -- estoque de onde saiu
  sl.code                              as estoque_codigo,
  sl.name                              as estoque,

  -- item e suas classificacoes (cada uma vira um filtro na tela)
  pi.id                                as item_id,
  pi.name                              as item,
  pi.code                              as codigo,
  pi.unit                              as unidade,
  pi.presentation                      as apresentacao,
  pi.medication_class                  as classe,
  pi.is_controlled                     as controlado,
  pi.controlled_class                  as classe_controlado,
  pi.is_mav                            as alta_vigilancia,
  pi.is_talidomida                     as talidomida,
  pi.padronizado,

  -- destino: setor/unidade quando existe; nulo em prescricao (vai pro paciente)
  coalesce(sm.destino_nome, d.name)    as destino,
  sm.destino_tipo,

  -- paciente (so em prescricao)
  sm.medical_record_number             as prontuario,
  -- O nome vem da dispensacao, nao de patients: stock_movements.patient_id
  -- nao e preenchido no fluxo atual (0 de 5.592 linhas), entao aquele join
  -- devolvia sempre nulo.
  pd.patient_name                      as paciente,
  sm.prescription_date                 as data_prescricao,

  -- lote consumido
  et.batch_number                      as lote,
  et.expiry_date                       as validade,

  sm.performed_by                      as usuario_id,
  u.full_name                          as usuario
from public.stock_movements sm
join      public.pharmacy_items  pi on pi.id = sm.item_id
left join public.stock_locations sl on sl.id = sm.source_location_id
left join public.expiry_tracking et on et.id = sm.expiry_tracking_id
left join public.users           u  on u.id  = sm.performed_by
left join public.pharmacy_dispensations pd on pd.id = sm.dispensation_id
left join public.requests        r  on r.id  = sm.request_id
left join public.departments     d  on d.id  = coalesce(r.destination_department_id, r.department_id)
where sm.item_type = 'pharmacy'
  and sm.direction = 'out';

grant select on public.v_farmacia_consumo to authenticated;

comment on view public.v_farmacia_consumo is
  'Consumo real da farmacia: uma linha por saida de estoque, com estoque de '
  'origem, tipo de saida, classificacoes do item, destino, paciente e lote. '
  'Substitui a tabela consumption_entries, que nunca foi alimentada.';
