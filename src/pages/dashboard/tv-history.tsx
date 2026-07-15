import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowLeft,
  Search,
  Calendar,
  RefreshCw,
  X,
  Sun,
  Moon
} from 'lucide-react'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { tvRequestService } from '@/lib/services/tv-requests'
import { departmentsService } from '@/lib/services/departments'
import { formatRequestNumber } from '@/lib/utils/request'
import type { TVRequest } from '@/lib/services/tv-requests'
import type { Department } from '@/lib/types/departments'
import type { RequestStatus } from '@/lib/services/requests'

/* ── Theme A: Menta + Verde (escuro) ── */
const THEME_A = {
  gradient: 'linear-gradient(135deg, #b0f5d0 0%, #78d8a0 25%, #50b87a 50%, #3a9a68 75%, #2e7d52 100%)',
  glass: 'rgba(10,15,20,0.65)',
  glassBorder: 'rgba(255,255,255,0.12)',
  glassRow: 'rgba(10,15,20,0.6)',
  glassRowBorder: 'rgba(255,255,255,0.08)',
  text: '#fff',
  textSecondary: 'rgba(255,255,255,0.75)',
  textMuted: 'rgba(255,255,255,0.5)',
  textHeader: 'rgba(255,255,255,0.9)',
  headerText: '#0a3320',
  headerMuted: 'rgba(10,51,32,0.6)',
  dest: '#ffd166',
  btnBg: 'rgba(0,0,0,0.2)',
  btnBorder: 'rgba(0,0,0,0.15)',
  btnText: '#0a3320',
  footerText: 'rgba(10,51,32,0.4)',
  footerBorder: 'rgba(0,0,0,0.08)',
  inputBg: 'rgba(0,0,0,0.3)',
  inputBorder: 'rgba(255,255,255,0.15)',
  inputText: '#fff',
  inputPlaceholder: 'rgba(255,255,255,0.4)',
  priorityHigh: { bg: 'rgba(239,68,68,0.3)', color: '#fff', border: 'rgba(239,68,68,0.5)' },
  priorityMedium: { bg: 'rgba(251,191,36,0.3)', color: '#fff', border: 'rgba(251,191,36,0.5)' },
  priorityLow: { bg: 'rgba(34,197,94,0.3)', color: '#fff', border: 'rgba(34,197,94,0.5)' },
  statusPending: { bg: 'rgba(251,191,36,0.2)', color: '#fff', border: 'rgba(251,191,36,0.4)', dot: '#fbbf24' },
  statusApproved: { bg: 'rgba(34,197,94,0.2)', color: '#fff', border: 'rgba(34,197,94,0.4)', dot: '#22c55e' },
  statusProcessing: { bg: 'rgba(59,130,246,0.2)', color: '#fff', border: 'rgba(59,130,246,0.4)', dot: '#3b82f6' },
  statusDelivered: { bg: 'rgba(139,92,246,0.2)', color: '#fff', border: 'rgba(139,92,246,0.4)', dot: '#8b5cf6' },
  statusCompleted: { bg: 'rgba(20,184,166,0.2)', color: '#fff', border: 'rgba(20,184,166,0.4)', dot: '#14b8a6' },
  statusCancelled: { bg: 'rgba(239,68,68,0.2)', color: '#fff', border: 'rgba(239,68,68,0.4)', dot: '#ef4444' },
  statusRejected: { bg: 'rgba(239,68,68,0.2)', color: '#fff', border: 'rgba(239,68,68,0.4)', dot: '#ef4444' },
}

