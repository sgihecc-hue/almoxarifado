import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  PackageCheck,
  Loader2,
  CheckCircle2,
  Calendar,
  Building2,
  User,
  AlertCircle,
  FileText,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { supabase } from '@/lib/supabase'
import { requestService } from '@/lib/services/requests'
import { formatRequestNumber } from '@/lib/utils/request'
import { useModule } from '@/contexts/module'
import { departmentBelongsToStock } from '@/lib/constants/stock-locations'

interface RequestItem {
  id: string
  quantity: number                // qtd LIBERADA (approved) — a que sera recebida
  requested_quantity: number      // qtd original solicitada (mostrada como referencia se diferente)
  item_name: string
  item_code: string
  item_unit?: string
}

interface DeliveredRequest {
  id: string
  request_number: string | null
  requester_name: string
  department_name: string
  delivered_at: string | null
  delivered_by_name: string
  created_at: string
  items: RequestItem[]
}

// Conferência de MATERIAL (Satélite Térreo). Uma linha por item do pedido, com
// lote/validade/quantidade digitados por quem recebeu — é a contagem física
// que vale, não o que o almoxarifado diz ter mandado.
interface MaterialReceiptForm {
  request_item_id: string
  item_id: string
  batch_number: string
  expiry_date: string
  quantity: string
  unit: string
}

// Recorte da lista de material: pedidos dos últimos 60 dias. Sem isso a tela
// carregaria o histórico inteiro do satélite.
const MATERIAL_JANELA_DIAS = 60

function Toast({ message, type, onClose }: { message: string; type: 'success' | 'error'; onClose: () => void }) {
  useEffect(() => {
    const t = setTimeout(onClose, 4000)
    return () => clearTimeout(t)
  }, [onClose])

  return (
    <div className={`fixed bottom-6 right-6 z-50 flex items-center gap-3 px-5 py-3 rounded-xl shadow-lg text-white transition-all ${
      type === 'success' ? 'bg-green-600' : 'bg-red-600'
    }`}>
      {type === 'success' ? <CheckCircle2 className="w-5 h-5" /> : <AlertCircle className="w-5 h-5" />}
      <span className="text-sm font-medium">{message}</span>
    </div>
  )
}

