import { useState, useEffect, useMemo } from 'react'
import { useTheme } from '@/contexts/theme'
import {
  Search, Loader2, Filter, Info, Download, X,
  ChevronDown, ChevronUp, BarChart3, ListOrdered,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { supabase } from '@/lib/supabase'

// Teto de linhas por carga. A view tem ~5,6 mil linhas hoje; o teto existe para
// a tela não travar se alguém pedir um período muito largo.
const MAX_ROWS = 20000
const PAGE_SIZE = 50

// Espelho da view public.v_farmacia_consumo — uma linha por saída de estoque.
// É só leitura: a tela nunca escreve nada.
type Consumo = {
  id: string
  data: string
  tipo: string
  quantidade: number | null
  custo_unitario: number | null
  custo_total: number | null
  estoque_codigo: string | null
  estoque: string | null
  item_id: string | null
  item: string | null
  codigo: string | null
  unidade: string | null
  apresentacao: string | null
  classe: string | null
  controlado: boolean | null
  alta_vigilancia: boolean | null
  talidomida: boolean | null
  padronizado: boolean | null
  destino: string | null
  destino_tipo: string | null
  prontuario: string | null
  paciente: string | null
  data_prescricao: string | null
  lote: string | null
  validade: string | null
  usuario_id: string | null
  usuario: string | null
}

// Tipos de saída da view. Só os três primeiros são consumo assistencial de fato —
// transferência muda o material de lugar, ajuste e devolução interna corrigem saldo.
const TIPOS = [
  { valor: 'PRESCRICAO', rotulo: 'Prescrição', consumo: true },
  { valor: 'SOLICITACAO', rotulo: 'Solicitação', consumo: true },
  { valor: 'SAIDA_AVULSA', rotulo: 'Saída avulsa', consumo: true },
  { valor: 'TRANSFERENCIA', rotulo: 'Transferência', consumo: false },
  { valor: 'DEVOLUCAO_INT', rotulo: 'Devolução interna', consumo: false },
  { valor: 'AJUSTE', rotulo: 'Ajuste', consumo: false },
]

const TIPOS_PADRAO = TIPOS.filter((t) => t.consumo).map((t) => t.valor)

const ESTOQUES = [
  { valor: 'CAF', rotulo: 'CAF' },
  { valor: 'SAT_1', rotulo: 'Satélite 1' },
  { valor: 'SAT_2', rotulo: 'Satélite 2' },
  { valor: 'SAT_T', rotulo: 'Satélite Térreo' },
]

function fmtData(d: string | null | undefined) {
  if (!d) return '—'
  return new Date(d).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
}

function fmtDia(d: string | null | undefined) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('pt-BR')
}

function fmtQtd(v: number | null | undefined) {
  if (v === null || v === undefined) return '—'
  return Number.isInteger(v) ? String(v) : v.toFixed(2).replace('.', ',')
}

