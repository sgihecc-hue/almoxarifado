import { useState, useEffect } from 'react'
import { getErrorMessage } from '@/lib/utils/error-messages'
import { useAuth } from '@/contexts/auth'
import { useModule } from '@/contexts/module'
import { podeAtenderSolicitacao } from '@/lib/utils/request-scope'
import {
  CheckCircle2, XCircle, PlayCircle,
  CheckSquare, Ban, Loader2, Truck, PackageCheck, Search, User, AlertTriangle
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'

import { requestService } from '@/lib/services/requests'
import type { Request } from '@/lib/services/requests'
import { employeesService } from '@/lib/services/employees'
import type { Employee } from '@/lib/types/employees'
import { supabase } from '@/lib/supabase'

interface RequestActionsProps {
  request: Request
  onUpdate: (request: Request) => void
}

export function RequestActions({ request, onUpdate }: RequestActionsProps) {
  const { user } = useAuth()
  const { homeModule } = useModule()
  const [loading, setLoading] = useState(false)
  const [showDialog, setShowDialog] = useState(false)
  const [showApprovalToast, setShowApprovalToast] = useState(false)
  const [action, setAction] = useState<'approve' | 'reject' | 'cancel' | 'deliver' | 'confirm_receipt' | null>(null)
  // FA5: saída sem saldo no sistema (item existe no físico mas não foi
  // lançado). O atendente confirma na caixinha e o estoque fica negativo —
  // ao dar entrada depois, o negativo é compensado.
  const [showNegativoDialog, setShowNegativoDialog] = useState(false)
  const [negativoCiente, setNegativoCiente] = useState(false)
  const [itensSemSaldo, setItensSemSaldo] = useState<Array<{ nome: string; pedido: number; saldo: number }>>([])
  // Medicamento sem lote/validade: bloqueio duro, sem "ciente" pra furar.
  const [showLoteDialog, setShowLoteDialog] = useState(false)
  const [itensSemLote, setItensSemLote] = useState<Array<{ nome: string; falta: string }>>([])
  const [reason, setReason] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [employee, setEmployee] = useState<Employee | null>(null)
  const [searchResults, setSearchResults] = useState<Employee[]>([])
  const [searchingEmployee, setSearchingEmployee] = useState(false)
  const [employeeError, setEmployeeError] = useState('')
  const [showResults, setShowResults] = useState(false)
  const [itemQuantities, setItemQuantities] = useState<Record<string, number>>(() => {
    // Initialize with current quantities or approved quantities if they exist
    if (!request?.request_items?.length) {
      return {}
    }
    
    try {
      return request.request_items.reduce((acc, item) => {
        if (!item || !item.id || typeof item.quantity !== 'number' || item.quantity < 0) return acc
        
        const quantity = Math.max(0, Math.floor(item.quantity))
        const approvedQuantity = (typeof item.approved_quantity === 'number' && item.approved_quantity !== null && item.approved_quantity >= 0) ? Math.max(0, Math.floor(item.approved_quantity)) : null
        
        acc[item.id] = approvedQuantity !== null 
          ? approvedQuantity 
          : quantity
        return acc
      }, {} as Record<string, number>)
    } catch (error) {
      console.error('Error initializing item quantities:', error)
      return {}
    }
  })

  // Validate request data on mount
  useEffect(() => {
    if (!request || !request.request_items) return
    
    // Validate request structure
    if (!request?.request_items?.length) {
      return
    }
    
    try {
      const validatedQuantities = request.request_items.reduce((acc, item) => {
        if (!item?.id || !item.quantity) return acc
        
        const quantity = typeof item.quantity === 'number' ? item.quantity : 0
        const approvedQuantity = (typeof item.approved_quantity === 'number' && 
          item.approved_quantity !== null && 
          item.approved_quantity >= 0) ? item.approved_quantity : null
        
        acc[item.id] = approvedQuantity !== null ? approvedQuantity : quantity
        return acc
      }, {} as Record<string, number>)
      
      setItemQuantities(validatedQuantities)
    } catch (error) {
      console.error('Error validating request data:', error)
    }
  }, [request])

  // Operador só atende solicitação do PRÓPRIO módulo. Sem isso, o papel
  // 'atendente' liberava qualquer pedido: um atendente da farmácia abria a
  // tela de atendimento de um pedido do almoxarifado e podia aprovar,
  // separar e marcar como entregue. Ver lib/utils/request-scope.ts.
  const podeAtender = podeAtenderSolicitacao(homeModule, request?.type)
  const isManager = podeAtender &&
    (user?.role === 'gestor' || user?.role === 'administrador' || user?.role === 'atendente')
  // Farmaceutico e staff SO em solicitacao de farmacia: atende (aprova) e informa
  // lote/quantidade. NAO recebe os passos do almoxarifado (Iniciar Processamento /
  // Marcar como Entregue), que seguem restritos a isManager — dar isso a ele
  // deixaria o pedido 'delivered' sem que a baixa do almox fizesse sentido.
  const isPharmacyStaff = isManager ||
    (podeAtender && user?.role === 'pharmacist' && request?.type === 'pharmacy')
  const canManage = isPharmacyStaff && request?.status === 'pending'
  // Fluxo depende do TIPO da solicitacao:
  // - Farmacia: aprovar ja marca como entregue -> solicitante confirma
  //   recebimento -> completed. Sem botao "Marcar como Entregue".
  // - Almoxarifado: aprovar -> approved. Depois staff clica "Marcar como
  //   Entregue" e o pedido vai direto pra completed (sem confirmacao de
  //   recebimento — almox nao pede confirmacao).
  const isPharmacyRequest = request?.type === 'pharmacy'
  // Fluxo sequencial do almox: aprovar → Iniciar processamento → Marcar como
  // Entregue. Por isso "Marcar como Entregue" (canDeliver) só aparece quando
  // já está em 'processing' — não quando ainda está 'approved'.
  const canDeliver = isManager && !isPharmacyRequest && request?.status === 'processing'
  // "Em Processamento" reativado SÓ no almoxarifado: após aprovar, o operador
  // move pra processamento (separação/em rota) antes de entregar.
  // Farmácia nunca vê (isPharmacyRequest bloqueia).
  const canProcess = isManager && !isPharmacyRequest && request?.status === 'approved'
  // Recebimento SO existe pra farmacia E so quem SOLICITOU (ou alguem
  // do mesmo setor solicitante) pode confirmar. Quem atendeu/entregou
  // NAO ve o botao — senao a mesma pessoa que aprovou tambem "confirma"
  // o recebimento e o controle vira teatro.
  // Aceita 2 caminhos: o proprio requester_id OU alguem cujo department
  // eh o setor solicitante (colega do mesmo setor pode confirmar quando
  // quem criou saiu do turno).
  const isRequester = !!user && !!request && user.id === request.requester_id
  const isFromRequestingSector = !!user?.department_id &&
    !!request?.department_id &&
    user.department_id === request.department_id
  const canConfirmReceipt = !!user &&
    isPharmacyRequest &&
    request?.status === 'delivered' &&
    (isRequester || isFromRequestingSector)
  const canComplete = false
  const canCancel = (user?.id === request?.requester_id || isManager) &&
    ['pending', 'approved'].includes(request.status)

  const searchEmployee = async () => {
    if (!searchQuery.trim()) {
      setEmployeeError('Digite a matricula ou nome')
      return
    }
    setSearchingEmployee(true)
    setEmployeeError('')
    setEmployee(null)
    setSearchResults([])
    setShowResults(false)
    try {
      const query = searchQuery.trim()
      // Check if it looks like a matricula (only numbers)
      const isMatricula = /^\d+$/.test(query)

      if (isMatricula) {
        const found = await employeesService.getByMatricula(query)
        if (found) {
          setEmployee(found)
        } else {
          setEmployeeError('Colaborador nao encontrado')
        }
      } else {
        // Search by name
        const results = await employeesService.searchByName(query)
        if (results.length === 1) {
          setEmployee(results[0])
        } else if (results.length > 1) {
          setSearchResults(results)
          setShowResults(true)
        } else {
          setEmployeeError('Nenhum colaborador encontrado')
        }
      }
    } catch {
      setEmployeeError('Erro ao buscar colaborador')
    } finally {
      setSearchingEmployee(false)
    }
  }

  const handleAction = async () => {
    if (!action) return

    // Validate employee for delivery
    if (action === 'deliver' && !employee) {
      setEmployeeError('Informe a matrícula do recebedor')
      return
    }

    try {
      setLoading(true)
      let updatedRequest: Request

      switch (action) {
        case 'approve':
          updatedRequest = await requestService.approve(request.id, itemQuantities, reason)
          setShowApprovalToast(true)
          break
        case 'reject':
          updatedRequest = await requestService.reject(request.id, reason)
          break
        case 'cancel':
          updatedRequest = await requestService.cancel(request.id, reason)
          break
        case 'deliver':
          updatedRequest = await requestService.markAsDelivered(
            request.id,
            reason,
            employee?.id
          )
          break
        case 'confirm_receipt':
          updatedRequest = await requestService.confirmReceipt(request.id, reason)
          break
        default:
          return
      }

      requestService.clearCache()
      onUpdate(updatedRequest)
      setShowDialog(false)
      setReason('')
      setSearchQuery('')
      setSearchResults([])
      setShowResults(false)
      setEmployee(null)
    } catch (error) {
      setEmployeeError(getErrorMessage(error))
    } finally {
      setLoading(false)
      if (action !== 'deliver') setAction(null)
    }
  }

  // Move a solicitação de almox pra "Em Processamento" (separação/em rota).
  // Ação direta, sem diálogo. Só almox (o botão só aparece quando canProcess).
  const handleStartProcessing = async () => {
    try {
      setLoading(true)
      const updated = await requestService.startProcessing(request.id)
      requestService.clearCache()
      onUpdate(updated)
    } catch (error) {
      setEmployeeError(getErrorMessage(error))
    } finally {
      setLoading(false)
    }
  }

  // Le a QUANTIDADE FORNECIDA que o atendente digitou. Ela e salva pelo
  // ItemRow direto em request_items.supplied_quantity (no blur), e NAO passa
  // pelo itemQuantities daqui — que e o estado antigo de "quantidade
  // aprovada" e vem preenchido com o valor SOLICITADO. Usar itemQuantities
  // fazia o item sem quantidade digitada ser tratado como atendido.
  const lerFornecidos = async (): Promise<Record<string, number>> => {
    const ids = (request.request_items || []).map((it) => it.id)
    if (ids.length === 0) return {}
    const { data } = await supabase
      .from('request_items')
      .select('id, supplied_quantity')
      .in('id', ids)
    const mapa: Record<string, number> = {}
    ;(data || []).forEach((r: any) => { mapa[r.id] = Number(r.supplied_quantity) || 0 })
    return mapa
  }

  /**
   * MEDICAMENTO não sai sem lote e validade.
   *
   * Revoga o FA2 ("lote nunca é obrigatório", 16/07) apenas onde ele abriu
   * buraco: o atendimento de solicitação. Entrada por NF, dispensação, saída
   * em lote e devolução já exigiam lote — este era o único caminho solto, e
   * por ele passaram 154 itens sem lote nenhum, TODOS medicamento.
   *
   * Cada saída sem lote baixa o saldo e não baixa lote, deixando as duas
   * contabilidades divergentes (foi assim que a Metadona ficou 175 x 180) e
   * apagando a rastreabilidade que a Portaria 344/98 exige.
   *
   * A regra é só para MEDICAMENTO. Material da farmácia (MAT/MED — curativos,
   * gaze, clorexidina) segue livre: nenhum deles usou a brecha.
   *
   * Só valida item que está de fato saindo (quantidade fornecida > 0).
   */
  const validarLoteMedicamentos = async (
    fornecidos: Record<string, number>,
  ): Promise<Array<{ nome: string; falta: string }>> => {
    const ids = (request.request_items || [])
      .map((it) => it.id)
      .filter((id) => (fornecidos[id] || 0) > 0)
    if (ids.length === 0) return []

    const [{ data: itens }, { data: lotes }] = await Promise.all([
      supabase
        .from('request_items')
        .select('id, item_name, pharmacy_item:pharmacy_items(category)')
        .in('id', ids),
      supabase
        .from('request_item_lots')
        .select('request_item_id, batch_number, expiry_date, quantity, expiry_tracking_id')
        .in('request_item_id', ids),
    ])

    const porItem = new Map<string, Array<any>>()
    for (const l of (lotes || []) as any[]) {
      const arr = porItem.get(l.request_item_id) ?? []
      arr.push(l)
      porItem.set(l.request_item_id, arr)
    }

    const pendencias: Array<{ nome: string; falta: string }> = []
    for (const it of (itens || []) as any[]) {
      const categoria = String(it.pharmacy_item?.category ?? '').toUpperCase()
      // 'MEDICAMENTO' e 'Medicamentos' entram; 'MAT/MED' não (começa com MAT).
      if (!categoria.startsWith('MEDICAMENTO')) continue

      const doItem = (porItem.get(it.id) ?? []).filter((l) => (Number(l.quantity) || 0) > 0)
      const nome = it.item_name || '(item)'
      if (doItem.length === 0) {
        pendencias.push({ nome, falta: 'lote e validade' })
        continue
      }
      const semLote = doItem.some((l) => !(l.batch_number || '').trim() && !l.expiry_tracking_id)
      const semValidade = doItem.some((l) => !l.expiry_date)
      if (semLote && semValidade) pendencias.push({ nome, falta: 'lote e validade' })
      else if (semLote) pendencias.push({ nome, falta: 'o número do lote' })
      else if (semValidade) pendencias.push({ nome, falta: 'a validade' })
    }
    return pendencias
  }

  // Executa a aprovação de fato (chamado direto ou após confirmar o negativo).
  const executarAprovacao = async () => {
    try {
      setLoading(true)
      const fornecidos = await lerFornecidos()
      // FA2: item sem quantidade fornecida NAO barra a solicitacao — ele fica
      // como NAO ATENDIDO e os demais seguem. O estoque abate o que de fato
      // saiu (supplied_quantity), nao o solicitado.
      if (isPharmacyRequest) {
        const naoAtendidos = (request.request_items || [])
          .filter((it) => !(fornecidos[it.id] > 0)).map((it) => it.id)
        if (naoAtendidos.length > 0) {
          await supabase.from('request_items').update({ status: 'nao_atendido' }).in('id', naoAtendidos)
        }
        const atendidos = (request.request_items || [])
          .filter((it) => fornecidos[it.id] > 0).map((it) => it.id)
        if (atendidos.length > 0) {
          await supabase.from('request_items').update({ status: 'atendido' }).in('id', atendidos)
        }
      }
      // approve() grava approved_quantity: usa o fornecido pra os dois campos
      // ficarem coerentes (aprovado = o que realmente vai sair).
      const quantidades = isPharmacyRequest ? fornecidos : itemQuantities
      const updatedRequest = await requestService.approve(request.id, quantidades, '')
      if (isPharmacyRequest) setShowApprovalToast(true)
      requestService.clearCache()
      onUpdate(updatedRequest)
    } catch (error) {
      console.error('Error approving:', error)
      setEmployeeError(getErrorMessage(error))
    } finally {
      setLoading(false)
      setShowNegativoDialog(false)
      setNegativoCiente(false)
    }
  }

  // Gate do FA5: lista SO os itens que vao sair acima do saldo — usando a
  // quantidade FORNECIDA (nao a solicitada).
  const handleAprovarClick = async () => {
    if (!isPharmacyRequest) { executarAprovacao(); return }
    setLoading(true)
    const fornecidos = await lerFornecidos()
    // Lote/validade de medicamento vem ANTES do aviso de saldo negativo: é
    // bloqueio, não alerta — não existe "estou ciente" que o dispense.
    const semLote = await validarLoteMedicamentos(fornecidos)
    setLoading(false)
    if (semLote.length > 0) {
      setItensSemLote(semLote)
      setShowLoteDialog(true)
      return
    }
    const semSaldo = (request.request_items || [])
      .map((it) => ({
        nome: it.item?.name || '(item)',
        pedido: fornecidos[it.id] || 0,
        saldo: Number(it.item?.current_stock) || 0,
      }))
      .filter((x) => x.pedido > 0 && x.pedido > x.saldo)
    if (semSaldo.length > 0) {
      setItensSemSaldo(semSaldo)
      setNegativoCiente(false)
      setShowNegativoDialog(true)
      return
    }
    executarAprovacao()
  }

  const handleDeliver = () => {
    setAction('deliver')
    setSearchQuery('')
    setEmployee(null)
    setEmployeeError('')
    setSearchResults([])
    setShowResults(false)
    // No dialog - uses inline form
  }

  const handleConfirmReceipt = () => {
    setAction('confirm_receipt')
    setShowDialog(true)
  }



  const handleComplete = async () => {
    try {
      setLoading(true)
      const updatedRequest = await requestService.complete(request.id)
      onUpdate(updatedRequest)
    } catch (error) {
      console.error('Error completing request:', error)
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      {/* flex-wrap pra os botões quebrarem linha em tela estreita — antes
          ficavam em UMA linha só e os últimos (ex: "Confirmar Recebimento")
          saíam de vista. justify-end pra alinhar à direita como CTA. */}
      <div className="flex flex-wrap items-center gap-2 justify-end pt-2">
        {/* Approve/Reject Actions */}
        {canManage && (
          <>
            <Button
              size="sm"
              className="bg-green-500 hover:bg-green-600 text-white"
              onClick={handleAprovarClick}
              disabled={loading}
            >
              <CheckCircle2 className="w-4 h-4 mr-2" />
              Aprovar
            </Button>
            <Button
              size="sm"
              variant="destructive"
              onClick={() => {
                setAction('reject')
                setShowDialog(true)
              }}
              disabled={loading}
            >
              <XCircle className="w-4 h-4 mr-2" />
              Rejeitar
            </Button>
          </>
        )}

        {/* Em Processamento (almox): move a solicitação aprovada pra separação.
            Depois o operador usa "Marcar como Entregue" pra concluir. */}
        {canProcess && (
          <Button
            size="sm"
            className="bg-blue-500 hover:bg-blue-600 text-white"
            onClick={handleStartProcessing}
            disabled={loading}
          >
            <PlayCircle className="w-4 h-4 mr-2" />
            Iniciar processamento
          </Button>
        )}

        {/* Deliver Action */}
        {canDeliver && (
          <Button
            size="sm"
            className="bg-orange-500 hover:bg-orange-600 text-white"
            onClick={handleDeliver}
            disabled={loading}
          >
            <Truck className="w-4 h-4 mr-2" />
            Marcar como Entregue
          </Button>
        )}

        {/* Confirm Receipt Action */}
        {canConfirmReceipt && (
          <Button
            size="sm"
            className="bg-emerald-500 hover:bg-emerald-600 text-white"
            onClick={handleConfirmReceipt}
            disabled={loading}
          >
            <PackageCheck className="w-4 h-4 mr-2" />
            Confirmar Recebimento
          </Button>
        )}

        {/* Complete Action */}
        {canComplete && (
          <Button
            size="sm"
            className="bg-emerald-500 hover:bg-emerald-600 text-white"
            onClick={handleComplete}
            disabled={loading}
          >
            <CheckSquare className="w-4 h-4 mr-2" />
            Concluir
          </Button>
        )}

        {/* Cancel Action */}
        {canCancel && (
          <Button
            size="sm"
            variant="outline"
            className="text-gray-600 hover:text-gray-700"
            onClick={() => {
              setAction('cancel')
              setShowDialog(true)
            }}
            disabled={loading}
          >
            <Ban className="w-4 h-4 mr-2" />
            Cancelar
          </Button>
        )}

        {/* Loading Indicator */}
        {loading && (
          <Loader2 className="w-5 h-5 text-primary-500 animate-spin" />
        )}
      </div>

      {/* Inline Delivery Form (no dialog - works on mobile) */}
      {action === 'deliver' && !showDialog && (
        <div className="mt-4 p-4 bg-orange-50 border border-orange-200 rounded-xl space-y-4">
          <h3 className="font-semibold text-orange-700 text-lg">Marcar como Entregue</h3>

          <div className="space-y-2">
            <Label className="font-medium text-gray-900">Recebedor</Label>
            <div className="flex gap-2">
              <Input
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value)
                  setEmployee(null)
                  setEmployeeError('')
                  setSearchResults([])
                  setShowResults(false)
                }}
                onKeyDown={(e) => e.key === 'Enter' && searchEmployee()}
                placeholder="Digite matricula ou nome..."
                className="flex-1 bg-white"
              />
              <Button type="button" variant="outline" onClick={searchEmployee} disabled={searchingEmployee}>
                {searchingEmployee ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
              </Button>
            </div>
            {employeeError && <p className="text-sm text-red-600">{employeeError}</p>}
            {showResults && searchResults.length > 0 && (
              <select
                className="w-full h-10 px-3 rounded-lg border border-gray-300 text-sm bg-white"
                defaultValue=""
                onChange={(e) => {
                  const selected = searchResults.find(emp => emp.id === e.target.value)
                  if (selected) {
                    setEmployee(selected)
                    setShowResults(false)
                    setSearchResults([])
                    setSearchQuery(selected.full_name)
                  }
                }}
              >
                <option value="" disabled>Selecione o recebedor...</option>
                {searchResults.map((emp) => (
                  <option key={emp.id} value={emp.id}>
                    {emp.full_name}{emp.matricula ? ` (Mat: ${emp.matricula})` : ''}
                  </option>
                ))}
              </select>
            )}
            {employee && (
              <div className="flex items-center gap-3 p-3 bg-green-50 border border-green-200 rounded-lg">
                <User className="w-5 h-5 text-green-600" />
                <div>
                  <p className="font-medium text-gray-900">{employee.full_name}</p>
                  <p className="text-sm text-gray-500">
                    {employee.matricula && `Mat: ${employee.matricula}`}
                    {employee.department_name && ` • ${employee.department_name}`}
                  </p>
                </div>
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label className="font-medium text-gray-900">Observações (opcional)</Label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="w-full min-h-[80px] p-3 rounded-lg border border-gray-200 text-sm bg-white"
              placeholder="Adicione observações sobre a entrega..."
            />
          </div>

          <div className="flex gap-2">
            <Button variant="outline" onClick={() => { setAction(null); setReason(''); setEmployee(null); setSearchQuery('') }}>
              Cancelar
            </Button>
            <Button
              onClick={handleAction}
              disabled={loading || !employee}
              className="bg-orange-600 hover:bg-orange-700 text-white"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Truck className="w-4 h-4 mr-2" />}
              Confirmar Entrega
            </Button>
          </div>
        </div>
      )}

      {/* Medicamento sem lote/validade — bloqueio, não aviso: não há botão de
          seguir mesmo assim. A saída sem lote quebra a rastreabilidade e
          desencontra saldo e lotes. */}
      <Dialog open={showLoteDialog} onOpenChange={setShowLoteDialog}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-700">
              <AlertTriangle className="w-5 h-5" />
              Falta informar o lote
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm text-gray-700">
              Medicamento não pode ser atendido sem <strong>lote e validade</strong>.
              Informe na coluna <strong>Lote(s)</strong> de cada item abaixo e aprove de novo.
            </p>
            <div className="rounded-lg border border-red-200 bg-red-50 divide-y divide-red-200 max-h-48 overflow-y-auto">
              {itensSemLote.map((x, i) => (
                <div key={i} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                  <span className="text-red-900 truncate">{x.nome}</span>
                  <span className="text-red-700 flex-shrink-0 text-xs">falta {x.falta}</span>
                </div>
              ))}
            </div>
            <p className="text-xs text-gray-500">
              Se o medicamento está na prateleira mas o lote não aparece na lista, use a opção
              de digitar o lote na hora — basta o número impresso na caixa e a validade.
            </p>
          </div>
          <DialogFooter>
            <Button onClick={() => setShowLoteDialog(false)} className="bg-red-600 hover:bg-red-700 text-white">
              Entendi
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* FA5: confirmação de saída sem saldo no sistema (estoque fica negativo) */}
      <Dialog open={showNegativoDialog} onOpenChange={(o) => { setShowNegativoDialog(o); if (!o) setNegativoCiente(false) }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-amber-700">
              <AlertTriangle className="w-5 h-5" />
              Saída sem saldo no sistema
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm text-gray-700">
              Estes itens vão sair em quantidade <strong>maior que o saldo registrado</strong>.
              Isso é esperado quando o medicamento existe fisicamente mas ainda não foi
              lançado no sistema.
            </p>
            <div className="rounded-lg border border-amber-200 bg-amber-50 divide-y divide-amber-200 max-h-48 overflow-y-auto">
              {itensSemSaldo.map((x, i) => (
                <div key={i} className="flex items-center justify-between px-3 py-2 text-sm">
                  <span className="text-amber-900 truncate">{x.nome}</span>
                  <span className="text-amber-800 flex-shrink-0 ml-2">
                    saindo <strong>{x.pedido}</strong> · saldo <strong>{x.saldo}</strong>
                  </span>
                </div>
              ))}
            </div>
            <p className="text-sm text-gray-600">
              O estoque ficará <strong>negativo</strong> e será <strong>compensado
              automaticamente</strong> quando o item for lançado na entrada.
            </p>
            <label className="flex items-start gap-2 text-sm cursor-pointer p-2 rounded hover:bg-gray-50">
              <input
                type="checkbox"
                checked={negativoCiente}
                onChange={(e) => setNegativoCiente(e.target.checked)}
                className="mt-0.5"
              />
              <span>Confirmo a saída e estou ciente de que o estoque ficará negativo.</span>
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowNegativoDialog(false)} disabled={loading}>
              Cancelar
            </Button>
            <Button
              onClick={executarAprovacao}
              disabled={loading || !negativoCiente}
              className="bg-amber-600 hover:bg-amber-700 text-white"
            >
              {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Confirmar e aprovar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Action Dialog (for non-delivery actions only) */}
      <Dialog open={showDialog && action !== 'deliver'} onOpenChange={setShowDialog}>
        <DialogContent className="max-w-2xl bg-white">
          <DialogHeader className="border-b pb-4">
            <DialogTitle className={`text-xl font-semibold ${
              action === 'approve' ? 'text-green-600' :
              action === 'reject' ? 'text-red-600' :
              action === 'confirm_receipt' ? 'text-emerald-600' :
              'text-gray-600'
            }`}>
              {action === 'approve' && 'Aprovar Solicitação'}
              {action === 'reject' && 'Rejeitar Solicitação'}
              {action === 'cancel' && 'Cancelar Solicitação'}
              {action === 'confirm_receipt' && 'Confirmar Recebimento'}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-6 py-4">
            {/* Comments/Reason */}
            <div className="space-y-2">
              <Label className="text-base font-medium text-gray-900">
                {action === 'approve' && 'Comentários (opcional)'}
                {action === 'reject' && 'Motivo da Rejeição'}
                {action === 'cancel' && 'Motivo do Cancelamento'}
                {action === 'confirm_receipt' && 'Observações sobre o Recebimento (opcional)'}
              </Label>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="w-full min-h-[100px] p-3 rounded-lg border border-gray-200 text-sm bg-white text-gray-900 focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                placeholder={
                  action === 'approve'
                    ? 'Adicione um comentário...'
                    : action === 'confirm_receipt'
                    ? 'Adicione observações sobre o recebimento...'
                    : 'Descreva o motivo...'
                }
              />
            </div>
          </div>

          <DialogFooter className="border-t pt-4">
            <Button
              variant="outline"
              onClick={() => {
                setShowDialog(false)
                setReason('')
                setAction(null)
              }}
              disabled={loading}
            >
              Cancelar
            </Button>
            <Button
              onClick={handleAction}
              disabled={loading || (['reject', 'cancel'].includes(action || '') && !reason.trim())}
              className={`px-6 ${
                action === 'approve'
                  ? 'bg-green-500 hover:bg-green-600 text-white'
                  : action === 'reject'
                  ? 'bg-red-500 hover:bg-red-600 text-white'
                  : action === 'deliver'
                  ? 'bg-orange-500 hover:bg-orange-600 text-white'
                  : action === 'confirm_receipt'
                  ? 'bg-emerald-500 hover:bg-emerald-600 text-white'
                  : 'bg-gray-500 hover:bg-gray-600 text-white'
              }`}
            >
              {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {action === 'approve' && 'Aprovar'}
              {action === 'reject' && 'Rejeitar'}
              {action === 'cancel' && 'Cancelar'}
              {action === 'confirm_receipt' && 'Confirmar Recebimento'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal de sucesso após aprovar — apenas informa que aprovou. NAO
          leva o staff pra Confirmar Recebimento: quem confirma nao eh
          quem aprova (essa tela e do setor solicitante). */}
      <ApprovalSuccessDialog
        open={showApprovalToast}
        onOpenChange={setShowApprovalToast}
        requestNumber={request?.request_number ?? request?.id?.slice(0, 8)}
        departmentName={request?.department}
      />
    </>
  )
}

