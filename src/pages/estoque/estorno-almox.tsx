import { useState, useEffect, useRef } from 'react'
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
import { lerQuantidade } from '@/lib/utils/seguro'

// Estorno do almoxarifado (auditoria 28/09/2026 — A7).
// Antes: somava QUALQUER quantidade a QUALQUER item, quantas vezes quisesse.
// Agora todo estorno aponta a ORIGEM (solicitacao entregue ou saida direta) e
// fica limitado ao que saiu nela para aquele item menos o que ja foi estornado.
// O banco (estornar_estoque_almox) confere tudo de novo com trava.

type OrigemTipo = 'solicitacao' | 'saida_direta'

interface OrigemItem {
  origem_id: string
  item_id: string
  item_nome: string
  item_codigo: string | null
  unidade: string | null
  saiu: number
  estornado: number
  disponivel: number
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
  const [searchParams, setSearchParams] = useSearchParams()
  // Item pré-selecionado (ex: vindo do detalhe de um pedido). So vale UMA vez:
  // depois do sucesso o formulario nao pode reaparecer preenchido.
  const preItemId = searchParams.get('item')
  const preAplicadoRef = useRef(false)

  const [origemTipo, setOrigemTipo] = useState<OrigemTipo>('solicitacao')
  const [numero, setNumero] = useState('')
  const [itens, setItens] = useState<OrigemItem[]>([])
  const [buscando, setBuscando] = useState(false)
  const [selected, setSelected] = useState<OrigemItem | null>(null)
  const [quantity, setQuantity] = useState('')
  const [reason, setReason] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [recent, setRecent] = useState<ReturnRow[]>([])
  const enviandoRef = useRef(false)
  const chaveRef = useRef<string>(crypto.randomUUID())

  const loadRecent = async () => {
    const { data, error: e } = await supabase
      .from('warehouse_request_returns')
      .select('id, item_name, quantity, reason, returned_at')
      .order('returned_at', { ascending: false })
      .limit(10)
    if (e) { setError('Erro ao carregar os estornos recentes: ' + getErrorMessage(e)); return }
    setRecent((data || []) as ReturnRow[])
  }

  useEffect(() => {
    if (canUse) loadRecent()
  }, [canUse])

  const buscarOrigem = async () => {
    setError(null)
    setSelected(null)
    setItens([])
    const n = lerQuantidade(numero)
    if (n === null || n <= 0) { setError('Informe o número da solicitação ou da saída direta.'); return }
    setBuscando(true)
    try {
      const { data, error: e } = await supabase.rpc('almox_estorno_itens_origem', {
        p_origem_tipo: origemTipo,
        p_numero: n,
      })
      if (e) throw e
      const rows = (data || []) as OrigemItem[]
      setItens(rows)
      if (rows.length === 0) setError('Nenhum item do almoxarifado saiu nessa origem.')
      // ?item= (vindo do pedido): pre-seleciona uma unica vez
      if (preItemId && !preAplicadoRef.current) {
        const found = rows.find((r) => r.item_id === preItemId)
        if (found) setSelected(found)
        preAplicadoRef.current = true
      }
    } catch (e: any) {
      setError(getErrorMessage(e))
    } finally {
      setBuscando(false)
    }
  }

  const reset = () => {
    setSelected(null)
    setQuantity('')
    setReason('')
    setItens([])
    setNumero('')
    setError(null)
    // tira o ?item= da URL para nada voltar preenchido
    if (preItemId) {
      searchParams.delete('item'); searchParams.delete('qty')
      setSearchParams(searchParams, { replace: true })
    }
  }

  const qty = lerQuantidade(quantity)
  const qtyInvalida = quantity !== '' && (qty === null || qty <= 0 || (selected ? qty > selected.disponivel : false))

