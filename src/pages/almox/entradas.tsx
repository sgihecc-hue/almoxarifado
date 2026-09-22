// =====================================================================
// ENTRADAS (almoxarifado e farmacia) — ver, completar e anular entradas.
//
// Nasceu da mascara cirurgica (21/09/2026): a compra da NF 30641 chegou antes
// da nota, entrou sem NF em 18/08 e, quando a nota chegou, a unica tela com
// campo de NF criou uma SEGUNDA entrada (+10.000). O sistema nao tinha como
// completar uma entrada existente. Aqui tem:
//   - Completar NF: grava nota, datas, AFM e fornecedor NA MESMA entrada
//     (mesmo id), sem mexer na quantidade.
//   - Editar (22/09/2026): quantidade, lote, validade, preco e nota; o estoque
//     acompanha a diferenca. Observacao opcional.
//   - Excluir (= anular): desfaz uma entrada lancada por engano, devolvendo o saldo do
//     local e do lote, com motivo. A linha fica marcada, nunca apagada.
// As entradas aparecem agrupadas por RODADA (tudo que foi gravado junto).
// Backend separado por modulo (regra do projeto):
//   material -> almox_completar_entrada / almox_anular_entrada (20260921180000)
//   farmacia -> farmacia_completar_entrada / farmacia_anular_entrada (20260921200000)
//               — na farmacia anular lanca um AJUSTE de saida no livro-razao.
// =====================================================================

import { useState, useEffect, useMemo, useCallback } from 'react'
import { PackagePlus, Loader2, Search, RefreshCw, AlertCircle, CheckCircle2, FileCheck2, Undo2, Pencil, History } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/auth'
import { getErrorMessage } from '@/lib/utils/error-messages'
import { lerAvisoEntrada, dataBR, useTravaEnvio, type EntradaParecida } from '@/lib/utils/entradas'

interface Linha {
  id: string
  entry_group_id: string | null
  created_at: string
  created_by: string | null
  item_id: string
  quantity: number
  acquisition_type: string | null
  invoice_number: string | null
  invoice_date: string | null
  delivery_date: string | null
  afm_number: string | null
  supplier_name: string | null
  supplier_cnpj: string | null
  unit_price: number | null
  batch_number: string | null
  expiry_date: string | null
  location_id: string | null
  nf_pendente: boolean
  anulada_em: string | null
  anulada_por: string | null
  anulada_motivo: string | null
  completada_em: string | null
  item?: { name: string; code: string | null; unit: string | null } | null
}

interface Rodada {
  chave: string
  quando: string
  autor: string
  linhas: Linha[]
}

type Filtro = 'todas' | 'pendentes' | 'anuladas'
type Tipo = 'warehouse' | 'pharmacy'

const CFG: Record<Tipo, {
  titulo: string; tabelaItem: string; rpcCompletar: string; rpcAnular: string; rpcEditar: string; papeis: string[]; oQue: string
}> = {
  warehouse: {
    titulo: 'Entradas — Almoxarifado', tabelaItem: 'warehouse_items',
    rpcCompletar: 'almox_completar_entrada', rpcAnular: 'almox_anular_entrada', rpcEditar: 'almox_editar_entrada',
    papeis: ['administrador', 'gestor', 'atendente', 'warehouse_manager'], oQue: 'material',
  },
  pharmacy: {
    titulo: 'Entradas — Farmácia', tabelaItem: 'pharmacy_items',
    rpcCompletar: 'farmacia_completar_entrada', rpcAnular: 'farmacia_anular_entrada', rpcEditar: 'farmacia_editar_entrada',
    papeis: ['administrador', 'gestor', 'atendente', 'pharmacist'], oQue: 'medicamento',
  },
}

const semNF = (nf: string | null) => !nf || ['—', '-', 'SN', 'S/N'].includes(nf.trim())
const MOTIVO_MINIMO = 10

export function EntradasAlmox() { return <EntradasPage tipo="warehouse" /> }
export function EntradasFarmacia() { return <EntradasPage tipo="pharmacy" /> }

