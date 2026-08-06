// =====================================================================
// Etiquetas de código de barras dos itens do Almoxarifado.
// Gera uma folha (A4) com etiquetas: nome + código de barras (Code 128) +
// código em texto. Imprime em impressora comum / papel adesivo.
// Só almoxarifado — não toca em farmácia.
// =====================================================================
import { useEffect, useMemo, useState } from 'react'
import { Barcode, Printer, Search, Loader2, CheckSquare, Square } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { supabase } from '@/lib/supabase'
import { Barcode128 } from '@/components/barcode128'

interface WItem { id: string; code: string; name: string }

export function EtiquetasAlmox() {
  const [items, setItems] = useState<WItem[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())

  useEffect(() => {
    ;(async () => {
      setLoading(true)
      const { data } = await supabase
        .from('warehouse_items')
        .select('id, code, name')
        .eq('is_active', true)
        .not('code', 'is', null)
        .order('name')
      setItems(((data as WItem[]) || []).filter((i) => i.code))
      setLoading(false)
    })()
  }, [])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return items
    return items.filter((i) => i.name.toLowerCase().includes(q) || (i.code || '').toLowerCase().includes(q))
  }, [items, search])

  const allFilteredSelected = filtered.length > 0 && filtered.every((i) => selected.has(i.id))
  function toggle(id: string) {
    setSelected((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }
  function toggleAllFiltered() {
    setSelected((prev) => {
      const n = new Set(prev)
      if (allFilteredSelected) filtered.forEach((i) => n.delete(i.id))
      else filtered.forEach((i) => n.add(i.id))
      return n
    })
  }

  // Etiquetas a imprimir: selecionadas; se nada selecionado, imprime as filtradas.
  const toPrint = selected.size > 0 ? items.filter((i) => selected.has(i.id)) : filtered

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3 no-print">
        <div className="flex items-center gap-3">
          <div className="p-3 rounded-lg bg-cyan-100"><Barcode className="w-6 h-6 text-cyan-700" /></div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Etiquetas de Código de Barras</h1>
            <p className="text-sm text-gray-500">Almoxarifado — gere e imprima as etiquetas dos materiais</p>
          </div>
        </div>
        <Button onClick={() => window.print()} disabled={toPrint.length === 0} className="bg-cyan-700 hover:bg-cyan-800 text-white">
          <Printer className="w-4 h-4 mr-2" /> Imprimir {toPrint.length} etiqueta(s)
        </Button>
      </div>

      {/* Controles */}
      <div className="bg-white border border-gray-100 rounded-xl shadow-sm p-4 space-y-3 no-print">
        <div className="relative">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar por nome ou código..." className="pl-9" />
        </div>
        <div className="flex items-center justify-between text-sm">
          <button onClick={toggleAllFiltered} className="inline-flex items-center gap-2 text-gray-700 hover:text-gray-900">
            {allFilteredSelected ? <CheckSquare className="w-4 h-4 text-cyan-700" /> : <Square className="w-4 h-4" />}
            Selecionar todos ({filtered.length})
          </button>
          <span className="text-gray-500">{selected.size} selecionado(s)</span>
        </div>
      </div>

      {/* Lista de seleção */}
      <div className="bg-white border border-gray-100 rounded-xl shadow-sm overflow-hidden no-print">
        {loading ? (
          <div className="p-8 text-center text-gray-400"><Loader2 className="w-5 h-5 animate-spin inline mr-2" /> Carregando...</div>
        ) : filtered.length === 0 ? (
          <p className="p-6 text-sm text-center text-gray-400">Nenhum item.</p>
        ) : (
          <div className="max-h-[420px] overflow-y-auto divide-y divide-gray-100">
            {filtered.map((i) => (
              <label key={i.id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 cursor-pointer">
                <input type="checkbox" checked={selected.has(i.id)} onChange={() => toggle(i.id)} className="w-4 h-4" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-gray-900 truncate">{i.name}</p>
                  <p className="text-xs text-gray-400 font-mono">{i.code}</p>
                </div>
              </label>
            ))}
          </div>
        )}
      </div>

      {/* Prévia + área de impressão */}
      <div className="no-print text-sm text-gray-500">
        Prévia das etiquetas ({toPrint.length}). Dica: selecione itens acima ou use a busca; sem seleção, imprime o que está filtrado.
      </div>
      <div id="etiquetas-print" className="etiquetas-grid">
        {toPrint.map((i) => (
          <div key={i.id} className="etiqueta">
            <div className="etiqueta-nome">{i.name}</div>
            <Barcode128 value={i.code} height={40} moduleWidth={1.3} />
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
        @media print {
          @page { size: A4 portrait; margin: 8mm; }
          body, html { background: #fff !important; }
          .no-print { display: none !important; }
          nav, aside, header { display: none !important; }
          .etiquetas-grid { grid-template-columns: repeat(3, 1fr); gap: 2mm; }
          .etiqueta { border: 1px solid #e5e7eb; }
        }
      `}</style>
    </div>
  )
}
