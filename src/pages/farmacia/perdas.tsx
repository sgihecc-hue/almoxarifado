// =====================================================================
// Perdas / Inutilização de Medicamentos
// Tabela medication_losses
// =====================================================================

import { useEffect, useState, useMemo, useRef } from 'react'
import {
  Trash2, Plus, Edit2, Search, Loader2, AlertCircle, X, FileSpreadsheet,
} from 'lucide-react'
import { saveAs } from 'file-saver'
import * as XLSX from 'xlsx'
import { Button } from '@/components/ui/button'
import { useTheme } from '@/contexts/theme'
import {
  medicationLossesService,
  type MedicationLoss,
  type CreateMedicationLossData,
  type MotivoPerda,
} from '@/lib/services/medication-losses'
import { supabase } from '@/lib/supabase'
import { getErrorMessage } from '@/lib/utils/error-messages'
import { useAuth } from '@/contexts/auth'
import { dataBR, hojeLocal, lerQuantidade } from '@/lib/utils/seguro'
import { PHARMACY_STOCKS } from '@/lib/constants/stock-locations'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface PharmacyItem {
  id: string
  name: string
  medication_class: string | null
  controlled_subclass?: string | null
}

interface LotRow {
  id: string
  batch_number: string | null
  expiry_date: string | null
  current_quantity: number
}

interface StockLocation {
  id: string
  name: string
}

const MOTIVOS: MotivoPerda[] = [
  'Vencimento', 'Quebra', 'Avaria', 'Desvio', 'Contaminação', 'Recolhimento', 'Outro',
]

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function fmtDate(d: string | null | undefined) {
  return dataBR(d)
}

function fmtDateTime(d: string | null | undefined) {
  if (!d) return '—'
  return new Date(d).toLocaleString('pt-BR')
}

