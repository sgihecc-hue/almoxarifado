import { useState, useEffect, useCallback } from 'react'
import {
  Ambulance, Plus, Loader2, Pencil, Trash2, AlertCircle, AlertTriangle,
  CheckCircle2, Search, ArrowLeft, Package, Pill, Hash,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import {
  emergencyCartsService, expiryStatus,
  type EmergencyCartSummary, type EmergencyCartItem, type CatalogOption, type CartItemType,
} from '@/lib/services/emergency-carts'
import { PHARMACY_STOCKS } from '@/lib/constants/stock-locations'
import { getErrorMessage } from '@/lib/utils/error-messages'

// Qualquer uma das 3 satélites pode abastecer qualquer carro. O CAF fica de
// fora: quem repõe o carro na ponta é a satélite do andar.
const SATELITES = PHARMACY_STOCKS.filter((s) => s.code !== 'CAF')

// expiry_date é `date` (sem fuso). O 'T00:00:00' evita o deslocamento de um dia
// que new Date('yyyy-MM-dd') causa ao interpretar como UTC.
function formatDate(d: string | null): string {
  if (!d) return '—'
  return new Date(d + 'T00:00:00').toLocaleDateString('pt-BR')
}

function tipoLabel(t: CartItemType): string {
  return t === 'pharmacy' ? 'Medicamento' : 'Material'
}

export function CarrosEmergencia() {
  const [carts, setCarts] = useState<EmergencyCartSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  // Carro aberto (null = visão dos 4 cards).
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [items, setItems] = useState<EmergencyCartItem[]>([])
  const [loadingItems, setLoadingItems] = useState(false)
  const [search, setSearch] = useState('')

  const selected = carts.find((c) => c.id === selectedId) ?? null

  // --- Dialog do número de registro ---
  const [showRegDialog, setShowRegDialog] = useState(false)
  const [regValue, setRegValue] = useState('')

  // --- Dialog de item (adicionar/editar) ---
  const [showItemDialog, setShowItemDialog] = useState(false)
  const [editingItem, setEditingItem] = useState<EmergencyCartItem | null>(null)
  const [catalogTerm, setCatalogTerm] = useState('')
  const [catalogOpts, setCatalogOpts] = useState<CatalogOption[]>([])
  const [searchingCatalog, setSearchingCatalog] = useState(false)
  const [chosen, setChosen] = useState<CatalogOption | null>(null)
  const [qty, setQty] = useState('0')
  const [minQty, setMinQty] = useState('')
  const [batch, setBatch] = useState('')
  const [expiry, setExpiry] = useState('')
  const [sourceLoc, setSourceLoc] = useState('')

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadCarts = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      setCarts(await emergencyCartsService.listWithSummary())
    } catch (e) {
      setLoadError(getErrorMessage(e))
    } finally {
      setLoading(false)
    }
  }, [])

  const loadItems = useCallback(async (cartId: string) => {
    setLoadingItems(true)
    try {
      const { items: list } = await emergencyCartsService.getWithItems(cartId)
      setItems(list)
    } catch (e) {
      setLoadError(getErrorMessage(e))
    } finally {
      setLoadingItems(false)
    }
  }, [])

  useEffect(() => { loadCarts() }, [loadCarts])
  useEffect(() => {
    if (selectedId) loadItems(selectedId)
    else setItems([])
  }, [selectedId, loadItems])
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 2500)
    return () => clearTimeout(t)
  }, [toast])

  // Busca no catálogo com debounce — dois catálogos por tecla seria pesado.
  useEffect(() => {
    if (!showItemDialog || editingItem) return
    const term = catalogTerm.trim()
    if (term.length < 2) { setCatalogOpts([]); return }
    setSearchingCatalog(true)
    const t = setTimeout(async () => {
      try {
        setCatalogOpts(await emergencyCartsService.searchCatalog(term))
      } catch (e) {
        console.error(e)
        setCatalogOpts([])
      } finally {
        setSearchingCatalog(false)
      }
    }, 350)
    return () => clearTimeout(t)
  }, [catalogTerm, showItemDialog, editingItem])

  // Busca client-side no conteúdo do carro (nome ou lote).
  const filtered = items.filter((i) => {
    const q = search.trim().toLowerCase()
    if (!q) return true
    return i.item_name.toLowerCase().includes(q) || (i.batch_number || '').toLowerCase().includes(q)
  })

  function openRegDialog() {
    if (!selected) return
    setRegValue(selected.registration_number || '')
    setError(null)
    setShowRegDialog(true)
  }

  async function saveRegistration() {
    if (!selected) return
    setSaving(true); setError(null)
    try {
      await emergencyCartsService.updateRegistration(selected.id, regValue)
      setShowRegDialog(false)
      setToast('Número de registro salvo.')
      await loadCarts()
    } catch (e) {
      setError(getErrorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  function openNewItem() {
    setEditingItem(null)
    setCatalogTerm(''); setCatalogOpts([]); setChosen(null)
    setQty('0'); setMinQty(''); setBatch(''); setExpiry(''); setSourceLoc('')
    setError(null); setShowItemDialog(true)
  }

  function openEditItem(i: EmergencyCartItem) {
    setEditingItem(i)
    // Na edição o item não muda — só quantidade/lote/validade/origem.
    setChosen({ id: i.item_id, name: i.item_name, code: i.item_code, unit: i.item_unit, item_type: i.item_type })
    setQty(String(i.quantity))
    setMinQty(i.min_quantity != null ? String(i.min_quantity) : '')
    setBatch(i.batch_number || '')
    setExpiry(i.expiry_date || '')
    setSourceLoc(i.source_location_id || '')
    setError(null); setShowItemDialog(true)
  }

  async function saveItem() {
    if (!selected) return
    setError(null)
    if (!chosen) { setError('Selecione o item no catálogo.'); return }
    const qtyNum = Number(qty)
    if (!Number.isFinite(qtyNum) || qtyNum < 0) { setError('Quantidade inválida.'); return }
    const minNum = minQty.trim() === '' ? null : Number(minQty)
    if (minNum !== null && (!Number.isFinite(minNum) || minNum < 0)) { setError('Quantidade padrão inválida.'); return }

    setSaving(true)
    try {
      if (editingItem) {
        await emergencyCartsService.updateItem(editingItem.id, {
          quantity: qtyNum, min_quantity: minNum, batch_number: batch,
          expiry_date: expiry, source_location_id: sourceLoc,
        })
        setToast('Item atualizado.')
      } else {
        await emergencyCartsService.addItem(selected.id, {
          item_id: chosen.id, item_type: chosen.item_type, quantity: qtyNum,
          min_quantity: minNum, batch_number: batch,
          expiry_date: expiry, source_location_id: sourceLoc,
        })
        setToast('Item adicionado ao carro.')
      }
      setShowItemDialog(false)
      await Promise.all([loadItems(selected.id), loadCarts()])
    } catch (e) {
      setError(getErrorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  async function removeItem(i: EmergencyCartItem) {
    if (!selected) return
    if (!confirm(`Remover "${i.item_name}" do ${selected.name}?`)) return
    try {
      await emergencyCartsService.removeItem(i.id)
      setToast('Item removido.')
      await Promise.all([loadItems(selected.id), loadCarts()])
    } catch (e) {
      setLoadError(getErrorMessage(e))
    }
  }

  // ------------------------------------------------------------------
  // Visão 1: os 4 carros em cards
  // ------------------------------------------------------------------
  if (!selected) {
    return (
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-red-100 rounded-lg"><Ambulance className="w-6 h-6 text-red-600" /></div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Carros de Emergência</h1>
            <p className="text-sm text-gray-500">
              Conteúdo dos carros A, B, C e D — medicamentos e materiais, com lote e validade.
            </p>
          </div>
        </div>

        {loadError && (
          <div className="p-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" /> {loadError}
          </div>
        )}

        {loading ? (
          <div className="p-10 text-center text-gray-400"><Loader2 className="w-6 h-6 animate-spin mx-auto" /></div>
        ) : carts.length === 0 ? (
          <div className="p-10 text-center text-gray-400 bg-white border border-gray-100 rounded-xl">
            Nenhum carro de emergência cadastrado.
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {carts.map((c) => {
              const alerta = c.expired_count > 0 || c.expiring_count > 0
              return (
                <button
                  key={c.id}
                  onClick={() => { setSelectedId(c.id); setSearch('') }}
                  className="text-left bg-white border border-gray-100 rounded-xl shadow-sm p-5 hover:border-red-200 hover:shadow-md transition"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-11 h-11 rounded-lg bg-red-50 flex items-center justify-center text-lg font-bold text-red-600">
                        {c.code}
                      </div>
                      <div>
                        <div className="font-semibold text-gray-900">{c.name}</div>
                        {c.registration_number ? (
                          <div className="text-xs text-gray-500 flex items-center gap-1">
                            <Hash className="w-3 h-3" /> Registro {c.registration_number}
                          </div>
                        ) : (
                          <div className="text-xs text-gray-400 italic">Sem número de registro</div>
                        )}
                      </div>
                    </div>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">
                      {c.total_items} {c.total_items === 1 ? 'item' : 'itens'}
                    </span>
                  </div>

                  {alerta && (
                    <div className="mt-4 flex flex-wrap gap-2">
                      {c.expired_count > 0 && (
                        <span className="text-xs px-2 py-1 rounded-md bg-red-100 text-red-700 flex items-center gap-1">
                          <AlertTriangle className="w-3 h-3" /> {c.expired_count} vencido{c.expired_count > 1 ? 's' : ''}
                        </span>
                      )}
                      {c.expiring_count > 0 && (
                        <span className="text-xs px-2 py-1 rounded-md bg-amber-100 text-amber-700 flex items-center gap-1">
                          <AlertTriangle className="w-3 h-3" /> {c.expiring_count} vencendo em 30 dias
                        </span>
                      )}
                    </div>
                  )}
                </button>
              )
            })}
          </div>
        )}

        {toast && (
          <div className="fixed bottom-6 right-6 z-50 flex items-center gap-2 px-5 py-3 rounded-xl shadow-lg bg-green-600 text-white text-sm font-medium">
            <CheckCircle2 className="w-5 h-5" /> {toast}
          </div>
        )}
      </div>
    )
  }

  // ------------------------------------------------------------------
  // Visão 2: conteúdo de um carro
  // ------------------------------------------------------------------
  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setSelectedId(null)}
            className="p-2 rounded-lg hover:bg-gray-100 text-gray-500"
            title="Voltar aos carros"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="p-2 bg-red-100 rounded-lg"><Ambulance className="w-6 h-6 text-red-600" /></div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{selected.name}</h1>
            <div className="text-sm text-gray-500 flex items-center gap-2">
              {selected.registration_number ? (
                <span className="flex items-center gap-1"><Hash className="w-3.5 h-3.5" /> Registro {selected.registration_number}</span>
              ) : (
                <span className="italic text-gray-400">Sem número de registro</span>
              )}
              <button onClick={openRegDialog} className="text-blue-600 hover:underline text-xs">
                {selected.registration_number ? 'editar' : 'informar'}
              </button>
            </div>
          </div>
        </div>
        <Button onClick={openNewItem} className="bg-primary-500 hover:bg-primary-600 text-white shrink-0">
          <Plus className="w-4 h-4 mr-2" /> Adicionar Item
        </Button>
      </div>

      {loadError && (
        <div className="p-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" /> {loadError}
        </div>
      )}

      <div className="relative">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar por item ou lote..."
          className="pl-9"
        />
      </div>

      <div className="bg-white border border-gray-100 rounded-xl shadow-sm overflow-hidden">
        {loadingItems ? (
          <div className="p-10 text-center text-gray-400"><Loader2 className="w-6 h-6 animate-spin mx-auto" /></div>
        ) : filtered.length === 0 ? (
          <div className="p-10 text-center text-gray-400">
            {search.trim() ? 'Nenhum item encontrado para a busca.' : 'Este carro ainda não tem itens cadastrados.'}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-gray-400 uppercase border-b">
                  <th className="text-left px-4 py-3">Item</th>
                  <th className="text-left px-4 py-3">Tipo</th>
                  <th className="text-right px-4 py-3">Qtd</th>
                  <th className="text-right px-4 py-3">Padrão</th>
                  <th className="text-left px-4 py-3">Lote</th>
                  <th className="text-left px-4 py-3">Validade</th>
                  <th className="px-4 py-3 w-24"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((i) => {
                  const st = expiryStatus(i.expiry_date)
                  // Abaixo do padrão do carro = falta item no checklist.
                  const abaixo = i.min_quantity != null && i.quantity < i.min_quantity
                  return (
                    <tr key={i.id} className="border-b last:border-0 hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <div className="font-medium text-gray-900">{i.item_name}</div>
                        {i.item_code && <div className="text-xs text-gray-400">{i.item_code}</div>}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`text-xs px-2 py-0.5 rounded-full inline-flex items-center gap-1 ${
                          i.item_type === 'pharmacy' ? 'bg-blue-100 text-blue-700' : 'bg-purple-100 text-purple-700'
                        }`}>
                          {i.item_type === 'pharmacy' ? <Pill className="w-3 h-3" /> : <Package className="w-3 h-3" />}
                          {tipoLabel(i.item_type)}
                        </span>
                      </td>
                      <td className={`px-4 py-3 text-right font-medium ${abaixo ? 'text-red-600' : 'text-gray-900'}`}>
                        {i.quantity}{i.item_unit ? ` ${i.item_unit}` : ''}
                      </td>
                      <td className="px-4 py-3 text-right text-gray-500">
                        {i.min_quantity != null ? i.min_quantity : '—'}
                      </td>
                      <td className="px-4 py-3 text-gray-600">{i.batch_number || '—'}</td>
                      <td className="px-4 py-3">
                        <span className={
                          st === 'expired' ? 'text-red-600 font-medium'
                          : st === 'expiring' ? 'text-amber-600 font-medium'
                          : 'text-gray-600'
                        }>
                          {formatDate(i.expiry_date)}
                        </span>
                        {st === 'expired' && <span className="ml-1 text-xs text-red-600">(vencido)</span>}
                        {st === 'expiring' && <span className="ml-1 text-xs text-amber-600">(vencendo)</span>}
                      </td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        <button onClick={() => openEditItem(i)} className="text-gray-500 hover:text-gray-700 p-1" title="Editar">
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button onClick={() => removeItem(i)} className="text-red-500 hover:text-red-600 p-1" title="Remover do carro">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Número de registro */}
      <Dialog open={showRegDialog} onOpenChange={setShowRegDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Número de Registro — {selected.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="ce-reg">Número de registro</Label>
              <Input
                id="ce-reg" value={regValue} onChange={(e) => setRegValue(e.target.value)}
                placeholder="Ex: CE-A-001" className="mt-1" autoFocus
              />
              <p className="text-xs text-gray-400 mt-1">Deixe em branco para limpar o registro.</p>
            </div>
            {error && (
              <div className="p-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded flex items-center gap-2">
                <AlertCircle className="w-4 h-4" /> {error}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowRegDialog(false)}>Cancelar</Button>
            <Button onClick={saveRegistration} disabled={saving} className="bg-primary-500 hover:bg-primary-600 text-white">
              {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />} Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Adicionar / editar item */}
      <Dialog open={showItemDialog} onOpenChange={setShowItemDialog}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingItem ? 'Editar Item do Carro' : 'Adicionar Item ao Carro'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {editingItem ? (
              // Na edição o item é fixo — trocar o item seria remover e adicionar.
              <div className="p-3 bg-gray-50 border border-gray-200 rounded-lg">
                <div className="font-medium text-gray-900">{editingItem.item_name}</div>
                <div className="text-xs text-gray-500">{tipoLabel(editingItem.item_type)}</div>
              </div>
            ) : (
              <div>
                <Label htmlFor="ce-busca">Item * (busca em medicamentos e materiais)</Label>
                <div className="relative mt-1">
                  <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <Input
                    id="ce-busca" value={chosen ? chosen.name : catalogTerm}
                    onChange={(e) => { setChosen(null); setCatalogTerm(e.target.value) }}
                    placeholder="Digite ao menos 2 letras..." className="pl-9" autoFocus
                  />
                </div>
                {!chosen && catalogTerm.trim().length >= 2 && (
                  <div className="mt-1 max-h-48 overflow-y-auto border border-gray-200 rounded-lg divide-y">
                    {searchingCatalog ? (
                      <div className="p-3 text-center text-gray-400 text-sm">
                        <Loader2 className="w-4 h-4 animate-spin mx-auto" />
                      </div>
                    ) : catalogOpts.length === 0 ? (
                      <div className="p-3 text-center text-gray-400 text-sm">Nenhum item encontrado.</div>
                    ) : (
                      catalogOpts.map((o) => (
                        <button
                          key={`${o.item_type}-${o.id}`}
                          onClick={() => { setChosen(o); setCatalogOpts([]) }}
                          className="w-full text-left px-3 py-2 hover:bg-gray-50 flex items-center justify-between gap-2"
                        >
                          <span className="text-sm text-gray-900">{o.name}</span>
                          <span className={`text-xs px-2 py-0.5 rounded-full shrink-0 ${
                            o.item_type === 'pharmacy' ? 'bg-blue-100 text-blue-700' : 'bg-purple-100 text-purple-700'
                          }`}>
                            {tipoLabel(o.item_type)}
                          </span>
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="ce-qtd">Quantidade *</Label>
                <Input id="ce-qtd" type="number" min="0" value={qty} onChange={(e) => setQty(e.target.value)} className="mt-1" />
              </div>
              <div>
                <Label htmlFor="ce-min">Quantidade padrão</Label>
                <Input id="ce-min" type="number" min="0" value={minQty} onChange={(e) => setMinQty(e.target.value)} placeholder="opcional" className="mt-1" />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="ce-lote">Lote</Label>
                <Input id="ce-lote" value={batch} onChange={(e) => setBatch(e.target.value)} placeholder="opcional" className="mt-1" />
              </div>
              <div>
                <Label htmlFor="ce-val">Validade</Label>
                <Input id="ce-val" type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} className="mt-1" />
              </div>
            </div>

            <div>
              <Label htmlFor="ce-origem">Satélite de origem</Label>
              <select
                id="ce-origem" value={sourceLoc} onChange={(e) => setSourceLoc(e.target.value)}
                className="mt-1 w-full h-10 px-3 text-sm border border-gray-200 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-primary-500"
              >
                <option value="">— não informado —</option>
                {SATELITES.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
              <p className="text-xs text-gray-400 mt-1">
                Informativo: o carro não debita o saldo da satélite nesta etapa.
              </p>
            </div>

            {error && (
              <div className="p-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded flex items-center gap-2">
                <AlertCircle className="w-4 h-4" /> {error}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowItemDialog(false)}>Cancelar</Button>
            <Button onClick={saveItem} disabled={saving} className="bg-primary-500 hover:bg-primary-600 text-white">
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
