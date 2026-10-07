import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Loader2, FileText, Pencil, Barcode, Layers, Plus, Trash2, History, ShieldCheck, PackagePlus, ListChecks, AlertCircle } from 'lucide-react'
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
import { useTravaEnvio } from '@/lib/utils/entradas'
import { lerQuantidade } from '@/lib/utils/seguro'
import type { Item, ItemCategory, UnitType } from '@/lib/services/items'
import { MEDICATION_CLASS_LABEL, CONTROLLED_SUBCLASSES } from '@/lib/types/farmacia'
import type { MedicationClass } from '@/lib/types/farmacia'
import { PHARMACY_STOCKS, pharmacyStockById } from '@/lib/constants/stock-locations'

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
//
// 28/09/2026: o Editar Item NÃO registra mais entrada de estoque. A seção
// "Registrar nova entrada de estoque" que ficava aqui criava lançamentos novos
// quando a pessoa queria CORRIGIR um lançamento (22 entradas de material desde
// 21/09 vieram por ali, uma NF de 10 linhas com o total da nota em cada linha,
// lote/validade antigos apagados). No lugar: botões para a Nova Entrada e para
// a tela Entradas.
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
  // Texto do campo (vazio fica vazio); validado como inteiro ao salvar.
  quantity: string
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
  // Opcional: com o campo travado (item com movimentação) o valor pode vir
  // vazio; as gravações usam a unidade atual do item nesse caso.
  unit: z.string().optional(),
  min_stock: z.preprocess(
    (v) => (v === '' || v === null || v === undefined || (typeof v === 'number' && isNaN(v)) ? 0 : Number(v)),
    z.number().min(0),
  ),
  // Só o Almoxarifado central edita o saldo aqui (com motivo). Inteiro.
  current_stock: z.preprocess(
    (v) => (v === '' || v === null || v === undefined || (typeof v === 'number' && isNaN(v)) ? 0 : Number(v)),
    z.number().int('Estoque deve ser um número inteiro').min(0, 'Estoque deve ser maior ou igual a 0'),
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
  nao_padronizado: z.boolean().optional(),
})

type FormData = z.infer<typeof schema>

interface EditItemDialogProps {
  item: Item
  /**
   * Catálogo do item: 'pharmacy' = pharmacy_items, 'warehouse' = warehouse_items.
   * Material aberto numa tela de farmácia (Satélite Térreo) é 'warehouse'.
   */
  type: 'pharmacy' | 'warehouse'
  // Material: o editor de lotes so faz sentido num SATELITE (SAT_T), que tem
  // saldo por local. O Almoxarifado central controla saldo global, sem lote por
  // local — para ele a tela segue exatamente como era, sem este bloco.
  // Medicamento ignora esta prop: sempre teve o editor.
  allowLotEdit?: boolean
  /** Estoque (stock_locations.id) de onde o diálogo foi aberto, quando houver. */
  locationId?: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess: () => void
}

const unitOptions = [
  'Un','Pc','Cx','Fr','Amp','Tb','Rl','Lt','Kg','Gl','ml','g','Pr','Cj','Sc','Rm','Ct','FL',
]

type SaldoLocal = { location_id: string; quantity: number }

