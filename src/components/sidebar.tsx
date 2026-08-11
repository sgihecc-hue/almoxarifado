import { useEffect, useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '@/contexts/auth'
import { useTheme } from '@/contexts/theme'
import { useModule } from '@/contexts/module'
import { supabase } from '@/lib/supabase'
import { buildSidebarSections, type VisibilityFlags, type SidebarSection } from '@/lib/constants/sidebar-menu'
import { LogOut, X, Pill, Package2, ArrowLeftRight } from 'lucide-react'

interface SidebarProps {
  isOpen: boolean
  onClose: () => void
}

export function Sidebar({ isOpen, onClose }: SidebarProps) {
  const { user, signOut } = useAuth()
  const { colors } = useTheme()
  const { activeModule, setActiveModule, isModuleUser, activeStock } = useModule()
  const navigate = useNavigate()

  const isAdmin = user?.role === 'administrador'
  const isManager = user?.role === 'gestor'
  // Farmacêutico opera a farmácia com a MESMA navegação de um atendente-farmácia
  // (Dispensações, Solicitações, Estoque, Saídas, catálogo, relatórios). Por isso
  // entra junto do atendente nos flags de visibilidade. As seções de almox não
  // aparecem pra ele porque o módulo efetivo dele é sempre 'farmacia'.
  const isPharmacyOperator = user?.role === 'atendente' || user?.role === 'pharmacist'

  const [deptCode, setDeptCode] = useState<string | null>(null)
  useEffect(() => {
    if (!user?.department_id) { setDeptCode(null); return }
    let cancelled = false
    ;(async () => {
      try {
        const { data } = await supabase
          .from('departments').select('code').eq('id', user.department_id!).maybeSingle()
        if (!cancelled) setDeptCode((data as { code?: string } | null)?.code ?? null)
      } catch {
        if (!cancelled) setDeptCode(null)
      }
    })()
    return () => { cancelled = true }
  }, [user?.department_id])

  const isEnfermagem = !!deptCode && deptCode.startsWith('ENF') && !isAdmin
  const canManageRequests = !isEnfermagem && (isAdmin || isManager || isPharmacyOperator)

  // isAtendente nos flags = "operador de farmácia" (atendente OU farmacêutico):
  // todos os itens de menu gated por f.isAtendente valem também pro farmacêutico.
  const flags: VisibilityFlags = { isAdmin, isManager, isAtendente: isPharmacyOperator, isEnfermagem, canManageRequests }

  // Contador de solicitacoes pendentes para o setor que o user atende
  // (destination_department). Aparece como badge ao lado de "Solicitações".
  // Estrategia: poll de 15s + refetch imediato quando a aba fica visivel
  // (Chrome throttla setInterval em tabs em segundo plano — sem visibility
  // handler, ao voltar pra aba o badge pode ficar ate 1min desatualizado).
  const [pendingCount, setPendingCount] = useState(0)
  useEffect(() => {
    if (!canManageRequests) { setPendingCount(0); return }
    let cancelled = false
    const loadCount = async () => {
      try {
        let deptId: string | null = null
        if (activeModule === 'farmacia' && activeStock) {
          const { data } = await supabase
            .from('departments')
            .select('id')
            .ilike('name', activeStock.code === 'CAF' ? 'CAF%' : activeStock.name)
            .maybeSingle()
          deptId = (data as { id?: string } | null)?.id ?? null
        } else if (activeModule === 'almoxarifado') {
          const { data } = await supabase
            .from('departments')
            .select('id')
            .eq('name', 'Almoxarifado')
            .maybeSingle()
          deptId = (data as { id?: string } | null)?.id ?? null
        }
        if (!deptId) { if (!cancelled) setPendingCount(0); return }
        // RPC (POST) em vez de SELECT (GET): proxies corporativos costumam
        // cachear GET, e o cliente ficava com contagem antiga por minutos.
        // POST nao eh cacheavel por default em quase todo proxy.
        const { data: rpcData } = await supabase
          .rpc('contar_solicitacoes_pendentes', { p_dept_id: deptId })
        const count = typeof rpcData === 'number' ? rpcData : Number(rpcData ?? 0)
        if (!cancelled) setPendingCount(count || 0)
      } catch {
        if (!cancelled) setPendingCount(0)
      }
    }
    loadCount()
    // Realtime: WebSocket pra requests. Qualquer INSERT/UPDATE/DELETE
    // dispara refetch (~1s). Fallback: poll de 60s + visibilitychange/focus
    // caso o WS caia ou a aba estivesse dormindo.
    const channel = supabase
      .channel('sidebar-badge-requests')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'requests' }, () => {
        loadCount()
      })
      .subscribe()
    const t = setInterval(loadCount, 60000)
    const onVisible = () => { if (document.visibilityState === 'visible') loadCount() }
    const onFocus = () => loadCount()
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onFocus)
    return () => {
      cancelled = true
      clearInterval(t)
      supabase.removeChannel(channel)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onFocus)
    }
  }, [canManageRequests, activeModule, activeStock])

  const allSections = buildSidebarSections({ pharmacyStock: activeModule === 'farmacia' ? activeStock : null })

  const filteredSections = mergeSectionsByTitle(filterSectionsByModule(allSections, activeModule))

  function filterSectionsByModule(sections: SidebarSection[], mod: typeof activeModule): SidebarSection[] {
    if (!mod) return sections
    return sections.filter(s =>
      s.module === 'shared' || s.module === 'admin' || s.module === mod
    )
  }

  // Duas secoes com o mesmo titulo (ex.: "Inicio" pra shared+farmacia+almox)
  // devem virar UMA no render, com os itens concatenados. Sem esse merge,
  // aparecia "INICIO" 3x seguidos no header — bagunca visual.
  function mergeSectionsByTitle(sections: SidebarSection[]): SidebarSection[] {
    const merged: SidebarSection[] = []
    for (const s of sections) {
      const idx = merged.findIndex((m) => m.title === s.title)
      if (idx >= 0) {
        merged[idx] = { ...merged[idx], items: [...merged[idx].items, ...s.items] }
      } else {
        merged.push({ ...s, items: [...s.items] })
      }
    }
    // Sem módulo ativo (solicitante), as secoes de farmacia e almox se juntam
    // e os itens apareciam DUPLICADOS (ex.: "Solicitacoes" e "Minhas
    // Solicitacoes", ambos indo pra /requests). Deduplica por href — mantem o
    // primeiro. Para quem tem modulo ativo isso e no-op (ja vem filtrado).
    return merged.map((s) => {
      const vistos = new Set<string>()
      return {
        ...s,
        items: s.items.filter((it) => {
          if (vistos.has(it.href)) return false
          vistos.add(it.href)
          return true
        }),
      }
    })
  }

  const modulePrefix = activeModule
    ? (activeModule === 'farmacia' ? '/farmacia' : '/almox')
    : ''

  const PATH_MAP: Record<string, string> = activeModule ? {
    '/': `${modulePrefix}/dashboard`,
    '/inventory/pharmacy': `${modulePrefix}/inventory`,
    '/inventory/warehouse': `${modulePrefix}/inventory`,
    '/dispensacao': `${modulePrefix}/dispensacao`,
    '/dispensacao/paciente': `${modulePrefix}/dispensacao/paciente`,
    '/dispensacao/fila-aprovacao': `${modulePrefix}/dispensacao/fila-aprovacao`,
    '/dispensacao/historico': `${modulePrefix}/dispensacao/historico`,
    '/farmacia/fornecedores': `${modulePrefix}/cadastros/fornecedores`,
    '/farmacia/prescritores': `${modulePrefix}/cadastros/prescritores`,
    '/farmacia/pacientes': `${modulePrefix}/cadastros/pacientes`,
    '/farmacia/antimicrobianos': `${modulePrefix}/antimicrobianos`,
    '/farmacia/intervencao-farmaceutica': `${modulePrefix}/intervencao-farmaceutica`,
    '/farmacia/movimentacoes': `${modulePrefix}/movimentacoes`,
    '/farmacia/movimentacoes/new': `${modulePrefix}/movimentacoes/new`,
    '/almoxarifado/movimentacoes': `${modulePrefix}/movimentacoes`,
    '/almoxarifado/movimentacoes/new': `${modulePrefix}/movimentacoes/new`,
    '/saida-direta': `${modulePrefix}/saida-direta`,
    '/saida-direta/new': `${modulePrefix}/saida-direta/new`,
    '/requests': `${modulePrefix}/requests`,
    '/requests/new': `${modulePrefix}/requests/new`,
    '/requests/inbox': `${modulePrefix}/requests/inbox`,
    '/requests/processing': `${modulePrefix}/requests/processing`,
    '/requests/history': `${modulePrefix}/requests/history`,
    '/requests/pending': `${modulePrefix}/requests/pending`,
    '/estoque/saida-avulsa': `${modulePrefix}/estoque/saida-avulsa`,
    '/estoque/devolucao': `${modulePrefix}/estoque/devolucao`,
    '/estoque/transferencia': `${modulePrefix}/estoque/transferencia`,
    '/estoque/emprestimos': `${modulePrefix}/estoque/emprestimos`,
    '/estoque/vencimentos': `${modulePrefix}/estoque/vencimentos`,
    '/reports/pharmacy-stock': `${modulePrefix}/reports/pharmacy-stock`,
    '/reports/warehouse-stock': `${modulePrefix}/reports/warehouse-stock`,
    '/reports/stock-expiry': `${modulePrefix}/reports/stock-expiry`,
    '/reports/pharmacy-consumption': `${modulePrefix}/reports/pharmacy-consumption`,
    '/reports/warehouse-consumption': `${modulePrefix}/reports/warehouse-consumption`,
    '/reports/pharmacy-admin-consumption': `${modulePrefix}/reports/pharmacy-admin-consumption`,
    '/reports/warehouse-admin-consumption': `${modulePrefix}/reports/warehouse-admin-consumption`,
    '/reports/farmacia-multi-estoque': `${modulePrefix}/reports/farmacia-multi-estoque`,
    '/reports/movimentacoes': `${modulePrefix}/reports/movimentacoes`,
  } : {}

  function prefixHref(href: string): string {
    if (!isModuleUser || !activeModule) return href
    // Suporta hrefs com query string (ex.: "/reports/stock-expiry?type=pharmacy"):
    // separa path do resto, mapeia so o path e reagrupa com o mesmo query.
    const qIdx = href.indexOf('?')
    if (qIdx >= 0) {
      const path = href.slice(0, qIdx)
      const rest = href.slice(qIdx)
      const mapped = PATH_MAP[path]
      return (mapped ?? path) + rest
    }
    return PATH_MAP[href] ?? href
  }

  function handleSwitchModule() {
    setActiveModule(null)
    // escolherModulo avisa o seletor que a troca foi PEDIDA pelo usuário, pra
    // ele não reaplicar o atalho por setor e mandar de volta pro mesmo módulo.
    navigate('/', { state: { escolherModulo: true } })
    onClose()
  }

  return (
    <div
      className={`fixed inset-y-0 left-0 z-50 w-64 flex flex-col h-full transform transition-all duration-300 ease-in-out ${isOpen ? 'translate-x-0' : '-translate-x-full'} md:relative md:translate-x-0`}
      style={{
        background: colors.sidebarBg,
        backdropFilter: 'blur(30px)',
        WebkitBackdropFilter: 'blur(30px)',
        borderRight: `1px solid ${colors.sidebarBorder}`,
        padding: 24,
        transition: 'background 0.4s, border-color 0.4s',
      }}
    >
      <button className="absolute top-4 right-4 md:hidden" onClick={onClose}>
        <X className="h-5 w-5" style={{ color: colors.sidebarTextMuted }} />
      </button>

      {/* Logo & User Info */}
      <div className="mb-8 space-y-2">
        <div className="flex items-center space-x-2">
          <div style={{
            width: 38, height: 38, borderRadius: 10,
            background: 'linear-gradient(135deg, #2db48c, #38bdaa)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 16, fontWeight: 800, color: '#fff',
            boxShadow: '0 4px 12px rgba(45, 180, 140, 0.3)',
          }}>H</div>
          <h1 style={{ fontSize: 20, fontWeight: 800, color: colors.sidebarLogo, transition: 'color 0.4s' }}>
            HECC
          </h1>
        </div>
        <h2 style={{ fontSize: 12, fontWeight: 500, color: colors.sidebarTextMuted, transition: 'color 0.4s' }}>
          Hospital Estadual Costa dos Coqueiros
        </h2>

        {/* Module indicator */}
        {isModuleUser && activeModule && (
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '6px 10px', borderRadius: 8,
            background: activeModule === 'farmacia'
              ? 'rgba(45, 163, 98, 0.15)'
              : 'rgba(0, 204, 187, 0.15)',
            marginTop: 8,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {activeModule === 'farmacia'
                ? <Pill className="w-4 h-4" style={{ color: '#2da362' }} />
                : <Package2 className="w-4 h-4" style={{ color: '#00CCBB' }} />
              }
              <span style={{
                fontSize: 12, fontWeight: 600,
                color: activeModule === 'farmacia' ? '#2da362' : '#00CCBB',
              }}>
                {activeModule === 'farmacia' ? 'Farmácia' : 'Almoxarifado'}
              </span>
            </div>
            <button
              onClick={handleSwitchModule}
              title="Trocar módulo"
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                padding: 2, borderRadius: 4, display: 'flex',
              }}
            >
              <ArrowLeftRight className="w-3.5 h-3.5" style={{ color: colors.sidebarTextMuted }} />
            </button>
          </div>
        )}

        <div style={{ paddingTop: 8, borderTop: `1px solid ${colors.sidebarBorder}` }}>
          <p style={{ fontSize: 14, fontWeight: 500, color: colors.sidebarText, transition: 'color 0.4s' }}>{user?.full_name}</p>
          <p style={{ fontSize: 12, color: colors.sidebarTextMuted, textTransform: 'capitalize', transition: 'color 0.4s' }}>{user?.role}</p>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 space-y-5 overflow-y-auto" style={{ marginRight: -8, paddingRight: 8 }}>
        {filteredSections.map((section) => {
          const visibleItems = section.items.filter(item => item.show(flags))
          if (visibleItems.length === 0) return null

          return (
            <div key={section.title}>
              <h3 style={{
                padding: '0 8px', fontSize: 11, fontWeight: 600,
                color: colors.sidebarTextMuted, textTransform: 'uppercase',
                letterSpacing: 1.2, transition: 'color 0.4s',
              }}>
                {section.title}
              </h3>
              <div className="mt-2 space-y-1">
                {visibleItems.map((item) => {
                  const resolvedHref = prefixHref(item.href)
                  return (
                  <div key={item.href}>
                    <NavLink
                      to={resolvedHref}
                      style={({ isActive }) => ({
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        padding: '8px 10px', fontSize: 14, fontWeight: 500,
                        borderRadius: 10, transition: 'all 0.2s',
                        background: isActive ? colors.sidebarActive : 'transparent',
                        color: isActive ? colors.sidebarActiveText : colors.sidebarText,
                        textDecoration: 'none',
                      })}
                      onClick={item.submenu ? undefined : onClose}
                      onMouseEnter={(e) => {
                        if (!e.currentTarget.classList.contains('active'))
                          e.currentTarget.style.background = colors.sidebarHover
                      }}
                      onMouseLeave={(e) => {
                        const isActive = e.currentTarget.getAttribute('aria-current') === 'page'
                        e.currentTarget.style.background = isActive ? colors.sidebarActive : 'transparent'
                      }}
                    >
                      <div className="flex items-center gap-2">
                        <item.icon className="w-5 h-5" />
                        {item.name}
                      </div>
                      {item.href === '/requests' && pendingCount > 0 && (
                        <span
                          title={`${pendingCount} solicitação(oes) pendente(s)`}
                          style={{
                            minWidth: 20, height: 20, padding: '0 6px',
                            borderRadius: 10, background: '#ef4444', color: '#fff',
                            fontSize: 11, fontWeight: 700,
                            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                            lineHeight: 1,
                          }}
                        >
                          {pendingCount > 99 ? '99+' : pendingCount}
                        </span>
                      )}
                    </NavLink>
                    {item.submenu && (
                      <div className="ml-7 mt-1 space-y-1">
                        {item.submenu.map((subitem) => (
                          <NavLink
                            key={subitem.href}
                            to={prefixHref(subitem.href)}
                            style={({ isActive }) => ({
                              display: 'flex', alignItems: 'center', gap: 8,
                              padding: '6px 10px', fontSize: 13,
                              borderRadius: 8, transition: 'all 0.2s',
                              background: isActive ? colors.sidebarActive : 'transparent',
                              color: isActive ? colors.sidebarActiveText : colors.sidebarText,
                              textDecoration: 'none',
                            })}
                            onClick={onClose}
                          >
                            <subitem.icon className="w-4 h-4" />
                            {subitem.name}
                          </NavLink>
                        ))}
                      </div>
                    )}
                  </div>
                  )
                })}
              </div>
            </div>
          )
        })}
      </nav>

      {/* Logout Button */}
      <button
        onClick={() => signOut()}
        style={{
          marginTop: 24, display: 'flex', alignItems: 'center', gap: 8,
          width: '100%', padding: '10px 10px', fontSize: 14, fontWeight: 500,
          borderRadius: 10, border: 'none', cursor: 'pointer',
          background: 'transparent', color: colors.sidebarText,
          transition: 'all 0.2s',
        }}
        onMouseEnter={(e) => { e.currentTarget.style.background = colors.sidebarHover }}
        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
      >
        <LogOut className="w-5 h-5" />
        Sair
      </button>

      <style>{`
        nav::-webkit-scrollbar { width: 4px; }
        nav::-webkit-scrollbar-track { background: transparent; }
        nav::-webkit-scrollbar-thumb { background: ${colors.sidebarBorder}; border-radius: 2px; }
      `}</style>
    </div>
  )
}
