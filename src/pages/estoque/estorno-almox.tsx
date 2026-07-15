import { useState, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Undo2, Loader2, AlertCircle, CheckCircle2, Search, Package2 } from 'lucide-react'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAuth } from '@/contexts/auth'
import { supabase } from '@/lib/supabase'
import { getErrorMessage } from '@/lib/utils/error-messages'

interface WhItem {
  id: string
  name: string
  code: string | null
  unit: string | null
  current_stock: number
}

interface ReturnRow {
  id: string
  item_name: string | null
  quantity: number
  reason: string | null
  returned_at: string
}

const STAFF_ROLES = new Set(['administrador', 'gestor', 'atendente'])

export function EstornoAlmox() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const canUse = !!user?.role && STAFF_ROLES.has(user.role)
  const [searchParams] = useSearchParams()
  // Item pré-selecionado (ex: vindo do detalhe de um pedido no Histórico).
  const preItemId = searchParams.get('item')
  const preQty = searchParams.get('qty')

  const [items, setItems] = useState<WhItem[]>([])
  const [loadingItems, setLoadingItems] = useState(true)
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<WhItem | null>(null)
  const [quantity, setQuantity] = useState<number | ''>('')
  const [reason, setReason] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [recent, setRecent] = useState<ReturnRow[]>([])

  const loadItems = async () => {
    setLoadingItems(true)
    const { data, error: e } = await supabase
      .from('warehouse_items')
      .select('id, name, code, unit, current_stock')
      .eq('is_active', true)
      .order('name')
    if (!e) setItems((data || []) as WhItem[])
    setLoadingItems(false)
  }

  const loadRecent = async () => {
    const { data } = await supabase
      .from('warehouse_request_returns')
      .select('id, item_name, quantity, reason, returned_at')
      .order('returned_at', { ascending: false })
      .limit(10)
    setRecent((data || []) as ReturnRow[])
  }

  useEffect(() => {
    if (canUse) { loadItems(); loadRecent() }
  }, [canUse])

  // Ao carregar os itens, se veio um item por parâmetro (?item=...), já
  // seleciona ele (e a quantidade sugerida, se houver).
  useEffect(() => {
    if (!preItemId || selected || items.length === 0) return
    const found = items.find((i) => i.id === preItemId)
    if (found) {
      setSelected(found)
      if (preQty && Number(preQty) > 0) setQuantity(Number(preQty))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, preItemId, preQty])

  const filtered = search.trim()
    ? items.filter((i) =>
        i.name.toLowerCase().includes(search.toLowerCase()) ||
        (i.code || '').toLowerCase().includes(search.toLowerCase())
      ).slice(0, 30)
    : items.slice(0, 30)

  const reset = () => {
    setSelected(null)
    setQuantity('')
    setReason('')
    setSearch('')
    setError(null)
  }

  const handleSubmit = async () => {
    setError(null)
    if (!selected) { setError('Selecione o item a estornar.'); return }
    const qty = Number(quantity)
    if (!qty || qty <= 0) { setError('Informe uma quantidade válida.'); return }
    if (reason.trim().length < 3) { setError('Informe o motivo do estorno (mínimo 3 caracteres).'); return }

    try {
      setSubmitting(true)
      const { data, error: rpcError } = await supabase.rpc('estornar_estoque_almox', {
        p_warehouse_item_id: selected.id,
        p_quantity: qty,
        p_reason: reason.trim(),
      })
      if (rpcError) throw rpcError
      const res = data as { success?: boolean; error?: string } | null
      if (!res?.success) throw new Error(res?.error || 'Falha no estorno')
      setSuccess(true)
      reset()
      await Promise.all([loadItems(), loadRecent()])
      setTimeout(() => setSuccess(false), 4000)
    } catch (e: any) {
      setError(getErrorMessage(e))
    } finally {
      setSubmitting(false)
    }
  }

  if (!canUse) {
    return (
      <div className="max-w-2xl mx-auto p-6">
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
          <h1 className="text-xl font-semibold text-gray-900">Sem permissão</h1>
          <p className="text-sm text-gray-500 mt-2">
            Apenas a coordenação/atendentes do almoxarifado podem estornar estoque.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="flex items-center gap-4">
        <button
          onClick={() => navigate(-1)}
          className="flex items-center justify-center w-10 h-10 rounded-lg border border-gray-200 bg-white hover:bg-gray-50"
          aria-label="Voltar"
        >
          <ArrowLeft className="w-5 h-5 text-gray-600" />
        </button>
        <div className="flex items-center gap-3">
          <div className="p-3 bg-amber-100 rounded-lg">
            <Undo2 className="w-6 h-6 text-amber-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Estorno de Estoque — Almoxarifado</h1>
            <p className="text-sm text-gray-500">
              Devolve ao estoque um item que retornou (ex: entregue mas não utilizado).
            </p>
          </div>
        </div>
      </div>

      {success && (
        <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 flex items-center gap-2 text-emerald-800 text-sm">
          <CheckCircle2 className="w-5 h-5" /> Estorno registrado! O estoque foi atualizado.
        </div>
      )}

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 space-y-5">
        {/* Seleção do item */}
        <div>
          <Label>Item *</Label>
          {selected ? (
            <div className="mt-1 flex items-center justify-between gap-3 p-3 rounded-lg border-2 border-amber-300 bg-amber-50">
              <div className="min-w-0">
                <p className="font-medium text-gray-900 truncate">{selected.name}</p>
                <p className="text-xs text-gray-500">
                  {selected.code || 's/ código'} · Estoque atual: <strong>{selected.current_stock}</strong> {selected.unit || ''}
                </p>
              </div>
              <Button variant="outline" size="sm" onClick={() => setSelected(null)}>Trocar</Button>
            </div>
          ) : (
            <>
              <div className="relative mt-1">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <Input
                  placeholder="Buscar item por nome ou código..."
                  className="pl-9"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <div className="mt-2 border border-gray-200 rounded-lg divide-y max-h-64 overflow-y-auto">
                {loadingItems ? (
                  <div className="p-4 text-center text-gray-500">
                    <Loader2 className="w-5 h-5 animate-spin inline-block mr-2" /> Carregando...
                  </div>
                ) : filtered.length === 0 ? (
                  <div className="p-4 text-center text-gray-500 text-sm">Nenhum item encontrado</div>
                ) : (
                  filtered.map((it) => (
                    <button
                      key={it.id}
                      type="button"
                      onClick={() => { setSelected(it); setSearch('') }}
                      className="w-full text-left p-3 hover:bg-gray-50 flex items-center justify-between gap-3"
                    >
                      <div className="min-w-0">
                        <p className="font-medium text-gray-900 truncate text-sm">{it.name}</p>
                        <p className="text-xs text-gray-500">{it.code || 's/ código'} · {it.unit || 'UN'}</p>
                      </div>
                      <span className="text-xs text-gray-500 flex-shrink-0">Estoque: {it.current_stock}</span>
                    </button>
                  ))
                )}
              </div>
            </>
          )}
        </div>

        {/* Quantidade */}
        <div>
          <Label htmlFor="qtd">Quantidade devolvida *</Label>
          <Input
            id="qtd"
            type="number"
            min={1}
            value={quantity}
            onChange={(e) => setQuantity(e.target.value === '' ? '' : Math.max(0, Number(e.target.value)))}
            placeholder="0"
            className="mt-1 max-w-[200px]"
          />
        </div>

        {/* Motivo */}
        <div>
          <Label htmlFor="motivo">Motivo do estorno *</Label>
          <textarea
            id="motivo"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            placeholder="Ex: Setor devolveu itens não utilizados da solicitação #123..."
            className="mt-1 w-full rounded-md border border-input bg-white px-3 py-2 text-sm"
          />
        </div>

        {error && (
          <div className="p-3 rounded-lg bg-red-50 border border-red-200 flex items-center gap-2 text-sm text-red-700">
            <AlertCircle className="w-4 h-4 flex-shrink-0" /> {error}
          </div>
        )}

        <div className="flex justify-end">
          <Button
            onClick={handleSubmit}
            disabled={submitting || !selected || !quantity || reason.trim().length < 3}
            className="bg-amber-600 hover:bg-amber-700 text-white"
          >
            {submitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            <Undo2 className="w-4 h-4 mr-2" />
            Registrar estorno
          </Button>
        </div>
      </div>

      {/* Estornos recentes */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center gap-2">
          <Package2 className="w-5 h-5 text-gray-400" />
          <h2 className="text-lg font-semibold text-gray-900">Estornos recentes</h2>
        </div>
        {recent.length === 0 ? (
          <p className="text-sm text-gray-500 text-center py-8">Nenhum estorno registrado ainda.</p>
        ) : (
          <div className="divide-y divide-gray-100">
            {recent.map((r) => (
              <div key={r.id} className="px-6 py-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">{r.item_name || '(item)'}</p>
                  {r.reason && <p className="text-xs text-gray-500 truncate">{r.reason}</p>}
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-sm font-semibold text-amber-700">+{r.quantity}</p>
                  <p className="text-xs text-gray-400">
                    {(() => { try { return format(new Date(r.returned_at), "dd/MM/yy HH:mm", { locale: ptBR }) } catch { return '' } })()}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
