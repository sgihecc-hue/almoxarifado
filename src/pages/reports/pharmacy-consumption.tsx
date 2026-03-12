import { useState, useEffect } from 'react'
import { 
  Calendar, 
  BarChart3, 
  Download, 
  Settings, 
  Pill, 
  ArrowUpDown, 
  Loader2, 
  AlertTriangle,
  TrendingUp,
  Clock,
  CalendarDays,
  CalendarClock,
  Save,
  CheckCircle2,
  Building2,
  X,
  Search
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { format, subDays, startOfWeek, endOfWeek, startOfMonth, endOfMonth } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { itemsService } from '@/lib/services/items'
import { departmentsService } from '@/lib/services/departments'
import { useAuth } from '@/contexts/auth'
import { supabase } from '@/lib/supabase'
import { 
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Switch } from '@/components/ui/switch'
import { ConsumptionLineChart } from '@/components/charts/consumption-line-chart'
import { DepartmentPieChart } from '@/components/charts/department-pie-chart'
import type { Item } from '@/lib/services/items'
import type { Department } from '@/lib/types/departments'

// Types for consumption data
interface ConsumptionData {
  date: string;
  quantity: number;
  value: number;
  department?: string;
}

interface ConsumptionStats {
  totalQuantity: number;
  totalValue: number;
  averageQuantity: number;
  averageValue: number;
  maxQuantity: number;
  maxDate: string;
  items: {
    id: string;
    name: string;
    quantity: number;
    value: number;
  }[];
  byDepartment?: {
    department: string;
    quantity: number;
    value: number;
    percentage: number;
  }[];
}

interface ReportSettings {
  autoRefresh: boolean;
  refreshInterval: number; // in minutes
  defaultPeriod: 'daily' | 'weekly' | 'monthly';
  showValueData: boolean;
  includeLowStockWarnings: boolean;
  topItemsCount: number;
  categories: string[];
  showDepartmentBreakdown: boolean;
}

export function PharmacyConsumptionReport() {
  const { user } = useAuth()
  const isAdmin = user?.role === 'administrador'
  const [items, setItems] = useState<Item[]>([])
  const [departments, setDepartments] = useState<Department[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [period, setPeriod] = useState<'daily' | 'weekly' | 'monthly'>('daily')
  const [dateRange, setDateRange] = useState<{start: Date, end: Date}>({
    start: subDays(new Date(), 1),
    end: new Date()
  })
  const [consumptionData, setConsumptionData] = useState<ConsumptionData[]>([])
  const [stats, setStats] = useState<ConsumptionStats | null>(null)
  const [showSettingsDialog, setShowSettingsDialog] = useState(false)
  const [settings, setSettings] = useState<ReportSettings>({
    autoRefresh: false,
    refreshInterval: 30,
    defaultPeriod: 'daily',
    showValueData: true,
    includeLowStockWarnings: true,
    topItemsCount: 10,
    categories: ['Medicamentos', 'Material Hospitalar'],
    showDepartmentBreakdown: true
  })
  const [customDateRange, setCustomDateRange] = useState<{start: string, end: string}>({
    start: format(dateRange.start, 'yyyy-MM-dd'),
    end: format(dateRange.end, 'yyyy-MM-dd')
  })
  const [settingsSaved, setSettingsSaved] = useState(false)
  const [selectedDepartment, setSelectedDepartment] = useState<string>('all')
  const [showDepartmentFilter, setShowDepartmentFilter] = useState(false)
  const [selectedItem, setSelectedItem] = useState<string>('all')
  const [showItemFilter, setShowItemFilter] = useState(false)
  const [itemSearchTerm, setItemSearchTerm] = useState('')

  // Load items and departments on component mount
  useEffect(() => {
    loadItems()
    loadDepartments()
  }, [])

  // Update date range when period changes
  useEffect(() => {
    const today = new Date()
    let start: Date
    let end: Date = today

    switch (period) {
      case 'daily':
        start = subDays(today, 1)
        break
      case 'weekly':
        start = startOfWeek(today, { weekStartsOn: 1 }) // Week starts on Monday
        end = endOfWeek(today, { weekStartsOn: 1 })
        break
      case 'monthly':
        start = startOfMonth(today)
        end = endOfMonth(today)
        break
      default:
        start = subDays(today, 1)
    }

    setDateRange({ start, end })
    setCustomDateRange({
      start: format(start, 'yyyy-MM-dd'),
      end: format(end, 'yyyy-MM-dd')
    })
  }, [period])

  // Auto-refresh data based on settings
  useEffect(() => {
    let intervalId: number | undefined

    if (settings.autoRefresh && !loading) {
      intervalId = window.setInterval(() => {
        loadItems()
      }, settings.refreshInterval * 60 * 1000)
    }

    return () => {
      if (intervalId) clearInterval(intervalId)
    }
  }, [settings.autoRefresh, settings.refreshInterval, loading])

  // Process consumption data when items change or date range changes or department/item selection changes
  useEffect(() => {
    if (items.length > 0) {
      loadConsumptionFromDatabase()
    }
  }, [items, dateRange, selectedDepartment, selectedItem])

  async function loadItems() {
    try {
      setLoading(true)
      setError(null)
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

  async function loadConsumptionFromDatabase() {
    try {
      setError(null)
      
      // Get real consumption entries from database
      const { data: consumptionEntries, error: consumptionError } = await supabase
        .from('consumption_entries')
        .select(`
          *,
          item:pharmacy_items!consumption_entries_item_id_fkey(
            id,
            name,
            code,
            category,
            unit,
            price
          ),
          department:departments!consumption_entries_department_id_fkey(
            id,
            name,
            code
          ),
          created_by_user:users!consumption_entries_created_by_fkey(
            full_name
          )
        `)
        .gte('date', format(dateRange.start, 'yyyy-MM-dd'))
        .lte('date', format(dateRange.end, 'yyyy-MM-dd'))
        .order('date', { ascending: true })

      if (consumptionError) {
        console.error('Error fetching consumption data:', consumptionError)
        throw new Error('Erro ao carregar dados de consumo do banco')
      }
      
      if (!consumptionEntries || !Array.isArray(consumptionEntries)) {
        console.warn('Invalid consumption entries data')
        setConsumptionData([])
        setStats(null)
        return
      }
      
      // Convert to expected format
      const processedEntries = consumptionEntries
        .filter(entry => entry && entry.item && entry.department)
        .map(entry => ({
          item: entry.item,
          department: entry.department,
          quantity: entry.quantity,
          date: entry.date,
          notes: entry.notes,
          created_by: entry.created_by_user?.full_name || 'Sistema',
          created_at: entry.created_at
        }))
      
      // Filter by department if selected
      const departmentFilteredEntries = selectedDepartment !== 'all' 
        ? processedEntries.filter(entry => entry.department.name === selectedDepartment)
        : processedEntries
      
      // Filter by item if selected
      const itemFilteredEntries = selectedItem !== 'all'
        ? departmentFilteredEntries.filter(entry => entry.item.id === selectedItem)
        : departmentFilteredEntries
      
      // Process consumption data by date
      const consumptionByDate: Record<string, { quantity: number, value: number }> = {}
      const itemConsumption: Record<string, { id: string, name: string, quantity: number, value: number }> = {}
      const departmentConsumption: Record<string, { quantity: number, value: number }> = {}
      
      itemFilteredEntries.forEach(entry => {
        if (!entry || !entry.item || !entry.department) {
          console.warn('Invalid entry data:', entry)
          return
        }
        
        const date = entry.date
        const itemPrice = typeof entry.item.price === 'number' ? entry.item.price : 0
        const value = itemPrice * entry.quantity
        
        // Add to consumption by date
        if (!consumptionByDate[date]) {
          consumptionByDate[date] = { quantity: 0, value: 0 }
        }
        consumptionByDate[date].quantity += entry.quantity
        consumptionByDate[date].value += value
        
        // Add to item consumption
        if (!itemConsumption[entry.item.id]) {
          itemConsumption[entry.item.id] = {
            id: entry.item.id,
            name: entry.item.name,
            quantity: 0,
            value: 0
          }
        }
        itemConsumption[entry.item.id].quantity += entry.quantity
        itemConsumption[entry.item.id].value += value
        
        // Add to department consumption
        if (!departmentConsumption[entry.department.name]) {
          departmentConsumption[entry.department.name] = { quantity: 0, value: 0 }
        }
        departmentConsumption[entry.department.name].quantity += entry.quantity
        departmentConsumption[entry.department.name].value += value
      })
      
      // Convert to array format for charts
      const consumptionArray = Object.entries(consumptionByDate).map(([date, data]) => ({
        date,
        quantity: Math.round(data.quantity * 100) / 100,
        value: Math.round(data.value * 100) / 100
      })).sort((a, b) => a.date.localeCompare(b.date))
      
      setConsumptionData(consumptionArray)
      
      // Calculate statistics
      if (consumptionArray.length > 0) {
        const totalQuantity = consumptionArray.reduce((sum, item) => sum + item.quantity, 0)
        const totalValue = consumptionArray.reduce((sum, item) => sum + item.value, 0)
        const averageQuantity = totalQuantity / consumptionArray.length
        const averageValue = totalValue / consumptionArray.length
        
        // Find max consumption day
        const maxConsumptionItem = consumptionArray.reduce((max, item) => 
          item.quantity > max.quantity ? item : max, 
          consumptionArray[0]
        )
        
        // Sort items by consumption
        const topItems = Object.values(itemConsumption)
          .sort((a, b) => b.quantity - a.quantity)
          .slice(0, settings.topItemsCount)
        
        // Process department breakdown
        const departmentStats = Object.entries(departmentConsumption).map(([department, data]) => ({
          department,
          quantity: Math.round(data.quantity * 100) / 100,
          value: Math.round(data.value * 100) / 100,
          percentage: totalQuantity > 0 ? (data.quantity / totalQuantity) * 100 : 0
        })).sort((a, b) => b.quantity - a.quantity)
        
        setStats({
          totalQuantity: Math.round(totalQuantity * 100) / 100,
          totalValue: Math.round(totalValue * 100) / 100,
          averageQuantity: Math.round(averageQuantity * 100) / 100,
          averageValue: Math.round(averageValue * 100) / 100,
          maxQuantity: Math.round(maxConsumptionItem.quantity * 100) / 100,
          maxDate: maxConsumptionItem.date,
          items: topItems,
          byDepartment: departmentStats
        })
      } else {
        // Set empty stats if no data
        setStats({
          totalQuantity: 0,
          totalValue: 0,
          averageQuantity: 0,
          averageValue: 0,
          maxQuantity: 0,
          maxDate: format(new Date(), 'yyyy-MM-dd'),
          items: [],
          byDepartment: []
        })
      }
    } catch (error) {
      console.error('Error loading consumption from database:', error)
      setError('Erro ao carregar dados de consumo. Verifique se há registros no banco.')
      // Set empty data on error
      setConsumptionData([])
      setStats({
        totalQuantity: 0,
        totalValue: 0,
        averageQuantity: 0,
        averageValue: 0,
        maxQuantity: 0,
        maxDate: format(new Date(), 'yyyy-MM-dd'),
        items: [],
        byDepartment: []
      })
    }
  }

  const handleCustomDateChange = () => {
    try {
      const start = new Date(customDateRange.start)
      const end = new Date(customDateRange.end)
      
      if (isNaN(start.getTime()) || isNaN(end.getTime())) {
        throw new Error('Data inválida')
      }
      
      if (start > end) {
        throw new Error('Data inicial deve ser anterior à data final')
      }
      
      setDateRange({ start, end })
      // Use a string literal instead of 'custom'
      setPeriod(period)
    } catch (error) {
      console.error('Error setting custom date range:', error)
      setError('Erro ao definir período personalizado. Verifique as datas.')
    }
  }

  const handleExport = () => {
    try {
      // Create CSV content
      const headers = ['Data', 'Quantidade', 'Valor (R$)']
      const rows = consumptionData.map(item => [
        item.date,
        item.quantity.toString(),
        item.value.toFixed(2)
      ])
      
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

  const saveSettings = () => {
    // In a real app, you would save these settings to a database
    // For now, we'll just update the local state
    setSettingsSaved(true)
    setTimeout(() => setSettingsSaved(false), 3000)
    setShowSettingsDialog(false)
  }

  // Filter items for the item selector
  const filteredItems = items.filter(item => 
    !itemSearchTerm || 
    item.name.toLowerCase().includes(itemSearchTerm.toLowerCase()) ||
    item.code?.toLowerCase().includes(itemSearchTerm.toLowerCase())
  )

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <Loader2 className="w-8 h-8 text-primary-500 animate-spin mx-auto mb-4" />
          <p className="text-gray-500">Carregando dados de consumo...</p>
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
              <h1 className="text-2xl font-bold text-gray-900">Estatísticas de Consumo - Farmácia</h1>
              <p className="text-sm text-gray-500 mt-1">
                Análise detalhada do consumo de medicamentos e materiais hospitalares
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button 
              variant="outline" 
              size="sm"
              onClick={() => setShowDepartmentFilter(!showDepartmentFilter)}
            >
              <Building2 className="w-4 h-4 mr-2" />
              Filtrar por Setor
            </Button>
            <Button 
              variant="outline" 
              size="sm"
              onClick={() => setShowItemFilter(!showItemFilter)}
            >
              <Pill className="w-4 h-4 mr-2" />
              Filtrar por Item
            </Button>
            <Button 
              variant="outline" 
              size="sm"
              onClick={handleExport}
            >
              <Download className="w-4 h-4 mr-2" />
              Exportar
            </Button>
            {isAdmin && (
              <Button 
                variant="outline" 
                size="sm"
                onClick={() => setShowSettingsDialog(true)}
              >
                <Settings className="w-4 h-4 mr-2" />
                Configurações
              </Button>
            )}
          </div>
        </div>

        {/* Department Filter */}
        {showDepartmentFilter && (
          <div className="mb-6 p-4 bg-gray-50 rounded-lg border border-gray-200">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-medium text-gray-700">Filtrar por Setor:</h3>
              <Button 
                variant="ghost" 
                size="sm" 
                onClick={() => setShowDepartmentFilter(false)}
                className="h-8 px-2 text-gray-500"
              >
                <X className="w-4 h-4" />
              </Button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
              <Button 
                variant={selectedDepartment === 'all' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setSelectedDepartment('all')}
                className="justify-start"
              >
                Todos os Setores
              </Button>
              {departments.map(dept => (
                <Button 
                  key={dept.id}
                  variant={selectedDepartment === dept.name ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setSelectedDepartment(dept.name)}
                  className="justify-start"
                >
                  {dept.name}
                </Button>
              ))}
            </div>
          </div>
        )}

        {/* Item Filter */}
        {showItemFilter && (
          <div className="mb-6 p-4 bg-gray-50 rounded-lg border border-gray-200">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-medium text-gray-700">Filtrar por Item:</h3>
              <Button 
                variant="ghost" 
                size="sm" 
                onClick={() => setShowItemFilter(false)}
                className="h-8 px-2 text-gray-500"
              >
                <X className="w-4 h-4" />
              </Button>
            </div>
            
            <div className="mb-3">
              <div className="relative">
                <Search className="w-4 h-4 absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" />
                <Input
                  placeholder="Buscar por nome ou código..."
                  className="pl-9"
                  value={itemSearchTerm}
                  onChange={(e) => setItemSearchTerm(e.target.value)}
                />
              </div>
            </div>
            
            <div className="grid grid-cols-1 gap-2 max-h-60 overflow-y-auto">
              <Button 
                variant={selectedItem === 'all' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setSelectedItem('all')}
                className="justify-start"
              >
                Todos os Itens
              </Button>
              {filteredItems.map(item => (
                <Button 
                  key={item.id}
                  variant={selectedItem === item.id ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setSelectedItem(item.id)}
                  className="justify-start text-left"
                >
                  <div className="flex flex-col items-start">
                    <span>{item.name}</span>
                    <span className="text-xs text-gray-500">{item.code} - {item.category}</span>
                  </div>
                </Button>
              ))}
              {filteredItems.length === 0 && itemSearchTerm && (
                <div className="text-center p-2 text-gray-500">
                  Nenhum item encontrado
                </div>
              )}
            </div>
          </div>
        )}

        {/* Period Selection */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          <div className="md:col-span-3 grid grid-cols-3 gap-4">
            <Button 
              variant={period === 'daily' ? 'default' : 'outline'}
              onClick={() => setPeriod('daily')}
              className="flex items-center gap-2"
            >
              <Clock className="w-4 h-4" />
              Diário
            </Button>
            <Button 
              variant={period === 'weekly' ? 'default' : 'outline'}
              onClick={() => setPeriod('weekly')}
              className="flex items-center gap-2"
            >
              <CalendarDays className="w-4 h-4" />
              Semanal
            </Button>
            <Button 
              variant={period === 'monthly' ? 'default' : 'outline'}
              onClick={() => setPeriod('monthly')}
              className="flex items-center gap-2"
            >
              <Calendar className="w-4 h-4" />
              Mensal
            </Button>
          </div>
          <div className="md:col-span-1">
            <Button 
              variant="outline" 
              className="w-full"
              onClick={() => loadItems()}
            >
              <ArrowUpDown className="w-4 h-4 mr-2" />
              Atualizar Dados
            </Button>
          </div>
        </div>

        {/* Custom Date Range */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <div>
            <Label htmlFor="start-date">Data Inicial</Label>
            <Input
              id="start-date"
              type="date"
              value={customDateRange.start}
              onChange={(e) => setCustomDateRange({...customDateRange, start: e.target.value})}
              className="mt-1"
            />
          </div>
          <div>
            <Label htmlFor="end-date">Data Final</Label>
            <Input
              id="end-date"
              type="date"
              value={customDateRange.end}
              onChange={(e) => setCustomDateRange({...customDateRange, end: e.target.value})}
              className="mt-1"
            />
          </div>
          <div className="flex items-end">
            <Button 
              onClick={handleCustomDateChange}
              className="w-full"
            >
              Aplicar Período Personalizado
            </Button>
          </div>
        </div>

        {/* Current Period and Department/Item Display */}
        <div className="bg-blue-50 p-4 rounded-lg border border-blue-100">
          <div className="flex flex-col sm:flex-row sm:items-center gap-2 text-blue-700">
            <div className="flex items-center gap-2">
              <CalendarClock className="w-5 h-5" />
              <span className="font-medium">
                Período: {format(dateRange.start, "dd 'de' MMMM", { locale: ptBR })} até {format(dateRange.end, "dd 'de' MMMM 'de' yyyy", { locale: ptBR })}
              </span>
            </div>
            {selectedDepartment !== 'all' && (
              <div className="flex items-center gap-2 sm:ml-4 sm:pl-4 sm:border-l border-blue-200">
                <Building2 className="w-5 h-5" />
                <span className="font-medium">
                  Setor: {selectedDepartment}
                </span>
              </div>
            )}
            {selectedItem !== 'all' && (
              <div className="flex items-center gap-2 sm:ml-4 sm:pl-4 sm:border-l border-blue-200">
                <Pill className="w-5 h-5" />
                <span className="font-medium">
                  Item: {items.find(i => i.id === selectedItem)?.name}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Error Message */}
        {error && (
          <div className="mt-4 p-4 bg-red-50 rounded-lg border border-red-200">
            <div className="flex items-center gap-2 text-red-700">
              <AlertTriangle className="w-5 h-5" />
              <p>{error}</p>
            </div>
          </div>
        )}

        {/* Success Message for Settings */}
        {settingsSaved && (
          <div className="mt-4 p-4 bg-green-50 rounded-lg border border-green-200">
            <div className="flex items-center gap-2 text-green-700">
              <CheckCircle2 className="w-5 h-5" />
              <p>Configurações salvas com sucesso!</p>
            </div>
          </div>
        )}
      </div>

      {/* Statistics Overview */}
      {stats && (
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Visão Geral do Consumo</h2>
          
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-blue-50 p-4 rounded-lg border border-blue-100">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-blue-100 rounded-lg">
                  <Pill className="w-5 h-5 text-blue-600" />
                </div>
                <div>
                  <p className="text-sm text-blue-700">Consumo Total</p>
                  <p className="text-xl font-semibold text-blue-900">{stats.totalQuantity} itens</p>
                </div>
              </div>
            </div>
            
            <div className="bg-green-50 p-4 rounded-lg border border-green-100">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-green-100 rounded-lg">
                  <TrendingUp className="w-5 h-5 text-green-600" />
                </div>
                <div>
                  <p className="text-sm text-green-700">Consumo Médio</p>
                  <p className="text-xl font-semibold text-green-900">{stats.averageQuantity} itens/dia</p>
                </div>
              </div>
            </div>
            
            {settings.showValueData && (
              <>
                <div className="bg-purple-50 p-4 rounded-lg border border-purple-100">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-purple-100 rounded-lg">
                      <BarChart3 className="w-5 h-5 text-purple-600" />
                    </div>
                    <div>
                      <p className="text-sm text-purple-700">Valor Total</p>
                      <p className="text-xl font-semibold text-purple-900">
                        R$ {stats.totalValue.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </p>
                    </div>
                  </div>
                </div>
                
                <div className="bg-amber-50 p-4 rounded-lg border border-amber-100">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-amber-100 rounded-lg">
                      <Calendar className="w-5 h-5 text-amber-600" />
                    </div>
                    <div>
                      <p className="text-sm text-amber-700">Valor Médio</p>
                      <p className="text-xl font-semibold text-amber-900">
                        R$ {stats.averageValue.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}/dia
                      </p>
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
          
          <div className="mt-4 p-4 bg-gray-50 rounded-lg border border-gray-200">
            <p className="text-sm text-gray-700">
              <span className="font-medium">Dia de maior consumo:</span> {format(new Date(stats.maxDate), "dd 'de' MMMM 'de' yyyy", { locale: ptBR })} com {stats.maxQuantity} itens
            </p>
          </div>
        </div>
      )}

      {/* Consumption Chart */}
      <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Gráfico de Consumo</h2>
        
        <div className="h-80 bg-gray-50 p-4 rounded-lg border border-gray-200">
          <ConsumptionLineChart 
            data={consumptionData} 
            showValue={settings.showValueData}
            period={period}
          />
        </div>
      </div>

      {/* Department Breakdown */}
      {stats && stats.byDepartment && stats.byDepartment.length > 0 && settings.showDepartmentBreakdown && (
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Consumo por Setor</h2>
          
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">Setor</th>
                  <th className="px-4 py-3 text-right text-sm font-medium text-gray-600">Quantidade</th>
                  {settings.showValueData && (
                    <th className="px-4 py-3 text-right text-sm font-medium text-gray-600">Valor (R$)</th>
                  )}
                  <th className="px-4 py-3 text-right text-sm font-medium text-gray-600">% do Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {stats.byDepartment.map((dept) => (
                  <tr key={dept.department} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-sm font-medium text-gray-900">{dept.department}</td>
                    <td className="px-4 py-3 text-sm text-right text-gray-600">
                      {Math.round(dept.quantity * 100) / 100}
                    </td>
                    {settings.showValueData && (
                      <td className="px-4 py-3 text-sm text-right text-gray-600">
                        {dept.value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits:  2 })}
                      </td>
                    )}
                    <td className="px-4 py-3 text-sm text-right text-gray-600">
                      {dept.percentage.toFixed(1)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          
          <div className="mt-4 h-60 bg-gray-50 p-4 rounded-lg border border-gray-200">
            <DepartmentPieChart 
              data={stats.byDepartment} 
              showValue={settings.showValueData}
            />
          </div>
        </div>
      )}

      {/* Top Consumed Items */}
      {stats && stats.items.length > 0 && (
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Itens Mais Consumidos</h2>
          
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">Item</th>
                  <th className="px-4 py-3 text-right text-sm font-medium text-gray-600">Quantidade</th>
                  {settings.showValueData && (
                    <th className="px-4 py-3 text-right text-sm font-medium text-gray-600">Valor (R$)</th>
                  )}
                  <th className="px-4 py-3 text-right text-sm font-medium text-gray-600">% do Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {stats.items.map((item) => (
                  <tr key={item.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-sm font-medium text-gray-900">{item.name}</td>
                    <td className="px-4 py-3 text-sm text-right text-gray-600">
                      {Math.round(item.quantity * 100) / 100}
                    </td>
                    {settings.showValueData && (
                      <td className="px-4 py-3 text-sm text-right text-gray-600">
                        {item.value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </td>
                    )}
                    <td className="px-4 py-3 text-sm text-right text-gray-600">
                      {((item.quantity / stats.totalQuantity) * 100).toFixed(1)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Settings Dialog */}
      <Dialog open={showSettingsDialog} onOpenChange={setShowSettingsDialog}>
        <DialogContent className="sm:max-w-[600px]">
          <DialogHeader>
            <DialogTitle>Configurações do Relatório</DialogTitle>
          </DialogHeader>
          
          <div className="space-y-6 py-4">
            <div className="space-y-4">
              <h3 className="text-sm font-medium text-gray-900">Atualização de Dados</h3>
              
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label htmlFor="auto-refresh">Atualização Automática</Label>
                  <p className="text-xs text-gray-500">
                    Atualiza os dados automaticamente no intervalo especificado
                  </p>
                </div>
                <Switch 
                  id="auto-refresh"
                  checked={settings.autoRefresh}
                  onCheckedChange={(checked) => setSettings({...settings, autoRefresh: checked})}
                />
              </div>
              
              {settings.autoRefresh && (
                <div>
                  <Label htmlFor="refresh-interval">Intervalo de Atualização (minutos)</Label>
                  <Input
                    id="refresh-interval"
                    type="number"
                    min="1"
                    max="60"
                    value={settings.refreshInterval}
                    onChange={(e) => setSettings({...settings, refreshInterval: parseInt(e.target.value) || 30})}
                    className="mt-1"
                  />
                </div>
              )}
            </div>
            
            <div className="space-y-4">
              <h3 className="text-sm font-medium text-gray-900">Exibição de Dados</h3>
              
              <div>
                <Label htmlFor="default-period">Período Padrão</Label>
                <select
                  id="default-period"
                  value={settings.defaultPeriod}
                  onChange={(e) => setSettings({...settings, defaultPeriod: e.target.value as 'daily' | 'weekly' | 'monthly'})}
                  className="w-full mt-1 h-9 rounded-md border border-input px-3 py-1"
                >
                  <option value="daily">Diário</option>
                  <option value="weekly">Semanal</option>
                  <option value="monthly">Mensal</option>
                </select>
              </div>
              
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label htmlFor="show-value">Exibir Dados de Valor</Label>
                  <p className="text-xs text-gray-500">
                    Mostra informações de valor monetário nos relatórios
                  </p>
                </div>
                <Switch 
                  id="show-value"
                  checked={settings.showValueData}
                  onCheckedChange={(checked) => setSettings({...settings, showValueData: checked})}
                />
              </div>
              
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label htmlFor="show-departments">Exibir Análise por Setor</Label>
                  <p className="text-xs text-gray-500">
                    Mostra o consumo dividido por setores
                  </p>
                </div>
                <Switch 
                  id="show-departments"
                  checked={settings.showDepartmentBreakdown}
                  onCheckedChange={(checked) => setSettings({...settings, showDepartmentBreakdown: checked})}
                />
              </div>
              
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label htmlFor="low-stock-warnings">Alertas de Estoque Baixo</Label>
                  <p className="text-xs text-gray-500">
                    Inclui alertas para itens com estoque abaixo do mínimo
                  </p>
                </div>
                <Switch 
                  id="low-stock-warnings"
                  checked={settings.includeLowStockWarnings}
                  onCheckedChange={(checked) => setSettings({...settings, includeLowStockWarnings: checked})}
                />
              </div>
              
              <div>
                <Label htmlFor="top-items">Número de Itens Mais Consumidos</Label>
                <Input
                  id="top-items"
                  type="number"
                  min="5"
                  max="50"
                  value={settings.topItemsCount}
                  onChange={(e) => setSettings({...settings, topItemsCount: parseInt(e.target.value) || 10})}
                  className="mt-1"
                />
              </div>
            </div>
            
            <div className="space-y-4">
              <h3 className="text-sm font-medium text-gray-900">Categorias</h3>
              
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="category-medicamentos"
                    checked={settings.categories.includes('Medicamentos')}
                    onChange={(e) => {
                      const newCategories = e.target.checked
                        ? [...settings.categories, 'Medicamentos']
                        : settings.categories.filter(c => c !== 'Medicamentos')
                      setSettings({...settings, categories: newCategories})
                    }}
                    className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                  />
                  <Label htmlFor="category-medicamentos">Medicamentos</Label>
                </div>
                
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="category-material"
                    checked={settings.categories.includes('Material Hospitalar')}
                    onChange={(e) => {
                      const newCategories = e.target.checked
                        ? [...settings.categories, 'Material Hospitalar']
                        : settings.categories.filter(c => c !== 'Material Hospitalar')
                      setSettings({...settings, categories: newCategories})
                    }}
                    className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                  />
                  <Label htmlFor="category-material">Material Hospitalar</Label>
                </div>
              </div>
            </div>
          </div>
          
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowSettingsDialog(false)}>
              Cancelar
            </Button>
            <Button onClick={saveSettings}>
              <Save className="w-4 h-4 mr-2" />
              Salvar Configurações
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}