import { useState, useEffect, useCallback } from 'react'
import { Building2, Plus, Loader2, Pencil, Power, AlertCircle, CheckCircle2, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import { externalUnitsService, type ExternalUnit } from '@/lib/services/external-units'
import { getErrorMessage } from '@/lib/utils/error-messages'

export function UnidadesExternas() {
  const [units, setUnits] = useState<ExternalUnit[]>([])
  const [loading, setLoading] = useState(true)
  const [showDialog, setShowDialog] = useState(false)
  const [editing, setEditing] = useState<ExternalUnit | null>(null)
  const [name, setName] = useState('')
  const [cnpj, setCnpj] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  // Busca client-side por nome ou CNPJ (dígitos).
  const filtered = units.filter((u) => {
    const q = search.trim().toLowerCase()
    if (!q) return true
    const digits = q.replace(/\D/g, '')
    return u.name.toLowerCase().includes(q) || (digits.length > 0 && (u.cnpj || '').includes(digits))
  })

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setUnits(await externalUnitsService.list(true))
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
    setEditing(null); setName(''); setCnpj(''); setError(null); setShowDialog(true)
  }
  function openEdit(u: ExternalUnit) {
    setEditing(u); setName(u.name); setCnpj(u.cnpj || ''); setError(null); setShowDialog(true)
  }

  async function save() {
    setError(null)
    if (!name.trim()) { setError('Nome é obrigatório.'); return }
    setSaving(true)
    try {
      if (editing) {
        await externalUnitsService.update(editing.id, { name, cnpj })
        setToast('Unidade externa atualizada.')
      } else {
        await externalUnitsService.create({ name, cnpj })
        setToast('Unidade externa cadastrada.')
      }
      setShowDialog(false)
      await load()
    } catch (e) {
      setError(getErrorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  async function toggleActive(u: ExternalUnit) {
    try {
      if (u.is_active) await externalUnitsService.deactivate(u.id)
      else await externalUnitsService.update(u.id, { is_active: true })
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
            <h1 className="text-2xl font-bold text-gray-900">Unidades Externas</h1>
            <p className="text-sm text-gray-500">Hospitais parceiros e unidades externas (destino de saídas).</p>
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
          placeholder="Buscar por nome ou CNPJ..."
          className="pl-9"
        />
      </div>

      <div className="bg-white border border-gray-100 rounded-xl shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-10 text-center text-gray-400"><Loader2 className="w-6 h-6 animate-spin mx-auto" /></div>
        ) : filtered.length === 0 ? (
          <div className="p-10 text-center text-gray-400">
            {search.trim() ? 'Nenhuma unidade encontrada para a busca.' : 'Nenhuma unidade externa cadastrada.'}
          </div>
        ) : (
          <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-gray-400 uppercase border-b">
                <th className="text-left px-4 py-3">Nome</th>
                <th className="text-left px-4 py-3">CNPJ</th>
                <th className="text-left px-4 py-3">Status</th>
                <th className="px-4 py-3 w-28"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((u) => (
                <tr key={u.id} className="border-b last:border-0 hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-900">{u.name}</td>
                  <td className="px-4 py-3 text-gray-500">{u.cnpj || '—'}</td>
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
            <DialogTitle>{editing ? 'Editar Unidade Externa' : 'Nova Unidade Externa'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="un-name">Nome *</Label>
              <Input id="un-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex: Hospital Parceiro X" className="mt-1" autoFocus />
            </div>
            <div>
              <Label htmlFor="un-cnpj">CNPJ (opcional)</Label>
              <Input id="un-cnpj" value={cnpj} onChange={(e) => setCnpj(e.target.value)} placeholder="00.000.000/0000-00" className="mt-1" />
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
