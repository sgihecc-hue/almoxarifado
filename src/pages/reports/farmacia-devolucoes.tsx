// =====================================================================
// Relatório de Devoluções (farmácia) — pedido de 16/09/2026.
// Lê a view public.v_farmacia_devolucoes: uma linha por item devolvido.
// "Origem não informada" = devolução antiga lançada pela farmácia com o setor
// da própria farmácia; o posto real não ficou registrado.
// =====================================================================

import { useState, useEffect, useMemo, useRef } from 'react'
import { useTheme } from '@/contexts/theme'
import { Undo2, Loader2, Download, Search, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { supabase } from '@/lib/supabase'
import { MOTIVO_OPTIONS } from '@/pages/estoque/devolucao'

type Linha = {
  id: string
  devolucao_id: string
  numero: number
  data: string
  status: string
  origem: string
  estoque_codigo: string | null
  estoque: string | null
  item_id: string
  item: string
  codigo: string | null
  unidade: string | null
  quantidade_enviada: number
  quantidade_recebida: number | null
  quantidade_entrada: number
  lote: string | null
  validade: string | null
  motivo: string | null
  observacao: string | null
  divergencia: string | null
  prontuario: string | null
  paciente: string | null
  registrado_por: string | null
  confirmado_por: string | null
  confirmado_em: string | null
}

const BLOCO = 1000
const MAX_ROWS = 20000
const PAGE_SIZE = 50
const ORIGEM_SEM = 'Origem não informada'

const iso = (d: Date) => d.toISOString().slice(0, 10)
const dataBR = (d: string | null) => (d ? new Date(d).toLocaleDateString('pt-BR') : '—')
const rotuloMotivo = (v: string | null) => MOTIVO_OPTIONS.find((o) => o.value === v)?.label ?? v ?? '—'
const porNome = (a: string, b: string) => a.localeCompare(b, 'pt-BR', { sensitivity: 'base' })

// Filtros ficam salvos no navegador (pedido da Andressa, 16/09/2026): recarregar
// a página não apaga o que foi escolhido. "Limpar tudo" continua zerando.
function lerFiltros(chave: string): Record<string, any> {
  try {
    const v = JSON.parse(localStorage.getItem(chave) || '{}')
    return v && typeof v === 'object' ? v : {}
  } catch {
    return {}
  }
}
function gravarFiltros(chave: string, valor: Record<string, unknown>) {
  try { localStorage.setItem(chave, JSON.stringify(valor)) } catch { /* sem armazenamento: segue sem salvar */ }
}
// Data digitada pela metade (ou apagada) não dispara busca.
function dataValida(d: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(d) && Number(d.slice(0, 4)) >= 2020
}

const CHAVE_FILTROS = 'relatorio-devolucoes-farmacia:filtros'

export function FarmaciaDevolucoesReport() {
  const { mode } = useTheme()
  const txt = mode === 'dark' ? '#fff' : '#0d2e1c'
  const txtSec = mode === 'dark' ? 'rgba(255,255,255,0.7)' : 'rgba(13,46,28,0.65)'
  const txtMut = mode === 'dark' ? 'rgba(255,255,255,0.45)' : 'rgba(13,46,28,0.45)'
  const card: React.CSSProperties = {
    background: mode === 'dark' ? 'rgba(10,15,20,0.55)' : 'rgba(255,255,255,0.65)',
    backdropFilter: 'blur(30px)', WebkitBackdropFilter: 'blur(30px)',
    border: `1px solid ${mode === 'dark' ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.5)'}`,
    borderRadius: 16,
  }
  const inputStyle: React.CSSProperties = {
    background: mode === 'dark' ? 'rgba(0,0,0,0.3)' : 'rgba(255,255,255,0.7)',
    border: `1px solid ${mode === 'dark' ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.1)'}`,
    borderRadius: 10, padding: '8px 12px', fontSize: 14, color: txt, outline: 'none', width: '100%',
  }
  const lbl: React.CSSProperties = {
    color: txtSec, fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, display: 'block', marginBottom: 4,
  }
  const th: React.CSSProperties = { ...lbl, display: 'table-cell', padding: '10px 16px', marginBottom: 0, textAlign: 'left' }
  const td: React.CSSProperties = { padding: '10px 16px', color: txt, fontSize: 14 }
  const borda = `1px solid ${mode === 'dark' ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)'}`
  const chip = (ativo: boolean): React.CSSProperties => ({
    padding: '6px 14px', borderRadius: 999, fontSize: 13, fontWeight: 600, cursor: 'pointer',
    background: ativo ? 'rgba(16,185,129,0.15)' : (mode === 'dark' ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.05)'),
    color: ativo ? '#059669' : txtSec, border: `1px solid ${ativo ? '#10b981' : 'transparent'}`,
  })

  const hoje = new Date()
  const [salvo] = useState(() => lerFiltros(CHAVE_FILTROS))
  const [dataDe, setDataDe] = useState<string>(salvo.dataDe ?? iso(new Date(hoje.getTime() - 29 * 86400000)))
  const [dataAte, setDataAte] = useState<string>(salvo.dataAte ?? iso(hoje))
  const [rows, setRows] = useState<Linha[]>([])
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [truncado, setTruncado] = useState(false)

  const [modo, setModo] = useState<'origem' | 'item' | 'detalhado'>(
    ['origem', 'item', 'detalhado'].includes(salvo.modo) ? salvo.modo : 'origem')
  const [estoque, setEstoque] = useState<string>(salvo.estoque ?? '')
  const [origem, setOrigem] = useState<string>(salvo.origem ?? '')
  const [motivo, setMotivo] = useState<string>(salvo.motivo ?? '')
  const [status, setStatus] = useState<'todas' | 'confirmed' | 'pending'>(
    ['todas', 'confirmed', 'pending'].includes(salvo.status) ? salvo.status : 'todas')
  const [busca, setBusca] = useState<string>(salvo.busca ?? '')

  useEffect(() => {
    gravarFiltros(CHAVE_FILTROS, { dataDe, dataAte, modo, estoque, origem, motivo, status, busca })
  }, [dataDe, dataAte, modo, estoque, origem, motivo, status, busca])
  const [page, setPage] = useState(0)

  // Só a busca mais recente vale (a busca vai em vários blocos).
  const cargaAtual = useRef(0)

  async function carregar() {
    const minha = ++cargaAtual.current
    setLoading(true)
    setErro(null)
    try {
      // A API devolve no máximo 1.000 linhas por pedido: busca em blocos.
      const lista: Linha[] = []
      for (let de = 0; de < MAX_ROWS; de += BLOCO) {
        const ate = Math.min(de + BLOCO, MAX_ROWS) - 1
        const { data, error } = await supabase
          .from('v_farmacia_devolucoes')
          .select('*')
          .gte('data', `${dataDe}T00:00:00-03:00`)
          .lte('data', `${dataAte}T23:59:59.999-03:00`)
          .order('data', { ascending: false })
          .order('id', { ascending: true })
          .range(de, ate)
        if (minha !== cargaAtual.current) return
        if (error) throw error
        const bloco = (data ?? []) as Linha[]
        lista.push(...bloco)
        if (bloco.length < ate - de + 1) break
      }
      if (minha !== cargaAtual.current) return
      setRows(lista)
      setTruncado(lista.length >= MAX_ROWS)
    } catch (e) {
      if (minha !== cargaAtual.current) return
      console.error(e)
      setErro('Não foi possível carregar as devoluções. Tente novamente.')
      setRows([])
    } finally {
      if (minha === cargaAtual.current) setLoading(false)
    }
  }

  useEffect(() => {
    if (!dataValida(dataDe) || !dataValida(dataAte)) return
    const t = setTimeout(() => { void carregar() }, 500)
    return () => clearTimeout(t)
  }, [dataDe, dataAte])
  useEffect(() => { setPage(0) }, [modo, estoque, origem, motivo, status, busca])

  const opcoes = useMemo(() => ({
    estoques: Array.from(new Map(rows.filter((r) => r.estoque_codigo).map((r) => [r.estoque_codigo as string, r.estoque ?? r.estoque_codigo])).entries())
      .sort((a, b) => porNome(a[1] as string, b[1] as string)),
    origens: Array.from(new Set(rows.map((r) => r.origem))).sort(porNome),
  }), [rows])

  const filtradas = useMemo(() => {
    const t = busca.trim().toLowerCase()
    return rows.filter((r) => {
      if (estoque && r.estoque_codigo !== estoque) return false
      if (origem && r.origem !== origem) return false
      if (motivo && r.motivo !== motivo) return false
      if (status !== 'todas' && r.status !== status) return false
      if (t && !`${r.item} ${r.codigo ?? ''} ${r.prontuario ?? ''}`.toLowerCase().includes(t)) return false
      return true
    })
  }, [rows, estoque, origem, motivo, status, busca])

  const totais = useMemo(() => ({
    devolucoes: new Set(filtradas.map((r) => r.devolucao_id)).size,
    enviado: filtradas.reduce((s, r) => s + (r.quantidade_enviada ?? 0), 0),
    entrada: filtradas.reduce((s, r) => s + (r.quantidade_entrada ?? 0), 0),
    pendentes: new Set(filtradas.filter((r) => r.status === 'pending').map((r) => r.devolucao_id)).size,
  }), [filtradas])

  const agrupar = (chave: (r: Linha) => string, rotulo: (r: Linha) => string, extra?: (r: Linha) => string) => {
    const mapa = new Map<string, { chave: string; rotulo: string; extra: string; devolucoes: Set<string>; itens: number; enviado: number; entrada: number }>()
    for (const r of filtradas) {
      const k = chave(r)
      const g = mapa.get(k) ?? { chave: k, rotulo: rotulo(r), extra: extra ? extra(r) : '', devolucoes: new Set<string>(), itens: 0, enviado: 0, entrada: 0 }
      g.devolucoes.add(r.devolucao_id)
      g.itens += 1
      g.enviado += r.quantidade_enviada ?? 0
      g.entrada += r.quantidade_entrada ?? 0
      mapa.set(k, g)
    }
    return Array.from(mapa.values()).sort((a, b) => porNome(a.rotulo, b.rotulo))
  }
  const porOrigem = useMemo(() => agrupar((r) => r.origem, (r) => r.origem), [filtradas])
  const porItem = useMemo(() => agrupar((r) => r.item_id, (r) => r.item, (r) => [r.codigo, r.unidade].filter(Boolean).join(' • ')), [filtradas])

  const lista: unknown[] = modo === 'origem' ? porOrigem : modo === 'item' ? porItem : filtradas
  const totalPaginas = Math.max(1, Math.ceil(lista.length / PAGE_SIZE))
  const inicio = page * PAGE_SIZE

  function exportarCsv() {
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
    let cab: string[]
    let linhas: unknown[][]
    if (modo === 'detalhado') {
      cab = ['Nº', 'Data', 'Status', 'Origem', 'Farmácia', 'Item', 'Código', 'Unidade', 'Enviado', 'Recebido', 'Entrada no estoque', 'Lote', 'Validade', 'Motivo', 'Observação', 'Divergência', 'Prontuário', 'Registrado por', 'Confirmado por', 'Confirmado em']
      linhas = filtradas.map((r) => [r.numero, dataBR(r.data), r.status === 'pending' ? 'Pendente' : 'Confirmada', r.origem, r.estoque, r.item, r.codigo, r.unidade,
        r.quantidade_enviada, r.quantidade_recebida ?? '', r.quantidade_entrada, r.lote, r.validade ? dataBR(r.validade) : '', rotuloMotivo(r.motivo),
        r.observacao, r.divergencia, r.prontuario, r.registrado_por, r.confirmado_por, r.confirmado_em ? dataBR(r.confirmado_em) : ''])
    } else {
      const grupos = modo === 'origem' ? porOrigem : porItem
      cab = [modo === 'origem' ? 'Origem' : 'Item', ...(modo === 'item' ? ['Código / unidade'] : []), 'Devoluções', 'Itens', 'Qtd enviada', 'Qtd que entrou no estoque']
      linhas = grupos.map((g) => [g.rotulo, ...(modo === 'item' ? [g.extra] : []), g.devolucoes.size, g.itens, g.enviado, g.entrada])
    }
    const csv = '﻿' + [cab, ...linhas].map((l) => l.map(esc).join(';')).join('\n')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    a.download = `devolucoes_farmacia_${modo}_${dataDe}_a_${dataAte}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  return (
    <div className="max-w-7xl mx-auto space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2" style={{ color: txt }}>
            <Undo2 size={22} /> Devoluções da Farmácia
          </h1>
          <p className="text-sm" style={{ color: txtSec }}>Medicamentos devolvidos pela enfermagem às farmácias.</p>
        </div>
        <div className="flex gap-2">
        <Button variant="outline" onClick={() => void carregar()} disabled={loading} title="Buscar de novo, mantendo os filtros">
          <RefreshCw size={14} className={`mr-1 ${loading ? 'animate-spin' : ''}`} /> Atualizar
        </Button>
        <Button variant="outline" onClick={exportarCsv} disabled={loading || lista.length === 0}>
          <Download size={14} className="mr-1" /> Exportar CSV
        </Button>
        </div>
      </div>

      <div className="p-5 space-y-4" style={card}>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div>
            <span style={lbl}>Data inicial</span>
            <input type="date" value={dataDe} onChange={(e) => setDataDe(e.target.value)} style={inputStyle} />
          </div>
          <div>
            <span style={lbl}>Data final</span>
            <input type="date" value={dataAte} onChange={(e) => setDataAte(e.target.value)} style={inputStyle} />
          </div>
          <div>
            <span style={lbl}>Origem</span>
            <select value={origem} onChange={(e) => setOrigem(e.target.value)} style={inputStyle}>
              <option value="">Todas</option>
              {opcoes.origens.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          </div>
          <div>
            <span style={lbl}>Motivo</span>
            <select value={motivo} onChange={(e) => setMotivo(e.target.value)} style={inputStyle}>
              <option value="">Todos</option>
              {MOTIVO_OPTIONS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </div>
        </div>
        <div className="flex flex-wrap items-end gap-6">
          <div>
            <span style={lbl}>Farmácia que recebeu</span>
            <div className="flex flex-wrap gap-2">
              <button style={chip(estoque === '')} onClick={() => setEstoque('')}>Todas</button>
              {opcoes.estoques.map(([cod, nome]) => (
                <button key={cod} style={chip(estoque === cod)} onClick={() => setEstoque(cod)}>{nome}</button>
              ))}
            </div>
          </div>
          <div>
            <span style={lbl}>Status</span>
            <div className="flex gap-2">
              {([['todas', 'Todas'], ['confirmed', 'Confirmadas'], ['pending', 'Pendentes']] as const).map(([v, r]) => (
                <button key={v} style={chip(status === v)} onClick={() => setStatus(v)}>{r}</button>
              ))}
            </div>
          </div>
          <div className="flex-1 min-w-[220px]">
            <span style={lbl}>Item ou prontuário</span>
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: txtMut }} />
              <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Ex.: dipirona ou 12345" style={{ ...inputStyle, paddingLeft: 32 }} />
            </div>
          </div>
        </div>
        {origem === ORIGEM_SEM || (!origem && rows.some((r) => r.origem === ORIGEM_SEM)) ? (
          <p className="text-xs" style={{ color: txtMut }}>
            <strong>Origem não informada</strong>: devoluções antigas lançadas pela farmácia com o setor da própria farmácia — o posto de origem não ficou registrado.
          </p>
        ) : null}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          ['Devoluções', totais.devolucoes],
          ['Qtd enviada', totais.enviado],
          ['Qtd que entrou no estoque', totais.entrada],
          ['Pendentes de confirmação', totais.pendentes],
        ].map(([r, v]) => (
          <div key={r as string} className="p-4" style={card}>
            <span style={lbl}>{r}</span>
            <p className="text-2xl font-bold" style={{ color: txt }}>{(v as number).toLocaleString('pt-BR')}</p>
          </div>
        ))}
      </div>

      <div className="flex gap-2">
        {([['origem', 'Por origem'], ['item', 'Por item'], ['detalhado', 'Detalhado']] as const).map(([v, r]) => (
          <button key={v} style={chip(modo === v)} onClick={() => setModo(v)}>{r}</button>
        ))}
      </div>

      <div style={card} className="overflow-hidden">
        {loading ? (
          <div className="p-12 flex justify-center items-center gap-2" style={{ color: txtMut }}>
            <Loader2 className="w-5 h-5 animate-spin" /> Carregando devoluções...
          </div>
        ) : erro ? (
          <p className="p-6 text-sm text-red-600">{erro}</p>
        ) : lista.length === 0 ? (
          <p className="p-8 text-center text-sm" style={{ color: txtMut }}>Nenhuma devolução no período com esses filtros.</p>
        ) : (
          <div className="overflow-x-auto">
            {modo !== 'detalhado' ? (
              <table className="w-full">
                <thead>
                  <tr style={{ borderBottom: borda }}>
                    <th style={th}>{modo === 'origem' ? 'Origem' : 'Item'}</th>
                    <th style={{ ...th, textAlign: 'right' }}>Devoluções</th>
                    <th style={{ ...th, textAlign: 'right' }}>Itens</th>
                    <th style={{ ...th, textAlign: 'right' }}>Qtd enviada</th>
                    <th style={{ ...th, textAlign: 'right' }}>Qtd que entrou</th>
                  </tr>
                </thead>
                <tbody>
                  {(lista as ReturnType<typeof agrupar>).slice(inicio, inicio + PAGE_SIZE).map((g) => (
                    <tr key={g.chave} style={{ borderBottom: borda }}>
                      <td style={td}>
                        <p style={{ fontWeight: 500, color: g.rotulo === ORIGEM_SEM ? txtMut : txt }}>{g.rotulo}</p>
                        {g.extra && <p style={{ color: txtMut, fontSize: 11 }}>{g.extra}</p>}
                      </td>
                      <td style={{ ...td, textAlign: 'right' }}>{g.devolucoes.size}</td>
                      <td style={{ ...td, textAlign: 'right' }}>{g.itens}</td>
                      <td style={{ ...td, textAlign: 'right' }}>{g.enviado.toLocaleString('pt-BR')}</td>
                      <td style={{ ...td, textAlign: 'right', fontWeight: 700 }}>{g.entrada.toLocaleString('pt-BR')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <table className="w-full">
                <thead>
                  <tr style={{ borderBottom: borda }}>
                    <th style={th}>Data / nº</th>
                    <th style={th}>Origem ➜ farmácia</th>
                    <th style={th}>Item / lote</th>
                    <th style={{ ...th, textAlign: 'right' }}>Enviado</th>
                    <th style={{ ...th, textAlign: 'right' }}>Entrou</th>
                    <th style={th}>Motivo</th>
                    <th style={th}>Registro</th>
                  </tr>
                </thead>
                <tbody>
                  {(lista as Linha[]).slice(inicio, inicio + PAGE_SIZE).map((r) => (
                    <tr key={r.id} style={{ borderBottom: borda, verticalAlign: 'top' }}>
                      <td style={{ ...td, whiteSpace: 'nowrap' }}>
                        {dataBR(r.data)}
                        <p style={{ color: txtMut, fontSize: 11 }}>Nº {r.numero}{r.status === 'pending' ? ' • Pendente' : ''}</p>
                      </td>
                      <td style={td}>
                        <span style={{ color: r.origem === ORIGEM_SEM ? txtMut : txt }}>{r.origem}</span>
                        <p style={{ color: txtMut, fontSize: 11 }}>➜ {r.estoque ?? '—'}</p>
                      </td>
                      <td style={td}>
                        {r.item}
                        <p style={{ color: txtMut, fontSize: 11 }}>
                          Lote {r.lote ?? '—'} • val. {r.validade ? dataBR(r.validade) : '—'}{r.prontuario ? ` • Pront. ${r.prontuario}` : ''}
                        </p>
                      </td>
                      <td style={{ ...td, textAlign: 'right' }}>{r.quantidade_enviada}</td>
                      <td style={{ ...td, textAlign: 'right', fontWeight: 700 }}>{r.status === 'pending' ? '—' : r.quantidade_entrada}</td>
                      <td style={td}>
                        {rotuloMotivo(r.motivo)}
                        {r.observacao && <p style={{ color: txtMut, fontSize: 11 }}>{r.observacao}</p>}
                        {r.divergencia && <p style={{ color: '#dc2626', fontSize: 11 }}>Divergência: {r.divergencia}</p>}
                      </td>
                      <td style={{ ...td, fontSize: 12, color: txtSec }}>
                        {r.registrado_por ?? '—'}
                        {r.confirmado_por && <p style={{ color: txtMut, fontSize: 11 }}>Confirmou: {r.confirmado_por}</p>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
        {!loading && lista.length > PAGE_SIZE && (
          <div className="flex items-center justify-between px-4 py-3" style={{ borderTop: borda }}>
            <span className="text-xs" style={{ color: txtMut }}>Página {page + 1} de {totalPaginas}</span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>Anterior</Button>
              <Button variant="outline" size="sm" disabled={page + 1 >= totalPaginas} onClick={() => setPage((p) => p + 1)}>Próxima</Button>
            </div>
          </div>
        )}
      </div>

      {truncado && (
        <p className="text-xs" style={{ color: txtMut }}>O período passou do teto de {MAX_ROWS.toLocaleString('pt-BR')} linhas; estreite as datas para ver tudo.</p>
      )}
    </div>
  )
}
