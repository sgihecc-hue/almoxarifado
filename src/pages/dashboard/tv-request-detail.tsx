import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import {
  ArrowLeft,
  Pill,
  Package2,
  Loader2,
  AlertCircle,
  User,
  Building2,
  Hash,
  Check,
  Undo2,
  Info
} from 'lucide-react'
import { tvRequestService } from '@/lib/services/tv-requests'
import { RequestStatusBadge } from '@/components/request-status-badge'
import { formatRequestNumber } from '@/lib/utils/request'
import type { TVRequest } from '@/lib/services/tv-requests'

// PAINEL DE TV = SO LEITURA (auditoria 28/09/2026). "Saiu para entrega" e
// "Solicitacao concluida" mudavam o status direto no banco, sem a baixa
// conferida, sem lote e — sem login — sem efeito nenhum, mas a TV mostrava
// "Concluida". Atender e entregar e pelo sistema, no detalhe do pedido.

const themes = {
  pharmacy: {
    accent: 'blue',
    icon: Pill,
    title: 'Farmácia',
    bgAccent: 'bg-blue-900',
    textAccent: 'text-blue-300',
    borderAccent: 'border-blue-700',
    btnPrimary: 'bg-blue-700 hover:bg-blue-600',
    btnActive: 'bg-blue-600'
  },
  warehouse: {
    accent: 'purple',
    icon: Package2,
    title: 'Almoxarifado',
    bgAccent: 'bg-purple-900',
    textAccent: 'text-purple-300',
    borderAccent: 'border-purple-700',
    btnPrimary: 'bg-purple-700 hover:bg-purple-600',
    btnActive: 'bg-purple-600'
  }
}

interface TVRequestDetailProps {
  type: 'pharmacy' | 'warehouse'
}

