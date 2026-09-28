import { useState, useEffect, useRef } from 'react'
import { 
  Calendar, 
  BarChart3, 
  Download, 
  Settings, 
  Package2, 
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
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { format, startOfWeek, endOfWeek, startOfMonth, endOfMonth } from 'date-fns'
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
import { buscarTodas, dataBR, hojeLocal, normalizarBusca, parseDataLocal } from '@/lib/utils/seguro'

const SEM_CATEGORIA = 'Sem categoria'

// Linha crua de v_warehouse_consumption
interface LinhaView {
  source_id: string
  item_id: string
  quantity: number
  department_id: string | null
  consumption_date: string
  origem: string
  lote: string | null
  validade: string | null
  destino_texto: string | null
}

interface ItemConsumo {
  id: string
  name: string
  code: string | null
  unit: string | null
  category: string | null
  price: number | null
  last_purchase_price: number | null
}

// Linha resolvida (item/setor/valor) exatamente como entra na tela
interface LinhaConsumo {
  date: string
  itemId: string
  itemName: string
  code: string
  unit: string
  category: string
  department: string
  origem: string
  lote: string | null
  validade: string | null
  quantity: number
  value: number
}

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
  byCategory?: {
    category: string;
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
  showCategoryBreakdown: boolean;
}

export function WarehouseConsumptionReport() {
  const { user } = useAuth()
  const isAdmin = user?.role === 'administrador'
  const [items, setItems] = useState<Item[]>([])
  const [departments, setDepartments] = useState<Department[]>([])
  const [loading, setLoading] = useState(true)
  const [carregandoConsumo, setCarregandoConsumo] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [period, setPeriod] = useState<'daily' | 'weekly' | 'monthly'>('daily')
  const [dateRange, setDateRange] = useState<{start: Date, end: Date}>({
    start: new Date(),
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
    // Categorias EXCLUIDAS do relatorio (vazio = todas). Antes era uma lista
    // fixa de categorias incluidas: item sem categoria (11 no cadastro) ou com
    // categoria nova sumia do relatorio sem aviso. As opcoes do dialogo vem
    // das categorias reais (DISTINCT) dos itens.
    categories: [],
    showDepartmentBreakdown: true,
    showCategoryBreakdown: true
  })
  const [customDateRange, setCustomDateRange] = useState<{start: string, end: string}>({
    start: hojeLocal(dateRange.start),
    end: hojeLocal(dateRange.end)
  })
  const [settingsSaved, setSettingsSaved] = useState(false)
  const [selectedDepartment, setSelectedDepartment] = useState<string>('all')
  const [showDepartmentFilter, setShowDepartmentFilter] = useState(false)
  const [activeTab, setActiveTab] = useState<'overview' | 'byDepartment' | 'byCategory'>('overview')
  const [selectedItem, setSelectedItem] = useState<string>('all')
  const [showItemFilter, setShowItemFilter] = useState(false)
  const [itemSearchTerm, setItemSearchTerm] = useState('')

  // Linhas de consumo ja resolvidas (item, setor, valor) e FILTRADAS como
  // estao na tela — a exportacao detalhada usa exatamente estas linhas.
  const [linhasTela, setLinhasTela] = useState<LinhaConsumo[]>([])
  const [categoriasDisponiveis, setCategoriasDisponiveis] = useState<string[]>([])
  const [recarregar, setRecarregar] = useState(0)
  const consultaAtual = useRef(0)

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
        // "Diario" = so hoje (antes subDays(1): cobria ontem + hoje)
        start = today
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
        start = today
    }

    setDateRange({ start, end })
    setCustomDateRange({
      start: hojeLocal(start),
      end: hojeLocal(end)
    })
  }, [period])

  // Auto-refresh data based on settings
  useEffect(() => {
    let intervalId: number | undefined

    if (settings.autoRefresh && !loading) {
      intervalId = window.setInterval(() => {
        setRecarregar((n) => n + 1)
      }, settings.refreshInterval * 60 * 1000)
    }

    return () => {
      if (intervalId) clearInterval(intervalId)
    }
  }, [settings.autoRefresh, settings.refreshInterval, loading])

  // O consumo NAO depende mais da lista de itens/setores ja carregada: antes
  // ele rodava quando `items` chegava e resolvia o setor com `departments`
  // que podia ainda estar vazio (corrida) -> relatorio zerado. Agora busca
  // item e setor pelos ids que vieram da view, sem filtro de ativo (item
  // inativado continua aparecendo no consumo do periodo em que foi usado).
  useEffect(() => {
    loadConsumptionFromDatabase()
  }, [dateRange, selectedDepartment, selectedItem, settings.categories, recarregar])

  async function loadItems() {
    try {
      setLoading(true)
      setError(null)
      // Lista para o filtro "Filtrar por Item" (so itens ativos do almox).
      const data = await itemsService.getByType('warehouse')
      setItems(data)
      setCategoriasDisponiveis(
        [...new Set(data.map((i) => (i.category as string | null) ?? SEM_CATEGORIA))].sort((a, b) => a.localeCompare(b))
      )
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

  const statsVazias = (): ConsumptionStats => ({
    totalQuantity: 0,
    totalValue: 0,
    averageQuantity: 0,
    averageValue: 0,
    maxQuantity: 0,
    maxDate: hojeLocal(),
    items: [],
    byDepartment: [],
    byCategory: []
  })

  async function loadConsumptionFromDatabase() {
    const minhaConsulta = ++consultaAtual.current
    try {
      setError(null)
      setCarregandoConsumo(true)

      // v_warehouse_consumption une as fontes reais de saida do almoxarifado:
      // solicitacao entregue, saida avulsa (stock_movements), saida direta
      // concluida (warehouse_dispatches) e lancamento manual. Paginado: o
      // PostgREST corta em 1000 linhas em silencio (setembro ja passa de 2 mil).
      const inicio = hojeLocal(dateRange.start)
      const fim = hojeLocal(dateRange.end)
      const rows = await buscarTodas<LinhaView>((de, ate) =>
        supabase
          .from('v_warehouse_consumption')
          .select('source_id, item_id, quantity, department_id, consumption_date, origem, lote, validade, destino_texto')
          .gte('consumption_date', inicio)
          .lte('consumption_date', fim)
          .order('consumption_date', { ascending: true })
          .order('source_id', { ascending: true })
          .range(de, ate) as unknown as PromiseLike<{ data: LinhaView[] | null; error: unknown }>
      )

      // Item e setor pelos ids da propria view (sem filtro de ativo).
      const itemIds = [...new Set(rows.map((r) => r.item_id).filter(Boolean))]
      const depIds = [...new Set(rows.map((r) => r.department_id).filter(Boolean))] as string[]
      const itemById = new Map<string, ItemConsumo>()
      for (let i = 0; i < itemIds.length; i += 300) {
        const { data, error: eItens } = await supabase
          .from('warehouse_items')
          .select('id, name, code, unit, category, price, last_purchase_price')
          .in('id', itemIds.slice(i, i + 300))
        if (eItens) throw eItens
        for (const it of (data || []) as ItemConsumo[]) itemById.set(it.id, it)
      }
      const deptById = new Map<string, string>()
      for (let i = 0; i < depIds.length; i += 300) {
        const { data, error: eSetores } = await supabase
          .from('departments')
          .select('id, name')
          .in('id', depIds.slice(i, i + 300))
        if (eSetores) throw eSetores
        for (const d of (data || []) as Array<{ id: string; name: string }>) deptById.set(d.id, d.name)
      }

      if (minhaConsulta !== consultaAtual.current) return // resposta velha

      const excluidas = new Set(settings.categories)
      const linhas: LinhaConsumo[] = rows
        .map((row) => {
          const item = itemById.get(row.item_id)
          const setor = (row.department_id && deptById.get(row.department_id))
            || (row.origem === 'saida_direta' && row.destino_texto ? `Saída direta: ${row.destino_texto}` : null)
            || row.destino_texto
            || 'Sem setor'
          const categoria = item?.category ?? SEM_CATEGORIA
          // Preco: price esta vazio em ~metade do cadastro -> ultimo preco de compra.
          const preco = Number(item?.price ?? item?.last_purchase_price ?? 0) || 0
          const quantidade = Number(row.quantity) || 0
          return {
            date: row.consumption_date,
            itemId: row.item_id,
            itemName: item?.name ?? '(item não encontrado)',
            code: item?.code ?? '',
            unit: item?.unit ?? '',
            category: categoria,
            department: setor,
            origem: row.origem,
            lote: row.lote,
            validade: row.validade,
            quantity: quantidade,
            value: preco * quantidade,
          }
        })
        .filter((l) => !excluidas.has(l.category))
        .filter((l) => selectedDepartment === 'all' || l.department === selectedDepartment)
        .filter((l) => selectedItem === 'all' || l.itemId === selectedItem)

      setLinhasTela(linhas)

      // Initialize data structure
      const consumptionByDate: Record<string, { quantity: number, value: number }> = {}
      const itemConsumption: Record<string, { id: string, name: string, quantity: number, value: number }> = {}
      const departmentConsumption: Record<string, { quantity: number, value: number }> = {}
      const categoryConsumption: Record<string, { quantity: number, value: number }> = {}

      linhas.forEach(entry => {
        const date = entry.date
        const value = entry.value

        if (!consumptionByDate[date]) {
          consumptionByDate[date] = { quantity: 0, value: 0 }
        }
        consumptionByDate[date].quantity += entry.quantity
        consumptionByDate[date].value += value

        if (!itemConsumption[entry.itemId]) {
          itemConsumption[entry.itemId] = {
            id: entry.itemId,
            name: entry.itemName,
            quantity: 0,
            value: 0
          }
        }
        itemConsumption[entry.itemId].quantity += entry.quantity
        itemConsumption[entry.itemId].value += value

        if (!departmentConsumption[entry.department]) {
          departmentConsumption[entry.department] = { quantity: 0, value: 0 }
        }
        departmentConsumption[entry.department].quantity += entry.quantity
        departmentConsumption[entry.department].value += value

        if (!categoryConsumption[entry.category]) {
          categoryConsumption[entry.category] = { quantity: 0, value: 0 }
        }
        categoryConsumption[entry.category].quantity += entry.quantity
        categoryConsumption[entry.category].value += value
      })

      // Convert to array format for charts
      const consumptionArray = Object.entries(consumptionByDate).map(([date, data]) => ({
        date,
        quantity: Math.round(data.quantity * 100) / 100, // Round to 2 decimal places
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

        // Process category breakdown
        const categoryStats = Object.entries(categoryConsumption).map(([category, data]) => ({
          category,
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
          byDepartment: departmentStats,
          byCategory: categoryStats
        })
      } else {
        setStats(statsVazias())
      }
    } catch (error) {
      if (minhaConsulta !== consultaAtual.current) return
      console.error('Error processing consumption data:', error)
      // Erro nao vira relatorio zerado: limpa e mostra a faixa com "Tentar de novo".
      setError('Erro ao carregar dados de consumo do banco.')
      setConsumptionData([])
      setLinhasTela([])
      setStats(null)
    } finally {
      if (minhaConsulta === consultaAtual.current) setCarregandoConsumo(false)
    }
  }

  const handleCustomDateChange = () => {
    // parseDataLocal: new Date('YYYY-MM-DD') e meia-noite UTC = dia anterior
    // aqui (UTC-3) — o periodo personalizado andava 1 dia para tras.
    const start = parseDataLocal(customDateRange.start)
    const end = parseDataLocal(customDateRange.end)

    if (!start || !end) {
      setError('Data inválida. Verifique as datas do período personalizado.')
      return
    }
    if (start > end) {
      setError('A data inicial deve ser anterior à data final.')
      return
    }
    setError(null)
    setDateRange({ start, end })
  }

  // Exportacao DETALHADA: uma linha por saida, com item, setor, lote e
  // validade (pedido de 22/09/2026). Usa exatamente as linhas da tela (mesmo
  // periodo, setor, item e categorias), todas, sem corte de 1000.
  const handleExportDetalhado = () => {
    try {
      const origemLabel: Record<string, string> = { solicitacao: 'Solicitação', avulsa: 'Saída avulsa', manual: 'Lançamento manual', saida_direta: 'Saída direta' }
      const cel = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
      const cab = ['Data', 'Código', 'Item', 'Unidade', 'Categoria', 'Quantidade', 'Valor (R$)', 'Setor/Destino', 'Origem', 'Lote', 'Validade']
      const corpo = linhasTela.map((r) =>
        [dataBR(r.date), r.code, r.itemName, r.unit, r.category, r.quantity,
          r.value.toFixed(2).replace('.', ','), r.department, origemLabel[r.origem] ?? r.origem,
          r.lote ?? '', r.validade ? dataBR(r.validade) : ''].map(cel).join(';')
      )
      // ';' e BOM: e o que o Excel em portugues abre direto, com acento certo.
      const csv = String.fromCharCode(0xfeff) + [cab.map(cel).join(';'), ...corpo].join('\n')
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
      const link = document.createElement('a')
      link.href = URL.createObjectURL(blob)
      link.download = `consumo_almoxarifado_detalhado_${format(dateRange.start, 'dd-MM-yyyy')}_a_${format(dateRange.end, 'dd-MM-yyyy')}.csv`
      document.body.appendChild(link); link.click(); document.body.removeChild(link)
    } catch (error) {
      console.error('Error exporting detailed data:', error)
      setError('Erro ao exportar o detalhado.')
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
      link.setAttribute('download', `consumo_almoxarifado_${format(new Date(), 'dd-MM-yyyy')}.csv`)
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
  const termoItem = normalizarBusca(itemSearchTerm)
  const filteredItems = items.filter(item =>
    !termoItem ||
    normalizarBusca(item.name).includes(termoItem) ||
    normalizarBusca(item.code).includes(termoItem)
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
            <div className="p-3 bg-purple-100 rounded-lg">
              <BarChart3 className="w-6 h-6 text-purple-600" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Estatísticas de Consumo - Almoxarifado</h1>
              <p className="text-sm text-gray-500 mt-1">
                Análise detalhada do consumo de materiais e equipamentos
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
              <Package2 className="w-4 h-4 mr-2" />
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
            <Button
              variant="outline"
              size="sm"
              onClick={handleExportDetalhado}
              disabled={carregandoConsumo || linhasTela.length === 0}
              title="Uma linha por saída, com item, setor, lote e validade"
            >
              <Download className="w-4 h-4 mr-2" />
              Exportar detalhado (lote/validade)
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
              onClick={() => { loadItems(); setRecarregar((n) => n + 1) }}
              disabled={carregandoConsumo}
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
        <div className="bg-purple-50 p-4 rounded-lg border border-purple-100">
          <div className="flex flex-col sm:flex-row sm:items-center gap-2 text-purple-700">
            <div className="flex items-center gap-2">
              <CalendarClock className="w-5 h-5" />
              <span className="font-medium">
                Período: {format(dateRange.start, "dd 'de' MMMM", { locale: ptBR })} até {format(dateRange.end, "dd 'de' MMMM 'de' yyyy", { locale: ptBR })}
              </span>
            </div>
            {selectedDepartment !== 'all' && (
              <div className="flex items-center gap-2 sm:ml-4 sm:pl-4 sm:border-l border-purple-200">
                <Building2 className="w-5 h-5" />
                <span className="font-medium">
                  Setor: {selectedDepartment}
                </span>
              </div>
            )}
            {selectedItem !== 'all' && (
              <div className="flex items-center gap-2 sm:ml-4 sm:pl-4 sm:border-l border-purple-200">
                <Package2 className="w-5 h-5" />
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
              <p className="flex-1">{error}</p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => { loadItems(); loadDepartments(); setRecarregar((n) => n + 1) }}
              >
                Tentar de novo
              </Button>
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

      {/* Tabs for different views */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100">
        <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as typeof activeTab)}>
          <div className="p-6 border-b border-gray-100">
            <TabsList className="grid grid-cols-3 gap-4">
              <TabsTrigger value="overview" className="flex items-center gap-2">
                <BarChart3 className="w-4 h-4" />
                Visão Geral
              </TabsTrigger>
              <TabsTrigger value="byDepartment" className="flex items-center gap-2">
                <Building2 className="w-4 h-4" />
                Por Setor
              </TabsTrigger>
              <TabsTrigger value="byCategory" className="flex items-center gap-2">
                <Package2 className="w-4 h-4" />
                Por Categoria
              </TabsTrigger>
            </TabsList>
          </div>

          {/* Overview Tab */}
          <TabsContent value="overview" className="p-6">
            {stats && (
              <div className="space-y-6">
                {/* Statistics Overview */}
                <div>
                  <h2 className="text-lg font-semibold text-gray-900 mb-4">Visão Geral do Consumo</h2>
                  
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div className="bg-purple-50 p-4 rounded-lg border border-purple-100">
                      <div className="flex items-center gap-3">
                        <div className="p-2 bg-purple-100 rounded-lg">
                          <Package2 className="w-5 h-5 text-purple-600" />
                        </div>
                        <div>
                          <p className="text-sm text-purple-700">Consumo Total</p>
                          <p className="text-xl font-semibold text-purple-900">{stats.totalQuantity} itens</p>
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
                        <div className="bg-blue-50 p-4 rounded-lg border border-blue-100">
                          <div className="flex items-center gap-3">
                            <div className="p-2 bg-blue-100 rounded-lg">
                              <BarChart3 className="w-5 h-5 text-blue-600" />
                            </div>
                            <div>
                              <p className="text-sm text-blue-700">Valor Total</p>
                              <p className="text-xl font-semibold text-blue-900">
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
                      <span className="font-medium">Dia de maior consumo:</span> {format(parseDataLocal(stats.maxDate) ?? new Date(), "dd 'de' MMMM 'de' yyyy", { locale: ptBR })} com {stats.maxQuantity} itens
                    </p>
                  </div>
                </div>

                {/* Consumption Chart */}
                <div>
                  <h2 className="text-lg font-semibold text-gray-900 mb-4">Gráfico de Consumo</h2>
                  
                  <div className="h-80 bg-gray-50 p-4 rounded-lg border border-gray-200">
                    <ConsumptionLineChart 
                      data={consumptionData} 
                      showValue={settings.showValueData}
                      period={period}
                    />
                  </div>
                </div>

                {/* Top Consumed Items */}
                {stats.items.length > 0 && (
                  <div>
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
              </div>
            )}
          </TabsContent>

          {/* By Department Tab */}
          <TabsContent value="byDepartment" className="p-6">
            {stats && stats.byDepartment && stats.byDepartment.length > 0 && settings.showDepartmentBreakdown && (
              <div className="space-y-6">
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
                              {dept.value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
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
          </TabsContent>

          {/* By Category Tab */}
          <TabsContent value="byCategory" className="p-6">
            {stats && stats.byCategory && stats.byCategory.length > 0 && settings.showCategoryBreakdown && (
              <div className="space-y-6">
                <h2 className="text-lg font-semibold text-gray-900 mb-4">Consumo por Categoria</h2>
                
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse">
                    <thead>
                      <tr className="bg-gray-50 border-b border-gray-100">
                        <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">Categoria</th>
                        <th className="px-4 py-3 text-right text-sm font-medium text-gray-600">Quantidade</th>
                        {settings.showValueData && (
                          <th className="px-4 py-3 text-right text-sm font-medium text-gray-600">Valor (R$)</th>
                        )}
                        <th className="px-4 py-3 text-right text-sm font-medium text-gray-600">% do Total</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {stats.byCategory.map((cat) => (
                        <tr key={cat.category} className="hover:bg-gray-50">
                          <td className="px-4 py-3 text-sm font-medium text-gray-900">{cat.category}</td>
                          <td className="px-4 py-3 text-sm text-right text-gray-600">
                            {Math.round(cat.quantity * 100) / 100}
                          </td>
                          {settings.showValueData && (
                            <td className="px-4 py-3 text-sm text-right text-gray-600">
                              {cat.value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </td>
                          )}
                          <td className="px-4 py-3 text-sm text-right text-gray-600">
                            {cat.percentage.toFixed(1)}%
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                
                <div className="mt-4 h-60 bg-gray-50 p-4 rounded-lg border border-gray-200">
                  <DepartmentPieChart 
                    data={stats.byCategory.map(cat => ({
                      department: cat.category,
                      quantity: cat.quantity,
                      value: cat.value,
                      percentage: cat.percentage
                    }))} 
                    showValue={settings.showValueData}
                  />
                </div>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>

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
                  <Label htmlFor="show-categories">Exibir Análise por Categoria</Label>
                  <p className="text-xs text-gray-500">
                    Mostra o consumo dividido por categorias
                  </p>
                </div>
                <Switch 
                  id="show-categories"
                  checked={settings.showCategoryBreakdown}
                  onCheckedChange={(checked) => setSettings({...settings, showCategoryBreakdown: checked})}
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
                {/* Categorias reais do cadastro (DISTINCT). Marcado = entra no relatorio. */}
                {[...categoriasDisponiveis, ...settings.categories.filter(c => !categoriasDisponiveis.includes(c))].map((cat) => (
                  <div key={cat} className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      id={`category-${cat}`}
                      checked={!settings.categories.includes(cat)}
                      onChange={(e) => {
                        const excluidas = e.target.checked
                          ? settings.categories.filter(c => c !== cat)
                          : [...settings.categories, cat]
                        setSettings({...settings, categories: excluidas})
                      }}
                      className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                    />
                    <Label htmlFor={`category-${cat}`}>{cat}</Label>
                  </div>
                ))}
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