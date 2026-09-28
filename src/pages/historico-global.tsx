import { useEffect, useMemo, useState } from 'react'
import { useTheme } from '@/contexts/theme'
import { useAuth } from '@/contexts/auth'
import {
  History, Search, RefreshCw, Loader2, AlertCircle, ChevronDown, ChevronRight,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { auditLogService } from '@/lib/services/audit-log'
import type { AuditLogEntry, AuditOrigem } from '@/lib/services/audit-log'
import { hojeLocal } from '@/lib/utils/seguro'

const PAGINA = 500

const ENTITIES = [
  'pharmacy_dispensations',
  'requests',
  'pharmacy_items',
  'warehouse_items',
  'stock_entries',
  'patients',
  'external_units',
  'users',
  'stock_movement',
  'livros_controlados',
  'medication_losses',
  'notificacao_receita',
  'bmpo_balancos',
]

export function HistoricoGlobal() {
  const { mode } = useTheme()
  const { user } = useAuth()
  const isAdmin = user?.role === 'administrador'

  const txt = mode === 'dark' ? '#fff' : '#0d2e1c'
  const txtSec = mode === 'dark' ? 'rgba(255,255,255,0.7)' : 'rgba(13,46,28,0.65)'
  const txtMut = mode === 'dark' ? 'rgba(255,255,255,0.45)' : 'rgba(13,46,28,0.45)'

  const glass: React.CSSProperties = {
    background: mode === 'dark' ? 'rgba(10,15,20,0.55)' : 'rgba(255,255,255,0.65)',
    backdropFilter: 'blur(30px)', WebkitBackdropFilter: 'blur(30px)',
    border: `1px solid ${mode === 'dark' ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.5)'}`,
    borderRadius: 16,
  }
  const inputStyle: React.CSSProperties = {
    background: mode === 'dark' ? 'rgba(0,0,0,0.3)' : 'rgba(255,255,255,0.5)',
    border: `1px solid ${mode === 'dark' ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.08)'}`,
    borderRadius: 10, padding: '8px 12px', fontSize: 14,
    color: txt, outline: 'none',
  }

  const [rows, setRows] = useState<AuditLogEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)

  const [search, setSearch] = useState('')
  // Periodo padrao: ultimos 7 dias (a busca agora varre o banco; sem periodo
  // ficaria lenta). Pode ser ampliado nos campos de data.
  const [dateFrom, setDateFrom] = useState(() => { const d = new Date(); d.setDate(d.getDate() - 6); return hojeLocal(d) })
  const [dateTo, setDateTo] = useState(() => hojeLocal())
  const [temMais, setTemMais] = useState(false)
  const [carregandoMais, setCarregandoMais] = useState(false)
  const [actorId, setActorId] = useState('')
  const [origem, setOrigem] = useState<AuditOrigem | ''>('')
  const [entity, setEntity] = useState('')
  const [action, setAction] = useState('')

  const [actors, setActors] = useState<Array<{ id: string; full_name: string }>>([])

  const filtrosAtuais = () => ({
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
    actorId: actorId || undefined,
    origem: origem || undefined,
    entity: entity || undefined,
    action: action || undefined,
    search: search || undefined,
    limit: PAGINA,
  })

  async function load() {
    try {
      setLoading(true)
      setError(null)
      const r = await auditLogService.list({ ...filtrosAtuais(), offset: 0 })
      setRows(r)
      setTemMais(r.length === PAGINA)
    } catch (e: any) {
      setError(e?.message || 'Erro ao carregar histórico')
      setRows([])
      setTemMais(false)
    } finally {
      setLoading(false)
    }
  }

  async function carregarMais() {
    if (carregandoMais) return
    try {
      setCarregandoMais(true)
      const r = await auditLogService.list({ ...filtrosAtuais(), offset: rows.length })
      setRows((atual) => [...atual, ...r])
      setTemMais(r.length === PAGINA)
    } catch (e: any) {
      setError(e?.message || 'Erro ao carregar mais eventos')
    } finally {
      setCarregandoMais(false)
    }
  }

  useEffect(() => {
    if (!isAdmin) return
    auditLogService.listActors().then(setActors).catch(console.error)
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin])

  useEffect(() => {
    if (!isAdmin) return
    const t = setTimeout(load, 500)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, dateFrom, dateTo, actorId, origem, entity, action])

  const actions = useMemo(() => {
    // Lista única das ações observadas (pra alimentar o dropdown).
    const set = new Set<string>()
    rows.forEach((r) => set.add(r.action))
    return Array.from(set).sort()
  }, [rows])

  if (!isAdmin) {
    return (
      <div className="max-w-2xl mx-auto p-8 text-center" style={glass}>
        <AlertCircle className="w-10 h-10 mx-auto mb-3" style={{ color: txtMut }} />
        <p style={{ color: txt }}>Acesso restrito a administradores.</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2" style={{ color: txt }}>
            <History className="w-6 h-6" /> Histórico Global
          </h1>
          <p className="text-sm mt-1" style={{ color: txtSec }}>
            Trilha unificada de auditoria (cadastros) e movimentações de estoque.
          </p>
        </div>
        <Button variant="outline" onClick={load}>
          <RefreshCw className="w-4 h-4 mr-2" /> Atualizar
        </Button>
      </div>

      {/* Filtros */}
      <div className="p-4 grid grid-cols-1 md:grid-cols-6 gap-3" style={glass}>
        <div className="relative md:col-span-2">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: txtMut }} />
          <input
            type="text"
            placeholder="Buscar (id, payload, nome)..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ ...inputStyle, paddingLeft: 34, width: '100%' }}
          />
        </div>
        <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} style={inputStyle} />
        <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} style={inputStyle} />

        <select value={actorId} onChange={(e) => setActorId(e.target.value)} style={inputStyle}>
          <option value="">Todos os usuários</option>
          {actors.map((a) => (
            <option key={a.id} value={a.id}>{a.full_name}</option>
          ))}
        </select>

        <select value={origem} onChange={(e) => setOrigem(e.target.value as AuditOrigem | '')} style={inputStyle}>
          <option value="">Todas origens</option>
          <option value="audit">Auditoria</option>
          <option value="stock">Movim. estoque</option>
        </select>

        <select value={entity} onChange={(e) => setEntity(e.target.value)} style={inputStyle}>
          <option value="">Todas entidades</option>
          {ENTITIES.map((e) => <option key={e} value={e}>{e}</option>)}
        </select>

        <select value={action} onChange={(e) => setAction(e.target.value)} style={inputStyle}>
          <option value="">Todas ações</option>
          {actions.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
      </div>

      {error && (
        <div className="p-4 rounded-xl bg-red-100 border border-red-200 flex items-center gap-2 text-red-800 text-sm">
          <AlertCircle size={16} /> <span className="flex-1">{error}</span>
          <Button variant="outline" size="sm" onClick={load}>Tentar de novo</Button>
        </div>
      )}

      {/* Tabela */}
      <div style={glass} className="overflow-hidden">
        <table className="w-full">
          <thead>
            <tr style={{ borderBottom: `1px solid ${mode === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)'}` }}>
              {['', 'Quando', 'Quem', 'Origem', 'Ação', 'Entidade', 'ID'].map((h) => (
                <th key={h} className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider" style={{ color: txtMut }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={7} className="text-center py-12" style={{ color: txtMut }}>
                  <Loader2 className="w-5 h-5 animate-spin inline mr-2" /> Carregando...
                </td>
              </tr>
            ) : error && rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="text-center py-12" style={{ color: '#ef4444' }}>
                  Dados não carregados.
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="text-center py-12" style={{ color: txtMut }}>
                  Nenhum evento com esses filtros.
                </td>
              </tr>
            ) : (
              rows.map((r, i) => {
                const key = `${r.origem}-${r.entity}-${r.entity_id}-${r.ts}`
                const isOpen = expanded === key
                return (
                  <>
                    <tr
                      key={key}
                      onClick={() => setExpanded(isOpen ? null : key)}
                      style={{
                        borderBottom: `1px solid ${mode === 'dark' ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)'}`,
                        background: i % 2 === 0 ? (mode === 'dark' ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)') : 'transparent',
                        cursor: 'pointer',
                      }}
                    >
                      <td className="px-4 py-3 text-xs" style={{ color: txtMut }}>
                        {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                      </td>
                      <td className="px-4 py-3 text-xs whitespace-nowrap" style={{ color: txtSec }}>
                        {format(new Date(r.ts), "dd/MM/yyyy HH:mm:ss", { locale: ptBR })}
                      </td>
                      <td className="px-4 py-3 text-sm" style={{ color: txt }}>
                        {r.actor_name || (r.actor_id ? r.actor_id.slice(0, 8) + '…' : <span style={{ color: txtMut }}>—</span>)}
                      </td>
                      <td className="px-4 py-3">
                        {r.origem === 'audit' ? (
                          <span className="text-xs px-2 py-0.5 rounded-full bg-violet-100 text-violet-800 border border-violet-200">Auditoria</span>
                        ) : (
                          <span className="text-xs px-2 py-0.5 rounded-full bg-cyan-100 text-cyan-800 border border-cyan-200">Estoque</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs font-semibold" style={{ color: txt }}>{r.action}</td>
                      <td className="px-4 py-3 text-xs" style={{ color: txtSec }}>{r.entity}</td>
                      <td className="px-4 py-3 text-xs font-mono" style={{ color: txtMut }}>{r.entity_id?.slice(0, 8) || '—'}…</td>
                    </tr>
                    {isOpen && (
                      <tr key={key + '-details'}>
                        <td colSpan={7} className="px-4 py-3" style={{ background: mode === 'dark' ? 'rgba(0,0,0,0.3)' : 'rgba(0,0,0,0.04)' }}>
                          <pre className="text-xs overflow-x-auto" style={{ color: txtSec, whiteSpace: 'pre-wrap' }}>
                            {JSON.stringify(r.details, null, 2)}
                          </pre>
                        </td>
                      </tr>
                    )}
                  </>
                )
              })
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center gap-3 text-sm" style={{ color: txtMut }}>
        <span>{rows.length} evento(s) no período{temMais ? ' (há mais)' : ''}.</span>
        {temMais && (
          <Button variant="outline" size="sm" onClick={carregarMais} disabled={carregandoMais}>
            {carregandoMais ? 'Carregando…' : `Carregar mais ${PAGINA}`}
          </Button>
        )}
      </div>
    </div>
  )
}
