// =====================================================================
// Saídas da farmácia — lista as saídas avulsas (quebra, vencimento, etc.)
// com opção de REVERTER (cancelar), devolvendo a quantidade ao estoque.
// A reversão cria um movimento de entrada de compensação (o histórico é
// imutável — nada é apagado). Só farmácia.
// =====================================================================
import { useEffect, useMemo, useState } from 'react'
import { PackageMinus, Undo2, Search, Loader2, AlertCircle, CheckCircle2, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { supabase } from '@/lib/supabase'
import { getErrorMessage } from '@/lib/utils/error-messages'

interface SaidaRow {
  id: string
  quantity: number
  reason: string | null
  reason_detail: string | null
  performed_at: string
  item_name: string
  item_code: string
  batch: string | null
  loc: string
  by: string | null
  reverted: boolean
}

const REASON_LABEL: Record<string, string> = {
  quebra: 'Quebra / Avaria', vencimento: 'Vencimento', transferencia: 'Transferência',
  devolucao_fornecedor: 'Devolução ao fornecedor', defeito_fabricacao: 'Defeito de fabricação',
  embalagem_violada: 'Embalagem violada', ajuste_inventario: 'Ajuste de inventário', outro: 'Outro',
}

export function SaidasFarmacia() {
  const [rows, setRows] = useState<SaidaRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [toast, setToast] = useState('')
  const [revertingId, setRevertingId] = useState<string | null>(null)

  async function load() {
    setLoading(true); setError('')
    try {
      const { data: mov, error: e1 } = await supabase
        .from('stock_movements')
        .select('id, quantity, reason, reason_detail, performed_at, item_id, expiry_tracking_id, source_location_id, performed_by')
        .eq('item_type', 'pharmacy').eq('direction', 'out')
        .in('movement_type', ['SAIDA_AVULSA', 'TRANSFERENCIA'])
        .order('performed_at', { ascending: false })
        .limit(400)
      if (e1) throw e1
      const movs = (mov || []) as any[]
      if (movs.length === 0) { setRows([]); return }

      const ids = movs.map((m) => m.id)
      const itemIds = [...new Set(movs.map((m) => m.item_id).filter(Boolean))]
      const lotIds = [...new Set(movs.map((m) => m.expiry_tracking_id).filter(Boolean))]
      const locIds = [...new Set(movs.map((m) => m.source_location_id).filter(Boolean))]
      const userIds = [...new Set(movs.map((m) => m.performed_by).filter(Boolean))]

      const [items, lotes, locs, users, reversals] = await Promise.all([
        supabase.from('pharmacy_items').select('id, name, code').in('id', itemIds.length ? itemIds : ['00000000-0000-0000-0000-000000000000']),
        lotIds.length ? supabase.from('expiry_tracking').select('id, batch_number').in('id', lotIds) : Promise.resolve({ data: [] }),
        locIds.length ? supabase.from('stock_locations').select('id, code, name').in('id', locIds) : Promise.resolve({ data: [] }),
        userIds.length ? supabase.from('users').select('id, full_name').in('id', userIds) : Promise.resolve({ data: [] }),
        supabase.from('stock_movements').select('linked_movement_id').in('linked_movement_id', ids),
      ])
      const itemMap = new Map((items.data || []).map((x: any) => [x.id, x]))
      const lotMap = new Map((lotes.data || []).map((x: any) => [x.id, x.batch_number]))
      const locMap = new Map((locs.data || []).map((x: any) => [x.id, x]))
      const userMap = new Map((users.data || []).map((x: any) => [x.id, x.full_name]))
      const revertedSet = new Set((reversals.data || []).map((x: any) => x.linked_movement_id))

      setRows(movs.map((m) => ({
        id: m.id,
        quantity: m.quantity,
        reason: m.reason,
        reason_detail: m.reason_detail,
        performed_at: m.performed_at,
        item_name: itemMap.get(m.item_id)?.name || '(item removido)',
        item_code: itemMap.get(m.item_id)?.code || '',
        batch: m.expiry_tracking_id ? (lotMap.get(m.expiry_tracking_id) || '—') : null,
        loc: locMap.get(m.source_location_id)?.code || '—',
        by: userMap.get(m.performed_by) || null,
        reverted: revertedSet.has(m.id),
      })))
    } catch (e) {
      setError(getErrorMessage(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  async function reverter(r: SaidaRow) {
    if (!confirm(`Reverter a saída de ${r.quantity} × ${r.item_name}? A quantidade volta ao estoque (${r.loc}).`)) return
    setRevertingId(r.id); setError('')
    try {
      const { error: e } = await supabase.rpc('farmacia_reverter_saida', { p_movement_id: r.id })
      if (e) throw e
      setToast('Saída revertida — item devolvido ao estoque.')
      setTimeout(() => setToast(''), 3000)
      await load()
    } catch (e) {
      setError(getErrorMessage(e))
    } finally {
      setRevertingId(null)
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return rows
    return rows.filter((r) => r.item_name.toLowerCase().includes(q) || (r.item_code || '').toLowerCase().includes(q) || (r.batch || '').toLowerCase().includes(q))
  }, [rows, search])

  const fmt = (s: string) => { try { return new Date(s).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) } catch { return s } }

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <div className="p-3 rounded-lg bg-red-100"><PackageMinus className="w-6 h-6 text-red-600" /></div>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Saídas da Farmácia</h1>
          <p className="text-sm text-gray-500">Saídas avulsas (quebra, vencimento, etc.) — com opção de reverter</p>
        </div>
      </div>

      {error && <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-800 text-sm flex items-center gap-2"><AlertCircle className="w-4 h-4" /> {error}</div>}

      <div className="bg-white border border-gray-100 rounded-xl shadow-sm p-4">
        <div className="relative">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar por item, código ou lote..." className="pl-9" />
        </div>
      </div>

      <div className="bg-white border border-gray-100 rounded-xl shadow-sm overflow-x-auto">
        {loading ? (
          <div className="p-8 text-center text-gray-400"><Loader2 className="w-5 h-5 animate-spin inline mr-2" /> Carregando...</div>
        ) : filtered.length === 0 ? (
          <p className="p-6 text-sm text-center text-gray-400">Nenhuma saída encontrada.</p>
        ) : (
          <table className="w-full text-sm min-w-[820px]">
            <thead>
              <tr className="text-xs text-gray-400 uppercase border-b bg-gray-50">
                <th className="text-left px-3 py-2">Data</th>
                <th className="text-left px-3 py-2">Item</th>
                <th className="text-right px-3 py-2">Qtd</th>
                <th className="text-left px-3 py-2">Lote</th>
                <th className="text-left px-3 py-2">Estoque</th>
                <th className="text-left px-3 py-2">Motivo</th>
                <th className="text-left px-3 py-2">Por</th>
                <th className="text-right px-3 py-2">Ação</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id} className={`border-b last:border-0 ${r.reverted ? 'bg-gray-50 text-gray-400' : ''}`}>
                  <td className="px-3 py-2 whitespace-nowrap">{fmt(r.performed_at)}</td>
                  <td className="px-3 py-2">
                    <div className="font-medium text-gray-900">{r.item_name}</div>
                    <div className="text-xs text-gray-400">{r.item_code}</div>
                  </td>
                  <td className="px-3 py-2 text-right font-semibold">{r.quantity}</td>
                  <td className="px-3 py-2">{r.batch || <span className="text-gray-400">sem lote</span>}</td>
                  <td className="px-3 py-2">{r.loc}</td>
                  <td className="px-3 py-2">{r.reason ? (REASON_LABEL[r.reason] || r.reason) : '—'}{r.reason_detail ? <span className="text-xs text-gray-400"> · {r.reason_detail}</span> : ''}</td>
                  <td className="px-3 py-2">{r.by || '—'}</td>
                  <td className="px-3 py-2 text-right">
                    {r.reverted ? (
                      <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 border border-gray-200">
                        <RotateCcw className="w-3 h-3" /> Revertida
                      </span>
                    ) : (
                      <Button variant="outline" size="sm" onClick={() => reverter(r)} disabled={revertingId === r.id}
                        className="h-8 text-amber-700 border-amber-200 hover:bg-amber-50">
                        {revertingId === r.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <><Undo2 className="w-3.5 h-3.5 mr-1" /> Reverter</>}
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {toast && (
        <div className="fixed bottom-6 right-6 z-50 flex items-center gap-2 px-5 py-3 rounded-xl shadow-lg bg-green-600 text-white text-sm font-medium">
          <CheckCircle2 className="w-5 h-5" /> {toast}
        </div>
      )}
    </div>
  )
}