// ---------------------------------------------------------------------------
// Badge
// ---------------------------------------------------------------------------
function ControladoBadge({ controlado }: { controlado: boolean | null | undefined }) {
  if (!controlado) return <span className="text-xs text-gray-400">—</span>
  return (
    <span className="inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full border bg-red-50 text-red-700 border-red-200">
      Controlado
    </span>
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------
export function Perdas() {
  const { mode } = useTheme()
  const { user } = useAuth()
  // Policies do banco: editar = administrador/gestor; excluir = administrador.
  const podeEditar = user?.role === 'administrador' || user?.role === 'gestor'
  const podeExcluir = user?.role === 'administrador'
  const salvandoRef = useRef(false)
  const chaveRef = useRef<string>(crypto.randomUUID())
  const [lots, setLots] = useState<LotRow[]>([])
  const [qtdTexto, setQtdTexto] = useState('')

  const txt    = mode === 'dark' ? '#fff' : '#0d2e1c'
  const txtSec = mode === 'dark' ? 'rgba(255,255,255,0.7)'  : 'rgba(13,46,28,0.65)'
  const txtMut = mode === 'dark' ? 'rgba(255,255,255,0.45)' : 'rgba(13,46,28,0.45)'

  const card: React.CSSProperties = {
    background: mode === 'dark' ? 'rgba(10,15,20,0.55)' : 'rgba(255,255,255,0.65)',
    backdropFilter: 'blur(30px)', WebkitBackdropFilter: 'blur(30px)',
    border: `1px solid ${mode === 'dark' ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.5)'}`,
    borderRadius: 16,
  }
  const inp: React.CSSProperties = {
    background: mode === 'dark' ? 'rgba(0,0,0,0.3)' : 'rgba(255,255,255,0.7)',
    border: `1px solid ${mode === 'dark' ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.1)'}`,
    borderRadius: 10, padding: '9px 12px', fontSize: 14,
    color: txt, outline: 'none', width: '100%',
  }
  const lbl: React.CSSProperties = {
    color: txtSec, fontSize: 11, fontWeight: 600,
    textTransform: 'uppercase' as const, letterSpacing: 0.5, display: 'block', marginBottom: 4,
  }

  // Data
  const [rows, setRows]       = useState<MedicationLoss[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState('')
  const [search, setSearch]   = useState('')
  const [filterMotivo, setFilterMotivo] = useState<MotivoPerda | ''>('')

  // Dropdown sources
  const [items, setItems] = useState<PharmacyItem[]>([])
  const [locations, setLocations] = useState<StockLocation[]>([])

  // Modal
  const [showModal, setShowModal] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [saving, setSaving]       = useState(false)
  const [formError, setFormError] = useState('')

  // ----- Form state -----
  const blankForm = (): CreateMedicationLossData => ({
    item_id: '', item_nome: '', stock_location_id: '', expiry_tracking_id: '',
    batch_number: '', expiry_date: '', quantity: 0,
    motivo: 'Vencimento', documento: '', responsavel_nome: '',
    observacao: '', is_controlado: false,
  })
  const [form, setForm] = useState<CreateMedicationLossData>(blankForm())

  // ----- Load -----
  useEffect(() => {
    load()
    loadItems()
    loadLocations()
  }, [])

  async function load() {
    setLoading(true); setError('')
    try { setRows(await medicationLossesService.getAll()) }
    catch (e: any) { setError(getErrorMessage(e)) }
    finally { setLoading(false) }
  }

  async function loadItems() {
    const { data, error: err } = await supabase
      .from('pharmacy_items')
      .select('id, name, medication_class, controlled_subclass')
      .order('name')
      .limit(2000)
    if (err) { setError('Erro ao carregar os medicamentos: ' + getErrorMessage(err)); return }
    if (data) setItems(data as PharmacyItem[])
  }

  // So estoques da farmacia (a perda baixa o saldo DO local escolhido).
  async function loadLocations() {
    setLocations(PHARMACY_STOCKS.filter((s) => s.itemType === 'pharmacy').map((s) => ({ id: s.id, name: s.name })))
  }

  // Lotes do item no local escolhido (inclui vencidos: perda por vencimento).
  useEffect(() => {
    if (!showModal || editingId || !form.item_id || !form.stock_location_id) { setLots([]); return }
    let cancel = false
    ;(async () => {
      const { data, error: err } = await supabase
        .from('expiry_tracking')
        .select('id, batch_number, expiry_date, current_quantity')
        .eq('item_id', form.item_id!)
        .eq('location_id', form.stock_location_id!)
        .gt('current_quantity', 0)
        .order('expiry_date', { ascending: true, nullsFirst: false })
      if (cancel) return
      if (err) { setFormError('Erro ao carregar os lotes: ' + getErrorMessage(err)); return }
      setLots((data || []) as LotRow[])
    })()
    return () => { cancel = true }
  }, [showModal, editingId, form.item_id, form.stock_location_id])

  // ----- Filter -----
  const filtered = useMemo(() => {
    let list = rows
    if (filterMotivo) list = list.filter(r => r.motivo === filterMotivo)
    const q = search.trim().toLowerCase()
    if (q) list = list.filter(r =>
      r.item_nome.toLowerCase().includes(q) ||
      (r.documento || '').toLowerCase().includes(q)
    )
    return list
  }, [rows, search, filterMotivo])

  // ----- Modal helpers -----
  function set<K extends keyof CreateMedicationLossData>(k: K, v: CreateMedicationLossData[K]) {
    setForm(f => ({ ...f, [k]: v }))
  }

  function openNew() {
    setEditingId(null); setForm(blankForm()); setQtdTexto(''); setLots([]); setFormError(''); setShowModal(true)
    chaveRef.current = crypto.randomUUID()
  }

  function openEdit(r: MedicationLoss) {
    setEditingId(r.id)
    setForm({
      item_id: r.item_id || '',
      item_nome: r.item_nome,
      stock_location_id: r.stock_location_id || '',
      batch_number: r.batch_number || '',
      expiry_date: r.expiry_date || '',
      quantity: r.quantity,
      motivo: r.motivo,
      documento: r.documento || '',
      responsavel_nome: r.responsavel_nome || '',
      observacao: r.observacao || '',
      is_controlado: r.is_controlado ?? false,
    })
    setQtdTexto(String(r.quantity))
    setFormError(''); setShowModal(true)
  }

  async function save() {
    if (salvandoRef.current) return
    const q = lerQuantidade(qtdTexto)
    if (!editingId) {
      if (!form.item_id) { setFormError('Item é obrigatório'); return }
      if (q === null || q <= 0) { setFormError('Quantidade deve ser um número inteiro maior que zero'); return }
      if (!form.stock_location_id) { setFormError('Local de estoque é obrigatório'); return }
      if (!form.expiry_tracking_id) { setFormError('Escolha o lote (rastreabilidade): a perda baixa o estoque desse lote'); return }
      const lot = lots.find((l) => l.id === form.expiry_tracking_id)
      if (lot && q > lot.current_quantity) { setFormError(`Quantidade maior que o saldo do lote (${lot.current_quantity})`); return }
    }
    if (!form.motivo) { setFormError('Motivo é obrigatório'); return }
    if (!form.responsavel_nome?.trim()) { setFormError('Responsável é obrigatório'); return }
    // Portaria 344/98 art.67-68: para controlados, exige número do termo + justificativa
    if (form.is_controlado) {
      if (!form.documento?.trim()) { setFormError('Para medicamentos controlados, o número do termo/ata de inutilização é obrigatório (Portaria 344/98)'); return }
      if (!form.observacao?.trim()) { setFormError('Para medicamentos controlados, a justificativa técnica é obrigatória (Portaria 344/98)'); return }
    }
    salvandoRef.current = true
    setSaving(true); setFormError('')
    try {
      if (editingId) {
        await medicationLossesService.update(editingId, form)
      } else {
        await medicationLossesService.create({ ...form, quantity: q as number }, chaveRef.current)
        chaveRef.current = crypto.randomUUID()
      }
      setShowModal(false); await load()
    } catch (e: any) { setFormError(getErrorMessage(e)) }
    finally { salvandoRef.current = false; setSaving(false) }
  }

  async function remove(r: MedicationLoss) {
    const motivo = window.prompt(
      `Excluir o registro de perda de "${r.item_nome}"?` +
      (r.movement_id ? ' A quantidade volta ao estoque e ao lote.' : '') +
      '\n\nInforme o motivo da exclusão:')
    if (motivo === null) return
    if (motivo.trim().length < 3) { setError('Informe o motivo da exclusão (mínimo 3 caracteres).'); return }
    setError('')
    try {
      await medicationLossesService.remove(r.id, motivo.trim())
      await load()
    } catch (e: any) { setError(getErrorMessage(e)) }
  }

  // ----- Export XLSX -----
  function exportXlsx() {
    try {
      const headers = [
        'Data', 'Item', 'Lote', 'Validade', 'Quantidade', 'Motivo',
        'Controlado', 'Documento', 'Local de Estoque', 'Responsável', 'Observação',
      ]
      const locName = (id: string | null) => locations.find(l => l.id === id)?.name || ''
      const body = filtered.map(r => [
        fmtDateTime(r.created_at),
        r.item_nome,
        r.batch_number || '',
        fmtDate(r.expiry_date),
        r.quantity,
        r.motivo,
        r.is_controlado ? 'Sim' : 'Não',
        r.documento || '',
        locName(r.stock_location_id),
        r.responsavel_nome || '',
        r.observacao || '',
      ])
      const aoa = [headers, ...body]
      const ws = XLSX.utils.aoa_to_sheet(aoa)
      ws['!cols'] = [
        { wch: 20 }, { wch: 30 }, { wch: 14 }, { wch: 12 }, { wch: 12 },
        { wch: 16 }, { wch: 12 }, { wch: 18 }, { wch: 20 }, { wch: 22 }, { wch: 40 },
      ]
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, 'Perdas')
      const buffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array', compression: true })
      const blob = new Blob([buffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      })
      const stamp = new Date().toISOString().slice(0, 10)
      saveAs(blob, `perdas_inutilizacao_${stamp}.xlsx`)
    } catch (e: any) {
      setError(getErrorMessage(e))
    }
  }

  // ----- Render -----
  return (
    <div className="max-w-7xl mx-auto space-y-6">

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="p-3 rounded-lg bg-red-100"><Trash2 className="w-6 h-6 text-red-600" /></div>
          <div>
            <h1 className="text-2xl font-bold" style={{ color: txt }}>Perdas / Inutilização</h1>
            <p className="text-sm" style={{ color: txtSec }}>Registro de perdas e inutilização de medicamentos</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={exportXlsx}>
            <FileSpreadsheet className="w-4 h-4 mr-2" /> Exportar XLSX
          </Button>
          <Button onClick={openNew} className="bg-red-600 hover:bg-red-700 text-white">
            <Plus className="w-4 h-4 mr-2" /> Nova Perda
          </Button>
        </div>
      </div>

      {error && (
        <div className="p-3 rounded-lg bg-red-100 border border-red-200 text-red-800 text-sm flex items-center gap-2">
          <AlertCircle size={16} /> {error}
        </div>
      )}

      {/* Filters */}
      <div className="p-4 flex flex-wrap gap-3 items-center" style={card}>
        <div className="relative flex-1 min-w-[200px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: txtMut }} />
          <input
            placeholder="Buscar por item ou documento..."
            value={search} onChange={e => setSearch(e.target.value)}
            style={{ ...inp, paddingLeft: 34 }}
          />
        </div>
        <select
          value={filterMotivo}
          onChange={e => setFilterMotivo(e.target.value as MotivoPerda | '')}
          style={{ ...inp, width: 'auto', minWidth: 180 }}
        >
          <option value="">Todos os motivos</option>
          {MOTIVOS.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
      </div>

      {/* Table */}
      <div className="overflow-x-auto" style={card}>
        {loading ? (
          <div className="flex items-center justify-center p-10" style={{ color: txtMut }}>
            <Loader2 className="w-5 h-5 animate-spin mr-2" /> Carregando...
          </div>
        ) : filtered.length === 0 ? (
          <p className="p-8 text-sm text-center" style={{ color: txtMut }}>Nenhum registro encontrado.</p>
        ) : (
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr style={{ background: mode === 'dark' ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)' }}>
                {['Data','Item','Lote','Validade','Quantidade','Motivo','Controlado','Documento','Ações'].map(h => (
                  <th key={h} className="text-left px-3 py-3 text-xs font-semibold uppercase whitespace-nowrap" style={{ color: txtSec }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(r => (
                <tr
                  key={r.id}
                  style={{ borderTop: `1px solid ${mode === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)'}` }}
                >
                  <td className="px-3 py-3 whitespace-nowrap" style={{ color: txtSec }}>{fmtDateTime(r.created_at)}</td>
                  <td className="px-3 py-3 font-medium" style={{ color: txt }}>{r.item_nome}</td>
                  <td className="px-3 py-3" style={{ color: txtSec }}>{r.batch_number || '—'}</td>
                  <td className="px-3 py-3 whitespace-nowrap" style={{ color: txtSec }}>{fmtDate(r.expiry_date)}</td>
                  <td className="px-3 py-3 text-center" style={{ color: txtSec }}>{r.quantity}</td>
                  <td className="px-3 py-3" style={{ color: txtSec }}>{r.motivo}</td>
                  <td className="px-3 py-3"><ControladoBadge controlado={r.is_controlado} /></td>
                  <td className="px-3 py-3" style={{ color: txtSec }}>{r.documento || '—'}</td>
                  <td className="px-3 py-3">
                    <div className="flex items-center gap-1">
                      {podeEditar && (
                        <Button variant="outline" size="sm" onClick={() => openEdit(r)} className="h-7 px-2" title="Editar textos da perda">
                          <Edit2 size={13} />
                        </Button>
                      )}
                      {podeExcluir && (
                        <Button variant="ghost" size="sm" onClick={() => remove(r)} className="h-7 px-2 text-red-600 hover:text-red-700">
                          <Trash2 size={13} />
                        </Button>
                      )}
                      {!podeEditar && !podeExcluir && <span className="text-xs text-gray-400">—</span>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-start justify-center p-4 overflow-y-auto" style={{ background: 'rgba(0,0,0,0.55)' }}>
          <div className="w-full max-w-3xl my-6 p-6 space-y-5" style={{
            background: mode === 'dark' ? 'rgba(10,15,20,0.95)' : 'rgba(255,255,255,0.97)',
            backdropFilter: 'blur(40px)', WebkitBackdropFilter: 'blur(40px)',
            border: `1px solid ${mode === 'dark' ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.08)'}`,
            borderRadius: 18,
          }}>
            {/* Modal header */}
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold" style={{ color: txt }}>
                {editingId ? 'Editar Perda' : 'Nova Perda / Inutilização'}
              </h2>
              <button onClick={() => setShowModal(false)} style={{ color: txtMut }}><X size={18} /></button>
            </div>

            {formError && (
              <div className="p-2 rounded bg-red-100 border border-red-200 text-red-800 text-sm">{formError}</div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Field label="Item *" style={lbl}>
                <select
                  value={form.item_id || ''}
                  disabled={!!editingId}
                  onChange={e => {
                    const id = e.target.value
                    const item = items.find(i => i.id === id)
                    set('item_id', id)
                    set('expiry_tracking_id', '')
                    if (item) {
                      set('item_nome', item.name)
                      // mesmo criterio do banco: subclasse da Portaria 344 ou classe controlados
                      set('is_controlado', item.medication_class === 'controlados' || !!item.controlled_subclass)
                    }
                  }}
                  style={inp as any}
                >
                  <option value="">— selecionar item —</option>
                  {items.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
                </select>
              </Field>
              <Field label="Local de estoque" style={lbl}>
                <select
                  value={form.stock_location_id || ''}
                  disabled={!!editingId}
                  onChange={e => { set('stock_location_id', e.target.value); set('expiry_tracking_id', '') }}
                  style={inp as any}
                >
                  <option value="">— selecionar local —</option>
                  {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                </select>
              </Field>
              {editingId ? (
                <Field label="Lote / Validade" style={lbl}>
                  <input value={`${form.batch_number || '—'} · ${fmtDate(form.expiry_date)}`} disabled style={inp} />
                </Field>
              ) : (
                <Field label="Lote *" style={lbl}>
                  <select
                    value={form.expiry_tracking_id || ''}
                    onChange={e => set('expiry_tracking_id', e.target.value)}
                    style={inp as any}
                    disabled={!form.item_id || !form.stock_location_id}
                  >
                    <option value="">{!form.item_id || !form.stock_location_id ? '— escolha item e local —' : lots.length === 0 ? 'Sem lote com saldo neste local' : '— selecionar lote —'}</option>
                    {lots.map(l => (
                      <option key={l.id} value={l.id}>
                        {l.expiry_date && l.expiry_date < hojeLocal() ? '⚠ VENCIDO · ' : ''}Lote {l.batch_number || '(sem número)'} · Val {fmtDate(l.expiry_date)} · {l.current_quantity} un
                      </option>
                    ))}
                  </select>
                </Field>
              )}
              <Field label="Quantidade *" style={lbl}>
                <input
                  type="text" inputMode="numeric"
                  value={qtdTexto}
                  disabled={!!editingId}
                  onChange={e => setQtdTexto(e.target.value)}
                  style={inp}
                />
              </Field>
              <Field label="Motivo *" style={lbl}>
                <select value={form.motivo} onChange={e => set('motivo', e.target.value)} style={inp as any}>
                  {MOTIVOS.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
              </Field>
              <Field label="Documento (nº termo / ata)" style={lbl}>
                <input value={form.documento || ''} onChange={e => set('documento', e.target.value)} style={inp} />
              </Field>
              <Field label="Responsável" style={lbl}>
                <input value={form.responsavel_nome || ''} onChange={e => set('responsavel_nome', e.target.value)} style={inp} />
              </Field>
            </div>

            <label className="flex items-center gap-2 text-sm" style={{ color: txtSec }}>
              <input type="checkbox" checked={!!form.is_controlado} disabled onChange={() => undefined} />
              Medicamento controlado (definido pelo cadastro do item)
            </label>

            <Field label="Observação" style={lbl}>
              <textarea rows={2} value={form.observacao || ''} onChange={e => set('observacao', e.target.value)} style={{ ...inp, resize: 'vertical' as const }} />
            </Field>

            {/* Actions */}
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setShowModal(false)}>Cancelar</Button>
              <Button onClick={save} disabled={saving} className="bg-red-600 hover:bg-red-700 text-white">
                {saving && <Loader2 size={14} className="mr-2 animate-spin" />} Salvar
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------
function Field({ label, style, children }: { label: string; style: React.CSSProperties; children: React.ReactNode }) {
  return (
    <div>
      <label style={style}>{label}</label>
      {children}
    </div>
  )
}
