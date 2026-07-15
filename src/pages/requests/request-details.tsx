import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '@/contexts/auth'
import {
  ArrowLeft, MessageSquare, AlertCircle, Loader2,
  Download, Printer, CheckCircle2
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { requestService } from '@/lib/services/requests'
import { RequestActions } from '@/components/request-actions'
import { RequestStatusBadge } from '@/components/request-status-badge'
import { RequestTimeline } from '@/components/request-timeline'
import { templatesService } from '@/lib/services/templates'
import type { Request } from '@/lib/services/requests'
import { formatRequestNumber } from '@/lib/utils/request'
import { getDepartmentName } from '@/lib/constants/departments'
import { supabase } from '@/lib/supabase'

interface LotOption { id: string; batch_number: string; expiry_date: string | null; current_quantity: number }

function ItemRow({ item, canEdit, isAdmin, canSeeStock, requestType }: {
  item: Request['request_items'][0]
  canEdit: boolean
  isAdmin: boolean
  canSeeStock: boolean
  requestType?: 'pharmacy' | 'warehouse'
}) {
  const [suppliedQty, setSuppliedQty] = useState<number | ''>(item.supplied_quantity ?? '')
  // Lote e validade — so pharmacy usa. Ao selecionar lote, validade preenche
  // automatica via expiry_tracking. Persiste em request_items.expiry_tracking_id.
  const [expiryTrackingId, setExpiryTrackingId] = useState<string | null>((item as any).expiry_tracking_id ?? null)
  const [lots, setLots] = useState<LotOption[]>([])
  const isPharmacy = requestType === 'pharmacy'
  useEffect(() => {
    if (!isPharmacy) return
    // Carrega lotes disponiveis do item (ordem FEFO)
    ;(async () => {
      const pharmacyItemId = (item as any).pharmacy_item_id ?? item.item?.id
      if (!pharmacyItemId) return
      const { data, error } = await supabase
        .from('expiry_tracking')
        .select('id, batch_number, expiry_date, current_quantity')
        .eq('item_id', pharmacyItemId)
        .gt('current_quantity', 0)
        .order('expiry_date', { ascending: true, nullsFirst: false })
      if (error) { console.error('lots', error); return }
      setLots((data || []) as LotOption[])
    })()
  }, [isPharmacy, item])
  const selectedLot = lots.find((l) => l.id === expiryTrackingId) || null
  // Observations stored as lines separated by \n
  const [observations, setObservations] = useState<string[]>(() => {
    const raw = item.observation || ''
    return raw ? raw.split('\n').filter(Boolean) : []
  })
  const [newNote, setNewNote] = useState('')
  const [checked, setChecked] = useState(item.is_checked || false)
  const saveField = async (field: string, value: any) => {
    try {
      await supabase
        .from('request_items')
        .update({ [field]: value })
        .eq('id', item.id)
    } catch (e) {
      console.error('Error saving field:', e)
    }
  }

  return (
    <tr className={`border-b border-gray-100 ${checked ? 'bg-green-50' : 'hover:bg-gray-50'} transition-colors`}>
      <td className="py-3 px-2">
        <p className="font-medium text-gray-900 text-sm">{item.item.name}</p>
        <p className="text-xs text-gray-400">{item.item.code}</p>
      </td>
      <td className="text-center py-3 px-2 text-gray-600">{item.item.unit || 'UN'}</td>
      <td className="text-center py-3 px-2 font-medium">{item.quantity}</td>
      {canSeeStock && (
        <td className="text-center py-3 px-2">
          <span className={`font-medium ${(item.item.current_stock || 0) < item.quantity ? 'text-red-600' : 'text-green-600'}`}>
            {item.item.current_stock ?? 0}
          </span>
        </td>
      )}
      <td className="text-center py-3 px-2">
        {canEdit ? (
          <Input
            type="number"
            min="0"
            value={suppliedQty === 0 ? '' : suppliedQty}
            placeholder="0"
            onFocus={(e) => e.target.select()}
            onChange={(e) => {
              const val = e.target.value === '' ? 0 : Math.max(0, parseInt(e.target.value) || 0)
              setSuppliedQty(val)
            }}
            onBlur={() => saveField('supplied_quantity', suppliedQty)}
            className="w-20 text-center mx-auto h-8 text-sm"
          />
        ) : (
          <span>{item.supplied_quantity ?? '—'}</span>
        )}
      </td>
      {isPharmacy && (
        <>
          <td className="text-center py-3 px-2">
            {canEdit ? (
              <select
                value={expiryTrackingId ?? ''}
                onChange={(e) => {
                  const v = e.target.value || null
                  setExpiryTrackingId(v)
                  saveField('expiry_tracking_id', v)
                }}
                className={`w-full max-w-[220px] h-8 px-2 text-xs rounded mx-auto ${
                  expiryTrackingId
                    ? 'border border-gray-300 bg-white'
                    : 'border-2 border-red-400 bg-red-50'
                }`}
              >
                <option value="">{lots.length ? '— Selecione o lote —' : 'Sem lotes'}</option>
                {lots.map((lo, i) => (
                  <option key={lo.id} value={lo.id}>
                    {i === 0 ? '★ ' : ''}Lote {lo.batch_number} · saldo {lo.current_quantity}
                  </option>
                ))}
              </select>
            ) : (
              <span className="text-xs">{selectedLot ? `Lote ${selectedLot.batch_number}` : '—'}</span>
            )}
          </td>
          <td className="text-center py-3 px-2 text-xs">
            {selectedLot?.expiry_date
              ? new Date(selectedLot.expiry_date + 'T00:00:00').toLocaleDateString('pt-BR')
              : '—'}
          </td>
        </>
      )}
      <td className="py-3 px-2">
        {observations.length > 0 && (
          <div className="space-y-1 mb-1">
            {observations.map((obs, idx) => (
              <div key={idx} className="flex items-center gap-1">
                <span className="text-xs bg-yellow-50 border border-yellow-200 text-yellow-800 px-2 py-1 rounded flex-1">{obs}</span>
                {isAdmin && (
                  <button
                    onClick={() => {
                      const updated = observations.filter((_, i) => i !== idx)
                      setObservations(updated)
                      saveField('observation', updated.join('\n'))
                    }}
                    className="text-red-400 hover:text-red-600 text-xs px-1"
                    title="Apagar"
                  >✕</button>
                )}
              </div>
            ))}
          </div>
        )}
        {canEdit && (
          <div className="flex gap-1">
            <input
              type="text"
              value={newNote}
              onChange={(e) => setNewNote(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && newNote.trim()) {
                  const updated = [...observations, newNote.trim()]
                  setObservations(updated)
                  saveField('observation', updated.join('\n'))
                  setNewNote('')
                }
              }}
              placeholder="Anotar..."
              className="flex-1 h-7 px-2 text-xs border border-gray-300 rounded bg-white"
            />
            <button
              onClick={() => {
                if (newNote.trim()) {
                  const updated = [...observations, newNote.trim()]
                  setObservations(updated)
                  saveField('observation', updated.join('\n'))
                  setNewNote('')
                }
              }}
              className="text-xs bg-emerald-500 text-white px-2 rounded hover:bg-emerald-600"
            >+</button>
          </div>
        )}
        {!canEdit && observations.length === 0 && <span className="text-xs text-gray-300">—</span>}
      </td>
      <td className="text-center py-3 px-2">
        {canEdit ? (
          <input
            type="checkbox"
            checked={checked}
            onChange={(e) => {
              setChecked(e.target.checked)
              saveField('is_checked', e.target.checked)
            }}
            className="w-5 h-5 rounded border-gray-300 text-green-600 focus:ring-green-500 cursor-pointer"
          />
        ) : (
          checked ? <CheckCircle2 className="w-5 h-5 text-green-500 mx-auto" /> : <span className="text-gray-300">—</span>
        )}
      </td>
    </tr>
  )
}

