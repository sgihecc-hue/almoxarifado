import { useNavigate } from 'react-router-dom'
import { Building2, Pill, Package2 } from 'lucide-react'

export function TablesOverview() {
  const navigate = useNavigate()

  return (
    <div className="space-y-6">
      <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
        <h1 className="text-2xl font-bold text-gray-900">Tabelas do Sistema</h1>
        <p className="text-sm text-gray-500 mt-1">
          Gerencie as tabelas de referência do sistema
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Departments */}
        <div 
          className="bg-white p-6 rounded-xl border border-gray-100 shadow-sm hover:shadow-md transition-shadow cursor-pointer"
          onClick={() => navigate('/tables/departments')}
        >
          <div className="flex items-center gap-4 mb-4">
            <div className="p-3 bg-blue-100 rounded-lg">
              <Building2 className="w-6 h-6 text-blue-600" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Setores</h2>
              <p className="text-sm text-gray-500">
                Departamentos e unidades
              </p>
            </div>
          </div>
          <p className="text-sm text-gray-600">
            Gerencie os setores e departamentos do hospital, incluindo códigos e responsáveis.
          </p>
        </div>

        {/* Pharmacy Items */}
        <div 
          className="bg-white p-6 rounded-xl border border-gray-100 shadow-sm hover:shadow-md transition-shadow cursor-pointer"
          onClick={() => navigate('/inventory/pharmacy')}
        >
          <div className="flex items-center gap-4 mb-4">
            <div className="p-3 bg-green-100 rounded-lg">
              <Pill className="w-6 h-6 text-green-600" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Itens da Farmácia</h2>
              <p className="text-sm text-gray-500">
                Medicamentos e materiais
              </p>
            </div>
          </div>
          <p className="text-sm text-gray-600">
            Gerencie o catálogo de medicamentos e materiais hospitalares disponíveis.
          </p>
        </div>

        {/* Warehouse Items */}
        <div 
          className="bg-white p-6 rounded-xl border border-gray-100 shadow-sm hover:shadow-md transition-shadow cursor-pointer"
          onClick={() => navigate('/inventory/warehouse')}
        >
          <div className="flex items-center gap-4 mb-4">
            <div className="p-3 bg-purple-100 rounded-lg">
              <Package2 className="w-6 h-6 text-purple-600" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Itens do Almoxarifado</h2>
              <p className="text-sm text-gray-500">
                Materiais e suprimentos
              </p>
            </div>
          </div>
          <p className="text-sm text-gray-600">
            Gerencie o catálogo de materiais e suprimentos do almoxarifado.
          </p>
        </div>
      </div>
    </div>
  )
}