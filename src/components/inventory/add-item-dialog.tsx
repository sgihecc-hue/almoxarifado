import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Loader2 } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { itemsService } from '@/lib/services/items'
import type { ItemCategory, UnitType } from '@/lib/services/items'

const itemSchema = z.object({
  code: z.string().min(1, 'Codigo e obrigatorio'),
  name: z.string().min(3, 'Nome deve ter no minimo 3 caracteres'),
  description: z.string().optional(),
  category: z.string(),
  unit: z.string(),
  min_stock: z.number().min(0, 'Estoque minimo deve ser maior ou igual a 0'),
})

type ItemFormData = z.infer<typeof itemSchema>

interface AddItemDialogProps {
  type: 'pharmacy' | 'warehouse'
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess: () => void
}

const unitOptions = [
  { value: 'Un', label: 'Unidade (Un)' },
  { value: 'Pc', label: 'Peca (Pc)' },
  { value: 'Cx', label: 'Caixa (Cx)' },
  { value: 'Fr', label: 'Frasco (Fr)' },
  { value: 'Amp', label: 'Ampola (Amp)' },
  { value: 'Tb', label: 'Tubo (Tb)' },
  { value: 'Rl', label: 'Rolo (Rl)' },
  { value: 'Lt', label: 'Litro (Lt)' },
  { value: 'Kg', label: 'Quilograma (Kg)' },
  { value: 'Gl', label: 'Galao (Gl)' },
  { value: 'ml', label: 'Mililitro (ml)' },
  { value: 'g', label: 'Grama (g)' },
  { value: 'Pr', label: 'Par (Pr)' },
  { value: 'Cj', label: 'Conjunto (Cj)' },
  { value: 'Sc', label: 'Saco (Sc)' },
  { value: 'Rm', label: 'Resma (Rm)' },
  { value: 'Ct', label: 'Cento (Ct)' },
  { value: 'FL', label: 'Folha (FL)' },
]

export function AddItemDialog({ type, open, onOpenChange, onSuccess }: AddItemDialogProps) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const { register, handleSubmit, formState: { errors }, reset } = useForm<ItemFormData>({
    resolver: zodResolver(itemSchema),
    defaultValues: {
      category: type === 'pharmacy' ? 'Medicamentos' : 'Material de Escritorio',
      unit: 'Un',
      min_stock: 0,
    }
  })

  const onSubmit = async (data: ItemFormData) => {
    try {
      setLoading(true)
      setError(null)

      await itemsService.create({
        code: data.code,
        name: data.name,
        description: data.description,
        category: data.category as ItemCategory,
        unit: data.unit as UnitType,
        min_stock: data.min_stock,
        current_stock: 0,
        price: 0,
      })

      reset()
      onSuccess()
      onOpenChange(false)
    } catch (error: any) {
      console.error('Error creating item:', error)
      const errorMessage = error?.message || 'Erro ao criar item. Por favor, tente novamente.'
      setError(errorMessage)
    } finally {
      setLoading(false)
    }
  }

  const getCategoryOptions = () => {
    if (type === 'pharmacy') {
      return [
        { value: 'Medicamentos', label: 'Medicamentos' },
        { value: 'Material Hospitalar', label: 'Material Hospitalar' }
      ]
    } else {
      return [
        { value: 'Material de Escritorio', label: 'Material de Escritorio' },
        { value: 'Material de Limpeza', label: 'Material de Limpeza' },
        { value: 'Equipamentos', label: 'Equipamentos' },
        { value: 'Outros', label: 'Outros' }
      ]
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Novo Item</DialogTitle>
          <p className="text-sm text-gray-500 mt-1">
            Cadastre as informacoes basicas do item. Para adicionar estoque, use a opcao "Adicionar Estoque" na pagina do item.
          </p>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="code">Codigo *</Label>
              <Input
                id="code"
                {...register('code')}
                className="mt-1"
                placeholder="Ex: MED-001"
              />
              {errors.code && (
                <p className="text-sm text-red-500 mt-1">{errors.code.message}</p>
              )}
            </div>

            <div>
              <Label htmlFor="category">Categoria *</Label>
              <select
                id="category"
                {...register('category')}
                className="w-full mt-1 h-9 rounded-md border border-input px-3 py-1 bg-white"
              >
                {getCategoryOptions().map(option => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              {errors.category && (
                <p className="text-sm text-red-500 mt-1">{errors.category.message}</p>
              )}
            </div>
          </div>

          <div>
            <Label htmlFor="name">Nome *</Label>
            <Input
              id="name"
              {...register('name')}
              className="mt-1"
              placeholder="Digite o nome do item"
            />
            {errors.name && (
              <p className="text-sm text-red-500 mt-1">{errors.name.message}</p>
            )}
          </div>

          <div>
            <Label htmlFor="description">Descricao</Label>
            <textarea
              id="description"
              {...register('description')}
              className="w-full mt-1 rounded-md border border-input px-3 py-2 min-h-[80px] bg-white"
              placeholder="Digite uma descricao para o item (opcional)"
            />
            {errors.description && (
              <p className="text-sm text-red-500 mt-1">{errors.description.message}</p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="unit">Unidade de Fornecimento *</Label>
              <select
                id="unit"
                {...register('unit')}
                className="w-full mt-1 h-9 rounded-md border border-input px-3 py-1 bg-white"
              >
                {unitOptions.map(option => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              {errors.unit && (
                <p className="text-sm text-red-500 mt-1">{errors.unit.message}</p>
              )}
            </div>

            <div>
              <Label htmlFor="min_stock">Estoque Minimo *</Label>
              <Input
                id="min_stock"
                type="number"
                min="0"
                {...register('min_stock', { valueAsNumber: true })}
                className="mt-1"
                placeholder="0"
              />
              {errors.min_stock && (
                <p className="text-sm text-red-500 mt-1">{errors.min_stock.message}</p>
              )}
            </div>
          </div>

          {error && (
            <div className="p-3 text-sm text-red-500 bg-red-50 rounded-md border border-red-200">
              {error}
            </div>
          )}

          <DialogFooter className="pt-4">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={loading}>
              {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Criar Item
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
