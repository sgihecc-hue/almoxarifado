import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTheme } from '@/contexts/theme'
import { useModule } from '@/contexts/module'
import { ArrowLeft, Search, ChevronDown, ChevronRight, Loader2, Filter } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { pharmacyDispensationService } from '@/lib/services/pharmacy-dispensation'
import { loadMaterialDispensations } from '@/lib/services/material-dispensations'
import type { PharmacyDispensation, DispensationStatus } from '@/lib/types/dispensation'

const PAGE_SIZE = 15

const STATUS_CONFIG: Record<DispensationStatus, { label: string; bg: string; color: string; border: string }> = {
  completed: { label: 'Concluída', bg: 'rgba(16,185,129,0.12)', color: '#065f46', border: 'rgba(16,185,129,0.35)' },
  pending_approval: { label: 'Aguard. aprovação', bg: 'rgba(245,158,11,0.12)', color: '#92400e', border: 'rgba(245,158,11,0.35)' },
  cancelled: { label: 'Cancelada', bg: 'rgba(239,68,68,0.12)', color: '#991b1b', border: 'rgba(239,68,68,0.35)' },
}

function fmt(d: string | null | undefined) {
  if (!d) return '—'
  return new Date(d).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
}

function fmtDate(d: string | null | undefined) {
  if (!d) return '—'
  return new Date(d + 'T00:00:00').toLocaleDateString('pt-BR')
}

