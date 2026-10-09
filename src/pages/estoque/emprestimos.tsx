// =====================================================================
// Emprestimos / Doacoes / Permutas
// Gerencia a tabela `loans` (com `loan_items`).
// Permite criar novos registros e gerar PDF para impressao.
// Categorias: emprestimo | doacao | permuta | troca_validade
// =====================================================================

import { useState, useEffect, useRef } from 'react'
import { dataBR, lerQuantidade } from '@/lib/utils/seguro'
import { useNavigate } from 'react-router-dom'
import {
  ArrowLeft,
  AlertCircle,
  Loader2,
  Handshake,
  Plus,
  X,
  Printer,
  Search,
  Trash2,
} from 'lucide-react'
import { useAuth } from '@/contexts/auth'
import { useModule } from '@/contexts/module'
import { warehouseDispatchService } from '@/lib/services/warehouse-dispatch'
import { useTheme } from '@/contexts/theme'
import { Button } from '@/components/ui/button'
import { supabase } from '@/lib/supabase'
import { getErrorMessage } from '@/lib/utils/error-messages'

// ---------- Tipos ----------

type LoanCategory = 'emprestimo' | 'doacao' | 'permuta' | 'troca_validade'

const CATEGORY_LABEL: Record<LoanCategory, string> = {
  emprestimo: 'Emprestimo',
  doacao: 'Doacao',
  permuta: 'Permuta',
  troca_validade: 'Troca de Validade',
}

interface LoanItem {
  id?: string
  loan_id?: string
  item_id: string | null
  item_nome: string
  batch_number: string
  expiry_date: string
  quantity: number
  valor_unit: number | null
  valor_total: number | null
}

interface Loan {
  id: string
  loan_number: number
  destino: string
  categoria: LoanCategory
  status: 'pending' | 'closed' | 'cancelled'
  modulo?: 'farmacia' | 'almoxarifado'
  saida_id?: string | null
  observacao: string | null
  created_by: string | null
  created_at: string
  loan_items: LoanItem[]
}

interface PharmacyItemRow {
  id: string
  code: string | null
  name: string
  unit: string
  price: number | null
  saldo?: number
}

// ---------- Helpers ----------

// 'YYYY-MM-DD' (validade) sem passar por new Date(): em UTC-3 mostrava o dia anterior.
const fmtDate = (iso: string) => /^\d{4}-\d{2}-\d{2}$/.test(iso) ? dataBR(iso) :
  new Date(iso).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })

const fmtCurrency = (v: number | null) =>
  v != null
    ? v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
    : '—'

// ---------- Componente principal ----------

