import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Clock, CheckCircle2, Loader2, AlertCircle, ExternalLink, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { supabase } from '@/lib/supabase'
import { pharmacyLoanService } from '@/lib/services/pharmacy-loan'
import type { LoanSummary } from '@/lib/services/pharmacy-loan'

interface PendingItem {
  id: string
  item_description: string
  unit: string | null
  quantity: number
  batch_number: string | null
  validity_date: string | null
  unit_price: number | null
  confirmed_at: string | null
  direction: 'enviando' | 'recebendo'
}

interface PendingLoan extends LoanSummary {
  items: PendingItem[]
}

export function LoansPendencias({ scope }: { scope: 'pharmacy' | 'warehouse' }) {
  const navigate = useNavigate()
  const [loans, setLoans] = useState<PendingLoan[]>([])
  const [loading, setLoading] = useState(true)
  const [confirming, setConfirming] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const confirmandoRef = useRef(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void load()
  }, [scope])

  async function load() {
    setLoading(true); setError(null)
    try {
      const pending = await pharmacyLoanService.listPending(scope)
      if (pending.length === 0) { setLoans([]); return }
      const ids = pending.map((l) => l.id)
      const { data: items, error: err } = await supabase
        .from('pharmacy_loan_items')
        .select('id, loan_id, item_description, unit, quantity, batch_number, validity_date, unit_price, confirmed_at, direction')
        .in('loan_id', ids)
      if (err) throw err
      const byLoan: Record<string, PendingItem[]> = {}
      for (const it of items || []) {
        (byLoan[it.loan_id] = byLoan[it.loan_id] || []).push(it as any)
      }
      setLoans(pending.map((l) => ({ ...l, items: byLoan[l.id] || [] })))
    } catch (e: any) {
      setError(e?.message || 'Erro ao carregar pendências')
    } finally {
      setLoading(false)
    }
  }

  async function confirmItem(loanId: string, itemId: string) {
    if (confirmandoRef.current) return
    confirmandoRef.current = true
    setConfirming(itemId); setError(null); setAviso(null)
    try {
      const r = await pharmacyLoanService.confirmItem(loanId, itemId)
      setAviso(r.concluido ? 'Item confirmado e estoque movimentado. Formulário concluído.' : 'Item confirmado e estoque movimentado.')
      await load()
    } catch (e: any) {
      setError(e?.message || 'Erro ao confirmar item')
    } finally {
      confirmandoRef.current = false
      setConfirming(null)
    }
  }

  async function confirmAll(loanId: string) {
    if (confirmandoRef.current) return
    if (!confirm('Confirmar TODOS os itens deste formulário? Cada item confirmado movimenta o estoque.')) return
    confirmandoRef.current = true
    setConfirming(loanId); setError(null); setAviso(null)
    try {
      await pharmacyLoanService.confirmAll(loanId)
      setAviso('Formulário concluído: todos os itens confirmados e estoque movimentado.')
      await load()
    } catch (e: any) {
      setError(e?.message || 'Erro ao aprovar todos')
    } finally {
      confirmandoRef.current = false
      setConfirming(null)
    }
  }

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2 text-gray-900">
            <Clock className="w-6 h-6" /> Movimentações Pendentes
            <span className="text-xs font-semibold px-2 py-1 rounded-full bg-amber-100 text-amber-800 border border-amber-200">
              {scope === 'pharmacy' ? 'Farmácia' : 'Almoxarifado'}
            </span>
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Aprove item por item ou clique em "Aprovar tudo" pra concluir o formulário.
          </p>
        </div>
        <Button variant="outline" onClick={load} disabled={loading}>
          {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
          Atualizar
        </Button>
      </div>

      {aviso && (
        <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm">{aviso}</div>
      )}
      {error && (
        <div className="p-4 rounded-xl bg-red-100 border border-red-200 flex items-center gap-2 text-red-800 text-sm">
          <AlertCircle size={16} /> {error}
        </div>
      )}

      {loading ? (
        <div className="text-center py-12 text-gray-500">
          <Loader2 className="w-6 h-6 animate-spin inline mr-2" /> Carregando...
        </div>
      ) : loans.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-xl border border-gray-100">
          <CheckCircle2 className="w-12 h-12 text-emerald-500 mx-auto mb-3" />
          <p className="text-gray-700 font-semibold">Nenhuma movimentação pendente.</p>
          <p className="text-xs text-gray-500 mt-1">Tudo em ordem por aqui.</p>
        </div>
      ) : (
        loans.map((loan) => {
          const confirmedCount = loan.items.filter((i) => i.confirmed_at).length
          const totalCount = loan.items.length
          const allConfirmed = confirmedCount === totalCount
          return (
            <div key={loan.id} className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
              <div className="p-5 border-b border-gray-100 flex items-center justify-between gap-4 flex-wrap">
                <div className="flex items-center gap-3 flex-wrap">
                  <span className="text-xs px-2 py-1 rounded-full bg-blue-100 text-blue-800 font-semibold">
                    Formulário #{loan.form_number}
                  </span>
                  <span className="text-sm font-semibold text-gray-900">
                    {loan.origem} → {loan.destino}
                  </span>
                  <span className="text-xs text-gray-500">
                    {format(new Date(loan.form_date + 'T00:00:00'), "dd/MM/yyyy", { locale: ptBR })}
                  </span>
                  <span className={`text-xs px-2 py-1 rounded-full font-medium ${
                    allConfirmed ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
                  }`}>
                    {confirmedCount}/{totalCount} itens confirmados
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline" size="sm"
                    onClick={() => navigate(`/farmacia/movimentacoes/${loan.id}`)}
                  >
                    <ExternalLink className="w-3.5 h-3.5 mr-1" /> Detalhes
                  </Button>
                  <Button
                    size="sm"
                    className="bg-emerald-600 hover:bg-emerald-700 text-white"
                    onClick={() => confirmAll(loan.id)}
                    disabled={confirming === loan.id || allConfirmed}
                  >
                    {confirming === loan.id ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Check className="w-3.5 h-3.5 mr-1" />}
                    Aprovar tudo
                  </Button>
                </div>
              </div>
              <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[720px]">
                <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
                  <tr>
                    <th className="text-left px-4 py-2">Direção</th>
                    <th className="text-left px-4 py-2">Item</th>
                    <th className="text-right px-4 py-2">Qtd</th>
                    <th className="text-left px-4 py-2">Lote</th>
                    <th className="text-left px-4 py-2">Validade</th>
                    <th className="text-center px-4 py-2">Ação</th>
                  </tr>
                </thead>
                <tbody>
                  {loan.items.map((it) => (
                    <tr key={it.id} className={`border-t border-gray-100 ${it.confirmed_at ? 'bg-emerald-50/40' : ''}`}>
                      <td className="px-4 py-2 text-xs uppercase text-gray-500">{it.direction}</td>
                      <td className="px-4 py-2 text-gray-900">{it.item_description}</td>
                      <td className="px-4 py-2 text-right">{it.quantity} {it.unit || ''}</td>
                      <td className="px-4 py-2 text-gray-500">{it.batch_number || '—'}</td>
                      <td className="px-4 py-2 text-gray-500">
                        {it.validity_date ? format(new Date(it.validity_date + 'T00:00:00'), "dd/MM/yyyy") : '—'}
                      </td>
                      <td className="px-4 py-2 text-center">
                        {it.confirmed_at ? (
                          <span className="inline-flex items-center gap-1 text-xs text-emerald-700 font-semibold">
                            <CheckCircle2 size={14} /> Confirmado
                          </span>
                        ) : (
                          <Button
                            variant="outline" size="sm"
                            onClick={() => confirmItem(loan.id, it.id)}
                            disabled={confirming === it.id}
                          >
                            {confirming === it.id ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Check className="w-3 h-3 mr-1" />}
                            Confirmar
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            </div>
          )
        })
      )}
    </div>
  )
}
