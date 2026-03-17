import { useState, useEffect } from 'react'
import { Search, Plus, Minus, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { itemsService } from '@/lib/services/items'
import type { Item } from '@/lib/services/items'
import { supabase } from '@/lib/supabase'
import { z } from 'zod'

const itemSchema = z.object({
  id: z.string().uuid('ID inválido'),
  quantity: z.number().min(1, 'Quantidade deve ser maior que 0'),
})

export type RequestItem = z.infer<typeof itemSchema>

interface RequestItemsProps {
  type: 'pharmacy' | 'warehouse'
  onSubmit: (items: RequestItem[]) => void
  defaultValues?: RequestItem[]
}

export function RequestItems({ type, onSubmit, defaultValues = [] }: RequestItemsProps) {
  const [items, setItems] = useState<Item[]>([])
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedItems, setSelectedItems] = useState<RequestItem[]>(defaultValues)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    loadItems()
  }, [])

  async function loadItems() {
    try {
      setLoading(true)
      const table = type === 'pharmacy' ? 'pharmacy_items' : 'warehouse_items'
      const { data, error } = await supabase
        .from(table)
        .select('*')
        .eq('is_active', true)
        .order('name')
      if (error) throw error
      setItems(data || [])
    } catch (error) {
      console.error('Error loading items:', error)
    } finally {
      setLoading(false)
    }
  }

  // Filter items based on search term
  const filteredItems = items.filter(item => {
    return searchTerm === '' ||
      item.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (item.code && item.code.toLowerCase().includes(searchTerm.toLowerCase()))
  })

  const handleAddItem = (item: Item) => {
    if (!selectedItems.some(i => i.id === item.id)) {
      setSelectedItems([...selectedItems, { id: item.id, quantity: 1 }])
    }
  }

  const handleRemoveItem = (itemId: string) => {
    setSelectedItems(selectedItems.filter(item => item.id !== itemId))
  }

  const handleQuantityChange = (itemId: string, quantity: number) => {
    setSelectedItems(selectedItems.map(item => 
      item.id === itemId ? { ...item, quantity } : item
    ))
  }

  const handleSubmit = async () => {
    try {
      setSubmitting(true)
      
      // Validação crítica antes de enviar
      if (selectedItems.length === 0) {
        alert('Por favor, selecione pelo menos um item antes de continuar.')
        return
      }
      
      // Validar se todas as quantidades são válidas
      const invalidItems = selectedItems.filter(item => item.quantity <= 0)
      if (invalidItems.length > 0) {
        alert('Todos os itens devem ter quantidade maior que zero.')
        return
      }
      
      await onSubmit(selectedItems)
    } catch (error) {
      console.error('Error submitting items:', error)
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <Loader2 className="w-8 h-8 text-primary-500 animate-spin mx-auto mb-4" />
          <p className="text-gray-500">Carregando itens...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Search Items */}
      <div className="space-y-2">
        <Label>Buscar Itens</Label>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
          <Input
            placeholder="Digite o nome ou código do item..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-9"
          />
        </div>
      </div>

      {/* Available Items */}
      <div className="space-y-2">
        <Label>Itens Disponíveis</Label>
        <div className="border rounded-lg divide-y max-h-[300px] overflow-y-auto">
          {filteredItems.map(item => (
            <div key={item.id} className="p-4 flex items-center justify-between hover:bg-gray-50">
              <div>
                <p className="font-medium">{item.name}</p>
                <p className="text-sm text-gray-500">
                  {item.code} • {item.category} • {item.unit}
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => handleAddItem(item)}
                disabled={selectedItems.some(i => i.id === item.id)}
              >
                <Plus className="w-4 h-4 mr-2" />
                Adicionar
              </Button>
            </div>
          ))}
          {filteredItems.length === 0 && (
            <div className="p-4 text-center text-gray-500">
              Nenhum item encontrado
            </div>
          )}
        </div>
      </div>

      {/* Selected Items */}
      <div className="space-y-2">
        <Label>Itens Selecionados</Label>
        <div className="border rounded-lg divide-y">
          {selectedItems.map(selectedItem => {
            const item = items.find(i => i.id === selectedItem.id)
            if (!item) return null

            return (
              <div key={item.id} className="p-4 flex items-center justify-between">
                <div>
                  <p className="font-medium">{item.name}</p>
                  <p className="text-sm text-gray-500">
                    {item.code} • {item.category} • {item.unit}
                  </p>
                </div>
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => handleQuantityChange(
                        item.id,
                        Math.max(1, selectedItem.quantity - 1)
                      )}
                    >
                      <Minus className="w-4 h-4" />
                    </Button>
                    <Input
                      type="number"
                      min="1"
                      value={selectedItem.quantity}
                      onChange={(e) => handleQuantityChange(
                        item.id,
                        Math.max(1, parseInt(e.target.value) || 1)
                      )}
                      className="w-20 text-center"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => handleQuantityChange(
                        item.id,
                        selectedItem.quantity + 1
                      )}
                    >
                      <Plus className="w-4 h-4" />
                    </Button>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="text-red-500 hover:text-red-600"
                    onClick={() => handleRemoveItem(item.id)}
                  >
                    Remover
                  </Button>
                </div>
              </div>
            )
          })}
          {selectedItems.length === 0 && (
            <div className="p-8 text-center text-gray-500">
              Nenhum item selecionado
            </div>
          )}
        </div>
      </div>

      <Button
        type="button"
        className="w-full"
        disabled={selectedItems.length === 0 || submitting}
        onClick={handleSubmit}
      >
        {submitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
        Confirmar Seleção
      </Button>
    </div>
  )
}