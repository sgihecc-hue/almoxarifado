import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTheme } from '@/contexts/theme'
import { ArrowLeft, Search, Loader2, Filter, Info, Download, AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { supabase } from '@/lib/supabase'

const PAGE_SIZE = 25

// Espelho da view public.v_almox_ressuprimento — a view aplica o POP.ALMXEPRO.09
// (CDM, ponto de ressuprimento, estoque mínimo) sobre o consumo das 8 últimas
// semanas completas. A tela é SÓ LEITURA: nada aqui grava no banco.
type LinhaRessuprimento = {
  item_id: string
  item: string | null
  codigo: string | null
  unidade: string | null
  saldo_atual: number | null
  consumo_periodo: number | null
  consumo_semanal: number | null
  cdm: number | null
  consumo_mensal: number | null
  prazo_reposicao: number | null
  ponto_ressuprimento: number | null
  estoque_minimo: number | null
  compra_estimada_90d: number | null
  dias_de_cobertura: number | null
  situacao: string | null
  prazo_padrao: boolean | null
}

type Situacao = 'todas' | 'zerado' | 'comprar' | 'ok' | 'sem consumo'

function num(v: number | null | undefined) {
  if (v === null || v === undefined) return '—'
  return String(v)
}

export function Ressuprimento() {
  const navigate = useNavigate()
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

  // Cores por situação — o operador precisa bater o olho e ver o que comprar.
  function estiloSituacao(s: string | null) {
    switch (s) {
      case 'zerado':
        return { bg: 'rgba(239,68,68,0.12)', fg: '#991b1b', bd: 'rgba(239,68,68,0.35)', rotulo: 'Zerado' }
      case 'comprar':
        return { bg: 'rgba(245,158,11,0.14)', fg: '#92400e', bd: 'rgba(245,158,11,0.4)', rotulo: 'Comprar' }
      case 'ok':
        return { bg: 'rgba(16,185,129,0.10)', fg: '#065f46', bd: 'rgba(16,185,129,0.3)', rotulo: 'OK' }
      default:
        // 'sem consumo': item parado nas 8 semanas — não há CDM para calcular nada.
        return { bg: 'rgba(120,120,120,0.10)', fg: txtMut, bd: 'rgba(120,120,120,0.25)', rotulo: 'Sem consumo' }
    }
  }

  const [rows, setRows] = useState<LinhaRessuprimento[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [exportando, setExportando] = useState(false)

  const [search, setSearch] = useState('')
  const [situacao, setSituacao] = useState<Situacao>('todas')
  const [page, setPage] = useState(0)

  // Resumo do cabeçalho: contagens sobre a base inteira, independentes do filtro.
  const [qtdZerado, setQtdZerado] = useState(0)
  const [qtdComprar, setQtdComprar] = useState(0)

  // Monta a consulta com os filtros correntes. Recebe os valores por parâmetro
  // porque "Limpar" precisa consultar antes do state novo chegar no render.
  function montarQuery(fSearch: string, fSituacao: Situacao) {
    let query = supabase
      .from('v_almox_ressuprimento')
      .select('*', { count: 'exact' })
      // Ordem de urgência sem depender de CASE no PostgREST: dias_de_cobertura
      // cresce junto com a folga. Zerado tem cobertura 0, 'comprar' fica abaixo
      // do prazo, 'ok' acima, e 'sem consumo' vem NULL — por isso nulls por último.
      .order('dias_de_cobertura', { ascending: true, nullsFirst: false })
      .order('item', { ascending: true })

    if (fSituacao !== 'todas') query = query.eq('situacao', fSituacao)
    if (fSearch.trim()) {
      const t = fSearch.trim()
      query = query.or(`item.ilike.%${t}%,codigo.ilike.%${t}%`)
    }
    return query
  }

  async function carregarResumo() {
    try {
      const [zer, comp] = await Promise.all([
        supabase.from('v_almox_ressuprimento').select('item_id', { count: 'exact', head: true }).eq('situacao', 'zerado'),
        supabase.from('v_almox_ressuprimento').select('item_id', { count: 'exact', head: true }).eq('situacao', 'comprar'),
      ])
      setQtdZerado(zer.count ?? 0)
      setQtdComprar(comp.count ?? 0)
    } catch (e) {
      console.error(e)
    }
  }

  async function load(targetPage: number, fSearch = search, fSituacao = situacao) {
    setLoading(true)
    try {
      const from = targetPage * PAGE_SIZE
      const { data, count, error } = await montarQuery(fSearch, fSituacao)
        .range(from, from + PAGE_SIZE - 1)
      if (error) throw error

      setRows((data ?? []) as LinhaRessuprimento[])
      setTotal(count ?? 0)
      setPage(targetPage)
    } catch (e) {
      console.error(e)
      setRows([])
      setTotal(0)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load(0); void carregarResumo() }, [])

  function applyFilters() {
    void load(0)
  }

  function clearFilters() {
    setSearch(''); setSituacao('todas')
    void load(0, '', 'todas')
  }

  // O POP manda registrar os parâmetros usados, com data e responsável. O CSV
  // sai com TODAS as linhas do filtro atual (não só a página) e é gerado no
  // próprio navegador — nenhuma chamada de escrita no banco.
  async function exportarCSV() {
    setExportando(true)
    try {
      const { data, error } = await montarQuery(search, situacao)
      if (error) throw error
      const linhas = (data ?? []) as LinhaRessuprimento[]

      const cab = [
        'Codigo', 'Item', 'Unidade', 'Saldo atual', 'Consumo 8 semanas', 'Consumo semanal',
        'CDM', 'Consumo mensal', 'Prazo reposicao (dias)', 'Prazo padrao do POP',
        'Ponto de ressuprimento', 'Estoque minimo (45d)', 'Compra sugerida (90d)',
        'Dias de cobertura', 'Situacao',
      ]
      const esc = (v: unknown) => {
        const s = v === null || v === undefined ? '' : String(v)
        return `"${s.replace(/"/g, '""')}"`
      }
      const corpo = linhas.map((r) => [
        r.codigo, r.item, r.unidade, r.saldo_atual, r.consumo_periodo, r.consumo_semanal,
        r.cdm, r.consumo_mensal, r.prazo_reposicao, r.prazo_padrao ? 'sim' : 'nao',
        r.ponto_ressuprimento, r.estoque_minimo, r.compra_estimada_90d,
        r.dias_de_cobertura, r.situacao,
      ].map(esc).join(';'))

      const emissao = new Date().toLocaleString('pt-BR')
      const rodape = [
        '',
        esc(`Emitido em ${emissao} — POP.ALMXEPRO.09`),
        esc('Base: consumo das ultimas 8 semanas completas (pedidos atendidos + saidas diretas)'),
        esc('Prazo padrao do POP = 30 dias, ainda nao confirmado pelo Setor de Compras'),
      ]

      // BOM na frente para o Excel abrir os acentos corretamente.
      const csv = '﻿' + [cab.map(esc).join(';'), ...corpo, ...rodape].join('\r\n')
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }))
      const a = document.createElement('a')
      a.href = url
      a.download = `ressuprimento-${new Date().toISOString().slice(0, 10)}.csv`
      a.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      console.error(e)
    } finally {
      setExportando(false)
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const thStyle: React.CSSProperties = { ...lbl, padding: '10px 16px', marginBottom: 0 }

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <button
          onClick={() => navigate(-1)}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            width: 40, height: 40, borderRadius: 10, cursor: 'pointer',
            background: mode === 'dark' ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.06)',
            border: `1px solid ${mode === 'dark' ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.08)'}`,
            color: txt,
          }}>
          <ArrowLeft size={18} />
        </button>
        <div>
          <h1 className="text-2xl font-bold" style={{ color: txt }}>Ressuprimento</h1>
          <p className="text-sm" style={{ color: txtSec }}>
            Ponto de ressuprimento e estoque mínimo, conforme POP.ALMXEPRO.09
          </p>
        </div>
      </div>

      {/* Resumo — o que o comprador precisa saber antes de olhar a lista */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="p-4 flex items-center gap-3" style={card}>
          <AlertTriangle size={20} style={{ color: '#dc2626', flexShrink: 0 }} />
          <div>
            <p className="text-2xl font-bold" style={{ color: '#dc2626' }}>{qtdZerado}</p>
            <p className="text-xs" style={{ color: txtSec }}>
              {qtdZerado === 1 ? 'item zerado' : 'itens zerados'} — sem saldo em estoque
            </p>
          </div>
        </div>
        <div className="p-4 flex items-center gap-3" style={card}>
          <AlertTriangle size={20} style={{ color: '#d97706', flexShrink: 0 }} />
          <div>
            <p className="text-2xl font-bold" style={{ color: '#d97706' }}>{qtdComprar}</p>
            <p className="text-xs" style={{ color: txtSec }}>
              {qtdComprar === 1 ? 'item atingiu' : 'itens atingiram'} o ponto de ressuprimento
            </p>
          </div>
        </div>
      </div>

      {/* De onde vem o número — sem isso o operador não confia na tela */}
      <div className="px-5 py-3 flex items-start gap-2" style={card}>
        <Info size={13} style={{ color: txtMut, marginTop: 3, flexShrink: 0 }} />
        <p className="text-xs" style={{ color: txtSec }}>
          O cálculo usa o <strong>consumo das últimas 8 semanas completas</strong> (pedidos atendidos + saídas
          diretas), conforme <strong>POP.ALMXEPRO.09</strong>. O consumo diário médio (CDM) é a base de todos os
          demais números: ponto de ressuprimento = CDM × prazo de reposição, estoque mínimo = CDM × 45 dias e
          compra sugerida = CDM × 90 dias.
        </p>
      </div>

      {/* Filtros */}
      <div className="p-5 space-y-4" style={card}>
        <div className="flex items-center gap-2">
          <Filter size={16} style={{ color: txtMut }} />
          <span className="text-sm font-semibold" style={{ color: txt }}>Filtros</span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label style={lbl}>Situação</label>
            <select
              value={situacao}
              onChange={(e) => setSituacao(e.target.value as Situacao)}
              style={inputStyle}>
              <option value="todas">Todas</option>
              <option value="zerado">Zerado</option>
              <option value="comprar">Comprar</option>
              <option value="ok">OK</option>
              <option value="sem consumo">Sem consumo</option>
            </select>
          </div>
          <div>
            <label style={lbl}>Busca</label>
            <div className="relative">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: txtMut }} />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && applyFilters()}
                placeholder="Nome ou código do item..."
                style={{ ...inputStyle, paddingLeft: 32 }}
              />
            </div>
          </div>
        </div>
        <div className="flex gap-2 justify-end">
          <Button variant="outline" size="sm" onClick={() => void exportarCSV()} disabled={exportando || loading}>
            {exportando
              ? <Loader2 size={13} className="mr-1 animate-spin" />
              : <Download size={13} className="mr-1" />}
            Exportar CSV
          </Button>
          <Button variant="outline" size="sm" onClick={clearFilters}>Limpar</Button>
          <Button size="sm" onClick={applyFilters} className="bg-blue-600 hover:bg-blue-700 text-white">
            <Search size={13} className="mr-1" /> Buscar
          </Button>
        </div>
      </div>

      {/* Lista */}
      {loading ? (
        <div className="p-8 flex items-center justify-center gap-3" style={card}>
          <Loader2 size={20} className="animate-spin" style={{ color: txtMut }} />
          <span style={{ color: txtMut }}>Calculando ressuprimento...</span>
        </div>
      ) : rows.length === 0 ? (
        <div className="p-10 flex flex-col items-center gap-2" style={card}>
          <p className="text-lg font-semibold" style={{ color: txt }}>Nenhum item encontrado</p>
          <p className="text-sm" style={{ color: txtMut }}>Tente ajustar os filtros de busca.</p>
        </div>
      ) : (
        <>
          <div style={{ ...card, overflow: 'hidden' }}>
            <div className="px-5 py-3 flex items-center justify-between"
              style={{ borderBottom: `1px solid ${mode === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)'}` }}>
              <p className="text-sm font-semibold" style={{ color: txt }}>
                {total} {total !== 1 ? 'itens' : 'item'}
              </p>
              <p className="text-xs" style={{ color: txtMut }}>
                Página {page + 1} de {totalPages}
              </p>
            </div>

            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: cellBorder }}>
                    <th style={{ ...thStyle, textAlign: 'left' }}>Item</th>
                    <th style={{ ...thStyle, textAlign: 'right' }}>Saldo atual</th>
                    <th style={{ ...thStyle, textAlign: 'right' }} title="Consumo diário médio nas 8 últimas semanas">CDM</th>
                    <th style={{ ...thStyle, textAlign: 'right' }}>Consumo mensal</th>
                    <th style={{ ...thStyle, textAlign: 'right' }} title="CDM × prazo de reposição">Ponto de ressuprimento</th>
                    <th style={{ ...thStyle, textAlign: 'right' }}>Estoque mínimo (45d)</th>
                    <th style={{ ...thStyle, textAlign: 'right' }}>Compra sugerida (90d)</th>
                    <th style={{ ...thStyle, textAlign: 'right' }}>Dias de cobertura</th>
                    <th style={{ ...thStyle, textAlign: 'left' }}>Situação</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const st = estiloSituacao(r.situacao)
                    const semConsumo = r.situacao === 'sem consumo'
                    // Item parado não tem CDM: mostrar zeros seria mentira de cálculo.
                    const corLinha = semConsumo ? txtMut : txt
                    const fundo =
                      r.situacao === 'zerado' ? 'rgba(239,68,68,0.06)'
                        : r.situacao === 'comprar' ? 'rgba(245,158,11,0.06)'
                          : 'transparent'
                    return (
                      <tr key={r.item_id} style={{ borderBottom: cellBorder, background: fundo }}>
                        <td style={{ padding: '10px 16px' }}>
                          <p style={{ color: corLinha, fontWeight: 500 }}>{r.item ?? '—'}</p>
                          <p style={{ color: txtMut, fontSize: 11 }}>
                            {r.codigo ? `Cód. ${r.codigo}` : 'Sem código'}
                            {r.unidade ? ` · ${r.unidade}` : ''}
                          </p>
                        </td>
                        <td style={{ padding: '10px 16px', textAlign: 'right', color: corLinha, fontWeight: 600, whiteSpace: 'nowrap' }}>
                          {num(r.saldo_atual)}
                        </td>
                        <td style={{ padding: '10px 16px', textAlign: 'right', color: semConsumo ? txtMut : txtSec }}>
                          {semConsumo ? '—' : num(r.cdm)}
                        </td>
                        <td style={{ padding: '10px 16px', textAlign: 'right', color: semConsumo ? txtMut : txtSec }}>
                          {semConsumo ? '—' : num(r.consumo_mensal)}
                        </td>
                        <td style={{ padding: '10px 16px', textAlign: 'right', color: semConsumo ? txtMut : corLinha, whiteSpace: 'nowrap' }}>
                          {semConsumo ? '—' : num(r.ponto_ressuprimento)}
                          {/* Prazo ainda não confirmado pelo Setor de Compras */}
                          {r.prazo_padrao && !semConsumo && (
                            <span
                              style={{ color: '#d97706', fontWeight: 700, marginLeft: 2 }}
                              title={`Prazo de ${r.prazo_reposicao ?? 30} dias: padrão do POP, ainda não confirmado pelo Setor de Compras`}>
                              *
                            </span>
                          )}
                          <span style={{ color: txtMut, fontSize: 11, display: 'block' }}>
                            {r.prazo_reposicao !== null && r.prazo_reposicao !== undefined
                              ? `prazo ${r.prazo_reposicao}d`
                              : 'sem prazo'}
                          </span>
                        </td>
                        <td style={{ padding: '10px 16px', textAlign: 'right', color: semConsumo ? txtMut : txtSec }}>
                          {semConsumo ? '—' : num(r.estoque_minimo)}
                        </td>
                        <td style={{ padding: '10px 16px', textAlign: 'right', color: semConsumo ? txtMut : corLinha, fontWeight: 600 }}>
                          {semConsumo ? '—' : num(r.compra_estimada_90d)}
                        </td>
                        <td style={{ padding: '10px 16px', textAlign: 'right', color: semConsumo ? txtMut : txtSec, whiteSpace: 'nowrap' }}>
                          {r.dias_de_cobertura === null || r.dias_de_cobertura === undefined
                            ? '—'
                            : `${r.dias_de_cobertura} d`}
                        </td>
                        <td style={{ padding: '10px 16px' }}>
                          <span
                            className="text-xs px-2 py-1 rounded-full font-medium"
                            style={{ background: st.bg, color: st.fg, border: `1px solid ${st.bd}`, whiteSpace: 'nowrap' }}>
                            {st.rotulo}
                          </span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {/* Legenda — o asterisco e o 'sem consumo' precisam de explicação */}
            <div className="px-5 py-3 space-y-2"
              style={{ borderTop: `1px solid ${mode === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)'}` }}>
              <div className="flex items-start gap-2">
                <span style={{ color: '#d97706', fontWeight: 700, lineHeight: '16px' }}>*</span>
                <p className="text-xs" style={{ color: txtMut }}>
                  Prazo de reposição de <strong>30 dias</strong>, o padrão do POP.ALMXEPRO.09 usado enquanto o
                  prazo real do item não é <strong>confirmado pelo Setor de Compras</strong>. O ponto de
                  ressuprimento desses itens é uma estimativa.
                </p>
              </div>
              <div className="flex items-start gap-2">
                <Info size={13} style={{ color: txtMut, marginTop: 2, flexShrink: 0 }} />
                <p className="text-xs" style={{ color: txtMut }}>
                  Itens <strong>sem consumo</strong> não tiveram saída nas 8 semanas: sem CDM não existe ponto de
                  ressuprimento nem sugestão de compra, por isso os números aparecem como "—". Eles seguem no fim
                  da lista para não competir com o que precisa de compra.
                </p>
              </div>
            </div>
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2">
              <Button variant="outline" size="sm" disabled={page === 0} onClick={() => void load(page - 1)}>
                Anterior
              </Button>
              <span className="text-sm" style={{ color: txtSec }}>
                {page + 1} / {totalPages}
              </span>
              <Button variant="outline" size="sm" disabled={page >= totalPages - 1} onClick={() => void load(page + 1)}>
                Próxima
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
