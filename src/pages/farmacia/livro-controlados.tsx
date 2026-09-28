// =====================================================================
// Livro de Registro Específico de Controlados
// Portaria SVS/MS 344/98 — FASE 12 do redesenho da Farmácia
// =====================================================================

import { useEffect, useState, useMemo, useRef } from 'react'
import {
  BookOpen, Printer, Lock, Unlock, Loader2, AlertCircle, X,
  ChevronLeft, ChevronRight,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useTheme } from '@/contexts/theme'
import { useAuth } from '@/contexts/auth'
import { supabase } from '@/lib/supabase'
import { getErrorMessage } from '@/lib/utils/error-messages'
import { hojeLocal, dataBR, buscarTodas } from '@/lib/utils/seguro'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type Lista = 'A1_A2' | 'A3_B1_B2' | 'C1_C2_C4_C5' | 'C3' | 'antimicrobianos'

const LISTAS: { value: Lista; label: string; sublabel: string }[] = [
  { value: 'A1_A2',        label: 'A1 / A2',             sublabel: 'Entorpecentes / Psicotrópicos' },
  { value: 'A3_B1_B2',     label: 'A3 / B1 / B2',        sublabel: 'Psicotrópicos / Barbitúricos / Anfetamínicos' },
  { value: 'C1_C2_C4_C5',  label: 'C1 / C2 / C4 / C5',  sublabel: 'Outras substâncias sujeitas a controle' },
  { value: 'C3',           label: 'C3',                   sublabel: 'Imunossupressores' },
  { value: 'antimicrobianos', label: 'Antimicrobianos',   sublabel: 'Portaria 2.616/98 MS' },
]

interface LivroRow {
  id: string
  lista: Lista
  numero_livro: number
  termo_abertura_data: string
  termo_abertura_texto: string | null
  termo_encerramento_data: string | null
  responsavel_tecnico_nome: string | null
  responsavel_tecnico_crf: string | null
}

// Linha devolvida pela RPC livro_controlados_movimentos (filtra lista/item/
// periodo no banco, pagina e calcula o saldo apos cada movimento).
interface MovRow {
  id: string
  performed_at: string
  livro_seq: number | null
  movement_type: string
  direction: 'in' | 'out'
  quantity: number
  item_id: string
  item_nome: string
  item_codigo: string | null
  subclasse: string | null
  lote: string | null
  validade: string | null
  local_codigo: string | null
  historico: string | null
  saldo_depois: number | null
  total: number
}

interface ItemOpt { id: string; name: string; medication_class: string | null; controlled_subclass: string | null }