export function EditItemDialog({ item, type, allowLotEdit = false, locationId, open, onOpenChange, onSuccess }: EditItemDialogProps) {
  const navigate = useNavigate()
  // Medicamento sempre teve o editor de lotes. Material so mostra quando a tela
  // que abriu o dialogo esta num satelite (passa allowLotEdit) — o Almoxarifado
  // central nao passa, entao nada muda para ele.
  const podeEditarLotes = type === 'pharmacy' || allowLotEdit
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [scanningBarcode, setScanningBarcode] = useState(false)
  const ehAlmox = type === 'warehouse'
  // Material aberto num satélite (SAT_T): o current_stock do cadastro é o
  // saldo do ALMOXARIFADO, não do satélite. Aqui ele não é editável — antes a
  // edição no satélite mexia no saldo do Almox.
  const localSatelite = ehAlmox && allowLotEdit
    ? (locationId ?? LOT_LOCATIONS_WAREHOUSE[0]?.id ?? null)
    : null
  // Só o Almoxarifado central edita "Estoque Atual" aqui (autorizado em 16/09,
  // com motivo e registro imutável). Farmácia e satélite: saldo só leitura.
  const editaSaldo = ehAlmox && !localSatelite
  const [motivo, setMotivo] = useState('')
  const [resumo, setResumo] = useState<LinhaResumo[] | null>(null)
  // Assinatura do que foi conferido no resumo (campos + motivo). O 2º clique
  // só grava se nada mudou desde o resumo. NÃO usar watch(callback) para limpar
  // o resumo: no react-hook-form 7.56 ele dispara no próprio submit.
  const [resumoAssinatura, setResumoAssinatura] = useState<string | null>(null)
  const trava = useTravaEnvio()
  // Retry depois de erro parcial (item gravou, lotes não): guarda o que já foi
  // gravado para não reenviar (o banco respondia "Nenhuma alteração" e os
  // lotes nunca eram salvos).
  const itemGravadoRef = useRef<string | null>(null)
  const [historico, setHistorico] = useState<EdicaoRegistrada[]>([])
  const barcodeInputRef = useRef<HTMLInputElement>(null)

  // Saldo real (item_stocks) só para exibir; e se o item já tem movimentação
  // (unidade não pode ser trocada). catalogoErrado: o item não está no
  // catálogo informado (ex.: material da Satélite Térreo aberto como remédio).
  const [saldos, setSaldos] = useState<SaldoLocal[] | null>(null)
  const [erroSaldos, setErroSaldos] = useState<string | null>(null)
  const [temMovimento, setTemMovimento] = useState(false)
  const [catalogoErrado, setCatalogoErrado] = useState(false)

  useEffect(() => {
    if (!open) return
    itemGravadoRef.current = null
    setError(null)
    let vivo = true
    ;(async () => {
      try {
        const tabela = type === 'pharmacy' ? 'pharmacy_items' : 'warehouse_items'
        const [noCatalogo, ent, mov, est] = await Promise.all([
          supabase.from(tabela).select('id').eq('id', item.id).maybeSingle(),
          supabase.from('stock_entries').select('id', { count: 'exact', head: true }).eq('item_id', item.id),
          supabase.from('stock_movements').select('id', { count: 'exact', head: true }).eq('item_id', item.id),
          supabase.from('item_stocks').select('location_id, quantity').eq('item_id', item.id).eq('item_type', type),
        ])
        if (!vivo) return
        if (noCatalogo.error) throw noCatalogo.error
        setCatalogoErrado(!noCatalogo.data)
        if (est.error) throw est.error
        const lista = (est.data ?? []) as SaldoLocal[]
        setSaldos(lista)
        setErroSaldos(null)
        setTemMovimento(
          (item.current_stock ?? 0) !== 0 || (ent.count ?? 0) > 0 || (mov.count ?? 0) > 0 ||
          lista.some((s) => Number(s.quantity) !== 0),
        )
      } catch (e) {
        if (!vivo) return
        setSaldos(null)
        setErroSaldos(getErrorMessage(e))
        // Sem saber, trata como "tem movimento" (o banco recusa de qualquer jeito).
        setTemMovimento(true)
      }
    })()
    return () => { vivo = false }
  }, [open, item.id, type, item.current_stock])

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
  const [erroLots, setErroLots] = useState<string | null>(null)
  const [lotsDirty, setLotsDirty] = useState(false)

  // Estoque ao qual o editor de lotes fica preso (quando a tela veio de um estoque).
  const estoqueDosLotes = locationId && LOT_LOCATIONS.some((l) => l.id === locationId) ? locationId : null
  const nomeEstoqueDosLotes = estoqueDosLotes ? LOT_LOCATIONS.find((l) => l.id === estoqueDosLotes)?.label : null

  useEffect(() => {
    if (!open || !podeEditarLotes) { setLots([]); setLotsDirty(false); return }
    let alive = true
    ;(async () => {
      setLoadingLots(true)
      setErroLots(null)
      const { data, error: err } = await supabase
        .from('expiry_tracking')
        .select('id, batch_number, expiry_date, current_quantity, location_id')
        .eq('item_id', item.id)
        // 30/09/2026: aberto a partir de um estoque (ex.: Satélite 1), mostra e
        // edita SÓ os lotes dele — antes vinham os lotes de todas as farmácias.
        .match(estoqueDosLotes ? { location_id: estoqueDosLotes } : {})
        .order('expiry_date', { ascending: true, nullsFirst: false })
      if (!alive) return
      if (err) {
        // Lista vazia por erro faria "Salvar" apagar/recriar lotes: mostra o erro.
        setErroLots(getErrorMessage(err))
        setLots([])
      } else {
        setLots((data || []).map((r: any) => ({
          _key: r.id,
          id: r.id,
          batch_number: r.batch_number || '',
          expiry_date: r.expiry_date || '',
          quantity: String(r.current_quantity ?? 0),
          location_id: r.location_id || LOT_LOCATIONS[0].id,
        })))
      }
      setLotsDirty(false)
      setLoadingLots(false)
    })()
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id, open, type, estoqueDosLotes])

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
      _key: newKey(), batch_number: '', expiry_date: '', quantity: '', location_id: estoqueDosLotes ?? LOT_LOCATIONS[0].id,
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
  const totalLotes = lotsVisiveis.reduce((s, l) => s + (lerQuantidade(l.quantity) ?? 0), 0)

  // Payload dos lotes validado (inteiro >= 0). Lança erro com mensagem clara.
  function payloadLotes() {
    for (const l of lots) {
      if (l.deleted) continue
      if (!l.location_id) throw new Error('Selecione o estoque de cada lote.')
      const q = lerQuantidade(l.quantity === '' ? '0' : l.quantity)
      if (q === null || q < 0) throw new Error(`Quantidade inválida no lote ${l.batch_number || '(sem número)'}: use número inteiro.`)
    }
    return lots.map((l) => ({
      id: l.id ?? null,
      batch_number: l.batch_number?.trim() || null,
      expiry_date: l.expiry_date || null,
      quantity: lerQuantidade(l.quantity === '' ? '0' : l.quantity) ?? 0,
      location_id: l.location_id,
      deleted: !!l.deleted,
    }))
  }

  const valoresDoItem = (): Partial<FormData> => ({
    code: item.code ?? '',
    barcode: (item as any).barcode || '',
    name: item.name,
    description: item.description || '',
    category: item.category ?? '',
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
    nao_padronizado: (item as any).nao_padronizado ?? false,
  })

  const { register, handleSubmit, formState: { errors }, reset, watch, setValue } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: valoresDoItem(),
  })

  // Recarrega valores quando trocar de item
  useEffect(() => {
    reset(valoresDoItem())
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
      unit: [it.unit ?? null, vazioParaNull(data.unit ?? it.unit)],
      min_stock: [it.min_stock ?? 0, vazioParaNull(data.min_stock) ?? 0],
      lead_time_days: [it.lead_time_days ?? null, vazioParaNull(data.lead_time_days)],
      batch_number: [it.batch_number || null, vazioParaNull(data.batch_number?.trim())],
      expiry_date: [it.expiry_date || null, vazioParaNull(data.expiry_date)],
      last_purchase_price: [it.last_purchase_price ?? null, vazioParaNull(data.last_purchase_price)],
      reference_price: [it.reference_price ?? null, vazioParaNull(data.reference_price)],
    }
    // Saldo só no Almoxarifado central (no satélite o campo é o saldo do Almox).
    if (editaSaldo) {
      candidatos.current_stock = [it.current_stock ?? 0, vazioParaNull(data.current_stock) ?? 0]
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
  // Devolve true quando gravou tudo (o diálogo fecha).
  async function salvarAlmox(data: FormData): Promise<boolean> {
    const campos = camposAlterados(data)
    const assinatura = JSON.stringify({ campos, motivo: motivo.trim() })
    // Retry: o item já foi gravado com exatamente estes campos; só faltam os lotes.
    const itemJaGravado = itemGravadoRef.current === assinatura
    const mexeuNoItem = Object.keys(campos).length > 0 && !itemJaGravado

    if (!mexeuNoItem && !(podeEditarLotes && lotsDirty)) {
      setError(itemJaGravado ? null : 'Nenhuma alteração para salvar.')
      return itemJaGravado
    }
    if (mexeuNoItem && motivo.trim().length < MOTIVO_MINIMO) {
      setError(`Informe o motivo da alteração (mínimo ${MOTIVO_MINIMO} caracteres). Ele fica registrado no histórico do item.`)
      return false
    }
    if (mexeuNoItem && (!resumo || resumoAssinatura !== assinatura)) {
      const it = item as any
      setResumo(Object.entries(campos).map(([campo, depois]) => ({ campo, antes: it[campo], depois })))
      setResumoAssinatura(assinatura)
      return false
    }
    const lotes = podeEditarLotes && lotsDirty ? payloadLotes() : null

    if (mexeuNoItem) {
      const { error: rpcErr } = await supabase.rpc('almox_editar_item', {
        p_item_id: item.id,
        p_campos: campos,
        p_motivo: motivo.trim(),
        p_entrada: null,
      })
      if (rpcErr) throw rpcErr
      itemGravadoRef.current = assinatura
    }

    // Lotes (só no satélite de material), pelo mesmo RPC de antes.
    if (lotes) {
      const { error: rpcErr } = await supabase.rpc('almox_editar_lotes', {
        p_item_id: item.id,
        p_lots: lotes,
      })
      if (rpcErr) {
        throw new Error(mexeuNoItem || itemJaGravado
          ? `Os dados do item foram salvos, mas os lotes não: ${getErrorMessage(rpcErr)}. Corrija e clique em Salvar de novo (só os lotes serão enviados).`
          : getErrorMessage(rpcErr))
      }
    }
    return true
  }

  // Farmácia: dados do cadastro + lotes. O saldo NÃO é enviado: o campo
  // current_stock lido na abertura era gravado de volta e desfazia saídas
  // feitas no meio (editar só o nome voltava o saldo antigo).
  async function salvarFarmacia(data: FormData) {
    const lotes = podeEditarLotes && lotsDirty ? payloadLotes() : null
    const updatePayload: any = {
      code: data.code,
      barcode: data.barcode?.trim() || null,
      name: data.name,
      description: data.description || null,
      category: data.category as ItemCategory,
      unit: (data.unit ?? item.unit) as UnitType,
      min_stock: data.min_stock,
      avg_monthly_consumption: data.avg_monthly_consumption ?? null,
      // Classes do medicamento (default uso_geral se nada marcado). O
      // service sincroniza medication_class (single) com a 1ª do array.
      medication_classes: selectedClasses.length > 0 ? selectedClasses : ['uso_geral'],
      controlled_subclass: hasControlados ? (data.controlled_subclass ?? null) : null,
      // As duas marcas são excludentes: não padronizado vence.
      padronizado: !!data.padronizado && !data.nao_padronizado,
      nao_padronizado: !!data.nao_padronizado,
      batch_number: data.batch_number || null,
      expiry_date: data.expiry_date || null,
      last_purchase_price: data.last_purchase_price ?? null,
      reference_price: data.reference_price ?? null,
    }
    // itemsService.update recusa quando nenhuma linha muda (RLS/catálogo errado).
    await itemsService.update(item.id, updatePayload, 'pharmacy')

    // Lotes: edita/adiciona/remove e recalcula o saldo por local (livro).
    if (lotes) {
      const { error: rpcErr } = await supabase.rpc('farmacia_editar_lotes', {
        p_item_id: item.id,
        p_lots: lotes,
      })
      if (rpcErr) throw new Error(`Os dados do item foram salvos, mas os lotes não: ${getErrorMessage(rpcErr)}. Corrija e clique em Salvar de novo.`)
    }
  }

  const onSubmit = async (data: FormData) => {
    // Trava que fecha na hora do clique (o disabled do botao so vale depois
    // do redesenho — um 2o clique nesse intervalo gravava de novo).
    if (!trava.tentar()) return
    try {
      setLoading(true)
      setError(null)
      if (catalogoErrado) {
        setError('Este item não está no catálogo desta tela, então nada seria salvo. Abra-o pela tela do estoque dele (material: Almoxarifado / Satélite Térreo).')
        return
      }
      if (ehAlmox) {
        if (await salvarAlmox(data)) {
          onSuccess()
          onOpenChange(false)
        }
        return
      }
      await salvarFarmacia(data)
      onSuccess()
      onOpenChange(false)
    } catch (e: any) {
      console.error('Error editing item:', e)
      setError(getErrorMessage(e))
    } finally {
      setLoading(false)
      trava.liberar()
    }
  }

  // Para onde vão os botões de entrada (rotas de App.tsx).
  const codigoLocal = pharmacyStockById(locationId)?.code
  const rotaNovaEntrada = ehAlmox
    ? `/inventory/warehouse/nf-entry?loc=${localSatelite ? (pharmacyStockById(localSatelite)?.code ?? 'SAT_T') : 'ALMOX'}&item=${item.id}`
    : `/inventory/pharmacy/nf-entry?loc=${codigoLocal && codigoLocal !== 'SAT_T' ? codigoLocal : 'CAF'}&item=${item.id}`
  const rotaEntradas = ehAlmox ? '/almox/entradas' : '/farmacia/entradas'
  const ir = (rota: string) => { onOpenChange(false); navigate(rota) }

  const nomeLocal = (id: string) => pharmacyStockById(id)?.label ?? (ehAlmox ? 'Almoxarifado' : 'Estoque')
  const saldoDoLocal = (id: string | null) => (saldos ?? []).find((s) => s.location_id === id)?.quantity ?? 0

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[640px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Pencil className="w-5 h-5 text-amber-600" />
            Editar Item — {item.name.slice(0, 60)}{item.name.length > 60 ? '…' : ''}
          </DialogTitle>
          <p className="text-sm text-gray-500 mt-1">
            Atualize os dados do cadastro do item. Entrada de estoque não é feita aqui.
          </p>
        </DialogHeader>

        {/* Entrada de estoque: sai daqui, vai para as telas próprias. */}
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900 space-y-2">
          <p className="flex items-start gap-2">
            <FileText className="w-4 h-4 mt-0.5 shrink-0" />
            <span>
              Chegou {ehAlmox ? 'material' : 'medicamento'}? Registre pela <strong>Nova Entrada</strong> (NF, lote, validade e local).
              Uma entrada já lançada está errada? Corrija em <strong>Entradas</strong> — lá o estoque acompanha a correção.
            </span>
          </p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" className="bg-emerald-600 hover:bg-emerald-700 text-white gap-1" onClick={() => ir(rotaNovaEntrada)}>
              <PackagePlus className="w-4 h-4" /> Registrar entrada de NF
            </Button>
            <Button type="button" size="sm" variant="outline" className="gap-1" onClick={() => ir(rotaEntradas)}>
              <ListChecks className="w-4 h-4" /> Corrigir uma entrada já lançada
            </Button>
          </div>
        </div>

        {catalogoErrado && (
          <div className="p-3 text-sm rounded-md border border-red-300 bg-red-50 text-red-800 flex items-start gap-2">
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
            <span>
              Este item não é do catálogo de {type === 'pharmacy' ? 'medicamentos' : 'materiais'} — nada seria salvo por aqui.
              {type === 'pharmacy' && ' Material da Satélite Térreo é editado pelo catálogo de materiais.'}
            </span>
          </div>
        )}

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
              <label className="flex items-start gap-2 cursor-pointer pt-1">
                <input
                  type="checkbox"
                  {...register('nao_padronizado')}
                  className="w-4 h-4 mt-0.5 flex-shrink-0 accent-orange-500"
                />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-orange-700">Medicamento NÃO padronizado</div>
                  <p className="text-xs text-gray-500 mt-0.5">
                    Marcado, a linha do item fica laranja na tela de estoque.
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
                  <Layers className="w-4 h-4" /> {lotesLabel}{nomeEstoqueDosLotes ? ` — ${nomeEstoqueDosLotes}` : ''}
                </div>
                <span className="text-xs text-indigo-700">{nomeEstoqueDosLotes ? `Total em ${nomeEstoqueDosLotes}: ` : 'Total: '}<strong>{totalLotes}</strong></span>
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
                ) : erroLots ? (
                  <p className="text-sm text-red-600 py-2">Não foi possível carregar os lotes: {erroLots}. Feche e abra de novo antes de mexer nos lotes.</p>
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
                                disabled={!!estoqueDosLotes}
                                title={estoqueDosLotes ? 'Os lotes ficam no estoque em que você está. Para mudar de estoque use Transferência.' : undefined}
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
                                type="text" inputMode="numeric"
                                value={l.quantity}
                                placeholder="0"
                                onFocus={(e) => e.target.select()}
                                onChange={(e) => updateLot(l._key, { quantity: e.target.value })}
                                onWheel={(e) => e.currentTarget.blur()}
                                className={`h-8 text-xs text-right w-20 ${l.quantity !== '' && lerQuantidade(l.quantity) === null ? 'border-red-400' : ''}`}
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
                <Button type="button" variant="outline" size="sm" onClick={addLot} disabled={!!erroLots} className="text-indigo-700 border-indigo-300">
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
                disabled={temMovimento}
                className="w-full mt-1 h-9 rounded-md border border-input px-3 py-1 bg-white disabled:bg-gray-100 disabled:text-gray-500"
              >
                {/* Unidade fora da lista (cadastro antigo) continua aparecendo. */}
                {!unitOptions.includes(item.unit) && item.unit && <option value={item.unit}>{item.unit}</option>}
                {unitOptions.map((u) => (
                  <option key={u} value={u}>{u}</option>
                ))}
              </select>
              {temMovimento && (
                <p className="text-xs text-gray-500 mt-1">
                  Não dá para trocar: o item já tem movimentação ou saldo. Se a unidade está errada, cadastre um item novo.
                </p>
              )}
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

          {editaSaldo ? (
            <div className="p-4 bg-blue-50 rounded-lg border border-blue-200">
              <Label htmlFor="current_stock" className="text-blue-900 font-semibold">Estoque Atual (Almoxarifado)</Label>
              <p className="text-xs text-blue-600 mb-2">
                Saldo no sistema. Altere só para corrigir após contagem — fica registrado com o motivo.
                Não use este campo para lançar entrada.
              </p>
              <Input
                id="current_stock"
                type="number"
                min="0"
                step="1"
                {...register('current_stock', { valueAsNumber: true })}
                className="bg-white"
              />
              {errors.current_stock && <p className="text-sm text-red-500 mt-1">{errors.current_stock.message}</p>}
            </div>
          ) : (
            <div className="p-4 bg-gray-50 rounded-lg border border-gray-200 text-sm">
              <p className="font-semibold text-gray-900">
                {localSatelite ? `Saldo na ${nomeLocal(localSatelite)}` : 'Saldo por estoque'}
              </p>
              {erroSaldos ? (
                <p className="text-red-600 mt-1">Não foi possível carregar o saldo: {erroSaldos}</p>
              ) : saldos === null ? (
                <p className="text-gray-400 mt-1 flex items-center gap-2"><Loader2 className="w-3.5 h-3.5 animate-spin" /> carregando…</p>
              ) : localSatelite ? (
                <p className="mt-1 text-gray-800"><strong>{saldoDoLocal(localSatelite)}</strong> {item.unit}</p>
              ) : (
                <ul className="mt-1 text-gray-800 flex flex-wrap gap-x-4 gap-y-1">
                  {LOT_LOCATIONS_PHARMACY.map((loc) => (
                    <li key={loc.id} className={loc.id === locationId ? 'font-semibold' : ''}>
                      {loc.label}: <strong>{saldoDoLocal(loc.id)}</strong> {item.unit}
                    </li>
                  ))}
                </ul>
              )}
              <p className="text-xs text-gray-500 mt-2">
                Só leitura. Ajuste de saldo é feito por movimentação{podeEditarLotes ? ' ou pelos lotes acima' : ''}.
              </p>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <Label htmlFor="batch_number">Lote (cadastro)</Label>
              <Input id="batch_number" {...register('batch_number')} className="mt-1" />
            </div>
            <div>
              <Label htmlFor="expiry_date">Validade (cadastro)</Label>
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
                          <strong>{ROTULO_CAMPO[l.campo] ?? l.campo}:</strong>{' '}
                          {mostraValor(l.antes)} <span className="text-gray-400">→</span> <strong>{mostraValor(l.depois)}</strong>
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
            <Button type="submit" disabled={loading || catalogoErrado}>
              {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {ehAlmox && resumo ? 'Confirmar e salvar' : 'Salvar'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
