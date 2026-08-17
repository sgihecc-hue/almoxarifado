import { useState, useEffect, useCallback } from 'react'
import { Building2, Plus, Loader2, Pencil, Power, AlertCircle, CheckCircle2, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import { internalUnitsService, type InternalUnit } from '@/lib/services/internal-units'
import { getErrorMessage } from '@/lib/utils/error-messages'

export function UnidadesInternas() {
  const [units, setUnits] = useState<InternalUnit[]>([])
  const [loading, setLoading] = useState(true)
  const [showDialog, setShowDialog] = useState(false)
  const [editing, setEditing] = useState<InternalUnit | null>(null)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  // Busca client-side por nome ou descrição.
  const filtered = units.filter((u) => {
    const q = search.trim().toLowerCase()
    if (!q) return true
    return u.name.toLowerCase().includes(q) || (u.description || '').toLowerCase().includes(q)
  })

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setUnits(await internalUnitsService.list(true))
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 2500)
    return () => clearTimeout(t)
  }, [toast])

  function openNew() {
    setEditing(null); setName(''); setDescription(''); setError(null); setShowDialog(true)
  }
  function openEdit(u: InternalUnit) {
    setEditing(u); setName(u.name); setDescription(u.description || ''); setError(null); setShowDialog(true)
  }

  async function save() {
    setError(null)
    if (!name.trim()) { setError('Nome é obrigatório.'); return }
    setSaving(true)
    try {
      if (editing) {
        await internalUnitsService.update(editing.id, { name, description })
        setToast('Unidade interna atualizada.')
      } else {
        await internalUnitsService.create({ name, description })
        setToast('Unidade interna cadastrada.')
      }
      setShowDialog(false)
      await load()
    } catch (e) {
      setError(getErrorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  async function toggleActive(u: InternalUnit) {
    try {
      if (u.is_active) await internalUnitsService.deactivate(u.id)
      else await internalUnitsService.update(u.id, { is_active: true })
      await load()
    } catch (e) {
      console.error(e)
    }
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-blue-100 rounded-lg"><Building2 className="w-6 h-6 text-blue-600" /></div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Unidades Internas</h1>
            <p className="text-sm text-gray-500">Setores do hospital (destino de saídas e solicitações).</p>
          </div>
        </div>
        <Button onClick={openNew} className="bg-primary-500 hover:bg-primary-600 text-white">
          <Plus className="w-4 h-4 mr-2" /> Nova Unidade
        </Button>
      </div>

      <div className="relative">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar por nome ou descrição..."
          className="pl-9"
        />
      </div>

      <div className="bg-white border border-gray-100 rounded-xl shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-10 text-center text-gray-400"><Loader2 className="w-6 h-6 animate-spin mx-auto" /></div>
        ) : filtered.length === 0 ? (
          <div className="p-10 text-center text-gray-400">
            {search.trim() ? 'Nenhuma unidade encontrada para a busca.' : 'Nenhuma unidade interna cadastrada.'}
          </div>
        ) : (
          <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-gray-400 uppercase border-b">
                <th className="text-left px-4 py-3">Nome</th>
                <th className="text-left px-4 py-3">Descrição</th>
                <th className="text-left px-4 py-3">Status</th>
                <th className="px-4 py-3 w-28"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((u) => (
                <tr key={u.id} className="border-b last:border-0 hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-900">{u.name}</td>
                  <td className="px-4 py-3 text-gray-500">{u.description || '—'}</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${u.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                      {u.is_active ? 'Ativa' : 'Inativa'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => openEdit(u)} className="text-gray-500 hover:text-gray-700 p-1" title="Editar"><Pencil className="w-4 h-4" /></button>
                    <button onClick={() => toggleActive(u)} className={`p-1 ${u.is_active ? 'text-red-500 hover:text-red-600' : 'text-green-600 hover:text-green-700'}`} title={u.is_active ? 'Desativar' : 'Reativar'}>
                      <Power className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </div>

      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? 'Editar Unidade Interna' : 'Nova Unidade Interna'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="ui-name">Nome *</Label>
              <Input id="ui-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex: UTI Adulto" className="mt-1" autoFocus />
            </div>
            <div>
              <Label htmlFor="ui-desc">Descrição (opcional)</Label>
              <Input id="ui-desc" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Ex: 2º andar, ala leste" className="mt-1" />
            </div>
            {error && (
              <div className="p-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded flex items-center gap-2"><AlertCircle className="w-4 h-4" /> {error}</div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDialog(false)}>Cancelar</Button>
            <Button onClick={save} disabled={saving} className="bg-primary-500 hover:bg-primary-600 text-white">
              {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />} Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {toast && (
        <div className="fixed bottom-6 right-6 z-50 flex items-center gap-2 px-5 py-3 rounded-xl shadow-lg bg-green-600 text-white text-sm font-medium">
          <CheckCircle2 className="w-5 h-5" /> {toast}
        </div>
      )}
    </div>
  )
}
