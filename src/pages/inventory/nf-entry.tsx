import { useState, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  ArrowLeft, FileText, Building2, Search, Plus, Trash2, Loader2, Package, CheckCircle2, AlertCircle,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { CurrencyInput } from '@/components/ui/currency-input'
import { supabase } from '@/lib/supabase'
import { getErrorMessage } from '@/lib/utils/error-messages'
import { suppliersService } from '@/lib/services/farmacia-cadastros'
import { externalUnitsService } from '@/lib/services/external-units'
import { useAuth } from '@/contexts/auth'
interface NfEntryProps {
  type: 'pharmacy' | 'warehouse'
}

interface ItemRow {
  id: string
  code: string | null
  name: string
  unit: string
}

interface LineItem {
  item_id: string
  name: string
  code: string
  unit: string
  quantity: number
  batch_number: string
  expiry_date: string
  unit_price: number
}

// Tipos de entrada. 'Compra' exige NF/AFM; os demais não.
// 'Inventário' = entrada por contagem/acerto de estoque (recontagem), sem NF.
const ENTRY_TYPES = ['Compra', 'Empréstimo', 'Doação', 'Permuta', 'Consignado', 'Troca de validade', 'Inventário'] as const

// Rotulo mostrado na tela. O VALOR gravado continua 'Inventário' — a farmacia
// chama de "Ajuste por inventário", mas ja existem 86 entradas gravadas com o
// nome antigo. Trocar o valor partiria o historico e os relatorios em dois
// nomes para a mesma coisa.
const ENTRY_TYPE_LABEL: Partial<Record<EntryType, string>> = {
  'Inventário': 'Ajuste por inventário',
}
type EntryType = typeof ENTRY_TYPES[number]

function formatCNPJ(value: string) {
  const n = value.replace(/\D/g, '').slice(0, 14)
  return n
    .replace(/(\d{2})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1/$2')
    .replace(/(\d{4})(\d)/, '$1-$2')
}

export function NfEntry({ type }: NfEntryProps) {
  const navigate = useNavigate()
  // Usado só pra recarregar os fornecedores QUANDO a sessão estiver pronta —
  // sem isso, se a lista carregava antes da sessão ser restaurada, a consulta
  // caía como anônima e voltava vazia (dropdown de Fornecedor sem opções).
  const { user } = useAuth()
  // ?loc=<CAF|SAT_1|SAT_2|SAT_T|ALMOX> — de qual estoque veio o botao. A
  // entrada eh gravada NESSE estoque. Sem query param, fallback pro central
  // (CAF pra farmacia, ALMOX pro almoxarifado) — comportamento antigo.
  const [searchParams] = useSearchParams()
  const locationCode = searchParams.get('loc') || (type === 'pharmacy' ? 'CAF' : 'ALMOX')
  // Rotulo bonito pra mostrar no rodape "Destino: ..."
  const LOC_LABELS: Record<string, string> = {
    CAF: 'CAF',
    SAT_1: 'Satélite 1º Andar',
    SAT_2: 'Satélite 2º Andar',
    SAT_T: 'Satélite Térreo',
    ALMOX: 'Almoxarifado',
  }
  const locationLabel = LOC_LABELS[locationCode] ?? locationCode
  const table = type === 'pharmacy' ? 'pharmacy_items' : 'warehouse_items'
  const backTo = type === 'pharmacy' ? '/inventory/pharmacy' : '/inventory/warehouse'
  const today = new Date().toISOString().slice(0, 10)

  // Cabeçalho
  const [entryType, setEntryType] = useState<EntryType>('Compra')
  const isCompra = entryType === 'Compra'
  // No Inventário não existe fornecedor — não pode ser obrigatório.
  const isInventario = entryType === 'Inventário'
  const [invoiceNumber, setInvoiceNumber] = useState('')
  const [invoiceDate, setInvoiceDate] = useState(today)     // emissão da NF
  const [deliveryDate, setDeliveryDate] = useState(today)   // chegada no hospital
  const [afmNumber, setAfmNumber] = useState('')
  const [supplierCnpj, setSupplierCnpj] = useState('')
  const [supplierName, setSupplierName] = useState('')

  // Lista suspensa de origem (Suppliers + Unidades Externas + "Outro")
  interface OrigemOption { tipo: 'supplier' | 'external_unit' | 'outro'; nome: string; cnpj?: string }
  const [origens, setOrigens] = useState<OrigemOption[]>([])
  const [origemKey, setOrigemKey] = useState<string>('') // "tipo|nome"

  useEffect(() => {
    // Só busca depois que há usuário autenticado (senão a query vai como anônima
    // e a RLS devolve vazio). Re-roda quando o user aparece.
    if (!user) return
    (async () => {
      const [sup, ext] = await Promise.all([
        suppliersService.list().catch((e) => { console.error('suppliers.list', e); return [] }),
        externalUnitsService.list().catch((e) => { console.error('externalUnits.list', e); return [] }),
      ])
      const opts: OrigemOption[] = [
        ...sup.map((s: any) => ({ tipo: 'supplier' as const, nome: s.name, cnpj: s.cnpj })),
        // A tabela external_units usa a coluna "name" (nao "nome"): mapear errado
        // deixava nome undefined e o sort abaixo estourava, zerando a lista toda.
        ...ext.map((e: any) => ({ tipo: 'external_unit' as const, nome: e.name, cnpj: e.cnpj || '' })),
      ]
        .filter((o) => !!o.nome)
        .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))
      setOrigens(opts)
    })()
  }, [user?.id])

  function onOrigemChange(key: string) {
    setOrigemKey(key)
    if (!key || key === 'outro|') {
      // Outro: limpa e libera pra digitar
      setSupplierName('')
      setSupplierCnpj('')
      return
    }
    const [, nome] = key.split('|')
    const found = origens.find((o) => `${o.tipo}|${o.nome}` === key)
    setSupplierName(found?.nome || nome)
    if (found?.cnpj) setSupplierCnpj(formatCNPJ(found.cnpj))
  }

  const isOutro = origemKey === 'outro|'

  const [lines, setLines] = useState<LineItem[]>([])
  const [search, setSearch] = useState('')
  const [results, setResults] = useState<ItemRow[]>([])
  const [searching, setSearching] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  useEffect(() => {
    const t = setTimeout(async () => {
      const q = search.trim()
      if (!q) { setResults([]); return }
      setSearching(true)
      const { data, error: err } = await supabase
        .from(table)
        .select('id, code, name, unit')
        .eq('is_active', true)
        .or(`name.ilike.%${q}%,code.ilike.%${q}%`)
        .order('name')
        .limit(20)
      if (err) console.error(err)
      setResults((data || []) as ItemRow[])
      setSearching(false)
    }, 200)
    return () => clearTimeout(t)
  }, [search, table])

  function addLine(item: ItemRow) {
    // O MESMO item pode entrar em várias linhas — uma por LOTE. Uma NF costuma
    // trazer o mesmo medicamento em lotes diferentes, e cada linha carrega seu
    // batch_number/validade. A RPC trata cada linha de forma independente e
    // cria/incrementa o lote por (item, lote, local).
    setLines((prev) => [...prev, {
      item_id: item.id, name: item.name, code: item.code || '', unit: item.unit || 'UN',
      quantity: 1, batch_number: '', expiry_date: '', unit_price: 0,
    }])
    setSearch(''); setResults([])
  }
  function updateLine(idx: number, patch: Partial<LineItem>) {
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)))
  }
  function removeLine(idx: number) {
    setLines((prev) => prev.filter((_, i) => i !== idx))
  }

  const totalQty = lines.reduce((s, l) => s + (l.quantity || 0), 0)
  const totalValue = lines.reduce((s, l) => s + (l.quantity || 0) * (l.unit_price || 0), 0)

  // Lote e validade sao obrigatorios pra QUALQUER entrada — sem eles,
  // o controle de FEFO e de vencimento do estoque quebra. Se o produto
  // legitimamente nao tem lote, o operador pode digitar "S/L" ou similar.
  const canSubmit =
    // Fornecedor obrigatório em tudo, MENOS no Inventário (não tem fornecedor).
    (isInventario || supplierName.trim()) &&
    // Compra exige NF + data de emissão. AFM deixou de ser obrigatório.
    (!isCompra || (invoiceNumber.trim() && invoiceDate)) &&
    lines.length > 0 &&
    lines.every((l) => l.quantity > 0 && l.batch_number.trim() && l.expiry_date)

  async function handleSubmit() {
    setError(null)
    if (!canSubmit) {
      // Erro especifico se o problema for lote/validade em alguma linha
      const missingLotValid = lines.some((l) => l.quantity > 0 && (!l.batch_number.trim() || !l.expiry_date))
      if (missingLotValid) {
        setError('Preencha Lote e Validade em TODAS as linhas — obrigatórios pra rastreabilidade e FEFO.')
        return
      }
      setError(isCompra
        ? 'Para Compra, preencha NF, data de emissão, fornecedor e ao menos uma linha válida.'
        : isInventario
          ? 'Adicione ao menos uma linha com quantidade, lote e validade.'
          : 'Informe a origem/fornecedor e ao menos uma linha com quantidade válida.')
      return
    }
    setSubmitting(true)
    try {
      const { data, error: rpcError } = await supabase.rpc('registrar_entrada_nf', {
        p_item_type: type,
        p_invoice_number: invoiceNumber.trim() || null,
        p_invoice_date: invoiceDate || null,
        p_delivery_date: deliveryDate || null,
        p_afm_number: afmNumber.trim() || null,
        p_supplier_cnpj: supplierCnpj.trim() || null,
        p_supplier_name: supplierName.trim(),
        p_acquisition_type: entryType,
        p_location_code: locationCode,
        p_items: lines.map((l) => ({
          item_id: l.item_id,
          quantity: l.quantity,
          unit_price: l.unit_price,
          batch_number: l.batch_number.trim() || null,
          expiry_date: l.expiry_date || null,
        })),
      })
      if (rpcError) throw rpcError
      const n = (data as any)?.itens ?? lines.length
      setToast(`Entrada (${entryType}) registrada: ${n} ${n === 1 ? 'item' : 'itens'}.`)
      setTimeout(() => navigate(backTo), 1200)
    } catch (e: any) {
      console.error('Entry error:', e)
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
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2 flex-wrap">
            <FileText className="w-6 h-6 text-emerald-600" />
            Nova Entrada — {type === 'pharmacy' ? 'Farmácia' : 'Almoxarifado'}
          </h1>
          <p className="text-sm text-gray-500">Lance vários itens de uma vez. Escolha o tipo de entrada.</p>
        </div>
      </div>

      {/* Dados da entrada */}
      <div className="bg-white border border-gray-100 rounded-xl shadow-sm p-6 space-y-4">
        <div className="flex items-center gap-2 text-sm font-semibold text-gray-700 border-b pb-2">
          <FileText className="w-4 h-4" /> Dados da Entrada
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <Label htmlFor="etype">Tipo de Entrada *</Label>
            <select
              id="etype"
              value={entryType}
              onChange={(e) => setEntryType(e.target.value as EntryType)}
              className="mt-1 w-full h-9 rounded-md border border-input px-3 py-1 bg-white text-sm"
            >
              {ENTRY_TYPES.map((t) => <option key={t} value={t}>{ENTRY_TYPE_LABEL[t] ?? t}</option>)}
            </select>
          </div>
          <div>
            <Label htmlFor="nf">Número da NF {isCompra ? '*' : '(opcional)'}</Label>
            <Input id="nf" value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} placeholder="Ex: NF-123456" className="mt-1" />
          </div>
          <div>
            <Label htmlFor="data">Data de Emissão da NF {isCompra ? '*' : ''}</Label>
            <Input id="data" type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} className="mt-1" />
          </div>
          <div>
            <Label htmlFor="entrega">Data de Entrega</Label>
            <Input id="entrega" type="date" value={deliveryDate} onChange={(e) => setDeliveryDate(e.target.value)} className="mt-1" title="Dia em que o item chegou no hospital" />
          </div>
          <div>
            <Label htmlFor="afm">Número da AFM (opcional)</Label>
            <Input id="afm" value={afmNumber} onChange={(e) => setAfmNumber(e.target.value)} placeholder="Ex: AFM-2026-001" className="mt-1" />
          </div>
          <div>
            <Label htmlFor="forn">{isCompra ? 'Fornecedor *' : isInventario ? 'Fornecedor / Origem (opcional)' : 'Fornecedor / Origem *'}</Label>
            <select
              id="forn"
              value={origemKey}
              onChange={(e) => onOrigemChange(e.target.value)}
              className="mt-1 w-full h-9 rounded-md border border-input bg-white px-3 py-1 text-sm"
            >
              <option value="">— selecionar —</option>
              {origens.map((o) => (
                <option key={`${o.tipo}|${o.nome}`} value={`${o.tipo}|${o.nome}`}>
                  {o.nome} {o.tipo === 'external_unit' ? '(externa)' : ''}
                </option>
              ))}
              <option value="outro|">Outro (digitar)</option>
            </select>
            {isOutro && (
              <Input
                value={supplierName}
                onChange={(e) => setSupplierName(e.target.value)}
                placeholder={isCompra ? 'Empresa fornecedora' : 'Quem forneceu / origem'}
                className="mt-2"
              />
            )}
          </div>
          <div>
            <Label htmlFor="cnpj">CNPJ {isOutro || !origemKey ? '(opcional)' : ''}</Label>
            <Input
              id="cnpj"
              value={supplierCnpj}
              onChange={(e) => setSupplierCnpj(formatCNPJ(e.target.value))}
              placeholder="00.000.000/0000-00"
              maxLength={18}
              className="mt-1"
              readOnly={!!origemKey && !isOutro}
            />
          </div>
        </div>
      </div>

      {/* Itens */}
      <div className="bg-white border border-gray-100 rounded-xl shadow-sm p-6 space-y-4">
        <div className="flex items-center gap-2 text-sm font-semibold text-gray-700 border-b pb-2">
          <Package className="w-4 h-4" /> Itens da Entrada
        </div>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar item por nome ou código para adicionar..." className="pl-9" />
          {search.trim() && (
            <div className="absolute z-20 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-64 overflow-y-auto">
              {searching ? (
                <div className="px-4 py-3 text-sm text-gray-400 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Buscando...</div>
              ) : results.length === 0 ? (
                <div className="px-4 py-3 text-sm text-gray-400">Nenhum item encontrado.</div>
              ) : results.map((i) => {
                // Item já na lista NÃO é mais bloqueado: clicar de novo cria
                // outra linha, pra lançar um segundo lote do mesmo item.
                const qtdLinhas = lines.filter((l) => l.item_id === i.id).length
                return (
                  <button key={i.id} onClick={() => addLine(i)}
                    className="w-full text-left px-4 py-2.5 border-b last:border-0 hover:bg-gray-50 flex items-center justify-between">
                    <span className="text-sm font-medium text-gray-900 flex items-center gap-1">
                      <Plus className="w-3.5 h-3.5" /> {i.name}
                      {qtdLinhas > 0 && (
                        <span className="text-xs text-blue-500 ml-1">
                          ({qtdLinhas} {qtdLinhas === 1 ? 'lote' : 'lotes'} — clique p/ outro)
                        </span>
                      )}
                    </span>
                    <span className="text-xs text-gray-400">{i.code || 'sem código'} · {i.unit}</span>
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {lines.length === 0 ? (
          <p className="text-sm text-center py-6 text-gray-400">Nenhum item adicionado. Use a busca acima.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-gray-400 uppercase border-b">
                  <th className="text-left py-2 pr-2">Item</th>
                  <th className="text-right py-2 px-2 w-24">Qtd *</th>
                  <th className="text-left py-2 px-2 w-32">Lote *</th>
                  <th className="text-left py-2 px-2 w-36">Validade *</th>
                  <th className="text-right py-2 px-2 w-32">Vlr. Unit.</th>
                  <th className="text-right py-2 px-2 w-28">Total</th>
                  <th className="w-10"></th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l, idx) => (
                  <tr key={l.item_id} className="border-b last:border-0">
                    <td className="py-2 pr-2">
                      <p className="font-medium text-gray-900">{l.name}</p>
                      <p className="text-xs text-gray-400">{l.code || 'sem código'} · {l.unit}</p>
                    </td>
                    <td className="py-2 px-2">
                      <Input
                        type="number"
                        min={1}
                        value={l.quantity === 0 ? '' : l.quantity}
                        placeholder="0"
                        onFocus={(e) => e.target.select()}
                        onChange={(e) => updateLine(idx, { quantity: e.target.value === '' ? 0 : parseInt(e.target.value) || 0 })}
                        onWheel={(e) => e.currentTarget.blur()}
                        className="w-20 text-right"
                      />
                    </td>
                    <td className="py-2 px-2">
                      <Input
                        value={l.batch_number}
                        onChange={(e) => updateLine(idx, { batch_number: e.target.value })}
                        placeholder="Obrigatório"
                        className={`w-28 ${!l.batch_number.trim() ? 'border-red-300 focus:border-red-500' : ''}`}
                      />
                    </td>
                    <td className="py-2 px-2">
                      <Input
                        type="date"
                        value={l.expiry_date}
                        onChange={(e) => updateLine(idx, { expiry_date: e.target.value })}
                        className={`w-36 ${!l.expiry_date ? 'border-red-300 focus:border-red-500' : ''}`}
                      />
                    </td>
                    <td className="py-2 px-2">
                      <div className="w-28 ml-auto"><CurrencyInput value={l.unit_price} onChange={(v) => updateLine(idx, { unit_price: v as number })} /></div>
                    </td>
                    <td className="py-2 px-2 text-right font-medium text-gray-700">
                      R$ {((l.quantity || 0) * (l.unit_price || 0)).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </td>
                    <td className="py-2 text-right">
                      <button onClick={() => removeLine(idx)} className="text-red-500 hover:text-red-600 p-1"><Trash2 className="w-4 h-4" /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-gray-200 font-semibold text-gray-800">
                  <td className="py-2 pr-2 text-right">Totais</td>
                  <td className="py-2 px-2 text-right">{totalQty}</td>
                  <td colSpan={3}></td>
                  <td className="py-2 px-2 text-right">R$ {totalValue.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      {error && (
        <div className="p-3 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2"><AlertCircle className="w-4 h-4" /> {error}</div>
      )}

      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-gray-500 flex items-center gap-1"><Building2 className="w-4 h-4" /> Destino: {locationLabel}</p>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => navigate(backTo)}>Cancelar</Button>
          <Button onClick={handleSubmit} disabled={!canSubmit || submitting} className="bg-emerald-600 hover:bg-emerald-700 text-white">
            {submitting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <CheckCircle2 className="w-4 h-4 mr-2" />}
            Registrar Entrada
          </Button>
        </div>
      </div>

      {toast && (
        <div className="fixed bottom-6 right-6 z-50 flex items-center gap-2 px-5 py-3 rounded-xl shadow-lg bg-green-600 text-white text-sm font-medium"><CheckCircle2 className="w-5 h-5" /> {toast}</div>
      )}
    </div>
  )
}
