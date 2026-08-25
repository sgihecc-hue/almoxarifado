// =====================================================================
// Entrada por Leitor — ALMOXARIFADO
//
// Alternativa a tela de Nova Entrada (inventory/nf-entry-warehouse.tsx),
// pensada pra quem esta com o leitor na mao e uma pilha de caixas: o
// almoxarife passa o leitor na etiqueta, o item cai na lista sozinho e
// ele so digita LOTE, VALIDADE e QUANTIDADE. Nada de mouse pra procurar
// item.
//
// NAO substitui a tela de entrada atual — ela continua existindo e e a
// indicada quando a entrada tem NF, valores e fornecedor pra lancar.
// Aqui o cabecalho (NF/fornecedor) fica recolhido e opcional de
// proposito: obrigar a preencher a cada leva mata o ganho de tempo.
//
// Grava pela MESMA RPC da entrada normal (registrar_entrada_nf) com
// p_location_code 'ALMOX' — a RPC credita warehouse_items.current_stock
// e a movimentacao aparece sozinha no livro (v_almox_movimentacao).
// Nao encosta em nada da farmacia.
// =====================================================================

import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowLeft, Barcode, Trash2, Loader2, CheckCircle2, AlertCircle, ChevronDown,
  ChevronRight, FileText,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { supabase } from '@/lib/supabase'
import { itemsService } from '@/lib/services/items'
import { getErrorMessage } from '@/lib/utils/error-messages'
import { useBarcodeScanner } from '@/hooks/use-barcode-scanner'
import type { Item } from '@/lib/services/items'

interface LineItem {
  // Identidade da LINHA, nao do item: a mesma caixa pode vir com lotes
  // diferentes, entao cada leitura vira uma linha propria.
  _uid: string
  item_id: string
  name: string
  code: string
  unit: string
  quantity: number
  batch_number: string
  expiry_date: string
}

// Mesmas opcoes da tela de entrada do almoxarifado. 'Inventario' fica de
// fora aqui tambem — no almox ele nao aparece.
const ENTRY_TYPES = ['Compra', 'Empréstimo', 'Doação', 'Consignado', 'Troca de validade'] as const
type EntryType = typeof ENTRY_TYPES[number]

// Esta tela e do almoxarifado central. Nunca chumbar id de estoque: a RPC
// resolve o local pelo codigo.
const LOCATION_CODE = 'ALMOX'

