import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTheme } from '@/contexts/theme'
import { ArrowLeft, Search, Loader2, Filter, Info } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { supabase } from '@/lib/supabase'

const PAGE_SIZE = 25

// Espelho da view public.v_almox_movimentacao — a view traduz o audit_logs
// de warehouse_items para linguagem de estoque (saldo antes/depois, tipo, autor).
type Movimento = {
  id: string
  data: string
  item_id: string | null
  item: string | null
  codigo: string | null
  unidade: string | null
  saldo_antes: number | null
  saldo_depois: number | null
  delta: number | null
  tipo: string | null
  usuario_id: string | null
  usuario: string | null
  origem_provavel: string | null
}

function fmt(d: string | null | undefined) {
  if (!d) return '—'
  return new Date(d).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
}

function num(v: number | null | undefined) {
  if (v === null || v === undefined) return '—'
  // Saldos podem vir fracionados; corta o ,00 quando é inteiro.
  return Number.isInteger(v) ? String(v) : String(v)
}

export function AlmoxMovimentacao() {
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

  const [rows, setRows] = useState<Movimento[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)

  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [search, setSearch] = useState('')
  const [tipo, setTipo] = useState<'todos' | 'entrada' | 'saida'>('todos')

  const [page, setPage] = useState(0)

  // Busca só a página pedida: a view cresce todo dia, não dá para trazer tudo.
  async function load(targetPage: number) {
    setLoading(true)
    try {
      let query = supabase
        .from('v_almox_movimentacao')
        .select('*', { count: 'exact' })
        .order('data', { ascending: false })

      if (dateFrom) query = query.gte('data', `${dateFrom}T00:00:00`)
      if (dateTo) query = query.lte('data', `${dateTo}T23:59:59`)
      if (tipo !== 'todos') query = query.eq('tipo', tipo)
      if (search.trim()) {
        const t = search.trim()
        query = query.or(`item.ilike.%${t}%,codigo.ilike.%${t}%`)
      }

      const from = targetPage * PAGE_SIZE
      const { data, count, error } = await query.range(from, from + PAGE_SIZE - 1)
      if (error) throw error

      setRows((data ?? []) as Movimento[])
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

  useEffect(() => { void load(0) }, [])

  function applyFilters() {
    void load(0)
  }

  function clearFilters() {
    setDateFrom(''); setDateTo(''); setSearch(''); setTipo('todos')
    // load() lê o state antigo nesta volta do render; por isso limpa direto na query.
    setTimeout(() => void load(0), 0)
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  return (
    <div className="max-w-6xl mx-auto space-y-6">
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
          <h1 className="text-2xl font-bold" style={{ color: txt }}>Movimentação</h1>
          <p className="text-sm" style={{ color: txtSec }}>Toda entrada e saída de material, com saldo antes e depois</p>
        </div>
      </div>

      {/* Filtros */}
      <div className="p-5 space-y-4" style={card}>
        <div className="flex items-center gap-2">
          <Filter size={16} style={{ color: txtMut }} />
          <span className="text-sm font-semibold" style={{ color: txt }}>Filtros</span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div>
            <label style={lbl}>Data inicial</label>
            <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} style={inputStyle} />
          </div>
          <div>
            <label style={lbl}>Data final</label>
            <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} style={inputStyle} />
          </div>
          <div>
            <label style={lbl}>Tipo</label>
            <select
              value={tipo}
              onChange={(e) => setTipo(e.target.value as 'todos' | 'entrada' | 'saida')}
              style={inputStyle}>
              <option value="todos">Todos</option>
              <option value="entrada">Entradas</option>
              <option value="saida">Saídas</option>
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
          <span style={{ color: txtMut }}>Carregando movimentação...</span>
        </div>
      ) : rows.length === 0 ? (
        <div className="p-10 flex flex-col items-center gap-2" style={card}>
          <p className="text-lg font-semibold" style={{ color: txt }}>Nenhuma movimentação encontrada</p>
          <p className="text-sm" style={{ color: txtMut }}>Tente ajustar os filtros de busca.</p>
        </div>
      ) : (
        <>
          <div style={{ ...card, overflow: 'hidden' }}>
            <div className="px-5 py-3 flex items-center justify-between"
              style={{ borderBottom: `1px solid ${mode === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)'}` }}>
              <p className="text-sm font-semibold" style={{ color: txt }}>
                {total} movimento{total !== 1 ? 's' : ''}
              </p>
              <p className="text-xs" style={{ color: txtMut }}>
                Página {page + 1} de {totalPages}
              </p>
            </div>

            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: cellBorder }}>
                    <th style={{ ...lbl, textAlign: 'left', padding: '10px 16px', marginBottom: 0 }}>Data/hora</th>
                    <th style={{ ...lbl, textAlign: 'left', padding: '10px 16px', marginBottom: 0 }}>Item</th>
                    <th style={{ ...lbl, textAlign: 'left', padding: '10px 16px', marginBottom: 0 }}>Tipo</th>
                    <th style={{ ...lbl, textAlign: 'right', padding: '10px 16px', marginBottom: 0 }}>Quantidade</th>
                    <th style={{ ...lbl, textAlign: 'right', padding: '10px 16px', marginBottom: 0 }}>Saldo</th>
                    <th style={{ ...lbl, textAlign: 'left', padding: '10px 16px', marginBottom: 0 }}>Usuário</th>
                    <th
                      style={{ ...lbl, textAlign: 'left', padding: '10px 16px', marginBottom: 0 }}
                      title="Pista inferida pelo horário do lançamento — não é um vínculo com o documento.">
                      Origem provável
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((m) => {
                    const isEntrada = m.tipo === 'entrada'
                    const cor = isEntrada ? '#059669' : '#dc2626'
                    const delta = m.delta ?? 0
                    return (
                      <tr key={m.id} style={{ borderBottom: cellBorder }}>
                        <td style={{ padding: '10px 16px', color: txt, whiteSpace: 'nowrap' }}>{fmt(m.data)}</td>
                        <td style={{ padding: '10px 16px' }}>
                          <p style={{ color: txt, fontWeight: 500 }}>{m.item ?? '—'}</p>
                          {m.codigo && <p style={{ color: txtMut, fontSize: 11 }}>Cód. {m.codigo}</p>}
                        </td>
                        <td style={{ padding: '10px 16px' }}>
                          <span
                            className="text-xs px-2 py-1 rounded-full font-medium"
                            style={{
                              background: isEntrada ? 'rgba(16,185,129,0.12)' : 'rgba(239,68,68,0.12)',
                              color: isEntrada ? '#065f46' : '#991b1b',
                              border: `1px solid ${isEntrada ? 'rgba(16,185,129,0.35)' : 'rgba(239,68,68,0.35)'}`,
                            }}>
                            {isEntrada ? 'Entrada' : 'Saída'}
                          </span>
                        </td>
                        <td style={{ padding: '10px 16px', textAlign: 'right', color: cor, fontWeight: 700, whiteSpace: 'nowrap' }}>
                          {delta > 0 ? `+${num(delta)}` : num(delta)} {m.unidade ?? ''}
                        </td>
                        <td style={{ padding: '10px 16px', textAlign: 'right', color: txtSec, whiteSpace: 'nowrap' }}>
                          {num(m.saldo_antes)} <span style={{ color: txtMut }}>→</span>{' '}
                          <strong style={{ color: txt }}>{num(m.saldo_depois)}</strong>
                        </td>
                        <td style={{ padding: '10px 16px', color: txt }}>{m.usuario ?? '—'}</td>
                        <td style={{ padding: '10px 16px', color: txtSec }}>{m.origem_provavel ?? '—'}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {/* A origem é inferida por proximidade de horário — deixa isso explícito. */}
            <div className="px-5 py-3 flex items-start gap-2"
              style={{ borderTop: `1px solid ${mode === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)'}` }}>
              <Info size={13} style={{ color: txtMut, marginTop: 2, flexShrink: 0 }} />
              <p className="text-xs" style={{ color: txtMut }}>
                A coluna <strong>Origem provável</strong> é uma pista: ela é deduzida pela proximidade de horário
                entre o movimento e os documentos do dia, não por vínculo direto. Use como indício, não como prova.
              </p>
            </div>
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page === 0}
                onClick={() => void load(page - 1)}>
                Anterior
              </Button>
              <span className="text-sm" style={{ color: txtSec }}>
                {page + 1} / {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= totalPages - 1}
                onClick={() => void load(page + 1)}>
                Próxima
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
