import { useState, useEffect, useMemo } from 'react'
import {
  Package2, Pill, Download, Search, AlertTriangle,
  ChevronDown, ChevronUp, Filter
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useTheme } from '@/contexts/theme'
import { supabase } from '@/lib/supabase'
import * as XLSX from 'xlsx'
import { saveAs } from 'file-saver'
import { format } from 'date-fns'

interface StockItem {
  id: string
  code: string
  name: string
  category: string
  unit: string
  current_stock: number
  min_stock: number
  price: number | null
  is_active: boolean
  batch_number?: string | null
  expiry_date?: string | null
}

// Lote com saldo, do MESMO estoque que o relatorio soma (CAF na farmacia,
// almoxarifado central no almox) — senao a soma dos lotes nao bate com o
// "Estoque Atual". Pedido de 22/09/2026: exportar lote e validade.
interface LoteSaldo { lote: string; validade: string | null; qtd: number }

const dataBR = (d: string | null | undefined) => (d ? d.slice(0, 10).split('-').reverse().join('/') : '')
const textoLotes = (ls: LoteSaldo[]) =>
  ls.map((l) => `${l.lote}${l.validade ? ` (${dataBR(l.validade)})` : ''}: ${l.qtd}`).join('; ')
const validadeMaisProxima = (ls: LoteSaldo[]) =>
  ls.map((l) => l.validade).filter(Boolean).sort()[0] ?? null

type SortField = 'name' | 'code' | 'category' | 'current_stock' | 'min_stock' | 'status'
type SortDir = 'asc' | 'desc'
type StockFilter = 'all' | 'normal' | 'low' | 'critical' | 'out'

function getStockStatus(item: StockItem) {
  if (item.current_stock === 0) return { label: 'Sem Estoque', color: '#ef4444', bg: 'rgba(239,68,68,0.12)', key: 'out' }
  if (item.current_stock <= item.min_stock * 0.5) return { label: 'Critico', color: '#f97316', bg: 'rgba(249,115,22,0.12)', key: 'critical' }
  if (item.current_stock <= item.min_stock) return { label: 'Estoque Baixo', color: '#eab308', bg: 'rgba(234,179,8,0.12)', key: 'low' }
  return { label: 'Normal', color: '#22c55e', bg: 'rgba(34,197,94,0.12)', key: 'normal' }
}

interface StockReportProps {
  type: 'pharmacy' | 'warehouse'
}