function EntradasPage({ tipo }: { tipo: Tipo }) {
  const cfg = CFG[tipo]
  const { user } = useAuth()
  const podeOperar = cfg.papeis.includes(user?.role || '')

  const [linhas, setLinhas] = useState<Linha[]>([])
  const [usuarios, setUsuarios] = useState<Record<string, string>>({})
  const [locais, setLocais] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [busca, setBusca] = useState('')
  const [filtro, setFiltro] = useState<Filtro>('todas')
  const [dias, setDias] = useState(60)

  // Dialogos
  const [completar, setCompletar] = useState<Rodada | null>(null)
  const [anular, setAnular] = useState<Rodada | null>(null)
  const [editar, setEditar] = useState<Linha | null>(null)
  const [historico, setHistorico] = useState<Rodada | null>(null)

  const carregar = useCallback(async () => {
    setLoading(true); setErro(null)
    try {
      const desde = new Date(Date.now() - dias * 24 * 60 * 60 * 1000).toISOString()
      // NF pendente aparece sempre, mesmo fora do periodo: e pendencia a resolver.
      const [recentes, pendentes, locs] = await Promise.all([
        supabase.from('stock_entries').select(`*, item:${cfg.tabelaItem}(name, code, unit)`)
          .eq('item_type', tipo).gte('created_at', desde)
          .order('created_at', { ascending: false }).limit(2000),
        supabase.from('stock_entries').select(`*, item:${cfg.tabelaItem}(name, code, unit)`)
          .eq('item_type', tipo).eq('nf_pendente', true),
        supabase.from('stock_locations').select('id, code, name'),
      ])
      if (recentes.error) throw recentes.error
      if (pendentes.error) throw pendentes.error
      const mapa = new Map<string, Linha>()
      for (const l of [...(recentes.data || []), ...(pendentes.data || [])] as unknown as Linha[]) mapa.set(l.id, l)
      const todas = [...mapa.values()]
      setLinhas(todas)
      setLocais(Object.fromEntries(((locs.data || []) as any[]).map((l) => [l.id, l.code === 'ALMOX' ? 'Almoxarifado' : l.name])))
      const ids = [...new Set(todas.flatMap((l) => [l.created_by, l.anulada_por]).filter(Boolean))] as string[]
      if (ids.length) {
        const { data } = await supabase.from('users').select('id, full_name').in('id', ids)
        setUsuarios(Object.fromEntries(((data || []) as any[]).map((u) => [u.id, u.full_name])))
      }
    } catch (e) {
      setErro(getErrorMessage(e))
    } finally {
      setLoading(false)
    }
  }, [dias, tipo, cfg.tabelaItem])

  useEffect(() => { carregar() }, [carregar])
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 3500)
    return () => clearTimeout(t)
  }, [toast])

  const rodadas = useMemo<Rodada[]>(() => {
    const q = busca.trim().toLowerCase()
    const grupos = new Map<string, Linha[]>()
    for (const l of linhas) {
      const chave = l.entry_group_id || l.id
      if (!grupos.has(chave)) grupos.set(chave, [])
      grupos.get(chave)!.push(l)
    }
    const lista: Rodada[] = []
    for (const [chave, ls] of grupos) {
      if (filtro === 'pendentes' && !ls.some((l) => l.nf_pendente)) continue
      if (filtro === 'anuladas' && !ls.some((l) => l.anulada_em)) continue
      if (q && !ls.some((l) =>
        (l.item?.name || '').toLowerCase().includes(q) ||
        (l.item?.code || '').toLowerCase().includes(q) ||
        (l.invoice_number || '').toLowerCase().includes(q) ||
        (l.supplier_name || '').toLowerCase().includes(q) ||
        (l.batch_number || '').toLowerCase().includes(q))) continue
      ls.sort((a, b) => (a.item?.name || '').localeCompare(b.item?.name || '', 'pt-BR'))
      lista.push({
        chave,
        quando: ls[0].created_at,
        autor: (ls[0].created_by && usuarios[ls[0].created_by]) || '—',
        linhas: ls,
      })
    }
    return lista.sort((a, b) => b.quando.localeCompare(a.quando))
  }, [linhas, busca, filtro, usuarios])

  const totalPendentes = useMemo(
    () => new Set(linhas.filter((l) => l.nf_pendente).map((l) => l.entry_group_id || l.id)).size,
    [linhas])

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <PackagePlus className="w-6 h-6 text-emerald-600" /> {cfg.titulo}
          </h1>
          <p className="text-sm text-gray-500 max-w-3xl">
            Nota fiscal que chegou depois da mercadoria? Use <strong>Completar NF</strong> na entrada que já existe —
            não lance de novo. Quantidade, lote ou validade errados? Use <strong>Editar</strong> — o estoque acompanha.
            Entrada lançada por engano? Use <strong>Excluir</strong>, que devolve o saldo. Tudo fica no <strong>Histórico</strong>.
          </p>
        </div>
        <Button variant="outline" onClick={carregar} disabled={loading} className="gap-2">
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />} Atualizar
        </Button>
      </div>

      {totalPendentes > 0 && (
        <button type="button" onClick={() => setFiltro('pendentes')}
          className="w-full text-left p-3 rounded-lg border border-amber-300 bg-amber-50 text-sm text-amber-900 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span><strong>{totalPendentes} {totalPendentes === 1 ? 'entrada' : 'entradas'} com NF pendente.</strong> Clique para ver e completar.</span>
        </button>
      )}

      <div className="bg-white border border-gray-100 rounded-xl shadow-sm p-4 flex flex-wrap gap-3 items-end">
        <div className="flex-1 min-w-[16rem]">
          <Label htmlFor="busca">Buscar</Label>
          <div className="relative mt-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <Input id="busca" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Item, código, NF, fornecedor ou lote" className="pl-9" />
          </div>
        </div>
        <div>
          <Label htmlFor="dias">Período</Label>
          <select id="dias" value={dias} onChange={(e) => setDias(Number(e.target.value))}
            className="mt-1 h-9 rounded-md border border-input bg-white px-3 text-sm">
            <option value={30}>Últimos 30 dias</option>
            <option value={60}>Últimos 60 dias</option>
            <option value={180}>Últimos 180 dias</option>
            <option value={3650}>Tudo</option>
          </select>
        </div>
        <div className="flex gap-1">
          {([['todas', 'Todas'], ['pendentes', 'NF pendente'], ['anuladas', 'Excluídas']] as Array<[Filtro, string]>).map(([v, rot]) => (
            <Button key={v} size="sm" variant={filtro === v ? 'default' : 'outline'} onClick={() => setFiltro(v)}>{rot}</Button>
          ))}
        </div>
      </div>

      {erro && <div className="p-3 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg">{erro}</div>}

      {loading ? (
        <div className="p-10 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>
      ) : rodadas.length === 0 ? (
        <div className="p-10 text-center text-sm text-gray-400 bg-white border border-gray-100 rounded-xl">Nenhuma entrada encontrada.</div>
      ) : (
        <div className="space-y-3">
          {rodadas.map((r) => {
            const l0 = r.linhas[0]
            const ativas = r.linhas.filter((l) => !l.anulada_em)
            const todasAnuladas = ativas.length === 0
            const pendente = r.linhas.some((l) => l.nf_pendente)
            const local = l0.location_id ? locais[l0.location_id] : null
            return (
              <div key={r.chave} className={`bg-white border rounded-xl shadow-sm overflow-hidden ${pendente ? 'border-amber-300' : 'border-gray-100'}`}>
                <div className="px-4 py-3 bg-gray-50 border-b border-gray-100 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                  <span className="font-medium text-gray-900">{dataBR(r.quando, true)}</span>
                  <span className="text-gray-600">{l0.acquisition_type || '—'}</span>
                  <span className="text-gray-600">{semNF(l0.invoice_number) ? 'Sem NF' : `NF ${l0.invoice_number}`}</span>
                  <span className="text-gray-600 truncate max-w-[16rem]">{l0.supplier_name || '—'}</span>
                  {local && <span className="text-gray-500">→ {local}</span>}
                  <span className="text-gray-500">por {r.autor}</span>
                  {pendente && <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-800">NF pendente</span>}
                  {todasAnuladas && <span className="text-xs px-2 py-0.5 rounded-full bg-gray-200 text-gray-700">Excluída</span>}
                  {l0.completada_em && !todasAnuladas && <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700">NF completada</span>}
                  <span className="ml-auto flex gap-2">
                    <Button size="sm" variant="ghost" className="gap-1 h-8" onClick={() => setHistorico(r)}>
                      <History className="w-3.5 h-3.5" /> Histórico
                    </Button>
                  {podeOperar && !todasAnuladas && (
                    <>
                      <Button size="sm" variant="outline" className="gap-1 h-8" onClick={() => setCompletar({ ...r, linhas: ativas })}>
                        <FileCheck2 className="w-3.5 h-3.5" /> Completar NF
                      </Button>
                      <Button size="sm" variant="outline" className="gap-1 h-8 text-red-700 hover:text-red-800" onClick={() => setAnular({ ...r, linhas: ativas })}>
                        <Undo2 className="w-3.5 h-3.5" /> Excluir
                      </Button>
                    </>
                  )}
                  </span>
                </div>
                <table className="w-full text-sm">
                  <tbody>
                    {r.linhas.map((l) => (
                      <tr key={l.id} className={`border-t border-gray-50 ${l.anulada_em ? 'text-gray-400 line-through' : ''}`}>
                        <td className="px-4 py-2">{l.item?.name || 'Item'}{l.item?.code ? <span className="text-xs text-gray-400"> · {l.item.code}</span> : null}</td>
                        <td className="px-4 py-2 text-right whitespace-nowrap font-medium">{l.quantity} {l.item?.unit || ''}</td>
                        <td className="px-4 py-2 text-gray-500 whitespace-nowrap">{l.batch_number ? `Lote ${l.batch_number}` : ''}</td>
                        <td className="px-4 py-2 text-gray-500 whitespace-nowrap">{l.expiry_date ? `Val. ${dataBR(l.expiry_date)}` : ''}</td>
                        <td className="px-4 py-2 text-gray-500 whitespace-nowrap">{l.unit_price ? `R$ ${Number(l.unit_price).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` : ''}</td>
                        <td className="px-2 py-1 text-right w-10">
                          {podeOperar && !l.anulada_em && (
                            <button type="button" title="Editar esta entrada" onClick={() => setEditar(l)}
                              className="p-1.5 rounded hover:bg-gray-100 text-gray-500 hover:text-gray-800">
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                    {r.linhas.filter((l) => l.anulada_em).slice(0, 1).map((l) => (
                      <tr key={`m${l.id}`}><td colSpan={6} className="px-4 py-2 text-xs text-gray-500">
                        Excluída em {dataBR(l.anulada_em, true)}{l.anulada_por && usuarios[l.anulada_por] ? ` por ${usuarios[l.anulada_por]}` : ''}: {l.anulada_motivo}
                      </td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          })}
        </div>
      )}

      {completar && (
        <CompletarDialog rodada={completar} rpc={cfg.rpcCompletar} onClose={() => setCompletar(null)}
          onDone={(msg) => { setCompletar(null); setToast(msg); carregar() }} />
      )}
      {anular && (
        <AnularDialog rodada={anular} rpc={cfg.rpcAnular} oQue={cfg.oQue} onClose={() => setAnular(null)}
          onDone={(msg) => { setAnular(null); setToast(msg); carregar() }} />
      )}
      {editar && (
        <EditarDialog linha={editar} rpc={cfg.rpcEditar} farmacia={tipo === 'pharmacy'} onClose={() => setEditar(null)}
          onDone={(msg) => { setEditar(null); setToast(msg); carregar() }} />
      )}
      {historico && (
        <HistoricoDialog rodada={historico} onClose={() => setHistorico(null)} />
      )}

      {toast && (
        <div className="fixed bottom-6 right-6 z-50 flex items-center gap-2 px-5 py-3 rounded-xl shadow-lg bg-gray-900 text-white text-sm">
          <CheckCircle2 className="w-4 h-4" /> {toast}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
function CompletarDialog({ rodada, rpc, onClose, onDone }: { rodada: Rodada; rpc: string; onClose: () => void; onDone: (msg: string) => void }) {
  const l0 = rodada.linhas[0]
  const [nf, setNf] = useState(semNF(l0.invoice_number) ? '' : (l0.invoice_number || ''))
  const [dataNf, setDataNf] = useState(l0.invoice_date || '')
  const [entrega, setEntrega] = useState(l0.delivery_date || '')
  const [afm, setAfm] = useState(semNF(l0.afm_number) ? '' : (l0.afm_number || ''))
  const [forn, setForn] = useState(l0.supplier_name && !/edi[cç][aã]o do item/i.test(l0.supplier_name) ? l0.supplier_name : '')
  const [cnpj, setCnpj] = useState(l0.supplier_cnpj && l0.supplier_cnpj !== '00.000.000/0000-00' ? l0.supplier_cnpj : '')
  const [motivo, setMotivo] = useState(semNF(l0.invoice_number) ? 'NF chegou depois da mercadoria' : '')
  const [nfUsada, setNfUsada] = useState<EntradaParecida | null>(null)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const trava = useTravaEnvio()

  async function salvar(confirmar = false) {
    setErro(null)
    if (!nf.trim()) { setErro('Informe o número da NF.'); return }
    if (!trava.tentar()) return
    setSalvando(true)
    try {
      const dados: Record<string, unknown> = {
        invoice_number: nf.trim(),
        invoice_date: dataNf || null,
        delivery_date: entrega || null,
        afm_number: afm.trim() || null,
        supplier_name: forn.trim() || null,
        supplier_cnpj: cnpj.trim() || null,
      }
      if (confirmar) dados.confirmar = true
      const { error } = await supabase.rpc(rpc, {
        p_entry_ids: rodada.linhas.map((l) => l.id),
        p_dados: dados,
        p_motivo: motivo.trim() || null,
      })
      if (error) throw error
      onDone(`NF ${nf.trim()} gravada na entrada de ${dataBR(rodada.quando)} — nada foi somado ao estoque.`)
    } catch (e) {
      const aviso = lerAvisoEntrada(e)
      if (aviso?.tipo === 'nf_ja_usada') setNfUsada(aviso.info)
      else setErro(getErrorMessage(e))
    } finally {
      setSalvando(false)
      trava.liberar()
    }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-w-xl">
        <DialogHeader><DialogTitle>Completar NF da entrada de {dataBR(rodada.quando, true)}</DialogTitle></DialogHeader>
        <p className="text-sm text-gray-600">
          Os dados vão para <strong>esta mesma entrada</strong> ({rodada.linhas.length} {rodada.linhas.length === 1 ? 'item' : 'itens'}).
          A quantidade e o estoque <strong>não mudam</strong>.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div><Label htmlFor="c-nf">Número da NF *</Label><Input id="c-nf" value={nf} onChange={(e) => setNf(e.target.value)} className="mt-1" /></div>
          <div><Label htmlFor="c-data">Data de emissão</Label><Input id="c-data" type="date" value={dataNf} onChange={(e) => setDataNf(e.target.value)} className="mt-1" /></div>
          <div><Label htmlFor="c-ent">Data de entrega</Label><Input id="c-ent" type="date" value={entrega} onChange={(e) => setEntrega(e.target.value)} className="mt-1" /></div>
          <div><Label htmlFor="c-afm">AFM</Label><Input id="c-afm" value={afm} onChange={(e) => setAfm(e.target.value)} className="mt-1" /></div>
          <div><Label htmlFor="c-forn">Fornecedor</Label><Input id="c-forn" value={forn} onChange={(e) => setForn(e.target.value)} className="mt-1" /></div>
          <div><Label htmlFor="c-cnpj">CNPJ</Label><Input id="c-cnpj" value={cnpj} onChange={(e) => setCnpj(e.target.value)} className="mt-1" /></div>
        </div>
        <div><Label htmlFor="c-mot">Observação (opcional)</Label><Input id="c-mot" value={motivo} onChange={(e) => setMotivo(e.target.value)} className="mt-1" /></div>

        {nfUsada && (
          <div className="p-3 text-sm rounded-md border border-red-300 bg-red-50 text-red-900 space-y-2">
            <p><strong>Esta NF já está em outra entrada deste item:</strong> {nfUsada.quantidade} un em {dataBR(nfUsada.data, true)}.</p>
            <p className="text-xs">
              Se é a mesma compra lançada duas vezes, <strong>anule a entrada repetida</strong> em vez de completar esta.
              Só confirme se a nota realmente veio em mais de uma remessa.
            </p>
            <Button size="sm" variant="outline" onClick={() => { setNfUsada(null); salvar(true) }} disabled={salvando}>
              A nota veio em mais de uma remessa — gravar mesmo assim
            </Button>
          </div>
        )}
        {erro && <div className="p-3 text-sm text-red-700 bg-red-50 border border-red-200 rounded-md">{erro}</div>}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={() => salvar()} disabled={salvando} className="gap-2">
            {salvando && <Loader2 className="w-4 h-4 animate-spin" />} Gravar NF
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
function AnularDialog({ rodada, rpc, oQue, onClose, onDone }: { rodada: Rodada; rpc: string; oQue: string; onClose: () => void; onDone: (msg: string) => void }) {
  const [marcadas, setMarcadas] = useState<Record<string, boolean>>(
    Object.fromEntries(rodada.linhas.map((l) => [l.id, true])))
  const [motivo, setMotivo] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const trava = useTravaEnvio()

  const escolhidas = rodada.linhas.filter((l) => marcadas[l.id])

  async function salvar() {
    setErro(null)
    if (escolhidas.length === 0) { setErro('Marque ao menos um item.'); return }
    if (motivo.trim().length < MOTIVO_MINIMO) { setErro(`Informe a justificativa (mínimo ${MOTIVO_MINIMO} caracteres).`); return }
    if (!trava.tentar()) return
    setSalvando(true)
    try {
      const { data, error } = await supabase.rpc(rpc, {
        p_entry_ids: escolhidas.map((l) => l.id),
        p_motivo: motivo.trim(),
      })
      if (error) throw error
      const q = (data as any)?.quantidade ?? escolhidas.reduce((s, l) => s + l.quantity, 0)
      onDone(`Entrada excluída: ${q} un tiradas do estoque. Ficou registrada no histórico.`)
    } catch (e) {
      setErro(getErrorMessage(e))
    } finally {
      setSalvando(false)
      trava.liberar()
    }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-w-xl">
        <DialogHeader><DialogTitle>Excluir entrada de {dataBR(rodada.quando, true)}</DialogTitle></DialogHeader>
        <p className="text-sm text-gray-600">
          Excluir <strong>tira do estoque</strong> a quantidade de {oQue} que esta entrada somou. Use quando a entrada foi
          lançada por engano ou em duplicidade. A entrada continua visível, marcada como excluída, com a justificativa no histórico.
        </p>
        <div className="border border-gray-100 rounded-md divide-y">
          {rodada.linhas.map((l) => (
            <label key={l.id} className="flex items-center gap-3 px-3 py-2 text-sm">
              <input type="checkbox" checked={!!marcadas[l.id]} onChange={(e) => setMarcadas((m) => ({ ...m, [l.id]: e.target.checked }))} />
              <span className="flex-1">{l.item?.name || 'Item'}</span>
              <span className="font-medium">−{l.quantity} {l.item?.unit || ''}</span>
            </label>
          ))}
        </div>
        <div>
          <Label htmlFor="a-mot">Justificativa *</Label>
          <Input id="a-mot" value={motivo} onChange={(e) => setMotivo(e.target.value)} className="mt-1"
            placeholder="Ex.: mesma compra da NF 30641 já lançada em 18/08" />
        </div>
        {erro && <div className="p-3 text-sm text-red-700 bg-red-50 border border-red-200 rounded-md">{erro}</div>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={salvar} disabled={salvando} className="gap-2 bg-red-600 hover:bg-red-700 text-white">
            {salvando && <Loader2 className="w-4 h-4 animate-spin" />} Excluir {escolhidas.length} {escolhidas.length === 1 ? 'item' : 'itens'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// EDITAR uma linha de entrada: quantidade, lote, validade, preco e nota. O
// banco ajusta o estoque pela diferenca de quantidade e move a quantidade de
// lote quando o lote muda. Observacao opcional (vai pro historico).
function EditarDialog({ linha, rpc, farmacia, onClose, onDone }: {
  linha: Linha; rpc: string; farmacia: boolean; onClose: () => void; onDone: (msg: string) => void
}) {
  const [qtd, setQtd] = useState(String(linha.quantity))
  const [lote, setLote] = useState(linha.batch_number || '')
  const [validade, setValidade] = useState(linha.expiry_date || '')
  const [preco, setPreco] = useState(linha.unit_price != null ? String(linha.unit_price) : '')
  const [nf, setNf] = useState(semNF(linha.invoice_number) ? '' : (linha.invoice_number || ''))
  const [dataNf, setDataNf] = useState(linha.invoice_date || '')
  const [entrega, setEntrega] = useState(linha.delivery_date || '')
  const [afm, setAfm] = useState(semNF(linha.afm_number) ? '' : (linha.afm_number || ''))
  const [forn, setForn] = useState(linha.supplier_name || '')
  const [obs, setObs] = useState('')
  const [nfUsada, setNfUsada] = useState<EntradaParecida | null>(null)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const trava = useTravaEnvio()

  const novaQtd = Number(qtd)
  const diferenca = Number.isFinite(novaQtd) ? novaQtd - linha.quantity : 0

  async function salvar(confirmar = false) {
    setErro(null)
    if (!Number.isInteger(novaQtd) || novaQtd <= 0) {
      setErro('Quantidade deve ser um número inteiro maior que zero. Para desfazer a entrada, use Excluir.')
      return
    }
    if (farmacia && !lote.trim()) { setErro('Medicamento precisa de lote.'); return }
    // So manda o que mudou: o historico registra exatamente o que foi alterado.
    const dados: Record<string, unknown> = {}
    const mudou = (a: unknown, b: unknown) => String(a ?? '') !== String(b ?? '')
    if (novaQtd !== linha.quantity) dados.quantity = novaQtd
    if (mudou(lote.trim(), linha.batch_number)) dados.batch_number = lote.trim()
    if (mudou(validade, linha.expiry_date)) dados.expiry_date = validade || null
    if (mudou(preco === '' ? null : Number(preco), linha.unit_price)) dados.unit_price = preco === '' ? null : Number(preco)
    if (mudou(nf.trim(), semNF(linha.invoice_number) ? '' : linha.invoice_number)) dados.invoice_number = nf.trim()
    if (mudou(dataNf, linha.invoice_date)) dados.invoice_date = dataNf || null
    if (mudou(entrega, linha.delivery_date)) dados.delivery_date = entrega || null
    if (mudou(afm.trim(), semNF(linha.afm_number) ? '' : linha.afm_number)) dados.afm_number = afm.trim()
    if (mudou(forn.trim(), linha.supplier_name)) dados.supplier_name = forn.trim()
    if (Object.keys(dados).length === 0) { setErro('Nada foi alterado.'); return }
    if (confirmar) dados.confirmar = true
    if (!trava.tentar()) return
    setSalvando(true)
    try {
      const { data, error } = await supabase.rpc(rpc, { p_entry_id: linha.id, p_dados: dados, p_obs: obs.trim() || null })
      if (error) throw error
      const d = Number((data as any)?.diferenca ?? 0)
      onDone(d === 0 ? 'Entrada editada. O estoque não mudou.'
        : `Entrada editada. Estoque ${d > 0 ? 'aumentou' : 'diminuiu'} ${Math.abs(d)} ${linha.item?.unit || 'un'}.`)
    } catch (e) {
      const aviso = lerAvisoEntrada(e)
      if (aviso?.tipo === 'nf_ja_usada') setNfUsada(aviso.info)
      else setErro(getErrorMessage(e))
    } finally {
      setSalvando(false)
      trava.liberar()
    }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>Editar entrada — {linha.item?.name || 'Item'}</DialogTitle></DialogHeader>
        <p className="text-sm text-gray-500">Entrada de {dataBR(linha.created_at, true)}. Tudo o que mudar fica no histórico.</p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <Label htmlFor="e-qtd">Quantidade</Label>
            <Input id="e-qtd" type="number" min={1} value={qtd} onChange={(e) => setQtd(e.target.value)} className="mt-1" />
            {diferenca !== 0 && Number.isFinite(diferenca) && (
              <p className={`text-xs mt-1 ${diferenca > 0 ? 'text-emerald-700' : 'text-amber-700'}`}>
                O estoque vai {diferenca > 0 ? 'aumentar' : 'diminuir'} {Math.abs(diferenca)} {linha.item?.unit || 'un'}.
              </p>
            )}
          </div>
          <div><Label htmlFor="e-lote">Lote</Label><Input id="e-lote" value={lote} onChange={(e) => setLote(e.target.value)} className="mt-1" /></div>
          <div><Label htmlFor="e-val">Validade</Label><Input id="e-val" type="date" value={validade} onChange={(e) => setValidade(e.target.value)} className="mt-1" /></div>
          <div><Label htmlFor="e-preco">Preço unitário</Label><Input id="e-preco" type="number" step="0.01" min={0} value={preco} onChange={(e) => setPreco(e.target.value)} className="mt-1" /></div>
          <div><Label htmlFor="e-nf">Número da NF</Label><Input id="e-nf" value={nf} onChange={(e) => setNf(e.target.value)} className="mt-1" /></div>
          <div><Label htmlFor="e-dnf">Data da NF</Label><Input id="e-dnf" type="date" value={dataNf} onChange={(e) => setDataNf(e.target.value)} className="mt-1" /></div>
          <div><Label htmlFor="e-ent">Data de entrega</Label><Input id="e-ent" type="date" value={entrega} onChange={(e) => setEntrega(e.target.value)} className="mt-1" /></div>
          <div><Label htmlFor="e-afm">AFM</Label><Input id="e-afm" value={afm} onChange={(e) => setAfm(e.target.value)} className="mt-1" /></div>
          <div><Label htmlFor="e-forn">Fornecedor</Label><Input id="e-forn" value={forn} onChange={(e) => setForn(e.target.value)} className="mt-1" /></div>
        </div>
        <div><Label htmlFor="e-obs">Observação (opcional)</Label><Input id="e-obs" value={obs} onChange={(e) => setObs(e.target.value)} className="mt-1" /></div>

        {nfUsada && (
          <div className="p-3 text-sm rounded-md border border-red-300 bg-red-50 text-red-900 space-y-2">
            <p><strong>Esta NF já está em outra entrada deste item:</strong> {nfUsada.quantidade} un em {dataBR(nfUsada.data, true)}.</p>
            <p className="text-xs">Se é a mesma compra lançada duas vezes, exclua a entrada repetida.</p>
            <Button size="sm" variant="outline" onClick={() => { setNfUsada(null); salvar(true) }} disabled={salvando}>
              A nota veio em mais de uma remessa — gravar mesmo assim
            </Button>
          </div>
        )}
        {erro && <div className="p-3 text-sm text-red-700 bg-red-50 border border-red-200 rounded-md">{erro}</div>}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={() => salvar()} disabled={salvando} className="gap-2">
            {salvando && <Loader2 className="w-4 h-4 animate-spin" />} Salvar alterações
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// HISTORICO da rodada: criacao + cada edicao/exclusao, com quem, quando, o
// antes/depois e a justificativa. Vem de entrada_historico (gatilho no banco).
const ROTULO_CAMPO: Record<string, string> = {
  quantity: 'Quantidade', batch_number: 'Lote', expiry_date: 'Validade', unit_price: 'Preço unitário',
  invoice_total_value: 'Valor total', invoice_number: 'NF', invoice_date: 'Data da NF', delivery_date: 'Entrega',
  afm_number: 'AFM', supplier_name: 'Fornecedor', supplier_cnpj: 'CNPJ', acquisition_type: 'Tipo',
}
const valorHist = (k: string, v: unknown) => {
  if (v == null || v === '') return '—'
  if (['expiry_date', 'invoice_date', 'delivery_date'].includes(k)) return dataBR(String(v))
  return String(v)
}

interface EventoHist {
  id: string
  entry_id: string
  acao: 'editada' | 'anulada'
  usuario_nome: string | null
  feito_em: string
  alteracoes: Record<string, { antes: unknown; depois: unknown }>
  justificativa: string | null
}

function HistoricoDialog({ rodada, onClose }: { rodada: Rodada; onClose: () => void }) {
  const [eventos, setEventos] = useState<EventoHist[] | null>(null)
  const nomeItem = (id: string) => rodada.linhas.find((l) => l.id === id)?.item?.name || 'Item'

  useEffect(() => {
    supabase.from('entrada_historico').select('*').in('entry_id', rodada.linhas.map((l) => l.id))
      .order('feito_em', { ascending: true })
      .then(({ data }) => setEventos((data || []) as EventoHist[]))
  }, [rodada])

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>Histórico da entrada de {dataBR(rodada.quando, true)}</DialogTitle></DialogHeader>
        <ol className="space-y-3 max-h-[60vh] overflow-auto text-sm">
          <li className="border-l-2 border-emerald-400 pl-3">
            <div className="font-medium text-gray-900">Criada</div>
            <div className="text-xs text-gray-500">{dataBR(rodada.quando, true)} · {rodada.autor}</div>
            <div className="text-xs text-gray-600">
              {rodada.linhas.map((l) => `${l.item?.name || 'Item'}: ${l.quantity}`).join(' · ')}
            </div>
          </li>
          {eventos === null ? (
            <li className="text-gray-400"><Loader2 className="w-4 h-4 animate-spin inline" /> carregando…</li>
          ) : eventos.map((ev) => (
            <li key={ev.id} className={`border-l-2 pl-3 ${ev.acao === 'anulada' ? 'border-red-400' : 'border-blue-300'}`}>
              <div className="font-medium text-gray-900">
                {ev.acao === 'anulada' ? 'Excluída' : 'Editada'} — {nomeItem(ev.entry_id)}
              </div>
              <div className="text-xs text-gray-500">{dataBR(ev.feito_em, true)} · {ev.usuario_nome || '—'}</div>
              {Object.entries(ev.alteracoes || {}).length > 0 && (
                <ul className="text-xs text-gray-700 mt-1">
                  {Object.entries(ev.alteracoes).map(([k, v]) => (
                    <li key={k}><strong>{ROTULO_CAMPO[k] ?? k}:</strong> {valorHist(k, v?.antes)} → {valorHist(k, v?.depois)}</li>
                  ))}
                </ul>
              )}
              {ev.justificativa && (
                <div className="text-xs text-gray-600 mt-1">
                  {ev.acao === 'anulada' ? 'Justificativa' : 'Observação'}: {ev.justificativa}
                </div>
              )}
            </li>
          ))}
          {eventos && eventos.length === 0 && <li className="text-xs text-gray-400">Nenhuma alteração desde a criação.</li>}
        </ol>
        <DialogFooter><Button variant="outline" onClick={onClose}>Fechar</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