function formatCNPJ(value: string) {
  const n = value.replace(/\D/g, '').slice(0, 14)
  return n
    .replace(/(\d{2})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1/$2')
    .replace(/(\d{4})(\d)/, '$1-$2')
}

export function EntradaLeitor() {
  const navigate = useNavigate()
  const backTo = '/inventory/warehouse'
  const today = new Date().toISOString().slice(0, 10)

  // Cabeçalho recolhido — opcional, so o tipo de entrada fica sempre visivel
  const [showHeader, setShowHeader] = useState(false)
  const [entryType, setEntryType] = useState<EntryType>('Compra')
  const [invoiceNumber, setInvoiceNumber] = useState('')
  const [invoiceDate, setInvoiceDate] = useState(today)
  const [afmNumber, setAfmNumber] = useState('')
  const [supplierCnpj, setSupplierCnpj] = useState('')
  const [supplierName, setSupplierName] = useState('')

  const [lines, setLines] = useState<LineItem[]>([])
  const [lookingUp, setLookingUp] = useState(false)
  const [notFound, setNotFound] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  const scanInputRef = useRef<HTMLInputElement>(null)
  // Campo de LOTE de cada linha, pra mandar o foco pra la depois da leitura
  const batchRefs = useRef<Record<string, HTMLInputElement | null>>({})

  // Foco no campo de leitura ao abrir a tela
  useEffect(() => {
    scanInputRef.current?.focus()
  }, [])

  const focusScan = useCallback(() => {
    scanInputRef.current?.focus()
  }, [])

  const addLine = useCallback((item: Item) => {
    const uid = `${item.id}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    setLines((prev) => [...prev, {
      _uid: uid,
      item_id: item.id,
      name: item.name,
      code: item.code || '',
      unit: item.unit || 'UN',
      quantity: 1,
      batch_number: '',
      expiry_date: '',
    }])
    // Depois que o React pintar a linha, o foco vai pro Lote dela. Se por
    // algum motivo o campo nao existir, o foco volta pro leitor — nunca
    // pode ficar solto, senao a proxima leitura se perde.
    setTimeout(() => {
      const el = batchRefs.current[uid]
      if (el) el.focus()
      else focusScan()
    }, 60)
  }, [focusScan])

  // Leitura do scanner: acha o item e joga na lista
  const handleScan = useCallback(async (barcode: string) => {
    const code = barcode.trim()
    if (!code) return
    setLookingUp(true)
    setNotFound(null)
    try {
      // 1. Busca pelo campo barcode do catalogo do almoxarifado
      const found = await itemsService.findByBarcode(code, 'warehouse')
      if (found) {
        addLine(found.item)
        return
      }

      // 2. Sem barcode → tenta o proprio codigo SIMPAS. As etiquetas
      // impressas pelo hospital (/almox/etiquetas) levam o codigo do item,
      // e nem todo item teve o campo barcode preenchido.
      const { data, error: err } = await supabase
        .from('warehouse_items')
        .select('*')
        .eq('is_active', true)
        .ilike('code', code)
        .limit(1)
      if (err) console.error('Busca por código:', err)
      const byCode = (data || [])[0] as Item | undefined
      if (byCode) {
        addLine(byCode)
        return
      }

      // 3. Nao achou: avisa QUAL etiqueta falhou e segue pronto pra
      // proxima leitura — a tela nao trava.
      setNotFound(code)
      focusScan()
    } finally {
      setLookingUp(false)
    }
  }, [addLine, focusScan])

  // O hook so intercepta quando o foco esta fora de input comum ou dentro
  // do input marcado com data-barcode-input — por isso digitar lote e
  // validade nao dispara leitura.
  useBarcodeScanner({ onScan: handleScan, enabled: true })

  function updateLine(uid: string, patch: Partial<LineItem>) {
    setLines((prev) => prev.map((l) => (l._uid === uid ? { ...l, ...patch } : l)))
  }
  function removeLine(uid: string) {
    setLines((prev) => prev.filter((l) => l._uid !== uid))
    delete batchRefs.current[uid]
    focusScan()
  }

  const totalQty = lines.reduce((s, l) => s + (l.quantity || 0), 0)
  const canSubmit = lines.length > 0 && lines.every((l) => l.quantity > 0)

  async function handleSubmit() {
    setError(null)
    if (!canSubmit) {
      setError('Leia ao menos um item e informe uma quantidade válida.')
      return
    }
    setSubmitting(true)
    try {
      const { data, error: rpcError } = await supabase.rpc('registrar_entrada_nf', {
        p_item_type: 'warehouse',
        p_invoice_number: invoiceNumber.trim() || null,
        p_invoice_date: invoiceDate || null,
        p_afm_number: afmNumber.trim() || null,
        p_supplier_cnpj: supplierCnpj.trim() || null,
        // Fornecedor e opcional nesta tela; quando em branco fica registrado
        // como entrada por leitura de etiqueta, pra nao gravar origem vazia.
        p_supplier_name: supplierName.trim() || 'Entrada por leitor',
        p_acquisition_type: entryType,
        p_location_code: LOCATION_CODE,
        p_items: lines.map((l) => ({
          item_id: l.item_id,
          quantity: l.quantity,
          unit_price: 0,
          batch_number: l.batch_number.trim() || null,
          expiry_date: l.expiry_date || null,
        })),
      })
      if (rpcError) throw rpcError
      const n = (data as any)?.itens ?? lines.length
      setToast(`Entrada registrada: ${n} ${n === 1 ? 'linha' : 'linhas'}.`)
      setTimeout(() => navigate(backTo), 1200)
    } catch (e: any) {
      console.error('Entrada por leitor:', e)
      setError(getErrorMessage(e))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex items-center gap-4">
        <button onClick={() => navigate(backTo)} className="flex items-center justify-center w-10 h-10 rounded-lg border border-gray-200 bg-white hover:bg-gray-50">
          <ArrowLeft className="w-5 h-5 text-gray-600" />
        </button>
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Barcode className="w-6 h-6 text-blue-600" />
            Entrada por Leitor — Almoxarifado
          </h1>
          <p className="text-sm text-gray-500">
            Passe o leitor na etiqueta e preencha só lote, validade e quantidade.
          </p>
        </div>
      </div>

      {/* Cabeçalho enxuto: tipo sempre visivel, NF/fornecedor recolhidos */}
      <div className="bg-white border border-gray-100 rounded-xl shadow-sm p-4 space-y-4">
        <div className="flex flex-wrap items-end gap-4">
          <div className="w-56">
            <Label htmlFor="etype">Tipo de Entrada</Label>
            <select
              id="etype"
              value={entryType}
              onChange={(e) => setEntryType(e.target.value as EntryType)}
              className="mt-1 w-full h-9 rounded-md border border-input px-3 py-1 bg-white text-sm"
            >
              {ENTRY_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <button
            type="button"
            onClick={() => setShowHeader((v) => !v)}
            className="h-9 flex items-center gap-1 text-sm font-medium text-gray-600 hover:text-gray-900"
          >
            {showHeader ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
            <FileText className="w-4 h-4" /> Nota fiscal e fornecedor (opcional)
          </button>
        </div>

        {showHeader && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2 border-t border-gray-100">
            <div>
              <Label htmlFor="nf">Número da NF</Label>
              <Input id="nf" value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} placeholder="Ex: NF-123456" className="mt-1" />
            </div>
            <div>
              <Label htmlFor="data">Data</Label>
              <Input id="data" type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} className="mt-1 w-fit min-w-[180px]" />
            </div>
            <div>
              <Label htmlFor="afm">Número da AFM</Label>
              <Input id="afm" value={afmNumber} onChange={(e) => setAfmNumber(e.target.value)} placeholder="Ex: AFM-2026-001" className="mt-1" />
            </div>
            <div>
              <Label htmlFor="cnpj">CNPJ</Label>
              <Input id="cnpj" value={supplierCnpj} onChange={(e) => setSupplierCnpj(formatCNPJ(e.target.value))} placeholder="00.000.000/0000-00" maxLength={18} className="mt-1" />
            </div>
            <div className="md:col-span-2">
              <Label htmlFor="forn">Fornecedor / Origem</Label>
              <Input id="forn" value={supplierName} onChange={(e) => setSupplierName(e.target.value)} placeholder="Quem forneceu / origem" className="mt-1" />
            </div>
          </div>
        )}
      </div>

      {/* Campo de leitura em destaque */}
      <div className="rounded-xl border-2 border-blue-400 bg-blue-50 p-4">
        <div className="flex items-center gap-3">
          <Barcode className="w-6 h-6 text-blue-600 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-blue-900">
              Aponte o leitor para a etiqueta
            </p>
            <p className="text-xs text-blue-600 mt-0.5">
              Cada leitura vira uma linha. Ler o mesmo código duas vezes cria outra linha — uma por lote.
            </p>
          </div>
          <input
            ref={scanInputRef}
            data-barcode-input="true"
            readOnly
            placeholder={lookingUp ? 'Buscando...' : 'Aguardando leitura...'}
            className={`w-48 h-9 px-2 text-xs rounded border text-center ${
              lookingUp ? 'bg-yellow-50 border-yellow-400' : 'bg-white border-blue-300'
            } focus:outline-none focus:ring-2 focus:ring-blue-400`}
            onBlur={() => {
              // O foco so pode sair daqui pra um campo da lista (lote,
              // validade, quantidade). Se foi parar em qualquer outro
              // lugar, volta — sem isso a segunda leitura se perde.
              setTimeout(() => {
                const el = document.activeElement as HTMLElement | null
                if (!el || !el.closest('[data-entrada-leitor-campo="true"]')) {
                  scanInputRef.current?.focus()
                }
              }, 120)
            }}
          />
          {lookingUp && <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />}
        </div>

        {notFound && (
          <div className="mt-3 p-3 rounded-lg bg-amber-50 border border-amber-300 text-sm text-amber-900 flex items-start gap-2">
            <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              Código <span className="font-mono font-semibold">{notFound}</span> não encontrado no catálogo do almoxarifado.
              Confira a etiqueta ou cadastre o item pela tela de Nova Entrada. Pode continuar lendo os outros.
            </div>
            <button onClick={() => { setNotFound(null); focusScan() }} className="text-amber-700 hover:text-amber-900 text-xs font-medium">
              Dispensar
            </button>
          </div>
        )}
      </div>

      {/* Linhas lidas */}
      <div className="bg-white border border-gray-100 rounded-xl shadow-sm p-6 space-y-4">
        {lines.length === 0 ? (
          <p className="text-sm text-center py-8 text-gray-400">
            Nenhuma leitura ainda. Passe o leitor na etiqueta do material.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-gray-400 uppercase border-b">
                  <th className="text-left py-2 pr-2">Item</th>
                  <th className="text-left py-2 px-2 w-36">Lote</th>
                  <th className="text-left py-2 px-2 w-40">Validade</th>
                  <th className="text-right py-2 px-2 w-24">Qtd</th>
                  <th className="w-10"></th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={l._uid} className="border-b last:border-0">
                    <td className="py-2 pr-2">
                      <p className="font-medium text-gray-900">{l.name}</p>
                      <p className="text-xs text-gray-400">{l.code || 'sem código'} · {l.unit}</p>
                    </td>
                    <td className="py-2 px-2" data-entrada-leitor-campo="true">
                      <Input
                        ref={(el) => { batchRefs.current[l._uid] = el }}
                        value={l.batch_number}
                        onChange={(e) => updateLine(l._uid, { batch_number: e.target.value })}
                        placeholder="Lote"
                        className="w-32"
                      />
                    </td>
                    <td className="py-2 px-2" data-entrada-leitor-campo="true">
                      <Input
                        type="date"
                        value={l.expiry_date}
                        onChange={(e) => updateLine(l._uid, { expiry_date: e.target.value })}
                        className="w-36"
                      />
                    </td>
                    <td className="py-2 px-2" data-entrada-leitor-campo="true">
                      <Input
                        type="number"
                        min={1}
                        value={l.quantity === 0 ? '' : l.quantity}
                        placeholder="0"
                        onFocus={(e) => e.target.select()}
                        onChange={(e) => updateLine(l._uid, { quantity: e.target.value === '' ? 0 : parseInt(e.target.value) || 0 })}
                        onWheel={(e) => e.currentTarget.blur()}
                        onKeyDown={(e) => {
                          // Enter na quantidade = linha terminada: devolve o
                          // foco pro leitor pra proxima caixa.
                          if (e.key === 'Enter') {
                            e.preventDefault()
                            focusScan()
                          }
                        }}
                        className="w-20 text-right"
                      />
                    </td>
                    <td className="py-2 text-right">
                      <button onClick={() => removeLine(l._uid)} className="text-red-500 hover:text-red-600 p-1" title="Remover linha">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {error && (
        <div className="p-3 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2">
          <AlertCircle className="w-4 h-4" /> {error}
        </div>
      )}

      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-gray-500">
          {lines.length} {lines.length === 1 ? 'linha' : 'linhas'} · {totalQty} {totalQty === 1 ? 'unidade' : 'unidades'} · Destino: Almoxarifado
        </p>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => navigate(backTo)}>Cancelar</Button>
          <Button onClick={handleSubmit} disabled={!canSubmit || submitting} className="bg-emerald-600 hover:bg-emerald-700 text-white">
            {submitting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <CheckCircle2 className="w-4 h-4 mr-2" />}
            Registrar Entrada
          </Button>
        </div>
      </div>

      {toast && (
        <div className="fixed bottom-6 right-6 z-50 flex items-center gap-2 px-5 py-3 rounded-xl shadow-lg bg-green-600 text-white text-sm font-medium">
          <CheckCircle2 className="w-5 h-5" /> {toast}
        </div>
      )}
    </div>
  )
}
