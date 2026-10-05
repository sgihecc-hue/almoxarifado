import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { ClipboardCheck } from 'lucide-react'
import { useModule } from '@/contexts/module'
import { almoxInventarioService, type StatusInventario } from '@/lib/services/almox-inventario'

// =============================================================================
// Faixa "Almoxarifado em inventário" (Modo Inventário, 05/10/2026).
// O status vem do banco (almox_inventario_status) — a mesma fonte dos gatilhos
// que bloqueiam os pedidos. Erro ao consultar = sem faixa (o bloqueio continua
// valendo no banco, com a mensagem clara na hora de gravar).
// =============================================================================

const INTERVALO_MS = 60_000

export function useInventarioAlmoxStatus(ativo = true) {
  const [status, setStatus] = useState<StatusInventario | null>(null)
  const location = useLocation()
  useEffect(() => {
    if (!ativo) { setStatus(null); return }
    let vivo = true
    const consultar = () => {
      almoxInventarioService.status()
        .then((s) => { if (vivo) setStatus(s) })
        .catch(() => { /* sem faixa; o banco segue bloqueando */ })
    }
    consultar()
    const t = setInterval(consultar, INTERVALO_MS)
    return () => { vivo = false; clearInterval(t) }
  }, [ativo, location.pathname])
  return status
}

/** Faixa no topo do layout, para quem está no módulo Almoxarifado. */
export function InventarioAlmoxBanner() {
  const { activeModule, perfil } = useModule()
  const location = useLocation()
  const navigate = useNavigate()
  const noAlmox = perfil.modulos.includes('almoxarifado')
    && (activeModule === 'almoxarifado' || location.pathname.startsWith('/almox'))
  const status = useInventarioAlmoxStatus(noAlmox)
  if (!noAlmox || !status?.aberto) return null
  const naPagina = location.pathname.startsWith('/almox/inventario')
  return (
    <div className="bg-amber-500 text-white px-4 py-2 text-sm font-medium flex items-center justify-center gap-2 flex-wrap text-center">
      <ClipboardCheck className="w-4 h-4 shrink-0" />
      <span>{status.mensagem}</span>
      {!naPagina && (
        <button type="button" onClick={() => navigate('/almox/inventario')}
          className="underline font-semibold hover:text-amber-50">
          Abrir o inventário
        </button>
      )}
    </div>
  )
}

/** Aviso na Nova Solicitação: o pedido do almox vai ser recusado pelo banco. */
export function InventarioAlmoxAvisoPedido({ active }: { active: boolean }) {
  const status = useInventarioAlmoxStatus(active)
  if (!active || !status?.aberto) return null
  return (
    <div role="alert" className="p-4 rounded-lg border border-amber-300 bg-amber-50 text-amber-900 text-sm flex items-start gap-3">
      <ClipboardCheck className="w-5 h-5 shrink-0 mt-0.5 text-amber-600" />
      <div>
        <p className="font-semibold">{status.mensagem}</p>
        <p className="mt-1">
          O almoxarifado está contando o estoque. Pedidos novos só poderão ser enviados depois do fechamento do inventário.
          Em caso de urgência, procure o almoxarifado.
        </p>
      </div>
    </div>
  )
}
