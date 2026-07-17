import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '@/contexts/auth'
import { useModule } from '@/contexts/module'
import { useTheme } from '@/contexts/theme'
import { AlertTriangle, X, ExternalLink } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { supabase } from '@/lib/supabase'

const SESSION_KEY_PHARM = 'expiry_alert_shown_pharm'
const SESSION_KEY_WH = 'expiry_alert_shown_wh'

interface ExpiringAlertRow {
  id: string
  item_type: 'pharmacy' | 'warehouse'
  item_name: string
  lote: string | null
  expiry_date: string
  quantity: number
  color_band: '1m' | '3m' | '6m'
  expiry_tracking_id: string
}

const BAND_ORDER: ('1m' | '3m' | '6m')[] = ['1m', '3m', '6m']

const BAND_LABELS: Record<string, string> = {
  '1m': 'Vence em 1 mês',
  '3m': 'Vence em 3 meses',
  '6m': 'Vence em 6 meses',
}

const BAND_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  '1m': { bg: 'rgba(239,68,68,0.15)', text: '#ef4444', border: 'rgba(239,68,68,0.4)' },
  '3m': { bg: 'rgba(251,146,60,0.15)', text: '#f97316', border: 'rgba(251,146,60,0.4)' },
  '6m': { bg: 'rgba(234,179,8,0.15)', text: '#ca8a04', border: 'rgba(234,179,8,0.4)' },
}

const NAVIGATE_ROLES = new Set(['pharmacist', 'gestor', 'administrador'])
// Popup de vencimentos SÓ para gestão. Solicitante/atendente/enfermagem
// não precisam ser interrompidos com esse alerta.
const SHOW_ROLES = new Set(['administrador', 'gestor'])

function formatDate(dateStr: string): string {
  try {
    const d = new Date(dateStr + 'T00:00:00')
    return d.toLocaleDateString('pt-BR')
  } catch {
    return dateStr
  }
}

// ---------------------------------------------------------------------------
// Hook: useExpiryAlerts — lightweight, reads from same session + supabase
// ---------------------------------------------------------------------------
/**
 * Hook lightweight que retorna a contagem de itens a vencer.
 * Aceita filtro por item_type ('pharmacy' | 'warehouse') pra o sidebar
 * mostrar contagem só do módulo em que o usuário está.
 */
export function useExpiryAlerts(itemType?: 'pharmacy' | 'warehouse') {
  const [hasAlerts, setHasAlerts] = useState(false)
  const [alertCount, setAlertCount] = useState(0)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        let q = supabase.from('v_itens_a_vencer').select('expiry_tracking_id, color_band, item_type')
        if (itemType) q = q.eq('item_type', itemType)
        const [alertData, resData] = await Promise.all([
          q,
          supabase.from('expiry_alert_resolutions').select('expiry_tracking_id, color_band'),
        ])
        if (cancelled) return

        const resolvedSet = new Set<string>()
        ;(resData.data || []).forEach((r: any) => {
          resolvedSet.add(`${r.expiry_tracking_id}__${r.color_band}`)
        })

        const unresolved = (alertData.data || []).filter(
          (r: any) => !resolvedSet.has(`${r.expiry_tracking_id}__${r.color_band}`)
        )

        setHasAlerts(unresolved.length > 0)
        setAlertCount(unresolved.length)
      } catch {
        if (!cancelled) {
          setHasAlerts(false)
          setAlertCount(0)
        }
      }
    })()
    return () => { cancelled = true }
  }, [itemType])

  return { hasAlerts, alertCount }
}

