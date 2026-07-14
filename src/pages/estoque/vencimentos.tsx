// =====================================================================
// Itens a Vencer
// Secao A: proximos de vencer (view v_itens_a_vencer) com color coding
// Secao B: vencidos a baixar (view expiring_to_writeoff) com baixa em massa
// =====================================================================

import { useState, useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useTheme } from '@/contexts/theme'
import { useAuth } from '@/contexts/auth'
import { ArrowLeft, AlertCircle, Loader2, CalendarX, Check, AlertTriangle, CheckCircle2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { supabase } from '@/lib/supabase'
import { stockService } from '@/lib/services/stock'
import { getErrorMessage } from '@/lib/utils/error-messages'
import type { ExpiryColorBand, ExpiringAlertRow, ExpiringToWriteoffRow } from '@/lib/types/stock'

const RESOLVE_ROLES = new Set(['pharmacist', 'gestor', 'administrador'])

export function VencimentosABaixar() {
  const navigate = useNavigate()
  const location = useLocation()
  const { user } = useAuth()
  const { mode } = useTheme()

  // Isolamento de módulo: quando acessado por /almox/* esta é a tela do
  // almoxarifado e deve mostrar SÓ itens 'warehouse'. Qualquer outro path
  // (farmácia e default /estoque/vencimentos) mantém o comportamento original
  // — nada aqui muda para a farmácia.
  const isWarehouse = location.pathname.startsWith('/almox')

  const canResolve = !!user?.role && RESOLVE_ROLES.has(user.role)
  const allowedWriteoffRoles = new Set(['admin', 'manager', 'administrador', 'gestor', 'pharmacist', 'warehouse_manager', 'atendente'])
  const canWriteoff = !!user?.role && allowedWriteoffRoles.has(user.role)

  const txt = mode === 'dark' ? '#fff' : '#0d2e1c'
  const txtSec = mode === 'dark' ? 'rgba(255,255,255,0.7)' : 'rgba(13,46,28,0.65)'
  const txtMut = mode === 'dark' ? 'rgba(255,255,255,0.45)' : 'rgba(13,46,28,0.45)'

  const glass: React.CSSProperties = {
    background: mode === 'dark' ? 'rgba(10,15,20,0.55)' : 'rgba(255,255,255,0.65)',
    backdropFilter: 'blur(30px)',
    WebkitBackdropFilter: 'blur(30px)',
    border: `1px solid ${mode === 'dark' ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.5)'}`,
    borderRadius: 16,
  }

  // ---- Secao A: a vencer ----
  const [alertRows, setAlertRows] = useState<ExpiringAlertRow[]>([])
  const [resolutions, setResolutions] = useState<Set<string>>(new Set()) // expiry_tracking_id__color_band
  const [loadingAlerts, setLoadingAlerts] = useState(true)
  const [resolvingId, setResolvingId] = useState<string | null>(null)

  // ---- Secao B: vencidos ----
  const [rows, setRows] = useState<ExpiringToWriteoffRow[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [loadingWriteoff, setLoadingWriteoff] = useState(true)
  const [cafLocationId, setCafLocationId] = useState<string>('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const loadAll = async () => {
    setLoadingAlerts(true)
    setLoadingWriteoff(true)
    setError('')
    try {
      const [alertData, writeoffData, locs, resData] = await Promise.all([
        supabase.from('v_itens_a_vencer').select('*').order('expiry_date'),
        stockService.listExpiringToWriteoff(),
        stockService.getLocations(),
        supabase.from('expiry_alert_resolutions').select('expiry_tracking_id, color_band'),
      ])

      if (alertData.error) throw alertData.error

      setAlertRows((alertData.data || []) as ExpiringAlertRow[])
      setRows(writeoffData)

      const caf = locs.find((l) => l.code === 'CAF')
      if (caf) setCafLocationId(caf.id)

      // Construir set de resolvidos: "expiry_tracking_id__color_band"
      const resolvedSet = new Set<string>()
      ;(resData.data || []).forEach((r: any) => {
        resolvedSet.add(`${r.expiry_tracking_id}__${r.color_band}`)
      })
      setResolutions(resolvedSet)
    } catch (e: any) {
      setError(getErrorMessage(e))
    } finally {
      setLoadingAlerts(false)
      setLoadingWriteoff(false)
    }
  }

  useEffect(() => { loadAll() }, [])

  // Filtrar resolvidos client-side. No módulo almoxarifado, restringe a itens
  // 'warehouse' (a view v_itens_a_vencer mistura os dois módulos). Fora do
  // almox, sem filtro de tipo — farmácia inalterada.
  const visibleAlerts = alertRows.filter(
    (r) =>
      !resolutions.has(`${r.expiry_tracking_id}__${r.color_band}`) &&
      (!isWarehouse || r.item_type === 'warehouse')
  )

  // Seção B (vencidos a baixar) vem da view expiring_to_writeoff, que só
  // retorna itens de farmácia. No almox filtramos por 'warehouse' (fica vazio
  // hoje, mas evita vazar farmácia); fora do almox, mantém tudo.
  const visibleWriteoff = rows.filter(
    (r) => !isWarehouse || r.item_type === 'warehouse'
  )

  const handleResolve = async (row: ExpiringAlertRow) => {
    if (!user?.id) return
    setResolvingId(row.expiry_tracking_id)
    try {
      const { error: e } = await supabase.from('expiry_alert_resolutions').insert({
        expiry_tracking_id: row.expiry_tracking_id,
        color_band: row.color_band,
        resolved_by: user.id,
      })
      if (e) throw e
      setResolutions((prev) => new Set([...prev, `${row.expiry_tracking_id}__${row.color_band}`]))
    } catch (e: any) {
      setError(getErrorMessage(e))
    } finally {
      setResolvingId(null)
    }
  }

  // ---- Color band helpers ----
  const bandConfig: Record<ExpiryColorBand, { bg: string; border: string; badge: string; label: string }> = {
    '1m': {
      bg: mode === 'dark' ? 'rgba(239,68,68,0.12)' : 'rgba(254,226,226,0.8)',
      border: mode === 'dark' ? 'rgba(239,68,68,0.3)' : 'rgba(239,68,68,0.25)',
      badge: '#ef4444',
      label: 'Vence em < 1 mes',
    },
    '3m': {
      bg: mode === 'dark' ? 'rgba(249,115,22,0.12)' : 'rgba(255,237,213,0.8)',
      border: mode === 'dark' ? 'rgba(249,115,22,0.3)' : 'rgba(249,115,22,0.25)',
      badge: '#f97316',
      label: 'Vence em < 3 meses',
    },
    '6m': {
      bg: mode === 'dark' ? 'rgba(234,179,8,0.12)' : 'rgba(254,249,195,0.8)',
      border: mode === 'dark' ? 'rgba(234,179,8,0.3)' : 'rgba(234,179,8,0.25)',
      badge: '#eab308',
      label: 'Vence em < 6 meses',
    },
  }

  const bandEmoji: Record<ExpiryColorBand, string> = { '1m': '🔴', '3m': '🟠', '6m': '🟡' }

  // ---- Writeoff helpers ----
  const toggle = (id: string) =>
    setSelected((prev) => {
      const n = new Set(prev)
      if (n.has(id)) n.delete(id); else n.add(id)
      return n
    })
  const toggleAll = () =>
    setSelected((prev) =>
      prev.size === visibleWriteoff.length ? new Set() : new Set(visibleWriteoff.map((r) => r.expiry_tracking_id))
    )

  const totalLoss = visibleWriteoff
    .filter((r) => selected.has(r.expiry_tracking_id))
    .reduce((sum, r) => sum + (Number(r.estimated_loss) || 0), 0)

  const handleWriteoff = async () => {
    if (selected.size === 0 || !user?.id || !cafLocationId) return
    setSubmitting(true)
    setError('')
    try {
      for (const r of visibleWriteoff.filter((row) => selected.has(row.expiry_tracking_id))) {
        await stockService.createSaidaAvulsa({
          item_id: r.item_id,
          item_type: r.item_type,
          quantity: r.current_quantity,
          unit_cost: r.unit_cost,
          source_location_id: cafLocationId,
          reason: 'vencimento',
          reason_detail: `Lote ${r.batch_number} | Venc: ${r.expiry_date}`,
          notes: 'Baixa em massa de itens vencidos',
        })
      }
      setSelected(new Set())
      await loadAll()
    } catch (e: any) {
      setError(getErrorMessage(e))
    } finally {
      setSubmitting(false)
    }
  }

  if (!canWriteoff) {
    return (
      <div className="max-w-3xl mx-auto p-6">
        <div className="p-6" style={glass}>
          <h1 className="text-xl font-semibold" style={{ color: txt }}>Sem permissao</h1>
          <p className="text-sm mt-2" style={{ color: txtSec }}>
            Apenas coordenacao/farmaceutico podem acessar esta pagina.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-5xl mx-auto space-y-8">
      {/* Header */}
      <div className="flex items-center gap-4">
        <button
          onClick={() => navigate(-1)}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            width: 40, height: 40, borderRadius: 10, cursor: 'pointer',
            background: mode === 'dark' ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.06)',
            border: `1px solid ${mode === 'dark' ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.08)'}`,
            color: txt,
          }}
        >
          <ArrowLeft size={18} />
        </button>
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2" style={{ color: txt }}>
            <AlertTriangle size={22} /> Itens a Vencer
          </h1>
          <p className="text-sm" style={{ color: txtSec }}>
            Itens proximos do vencimento e itens vencidos para baixa em massa.
          </p>
        </div>
      </div>

      {error && (
        <div className="p-4 rounded-xl bg-red-100 border border-red-200 flex items-center gap-2 text-red-800 text-sm">
          <AlertCircle size={16} /> {error}
        </div>
      )}

      {/* ===== SECAO A: PROXIMOS DE VENCER ===== */}
      <section className="space-y-3">
        <h2 className="text-lg font-bold flex items-center gap-2" style={{ color: txt }}>
          <AlertTriangle size={18} style={{ color: '#f59e0b' }} />
          Proximos de Vencer
        </h2>

        {loadingAlerts ? (
          <div className="p-12 flex justify-center" style={glass}>
            <Loader2 className="w-6 h-6 animate-spin" style={{ color: txtMut }} />
          </div>
        ) : visibleAlerts.length === 0 ? (
          <div className="p-8 text-center" style={glass}>
            <CheckCircle2 size={32} className="mx-auto mb-3" style={{ color: '#10b981' }} />
            <p className="text-sm font-medium" style={{ color: txtSec }}>
              Nenhum item proximo do vencimento!
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {visibleAlerts.map((r) => {
              const cfg = bandConfig[r.color_band] || bandConfig['6m']
              return (
                <div
                  key={`${r.expiry_tracking_id}-${r.color_band}`}
                  className="p-4 rounded-xl flex items-center gap-4"
                  style={{ background: cfg.bg, border: `1px solid ${cfg.border}` }}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 mb-1">
                      <p className="font-semibold text-sm" style={{ color: txt }}>{r.item_name}</p>
                      <span
                        className="text-xs font-semibold px-2 py-0.5 rounded-full"
                        style={{
                          background: `${cfg.badge}22`,
                          color: cfg.badge,
                          border: `1px solid ${cfg.badge}44`,
                        }}
                      >
                        {bandEmoji[r.color_band]} {cfg.label}
                      </span>
                    </div>
                    <p className="text-xs" style={{ color: txtSec }}>
                      Lote <strong>{r.batch_number}</strong>
                      {' · '}
                      Validade:{' '}
                      <strong style={{ color: cfg.badge }}>
                        {new Date(r.expiry_date + 'T00:00:00').toLocaleDateString('pt-BR')}
                      </strong>
                      {' · '}
                      Saldo: <strong>{r.current_quantity}</strong>
                      {r.estimated_value != null && (
                        <>
                          {' · '}
                          Valor estimado:{' '}
                          <strong>
                            {Number(r.estimated_value).toLocaleString('pt-BR', {
                              style: 'currency',
                              currency: 'BRL',
                            })}
                          </strong>
                        </>
                      )}
                    </p>
                  </div>
                  {canResolve && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={resolvingId === r.expiry_tracking_id}
                      onClick={() => handleResolve(r)}
                      style={{ borderColor: cfg.badge, color: cfg.badge, flexShrink: 0 }}
                    >
                      {resolvingId === r.expiry_tracking_id ? (
                        <Loader2 size={12} className="animate-spin mr-1" />
                      ) : (
                        <Check size={12} className="mr-1" />
                      )}
                      Marcar como Resolvido
                    </Button>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </section>

      {/* ===== SECAO B: VENCIDOS A BAIXAR ===== */}
      <section className="space-y-3">
        <h2 className="text-lg font-bold flex items-center gap-2" style={{ color: txt }}>
          <CalendarX size={18} style={{ color: '#ef4444' }} />
          Vencidos — Dar Baixa
        </h2>
        <p className="text-sm" style={{ color: txtSec }}>
          Itens com validade expirada e saldo positivo. Selecione para dar baixa em massa.
        </p>

        <div className="p-6" style={glass}>
          {loadingWriteoff ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin" style={{ color: txtMut }} />
            </div>
          ) : visibleWriteoff.length === 0 ? (
            <p className="text-sm text-center py-8" style={{ color: txtMut }}>
              Nenhum item vencido com saldo. Tudo limpo! 🎉
            </p>
          ) : (
            <>
              <div
                className="flex items-center justify-between mb-4 pb-3 border-b"
                style={{
                  borderColor: mode === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
                }}
              >
                <label className="flex items-center gap-2 text-sm cursor-pointer" style={{ color: txt }}>
                  <input
                    type="checkbox"
                    checked={selected.size === visibleWriteoff.length && visibleWriteoff.length > 0}
                    onChange={toggleAll}
                  />
                  {selected.size === visibleWriteoff.length ? 'Desmarcar todos' : `Selecionar todos (${visibleWriteoff.length})`}
                </label>
                <div className="text-right">
                  {selected.size > 0 && (
                    <p className="text-xs" style={{ color: txtMut }}>
                      {selected.size} selecionados · perda estimada:{' '}
                      <strong style={{ color: '#ef4444' }}>
                        {totalLoss.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                      </strong>
                    </p>
                  )}
                </div>
              </div>

              <div className="space-y-2">
                {visibleWriteoff.map((r) => (
                  <label
                    key={r.expiry_tracking_id}
                    className="flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-colors"
                    style={{
                      background: selected.has(r.expiry_tracking_id)
                        ? mode === 'dark'
                          ? 'rgba(239,68,68,0.1)'
                          : 'rgba(239,68,68,0.05)'
                        : mode === 'dark'
                          ? 'rgba(255,255,255,0.03)'
                          : 'rgba(0,0,0,0.02)',
                      border: `1px solid ${
                        selected.has(r.expiry_tracking_id)
                          ? '#ef4444'
                          : mode === 'dark'
                            ? 'rgba(255,255,255,0.08)'
                            : 'rgba(0,0,0,0.06)'
                      }`,
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={selected.has(r.expiry_tracking_id)}
                      onChange={() => toggle(r.expiry_tracking_id)}
                      className="flex-shrink-0"
                    />
                    <div className="flex-1">
                      <p className="font-medium text-sm" style={{ color: txt }}>{r.item_name}</p>
                      <p className="text-xs mt-0.5" style={{ color: txtMut }}>
                        Lote <strong>{r.batch_number}</strong> · Venc:{' '}
                        <strong style={{ color: '#ef4444' }}>
                          {new Date(r.expiry_date + 'T00:00:00').toLocaleDateString('pt-BR')}
                        </strong>
                        {' · '}Saldo: <strong>{r.current_quantity}</strong>
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-semibold" style={{ color: '#ef4444' }}>
                        {r.estimated_loss !== null
                          ? Number(r.estimated_loss).toLocaleString('pt-BR', {
                              style: 'currency',
                              currency: 'BRL',
                            })
                          : '—'}
                      </p>
                    </div>
                  </label>
                ))}
              </div>

              <div className="flex justify-end pt-4">
                <Button
                  onClick={handleWriteoff}
                  disabled={selected.size === 0 || submitting}
                  className="bg-red-600 hover:bg-red-700 text-white"
                >
                  {submitting ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <Check className="w-4 h-4 mr-2" />
                  )}
                  Dar baixa em {selected.size} item(s)
                </Button>
              </div>
            </>
          )}
        </div>
      </section>
    </div>
  )
}
