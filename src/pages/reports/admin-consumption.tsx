import { useState, useEffect } from 'react'
import { 
  BarChart3, 
  Download, 
  Pill, 
  Loader2, 
  AlertTriangle,
  Save,
  CheckCircle2,
  Building2,
  Plus,
  Trash2,
  Search,
  FileText,
  Upload
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { format } from 'date-fns'
import { itemsService } from '@/lib/services/items'
import { departmentsService } from '@/lib/services/departments'
import { pharmacyConsumptionService } from '@/lib/services/pharmacy-consumption'
import { useAuth } from '@/contexts/auth'
import { 
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import type { Item } from '@/lib/services/items'
import type { Department } from '@/lib/types/departments'

// Types for consumption data
interface ConsumptionEntry {
  id: string;
  item_id: string;
  department_id: string;
  date: string;
  quantity: number;
  notes?: string;
  created_by: string;
  created_at: string;
}

interface ItemConsumptionData {
  item: Item;
  department: Department;
  quantity: number;
  date: string;
  notes?: string;
}

interface DepartmentConsumptionData {
  department: Department;
  totalQuantity: number;
  items: {
    item: Item;
    quantity: number;
  }[];
}

export function AdminConsumptionManagement() {
  const { user } = useAuth()
  const isAdmin = user?.role === 'administrador'
  const [items, setItems] = useState<Item[]>([])
  const [departments, setDepartments] = useState<Department[]>([])
  const [consumptionEntries, setConsumptionEntries] = useState<ConsumptionEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<'byItem' | 'byDepartment' | 'history'>('byItem')
  
  // Form states
  const [showAddItemDialog, setShowAddItemDialog] = useState(false)
  const [showAddBulkDialog, setShowAddBulkDialog] = useState(false)
  const [selectedItem, setSelectedItem] = useState<string>('')
  const [selectedDepartment, setSelectedDepartment] = useState<string>('')
  const [consumptionDate, setConsumptionDate] = useState<string>(format(new Date(), 'yyyy-MM-dd'))
  const [consumptionQuantity, setConsumptionQuantity] = useState<number>(1)
  const [consumptionNotes, setConsumptionNotes] = useState<string>('')
  const [searchTerm, setSearchTerm] = useState<string>('')
  const [bulkEntries, setBulkEntries] = useState<ItemConsumptionData[]>([])
  const [bulkDepartment, setBulkDepartment] = useState<string>('')
  const [bulkDate, setBulkDate] = useState<string>(format(new Date(), 'yyyy-MM-dd'))
  
  // Filters
  const [dateFilter, setDateFilter] = useState<string>('')
  const [departmentFilter, setDepartmentFilter] = useState<string>('')
  const [itemFilter, setItemFilter] = useState<string>('')

  // Load items and departments on component mount
  useEffect(() => {
    if (!isAdmin) {
      setError('Você não tem permissão para acessar esta página')
      return
    }
    
    loadItems()
    loadDepartments()
    loadConsumptionData()
  }, [isAdmin])

  async function loadItems() {
    try {
      setLoading(true)
      const data = await itemsService.getAll()
      
      // Filter only pharmacy items
      const pharmacyItems = data.filter(item => 
        item.category === 'Medicamentos' || item.category === 'Material Hospitalar'
      )
      
      setItems(pharmacyItems)
    } catch (error) {
      console.error('Error loading items:', error)
      setError('Erro ao carregar itens. Por favor, tente novamente.')
    } finally {
      setLoading(false)
    }
  }

  async function loadDepartments() {
    try {
      const data = await departmentsService.getAll()
      setDepartments(data)
    } catch (error) {
      console.error('Error loading departments:', error)
      setError('Erro ao carregar setores. Por favor, tente novamente.')
    }
  }

  async function loadConsumptionData() {
    try {
      setError(null)
      // Load real consumption data from database
      const data = await pharmacyConsumptionService.getAll()
      
      if (!Array.isArray(data)) {
        console.warn('Invalid consumption data format')
        setConsumptionEntries([])
        return
      }
      
      // Convert to the expected format for local state
      const entries: ConsumptionEntry[] = data.map(entry => ({
        id: entry.id || `temp_${Math.random().toString(36).substring(2, 11)}`,
        item_id: entry.item.id,
        department_id: entry.department.id,
        date: entry.date,
        quantity: entry.quantity,
        notes: entry.notes,
        created_by: entry.created_by,
        created_at: entry.created_at
      })).filter(entry => entry.item_id && entry.department_id)
      
      setConsumptionEntries(entries)
    } catch (error) {
      console.error('Error loading consumption data:', error)
      setError('Erro ao carregar dados de consumo do banco. Verifique se há registros na tabela consumption_entries.')
      setConsumptionEntries([])
    }
  }

  const handleAddConsumption = async () => {
    try {
      if (!selectedItem || !selectedDepartment || !consumptionDate || consumptionQuantity <= 0) {
        setError('Por favor, preencha todos os campos obrigatórios')
        return
      }
      
      // Save to database
      await pharmacyConsumptionService.create({
        item_id: selectedItem,
        department_id: selectedDepartment,
        date: consumptionDate,
        quantity: consumptionQuantity,
        notes: consumptionNotes || undefined
      })
      
      // Reload data
      await loadConsumptionData()
      
      // Reset form
      setSelectedItem('')
      setSelectedDepartment('')
      setConsumptionQuantity(1)
      setConsumptionNotes('')
      
      setShowAddItemDialog(false)
      setSuccess('Consumo registrado com sucesso')
      
      // Clear success message after 3 seconds
      setTimeout(() => setSuccess(null), 3000)
    } catch (error) {
      console.error('Error adding consumption:', error)
      setError('Erro ao registrar consumo. Por favor, tente novamente.')
    }
  }

  const handleAddBulkConsumption = async () => {
    try {
      if (bulkEntries.length === 0) {
        setError('Adicione pelo menos um item para registrar consumo em massa')
        return
      }
      
      // Save all entries to database
      for (const entry of bulkEntries) {
        await pharmacyConsumptionService.create({
          item_id: entry.item.id,
          department_id: entry.department.id,
          date: entry.date,
          quantity: entry.quantity,
          notes: entry.notes
        })
      }
      
      // Reload data
      await loadConsumptionData()
      
      // Reset form
      setBulkEntries([])
      setBulkDepartment('')
      
      setShowAddBulkDialog(false)
      setSuccess(`${bulkEntries.length} registros de consumo adicionados com sucesso`)
      
      // Clear success message after 3 seconds
      setTimeout(() => setSuccess(null), 3000)
    } catch (error) {
      console.error('Error adding bulk consumption:', error)
      setError('Erro ao registrar consumo em massa. Por favor, tente novamente.')
    }
  }

  const handleAddToBulk = () => {
    if (!selectedItem || !bulkDepartment || !bulkDate || consumptionQuantity <= 0) {
      setError('Por favor, preencha todos os campos obrigatórios')
      return
    }
    
    const item = items.find(i => i.id === selectedItem)
    const department = departments.find(d => d.id === bulkDepartment)
    
    if (!item || !department) {
      setError('Item ou departamento inválido')
      return
    }
    
    const newEntry: ItemConsumptionData = {
      item,
      department,
      quantity: consumptionQuantity,
      date: bulkDate,
      notes: consumptionNotes
    }
    
    setBulkEntries([...bulkEntries, newEntry])
    
    // Reset item selection and quantity
    setSelectedItem('')
    setConsumptionQuantity(1)
    setConsumptionNotes('')
  }

  const handleRemoveFromBulk = (index: number) => {
    const newEntries = [...bulkEntries]
    newEntries.splice(index, 1)
    setBulkEntries(newEntries)
  }

  const handleDeleteConsumption = (id: string) => {
    try {
      // Delete from database
      pharmacyConsumptionService.delete(id).then(() => {
        // Reload data
        loadConsumptionData()
        setSuccess('Registro de consumo excluído com sucesso')
        setTimeout(() => setSuccess(null), 3000)
      }).catch(error => {
        console.error('Error deleting consumption:', error)
        setError('Erro ao excluir registro de consumo. Por favor, tente novamente.')
      })
      
    } catch (error) {
      console.error('Error deleting consumption:', error)
      setError('Erro ao excluir registro de consumo. Por favor, tente novamente.')
    }
  }

  const handleExport = () => {
    try {
      // Create CSV content
      const headers = ['Data', 'Item', 'Departamento', 'Quantidade', 'Observações']
      const rows = consumptionEntries.map(entry => {
        const item = items.find(i => i.id === entry.item_id)
        const department = departments.find(d => d.id === entry.department_id)
        
        return [
          entry.date,
          item?.name || 'Item não encontrado',
          department?.name || 'Departamento não encontrado',
          entry.quantity.toString(),
          entry.notes || ''
        ]
      })
      
      const csvContent = [
        headers.join(','),
        ...rows.map(row => row.join(','))
      ].join('\n')
      
      // Create blob and download
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
      const link = document.createElement('a')
      const url = URL.createObjectURL(blob)
      
      link.setAttribute('href', url)
      link.setAttribute('download', `consumo_farmacia_${format(new Date(), 'dd-MM-yyyy')}.csv`)
      link.style.visibility = 'hidden'
      
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
    } catch (error) {
      console.error('Error exporting data:', error)
      setError('Erro ao exportar dados.')
    }
  }

  // Filter consumption entries based on filters
  const filteredEntries = consumptionEntries.filter(entry => {
    const item = items.find(i => i.id === entry.item_id)
    const department = departments.find(d => d.id === entry.department_id)
    
    const matchesDate = !dateFilter || entry.date === dateFilter
    const matchesDepartment = !departmentFilter || entry.department_id === departmentFilter
    const matchesItem = !itemFilter || entry.item_id === itemFilter
    
    // Search term filter
    const matchesSearch = !searchTerm || 
      item?.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      item?.code?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      item?.category.toLowerCase().includes(searchTerm.toLowerCase()) ||
      department?.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      department?.description?.toLowerCase().includes(searchTerm.toLowerCase())
    
    return matchesDate && matchesDepartment && matchesItem && matchesSearch
  })

  // Group consumption by department for the department view
  const consumptionByDepartment: DepartmentConsumptionData[] = departments.map(department => {
    const departmentEntries = consumptionEntries.filter(entry => entry.department_id === department.id)
    
    const itemConsumption = items.map(item => {
      const itemEntries = departmentEntries.filter(entry => entry.item_id === item.id)
      const totalQuantity = itemEntries.reduce((sum, entry) => sum + entry.quantity, 0)
      
      return {
        item,
        quantity: totalQuantity
      }
    }).filter(item => item.quantity > 0)
    
    const totalQuantity = itemConsumption.reduce((sum, item) => sum + item.quantity, 0)
    
    return {
      department,
      totalQuantity,
      items: itemConsumption
    }
  }).filter(dept => dept.totalQuantity > 0)

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <Loader2 className="w-8 h-8 text-primary-500 animate-spin mx-auto mb-4" />
          <p className="text-gray-500">Carregando dados...</p>
        </div>
      </div>
    )
  }

  if (!isAdmin) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <AlertTriangle className="w-12 h-12 text-red-500 mx-auto mb-4" />
          <h2 className="text-lg font-semibold text-gray-900 mb-2">
            Acesso Restrito
          </h2>
          <p className="text-gray-500 mb-6">
            Você não tem permissão para acessar esta página.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-blue-100 rounded-lg">
              <BarChart3 className="w-6 h-6 text-blue-600" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Gestão de Consumo - Farmácia</h1>
              <p className="text-sm text-gray-500 mt-1">
                Registre e gerencie o consumo de medicamentos e materiais por setor
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button 
              variant="outline" 
              size="sm"
              onClick={() => setShowAddBulkDialog(true)}
            >
              <Upload className="w-4 h-4 mr-2" />
              Registrar em Massa
            </Button>
            <Button 
              variant="outline" 
              size="sm"
              onClick={handleExport}
            >
              <Download className="w-4 h-4 mr-2" />
              Exportar
            </Button>
            <Button 
              className="bg-primary-500 hover:bg-primary-600 text-white"
              onClick={() => setShowAddItemDialog(true)}
            >
              <Plus className="w-4 h-4 mr-2" />
              Novo Registro
            </Button>
          </div>
        </div>

        {/* Success Message */}
        {success && (
          <div className="mb-6 p-4 bg-green-50 rounded-lg border border-green-200">
            <div className="flex items-center gap-2 text-green-700">
              <CheckCircle2 className="w-5 h-5" />
              <p>{success}</p>
            </div>
          </div>
        )}

        {/* Error Message */}
        {error && (
          <div className="mb-6 p-4 bg-red-50 rounded-lg border border-red-200">
            <div className="flex items-center gap-2 text-red-700">
              <AlertTriangle className="w-5 h-5" />
              <p>{error}</p>
            </div>
          </div>
        )}

        {/* Filters */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          <div>
            <Label htmlFor="date-filter">Filtrar por Data</Label>
            <Input
              id="date-filter"
              type="date"
              value={dateFilter}
              onChange={(e) => setDateFilter(e.target.value)}
              className="mt-1"
            />
          </div>
          <div>
            <Label htmlFor="department-filter">Filtrar por Setor</Label>
            <select
              id="department-filter"
              value={departmentFilter}
              onChange={(e) => setDepartmentFilter(e.target.value)}
              className="w-full mt-1 h-9 rounded-md border border-input px-3 py-1"
            >
              <option value="">Todos os Setores</option>
              {departments.map(dept => (
                <option key={dept.id} value={dept.id}>
                  {dept.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor="item-filter">Filtrar por Item</Label>
            <select
              id="item-filter"
              value={itemFilter}
              onChange={(e) => setItemFilter(e.target.value)}
              className="w-full mt-1 h-9 rounded-md border border-input px-3 py-1"
            >
              <option value="">Todos os Itens</option>
              {items.map(item => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-end">
            <Button 
              variant="outline" 
              className="w-full"
              onClick={() => {
                setDateFilter('')
                setDepartmentFilter('')
                setItemFilter('')
              }}
            >
              Limpar Filtros
            </Button>
          </div>
        </div>

        {/* Search */}
        <div className="relative mb-6">
          <Search className="w-4 h-4 absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" />
          <Input
            placeholder="Buscar por item ou setor..."
            className="pl-9"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
      </div>

      {/* Tabs */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100">
        <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as typeof activeTab)}>
          <div className="p-6 border-b border-gray-100">
            <TabsList className="grid grid-cols-3 gap-4">
              <TabsTrigger value="byItem" className="flex items-center gap-2">
                <Pill className="w-4 h-4" />
                Por Item
              </TabsTrigger>
              <TabsTrigger value="byDepartment" className="flex items-center gap-2">
                <Building2 className="w-4 h-4" />
                Por Setor
              </TabsTrigger>
              <TabsTrigger value="history" className="flex items-center gap-2">
                <FileText className="w-4 h-4" />
                Histórico
              </TabsTrigger>
            </TabsList>
          </div>

          {/* By Item View */}
          <TabsContent value="byItem" className="p-6">
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold text-gray-900">Consumo por Item</h2>
                <Button 
                  size="sm"
                  onClick={() => setShowAddItemDialog(true)}
                >
                  <Plus className="w-4 h-4 mr-2" />
                  Registrar Consumo
                </Button>
              </div>
              
              <div className="overflow-x-auto">
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-100">
                      <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">Item</th>
                      <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">Categoria</th>
                      <th className="px-4 py-3 text-right text-sm font-medium text-gray-600">Consumo Total</th>
                      <th className="px-4 py-3 text-right text-sm font-medium text-gray-600">Consumo Médio Diário</th>
                      <th className="px-4 py-3 text-center text-sm font-medium text-gray-600">Ações</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {items
                      .filter(item => 
                        !searchTerm || 
                        item.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                        item.code?.toLowerCase().includes(searchTerm.toLowerCase())
                      )
                      .map(item => {
                        const itemEntries = consumptionEntries.filter(entry => entry.item_id === item.id)
                        const totalConsumption = itemEntries.reduce((sum, entry) => sum + entry.quantity, 0)
                        
                        // Calculate average daily consumption
                        // In a real app, this would be more sophisticated
                        const avgDailyConsumption = totalConsumption / 30
                        
                        return (
                          <tr key={item.id} className="hover:bg-gray-50">
                            <td className="px-4 py-3 text-sm font-medium text-gray-900">
                              {item.name}
                              <div className="text-xs text-gray-500 mt-1">{item.code}</div>
                            </td>
                            <td className="px-4 py-3 text-sm text-gray-600">{item.category}</td>
                            <td className="px-4 py-3 text-sm text-right text-gray-600">
                              {totalConsumption} {item.unit}
                            </td>
                            <td className="px-4 py-3 text-sm text-right text-gray-600">
                              {avgDailyConsumption.toFixed(2)} {item.unit}/dia
                            </td>
                            <td className="px-4 py-3 text-center">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                  setSelectedItem(item.id)
                                  setShowAddItemDialog(true)
                                }}
                              >
                                <Plus className="w-4 h-4 mr-2" />
                                Registrar
                              </Button>
                            </td>
                          </tr>
                        )
                      })}
                  </tbody>
                </table>
              </div>
            </div>
          </TabsContent>

          {/* By Department View */}
          <TabsContent value="byDepartment" className="p-6">
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold text-gray-900">Consumo por Setor</h2>
                <Button 
                  size="sm"
                  onClick={() => setShowAddItemDialog(true)}
                >
                  <Plus className="w-4 h-4 mr-2" />
                  Registrar Consumo
                </Button>
              </div>
              
              {consumptionByDepartment
                .filter(dept =>
                  !searchTerm ||
                  dept.department.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                  dept.department.description?.toLowerCase().includes(searchTerm.toLowerCase())
                )
                .map(dept => (
                  <div key={dept.department.id} className="bg-gray-50 p-4 rounded-lg border border-gray-200 mb-4">
                    <div className="flex items-center justify-between mb-4">
                      <div>
                        <h3 className="font-medium text-gray-900">{dept.department.name}</h3>
                        {dept.department.description && (
                          <p className="text-sm text-gray-500">{dept.department.description}</p>
                        )}
                      </div>
                      <div className="text-right">
                        <p className="text-sm text-gray-500">Consumo Total</p>
                        <p className="font-medium text-gray-900">{dept.totalQuantity} itens</p>
                      </div>
                    </div>
                    
                    <div className="overflow-x-auto">
                      <table className="w-full border-collapse">
                        <thead>
                          <tr className="bg-white border-b border-gray-100">
                            <th className="px-4 py-2 text-left text-xs font-medium text-gray-600">Item</th>
                            <th className="px-4 py-2 text-right text-xs font-medium text-gray-600">Quantidade</th>
                            <th className="px-4 py-2 text-right text-xs font-medium text-gray-600">% do Total</th>
                            <th className="px-4 py-2 text-center text-xs font-medium text-gray-600">Ações</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {dept.items.map(item => (
                            <tr key={item.item.id} className="hover:bg-white">
                              <td className="px-4 py-2 text-xs font-medium text-gray-900">{item.item.name}</td>
                              <td className="px-4 py-2 text-xs text-right text-gray-600">
                                {item.quantity} {item.item.unit}
                              </td>
                              <td className="px-4 py-2 text-xs text-right text-gray-600">
                                {((item.quantity / dept.totalQuantity) * 100).toFixed(1)}%
                              </td>
                              <td className="px-4 py-2 text-center">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 px-2 text-xs"
                                  onClick={() => {
                                    setSelectedItem(item.item.id)
                                    setSelectedDepartment(dept.department.id)
                                    setShowAddItemDialog(true)
                                  }}
                                >
                                  <Plus className="w-3 h-3 mr-1" />
                                  Registrar
                                </Button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ))}
            </div>
          </TabsContent>

          {/* History View */}
          <TabsContent value="history" className="p-6">
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold text-gray-900">Histórico de Registros</h2>
                <Button 
                  variant="outline" 
                  size="sm"
                  onClick={handleExport}
                >
                  <Download className="w-4 h-4 mr-2" />
                  Exportar
                </Button>
              </div>
              
              <div className="overflow-x-auto">
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-100">
                      <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">Data</th>
                      <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">Item</th>
                      <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">Setor</th>
                      <th className="px-4 py-3 text-right text-sm font-medium text-gray-600">Quantidade</th>
                      <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">Observações</th>
                      <th className="px-4 py-3 text-center text-sm font-medium text-gray-600">Ações</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {filteredEntries.map(entry => {
                      const item = items.find(i => i.id === entry.item_id)
                      const department = departments.find(d => d.id === entry.department_id)
                      
                      return (
                        <tr key={entry.id} className="hover:bg-gray-50">
                          <td className="px-4 py-3 text-sm text-gray-600">
                            {format(new Date(entry.date), 'dd/MM/yyyy')}
                          </td>
                          <td className="px-4 py-3 text-sm font-medium text-gray-900">
                            {item?.name || 'Item não encontrado'}
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-600">
                            {department?.name || 'Setor não encontrado'}
                          </td>
                          <td className="px-4 py-3 text-sm text-right text-gray-600">
                            {entry.quantity} {item?.unit || 'un'}
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-600">
                            {entry.notes || '-'}
                          </td>
                          <td className="px-4 py-3 text-center">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-red-500 hover:text-red-600"
                              onClick={() => handleDeleteConsumption(entry.id)}
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </td>
                        </tr>
                      )
                    })}
                    {filteredEntries.length === 0 && (
                      <tr>
                        <td colSpan={6} className="px-4 py-6 text-center text-gray-500">
                          Nenhum registro de consumo encontrado
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </div>

      {/* Add Item Consumption Dialog */}
      <Dialog open={showAddItemDialog} onOpenChange={setShowAddItemDialog}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>Registrar Consumo</DialogTitle>
          </DialogHeader>
          
          <div className="space-y-4 py-4">
            <div>
              <Label htmlFor="item">Item</Label>
              <select
                id="item"
                value={selectedItem}
                onChange={(e) => setSelectedItem(e.target.value)}
                className="w-full mt-1 h-9 rounded-md border border-input px-3 py-1"
              >
                <option value="">Selecione um item</option>
                {items.map(item => (
                  <option key={item.id} value={item.id}>
                    {item.name} ({item.code})
                  </option>
                ))}
              </select>
            </div>
            
            <div>
              <Label htmlFor="department">Setor</Label>
              <select
                id="department"
                value={selectedDepartment}
                onChange={(e) => setSelectedDepartment(e.target.value)}
                className="w-full mt-1 h-9 rounded-md border border-input px-3 py-1"
              >
                <option value="">Selecione um setor</option>
                {departments.map(dept => (
                  <option key={dept.id} value={dept.id}>
                    {dept.name}
                  </option>
                ))}
              </select>
            </div>
            
            <div>
              <Label htmlFor="date">Data do Consumo</Label>
              <Input
                id="date"
                type="date"
                value={consumptionDate}
                onChange={(e) => setConsumptionDate(e.target.value)}
                className="mt-1"
              />
            </div>
            
            <div>
              <Label htmlFor="quantity">Quantidade</Label>
              <Input
                id="quantity"
                type="number"
                min="1"
                value={consumptionQuantity}
                onChange={(e) => setConsumptionQuantity(parseInt(e.target.value) || 0)}
                className="mt-1"
              />
            </div>
            
            <div>
              <Label htmlFor="notes">Observações (opcional)</Label>
              <textarea
                id="notes"
                value={consumptionNotes}
                onChange={(e) => setConsumptionNotes(e.target.value)}
                className="w-full mt-1 rounded-md border border-input px-3 py-2 min-h-[80px]"
                placeholder="Adicione observações sobre este consumo..."
              />
            </div>
          </div>
          
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddItemDialog(false)}>
              Cancelar
            </Button>
            <Button onClick={handleAddConsumption}>
              <Save className="w-4 h-4 mr-2" />
              Registrar Consumo
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Bulk Consumption Dialog */}
      <Dialog open={showAddBulkDialog} onOpenChange={setShowAddBulkDialog}>
        <DialogContent className="sm:max-w-[700px]">
          <DialogHeader>
            <DialogTitle>Registrar Consumo em Massa</DialogTitle>
          </DialogHeader>
          
          <div className="space-y-6 py-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="bulk-department">Setor</Label>
                <select
                  id="bulk-department"
                  value={bulkDepartment}
                  onChange={(e) => setBulkDepartment(e.target.value)}
                  className="w-full mt-1 h-9 rounded-md border border-input px-3 py-1"
                >
                  <option value="">Selecione um setor</option>
                  {departments.map(dept => (
                    <option key={dept.id} value={dept.id}>
                      {dept.name}
                    </option>
                  ))}
                </select>
              </div>
              
              <div>
                <Label htmlFor="bulk-date">Data do Consumo</Label>
                <Input
                  id="bulk-date"
                  type="date"
                  value={bulkDate}
                  onChange={(e) => setBulkDate(e.target.value)}
                  className="mt-1"
                />
              </div>
            </div>
            
            <div className="border-t border-b py-4">
              <h3 className="text-sm font-medium text-gray-900 mb-4">Adicionar Itens</h3>
              
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                <div>
                  <Label htmlFor="bulk-item">Item</Label>
                  <select
                    id="bulk-item"
                    value={selectedItem}
                    onChange={(e) => setSelectedItem(e.target.value)}
                    className="w-full mt-1 h-9 rounded-md border border-input px-3 py-1"
                  >
                    <option value="">Selecione um item</option>
                    {items.map(item => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                </div>
                
                <div>
                  <Label htmlFor="bulk-quantity">Quantidade</Label>
                  <Input
                    id="bulk-quantity"
                    type="number"
                    min="1"
                    value={consumptionQuantity}
                    onChange={(e) => setConsumptionQuantity(parseInt(e.target.value) || 0)}
                    className="mt-1"
                  />
                </div>
                
                <div className="flex items-end">
                  <Button 
                    onClick={handleAddToBulk}
                    className="w-full"
                    disabled={!selectedItem || !bulkDepartment || !bulkDate || consumptionQuantity <= 0}
                  >
                    <Plus className="w-4 h-4 mr-2" />
                    Adicionar Item
                  </Button>
                </div>
              </div>
              
              <div>
                <Label htmlFor="bulk-notes">Observações (opcional)</Label>
                <textarea
                  id="bulk-notes"
                  value={consumptionNotes}
                  onChange={(e) => setConsumptionNotes(e.target.value)}
                  className="w-full mt-1 rounded-md border border-input px-3 py-2 min-h-[60px]"
                  placeholder="Adicione observações sobre este consumo..."
                />
              </div>
            </div>
            
            <div>
              <h3 className="text-sm font-medium text-gray-900 mb-4">Itens Adicionados</h3>
              
              {bulkEntries.length > 0 ? (
                <div className="overflow-y-auto max-h-[200px] border rounded-md">
                  <table className="w-full border-collapse">
                    <thead>
                      <tr className="bg-gray-50 border-b border-gray-100">
                        <th className="px-4 py-2 text-left text-xs font-medium text-gray-600">Item</th>
                        <th className="px-4 py-2 text-right text-xs font-medium text-gray-600">Quantidade</th>
                        <th className="px-4 py-2 text-center text-xs font-medium text-gray-600">Ações</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {bulkEntries.map((entry, index) => (
                        <tr key={index} className="hover:bg-gray-50">
                          <td className="px-4 py-2 text-xs font-medium text-gray-900">
                            {entry.item.name}
                          </td>
                          <td className="px-4 py-2 text-xs text-right text-gray-600">
                            {entry.quantity} {entry.item.unit}
                          </td>
                          <td className="px-4 py-2 text-center">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 px-2 text-red-500 hover:text-red-600"
                              onClick={() => handleRemoveFromBulk(index)}
                            >
                              <Trash2 className="w-3 h-3" />
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="p-4 text-center text-gray-500 border rounded-md">
                  Nenhum item adicionado
                </div>
              )}
            </div>
          </div>
          
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddBulkDialog(false)}>
              Cancelar
            </Button>
            <Button 
              onClick={handleAddBulkConsumption}
              disabled={bulkEntries.length === 0}
            >
              <Save className="w-4 h-4 mr-2" />
              Registrar {bulkEntries.length} Item(ns)
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}