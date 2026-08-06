import { useEffect, useState } from 'react'
import { AlertTriangle, X, PackageSearch } from 'lucide-react'
import { Button } from '@/components/ui/button'

// =====================================================================
// Aviso do Inventário Rotativo do Almoxarifado (CI 06/2026).
// Só aparece quando a solicitação é PARA O ALMOXARIFADO (prop `active`):
// - Modal grande assim que a pessoa escolhe o almox (ela fecha).
// - Depois, uma tarja fixa no topo enquanto ela monta a solicitação.
// O aviso some sozinho depois do último dia do inventário (não precisa
// remover na mão). Para reusar em outro inventário, ajuste as datas abaixo.
// =====================================================================
const INV_DATAS = '11, 12 e 13 de agosto de 2026'
const AVISO_ATE = '2026-08-13' // some sozinho a partir de 14/08

export function InventoryNoticeAlmox({ active }: { active: boolean }) {
  const hoje = new Date().toISOString().slice(0, 10)
  const dentroJanela = hoje <= AVISO_ATE
  const [modalAberto, setModalAberto] = useState(false)
  const [jaMostrou, setJaMostrou] = useState(false)

  // Abre o modal uma vez, quando a pessoa escolhe o almoxarifado.
  useEffect(() => {
    if (active && dentroJanela && !jaMostrou) {
      setModalAberto(true)
      setJaMostrou(true)
    }
  }, [active, dentroJanela, jaMostrou])

  if (!active || !dentroJanela) return null

  return (
    <>
      {/* Tarja fixa no topo, visível enquanto faz o pedido */}
      <div className="sticky top-0 z-30 -mx-4 sm:mx-0 mb-4">
        <div className="flex items-center gap-2 px-4 py-2.5 bg-amber-500 text-white text-sm font-medium shadow-md sm:rounded-lg">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          <span>
            <strong>Inventário do Almoxarifado ({INV_DATAS}).</strong>{' '}
            O atendimento de requisições ficará limitado — antecipe seus pedidos.
          </span>
        </div>
      </div>

      {/* Modal grande na entrada */}
      {modalAberto && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.6)' }}
          onClick={() => setModalAberto(false)}
        >
          <div
            className="w-full max-w-lg rounded-2xl bg-white shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="bg-amber-500 px-6 py-5 flex items-start gap-3">
              <div className="p-2 bg-white/20 rounded-xl">
                <PackageSearch className="w-7 h-7 text-white" />
              </div>
              <div className="flex-1">
                <h2 className="text-xl font-bold text-white leading-tight">
                  Inventário Rotativo do Almoxarifado
                </h2>
                <p className="text-amber-50 text-sm mt-0.5">{INV_DATAS}</p>
              </div>
              <button onClick={() => setModalAberto(false)} className="text-white/80 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="px-6 py-5 space-y-3 text-sm text-gray-700 leading-relaxed">
              <p>
                Nesses <strong>três dias</strong>, o Almoxarifado estará dedicado à
                <strong> conferência e validação dos estoques</strong>. Durante o período, o
                <strong> atendimento das requisições de materiais ficará limitado</strong>.
              </p>
              <p>
                Por favor, <strong>programe-se e antecipe seus pedidos</strong> para garantir o
                abastecimento do seu setor durante o inventário.
              </p>
              <p className="text-gray-500">Contamos com a sua compreensão e colaboração.</p>
            </div>

            <div className="px-6 py-4 bg-gray-50 border-t border-gray-100 flex justify-end">
              <Button onClick={() => setModalAberto(false)} className="bg-amber-600 hover:bg-amber-700 text-white">
                Entendi, continuar
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
