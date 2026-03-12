import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Loader2, Package2, FileText, Building2, Calendar } from 'lucide-react'
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
import { supabase } from '@/lib/supabase'
import type { Item } from '@/lib/services/items'

const stockEntrySchema = z.object({
  quantity: z.number().min(1, 'Quantidade deve ser maior que 0'),
  invoice_number: z.string().min(1, 'Numero da nota fiscal e obrigatorio'),
  invoice_date: z.string().min(1, 'Data de emissao e obrigatoria'),
  invoice_total_value: z.number().min(0, 'Valor total deve ser maior ou igual a 0'),
  expiry_date: z.string().optional(),
  afm_number: z.string().min(1, 'Numero da AFM e obrigatorio'),
  supplier_cnpj: z.string().min(1, 'CNPJ do fornecedor e obrigatorio'),
  supplier_name: z.string().min(1, 'Nome do fornecedor e obrigatorio'),
  unit_price: z.number().min(0, 'Valor unitario deve ser maior ou igual a 0'),
  batch_number: z.string().optional(),
  delivery_date: z.string().optional(),
  notes: z.string().optional(),
})

type StockEntryFormData = z.infer<typeof stockEntrySchema>

interface AddStockDialogProps {
  item: Item
  type: 'pharmacy' | 'warehouse'
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess: () => void
}