/* ── Theme B: Só Menta (claro) ── */
const THEME_B = {
  gradient: 'linear-gradient(135deg, #e0fff0 0%, #c8ffe8 20%, #a8f0d0 40%, #88e8b8 60%, #70d8a5 80%, #60c898 100%)',
  glass: 'rgba(255,255,255,0.55)',
  glassBorder: 'rgba(255,255,255,0.7)',
  glassRow: 'rgba(255,255,255,0.45)',
  glassRowBorder: 'rgba(255,255,255,0.6)',
  text: '#0d2e1c',
  textSecondary: 'rgba(13,46,28,0.7)',
  textMuted: 'rgba(13,46,28,0.65)',
  textHeader: 'rgba(13,46,28,0.8)',
  headerText: '#0d2e1c',
  headerMuted: 'rgba(13,46,28,0.5)',
  dest: '#0d5a30',
  btnBg: 'rgba(255,255,255,0.5)',
  btnBorder: 'rgba(255,255,255,0.6)',
  btnText: '#0d2e1c',
  footerText: 'rgba(13,46,28,0.5)',
  footerBorder: 'rgba(0,0,0,0.1)',
  inputBg: 'rgba(255,255,255,0.5)',
  inputBorder: 'rgba(0,0,0,0.1)',
  inputText: '#0d2e1c',
  inputPlaceholder: 'rgba(13,46,28,0.4)',
  priorityHigh: { bg: 'rgba(239,68,68,0.15)', color: '#b91c1c', border: 'rgba(239,68,68,0.3)' },
  priorityMedium: { bg: 'rgba(251,191,36,0.15)', color: '#92400e', border: 'rgba(251,191,36,0.3)' },
  priorityLow: { bg: 'rgba(34,197,94,0.15)', color: '#166534', border: 'rgba(34,197,94,0.3)' },
  statusPending: { bg: 'rgba(251,191,36,0.15)', color: '#92400e', border: 'rgba(251,191,36,0.3)', dot: '#d97706' },
  statusApproved: { bg: 'rgba(34,197,94,0.15)', color: '#166534', border: 'rgba(34,197,94,0.3)', dot: '#16a34a' },
  statusProcessing: { bg: 'rgba(59,130,246,0.15)', color: '#1e40af', border: 'rgba(59,130,246,0.3)', dot: '#2563eb' },
  statusDelivered: { bg: 'rgba(139,92,246,0.15)', color: '#5b21b6', border: 'rgba(139,92,246,0.3)', dot: '#7c3aed' },
  statusCompleted: { bg: 'rgba(20,184,166,0.15)', color: '#0f766e', border: 'rgba(20,184,166,0.3)', dot: '#0d9488' },
  statusCancelled: { bg: 'rgba(239,68,68,0.15)', color: '#b91c1c', border: 'rgba(239,68,68,0.3)', dot: '#dc2626' },
  statusRejected: { bg: 'rgba(239,68,68,0.15)', color: '#b91c1c', border: 'rgba(239,68,68,0.3)', dot: '#dc2626' },
}

const ALL_STATUSES: { value: RequestStatus | 'all'; label: string }[] = [
  { value: 'all', label: 'Todos' },
  { value: 'pending', label: 'Pendente' },
  { value: 'approved', label: 'Aprovado' },
  { value: 'processing', label: 'Processando' },
  { value: 'delivered', label: 'Entregue' },
  { value: 'completed', label: 'Concluído' },
  { value: 'cancelled', label: 'Cancelado' },
  { value: 'rejected', label: 'Rejeitado' }
]

const PRIORITIES = [
  { value: 'all', label: 'Todas' },
  { value: 'high', label: 'Alta' },
  { value: 'medium', label: 'Média' },
  { value: 'low', label: 'Baixa' }
]

function getStatusStyle(status: string, theme: typeof THEME_A) {
  const map: Record<string, typeof theme.statusPending> = {
    pending: theme.statusPending,
    approved: theme.statusApproved,
    processing: theme.statusProcessing,
    delivered: theme.statusDelivered,
    completed: theme.statusCompleted,
    cancelled: theme.statusCancelled,
    rejected: theme.statusRejected,
  }
  return map[status] || theme.statusPending
}

function getStatusLabel(status: string) {
  const map: Record<string, string> = {
    pending: 'Pendente',
    approved: 'Aprovada',
    processing: 'Em Processamento',
    delivered: 'Entregue',
    completed: 'Concluída',
    cancelled: 'Cancelada',
    rejected: 'Rejeitada',
  }
  return map[status] || status
}

function getPriorityStyle(priority: string, theme: typeof THEME_A) {
  const map: Record<string, typeof theme.priorityHigh> = {
    high: theme.priorityHigh,
    medium: theme.priorityMedium,
    low: theme.priorityLow,
  }
  return map[priority] || theme.priorityLow
}

function getPriorityLabel(priority: string) {
  return priority === 'high' ? 'Alta' : priority === 'medium' ? 'Média' : 'Baixa'
}

interface TVHistoryProps {
  type: 'pharmacy' | 'warehouse'
}

