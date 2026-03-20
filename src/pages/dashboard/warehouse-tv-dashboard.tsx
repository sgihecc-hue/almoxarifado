import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  AlertCircle,
  RefreshCw,
  Home,
  History,
  Sun,
  Moon
} from 'lucide-react'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { tvRequestService } from '@/lib/services/tv-requests'
import { supabase } from '@/lib/supabase'
import type { TVRequest } from '@/lib/services/tv-requests'

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
  dest: '#ffd166',
  totalNum: '#fff',
  pendingNum: '#ffcc00',
  approvedNum: '#00e676',
  processingNum: '#448aff',
  pendingGlow: '0 0 12px rgba(255,204,0,0.4)',
  approvedGlow: '0 0 12px rgba(0,230,118,0.4)',
  processingGlow: '0 0 12px rgba(68,138,255,0.4)',
  btnBg: 'rgba(0,0,0,0.25)',
  btnBorder: 'rgba(255,255,255,0.15)',
  btnText: '#fff',
  footerText: 'rgba(255,255,255,0.35)',
  footerBorder: 'rgba(255,255,255,0.05)',
  priorityHigh: { bg: 'rgba(239,68,68,0.3)', color: '#fff', border: 'rgba(239,68,68,0.5)' },
  priorityMedium: { bg: 'rgba(251,191,36,0.3)', color: '#fff', border: 'rgba(251,191,36,0.5)' },
  priorityLow: { bg: 'rgba(34,197,94,0.3)', color: '#fff', border: 'rgba(34,197,94,0.5)' },
  statusPending: { bg: 'rgba(251,191,36,0.2)', color: '#fff', border: 'rgba(251,191,36,0.4)', dot: '#fbbf24' },
  statusApproved: { bg: 'rgba(34,197,94,0.2)', color: '#fff', border: 'rgba(34,197,94,0.4)', dot: '#22c55e' },
  statusProcessing: { bg: 'rgba(59,130,246,0.2)', color: '#fff', border: 'rgba(59,130,246,0.4)', dot: '#3b82f6' },
}

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
  dest: '#0d5a30',
  totalNum: '#0d2e1c',
  pendingNum: '#8a6800',
  approvedNum: '#0d6a35',
  processingNum: '#1a4eaa',
  pendingGlow: 'none',
  approvedGlow: 'none',
  processingGlow: 'none',
  btnBg: 'rgba(255,255,255,0.5)',
  btnBorder: 'rgba(255,255,255,0.6)',
  btnText: '#0d2e1c',
  footerText: 'rgba(13,46,28,0.5)',
  footerBorder: 'rgba(0,0,0,0.1)',
  priorityHigh: { bg: 'rgba(239,68,68,0.2)', color: '#a11', border: 'rgba(239,68,68,0.4)' },
  priorityMedium: { bg: 'rgba(251,191,36,0.25)', color: '#7a5500', border: 'rgba(251,191,36,0.5)' },
  priorityLow: { bg: 'rgba(34,197,94,0.25)', color: '#0d5a2a', border: 'rgba(34,197,94,0.5)' },
  statusPending: { bg: 'rgba(251,191,36,0.2)', color: '#7a5500', border: 'rgba(251,191,36,0.45)', dot: '#d4a017' },
  statusApproved: { bg: 'rgba(34,197,94,0.2)', color: '#0d5a2a', border: 'rgba(34,197,94,0.45)', dot: '#1a8a50' },
  statusProcessing: { bg: 'rgba(59,130,246,0.2)', color: '#1a4eaa', border: 'rgba(59,130,246,0.45)', dot: '#2060cc' },
}