// Dialog de sucesso da aprovacao/atendimento.
// IMPORTANTE: quem confirma o recebimento NAO eh quem atende o pedido.
// O staff que aprovou aqui NUNCA vai para a tela "Confirmar Recebimento"
// — essa tela e do SETOR SOLICITANTE. Por isso o dialog so informa o
// sucesso e fecha; nao tem botao/link/redirect pra Confirmar Recebimento.
function ApprovalSuccessDialog({
  open, onOpenChange, requestNumber, departmentName,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  requestNumber?: number | string
  departmentName?: string
}) {
  if (!open) return null
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.55)',
        zIndex: 99999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
      }}
      onClick={() => onOpenChange(false)}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'white',
          borderRadius: 14,
          maxWidth: 440,
          width: '100%',
          padding: 24,
          boxShadow: '0 20px 60px rgba(0,0,0,0.35)',
          border: '2px solid #10b981',
        }}
      >
        <div className="flex items-center gap-2 mb-3" style={{ color: '#047857' }}>
          <CheckCircle2 className="w-7 h-7" />
          <h3 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>Solicitação aprovada!</h3>
        </div>
        <p style={{ fontSize: 14, color: '#374151', marginBottom: 8 }}>
          O pedido <strong>#{requestNumber}</strong> foi aprovado com sucesso.
        </p>
        <p style={{ fontSize: 13, color: '#6b7280', marginBottom: 20 }}>
          {departmentName ? <>O setor <strong>{departmentName}</strong> </> : 'O setor solicitante '}
          vai receber e confirmar o recebimento.
        </p>
        <div className="flex justify-end">
          <Button
            className="bg-green-600 hover:bg-green-700 text-white"
            onClick={() => onOpenChange(false)}
          >
            Fechar
          </Button>
        </div>
      </div>
    </div>
  )
}