export function TVHistory({ type }: TVHistoryProps) {
  const navigate = useNavigate()
  const panelTitle = type === 'pharmacy' ? 'Farmácia' : 'Almoxarifado'

  const [requests, setRequests] = useState<TVRequest[]>([])
  const [, setDepartments] = useState<Department[]>([])
  const [loading, setLoading] = useState(true)
  const [themeMode, setThemeMode] = useState<'a' | 'b'>('a')
  const theme = themeMode === 'a' ? THEME_A : THEME_B

  // Filters
  const [statusFilter, setStatusFilter] = useState<RequestStatus | 'all'>('all')
  const [priorityFilter, setPriorityFilter] = useState<string>('all')
  const [departmentFilter, setDepartmentFilter] = useState<string>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  useEffect(() => { loadData() }, [])

  async function loadData() {
    setLoading(true)
    try {
      const [reqs, depts] = await Promise.all([
        tvRequestService.getAll(type),
        departmentsService.getAll()
      ])
      setRequests(reqs)
      setDepartments(depts)
    } catch (error) {
      console.error('Error loading data:', error)
    } finally {
      setLoading(false)
    }
  }

  const filteredRequests = useMemo(() => {
    return requests.filter(req => {
      if (statusFilter !== 'all' && req.status !== statusFilter) return false
      if (priorityFilter !== 'all' && req.priority !== priorityFilter) return false
      if (departmentFilter !== 'all' && req.department !== departmentFilter) return false
      if (dateFrom) {
        const reqDate = new Date(req.created_at).toISOString().split('T')[0]
        if (reqDate < dateFrom) return false
      }
      if (dateTo) {
        const reqDate = new Date(req.created_at).toISOString().split('T')[0]
        if (reqDate > dateTo) return false
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase()
        const matchesNumber = (req.request_number || formatRequestNumber(req.id)).toLowerCase().includes(q)
        const matchesRequester = req.requester_name.toLowerCase().includes(q)
        const matchesDepartment = req.department.toLowerCase().includes(q)
        const matchesItem = req.items.some(item => item.item_name.toLowerCase().includes(q))
        if (!matchesNumber && !matchesRequester && !matchesDepartment && !matchesItem) return false
      }
      return true
    })
  }, [requests, statusFilter, priorityFilter, departmentFilter, dateFrom, dateTo, searchQuery])

  const clearFilters = () => {
    setStatusFilter('all')
    setPriorityFilter('all')
    setDepartmentFilter('all')
    setSearchQuery('')
    setDateFrom('')
    setDateTo('')
  }

  const hasActiveFilters = statusFilter !== 'all' || priorityFilter !== 'all' ||
    departmentFilter !== 'all' || searchQuery.trim() !== '' || dateFrom !== '' || dateTo !== ''

  const availableDepartments = useMemo(() => {
    const depts = new Set(requests.map(r => r.department))
    return Array.from(depts).sort()
  }, [requests])

  const selectStyle: React.CSSProperties = {
    background: theme.inputBg,
    backdropFilter: 'blur(20px)',
    border: `1px solid ${theme.inputBorder}`,
    borderRadius: 10,
    padding: '8px 12px',
    fontSize: 13,
    color: theme.inputText,
    outline: 'none',
    cursor: 'pointer',
  }

  const inputStyle: React.CSSProperties = {
    background: theme.inputBg,
    backdropFilter: 'blur(20px)',
    border: `1px solid ${theme.inputBorder}`,
    borderRadius: 10,
    padding: '8px 12px',
    fontSize: 13,
    color: theme.inputText,
    outline: 'none',
  }

  return (
    <div style={{
      background: theme.gradient,
      minHeight: '100vh',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
      padding: 32,
      transition: 'background 0.6s ease',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    }}>

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <button onClick={() => navigate(`/tv/${type}`)} style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            width: 42, height: 42, borderRadius: 12, cursor: 'pointer',
            color: theme.headerText, background: theme.btnBg,
            backdropFilter: 'blur(20px)',
            border: `1px solid ${theme.btnBorder}`,
            transition: 'all 0.4s',
          }}><ArrowLeft size={18} /></button>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 14,
            paddingRight: 20,
            borderRight: `1px solid ${themeMode === 'a' ? 'rgba(10,51,32,0.15)' : 'rgba(0,0,0,0.1)'}`,
          }}>
            <div style={{
              width: 48, height: 48, borderRadius: 12,
              background: 'linear-gradient(135deg, #2db48c, #38bdaa)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 20, fontWeight: 800, color: '#fff',
              boxShadow: '0 4px 15px rgba(45, 180, 140, 0.3)',
            }}>H</div>
            <div style={{
              fontSize: 11, fontWeight: 600, color: theme.headerText,
              textTransform: 'uppercase', letterSpacing: 1, lineHeight: 1.4,
              transition: 'color 0.4s',
            }}>
              <span style={{ fontSize: 13, fontWeight: 800 }}>HECC</span><br />
              Hospital Estadual<br />Costa dos Coqueiros
            </div>
          </div>
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 700, color: theme.headerText, letterSpacing: -0.5, transition: 'color 0.4s' }}>
              Histórico de Solicitações — {panelTitle}
            </h1>
            <div style={{ fontSize: 12, color: theme.headerMuted, marginTop: 2, transition: 'color 0.4s' }}>
              {filteredRequests.length} de {requests.length} solicitações
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <button onClick={() => setThemeMode(themeMode === 'a' ? 'b' : 'a')} style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            width: 42, height: 42, borderRadius: 12, cursor: 'pointer',
            color: theme.btnText, background: theme.btnBg,
            backdropFilter: 'blur(20px)',
            border: `1px solid ${theme.btnBorder}`,
            transition: 'all 0.4s',
          }} title={themeMode === 'a' ? 'Tema claro' : 'Tema escuro'}>
            {themeMode === 'a' ? <Sun size={18} /> : <Moon size={18} />}
          </button>
          {hasActiveFilters && (
            <button onClick={clearFilters} style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '8px 14px', borderRadius: 12, cursor: 'pointer',
              color: '#ef4444', background: 'rgba(239,68,68,0.15)',
              backdropFilter: 'blur(20px)',
              border: '1px solid rgba(239,68,68,0.3)',
              fontSize: 13, fontWeight: 500,
              transition: 'all 0.4s',
            }}>
              <X size={14} /> Limpar
            </button>
          )}
          <button onClick={loadData} style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            width: 42, height: 42, borderRadius: 12, cursor: 'pointer',
            color: theme.btnText, background: theme.btnBg,
            backdropFilter: 'blur(20px)',
            border: `1px solid ${theme.btnBorder}`,
            transition: 'all 0.4s',
          }}><RefreshCw size={18} /></button>
        </div>
      </div>

      {/* Filters */}
      <div style={{
        display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12,
        marginBottom: 20, flexShrink: 0,
        background: theme.glass,
        backdropFilter: 'blur(30px)',
        borderRadius: 16,
        border: `1px solid ${theme.glassBorder}`,
        padding: '14px 20px',
        transition: 'all 0.4s',
      }}>
        {/* Search */}
        <div style={{ position: 'relative' }}>
          <Search size={14} style={{
            position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)',
            color: theme.textMuted,
          }} />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Buscar por nº, solicitante, setor, item..."
            style={{ ...inputStyle, paddingLeft: 34, width: 320 }}
          />
        </div>

        {/* Status */}
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as any)} style={selectStyle}>
          {ALL_STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>

        {/* Priority */}
        <select value={priorityFilter} onChange={(e) => setPriorityFilter(e.target.value)} style={selectStyle}>
          {PRIORITIES.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
        </select>

        {/* Department */}
        <select value={departmentFilter} onChange={(e) => setDepartmentFilter(e.target.value)} style={selectStyle}>
          <option value="all">Todos os Setores</option>
          {availableDepartments.map(dept => <option key={dept} value={dept}>{dept}</option>)}
        </select>

        {/* Date range */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Calendar size={14} style={{ color: theme.textMuted }} />
          <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} style={{ ...inputStyle, width: 140 }} />
          <span style={{ color: theme.textMuted, fontSize: 12 }}>até</span>
          <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} style={{ ...inputStyle, width: 140 }} />
        </div>
      </div>

      {/* Table Header */}
      <div style={{
        background: theme.glass,
        backdropFilter: 'blur(30px)',
        borderRadius: '16px 16px 0 0',
        border: `1px solid ${theme.glassBorder}`,
        borderBottom: 'none',
        padding: '14px 24px',
        display: 'grid',
        gridTemplateColumns: '80px 150px 1fr 1fr 1fr 100px 160px',
        gap: 16,
        fontSize: 11,
        fontWeight: 700,
        textTransform: 'uppercase' as const,
        letterSpacing: 1.5,
        color: theme.textMuted,
        flexShrink: 0,
        transition: 'all 0.4s',
      }}>
        <div>Código</div>
        <div>Data/Hora</div>
        <div>Solicitante</div>
        <div>Setor Origem</div>
        <div>Setor Destino</div>
        <div style={{ textAlign: 'center' }}>Prioridade</div>
        <div style={{ textAlign: 'center' }}>Status</div>
      </div>

      {/* Table Body */}
      <div style={{
        flex: 1,
        overflowY: 'auto',
        background: theme.glass,
        backdropFilter: 'blur(30px)',
        borderRadius: '0 0 16px 16px',
        border: `1px solid ${theme.glassBorder}`,
        borderTop: `1px solid ${theme.glassBorder}`,
        transition: 'all 0.4s',
      }}>
        {loading ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 200 }}>
            <div style={{
              width: 40, height: 40, border: `3px solid ${theme.textMuted}`,
              borderTopColor: 'transparent', borderRadius: '50%',
              animation: 'spin 1s linear infinite',
            }} />
          </div>
        ) : filteredRequests.length === 0 ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 200, color: theme.textMuted, fontSize: 15 }}>
            Nenhuma solicitação encontrada
          </div>
        ) : (
          filteredRequests.map((request, index) => {
            const statusS = getStatusStyle(request.status, theme)
            const priorityS = getPriorityStyle(request.priority, theme)
            return (
              <div
                key={request.id}
                onClick={() => navigate(
                  // Histórico do almoxarifado abre o pedido em SOMENTE LEITURA
                  // (ro=1) — consulta, sem poder atender. Atendimento é só no
                  // painel principal. Farmácia mantém o comportamento atual.
                  `/tv/${type}/${request.id}${type === 'warehouse' ? '?ro=1' : ''}`
                )}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '80px 150px 1fr 1fr 1fr 100px 160px',
                  gap: 16,
                  padding: '14px 24px',
                  alignItems: 'center',
                  cursor: 'pointer',
                  background: index % 2 === 0 ? theme.glassRow : 'transparent',
                  borderBottom: `1px solid ${theme.glassRowBorder}`,
                  transition: 'background 0.2s',
                  fontSize: 14,
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = themeMode === 'a' ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.04)' }}
                onMouseLeave={(e) => { e.currentTarget.style.background = index % 2 === 0 ? theme.glassRow : 'transparent' }}
              >
                <div style={{ fontWeight: 700, color: theme.text, fontSize: 14 }}>
                  #{request.request_number || formatRequestNumber(request.id)}
                </div>
                <div style={{ color: theme.textSecondary, fontSize: 13 }}>
                  {format(new Date(request.created_at), "dd/MM/yyyy HH:mm", { locale: ptBR })}
                </div>
                <div style={{ color: theme.text, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {request.requester_name}
                </div>
                <div style={{ color: theme.textSecondary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {request.department}
                </div>
                <div style={{ color: theme.dest, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {request.destination_department || '—'}
                </div>
                <div style={{ textAlign: 'center' }}>
                  <span style={{
                    padding: '4px 12px', borderRadius: 20, fontSize: 11, fontWeight: 600,
                    background: priorityS.bg, color: priorityS.color,
                    border: `1px solid ${priorityS.border}`,
                  }}>{getPriorityLabel(request.priority)}</span>
                </div>
                <div style={{ textAlign: 'center' }}>
                  <span style={{
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                    padding: '5px 14px', borderRadius: 20, fontSize: 12, fontWeight: 500,
                    background: statusS.bg, color: statusS.color,
                    border: `1px solid ${statusS.border}`,
                  }}>
                    <span style={{
                      width: 7, height: 7, borderRadius: '50%',
                      background: statusS.dot,
                    }} />
                    {getStatusLabel(request.status)}
                  </span>
                </div>
              </div>
            )
          })
        )}
      </div>

      {/* Footer */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        padding: '12px 0 0', marginTop: 12, flexShrink: 0,
        borderTop: `1px solid ${theme.footerBorder}`,
        fontSize: 11, color: theme.footerText,
        transition: 'all 0.4s',
      }}>
        <span>HECC — Hospital Estadual Costa dos Coqueiros • FESF-SUS</span>
        <span>Sistema de Gestão de Insumos v1.0</span>
      </div>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg) } }
        select option { background: #1a2e23; color: #fff; }
        ::-webkit-scrollbar { width: 8px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.2); border-radius: 4px; }
        ::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.3); }
      `}</style>
    </div>
  )
}

export default TVHistory
