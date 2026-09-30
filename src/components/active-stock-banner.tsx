import { Building2, AlertCircle } from 'lucide-react'
import { useModule } from '@/contexts/module'
import { corDoEstoque } from '@/lib/constants/cores-estoque'

/**
 * Faixa horizontal no TOPO da tela mostrando em qual estoque
 * (CAF/SAT_1/SAT_2/SAT_T) o operador está. Fica logo abaixo do
 * Header, ocupa 100% da largura, texto grande e centralizado —
 * pra ficar impossível de ignorar. Substitui o badge inline pequeno.
 *
 * Só aparece no módulo Farmácia. No Almoxarifado ou fora de módulo,
 * o banner some (retorna null).
 */
export function ActiveStockBanner() {
  const { activeModule, activeStock } = useModule()
  if (activeModule !== 'farmacia') return null

  if (!activeStock) {
    return (
      <div
        style={{
          background: 'linear-gradient(90deg, rgba(245,158,11,0.15), rgba(245,158,11,0.25), rgba(245,158,11,0.15))',
          borderBottom: '1px solid rgba(245,158,11,0.35)',
          padding: '10px 16px',
        }}
      >
        <div className="flex items-center justify-center gap-2 text-amber-900 font-semibold text-base">
          <AlertCircle className="w-5 h-5" />
          Nenhum estoque selecionado — escolha um estoque no menu superior
        </div>
      </div>
    )
  }

  const cor = corDoEstoque(activeStock.code)
  return (
    <div
      style={{
        background: cor?.faixa ?? 'linear-gradient(90deg, rgba(45,180,140,0.12), rgba(45,180,140,0.22), rgba(45,180,140,0.12))',
        borderBottom: `2px solid ${cor?.destaque ?? 'rgba(45,180,140,0.35)'}`,
        padding: '12px 16px',
      }}
    >
      <div className="flex items-center justify-center gap-3">
        <Building2 className="w-6 h-6" style={{ color: cor?.destaque ?? '#2da362' }} />
        <div className="text-center">
          <div className="text-xs uppercase tracking-widest font-semibold" style={{ color: cor?.texto ?? '#1a6b47' }}>
            Você está no estoque
          </div>
          <div className="text-xl md:text-2xl font-bold" style={{ color: cor?.texto ?? '#0d5a3a' }}>
            {activeStock.name}
          </div>
        </div>
      </div>
    </div>
  )
}