export function ReceiptConfirmation() {
  const navigate = useNavigate()
  const { activeStock } = useModule()
  const [requests, setRequests] = useState<DeliveredRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [confirming, setConfirming] = useState<string | null>(null)
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null)
  // Formulário da conferência de material, indexado por request_item_id.
  const [forms, setForms] = useState<Record<string, MaterialReceiptForm>>({})

  // Satélite Térreo (e qualquer estoque de material) usa o fluxo de conferência
  // item a item. Os demais estoques são medicamento e seguem o fluxo antigo,
  // que não muda em nada.
  const isMaterial = activeStock?.itemType === 'warehouse'

  const showToast = useCallback((message: string, type: 'success' | 'error') => {
    setToast({ message, type })
  }, [])

  // ——— Material: pedidos do almoxarifado para este satélite que ainda têm item
  // sem recebimento registrado (nada em material_receipts para o request_item).
  const loadMaterialRequests = useCallback(async () => {
    if (!activeStock) return
    try {
      setLoading(true)

      const desde = new Date()
      desde.setDate(desde.getDate() - MATERIAL_JANELA_DIAS)

      // 'delivered' e 'completed' porque o almoxarifado fecha o pedido direto
      // como 'completed' — o status do pedido é do fluxo dele, não nosso.
      const { data, error } = await supabase
        .from('requests')
        .select(`
          id,
          request_number,
          created_at,
          delivered_at,
          requester:users!requests_requester_id_fkey(full_name),
          department:departments!requests_department_id_fkey(name),
          delivered_by_user:users!requests_delivered_by_fkey(full_name),
          request_items(
            id,
            quantity,
            approved_quantity,
            supplied_quantity,
            almox_batch_number,
            almox_expiry_date,
            warehouse_item:warehouse_items(id, name, code, unit)
          )
        `)
        .eq('type', 'warehouse')
        .in('status', ['delivered', 'completed'])
        .gte('created_at', desde.toISOString())
        .order('delivered_at', { ascending: false, nullsFirst: false })

      if (error) throw error

      // Só os pedidos do setor dono deste estoque.
      const scoped = ((data || []) as any[]).filter((r) =>
        departmentBelongsToStock(r.department?.name, activeStock)
      )

      // Quais itens já foram conferidos? Uma linha em material_receipts para o
      // request_item basta pra tirar o item da lista.
      const ids = scoped.map((r) => r.id)
      let jaRecebidos = new Set<string>()
      if (ids.length > 0) {
        const { data: recs, error: recErr } = await supabase
          .from('material_receipts')
          .select('request_item_id')
          .in('request_id', ids)
        if (recErr) throw recErr
        jaRecebidos = new Set(
          (recs || []).map((r: any) => r.request_item_id).filter(Boolean)
        )
      }

      const novosForms: Record<string, MaterialReceiptForm> = {}
      const mapped: DeliveredRequest[] = scoped
        .map((req: any) => {
          const items: RequestItem[] = (req.request_items || [])
            .filter((ri: any) => ri.warehouse_item && !jaRecebidos.has(ri.id))
            .map((ri: any) => {
              const item = ri.warehouse_item
              // O que o almoxarifado declarou ter liberado. Fica SO como
              // referencia na tela ("almox informou X") — NAO entra no campo.
              const sugerida = ri.supplied_quantity ?? ri.approved_quantity ?? ri.quantity
              // Quantidade nasce VAZIA de proposito: quem recebe tem que contar
              // e digitar. Quando vinha pre-preenchida, as 9 conferencias reais
              // foram salvas com o numero do almox sem uma unica edicao — em 5
              // delas o almox tinha liberado quantidade diferente da aprovada.
              // Campo pre-preenchido com botao de confirmar acima vira carimbo.
              // Lote e validade, ao contrario, vem PRONTOS do almoxarifado:
              // sao o que a pessoa confere contra a caixa.
              novosForms[ri.id] = {
                request_item_id: ri.id,
                item_id: item.id,
                batch_number: ri.almox_batch_number ?? '',
                expiry_date: ri.almox_expiry_date ?? '',
                quantity: '',
                unit: 'UN',
              }
              return {
                id: ri.id,
                quantity: sugerida,
                requested_quantity: ri.quantity,
                item_name: item?.name ?? '—',
                item_code: item?.code ?? '—',
                item_unit: item?.unit,
              } as RequestItem
            })
          return {
            id: req.id,
            request_number: req.request_number,
            requester_name: req.requester?.full_name ?? '—',
            department_name: req.department?.name ?? '—',
            delivered_at: req.delivered_at,
            delivered_by_name: req.delivered_by_user?.full_name ?? '—',
            created_at: req.created_at,
            items,
          }
        })
        .filter((r) => r.items.length > 0)

      setForms(novosForms)
      setRequests(mapped)
    } catch (err) {
      console.error('ReceiptConfirmation.loadMaterialRequests:', err)
      showToast('Erro ao carregar pedidos de material.', 'error')
    } finally {
      setLoading(false)
    }
  }, [showToast, activeStock?.id])

  const loadDeliveredRequests = useCallback(async () => {
    try {
      setLoading(true)

      // Pedidos entregues aguardando confirmação de recebimento. Quem confirma
      // é o SETOR SOLICITANTE (foi ele que recebeu os itens). A RLS permite
      // delivered → completed pra qualquer user autenticado do setor.
      // Almoxarifado nao tem confirmacao de recebimento — quando o staff
      // marca como entregue no almox, o pedido ja vai pra 'completed'. So
      // pedidos de farmacia com status='delivered' aparecem nesta tela.
      const { data, error } = await supabase
        .from('requests')
        .select(`
          id,
          request_number,
          created_at,
          delivered_at,
          source_location_id,
          requester:users!requests_requester_id_fkey(full_name),
          department:departments!requests_department_id_fkey(name),
          delivered_by_user:users!requests_delivered_by_fkey(full_name),
          request_items(
            id,
            quantity,
            approved_quantity,
            supplied_quantity,
            pharmacy_item:pharmacy_items(id, name, code, unit),
            warehouse_item:warehouse_items(id, name, code, unit)
          )
        `)
        .eq('status', 'delivered')
        .eq('type', 'pharmacy')
        // Recente → antigo (usuário rola até achar; entregas de hoje no topo)
        .order('delivered_at', { ascending: false, nullsFirst: false })

      if (error) throw error

      const raw = (data || []) as any[]

      // Se o operador está num estoque (satélite/CAF), só mostra pedidos que
      // aquele setor solicitou — quem confirma recebimento é quem pediu.
      const scoped = activeStock
        ? raw.filter((r) => departmentBelongsToStock(r.department?.name, activeStock))
        : raw

      const mapped: DeliveredRequest[] = scoped.map((req: any) => ({
        id: req.id,
        request_number: req.request_number,
        requester_name: req.requester?.full_name ?? '—',
        department_name: req.department?.name ?? '—',
        delivered_at: req.delivered_at,
        delivered_by_name: req.delivered_by_user?.full_name ?? '—',
        created_at: req.created_at,
        items: (req.request_items || []).map((ri: any) => {
          const item = ri.pharmacy_item ?? ri.warehouse_item
          // No recebimento aparece a quantidade LIBERADA (approved) — nao
          // a original solicitada. Se por algum motivo approved nao foi
          // preenchido, cai pra supplied ou pra quantity como fallback.
          const finalQty = ri.approved_quantity ?? ri.supplied_quantity ?? ri.quantity
          return {
            id: ri.id,
            quantity: finalQty,
            requested_quantity: ri.quantity,
            item_name: item?.name ?? '—',
            item_code: item?.code ?? '—',
            item_unit: item?.unit,
          } as RequestItem
        }),
      }))

      setRequests(mapped)
    } catch (err) {
      console.error('ReceiptConfirmation.loadDeliveredRequests:', err)
      showToast('Erro ao carregar pedidos entregues.', 'error')
    } finally {
      setLoading(false)
    }
  }, [showToast, activeStock?.id])

  useEffect(() => {
    if (isMaterial) loadMaterialRequests()
    else loadDeliveredRequests()
  }, [isMaterial, loadMaterialRequests, loadDeliveredRequests])

  function updateForm(itemId: string, campo: keyof MaterialReceiptForm, valor: string) {
    setForms((prev) => ({ ...prev, [itemId]: { ...prev[itemId], [campo]: valor } }))
  }

  // Conferência de material: manda lote/validade/quantidade de cada item pra
  // RPC, que credita o estoque DESTE local. Não mexe no almoxarifado.
  async function handleConfirmMaterial(req: DeliveredRequest) {
    if (!activeStock) return
    try {
      setConfirming(req.id)

      const payload = req.items.map((item) => {
        const f = forms[item.id]
        const qtd = Number(f?.quantity)
        if (!Number.isFinite(qtd) || qtd <= 0) {
          throw new Error(`Informe a quantidade recebida de "${item.item_name}".`)
        }
        return {
          request_item_id: item.id,
          item_id: f.item_id,
          quantity: Math.trunc(qtd),
          batch_number: f.batch_number?.trim() || null,
          expiry_date: f.expiry_date || null,
          unit: f.unit?.trim() || null,
        }
      })

      const { error } = await supabase.rpc('confirmar_recebimento_material', {
        p_request_id: req.id,
        p_location_code: activeStock.code,
        p_items: payload,
      })
      if (error) throw error

      showToast('Recebimento registrado e estoque creditado!', 'success')
      setRequests((prev) => prev.filter((r) => r.id !== req.id))
    } catch (err: any) {
      console.error('ReceiptConfirmation.handleConfirmMaterial:', err)
      showToast(err?.message ?? 'Erro ao registrar recebimento.', 'error')
    } finally {
      setConfirming(null)
    }
  }

  async function handleConfirm(req: DeliveredRequest) {
    try {
      setConfirming(req.id)
      await requestService.confirmReceipt(req.id)
      showToast('Recebimento confirmado com sucesso!', 'success')
      setRequests((prev) => prev.filter((r) => r.id !== req.id))
    } catch (err: any) {
      console.error('ReceiptConfirmation.handleConfirm:', err)
      showToast(err?.message ?? 'Erro ao confirmar recebimento.', 'error')
    } finally {
      setConfirming(null)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <Loader2 className="w-8 h-8 text-primary-500 animate-spin mx-auto mb-4" />
          <p className="text-gray-500">Carregando pedidos...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
        <div className="flex items-center gap-3 mb-1">
          <div className="p-2 bg-green-100 rounded-lg">
            <PackageCheck className="w-6 h-6 text-green-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Confirmar Recebimento</h1>
            <p className="text-sm text-gray-500 mt-0.5">
              {isMaterial
                ? `Materiais entregues pelo almoxarifado. Informe lote, validade e a quantidade realmente recebida — mostrando os pedidos dos últimos ${MATERIAL_JANELA_DIAS} dias.`
                : 'Pedidos entregues aguardando confirmação. Confira os itens e confirme o recebimento.'}
            </p>
          </div>
        </div>

        {requests.length > 0 && (
          <div className="mt-4 inline-flex items-center gap-2 px-3 py-1.5 bg-yellow-50 border border-yellow-200 rounded-lg">
            <AlertCircle className="w-4 h-4 text-yellow-600" />
            <span className="text-sm text-yellow-700 font-medium">
              {requests.length} pedido{requests.length !== 1 ? 's' : ''} aguardando confirmação
            </span>
          </div>
        )}
      </div>

      {/* Empty state */}
      {requests.length === 0 && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-16 text-center">
          <div className="flex flex-col items-center gap-4">
            <div className="p-4 bg-gray-100 rounded-full">
              <PackageCheck className="w-10 h-10 text-gray-400" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-gray-700">Nenhum pedido aguardando confirmação</h2>
              <p className="text-sm text-gray-500 mt-1">
                {isMaterial
                  ? `Nenhum material dos últimos ${MATERIAL_JANELA_DIAS} dias está pendente de conferência. Assim que o almoxarifado entregar um pedido, ele aparece aqui.`
                  : 'Quando um pedido for marcado como entregue, ele aparecerá aqui para confirmação.'}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Requests list */}
      {requests.length > 0 && (
        <div className="space-y-4">
          {requests.map((req, index) => (
            <div
              key={req.id}
              onClick={() => navigate(`/requests/${req.id}`)}
              className={`bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden cursor-pointer hover:shadow-md hover:border-gray-200 transition-all ${
                index % 2 === 0 ? 'border-l-4 border-l-green-400' : 'border-l-4 border-l-blue-400'
              }`}
            >
              {/* Card Header */}
              <div className="p-5 border-b border-gray-50">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="flex flex-wrap items-center gap-3">
                    {/* Request number */}
                    <div className="flex items-center gap-2 px-3 py-1.5 bg-white rounded-lg border border-gray-200 shadow-sm">
                      <span className="text-xs text-gray-500">Pedido Nº</span>
                      <span className="text-base font-semibold text-gray-900">
                        {req.request_number ?? formatRequestNumber(req.id)}
                      </span>
                    </div>

                    {/* Requester */}
                    <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-gray-50 border border-gray-200">
                      <User className="w-4 h-4 text-gray-500" />
                      <span className="text-xs text-gray-400">Solicitante:</span>
                      <span className="text-sm font-medium text-gray-700">{req.requester_name}</span>
                    </div>

                    {/* Department */}
                    <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-green-50 border border-green-200">
                      <Building2 className="w-4 h-4 text-green-500" />
                      <span className="text-xs text-green-400">Setor:</span>
                      <span className="text-sm font-medium text-green-700">{req.department_name}</span>
                    </div>

                    {/* Delivered at */}
                    {req.delivered_at && (
                      <div className="flex items-center gap-2 text-gray-500">
                        <Calendar className="w-4 h-4" />
                        <span className="text-sm">
                          Entregue em{' '}
                          {format(new Date(req.delivered_at), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Acoes — Ver detalhes + Confirmar. stopPropagation nos
                      dois pra nao disparar o navigate do card. */}
                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation()
                        navigate(`/requests/${req.id}`)
                      }}
                    >
                      <FileText className="w-4 h-4 mr-2" />
                      Ver detalhes
                    </Button>
                    <Button
                      onClick={(e) => {
                        e.stopPropagation()
                        if (isMaterial) handleConfirmMaterial(req)
                        else handleConfirm(req)
                      }}
                      disabled={confirming === req.id}
                      className="bg-green-600 hover:bg-green-700 text-white"
                      size="sm"
                    >
                      {confirming === req.id ? (
                        <>
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          Confirmando...
                        </>
                      ) : (
                        <>
                          <CheckCircle2 className="w-4 h-4 mr-2" />
                          Confirmar Recebimento
                        </>
                      )}
                    </Button>
                  </div>
                </div>
              </div>

              {/* Itens — material: conferência com lote/validade/quantidade.
                  stopPropagation no bloco todo pra digitar sem que o clique
                  abra os detalhes do pedido. */}
              {isMaterial && (
                <div className="p-5" onClick={(e) => e.stopPropagation()}>
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
                    Conferência ({req.items.length} {req.items.length === 1 ? 'item' : 'itens'}) — quantidade na
                    unidade da {activeStock?.label ?? 'farmácia'}
                  </p>
                  <div className="space-y-3">
                    {req.items.map((item) => {
                      const f = forms[item.id]
                      return (
                        <div
                          key={item.id}
                          className="p-3 bg-gray-50 rounded-lg border border-gray-100"
                        >
                          <div className="flex flex-wrap items-center gap-2 mb-2">
                            <span className="font-medium text-gray-900">{item.item_name}</span>
                            <span className="text-xs px-1.5 py-0.5 bg-white border border-gray-200 rounded text-gray-500">
                              {item.item_code}
                            </span>
                            <span className="text-[11px] text-gray-400">
                              almox. informou {item.quantity}
                              {item.item_unit ? ` ${item.item_unit}` : ''}
                            </span>
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
                            <div>
                              <label className="block text-[11px] text-gray-500 mb-1">Lote</label>
                              <input
                                type="text"
                                value={f?.batch_number ?? ''}
                                onChange={(e) => updateForm(item.id, 'batch_number', e.target.value)}
                                placeholder="Sem lote"
                                className="w-full px-2 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-200"
                              />
                            </div>
                            <div>
                              <label className="block text-[11px] text-gray-500 mb-1">Validade</label>
                              <input
                                type="date"
                                value={f?.expiry_date ?? ''}
                                onChange={(e) => updateForm(item.id, 'expiry_date', e.target.value)}
                                className="w-full px-2 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-200"
                              />
                            </div>
                            <div>
                              <label className="block text-[11px] text-gray-500 mb-1">Qtd. recebida</label>
                              <input
                                type="number"
                                min={1}
                                value={f?.quantity ?? ''}
                                onChange={(e) => updateForm(item.id, 'quantity', e.target.value)}
                                className="w-full px-2 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-200"
                              />
                            </div>
                            <div>
                              <label className="block text-[11px] text-gray-500 mb-1">Unidade</label>
                              <input
                                type="text"
                                value={f?.unit ?? ''}
                                onChange={(e) => updateForm(item.id, 'unit', e.target.value)}
                                placeholder="UN"
                                className="w-full px-2 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-200"
                              />
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                  <p className="text-[11px] text-gray-400 mt-3">
                    Conte o que chegou e digite na unidade desta farmácia — o almoxarifado trabalha em
                    caixa/pacote e não existe conversão automática.
                  </p>
                </div>
              )}

              {/* Items */}
              {!isMaterial && (
              <div className="p-5">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
                  Itens ({req.items.length})
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {req.items.map((item) => (
                    <div
                      key={item.id}
                      className="flex items-center justify-between p-3 bg-gray-50 rounded-lg border border-gray-100"
                    >
                      <div className="min-w-0">
                        <p className="font-medium text-gray-900 truncate">{item.item_name}</p>
                        <span className="text-xs px-1.5 py-0.5 bg-white border border-gray-200 rounded text-gray-500">
                          {item.item_code}
                        </span>
                      </div>
                      <div className="text-right shrink-0 ml-3">
                        <div className="flex flex-col items-end gap-0.5">
                          <span className="text-sm font-semibold text-gray-800 whitespace-nowrap">
                            {item.quantity}
                            {item.item_unit ? ` ${item.item_unit}` : ''}
                          </span>
                          {item.requested_quantity !== item.quantity && (
                            <span className="text-[10px] text-gray-400 whitespace-nowrap" title="Quantidade originalmente solicitada">
                              solic.: {item.requested_quantity}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Toast */}
      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          onClose={() => setToast(null)}
        />
      )}
    </div>
  )
}
