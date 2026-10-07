// =============================================================================
// INVENTÁRIO DA FARMÁCIA (07/10/2026, pedido da Andressa)
//
// Grade com lote, validade e quantidade de todos os medicamentos do estoque
// ativo (CAF ou satélite). Cada lote salvo entra NA HORA no estoque, como
// ajuste de inventário (sem pedir motivo). O nome do medicamento não muda aqui.
// Ao salvar, o saldo do item no estoque passa a ser a soma dos lotes.
//
// Só quem está em farmacia_inventario_acesso usa (o banco confere de novo em
// farmacia_inventario_grade / farmacia_inventario_salvar, migration 20261007180000).
// =============================================================================
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as XLSX from 'xlsx'
import { saveAs } from 'file-saver'
import { ClipboardCheck, Loader2, RefreshCw, Search, Plus, Save, FileSpreadsheet, CheckCircle2, AlertTriangle, Lock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ErroCarregamento } from '@/components/ui/erro-carregamento'
import { useModule } from '@/contexts/module'
import { supabase } from '@/lib/supabase'
import { getErrorMessage } from '@/lib/utils/error-messages'
import { buscarTodas, dataBR, hojeLocal, lerQuantidade, normalizarBusca } from '@/lib/utils/seguro'

interface LinhaGrade {
  item_id: string
  item_name: string
  item_code: string | null
  unidade: string | null
  nao_padronizado: boolean
  saldo: number
  lot_id: string | null
  lote: string | null
  validade: string | null
  quantidade: number | null
}

interface Lote { chave: string; lot_id: string | null; lote: string; validade: string; quantidade: string; orig: { lote: string; validade: string; quantidade: string } | null }
interface ItemGrade { item_id: string; nome: string; codigo: string | null; unidade: string | null; naoPadronizado: boolean; saldo: number; lotes: Lote[] }

type Filtro = 'todos' | 'com_saldo' | 'negativos' | 'divergentes'
const MAX = 150
const inteiro = (n: number) => n.toLocaleString('pt-BR')

const ESTOQUES_OK = ['CAF', 'SAT_1', 'SAT_2', 'SAT_T']

