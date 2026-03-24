import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '@/contexts/auth'
import { ArrowLeft, ArrowRight, AlertCircle, AlertTriangle, ChevronDown, Clock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { RequestTypeStep } from './components/request-type'
import { RequestDetails, type RequestDetails as RequestDetailsType } from './components/request-details'
import { RequestItems, type RequestItem } from './components/request-items'
import { RequestReview } from './components/request-review'
import { requestService } from '@/lib/services/requests'
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
  const [currentStep, setCurrentStep] = useState(0)
  const [requestType, setRequestType] = useState<RequestType | null>(null)
  const [details, setDetails] = useState<RequestDetailsType | null>(null)
  const [items, setItems] = useState<RequestItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [_createdRequest, _setCreatedRequest] = useState<any>(null)
  const [recentRequests, setRecentRequests] = useState<any[]>([])
  const [showRecent, setShowRecent] = useState(false)

  useEffect(() => {
    if (user?.department_id) {
      requestService.getRecentByDepartment(user.department_id).then(setRecentRequests)
    }
  }, [user?.department_id])

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
      
      // Use the selected justification option as the justification text
      const request = await requestService.create({
        type: requestType,
        priority: details.priority,
        department: details.department,
        destination_department: details.destination_department,
        justification: details.justification_option,
        created_by: user.id,
        items: items.map(item => ({
          item_id: item.id,
          quantity: item.quantity
        }))
      })

      if (request) {
        // Store the created request if needed
        _setCreatedRequest(request)
        
        // Redirect to requests page with success message
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
    </div>
  )
}