function fmtMoeda(v: number | null | undefined) {
  const n = v ?? 0
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function iso(d: Date) {
  return d.toISOString().slice(0, 10)
}

function rotuloTipo(t: string | null) {
  return TIPOS.find((x) => x.valor === t)?.rotulo ?? (t ?? '—')
}

export function PharmacyConsumptionReport() {
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
    borderRadius: 10, padding: '8px 12px', fontSize: 14,
    color: txt, outline: 'none', width: '100%',
  }
  const lbl: React.CSSProperties = {
    color: txtSec, fontSize: 11, fontWeight: 600, textTransform: 'uppercase',
    letterSpacing: 0.5, display: 'block', marginBottom: 4,
  }
  const cellBorder = `1px solid ${mode === 'dark' ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)'}`
  const divisor = `1px solid ${mode === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)'}`

  const [rows, setRows] = useState<Consumo[]>([])
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [truncado, setTruncado] = useState(false)

  const [modo, setModo] = useState<'resumo' | 'detalhado'>('resumo')
  const [filtrosAbertos, setFiltrosAbertos] = useState(true)
  const [page, setPage] = useState(0)

  // ---- Filtros ----
  const hoje = new Date()
  const [dataDe, setDataDe] = useState(iso(new Date(hoje.getTime() - 29 * 86400000)))
  const [dataAte, setDataAte] = useState(iso(hoje))
  const [estoquesSel, setEstoquesSel] = useState<string[]>([])
  const [tiposSel, setTiposSel] = useState<string[]>(TIPOS_PADRAO)
  const [busca, setBusca] = useState('')
  const [classe, setClasse] = useState('')
  const [soControlados, setSoControlados] = useState(false)
  const [soAltaVig, setSoAltaVig] = useState(false)
  const [soTalidomida, setSoTalidomida] = useState(false)
  const [soPadronizados, setSoPadronizados] = useState(false)
  const [destino, setDestino] = useState('')
  const [prontuario, setProntuario] = useState('')
  const [usuario, setUsuario] = useState('')

  // Listas de opções (classe/destino/usuário) saem dos próprios dados carregados.
  const [opcoes, setOpcoes] = useState<{ classes: string[]; destinos: string[]; usuarios: string[] }>(
    { classes: [], destinos: [], usuarios: [] }
  )

  // Só o período e o tipo vão para o servidor; o resto é refinado em memória,
  // assim mexer num filtro não custa uma ida ao banco.
  async function carregar() {
    setLoading(true)
    setErro(null)
    try {
      let query = supabase
        .from('v_farmacia_consumo')
        .select('*')
        .order('data', { ascending: false })

      if (dataDe) query = query.gte('data', `${dataDe}T00:00:00`)
      if (dataAte) query = query.lte('data', `${dataAte}T23:59:59`)

      const { data, error } = await query.range(0, MAX_ROWS - 1)
      if (error) throw error

      const lista = (data ?? []) as Consumo[]
      setRows(lista)
      setTruncado(lista.length >= MAX_ROWS)

      const uniq = (vals: (string | null)[]) =>
        Array.from(new Set(vals.filter((v): v is string => !!v && v.trim() !== ''))).sort(
          (a, b) => a.localeCompare(b, 'pt-BR')
        )
      setOpcoes({
        classes: uniq(lista.map((r) => r.classe)),
        destinos: uniq(lista.map((r) => r.destino)),
        usuarios: uniq(lista.map((r) => r.usuario)),
      })
    } catch (e) {
      console.error(e)
      setErro('Não foi possível carregar o consumo. Tente novamente.')
      setRows([])
    } finally {
      setLoading(false)
    }
  }

  // Carga inicial e toda vez que o período mudar — é o único filtro que vai ao banco.
  useEffect(() => { void carregar() }, [dataDe, dataAte])
  // Qualquer mudança de filtro reinicia a paginação do detalhado.
  useEffect(() => { setPage(0) }, [
    estoquesSel, tiposSel, busca, classe, soControlados, soAltaVig,
    soTalidomida, soPadronizados, destino, prontuario, usuario, modo,
  ])

  const filtradas = useMemo(() => {
    const termo = busca.trim().toLowerCase()
    return rows.filter((r) => {
      if (tiposSel.length > 0 && !tiposSel.includes(r.tipo)) return false
      if (estoquesSel.length > 0 && !estoquesSel.includes(r.estoque_codigo ?? '')) return false
      if (classe && r.classe !== classe) return false
      if (destino && r.destino !== destino) return false
      if (usuario && r.usuario !== usuario) return false
      if (soControlados && !r.controlado) return false
      if (soAltaVig && !r.alta_vigilancia) return false
      if (soTalidomida && !r.talidomida) return false
      if (soPadronizados && !r.padronizado) return false
      if (prontuario.trim() && !(r.prontuario ?? '').toLowerCase().includes(prontuario.trim().toLowerCase())) return false
      if (termo) {
        const alvo = `${r.item ?? ''} ${r.codigo ?? ''}`.toLowerCase()
        if (!alvo.includes(termo)) return false
      }
      return true
    })
  }, [rows, tiposSel, estoquesSel, classe, destino, usuario, soControlados,
      soAltaVig, soTalidomida, soPadronizados, prontuario, busca])

  const totais = useMemo(() => {
    let qtd = 0, custo = 0
    for (const r of filtradas) {
      qtd += r.quantidade ?? 0
      custo += r.custo_total ?? 0
    }
    return { saidas: filtradas.length, qtd, custo }
  }, [filtradas])

  // Resumo agregado: consumo somado por item, do maior para o menor.
  // Não carrega prontuário nem paciente — esses só aparecem no detalhado.
  const resumo = useMemo(() => {
    const mapa = new Map<string, {
      chave: string; item: string; codigo: string; unidade: string
      classe: string; qtd: number; saidas: number; custo: number
    }>()
    for (const r of filtradas) {
      const chave = r.item_id ?? `${r.codigo ?? ''}|${r.item ?? ''}`
      const atual = mapa.get(chave) ?? {
        chave,
        item: r.item ?? '—',
        codigo: r.codigo ?? '',
        unidade: r.unidade ?? '',
        classe: r.classe ?? '',
        qtd: 0, saidas: 0, custo: 0,
      }
      atual.qtd += r.quantidade ?? 0
      atual.custo += r.custo_total ?? 0
      atual.saidas += 1
      mapa.set(chave, atual)
    }
    return Array.from(mapa.values()).sort((a, b) => b.qtd - a.qtd)
  }, [filtradas])

  const listaAtual: unknown[] = modo === 'resumo' ? resumo : filtradas
  const totalPaginas = Math.max(1, Math.ceil(listaAtual.length / PAGE_SIZE))
  const inicio = page * PAGE_SIZE
  const resumoPagina = resumo.slice(inicio, inicio + PAGE_SIZE)
  const detalhePagina = filtradas.slice(inicio, inicio + PAGE_SIZE)

  // Etiquetas do que está ativo, para o usuário não se perder com o painel recolhido.
  const filtrosAtivos = useMemo(() => {
    const ativos: { rotulo: string; limpar: () => void }[] = []
    if (estoquesSel.length) ativos.push({ rotulo: `Estoque: ${estoquesSel.map((e) => ESTOQUES.find((x) => x.valor === e)?.rotulo ?? e).join(', ')}`, limpar: () => setEstoquesSel([]) })
    const tiposDiferentes = tiposSel.length !== TIPOS_PADRAO.length || !TIPOS_PADRAO.every((t) => tiposSel.includes(t))
    if (tiposDiferentes) ativos.push({ rotulo: `Tipo: ${tiposSel.map(rotuloTipo).join(', ') || 'nenhum'}`, limpar: () => setTiposSel(TIPOS_PADRAO) })
    if (busca.trim()) ativos.push({ rotulo: `Item: "${busca.trim()}"`, limpar: () => setBusca('') })
    if (classe) ativos.push({ rotulo: `Classe: ${classe}`, limpar: () => setClasse('') })
    if (soControlados) ativos.push({ rotulo: 'Só controlados', limpar: () => setSoControlados(false) })
    if (soAltaVig) ativos.push({ rotulo: 'Só alta vigilância', limpar: () => setSoAltaVig(false) })
    if (soTalidomida) ativos.push({ rotulo: 'Só talidomida', limpar: () => setSoTalidomida(false) })
    if (soPadronizados) ativos.push({ rotulo: 'Só padronizados', limpar: () => setSoPadronizados(false) })
    if (destino) ativos.push({ rotulo: `Destino: ${destino}`, limpar: () => setDestino('') })
    if (prontuario.trim()) ativos.push({ rotulo: `Prontuário: ${prontuario.trim()}`, limpar: () => setProntuario('') })
    if (usuario) ativos.push({ rotulo: `Usuário: ${usuario}`, limpar: () => setUsuario('') })
    return ativos
  }, [estoquesSel, tiposSel, busca, classe, soControlados, soAltaVig,
      soTalidomida, soPadronizados, destino, prontuario, usuario])

  function limparTudo() {
    setEstoquesSel([])
    setTiposSel(TIPOS_PADRAO)
    setBusca(''); setClasse(''); setDestino(''); setProntuario(''); setUsuario('')
    setSoControlados(false); setSoAltaVig(false); setSoTalidomida(false); setSoPadronizados(false)
  }

  function atalho(dias: 'hoje' | 7 | 30 | 'mes') {
    const agora = new Date()
    if (dias === 'hoje') { setDataDe(iso(agora)); setDataAte(iso(agora)); return }
    if (dias === 'mes') {
      setDataDe(iso(new Date(agora.getFullYear(), agora.getMonth(), 1)))
      setDataAte(iso(agora)); return
    }
    setDataDe(iso(new Date(agora.getTime() - (dias - 1) * 86400000)))
    setDataAte(iso(agora))
  }

  function alterna(lista: string[], valor: string, set: (v: string[]) => void) {
    set(lista.includes(valor) ? lista.filter((v) => v !== valor) : [...lista, valor])
  }

  // CSV gerado no navegador: separador ';' e BOM, que é o que o Excel pt-BR espera.
  function exportarCSV() {
    const cabecalho = modo === 'resumo'
      ? ['Item', 'Código', 'Unidade', 'Classe', 'Quantidade', 'Saídas', 'Custo total']
      : ['Data', 'Item', 'Código', 'Quantidade', 'Unidade', 'Estoque', 'Tipo',
         'Destino', 'Prontuário', 'Paciente', 'Lote', 'Validade', 'Custo total', 'Usuário']

    const linhas = modo === 'resumo'
      ? resumo.map((r) => [r.item, r.codigo, r.unidade, r.classe,
          fmtQtd(r.qtd), String(r.saidas), (r.custo ?? 0).toFixed(2).replace('.', ',')])
      : filtradas.map((r) => [
          fmtData(r.data), r.item ?? '', r.codigo ?? '', fmtQtd(r.quantidade), r.unidade ?? '',
          r.estoque ?? '', rotuloTipo(r.tipo), r.destino ?? '', r.prontuario ?? '',
          r.paciente ?? '', r.lote ?? '', fmtDia(r.validade),
          (r.custo_total ?? 0).toFixed(2).replace('.', ','), r.usuario ?? '',
        ])

    const escapa = (v: string) => `"${String(v ?? '').replace(/"/g, '""')}"`
    const csv = [cabecalho, ...linhas].map((l) => l.map(escapa).join(';')).join('\r\n')

    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `consumo_farmacia_${modo}_${dataDe}_a_${dataAte}.csv`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  const chip = (ativo: boolean): React.CSSProperties => ({
    fontSize: 12, padding: '6px 12px', borderRadius: 999, cursor: 'pointer',
    background: ativo ? 'rgba(37,99,235,0.15)' : (mode === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)'),
    border: `1px solid ${ativo ? 'rgba(37,99,235,0.45)' : (mode === 'dark' ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.08)')}`,
    color: ativo ? (mode === 'dark' ? '#93c5fd' : '#1d4ed8') : txtSec,
    fontWeight: ativo ? 600 : 500,
  })

  const th: React.CSSProperties = { ...lbl, padding: '10px 16px', marginBottom: 0, textAlign: 'left' }
  const thR: React.CSSProperties = { ...th, textAlign: 'right' }

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Cabeçalho */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: txt }}>Consumo da Farmácia</h1>
          <p className="text-sm" style={{ color: txtSec }}>
            Saídas registradas no sistema (dispensação por prescrição, atendimento de solicitação
            e saída avulsa)
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant={modo === 'resumo' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setModo('resumo')}>
            <BarChart3 size={14} className="mr-1" /> Resumo
          </Button>
          <Button
            variant={modo === 'detalhado' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setModo('detalhado')}>
            <ListOrdered size={14} className="mr-1" /> Detalhado
          </Button>
          <Button variant="outline" size="sm" onClick={exportarCSV} disabled={filtradas.length === 0}>
            <Download size={14} className="mr-1" /> CSV
          </Button>
        </div>
      </div>

      {/* Totais do que está filtrado */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="p-4" style={card}>
          <p style={lbl}>Saídas</p>
          <p className="text-2xl font-bold" style={{ color: txt }}>{totais.saidas.toLocaleString('pt-BR')}</p>
        </div>
        <div className="p-4" style={card}>
          <p style={lbl}>Quantidade total</p>
          <p className="text-2xl font-bold" style={{ color: txt }}>{fmtQtd(totais.qtd)}</p>
        </div>
        <div className="p-4" style={card}>
          <p style={lbl}>Custo total</p>
          <p className="text-2xl font-bold" style={{ color: txt }}>{fmtMoeda(totais.custo)}</p>
        </div>
      </div>

      {/* Filtros — painel recolhível, para a tela não virar um paredão */}
      <div style={card}>
        <button
          onClick={() => setFiltrosAbertos(!filtrosAbertos)}
          className="w-full px-5 py-3 flex items-center justify-between"
          style={{ background: 'transparent', border: 'none', cursor: 'pointer' }}>
          <span className="flex items-center gap-2 text-sm font-semibold" style={{ color: txt }}>
            <Filter size={16} style={{ color: txtMut }} />
            Filtros
            {filtrosAtivos.length > 0 && (
              <span className="text-xs font-medium px-2 py-0.5 rounded-full"
                style={{ background: 'rgba(37,99,235,0.15)', color: mode === 'dark' ? '#93c5fd' : '#1d4ed8' }}>
                {filtrosAtivos.length}
              </span>
            )}
          </span>
          {filtrosAbertos
            ? <ChevronUp size={16} style={{ color: txtMut }} />
            : <ChevronDown size={16} style={{ color: txtMut }} />}
        </button>

        {filtrosAbertos && (
          <div className="px-5 pb-5 space-y-4" style={{ borderTop: divisor, paddingTop: 16 }}>
            {/* Período */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div>
                <label style={lbl}>Data inicial</label>
                <input type="date" value={dataDe} onChange={(e) => setDataDe(e.target.value)} style={inputStyle} />
              </div>
              <div>
                <label style={lbl}>Data final</label>
                <input type="date" value={dataAte} onChange={(e) => setDataAte(e.target.value)} style={inputStyle} />
              </div>
              <div className="md:col-span-2">
                <label style={lbl}>Atalhos</label>
                <div className="flex flex-wrap gap-2">
                  <button style={chip(false)} onClick={() => atalho('hoje')}>Hoje</button>
                  <button style={chip(false)} onClick={() => atalho(7)}>7 dias</button>
                  <button style={chip(false)} onClick={() => atalho(30)}>30 dias</button>
                  <button style={chip(false)} onClick={() => atalho('mes')}>Mês atual</button>
                </div>
              </div>
            </div>

            {/* Estoque */}
            <div>
              <label style={lbl}>Estoque</label>
              <div className="flex flex-wrap gap-2">
                {ESTOQUES.map((e) => (
                  <button key={e.valor}
                    style={chip(estoquesSel.includes(e.valor))}
                    onClick={() => alterna(estoquesSel, e.valor, setEstoquesSel)}>
                    {e.rotulo}
                  </button>
                ))}
                {estoquesSel.length > 0 && (
                  <button style={chip(false)} onClick={() => setEstoquesSel([])}>Todos</button>
                )}
              </div>
            </div>

            {/* Tipo de saída */}
            <div>
              <label style={lbl}>Tipo de saída</label>
              <div className="flex flex-wrap gap-2">
                {TIPOS.map((t) => (
                  <button key={t.valor}
                    style={chip(tiposSel.includes(t.valor))}
                    onClick={() => alterna(tiposSel, t.valor, setTiposSel)}>
                    {t.rotulo}
                  </button>
                ))}
              </div>
            </div>

            {/* Busca e listas */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div>
                <label style={lbl}>Item (nome ou código)</label>
                <div className="relative">
                  <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: txtMut }} />
                  <input
                    value={busca}
                    onChange={(e) => setBusca(e.target.value)}
                    placeholder="Ex.: dipirona ou 1042"
                    style={{ ...inputStyle, paddingLeft: 32 }}
                  />
                </div>
              </div>
              <div>
                <label style={lbl}>Classe</label>
                <select value={classe} onChange={(e) => setClasse(e.target.value)} style={inputStyle}>
                  <option value="">Todas</option>
                  {opcoes.classes.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label style={lbl}>Destino (setor/unidade)</label>
                <select value={destino} onChange={(e) => setDestino(e.target.value)} style={inputStyle}>
                  <option value="">Todos</option>
                  {opcoes.destinos.map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>
              <div>
                <label style={lbl}>Usuário que realizou</label>
                <select value={usuario} onChange={(e) => setUsuario(e.target.value)} style={inputStyle}>
                  <option value="">Todos</option>
                  {opcoes.usuarios.map((u) => <option key={u} value={u}>{u}</option>)}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div>
                <label style={lbl}>Prontuário</label>
                <input
                  value={prontuario}
                  onChange={(e) => setProntuario(e.target.value)}
                  placeholder="Número do prontuário"
                  style={inputStyle}
                />
              </div>
              <div className="md:col-span-3">
                <label style={lbl}>Marcadores do item</label>
                <div className="flex flex-wrap gap-2">
                  <button style={chip(soControlados)} onClick={() => setSoControlados(!soControlados)}>Só controlados</button>
                  <button style={chip(soAltaVig)} onClick={() => setSoAltaVig(!soAltaVig)}>Só alta vigilância</button>
                  <button style={chip(soTalidomida)} onClick={() => setSoTalidomida(!soTalidomida)}>Só talidomida</button>
                  <button style={chip(soPadronizados)} onClick={() => setSoPadronizados(!soPadronizados)}>Só padronizados</button>
                </div>
              </div>
            </div>

            {/* Transferência/ajuste/devolução não são consumo assistencial. */}
            <div className="flex items-start gap-2 p-3 rounded-lg"
              style={{ background: mode === 'dark' ? 'rgba(37,99,235,0.08)' : 'rgba(37,99,235,0.06)' }}>
              <Info size={13} style={{ color: txtMut, marginTop: 2, flexShrink: 0 }} />
              <p className="text-xs" style={{ color: txtSec }}>
                <strong>Transferência</strong> entre estoques não é consumo: o material não saiu da
                farmácia, só mudou de lugar. O mesmo vale para <strong>ajuste</strong> e
                <strong> devolução interna</strong>, que apenas corrigem saldo. Por isso os três vêm
                desmarcados — marque-os apenas se quiser ver toda a movimentação.
              </p>
            </div>
          </div>
        )}

        {/* Filtros ativos + limpar tudo */}
        {filtrosAtivos.length > 0 && (
          <div className="px-5 py-3 flex flex-wrap items-center gap-2" style={{ borderTop: divisor }}>
            <span className="text-xs" style={{ color: txtMut }}>Ativos:</span>
            {filtrosAtivos.map((f) => (
              <button key={f.rotulo} onClick={f.limpar} style={{ ...chip(true), display: 'flex', alignItems: 'center', gap: 4 }}>
                {f.rotulo} <X size={11} />
              </button>
            ))}
            <Button variant="outline" size="sm" onClick={limparTudo} className="ml-auto">Limpar tudo</Button>
          </div>
        )}
      </div>

      {/* Resultado */}
      {loading ? (
        <div className="p-8 flex items-center justify-center gap-3" style={card}>
          <Loader2 size={20} className="animate-spin" style={{ color: txtMut }} />
          <span style={{ color: txtMut }}>Carregando consumo...</span>
        </div>
      ) : erro ? (
        <div className="p-8 text-center" style={card}>
          <p className="text-sm" style={{ color: '#dc2626' }}>{erro}</p>
        </div>
      ) : filtradas.length === 0 ? (
        <div className="p-10 flex flex-col items-center gap-2" style={card}>
          <p className="text-lg font-semibold" style={{ color: txt }}>Nenhuma saída encontrada</p>
          <p className="text-sm" style={{ color: txtMut }}>Tente ampliar o período ou afrouxar os filtros.</p>
        </div>
      ) : (
        <>
          <div style={{ ...card, overflow: 'hidden' }}>
            <div className="px-5 py-3 flex items-center justify-between" style={{ borderBottom: divisor }}>
              <p className="text-sm font-semibold" style={{ color: txt }}>
                {modo === 'resumo'
                  ? `${resumo.length} ${resumo.length === 1 ? 'item' : 'itens'} consumidos`
                  : `${filtradas.length} ${filtradas.length === 1 ? 'saída' : 'saídas'}`}
              </p>
              <p className="text-xs" style={{ color: txtMut }}>Página {page + 1} de {totalPaginas}</p>
            </div>

            <div style={{ overflowX: 'auto' }}>
              {modo === 'resumo' ? (
                // Resumo agregado — sem prontuário e sem nome de paciente (LGPD):
                // dado de paciente só faz sentido na leitura linha a linha.
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ borderBottom: cellBorder }}>
                      <th style={th}>Item</th>
                      <th style={th}>Classe</th>
                      <th style={thR}>Quantidade</th>
                      <th style={thR}>Saídas</th>
                      <th style={thR}>Custo total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {resumoPagina.map((r) => (
                      <tr key={r.chave} style={{ borderBottom: cellBorder }}>
                        <td style={{ padding: '10px 16px' }}>
                          <p style={{ color: txt, fontWeight: 500 }}>{r.item}</p>
                          {r.codigo && <p style={{ color: txtMut, fontSize: 11 }}>Cód. {r.codigo}</p>}
                        </td>
                        <td style={{ padding: '10px 16px', color: txtSec }}>{r.classe || '—'}</td>
                        <td style={{ padding: '10px 16px', textAlign: 'right', color: txt, fontWeight: 700, whiteSpace: 'nowrap' }}>
                          {fmtQtd(r.qtd)} {r.unidade}
                        </td>
                        <td style={{ padding: '10px 16px', textAlign: 'right', color: txtSec }}>{r.saidas}</td>
                        <td style={{ padding: '10px 16px', textAlign: 'right', color: txtSec, whiteSpace: 'nowrap' }}>
                          {fmtMoeda(r.custo)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ borderBottom: cellBorder }}>
                      <th style={th}>Data/hora</th>
                      <th style={th}>Item</th>
                      <th style={thR}>Quantidade</th>
                      <th style={th}>Estoque</th>
                      <th style={th}>Tipo</th>
                      <th style={th}>Destino / Paciente</th>
                      <th style={th}>Lote</th>
                      <th style={th}>Usuário</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detalhePagina.map((r) => (
                      <tr key={r.id} style={{ borderBottom: cellBorder }}>
                        <td style={{ padding: '10px 16px', color: txt, whiteSpace: 'nowrap' }}>{fmtData(r.data)}</td>
                        <td style={{ padding: '10px 16px' }}>
                          <p style={{ color: txt, fontWeight: 500 }}>{r.item ?? '—'}</p>
                          {r.codigo && <p style={{ color: txtMut, fontSize: 11 }}>Cód. {r.codigo}</p>}
                        </td>
                        <td style={{ padding: '10px 16px', textAlign: 'right', color: txt, fontWeight: 700, whiteSpace: 'nowrap' }}>
                          {fmtQtd(r.quantidade)} {r.unidade ?? ''}
                        </td>
                        <td style={{ padding: '10px 16px', color: txtSec }}>{r.estoque ?? '—'}</td>
                        <td style={{ padding: '10px 16px' }}>
                          <span className="text-xs px-2 py-1 rounded-full font-medium"
                            style={{
                              background: mode === 'dark' ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.05)',
                              color: txtSec,
                              border: `1px solid ${mode === 'dark' ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.08)'}`,
                            }}>
                            {rotuloTipo(r.tipo)}
                          </span>
                        </td>
                        <td style={{ padding: '10px 16px' }}>
                          <p style={{ color: txt }}>{r.destino ?? '—'}</p>
                          {(r.paciente || r.prontuario) && (
                            <p style={{ color: txtMut, fontSize: 11 }}>
                              {r.paciente ?? '—'}{r.prontuario ? ` · Pront. ${r.prontuario}` : ''}
                            </p>
                          )}
                        </td>
                        <td style={{ padding: '10px 16px', color: txtSec, whiteSpace: 'nowrap' }}>
                          {r.lote ?? '—'}
                          {r.validade && <span style={{ color: txtMut, fontSize: 11 }}> · val. {fmtDia(r.validade)}</span>}
                        </td>
                        <td style={{ padding: '10px 16px', color: txtSec }}>{r.usuario ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div className="px-5 py-3 flex items-start gap-2" style={{ borderTop: divisor }}>
              <Info size={13} style={{ color: txtMut, marginTop: 2, flexShrink: 0 }} />
              <p className="text-xs" style={{ color: txtMut }}>
                Os números vêm das saídas registradas no sistema (dispensação por prescrição,
                atendimento de solicitação e saída avulsa) — nada é digitado à parte.
                {truncado && ' O período pedido passou do teto de linhas por carga; estreite as datas para ver tudo.'}
              </p>
            </div>
          </div>

          {totalPaginas > 1 && (
            <div className="flex items-center justify-center gap-2">
              <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(page - 1)}>
                Anterior
              </Button>
              <span className="text-sm" style={{ color: txtSec }}>{page + 1} / {totalPaginas}</span>
              <Button variant="outline" size="sm" disabled={page >= totalPaginas - 1} onClick={() => setPage(page + 1)}>
                Próxima
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
