import { useState, useEffect, useCallback } from 'react'
import { Boxes, Plus, Loader2, Pencil, Power, AlertCircle, CheckCircle2, Search, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import { supabase } from '@/lib/supabase'
import { kitsService, type Kit } from '@/lib/services/kits'
import { getErrorMessage } from '@/lib/utils/error-messages'

// Cadastro de kits (gestor/administrador). O kit e um conjunto fixo de MATERIAL
// que a enfermagem pede pronto: "5 x Kit Banho". Quem atende recebe os itens
// somados. Mudar a composicao aqui nao reescreve pedido antigo — o pedido
// guarda copia do nome e ja nasce com os itens somados.

interface LinhaItem {
  _key: string
  item_id: string
  name: string
  unit: string | null
  quantity: number
}

interface ItemBusca { id: string; name: string; code: string | null; unit: string | null }

export function CadastroKits() {
  const [kits, setKits] = useState<Kit[]>([])
  const [contagem, setContagem] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [toast, setToast] = useState<string | null>(null)

  const [showDialog, setShowDialog] = useState(false)
  const [editing, setEditing] = useState<Kit | null>(null)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [linhas, setLinhas] = useState<LinhaItem[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [busca, setBusca] = useState('')
  const [resultados, setResultados] = useState<ItemBusca[]>([])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const lista = await kitsService.list(true)
      setKits(lista)
      // Quantos itens cada kit tem — so pra mostrar na lista.
      const { data } = await supabase.from('kit_items').select('kit_id')
      const cont: Record<string, number> = {}
      for (const r of (data || []) as Array<{ kit_id: string }>) {
        cont[r.kit_id] = (cont[r.kit_id] || 0) + 1
      }
      setContagem(cont)
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

  useEffect(() => {
    const t = setTimeout(async () => {
      const q = busca.trim()
      if (!q) { setResultados([]); return }
      const { data } = await supabase
        .from('warehouse_items')
        .select('id, name, code, unit')
        .eq('is_active', true)
        .or(`name.ilike.%${q}%,code.ilike.%${q}%`)
        .order('name')
        .limit(20)
      setResultados((data || []) as ItemBusca[])
    }, 200)
    return () => clearTimeout(t)
  }, [busca])

  const filtrados = kits.filter((k) =>
    !search.trim() || k.name.toLowerCase().includes(search.trim().toLowerCase()))

  function openNew() {
    setEditing(null); setName(''); setDescription(''); setLinhas([]); setError(null)
    setBusca(''); setResultados([]); setShowDialog(true)
  }

  async function openEdit(kit: Kit) {
    setEditing(kit); setName(kit.name); setDescription(kit.description || '')
    setError(null); setBusca(''); setResultados([]); setShowDialog(true)
    try {
      const itens = await kitsService.listItems(kit.id)
      setLinhas(itens.map((i) => ({
        _key: Math.random().toString(36).slice(2),
        item_id: i.warehouse_item_id!,
        name: i.item_name || 'Item',
        unit: i.unit,
        quantity: i.quantity,
      })))
    } catch (e) {
      setError(getErrorMessage(e))
    }
  }

  function addItem(item: ItemBusca) {
    if (linhas.some((l) => l.item_id === item.id)) {
      setError('Este item já está no kit. Ajuste a quantidade na linha existente.')
      setBusca(''); setResultados([])
      return
    }
    setLinhas((prev) => [...prev, {
      _key: Math.random().toString(36).slice(2),
      item_id: item.id, name: item.name, unit: item.unit, quantity: 1,
    }])
    setBusca(''); setResultados([]); setError(null)
  }

  async function save() {
    setError(null)
    if (!name.trim()) { setError('Nome do kit é obrigatório.'); return }
    if (linhas.length === 0) { setError('O kit precisa de pelo menos um item.'); return }
    if (linhas.some((l) => !l.quantity || l.quantity <= 0)) {
      setError('Quantidade tem que ser maior que zero em todas as linhas.'); return
    }
    setSaving(true)
    try {
      const kit = editing
        ? await kitsService.update(editing.id, { name, description })
        : await kitsService.create({ name, description })
      await kitsService.setItems(kit.id, linhas.map((l) => ({
        item_id: l.item_id, quantity: l.quantity, unit: l.unit,
      })))
      setToast(editing ? 'Kit atualizado.' : 'Kit cadastrado.')
      setShowDialog(false)
      await load()
    } catch (e) {
      setError(getErrorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  async function toggleActive(kit: Kit) {
    try {
      await kitsService.update(kit.id, { is_active: !kit.is_active })
      setToast(kit.is_active ? 'Kit inativado.' : 'Kit reativado.')
      await load()
    } catch (e) {
      setToast(getErrorMessage(e))
    }
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Boxes className="w-6 h-6 text-emerald-600" /> Kits
          </h1>
          <p className="text-sm text-gray-500">
            Conjuntos de material que a enfermagem pede prontos. Atendidos pela Satélite Térreo.
          </p>
        </div>
        <Button onClick={openNew} className="gap-2"><Plus className="w-4 h-4" /> Novo Kit</Button>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar kit pelo nome..." className="pl-9" />
      </div>

      <div className="bg-white border border-gray-100 rounded-xl shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-10 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>
        ) : filtrados.length === 0 ? (
          <div className="p-10 text-center text-gray-400 text-sm">
            Nenhum kit cadastrado. Use "Novo Kit" para criar o primeiro.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-600">
              <tr>
                <th className="text-left px-4 py-2">Kit</th>
                <th className="text-left px-4 py-2">Itens</th>
                <th className="text-left px-4 py-2">Situação</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {filtrados.map((kit) => (
                <tr key={kit.id} className="border-t border-gray-100">
                  <td className="px-4 py-2">
                    <div className="font-medium text-gray-900">{kit.name}</div>
                    {kit.description && <div className="text-xs text-gray-500">{kit.description}</div>}
                  </td>
                  <td className="px-4 py-2 text-gray-600">{contagem[kit.id] || 0}</td>
                  <td className="px-4 py-2">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${kit.is_active ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
                      {kit.is_active ? 'Ativo' : 'Inativo'}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-right whitespace-nowrap">
                    <Button variant="ghost" size="sm" onClick={() => openEdit(kit)} className="gap-1">
                      <Pencil className="w-3.5 h-3.5" /> Editar
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => toggleActive(kit)} className="gap-1">
                      <Power className="w-3.5 h-3.5" /> {kit.is_active ? 'Inativar' : 'Reativar'}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editing ? 'Editar kit' : 'Novo kit'}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <Label htmlFor="kit-nome">Nome do kit *</Label>
              <Input id="kit-nome" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Kit Banho" className="mt-1" />
            </div>
            <div>
              <Label htmlFor="kit-desc">Descrição (opcional)</Label>
              <Input id="kit-desc" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Para que serve o kit" className="mt-1" />
            </div>

            <div>
              <Label>Itens do kit *</Label>
              <div className="relative mt-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <Input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar material por nome ou código..." className="pl-9" />
              </div>
              {resultados.length > 0 && (
                <div className="mt-1 border border-gray-200 rounded-md max-h-40 overflow-auto">
                  {resultados.map((r) => (
                    <button key={r.id} type="button" onClick={() => addItem(r)}
                      className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50">
                      {r.name} {r.code ? <span className="text-xs text-gray-400">· {r.code}</span> : null}
                    </button>
                  ))}
                </div>
              )}

              {linhas.length > 0 && (
                <table className="w-full text-sm mt-3">
                  <thead className="text-gray-500">
                    <tr>
                      <th className="text-left font-normal">Material</th>
                      <th className="text-left font-normal w-28">Qtd por kit</th>
                      <th className="w-10" />
                    </tr>
                  </thead>
                  <tbody>
                    {linhas.map((l, idx) => (
                      <tr key={l._key} className="border-t border-gray-100">
                        <td className="py-1.5 pr-2">{l.name}</td>
                        <td className="py-1.5">
                          <Input type="number" min={1} value={l.quantity}
                            onChange={(e) => setLinhas((prev) => prev.map((x, i) => i === idx ? { ...x, quantity: Number(e.target.value) } : x))}
                            className="h-8" />
                        </td>
                        <td className="py-1.5 text-right">
                          <button type="button" onClick={() => setLinhas((prev) => prev.filter((_, i) => i !== idx))}
                            className="text-gray-400 hover:text-red-600">
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {error && (
              <div className="flex items-start gap-2 text-sm text-red-600">
                <AlertCircle className="w-4 h-4 mt-0.5" /> {error}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDialog(false)}>Cancelar</Button>
            <Button onClick={save} disabled={saving} className="gap-2">
              {saving && <Loader2 className="w-4 h-4 animate-spin" />} Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {toast && (
        <div className="fixed bottom-6 right-6 bg-gray-900 text-white text-sm px-4 py-2 rounded-lg shadow-lg flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4" /> {toast}
        </div>
      )}
    </div>
  )
}