export function EmprestimosAbertos() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const { mode } = useTheme()

  const txt = mode === 'dark' ? '#fff' : '#0d2e1c'
  const txtSec =
    mode === 'dark' ? 'rgba(255,255,255,0.7)' : 'rgba(13,46,28,0.65)'
  const txtMut =
    mode === 'dark' ? 'rgba(255,255,255,0.45)' : 'rgba(13,46,28,0.45)'

  const glass: React.CSSProperties = {
    background:
      mode === 'dark' ? 'rgba(10,15,20,0.55)' : 'rgba(255,255,255,0.65)',
    backdropFilter: 'blur(30px)',
    WebkitBackdropFilter: 'blur(30px)',
    border: `1px solid ${mode === 'dark' ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.5)'}`,
    borderRadius: 16,
  }

  const inputStyle: React.CSSProperties = {
    background:
      mode === 'dark' ? 'rgba(0,0,0,0.3)' : 'rgba(255,255,255,0.7)',
    border: `1px solid ${mode === 'dark' ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.1)'}`,
    borderRadius: 10,
    padding: '9px 13px',
    fontSize: 14,
    color: txt,
    outline: 'none',
    width: '100%',
  }

  const labelStyle: React.CSSProperties = {
    color: txtSec,
    fontSize: 12,
    fontWeight: 600,
    marginBottom: 4,
    display: 'block',
  }

  // ---------- Estado principal ----------
  const [loans, setLoans] = useState<Loan[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // ---------- Modal ----------
  const [showModal, setShowModal] = useState(false)
  const [saving, setSaving] = useState(false)
  const salvandoRef = useRef(false)
  const [formError, setFormError] = useState('')

  const [destino, setDestino] = useState('')
  const [categoria, setCategoria] = useState<LoanCategory>('emprestimo')
  const [observacao, setObservacao] = useState('')

  const emptyItem = (): LoanItem => ({
    item_id: null,
    item_nome: '',
    batch_number: '',
    expiry_date: '',
    quantity: 1,
    valor_unit: null,
    valor_total: null,
  })
  const [formItems, setFormItems] = useState<LoanItem[]>([emptyItem()])
  const [itemSearches, setItemSearches] = useState<Record<number, string>>({})
  const [showDropdowns, setShowDropdowns] = useState<Record<number, boolean>>({})

  // Itens do catálogo do módulo ativo para busca (farmácia ou almoxarifado).
  // 09/10/2026: no almox a tela só achava itens da farmácia (Rafaela).
  const { activeModule, homeModule } = useModule()
  // Módulo ativo; sem ele (path neutro antes de escolher), o módulo do setor.
  const modulo: 'farmacia' | 'almoxarifado' =
    (activeModule ?? homeModule) === 'almoxarifado' ? 'almoxarifado' : 'farmacia'
  const [pharmacyItems, setPharmacyItems] = useState<PharmacyItemRow[]>([])

  // Loan selecionado para impressao
  const [printLoan, setPrintLoan] = useState<Loan | null>(null)

  // ---------- Carga de dados ----------

  const loadLoans = async () => {
    setLoading(true)
    try {
      const { data, error: err } = await supabase
        .from('loans')
        .select(
          `id, loan_number, destino, categoria, status, observacao, created_by, created_at, modulo, saida_id,
           loan_items ( id, loan_id, item_id, item_nome, batch_number, expiry_date, quantity, valor_unit, valor_total )`
        )
        .eq('modulo', modulo)
        .order('created_at', { ascending: false })
        .limit(100)
      if (err) throw err
      setLoans((data || []) as Loan[])
    } catch (e: any) {
      setError(getErrorMessage(e))
    } finally {
      setLoading(false)
    }
  }

  const loadPharmacyItems = async () => {
    if (modulo === 'almoxarifado') {
      // Valor = última compra; nunca comprado = valor referencial.
      const { data } = await supabase
        .from('warehouse_items')
        .select('id, code, name, unit, price, last_purchase_price, reference_price, current_stock')
        .eq('is_active', true)
        .order('name')
        .limit(3000)
      setPharmacyItems(((data || []) as any[]).map((w) => ({
        id: w.id, code: w.code, name: w.name, unit: w.unit,
        price: Number(w.last_purchase_price) || Number(w.reference_price) || Number(w.price) || null,
        saldo: w.current_stock ?? 0,
      })))
      return
    }
    const { data } = await supabase
      .from('pharmacy_items')
      .select('id, code, name, unit, price')
      .eq('is_active', true)
      .order('name')
      .limit(2000)
    setPharmacyItems((data || []) as PharmacyItemRow[])
  }

  useEffect(() => {
    loadLoans()
    loadPharmacyItems()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modulo])

  // ---------- Modal helpers ----------

  const openModal = () => {
    setDestino('')
    setCategoria('emprestimo')
    setObservacao('')
    setFormItems([emptyItem()])
    setItemSearches({})
    setShowDropdowns({})
    setFormError('')
    setShowModal(true)
  }

  const updateFormItem = (idx: number, patch: Partial<LoanItem>) => {
    setFormItems((prev) => {
      const next = [...prev]
      next[idx] = { ...next[idx], ...patch }
      if (patch.quantity !== undefined || patch.valor_unit !== undefined) {
        const item = next[idx]
        const vu = item.valor_unit
        next[idx].valor_total = vu != null ? item.quantity * vu : null
      }
      return next
    })
  }

  const selectPharmacyItem = (idx: number, pi: PharmacyItemRow) => {
    const qty = formItems[idx]?.quantity ?? 1
    updateFormItem(idx, {
      item_id: pi.id,
      item_nome: pi.name,
      valor_unit: pi.price ?? null,
      valor_total: pi.price != null ? qty * pi.price : null,
    })
    setItemSearches((m) => ({ ...m, [idx]: pi.name }))
    setShowDropdowns((m) => ({ ...m, [idx]: false }))
  }

  const filteredItems = (search: string) => {
    if (!search.trim()) return pharmacyItems.slice(0, 20)
    const q = search.toLowerCase()
    return pharmacyItems
      .filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          (p.code ?? '').toLowerCase().includes(q)
      )
      .slice(0, 20)
  }

  // ---------- Salvar ----------

  const handleSave = async () => {
    if (salvandoRef.current) return
    setFormError('')
    if (!destino.trim()) {
      setFormError('Destino obrigatorio.')
      return
    }
    if (formItems.length === 0) {
      setFormError('Adicione pelo menos um item.')
      return
    }
    for (const [i, fi] of formItems.entries()) {
      if (!fi.item_nome.trim()) {
        setFormError(`Item ${i + 1}: nome obrigatorio.`)
        return
      }
      if (fi.quantity <= 0) {
        setFormError(`Item ${i + 1}: quantidade invalida.`)
        return
      }
    }

    if (modulo === 'almoxarifado') {
      const semItem = formItems.findIndex((fi) => !fi.item_id)
      if (semItem >= 0) {
        setFormError(`Item ${semItem + 1}: escolha o produto na lista (precisa ser do cadastro para dar saída no estoque).`)
        return
      }
    }

    salvandoRef.current = true
    setSaving(true)
    try {
      // Almoxarifado: dá a saída no estoque ANTES de gravar (recusa se não houver saldo).
      let saida: { id: string; dispatch_number: number } | null = null
      if (modulo === 'almoxarifado') {
        const tipo = categoria === 'troca_validade' ? 'outro' : categoria
        saida = await warehouseDispatchService.create({
          items: formItems.map((fi) => ({ item_id: fi.item_id as string, quantity: fi.quantity })),
          destination_department_text: destino.trim(),
          dispatch_type: tipo as any,
          notes: `${CATEGORY_LABEL[categoria] ?? categoria} para ${destino.trim()}${observacao.trim() ? ' · ' + observacao.trim() : ''}`,
        } as any, crypto.randomUUID())
      }

      const { data: loanData, error: loanErr } = await supabase
        .from('loans')
        .insert({
          destino: destino.trim(),
          categoria,
          status: 'pending',
          observacao: observacao.trim() || null,
          created_by: user?.id ?? null,
          modulo,
          saida_id: saida?.id ?? null,
        })
        .select('id')
        .single()
      if (loanErr) {
        if (saida) throw new Error(`A saída nº ${saida.dispatch_number} já foi feita no estoque, mas o registro do empréstimo não gravou (${getErrorMessage(loanErr)}). Avise o suporte.`)
        throw loanErr
      }

      const loanId = loanData.id
      const itemsPayload = formItems.map((fi) => ({
        loan_id: loanId,
        item_id: fi.item_id,
        item_nome: fi.item_nome.trim(),
        batch_number: fi.batch_number.trim() || null,
        expiry_date: fi.expiry_date || null,
        quantity: fi.quantity,
        valor_unit: categoria === 'troca_validade' ? null : fi.valor_unit,
        valor_total: categoria === 'troca_validade' ? null : fi.valor_total,
      }))

      const { error: itemsErr } = await supabase
        .from('loan_items')
        .insert(itemsPayload)
      if (itemsErr) throw itemsErr

      setShowModal(false)
      await loadLoans()
      // Já abre o formulário pronto para imprimir/assinar.
      const { data: novo } = await supabase
        .from('loans')
        .select(`id, loan_number, destino, categoria, status, observacao, created_by, created_at, modulo, saida_id,
                 loan_items ( id, loan_id, item_id, item_nome, batch_number, expiry_date, quantity, valor_unit, valor_total )`)
        .eq('id', loanId)
        .maybeSingle()
      if (novo) handlePrint(novo as Loan)
    } catch (e: any) {
      setFormError(getErrorMessage(e))
    } finally {
      salvandoRef.current = false
      setSaving(false)
    }
  }

  // ---------- Impressao ----------

  const handlePrint = (loan: Loan) => {
    setPrintLoan(loan)
    setTimeout(() => window.print(), 200)
  }

  // ---------- Badges ----------

  const statusBadge = (status: Loan['status']) => {
    const map: Record<string, { label: string; color: string }> = {
      pending: { label: 'Pendente', color: '#f59e0b' },
      closed: { label: 'Encerrado', color: '#10b981' },
      cancelled: { label: 'Cancelado', color: '#ef4444' },
    }
    const s = map[status] ?? { label: status, color: txtMut }
    return (
      <span
        style={{
          fontSize: 11,
          fontWeight: 700,
          color: s.color,
          background: s.color + '22',
          borderRadius: 6,
          padding: '2px 8px',
          border: `1px solid ${s.color}44`,
        }}
      >
        {s.label}
      </span>
    )
  }

  const catBadge = (cat: LoanCategory) => (
    <span
      style={{
        fontSize: 11,
        color: txtMut,
        background:
          mode === 'dark'
            ? 'rgba(255,255,255,0.08)'
            : 'rgba(0,0,0,0.06)',
        borderRadius: 6,
        padding: '2px 8px',
      }}
    >
      {CATEGORY_LABEL[cat]}
    </span>
  )

  // ---------- Render ----------

  return (
    <>
      {/* Print styles */}
      <style>{`
        @media print {
          .no-print { display: none !important; }
          .print-only { display: block !important; }
        }
        .print-only { display: none; }
      `}</style>

      {/* Documento para impressao (visivel apenas ao imprimir) */}
      {printLoan && (
        <div className="print-only">
          <PrintDocument loan={printLoan} />
        </div>
      )}

      {/* Conteudo principal */}
      <div className="max-w-5xl mx-auto space-y-6 no-print">
        {/* Cabecalho */}
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <button
              onClick={() => navigate(-1)}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 40,
                height: 40,
                borderRadius: 10,
                cursor: 'pointer',
                background:
                  mode === 'dark'
                    ? 'rgba(255,255,255,0.1)'
                    : 'rgba(0,0,0,0.06)',
                border: `1px solid ${mode === 'dark' ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.08)'}`,
                color: txt,
              }}
            >
              <ArrowLeft size={18} />
            </button>
            <div>
              <h1
                className="text-2xl font-bold flex items-center gap-2"
                style={{ color: txt }}
              >
                <Handshake size={22} /> Emprestimos / Doacoes</h1>
              <p className="text-sm" style={{ color: txtSec }}>
                Controle de saidas por emprestimo, doacao, permuta e troca de
                validade.
              </p>
            </div>
          </div>

          <Button
            onClick={openModal}
            className="bg-emerald-600 hover:bg-emerald-700 text-white flex items-center gap-2"
          >
            <Plus size={16} /> Novo Emprestimo
          </Button>
        </div>

        {/* Erro global */}
        {error && (
          <div className="p-4 rounded-xl bg-red-100 border border-red-200 flex items-center gap-2 text-red-800 text-sm">
            <AlertCircle size={16} /> {error}
          </div>
        )}

        {/* Lista */}
        <div className="p-6 space-y-3" style={glass}>
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2
                className="w-6 h-6 animate-spin"
                style={{ color: txtMut }}
              />
            </div>
          ) : loans.length === 0 ? (
            <p className="text-sm text-center py-8" style={{ color: txtMut }}>
              Nenhum emprestimo registrado.
            </p>
          ) : (
            loans.map((loan) => (
              <LoanCard
                key={loan.id}
                loan={loan}
                mode={mode}
                txt={txt}
                txtSec={txtSec}
                txtMut={txtMut}
                statusBadge={statusBadge}
                catBadge={catBadge}
                onPrint={handlePrint}
              />
            ))
          )}
        </div>
      </div>

      {/* Modal Novo Emprestimo */}
      {showModal && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto py-8 px-4 no-print"
          style={{
            background: 'rgba(0,0,0,0.55)',
            backdropFilter: 'blur(4px)',
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowModal(false)
          }}
        >
          <div
            className="w-full max-w-3xl rounded-2xl p-6 space-y-5"
            style={{
              background:
                mode === 'dark'
                  ? 'rgba(10,18,26,0.97)'
                  : 'rgba(255,255,255,0.98)',
              border: `1px solid ${mode === 'dark' ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}`,
            }}
          >
            {/* Header modal */}
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold" style={{ color: txt }}>
                Novo Emprestimo / Doacao
              </h2>
              <button
                onClick={() => setShowModal(false)}
                style={{ color: txtMut, cursor: 'pointer' }}
              >
                <X size={20} />
              </button>
            </div>

            {formError && (
              <div className="p-3 rounded-xl bg-red-100 border border-red-200 text-red-800 text-sm flex items-center gap-2">
                <AlertCircle size={15} /> {formError}
              </div>
            )}

            {/* Campos principais */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="md:col-span-2">
                <label style={labelStyle}>Destino (instituicao) *</label>
                <input
                  style={inputStyle}
                  placeholder="Ex: Hospital Municipal de Salvador"
                  value={destino}
                  onChange={(e) => setDestino(e.target.value)}
                />
              </div>
              <div>
                <label style={labelStyle}>Categoria *</label>
                <select
                  style={inputStyle}
                  value={categoria}
                  onChange={(e) =>
                    setCategoria(e.target.value as LoanCategory)
                  }
                >
                  {(Object.keys(CATEGORY_LABEL) as LoanCategory[]).map((k) => (
                    <option key={k} value={k}>
                      {CATEGORY_LABEL[k]}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label style={labelStyle}>Observacao</label>
                <input
                  style={inputStyle}
                  placeholder="Opcional"
                  value={observacao}
                  onChange={(e) => setObservacao(e.target.value)}
                />
              </div>
            </div>

            {/* Itens */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <span
                  style={{
                    color: txtSec,
                    fontSize: 12,
                    fontWeight: 600,
                  }}
                >
                  Itens *
                </span>
                <button
                  onClick={() =>
                    setFormItems((prev) => [...prev, emptyItem()])
                  }
                  className="text-emerald-600 hover:text-emerald-500 flex items-center gap-1 text-sm font-medium"
                  style={{ cursor: 'pointer' }}
                >
                  <Plus size={14} /> Adicionar item
                </button>
              </div>

              <div className="space-y-3">
                {formItems.map((fi, idx) => (
                  <FormItemRow
                    key={idx}
                    idx={idx}
                    item={fi}
                    categoria={categoria}
                    mode={mode}
                    txt={txt}
                    txtSec={txtSec}
                    txtMut={txtMut}
                    inputStyle={inputStyle}
                    labelStyle={labelStyle}
                    searchValue={itemSearches[idx] ?? ''}
                    showDropdown={showDropdowns[idx] ?? false}
                    filteredItems={filteredItems}
                    onSearchChange={(v) => {
                      setItemSearches((m) => ({ ...m, [idx]: v }))
                      setShowDropdowns((m) => ({ ...m, [idx]: true }))
                      updateFormItem(idx, { item_id: null, item_nome: v })
                    }}
                    onSelectItem={(pi) => selectPharmacyItem(idx, pi)}
                    onCloseDropdown={() =>
                      setShowDropdowns((m) => ({ ...m, [idx]: false }))
                    }
                    onUpdate={(patch) => updateFormItem(idx, patch)}
                    onRemove={
                      formItems.length > 1
                        ? () =>
                            setFormItems((prev) =>
                              prev.filter((_, i) => i !== idx)
                            )
                        : undefined
                    }
                  />
                ))}
              </div>
            </div>

            {/* Acoes */}
            <div className="flex justify-end gap-3 pt-2">
              <Button
                variant="outline"
                onClick={() => setShowModal(false)}
                disabled={saving}
              >
                Cancelar
              </Button>
              <Button
                className="bg-emerald-600 hover:bg-emerald-700 text-white"
                onClick={handleSave}
                disabled={saving}
              >
                {saving ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : null}
                Salvar
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

// ---------- Card de emprestimo na lista ----------

interface LoanCardProps {
  loan: Loan
  mode: string
  txt: string
  txtSec: string
  txtMut: string
  statusBadge: (s: Loan['status']) => React.ReactNode
  catBadge: (c: LoanCategory) => React.ReactNode
  onPrint: (loan: Loan) => void
}

function LoanCard({
  loan,
  mode,
  txt,
  txtSec,
  txtMut,
  statusBadge,
  catBadge,
  onPrint,
}: LoanCardProps) {
  const [expanded, setExpanded] = useState(false)

  const totalValue = (loan.loan_items ?? []).reduce(
    (acc, i) => acc + (i.valor_total ?? 0),
    0
  )

  return (
    <div
      className="rounded-xl p-4 space-y-2"
      style={{
        background:
          mode === 'dark' ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.02)',
        border: `1px solid ${mode === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)'}`,
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-sm" style={{ color: txt }}>
              #{loan.loan_number} — {loan.destino}
            </span>
            {catBadge(loan.categoria)}
            {statusBadge(loan.status)}
          </div>
          <p className="text-xs mt-1" style={{ color: txtMut }}>
            {new Date(loan.created_at).toLocaleString('pt-BR', {
              day: '2-digit',
              month: '2-digit',
              year: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
            })}
            {totalValue > 0 && (
              <>
                {' '}
                &bull; Total:{' '}
                <span style={{ color: txtSec }}>
                  {totalValue.toLocaleString('pt-BR', {
                    style: 'currency',
                    currency: 'BRL',
                  })}
                </span>
              </>
            )}
          </p>
          {loan.observacao && (
            <p
              className="text-xs mt-0.5 italic"
              style={{ color: txtMut }}
            >
              "{loan.observacao}"
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => setExpanded((v) => !v)}
            style={{
              fontSize: 12,
              color: txtMut,
              cursor: 'pointer',
              padding: '4px 8px',
              borderRadius: 6,
              border: `1px solid ${mode === 'dark' ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)'}`,
            }}
          >
            {expanded ? 'Ocultar' : `${loan.loan_items?.length ?? 0} itens`}
          </button>
          <button
            onClick={() => onPrint(loan)}
            title="Gerar PDF"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              fontSize: 12,
              color: '#3b82f6',
              cursor: 'pointer',
              padding: '4px 10px',
              borderRadius: 6,
              border: '1px solid #3b82f633',
              background: '#3b82f611',
            }}
          >
            <Printer size={13} /> PDF
          </button>
        </div>
      </div>

      {expanded && (loan.loan_items ?? []).length > 0 && (
        <div
          className="rounded-lg overflow-hidden mt-2"
          style={{
            border: `1px solid ${mode === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)'}`,
          }}
        >
          <table
            style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}
          >
            <thead>
              <tr
                style={{
                  background:
                    mode === 'dark'
                      ? 'rgba(255,255,255,0.06)'
                      : 'rgba(0,0,0,0.04)',
                }}
              >
                {[
                  'Produto',
                  'Lote',
                  'Validade',
                  'Qtd',
                  'Vlr Unit',
                  'Vlr Total',
                ].map((h) => (
                  <th
                    key={h}
                    style={{
                      padding: '6px 10px',
                      textAlign: 'left',
                      color: txtMut,
                      fontWeight: 600,
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loan.loan_items.map((li, i) => (
                <tr
                  key={li.id ?? i}
                  style={{
                    borderTop: `1px solid ${mode === 'dark' ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)'}`,
                  }}
                >
                  <td style={{ padding: '6px 10px', color: txt }}>
                    {li.item_nome}
                  </td>
                  <td style={{ padding: '6px 10px', color: txtSec }}>
                    {li.batch_number || '—'}
                  </td>
                  <td style={{ padding: '6px 10px', color: txtSec }}>
                    {li.expiry_date ? fmtDate(li.expiry_date) : '—'}
                  </td>
                  <td style={{ padding: '6px 10px', color: txt }}>
                    {li.quantity}
                  </td>
                  <td style={{ padding: '6px 10px', color: txtSec }}>
                    {fmtCurrency(li.valor_unit)}
                  </td>
                  <td style={{ padding: '6px 10px', color: txtSec }}>
                    {fmtCurrency(li.valor_total)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ---------- Linha de item no formulario ----------

interface FormItemRowProps {
  idx: number
  item: LoanItem
  categoria: LoanCategory
  mode: string
  txt: string
  txtSec: string
  txtMut: string
  inputStyle: React.CSSProperties
  labelStyle: React.CSSProperties
  searchValue: string
  showDropdown: boolean
  filteredItems: (s: string) => PharmacyItemRow[]
  onSearchChange: (v: string) => void
  onSelectItem: (pi: PharmacyItemRow) => void
  onCloseDropdown: () => void
  onUpdate: (patch: Partial<LoanItem>) => void
  onRemove?: () => void
}

function FormItemRow({
  idx: _idx,
  item,
  categoria,
  mode,
  txt,
  txtSec: _txtSec,
  txtMut,
  inputStyle,
  labelStyle,
  searchValue,
  showDropdown,
  filteredItems,
  onSearchChange,
  onSelectItem,
  onCloseDropdown,
  onUpdate,
  onRemove,
}: FormItemRowProps) {
  const showValues = categoria !== 'troca_validade'

  return (
    <div
      className="rounded-xl p-3 space-y-3"
      style={{
        background:
          mode === 'dark' ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.02)',
        border: `1px solid ${mode === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)'}`,
        position: 'relative',
      }}
    >
      {onRemove && (
        <button
          onClick={onRemove}
          style={{
            position: 'absolute',
            top: 10,
            right: 10,
            color: '#ef4444',
            cursor: 'pointer',
          }}
          title="Remover item"
        >
          <Trash2 size={15} />
        </button>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {/* Busca de produto */}
        <div style={{ position: 'relative' }}>
          <label style={labelStyle}>
            <Search
              size={11}
              style={{ display: 'inline', marginRight: 4 }}
            />
            Produto *
          </label>
          <input
            style={inputStyle}
            placeholder="Buscar pelo nome ou codigo..."
            value={searchValue}
            onChange={(e) => onSearchChange(e.target.value)}
            onFocus={() => onSearchChange(searchValue)}
            onBlur={() => setTimeout(onCloseDropdown, 200)}
          />
          {showDropdown && filteredItems(searchValue).length > 0 && (
            <div
              style={{
                position: 'absolute',
                top: '100%',
                left: 0,
                right: 0,
                zIndex: 100,
                background: mode === 'dark' ? '#0f1a24' : '#fff',
                border: `1px solid ${mode === 'dark' ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.1)'}`,
                borderRadius: 10,
                marginTop: 4,
                maxHeight: 200,
                overflowY: 'auto',
              }}
            >
              {filteredItems(searchValue).map((pi) => (
                <button
                  key={pi.id}
                  onMouseDown={() => onSelectItem(pi)}
                  style={{
                    display: 'block',
                    width: '100%',
                    textAlign: 'left',
                    padding: '8px 12px',
                    fontSize: 13,
                    color: txt,
                    cursor: 'pointer',
                    borderBottom: `1px solid ${mode === 'dark' ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)'}`,
                  }}
                >
                  <span style={{ fontWeight: 600 }}>{pi.name}</span>
                  {pi.code && (
                    <span
                      style={{
                        color: txtMut,
                        marginLeft: 6,
                        fontSize: 11,
                      }}
                    >
                      {pi.code}
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Quantidade */}
        <div>
          <label style={labelStyle}>Quantidade *</label>
          <input
            type="text"
            inputMode="numeric"
            style={inputStyle}
            value={item.quantity || ''}
            onChange={(e) =>
              // vazio fica vazio (antes parseInt(v)||1 fazia "5" virar "15")
              onUpdate({ quantity: lerQuantidade(e.target.value) ?? 0 })
            }
          />
        </div>

        {/* Lote */}
        <div>
          <label style={labelStyle}>Lote</label>
          <input
            style={inputStyle}
            placeholder="Ex: LOT2024001"
            value={item.batch_number}
            onChange={(e) => onUpdate({ batch_number: e.target.value })}
          />
        </div>

        {/* Validade */}
        <div>
          <label style={labelStyle}>Validade</label>
          <input
            type="date"
            style={inputStyle}
            value={item.expiry_date}
            onChange={(e) => onUpdate({ expiry_date: e.target.value })}
          />
        </div>

        {showValues && (
          <>
            <div>
              <label style={labelStyle}>Valor Unitario (R$)</label>
              <input
                type="number"
                min={0}
                step={0.01}
                style={inputStyle}
                placeholder="0,00"
                value={item.valor_unit ?? ''}
                onChange={(e) => {
                  const v = parseFloat(e.target.value)
                  onUpdate({ valor_unit: isNaN(v) ? null : v })
                }}
                onWheel={(e) => e.currentTarget.blur()}
              />
            </div>

            <div>
              <label style={labelStyle}>Valor Total (R$)</label>
              <input
                type="number"
                min={0}
                step={0.01}
                style={{ ...inputStyle, opacity: 0.8 }}
                placeholder="Auto"
                value={item.valor_total ?? ''}
                onChange={(e) => {
                  const v = parseFloat(e.target.value)
                  onUpdate({ valor_total: isNaN(v) ? null : v })
                }}
                onWheel={(e) => e.currentTarget.blur()}
              />
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ---------- Documento para impressao ----------

function PrintDocument({ loan }: { loan: Loan }) {
  const totalValue = (loan.loan_items ?? []).reduce(
    (acc, i) => acc + (i.valor_total ?? 0),
    0
  )

  return (
    <div
      style={{
        fontFamily: 'Arial, sans-serif',
        fontSize: 12,
        color: '#000',
        padding: '20mm',
        maxWidth: '180mm',
        margin: '0 auto',
      }}
    >
      {/* Cabecalho */}
      <div style={{ textAlign: 'center', marginBottom: 24 }}>
        <p
          style={{
            fontWeight: 700,
            fontSize: 13,
            margin: 0,
            textTransform: 'uppercase',
          }}
        >
          HOSPITAL ESTADUAL COSTA DOS COQUEIROS - HECC
        </p>
        <p
          style={{
            fontWeight: 600,
            fontSize: 13,
            margin: '6px 0 0',
            textTransform: 'uppercase',
          }}
        >
          EMPRESTIMO / DOACAO DE MEDICAMENTO
        </p>
        <p style={{ margin: '4px 0 0', fontSize: 11, color: '#555' }}>
          N° {loan.loan_number} — {CATEGORY_LABEL[loan.categoria]}
        </p>
      </div>

      {/* Dados gerais */}
      <table
        style={{
          width: '100%',
          borderCollapse: 'collapse',
          marginBottom: 16,
        }}
      >
        <tbody>
          <tr>
            <td
              style={{ width: '50%', padding: '4px 0', verticalAlign: 'top' }}
            >
              <strong>Destino:</strong> {loan.destino}
            </td>
            <td
              style={{ width: '50%', padding: '4px 0', verticalAlign: 'top' }}
            >
              <strong>Data:</strong>{' '}
              {new Date(loan.created_at).toLocaleDateString('pt-BR', {
                day: '2-digit',
                month: '2-digit',
                year: 'numeric',
              })}
            </td>
          </tr>
          {loan.observacao && (
            <tr>
              <td colSpan={2} style={{ padding: '4px 0' }}>
                <strong>Observacao:</strong> {loan.observacao}
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {/* Tabela de itens */}
      <table
        style={{
          width: '100%',
          borderCollapse: 'collapse',
          border: '1px solid #999',
          marginBottom: 20,
        }}
      >
        <thead>
          <tr style={{ background: '#f0f0f0' }}>
            {[
              'Produto',
              'Qtd',
              'Apresentacao',
              'Lote',
              'Validade',
              'Valor Unit',
              'Valor Total',
            ].map((h) => (
              <th
                key={h}
                style={{
                  border: '1px solid #999',
                  padding: '5px 6px',
                  textAlign: 'left',
                  fontSize: 11,
                  fontWeight: 700,
                }}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {(loan.loan_items ?? []).map((li, i) => (
            <tr key={li.id ?? i}>
              <td style={{ border: '1px solid #ccc', padding: '5px 6px' }}>
                {li.item_nome}
              </td>
              <td
                style={{
                  border: '1px solid #ccc',
                  padding: '5px 6px',
                  textAlign: 'center',
                }}
              >
                {li.quantity}
              </td>
              <td style={{ border: '1px solid #ccc', padding: '5px 6px' }} />
              <td style={{ border: '1px solid #ccc', padding: '5px 6px' }}>
                {li.batch_number || '—'}
              </td>
              <td style={{ border: '1px solid #ccc', padding: '5px 6px' }}>
                {li.expiry_date ? fmtDate(li.expiry_date) : '—'}
              </td>
              <td
                style={{
                  border: '1px solid #ccc',
                  padding: '5px 6px',
                  textAlign: 'right',
                }}
              >
                {loan.categoria === 'troca_validade'
                  ? '—'
                  : fmtCurrency(li.valor_unit)}
              </td>
              <td
                style={{
                  border: '1px solid #ccc',
                  padding: '5px 6px',
                  textAlign: 'right',
                }}
              >
                {loan.categoria === 'troca_validade'
                  ? '—'
                  : fmtCurrency(li.valor_total)}
              </td>
            </tr>
          ))}
        </tbody>
        {loan.categoria !== 'troca_validade' && totalValue > 0 && (
          <tfoot>
            <tr style={{ background: '#f8f8f8' }}>
              <td
                colSpan={6}
                style={{
                  border: '1px solid #ccc',
                  padding: '5px 6px',
                  textAlign: 'right',
                  fontWeight: 700,
                }}
              >
                TOTAL
              </td>
              <td
                style={{
                  border: '1px solid #ccc',
                  padding: '5px 6px',
                  textAlign: 'right',
                  fontWeight: 700,
                }}
              >
                {totalValue.toLocaleString('pt-BR', {
                  style: 'currency',
                  currency: 'BRL',
                })}
              </td>
            </tr>
          </tfoot>
        )}
      </table>

      {/* Assinaturas */}
      <div
        style={{
          display: 'flex',
          gap: 24,
          marginTop: 40,
          justifyContent: 'space-between',
        }}
      >
        {['Entregue por (responsável):', 'Recebido por (nome legível e documento):'].map((label) => (
          <div key={label} style={{ flex: 1, textAlign: 'center' }}>
            <div
              style={{
                borderTop: '1px solid #000',
                paddingTop: 6,
                marginTop: 40,
                fontSize: 11,
              }}
            >
              {label}
            </div>
          </div>
        ))}
      </div>

      <p
        style={{
          marginTop: 24,
          fontSize: 10,
          color: '#888',
          textAlign: 'center',
        }}
      >
        Documento gerado em{' '}
        {new Date().toLocaleString('pt-BR', {
          day: '2-digit',
          month: '2-digit',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        })}
      </p>
    </div>
  )
}