export function StockReport({ type }: StockReportProps) {
  const { mode } = useTheme()
  const [items, setItems] = useState<StockItem[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [stockFilter, setStockFilter] = useState<StockFilter>('all')
  const [sortField, setSortField] = useState<SortField>('name')
  const [sortDir, setSortDir] = useState<SortDir>('asc')
  const [lotes, setLotes] = useState<Map<string, LoteSaldo[]>>(new Map())

  const table = type === 'pharmacy' ? 'pharmacy_items' : 'warehouse_items'
  const title = type === 'pharmacy' ? 'Relatorio de Estoque — Farmacia' : 'Relatorio de Estoque — Almoxarifado'
  const Icon = type === 'pharmacy' ? Pill : Package2

  const txt = mode === 'dark' ? '#e8f0ec' : '#0d2e1c'
  const txtSec = mode === 'dark' ? 'rgba(255,255,255,0.7)' : 'rgba(13,46,28,0.65)'
  const txtMut = mode === 'dark' ? 'rgba(255,255,255,0.4)' : 'rgba(13,46,28,0.4)'

  const glass: React.CSSProperties = {
    background: mode === 'dark' ? 'rgba(10,15,20,0.55)' : 'rgba(255,255,255,0.65)',
    backdropFilter: 'blur(30px)',
    WebkitBackdropFilter: 'blur(30px)',
    border: `1px solid ${mode === 'dark' ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.5)'}`,
    borderRadius: 16,
  }

  const inputStyle: React.CSSProperties = {
    background: mode === 'dark' ? 'rgba(0,0,0,0.3)' : 'rgba(255,255,255,0.5)',
    border: `1px solid ${mode === 'dark' ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.08)'}`,
    borderRadius: 10, padding: '8px 12px', fontSize: 14,
    color: txt, outline: 'none',
  }

  useEffect(() => { loadItems() }, [])

  async function loadItems() {
    setLoading(true)
    try {
      const { data, error } = await supabase
        .from(table)
        .select('id, code, name, category, unit, current_stock, min_stock, price, is_active, batch_number, expiry_date')
        .eq('is_active', true)
        .order('name')
      if (error) throw error
      setItems(data || [])
      await loadLotes()
    } catch (e) {
      console.error('Error loading items:', e)
    } finally {
      setLoading(false)
    }
  }

  // Lotes com saldo do estoque do relatorio. Paginado: o Supabase devolve no
  // maximo 1000 linhas por consulta.
  async function loadLotes() {
    try {
      const { data: loc } = await supabase.from('stock_locations').select('id')
        .eq('code', type === 'pharmacy' ? 'CAF' : 'ALMOX').maybeSingle()
      if (!loc) return
      const mapa = new Map<string, LoteSaldo[]>()
      for (let de = 0; ; de += 1000) {
        const { data, error } = await supabase.from('expiry_tracking')
          .select('item_id, batch_number, expiry_date, current_quantity')
          .eq('location_id', (loc as any).id).gt('current_quantity', 0)
          .order('expiry_date', { ascending: true, nullsFirst: false })
          .range(de, de + 999)
        if (error) throw error
        for (const r of (data || []) as any[]) {
          const lista = mapa.get(r.item_id) || []
          lista.push({ lote: r.batch_number || 's/ lote', validade: r.expiry_date, qtd: Number(r.current_quantity) })
          mapa.set(r.item_id, lista)
        }
        if (!data || data.length < 1000) break
      }
      setLotes(mapa)
    } catch (e) {
      console.error('Error loading lots:', e)
    }
  }

  // Item sem lote cadastrado: usa o lote/validade gravados no proprio item
  // (modelo antigo do almox), quando houver.
  function lotesDoItem(item: StockItem): LoteSaldo[] {
    const ls = lotes.get(item.id)
    if (ls && ls.length) return ls
    if (item.batch_number || item.expiry_date) {
      return [{ lote: item.batch_number || 's/ lote', validade: item.expiry_date ?? null, qtd: item.current_stock }]
    }
    return []
  }

  const categories = useMemo(() => {
    const cats = new Set(items.map(i => i.category))
    return Array.from(cats).sort()
  }, [items])

  const filteredItems = useMemo(() => {
    let result = [...items]

    if (search.trim()) {
      const q = search.toLowerCase()
      result = result.filter(i => i.name.toLowerCase().includes(q) || i.code.toLowerCase().includes(q))
    }

    if (categoryFilter !== 'all') {
      result = result.filter(i => i.category === categoryFilter)
    }

    if (stockFilter !== 'all') {
      result = result.filter(i => getStockStatus(i).key === stockFilter)
    }

    result.sort((a, b) => {
      let cmp = 0
      switch (sortField) {
        case 'name': cmp = a.name.localeCompare(b.name); break
        case 'code': cmp = a.code.localeCompare(b.code); break
        case 'category': cmp = a.category.localeCompare(b.category); break
        case 'current_stock': cmp = a.current_stock - b.current_stock; break
        case 'min_stock': cmp = a.min_stock - b.min_stock; break
        case 'status': cmp = a.current_stock / Math.max(a.min_stock, 1) - b.current_stock / Math.max(b.min_stock, 1); break
      }
      return sortDir === 'asc' ? cmp : -cmp
    })

    return result
  }, [items, search, categoryFilter, stockFilter, sortField, sortDir])

  // Stats
  const stats = useMemo(() => {
    const total = items.length
    const normal = items.filter(i => getStockStatus(i).key === 'normal').length
    const low = items.filter(i => getStockStatus(i).key === 'low').length
    const critical = items.filter(i => getStockStatus(i).key === 'critical').length
    const out = items.filter(i => getStockStatus(i).key === 'out').length
    const totalValue = items.reduce((sum, i) => sum + (i.current_stock * (i.price || 0)), 0)
    return { total, normal, low, critical, out, totalValue }
  }, [items])

  function toggleSort(field: SortField) {
    if (sortField === field) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortField(field)
      setSortDir('asc')
    }
  }

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return <ChevronDown size={12} style={{ opacity: 0.3 }} />
    return sortDir === 'asc' ? <ChevronUp size={12} /> : <ChevronDown size={12} />
  }

  function exportToExcel() {
    const data = filteredItems.map(item => {
      const status = getStockStatus(item)
      return {
        'Codigo': item.code,
        'Nome': item.name,
        'Categoria': item.category,
        'Unidade': item.unit,
        'Estoque Atual': item.current_stock,
        'Estoque Minimo': item.min_stock,
        'Preco Unit.': item.price || 0,
        'Valor Total': item.current_stock * (item.price || 0),
        'Status': status.label,
        'Lotes': textoLotes(lotesDoItem(item)),
        'Validade mais proxima': dataBR(validadeMaisProxima(lotesDoItem(item))),
      }
    })

    const ws = XLSX.utils.json_to_sheet(data)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Estoque')

    // Aba "Por lote": uma linha por lote com saldo, ordenada por validade.
    const porLote = filteredItems.flatMap((item) =>
      lotesDoItem(item).map((l) => ({
        'Codigo': item.code,
        'Nome': item.name,
        'Unidade': item.unit,
        'Lote': l.lote,
        'Validade': dataBR(l.validade),
        'Quantidade no lote': l.qtd,
      })))
    if (porLote.length) {
      const wsLote = XLSX.utils.json_to_sheet(porLote)
      wsLote['!cols'] = [{ wch: 18 }, { wch: 50 }, { wch: 8 }, { wch: 16 }, { wch: 12 }, { wch: 18 }]
      XLSX.utils.book_append_sheet(wb, wsLote, 'Por lote')
    }

    // Auto-size columns
    const colWidths = Object.keys(data[0] || {}).map(key => ({ wch: Math.max(key.length, 15) }))
    ws['!cols'] = colWidths

    const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
    const blob = new Blob([buf], { type: 'application/octet-stream' })
    const dateStr = format(new Date(), 'yyyy-MM-dd')
    saveAs(blob, `relatorio_estoque_${type}_${dateStr}.xlsx`)
  }

  function exportToCSV() {
    const headers = ['Codigo', 'Nome', 'Categoria', 'Unidade', 'Estoque Atual', 'Estoque Minimo', 'Status', 'Lotes', 'Validade mais proxima']
    const cel = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
    const rows = filteredItems.map(item => {
      const status = getStockStatus(item)
      const ls = lotesDoItem(item)
      return [item.code, item.name, item.category, item.unit, item.current_stock, item.min_stock, status.label,
        textoLotes(ls), dataBR(validadeMaisProxima(ls))].map(cel).join(';')
    })
    const csv = [headers.join(';'), ...rows].join('\n')
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' })
    const dateStr = format(new Date(), 'yyyy-MM-dd')
    saveAs(blob, `relatorio_estoque_${type}_${dateStr}.csv`)
  }

  const statCards = [
    { label: 'Total de Itens', value: stats.total, color: txt, filter: 'all' as StockFilter },
    { label: 'Normal', value: stats.normal, color: '#22c55e', filter: 'normal' as StockFilter },
    { label: 'Estoque Baixo', value: stats.low, color: '#eab308', filter: 'low' as StockFilter },
    { label: 'Critico', value: stats.critical, color: '#f97316', filter: 'critical' as StockFilter },
    { label: 'Sem Estoque', value: stats.out, color: '#ef4444', filter: 'out' as StockFilter },
  ]

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg" style={{ background: mode === 'dark' ? 'rgba(45,180,140,0.15)' : 'rgba(16,185,129,0.12)' }}>
            <Icon size={20} style={{ color: mode === 'dark' ? '#5ee8b8' : '#059669' }} />
          </div>
          <div>
            <h1 className="text-xl font-bold" style={{ color: txt }}>{title}</h1>
            <p className="text-sm" style={{ color: txtSec }}>
              {filteredItems.length} de {items.length} itens | Gerado em {format(new Date(), "dd/MM/yyyy 'as' HH:mm")}
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={exportToCSV}>
            <Download size={14} className="mr-1" /> CSV
          </Button>
          <Button size="sm" className="bg-primary-500 hover:bg-primary-600 text-white" onClick={exportToExcel}>
            <Download size={14} className="mr-1" /> Excel
          </Button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {statCards.map((s) => (
          <button
            key={s.label}
            onClick={() => setStockFilter(stockFilter === s.filter ? 'all' : s.filter)}
            className="p-4 rounded-xl text-left transition-all"
            style={{
              ...glass,
              outline: stockFilter === s.filter ? `2px solid ${s.color}` : 'none',
              cursor: 'pointer',
            }}
          >
            <div className="text-2xl font-bold" style={{ color: s.color }}>{s.value}</div>
            <div className="text-xs font-medium mt-1" style={{ color: txtSec }}>{s.label}</div>
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 p-4 rounded-xl" style={glass}>
        <div className="relative flex-1 min-w-[200px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: txtMut }} />
          <input
            type="text"
            placeholder="Buscar por nome ou codigo..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ ...inputStyle, paddingLeft: 34, width: '100%' }}
          />
        </div>
        <div className="flex items-center gap-2">
          <Filter size={14} style={{ color: txtMut }} />
          <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} style={inputStyle}>
            <option value="all">Todas as categorias</option>
            {categories.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
      </div>

      {/* Table */}
      <div className="rounded-xl overflow-hidden" style={glass}>
        <table className="w-full">
          <thead>
            <tr style={{ borderBottom: `1px solid ${mode === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)'}` }}>
              {[
                { label: 'Codigo', field: 'code' as SortField },
                { label: 'Nome', field: 'name' as SortField },
                { label: 'Categoria', field: 'category' as SortField },
                { label: 'Unidade', field: null },
                { label: 'Estoque Atual', field: 'current_stock' as SortField },
                { label: 'Estoque Minimo', field: 'min_stock' as SortField },
                { label: 'Status', field: 'status' as SortField },
              ].map((col) => (
                <th
                  key={col.label}
                  onClick={col.field ? () => toggleSort(col.field!) : undefined}
                  className={`text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider ${col.field ? 'cursor-pointer select-none' : ''}`}
                  style={{ color: txtMut }}
                >
                  <div className="flex items-center gap-1">
                    {col.label}
                    {col.field && <SortIcon field={col.field} />}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} className="text-center py-12" style={{ color: txtMut }}>Carregando...</td></tr>
            ) : filteredItems.length === 0 ? (
              <tr><td colSpan={7} className="text-center py-12" style={{ color: txtMut }}>Nenhum item encontrado</td></tr>
            ) : (
              filteredItems.map((item, i) => {
                const status = getStockStatus(item)
                return (
                  <tr
                    key={item.id}
                    style={{
                      borderBottom: `1px solid ${mode === 'dark' ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)'}`,
                      background: i % 2 === 0 ? (mode === 'dark' ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.015)') : 'transparent',
                    }}
                  >
                    <td className="px-4 py-3 text-sm" style={{ color: txtMut }}>{item.code}</td>
                    <td className="px-4 py-3 text-sm font-medium" style={{ color: txt }}>{item.name}</td>
                    <td className="px-4 py-3 text-sm" style={{ color: txtSec }}>{item.category}</td>
                    <td className="px-4 py-3 text-sm" style={{ color: txtMut }}>{item.unit}</td>
                    <td className="px-4 py-3 text-sm font-bold" style={{ color: status.key === 'normal' ? txt : status.color }}>
                      {item.current_stock}
                    </td>
                    <td className="px-4 py-3 text-sm" style={{ color: txtSec }}>{item.min_stock}</td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium" style={{
                        background: status.bg,
                        color: status.color,
                      }}>
                        {status.key !== 'normal' && <AlertTriangle size={10} />}
                        {status.label}
                      </span>
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Summary */}
      {stats.totalValue > 0 && (
        <div className="text-sm text-right" style={{ color: txtMut }}>
          Valor estimado em estoque: <strong style={{ color: txt }}>R$ {stats.totalValue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</strong>
        </div>
      )}
    </div>
  )
}

// Pharmacy Stock Report Page
export function PharmacyStockReport() {
  return <StockReport type="pharmacy" />
}

// Warehouse Stock Report Page
export function WarehouseStockReport() {
  return <StockReport type="warehouse" />
}
