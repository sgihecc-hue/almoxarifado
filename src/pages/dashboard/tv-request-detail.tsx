import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  ArrowLeft,
  Pill,
  Package2,
  Truck,
  CheckCircle2,
  Loader2,
  AlertCircle,
  Search,
  User,
  Building2,
  Hash,
  Check
} from 'lucide-react'
import { tvRequestService } from '@/lib/services/tv-requests'
import { employeesService } from '@/lib/services/employees'
import { RequestStatusBadge } from '@/components/request-status-badge'
import { formatRequestNumber } from '@/lib/utils/request'
import type { TVRequest, SuppliedItemData } from '@/lib/services/tv-requests'
import type { Employee } from '@/lib/types/employees'

const OBSERVATION_OPTIONS = [
  '',
  'Opção 1',
  'Opção 2',
  'Opção 3'
]

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
  const theme = themes[type]
  const Icon = theme.icon

  const [request, setRequest] = useState<TVRequest | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Item form state
  const [suppliedItems, setSuppliedItems] = useState<Map<string, SuppliedItemData>>(new Map())

  // Workflow state: 1 = fill items, 2 = enter matricula, 3 = done
  const [workflowStep, setWorkflowStep] = useState<1 | 2 | 3>(1)
  const [isSubmitting, setIsSubmitting] = useState(false)

  // Employee state
  const [matriculaInput, setMatriculaInput] = useState('')
  const [employee, setEmployee] = useState<Employee | null>(null)
  const [searchingEmployee, setSearchingEmployee] = useState(false)
  const [employeeError, setEmployeeError] = useState<string | null>(null)

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

      // Initialize supplied items form state
      const itemsMap = new Map<string, SuppliedItemData>()
      data.items.forEach(item => {
        itemsMap.set(item.id, {
          id: item.id,
          supplied_quantity: item.supplied_quantity ?? item.approved_quantity ?? item.quantity,
          observation: item.observation || '',
          is_checked: item.is_checked || false
        })
      })
      setSuppliedItems(itemsMap)

      // Set workflow step based on current status
      if (data.status === 'delivered') {
        setWorkflowStep(2)
      } else if (data.status === 'completed') {
        setWorkflowStep(3)
      }
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

  // Update a single item field
  const updateItem = (itemId: string, field: keyof SuppliedItemData, value: any) => {
    setSuppliedItems(prev => {
      const newMap = new Map(prev)
      const current = newMap.get(itemId)
      if (current) {
        newMap.set(itemId, { ...current, [field]: value })
      }
      return newMap
    })
  }

  // Handle "Saiu para entrega"
  const handleMarkAsDelivered = async () => {
    if (!request) return
    setIsSubmitting(true)
    try {
      const items = Array.from(suppliedItems.values())
      const success = await tvRequestService.markAsDelivered(request.id, items)
      if (success) {
        setWorkflowStep(2)
        // Reload to get updated status
        await loadRequest()
      } else {
        setError('Erro ao marcar como entregue. Tente novamente.')
      }
    } catch (err) {
      console.error('Error marking as delivered:', err)
      setError('Erro ao processar. Tente novamente.')
    } finally {
      setIsSubmitting(false)
    }
  }

  // Search employee by matricula
  const handleSearchEmployee = async () => {
    if (!matriculaInput.trim()) return
    setSearchingEmployee(true)
    setEmployeeError(null)
    setEmployee(null)
    try {
      const emp = await employeesService.getByMatricula(matriculaInput.trim())
      if (emp) {
        setEmployee(emp)
      } else {
        setEmployeeError('Funcionário não encontrado com esta matrícula')
      }
    } catch (err) {
      setEmployeeError('Erro ao buscar funcionário')
    } finally {
      setSearchingEmployee(false)
    }
  }

  // Handle "Solicitação Concluída"
  const handleComplete = async () => {
    if (!request || !employee) return
    setIsSubmitting(true)
    try {
      const success = await tvRequestService.completeRequest(
        request.id,
        employee.matricula,
        employee.id
      )
      if (success) {
        setWorkflowStep(3)
        // Navigate back after a short delay
        setTimeout(() => {
          navigate(`/tv/${type}`)
        }, 2000)
      } else {
        setError('Erro ao concluir solicitação. Tente novamente.')
      }
    } catch (err) {
      console.error('Error completing request:', err)
      setError('Erro ao processar. Tente novamente.')
    } finally {
      setIsSubmitting(false)
    }
  }

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
              onClick={() => navigate(`/tv/${type}`)}
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
              const itemData = suppliedItems.get(item.id)
              const isEditable = workflowStep === 1 && ['approved', 'processing'].includes(request.status)

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
                      {isEditable ? (
                        <input
                          type="number"
                          min={0}
                          max={item.item_current_stock}
                          value={itemData?.supplied_quantity ?? 0}
                          onChange={(e) => updateItem(item.id, 'supplied_quantity', Math.max(0, parseInt(e.target.value) || 0))}
                          className="w-20 mx-auto bg-gray-700 border border-gray-600 rounded px-2 py-1 text-center text-white text-sm focus:border-blue-500 focus:outline-none"
                        />
                      ) : (
                        <span className="text-sm text-white">{itemData?.supplied_quantity ?? '-'}</span>
                      )}
                    </div>

                    {/* Observation (dropdown) */}
                    <div className="col-span-3 text-center">
                      {isEditable ? (
                        <select
                          value={itemData?.observation || ''}
                          onChange={(e) => updateItem(item.id, 'observation', e.target.value)}
                          className="w-full bg-gray-700 border border-gray-600 rounded px-2 py-1 text-white text-sm focus:border-blue-500 focus:outline-none"
                        >
                          {OBSERVATION_OPTIONS.map(opt => (
                            <option key={opt} value={opt}>
                              {opt || '-- Selecione --'}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span className="text-sm text-gray-300">{itemData?.observation || '-'}</span>
                      )}
                    </div>

                    {/* Checkbox */}
                    <div className="col-span-1 text-center">
                      {isEditable ? (
                        <input
                          type="checkbox"
                          checked={itemData?.is_checked || false}
                          onChange={(e) => updateItem(item.id, 'is_checked', e.target.checked)}
                          className="w-5 h-5 rounded bg-gray-700 border-gray-600 text-green-500 focus:ring-green-500 focus:ring-offset-gray-800 cursor-pointer"
                        />
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

        {/* ============================================ */}
        {/* WORKFLOW ACTIONS */}
        {/* ============================================ */}

        {/* Step 1: "Saiu para entrega" button */}
        {workflowStep === 1 && ['approved', 'processing'].includes(request.status) && (
          <div className="mt-6 flex justify-center">
            <button
              onClick={handleMarkAsDelivered}
              disabled={isSubmitting}
              className={`flex items-center gap-3 px-8 py-4 rounded-xl text-lg font-semibold transition-all
                bg-orange-700 hover:bg-orange-600 text-white shadow-lg hover:shadow-xl
                disabled:opacity-50 disabled:cursor-not-allowed`}
            >
              {isSubmitting ? (
                <Loader2 className="w-6 h-6 animate-spin" />
              ) : (
                <Truck className="w-6 h-6" />
              )}
              Saiu para Entrega
            </button>
          </div>
        )}

        {/* Step 2: Employee matricula input (appears after delivery) */}
        {workflowStep === 2 && (
          <div className="mt-6 bg-gray-800 rounded-xl border border-gray-700 p-6">
            <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
              <User className="w-5 h-5 text-gray-400" />
              Confirmação de Recebimento
            </h3>

            <div className="flex items-center gap-3 mb-4">
              <div className="flex-1 max-w-xs">
                <label className="block text-sm text-gray-400 mb-1">Matrícula do Funcionário</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={matriculaInput}
                    onChange={(e) => {
                      setMatriculaInput(e.target.value)
                      setEmployee(null)
                      setEmployeeError(null)
                    }}
                    onKeyDown={(e) => e.key === 'Enter' && handleSearchEmployee()}
                    placeholder="Digite a matrícula..."
                    className="flex-1 bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none"
                  />
                  <button
                    onClick={handleSearchEmployee}
                    disabled={searchingEmployee || !matriculaInput.trim()}
                    className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg transition-colors disabled:opacity-50"
                  >
                    {searchingEmployee ? (
                      <Loader2 className="w-5 h-5 animate-spin" />
                    ) : (
                      <Search className="w-5 h-5" />
                    )}
                  </button>
                </div>
              </div>
            </div>

            {/* Employee error */}
            {employeeError && (
              <div className="mb-4 p-3 bg-red-900/30 border border-red-700 rounded-lg text-red-300 text-sm">
                {employeeError}
              </div>
            )}

            {/* Employee info card */}
            {employee && (
              <div className="mb-6 p-4 bg-green-900/20 border border-green-700 rounded-lg">
                <div className="flex items-center gap-3 mb-2">
                  <CheckCircle2 className="w-5 h-5 text-green-400" />
                  <span className="text-green-300 font-medium">Funcionário encontrado</span>
                </div>
                <div className="grid grid-cols-3 gap-4 text-sm">
                  <div>
                    <span className="text-gray-400">Nome:</span>
                    <p className="text-white font-medium">{employee.full_name}</p>
                  </div>
                  <div>
                    <span className="text-gray-400">Matrícula:</span>
                    <p className="text-white font-medium">{employee.matricula}</p>
                  </div>
                  <div>
                    <span className="text-gray-400">Cargo:</span>
                    <p className="text-white font-medium">{employee.cargo || '-'}</p>
                  </div>
                </div>
              </div>
            )}

            {/* Complete button */}
            {employee && (
              <div className="flex justify-center">
                <button
                  onClick={handleComplete}
                  disabled={isSubmitting}
                  className="flex items-center gap-3 px-8 py-4 rounded-xl text-lg font-semibold transition-all
                    bg-emerald-700 hover:bg-emerald-600 text-white shadow-lg hover:shadow-xl
                    disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isSubmitting ? (
                    <Loader2 className="w-6 h-6 animate-spin" />
                  ) : (
                    <CheckCircle2 className="w-6 h-6" />
                  )}
                  Solicitação Concluída
                </button>
              </div>
            )}
          </div>
        )}

        {/* Step 3: Success message */}
        {workflowStep === 3 && (
          <div className="mt-6 p-6 bg-emerald-900/20 border border-emerald-700 rounded-xl text-center">
            <CheckCircle2 className="w-12 h-12 text-emerald-400 mx-auto mb-3" />
            <h3 className="text-xl font-bold text-emerald-300 mb-2">Solicitação Concluída!</h3>
            <p className="text-gray-400">Redirecionando ao painel...</p>
          </div>
        )}
      </div>
    </div>
  )
}

export default TVRequestDetail
