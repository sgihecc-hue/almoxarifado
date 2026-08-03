import { useState, useEffect, useRef } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Loader2, Pill, Barcode } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { getErrorMessage } from '@/lib/utils/error-messages'
import { CurrencyInput } from '@/components/ui/currency-input'
import { Label } from '@/components/ui/label'
import { itemsService } from '@/lib/services/items'
import type { ItemCategory, UnitType } from '@/lib/services/items'
import { departmentsService } from '@/lib/services/departments'
import type { Department } from '@/lib/types/departments'
import type { MedicationClass, Presentation } from '@/lib/types/farmacia'
import {
  MEDICATION_CLASS_LABEL,
  CONTROLLED_SUBCLASSES,
  PRESENTATION_LABEL,
} from '@/lib/types/farmacia'

// Converte vazio/NaN em undefined para campos numéricos opcionais
// (valueAsNumber transforma '' em NaN, que faz z.number().optional() falhar).
const optionalNumber = z.preprocess(
  (v) => (v === '' || v === null || v === undefined || (typeof v === 'number' && isNaN(v)) ? undefined : Number(v)),
  z.number().min(0).optional(),
)

const itemSchema = z.object({
  code: z.string().min(1, 'Codigo e obrigatorio'),
  barcode: z.string().optional(),
  name: z.string().min(3, 'Nome deve ter no minimo 3 caracteres'),
  description: z.string().optional(),
  category: z.string(),
  unit: z.string(),
  min_stock: optionalNumber,
  max_stock: optionalNumber,
  last_purchase_price: optionalNumber,
  reference_price: optionalNumber,
  // Consumo médio mensal informado pela farmácia (unidades/mês). Quando
  // preenchido, é o que a tela usa na coluna "Consumo" e no ponto de pedido;
  // vazio mantém o cálculo pelo histórico.
  avg_monthly_consumption: optionalNumber,
  // Almox: prazo de reposição (dias) e consumo diário informado (fallback).
  lead_time_days: optionalNumber,
  avg_daily_consumption: optionalNumber,
  // Farmacia (so usados quando type='pharmacy')
  // medication_classes: classificação múltipla. O service grava o array e
  // sincroniza medication_class (single) com a primeira pra back-compat.
  controlled_subclass: z.enum(['A1', 'A2', 'A3', 'B1', 'B2', 'C1', 'C2', 'C3', 'C4']).optional(),
  presentation: z.enum([
    'comprimidos', 'injetaveis', 'solucoes_orais', 'topicos', 'aerosol',
    'xarope', 'supositorio', 'gotas', 'outros',
  ]).optional(),
  padronizado: z.boolean().optional(),
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
  const [scanningBarcode, setScanningBarcode] = useState(false)
  const barcodeInputRef = useRef<HTMLInputElement>(null)
  const [departments, setDepartments] = useState<Department[]>([])
  const [allowedDepts, setAllowedDepts] = useState<string[]>([])
  // Classificação múltipla — checkboxes. Default vazio (mas se vazio na hora
  // de submeter, assumimos 'uso_geral' pra não quebrar a validação da RPC).
  const [selectedClasses, setSelectedClasses] = useState<MedicationClass[]>([])

  const { register, handleSubmit, formState: { errors }, reset, watch, setValue } = useForm<ItemFormData>({
    resolver: zodResolver(itemSchema),
    defaultValues: {
      category: type === 'pharmacy' ? 'MEDICAMENTO' : 'MATERIAL HOSPITALAR',
      unit: 'Un',
      min_stock: 0,
      padronizado: false,
    }
  })

  const hasControlados = selectedClasses.includes('controlados')

  // Carrega os setores (para "quem pode solicitar")
  useEffect(() => {
    if (!open) return
    departmentsService.getAll().then(setDepartments).catch((e) => console.error(e))
  }, [open])

  function toggleDept(id: string) {
    setAllowedDepts((prev) => prev.includes(id) ? prev.filter((d) => d !== id) : [...prev, id])
  }

  function toggleClass(c: MedicationClass) {
    setSelectedClasses((prev) => prev.includes(c) ? prev.filter((k) => k !== c) : [...prev, c])
  }

  const onSubmit = async (data: ItemFormData) => {
    try {
      setLoading(true)
      setError(null)

      // Cadastro puro do item — SEM estoque. A entrada de estoque é uma ação
      // separada (botão "Entrada por NF" na tela do estoque).
      // Pharmacy: garante pelo menos uma classe (default 'uso_geral') pra
      // não quebrar a RPC criar_dispensacao em prod que ainda olha o single.
      const classes: MedicationClass[] = type === 'pharmacy'
        ? (selectedClasses.length > 0 ? selectedClasses : ['uso_geral'])
        : []

      await itemsService.create({
        code: data.code,
        barcode: data.barcode || undefined,
        name: data.name,
        description: data.description,
        category: data.category as ItemCategory,
        unit: data.unit as UnitType,
        min_stock: data.min_stock ?? 0,
        max_stock: data.max_stock ?? 0,
        current_stock: 0,
        price: 0,
        last_purchase_price: data.last_purchase_price,
        reference_price: data.reference_price,
        allowed_department_ids: allowedDepts,
        // Farmacia
        medication_classes: type === 'pharmacy' ? classes : undefined,
        controlled_subclass: type === 'pharmacy' && hasControlados
          ? data.controlled_subclass : null,
        presentation: type === 'pharmacy' ? data.presentation : undefined,
        padronizado: type === 'pharmacy' ? !!data.padronizado : undefined,
        avg_monthly_consumption: type === 'pharmacy'
          ? data.avg_monthly_consumption : undefined,
        lead_time_days: type === 'warehouse' ? data.lead_time_days : undefined,
        avg_daily_consumption: type === 'warehouse' ? data.avg_daily_consumption : undefined,
      }, type)

      reset()
      setAllowedDepts([])
      setSelectedClasses([])
      onSuccess()
      onOpenChange(false)
    } catch (error: any) {
      console.error('Error creating item:', error)
      const raw = (error?.message || '').toString()
      if (raw.includes('duplicate key') || raw.includes('unique constraint') || raw.includes('code_unique')) {
        setError('Já existe um item ativo com esse código. Verifique a lista de itens ou use um código diferente.')
      } else {
        setError(getErrorMessage(error))
      }
    } finally {
      setLoading(false)
    }
  }

  const getCategoryOptions = () => {
    if (type === 'pharmacy') {
      return [
        { value: 'MEDICAMENTO', label: 'Medicamento' },
        { value: 'MAT/MED', label: 'Material/Medicamento' },
        { value: 'HIGIENE E LIMPEZA', label: 'Higiene e Limpeza' }
      ]
    } else {
      return [
        { value: 'MATERIAL HOSPITALAR', label: 'Material Hospitalar' },
        { value: 'MATERIAL DE EXPEDIENTE', label: 'Material de Expediente' },
        { value: 'MATERIAL DE HIGIENIZAÇÃO', label: 'Material de Higienização' },
        { value: 'HIGIENIZAÇÃO E LIMPEZA', label: 'Higienização e Limpeza' },
        { value: 'EPI', label: 'EPI' },
        { value: 'OUTROS', label: 'Outros' }
      ]
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[680px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Novo Item</DialogTitle>
          <p className="text-sm text-gray-500 mt-1">
            Cadastro do item (identificação e classificação). A entrada de estoque é uma ação separada.
          </p>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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

          {/* Código de barras */}
          <div>
            <Label htmlFor="barcode" className="flex items-center gap-1.5">
              <Barcode className="w-3.5 h-3.5 text-gray-500" />
              Código de Barras
              <span className="text-xs text-gray-400 font-normal">(opcional — EAN-13, Code 128, etc.)</span>
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
                placeholder={scanningBarcode ? 'Aguardando scan...' : 'Digite ou escaneie o código'}
                onFocus={() => setScanningBarcode(true)}
                onBlur={() => setScanningBarcode(false)}
              />
              <button
                type="button"
                onClick={() => {
                  setScanningBarcode(true)
                  barcodeInputRef.current?.focus()
                }}
                className="px-3 h-9 rounded-md border border-gray-300 text-xs text-gray-600 hover:bg-gray-50 flex items-center gap-1.5 whitespace-nowrap"
                title="Clique e aponte o scanner para este campo"
              >
                <Barcode className="w-3.5 h-3.5" />
                Escanear
              </button>
            </div>
            {scanningBarcode && (
              <p className="text-xs text-primary-600 mt-1 animate-pulse">
                🔵 Campo ativo — aponte o scanner e leia o código de barras do produto
              </p>
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

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
              <Label htmlFor="min_stock">Estoque Mínimo</Label>
              <Input
                id="min_stock"
                type="number"
                min="0"
                {...register('min_stock', { valueAsNumber: true })}
                className="mt-1"
                placeholder="0"
              />
            </div>

            <div>
              <Label htmlFor="max_stock">Estoque Máximo</Label>
              <Input
                id="max_stock"
                type="number"
                min="0"
                {...register('max_stock', { valueAsNumber: true })}
                className="mt-1"
                placeholder="0"
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
                  Quantidade consumida por mês. Usada na coluna “Consumo” e no
                  cálculo do ponto de pedido. Deixe vazio para calcular pelo histórico.
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
                    Dias que o fornecedor leva pra entregar. Necessário para o
                    ponto de ressuprimento.
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
                    Un/dia. Usado só enquanto o item não tem saídas registradas;
                    depois o sistema calcula pela média dos últimos 30 dias.
                  </p>
                </div>
              </>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <Label htmlFor="last_purchase_price">Valor da Última Compra</Label>
              <div className="mt-1">
                <CurrencyInput
                  id="last_purchase_price"
                  value={watch('last_purchase_price')}
                  onChange={(v) => setValue('last_purchase_price', v)}
                />
              </div>
            </div>

            <div>
              <Label htmlFor="reference_price">Valor Referencial</Label>
              <div className="mt-1">
                <CurrencyInput
                  id="reference_price"
                  value={watch('reference_price')}
                  onChange={(v) => setValue('reference_price', v)}
                />
              </div>
            </div>
          </div>

          {/* Secao: Classificacao Farmaceutica — so para pharmacy */}
          {type === 'pharmacy' && (
            <div className="border border-blue-200 rounded-lg overflow-hidden">
              <div className="flex items-center gap-2 px-4 py-3 bg-blue-50 border-b border-blue-200">
                <Pill className="w-4 h-4 text-blue-700" />
                <span className="text-sm font-medium text-blue-900">
                  Classificação Farmacêutica
                </span>
              </div>
              <div className="p-4 space-y-4 bg-white">
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

                <div>
                  <Label htmlFor="presentation">Apresentação *</Label>
                  <select
                    id="presentation"
                    {...register('presentation')}
                    className="w-full mt-1 h-9 rounded-md border border-input px-3 py-1 bg-white"
                  >
                    <option value="">Selecione...</option>
                    {(Object.entries(PRESENTATION_LABEL) as Array<[Presentation, string]>).map(([k, label]) => (
                      <option key={k} value={k}>{label}</option>
                    ))}
                  </select>
                </div>

                <label className="flex items-start gap-3 p-3 rounded-lg cursor-pointer select-none border border-gray-200 bg-gray-50 hover:bg-gray-100 transition-colors">
                  <input
                    type="checkbox"
                    {...register('padronizado')}
                    className="w-4 h-4 mt-0.5 flex-shrink-0"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-gray-900">Medicamento padronizado</div>
                    <p className="text-xs text-gray-500 mt-0.5">
                      Marque se este item faz parte da padronização da farmácia.
                    </p>
                  </div>
                </label>
              </div>
            </div>
          )}

          {/* Setores que podem solicitar este item (vazio = todos) */}
          <div className="border border-gray-200 rounded-lg overflow-hidden">
            <div className="px-4 py-3 bg-gray-50 border-b border-gray-200">
              <span className="text-sm font-medium text-gray-800">Setores que podem solicitar</span>
              <p className="text-xs text-gray-500 mt-0.5">Marque os setores autorizados. Nenhum marcado = todos podem solicitar.</p>
            </div>
            <div className="p-4 grid grid-cols-2 md:grid-cols-3 gap-2 max-h-48 overflow-y-auto bg-white">
              {departments.length === 0 ? (
                <p className="text-xs text-gray-400 col-span-full">Carregando setores...</p>
              ) : departments.map((d) => (
                <label key={d.id} className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                  <input type="checkbox" checked={allowedDepts.includes(d.id)} onChange={() => toggleDept(d.id)} className="w-4 h-4" />
                  <span className="truncate">{d.name}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="p-3 bg-blue-50 rounded-lg border border-blue-200 text-xs text-blue-700">
            Este é o <strong>cadastro do item</strong> (sem estoque). Para dar entrada de
            quantidade, use o botão <strong>"Entrada por NF"</strong> na tela do estoque.
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
              Criar Item
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
