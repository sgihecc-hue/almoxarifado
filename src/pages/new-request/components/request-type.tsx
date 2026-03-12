import { Package2, Pill, ArrowRight } from 'lucide-react'
import type { RequestType } from '../types'

interface RequestTypeProps {
  type: RequestType | null
  onTypeSelect: (type: RequestType) => void
}

export function RequestTypeStep({ type, onTypeSelect }: RequestTypeProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      {/* Pharmacy Card */}
      <div 
        className={`relative group cursor-pointer rounded-xl border-2 transition-all ${
          type === 'pharmacy'
            ? 'border-primary-500 bg-primary-50 shadow-lg'
            : 'border-gray-200 hover:border-primary-200 hover:bg-gray-50'
        }`}
        onClick={() => onTypeSelect('pharmacy')}
      >
        <div className="p-6">
          <div className="flex items-center gap-4">
            <div className={`p-3 rounded-lg transition-colors ${
              type === 'pharmacy' ? 'bg-primary-100' : 'bg-gray-100 group-hover:bg-primary-50'
            }`}>
              <Pill className={`w-8 h-8 ${
                type === 'pharmacy' ? 'text-primary-600' : 'text-gray-500 group-hover:text-primary-500'
              }`} />
            </div>
            <div>
              <h3 className={`text-lg font-semibold transition-colors ${
                type === 'pharmacy' ? 'text-primary-900' : 'text-gray-900'
              }`}>
                Farmácia
              </h3>
              <p className="text-gray-500 mt-1">
                Solicite medicamentos e materiais hospitalares
              </p>
            </div>
          </div>
          <ul className="mt-4 space-y-2 text-sm text-gray-500">
            <li className="flex items-center">
              <span className="w-2 h-2 rounded-full bg-primary-500 mr-2" />
              Medicamentos
            </li>
            <li className="flex items-center">
              <span className="w-2 h-2 rounded-full bg-primary-500 mr-2" />
              Materiais hospitalares
            </li>
            <li className="flex items-center">
              <span className="w-2 h-2 rounded-full bg-primary-500 mr-2" />
              Insumos médicos
            </li>
          </ul>
        </div>
        {type === 'pharmacy' && (
          <div className="absolute -right-2 -top-2 w-8 h-8 bg-primary-500 rounded-full flex items-center justify-center text-white">
            <ArrowRight className="w-4 h-4" />
          </div>
        )}
      </div>

      {/* Warehouse Card */}
      <div 
        className={`relative group cursor-pointer rounded-xl border-2 transition-all ${
          type === 'warehouse'
            ? 'border-primary-500 bg-primary-50 shadow-lg'
            : 'border-gray-200 hover:border-primary-200 hover:bg-gray-50'
        }`}
        onClick={() => onTypeSelect('warehouse')}
      >
        <div className="p-6">
          <div className="flex items-center gap-4">
            <div className={`p-3 rounded-lg transition-colors ${
              type === 'warehouse' ? 'bg-primary-100' : 'bg-gray-100 group-hover:bg-primary-50'
            }`}>
              <Package2 className={`w-8 h-8 ${
                type === 'warehouse' ? 'text-primary-600' : 'text-gray-500 group-hover:text-primary-500'
              }`} />
            </div>
            <div>
              <h3 className={`text-lg font-semibold transition-colors ${
                type === 'warehouse' ? 'text-primary-900' : 'text-gray-900'
              }`}>
                Almoxarifado
              </h3>
              <p className="text-gray-500 mt-1">
                Solicite materiais de escritório e outros insumos
              </p>
            </div>
          </div>
          <ul className="mt-4 space-y-2 text-sm text-gray-500">
            <li className="flex items-center">
              <span className="w-2 h-2 rounded-full bg-primary-500 mr-2" />
              Material de escritório
            </li>
            <li className="flex items-center">
              <span className="w-2 h-2 rounded-full bg-primary-500 mr-2" />
              Material de limpeza
            </li>
            <li className="flex items-center">
              <span className="w-2 h-2 rounded-full bg-primary-500 mr-2" />
              Equipamentos
            </li>
          </ul>
        </div>
        {type === 'warehouse' && (
          <div className="absolute -right-2 -top-2 w-8 h-8 bg-primary-500 rounded-full flex items-center justify-center text-white">
            <ArrowRight className="w-4 h-4" />
          </div>
        )}
      </div>
    </div>
  )
}