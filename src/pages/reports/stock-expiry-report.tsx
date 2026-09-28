import { useState, useEffect, useMemo, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  CalendarClock, Search, AlertTriangle, Filter,
  ChevronDown, ChevronUp, Printer, FileSpreadsheet,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useTheme } from '@/contexts/theme'
import { supabase } from '@/lib/supabase'
import { buscarTodas, normalizarBusca, parseDataLocal } from '@/lib/utils/seguro'
import * as XLSX from 'xlsx'
import { saveAs } from 'file-saver'
import { format, differenceInDays, parseISO } from 'date-fns'

// --------------- Tipos ---------------

// Uma linha por LOTE com saldo (expiry_tracking.current_quantity > 0).
// Antes era uma linha por item com o lote/validade do CADASTRO (campo unico,
// velho): 22 itens apareciam vencidos sem ter lote vencido com saldo.
interface ExpiryItem {
  id: string          // id da linha (lote) — unico
  item_id: string
  local: string       // codigo do estoque do lote (CAF, SAT_1...) ou 'cadastro'
  code: string | null
  name: string
  category: string | null
  unit: string | null
  current_stock: number   // saldo do LOTE neste local
  min_stock: number
  batch_number: string | null
  expiry_date: string | null
  price: number | null
  last_purchase_price: number | null
  reference_price: number | null
  item_type: 'pharmacy' | 'warehouse'
}

type SortField = 'name' | 'code' | 'category' | 'current_stock' | 'expiry_date' | 'expiry_status' | 'batch_number'
type SortDir = 'asc' | 'desc'
type ExpiryFilter = 'all' | 'expired' | 'expiring_soon' | 'ok' | 'no_date'
type TypeFilter = 'all' | 'pharmacy' | 'warehouse'

// --------------- Helpers ---------------

const DAYS_EXPIRING_SOON = 90

function getExpiryStatus(expiryDate: string | null) {
  if (!expiryDate) return { label: 'Sem Validade', color: '#94a3b8', bg: 'rgba(148,163,184,0.12)', key: 'no_date' as const, days: null }

  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const expDate = parseDataLocal(expiryDate) ?? parseISO(expiryDate)
  const days = differenceInDays(expDate, today)

  if (days < 0) return { label: 'Vencido', color: '#ef4444', bg: 'rgba(239,68,68,0.12)', key: 'expired' as const, days }
  if (days <= DAYS_EXPIRING_SOON) return { label: `Vence em ${days}d`, color: '#f97316', bg: 'rgba(249,115,22,0.12)', key: 'expiring_soon' as const, days }
  return { label: 'Dentro da Validade', color: '#22c55e', bg: 'rgba(34,197,94,0.12)', key: 'ok' as const, days }
}

function formatDate(date: string | null) {
  if (!date) return '—'
  try {
    return format(parseISO(date), 'dd/MM/yyyy')
  } catch {
    return date
  }
}

