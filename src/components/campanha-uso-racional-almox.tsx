import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'

// =====================================================================
// Campanha "Usar bem é cuidar melhor" — uso racional de materiais
// médico-hospitalares.
//
// Só aparece quando a solicitação é PARA O ALMOXARIFADO (prop `active`).
// A farmácia não vê nada disto.
//
// TODA VEZ, de proposito: abre a cada visita à tela de nova solicitação
// enquanto a campanha estiver no ar. Não tem "não mostrar de novo" nem
// nada gravado no navegador — o pedido foi que aparecesse sempre.
//
// Some sozinho depois de CAMPANHA_ATE, sem precisar de deploy para tirar.
// Para prorrogar ou reaproveitar, mude só a data abaixo.
//
// Mesmo padrão do inventory-notice-almox.tsx (aviso do inventário de agosto).
// =====================================================================
const CAMPANHA_ATE = '2026-10-10' // 30 dias a partir de 10/09/2026
const IMAGEM = '/assets/campanha-uso-racional.jpg'

export function CampanhaUsoRacionalAlmox({ active }: { active: boolean }) {
  const hoje = new Date().toISOString().slice(0, 10)
  const dentroJanela = hoje <= CAMPANHA_ATE
  const [aberto, setAberto] = useState(false)
  const [jaAbriu, setJaAbriu] = useState(false)

  // Abre quando a pessoa escolhe o almoxarifado. O `jaAbriu` evita reabrir
  // a cada re-render DESTA visita — sair da tela e voltar mostra de novo,
  // que é o comportamento pedido.
  useEffect(() => {
    if (active && dentroJanela && !jaAbriu) {
      setAberto(true)
      setJaAbriu(true)
    }
  }, [active, dentroJanela, jaAbriu])

  // Esc fecha, como em qualquer modal.
  useEffect(() => {
    if (!aberto) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setAberto(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [aberto])

  if (!active || !dentroJanela || !aberto) return null

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.7)' }}
      onClick={() => setAberto(false)}
      role="dialog"
      aria-modal="true"
      aria-label="Campanha: usar bem é cuidar melhor"
    >
      <div
        className="w-full max-w-2xl max-h-[92vh] rounded-2xl bg-white shadow-2xl overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-2.5 bg-[#0f4c5c] flex-shrink-0">
          <span className="text-white text-sm font-semibold tracking-wide">
            Campanha HECC — Uso Racional de Materiais
          </span>
          <button
            onClick={() => setAberto(false)}
            className="text-white/80 hover:text-white p-1"
            aria-label="Fechar"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* A peça é alta: rola dentro do modal em vez de estourar a tela. */}
        <div className="overflow-y-auto flex-1 bg-gray-50">
          <img
            src={IMAGEM}
            alt="Campanha Usar bem é cuidar melhor — uso racional e consciente de materiais médico-hospitalares. Antes de utilizar, pense: é realmente necessário? Estou utilizando a quantidade adequada? O material está sendo utilizado corretamente? Posso evitar uma perda? Retirei e não utilizei?"
            className="w-full h-auto block"
          />
        </div>

        <div className="px-4 py-3 bg-white border-t border-gray-100 flex justify-end flex-shrink-0">
          <Button
            onClick={() => setAberto(false)}
            className="bg-[#0f4c5c] hover:bg-[#0c3d4a] text-white"
          >
            Entendi, continuar
          </Button>
        </div>
      </div>
    </div>
  )
}
