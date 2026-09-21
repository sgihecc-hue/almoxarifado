import { useEffect, useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Loader2, FileText, Pencil, Barcode, Layers, Plus, Trash2, History, ShieldCheck } from 'lucide-react'
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
import { novaRodadaId, useTravaEnvio, lerAvisoEntrada, descreverParecida, type EntradaParecida } from '@/lib/utils/entradas'
import type { Item, ItemCategory, UnitType } from '@/lib/services/items'
import { MEDICATION_CLASS_LABEL, CONTROLLED_SUBCLASSES } from '@/lib/types/farmacia'
import type { MedicationClass } from '@/lib/types/farmacia'
import { PHARMACY_STOCKS } from '@/lib/constants/stock-locations'

// Estoques de farmácia que guardam lotes de medicamento (o Satélite Térreo é
// material/almoxarifado, então não entra na edição de lotes de remédio).
const LOT_LOCATIONS_PHARMACY = PHARMACY_STOCKS.filter((s) => s.itemType === 'pharmacy')

// Locais de MATERIAL que guardam lote. Só o(s) estoque(s) de material do
// seletor da farmácia (hoje a Satélite Térreo): o Almoxarifado não trabalha com
// lote por local — o saldo dele é o global (warehouse_items.current_stock).
const LOT_LOCATIONS_WAREHOUSE = PHARMACY_STOCKS.filter((s) => s.itemType === 'warehouse')

function lotLocationsFor(type: 'pharmacy' | 'warehouse') {
  return type === 'pharmacy' ? LOT_LOCATIONS_PHARMACY : LOT_LOCATIONS_WAREHOUSE
}

// Edição de item do ALMOXARIFADO é auditável: motivo obrigatório, resumo
// antes/depois e gravação pela RPC almox_editar_item (registro imutável em
// almox_item_edicoes). Medicamento segue o caminho de sempre.
const ROTULO_CAMPO: Record<string, string> = {
  code: 'Código',
  barcode: 'Código de barras',
  name: 'Nome',
  description: 'Descrição',
  category: 'Categoria',
  unit: 'Unidade',
  min_stock: 'Estoque mínimo',
  lead_time_days: 'Prazo de reposição (dias)',
  avg_daily_consumption: 'Consumo médio diário',
  current_stock: 'Estoque atual',
  batch_number: 'Lote',
  expiry_date: 'Validade',
  last_purchase_price: 'Valor da última compra',
  reference_price: 'Valor referencial',
}
const MOTIVO_MINIMO = 10

type LinhaResumo = { campo: string; antes: unknown; depois: unknown }
type EdicaoRegistrada = {
  id: string
  feito_em: string
  usuario_nome: string | null
  motivo: string
  alteracoes: Record<string, { antes: unknown; depois: unknown }>
  entrada: { quantity?: number } | null
}

function mostraValor(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—'
  return String(v)
}

function vazioParaNull(v: unknown): unknown {
  if (v === '' || v === undefined || (typeof v === 'number' && Number.isNaN(v))) return null
  return v
}

function mesmoValor(a: unknown, b: unknown): boolean {
  if (a === null || a === undefined) return b === null || b === undefined
  if (b === null || b === undefined) return false
  if (typeof a === 'number' || typeof b === 'number') return Number(a) === Number(b)
  return String(a) === String(b)
}

interface LotRow {
  _key: string
  id?: string
  batch_number: string
  expiry_date: string
  quantity: number
  location_id: string
  deleted?: boolean
}

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
  // Farmácia: item faz parte da padronização da farmácia.
  padronizado: z.boolean().optional(),
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
  // Material: o editor de lotes so faz sentido num SATELITE (SAT_T), que tem
  // saldo por local. O Almoxarifado central controla saldo global, sem lote por
  // local — para ele a tela segue exatamente como era, sem este bloco.
  // Medicamento ignora esta prop: sempre teve o editor.
  allowLotEdit?: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess: () => void
}

const unitOptions = [
  'Un','Pc','Cx','Fr','Amp','Tb','Rl','Lt','Kg','Gl','ml','g','Pr','Cj','Sc','Rm','Ct','FL',
]