function TVStatusBadge({ status, theme }: { status: string; theme: typeof THEME_A }) {
  const config = status === 'approved' ? theme.statusApproved
    : status === 'processing' ? theme.statusProcessing
    : theme.statusPending
  const label = status === 'approved' ? 'Aprovada'
    : status === 'processing' ? 'Em Processamento'
    : 'Pendente'

  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
      width: 180, padding: '7px 0', borderRadius: 10,
      fontSize: 13, fontWeight: 600,
      background: config.bg, color: config.color,
      border: `1px solid ${config.border}`,
    }}>
      <span style={{
        width: 8, height: 8, borderRadius: '50%',
        background: config.dot,
        boxShadow: `0 0 8px ${config.dot}`,
        animation: 'pulse 2s ease-in-out infinite',
      }} />
      {label}
    </span>
  )
}

function TVPriorityBadge({ priority, theme }: { priority: string; theme: typeof THEME_A }) {
  const config = priority === 'high' ? theme.priorityHigh
    : priority === 'medium' ? theme.priorityMedium
    : theme.priorityLow
  const label = priority === 'high' ? 'Alta' : priority === 'medium' ? 'Média' : 'Baixa'

  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      width: 90, padding: '7px 0', borderRadius: 8,
      fontSize: 12, fontWeight: 700,
      background: config.bg, color: config.color,
      border: `1px solid ${config.border}`,
    }}>
      {label}
    </span>
  )
}