export function TVRequestDetail({ type }: TVRequestDetailProps) {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  // Modo somente-leitura: usado quando aberto pelo Histórico. Consulta o
  // pedido sem permitir atender (nada de editar qtd, marcar entrega, etc.).
  const readOnly = searchParams.get('ro') === '1'
  const theme = themes[type]
  const Icon = theme.icon

  const [request, setRequest] = useState<TVRequest | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadRequest = useCallback(async () => {
    if (!id) return
    try {
      setLoading(true)
      setError(null)
      const data = await tvRequestService.getById(id)
      if (!data) {
        setError('Solicitação não encontrada')
        return
      }
      setRequest(data)
    } catch (err) {
      console.error('Error loading request:', err)
      setError('Erro ao carregar solicitação')
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    loadRequest()
  }, [loadRequest])

  if (loading) {
    return (
      <div className="h-screen bg-gray-900 flex items-center justify-center">
        <Loader2 className={`w-12 h-12 ${theme.textAccent} animate-spin`} />
      </div>
    )
  }

  if (error && !request) {
    return (
      <div className="h-screen bg-gray-900 flex flex-col items-center justify-center text-white">
        <AlertCircle className="w-12 h-12 text-red-400 mb-4" />
        <p className="text-red-400 text-lg mb-4">{error}</p>
        <button
          onClick={() => navigate(`/tv/${type}`)}
          className="px-4 py-2 bg-gray-800 hover:bg-gray-700 rounded-lg transition-colors"
        >
          Voltar ao Painel
        </button>
      </div>
    )
  }

  if (!request) return null

  return (
    <div className="h-screen bg-gray-900 text-white flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex-shrink-0 border-b border-gray-700 p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button
              onClick={() => {
                // Aberto pelo Histórico (read-only): volta pro Histórico.
                // Caso contrário, volta pro painel principal.
                if (readOnly && window.history.length > 1) navigate(-1)
                else navigate(`/tv/${type}`)
              }}
              className="p-2 bg-gray-800 hover:bg-gray-700 rounded-lg transition-colors"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div className={`p-2 ${theme.bgAccent} rounded-lg`}>
              <Icon className={`w-6 h-6 ${theme.textAccent}`} />
            </div>
            <div>
              <h1 className="text-2xl font-bold flex items-center gap-3">
                <Hash className="w-5 h-5 text-gray-400" />
                {request.request_number || formatRequestNumber(request.id)}
                <RequestStatusBadge status={request.status} />
              </h1>
            </div>
          </div>

          {/* Priority badge */}
          <span className={`px-3 py-1 rounded-full text-sm font-medium ${
            request.priority === 'high'
              ? 'bg-red-900 text-red-200 border border-red-700'
              : request.priority === 'medium'
                ? 'bg-yellow-900 text-yellow-200 border border-yellow-700'
                : 'bg-green-900 text-green-200 border border-green-700'
          }`}>
            {request.priority === 'high' ? 'Alta' :
             request.priority === 'medium' ? 'Média' : 'Baixa'}
          </span>
        </div>

        {/* Request info */}
        <div className="flex items-center gap-8 mt-3 text-sm">
          <div className="flex items-center gap-2">
            <User className="w-4 h-4 text-gray-400" />
            <span className="text-gray-400">Solicitante:</span>
            <span className="text-white font-medium">{request.requester_name}</span>
          </div>
          <div className="flex items-center gap-2">
            <Building2 className="w-4 h-4 text-gray-400" />
            <span className="text-gray-400">Unidade Solicitante:</span>
            <span className="text-white font-medium">{request.department}</span>
          </div>
        </div>
      </div>

      {/* Error message */}
      {error && (
        <div className="flex-shrink-0 mx-4 mt-3 p-3 bg-red-900/30 border border-red-700 rounded-lg text-red-300 text-sm">
          {error}
        </div>
      )}

      {/* Items Table */}
      <div className="flex-1 overflow-auto p-4">
        <div className="bg-gray-800 rounded-xl border border-gray-700 overflow-hidden">
          {/* Table header */}
          <div className="bg-gray-750 border-b border-gray-700 p-3">
            <div className="grid grid-cols-12 gap-2 text-xs font-semibold text-gray-400 uppercase tracking-wider">
              <div className="col-span-3">Nome do Item</div>
              <div className="col-span-1 text-center">UF</div>
              <div className="col-span-1 text-center">Estoque</div>
              <div className="col-span-1 text-center">Qtd Solicitada</div>
              <div className="col-span-2 text-center">Qtd Fornecida</div>
              <div className="col-span-3 text-center">Observação</div>
              <div className="col-span-1 text-center">
                <Check className="w-4 h-4 mx-auto" />
              </div>
            </div>
          </div>

          {/* Table rows */}
          <div className="divide-y divide-gray-700">
            {request.items.map((item, index) => {
              const itemData = item

              return (
                <div
                  key={item.id}
                  className={`p-3 ${index % 2 === 0 ? 'bg-gray-800' : 'bg-gray-800/50'} ${
                    itemData?.is_checked ? 'bg-green-900/10' : ''
                  }`}
                >
                  <div className="grid grid-cols-12 gap-2 items-center">
                    {/* Item name */}
                    <div className="col-span-3">
                      <p className="text-sm font-medium text-white">{item.item_name}</p>
                      {item.item_code && (
                        <p className="text-xs text-gray-500">{item.item_code}</p>
                      )}
                    </div>

                    {/* Unit */}
                    <div className="col-span-1 text-center">
                      <span className="text-sm text-gray-300">{item.item_unit}</span>
                    </div>

                    {/* Current stock */}
                    <div className="col-span-1 text-center">
                      <span className={`text-sm font-medium ${
                        item.item_current_stock <= 0 ? 'text-red-400' :
                        item.item_current_stock < item.quantity ? 'text-yellow-400' :
                        'text-green-400'
                      }`}>
                        {item.item_current_stock}
                      </span>
                    </div>

                    {/* Requested quantity */}
                    <div className="col-span-1 text-center">
                      <span className="text-sm text-white font-medium">{item.quantity}</span>
                      {item.approved_quantity != null && item.approved_quantity !== item.quantity && (
                        <span className="text-xs text-yellow-400 block">
                          (Aprov: {item.approved_quantity})
                        </span>
                      )}
                    </div>

                    {/* Supplied quantity (editable) */}
                    <div className="col-span-2 text-center">
                      <span className="text-sm text-white">{itemData.supplied_quantity ?? '—'}</span>
                    </div>

                    {/* Observation (dropdown) */}
                    <div className="col-span-3 text-center">
                      <span className="text-sm text-gray-300">{itemData?.observation || '-'}</span>
                    </div>

                    {/* Última coluna: em modo somente-leitura (Histórico do
                        almox) vira botão "Estornar" que leva o item pra tela
                        de estorno já selecionado. Fora disso, o check normal. */}
                    <div className="col-span-1 text-center">
                      {readOnly && type === 'warehouse' ? (
                        <button
                          onClick={() => navigate(`/almox/estoque/estorno?item=${item.item_id}`)}
                          title="Estornar este item (devolve ao estoque)"
                          className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-amber-700/80 hover:bg-amber-600 text-white text-xs font-medium transition-colors"
                        >
                          <Undo2 className="w-3.5 h-3.5" />
                          Estornar
                        </button>
                      ) : (
                        <span className={`inline-flex items-center justify-center w-5 h-5 rounded ${
                          itemData?.is_checked ? 'bg-green-900 text-green-300' : 'bg-gray-700 text-gray-500'
                        }`}>
                          {itemData?.is_checked && <Check className="w-3 h-3" />}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {!readOnly && ['pending', 'approved', 'processing'].includes(request.status) && (
          <div className="mt-6 p-4 bg-gray-800 border border-gray-700 rounded-xl flex items-start gap-3 text-gray-300 text-sm">
            <Info className="w-5 h-5 text-gray-400 flex-shrink-0" />
            <span>
              Painel somente leitura. Para atender, informar a quantidade fornecida e marcar a entrega,
              abra esta solicitação no sistema (Solicitações → detalhe do pedido).
            </span>
          </div>
        )}
      </div>
    </div>
  )
}

export default TVRequestDetail
