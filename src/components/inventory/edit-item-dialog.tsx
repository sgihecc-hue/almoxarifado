import { useEffect, useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Loader2, FileText, Pencil, Barcode } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { CurrencyInput } from '@/components/ui/currency-input'
import { Label } from '@/components/ui/label'
import { itemsService } from '@/lib/services/items'
import { supabase } from '@/lib/supabase'
import { getErrorMessage } from '@/lib/utils/error-messages'
import type { Item, ItemCategory, UnitType } from '@/lib/services/items'
import { MEDICATION_CLASS_LABEL, CONTROLLED_SUBCLASSES } from '@/lib/types/farmacia'
import type { MedicationClass } from '@/lib/types/farmacia'

// Transforma NaN/vazio em undefined para campos numéricos opcionais
const optionalNumber = z.preprocess(
  (v) => (v === '' || v === null || v === undefined || (typeof v === 'number' && isNaN(v)) ? undefined : Number(v)),
  z.number().min(0).optional(),
)

const schema = z.object({
  // Dados do item
  code: z.string().min(1, 'Código é obrigatório'),
  barcode: z.string().optional(),
  name: z.string().min(3, 'Nome deve ter no mínimo 3 caracteres'),
  description: z.string().optional(),
  category: z.string(),
  unit: z.string(),
  min_stock: z.preprocess(
    (v) => (v === '' || v === null || v === undefined || (typeof v === 'number' && isNaN(v)) ? 0 : Number(v)),
    z.number().min(0),
  ),
  current_stock: z.preprocess(
    (v) => (v === '' || v === null || v === undefined || (typeof v === 'number' && isNaN(v)) ? 0 : Number(v)),
    z.number().min(0, 'Estoque deve ser maior ou igual a 0'),
  ),
  // Consumo médio mensal informado (un/mês). Vazio => volta a calcular pelo histórico.
  avg_monthly_consumption: z.preprocess(
    (v) => (v === '' || v === null || v === undefined || (typeof v === 'number' && isNaN(v)) ? null : Number(v)),
    z.number().min(0).nullable(),
  ).optional(),
  // Almox: prazo de reposição (dias) e consumo diário informado (fallback).
  lead_time_days: z.preprocess(
    (v) => (v === '' || v === null || v === undefined || (typeof v === 'number' && isNaN(v)) ? null : Number(v)),
    z.number().min(0).nullable(),
  ).optional(),
  avg_daily_consumption: z.preprocess(
    (v) => (v === '' || v === null || v === undefined || (typeof v === 'number' && isNaN(v)) ? null : Number(v)),
    z.number().min(0).nullable(),
  ).optional(),
  batch_number: z.string().optional(),
  expiry_date: z.string().optional(),
  last_purchase_price: optionalNumber,
  reference_price: optionalNumber,
  // Farmácia: subclasse da Portaria 344/98 (só quando "controlados" marcado).
  controlled_subclass: z.enum(['A1', 'A2', 'A3', 'B1', 'B2', 'C1', 'C2', 'C3', 'C4']).optional(),
  // Nova entrada (opcional)
  entry_quantity: optionalNumber,
  acquisition_type: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.enum(['Compra', 'Empréstimo', 'Doação', 'Permuta', 'Devolução', 'Inventário']).optional(),
  ),
  invoice_number: z.string().optional(),
  invoice_date: z.string().optional(),
  invoice_total_value: optionalNumber,
  unit_price: optionalNumber,
  afm_number: z.string().optional(),
  supplier_cnpj: z.string().optional(),
  supplier_name: z.string().optional(),
})

type FormData = z.infer<typeof schema>

interface EditItemDialogProps {
  item: Item
  type: 'pharmacy' | 'warehouse'
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess: () => void
}

const unitOptions = [
  'Un','Pc','Cx','Fr','Amp','Tb','Rl','Lt','Kg','Gl','ml','g','Pr','Cj','Sc','Rm','Ct','FL',
]