export function AddStockDialog({ item, type, open, onOpenChange, onSuccess }: AddStockDialogProps) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const today = new Date().toISOString().split('T')[0]
  const defaultExpiry = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]

  const { register, handleSubmit, formState: { errors }, reset, watch } = useForm<StockEntryFormData>({
    resolver: zodResolver(stockEntrySchema),
    defaultValues: {
      quantity: 1,
      invoice_number: '',
      invoice_date: today,
      invoice_total_value: 0,
      expiry_date: defaultExpiry,
      afm_number: '',
      supplier_cnpj: '',
      supplier_name: '',
      unit_price: 0,
      batch_number: '',
      delivery_date: today,
      notes: '',
    }
  })

  const quantity = watch('quantity')
  const unitPrice = watch('unit_price')
  const totalValue = (quantity || 0) * (unitPrice || 0)

  const onSubmit = async (data: StockEntryFormData) => {
    try {
      setLoading(true)
      setError(null)

      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Usuario nao autenticado')

      const tableName = type === 'pharmacy' ? 'pharmacy_items' : 'warehouse_items'

      const { error: entryError } = await supabase
        .from('stock_entries')
        .insert({
          item_id: item.id,
          item_type: type,
          quantity: data.quantity,
          invoice_number: data.invoice_number,
          invoice_date: data.invoice_date,
          invoice_total_value: data.invoice_total_value,
          expiry_date: data.expiry_date || null,
          afm_number: data.afm_number,
          supplier_cnpj: data.supplier_cnpj,
          supplier_name: data.supplier_name,
          unit_price: data.unit_price,
          batch_number: data.batch_number || null,
          delivery_date: data.delivery_date || null,
          notes: data.notes || null,
          created_by: user.id,
        })

      if (entryError) {
        console.error('Error creating stock entry:', entryError)
        throw entryError
      }

      const newStock = item.current_stock + data.quantity

      const { error: updateError } = await supabase
        .from(tableName)
        .update({
          current_stock: newStock,
          updated_at: new Date().toISOString(),
        })
        .eq('id', item.id)

      if (updateError) {
        console.error('Error updating item stock:', updateError)
        throw updateError
      }

      if (data.expiry_date && data.batch_number) {
        await supabase
          .from('expiry_tracking')
          .insert({
            item_id: item.id,
            batch_number: data.batch_number,
            expiry_date: data.expiry_date,
            initial_quantity: data.quantity,
            current_quantity: data.quantity,
            created_by: user.id,
            invoice_number: data.invoice_number,
            invoice_date: data.invoice_date,
            delivery_date: data.delivery_date,
            afm_number: data.afm_number,
            supplier_cnpj: data.supplier_cnpj,
            supplier_name: data.supplier_name,
            invoice_total_value: data.invoice_total_value,
          })
      }

      reset()
      onSuccess()
      onOpenChange(false)
    } catch (error: any) {
      console.error('Error adding stock:', error)
      setError(error?.message || 'Erro ao adicionar estoque. Por favor, tente novamente.')
    } finally {
      setLoading(false)
    }
  }

  const formatCNPJ = (value: string) => {
    const numbers = value.replace(/\D/g, '')
    if (numbers.length <= 14) {
      return numbers
        .replace(/(\d{2})(\d)/, '$1.$2')
        .replace(/(\d{3})(\d)/, '$1.$2')
        .replace(/(\d{3})(\d)/, '$1/$2')
        .replace(/(\d{4})(\d)/, '$1-$2')
    }
    return value
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[700px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Package2 className="w-5 h-5 text-primary-600" />
            Adicionar Estoque
          </DialogTitle>
          <div className="mt-2 p-3 bg-gray-50 rounded-lg">
            <p className="text-sm text-gray-600">
              <span className="font-medium">Item:</span> {item.name}
            </p>
            <p className="text-sm text-gray-600">
              <span className="font-medium">Codigo:</span> {item.code}
            </p>
            <p className="text-sm text-gray-600">
              <span className="font-medium">UF:</span> {item.unit}
            </p>
            <p className="text-sm text-gray-600">
              <span className="font-medium">Estoque atual:</span> {item.current_stock} {item.unit}
            </p>
          </div>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-sm font-medium text-gray-700 border-b pb-2">
              <FileText className="w-4 h-4" />
              Dados da Nota Fiscal
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="invoice_number">Numero da Nota Fiscal *</Label>
                <Input
                  id="invoice_number"
                  {...register('invoice_number')}
                  className="mt-1"
                  placeholder="Ex: NF-123456"
                />
                {errors.invoice_number && (
                  <p className="text-sm text-red-500 mt-1">{errors.invoice_number.message}</p>
                )}
              </div>

              <div>
                <Label htmlFor="invoice_date">Data de Emissao *</Label>
                <Input
                  id="invoice_date"
                  type="date"
                  {...register('invoice_date')}
                  className="mt-1"
                />
                {errors.invoice_date && (
                  <p className="text-sm text-red-500 mt-1">{errors.invoice_date.message}</p>
                )}
              </div>

              <div>
                <Label htmlFor="invoice_total_value">Valor Total da Nota (R$) *</Label>
                <Input
                  id="invoice_total_value"
                  type="number"
                  step="0.01"
                  min="0"
                  {...register('invoice_total_value', { valueAsNumber: true })}
                  className="mt-1"
                  placeholder="0.00"
                />
                {errors.invoice_total_value && (
                  <p className="text-sm text-red-500 mt-1">{errors.invoice_total_value.message}</p>
                )}
              </div>

              <div>
                <Label htmlFor="afm_number">Numero da AFM *</Label>
                <Input
                  id="afm_number"
                  {...register('afm_number')}
                  className="mt-1"
                  placeholder="Ex: AFM-2024-001"
                />
                {errors.afm_number && (
                  <p className="text-sm text-red-500 mt-1">{errors.afm_number.message}</p>
                )}
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <div className="flex items-center gap-2 text-sm font-medium text-gray-700 border-b pb-2">
              <Building2 className="w-4 h-4" />
              Dados do Fornecedor
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="supplier_cnpj">CNPJ do Fornecedor *</Label>
                <Input
                  id="supplier_cnpj"
                  {...register('supplier_cnpj')}
                  className="mt-1"
                  placeholder="00.000.000/0000-00"
                  onChange={(e) => {
                    e.target.value = formatCNPJ(e.target.value)
                  }}
                  maxLength={18}
                />
                {errors.supplier_cnpj && (
                  <p className="text-sm text-red-500 mt-1">{errors.supplier_cnpj.message}</p>
                )}
              </div>

              <div>
                <Label htmlFor="supplier_name">Nome do Fornecedor *</Label>
                <Input
                  id="supplier_name"
                  {...register('supplier_name')}
                  className="mt-1"
                  placeholder="Nome da empresa fornecedora"
                />
                {errors.supplier_name && (
                  <p className="text-sm text-red-500 mt-1">{errors.supplier_name.message}</p>
                )}
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <div className="flex items-center gap-2 text-sm font-medium text-gray-700 border-b pb-2">
              <Package2 className="w-4 h-4" />
              Dados do Produto
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div>
                <Label htmlFor="quantity">Quantidade *</Label>
                <Input
                  id="quantity"
                  type="number"
                  min="1"
                  {...register('quantity', { valueAsNumber: true })}
                  className="mt-1"
                />
                {errors.quantity && (
                  <p className="text-sm text-red-500 mt-1">{errors.quantity.message}</p>
                )}
              </div>

              <div>
                <Label htmlFor="unit_price">Valor Unitario (R$) *</Label>
                <Input
                  id="unit_price"
                  type="number"
                  step="0.01"
                  min="0"
                  {...register('unit_price', { valueAsNumber: true })}
                  className="mt-1"
                  placeholder="0.00"
                />
                {errors.unit_price && (
                  <p className="text-sm text-red-500 mt-1">{errors.unit_price.message}</p>
                )}
              </div>

              <div>
                <Label>Valor Total do Item</Label>
                <div className="mt-1 h-9 px-3 py-2 bg-gray-100 rounded-md text-sm font-medium text-gray-700">
                  R$ {totalValue.toFixed(2)}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="batch_number">Numero do Lote</Label>
                <Input
                  id="batch_number"
                  {...register('batch_number')}
                  className="mt-1"
                  placeholder="Ex: LOTE-2024-001"
                />
              </div>

              <div>
                <Label htmlFor="expiry_date">Prazo de Validade</Label>
                <Input
                  id="expiry_date"
                  type="date"
                  {...register('expiry_date')}
                  className="mt-1"
                />
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <div className="flex items-center gap-2 text-sm font-medium text-gray-700 border-b pb-2">
              <Calendar className="w-4 h-4" />
              Dados de Entrega
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="delivery_date">Data de Entrega</Label>
                <Input
                  id="delivery_date"
                  type="date"
                  {...register('delivery_date')}
                  className="mt-1"
                />
              </div>
            </div>

            <div>
              <Label htmlFor="notes">Observacoes</Label>
              <textarea
                id="notes"
                {...register('notes')}
                className="w-full mt-1 rounded-md border border-input px-3 py-2 min-h-[80px] bg-white"
                placeholder="Observacoes adicionais (opcional)"
              />
            </div>
          </div>

          {error && (
            <div className="p-3 text-sm text-red-500 bg-red-50 rounded-md border border-red-200">
              {error}
            </div>
          )}

          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <p className="text-sm text-blue-700">
              <span className="font-medium">Resumo:</span> Sera adicionado{' '}
              <span className="font-bold">{quantity || 0} {item.unit}</span> ao estoque.
              Novo estoque total: <span className="font-bold">{item.current_stock + (quantity || 0)} {item.unit}</span>
            </p>
          </div>

          <DialogFooter className="pt-4">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={loading}>
              {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Confirmar Entrada
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