export function EditItemDialog({ item, type, allowLotEdit = false, open, onOpenChange, onSuccess }: EditItemDialogProps) {
  // Medicamento sempre teve o editor de lotes. Material so mostra quando a tela
  // que abriu o dialogo esta num satelite (passa allowLotEdit) — o Almoxarifado
  // central nao passa, entao nada muda para ele.
  const podeEditarLotes = type === 'pharmacy' || allowLotEdit
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [scanningBarcode, setScanningBarcode] = useState(false)
  const ehAlmox = type === 'warehouse'
  const [motivo, setMotivo] = useState('')
  const [resumo, setResumo] = useState<LinhaResumo[] | null>(null)
  // Assinatura do que foi conferido no resumo (campos + motivo + entrada). O
  // 2º clique só grava se nada mudou desde o resumo. NÃO usar watch(callback)
  // para limpar o resumo: no react-hook-form 7.56 ele dispara no próprio
  // submit e apagava o resumo na hora — o botão Salvar parecia não funcionar.
  const [resumoAssinatura, setResumoAssinatura] = useState<string | null>(null)
  // Entrada pela edicao do item (almox): rodada unica por abertura do dialogo,
  // trava de envio e aviso de entrada parecida. Foi por esta tela que a mesma
  // compra de mascaras entrou duas vezes (18/08 e 28/08/2026).
  const rodadaRef = useRef<string>(novaRodadaId())
  const confirmarParecidaRef = useRef(false)
  const trava = useTravaEnvio()
  const [parecida, setParecida] = useState<EntradaParecida | null>(null)
  const [nfPendente, setNfPendente] = useState(false)
  useEffect(() => {
    if (!open) return
    rodadaRef.current = novaRodadaId()
    confirmarParecidaRef.current = false
    setParecida(null)
    setNfPendente(false)
  }, [open, item.id])
  const [historico, setHistorico] = useState<EdicaoRegistrada[]>([])
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

  // Lotes do item (expiry_tracking) — editáveis nesta tela para medicamento
  // (farmácia) e para material (Satélite Térreo).
  const LOT_LOCATIONS = lotLocationsFor(type)
  const lotesLabel = type === 'pharmacy' ? 'Lotes do medicamento' : 'Lotes do material'
  const [lots, setLots] = useState<LotRow[]>([])
  const [loadingLots, setLoadingLots] = useState(false)
  const [lotsDirty, setLotsDirty] = useState(false)

  useEffect(() => {
    if (!open || !podeEditarLotes) { setLots([]); setLotsDirty(false); return }
    let alive = true
    ;(async () => {
      setLoadingLots(true)
      const { data } = await supabase
        .from('expiry_tracking')
        .select('id, batch_number, expiry_date, current_quantity, location_id')
        .eq('item_id', item.id)
        .order('expiry_date', { ascending: true, nullsFirst: false })
      if (!alive) return
      setLots((data || []).map((r: any) => ({
        _key: r.id,
        id: r.id,
        batch_number: r.batch_number || '',
        expiry_date: r.expiry_date || '',
        quantity: r.current_quantity ?? 0,
        location_id: r.location_id || LOT_LOCATIONS[0].id,
      })))
      setLotsDirty(false)
      setLoadingLots(false)
    })()
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id, open, type])

  // Almoxarifado: motivo e resumo recomeçam a cada abertura; histórico do item.
  useEffect(() => {
    if (!open || !ehAlmox) return
    setMotivo('')
    setResumo(null)
    let vivo = true
    supabase
      .from('almox_item_edicoes')
      .select('id, feito_em, usuario_nome, motivo, alteracoes, entrada')
      .eq('item_id', item.id)
      .order('feito_em', { ascending: false })
      .limit(20)
      .then(({ data }) => { if (vivo) setHistorico((data ?? []) as EdicaoRegistrada[]) })
    return () => { vivo = false }
  }, [item.id, open, ehAlmox])

  const newKey = () => Math.random().toString(36).slice(2)
  function updateLot(key: string, patch: Partial<LotRow>) {
    setLots((prev) => prev.map((l) => (l._key === key ? { ...l, ...patch } : l)))
    setLotsDirty(true)
  }
  function addLot() {
    setLots((prev) => [...prev, {
      _key: newKey(), batch_number: '', expiry_date: '', quantity: 0, location_id: LOT_LOCATIONS[0].id,
    }])
    setLotsDirty(true)
  }
  function removeLot(key: string) {
    // Se já existe no banco, marca deleted (o RPC apaga); se é novo, some da lista.
    setLots((prev) => prev.flatMap((l) => {
      if (l._key !== key) return [l]
      return l.id ? [{ ...l, deleted: true }] : []
    }))
    setLotsDirty(true)
  }
  const lotsVisiveis = lots.filter((l) => !l.deleted)
  const totalLotes = lotsVisiveis.reduce((s, l) => s + (Number(l.quantity) || 0), 0)

  const { register, handleSubmit, formState: { errors }, reset, watch, setValue } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      code: type === 'warehouse' ? (item.code ?? '') : item.code,
      barcode: (item as any).barcode || '',
      name: item.name,
      description: item.description || '',
      category: type === 'warehouse' ? (item.category ?? '') : item.category,
      unit: item.unit,
      min_stock: item.min_stock ?? 0,
      avg_monthly_consumption: (item as any).avg_monthly_consumption ?? null,
      lead_time_days: (item as any).lead_time_days ?? null,
      // Guardado como média diária; exibimos em Un/SEMANA (×7).
      avg_daily_consumption: (item as any).avg_daily_consumption != null
        ? Number((item as any).avg_daily_consumption) * 7 : null,
      current_stock: item.current_stock ?? 0,
      batch_number: (item as any).batch_number || '',
      expiry_date: item.expiry_date || '',
      last_purchase_price: (item as any).last_purchase_price ?? undefined,
      reference_price: (item as any).reference_price ?? undefined,
      controlled_subclass: (item as any).controlled_subclass ?? undefined,
      padronizado: (item as any).padronizado ?? false,
      entry_quantity: 0,
    },
  })

  // Recarrega valores quando trocar de item
  useEffect(() => {
    reset({
      code: type === 'warehouse' ? (item.code ?? '') : item.code,
      barcode: (item as any).barcode || '',
      name: item.name,
      description: item.description || '',
      category: type === 'warehouse' ? (item.category ?? '') : item.category,
      unit: item.unit,
      min_stock: item.min_stock ?? 0,
      avg_monthly_consumption: (item as any).avg_monthly_consumption ?? null,
      lead_time_days: (item as any).lead_time_days ?? null,
      // Guardado como média diária; exibimos em Un/SEMANA (×7).
      avg_daily_consumption: (item as any).avg_daily_consumption != null
        ? Number((item as any).avg_daily_consumption) * 7 : null,
      current_stock: item.current_stock ?? 0,
      batch_number: (item as any).batch_number || '',
      expiry_date: item.expiry_date || '',
      last_purchase_price: (item as any).last_purchase_price ?? undefined,
      reference_price: (item as any).reference_price ?? undefined,
      controlled_subclass: (item as any).controlled_subclass ?? undefined,
      padronizado: (item as any).padronizado ?? false,
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

  // Campos do item de almoxarifado que o usuário realmente mudou.
  function camposAlterados(data: FormData): Record<string, unknown> {
    const it = item as any
    const candidatos: Record<string, [unknown, unknown]> = {
      code: [it.code ?? null, vazioParaNull(data.code)],
      barcode: [it.barcode || null, vazioParaNull(data.barcode?.trim())],
      name: [it.name ?? null, vazioParaNull(data.name)],
      description: [it.description || null, vazioParaNull(data.description)],
      category: [it.category ?? null, vazioParaNull(data.category)],
      unit: [it.unit ?? null, vazioParaNull(data.unit)],
      min_stock: [it.min_stock ?? 0, vazioParaNull(data.min_stock) ?? 0],
      lead_time_days: [it.lead_time_days ?? null, vazioParaNull(data.lead_time_days)],
      current_stock: [it.current_stock ?? 0, vazioParaNull(data.current_stock) ?? 0],
      batch_number: [it.batch_number || null, vazioParaNull(data.batch_number?.trim())],
      expiry_date: [it.expiry_date || null, vazioParaNull(data.expiry_date)],
      last_purchase_price: [it.last_purchase_price ?? null, vazioParaNull(data.last_purchase_price)],
      reference_price: [it.reference_price ?? null, vazioParaNull(data.reference_price)],
    }
    const campos: Record<string, unknown> = {}
    for (const [campo, [atual, novo]] of Object.entries(candidatos)) {
      if (!mesmoValor(atual, novo)) campos[campo] = novo
    }
    // Consumo é digitado em Un/SEMANA e guardado como média diária (÷7).
    const semanalAtual = it.avg_daily_consumption != null ? Math.round(Number(it.avg_daily_consumption) * 7 * 100) / 100 : null
    const semanalNovo = vazioParaNull(data.avg_daily_consumption) as number | null
    const semanalNovoArred = semanalNovo != null ? Math.round(Number(semanalNovo) * 100) / 100 : null
    if (!mesmoValor(semanalAtual, semanalNovoArred)) {
      campos.avg_daily_consumption = semanalNovo != null ? Number(semanalNovo) / 7 : null
    }
    return campos
  }

  // Almoxarifado: 1º clique mostra o resumo; 2º grava pela RPC auditada.
  // Devolve true quando gravou (o diálogo fecha).
  async function salvarAlmox(data: FormData): Promise<boolean> {
    const campos = camposAlterados(data)
    const hasEntry = (data.entry_quantity ?? 0) > 0
    const mexeuNoItem = Object.keys(campos).length > 0 || hasEntry

    if (!mexeuNoItem && !(podeEditarLotes && lotsDirty)) {
      setError('Nenhuma alteração para salvar.')
      return false
    }
    if (mexeuNoItem && motivo.trim().length < MOTIVO_MINIMO) {
      setError(`Informe o motivo da alteração (mínimo ${MOTIVO_MINIMO} caracteres). Ele fica registrado no histórico do item.`)
      return false
    }
    if (hasEntry && !data.acquisition_type) {
      setError('Selecione o tipo de aquisição da nova entrada')
      return false
    }
    const assinatura = JSON.stringify({
      campos,
      motivo: motivo.trim(),
      entrada: hasEntry ? [data.entry_quantity, data.acquisition_type, data.invoice_number, data.unit_price] : null,
    })
    if (mexeuNoItem && (!resumo || resumoAssinatura !== assinatura)) {
      const it = item as any
      const linhas: LinhaResumo[] = Object.entries(campos).map(([campo, depois]) => ({
        campo,
        antes: it[campo],
        depois,
      }))
      if (hasEntry) {
        linhas.push({ campo: 'entrada', antes: null, depois: `+${data.entry_quantity} ${item.unit} (${data.acquisition_type})` })
      }
      setResumo(linhas)
      setResumoAssinatura(assinatura)
      return false
    }

    if (mexeuNoItem) {
      const entrada = hasEntry
        ? {
            quantity: data.entry_quantity,
            acquisition_type: data.acquisition_type,
            invoice_number: data.invoice_number?.trim() || null,
            invoice_date: data.invoice_date || null,
            invoice_total_value: data.invoice_total_value ?? null,
            unit_price: data.unit_price ?? data.last_purchase_price ?? null,
            afm_number: data.afm_number?.trim() || null,
            supplier_cnpj: data.supplier_cnpj?.trim() || null,
            supplier_name:
              data.supplier_name?.trim() ||
              (data.acquisition_type === 'Doação' ? 'Doação' : data.acquisition_type === 'Devolução' ? 'Devolução de setor' : null),
            batch_number: data.batch_number?.trim() || null,
            expiry_date: data.expiry_date || null,
            entry_group_id: rodadaRef.current,
            nf_pendente: data.acquisition_type === 'Compra' && nfPendente,
            confirmar_parecida: confirmarParecidaRef.current,
          }
        : null
      const { error: rpcErr } = await supabase.rpc('almox_editar_item', {
        p_item_id: item.id,
        p_campos: campos,
        p_motivo: motivo.trim(),
        p_entrada: entrada,
      })
      if (rpcErr) throw rpcErr
    }

    // Lotes (só no satélite de material), pelo mesmo RPC de antes.
    if (podeEditarLotes && lotsDirty) {
      const semLocal = lots.find((l) => !l.deleted && !l.location_id)
      if (semLocal) throw new Error('Selecione o estoque de cada lote.')
      const payload = lots.map((l) => ({
        id: l.id ?? null,
        batch_number: l.batch_number?.trim() || null,
        expiry_date: l.expiry_date || null,
        quantity: Number(l.quantity) || 0,
        location_id: l.location_id,
        deleted: !!l.deleted,
      }))
      const { error: rpcErr } = await supabase.rpc('almox_editar_lotes', {
        p_item_id: item.id,
        p_lots: payload,
      })
      if (rpcErr) throw rpcErr
    }
    return true
  }

  const onSubmit = async (data: FormData) => {
    // Almox: trava que fecha na hora do clique (o disabled do botao so vale
    // depois do redesenho — um 2o clique nesse intervalo gravava de novo).
    if (ehAlmox && !trava.tentar()) return
    try {
      setLoading(true)
      setError(null)

      if (ehAlmox) {
        setParecida(null)
        if (await salvarAlmox(data)) {
          onSuccess()
          onOpenChange(false)
        }
        return
      }

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
              padronizado: !!data.padronizado,
            }
          : {
              lead_time_days: data.lead_time_days ?? null,
              // Digitado em Un/SEMANA; guardamos como média diária (÷7).
              avg_daily_consumption: (data.avg_daily_consumption != null && !Number.isNaN(data.avg_daily_consumption))
                ? data.avg_daily_consumption / 7 : null,
            }),
        current_stock: data.current_stock,
        batch_number: data.batch_number || null,
        expiry_date: data.expiry_date || null,
        last_purchase_price: data.last_purchase_price ?? null,
        reference_price: data.reference_price ?? null,
      }
      await itemsService.update(item.id, updatePayload, type)

      // 1b) Se mexeu nos lotes, grava via RPC (edita/adiciona/remove lotes e
      // recalcula o saldo por local). Na farmácia o RPC também recalcula o
      // current_stock do medicamento (soma dos lotes); no material NÃO — lá o
      // current_stock é o saldo do almoxarifado e não pode ser mexido.
      if (podeEditarLotes && lotsDirty) {
        const semLocal = lots.find((l) => !l.deleted && !l.location_id)
        if (semLocal) throw new Error('Selecione o estoque de cada lote.')
        const payload = lots.map((l) => ({
          id: l.id ?? null,
          batch_number: l.batch_number?.trim() || null,
          expiry_date: l.expiry_date || null,
          quantity: Number(l.quantity) || 0,
          location_id: l.location_id,
          deleted: !!l.deleted,
        }))
        const rpcName = type === 'pharmacy' ? 'farmacia_editar_lotes' : 'almox_editar_lotes'
        const { error: rpcErr } = await supabase.rpc(rpcName, {
          p_item_id: item.id,
          p_lots: payload,
        })
        if (rpcErr) throw rpcErr
      }

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
      const aviso = ehAlmox ? lerAvisoEntrada(e) : null
      if (aviso?.tipo === 'ja_registrada') {
        // O primeiro envio ja gravou; nada foi somado de novo.
        onSuccess()
        onOpenChange(false)
      } else if (aviso?.tipo === 'parecida') {
        setParecida(aviso.info)
      } else {
        console.error('Error editing item:', e)
        setError(getErrorMessage(e))
      }
    } finally {
      setLoading(false)
      if (ehAlmox) trava.liberar()
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

              <label className="flex items-start gap-2 cursor-pointer pt-1">
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
          )}

          {/* Lotes do item (medicamento ou material) — editar/adicionar/remover */}
          {podeEditarLotes && (
          <div className="rounded-lg border border-indigo-200 overflow-hidden">
              <div className="flex items-center justify-between gap-2 px-4 py-3 bg-indigo-50 border-b border-indigo-200">
                <div className="flex items-center gap-2 text-sm font-semibold text-indigo-900">
                  <Layers className="w-4 h-4" /> {lotesLabel}
                </div>
                <span className="text-xs text-indigo-700">Total: <strong>{totalLotes}</strong></span>
              </div>
              <div className="p-4 space-y-3 bg-white">
                <p className="text-xs text-gray-500">
                  Edite lote, validade, estoque e quantidade.{' '}
                  {type === 'pharmacy'
                    ? 'O saldo do medicamento é recalculado pela soma dos lotes ao salvar.'
                    : 'O saldo por estoque é recalculado pela soma dos lotes ao salvar (o saldo do Almoxarifado não é alterado).'}
                </p>
                {loadingLots ? (
                  <div className="flex items-center gap-2 text-sm text-gray-400 py-2"><Loader2 className="w-4 h-4 animate-spin" /> Carregando lotes...</div>
                ) : lotsVisiveis.length === 0 ? (
                  <p className="text-sm text-gray-400 py-2">Nenhum lote cadastrado. Use "Adicionar lote".</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-xs text-gray-400 uppercase border-b">
                          <th className="text-left py-1 pr-2">Lote</th>
                          <th className="text-left py-1 px-2">Validade</th>
                          <th className="text-left py-1 px-2">Estoque</th>
                          <th className="text-right py-1 px-2 w-20">Qtd</th>
                          <th className="w-8"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {lotsVisiveis.map((l) => (
                          <tr key={l._key} className="border-b last:border-0">
                            <td className="py-1 pr-2">
                              <Input value={l.batch_number} onChange={(e) => updateLot(l._key, { batch_number: e.target.value })} className="h-8 text-xs" placeholder="Lote" />
                            </td>
                            <td className="py-1 px-2">
                              <Input type="date" value={l.expiry_date} onChange={(e) => updateLot(l._key, { expiry_date: e.target.value })} className="h-8 text-xs w-36" />
                            </td>
                            <td className="py-1 px-2">
                              <select
                                value={l.location_id}
                                onChange={(e) => updateLot(l._key, { location_id: e.target.value })}
                                className="h-8 rounded-md border border-input bg-white px-2 text-xs"
                              >
                                {LOT_LOCATIONS.map((loc) => (
                                  <option key={loc.id} value={loc.id}>{loc.label}</option>
                                ))}
                              </select>
                            </td>
                            <td className="py-1 px-2">
                              <Input
                                type="number" min={0}
                                value={l.quantity === 0 ? '' : l.quantity}
                                placeholder="0"
                                onFocus={(e) => e.target.select()}
                                onChange={(e) => updateLot(l._key, { quantity: e.target.value === '' ? 0 : parseInt(e.target.value) || 0 })}
                                onWheel={(e) => e.currentTarget.blur()}
                                className="h-8 text-xs text-right w-20"
                              />
                            </td>
                            <td className="py-1 text-center">
                              <button type="button" onClick={() => removeLot(l._key)} className="text-red-500 hover:text-red-600 p-1" title="Remover lote">
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                <Button type="button" variant="outline" size="sm" onClick={addLot} className="text-indigo-700 border-indigo-300">
                  <Plus className="w-4 h-4 mr-1" /> Adicionar lote
                </Button>
              </div>
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
                  <Label htmlFor="avg_daily_consumption">Consumo Semanal (opcional)</Label>
                  <Input
                    id="avg_daily_consumption"
                    type="number"
                    min="0"
                    {...register('avg_daily_consumption', { valueAsNumber: true })}
                    className="mt-1"
                    placeholder="Ex: 40"
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    Un/semana. Só usado enquanto não há saídas; depois o sistema calcula pelos últimos 30 dias.
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

          {/* Nova entrada de estoque (opcional) — SO ALMOXARIFADO.
              Na farmacia esta secao gravava a entrada direto do navegador, FORA
              do livro-razao (stock_movements): o saldo por estoque (item_stocks)
              nao mudava e so a coluna legada subia. Nunca foi usada (as 214
              entradas de medicamento vieram da Nova Entrada) e foi fechada em
              21/09/2026 antes que alguem usasse. */}
          {!ehAlmox && (
            <div className="text-sm rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-900 p-4">
              Para dar <strong>entrada de medicamento</strong>, use <strong>Nova Entrada</strong> no estoque — é ela que
              registra lote, validade e o movimento no livro. Nota fiscal que chegou depois? Complete a entrada em
              <strong> Farmácia → Entradas</strong>.
            </div>
          )}
          {ehAlmox && (
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
              {ehAlmox && (
                <div className="text-xs rounded-md border border-amber-300 bg-amber-50 text-amber-900 p-3">
                  <strong>Atenção: esta seção SOMA ao estoque.</strong> Se a nota fiscal só chegou agora para um material
                  que <strong>já deu entrada</strong>, não preencha aqui — vá em <strong>Almoxarifado → Entradas</strong> e
                  use <strong>Completar NF</strong> na entrada que já existe.
                </div>
              )}

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
                  {ehAlmox && watch('acquisition_type') === 'Compra' && (
                    <label className="flex items-start gap-2 mt-2 text-xs text-gray-600">
                      <input type="checkbox" checked={nfPendente} onChange={(e) => setNfPendente(e.target.checked)} className="mt-0.5" />
                      <span>A NF ainda não chegou — fica como <strong>NF pendente</strong> para completar depois em Entradas.</span>
                    </label>
                  )}
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
          )}

          {ehAlmox && (
            <div className="rounded-lg border border-amber-300 overflow-hidden">
              <div className="flex items-center gap-2 px-4 py-3 bg-amber-50 border-b border-amber-200">
                <ShieldCheck className="w-4 h-4 text-amber-700" />
                <span className="text-sm font-medium text-amber-900">Motivo da alteração (obrigatório)</span>
              </div>
              <div className="p-4 space-y-3 bg-white">
                <textarea
                  value={motivo}
                  onChange={(e) => { setMotivo(e.target.value); setResumo(null) }}
                  rows={2}
                  className="w-full rounded-md border border-input bg-white px-3 py-2 text-sm"
                  placeholder="Ex.: saldo corrigido após contagem física de 16/09 com a Rafaela"
                />
                <p className="text-xs text-gray-500">
                  Fica registrado com seu nome, data e hora, junto com cada campo alterado (antes → depois).
                  O registro não pode ser editado nem apagado.
                </p>

                {resumo && (
                  <div className="rounded-md border border-amber-300 bg-amber-50 p-3">
                    <p className="text-sm font-semibold text-amber-900 mb-2">Confira antes de salvar:</p>
                    <ul className="space-y-1 text-sm">
                      {resumo.map((l) => (
                        <li key={l.campo} className="text-gray-800">
                          <strong>{l.campo === 'entrada' ? 'Nova entrada' : (ROTULO_CAMPO[l.campo] ?? l.campo)}:</strong>{' '}
                          {l.campo === 'entrada'
                            ? mostraValor(l.depois)
                            : <>{mostraValor(l.antes)} <span className="text-gray-400">→</span> <strong>{mostraValor(l.depois)}</strong></>}
                        </li>
                      ))}
                    </ul>
                    <p className="text-xs text-amber-800 mt-2">Clique em <strong>Confirmar e salvar</strong> para gravar.</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {ehAlmox && historico.length > 0 && (
            <details className="rounded-lg border border-gray-200 bg-white">
              <summary className="flex items-center gap-2 px-4 py-3 cursor-pointer text-sm font-medium text-gray-800">
                <History className="w-4 h-4 text-gray-600" />
                Histórico de edições deste item ({historico.length})
              </summary>
              <ul className="px-4 pb-4 space-y-3">
                {historico.map((h) => (
                  <li key={h.id} className="text-sm border-t border-gray-100 pt-3">
                    <p className="text-gray-900">
                      <strong>{h.usuario_nome ?? '—'}</strong>{' '}
                      <span className="text-gray-500">em {new Date(h.feito_em).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</span>
                    </p>
                    <p className="text-gray-700">Motivo: {h.motivo}</p>
                    <ul className="text-gray-600 mt-1">
                      {Object.entries(h.alteracoes ?? {}).map(([campo, v]) => (
                        <li key={campo}>
                          {ROTULO_CAMPO[campo] ?? campo}: {mostraValor(v?.antes)} → {mostraValor(v?.depois)}
                        </li>
                      ))}
                      {h.entrada?.quantity ? <li>Entrada registrada junto: +{h.entrada.quantity}</li> : null}
                    </ul>
                  </li>
                ))}
              </ul>
            </details>
          )}

          {parecida && (
            <div className="p-3 text-sm bg-amber-50 rounded-md border border-amber-300 space-y-2">
              <p className="text-amber-900"><strong>Esta entrada parece repetida.</strong> {descreverParecida(parecida)}</p>
              <p className="text-xs text-amber-800">
                Se a nota só chegou agora para esse material, não registre de novo: complete a entrada existente em
                Almoxarifado → Entradas.
              </p>
              <div className="flex gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => setParecida(null)}>Cancelar</Button>
                <Button type="button" size="sm" className="bg-amber-600 hover:bg-amber-700 text-white" disabled={loading}
                  onClick={() => { confirmarParecidaRef.current = true; setParecida(null); handleSubmit(onSubmit)() }}>
                  É outra entrada — registrar mesmo assim
                </Button>
              </div>
            </div>
          )}

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
              {ehAlmox && resumo ? 'Confirmar e salvar' : 'Salvar'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
