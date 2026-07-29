import { useEffect, useMemo, useState } from 'react'
import { useTheme } from '@/contexts/theme'
import { useAuth } from '@/contexts/auth'
import { Search, Plus, Loader2, AlertCircle, Edit, PowerOff, Power, Pill } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { supabase } from '@/lib/supabase'
import { itemsService } from '@/lib/services/items'
import type { Item } from '@/lib/services/items'
import { AddItemDialog } from '@/components/inventory/add-item-dialog'
import { EditItemDialog } from '@/components/inventory/edit-item-dialog'
import { MEDICATION_CLASS_LABEL } from '@/lib/types/farmacia'
import type { MedicationClass } from '@/lib/types/farmacia'

type StatusFilter = 'todos' | 'ativos' | 'inativos'

const CLASS_BADGE_STYLE: Record<MedicationClass, string> = {
  uso_geral: 'bg-gray-100 text-gray-800 border-gray-200',
  antimicrobianos: 'bg-rose-100 text-rose-800 border-rose-200',
  controlados: 'bg-indigo-100 text-indigo-800 border-indigo-200',
  mav: 'bg-amber-100 text-amber-800 border-amber-200',
  sgv: 'bg-cyan-100 text-cyan-800 border-cyan-200',
  curativo: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  anticoagulante: 'bg-purple-100 text-purple-800 border-purple-200',
}