export function RequestDetails() {
  const navigate = useNavigate()
  const { id } = useParams()
  const { user } = useAuth()
  const [request, setRequest] = useState<Request | null>(null)
  const [loading, setLoading] = useState(true)
  const [commenting, setCommenting] = useState(false)
  const [comment, setComment] = useState('')

  useEffect(() => {
    if (id) loadRequest(id)
  }, [id])

  // Add event listeners for print
  useEffect(() => {
    const beforePrint = () => {
      // This function intentionally left empty
    }
    
    const afterPrint = () => {
      // This function intentionally left empty
    }
    
    window.addEventListener('beforeprint', beforePrint)
    window.addEventListener('afterprint', afterPrint)
    
    return () => {
      window.removeEventListener('beforeprint', beforePrint)
      window.removeEventListener('afterprint', afterPrint)
    }
  }, [])

  // silent=true reloada os dados sem trocar loading -> nao remonta o
  // RequestActions (senao o modal de aprovacao some antes de renderizar).
  async function loadRequest(requestId: string, silent = false) {
    try {
      if (!silent) setLoading(true)
      const data = await requestService.getById(requestId)
      setRequest(data)
    } catch (error) {
      console.error('Error loading request:', error)
    } finally {
      if (!silent) setLoading(false)
    }
  }

  const handlePrint = () => {
    if (!request) { window.print(); return }
    const win = window.open('', '_blank', 'width=900,height=700')
    if (!win) { window.print(); return }

    const items = request.request_items || []
    const totalItems = items.length
    const totalQtd = items.reduce((sum, it) => sum + (it.approved_quantity ?? it.quantity), 0)

    const reqNumber = request.request_number ? '#' + request.request_number : request.id.substring(0, 8)
    const createdDate = new Date(request.created_at).toLocaleString('pt-BR')
    const deptName = (request as any).department?.name || request.department || '-'
    const requesterName = (request as any).requester?.full_name || '-'

    const html = `
<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<title>Lista de Separação - ${reqNumber}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Arial, Helvetica, sans-serif; padding: 20px; color: #000; font-size: 11pt; }
  .header { border-bottom: 2px solid #000; padding-bottom: 10px; margin-bottom: 15px; }
  .header h1 { font-size: 16pt; margin-bottom: 4px; }
  .header .sub { font-size: 10pt; color: #444; }
  .info { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 15px; font-size: 10pt; }
  .info div { padding: 4px; }
  .info strong { display: inline-block; min-width: 100px; }
  table { width: 100%; border-collapse: collapse; font-size: 10pt; margin-bottom: 15px; }
  thead { background: #f0f0f0; }
  th, td { border: 1px solid #888; padding: 6px 8px; text-align: left; vertical-align: top; }
  th { font-weight: bold; font-size: 9pt; text-transform: uppercase; }
  .col-num { width: 28px; text-align: center; }
  .col-code { width: 120px; font-family: monospace; font-size: 9pt; }
  .col-qty { width: 60px; text-align: center; font-weight: bold; }
  .col-check { width: 40px; text-align: center; }
  .qty-fornec { background: #fffacd; font-size: 14pt; }
  .checkbox { display: inline-block; width: 16px; height: 16px; border: 2px solid #000; }
  .totals { margin-top: 20px; padding: 10px; background: #f0f0f0; border: 1px solid #888; font-size: 10pt; }
  .totals strong { margin-right: 20px; }
  .signature { margin-top: 40px; display: grid; grid-template-columns: 1fr 1fr; gap: 40px; font-size: 10pt; }
  .signature div { border-top: 1px solid #000; padding-top: 4px; text-align: center; }
  .item-name { font-weight: 600; line-height: 1.3; }
  .item-code { font-size: 8pt; color: #666; margin-top: 2px; }
  @page { size: A4; margin: 1cm; }
  @media print {
    body { padding: 0; }
  }
</style>
</head>
<body>
  <div class="header">
    <h1>LISTA DE SEPARAÇÃO DE ITENS</h1>
    <div class="sub">HECC — Hospital Estadual Costa dos Coqueiros • Sistema de Gestão de Insumos</div>
  </div>

  <div class="info">
    <div><strong>Solicitação:</strong> ${reqNumber}</div>
    <div><strong>Data:</strong> ${createdDate}</div>
    <div><strong>Setor Solicitante:</strong> ${deptName}</div>
    <div><strong>Setor Solicitado:</strong> ${(request as any).destination_department ? getDepartmentName((request as any).destination_department) : '—'}</div>
    <div><strong>Solicitante:</strong> ${requesterName}</div>
    <div><strong>Prioridade:</strong> ${request.priority === 'high' ? 'Alta' : request.priority === 'medium' ? 'Média' : 'Baixa'}</div>
    <div><strong>Status:</strong> ${request.status}</div>
  </div>

  <table>
    <thead>
      <tr>
        <th class="col-num">#</th>
        <th>Item</th>
        <th class="col-qty">Qtd Sol.</th>
        <th class="col-qty qty-fornec">Qtd Fornec.</th>
        <th class="col-check">✓</th>
      </tr>
    </thead>
    <tbody>
      ${items.map((it, idx) => {
        const qtd = it.approved_quantity ?? it.quantity
        const fornec = it.supplied_quantity ?? ''
        return `
        <tr>
          <td class="col-num">${idx + 1}</td>
          <td>
            <div class="item-name">${(it.item?.name || '').replace(/</g, '&lt;')}</div>
            <div class="item-code">Código: ${it.item?.code || '-'} • Unidade: ${it.item?.unit || 'UN'}</div>
          </td>
          <td class="col-qty">${qtd}</td>
          <td class="col-qty qty-fornec">${fornec}</td>
          <td class="col-check"><span class="checkbox"></span></td>
        </tr>`
      }).join('')}
    </tbody>
  </table>

  <div class="totals">
    <strong>Total de Itens:</strong> ${totalItems}
    <strong>Quantidade Total Aprovada:</strong> ${totalQtd}
  </div>

  <div class="signature">
    <div>Assinatura de quem separou</div>
    <div>Assinatura de quem recebeu</div>
  </div>

  <script>
    window.onload = function() {
      setTimeout(function() { window.print(); }, 300);
    };
  </script>
</body>
</html>
    `

    win.document.write(html)
    win.document.close()
  }

  const handleExportTemplate = async () => {
    if (!request || !request.id) {
      console.error('No request data available for export')
      return
    }
    
    try {
      await templatesService.generateRequestTemplate(request)
    } catch (error) {
      console.error('Error generating template:', error)
    }
  }

  // Add error state
  const [error, setError] = useState<string | null>(null)

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <Loader2 className="w-8 h-8 text-primary-500 animate-spin mx-auto mb-4" />
          <p className="text-gray-500">Carregando solicitação...</p>
        </div>
      </div>
    )
  }

  if (!request) {
    return (
      <div className="text-center py-12">
        <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
        <h2 className="text-lg font-semibold text-gray-900 mb-2">
          Solicitação não encontrada
        </h2>
        <p className="text-gray-500 mb-6">
          A solicitação que você está procurando não existe ou foi removida.
        </p>
        <Button
          variant="outline"
          onClick={() => navigate('/requests')}
        >
          <ArrowLeft className="w-4 h-4 mr-2" />
          Voltar para Solicitações
        </Button>
      </div>
    )
  }

  return (
    <div className="max-w-7xl mx-auto space-y-6 print:space-y-1 print:max-w-full">
      {/* Header - Only visible on screen */}
      <div className="flex items-center justify-between print:hidden">
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            className="text-primary-600 hover:text-primary-700"
            onClick={() => {
              // Só no almoxarifado: volta pra tela de origem (Histórico, Caixa
              // de Entrada, Em Processamento, etc.) em vez de ir sempre pras
              // solicitações atuais. Farmácia mantém o comportamento anterior.
              if (request?.type === 'warehouse' && window.history.length > 1) {
                navigate(-1)
              } else {
                navigate('/requests')
              }
            }}
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            Voltar
          </Button>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">
              Solicitação #{request?.request_number || formatRequestNumber(request.id)}</h1>
            
            {/* Error Message */}
            {error && (
              <div className="mt-2 p-2 bg-red-50 rounded border border-red-200">
                <p className="text-sm text-red-600">{error}</p>
                <button onClick={() => setError(null)} className="text-xs text-red-500 underline">
                  Fechar
                </button>
              </div>
            )}
            <p className="text-sm text-gray-500">
              Criada em {format(new Date(request.created_at), "dd 'de' MMMM', às' HH:mm", {
                locale: ptBR,
              })}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleExportTemplate}>
            <Download className="w-4 h-4 mr-2" />
            Exportar
          </Button>
          <Button variant="outline" size="sm" onClick={handlePrint}>
            <Printer className="w-4 h-4 mr-2" />
            Imprimir
          </Button>
        </div>
      </div>

      {/* Status and Info */}
      {/* Grid mudou de md:grid-cols-3 para xl:grid-cols-3: em telas medias
          (tablet) a linha do tempo comprimia num "canto" estreito e o texto
          quebrava palavra-por-palavra. Agora so vira coluna lateral em xl+ */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 print:grid-cols-1 print:gap-2">
        <div className="xl:col-span-2 space-y-6 print:space-y-2 print:col-span-1">
          {/* Request Info */}
          <div className="bg-white rounded-xl p-6 border border-gray-100 print:p-2 print:border-0 print:shadow-none">
            <div className="flex items-center justify-between mb-6 print:mb-2">
              <div>
                <h2 className="text-lg font-semibold text-gray-900 print:text-base">
                  Informações da Solicitação
                </h2>
                <p className="text-sm text-gray-500 print:hidden">
                  Detalhes e status atual
                </p>
              </div>
              <RequestStatusBadge status={request.status} />
            </div>

            <div className="grid grid-cols-3 gap-6 print:grid-cols-5 print:gap-2 print:text-sm">
              <div>
                <p className="text-sm text-gray-500 print:text-xs">Solicitante</p>
                <p className="font-medium print:text-sm">{request.requester?.full_name}</p>
              </div>
              <div>
                <p className="text-sm text-gray-500 print:text-xs">Tipo</p>
                <p className="font-medium print:text-sm">
                  {request.type === 'pharmacy' ? 'Farmácia' : 'Almoxarifado'}
                </p>
              </div>
              <div>
                <p className="text-sm text-gray-500 print:text-xs">Prioridade</p>
                <p className="font-medium print:text-sm">
                  {request.priority === 'high' ? 'Alta' :
                   request.priority === 'medium' ? 'Média' : 'Baixa'}
                </p>
              </div>
              <div>
                <p className="text-sm text-gray-500 print:text-xs">Nº Solicitação</p>
                <p className="font-medium print:text-sm">#{request.request_number || formatRequestNumber(request.id)}</p>
              </div>
              <div>
                <p className="text-sm text-gray-500 print:text-xs">Setor Solicitante</p>
                <p className="font-medium print:text-sm">{getDepartmentName(request.department)}</p>
              </div>
              <div>
                <p className="text-sm text-gray-500 print:text-xs">Setor Solicitado</p>
                <p className="font-medium print:text-sm">
                  {request.destination_department ? getDepartmentName(request.destination_department) : '—'}
                </p>
              </div>
              <div>
                <p className="text-sm text-gray-500 print:text-xs">Data de Criação</p>
                <p className="font-medium print:text-sm">
                  {format(new Date(request.created_at), "dd/MM/yyyy 'às' HH:mm", {
                    locale: ptBR,
                  })}
                </p>
              </div>
            </div>

            {/* Dados do Paciente (Colchão Casca de Ovo e similares) */}
            {(request as any).notes && (request as any).notes.includes('[Dados do Paciente]') && (
              <div className="mt-6 border-t border-gray-100 pt-4">
                <h3 className="text-sm font-semibold text-blue-800 mb-3 flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-blue-500"></span>
                  Dados do(s) Paciente(s)
                </h3>
                <div className="space-y-2">
                  {((request as any).notes as string).split('\n').filter((line: string) => line.includes('[Dados do Paciente]')).map((line: string, idx: number) => {
                    const parts: Record<string, string> = {}
                    line.replace('[Dados do Paciente] ', '').split(' | ').forEach((part: string) => {
                      const [key, ...vals] = part.split(': ')
                      if (key && vals.length) parts[key.trim()] = vals.join(': ').trim()
                    })
                    return (
                      <div key={idx} className="p-3 bg-blue-50 border border-blue-200 rounded-lg text-sm">
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                          <div>
                            <span className="text-blue-600 font-medium">Paciente:</span>{' '}
                            <span className="text-blue-900 font-semibold">{parts['Nome'] || '—'}</span>
                          </div>
                          <div>
                            <span className="text-blue-600 font-medium">Leito:</span>{' '}
                            <span className="text-blue-900">{parts['Leito'] || '—'}</span>
                          </div>
                          <div>
                            <span className="text-blue-600 font-medium">Posto:</span>{' '}
                            <span className="text-blue-900">{parts['Posto'] || '—'}</span>
                          </div>
                          <div>
                            <span className="text-blue-600 font-medium">Enfermeira:</span>{' '}
                            <span className="text-blue-900">{parts['Enfermeira'] || '—'}</span>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Observações gerais (notes sem dados de paciente) */}
            {(request as any).notes && !(request as any).notes.includes('[Dados do Paciente]') && (
              <div className="mt-6 border-t border-gray-100 pt-4">
                <p className="text-sm text-gray-500">Observações</p>
                <p className="font-medium text-gray-900 whitespace-pre-line mt-1">{(request as any).notes}</p>
              </div>
            )}

          </div>
        </div>

        {/* Timeline - Hide when printing */}
        <div className="bg-white rounded-xl p-6 border border-gray-100 print:hidden">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">
                Linha do Tempo
              </h2>
              <p className="text-sm text-gray-500">
                Histórico da solicitação
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCommenting(!commenting)}
            >
              <MessageSquare className="w-4 h-4 mr-2" />
              Comentar
            </Button>
          </div>

          {commenting && (
            <div className="mb-6">
              <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                className="w-full min-h-[100px] p-3 rounded-lg border border-gray-200 text-sm"
                placeholder="Digite seu comentário..."
              />
              <div className="flex justify-end gap-2 mt-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setCommenting(false)
                    setComment('')
                  }}
                >
                  Cancelar
                </Button>
                <Button
                  size="sm"
                  disabled={!comment.trim() || !user}
                  onClick={async () => {
                    if (!comment.trim() || !user) return
                    try {
                      await requestService.addComment(
                        request.id,
                        comment
                      )
                      if (id) await loadRequest(id)
                      setCommenting(false)
                      setComment('')
                    } catch (error) {
                      console.error('Error adding comment:', error)
                    }
                  }}
                >
                  Enviar
                </Button>
              </div>
            </div>
          )}

          <RequestTimeline request={request} />
        </div>
      </div>

      {/* Items - Spreadsheet Table (Full Width) */}
      <div className="bg-white rounded-xl p-6 border border-gray-100 print:p-2 print:border print:border-gray-300 print:shadow-none">
        <h2 className="text-lg font-semibold text-gray-900 mb-6 print:mb-2 print:text-base">
          Itens Solicitados
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b-2 border-gray-200">
                <th className="text-left py-3 px-3 font-medium text-gray-600">Nome</th>
                <th className="text-center py-3 px-3 font-medium text-gray-600 w-20">UF</th>
                <th className="text-center py-3 px-3 font-medium text-gray-600 w-24">Qtd Solic.</th>
                {/* Coluna "Saldo" só aparece pra staff da farmácia/almox — solicitante
                    (setor solicitante) não deve ver o estoque, senão informa consumo. */}
                {(user?.role === 'administrador' || user?.role === 'gestor' || user?.role === 'atendente') && (
                  <th className="text-center py-3 px-3 font-medium text-gray-600 w-24">Saldo</th>
                )}
                <th className="text-center py-3 px-3 font-medium text-gray-600 w-28">Qtd Fornec.</th>
                {/* Colunas Lote e Validade so aparecem em solicitacoes de
                    FARMACIA (o staff informa o lote no atendimento; validade
                    preenche automatica). Almoxarifado nao usa. */}
                {request.type === 'pharmacy' && (
                  <>
                    <th className="text-center py-3 px-3 font-medium text-gray-600 w-56">
                      Lote <span className="text-red-500">*</span>
                    </th>
                    <th className="text-center py-3 px-3 font-medium text-gray-600 w-28">Validade</th>
                  </>
                )}
                <th className="text-center py-3 px-3 font-medium text-gray-600 w-44">Observação</th>
                <th className="text-center py-3 px-3 font-medium text-gray-600 w-24">Confirmar</th>
              </tr>
            </thead>
            <tbody>
              {request.request_items.map((item) => {
                const isStaff = user?.role === 'administrador' || user?.role === 'gestor' || user?.role === 'atendente'
                const statusAllowsEdit = request.status === 'pending' || request.status === 'approved' || request.status === 'processing'
                return (
                  <ItemRow
                    key={item.id}
                    item={item}
                    canEdit={isStaff && statusAllowsEdit}
                    isAdmin={user?.role === 'administrador'}
                    canSeeStock={isStaff}
                    requestType={request.type}
                  />
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Request Actions - Below items, hide when printing */}
      <div className="print:hidden">
        <RequestActions
          request={request}
          onUpdate={() => { if (id) loadRequest(id, true) }}
        />
      </div>

      {/* Print Signature Section - Only visible when printing */}
      <div className="hidden print:block print:mt-4">
        <div className="grid grid-cols-3 gap-4">
          <div className="text-center">
            <div className="border-t border-gray-300 pt-1 mt-8">
              <p className="text-xs">Solicitante</p>
            </div>
          </div>
          <div className="text-center">
            <div className="border-t border-gray-300 pt-1 mt-8">
              <p className="text-xs">Aprovador</p>
            </div>
          </div>
          <div className="text-center">
            <div className="border-t border-gray-300 pt-1 mt-8">
              <p className="text-xs">Recebedor</p>
            </div>
          </div>
        </div>

        <div className="mt-4 text-center text-xs text-gray-500">
          <p>Data de impressão: {format(new Date(), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}</p>
        </div>
      </div>

      {/* Print-specific styles */}
      <style>
        {`
        @media print {
          @page {
            size: A4;
            margin: 0.5cm;
            scale: 90%;
          }
          body {
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
            font-size: 9pt;
          }
          .print\\:hidden {
            display: none !important;
          }
          header {
            display: none !important;
          }
          table {
            page-break-inside: auto;
          }
          tr {
            page-break-inside: avoid;
            page-break-after: auto;
          }
        }
        `}
      </style>
    </div>
  )
}
