// =====================================================================
// Etiquetas de código de barras dos lotes de medicamento (Farmácia).
// Carrega item + lote + validade no código (Code128), pra colar na caixa
// ou na unidade do medicamento. Imprime em impressora térmica de etiqueta
// (ou impressora comum + folha adesiva) via window.print().
// Só farmácia — não toca em almoxarifado.
// =====================================================================
import { useEffect, useMemo, useState } from 'react'
import { Barcode, Printer, Search, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { supabase } from '@/lib/supabase'
import { Barcode128 } from '@/components/barcode128'

interface PItem { id: string; code: string; name: string }
interface Lote { id: string; batch_number: string; expiry_date: string; current_quantity: number }

// Code128 aceita letras/numeros/simbolos; formato compacto pra caber numa
// etiqueta pequena (ampola/frasco). AAAAMMDD em vez de AAAA-MM-DD economiza
// 2 caracteres — em barra fina isso conta.
function codigoEtiqueta(codigoItem: string, lote: string, validade: string): string {
  const validadeCompacta = validade.replace(/-/g, '')
  return `${codigoItem}|${lote}|${validadeCompacta}`
}

export function EtiquetasFarmacia() {
  const [items, setItems] = useState<PItem[]>([])
  const [loadingItems, setLoadingItems] = useState(true)
  const [search, setSearch] = useState('')
  const [selectedItem, setSelectedItem] = useState<PItem | null>(null)

  const [lotes, setLotes] = useState<Lote[]>([])
  const [loadingLotes, setLoadingLotes] = useState(false)
  const [selectedLote, setSelectedLote] = useState<Lote | null>(null)
  const [quantidade, setQuantidade] = useState(1)

  useEffect(() => {
    ;(async () => {
      setLoadingItems(true)
      const { data } = await supabase
        .from('pharmacy_items')
        .select('id, code, name')
        .or('is_active.is.null,is_active.eq.true')
        .order('name')
      setItems(((data as PItem[]) || []).filter((i) => i.code))
      setLoadingItems(false)
    })()
  }, [])

  useEffect(() => {
    if (!selectedItem) { setLotes([]); setSelectedLote(null); return }
    ;(async () => {
      setLoadingLotes(true)
      setSelectedLote(null)
      const { data } = await supabase
        .from('expiry_tracking')
        .select('id, batch_number, expiry_date, current_quantity')
        .eq('item_id', selectedItem.id)
        .gt('current_quantity', 0)
        .order('expiry_date')
      setLotes((data as Lote[]) || [])
      setLoadingLotes(false)
    })()
  }, [selectedItem])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return items
    return items.filter((i) => i.name.toLowerCase().includes(q) || i.code.toLowerCase().includes(q))
  }, [items, search])

  const podeImprimir = !!selectedItem && !!selectedLote && quantidade > 0
  const etiquetas = podeImprimir
    ? Array.from({ length: quantidade }, (_, i) => i)
    : []

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3 no-print">
        <div className="flex items-center gap-3">
          <div className="p-3 rounded-lg bg-cyan-100"><Barcode className="w-6 h-6 text-cyan-700" /></div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Etiquetas de Lote</h1>
            <p className="text-sm text-gray-500">Farmácia — código de barras com medicamento, lote e validade</p>
          </div>
        </div>
        <Button onClick={() => window.print()} disabled={!podeImprimir} className="bg-cyan-700 hover:bg-cyan-800 text-white">
          <Printer className="w-4 h-4 mr-2" /> Imprimir {quantidade} etiqueta(s)
        </Button>
      </div>

      {/* Passo 1: escolher o medicamento */}
      <div className="bg-white border border-gray-100 rounded-xl shadow-sm p-4 space-y-3 no-print">
        <h2 className="text-sm font-semibold text-gray-700">1. Medicamento</h2>
        <div className="relative">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar por nome ou código..." className="pl-9" />
        </div>
        {loadingItems ? (
          <div className="p-6 text-center text-gray-400"><Loader2 className="w-5 h-5 animate-spin inline mr-2" /> Carregando...</div>
        ) : (
          <div className="max-h-64 overflow-y-auto divide-y divide-gray-100 border border-gray-100 rounded-lg">
            {filtered.length === 0 && <p className="p-4 text-sm text-center text-gray-400">Nenhum item.</p>}
            {filtered.map((i) => (
              <button
                key={i.id}
                onClick={() => setSelectedItem(i)}
                className={`w-full text-left px-4 py-2.5 hover:bg-gray-50 ${selectedItem?.id === i.id ? 'bg-cyan-50' : ''}`}
              >
                <p className="text-sm text-gray-900 truncate">{i.name}</p>
                <p className="text-xs text-gray-400 font-mono">{i.code}</p>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Passo 2: escolher o lote (so aparece com item selecionado) */}
      {selectedItem && (
        <div className="bg-white border border-gray-100 rounded-xl shadow-sm p-4 space-y-3 no-print">
          <h2 className="text-sm font-semibold text-gray-700">2. Lote — {selectedItem.name}</h2>
          {loadingLotes ? (
            <div className="p-6 text-center text-gray-400"><Loader2 className="w-5 h-5 animate-spin inline mr-2" /> Carregando...</div>
          ) : lotes.length === 0 ? (
            <p className="p-4 text-sm text-center text-gray-400">Esse item não tem lote com saldo cadastrado.</p>
          ) : (
            <div className="divide-y divide-gray-100 border border-gray-100 rounded-lg">
              {lotes.map((l) => (
                <button
                  key={l.id}
                  onClick={() => setSelectedLote(l)}
                  className={`w-full text-left px-4 py-2.5 hover:bg-gray-50 flex items-center justify-between ${selectedLote?.id === l.id ? 'bg-cyan-50' : ''}`}
                >
                  <span className="text-sm text-gray-900">Lote <strong>{l.batch_number || '—'}</strong></span>
                  <span className="text-xs text-gray-500">
                    Val. {new Date(l.expiry_date + 'T00:00:00').toLocaleDateString('pt-BR')} · saldo {l.current_quantity}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Passo 3: quantidade (so com lote selecionado) */}
      {selectedLote && (
        <div className="bg-white border border-gray-100 rounded-xl shadow-sm p-4 space-y-2 no-print">
          <h2 className="text-sm font-semibold text-gray-700">3. Quantas etiquetas</h2>
          <Input
            type="number"
            min={1}
            value={quantidade}
            onChange={(e) => setQuantidade(Math.max(1, Number(e.target.value) || 1))}
            className="max-w-[140px]"
          />
        </div>
      )}

      {/* Prévia + área de impressão */}
      {podeImprimir && (
        <div className="no-print text-sm text-gray-500">
          Prévia de {quantidade} etiqueta(s) do lote {selectedLote!.batch_number || '—'}.
        </div>
      )}
      <div id="etiquetas-print" className="etiquetas-grid">
        {podeImprimir && etiquetas.map((i) => (
          <div key={i} className="etiqueta">
            <div className="etiqueta-nome">{selectedItem!.name}</div>
            <Barcode128
              value={codigoEtiqueta(selectedItem!.code, selectedLote!.batch_number || '—', selectedLote!.expiry_date)}
              height={40}
              moduleWidth={1.3}
              showText={false}
            />
            <div className="etiqueta-detalhe">
              Lote {selectedLote!.batch_number || '—'} · Val. {new Date(selectedLote!.expiry_date + 'T00:00:00').toLocaleDateString('pt-BR')}
            </div>
          </div>
        ))}
      </div>

      <style>{`
        .etiquetas-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 6px;
        }
        .etiqueta {
          border: 1px dashed #cbd5e1;
          border-radius: 6px;
          padding: 6px 8px;
          text-align: center;
          display: flex; flex-direction: column; align-items: center; justify-content: center;
          break-inside: avoid;
          background: #fff;
        }
        .etiqueta-nome {
          font-size: 9px; font-weight: 600; color: #111; line-height: 1.15;
          margin-bottom: 3px; max-height: 24px; overflow: hidden;
        }
        .etiqueta-detalhe {
          font-size: 8px; color: #444; margin-top: 3px;
        }
        @media print {
          /* Tamanho da etiqueta termica: ajuste aqui conforme o rolo comprado
             (ex.: 40mm x 30mm). Em impressora comum + folha adesiva A4,
             comente esta @page e use a de baixo. */
          @page { size: 40mm 30mm; margin: 2mm; }
          body, html { background: #fff !important; }
          .no-print { display: none !important; }
          nav, aside, header { display: none !important; }
          .etiquetas-grid { grid-template-columns: 1fr; gap: 0; }
          .etiqueta { border: none; page-break-after: always; }
        }
      `}</style>
    </div>
  )
}