export function PharmacyCatalogo() {
  const { mode } = useTheme()
  const { user } = useAuth()
  const canEdit = user?.role === 'administrador' || user?.role === 'gestor'

  const txt = mode === 'dark' ? '#fff' : '#0d2e1c'
  const txtSec = mode === 'dark' ? 'rgba(255,255,255,0.7)' : 'rgba(13,46,28,0.65)'
  const txtMut = mode === 'dark' ? 'rgba(255,255,255,0.45)' : 'rgba(13,46,28,0.45)'

  const glass: React.CSSProperties = {
    background: mode === 'dark' ? 'rgba(10,15,20,0.55)' : 'rgba(255,255,255,0.65)',
    backdropFilter: 'blur(30px)', WebkitBackdropFilter: 'blur(30px)',
    border: `1px solid ${mode === 'dark' ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.5)'}`,
    borderRadius: 16,
  }
  const inputStyle: React.CSSProperties = {
    background: mode === 'dark' ? 'rgba(0,0,0,0.3)' : 'rgba(255,255,255,0.5)',
    border: `1px solid ${mode === 'dark' ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.08)'}`,
    borderRadius: 10, padding: '8px 12px', fontSize: 14,
    color: txt, outline: 'none',
  }

  const [items, setItems] = useState<Item[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [classFilter, setClassFilter] = useState<MedicationClass | ''>('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ativos')

  const [showAdd, setShowAdd] = useState(false)
  const [editingItem, setEditingItem] = useState<Item | null>(null)

  async function loadItems() {
    try {
      setLoading(true)
      setError(null)
      // Busca direto: precisamos de ativos E inativos (Item[] via itemsService
      // filtra inativos por padrão); usamos query crua aqui.
      const { data, error } = await supabase
        .from('pharmacy_items')
        .select('id, code, name, description, category, unit, current_stock, min_stock, is_active, padronizado, medication_class, medication_classes, controlled_subclass, presentation, is_mav, created_at, updated_at')
        .order('name', { ascending: true })
        .limit(2000)
      if (error) throw error
      setItems((data || []) as unknown as Item[])
    } catch (e: any) {
      setError(e?.message || 'Erro ao carregar catálogo')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadItems() }, [])

  // Resolve classes do item (fallback do single quando array vazio).
  function classesOf(it: Item): MedicationClass[] {
    const arr = (it as any).medication_classes as MedicationClass[] | null | undefined
    if (Array.isArray(arr) && arr.length > 0) return arr
    if (it.medication_class) return [it.medication_class]
    return []
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return items.filter((it) => {
      if (statusFilter === 'ativos' && it.is_active === false) return false
      if (statusFilter === 'inativos' && it.is_active !== false) return false
      if (classFilter && !classesOf(it).includes(classFilter)) return false
      if (q) {
        const blob = `${it.code} ${it.name} ${it.description || ''}`.toLowerCase()
        if (!blob.includes(q)) return false
      }
      return true
    })
  }, [items, search, statusFilter, classFilter])

  async function toggleActive(it: Item) {
    const next = it.is_active === false
    if (!confirm(next ? `Reativar "${it.name}"?` : `Inativar "${it.name}"?\n\nO item será ocultado das telas operacionais.`)) return
    try {
      await itemsService.update(it.id, { is_active: next }, 'pharmacy')
      await loadItems()
    } catch (e: any) {
      alert(e?.message || 'Erro ao alterar status')
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2 flex-wrap" style={{ color: txt }}>
            <Pill className="w-6 h-6" /> Medicamentos
          </h1>
          <p className="text-sm mt-1" style={{ color: txtSec }}>
            Cadastro de itens da farmácia. O estoque é gerenciado nas telas de cada local.
          </p>
        </div>
        {canEdit && (
          <Button
            className="bg-primary-500 hover:bg-primary-600 text-white"
            onClick={() => setShowAdd(true)}
          >
            <Plus className="w-4 h-4 mr-2" />
            Novo Item
          </Button>
        )}
      </div>

      {/* Filtros */}
      <div className="p-4 flex flex-wrap items-center gap-3" style={glass}>
        <div className="relative flex-1 min-w-[260px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: txtMut }} />
          <input
            type="text"
            placeholder="Buscar por código, nome ou descrição..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ ...inputStyle, paddingLeft: 34, width: '100%' }}
          />
        </div>

        <select
          value={classFilter}
          onChange={(e) => setClassFilter(e.target.value as MedicationClass | '')}
          style={{ ...inputStyle, width: 220 }}
        >
          <option value="">Todas as classes</option>
          {(Object.entries(MEDICATION_CLASS_LABEL) as Array<[MedicationClass, string]>).map(([k, label]) => (
            <option key={k} value={k}>{label}</option>
          ))}
        </select>

        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
          style={{ ...inputStyle, width: 150 }}
        >
          <option value="ativos">Ativos</option>
          <option value="inativos">Inativos</option>
          <option value="todos">Todos</option>
        </select>
      </div>

      {error && (
        <div className="p-4 rounded-xl bg-red-100 border border-red-200 flex items-center gap-2 text-red-800 text-sm">
          <AlertCircle size={16} /> {error}
        </div>
      )}

      {/* Tabela */}
      <div style={glass} className="overflow-hidden">
        <div className="overflow-x-auto">
        <table className="w-full min-w-[900px]">
          <thead>
            <tr style={{ borderBottom: `1px solid ${mode === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)'}` }}>
              {['Código', 'Nome', 'Categoria', 'Unidade', 'Classificação', 'Padronizado', 'Status', 'Ações'].map((h) => (
                <th key={h} className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider" style={{ color: txtMut }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={8} className="text-center py-12" style={{ color: txtMut }}>
                  <Loader2 className="w-5 h-5 animate-spin inline mr-2" /> Carregando catálogo...
                </td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={8} className="text-center py-12" style={{ color: txtMut }}>
                  Nenhum item encontrado com esses filtros.
                </td>
              </tr>
            ) : (
              filtered.map((it, i) => {
                const classes = classesOf(it)
                const inactive = it.is_active === false
                return (
                  <tr
                    key={it.id}
                    style={{
                      borderBottom: `1px solid ${mode === 'dark' ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)'}`,
                      background: i % 2 === 0 ? (mode === 'dark' ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)') : 'transparent',
                      opacity: inactive ? 0.55 : 1,
                    }}
                  >
                    <td className="px-4 py-3 text-sm font-bold" style={{ color: txt }}>{it.code}</td>
                    <td className="px-4 py-3 text-sm" style={{ color: txt }}>{it.name}</td>
                    <td className="px-4 py-3 text-xs" style={{ color: txtSec }}>{it.category}</td>
                    <td className="px-4 py-3 text-xs" style={{ color: txtSec }}>{it.unit}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {classes.length === 0 ? (
                          <span className="text-xs" style={{ color: txtMut }}>—</span>
                        ) : classes.map((c) => (
                          <span
                            key={c}
                            className={`text-xs px-2 py-0.5 rounded-full border ${CLASS_BADGE_STYLE[c]}`}
                            title={MEDICATION_CLASS_LABEL[c]}
                          >
                            {MEDICATION_CLASS_LABEL[c]}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {(it as any).padronizado ? (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-800 border border-green-200">
                          Padronizado
                        </span>
                      ) : (
                        <span className="text-xs" style={{ color: txtMut }}>—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {inactive ? (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-gray-200 text-gray-700">Inativo</span>
                      ) : (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800">Ativo</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs">
                      <div className="flex items-center gap-2">
                        {canEdit && (
                          <button
                            onClick={() => setEditingItem(it)}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded-md border text-xs hover:bg-gray-50"
                            style={{
                              color: txt,
                              borderColor: mode === 'dark' ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.12)',
                            }}
                            title="Editar"
                          >
                            <Edit size={12} /> Editar
                          </button>
                        )}
                        {canEdit && (
                          <button
                            onClick={() => toggleActive(it)}
                            className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs ${
                              inactive
                                ? 'bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100'
                                : 'bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100'
                            }`}
                            title={inactive ? 'Reativar' : 'Inativar'}
                          >
                            {inactive ? <Power size={12} /> : <PowerOff size={12} />}
                            {inactive ? 'Reativar' : 'Inativar'}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
        </div>
      </div>

      <div className="text-sm" style={{ color: txtMut }}>
        {filtered.length} item(ns) no catálogo
        {classFilter && ` · filtro: ${MEDICATION_CLASS_LABEL[classFilter]}`}
        {statusFilter !== 'todos' && ` · ${statusFilter}`}
      </div>

      <AddItemDialog
        type="pharmacy"
        open={showAdd}
        onOpenChange={setShowAdd}
        onSuccess={loadItems}
      />

      {editingItem && (
        <EditItemDialog
          item={editingItem}
          type="pharmacy"
          open={!!editingItem}
          onOpenChange={(o) => !o && setEditingItem(null)}
          onSuccess={loadItems}
        />
      )}
    </div>
  )
}
