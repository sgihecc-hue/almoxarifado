import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '@/contexts/auth'
import { ArrowLeft, ArrowRight, AlertCircle, AlertTriangle, ChevronDown, Clock, Cloud, CloudOff } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { RequestTypeStep } from './components/request-type'
import { RequestDetails, type RequestDetails as RequestDetailsType } from './components/request-details'
import { RequestItems, type RequestItem } from './components/request-items'
import { RequestReview } from './components/request-review'
import { InventoryNoticeAlmox } from '@/components/inventory-notice-almox'
import { requestService } from '@/lib/services/requests'
import { requestDraftsService } from '@/lib/services/request-drafts'
import { useTheme } from '@/contexts/theme'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import type { RequestType } from './types'

const steps = [
  { id: 'type', title: 'Tipo de Solicitação', description: 'Escolha o tipo de solicitação que deseja fazer' },
  { id: 'details', title: 'Detalhes', description: 'Informe os detalhes da solicitação' },
  { id: 'items', title: 'Itens', description: 'Adicione os itens necessários' },
  { id: 'review', title: 'Revisão', description: 'Revise sua solicitação antes de enviar' },
]

const statusLabels: Record<string, string> = {
  pending: 'Pendente',
  approved: 'Aprovada',
  processing: 'Em Processamento',
}
const statusColors: Record<string, string> = {
  pending: '#f59e0b',
  approved: '#22c55e',
  processing: '#3b82f6',
}

