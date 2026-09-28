import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowLeft, Search, Plus, Trash2, Loader2, AlertCircle, Package2, Barcode,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { supabase } from '@/lib/supabase'
import { getErrorMessage } from '@/lib/utils/error-messages'
import { lerQuantidade } from '@/lib/utils/seguro'
import { warehouseDispatchService, DISPATCH_TYPE_LABELS, type DispatchType } from '@/lib/services/warehouse-dispatch'
import { itemsService } from '@/lib/services/items'
import { useBarcodeScanner } from '@/hooks/use-barcode-scanner'
import type { Item } from '@/lib/services/items'

interface SelectedItem {
  item_id: string
  name: string
  code: string
  barcode?: string | null
  unit: string
  current_stock: number
  // Texto digitado (convertido so ao validar/enviar): parseInt(v)||1 num input
  // controlado fazia "5" virar "15" ao apagar e redigitar.
  quantity: string
}

interface Department {
  id: string
  name: string
}

export function NewWarehouseDispatch() {
  const navigate = useNavigate()

  // Form state
  const [destinationType, setDestinationType] = useState<'interno' | 'externo'>('interno')
  const [departmentId, setDepartmentId] = useState<string>('')
  const [departmentText, setDepartmentText] = useState<string>('')
  const [dispatchType, setDispatchType] = useState<DispatchType>('consumo')
  const [notes, setNotes] = useState('')

  // Departments
  const [departments, setDepartments] = useState<Department[]>([])

  // Items state
  const [allItems, setAllItems] = useState<Item[]>([])
  const [itemSearch, setItemSearch] = useState('')
  const [selectedItems, setSelectedItems] = useState<SelectedItem[]>([])
  const [loadingItems, setLoadingItems] = useState(true)

  // Scanner mode
  const [scannerMode, setScannerMode] = useState(false)
  const [scannerLookup, setScannerLookup] = useState(false)
  const scanInputRef = useRef<HTMLInputElement>(null)
  const quantityRefs = useRef<Record<string, HTMLInputElement | null>>({})

  // Submit state
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  // Trava de duplo clique (o estado do React nao bloqueia o 2o clique no mesmo
  // tick) e chave da rodada: repetir o envio nao grava a saida duas vezes.
  const enviandoRef = useRef(false)
  const chaveRef = useRef<string>(crypto.randomUUID())

  useEffect(() => {
    loadItems()
    loadDepartments()
  }, [])

  // Foca o input de scan quando ativa o modo scanner
  useEffect(() => {
    if (scannerMode && scanInputRef.current) {
      scanInputRef.current.focus()
    }
  }, [scannerMode])

  async function loadItems() {
    try {
      setLoadingItems(true)
      const { data, error } = await supabase
        .from('warehouse_items')
        .select('*')
        .eq('is_active', true)
        .order('name')
      if (error) throw error
      setAllItems((data as any) || [])
    } catch (e) {
      console.error('Error loading items:', e)
      setError('Não foi possível carregar os itens do almoxarifado: ' + getErrorMessage(e) + ' Recarregue a página.')
    } finally {
      setLoadingItems(false)
    }
  }

  async function loadDepartments() {
    try {
      const { data, error } = await supabase
        .from('departments')
        .select('id, name')
        .order('name')
      if (error) throw error
      setDepartments((data as any) || [])
    } catch (e) {
      console.error('Error loading departments:', e)
      setError('Não foi possível carregar os setores: ' + getErrorMessage(e) + ' Recarregue a página.')
    }
  }

  const addItem = useCallback((item: Item) => {
    setSelectedItems((prev) => {
      const existing = prev.find((s) => s.item_id === item.id)
      if (existing) {
        // Scan duplicado → incrementa quantidade
        return prev.map((s) =>
          s.item_id === item.id ? { ...s, quantity: String((lerQuantidade(s.quantity) ?? 0) + 1) } : s,
        )
      }
      return [
        ...prev,
        {
          item_id: item.id,
          name: item.name,
          code: item.code,
          barcode: (item as any).barcode,
          unit: item.unit || 'UN',
          current_stock: item.current_stock || 0,
          quantity: '1',
        },
      ]
    })
    setItemSearch('')
  }, [])

  // Handler do scanner: busca por barcode no banco
  const handleScan = useCallback(
    async (barcode: string) => {
      if (!scannerMode) return
      setScannerLookup(true)
      try {
        // 1. Busca no banco pelo barcode
        const result = await itemsService.findByBarcode(barcode, 'warehouse')

        if (result) {
          addItem(result.item)
          toast.success(`${result.item.name} adicionado`, {
            description: `Código de barras: ${barcode}`,
            duration: 2000,
          })
          // Foca o campo de quantidade do item recém-adicionado
          setTimeout(() => {
            const qtyInput = quantityRefs.current[result.item.id]
            if (qtyInput) qtyInput.focus()
            else scanInputRef.current?.focus()
          }, 100)
        } else {
          // Sem barcode → tenta o campo "code"
          const local = allItems.find(
            (i) => i.code?.toLowerCase() === barcode.toLowerCase(),
          )
          if (local) {
            addItem(local)
            toast.success(`${local.name} adicionado`, {
              description: `Código: ${barcode}`,
              duration: 2000,
            })
            setTimeout(() => {
              const qtyInput = quantityRefs.current[local.id]
              if (qtyInput) qtyInput.focus()
              else scanInputRef.current?.focus()
            }, 100)
          } else {
            toast.error('Produto não encontrado', {
              description: `Código "${barcode}" não está cadastrado. Use a busca por nome ou cadastre o produto primeiro.`,
              duration: 4000,
            })
            scanInputRef.current?.focus()
          }
        }
      } finally {
        setScannerLookup(false)
      }
    },
    [scannerMode, allItems, addItem],
  )

  // Hook global para capturar scan quando o input de scan está focado
  useBarcodeScanner({
    onScan: handleScan,
    enabled: scannerMode,
  })

  const filteredItems = allItems
    .filter((item) => {
      if (!itemSearch.trim()) return false
      const q = itemSearch.toLowerCase()
      return (
        item.name.toLowerCase().includes(q) ||
        (item.code || '').toLowerCase().includes(q)
      )
    })
    .filter((item) => !selectedItems.some((s) => s.item_id === item.id))

  const removeItem = (itemId: string) => {
    setSelectedItems((prev) => prev.filter((i) => i.item_id !== itemId))
  }

  const updateQuantity = (itemId: string, qty: string) => {
    setSelectedItems((prev) =>
      prev.map((i) => (i.item_id === itemId ? { ...i, quantity: qty } : i)),
    )
  }
  const qtd = (i: SelectedItem) => lerQuantidade(i.quantity)

  const hasDestination =
    destinationType === 'interno'
      ? !!departmentId
      : departmentText.trim().length > 0
  const allItemsValid =
    selectedItems.length > 0 &&
    selectedItems.every((i) => { const q = qtd(i); return q !== null && q > 0 && q <= i.current_stock })
  const canSubmit = hasDestination && allItemsValid

  const handleSubmit = async () => {
    if (!canSubmit || enviandoRef.current) return
    enviandoRef.current = true
    setSubmitting(true)
    setError('')
    try {
      await warehouseDispatchService.create({
        destination_department_id:
          destinationType === 'interno' ? departmentId || undefined : undefined,
        destination_department_text:
          destinationType === 'externo' ? departmentText.trim() : undefined,
        dispatch_type: dispatchType,
        notes: notes || undefined,
        items: selectedItems.map((i) => ({ item_id: i.item_id, quantity: qtd(i) as number })),
      }, chaveRef.current)
      // sucesso: nao reabilita o botao — sai da tela
      navigate('/saida-direta')
    } catch (e: any) {
      setError(getErrorMessage(e))
      enviandoRef.current = false
      setSubmitting(false)
    }
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="sm" onClick={() => navigate('/saida-direta')}>
          <ArrowLeft className="w-4 h-4 mr-2" />
          Voltar
        </Button>
        <div className="flex items-center gap-3">
          <div className="p-3 bg-primary-100 rounded-lg">
            <Package2 className="w-6 h-6 text-primary-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Nova Saída Direta</h1>
            <p className="text-sm text-gray-500">
              Registre uma saída do almoxarifado sem solicitação prévia. O estoque é abatido automaticamente.
            </p>
          </div>
        </div>
      </div>

      {error && (
        <div className="p-4 rounded-lg bg-red-50 border border-red-200 flex items-center gap-2 text-red-800 text-sm">
          <AlertCircle className="w-4 h-4" /> {error}
        </div>
      )}

      {/* Destination */}
      <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Destino</h2>

        <div className="flex gap-2 mb-4 p-1 bg-gray-100 rounded-lg w-fit">
          <button
            type="button"
            onClick={() => {
              setDestinationType('interno')
              setDepartmentText('')
              setDispatchType('consumo')
            }}
            className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
              destinationType === 'interno'
                ? 'bg-white text-primary-700 shadow-sm'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            Setor interno
          </button>
          <button
            type="button"
            onClick={() => {
              setDestinationType('externo')
              setDepartmentId('')
              if (dispatchType === 'consumo') setDispatchType('doacao')
            }}
            className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
              destinationType === 'externo'
                ? 'bg-white text-primary-700 shadow-sm'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            Unidade externa
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {destinationType === 'interno' ? (
            <div className="md:col-span-2">
              <Label htmlFor="department">Setor / Departamento *</Label>
              <select
                id="department"
                value={departmentId}
                onChange={(e) => setDepartmentId(e.target.value)}
                className="mt-1 w-full h-9 rounded-md border border-input bg-white px-3 py-1 text-sm"
              >
                <option value="">— Selecione —</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
              <p className="text-xs text-gray-500 mt-1">
                Se o destino for uma unidade externa (outro hospital), troque a opção acima.
              </p>
            </div>
          ) : (
            <div className="md:col-span-2">
              <Label htmlFor="department_text">Nome da unidade externa *</Label>
              <Input
                id="department_text"
                value={departmentText}
                onChange={(e) => setDepartmentText(e.target.value)}
                placeholder="Ex: Hospital São Rafael, UPA Lauro de Freitas, SAMU"
                className="mt-1"
                autoFocus
              />
              <p className="text-xs text-gray-500 mt-1">
                Digite o nome do hospital, posto ou unidade que vai receber os itens.
              </p>
            </div>
          )}
          <div className="md:col-span-2">
            <Label htmlFor="dispatch_type">Tipo de Saída *</Label>
            <select
              id="dispatch_type"
              value={dispatchType}
              onChange={(e) => setDispatchType(e.target.value as DispatchType)}
              className="mt-1 w-full h-9 rounded-md border border-input bg-white px-3 py-1 text-sm"
            >
              {(Object.keys(DISPATCH_TYPE_LABELS) as DispatchType[]).map((key) => (
                <option key={key} value={key}>
                  {DISPATCH_TYPE_LABELS[key]}
                </option>
              ))}
            </select>
          </div>
          <div className="md:col-span-2">
            <Label htmlFor="notes">Observações</Label>
            <textarea
              id="notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Observações adicionais (opcional)"
              rows={2}
              className="mt-1 w-full rounded-md border border-input bg-white px-3 py-2 text-sm"
            />
          </div>
        </div>
      </div>

      {/* Items */}
      <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900">Itens</h2>

          {/* Botão Modo Scanner */}
          <button
            type="button"
            onClick={() => setScannerMode((v) => !v)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors border ${
              scannerMode
                ? 'bg-blue-600 text-white border-blue-700 shadow-md'
                : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
            }`}
          >
            <Barcode className="w-4 h-4" />
            {scannerMode ? 'Scanner ativo' : 'Modo Scanner'}
          </button>
        </div>

        {/* Barra de scan ativo */}
        {scannerMode && (
          <div className="mb-4 p-3 rounded-lg border-2 border-blue-400 bg-blue-50 flex items-center gap-3">
            <Barcode className="w-5 h-5 text-blue-600 flex-shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-medium text-blue-900">
                Modo Scanner ativo — aponte o leitor para o produto
              </p>
              <p className="text-xs text-blue-600 mt-0.5">
                Scan duplicado incrementa a quantidade. Clique em "Scanner ativo" para desativar.
              </p>
            </div>
            <input
              ref={scanInputRef}
              data-barcode-input="true"
              readOnly
              placeholder={scannerLookup ? 'Buscando...' : 'Aguardando scan...'}
              className={`w-40 h-8 px-2 text-xs rounded border text-center ${
                scannerLookup ? 'bg-yellow-50 border-yellow-400' : 'bg-white border-blue-300'
              } focus:outline-none focus:ring-2 focus:ring-blue-400`}
              onBlur={() => {
                // Re-foca após blur para manter o input sempre pronto
                setTimeout(() => scanInputRef.current?.focus(), 100)
              }}
            />
            {scannerLookup && <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />}
          </div>
        )}

        {/* Busca manual (visível quando scanner desativado) */}
        {!scannerMode && (
          <div className="relative mb-4">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <Input
              type="text"
              placeholder="Buscar item por nome ou código..."
              value={itemSearch}
              onChange={(e) => setItemSearch(e.target.value)}
              className="pl-9"
            />
          </div>
        )}

        {/* Dropdown de resultados (só busca manual) */}
        {!scannerMode && filteredItems.length > 0 && (
          <div className="mb-4 rounded-lg border border-gray-200 overflow-hidden max-h-60 overflow-y-auto">
            {filteredItems.slice(0, 20).map((item) => (
              <div
                key={item.id}
                onClick={() => addItem(item)}
                className="flex items-center justify-between px-4 py-2 cursor-pointer hover:bg-gray-50 border-b border-gray-100 last:border-b-0"
              >
                <div className="min-w-0 flex-1">
                  <span className="font-medium text-sm text-gray-900">{item.name}</span>
                  <span className="text-xs text-gray-500 ml-2">{item.code}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-gray-500">
                    Estoque:{' '}
                    <span
                      className={`font-semibold ${
                        (item.current_stock || 0) > 0 ? 'text-emerald-600' : 'text-red-500'
                      }`}
                    >
                      {item.current_stock || 0}
                    </span>{' '}
                    {item.unit}
                  </span>
                  <Plus className="w-4 h-4 text-emerald-600" />
                </div>
              </div>
            ))}
          </div>
        )}

        {loadingItems && (
          <div className="text-center py-4 text-gray-500">
            <Loader2 className="w-5 h-5 animate-spin inline-block mr-2" /> Carregando itens...
          </div>
        )}

        {selectedItems.length === 0 ? (
          <div className="text-center py-8 rounded-lg border-2 border-dashed border-gray-200 text-gray-500">
            {scannerMode
              ? 'Aponte o scanner para adicionar itens'
              : 'Nenhum item adicionado. Use a busca acima para encontrar e adicionar.'}
          </div>
        ) : (
          <div className="space-y-2">
            {selectedItems.map((item) => {
              const q = qtd(item)
              const overStock = q !== null && q > item.current_stock
              const invalida = q === null || q <= 0
              return (
                <div
                  key={item.item_id}
                  className={`flex items-center gap-4 px-4 py-3 rounded-lg border ${
                    overStock ? 'border-red-300 bg-red-50' : 'border-gray-200 bg-gray-50'
                  }`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm text-gray-900 truncate">{item.name}</div>
                    <div className="text-xs text-gray-500 flex items-center gap-2">
                      <span>{item.code}</span>
                      {item.barcode && (
                        <span className="flex items-center gap-0.5 text-blue-500">
                          <Barcode className="w-3 h-3" />
                          {item.barcode}
                        </span>
                      )}
                      <span>| Estoque: {item.current_stock} {item.unit}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Label className="text-xs">Qtd:</Label>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={item.quantity}
                      ref={(el) => { quantityRefs.current[item.item_id] = el }}
                      onChange={(e) => updateQuantity(item.item_id, e.target.value)}
                      onWheel={(e) => e.currentTarget.blur()}
                      onKeyDown={(e) => {
                        // Tab ou Enter no campo quantidade → volta pro scan
                        if (scannerMode && (e.key === 'Tab' || e.key === 'Enter')) {
                          e.preventDefault()
                          scanInputRef.current?.focus()
                        }
                      }}
                      className="w-20 px-2 py-1 text-sm text-center border border-gray-300 rounded"
                    />
                    <span className="text-xs text-gray-500">{item.unit}</span>
                  </div>
                  {overStock && (
                    <span className="text-xs text-red-600 whitespace-nowrap">Excede estoque!</span>
                  )}
                  {invalida && (
                    <span className="text-xs text-red-600 whitespace-nowrap">Quantidade inteira maior que zero</span>
                  )}
                  <button
                    onClick={() => removeItem(item.item_id)}
                    className="text-red-500 hover:text-red-700 p-1"
                    title="Remover"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Submit */}
      <div className="flex justify-end gap-3">
        <Button variant="outline" onClick={() => navigate('/saida-direta')}>
          Cancelar
        </Button>
        <Button
          className="bg-primary-500 hover:bg-primary-600 text-white"
          onClick={handleSubmit}
          disabled={!canSubmit || submitting}
        >
          {submitting ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin mr-2" />
              Registrando...
            </>
          ) : (
            'Registrar Saída'
          )}
        </Button>
      </div>
    </div>
  )
}
