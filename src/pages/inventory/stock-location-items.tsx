import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { PharmacyItems } from './pharmacy-items'
import { WarehouseItems } from './warehouse-items'
import { useModule } from '@/contexts/module'
import { pharmacyStockById } from '@/lib/constants/stock-locations'

export function StockLocationItems() {
  const { locationId } = useParams<{ locationId: string }>()
  const { setActiveStock } = useModule()
  const stock = pharmacyStockById(locationId)
  const [aba, setAba] = useState<'material' | 'caf'>('material')

  // Mantém o estoque ativo (topo/sidebar) em sincronia ao entrar direto pela URL.
  useEffect(() => {
    if (stock) setActiveStock(stock)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locationId])

  // SAT_T é um satélite de MATERIAIS (mesmo catálogo do almoxarifado). CAF, SAT_1
  // e SAT_2 são satélites de MEDICAMENTOS. O `itemType` da constante decide.
  // O Terreo tambem guarda mat-med e soros da CAF (cadastro de farmacia,
  // Andressa 05/11): segunda aba com esses itens.
  if (stock?.itemType === 'warehouse') {
    const btn = (k: 'material' | 'caf', rotulo: string) => (
      <button
        type="button"
        onClick={() => setAba(k)}
        className={`px-4 py-2 rounded-lg text-sm font-medium border ${aba === k
          ? 'bg-primary-500 text-white border-primary-500'
          : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'}`}
      >
        {rotulo}
      </button>
    )
    return (
      <div className="space-y-4">
        {stock.code === 'SAT_T' && (
          <div className="flex gap-2">
            {btn('material', 'Materiais do almoxarifado')}
            {btn('caf', 'Mat-med e soros da CAF')}
          </div>
        )}
        {aba === 'caf' && stock.code === 'SAT_T'
          ? <PharmacyItems key="caf" locationId={locationId} locationName={stock.name} catalogoFarmacia />
          : <WarehouseItems locationId={locationId} locationName={stock.name} />}
      </div>
    )
  }
  return <PharmacyItems locationId={locationId} locationName={stock?.name} />
}

// Rota /farmacia/inventory (menu Estoque da farmacia). No Satelite Terreo mostra
// as duas abas: material do almox (tela de sempre) e mat-med/soros da CAF.
export function EstoqueFarmacia() {
  const { activeStock } = useModule()
  const [aba, setAba] = useState<'material' | 'caf'>('material')
  if (activeStock?.code !== 'SAT_T') return <PharmacyItems />
  const btn = (k: 'material' | 'caf', rotulo: string) => (
    <button
      type="button"
      onClick={() => setAba(k)}
      className={`px-4 py-2 rounded-lg text-sm font-medium border ${aba === k
        ? 'bg-primary-500 text-white border-primary-500'
        : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'}`}
    >
      {rotulo}
    </button>
  )
  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        {btn('material', 'Materiais do almoxarifado')}
        {btn('caf', 'Mat-med e soros da CAF')}
      </div>
      {aba === 'caf' ? <PharmacyItems key="caf" catalogoFarmacia /> : <PharmacyItems key="material" />}
    </div>
  )
}