  const handleSubmit = async () => {
    setError(null)
    if (enviandoRef.current) return
    if (!selected) { setError('Selecione o item a estornar.'); return }
    if (qty === null || qty <= 0) { setError('Informe uma quantidade inteira maior que zero.'); return }
    if (qty > selected.disponivel) {
      setError(`Estorno maior que o disponível: saiu ${selected.saiu}, já estornado ${selected.estornado}, disponível ${selected.disponivel}.`)
      return
    }
    if (reason.trim().length < 3) { setError('Informe o motivo do estorno (mínimo 3 caracteres).'); return }

    enviandoRef.current = true
    setSubmitting(true)
    try {
      const { error: rpcError } = await supabase.rpc('estornar_estoque_almox', {
        p_warehouse_item_id: selected.item_id,
        p_quantity: qty,
        p_reason: reason.trim(),
        p_origem_tipo: origemTipo,
        p_origem_id: selected.origem_id,
        p_chave: chaveRef.current,
      })
      if (rpcError) throw rpcError
      setSuccess(`Estorno registrado: +${qty} ${selected.unidade || ''} de ${selected.item_nome}.`)
      chaveRef.current = crypto.randomUUID()
      reset()
      await loadRecent()
      setTimeout(() => setSuccess(null), 5000)
    } catch (e: any) {
      setError(getErrorMessage(e))
    } finally {
      enviandoRef.current = false
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
              Devolve ao estoque um item que voltou de uma solicitação entregue ou de uma saída direta — até o que saiu nela.
            </p>
          </div>
        </div>
      </div>

      {success && (
        <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 flex items-center gap-2 text-emerald-800 text-sm">
          <CheckCircle2 className="w-5 h-5" /> {success}
        </div>
      )}

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 space-y-5">
        {/* Origem */}
        <div>
          <Label>Origem do estorno *</Label>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <select
              value={origemTipo}
              onChange={(e) => { setOrigemTipo(e.target.value as OrigemTipo); setItens([]); setSelected(null) }}
              className="h-9 rounded-md border border-input px-3 py-1 bg-white text-sm"
            >
              <option value="solicitacao">Solicitação nº</option>
              <option value="saida_direta">Saída direta nº</option>
            </select>
            <Input
              value={numero}
              inputMode="numeric"
              onChange={(e) => setNumero(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void buscarOrigem() }}
              placeholder="Número"
              className="max-w-[160px]"
            />
            <Button variant="outline" onClick={() => void buscarOrigem()} disabled={buscando}>
              {buscando ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Search className="w-4 h-4 mr-2" />}
              Buscar itens
            </Button>
          </div>
          {preItemId && !preAplicadoRef.current && (
            <p className="text-xs text-amber-700 mt-1">Informe o número do pedido de onde o item voltou para continuar.</p>
          )}
        </div>

        {/* Itens da origem */}
        {itens.length > 0 && (
          <div>
            <Label>Item *</Label>
            <div className="mt-2 border border-gray-200 rounded-lg divide-y max-h-64 overflow-y-auto">
              {itens.map((it) => (
                <button
                  key={it.item_id}
                  type="button"
                  disabled={it.disponivel <= 0}
                  onClick={() => { setSelected(it); setQuantity('') }}
                  className={`w-full text-left p-3 flex items-center justify-between gap-3 ${
                    selected?.item_id === it.item_id ? 'bg-amber-50' : 'hover:bg-gray-50'
                  } ${it.disponivel <= 0 ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                  <div className="min-w-0">
                    <p className="font-medium text-gray-900 truncate text-sm">{it.item_nome}</p>
                    <p className="text-xs text-gray-500">{it.item_codigo || 's/ código'} · {it.unidade || 'UN'}</p>
                  </div>
                  <span className="text-xs text-gray-600 flex-shrink-0 text-right">
                    Saiu {it.saiu} · estornado {it.estornado}<br />
                    <strong>disponível {it.disponivel}</strong>
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Quantidade */}
        <div>
          <Label htmlFor="qtd">Quantidade devolvida *{selected ? ` (máx. ${selected.disponivel})` : ''}</Label>
          <Input
            id="qtd"
            type="text"
            inputMode="numeric"
            value={quantity}
            disabled={!selected}
            onChange={(e) => setQuantity(e.target.value)}
            placeholder="0"
            className={`mt-1 max-w-[200px] ${qtyInvalida ? 'border-red-400' : ''}`}
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
            placeholder="Ex: Setor devolveu itens não utilizados..."
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
            disabled={submitting || !selected || qty === null || qtyInvalida || reason.trim().length < 3}
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
