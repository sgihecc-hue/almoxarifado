import { CheckCircle2, AlertCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { itemsService } from '@/lib/services/items'
import type { RequestDetails } from './request-details'
import type { RequestItem } from './request-items'

interface RequestReviewProps {
  type: 'pharmacy' | 'warehouse'
  details: RequestDetails
  items: RequestItem[]
  onSubmit: () => void
  onEdit: (step: number) => void
  loading?: boolean
}

// Estado para armazenar dados completos dos itens
import { useState, useEffect } from 'react'
import type { Item } from '@/lib/services/items'

// Justification options mapping
const justificationOptions = {
  'routine': 'Reposição de Rotina',
  'increased_demand': 'Aumento de Demanda',
  'new_procedure': 'Novo Procedimento',
  'critical_level': 'Nível Crítico',
  'replacement': 'Substituição',
  'special_event': 'Evento Especial',
  'emergency': 'Emergência'
}

export function RequestReview({ type, details, items, onSubmit, onEdit, loading = false }: RequestReviewProps) {
  const [itemsData, setItemsData] = useState<Record<string, Item>>({})
  const [loadingItems, setLoadingItems] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Carregar dados completos dos itens
  useEffect(() => {
    async function loadItemsData() {
      if (!items || items.length === 0) {
        console.warn('Nenhum item encontrado para carregar dados completos')
        return
      }

      try {
        setLoadingItems(true)
        setError(null)
        
        const allItems = await itemsService.getAll()
        const itemsMap: Record<string, Item> = {}
        
        allItems.forEach(item => {
          itemsMap[item.id] = item
        })
        
        setItemsData(itemsMap)
        
        // Verificar se todos os itens foram encontrados
        const missingItems = items.filter(item => !itemsMap[item.id])
        if (missingItems.length > 0) {
          console.warn('Alguns itens não foram encontrados:', missingItems)
          setError(`${missingItems.length} item(ns) não encontrado(s) no sistema`)
        }
      } catch (error) {
        console.error('Erro ao carregar dados dos itens:', error)
        setError('Erro ao carregar informações dos itens')
      } finally {
        setLoadingItems(false)
      }
    }

    loadItemsData()
  }, [items])

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'high':
        return 'text-red-600 bg-red-50 border-red-200'
      case 'medium':
        return 'text-yellow-600 bg-yellow-50 border-yellow-200'
      case 'low':
        return 'text-green-600 bg-green-50 border-green-200'
      default:
        return 'text-gray-600 bg-gray-50 border-gray-200'
    }
  }

  return (
    <div className="space-y-8">
      {/* Summary Header */}
      <div className="bg-primary-50 border border-primary-100 rounded-lg p-4 flex items-start gap-3">
        <CheckCircle2 className="w-5 h-5 text-primary-500 mt-0.5" />
        <div>
          <h3 className="font-medium text-primary-900">Revisão da Solicitação</h3>
          <p className="text-sm text-primary-700 mt-1">
            Verifique todos os detalhes da sua solicitação antes de enviar.
          </p>
        </div>
      </div>

      {/* Request Type */}
      <div className="space-y-2">
        <div className="flex justify-between items-center">
          <h3 className="font-medium text-gray-900">Tipo de Solicitação</h3>
          <Button variant="ghost" size="sm" onClick={() => onEdit(0)}>
            Editar
          </Button>
        </div>
        <div className="bg-white border rounded-lg p-4">
          <span className="font-medium">
            {type === 'pharmacy' ? 'Farmácia' : 'Almoxarifado'}
          </span>
        </div>
      </div>

      {/* Request Details */}
      <div className="space-y-2">
        <div className="flex justify-between items-center">
          <h3 className="font-medium text-gray-900">Detalhes da Solicitação</h3>
          <Button variant="ghost" size="sm" onClick={() => onEdit(1)}>
            Editar
          </Button>
        </div>
        <div className="bg-white border rounded-lg p-4 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-sm text-gray-500">Data da Solicitação</p>
              <p className="font-medium">
                {format(new Date(details.requestDate), "dd 'de' MMMM 'de' yyyy", { locale: ptBR })}
              </p>
            </div>
            <div>
              <p className="text-sm text-gray-500">Setor Solicitante</p>
              <p className="font-medium">{details.department}</p>
            </div>
          </div>
          <div>
            <p className="text-sm text-gray-500">Prioridade</p>
            <span className={`inline-block px-2 py-1 text-sm font-medium rounded-full border ${getPriorityColor(details.priority)}`}>
              {details.priority === 'high' ? 'Alta' : details.priority === 'medium' ? 'Média' : 'Baixa'}
            </span>
          </div>
          <div>
            <p className="text-sm text-gray-500">Justificativa</p>
            <p className="mt-1 font-medium">
              {justificationOptions[details.justification_option as keyof typeof justificationOptions] || details.justification_option}
            </p>
          </div>
        </div>
      </div>

      {/* Selected Items */}
      <div className="space-y-2">
        <div className="flex justify-between items-center">
          <h3 className="font-medium text-gray-900">Itens Selecionados</h3>
          <Button variant="ghost" size="sm" onClick={() => onEdit(2)}>
            Editar
          </Button>
        </div>
        <div className="bg-white border rounded-lg divide-y">
          {/* Verificar se há itens para exibir */}
          {!items || items.length === 0 ? (
            <div className="p-8 text-center">
              <AlertCircle className="w-12 h-12 text-gray-400 mx-auto mb-4" />
              <p className="text-gray-500 font-medium">Nenhum item selecionado</p>
              <p className="text-gray-400 text-sm mt-1">
                Volte para a etapa de seleção de itens para adicionar produtos
              </p>
              <Button 
                variant="outline" 
                className="mt-4"
                onClick={() => onEdit(2)}
              >
                Adicionar Itens
              </Button>
            </div>
          ) : loadingItems ? (
            <div className="p-8 text-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-500 mx-auto mb-4"></div>
              <p className="text-gray-500">Carregando informações dos itens...</p>
            </div>
          ) : error ? (
            <div className="p-8 text-center">
              <AlertCircle className="w-12 h-12 text-red-400 mx-auto mb-4" />
              <p className="text-red-600 font-medium">Erro ao carregar itens</p>
              <p className="text-red-500 text-sm mt-1">{error}</p>
              <Button 
                variant="outline" 
                className="mt-4"
                onClick={() => window.location.reload()}
              >
                Tentar Novamente
              </Button>
            </div>
          ) : (
            items.map(selectedItem => {
              const item = itemsData[selectedItem.id]
              
              if (!item) {
                return (
                  <div key={selectedItem.id} className="p-4 bg-red-50 border-l-4 border-red-400">
                    <div className="flex">
                      <AlertCircle className="w-5 h-5 text-red-400 mr-2 mt-0.5" />
                      <div>
                        <p className="font-medium text-red-800">Item não encontrado</p>
                        <p className="text-red-600 text-sm">
                          ID: {selectedItem.id} | Quantidade: {selectedItem.quantity}
                        </p>
                        <p className="text-red-500 text-xs mt-1">
                          Este item pode ter sido removido do sistema ou há um erro na seleção.
                        </p>
                      </div>
                    </div>
                  </div>
                )
              }

              return (
                <div key={item.id} className="p-4 hover:bg-gray-50 transition-colors">
                  <div className="flex justify-between items-start">
                    <div className="flex-1">
                      <p className="font-medium text-gray-900">{item.name}</p>
                      <p className="text-sm text-gray-500 mt-1">
                        <span className="font-mono bg-gray-100 px-2 py-1 rounded text-xs mr-2">{item.code}</span>
                        <span>{item.category}</span>
                        <span className="mx-2">•</span>
                        <span>{item.unit}</span>
                      </p>
                      {item.description && (
                        <p className="text-xs text-gray-400 mt-1">{item.description}</p>
                      )}
                    </div>
                    <div className="text-right ml-4">
                      <p className="font-semibold text-lg text-primary-600">
                        {selectedItem.quantity} {item.unit}
                      </p>
                      <p className="text-sm text-gray-500">Quantidade</p>
                    </div>
                  </div>
                </div>
              )
            })
          )}
        </div>
      </div>

      {/* Warning */}
      <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 flex items-start gap-3">
        <AlertCircle className="w-5 h-5 text-yellow-500 mt-0.5" />
        <div>
          <h3 className="font-medium text-yellow-900">Importante</h3>
          <p className="text-sm text-yellow-700 mt-1">
            Após o envio, sua solicitação será analisada pela equipe responsável.
            Você receberá notificações sobre o status do seu pedido.
          </p>
        </div>
      </div>

      {/* Submit Button */}
      <Button
        className="w-full bg-primary-500 hover:bg-primary-600"
        onClick={onSubmit}
        disabled={loading}
      >
        {loading ? 'Enviando...' : 'Enviar Solicitação'}
      </Button>
    </div>
  )
}