function formatCurrency(val: number | null) {
  if (val === null || val === undefined) return '—'
  return val.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

// --------------- Componente ---------------

export function StockExpiryReport() {
  const { mode } = useTheme()
  const printRef = useRef<HTMLDivElement>(null)
  const [items, setItems] = useState<ExpiryItem[]>([])
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [expiryFilter, setExpiryFilter] = useState<ExpiryFilter>('all')
  // typeFilter default vem do ?type= da URL. Assim o link "Relatorios ·
  // Farmacia > Validade" ja abre filtrado como farmacia; o do Almox como
  // warehouse. Sem query param, mostra tudo ("all").
  const [searchParams] = useSearchParams()
  const initialType = ((): TypeFilter => {
    const t = searchParams.get('type')
    return t === 'pharmacy' || t === 'warehouse' ? t : 'all'
  })()
  const [typeFilter, setTypeFilter] = useState<TypeFilter>(initialType)
  const [sortField, setSortField] = useState<SortField>('expiry_date')
  const [sortDir, setSortDir] = useState<SortDir>('asc')

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
    setErro(null)
    try {
      type Cad = Omit<ExpiryItem, 'id' | 'item_id' | 'local' | 'item_type'> & { id: string }
      const campos = 'id, code, name, category, unit, current_stock, min_stock, batch_number, expiry_date, price, last_purchase_price, reference_price'
      const cadastro = (tabela: string) => buscarTodas<Cad>((de, ate) =>
        supabase.from(tabela).select(campos).eq('is_active', true).order('name').order('id').range(de, ate) as unknown as PromiseLike<{ data: Cad[] | null; error: unknown }>)
      type Lote = { id: string; item_id: string; batch_number: string | null; expiry_date: string | null; current_quantity: number; location_id: string | null }
      const [pharma, warehouse, lotes, locs] = await Promise.all([
        cadastro('pharmacy_items'),
        cadastro('warehouse_items'),
        buscarTodas<Lote>((de, ate) =>
          supabase.from('expiry_tracking')
            .select('id, item_id, batch_number, expiry_date, current_quantity, location_id')
            .gt('current_quantity', 0)
            .order('id')
            .range(de, ate) as unknown as PromiseLike<{ data: Lote[] | null; error: unknown }>),
        supabase.from('stock_locations').select('id, code'),
      ])
      if (locs.error) throw locs.error
      const codLocal = new Map(((locs.data || []) as Array<{ id: string; code: string }>).map((l) => [l.id, l.code]))
      const lotesPorItem = new Map<string, Lote[]>()
      for (const l of lotes) {
        const lista = lotesPorItem.get(l.item_id) ?? []
        lista.push(l)
        lotesPorItem.set(l.item_id, lista)
      }

      const all: ExpiryItem[] = []
      const montar = (lista: Cad[], tipo: 'pharmacy' | 'warehouse') => {
        for (const it of lista) {
          const ls = lotesPorItem.get(it.id) ?? []
          if (ls.length > 0) {
            for (const l of ls) {
              all.push({ ...it, id: l.id, item_id: it.id, item_type: tipo,
                local: (l.location_id && codLocal.get(l.location_id)) || '—',
                batch_number: l.batch_number, expiry_date: l.expiry_date,
                current_stock: Number(l.current_quantity) || 0 })
            }
          } else if (tipo === 'warehouse' && Number(it.current_stock) > 0) {
            // Almox antigo: lote/validade so no cadastro (sem expiry_tracking).
            all.push({ ...it, id: `cad-${it.id}`, item_id: it.id, item_type: tipo, local: 'cadastro' })
          }
          // Farmacia sem lote com saldo: nada a vencer (saldo zero) — fica de fora.
        }
      }
      montar(pharma, 'pharmacy')
      montar(warehouse, 'warehouse')

      setItems(all)
    } catch (e) {
      console.error('Error loading items for expiry report:', e)
      setErro('Não foi possível carregar o relatório de validade. Verifique a conexão e tente de novo.')
      setItems([])
    } finally {
      setLoading(false)
    }
  }

  const categories = useMemo(() => {
    let source = items
    if (typeFilter !== 'all') source = source.filter(i => i.item_type === typeFilter)
    return Array.from(new Set(source.map(i => i.category ?? ''))).filter(Boolean).sort((a, b) => a.localeCompare(b))
  }, [items, typeFilter])

  const filteredItems = useMemo(() => {
    let result = [...items]

    if (typeFilter !== 'all') result = result.filter(i => i.item_type === typeFilter)

    if (search.trim()) {
      const q = normalizarBusca(search)
      result = result.filter(i =>
        normalizarBusca(i.name).includes(q) ||
        normalizarBusca(i.code).includes(q) ||
        normalizarBusca(i.batch_number).includes(q),
      )
    }

    if (categoryFilter !== 'all') result = result.filter(i => i.category === categoryFilter)

    if (expiryFilter !== 'all') result = result.filter(i => getExpiryStatus(i.expiry_date).key === expiryFilter)

    result.sort((a, b) => {
      let cmp = 0
      switch (sortField) {
        case 'name': cmp = (a.name ?? '').localeCompare(b.name ?? ''); break
        case 'code': cmp = (a.code || '').localeCompare(b.code || ''); break
        case 'category': cmp = (a.category || '').localeCompare(b.category || ''); break
        case 'current_stock': cmp = a.current_stock - b.current_stock; break
        case 'batch_number': cmp = (a.batch_number || '').localeCompare(b.batch_number || ''); break
        case 'expiry_date': {
          const da = a.expiry_date ? (parseDataLocal(a.expiry_date)?.getTime() ?? Infinity) : Infinity
          const db = b.expiry_date ? (parseDataLocal(b.expiry_date)?.getTime() ?? Infinity) : Infinity
          cmp = da - db
          break
        }
        case 'expiry_status': {
          const sa = getExpiryStatus(a.expiry_date).days ?? 99999
          const sb = getExpiryStatus(b.expiry_date).days ?? 99999
          cmp = sa - sb
          break
        }
      }
      return sortDir === 'asc' ? cmp : -cmp
    })

    return result
  }, [items, search, categoryFilter, expiryFilter, typeFilter, sortField, sortDir])

  // Stats
  const stats = useMemo(() => {
    let source = items
    if (typeFilter !== 'all') source = source.filter(i => i.item_type === typeFilter)
    const total = source.length
    const expired = source.filter(i => getExpiryStatus(i.expiry_date).key === 'expired').length
    const expiringSoon = source.filter(i => getExpiryStatus(i.expiry_date).key === 'expiring_soon').length
    const ok = source.filter(i => getExpiryStatus(i.expiry_date).key === 'ok').length
    const noDate = source.filter(i => getExpiryStatus(i.expiry_date).key === 'no_date').length
    const expiredValue = source
      .filter(i => getExpiryStatus(i.expiry_date).key === 'expired')
      .reduce((sum, i) => sum + (i.current_stock * (i.last_purchase_price || i.price || i.reference_price || 0)), 0)
    return { total, expired, expiringSoon, ok, noDate, expiredValue }
  }, [items, typeFilter])

  function toggleSort(field: SortField) {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortField(field); setSortDir('asc') }
  }

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return <ChevronDown size={12} style={{ opacity: 0.3 }} />
    return sortDir === 'asc' ? <ChevronUp size={12} /> : <ChevronDown size={12} />
  }

  // --------------- Exportações ---------------

  function buildExportData() {
    return filteredItems.map(item => {
      const status = getExpiryStatus(item.expiry_date)
      return {
        'Tipo': item.item_type === 'pharmacy' ? 'Farmácia' : 'Almoxarifado',
        'Código': item.code || '',
        'Nome': item.name,
        'Categoria': item.category || '',
        'Unidade': item.unit,
        'Local': item.local,
        'Lote': item.batch_number || '',
        'Validade': item.expiry_date ? formatDate(item.expiry_date) : 'Sem data',
        'Dias Restantes': status.days !== null ? status.days : '',
        'Saldo do lote': item.current_stock,
        'Estoque Mínimo': item.min_stock,
        'Valor Unit.': item.last_purchase_price || item.price || item.reference_price || 0,
        'Valor Total': item.current_stock * (item.last_purchase_price || item.price || item.reference_price || 0),
        'Status Validade': status.label,
      }
    })
  }

  function exportToExcel() {
    const data = buildExportData()
    if (data.length === 0) return

    const ws = XLSX.utils.json_to_sheet(data)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Validade Estoque')

    const colWidths = Object.keys(data[0]).map(key => ({ wch: Math.max(key.length + 2, 15) }))
    ws['!cols'] = colWidths

    const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
    const blob = new Blob([buf], { type: 'application/octet-stream' })
    const dateStr = format(new Date(), 'yyyy-MM-dd')
    const suffix = typeFilter !== 'all' ? `_${typeFilter}` : ''
    saveAs(blob, `relatorio_validade_estoque${suffix}_${dateStr}.xlsx`)
  }

  function exportToPDF() {
    const data = buildExportData()
    if (data.length === 0) return

    const dateStr = format(new Date(), "dd/MM/yyyy 'às' HH:mm")
    const typeLabel = typeFilter === 'pharmacy' ? 'Farmácia' : typeFilter === 'warehouse' ? 'Almoxarifado' : 'Farmácia e Almoxarifado'
    const filterLabel = expiryFilter === 'all' ? 'Todos' : expiryFilter === 'expired' ? 'Vencidos' : expiryFilter === 'expiring_soon' ? 'Próximos do Vencimento' : expiryFilter === 'ok' ? 'Dentro da Validade' : 'Sem Data'

    const html = `
      <!DOCTYPE html>
      <html><head>
        <meta charset="utf-8" />
        <title>Relatório de Validade de Estoque</title>
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body { font-family: Arial, Helvetica, sans-serif; font-size: 10px; color: #1a1a1a; padding: 20px; }
          .header { text-align: center; margin-bottom: 16px; border-bottom: 2px solid #0d5c2e; padding-bottom: 12px; }
          .header h1 { font-size: 16px; color: #0d5c2e; margin-bottom: 4px; }
          .header p { font-size: 10px; color: #666; }
          .summary { display: flex; gap: 16px; margin-bottom: 14px; flex-wrap: wrap; }
          .summary-card { flex: 1; min-width: 100px; padding: 8px 12px; border: 1px solid #ddd; border-radius: 6px; text-align: center; }
          .summary-card .value { font-size: 18px; font-weight: bold; }
          .summary-card .label { font-size: 9px; color: #666; margin-top: 2px; }
          table { width: 100%; border-collapse: collapse; font-size: 9px; }
          th { background: #0d5c2e; color: #fff; padding: 6px 8px; text-align: left; font-weight: 600; white-space: nowrap; }
          td { padding: 5px 8px; border-bottom: 1px solid #e5e5e5; }
          tr:nth-child(even) { background: #f9f9f9; }
          .badge { display: inline-block; padding: 2px 8px; border-radius: 10px; font-size: 8px; font-weight: 600; }
          .badge-expired { background: #fee2e2; color: #dc2626; }
          .badge-soon { background: #ffedd5; color: #ea580c; }
          .badge-ok { background: #dcfce7; color: #16a34a; }
          .badge-none { background: #f1f5f9; color: #64748b; }
          .footer { margin-top: 12px; text-align: center; font-size: 8px; color: #999; border-top: 1px solid #ddd; padding-top: 8px; }
          .text-right { text-align: right; }
          @media print { body { padding: 10px; } }
        </style>
      </head><body>
        <div class="header">
          <h1>SGI-HECC — Relatório de Validade de Estoque</h1>
          <p>${typeLabel} | Filtro: ${filterLabel} | Gerado em: ${dateStr}</p>
        </div>
        <div class="summary">
          <div class="summary-card"><div class="value">${stats.total}</div><div class="label">Total de Lotes</div></div>
          <div class="summary-card"><div class="value" style="color:#dc2626">${stats.expired}</div><div class="label">Vencidos</div></div>
          <div class="summary-card"><div class="value" style="color:#ea580c">${stats.expiringSoon}</div><div class="label">Próx. Vencimento</div></div>
          <div class="summary-card"><div class="value" style="color:#16a34a">${stats.ok}</div><div class="label">Dentro da Validade</div></div>
          <div class="summary-card"><div class="value" style="color:#64748b">${stats.noDate}</div><div class="label">Sem Data</div></div>
        </div>
        <table>
          <thead><tr>
            <th>Tipo</th><th>Código</th><th>Nome</th><th>Categoria</th>
            <th>Local</th><th>Lote</th><th>Validade</th><th>Dias</th>
            <th>Saldo do lote</th><th>Und</th><th class="text-right">Valor Unit.</th><th class="text-right">Valor Total</th><th>Status</th>
          </tr></thead>
          <tbody>
            ${data.map(row => {
              const badgeClass = row['Status Validade'] === 'Vencido' ? 'badge-expired'
                : row['Status Validade'].startsWith('Vence') ? 'badge-soon'
                : row['Status Validade'] === 'Dentro da Validade' ? 'badge-ok' : 'badge-none'
              return `<tr>
                <td>${row['Tipo']}</td>
                <td>${row['Código']}</td>
                <td>${row['Nome']}</td>
                <td>${row['Categoria']}</td>
                <td>${row['Local']}</td>
                <td>${row['Lote']}</td>
                <td>${row['Validade']}</td>
                <td>${row['Dias Restantes'] !== '' ? row['Dias Restantes'] : '—'}</td>
                <td>${row['Saldo do lote']}</td>
                <td>${row['Unidade']}</td>
                <td class="text-right">${formatCurrency(row['Valor Unit.'] as number)}</td>
                <td class="text-right">${formatCurrency(row['Valor Total'] as number)}</td>
                <td><span class="badge ${badgeClass}">${row['Status Validade']}</span></td>
              </tr>`
            }).join('')}
          </tbody>
        </table>
        ${stats.expiredValue > 0 ? `
        <div class="footer" style="text-align:left; font-size:10px; color:#dc2626; font-weight:600;">
          Valor estimado de itens vencidos em estoque: ${formatCurrency(stats.expiredValue)}
        </div>` : ''}
        <div class="footer">SGI-HECC — Sistema de Gestão Integrada — HECC | ${dateStr}</div>
      </body></html>
    `

    const printWindow = window.open('', '_blank')
    if (printWindow) {
      printWindow.document.write(html)
      printWindow.document.close()
      setTimeout(() => { printWindow.print() }, 400)
    }
  }

  // --------------- Stat cards ---------------

  const statCards = [
    { label: 'Total de Lotes', value: stats.total, color: txt, filter: 'all' as ExpiryFilter },
    { label: 'Vencidos', value: stats.expired, color: '#ef4444', filter: 'expired' as ExpiryFilter },
    { label: 'Próx. Vencimento', value: stats.expiringSoon, color: '#f97316', filter: 'expiring_soon' as ExpiryFilter },
    { label: 'Dentro da Validade', value: stats.ok, color: '#22c55e', filter: 'ok' as ExpiryFilter },
    { label: 'Sem Data', value: stats.noDate, color: '#94a3b8', filter: 'no_date' as ExpiryFilter },
  ]

  // --------------- Colunas da tabela ---------------

  const columns: { label: string; field: SortField | null }[] = [
    { label: 'Tipo', field: null },
    { label: 'Código', field: 'code' },
    { label: 'Nome', field: 'name' },
    { label: 'Categoria', field: 'category' },
    { label: 'Local', field: null },
    { label: 'Lote', field: 'batch_number' },
    { label: 'Validade', field: 'expiry_date' },
    { label: 'Saldo do lote', field: 'current_stock' },
    { label: 'Und', field: null },
    { label: 'Status', field: 'expiry_status' },
  ]

  return (
    <div className="space-y-6" ref={printRef}>
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg" style={{ background: mode === 'dark' ? 'rgba(45,180,140,0.15)' : 'rgba(16,185,129,0.12)' }}>
            <CalendarClock size={20} style={{ color: mode === 'dark' ? '#5ee8b8' : '#059669' }} />
          </div>
          <div>
            <h1 className="text-xl font-bold" style={{ color: txt }}>Relatório de Validade de Estoque</h1>
            <p className="text-sm" style={{ color: txtSec }}>
              {filteredItems.length} de {items.length} lotes | Gerado em {format(new Date(), "dd/MM/yyyy 'às' HH:mm")}
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={exportToPDF}>
            <Printer size={14} className="mr-1" /> PDF
          </Button>
          <Button size="sm" className="bg-primary-500 hover:bg-primary-600 text-white" onClick={exportToExcel}>
            <FileSpreadsheet size={14} className="mr-1" /> Excel
          </Button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {statCards.map(s => (
          <button
            key={s.label}
            onClick={() => setExpiryFilter(expiryFilter === s.filter ? 'all' : s.filter)}
            className="p-4 rounded-xl text-left transition-all"
            style={{
              ...glass,
              outline: expiryFilter === s.filter ? `2px solid ${s.color}` : 'none',
              cursor: 'pointer',
            }}
          >
            <div className="text-2xl font-bold" style={{ color: s.color }}>{s.value}</div>
            <div className="text-xs font-medium mt-1" style={{ color: txtSec }}>{s.label}</div>
          </button>
        ))}
      </div>

      {/* Valor estimado de itens vencidos */}
      {stats.expiredValue > 0 && (
        <div className="p-3 rounded-xl text-sm" style={{
          background: mode === 'dark' ? 'rgba(239,68,68,0.1)' : 'rgba(239,68,68,0.06)',
          border: '1px solid rgba(239,68,68,0.25)',
          color: '#ef4444',
        }}>
          <AlertTriangle size={14} className="inline mr-2" />
          Valor estimado de itens <strong>vencidos</strong> em estoque:{' '}
          <strong>{formatCurrency(stats.expiredValue)}</strong>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 p-4 rounded-xl" style={glass}>
        <div className="relative flex-1 min-w-[200px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: txtMut }} />
          <input
            type="text"
            placeholder="Buscar por nome, código ou lote..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ ...inputStyle, paddingLeft: 34, width: '100%' }}
          />
        </div>
        <div className="flex items-center gap-2">
          <Filter size={14} style={{ color: txtMut }} />
          <select value={typeFilter} onChange={e => setTypeFilter(e.target.value as TypeFilter)} style={inputStyle}>
            <option value="all">Farmácia + Almoxarifado</option>
            <option value="pharmacy">Farmácia</option>
            <option value="warehouse">Almoxarifado</option>
          </select>
        </div>
        <select value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)} style={inputStyle}>
          <option value="all">Todas as categorias</option>
          {categories.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      {/* Table */}
      <div className="rounded-xl overflow-hidden" style={glass}>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr style={{ borderBottom: `1px solid ${mode === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)'}` }}>
                {columns.map(col => (
                  <th
                    key={col.label}
                    onClick={col.field ? () => toggleSort(col.field!) : undefined}
                    className={`text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider ${col.field ? 'cursor-pointer select-none' : ''}`}
                    style={{ color: txtMut, whiteSpace: 'nowrap' }}
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
                <tr><td colSpan={columns.length} className="text-center py-12" style={{ color: txtMut }}>Carregando...</td></tr>
              ) : erro ? (
                <tr><td colSpan={columns.length} className="text-center py-12" style={{ color: '#ef4444' }}>
                  {erro}{' '}
                  <Button size="sm" variant="outline" onClick={loadItems}>Tentar de novo</Button>
                </td></tr>
              ) : filteredItems.length === 0 ? (
                <tr><td colSpan={columns.length} className="text-center py-12" style={{ color: txtMut }}>Nenhum item encontrado</td></tr>
              ) : (
                filteredItems.map((item, i) => {
                  const status = getExpiryStatus(item.expiry_date)
                  return (
                    <tr
                      key={`${item.item_type}-${item.id}`}
                      style={{
                        borderBottom: `1px solid ${mode === 'dark' ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)'}`,
                        background: status.key === 'expired'
                          ? (mode === 'dark' ? 'rgba(239,68,68,0.06)' : 'rgba(239,68,68,0.04)')
                          : i % 2 === 0
                            ? (mode === 'dark' ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.015)')
                            : 'transparent',
                      }}
                    >
                      <td className="px-4 py-3 text-xs" style={{ color: txtMut }}>
                        <span className="inline-block px-2 py-0.5 rounded text-xs font-medium" style={{
                          background: item.item_type === 'pharmacy'
                            ? (mode === 'dark' ? 'rgba(99,102,241,0.15)' : 'rgba(99,102,241,0.1)')
                            : (mode === 'dark' ? 'rgba(234,179,8,0.15)' : 'rgba(234,179,8,0.1)'),
                          color: item.item_type === 'pharmacy' ? '#818cf8' : '#ca8a04',
                        }}>
                          {item.item_type === 'pharmacy' ? 'Farm' : 'Almox'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm" style={{ color: txtMut }}>{item.code}</td>
                      <td className="px-4 py-3 text-sm font-medium" style={{ color: txt }}>{item.name}</td>
                      <td className="px-4 py-3 text-sm" style={{ color: txtSec }}>{item.category}</td>
                      <td className="px-4 py-3 text-xs" style={{ color: txtMut }}>{item.local}</td>
                      <td className="px-4 py-3 text-sm" style={{ color: txtSec }}>{item.batch_number || '—'}</td>
                      <td className="px-4 py-3 text-sm" style={{
                        color: status.key === 'expired' ? '#ef4444' : status.key === 'expiring_soon' ? '#f97316' : txtSec,
                        fontWeight: status.key === 'expired' || status.key === 'expiring_soon' ? 600 : 400,
                      }}>
                        {formatDate(item.expiry_date)}
                      </td>
                      <td className="px-4 py-3 text-sm font-bold" style={{ color: txt }}>{item.current_stock}</td>
                      <td className="px-4 py-3 text-sm" style={{ color: txtMut }}>{item.unit}</td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium whitespace-nowrap" style={{
                          background: status.bg,
                          color: status.color,
                        }}>
                          {(status.key === 'expired' || status.key === 'expiring_soon') && <AlertTriangle size={10} />}
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
      </div>

      {/* Legenda */}
      <div className="text-xs flex flex-wrap gap-4" style={{ color: txtMut }}>
        <span>Próx. vencimento = vence em até {DAYS_EXPIRING_SOON} dias</span>
        <span>·</span>
        <span>Itens inativos não aparecem neste relatório</span>
      </div>
    </div>
  )
}
