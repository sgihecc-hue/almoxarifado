import { useState } from 'react'
import { validateNumeric } from '@/lib/utils/sanitize'
import { Filter, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import type { FilterOptions } from '@/lib/services/items'

interface AdvancedFiltersProps {
  categories: string[]
  onFilterChange: (filters: FilterOptions) => void
  defaultFilters?: FilterOptions
}

export function AdvancedFilters({ 
  categories, 
  onFilterChange,
  defaultFilters = {
    categories: [],
    status: []
  }
}: AdvancedFiltersProps) {
  const [filters, setFilters] = useState<FilterOptions>(defaultFilters)
  const [open, setOpen] = useState(false)

  const handleFilterChange = (newFilters: Partial<FilterOptions>) => {
    const updatedFilters = { ...filters, ...newFilters }
    setFilters(updatedFilters)
    onFilterChange(updatedFilters)
  }

  const clearFilters = () => {
    const emptyFilters = {
      categories: [],
      status: []
    }
    setFilters(emptyFilters)
    onFilterChange(emptyFilters)
    setOpen(false)
  }

  const activeFiltersCount = [
    filters.minStock,
    filters.maxStock,
    filters.minPrice,
    filters.maxPrice,
    filters.minConsumption,
    filters.maxConsumption,
    ...(filters.categories || []),
    ...(filters.status || []),
    ...(filters.suppliers || []),
    ...(filters.locations || []),
    ...(filters.tags || []),
    filters.expiryDateRange?.start,
    filters.expiryDateRange?.end,
    filters.lastUpdated?.start,
    filters.lastUpdated?.end,
  ].filter(Boolean).length

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="relative">
          <Filter className="w-4 h-4 mr-2" />
          Filtros Avançados
          {activeFiltersCount > 0 && (
            <span className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-primary-500 text-white text-xs flex items-center justify-center">
              {activeFiltersCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[400px] p-4">
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-medium">Filtros Avançados</h3>
            <Button 
              variant="ghost" 
              size="sm"
              onClick={clearFilters}
              className="h-8 px-2 text-gray-500"
            >
              <X className="w-4 h-4 mr-2" />
              Limpar
            </Button>
          </div>

          <Accordion type="single" collapsible className="w-full">
            {/* Stock Filters */}
            <AccordionItem value="stock">
              <AccordionTrigger className="text-sm">
                Estoque
              </AccordionTrigger>
              <AccordionContent>
                <div className="space-y-4 pt-2">
                  {/* Stock Range */}
                  <div>
                    <Label className="text-xs">Quantidade em Estoque</Label>
                    <div className="grid grid-cols-2 gap-2 mt-1.5">
                      <div>
                        <Input
                          type="number"
                          placeholder="Mínimo"
                          value={filters.minStock || ''}
                          onChange={(e) => handleFilterChange({ 
                            minStock: e.target.value && validateNumeric(e.target.value) ? parseInt(e.target.value) : undefined 
                          })}
                          className="h-8"
                        />
                      </div>
                      <div>
                        <Input
                          type="number"
                          placeholder="Máximo"
                          value={filters.maxStock || ''}
                          onChange={(e) => handleFilterChange({ 
                            maxStock: e.target.value && validateNumeric(e.target.value) ? parseInt(e.target.value) : undefined 
                          })}
                          className="h-8"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Stock Status */}
                  <div>
                    <Label className="text-xs">Status do Estoque</Label>
                    <div className="grid grid-cols-1 gap-2 mt-1.5">
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={filters.status?.includes('normal')}
                          onChange={(e) => {
                            const newStatus = e.target.checked
                              ? [...(filters.status || []), 'normal']
                              : (filters.status || []).filter(s => s !== 'normal')
                            handleFilterChange({ status: newStatus as ('normal' | 'low' | 'critical')[] })
                          }}
                          className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                        />
                        Normal
                      </label>
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={filters.status?.includes('low')}
                          onChange={(e) => {
                            const newStatus = e.target.checked
                              ? [...(filters.status || []), 'low']
                              : (filters.status || []).filter(s => s !== 'low')
                            handleFilterChange({ status: newStatus as ('normal' | 'low' | 'critical')[] })
                          }}
                          className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                        />
                        Estoque Baixo
                      </label>
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={filters.status?.includes('critical')}
                          onChange={(e) => {
                            const newStatus = e.target.checked
                              ? [...(filters.status || []), 'critical']
                              : (filters.status || []).filter(s => s !== 'critical')
                            handleFilterChange({ status: newStatus as ('normal' | 'low' | 'critical')[] })
                          }}
                          className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                        />
                        Crítico
                      </label>
                    </div>
                  </div>
                </div>
              </AccordionContent>
            </AccordionItem>

            {/* Price Filters */}
            <AccordionItem value="price">
              <AccordionTrigger className="text-sm">
                Preço
              </AccordionTrigger>
              <AccordionContent>
                <div className="space-y-4 pt-2">
                  <div>
                    <Label className="text-xs">Faixa de Preço (R$)</Label>
                    <div className="grid grid-cols-2 gap-2 mt-1.5">
                      <div>
                        <Input
                          type="number"
                          placeholder="Mínimo"
                          value={filters.minPrice || ''}
                          onChange={(e) => handleFilterChange({ 
                            minPrice: e.target.value ? parseFloat(e.target.value) : undefined 
                          })}
                          className="h-8"
                        />
                      </div>
                      <div>
                        <Input
                          type="number"
                          placeholder="Máximo"
                          value={filters.maxPrice || ''}
                          onChange={(e) => handleFilterChange({ 
                            maxPrice: e.target.value ? parseFloat(e.target.value) : undefined 
                          })}
                          className="h-8"
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </AccordionContent>
            </AccordionItem>

            {/* Consumption Filters */}
            <AccordionItem value="consumption">
              <AccordionTrigger className="text-sm">
                Consumo
              </AccordionTrigger>
              <AccordionContent>
                <div className="space-y-4 pt-2">
                  <div>
                    <Label className="text-xs">Consumo Médio Mensal</Label>
                    <div className="grid grid-cols-2 gap-2 mt-1.5">
                      <div>
                        <Input
                          type="number"
                          placeholder="Mínimo"
                          value={filters.minConsumption || ''}
                          onChange={(e) => handleFilterChange({ 
                            minConsumption: e.target.value ? parseInt(e.target.value) : undefined 
                          })}
                          className="h-8"
                        />
                      </div>
                      <div>
                        <Input
                          type="number"
                          placeholder="Máximo"
                          value={filters.maxConsumption || ''}
                          onChange={(e) => handleFilterChange({ 
                            maxConsumption: e.target.value ? parseInt(e.target.value) : undefined 
                          })}
                          className="h-8"
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </AccordionContent>
            </AccordionItem>

            {/* Category Filters */}
            <AccordionItem value="categories">
              <AccordionTrigger className="text-sm">
                Categorias
              </AccordionTrigger>
              <AccordionContent>
                <div className="space-y-4 pt-2">
                  <div className="grid grid-cols-1 gap-2">
                    {categories.map(category => (
                      <label 
                        key={category}
                        className="flex items-center gap-2 text-sm"
                      >
                        <input
                          type="checkbox"
                          checked={filters.categories?.includes(category)}
                          onChange={(e) => {
                            const newCategories = e.target.checked
                              ? [...(filters.categories || []), category]
                              : (filters.categories || []).filter(c => c !== category)
                            handleFilterChange({ categories: newCategories })
                          }}
                          className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                        />
                        {category}
                      </label>
                    ))}
                  </div>
                </div>
              </AccordionContent>
            </AccordionItem>

            {/* Date Filters */}
            <AccordionItem value="dates">
              <AccordionTrigger className="text-sm">
                Datas
              </AccordionTrigger>
              <AccordionContent>
                <div className="space-y-4 pt-2">
                  {/* Last Updated */}
                  <div>
                    <Label className="text-xs">Última Atualização</Label>
                    <div className="grid grid-cols-2 gap-2 mt-1.5">
                      <div>
                        <Input
                          type="date"
                          value={filters.lastUpdated?.start?.toISOString().split('T')[0] || ''}
                          onChange={(e) => handleFilterChange({
                            lastUpdated: {
                              ...filters.lastUpdated,
                              start: e.target.value ? new Date(e.target.value) : undefined
                            }
                          })}
                          className="h-8"
                        />
                      </div>
                      <div>
                        <Input
                          type="date"
                          value={filters.lastUpdated?.end?.toISOString().split('T')[0] || ''}
                          onChange={(e) => handleFilterChange({
                            lastUpdated: {
                              ...filters.lastUpdated,
                              end: e.target.value ? new Date(e.target.value) : undefined
                            }
                          })}
                          className="h-8"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Expiry Date */}
                  <div>
                    <Label className="text-xs">Data de Validade</Label>
                    <div className="grid grid-cols-2 gap-2 mt-1.5">
                      <div>
                        <Input
                          type="date"
                          value={filters.expiryDateRange?.start?.toISOString().split('T')[0] || ''}
                          onChange={(e) => handleFilterChange({
                            expiryDateRange: {
                              ...filters.expiryDateRange,
                              start: e.target.value ? new Date(e.target.value) : undefined
                            }
                          })}
                          className="h-8"
                        />
                      </div>
                      <div>
                        <Input
                          type="date"
                          value={filters.expiryDateRange?.end?.toISOString().split('T')[0] || ''}
                          onChange={(e) => handleFilterChange({
                            expiryDateRange: {
                              ...filters.expiryDateRange,
                              end: e.target.value ? new Date(e.target.value) : undefined
                            }
                          })}
                          className="h-8"
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </AccordionContent>
            </AccordionItem>

            {/* Location Filters */}
            <AccordionItem value="locations">
              <AccordionTrigger className="text-sm">
                Localização
              </AccordionTrigger>
              <AccordionContent>
                <div className="space-y-4 pt-2">
                  <div>
                    <Label className="text-xs">Local de Armazenamento</Label>
                    <div className="grid grid-cols-1 gap-2 mt-1.5">
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={filters.locations?.includes('Prateleira A')}
                          onChange={(e) => {
                            const newLocations = e.target.checked
                              ? [...(filters.locations || []), 'Prateleira A']
                              : (filters.locations || []).filter(l => l !== 'Prateleira A')
                            handleFilterChange({ locations: newLocations })
                          }}
                          className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                        />
                        Prateleira A
                      </label>
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={filters.locations?.includes('Prateleira B')}
                          onChange={(e) => {
                            const newLocations = e.target.checked
                              ? [...(filters.locations || []), 'Prateleira B']
                              : (filters.locations || []).filter(l => l !== 'Prateleira B')
                            handleFilterChange({ locations: newLocations })
                          }}
                          className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                        />
                        Prateleira B
                      </label>
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={filters.locations?.includes('Armário 1')}
                          onChange={(e) => {
                            const newLocations = e.target.checked
                              ? [...(filters.locations || []), 'Armário  1']
                              : (filters.locations || []).filter(l => l !== 'Armário 1')
                            handleFilterChange({ locations: newLocations })
                          }}
                          className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                        />
                        Armário 1
                      </label>
                    </div>
                  </div>
                </div>
              </AccordionContent>
            </AccordionItem>
          </Accordion>

          <div className="pt-4 border-t">
            <Button 
              className="w-full"
              onClick={() => setOpen(false)}
            >
              Aplicar Filtros
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}