export function HistoricoDispensacoes() {
  const navigate = useNavigate()
  const { mode } = useTheme()
  const { activeStock } = useModule()
  // Satélite Térreo (e qualquer estoque de material) tem histórico próprio,
  // reconstruído do livro-razão.
  const isMaterial = activeStock?.itemType === 'warehouse'

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

  const [filtered, setFiltered] = useState<PharmacyDispensation[]>([])
  const [loading, setLoading] = useState(true)

  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [search, setSearch] = useState('')

  const [page, setPage] = useState(0)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  async function load() {
    setLoading(true)
    try {
      const f = {
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
        search: search || undefined,
      }
      // Isolamento por estoque: cada local vê só as suas dispensações.
      const data = isMaterial
        ? await loadMaterialDispensations(activeStock!.id, f)
        : await pharmacyDispensationService.getAll({ ...f, locationId: activeStock?.id })
      setFiltered(data)
      setPage(0)
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  // Recarrega ao trocar o estoque ativo — o histórico é por local.
  useEffect(() => { void load() }, [activeStock?.id])

  function applyFilters() {
    void load()
  }

  function clearFilters() {
    setDateFrom(''); setDateTo(''); setSearch('')
    void load()
  }

  function toggleExpand(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE)
  const paginated = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <button
          onClick={() => navigate('/dispensacao')}
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
          <h1 className="text-2xl font-bold" style={{ color: txt }}>Histórico de Dispensações</h1>
          <p className="text-sm" style={{ color: txtSec }}>Registro completo de dispensações com drill-down por itens</p>
        </div>
      </div>

      {/* Filtros */}
      <div className="p-5 space-y-4" style={card}>
        <div className="flex items-center gap-2">
          <Filter size={16} style={{ color: txtMut }} />
          <span className="text-sm font-semibold" style={{ color: txt }}>Filtros</span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label style={lbl}>Data inicial</label>
            <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} style={inputStyle} />
          </div>
          <div>
            <label style={lbl}>Data final</label>
            <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} style={inputStyle} />
          </div>
          <div>
            <label style={lbl}>Busca</label>
            <div className="relative">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: txtMut }} />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && applyFilters()}
                placeholder={isMaterial ? 'Setor, item, responsável...' : 'Paciente, prontuário, prescritor...'}
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
          <span style={{ color: txtMut }}>Carregando histórico...</span>
        </div>
      ) : filtered.length === 0 ? (
        <div className="p-10 flex flex-col items-center gap-2" style={card}>
          <p className="text-lg font-semibold" style={{ color: txt }}>Nenhuma dispensação encontrada</p>
          <p className="text-sm" style={{ color: txtMut }}>Tente ajustar os filtros de busca.</p>
        </div>
      ) : (
        <>
          <div style={{ ...card, overflow: 'hidden' }}>
            <div className="px-5 py-3 flex items-center justify-between"
              style={{ borderBottom: `1px solid ${mode === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)'}` }}>
              <p className="text-sm font-semibold" style={{ color: txt }}>
                {filtered.length} resultado{filtered.length !== 1 ? 's' : ''}
              </p>
              <p className="text-xs" style={{ color: txtMut }}>
                Página {page + 1} de {totalPages}
              </p>
            </div>

            {paginated.map((d, idx) => {
              const isExpanded = expanded.has(d.id)
              const statusCfg = STATUS_CONFIG[d.status] ?? STATUS_CONFIG.completed
              return (
                <div key={d.id}
                  style={{
                    borderBottom: idx < paginated.length - 1
                      ? `1px solid ${mode === 'dark' ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)'}`
                      : 'none',
                  }}>
                  <button
                    onClick={() => toggleExpand(d.id)}
                    className="w-full text-left px-5 py-4 flex items-center gap-3"
                    style={{ background: 'transparent' }}>
                    <div style={{ color: txtMut, flexShrink: 0 }}>
                      {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                    </div>
                    <div className="flex-1 min-w-0 grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-1">
                      <div>
                        <p className="text-xs" style={{ color: txtMut }}>Dispensação</p>
                        <p className="text-sm font-bold" style={{ color: txt }}>#{d.dispensation_number}</p>
                      </div>
                      <div className="col-span-1">
                        {/* No material não há paciente: quem recebe é o SETOR. */}
                        <p className="text-xs" style={{ color: txtMut }}>{isMaterial ? 'Setor' : 'Paciente'}</p>
                        <p className="text-sm font-medium truncate" style={{ color: txt }}>{d.patient_name}</p>
                        {!isMaterial && (
                          <p className="text-xs" style={{ color: txtSec }}>Pron. {d.medical_record_number}</p>
                        )}
                      </div>
                      <div className="hidden md:block">
                        <p className="text-xs" style={{ color: txtMut }}>{isMaterial ? 'Responsável' : 'Prescritor'}</p>
                        <p className="text-sm truncate" style={{ color: txt }}>
                          {isMaterial ? d.created_by_name : d.prescribing_doctor}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs" style={{ color: txtMut }}>Data</p>
                        <p className="text-sm" style={{ color: txt }}>{fmt(d.created_at)}</p>
                      </div>
                    </div>
                    <span
                      className="text-xs px-2 py-1 rounded-full font-medium flex-shrink-0"
                      style={{ background: statusCfg.bg, color: statusCfg.color, border: `1px solid ${statusCfg.border}` }}>
                      {statusCfg.label}
                    </span>
                  </button>

                  {isExpanded && (
                    <div className="px-5 pb-4 space-y-3">
                      <div className="p-4 rounded-xl space-y-3"
                        style={{ background: mode === 'dark' ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)', border: `1px solid ${mode === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)'}` }}>
                        <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs" style={{ color: txtSec }}>
                          <span><strong style={{ color: txt }}>Criado por:</strong> {d.created_by_name} · {fmt(d.created_at)}</span>
                          {d.approved_by_name && (
                            <span><strong style={{ color: txt }}>Aprovado por:</strong> {d.approved_by_name} · {fmt(d.approved_at)}</span>
                          )}
                          {d.prescription_date && (
                            <span><strong style={{ color: txt }}>Data prescrição:</strong> {fmtDate(d.prescription_date)}</span>
                          )}
                          {d.cancellation_reason && (
                            <span><strong style={{ color: '#991b1b' }}>Motivo cancelamento:</strong> {d.cancellation_reason}</span>
                          )}
                        </div>

                        <div className="space-y-1">
                          <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: txtMut }}>
                            Itens dispensados ({d.items.length})
                          </p>
                          {d.items.map((item) => (
                            <div key={item.id}
                              className="flex items-center gap-3 p-2 rounded-lg"
                              style={{ background: mode === 'dark' ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.02)' }}>
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium" style={{ color: txt }}>
                                  {item.item_name}
                                  {item.is_mav && (
                                    <span className="ml-2 text-xs px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 border border-amber-200">
                                      ⚠️ MAV
                                    </span>
                                  )}
                                </p>
                                <p className="text-xs" style={{ color: txtMut }}>
                                  {item.batch_number ? `Lote ${item.batch_number}` : 'Sem lote'}
                                  {item.expiry_date ? ` · Val ${fmtDate(item.expiry_date)}` : ''}
                                  {item.item_code ? ` · Cód. ${item.item_code}` : ''}
                                </p>
                              </div>
                              <span className="text-sm font-bold" style={{ color: txt }}>
                                {item.quantity} {item.item_unit}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page === 0}
                onClick={() => setPage((p) => p - 1)}>
                Anterior
              </Button>
              <span className="text-sm" style={{ color: txtSec }}>
                {page + 1} / {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= totalPages - 1}
                onClick={() => setPage((p) => p + 1)}>
                Próxima
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