// ---------------------------------------------------------------------------
// ExpiryAlertPopup — renders once per session
// ---------------------------------------------------------------------------
export function ExpiryAlertPopup({ onAlertsLoaded }: { onAlertsLoaded?: (count: number) => void }) {
  const { user } = useAuth()
  const { mode } = useTheme()
  const { activeModule } = useModule()
  const navigate = useNavigate()

  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<ExpiringAlertRow[]>([])

  const canNavigate = !!user?.role && NAVIGATE_ROLES.has(user.role)
  // Cada módulo vê os SEUS próprios vencimentos:
  //   - Farmácia → lotes de farmácia (via expiry_tracking)
  //   - Almoxarifado → itens de warehouse_items com expiry_date
  // Se o operador está fora de módulo específico, mostra ambos (fallback).
  const itemTypeFilter: 'pharmacy' | 'warehouse' | null =
    activeModule === 'farmacia' ? 'pharmacy' :
    activeModule === 'almoxarifado' ? 'warehouse' :
    null
  const sessionKey = activeModule === 'almoxarifado' ? SESSION_KEY_WH : SESSION_KEY_PHARM

  const isDark = mode === 'dark'
  const overlayBg = 'rgba(0,0,0,0.55)'
  const modalBg = isDark ? 'rgba(10,20,15,0.96)' : 'rgba(255,255,255,0.98)'
  const borderColor = isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.08)'
  const titleColor = isDark ? '#e8f0ec' : '#0d2e1c'
  const textColor = isDark ? 'rgba(255,255,255,0.8)' : 'rgba(13,46,28,0.75)'
  const mutedColor = isDark ? 'rgba(255,255,255,0.45)' : 'rgba(13,46,28,0.45)'
  const dividerColor = isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.06)'

  useEffect(() => {
    // Só admin/gestor recebem o popup (SHOW_ROLES). Solicitante/atendente/
    // enfermagem não são interrompidos com alerta que não é da alçada deles.
    if (!user?.role || !SHOW_ROLES.has(user.role)) return
    // Sem módulo ativo (tela de seleção Farmácia/Almox), NÃO mostra o popup:
    // não há "de qual módulo" e sem filtro ele misturava os dois. O alerta
    // aparece só depois que o usuário entra num módulo, com os itens dele.
    if (!itemTypeFilter) return
    // Skip if this module's session key already shown
    if (sessionStorage.getItem(sessionKey)) return

    let cancelled = false
    ;(async () => {
      try {
        let q = supabase.from('v_itens_a_vencer').select('*').order('expiry_date')
        if (itemTypeFilter) q = q.eq('item_type', itemTypeFilter)
        const [alertData, resData] = await Promise.all([
          q,
          supabase.from('expiry_alert_resolutions').select('expiry_tracking_id, color_band'),
        ])
        if (cancelled) return

        const resolvedSet = new Set<string>()
        ;(resData.data || []).forEach((r: any) => {
          resolvedSet.add(`${r.expiry_tracking_id}__${r.color_band}`)
        })

        const unresolved = ((alertData.data || []) as ExpiringAlertRow[]).filter(
          (r) => !resolvedSet.has(`${r.expiry_tracking_id}__${r.color_band}`)
        )

        if (onAlertsLoaded) onAlertsLoaded(unresolved.length)

        if (unresolved.length > 0) {
          setItems(unresolved)
          setOpen(true)
        }
      } catch {
        // silently fail — don't block the app
      }
    })()
    return () => { cancelled = true }
  }, [itemTypeFilter, sessionKey, user?.role]) // eslint-disable-line react-hooks/exhaustive-deps

  function handleClose() {
    sessionStorage.setItem(sessionKey, '1')
    setOpen(false)
  }

  function handleNavigate() {
    handleClose()
    // Farmácia tem tela dedicada; almox usa a lista do estoque
    navigate(activeModule === 'almoxarifado' ? '/inventory/warehouse' : '/estoque/vencimentos')
  }

  // Gate extra: se por algum motivo o role saiu de gestão depois do open, esconde.
  if (!user?.role || !SHOW_ROLES.has(user.role)) return null
  if (!open || items.length === 0) return null

  // Group by color_band in order 1m → 3m → 6m
  const grouped: Record<string, ExpiringAlertRow[]> = {}
  for (const band of BAND_ORDER) {
    const bandItems = items.filter((i) => i.color_band === band)
    if (bandItems.length > 0) grouped[band] = bandItems
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: overlayBg,
        padding: 16,
      }}
      onClick={(e) => { if (e.target === e.currentTarget) handleClose() }}
    >
      <div
        style={{
          background: modalBg,
          border: `1px solid ${borderColor}`,
          borderRadius: 20,
          width: '100%',
          maxWidth: 560,
          maxHeight: '85vh',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 24px 64px rgba(0,0,0,0.35)',
          backdropFilter: 'blur(30px)',
          WebkitBackdropFilter: 'blur(30px)',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '20px 24px 16px',
            borderBottom: `1px solid ${dividerColor}`,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div
              style={{
                width: 38,
                height: 38,
                borderRadius: 10,
                background: 'rgba(239,68,68,0.15)',
                border: '1px solid rgba(239,68,68,0.3)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <AlertTriangle style={{ width: 20, height: 20, color: '#ef4444' }} />
            </div>
            <div>
              <h2 style={{ fontSize: 16, fontWeight: 700, color: titleColor, margin: 0 }}>
                ⚠️ Atenção: Itens próximos de vencer
              </h2>
              <p style={{ fontSize: 12, color: mutedColor, margin: 0, marginTop: 2 }}>
                {items.length} {items.length === 1 ? 'item encontrado' : 'itens encontrados'}
              </p>
            </div>
          </div>
          <button
            onClick={handleClose}
            style={{
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              padding: 6,
              borderRadius: 8,
              display: 'flex',
              color: mutedColor,
            }}
          >
            <X style={{ width: 18, height: 18 }} />
          </button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 24px' }}>
          {BAND_ORDER.map((band) => {
            const bandItems = grouped[band]
            if (!bandItems) return null
            const colors = BAND_COLORS[band]
            return (
              <div key={band} style={{ marginBottom: 20 }}>
                {/* Band header */}
                <div
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '3px 10px',
                    borderRadius: 20,
                    background: colors.bg,
                    border: `1px solid ${colors.border}`,
                    marginBottom: 10,
                  }}
                >
                  <span style={{ fontSize: 12, fontWeight: 600, color: colors.text }}>
                    {BAND_LABELS[band]}
                  </span>
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      color: colors.text,
                      background: colors.border,
                      borderRadius: 10,
                      padding: '0 6px',
                    }}
                  >
                    {bandItems.length}
                  </span>
                </div>

                {/* Items */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {bandItems.map((item) => (
                    <div
                      key={`${item.expiry_tracking_id}__${item.color_band}`}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        padding: '10px 14px',
                        borderRadius: 10,
                        background: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.025)',
                        border: `1px solid ${dividerColor}`,
                        gap: 8,
                      }}
                    >
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p
                          style={{
                            fontSize: 13,
                            fontWeight: 600,
                            color: titleColor,
                            margin: 0,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {item.item_name}
                        </p>
                        <p style={{ fontSize: 11, color: mutedColor, margin: 0, marginTop: 2 }}>
                          {item.lote ? `Lote: ${item.lote} · ` : ''}
                          Validade: {formatDate(item.expiry_date)}
                        </p>
                      </div>
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 6,
                          flexShrink: 0,
                        }}
                      >
                        <span
                          style={{
                            fontSize: 12,
                            fontWeight: 600,
                            color: textColor,
                          }}
                        >
                          {item.quantity} un.
                        </span>
                        <span
                          style={{
                            fontSize: 11,
                            fontWeight: 600,
                            padding: '2px 8px',
                            borderRadius: 20,
                            background: colors.bg,
                            color: colors.text,
                            border: `1px solid ${colors.border}`,
                          }}
                        >
                          {band}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </div>

        {/* Footer */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            gap: 10,
            padding: '16px 24px',
            borderTop: `1px solid ${dividerColor}`,
          }}
        >
          <Button variant="outline" onClick={handleClose}>
            Fechar
          </Button>
          {canNavigate && (
            <Button onClick={handleNavigate} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <ExternalLink style={{ width: 15, height: 15 }} />
              Ir para Itens a Vencer
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
