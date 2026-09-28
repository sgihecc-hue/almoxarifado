// =====================================================================
// Saida avulsa / "Quebras e Avarias" — APOSENTADA (auditoria 28/09/2026, A10)
//
// Esta tela listava SO medicamentos (pharmacy_items), gravava o movimento
// direto do navegador (sem lote, sem conferir saldo, sem idempotencia) e o
// menu "Quebras e Avarias" do ALMOXARIFADO apontava para ela — a saida de
// material saia como se fosse da farmacia.
//
// A saida em lote (inventory/saida-lote -> RPC registrar_saida_lote) faz tudo
// isso certo: modulo correto, lote, saldo com trava, motivo Quebra/Avaria,
// chave contra duplo clique. Esta rota agora so redireciona para ela, pelo
// modulo/estoque ativo. O menu deve apontar direto para a saida em lote
// (mudanca de menu descrita no relatorio para o coordenador).
// =====================================================================

import { Navigate, useLocation } from 'react-router-dom'
import { useModule } from '@/contexts/module'

export function SaidaAvulsa() {
  const { activeModule, activeStock } = useModule()
  const location = useLocation()

  const ehAlmox = activeModule === 'almoxarifado' || location.pathname.startsWith('/almox')
  if (ehAlmox) {
    return <Navigate to="/inventory/warehouse/saida-lote?loc=ALMOX" replace />
  }
  const code = activeStock?.code ?? 'CAF'
  const tipo = activeStock?.itemType === 'warehouse' ? 'warehouse' : 'pharmacy'
  return <Navigate to={`/inventory/${tipo}/saida-lote?loc=${code}`} replace />
}
