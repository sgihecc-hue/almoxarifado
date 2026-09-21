import { useState, useEffect } from 'react'
import { Loader2, AlertCircle, CheckCircle2, XCircle, PackageCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/auth'
import { useModule } from '@/contexts/module'
import { kitsService, SAT_T_ID } from '@/lib/services/kits'
import { getErrorMessage } from '@/lib/utils/error-messages'
import type { Request } from '@/lib/services/requests'

// Atendimento do PEDIDO DE ENFERMAGEM pela Satelite Terreo.
//
// Substitui, so pra esse tipo de pedido, os botoes genericos de solicitacao.
// Motivo: os botoes genericos levam o pedido de material ao gatilho do
// ALMOXARIFADO, que abate de warehouse_items (saldo do almox central). O
// material do pedido de enfermagem sai da prateleira da Satelite Terreo, entao
// a baixa tem que ser em item_stocks(SAT_T). A RPC atender_pedido_enfermagem
// faz isso pela mesma funcao que a satelite ja usa (criar_saida_material), e o
// banco recusa concluir esse pedido por qualquer outro caminho.

interface Lote { id: string; batch_number: string | null; expiry_date: string | null; current_quantity: number }

interface Linha {
  _key: string
  request_item_id: string
  warehouse_item_id: string
  nome: string
  pedido: number
  quantidade: number
  lote: string
}

export function AtenderPedidoEnfermagem({ request, onDone }: { request: Request; onDone: () => void }) {
  const { user } = useAuth()
  const { activeStock } = useModule()

  const [linhas, setLinhas] = useState<Linha[]>([])
  const [lotes, setLotes] = useState<Record<string, Lote[]>>({})
  const [saldos, setSaldos] = useState<Record<string, number>>({})
  const [notes, setNotes] = useState('')
  const [motivoRecusa, setMotivoRecusa] = useState('')
  const [mostrarRecusa, setMostrarRecusa] = useState(false)
  const [salvando, setSalvando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)

  const aberto = ['pending', 'approved', 'processing'].includes(request.status)
  const papelPode = ['administrador', 'gestor', 'atendente', 'pharmacist'].includes(user?.role || '')
  // Admin atende de qualquer lugar; os demais precisam estar operando a SAT_T.
  const podeAtender = aberto && papelPode &&
    (user?.role === 'administrador' || activeStock?.id === SAT_T_ID)

  useEffect(() => {
    const itens = ((request.request_items || []) as any[])
      .filter((i) => i.warehouse_item_id || i.item?.id)
    setLinhas(itens.map((i) => ({
      _key: i.id,
      request_item_id: i.id,
      warehouse_item_id: i.warehouse_item_id || i.item?.id,
      nome: i.item_name || i.item?.name || 'Item',
      pedido: i.quantity,
      quantidade: i.quantity,
      lote: '',
    })))
  }, [request])

  // Saldo e lotes da SATELITE TERREO (nunca do almoxarifado).
  useEffect(() => {
    const ids = [...new Set(linhas.map((l) => l.warehouse_item_id))]
    if (ids.length === 0 || !podeAtender) return
    ;(async () => {
      const [st, lt] = await Promise.all([
        supabase.from('item_stocks').select('item_id, quantity')
          .eq('location_id', SAT_T_ID).eq('item_type', 'warehouse').in('item_id', ids),
        supabase.from('expiry_tracking').select('id, item_id, batch_number, expiry_date, current_quantity')
          .eq('location_id', SAT_T_ID).in('item_id', ids).gt('current_quantity', 0)
          .order('expiry_date', { ascending: true, nullsFirst: false }),
      ])
      const s: Record<string, number> = {}
      for (const r of (st.data || []) as any[]) s[r.item_id] = r.quantity
      setSaldos(s)
      const l: Record<string, Lote[]> = {}
      for (const r of (lt.data || []) as any[]) (l[r.item_id] ||= []).push(r)
      setLotes(l)
    })()
  }, [linhas.length, podeAtender])

  if (!aberto) return null

  if (!podeAtender) {
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-800 flex items-start gap-2">
        <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
        <span>
          Pedido de enfermagem. É atendido pela <strong>Farmácia Satélite Térreo</strong>, com baixa no estoque dela.
          Para atender, entre na Farmácia com a Satélite Térreo como estoque ativo.
        </span>
      </div>
    )
  }

  async function atender() {
    setError(null)
    if (linhas.some((l) => !Number.isFinite(l.quantidade) || l.quantidade < 0)) {
      setError('Quantidade inválida em alguma linha.'); return
    }
    if (linhas.every((l) => l.quantidade === 0)) {
      setError('Nenhum item fornecido. Se não há como atender, use Recusar.'); return
    }
    setSalvando(true)
    try {
      const r = await kitsService.atender(request.id, linhas.map((l) => ({
        request_item_id: l.request_item_id,
        quantity: l.quantidade,
        expiry_tracking_id: l.lote || null,
      })), notes)
      setOk(`Pedido ${r.numero} atendido: ${r.quantidade_total} un baixadas da Satélite Térreo.`)
      setTimeout(onDone, 1200)
    } catch (e) {
      setError(getErrorMessage(e))
    } finally {
      setSalvando(false)
    }
  }

  async function recusar() {
    setError(null)
    if (!motivoRecusa.trim()) { setError('Informe o motivo da recusa.'); return }
    setSalvando(true)
    try {
      await kitsService.recusar(request.id, motivoRecusa)
      setOk('Pedido recusado.')
      setTimeout(onDone, 1000)
    } catch (e) {
      setError(getErrorMessage(e))
    } finally {
      setSalvando(false)
    }
  }

  return (
    <div className="bg-white rounded-xl p-6 border-2 border-emerald-200 space-y-4">
      <div className="flex items-center gap-2 text-lg font-semibold text-gray-900">
        <PackageCheck className="w-5 h-5 text-emerald-600" /> Atender pela Satélite Térreo
      </div>
      <p className="text-sm text-gray-500">
        A baixa sai do estoque da Satélite Térreo. Ajuste a quantidade se faltar algum item (0 = não fornecido).
      </p>

      <table className="w-full text-sm">
        <thead className="text-gray-500">
          <tr>
            <th className="text-left font-normal">Item</th>
            <th className="text-right font-normal w-20">Pedido</th>
            <th className="text-right font-normal w-24">Saldo ST</th>
            <th className="text-left font-normal w-28 pl-3">Fornecer</th>
            <th className="text-left font-normal w-48">Lote (opcional)</th>
          </tr>
        </thead>
        <tbody>
          {linhas.map((l, idx) => {
            const saldo = saldos[l.warehouse_item_id] ?? 0
            const falta = l.quantidade > saldo
            return (
              <tr key={l._key} className="border-t border-gray-100">
                <td className="py-2 pr-2">{l.nome}</td>
                <td className="py-2 text-right">{l.pedido}</td>
                <td className={`py-2 text-right ${falta ? 'text-red-600 font-medium' : 'text-gray-500'}`}>{saldo}</td>
                <td className="py-2 pl-3">
                  <Input type="number" min={0} value={l.quantidade} className="h-8"
                    onChange={(e) => setLinhas((p) => p.map((x, i) => i === idx ? { ...x, quantidade: Number(e.target.value) } : x))} />
                </td>
                <td className="py-2">
                  <select value={l.lote}
                    onChange={(e) => setLinhas((p) => p.map((x, i) => i === idx ? { ...x, lote: e.target.value } : x))}
                    className="w-full h-8 rounded-md border border-input bg-white px-2 text-sm">
                    <option value="">— sem lote —</option>
                    {(lotes[l.warehouse_item_id] || []).map((lt) => (
                      <option key={lt.id} value={lt.id}>
                        {lt.batch_number || 's/n'}{lt.expiry_date ? ` · ${new Date(lt.expiry_date).toLocaleDateString('pt-BR')}` : ''} ({lt.current_quantity})
                      </option>
                    ))}
                  </select>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>

      <div>
        <Label htmlFor="obs-at">Observação (opcional)</Label>
        <Input id="obs-at" value={notes} onChange={(e) => setNotes(e.target.value)} className="mt-1" />
      </div>

      {mostrarRecusa && (
        <div>
          <Label htmlFor="recusa">Motivo da recusa *</Label>
          <Input id="recusa" value={motivoRecusa} onChange={(e) => setMotivoRecusa(e.target.value)} className="mt-1" />
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2 text-sm text-red-600"><AlertCircle className="w-4 h-4 mt-0.5" /> {error}</div>
      )}
      {ok && (
        <div className="flex items-start gap-2 text-sm text-emerald-700"><CheckCircle2 className="w-4 h-4 mt-0.5" /> {ok}</div>
      )}

      <div className="flex justify-end gap-2">
        {mostrarRecusa ? (
          <>
            <Button variant="outline" onClick={() => setMostrarRecusa(false)} disabled={salvando}>Voltar</Button>
            <Button variant="destructive" onClick={recusar} disabled={salvando} className="gap-2">
              {salvando && <Loader2 className="w-4 h-4 animate-spin" />} Confirmar recusa
            </Button>
          </>
        ) : (
          <>
            <Button variant="outline" onClick={() => setMostrarRecusa(true)} disabled={salvando} className="gap-2">
              <XCircle className="w-4 h-4" /> Recusar
            </Button>
            <Button onClick={atender} disabled={salvando} className="gap-2">
              {salvando && <Loader2 className="w-4 h-4 animate-spin" />} Atender e dar baixa
            </Button>
          </>
        )}
      </div>
    </div>
  )
}