export default function WarehouseTVDashboard() {
  const navigate = useNavigate()
  const [requests, setRequests] = useState<TVRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date())
  const [activeFilter, setActiveFilter] = useState<'all' | 'pending' | 'approved' | 'processing'>('all')
  const [autoRefresh] = useState(true)
  const [refreshInterval] = useState(60)
  const [connectionError, setConnectionError] = useState(false)
  const [themeMode, setThemeMode] = useState<'a' | 'b'>('a')

  const theme = themeMode === 'a' ? THEME_A : THEME_B

  useEffect(() => {
    async function checkConnection() {
      try {
        const { error } = await supabase.from('requests').select('id').limit(1)
        if (error) {
          setConnectionError(true)
          setError('Erro de conexão com o banco de dados.')
        } else {
          setConnectionError(false)
        }
      } catch {
        setConnectionError(true)
        setError('Erro de conexão com o banco de dados.')
      }
    }
    checkConnection()
  }, [])

  useEffect(() => {
    if (!connectionError) {
      loadRequests()
      let intervalId: number | undefined
      if (autoRefresh) {
        intervalId = window.setInterval(() => loadRequests(), refreshInterval * 1000)
      }
      return () => { if (intervalId) clearInterval(intervalId) }
    }
  }, [autoRefresh, refreshInterval, connectionError])

  async function loadRequests() {
    try {
      setLoading(true)
      setError(null)
      const data = await tvRequestService.getAll('warehouse')
      const activeRequests = data.filter(r => ['pending', 'approved', 'processing'].includes(r.status))
      setRequests(activeRequests)
      setLastUpdated(new Date())
    } catch (error) {
      if (error instanceof Error) {
        setError(error.message.includes('Failed to fetch') ? 'Erro de conexão com o servidor.' : `Erro: ${error.message}`)
      } else {
        setError('Erro ao carregar solicitações.')
      }
    } finally {
      setLoading(false)
    }
  }

  const filteredRequests = requests.filter(r => activeFilter === 'all' || r.status === activeFilter)
  const counts = {
    all: requests.length,
    pending: requests.filter(r => r.status === 'pending').length,
    approved: requests.filter(r => r.status === 'approved').length,
    processing: requests.filter(r => r.status === 'processing').length,
  }

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap');
        @keyframes pulse {
          0%, 100% { opacity: 1; box-shadow: 0 0 8px currentColor; }
          50% { opacity: 0.5; box-shadow: 0 0 2px currentColor; }
        }
      `}</style>
      <div style={{
        fontFamily: "'Inter', sans-serif",
        background: theme.gradient,
        minHeight: '100vh',
        padding: 32,
        transition: 'background 0.6s ease',
      }}>

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 28 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 14,
              paddingRight: 20,
              borderRight: `1px solid ${themeMode === 'a' ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}`,
            }}>
              <div style={{
                width: 48, height: 48, borderRadius: 12,
                background: 'linear-gradient(135deg, #2db48c, #38bdaa)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 20, fontWeight: 800, color: '#fff',
                boxShadow: '0 4px 15px rgba(45, 180, 140, 0.3)',
              }}>H</div>
              <div style={{
                fontSize: 11, fontWeight: 600, color: theme.text,
                textTransform: 'uppercase', letterSpacing: 1, lineHeight: 1.4,
                transition: 'color 0.4s',
              }}>
                <span style={{ fontSize: 13, fontWeight: 800 }}>HECC</span><br />
                Hospital Estadual<br />Costa dos Coqueiros
              </div>
            </div>
            <div>
              <h1 style={{ fontSize: 24, fontWeight: 700, color: theme.text, letterSpacing: -0.5, transition: 'color 0.4s' }}>
                Painel de Solicitações — Almoxarifado
              </h1>
              <div style={{ fontSize: 12, color: theme.textMuted, marginTop: 4, transition: 'color 0.4s' }}>
                Atualizado em {format(lastUpdated, "dd 'de' MMMM 'de' yyyy 'às' HH:mm", { locale: ptBR })}
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
            {[
              { label: 'Histórico', icon: <History size={16} />, action: () => navigate('/tv/warehouse/history') },
              { label: 'Menu', icon: <Home size={16} />, action: () => navigate('/') },
              { label: 'Atualizar', icon: <RefreshCw size={16} />, action: loadRequests },
            ].map(btn => (
              <button key={btn.label} onClick={btn.action} style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '10px 20px', borderRadius: 12,
                fontSize: 13, fontWeight: 600, cursor: 'pointer',
                color: theme.btnText, background: theme.btnBg,
                backdropFilter: 'blur(20px)',
                border: `1px solid ${theme.btnBorder}`,
                transition: 'all 0.4s',
              }}>{btn.icon} {btn.label}</button>
            ))}
          </div>
        </div>

        {/* Stats Cards as Filters */}
        <div style={{ display: 'flex', gap: 16, marginBottom: 28 }}>
          {[
            { key: 'all' as const, label: 'TODAS', num: counts.all, numColor: theme.totalNum, glow: 'none' },
            { key: 'pending' as const, label: 'PENDENTES', num: counts.pending, numColor: theme.pendingNum, glow: theme.pendingGlow },
            { key: 'approved' as const, label: 'APROVADAS', num: counts.approved, numColor: theme.approvedNum, glow: theme.approvedGlow },
            { key: 'processing' as const, label: 'PROCESSANDO', num: counts.processing, numColor: theme.processingNum, glow: theme.processingGlow },
          ].map(card => (
            <div key={card.key} onClick={() => setActiveFilter(card.key)} style={{
              flex: 1, padding: '20px 24px', borderRadius: 16, cursor: 'pointer',
              background: activeFilter === card.key
                ? (themeMode === 'a' ? 'rgba(10,15,20,0.75)' : 'rgba(255,255,255,0.7)')
                : theme.glass,
              backdropFilter: 'blur(30px)',
              border: `1px solid ${activeFilter === card.key
                ? (themeMode === 'a' ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.8)')
                : theme.glassBorder}`,
              boxShadow: activeFilter === card.key ? '0 8px 30px rgba(0,0,0,0.4)' : '0 4px 16px rgba(0,0,0,0.15)',
              transition: 'all 0.3s',
            }}>
              <div style={{
                fontSize: 36, fontWeight: 800, lineHeight: 1, marginBottom: 6,
                color: card.numColor, textShadow: card.glow,
                transition: 'color 0.4s',
              }}>{card.num}</div>
              <div style={{
                fontSize: 12, fontWeight: 600, textTransform: 'uppercase',
                letterSpacing: 1.5, color: theme.text,
                transition: 'color 0.4s',
              }}>{card.label}</div>
            </div>
          ))}
        </div>

        {/* Table */}
        <div>
          {/* Header row */}
          <div style={{ display: 'flex', padding: '14px 20px' }}>
            {['CÓDIGO', 'DATA/HORA', 'SOLICITANTE', 'SETOR ORIGEM', 'SETOR DESTINO', 'PRIORIDADE', 'STATUS'].map((h, i) => (
              <div key={h} style={{
                flex: i === 0 ? '0 0 100px' : i === 5 || i === 6 ? '0 0 180px' : 1,
                fontSize: 12, fontWeight: 700, textTransform: 'uppercase',
                letterSpacing: 1.2, color: theme.textHeader,
                textAlign: i >= 5 ? 'center' : 'left',
                transition: 'color 0.4s',
              }}>{h}</div>
            ))}
          </div>

          {/* Rows */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {loading ? (
              <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}>
                <div style={{
                  width: 48, height: 48, borderRadius: '50%',
                  border: '3px solid rgba(255,255,255,0.2)',
                  borderTopColor: '#fff',
                  animation: 'spin 1s linear infinite',
                }} />
                <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
              </div>
            ) : error ? (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: 60 }}>
                <AlertCircle size={48} color="#ef4444" />
                <p style={{ color: '#ef4444', marginTop: 12 }}>{error}</p>
                <button onClick={loadRequests} style={{
                  marginTop: 16, padding: '10px 24px', borderRadius: 12,
                  background: 'rgba(239,68,68,0.2)', color: '#fff',
                  border: '1px solid rgba(239,68,68,0.4)', cursor: 'pointer',
                }}>Tentar Novamente</button>
              </div>
            ) : filteredRequests.length === 0 ? (
              <div style={{
                textAlign: 'center', padding: 60,
                color: theme.textSecondary, fontSize: 16,
              }}>Nenhuma solicitação encontrada</div>
            ) : filteredRequests.map(request => (
              <div key={request.id} onClick={() => navigate(`/requests/${request.id}`)} style={{
                display: 'flex', alignItems: 'center', padding: 20,
                borderRadius: 14, cursor: 'pointer',
                background: theme.glassRow,
                backdropFilter: 'blur(30px)',
                border: `1px solid ${theme.glassRowBorder}`,
                boxShadow: '0 4px 16px rgba(0,0,0,0.15)',
                transition: 'all 0.3s',
              }}
              onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-2px)' }}
              onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(0)' }}
              >
                <div style={{ flex: '0 0 100px', fontWeight: 700, fontSize: 15, color: theme.text, transition: 'color 0.4s' }}>
                  #{request.request_number || '—'}
                </div>
                <div style={{ flex: 1, color: theme.textSecondary, fontWeight: 400, fontSize: 13, transition: 'color 0.4s' }}>
                  {format(new Date(request.created_at), "dd/MM/yyyy HH:mm")}
                </div>
                <div style={{ flex: 1, fontWeight: 600, color: theme.text, fontSize: 14, transition: 'color 0.4s' }}>
                  {request.requester_name}
                </div>
                <div style={{ flex: 1, color: theme.textSecondary, fontWeight: 500, transition: 'color 0.4s' }}>
                  {request.department}
                </div>
                <div style={{ flex: 1, color: theme.dest, fontWeight: 700, transition: 'color 0.4s' }}>
                  {request.destination_department || '—'}
                </div>
                <div style={{ flex: '0 0 180px', textAlign: 'center' }}>
                  <TVPriorityBadge priority={request.priority} theme={theme} />
                </div>
                <div style={{ flex: '0 0 180px', textAlign: 'center' }}>
                  <TVStatusBadge status={request.status} theme={theme} />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div style={{
          marginTop: 24, padding: '12px 0',
          borderTop: `1px solid ${theme.footerBorder}`,
          display: 'flex', justifyContent: 'space-between',
          fontSize: 11, color: theme.footerText, letterSpacing: 0.5,
          transition: 'all 0.4s',
        }}>
          <span>HECC — Hospital Estadual Costa dos Coqueiros - FESF-SUS</span>
          <span>Sistema de Gestão de Insumos v1.0</span>
        </div>
      </div>
    </>
  )
}

export { WarehouseTVDashboard }
