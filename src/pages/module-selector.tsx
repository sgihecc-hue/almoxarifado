import { useState, useEffect, useRef } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '@/contexts/auth'
import { useModule } from '@/contexts/module'
import { useTheme } from '@/contexts/theme'
import { supabase } from '@/lib/supabase'
import { Pill, Package2, ArrowRight, ArrowLeft, Building2, Warehouse } from 'lucide-react'
import { PHARMACY_STOCKS, moduloDoSetor, type PharmacyStock } from '@/lib/constants/stock-locations'

export function ModuleSelector() {
  const navigate = useNavigate()
  const location = useLocation()
  const { user } = useAuth()
  const { setActiveModule, setActiveStock } = useModule()
  const { mode } = useTheme()

  const firstName = user?.full_name?.split(' ')[0] || 'Usuário'

  // Atalho por setor: quem é lotado numa farmácia já cai na escolha de estoque
  // e quem é do Almoxarifado entra direto no módulo dele. Setor administrativo
  // (Supervisão Administrativa, TI...) continua vendo os dois cartões.
  //
  // Quando o usuário clica em "trocar módulo" na sidebar, ela navega pra "/"
  // com state.escolherModulo = true — aí o atalho NÃO roda, senão ele voltaria
  // pro mesmo módulo num loop e a troca ficaria impossível.
  const trocaExplicita = (location.state as { escolherModulo?: boolean } | null)?.escolherModulo === true
  // Só aplica o atalho uma vez: depois disso o usuário navega à vontade
  // (ex.: "Voltar aos módulos" não pode ser desfeito pelo atalho).
  const atalhoAplicado = useRef(false)
  const [verificandoSetor, setVerificandoSetor] = useState(!trocaExplicita)

  const glass = mode === 'dark' ? 'rgba(30, 46, 38, 0.7)' : 'rgba(255, 255, 255, 0.7)'
  const textColor = mode === 'dark' ? '#e8f0ec' : '#1a2a22'
  const mutedColor = mode === 'dark' ? '#98b0a4' : '#64748b'
  const borderCol = mode === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)'

  // 'modules' = escolher Farmácia/Almoxarifado; 'pharmacy' = escolher o estoque
  const [view, setView] = useState<'modules' | 'pharmacy'>('modules')

  function selectAlmoxarifado() {
    setActiveModule('almoxarifado')
    setActiveStock(null)
    navigate('/almox/dashboard')
  }

  function selectPharmacyStock(stock: PharmacyStock) {
    setActiveModule('farmacia')
    setActiveStock(stock)
    navigate(`/inventory/stock/${stock.id}`)
  }

  useEffect(() => {
    if (trocaExplicita || atalhoAplicado.current) { setVerificandoSetor(false); return }
    if (!user) return // auth ainda carregando
    if (!user.department_id) { setVerificandoSetor(false); return }

    let cancelado = false
    ;(async () => {
      const { data } = await supabase
        .from('departments')
        .select('name')
        .eq('id', user.department_id)
        .maybeSingle()
      if (cancelado) return
      atalhoAplicado.current = true
      const modulo = moduloDoSetor((data as { name?: string } | null)?.name)
      if (modulo === 'almoxarifado') {
        selectAlmoxarifado()
        return
      }
      if (modulo === 'farmacia') {
        // Vai direto pra escolha de estoque (CAF / Satélites).
        setActiveModule('farmacia')
        setView('pharmacy')
      }
      setVerificandoSetor(false)
    })()
    return () => { cancelado = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.department_id, trocaExplicita])

  // Evita piscar os dois cartões antes de saber o setor.
  if (verificandoSetor) {
    return <div style={{ padding: 40, textAlign: 'center', color: mutedColor }}>Carregando…</div>
  }

  const cardBase: React.CSSProperties = {
    background: glass,
    backdropFilter: 'blur(20px)',
    WebkitBackdropFilter: 'blur(20px)',
    border: `1px solid ${borderCol}`,
    borderRadius: 16,
    padding: 28,
    cursor: 'pointer',
    textAlign: 'left',
    transition: 'all 0.3s ease',
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
  }

  function hoverIn(e: React.MouseEvent<HTMLButtonElement>, color: string, bg: string) {
    e.currentTarget.style.background = bg
    e.currentTarget.style.borderColor = color
    e.currentTarget.style.transform = 'translateY(-4px)'
    e.currentTarget.style.boxShadow = `0 12px 32px ${color}20`
  }
  function hoverOut(e: React.MouseEvent<HTMLButtonElement>) {
    e.currentTarget.style.background = glass
    e.currentTarget.style.borderColor = borderCol
    e.currentTarget.style.transform = 'translateY(0)'
    e.currentTarget.style.boxShadow = 'none'
  }

  // ---------- Passo 1: módulos ----------
  if (view === 'modules') {
    const modules = [
      {
        key: 'farmacia' as const, title: 'Farmácia',
        description: 'Dispensação, cadastros, estoque de medicamentos, prescrições e controle de validades',
        icon: Pill, color: '#2da362', gradient: 'linear-gradient(135deg, #2da362, #38bdaa)',
        bgHover: mode === 'dark' ? 'rgba(45, 163, 98, 0.12)' : 'rgba(45, 163, 98, 0.08)',
        onClick: () => setView('pharmacy'),
      },
      {
        key: 'almoxarifado' as const, title: 'Almoxarifado',
        description: 'Saídas diretas, movimentações, estoque de materiais, consumo e relatórios',
        icon: Package2, color: '#00CCBB', gradient: 'linear-gradient(135deg, #00CCBB, #38bdaa)',
        bgHover: mode === 'dark' ? 'rgba(0, 204, 187, 0.12)' : 'rgba(0, 204, 187, 0.08)',
        onClick: selectAlmoxarifado,
      },
    ]

    return (
      <div style={{ maxWidth: 720, margin: '0 auto', padding: '40px 16px' }}>
        <div style={{ textAlign: 'center', marginBottom: 48 }}>
          <h1 style={{ fontSize: 28, fontWeight: 700, color: textColor, marginBottom: 8 }}>Olá, {firstName}!</h1>
          <p style={{ fontSize: 16, color: mutedColor }}>Selecione o módulo que deseja acessar</p>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
          {modules.map((mod) => (
            <button
              key={mod.key}
              onClick={mod.onClick}
              style={{ ...cardBase, padding: 32, gap: 20 }}
              onMouseEnter={(e) => hoverIn(e, mod.color, mod.bgHover)}
              onMouseLeave={hoverOut}
            >
              <div style={{
                width: 56, height: 56, borderRadius: 14, background: mod.gradient,
                display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: `0 4px 16px ${mod.color}30`,
              }}>
                <mod.icon className="w-7 h-7" style={{ color: '#fff' }} />
              </div>
              <div>
                <h2 style={{ fontSize: 20, fontWeight: 700, color: textColor, marginBottom: 6 }}>{mod.title}</h2>
                <p style={{ fontSize: 13, color: mutedColor, lineHeight: 1.5 }}>{mod.description}</p>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 600, color: mod.color, marginTop: 'auto' }}>
                {mod.key === 'farmacia' ? 'Escolher estoque' : 'Acessar'} <ArrowRight className="w-4 h-4" />
              </div>
            </button>
          ))}
        </div>
      </div>
    )
  }

  // ---------- Passo 2: estoques da farmácia ----------
  const color = '#2da362'
  const bgHover = mode === 'dark' ? 'rgba(45, 163, 98, 0.12)' : 'rgba(45, 163, 98, 0.08)'

  return (
    <div style={{ maxWidth: 860, margin: '0 auto', padding: '40px 16px' }}>
      <div style={{ textAlign: 'center', marginBottom: 16 }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, color, fontWeight: 700, fontSize: 14, marginBottom: 8 }}>
          <Pill className="w-4 h-4" /> Farmácia
        </div>
        <h1 style={{ fontSize: 26, fontWeight: 700, color: textColor, marginBottom: 8 }}>Em qual estoque deseja entrar?</h1>
        <p style={{ fontSize: 15, color: mutedColor }}>Escolha o estoque de farmácia que vai operar</p>
      </div>

      <button
        onClick={() => setView('modules')}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 6, marginBottom: 20,
          background: 'transparent', border: 'none', cursor: 'pointer', color: mutedColor, fontSize: 14, fontWeight: 600,
        }}
      >
        <ArrowLeft className="w-4 h-4" /> Voltar aos módulos
      </button>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 20 }}>
        {PHARMACY_STOCKS.map((stock) => {
          const isCaf = stock.code === 'CAF'
          const Icon = isCaf ? Building2 : Warehouse
          return (
            <button
              key={stock.id}
              onClick={() => selectPharmacyStock(stock)}
              style={cardBase}
              onMouseEnter={(e) => hoverIn(e, color, bgHover)}
              onMouseLeave={hoverOut}
            >
              <div style={{
                width: 48, height: 48, borderRadius: 12, background: 'linear-gradient(135deg, #2da362, #38bdaa)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: `0 4px 16px ${color}30`,
              }}>
                <Icon className="w-6 h-6" style={{ color: '#fff' }} />
              </div>
              <div>
                <h2 style={{ fontSize: 18, fontWeight: 700, color: textColor, marginBottom: 4 }}>{stock.label}</h2>
                <p style={{ fontSize: 12, color: mutedColor, lineHeight: 1.4 }}>{stock.name}</p>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 600, color, marginTop: 'auto' }}>
                Entrar <ArrowRight className="w-4 h-4" />
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}