export function NewRequest() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const { mode } = useTheme()
  const draftKey = user?.id ? `sgi_draft_request_${user.id}` : null

  const [currentStep, setCurrentStep] = useState(0)
  const [requestType, setRequestType] = useState<RequestType | null>(null)
  const [details, setDetails] = useState<RequestDetailsType | null>(null)
  const [items, setItems] = useState<RequestItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [_createdRequest, _setCreatedRequest] = useState<any>(null)
  const [recentRequests, setRecentRequests] = useState<any[]>([])
  const [showRecent, setShowRecent] = useState(false)
  const [draftLoaded, setDraftLoaded] = useState(false)
  const [draftSavedAt, setDraftSavedAt] = useState<Date | null>(null)
  const [hasDraft, setHasDraft] = useState(false)
  const [cloudSync, setCloudSync] = useState<'idle' | 'saving' | 'saved' | 'offline'>('idle')
  const saveTimerRef = useRef<number | null>(null)
  // Pending draft (carregado da nuvem mas aguardando o usuario clicar em "Continuar editando")
  const [pendingDraft, setPendingDraft] = useState<any | null>(null)
  const [draftDismissed, setDraftDismissed] = useState(false)

  // Check if within service hours (8h-14h)
  const now = new Date()
  const currentHour = now.getHours()
  const isOutsideServiceHours = currentHour < 8 || currentHour >= 14

  // P7: popup de confirmação de leitura para pedidos de almoxarifado feitos
  // após as 14h. O usuário precisa clicar confirmando que leu antes do envio.
  const [showLateOrderDialog, setShowLateOrderDialog] = useState(false)

  useEffect(() => {
    if (user?.department_id) {
      requestService.getRecentByDepartment(user.department_id).then(setRecentRequests)
    }
  }, [user?.department_id])

  // Load draft on mount: try cloud first, then localStorage. Apenas marca como pendente.
  useEffect(() => {
    if (!user?.id || draftLoaded) return
    let cancelled = false
    ;(async () => {
      let foundDraft: any = null
      let savedAt: Date | null = null

      // 1) Try cloud
      const cloudDraft = await requestDraftsService.load(user.id)
      if (cancelled) return
      if (cloudDraft && (cloudDraft.request_type || cloudDraft.details || (cloudDraft.items?.length))) {
        foundDraft = {
          requestType: cloudDraft.request_type,
          details: cloudDraft.details,
          items: cloudDraft.items || [],
          currentStep: cloudDraft.current_step ?? 0,
          source: 'cloud'
        }
        savedAt = new Date(cloudDraft.updated_at)
      } else if (draftKey) {
        // 2) Fallback to localStorage
        try {
          const saved = localStorage.getItem(draftKey)
          if (saved) {
            const draft = JSON.parse(saved)
            if (draft.requestType || draft.details || draft.items?.length) {
              foundDraft = {
                requestType: draft.requestType,
                details: draft.details,
                items: draft.items || [],
                currentStep: draft.currentStep ?? 0,
                source: 'local'
              }
              if (draft.savedAt) savedAt = new Date(draft.savedAt)
            }
          }
        } catch (e) { console.warn('Failed to load local draft', e) }
      }

      if (foundDraft) {
        setPendingDraft(foundDraft)
        setDraftSavedAt(savedAt)
      }
      setDraftLoaded(true)
    })()
    return () => { cancelled = true }
  }, [user?.id, draftLoaded, draftKey])

  const continueDraft = () => {
    if (!pendingDraft) return
    if (pendingDraft.requestType) setRequestType(pendingDraft.requestType)
    if (pendingDraft.details) setDetails(pendingDraft.details)
    if (pendingDraft.items?.length) setItems(pendingDraft.items)
    if (typeof pendingDraft.currentStep === 'number') setCurrentStep(pendingDraft.currentStep)
    setHasDraft(true)
    setCloudSync(pendingDraft.source === 'cloud' ? 'saved' : 'idle')
    setPendingDraft(null)
  }

  const dismissDraft = async () => {
    if (draftKey) localStorage.removeItem(draftKey)
    if (user?.id) await requestDraftsService.clear(user.id)
    setPendingDraft(null)
    setDraftDismissed(true)
    setDraftSavedAt(null)
    setHasDraft(false)
  }

  // Auto-save draft on changes (debounced cloud sync + always localStorage)
  useEffect(() => {
    if (!draftLoaded || !user?.id) return
    if (pendingDraft) return // Aguarda decisao do usuario sobre o rascunho pendente
    if (!requestType && !details && items.length === 0) return

    const now = new Date()

    // 1) Always save to localStorage immediately (fast)
    if (draftKey) {
      try {
        localStorage.setItem(draftKey, JSON.stringify({
          requestType, details, items, currentStep, savedAt: now.toISOString()
        }))
      } catch (e) { console.warn('Failed to save local draft', e) }
    }

    setHasDraft(true)
    setDraftSavedAt(now)
    setCloudSync('saving')

    // 2) Debounced cloud sync (1.2s after last change)
    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current)
    }
    saveTimerRef.current = window.setTimeout(async () => {
      try {
        await requestDraftsService.save(user.id, {
          request_type: requestType,
          details,
          items,
          current_step: currentStep,
        })
        setCloudSync('saved')
      } catch (e) {
        console.warn('Cloud sync failed:', e)
        setCloudSync('offline')
      }
    }, 1200)

    return () => {
      if (saveTimerRef.current) {
        window.clearTimeout(saveTimerRef.current)
      }
    }
  }, [requestType, details, items, currentStep, draftKey, draftLoaded, user?.id])

  const clearDraft = async () => {
    if (draftKey) localStorage.removeItem(draftKey)
    if (user?.id) await requestDraftsService.clear(user.id)
    setRequestType(null)
    setDetails(null)
    setItems([])
    setCurrentStep(0)
    setHasDraft(false)
    setDraftSavedAt(null)
    setCloudSync('idle')
  }

  const canNavigateToStep = (stepIndex: number) => {
    if (stepIndex === 0) return true
    if (stepIndex === 1) return !!requestType
    if (stepIndex === 2) return !!requestType && !!details
    if (stepIndex === 3) return !!requestType && !!details && items.length > 0
    return false
  }

  const handleStepClick = (index: number) => {
    if (canNavigateToStep(index)) {
      setCurrentStep(index)
    }
  }

  const handleNext = () => {
    if (currentStep === 1) return // Let form handle submission
    if (currentStep === 0 && !requestType) return
    if (currentStep === 2 && items.length === 0) return
    setCurrentStep(prev => Math.min(steps.length - 1, prev + 1))
  }

  const handleBack = () => {
    setCurrentStep(prev => Math.max(0, prev - 1))
  }

  const handleSubmit = async () => {
    // P7: pedido de almoxarifado após as 14h — exige confirmação de leitura
    // antes de enviar. Só interrompe uma vez (o botão do popup chama doSubmit).
    if (isOutsideServiceHours && requestType === 'warehouse') {
      setShowLateOrderDialog(true)
      return
    }
    await doSubmit()
  }

  const doSubmit = async () => {
    // Validar se há itens selecionados
    if (!items || items.length === 0) {
      setError('Nenhum item foi selecionado. Por favor, volte e adicione itens à sua solicitação.')
      return
    }

    // Check if user is authenticated
    if (!user?.id) {
      setError('Você precisa estar autenticado para criar uma solicitação')
      navigate('/login')
      return
    }

    if (!requestType || !details || !items.length) {
      setError('Dados incompletos para criar a solicitação')
      return
    }

    try {
      setLoading(true)
      setError(null)
      
      // Build patient notes if any items have patient info
      const patientItems = items.filter(i => i.patient_name)
      let notes = ''
      if (patientItems.length > 0) {
        notes = patientItems.map(i =>
          `[Dados do Paciente] Nome: ${i.patient_name} | Leito: ${i.patient_bed} | Posto: ${i.patient_ward} | Enfermeira: ${i.nurse_name}`
        ).join('\n')
      }

      const request = await requestService.create({
        type: requestType,
        priority: details.priority,
        department: details.requesting_department || details.department,
        destination_department: details.destination_department,
        justification: details.justification_option,
        notes: notes || undefined,
        created_by: user.id,
        items: items.map(item => ({
          item_id: item.id,
          quantity: item.quantity
        }))
      })

      if (request) {
        _setCreatedRequest(request)

        // Clear draft after successful submission (cloud + local)
        if (draftKey) localStorage.removeItem(draftKey)
        if (user?.id) await requestDraftsService.clear(user.id)

        navigate('/requests', {
          state: {
            message: 'Solicitação criada com sucesso!',
            type: 'success'
          }
        })
      }
    } catch (error) {
      console.error('Error submitting request:', error)
      setError('Erro ao criar solicitação. Por favor, tente novamente.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="max-w-5xl mx-auto space-y-8">
      {/* Aviso do Inventário Rotativo do Almoxarifado — só p/ pedido de almox */}
      <InventoryNoticeAlmox active={requestType === 'warehouse'} />

      {/* Pending Draft Banner - aguarda decisao do usuario */}
      {pendingDraft && draftSavedAt && !draftDismissed && (
        <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg space-y-3">
          <div className="flex items-start gap-3">
            <Cloud className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="font-medium text-blue-900">Você tem um rascunho não enviado</p>
              <p className="text-sm text-blue-700 mt-1">
                Salvo {pendingDraft.source === 'cloud' ? 'na nuvem' : 'no navegador'} em{' '}
                <strong>{draftSavedAt.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</strong>
              </p>
              {pendingDraft.requestType && (
                <p className="text-xs text-blue-600 mt-1">
                  Tipo: <strong>{pendingDraft.requestType === 'pharmacy' ? 'Farmácia' : 'Almoxarifado'}</strong>
                  {pendingDraft.items?.length ? ` · ${pendingDraft.items.length} item(s) adicionado(s)` : ''}
                </p>
              )}
            </div>
          </div>
          <div className="flex gap-2 ml-8">
            <Button
              size="sm"
              onClick={continueDraft}
              className="bg-blue-600 hover:bg-blue-700 text-white"
            >
              Continuar editando
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                if (confirm('Descartar este rascunho? Esta ação não pode ser desfeita.')) {
                  dismissDraft()
                }
              }}
              className="text-red-600 border-red-200 hover:bg-red-50"
            >
              Descartar e começar do zero
            </Button>
          </div>
        </div>
      )}

      {/* Draft indicator (durante edicao) */}
      {!pendingDraft && hasDraft && draftSavedAt && (
        <div className="flex items-center justify-between gap-3 p-3 bg-emerald-50 border border-emerald-200 rounded-lg">
          <div className="flex items-center gap-2 text-sm text-emerald-800">
            {cloudSync === 'saving' && (
              <>
                <Cloud className="w-4 h-4 animate-pulse" />
                <span>Salvando rascunho na nuvem...</span>
              </>
            )}
            {cloudSync === 'saved' && (
              <>
                <Cloud className="w-4 h-4" />
                <span>
                  Rascunho salvo na nuvem às <strong>{draftSavedAt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</strong>
                </span>
              </>
            )}
            {cloudSync === 'offline' && (
              <>
                <CloudOff className="w-4 h-4 text-amber-600" />
                <span className="text-amber-700">
                  Salvo localmente (sem conexão com a nuvem) — última atualização <strong>{draftSavedAt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</strong>
                </span>
              </>
            )}
            {cloudSync === 'idle' && (
              <>
                <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                <span>
                  Rascunho salvo às <strong>{draftSavedAt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</strong>
                </span>
              </>
            )}
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              if (confirm('Deseja descartar o rascunho e começar uma nova solicitação?')) {
                clearDraft()
              }
            }}
            className="text-red-600 hover:bg-red-50 hover:text-red-700 h-8"
          >
            Descartar rascunho
          </Button>
        </div>
      )}

      {/* Service Hours Warning — apenas para pedidos de almoxarifado.
          Aviso ampliado (P6): mais chamativo para o solicitante não perder. */}
      {isOutsideServiceHours && requestType === 'warehouse' && (
        <div className="flex items-start gap-4 p-6 bg-amber-100 border-2 border-amber-400 rounded-xl shadow-sm">
          <Clock className="w-10 h-10 text-amber-600 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-xl font-bold text-amber-900">⚠️ Fora do horário de atendimento</p>
            <p className="text-base text-amber-800 mt-1">
              O almoxarifado atende solicitações das <strong>8h às 14h</strong>.
              Pedidos feitos <strong>após as 14h</strong> só serão entregues no{' '}
              <strong>próximo dia útil</strong>.
            </p>
          </div>
        </div>
      )}

      {/* Header */}
      <div>
        <Button
          variant="ghost"
          className="mb-6 text-primary-600 hover:text-primary-700"
          onClick={() => navigate('/requests')}
        >
          <ArrowLeft className="w-4 h-4 mr-2" />
          Voltar para Solicitações
        </Button>

        <h1 className="text-2xl font-bold text-gray-900">Nova Solicitação</h1>
        <p className="mt-2 text-gray-500">
          Siga os passos abaixo para criar uma nova solicitação de materiais ou medicamentos.
        </p>
      </div>

      {/* Recent Requests from Department */}
      {recentRequests.length > 0 && (
        <div className="rounded-xl overflow-hidden" style={{
          background: mode === 'dark' ? 'rgba(251,191,36,0.08)' : 'rgba(251,191,36,0.08)',
          border: `1px solid ${mode === 'dark' ? 'rgba(251,191,36,0.2)' : 'rgba(251,191,36,0.25)'}`,
        }}>
          <button
            onClick={() => setShowRecent(!showRecent)}
            className="w-full px-4 py-3 flex items-center justify-between"
            style={{ background: 'transparent', border: 'none', cursor: 'pointer' }}
          >
            <div className="flex items-center gap-2">
              <AlertTriangle size={16} style={{ color: '#f59e0b' }} />
              <span className="text-sm font-semibold" style={{ color: mode === 'dark' ? '#fbbf24' : '#92400e' }}>
                Seu setor tem {recentRequests.length} solicitacao(oes) em andamento
              </span>
            </div>
            <ChevronDown size={16} style={{
              color: mode === 'dark' ? '#fbbf24' : '#92400e',
              transform: showRecent ? 'rotate(180deg)' : 'rotate(0)',
              transition: 'transform 0.3s',
            }} />
          </button>
          {showRecent && (
            <div className="px-4 pb-4 space-y-2">
              {recentRequests.map((req) => (
                <div
                  key={req.id}
                  onClick={() => navigate(`/requests/${req.id}`)}
                  className="p-3 rounded-lg cursor-pointer transition-colors"
                  style={{
                    background: mode === 'dark' ? 'rgba(0,0,0,0.2)' : 'rgba(255,255,255,0.6)',
                    border: `1px solid ${mode === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)'}`,
                  }}
                >
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-bold" style={{ color: mode === 'dark' ? '#fff' : '#1a1a1a' }}>
                        #{req.request_number}
                      </span>
                      <span className="text-xs" style={{ color: mode === 'dark' ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.5)' }}>
                        <Clock size={10} className="inline mr-1" />
                        {format(new Date(req.created_at), "dd/MM/yyyy", { locale: ptBR })}
                      </span>
                      <span className="text-xs" style={{ color: mode === 'dark' ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.5)' }}>
                        {req.requester_name}
                      </span>
                    </div>
                    <span className="text-xs font-medium px-2 py-0.5 rounded-full" style={{
                      background: `${statusColors[req.status]}20`,
                      color: statusColors[req.status],
                      border: `1px solid ${statusColors[req.status]}40`,
                    }}>
                      {statusLabels[req.status] || req.status}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {req.items.slice(0, 4).map((item: any, i: number) => (
                      <span key={i} className="text-xs px-2 py-0.5 rounded" style={{
                        background: mode === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)',
                        color: mode === 'dark' ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.6)',
                      }}>
                        {item.name} x{item.quantity}
                      </span>
                    ))}
                    {req.items.length > 4 && (
                      <span className="text-xs" style={{ color: mode === 'dark' ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.4)' }}>
                        +{req.items.length - 4} mais
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Progress Steps */}
      <div className="relative">
        <div className="absolute top-5 left-1 right-1 h-0.5 bg-gray-200">
          <div 
            className="h-full bg-primary-500 transition-all duration-300"
            style={{ width: `${(currentStep / (steps.length - 1)) * 100}%` }}
          />
        </div>
        <div className="relative grid grid-cols-4 gap-4">
          {steps.map((step, index) => (
            <button
              key={step.id}
              onClick={() => handleStepClick(index)}
              disabled={!canNavigateToStep(index)}
              className={`text-center focus:outline-none transition-colors ${
                !canNavigateToStep(index) 
                  ? 'cursor-not-allowed opacity-50' 
                  : 'hover:opacity-80'
              } ${
                index <= currentStep ? 'text-primary-600' : 'text-gray-400'
              }`}
            >
              <div className="flex items-center justify-center mb-2">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center border-2 transition-colors ${
                  index <= currentStep 
                    ? 'border-primary-500 bg-primary-50' 
                    : 'border-gray-200 bg-white'
                }`}>
                  {index + 1}
                </div>
              </div>
              <h3 className="text-sm font-medium">{step.title}</h3>
              <p className="text-xs mt-1">{step.description}</p>
            </button>
          ))}
        </div>
      </div>

      {/* Error Message */}
      {error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
          <div className="flex items-center gap-2 text-red-600">
            <AlertCircle className="w-5 h-5" />
            <p className="font-medium">{error}</p>
          </div>
        </div>
      )}

      {/* Content */}
      <div className="mt-12">
        {currentStep === 0 && (
          <div className="space-y-6">
            <RequestTypeStep
              type={requestType}
              onTypeSelect={setRequestType}
            />
            <div className="flex justify-center gap-4">
              <Button
                onClick={handleNext}
                disabled={!requestType}
                className="bg-primary-500 hover:bg-primary-600 text-white w-full max-w-md"
              >
                Próximo
                <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </div>
          </div>
        )}

        {currentStep === 1 && requestType && (
          <div className="space-y-6">
            <RequestDetails
              onSubmit={(data) => {
                setDetails(data)
                setCurrentStep(prev => prev + 1)
              }}
              defaultValues={details || undefined}
              requestType={requestType}
            />
            <div className="flex justify-center gap-4">
              <Button
                variant="outline"
                onClick={handleBack}
                className="w-full max-w-[200px]"
              >
                <ArrowLeft className="w-4 h-4 mr-2" />
                Voltar
              </Button>
            </div>
          </div>
        )}

        {currentStep === 2 && requestType && details && (
          <div className="space-y-6">
            <RequestItems
              type={requestType}
              onSubmit={(selectedItems) => {
                setItems(selectedItems)
                setCurrentStep(prev => prev + 1)
              }}
              defaultValues={items}
            />
            <div className="flex justify-center gap-4">
              <Button
                variant="outline"
                onClick={handleBack}
                className="w-full max-w-[200px]"
              >
                <ArrowLeft className="w-4 h-4 mr-2" />
                Voltar
              </Button>
              <Button
                onClick={handleNext}
                disabled={items.length === 0}
                className="bg-primary-500 hover:bg-primary-600 text-white w-full max-w-md"
              >
                Próximo
                <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </div>
          </div>
        )}

        {currentStep === 3 && requestType && details && items.length > 0 && (
          <div className="space-y-6">
            <RequestReview
              type={requestType}
              details={details}
              items={items}
              onSubmit={handleSubmit}
              loading={loading}
              onEdit={setCurrentStep}
            />
            <div className="flex justify-center gap-4">
              <Button
                variant="outline"
                onClick={handleBack}
                className="w-full max-w-[200px]"
              >
                <ArrowLeft className="w-4 h-4 mr-2" />
                Voltar
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* P7: popup de confirmação para pedido de almoxarifado após as 14h */}
      <Dialog open={showLateOrderDialog} onOpenChange={setShowLateOrderDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-amber-700">
              <Clock className="w-6 h-6" />
              Pedido após as 14h
            </DialogTitle>
          </DialogHeader>
          <div className="py-2 space-y-3">
            <div className="p-4 rounded-lg bg-amber-50 border-2 border-amber-300">
              <p className="text-base text-amber-900">
                Você está finalizando um pedido de <strong>almoxarifado</strong> após
                as <strong>14h</strong>. Ele <strong>só será atendido e entregue no
                próximo dia útil</strong>.
              </p>
            </div>
            <p className="text-sm text-gray-600">
              Clique em <strong>“Li e estou ciente”</strong> para confirmar que leu
              o aviso e enviar a solicitação.
            </p>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowLateOrderDialog(false)}
              disabled={loading}
            >
              Voltar
            </Button>
            <Button
              onClick={() => { setShowLateOrderDialog(false); doSubmit() }}
              disabled={loading}
              className="bg-amber-600 hover:bg-amber-700 text-white"
            >
              Li e estou ciente
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