export function EditItemDialog({ item, type, open, onOpenChange, onSuccess }: EditItemDialogProps) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [scanningBarcode, setScanningBarcode] = useState(false)
  const barcodeInputRef = useRef<HTMLInputElement>(null)

  // Classes do medicamento (farmácia): lê do array medication_classes; se
  // vazio, cai no medication_class (single) por compatibilidade.
  const classesDoItem = (it: Item): MedicationClass[] => {
    const arr = (it as any).medication_classes as MedicationClass[] | null | undefined
    if (Array.isArray(arr) && arr.length > 0) return arr
    const single = (it as any).medication_class as MedicationClass | null | undefined
    return single ? [single] : []
  }
  const [selectedClasses, setSelectedClasses] = useState<MedicationClass[]>(() => classesDoItem(item))
  const hasControlados = selectedClasses.includes('controlados')
  function toggleClass(c: MedicationClass) {
    setSelectedClasses((prev) => prev.includes(c) ? prev.filter((k) => k !== c) : [...prev, c])
  }

  const { register, handleSubmit, formState: { errors }, reset, watch, setValue } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      code: item.code,
      barcode: (item as any).barcode || '',
      name: item.name,
      description: item.description || '',
      category: item.category,
      unit: item.unit,
      min_stock: item.min_stock ?? 0,
      avg_monthly_consumption: (item as any).avg_monthly_consumption ?? null,
      lead_time_days: (item as any).lead_time_days ?? null,
      avg_daily_consumption: (item as any).avg_daily_consumption ?? null,
      current_stock: item.current_stock ?? 0,
      batch_number: (item as any).batch_number || '',
      expiry_date: item.expiry_date || '',
      last_purchase_price: (item as any).last_purchase_price ?? undefined,
      reference_price: (item as any).reference_price ?? undefined,
      controlled_subclass: (item as any).controlled_subclass ?? undefined,
      entry_quantity: 0,
    },
  })

  // Recarrega valores quando trocar de item
  useEffect(() => {
    reset({
      code: item.code,
      barcode: (item as any).barcode || '',
      name: item.name,
      description: item.description || '',
      category: item.category,
      unit: item.unit,
      min_stock: item.min_stock ?? 0,
      avg_monthly_consumption: (item as any).avg_monthly_consumption ?? null,
      lead_time_days: (item as any).lead_time_days ?? null,
      avg_daily_consumption: (item as any).avg_daily_consumption ?? null,
      current_stock: item.current_stock ?? 0,
      batch_number: (item as any).batch_number || '',
      expiry_date: item.expiry_date || '',
      last_purchase_price: (item as any).last_purchase_price ?? undefined,
      reference_price: (item as any).reference_price ?? undefined,
      controlled_subclass: (item as any).controlled_subclass ?? undefined,
      entry_quantity: 0,
      acquisition_type: undefined,
      invoice_number: '',
      invoice_date: '',
      invoice_total_value: undefined,
      unit_price: undefined,
      afm_number: '',
      supplier_cnpj: '',
      supplier_name: '',
    })
    setSelectedClasses(classesDoItem(item))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id])

  const categoryOptions =
    type === 'pharmacy'
      ? [
          { value: 'MEDICAMENTO', label: 'Medicamento' },
          { value: 'MAT/MED', label: 'Material/Medicamento' },
          { value: 'HIGIENE E LIMPEZA', label: 'Higiene e Limpeza' },
        ]
      : [
          { value: 'MATERIAL HOSPITALAR', label: 'Material Hospitalar' },
          { value: 'MATERIAL DE EXPEDIENTE', label: 'Material de Expediente' },
          { value: 'MATERIAL DE HIGIENIZAÇÃO', label: 'Material de Higienização' },
          { value: 'HIGIENIZAÇÃO E LIMPEZA', label: 'Higienização e Limpeza' },
          { value: 'EPI', label: 'EPI' },
          { value: 'OUTROS', label: 'Outros' },
        ]

  const onSubmit = async (data: FormData) => {
    try {
      setLoading(true)
      setError(null)

      const hasEntry = (data.entry_quantity ?? 0) > 0

      // 1) Atualiza dados do item incluindo estoque atual
      const updatePayload: any = {
        code: data.code,
        barcode: data.barcode?.trim() || null,
        name: data.name,
        description: data.description || null,
        category: data.category as ItemCategory,
        unit: data.unit as UnitType,
        min_stock: data.min_stock,
        ...(type === 'pharmacy'
          ? {
              avg_monthly_consumption: data.avg_monthly_consumption ?? null,
              // Classes do medicamento (default uso_geral se nada marcado). O
              // service sincroniza medication_class (single) com a 1ª do array.
              medication_classes: selectedClasses.length > 0 ? selectedClasses : ['uso_geral'],
              controlled_subclass: hasControlados ? (data.controlled_subclass ?? null) : null,
            }
          : {
              lead_time_days: data.lead_time_days ?? null,
              avg_daily_consumption: data.avg_daily_consumption ?? null,
            }),
        current_stock: data.current_stock,
        batch_number: data.batch_number || null,
        expiry_date: data.expiry_date || null,
        last_purchase_price: data.last_purchase_price ?? null,
        reference_price: data.reference_price ?? null,
      }
      await itemsService.update(item.id, updatePayload, type)

      // 2) Se preencheu Nova Entrada, registra e soma estoque
      if (hasEntry) {
        const { data: authData } = await supabase.auth.getUser()
        if (!authData?.user) throw new Error('Usuário não autenticado')

        if (!data.acquisition_type) {
          throw new Error('Selecione o tipo de aquisição da nova entrada')
        }

        // Campos NOT NULL do banco: usa string vazia em vez de null
        const entry = {
          item_id: item.id,
          item_type: type,
          quantity: data.entry_quantity!,
          acquisition_type: data.acquisition_type,
          invoice_number: data.invoice_number?.trim() || '—',
          invoice_date: data.invoice_date || new Date().toISOString().slice(0, 10),
          invoice_total_value: data.invoice_total_value ?? 0,
          unit_price: data.unit_price ?? data.last_purchase_price ?? 0,
          afm_number: data.afm_number?.trim() || '—',
          supplier_cnpj: data.supplier_cnpj?.trim() || '00.000.000/0000-00',
          supplier_name:
            data.supplier_name?.trim() ||
            (data.acquisition_type === 'Doação' ? 'Doação' : data.acquisition_type === 'Devolução' ? 'Devolução de setor' : 'Entrada via edição do item'),
          batch_number: data.batch_number?.trim() || null,
          expiry_date: data.expiry_date || null,
          notes: 'Entrada registrada na edição do item',
          created_by: authData.user.id,
        }
        const { error: entryError } = await supabase.from('stock_entries').insert(entry)
        if (entryError) throw entryError

        // Soma no estoque atual (usa o valor editado pelo usuário como base)
        const newStock = (data.current_stock ?? item.current_stock ?? 0) + data.entry_quantity!
        const tableName = type === 'pharmacy' ? 'pharmacy_items' : 'warehouse_items'
        const { error: stockErr } = await supabase
          .from(tableName)
          .update({ current_stock: newStock, updated_at: new Date().toISOString() })
          .eq('id', item.id)
        if (stockErr) throw stockErr
      }

      onSuccess()
      onOpenChange(false)
    } catch (e: any) {
      console.error('Error editing item:', e)
      setError(getErrorMessage(e))
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[640px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Pencil className="w-5 h-5 text-amber-600" />
            Editar Item — {item.name.slice(0, 60)}{item.name.length > 60 ? '…' : ''}
          </DialogTitle>
          <p className="text-sm text-gray-500 mt-1">
            Atualize os dados do item. Se quiser <strong>registrar uma nova entrada</strong> de estoque,
            preencha a seção verde no final do formulário.
          </p>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          {/* Dados do item */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <Label htmlFor="code">Código *</Label>
              <Input id="code" {...register('code')} className="mt-1" />
              {errors.code && <p className="text-sm text-red-500 mt-1">{errors.code.message}</p>}
            </div>
            <div>
              <Label htmlFor="category">Categoria *</Label>
              <select
                id="category"
                {...register('category')}
                className="w-full mt-1 h-9 rounded-md border border-input px-3 py-1 bg-white"
              >
                {categoryOptions.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <Label htmlFor="name">Nome *</Label>
            <Input id="name" {...register('name')} className="mt-1" />
            {errors.name && <p className="text-sm text-red-500 mt-1">{errors.name.message}</p>}
          </div>

          {/* Código de barras */}
          <div>
            <Label htmlFor="barcode" className="flex items-center gap-1.5">
              <Barcode className="w-3.5 h-3.5 text-gray-500" />
              Código de Barras
              <span className="text-xs text-gray-400 font-normal">(opcional)</span>
            </Label>
            <div className="flex gap-2 mt-1">
              <input
                id="barcode"
                {...register('barcode')}
                ref={(el) => {
                  (register('barcode') as any).ref(el)
                  ;(barcodeInputRef as any).current = el
                }}
                data-barcode-input="true"
                className="flex-1 h-9 rounded-md border border-input bg-white px-3 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                placeholder={scanningBarcode ? 'Aguardando scan...' : 'EAN-13, Code 128, etc.'}
                onFocus={() => setScanningBarcode(true)}
                onBlur={() => setScanningBarcode(false)}
              />
              <button
                type="button"
                onClick={() => { setScanningBarcode(true); barcodeInputRef.current?.focus() }}
                className="px-3 h-9 rounded-md border border-gray-300 text-xs text-gray-600 hover:bg-gray-50 flex items-center gap-1.5 whitespace-nowrap"
              >
                <Barcode className="w-3.5 h-3.5" />
                Escanear
              </button>
            </div>
            {scanningBarcode && (
              <p className="text-xs text-primary-600 mt-1 animate-pulse">
                🔵 Campo ativo — aponte o scanner para ler o código de barras do produto
              </p>
            )}
          </div>

          <div>
            <Label htmlFor="description">Descrição</Label>
            <textarea
              id="description"
              {...register('description')}
              className="w-full mt-1 rounded-md border border-input px-3 py-2 min-h-[60px] bg-white"
            />
          </div>

          {type === 'pharmacy' && (
            <div className="rounded-lg border border-gray-200 p-4 space-y-4 bg-white">
              <div>
                <Label>Classes do medicamento (uma ou mais)</Label>
                <p className="text-xs text-gray-500 mt-0.5 mb-2">
                  Clique para marcar/desmarcar. Itens controlados ou antimicrobianos
                  exigem aprovação farmacêutica na dispensação.
                </p>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-1">
                  {(Object.entries(MEDICATION_CLASS_LABEL) as Array<[MedicationClass, string]>).map(([k, label]) => {
                    const selected = selectedClasses.includes(k)
                    return (
                      <button
                        key={k}
                        type="button"
                        onClick={() => toggleClass(k)}
                        className={`px-2 py-2 text-xs rounded-lg border text-center leading-tight transition-colors flex items-center justify-center gap-1 min-h-[60px] ${
                          selected
                            ? 'bg-blue-100 border-blue-500 text-blue-900 font-semibold'
                            : 'bg-white border-gray-200 text-gray-700 hover:bg-gray-50'
                        }`}
                      >
                        <span className={`inline-block w-3 h-3 rounded-sm border ${selected ? 'bg-blue-600 border-blue-600' : 'border-gray-400'}`}>
                          {selected && <span className="text-white text-[10px] leading-3 block text-center">✓</span>}
                        </span>
                        {label}
                      </button>
                    )
                  })}
                </div>
              </div>

              {hasControlados && (
                <div>
                  <Label>Lista (Portaria 344/98) — opcional</Label>
                  <select
                    {...register('controlled_subclass')}
                    className="w-full mt-1 h-9 rounded-md border border-input px-3 py-1 bg-white"
                  >
                    <option value="">Selecione a lista</option>
                    {CONTROLLED_SUBCLASSES.map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                  <p className="text-xs text-gray-500 mt-1">
                    A1/A2/A3=entorpecentes · B1/B2=psicotrópicos · C1=outros · C2=retinoicos · C3=imunossupressores · C4=antirretrovirais
                  </p>
                </div>
              )}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <Label htmlFor="unit">Unidade *</Label>
              <select
                id="unit"
                {...register('unit')}
                className="w-full mt-1 h-9 rounded-md border border-input px-3 py-1 bg-white"
              >
                {unitOptions.map((u) => (
                  <option key={u} value={u}>{u}</option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor="min_stock">Estoque Mínimo *</Label>
              <Input
                id="min_stock"
                type="number"
                min="0"
                {...register('min_stock', { valueAsNumber: true })}
                className="mt-1"
              />
            </div>
            {type === 'pharmacy' && (
              <div>
                <Label htmlFor="avg_monthly_consumption">Consumo Médio Mensal</Label>
                <Input
                  id="avg_monthly_consumption"
                  type="number"
                  min="0"
                  {...register('avg_monthly_consumption', { valueAsNumber: true })}
                  className="mt-1"
                  placeholder="Ex: 120"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Un/mês. Vazio = calcular pelo histórico.
                </p>
              </div>
            )}
            {type === 'warehouse' && (
              <>
                <div>
                  <Label htmlFor="lead_time_days">Prazo de Reposição (dias)</Label>
                  <Input
                    id="lead_time_days"
                    type="number"
                    min="0"
                    {...register('lead_time_days', { valueAsNumber: true })}
                    className="mt-1"
                    placeholder="Ex: 30"
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    Dias de entrega do fornecedor. Necessário para o ponto de ressuprimento.
                  </p>
                </div>
                <div>
                  <Label htmlFor="avg_daily_consumption">Consumo Diário (opcional)</Label>
                  <Input
                    id="avg_daily_consumption"
                    type="number"
                    min="0"
                    {...register('avg_daily_consumption', { valueAsNumber: true })}
                    className="mt-1"
                    placeholder="Ex: 376"
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    Un/dia. Só usado enquanto não há saídas; depois o sistema calcula pelos últimos 30 dias.
                  </p>
                </div>
              </>
            )}
          </div>

          <div className="p-4 bg-blue-50 rounded-lg border border-blue-200">
            <Label htmlFor="current_stock" className="text-blue-900 font-semibold">Estoque Atual</Label>
            <p className="text-xs text-blue-600 mb-2">Valor atual em sistema. Altere para corrigir manualmente.</p>
            <Input
              id="current_stock"
              type="number"
              min="0"
              {...register('current_stock', { valueAsNumber: true })}
              className="bg-white"
            />
            {errors.current_stock && <p className="text-sm text-red-500 mt-1">{errors.current_stock.message}</p>}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <Label htmlFor="batch_number">Lote</Label>
              <Input id="batch_number" {...register('batch_number')} className="mt-1" />
            </div>
            <div>
              <Label htmlFor="expiry_date">Validade</Label>
              <Input id="expiry_date" type="date" {...register('expiry_date')} className="mt-1" />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <Label htmlFor="last_purchase_price">Valor da Última Compra</Label>
              <div className="mt-1">
                <CurrencyInput
                  id="last_purchase_price"
                  value={watch('last_purchase_price') as number | undefined}
                  onChange={(v) => setValue('last_purchase_price', v as any)}
                />
              </div>
            </div>
            <div>
              <Label htmlFor="reference_price">Valor Referencial</Label>
              <div className="mt-1">
                <CurrencyInput
                  id="reference_price"
                  value={watch('reference_price') as number | undefined}
                  onChange={(v) => setValue('reference_price', v as any)}
                />
              </div>
            </div>
          </div>

          {/* Nova entrada de estoque (opcional) */}
          <div className="border border-emerald-200 rounded-lg overflow-hidden">
            <div className="flex items-center gap-2 px-4 py-3 bg-emerald-50 border-b border-emerald-200">
              <FileText className="w-4 h-4 text-emerald-700" />
              <span className="text-sm font-medium text-emerald-900">
                Registrar nova entrada de estoque (opcional)
              </span>
            </div>

            <div className="p-4 space-y-4 bg-white">
              <p className="text-xs text-gray-500">
                Preencha esta seção se está recebendo <strong>mais material</strong> agora (Compra, Doação,
                Empréstimo, Permuta ou Devolução). O sistema vai somar a quantidade ao estoque e registrar a NF/fornecedor.
                Estoque atual: <strong>{item.current_stock} {item.unit}</strong>
              </p>

              <div>
                <Label htmlFor="acquisition_type">Como o material chegou?</Label>
                <select
                  id="acquisition_type"
                  {...register('acquisition_type')}
                  className="mt-1 w-full h-9 rounded-md border border-input bg-white px-3 py-1 text-sm"
                  defaultValue=""
                >
                  <option value="">— Selecione o tipo —</option>
                  <option value="Compra">Compra</option>
                  <option value="Doação">Doação</option>
                  <option value="Empréstimo">Empréstimo</option>
                  <option value="Permuta">Permuta</option>
                  <option value="Devolução">Devolução</option>
                  <option value="Inventário">Inventário</option>
                </select>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="entry_quantity">Quantidade a adicionar</Label>
                  <Input
                    id="entry_quantity"
                    type="number"
                    min="0"
                    {...register('entry_quantity', { valueAsNumber: true })}
                    onWheel={(e) => e.currentTarget.blur()}
                    className="mt-1"
                    placeholder="0"
                  />
                </div>
                <div>
                  <Label htmlFor="unit_price">Valor Unitário</Label>
                  <div className="mt-1">
                    <CurrencyInput
                      id="unit_price"
                      value={watch('unit_price') as number | undefined}
                      onChange={(v) => setValue('unit_price', v as any)}
                    />
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="invoice_number">Número da NF</Label>
                  <Input id="invoice_number" {...register('invoice_number')} className="mt-1" placeholder="Ex: NF-123456" />
                </div>
                <div>
                  <Label htmlFor="afm_number">Número da AFM</Label>
                  <Input id="afm_number" {...register('afm_number')} className="mt-1" placeholder="Ex: AFM-2026-001" />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="invoice_date">Data da NF</Label>
                  <Input id="invoice_date" type="date" {...register('invoice_date')} className="mt-1" />
                </div>
                <div>
                  <Label htmlFor="invoice_total_value">Valor Total da NF</Label>
                  <div className="mt-1">
                    <CurrencyInput
                      id="invoice_total_value"
                      value={watch('invoice_total_value') as number | undefined}
                      onChange={(v) => setValue('invoice_total_value', v as any)}
                    />
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="supplier_cnpj">CNPJ do Fornecedor</Label>
                  <Input id="supplier_cnpj" {...register('supplier_cnpj')} className="mt-1" placeholder="00.000.000/0000-00" />
                </div>
                <div>
                  <Label htmlFor="supplier_name">Nome do Fornecedor</Label>
                  <Input id="supplier_name" {...register('supplier_name')} className="mt-1" placeholder="Nome da empresa" />
                </div>
              </div>
            </div>
          </div>

          {error && (
            <div className="p-3 text-sm text-red-500 bg-red-50 rounded-md border border-red-200">
              {error}
            </div>
          )}

          {Object.keys(errors).length > 0 && (
            <div className="p-3 text-sm text-amber-700 bg-amber-50 rounded-md border border-amber-200">
              <strong>Corrija os campos:</strong>{' '}
              {Object.entries(errors).map(([key, err]) => (
                <span key={key}>{key}: {(err as any)?.message || 'inválido'}; </span>
              ))}
            </div>
          )}

          <DialogFooter className="pt-4">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={loading}>
              {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Salvar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