export function InventarioFarmacia() {
  const { activeStock } = useModule()
  const code = activeStock?.code ?? ''
  const [pode, setPode] = useState<boolean | null>(null)
  const [itens, setItens] = useState<ItemGrade[]>([])
  const [carregando, setCarregando] = useState(false)
  const [erro, setErro] = useState<unknown>(null)
  const [busca, setBusca] = useState('')
  const [filtro, setFiltro] = useState<Filtro>('todos')
  const [aviso, setAviso] = useState<{ tipo: 'ok' | 'erro'; msg: string } | null>(null)
  const [salvando, setSalvando] = useState<string | null>(null)
  const seq = useRef(0)

  useEffect(() => {
    supabase.rpc('farmacia_inventario_pode').then(({ data }) => setPode(!!data), () => setPode(false))
  }, [])

  const carregar = useCallback(async () => {
    if (!ESTOQUES_OK.includes(code)) return
    setCarregando(true); setErro(null)
    try {
      const rows = await buscarTodas<LinhaGrade>((de, ate) =>
        supabase.rpc('farmacia_inventario_grade', { p_location_code: code }).range(de, ate) as any)
      const mapa = new Map<string, ItemGrade>()
      for (const r of rows) {
        let it = mapa.get(r.item_id)
        if (!it) {
          it = { item_id: r.item_id, nome: r.item_name, codigo: r.item_code, unidade: r.unidade, naoPadronizado: r.nao_padronizado, saldo: r.saldo, lotes: [] }
          mapa.set(r.item_id, it)
        }
        if (r.lot_id) {
          const v = { lote: r.lote ?? '', validade: r.validade ?? '', quantidade: String(r.quantidade ?? 0) }
          it.lotes.push({ chave: r.lot_id, lot_id: r.lot_id, ...v, orig: v })
        }
      }
      setItens([...mapa.values()])
    } catch (e) {
      setErro(e)
    } finally {
      setCarregando(false)
    }
  }, [code])

  useEffect(() => { if (pode) void carregar() }, [pode, carregar])
  useEffect(() => {
    if (!aviso) return
    const t = setTimeout(() => setAviso(null), 5000)
    return () => clearTimeout(t)
  }, [aviso])

  const somaLotes = (it: ItemGrade) => it.lotes.reduce((s, l) => s + (l.orig ? Number(l.orig.quantidade) || 0 : 0), 0)

  const visiveis = useMemo(() => {
    const q = normalizarBusca(busca)
    return itens.filter((it) => {
      if (q && !normalizarBusca(it.nome).includes(q) && !normalizarBusca(it.codigo).includes(q)) return false
      if (filtro === 'com_saldo' && it.saldo === 0 && !it.lotes.some((l) => Number(l.quantidade) !== 0)) return false
      if (filtro === 'negativos' && !it.lotes.some((l) => l.orig && Number(l.orig.quantidade) < 0)) return false
      if (filtro === 'divergentes' && somaLotes(it) === it.saldo) return false
      return true
    })
  }, [itens, busca, filtro])

  function mudar(itemId: string, chave: string, campo: 'lote' | 'validade' | 'quantidade', valor: string) {
    setItens((xs) => xs.map((it) => it.item_id !== itemId ? it : {
      ...it, lotes: it.lotes.map((l) => (l.chave === chave ? { ...l, [campo]: valor } : l)),
    }))
  }
  function novoLote(itemId: string) {
    const chave = `novo-${++seq.current}`
    setItens((xs) => xs.map((it) => it.item_id !== itemId ? it : {
      ...it, lotes: [...it.lotes, { chave, lot_id: null, lote: '', validade: '', quantidade: '', orig: null }],
    }))
  }
  const sujo = (l: Lote) => !l.orig || l.lote !== l.orig.lote || l.validade !== l.orig.validade || l.quantidade !== l.orig.quantidade

  async function salvar(it: ItemGrade, l: Lote) {
    const q = lerQuantidade(l.quantidade)
    if (q === null || q < 0) { setAviso({ tipo: 'erro', msg: `${it.nome}: quantidade inválida (0 ou mais).` }); return }
    if (!l.lot_id && !l.lote.trim() && q === 0) { setAviso({ tipo: 'erro', msg: `${it.nome}: informe o lote ou a quantidade do lote novo.` }); return }
    setSalvando(l.chave)
    try {
      const { data, error } = await supabase.rpc('farmacia_inventario_salvar', {
        p_location_code: code, p_item_id: it.item_id, p_lot_id: l.lot_id,
        p_lote: l.lote, p_validade: l.validade || null, p_quantidade: q,
      })
      if (error) throw error
      const r = data as { lot_id: string; saldo: number }
      const v = { lote: l.lote.trim(), validade: l.validade, quantidade: String(q) }
      setItens((xs) => xs.map((x) => x.item_id !== it.item_id ? x : {
        ...x, saldo: r.saldo,
        lotes: x.lotes.map((y) => (y.chave === l.chave ? { ...y, ...v, chave: r.lot_id, lot_id: r.lot_id, orig: v } : y)),
      }))
      setAviso({ tipo: 'ok', msg: `${it.nome}: salvo. Saldo no estoque agora ${inteiro(r.saldo)}.` })
    } catch (e) {
      setAviso({ tipo: 'erro', msg: `${it.nome}: ${getErrorMessage(e)}` })
    } finally {
      setSalvando(null)
    }
  }

  function exportar() {
    const linhas: Record<string, string | number>[] = []
    for (const it of visiveis) {
      if (it.lotes.length === 0) {
        linhas.push({ Medicamento: it.nome, 'Código': it.codigo ?? '', Unidade: it.unidade ?? '', Lote: '', Validade: '', Quantidade: '', 'Saldo do estoque': it.saldo })
      }
      for (const l of it.lotes) {
        if (!l.orig) continue
        linhas.push({
          Medicamento: it.nome, 'Código': it.codigo ?? '', Unidade: it.unidade ?? '',
          Lote: l.orig.lote, Validade: l.orig.validade ? dataBR(l.orig.validade) : '',
          Quantidade: Number(l.orig.quantidade), 'Saldo do estoque': it.saldo,
        })
      }
    }
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(linhas), 'Inventário')
    const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
    saveAs(new Blob([buf], { type: 'application/octet-stream' }), `inventario_farmacia_${code}_${hojeLocal()}.xlsx`)
  }

  if (pode === null) return <div className="p-10 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>
  if (!pode) {
    return (
      <div className="max-w-xl mx-auto mt-10 p-6 bg-white border border-gray-200 rounded-xl text-center space-y-2">
        <Lock className="w-8 h-8 mx-auto text-gray-400" />
        <p className="font-semibold text-gray-800">Inventário da farmácia</p>
        <p className="text-sm text-gray-600">Você não tem acesso a esta tela. Fale com a coordenação da farmácia.</p>
      </div>
    )
  }
  if (!ESTOQUES_OK.includes(code)) {
    return <p className="p-6 text-sm text-gray-600">Escolha no topo um estoque da farmácia (CAF ou satélite).</p>
  }

  const negativos = itens.reduce((s, it) => s + it.lotes.filter((l) => l.orig && Number(l.orig.quantidade) < 0).length, 0)
  const divergentes = itens.filter((it) => somaLotes(it) !== it.saldo).length

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <ClipboardCheck className="w-6 h-6 text-emerald-600" /> Inventário da Farmácia
          </h1>
          <p className="text-sm text-gray-600 mt-1 max-w-3xl">
            Estoque <strong>{activeStock?.name}</strong>. Altere lote, validade ou quantidade e clique em salvar no lote:
            o estoque já muda na hora, registrado como ajuste de inventário com o seu nome. Ao salvar, o saldo do item
            passa a ser a soma dos lotes.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => void carregar()} disabled={carregando} className="gap-1">
            {carregando ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />} Atualizar
          </Button>
          <Button variant="outline" size="sm" onClick={exportar} disabled={visiveis.length === 0} className="gap-1">
            <FileSpreadsheet className="w-4 h-4" /> Exportar .xlsx
          </Button>
        </div>
      </div>

      <div className="bg-white border border-gray-100 rounded-xl shadow-sm p-4 flex flex-wrap gap-3 items-end">
        <div className="flex-1 min-w-[16rem] relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <Input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar medicamento ou código" className="pl-9" autoFocus />
        </div>
        <div className="flex gap-1 flex-wrap">
          {([['todos', 'Todos'], ['com_saldo', 'Com saldo'], ['negativos', `Lotes negativos (${negativos})`], ['divergentes', `Saldo ≠ lotes (${divergentes})`]] as Array<[Filtro, string]>).map(([v, rot]) => (
            <Button key={v} size="sm" variant={filtro === v ? 'default' : 'outline'} onClick={() => setFiltro(v)}>{rot}</Button>
          ))}
        </div>
        <p className="w-full text-xs text-gray-500">{inteiro(visiveis.length)} medicamentos na lista.</p>
      </div>

      {aviso && (
        <div className={`p-3 text-sm rounded-lg border flex items-center gap-2 ${aviso.tipo === 'ok' ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : 'border-red-200 bg-red-50 text-red-800'}`}>
          {aviso.tipo === 'ok' ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <AlertTriangle className="w-4 h-4 shrink-0" />} {aviso.msg}
        </div>
      )}

      <ErroCarregamento erro={erro} onTentar={carregar} titulo="Não foi possível carregar o inventário." />

      {carregando && itens.length === 0 ? (
        <div className="p-10 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>
      ) : (
        <div className="bg-white border border-gray-100 rounded-xl shadow-sm overflow-x-auto">
          <table className="w-full text-sm min-w-[900px]">
            <thead className="bg-gray-50 text-xs uppercase text-gray-500">
              <tr>
                <th className="text-left px-3 py-2">Medicamento</th>
                <th className="text-right px-3 py-2">Saldo</th>
                <th className="text-left px-3 py-2">Lote</th>
                <th className="text-left px-3 py-2">Validade</th>
                <th className="text-right px-3 py-2">Quantidade</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {visiveis.slice(0, MAX).map((it) => {
                const div = somaLotes(it) !== it.saldo
                const linhas = it.lotes.length ? it.lotes : [null]
                return linhas.map((l, i) => (
                  <tr key={l ? l.chave : it.item_id} className={`${i === 0 ? 'border-t-2 border-gray-200' : 'border-t border-gray-50'} ${it.naoPadronizado ? 'bg-orange-50' : ''}`}>
                    {i === 0 && (
                      <>
                        <td className="px-3 py-2 align-top" rowSpan={linhas.length}>
                          <p className="font-medium text-gray-900">{it.nome}</p>
                          <p className="text-xs text-gray-500">{it.codigo ? `Cód. ${it.codigo} · ` : ''}{it.unidade ?? ''}</p>
                          <button type="button" onClick={() => novoLote(it.item_id)} className="mt-1 text-xs text-emerald-700 hover:underline inline-flex items-center gap-1">
                            <Plus className="w-3 h-3" /> adicionar lote
                          </button>
                        </td>
                        <td className="px-3 py-2 align-top text-right" rowSpan={linhas.length}>
                          <span className="font-semibold">{inteiro(it.saldo)}</span>
                          {div && <span className="block text-[11px] text-amber-700" title="A soma dos lotes não bate com o saldo">lotes: {inteiro(somaLotes(it))}</span>}
                        </td>
                      </>
                    )}
                    {l ? (
                      <>
                        <td className="px-3 py-1.5">
                          <Input value={l.lote} onChange={(e) => mudar(it.item_id, l.chave, 'lote', e.target.value)} maxLength={60} placeholder="(sem lote)" className="h-8" />
                        </td>
                        <td className="px-3 py-1.5">
                          <Input type="date" value={l.validade} onChange={(e) => mudar(it.item_id, l.chave, 'validade', e.target.value)} className="h-8" />
                        </td>
                        <td className="px-3 py-1.5">
                          <Input inputMode="numeric" value={l.quantidade} onChange={(e) => mudar(it.item_id, l.chave, 'quantidade', e.target.value)}
                            className={`h-8 text-right ${Number(l.orig?.quantidade) < 0 ? 'border-red-400 text-red-700 font-semibold' : ''}`} placeholder="qtd" />
                        </td>
                        <td className="px-3 py-1.5 text-right">
                          {sujo(l) && (
                            <Button size="sm" onClick={() => void salvar(it, l)} disabled={salvando !== null} className="h-8 gap-1 bg-emerald-600 hover:bg-emerald-700 text-white">
                              {salvando === l.chave ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />} Salvar
                            </Button>
                          )}
                        </td>
                      </>
                    ) : (
                      <td colSpan={4} className="px-3 py-2 text-xs text-gray-400">Sem lote neste estoque. Use "adicionar lote".</td>
                    )}
                  </tr>
                ))
              })}
            </tbody>
          </table>
          {visiveis.length > MAX && (
            <p className="px-4 py-2 text-xs text-gray-500 border-t border-gray-100">
              Mostrando {MAX} de {inteiro(visiveis.length)} medicamentos. Use a busca para achar os demais.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