// Saida que e PERDA/inutilizacao no livro (coluna propria).
function ehPerda(m: MovRow): boolean {
  return m.direction === 'out' && m.movement_type === 'SAIDA_AVULSA' && /perda|vencimento|quebra/i.test(m.historico ?? '')
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function fmtDate(d: string | null | undefined) {
  return dataBR(d)
}

function subclassMatchesList(subclass: string | null | undefined, lista: Lista): boolean {
  if (!subclass) return lista === 'antimicrobianos'
  const s = subclass.toUpperCase()
  if (lista === 'A1_A2')       return s === 'A1' || s === 'A2'
  if (lista === 'A3_B1_B2')    return s === 'A3' || s === 'B1' || s === 'B2'
  if (lista === 'C1_C2_C4_C5') return s === 'C1' || s === 'C2' || s === 'C4' || s === 'C5'
  if (lista === 'C3')          return s === 'C3'
  return false
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------
export function LivroControlados() {
  const { mode } = useTheme()
  const { user } = useAuth()
  const printRef = useRef<HTMLDivElement>(null)

  const isAdminGestor = user?.role === 'administrador' || user?.role === 'gestor'

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

  const [selectedLista, setSelectedLista] = useState<Lista>('A1_A2')
  const [livros, setLivros]       = useState<LivroRow[]>([])
  const [movs, setMovs]           = useState<MovRow[]>([])
  const [totalMovs, setTotalMovs] = useState(0)
  const [itemFilter, setItemFilter] = useState('')
  const [dataDe, setDataDe] = useState('')
  const [dataAte, setDataAte] = useState('')
  const [itensLista, setItensLista] = useState<ItemOpt[]>([])
  const [loading, setLoading]     = useState(false)
  const [error, setError]         = useState('')

  // Pagination
  const PAGE_SIZE = 50
  const [page, setPage] = useState(0)

  // Modal abertura / encerramento
  const [showAbrirModal, setShowAbrirModal]   = useState(false)
  const [showEncerrarModal, setShowEncerrarModal] = useState(false)
  const [savingLivro, setSavingLivro]         = useState(false)
  const [livroError, setLivroError]           = useState('')
  const [abrirForm, setAbrirForm] = useState({
    numero_livro: '',
    termo_abertura_data: hojeLocal(),
    termo_abertura_texto: '',
    responsavel_tecnico_nome: '',
    responsavel_tecnico_crf: '',
  })
  const [encerrarForm, setEncerrarForm] = useState({
    termo_encerramento_data: hojeLocal(),
    termo_encerramento_texto: '',
  })

  const livroAberto = useMemo(
    () => livros.find(l => l.lista === selectedLista && !l.termo_encerramento_data) ?? null,
    [livros, selectedLista]
  )

  useEffect(() => {
    void loadLivros()
    void loadItens()
  }, [])

  // Troca de lista zera o filtro de item e volta a pagina 1.
  useEffect(() => {
    setItemFilter('')
    setPage(0)
  }, [selectedLista])

  useEffect(() => {
    void loadMovs(page)
  }, [selectedLista, itemFilter, dataDe, dataAte, page])

  async function loadItens() {
    const { data, error: err } = await supabase
      .from('pharmacy_items')
      .select('id, name, medication_class, controlled_subclass')
      .or('controlled_subclass.not.is.null,medication_class.eq.controlados,medication_class.eq.antimicrobianos')
      .order('name')
    if (err) { setError(getErrorMessage(err)); return }
    setItensLista((data || []) as ItemOpt[])
  }

  const itensDaLista = useMemo(
    () => itensLista.filter((i) =>
      selectedLista === 'antimicrobianos'
        ? i.medication_class === 'antimicrobianos'
        : !!i.controlled_subclass && subclassMatchesList(i.controlled_subclass, selectedLista)),
    [itensLista, selectedLista],
  )

  function rpcArgs(limite: number, offset: number) {
    return {
      p_lista: selectedLista,
      p_item_id: itemFilter || null,
      p_de: dataDe || null,
      p_ate: dataAte || null,
      p_limite: limite,
      p_offset: offset,
    }
  }

  async function loadLivros() {
    const { data, error: err } = await supabase
      .from('livros_controlados')
      .select('*')
      .order('termo_abertura_data', { ascending: false })
    if (err) { setError(getErrorMessage(err)); return }
    setLivros((data || []) as LivroRow[])
  }

  async function loadMovs(pagina: number) {
    setLoading(true); setError('')
    try {
      const { data, error: err } = await supabase.rpc('livro_controlados_movimentos', rpcArgs(PAGE_SIZE, pagina * PAGE_SIZE))
      if (err) throw err
      const rows = (data || []) as MovRow[]
      setMovs(rows)
      setTotalMovs(rows[0]?.total ?? 0)
    } catch (e: any) {
      setMovs([]); setTotalMovs(0)
      setError(getErrorMessage(e))
    } finally {
      setLoading(false)
    }
  }

  const pagedMovs = movs
  const totalPages = Math.max(1, Math.ceil(totalMovs / PAGE_SIZE))

  // ----- Abrir livro -----
  async function abrirLivro() {
    if (!abrirForm.numero_livro) { setLivroError('Informe o número do livro'); return }
    if (!abrirForm.termo_abertura_data) { setLivroError('Data de abertura é obrigatória'); return }
    // Portaria 344/98 art.34: livro deve ser aberto pelo RT (Responsável Técnico)
    if (!abrirForm.responsavel_tecnico_nome?.trim()) {
      setLivroError('Nome do Responsável Técnico é obrigatório (Portaria 344/98 art.34)'); return
    }
    if (!abrirForm.responsavel_tecnico_crf?.trim()) {
      setLivroError('CRF do Responsável Técnico é obrigatório (Portaria 344/98 art.34)'); return
    }
    // CRF formato: 2 letras (estado) + dígitos. Ex: CRF-BA/12345 ou BA/12345
    if (!/^(CRF-?)?[A-Z]{2}[\s\/-]*\d+$/i.test(abrirForm.responsavel_tecnico_crf.trim())) {
      setLivroError('CRF inválido. Formato esperado: CRF-BA/12345 ou BA-12345'); return
    }
    setSavingLivro(true); setLivroError('')
    try {
      const { error: err } = await supabase.from('livros_controlados').insert({
        lista: selectedLista,
        numero_livro: parseInt(abrirForm.numero_livro),
        termo_abertura_data: abrirForm.termo_abertura_data,
        termo_abertura_texto: abrirForm.termo_abertura_texto || null,
        responsavel_tecnico_nome: abrirForm.responsavel_tecnico_nome || null,
        responsavel_tecnico_crf: abrirForm.responsavel_tecnico_crf || null,
      })
      if (err) throw err
      setShowAbrirModal(false)
      await loadLivros()
    } catch (e: any) {
      setLivroError(getErrorMessage(e))
    } finally {
      setSavingLivro(false)
    }
  }

  // ----- Encerrar livro -----
  async function encerrarLivro() {
    if (!livroAberto) return
    if (!encerrarForm.termo_encerramento_data) { setLivroError('Data de encerramento é obrigatória'); return }
    setSavingLivro(true); setLivroError('')
    try {
      const { error: err } = await supabase
        .from('livros_controlados')
        .update({
          termo_encerramento_data: encerrarForm.termo_encerramento_data,
          termo_encerramento_texto: encerrarForm.termo_encerramento_texto || null,
        })
        .eq('id', livroAberto.id)
      if (err) throw err
      setShowEncerrarModal(false)
      await loadLivros()
    } catch (e: any) {
      setLivroError(getErrorMessage(e))
    } finally {
      setSavingLivro(false)
    }
  }

  // ----- Print -----
  async function handlePrint() {
    // Impressao leva TODAS as linhas do filtro (paginando no banco).
    let todas: MovRow[] = []
    try {
      todas = await buscarTodas<MovRow>((de, ate) =>
        supabase.rpc('livro_controlados_movimentos', rpcArgs(ate - de + 1, de)) as any, { tamanho: 500 })
    } catch (e: any) {
      setError(getErrorMessage(e))
      return
    }
    const listaInfo = LISTAS.find(l => l.value === selectedLista)!
    const term = livroAberto
      ? `Livro nº ${livroAberto.numero_livro} — Aberto em ${fmtDate(livroAberto.termo_abertura_data)}`
      : 'Sem livro aberto'

    const esc = (t: string | null | undefined) => (t ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    const rows = todas.map((m, i) => `
      <tr style="border-bottom:1px solid #ccc">
        <td style="padding:4px 6px;text-align:center">${m.livro_seq ?? i + 1}</td>
        <td style="padding:4px 6px">${fmtDate(m.performed_at)}</td>
        <td style="padding:4px 6px">${esc(m.item_nome)}${m.historico ? ' — ' + esc(m.historico).slice(0, 80) : ''}</td>
        <td style="padding:4px 6px;text-align:right">${m.direction === 'in' ? m.quantity : ''}</td>
        <td style="padding:4px 6px;text-align:right">${m.direction === 'out' && !ehPerda(m) ? m.quantity : ''}</td>
        <td style="padding:4px 6px">${ehPerda(m) ? m.quantity + ' — ' + esc(m.historico).slice(0, 60) : '—'}</td>
        <td style="padding:4px 6px;text-align:right">${m.saldo_depois ?? '—'}</td>
        <td style="padding:4px 6px">${esc(m.lote) || '—'}</td>
        <td style="padding:4px 6px">${fmtDate(m.validade)}</td>
        <td style="padding:4px 6px"></td>
      </tr>
    `).join('')

    const html = `
      <html>
      <head>
        <meta charset="UTF-8">
        <title>Livro de Registro Específico</title>
        <style>
          body { font-family: Arial, sans-serif; font-size: 11px; color: #000; padding: 20px; }
          h1 { font-size: 14px; text-align: center; margin: 0 0 4px; }
          h2 { font-size: 12px; text-align: center; margin: 0 0 8px; }
          p.meta { font-size: 10px; text-align: center; color: #444; margin: 2px 0; }
          table { width: 100%; border-collapse: collapse; margin-top: 12px; }
          th { background: #f0f0f0; font-size: 9px; text-transform: uppercase; padding: 4px 6px; border: 1px solid #ccc; }
          td { font-size: 10px; border: 1px solid #ddd; }
          .footer { margin-top: 24px; font-size: 10px; text-align: center; }
        </style>
      </head>
      <body>
        <h1>HOSPITAL ESTADUAL COSTA DAS COQUEIROS — HECC</h1>
        <h2>LIVRO DE REGISTRO ESPECÍFICO — LISTA ${listaInfo.label.toUpperCase()}</h2>
        <p class="meta">${listaInfo.sublabel} — ${term}</p>
        ${livroAberto ? `<p class="meta">RT: ${livroAberto.responsavel_tecnico_nome || '—'} · CRF: ${livroAberto.responsavel_tecnico_crf || '—'}</p>` : ''}
        <p class="meta">Gerado em: ${new Date().toLocaleString('pt-BR')}</p>
        <table>
          <thead>
            <tr>
              <th>Nº Seq</th>
              <th>Data</th>
              <th>Histórico (prontuário / NF)</th>
              <th>Entrada</th>
              <th>Saída</th>
              <th>Perda / Justificativa</th>
              <th>Saldo</th>
              <th>Lote</th>
              <th>Validade</th>
              <th>Assinatura RT</th>
            </tr>
          </thead>
          <tbody>
            ${rows || '<tr><td colspan="10" style="text-align:center;padding:12px">Sem movimentações no período</td></tr>'}
          </tbody>
        </table>
        <div class="footer">
          <p>_________________________________________ &nbsp;&nbsp;&nbsp; _______________________________</p>
          <p>Responsável Técnico — CRF &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; Data</p>
        </div>
      </body>
      </html>
    `
    const w = window.open('', '_blank')
    if (!w) return
    w.document.write(html)
    w.document.close()
    w.focus()
    setTimeout(() => w.print(), 500)
  }

  // ----- Render -----
  return (
    <div className="max-w-7xl mx-auto space-y-6">

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="p-3 rounded-lg bg-indigo-100">
            <BookOpen className="w-6 h-6 text-indigo-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold" style={{ color: txt }}>Livro de Registro Específico</h1>
            <p className="text-sm" style={{ color: txtSec }}>Portaria SVS/MS 344/98 — Controle de psicotrópicos e entorpecentes</p>
          </div>
        </div>
        <div className="flex gap-2 flex-wrap">
          {isAdminGestor && !livroAberto && (
            <Button
              onClick={() => { setAbrirForm(f => ({ ...f, termo_abertura_data: hojeLocal() })); setLivroError(''); setShowAbrirModal(true) }}
              className="bg-indigo-600 hover:bg-indigo-700 text-white">
              <Unlock className="w-4 h-4 mr-2" /> Abrir Livro
            </Button>
          )}
          {isAdminGestor && livroAberto && (
            <Button
              variant="outline"
              onClick={() => { setEncerrarForm(f => ({ ...f, termo_encerramento_data: hojeLocal() })); setLivroError(''); setShowEncerrarModal(true) }}
              className="border-red-300 text-red-600 hover:bg-red-50">
              <Lock className="w-4 h-4 mr-2" /> Encerrar Livro
            </Button>
          )}
          <Button variant="outline" onClick={() => void handlePrint()}>
            <Printer className="w-4 h-4 mr-2" /> Gerar PDF
          </Button>
        </div>
      </div>

      {error && (
        <div className="p-3 rounded-lg bg-red-100 border border-red-200 text-red-800 text-sm flex items-center gap-2">
          <AlertCircle size={16} /> {error}
        </div>
      )}

      {/* Status do livro aberto */}
      {livroAberto && (
        <div className="p-4 rounded-xl flex items-center gap-3"
          style={{ background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.3)' }}>
          <Unlock className="text-emerald-500 flex-shrink-0" size={18} />
          <div>
            <p className="text-sm font-semibold" style={{ color: txt }}>
              Livro nº {livroAberto.numero_livro} aberto — {LISTAS.find(l => l.value === selectedLista)?.label}
            </p>
            <p className="text-xs" style={{ color: txtSec }}>
              Abertura: {fmtDate(livroAberto.termo_abertura_data)}
              {livroAberto.responsavel_tecnico_nome ? ` · RT: ${livroAberto.responsavel_tecnico_nome} (CRF ${livroAberto.responsavel_tecnico_crf || '—'})` : ''}
            </p>
          </div>
        </div>
      )}

      {!livroAberto && (
        <div className="p-4 rounded-xl flex items-center gap-3"
          style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.3)' }}>
          <Lock className="text-amber-500 flex-shrink-0" size={18} />
          <p className="text-sm" style={{ color: txt }}>
            Nenhum livro aberto para a lista selecionada.
            {isAdminGestor ? ' Clique em "Abrir Livro" para criar um novo termo de abertura.' : ''}
          </p>
        </div>
      )}

      {/* Tab selector */}
      <div className="p-1 flex flex-wrap gap-1" style={{ ...card, borderRadius: 12 }}>
        {LISTAS.map(l => (
          <button
            key={l.value}
            onClick={() => setSelectedLista(l.value)}
            className="flex-1 min-w-[120px] px-3 py-2 rounded-lg text-sm font-medium transition-all"
            style={{
              background: selectedLista === l.value
                ? (mode === 'dark' ? 'rgba(99,102,241,0.3)' : 'rgba(99,102,241,0.12)')
                : 'transparent',
              color: selectedLista === l.value ? (mode === 'dark' ? '#a5b4fc' : '#4338ca') : txtSec,
              border: selectedLista === l.value ? '1px solid rgba(99,102,241,0.35)' : '1px solid transparent',
            }}>
            <span className="font-bold">{l.label}</span>
            <span className="block text-xs opacity-70 truncate">{l.sublabel}</span>
          </button>
        ))}
      </div>

      {/* Filtros (aplicados no banco) */}
      <div className="p-4 grid grid-cols-1 md:grid-cols-3 gap-3" style={card}>
        <div>
          <label style={lbl}>Medicamento</label>
          <select value={itemFilter} onChange={e => { setItemFilter(e.target.value); setPage(0) }} style={inp as any}>
            <option value="">Todos da lista</option>
            {itensDaLista.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
          </select>
        </div>
        <div>
          <label style={lbl}>De</label>
          <input type="date" value={dataDe} onChange={e => { setDataDe(e.target.value); setPage(0) }} style={inp} />
        </div>
        <div>
          <label style={lbl}>Até</label>
          <input type="date" value={dataAte} onChange={e => { setDataAte(e.target.value); setPage(0) }} style={inp} />
        </div>
      </div>

      {/* Table */}
      <div style={card} ref={printRef}>
        {loading ? (
          <div className="flex items-center justify-center p-12" style={{ color: txtMut }}>
            <Loader2 className="w-5 h-5 animate-spin mr-2" /> Carregando...
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr style={{ background: mode === 'dark' ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)' }}>
                    {[
                      'Nº Seq', 'Data', 'Histórico', 'Entrada', 'Saída',
                      'Perda / Justificativa', 'Saldo', 'Lote', 'Validade', 'Assinatura RT'
                    ].map(h => (
                      <th key={h} className="text-left px-3 py-3 text-xs font-semibold uppercase whitespace-nowrap"
                        style={{ color: txtSec }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {pagedMovs.length === 0 ? (
                    <tr>
                      <td colSpan={10} className="text-center py-10 text-sm" style={{ color: txtMut }}>
                        Nenhuma movimentação encontrada para esta lista.
                      </td>
                    </tr>
                  ) : pagedMovs.map((m, i) => {
                    const seq = m.livro_seq ?? page * PAGE_SIZE + i + 1
                    const isEntrada = m.direction === 'in'
                    const isPerdaJust = ehPerda(m)
                    return (
                      <tr
                        key={m.id}
                        style={{
                          borderTop: `1px solid ${mode === 'dark' ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)'}`,
                        }}>
                        <td className="px-3 py-2 text-center font-mono text-xs" style={{ color: txtMut }}>
                          {seq}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap" style={{ color: txtSec }}>
                          {fmtDate(m.performed_at)}
                        </td>
                        <td className="px-3 py-2" style={{ color: txt, maxWidth: 220 }}>
                          <p className="truncate font-medium">{m.item_nome}</p>
                          {m.historico && !isPerdaJust && (
                            <p className="text-xs truncate" style={{ color: txtMut }} title={m.historico}>{m.historico}</p>
                          )}
                          {m.local_codigo && (
                            <p className="text-xs" style={{ color: txtMut }}>{m.local_codigo}</p>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums" style={{ color: '#10b981' }}>
                          {isEntrada ? m.quantity : ''}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums" style={{ color: '#ef4444' }}>
                          {!isEntrada && !isPerdaJust ? m.quantity : ''}
                        </td>
                        <td className="px-3 py-2" style={{ color: txtSec, maxWidth: 180 }}>
                          {isPerdaJust ? (
                            <span className="text-xs">{m.quantity} — {m.historico}</span>
                          ) : '—'}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums font-mono text-xs" style={{ color: txt }}>
                          {m.saldo_depois ?? '—'}
                        </td>
                        <td className="px-3 py-2 text-xs font-mono" style={{ color: txtSec }}>
                          {m.lote ?? '—'}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap text-xs" style={{ color: txtSec }}>
                          {fmtDate(m.validade)}
                        </td>
                        <td className="px-3 py-2" style={{ width: 80 }} />
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {totalMovs > PAGE_SIZE && (
              <div className="flex items-center justify-between px-4 py-3"
                style={{ borderTop: `1px solid ${mode === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)'}` }}>
                <span className="text-xs" style={{ color: txtMut }}>
                  {totalMovs} registros · página {page + 1} de {totalPages}
                </span>
                <div className="flex gap-1">
                  <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(p => p - 1)}>
                    <ChevronLeft size={14} />
                  </Button>
                  <Button variant="outline" size="sm" disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}>
                    <ChevronRight size={14} />
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Histórico de livros */}
      {livros.filter(l => l.lista === selectedLista).length > 0 && (
        <div className="p-4 space-y-2" style={card}>
          <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: txtMut }}>
            Histórico de livros — {LISTAS.find(l => l.value === selectedLista)?.label}
          </p>
          {livros.filter(l => l.lista === selectedLista).map(l => (
            <div key={l.id} className="flex items-center justify-between gap-2 py-1"
              style={{ borderBottom: `1px solid ${mode === 'dark' ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)'}` }}>
              <div>
                <span className="text-sm font-medium" style={{ color: txt }}>Livro nº {l.numero_livro}</span>
                <span className="text-xs ml-2" style={{ color: txtSec }}>
                  Aberto: {fmtDate(l.termo_abertura_data)}
                  {l.termo_encerramento_data ? ` · Encerrado: ${fmtDate(l.termo_encerramento_data)}` : ''}
                </span>
              </div>
              {!l.termo_encerramento_data && (
                <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 border border-emerald-200">
                  Aberto
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Modal: Abrir Livro */}
      {showAbrirModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.55)' }}>
          <div className="w-full max-w-md p-6 space-y-4" style={{
            background: mode === 'dark' ? 'rgba(10,15,20,0.97)' : '#fff',
            borderRadius: 16,
            border: `1px solid ${mode === 'dark' ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.08)'}`,
          }}>
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold" style={{ color: txt }}>
                Abrir Livro — {LISTAS.find(l => l.value === selectedLista)?.label}
              </h2>
              <button onClick={() => setShowAbrirModal(false)} style={{ color: txtMut }}>
                <X size={18} />
              </button>
            </div>
            {livroError && (
              <div className="p-2 rounded bg-red-100 border border-red-200 text-red-800 text-sm">{livroError}</div>
            )}
            <div className="space-y-3">
              <div>
                <label style={lbl}>Número do Livro *</label>
                <input type="number" min="1" value={abrirForm.numero_livro}
                  onChange={e => setAbrirForm(f => ({ ...f, numero_livro: e.target.value }))} style={inp} />
              </div>
              <div>
                <label style={lbl}>Data de Abertura *</label>
                <input type="date" value={abrirForm.termo_abertura_data}
                  onChange={e => setAbrirForm(f => ({ ...f, termo_abertura_data: e.target.value }))} style={inp} />
              </div>
              <div>
                <label style={lbl}>Responsável Técnico</label>
                <input placeholder="Nome do farmacêutico RT" value={abrirForm.responsavel_tecnico_nome}
                  onChange={e => setAbrirForm(f => ({ ...f, responsavel_tecnico_nome: e.target.value }))} style={inp} />
              </div>
              <div>
                <label style={lbl}>CRF</label>
                <input placeholder="CRF-XX/12345" value={abrirForm.responsavel_tecnico_crf}
                  onChange={e => setAbrirForm(f => ({ ...f, responsavel_tecnico_crf: e.target.value }))} style={inp} />
              </div>
              <div>
                <label style={lbl}>Texto do Termo de Abertura</label>
                <textarea rows={3} value={abrirForm.termo_abertura_texto}
                  onChange={e => setAbrirForm(f => ({ ...f, termo_abertura_texto: e.target.value }))}
                  style={{ ...inp, resize: 'vertical' as const }} />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setShowAbrirModal(false)}>Cancelar</Button>
              <Button onClick={abrirLivro} disabled={savingLivro} className="bg-indigo-600 hover:bg-indigo-700 text-white">
                {savingLivro && <Loader2 size={14} className="mr-2 animate-spin" />} Abrir Livro
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Encerrar Livro */}
      {showEncerrarModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.55)' }}>
          <div className="w-full max-w-md p-6 space-y-4" style={{
            background: mode === 'dark' ? 'rgba(10,15,20,0.97)' : '#fff',
            borderRadius: 16,
            border: `1px solid ${mode === 'dark' ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.08)'}`,
          }}>
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold" style={{ color: txt }}>
                Encerrar Livro nº {livroAberto?.numero_livro}
              </h2>
              <button onClick={() => setShowEncerrarModal(false)} style={{ color: txtMut }}>
                <X size={18} />
              </button>
            </div>
            {livroError && (
              <div className="p-2 rounded bg-red-100 border border-red-200 text-red-800 text-sm">{livroError}</div>
            )}
            <div className="space-y-3">
              <div>
                <label style={lbl}>Data de Encerramento *</label>
                <input type="date" value={encerrarForm.termo_encerramento_data}
                  onChange={e => setEncerrarForm(f => ({ ...f, termo_encerramento_data: e.target.value }))} style={inp} />
              </div>
              <div>
                <label style={lbl}>Texto do Termo de Encerramento</label>
                <textarea rows={3} value={encerrarForm.termo_encerramento_texto}
                  onChange={e => setEncerrarForm(f => ({ ...f, termo_encerramento_texto: e.target.value }))}
                  style={{ ...inp, resize: 'vertical' as const }} />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setShowEncerrarModal(false)}>Cancelar</Button>
              <Button onClick={encerrarLivro} disabled={savingLivro}
                className="bg-red-600 hover:bg-red-700 text-white">
                {savingLivro && <Loader2 size={14} className="mr-2 animate-spin" />} Encerrar Livro
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
