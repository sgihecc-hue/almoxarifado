// =============================================================================
// MODO INVENTÁRIO DO ALMOXARIFADO (05/10/2026)
//
// Pedido do dono: durante o inventário o sistema segura os pedidos do almox,
// a equipe conta item a item (quantidade/lote/validade, várias linhas por item)
// e, ao fechar, o saldo é ajustado pela diferença e sai um relatório valorizado
// pelo último preço de compra. Toda decisão vira OPÇÃO escolhida na abertura.
//
// Tudo que grava passa pelas RPCs almox_inventario_* (migrations
// 20261005120000..120200), que checam o papel de novo no banco. A tela só
// esconde botões; quem manda é o banco.
//
//   sem inventário aberto ... histórico + "Abrir inventário" (gestor/admin)
//   com inventário aberto ... Contagem | Conferência (gestor/admin) | Pedidos parados
//                             + Fechar / Cancelar (gestor/admin)
//   ?relatorio=<id> ......... relatório do inventário (resumo + itens + .xlsx)
// =============================================================================
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import * as XLSX from 'xlsx'
import { saveAs } from 'file-saver'
import {
  ClipboardCheck, Loader2, RefreshCw, Search, Plus, Trash2, Lock, Unlock, FileSpreadsheet,
  ArrowLeft, AlertTriangle, CheckCircle2, XCircle,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { ErroCarregamento } from '@/components/ui/erro-carregamento'
import { useModule } from '@/contexts/module'
import { getErrorMessage } from '@/lib/utils/error-messages'
import { dataBR, hojeLocal, lerQuantidade, normalizarBusca } from '@/lib/utils/seguro'
import {
  almoxInventarioService as svc,
  type Bloqueio, type Inventario, type ItemInventario, type LinhaContagem, type LinhaResultado,
  type NaoContados, type PedidoParado, type ResumoInventario, type Liberacao,
} from '@/lib/services/almox-inventario'

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
const moeda = (v: number | null | undefined) =>
  Number(v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const inteiro = (v: number | null | undefined) => Number(v ?? 0).toLocaleString('pt-BR')
const dataHora = (s: string | null | undefined) =>
  s ? new Date(s).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—'
const sinal = (n: number) => (n > 0 ? `+${inteiro(n)}` : inteiro(n))

const NOME_BLOQUEIO: Record<Bloqueio, string> = {
  todos: 'Todos os pedidos e saídas',
  novos: 'Só pedidos novos',
}
const NOME_NAO_CONTADOS: Record<NaoContados, string> = {
  manter: 'Manter saldo do sistema',
  zerar: 'Zerar',
}
const NOME_STATUS: Record<Inventario['status'], string> = {
  aberto: 'Aberto',
  fechado: 'Fechado',
  cancelado: 'Cancelado',
}
const NOME_STATUS_PEDIDO: Record<string, string> = {
  pending: 'Pendente',
  approved: 'Aprovado',
  processing: 'Em processamento',
}

/** Trava de duplo clique: o estado do React não bloqueia o 2º clique no mesmo tick. */
function useTrava() {
  const ref = useRef(false)
  return {
    tentar: () => { if (ref.current) return false; ref.current = true; return true },
    liberar: () => { ref.current = false },
  }
}

function Selo({ cor, children }: { cor: 'verde' | 'cinza' | 'amarelo' | 'vermelho' | 'azul'; children: React.ReactNode }) {
  const cls = {
    verde: 'bg-emerald-50 text-emerald-800 border-emerald-200',
    cinza: 'bg-gray-50 text-gray-600 border-gray-200',
    amarelo: 'bg-amber-50 text-amber-800 border-amber-200',
    vermelho: 'bg-red-50 text-red-800 border-red-200',
    azul: 'bg-blue-50 text-blue-800 border-blue-200',
  }[cor]
  return <span className={`inline-block text-xs px-2 py-0.5 rounded-full border font-medium ${cls}`}>{children}</span>
}

function Cartao({ titulo, valor, detalhe, cor }: { titulo: string; valor: string; detalhe?: string; cor?: string }) {
  return (
    <div className="bg-white border border-gray-100 rounded-xl shadow-sm p-4">
      <p className="text-xs uppercase tracking-wide text-gray-500 font-semibold">{titulo}</p>
      <p className={`text-xl font-bold mt-1 ${cor ?? 'text-gray-900'}`}>{valor}</p>
      {detalhe && <p className="text-xs text-gray-500 mt-0.5">{detalhe}</p>}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Página
// ---------------------------------------------------------------------------
export function InventarioAlmox() {
  const { perfil } = useModule()
  const gestao = perfil.papel === 'gestor' || perfil.papel === 'administrador'
  const admin = perfil.papel === 'administrador'
  const [params, setParams] = useSearchParams()
  const relatorioId = params.get('relatorio')

  const [lista, setLista] = useState<Inventario[]>([])
  const [nomes, setNomes] = useState<Record<string, string>>({})
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<unknown>(null)
  const [abrindo, setAbrindo] = useState(false)
  const [aviso, setAviso] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    setCarregando(true); setErro(null)
    try {
      const invs = await svc.listar()
      setLista(invs)
      setNomes(await svc.nomesUsuarios(invs.flatMap((i) => [i.aberto_por, i.fechado_por ?? '', i.cancelado_por ?? ''])))
    } catch (e) {
      setErro(e)
    } finally {
      setCarregando(false)
    }
  }, [])

  useEffect(() => { void carregar() }, [carregar])
  useEffect(() => {
    if (!aviso) return
    const t = setTimeout(() => setAviso(null), 5000)
    return () => clearTimeout(t)
  }, [aviso])

  const aberto = lista.find((i) => i.status === 'aberto') ?? null

  const abrirRelatorio = (id: string) => setParams({ relatorio: id })
  const voltar = () => setParams({})

  if (relatorioId) {
    return <Relatorio id={relatorioId} nomes={nomes} onVoltar={voltar} />
  }

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <ClipboardCheck className="w-6 h-6 text-emerald-600" /> Inventário do Almoxarifado
          </h1>
          <p className="text-sm text-gray-500 max-w-3xl">
            Durante o inventário os pedidos do almoxarifado ficam parados. A equipe conta item a item
            (quantidade, lote e validade). Ao fechar, o saldo de cada item é ajustado pela diferença
            entre o contado e o sistema, e sai o relatório valorizado pelo último preço de compra.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => void carregar()} disabled={carregando} className="gap-2">
            {carregando ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />} Atualizar
          </Button>
          {!aberto && gestao && !carregando && !erro && (
            <Button onClick={() => setAbrindo(true)} className="gap-2 bg-emerald-600 hover:bg-emerald-700 text-white">
              <Lock className="w-4 h-4" /> Abrir inventário
            </Button>
          )}
        </div>
      </div>

      {aviso && (
        <div className="p-3 text-sm rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-900 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0" /> {aviso}
        </div>
      )}

      <ErroCarregamento erro={erro} onTentar={carregar} titulo="Não foi possível carregar os inventários." />

      {carregando && lista.length === 0 && !erro ? (
        <div className="p-10 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>
      ) : aberto ? (
        <InventarioAberto
          inv={aberto}
          nomes={nomes}
          gestao={gestao}
          admin={admin}
          onFechado={(id) => { void carregar(); abrirRelatorio(id) }}
          onCancelado={() => { setAviso('Inventário cancelado. Nenhum saldo foi alterado e os pedidos voltaram ao normal.'); void carregar() }}
        />
      ) : !erro && (
        <div className="p-4 rounded-lg border border-gray-200 bg-white text-sm text-gray-600">
          Nenhum inventário aberto. O almoxarifado está funcionando normalmente.
          {!gestao && ' Só o gestor do almoxarifado ou o administrador abre um inventário.'}
        </div>
      )}

      {!erro && <Historico lista={lista.filter((i) => i.status !== 'aberto')} nomes={nomes} onRelatorio={abrirRelatorio} />}

      {abrindo && (
        <AbrirDialog
          onClose={() => setAbrindo(false)}
          onAberto={(n) => { setAbrindo(false); setAviso(`Inventário nº ${n} aberto. Pedidos do almoxarifado bloqueados até o fechamento.`); void carregar() }}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Histórico
// ---------------------------------------------------------------------------
function Historico({ lista, nomes, onRelatorio }: { lista: Inventario[]; nomes: Record<string, string>; onRelatorio: (id: string) => void }) {
  return (
    <div className="bg-white border border-gray-100 rounded-xl shadow-sm overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100 font-semibold text-gray-900">Inventários anteriores</div>
      {lista.length === 0 ? (
        <p className="p-6 text-sm text-gray-400 text-center">Nenhum inventário anterior.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs uppercase text-gray-500">
              <tr>
                <th className="text-left px-4 py-2">Nº</th>
                <th className="text-left px-4 py-2">Aberto</th>
                <th className="text-left px-4 py-2">Encerrado</th>
                <th className="text-left px-4 py-2">Status</th>
                <th className="text-left px-4 py-2">Resumo</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {lista.map((i) => {
                const r = i.resumo
                return (
                  <tr key={i.id} className="border-t border-gray-100 align-top">
                    <td className="px-4 py-2 font-medium">{i.numero}</td>
                    <td className="px-4 py-2">{dataHora(i.aberto_em)}<br /><span className="text-xs text-gray-500">{nomes[i.aberto_por] ?? '—'}</span></td>
                    <td className="px-4 py-2">
                      {i.status === 'fechado' ? (
                        <>{dataHora(i.fechado_em)}<br /><span className="text-xs text-gray-500">{(i.fechado_por && nomes[i.fechado_por]) ?? '—'}</span></>
                      ) : (
                        <>{dataHora(i.cancelado_em)}<br /><span className="text-xs text-gray-500">{(i.cancelado_por && nomes[i.cancelado_por]) ?? '—'}</span></>
                      )}
                    </td>
                    <td className="px-4 py-2">
                      <Selo cor={i.status === 'fechado' ? 'verde' : 'cinza'}>{NOME_STATUS[i.status]}</Selo>
                    </td>
                    <td className="px-4 py-2 text-xs text-gray-600">
                      {r ? (
                        <>
                          {inteiro(r.itens_contados)} contados · {inteiro(r.itens_com_sobra)} com sobra ({moeda(r.valor_sobra)}) ·{' '}
                          {inteiro(r.itens_com_falta)} com falta ({moeda(r.valor_falta)})
                        </>
                      ) : i.status === 'cancelado' ? (
                        <>Motivo: {i.motivo_cancelamento ?? '—'}</>
                      ) : '—'}
                    </td>
                    <td className="px-4 py-2 text-right">
                      <Button size="sm" variant="outline" onClick={() => onRelatorio(i.id)}>Relatório</Button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Abrir
// ---------------------------------------------------------------------------
function Opcao({ marcado, onClick, titulo, children }: { marcado: boolean; onClick: () => void; titulo: string; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick}
      className={`w-full text-left p-3 rounded-lg border transition ${marcado ? 'border-emerald-500 bg-emerald-50 ring-1 ring-emerald-500' : 'border-gray-200 hover:bg-gray-50'}`}>
      <p className="font-medium text-gray-900 flex items-center gap-2">
        <span className={`w-4 h-4 rounded-full border-2 ${marcado ? 'border-emerald-600 bg-emerald-600' : 'border-gray-300'}`} />
        {titulo}
      </p>
      <p className="text-xs text-gray-600 mt-1 ml-6">{children}</p>
    </button>
  )
}

function AbrirDialog({ onClose, onAberto }: { onClose: () => void; onAberto: (numero: number) => void }) {
  const [bloqueio, setBloqueio] = useState<Bloqueio>('todos')
  const [liberacao, setLiberacao] = useState(true)
  const [naoContados, setNaoContados] = useState<NaoContados>('manter')
  const [obs, setObs] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const trava = useTrava()

  async function abrir() {
    if (!trava.tentar()) return
    setSalvando(true); setErro(null)
    try {
      const r = await svc.abrir({ bloqueio, permiteLiberacao: bloqueio === 'todos' && liberacao, naoContados, observacao: obs })
      onAberto(r.numero)
    } catch (e) {
      setErro(getErrorMessage(e))
      setSalvando(false)
      trava.liberar()
    }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !salvando) onClose() }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Abrir inventário do almoxarifado</DialogTitle></DialogHeader>

        <div className="space-y-2">
          <p className="text-sm font-semibold text-gray-900">O que fica bloqueado enquanto o inventário estiver aberto?</p>
          <Opcao marcado={bloqueio === 'todos'} onClick={() => setBloqueio('todos')} titulo="Todos os pedidos e saídas (recomendado)">
            Ninguém cria pedido novo do almoxarifado e nada sai do estoque: entrega de pedido, Saída Direta,
            quebras/avarias, vencimentos e empréstimos ficam parados até o fechamento. Assim o que está na
            prateleira não muda durante a contagem.
          </Opcao>
          <Opcao marcado={bloqueio === 'novos'} onClick={() => setBloqueio('novos')} titulo="Só pedidos novos">
            Ninguém cria pedido novo, mas os pedidos que já existem podem ser entregues e as saídas continuam.
            Use se o inventário for longo. O ajuste considera as saídas feitas depois de cada item contado.
          </Opcao>
        </div>

        {bloqueio === 'todos' && (
          <div className="space-y-2">
            <p className="text-sm font-semibold text-gray-900">Permitir que o administrador libere uma saída urgente?</p>
            <div className="grid grid-cols-2 gap-2">
              <Opcao marcado={liberacao} onClick={() => setLiberacao(true)} titulo="Sim">
                O administrador pode liberar um pedido específico (com motivo registrado) para ser entregue durante o inventário.
              </Opcao>
              <Opcao marcado={!liberacao} onClick={() => setLiberacao(false)} titulo="Não">
                Nenhuma entrega até o fechamento.
              </Opcao>
            </div>
          </div>
        )}

        <div className="space-y-2">
          <p className="text-sm font-semibold text-gray-900">Itens que ninguém contar, ao fechar:</p>
          <Opcao marcado={naoContados === 'manter'} onClick={() => setNaoContados('manter')} titulo="Manter o saldo do sistema (recomendado)">
            Item não contado continua com o saldo que o sistema tem. Bom para inventário parcial ou por setor.
          </Opcao>
          <Opcao marcado={naoContados === 'zerar'} onClick={() => setNaoContados('zerar')} titulo="Zerar">
            Item não contado fica com saldo 0 (considera que não foi encontrado). Só use em inventário geral,
            quando todos os itens da prateleira forem contados.
          </Opcao>
        </div>

        <div>
          <Label htmlFor="inv-obs">Observação (opcional)</Label>
          <Input id="inv-obs" value={obs} onChange={(e) => setObs(e.target.value)} maxLength={300}
            placeholder="Ex.: Inventário anual FESF" className="mt-1" />
        </div>

        {erro && <div className="p-3 text-sm text-red-700 bg-red-50 border border-red-200 rounded-md">{erro}</div>}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={salvando}>Voltar</Button>
          <Button onClick={() => void abrir()} disabled={salvando} className="gap-2 bg-emerald-600 hover:bg-emerald-700 text-white">
            {salvando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Lock className="w-4 h-4" />} Abrir inventário
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Inventário aberto
// ---------------------------------------------------------------------------
type Aba = 'contagem' | 'conferencia' | 'pedidos'

function InventarioAberto({ inv, nomes, gestao, admin, onFechado, onCancelado }: {
  inv: Inventario; nomes: Record<string, string>; gestao: boolean; admin: boolean
  onFechado: (id: string) => void; onCancelado: () => void
}) {
  const [aba, setAba] = useState<Aba>('contagem')
  const [fechando, setFechando] = useState(false)
  const [cancelando, setCancelando] = useState(false)

  const abas: Array<[Aba, string]> = [
    ['contagem', 'Contagem'],
    ...(gestao ? [['conferencia', 'Conferência'] as [Aba, string]] : []),
    ['pedidos', 'Pedidos parados'],
  ]

  return (
    <div className="space-y-4">
      <div className="p-4 rounded-xl border-2 border-amber-400 bg-amber-50 text-amber-900 space-y-2">
        <p className="font-semibold flex items-center gap-2">
          <AlertTriangle className="w-5 h-5 text-amber-600" />
          Inventário nº {inv.numero} aberto desde {dataHora(inv.aberto_em)} por {nomes[inv.aberto_por] ?? '—'}
        </p>
        <div className="text-sm flex flex-wrap gap-x-6 gap-y-1">
          <span>Bloqueio: <strong>{NOME_BLOQUEIO[inv.bloqueio]}</strong></span>
          {inv.bloqueio === 'todos' && <span>Liberação urgente: <strong>{inv.permite_liberacao_urgente ? 'permitida (administrador)' : 'não'}</strong></span>}
          <span>Não contados ao fechar: <strong>{NOME_NAO_CONTADOS[inv.nao_contados]}</strong></span>
          {inv.observacao && <span>Obs.: {inv.observacao}</span>}
        </div>
        <p className="text-xs">
          Entradas por NF continuam liberadas (mercadoria pode chegar). Para não contar duas vezes, conte o item
          antes de guardar a mercadoria nova — ou, se ela já foi guardada, salve a contagem do item de novo depois da entrada.
        </p>
        {gestao && (
          <div className="flex gap-2 pt-1 flex-wrap">
            <Button onClick={() => setFechando(true)} className="gap-2 bg-emerald-600 hover:bg-emerald-700 text-white">
              <Unlock className="w-4 h-4" /> Fechar inventário
            </Button>
            <Button variant="outline" onClick={() => setCancelando(true)} className="gap-2 text-red-700 border-red-300 hover:bg-red-50">
              <XCircle className="w-4 h-4" /> Cancelar inventário
            </Button>
          </div>
        )}
      </div>

      <div className="flex gap-1 border-b border-gray-200">
        {abas.map(([k, rot]) => (
          <button key={k} type="button" onClick={() => setAba(k)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${aba === k ? 'border-emerald-600 text-emerald-700' : 'border-transparent text-gray-500 hover:text-gray-800'}`}>
            {rot}
          </button>
        ))}
      </div>

      {aba === 'contagem' && <Contagem inv={inv} gestao={gestao} />}
      {aba === 'conferencia' && gestao && <Conferencia inv={inv} />}
      {aba === 'pedidos' && <PedidosParados inv={inv} admin={admin} />}

      {fechando && <FecharDialog inv={inv} onClose={() => setFechando(false)} onFechado={() => { setFechando(false); onFechado(inv.id) }} />}
      {cancelando && <CancelarDialog inv={inv} onClose={() => setCancelando(false)} onCancelado={() => { setCancelando(false); onCancelado() }} />}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Contagem
// ---------------------------------------------------------------------------
type FiltroContagem = 'todos' | 'nao' | 'sim'

function Contagem({ inv, gestao }: { inv: Inventario; gestao: boolean }) {
  const [itens, setItens] = useState<ItemInventario[]>([])
  const [linhas, setLinhas] = useState<LinhaContagem[]>([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<unknown>(null)
  const [busca, setBusca] = useState('')
  const [filtro, setFiltro] = useState<FiltroContagem>('todos')
  const [editando, setEditando] = useState<ItemInventario | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    setCarregando(true); setErro(null)
    try {
      const [its, ls] = await Promise.all([svc.itensAtivos(gestao), svc.contagens(inv.id)])
      setItens(its)
      setLinhas(ls)
    } catch (e) {
      setErro(e)
    } finally {
      setCarregando(false)
    }
  }, [inv.id, gestao])

  useEffect(() => { void carregar() }, [carregar])
  useEffect(() => {
    if (!aviso) return
    const t = setTimeout(() => setAviso(null), 4000)
    return () => clearTimeout(t)
  }, [aviso])

  const porItem = useMemo(() => {
    const m = new Map<string, LinhaContagem[]>()
    for (const l of linhas) {
      if (!m.has(l.item_id)) m.set(l.item_id, [])
      m.get(l.item_id)!.push(l)
    }
    return m
  }, [linhas])

  const visiveis = useMemo(() => {
    const q = normalizarBusca(busca)
    return itens.filter((i) => {
      const contado = porItem.has(i.id)
      if (filtro === 'nao' && contado) return false
      if (filtro === 'sim' && !contado) return false
      if (!q) return true
      return normalizarBusca(i.name).includes(q) || normalizarBusca(i.code).includes(q)
    })
  }, [itens, porItem, busca, filtro])

  const contados = itens.filter((i) => porItem.has(i.id)).length
  const MAX = 300

  return (
    <div className="space-y-3">
      <div className="bg-white border border-gray-100 rounded-xl shadow-sm p-4 flex flex-wrap gap-3 items-end">
        <div className="flex-1 min-w-[16rem]">
          <Label htmlFor="inv-busca">Buscar item</Label>
          <div className="relative mt-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <Input id="inv-busca" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Nome ou código" className="pl-9" autoFocus />
          </div>
        </div>
        <div className="flex gap-1">
          {([['todos', 'Todos'], ['nao', 'Não contados'], ['sim', 'Contados']] as Array<[FiltroContagem, string]>).map(([v, rot]) => (
            <Button key={v} size="sm" variant={filtro === v ? 'default' : 'outline'} onClick={() => setFiltro(v)}>{rot}</Button>
          ))}
        </div>
        <Button size="sm" variant="outline" onClick={() => void carregar()} disabled={carregando} className="gap-1">
          {carregando ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />} Atualizar
        </Button>
        <p className="w-full text-sm text-gray-600">
          <strong>{inteiro(contados)}</strong> de {inteiro(itens.length)} itens ativos contados.
          {!gestao && ' O saldo do sistema não aparece aqui, para a contagem ser às cegas.'}
        </p>
      </div>

      {aviso && (
        <div className="p-3 text-sm rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-900 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0" /> {aviso}
        </div>
      )}

      <ErroCarregamento erro={erro} onTentar={carregar} titulo="Não foi possível carregar os itens e a contagem." />

      {carregando && itens.length === 0 && !erro ? (
        <div className="p-10 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>
      ) : !erro && visiveis.length === 0 ? (
        <div className="p-10 text-center text-sm text-gray-400 bg-white border border-gray-100 rounded-xl">Nenhum item encontrado.</div>
      ) : !erro && (
        <div className="bg-white border border-gray-100 rounded-xl shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs uppercase text-gray-500">
                <tr>
                  <th className="text-left px-4 py-2">Item</th>
                  <th className="text-left px-4 py-2">Unid.</th>
                  {gestao && <th className="text-right px-4 py-2">Saldo sistema</th>}
                  <th className="text-right px-4 py-2">Contado</th>
                  <th className="text-left px-4 py-2">Status</th>
                  <th className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {visiveis.slice(0, MAX).map((i) => {
                  const ls = porItem.get(i.id)
                  const total = ls ? ls.reduce((s, l) => s + l.quantidade, 0) : null
                  return (
                    <tr key={i.id} className="border-t border-gray-100 hover:bg-gray-50 cursor-pointer" onClick={() => setEditando(i)}>
                      <td className="px-4 py-2">
                        <p className="font-medium text-gray-900">{i.name}</p>
                        {i.code && <p className="text-xs text-gray-500">Cód. {i.code}</p>}
                      </td>
                      <td className="px-4 py-2 text-gray-600">{i.unit ?? '—'}</td>
                      {gestao && <td className="px-4 py-2 text-right text-gray-600">{inteiro(i.current_stock)}</td>}
                      <td className="px-4 py-2 text-right font-semibold">
                        {total === null ? '—' : inteiro(total)}
                        {ls && ls.length > 1 && <span className="block text-xs font-normal text-gray-500">{ls.length} linhas</span>}
                      </td>
                      <td className="px-4 py-2">
                        {ls ? <Selo cor="verde">Contado</Selo> : <Selo cor="cinza">Não contado</Selo>}
                      </td>
                      <td className="px-4 py-2 text-right">
                        <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); setEditando(i) }}>
                          {ls ? 'Editar' : 'Contar'}
                        </Button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {visiveis.length > MAX && (
            <p className="px-4 py-2 text-xs text-gray-500 border-t border-gray-100">
              Mostrando {MAX} de {inteiro(visiveis.length)} itens. Use a busca para achar os demais.
            </p>
          )}
        </div>
      )}

      {editando && (
        <EditorItem
          inv={inv}
          item={editando}
          gestao={gestao}
          linhasAtuais={porItem.get(editando.id) ?? []}
          onClose={() => setEditando(null)}
          onSalvo={(msg) => { setEditando(null); setAviso(msg); void carregar() }}
        />
      )}
    </div>
  )
}

interface LinhaEdit { chave: number; quantidade: string; lote: string; validade: string }

function EditorItem({ inv, item, gestao, linhasAtuais, onClose, onSalvo }: {
  inv: Inventario; item: ItemInventario; gestao: boolean; linhasAtuais: LinhaContagem[]
  onClose: () => void; onSalvo: (msg: string) => void
}) {
  const seq = useRef(0)
  const nova = (l?: Partial<LinhaEdit>): LinhaEdit => ({ chave: ++seq.current, quantidade: '', lote: '', validade: '', ...l })
  const [linhas, setLinhas] = useState<LinhaEdit[]>(() =>
    linhasAtuais.length
      ? linhasAtuais.map((l) => nova({ quantidade: String(l.quantidade), lote: l.lote ?? '', validade: l.validade ?? '' }))
      : [nova()])
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const trava = useTrava()

  const mudar = (chave: number, campo: keyof Omit<LinhaEdit, 'chave'>, valor: string) =>
    setLinhas((ls) => ls.map((l) => (l.chave === chave ? { ...l, [campo]: valor } : l)))
  const remover = (chave: number) => setLinhas((ls) => ls.filter((l) => l.chave !== chave))

  const total = linhas.reduce((s, l) => s + (lerQuantidade(l.quantidade) ?? 0), 0)

  function validar(): string | null {
    for (const [i, l] of linhas.entries()) {
      const q = lerQuantidade(l.quantidade)
      if (q === null) return `Linha ${i + 1}: informe a quantidade (número inteiro, 0 ou mais).`
      if (q < 0) return `Linha ${i + 1}: a quantidade não pode ser negativa.`
      if (l.validade && !/^\d{4}-\d{2}-\d{2}$/.test(l.validade)) return `Linha ${i + 1}: validade inválida.`
    }
    return null
  }

  async function salvar(apagar = false) {
    setErro(null)
    if (!apagar) {
      if (linhas.length === 0) { setErro('Adicione ao menos uma linha, ou use "Apagar contagem".'); return }
      const v = validar()
      if (v) { setErro(v); return }
    }
    if (!trava.tentar()) return
    setSalvando(true)
    try {
      const enviar = apagar ? [] : linhas.map((l) => ({ quantidade: String(lerQuantidade(l.quantidade)), lote: l.lote, validade: l.validade }))
      const r = await svc.salvarItem(inv.id, item.id, enviar)
      onSalvo(apagar
        ? `Contagem de "${item.name}" apagada: o item voltou a "não contado".`
        : `"${item.name}": ${inteiro(r.total)} ${item.unit ?? ''} contados em ${r.linhas} ${r.linhas === 1 ? 'linha' : 'linhas'}.`)
    } catch (e) {
      setErro(getErrorMessage(e))
      setSalvando(false)
      trava.liberar()
    }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !salvando) onClose() }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Contagem: {item.name}</DialogTitle></DialogHeader>
        <p className="text-sm text-gray-600">
          {item.code ? `Cód. ${item.code} · ` : ''}Unidade: {item.unit ?? '—'}
          {gestao && <> · Saldo no sistema agora: <strong>{inteiro(item.current_stock)}</strong></>}
        </p>
        <p className="text-xs text-gray-500">
          Uma linha por lote/validade encontrada. Sem lote? Deixe lote e validade em branco.
          Salvar de novo substitui a contagem anterior deste item.
        </p>

        <div className="space-y-2">
          <div className="grid grid-cols-[1fr_1.3fr_1.3fr_auto] gap-2 text-xs font-semibold text-gray-500 uppercase">
            <span>Quantidade</span><span>Lote</span><span>Validade</span><span></span>
          </div>
          {linhas.map((l, i) => (
            <div key={l.chave} className="grid grid-cols-[1fr_1.3fr_1.3fr_auto] gap-2 items-center">
              <Input inputMode="numeric" value={l.quantidade} onChange={(e) => mudar(l.chave, 'quantidade', e.target.value)}
                placeholder="0" aria-label={`Quantidade linha ${i + 1}`} autoFocus={i === linhas.length - 1} />
              <Input value={l.lote} onChange={(e) => mudar(l.chave, 'lote', e.target.value)} maxLength={60}
                placeholder="(sem lote)" aria-label={`Lote linha ${i + 1}`} />
              <Input type="date" value={l.validade} onChange={(e) => mudar(l.chave, 'validade', e.target.value)}
                min="2015-01-01" aria-label={`Validade linha ${i + 1}`} />
              <button type="button" onClick={() => remover(l.chave)} title="Remover linha"
                className="p-2 rounded-md text-red-600 hover:bg-red-50">
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
          <div className="flex items-center justify-between">
            <Button type="button" size="sm" variant="outline" onClick={() => setLinhas((ls) => [...ls, nova()])} className="gap-1">
              <Plus className="w-4 h-4" /> Adicionar linha
            </Button>
            <p className="text-sm">Total contado: <strong>{inteiro(total)}</strong> {item.unit ?? ''}</p>
          </div>
        </div>

        {erro && <div className="p-3 text-sm text-red-700 bg-red-50 border border-red-200 rounded-md">{erro}</div>}

        <DialogFooter className="gap-2 flex-wrap">
          {linhasAtuais.length > 0 && (
            <Button variant="outline" onClick={() => void salvar(true)} disabled={salvando}
              className="text-red-700 border-red-300 hover:bg-red-50 sm:mr-auto">
              Apagar contagem
            </Button>
          )}
          <Button variant="outline" onClick={onClose} disabled={salvando}>Voltar</Button>
          <Button onClick={() => void salvar()} disabled={salvando} className="gap-2 bg-emerald-600 hover:bg-emerald-700 text-white">
            {salvando && <Loader2 className="w-4 h-4 animate-spin" />} Salvar item
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Conferência (gestor/admin)
// ---------------------------------------------------------------------------
type FiltroConf = 'todos' | 'diferenca' | 'nao_contados'

function totais(rs: LinhaResultado[]) {
  const t = { contados: 0, naoContados: 0, sobra: 0, falta: 0, qSobra: 0, qFalta: 0, vSobra: 0, vFalta: 0, mudamNaoContados: 0, negativos: 0, semPreco: 0 }
  for (const r of rs) {
    if (r.contado) t.contados++; else t.naoContados++
    if (!r.contado && r.diferenca !== 0) t.mudamNaoContados++
    if (r.diferenca > 0) { t.sobra++; t.qSobra += r.diferenca; t.vSobra += Number(r.valor_diferenca) }
    if (r.diferenca < 0) { t.falta++; t.qFalta -= r.diferenca; t.vFalta -= Number(r.valor_diferenca) }
    if (r.saldo_depois < 0) t.negativos++
    if (Number(r.valor_unitario) === 0 && (r.contado || r.saldo_depois > 0)) t.semPreco++
  }
  return t
}

function Conferencia({ inv }: { inv: Inventario }) {
  const [rs, setRs] = useState<LinhaResultado[]>([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<unknown>(null)
  const [filtro, setFiltro] = useState<FiltroConf>('diferenca')
  const [busca, setBusca] = useState('')

  const carregar = useCallback(async () => {
    setCarregando(true); setErro(null)
    try { setRs(await svc.previa(inv.id)) } catch (e) { setErro(e) } finally { setCarregando(false) }
  }, [inv.id])
  useEffect(() => { void carregar() }, [carregar])

  const t = useMemo(() => totais(rs), [rs])
  const visiveis = useMemo(() => {
    const q = normalizarBusca(busca)
    return rs.filter((r) => {
      if (filtro === 'diferenca' && r.diferenca === 0) return false
      if (filtro === 'nao_contados' && r.contado) return false
      if (q && !normalizarBusca(r.item_nome).includes(q) && !normalizarBusca(r.item_codigo).includes(q)) return false
      return true
    })
  }, [rs, filtro, busca])

  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-600">
        Prévia do que o fechamento faria <strong>agora</strong>. Diferença = contado − saldo do sistema no momento
        em que o item foi contado; ela é somada ao saldo atual (saídas e entradas feitas depois da contagem continuam valendo).
        Valor unitário = último preço de compra (sem ele, o preço do cadastro).
      </p>
      <ErroCarregamento erro={erro} onTentar={carregar} titulo="Não foi possível carregar a conferência." />
      {!erro && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Cartao titulo="Contados" valor={inteiro(t.contados)} detalhe={`${inteiro(t.naoContados)} não contados`} />
          <Cartao titulo="Sobras" valor={moeda(t.vSobra)} detalhe={`${inteiro(t.sobra)} itens · ${inteiro(t.qSobra)} un`} cor="text-emerald-700" />
          <Cartao titulo="Faltas" valor={moeda(t.vFalta)} detalhe={`${inteiro(t.falta)} itens · ${inteiro(t.qFalta)} un`} cor="text-red-700" />
          <Cartao titulo="Resultado líquido" valor={moeda(t.vSobra - t.vFalta)} detalhe={t.semPreco ? `${t.semPreco} itens sem preço (valor 0)` : undefined} />
        </div>
      )}
      <div className="bg-white border border-gray-100 rounded-xl shadow-sm p-3 flex flex-wrap gap-3 items-end">
        <div className="flex-1 min-w-[14rem]">
          <Label htmlFor="conf-busca">Buscar</Label>
          <Input id="conf-busca" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Nome ou código" className="mt-1" />
        </div>
        <div className="flex gap-1">
          {([['diferenca', 'Só com diferença'], ['nao_contados', 'Não contados'], ['todos', 'Todos']] as Array<[FiltroConf, string]>).map(([v, rot]) => (
            <Button key={v} size="sm" variant={filtro === v ? 'default' : 'outline'} onClick={() => setFiltro(v)}>{rot}</Button>
          ))}
        </div>
        <Button size="sm" variant="outline" onClick={() => void carregar()} disabled={carregando} className="gap-1">
          {carregando ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />} Atualizar
        </Button>
      </div>
      {!erro && <TabelaResultado linhas={visiveis} carregando={carregando} />}
    </div>
  )
}

function TabelaResultado({ linhas, carregando, comLotes }: { linhas: LinhaResultado[]; carregando: boolean; comLotes?: boolean }) {
  if (carregando && linhas.length === 0) {
    return <div className="p-10 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>
  }
  if (linhas.length === 0) {
    return <div className="p-10 text-center text-sm text-gray-400 bg-white border border-gray-100 rounded-xl">Nenhum item neste filtro.</div>
  }
  return (
    <div className="bg-white border border-gray-100 rounded-xl shadow-sm overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs uppercase text-gray-500">
            <tr>
              <th className="text-left px-3 py-2">Item</th>
              <th className="text-right px-3 py-2" title="Saldo do sistema quando o item foi contado">Sistema na contagem</th>
              <th className="text-right px-3 py-2">Contado</th>
              <th className="text-right px-3 py-2">Diferença</th>
              <th className="text-right px-3 py-2">Saldo antes → depois</th>
              <th className="text-right px-3 py-2">Valor unit.</th>
              <th className="text-right px-3 py-2">Valor diferença</th>
              {comLotes && <th className="text-left px-3 py-2">Lotes contados</th>}
            </tr>
          </thead>
          <tbody>
            {linhas.map((r) => (
              <tr key={r.item_id} className="border-t border-gray-100 align-top">
                <td className="px-3 py-2">
                  <p className="font-medium text-gray-900">{r.item_nome ?? '—'}</p>
                  <p className="text-xs text-gray-500">{r.item_codigo ? `Cód. ${r.item_codigo} · ` : ''}{r.unidade ?? ''}</p>
                </td>
                <td className="px-3 py-2 text-right text-gray-600">{r.contado ? inteiro(r.saldo_sistema_contagem) : '—'}</td>
                <td className="px-3 py-2 text-right">{r.contado ? <strong>{inteiro(r.quantidade_contada)}</strong> : <Selo cor="cinza">Não contado</Selo>}</td>
                <td className={`px-3 py-2 text-right font-semibold ${r.diferenca > 0 ? 'text-emerald-700' : r.diferenca < 0 ? 'text-red-700' : 'text-gray-500'}`}>
                  {sinal(r.diferenca)}
                </td>
                <td className={`px-3 py-2 text-right whitespace-nowrap ${r.saldo_depois < 0 ? 'text-red-700 font-bold' : 'text-gray-600'}`}>
                  {inteiro(r.saldo_antes)} → {inteiro(r.saldo_depois)}
                </td>
                <td className="px-3 py-2 text-right text-gray-600 whitespace-nowrap">{moeda(r.valor_unitario)}</td>
                <td className={`px-3 py-2 text-right whitespace-nowrap ${Number(r.valor_diferenca) > 0 ? 'text-emerald-700' : Number(r.valor_diferenca) < 0 ? 'text-red-700' : 'text-gray-500'}`}>
                  {moeda(r.valor_diferenca)}
                </td>
                {comLotes && (
                  <td className="px-3 py-2 text-xs text-gray-600">
                    {(r.lotes ?? []).map((l, i) => (
                      <div key={i}>{l.lote ?? 'sem lote'}{l.validade ? ` · val. ${dataBR(l.validade)}` : ''}: {inteiro(l.quantidade)}</div>
                    ))}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Pedidos parados
// ---------------------------------------------------------------------------
function PedidosParados({ inv, admin }: { inv: Inventario; admin: boolean }) {
  const navigate = useNavigate()
  const [ps, setPs] = useState<PedidoParado[]>([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<unknown>(null)
  const [liberando, setLiberando] = useState<PedidoParado | null>(null)

  const carregar = useCallback(async () => {
    setCarregando(true); setErro(null)
    try { setPs(await svc.pedidosParados(inv.id)) } catch (e) { setErro(e) } finally { setCarregando(false) }
  }, [inv.id])
  useEffect(() => { void carregar() }, [carregar])

  const podeLiberar = admin && inv.bloqueio === 'todos' && inv.permite_liberacao_urgente

  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-600">
        {inv.bloqueio === 'todos'
          ? 'Pedidos do almoxarifado em aberto. Nenhum pode ser entregue até o fechamento'
            + (inv.permite_liberacao_urgente ? ', a não ser que o administrador libere (urgência, com motivo).' : '.')
          : 'Neste inventário só os pedidos novos estão bloqueados; os pedidos abaixo podem ser entregues normalmente.'}
      </p>
      <ErroCarregamento erro={erro} onTentar={carregar} titulo="Não foi possível carregar os pedidos." />
      {carregando && ps.length === 0 && !erro ? (
        <div className="p-10 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>
      ) : !erro && ps.length === 0 ? (
        <div className="p-10 text-center text-sm text-gray-400 bg-white border border-gray-100 rounded-xl">Nenhum pedido do almoxarifado em aberto.</div>
      ) : !erro && (
        <div className="bg-white border border-gray-100 rounded-xl shadow-sm overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs uppercase text-gray-500">
              <tr>
                <th className="text-left px-4 py-2">Pedido</th>
                <th className="text-left px-4 py-2">Setor / solicitante</th>
                <th className="text-left px-4 py-2">Status</th>
                <th className="text-right px-4 py-2">Itens</th>
                <th className="text-left px-4 py-2">Liberação</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {ps.map((p) => (
                <tr key={p.request_id} className="border-t border-gray-100 align-top">
                  <td className="px-4 py-2">
                    <button type="button" className="font-medium text-blue-700 underline" onClick={() => navigate(`/almox/requests/${p.request_id}`)}>
                      nº {p.request_number}
                    </button>
                    <p className="text-xs text-gray-500">{dataHora(p.created_at)}</p>
                  </td>
                  <td className="px-4 py-2">{p.setor ?? '—'}<p className="text-xs text-gray-500">{p.solicitante ?? '—'}</p></td>
                  <td className="px-4 py-2">{NOME_STATUS_PEDIDO[p.status] ?? p.status}</td>
                  <td className="px-4 py-2 text-right">{p.itens}</td>
                  <td className="px-4 py-2 text-xs">
                    {p.liberado ? (
                      <>
                        <Selo cor="azul">Liberado</Selo>
                        <p className="mt-1 text-gray-600">{p.liberado_por ?? '—'} · {dataHora(p.liberado_em)}</p>
                        <p className="text-gray-600">Motivo: {p.motivo_liberacao ?? '—'}</p>
                      </>
                    ) : inv.bloqueio === 'todos' ? <Selo cor="amarelo">Parado</Selo> : <Selo cor="cinza">Pode entregar</Selo>}
                  </td>
                  <td className="px-4 py-2 text-right">
                    {podeLiberar && !p.liberado && (
                      <Button size="sm" variant="outline" onClick={() => setLiberando(p)} className="gap-1">
                        <Unlock className="w-4 h-4" /> Liberar
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {liberando && (
        <LiberarDialog inv={inv} pedido={liberando} onClose={() => setLiberando(null)}
          onLiberado={() => { setLiberando(null); void carregar() }} />
      )}
    </div>
  )
}

function LiberarDialog({ inv, pedido, onClose, onLiberado }: { inv: Inventario; pedido: PedidoParado; onClose: () => void; onLiberado: () => void }) {
  const [motivo, setMotivo] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const trava = useTrava()

  async function liberar() {
    setErro(null)
    if (motivo.trim().length < 5) { setErro('Informe o motivo da liberação (mínimo 5 caracteres).'); return }
    if (!trava.tentar()) return
    setSalvando(true)
    try {
      await svc.liberarSaida(inv.id, pedido.request_id, motivo)
      onLiberado()
    } catch (e) {
      setErro(getErrorMessage(e))
      setSalvando(false)
      trava.liberar()
    }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !salvando) onClose() }}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Liberar saída urgente — pedido nº {pedido.request_number}</DialogTitle></DialogHeader>
        <p className="text-sm text-gray-600">
          Este pedido poderá ser entregue durante o inventário. A saída entra normalmente no saldo; como o ajuste
          do fechamento é pela diferença da contagem, ela não é contada duas vezes. A liberação fica no relatório.
        </p>
        <div>
          <Label htmlFor="lib-mot">Motivo *</Label>
          <Input id="lib-mot" value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={300}
            placeholder="Ex.: material para cirurgia de urgência" className="mt-1" autoFocus />
        </div>
        {erro && <div className="p-3 text-sm text-red-700 bg-red-50 border border-red-200 rounded-md">{erro}</div>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={salvando}>Voltar</Button>
          <Button onClick={() => void liberar()} disabled={salvando} className="gap-2">
            {salvando && <Loader2 className="w-4 h-4 animate-spin" />} Liberar pedido
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Fechar / Cancelar
// ---------------------------------------------------------------------------
function FecharDialog({ inv, onClose, onFechado }: { inv: Inventario; onClose: () => void; onFechado: () => void }) {
  const [rs, setRs] = useState<LinhaResultado[] | null>(null)
  const [erroPrevia, setErroPrevia] = useState<unknown>(null)
  const [confirmo, setConfirmo] = useState(false)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const trava = useTrava()

  const carregar = useCallback(async () => {
    setErroPrevia(null)
    try { setRs(await svc.previa(inv.id)) } catch (e) { setErroPrevia(e) }
  }, [inv.id])
  useEffect(() => { void carregar() }, [carregar])

  const t = useMemo(() => (rs ? totais(rs) : null), [rs])
  const vaiMudar = rs ? rs.filter((r) => r.diferenca !== 0).length : 0

  async function fechar() {
    setErro(null)
    if (!confirmo) { setErro('Marque a confirmação para fechar.'); return }
    if (!trava.tentar()) return
    setSalvando(true)
    try {
      await svc.fechar(inv.id)
      onFechado()
    } catch (e) {
      setErro(getErrorMessage(e))
      setSalvando(false)
      trava.liberar()
    }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !salvando) onClose() }}>
      <DialogContent className="max-w-xl">
        <DialogHeader><DialogTitle>Fechar inventário nº {inv.numero}</DialogTitle></DialogHeader>
        <ErroCarregamento erro={erroPrevia} onTentar={carregar} titulo="Não foi possível calcular o resumo." />
        {!t && !erroPrevia && <div className="p-6 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-gray-400" /></div>}
        {t && (
          <div className="space-y-2 text-sm">
            <p>Ao fechar, o sistema vai:</p>
            <ul className="list-disc ml-5 space-y-1">
              <li>Ajustar o saldo de <strong>{inteiro(vaiMudar)}</strong> {vaiMudar === 1 ? 'item' : 'itens'}:
                {' '}{inteiro(t.sobra)} com sobra (+{inteiro(t.qSobra)} un, {moeda(t.vSobra)}) e
                {' '}{inteiro(t.falta)} com falta (−{inteiro(t.qFalta)} un, {moeda(t.vFalta)}).</li>
              <li>{inteiro(t.contados)} itens contados; {inteiro(t.naoContados)} não contados
                {inv.nao_contados === 'zerar'
                  ? <> — <strong className="text-red-700">{inteiro(t.mudamNaoContados)} serão ZERADOS</strong> (opção escolhida na abertura).</>
                  : <> — mantêm o saldo do sistema.</>}</li>
              <li>Refazer os lotes do almoxarifado dos itens contados com o lote/validade contados.</li>
              <li>Registrar cada ajuste na Movimentação (motivo "Inventário de {dataBR(inv.aberto_em)}") e liberar os pedidos.</li>
            </ul>
            {t.negativos > 0 && (
              <p className="p-2 rounded border border-red-300 bg-red-50 text-red-800">
                {t.negativos} {t.negativos === 1 ? 'item ficaria' : 'itens ficariam'} com saldo negativo (saiu mais do que foi contado
                depois da contagem). O fechamento será recusado: reconte esses itens (veja a Conferência).
              </p>
            )}
            <label className="flex items-start gap-2 pt-2">
              <input type="checkbox" checked={confirmo} onChange={(e) => setConfirmo(e.target.checked)} className="mt-1" />
              <span>Conferi a contagem e quero fechar. Os saldos serão alterados e isso não pode ser desfeito por esta tela.</span>
            </label>
          </div>
        )}
        {erro && <div className="p-3 text-sm text-red-700 bg-red-50 border border-red-200 rounded-md">{erro}</div>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={salvando}>Voltar</Button>
          <Button onClick={() => void fechar()} disabled={salvando || !t} className="gap-2 bg-emerald-600 hover:bg-emerald-700 text-white">
            {salvando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Unlock className="w-4 h-4" />} Fechar e ajustar saldos
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function CancelarDialog({ inv, onClose, onCancelado }: { inv: Inventario; onClose: () => void; onCancelado: () => void }) {
  const [motivo, setMotivo] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const trava = useTrava()

  async function cancelar() {
    setErro(null)
    if (motivo.trim().length < 5) { setErro('Informe o motivo do cancelamento (mínimo 5 caracteres).'); return }
    if (!trava.tentar()) return
    setSalvando(true)
    try {
      await svc.cancelar(inv.id, motivo)
      onCancelado()
    } catch (e) {
      setErro(getErrorMessage(e))
      setSalvando(false)
      trava.liberar()
    }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !salvando) onClose() }}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Cancelar inventário nº {inv.numero}</DialogTitle></DialogHeader>
        <p className="text-sm text-gray-600">
          Cancelar encerra o inventário <strong>sem mexer em nenhum saldo ou lote</strong>. Os pedidos voltam ao normal.
          A contagem feita fica guardada no histórico, mas não é aplicada.
        </p>
        <div>
          <Label htmlFor="can-mot">Motivo *</Label>
          <Input id="can-mot" value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={300} className="mt-1" autoFocus />
        </div>
        {erro && <div className="p-3 text-sm text-red-700 bg-red-50 border border-red-200 rounded-md">{erro}</div>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={salvando}>Voltar</Button>
          <Button onClick={() => void cancelar()} disabled={salvando} className="gap-2 bg-red-600 hover:bg-red-700 text-white">
            {salvando && <Loader2 className="w-4 h-4 animate-spin" />} Cancelar inventário
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Relatório
// ---------------------------------------------------------------------------
type FiltroRel = 'diferenca' | 'contados' | 'nao_contados' | 'todos'

function Relatorio({ id, nomes: nomesBase, onVoltar }: { id: string; nomes: Record<string, string>; onVoltar: () => void }) {
  const [inv, setInv] = useState<Inventario | null>(null)
  const [rs, setRs] = useState<LinhaResultado[]>([])
  const [libs, setLibs] = useState<Liberacao[]>([])
  const [nomes, setNomes] = useState<Record<string, string>>(nomesBase)
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<unknown>(null)
  const [filtro, setFiltro] = useState<FiltroRel>('diferenca')
  const [busca, setBusca] = useState('')

  const carregar = useCallback(async () => {
    setCarregando(true); setErro(null)
    try {
      const i = await svc.buscar(id)
      if (!i) throw new Error('Inventário não encontrado.')
      const [r, l] = await Promise.all([i.status === 'fechado' ? svc.resultado(id) : Promise.resolve([]), svc.liberacoes(id)])
      setInv(i); setRs(r); setLibs(l)
      const ns = await svc.nomesUsuarios([i.aberto_por, i.fechado_por ?? '', i.cancelado_por ?? '', ...l.map((x) => x.liberado_por)])
      setNomes((n) => ({ ...n, ...ns }))
    } catch (e) {
      setErro(e)
    } finally {
      setCarregando(false)
    }
  }, [id])
  useEffect(() => { void carregar() }, [carregar])

  const visiveis = useMemo(() => {
    const q = normalizarBusca(busca)
    return rs.filter((r) => {
      if (filtro === 'diferenca' && r.diferenca === 0) return false
      if (filtro === 'contados' && !r.contado) return false
      if (filtro === 'nao_contados' && r.contado) return false
      if (q && !normalizarBusca(r.item_nome).includes(q) && !normalizarBusca(r.item_codigo).includes(q)) return false
      return true
    })
  }, [rs, filtro, busca])

  const r: ResumoInventario | null = inv?.resumo ?? null

  function exportar() {
    if (!inv) return
    const resumo: Array<[string, string | number]> = [
      ['Inventário nº', inv.numero],
      ['Status', NOME_STATUS[inv.status]],
      ['Aberto em', dataHora(inv.aberto_em)],
      ['Aberto por', nomes[inv.aberto_por] ?? ''],
      ['Fechado em', dataHora(inv.fechado_em)],
      ['Fechado por', (inv.fechado_por && nomes[inv.fechado_por]) || ''],
      ['Bloqueio', NOME_BLOQUEIO[inv.bloqueio]],
      ['Liberação urgente', inv.permite_liberacao_urgente ? 'Permitida' : 'Não'],
      ['Itens não contados', NOME_NAO_CONTADOS[inv.nao_contados]],
      ['Observação', inv.observacao ?? ''],
    ]
    if (inv.status === 'cancelado') {
      resumo.push(['Cancelado em', dataHora(inv.cancelado_em)], ['Cancelado por', (inv.cancelado_por && nomes[inv.cancelado_por]) || ''], ['Motivo', inv.motivo_cancelamento ?? ''])
    }
    if (r) {
      resumo.push(
        ['Itens no inventário', r.itens_total],
        ['Itens contados', r.itens_contados],
        ['Itens não contados', r.itens_nao_contados],
        ['Não contados zerados', r.itens_nao_contados_zerados],
        ['Contados sem diferença', r.itens_sem_diferenca],
        ['Itens com sobra', r.itens_com_sobra],
        ['Quantidade sobra', r.qtd_sobra],
        ['Valor sobra (R$)', Number(r.valor_sobra)],
        ['Itens com falta', r.itens_com_falta],
        ['Quantidade falta', r.qtd_falta],
        ['Valor falta (R$)', Number(r.valor_falta)],
        ['Resultado líquido (R$)', Number(r.valor_liquido)],
        ['Valor total contado (R$)', Number(r.valor_total_contado)],
        ['Valor do estoque após o fechamento (R$)', Number(r.valor_estoque_final)],
        ['Itens sem preço (valor 0)', r.itens_sem_preco],
        ['Linhas de contagem', r.linhas_contagem],
        ['Saídas urgentes liberadas', r.liberacoes],
      )
    }
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Campo', 'Valor'], ...resumo]), 'Resumo')
    if (rs.length) {
      const itens = rs.map((x) => ({
        Item: x.item_nome ?? '',
        'Código': x.item_codigo ?? '',
        Unidade: x.unidade ?? '',
        Contado: x.contado ? 'Sim' : 'Não',
        'Qtd contada': x.contado ? x.quantidade_contada : '',
        'Sistema na contagem': x.contado ? x.saldo_sistema_contagem : '',
        'Saldo antes': x.saldo_antes,
        'Diferença': x.diferenca,
        'Saldo depois': x.saldo_depois,
        'Valor unitário (R$)': Number(x.valor_unitario),
        'Valor diferença (R$)': Number(x.valor_diferenca),
        'Valor final (R$)': Number(x.valor_final),
        Lotes: (x.lotes ?? []).map((l) => `${l.lote ?? 'sem lote'}${l.validade ? ` val ${dataBR(l.validade)}` : ''}: ${l.quantidade}`).join('; '),
      }))
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(itens), 'Itens')
    }
    if (libs.length) {
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(libs.map((l) => ({
        Pedido: l.request_id,
        'Liberado por': nomes[l.liberado_por] ?? '',
        'Liberado em': dataHora(l.liberado_em),
        Motivo: l.motivo,
      }))), 'Liberações')
    }
    const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
    saveAs(new Blob([buf], { type: 'application/octet-stream' }), `inventario_almox_${inv.numero}_${hojeLocal()}.xlsx`)
  }

  return (
    <div className="max-w-6xl mx-auto space-y-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" onClick={onVoltar} className="gap-1"><ArrowLeft className="w-4 h-4" /> Voltar</Button>
          <h1 className="text-2xl font-bold text-gray-900">Relatório do inventário {inv ? `nº ${inv.numero}` : ''}</h1>
        </div>
        <Button onClick={exportar} disabled={!inv} className="gap-2"><FileSpreadsheet className="w-4 h-4" /> Exportar .xlsx</Button>
      </div>

      <ErroCarregamento erro={erro} onTentar={carregar} titulo="Não foi possível carregar o relatório." />
      {carregando && !inv && !erro && <div className="p-10 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>}

      {inv && (
        <>
          <div className="bg-white border border-gray-100 rounded-xl shadow-sm p-4 text-sm grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1">
            <p>Status: <Selo cor={inv.status === 'fechado' ? 'verde' : inv.status === 'aberto' ? 'amarelo' : 'cinza'}>{NOME_STATUS[inv.status]}</Selo></p>
            <p>Aberto: {dataHora(inv.aberto_em)} por {nomes[inv.aberto_por] ?? '—'}</p>
            {inv.status === 'fechado' && <p>Fechado: {dataHora(inv.fechado_em)} por {(inv.fechado_por && nomes[inv.fechado_por]) || '—'}</p>}
            {inv.status === 'cancelado' && <p>Cancelado: {dataHora(inv.cancelado_em)} por {(inv.cancelado_por && nomes[inv.cancelado_por]) || '—'} — {inv.motivo_cancelamento}</p>}
            <p>Bloqueio: {NOME_BLOQUEIO[inv.bloqueio]}{inv.bloqueio === 'todos' ? ` · liberação urgente: ${inv.permite_liberacao_urgente ? 'sim' : 'não'}` : ''}</p>
            <p>Não contados: {NOME_NAO_CONTADOS[inv.nao_contados]}</p>
            {inv.observacao && <p>Obs.: {inv.observacao}</p>}
          </div>

          {inv.status === 'cancelado' && (
            <p className="p-3 rounded-lg border border-gray-200 bg-gray-50 text-sm text-gray-700">
              Inventário cancelado: nenhum saldo ou lote foi alterado.
            </p>
          )}
          {inv.status === 'aberto' && (
            <p className="p-3 rounded-lg border border-amber-200 bg-amber-50 text-sm text-amber-900">
              Este inventário ainda está aberto. O relatório por item sai no fechamento; a prévia está na aba Conferência.
            </p>
          )}

          {r && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Cartao titulo="Itens contados" valor={inteiro(r.itens_contados)} detalhe={`de ${inteiro(r.itens_total)} · ${inteiro(r.itens_sem_diferenca)} sem diferença`} />
              <Cartao titulo="Sobras" valor={moeda(r.valor_sobra)} detalhe={`${inteiro(r.itens_com_sobra)} itens · ${inteiro(r.qtd_sobra)} un`} cor="text-emerald-700" />
              <Cartao titulo="Faltas" valor={moeda(r.valor_falta)} detalhe={`${inteiro(r.itens_com_falta)} itens · ${inteiro(r.qtd_falta)} un`} cor="text-red-700" />
              <Cartao titulo="Resultado líquido" valor={moeda(r.valor_liquido)} />
              <Cartao titulo="Não contados" valor={inteiro(r.itens_nao_contados)}
                detalhe={r.nao_contados === 'zerar' ? `${inteiro(r.itens_nao_contados_zerados)} zerados` : 'saldo mantido'} />
              <Cartao titulo="Valor contado" valor={moeda(r.valor_total_contado)} />
              <Cartao titulo="Estoque após fechamento" valor={moeda(r.valor_estoque_final)} detalhe={r.itens_sem_preco ? `${r.itens_sem_preco} itens sem preço (valor 0)` : undefined} />
              <Cartao titulo="Saídas liberadas" valor={inteiro(r.liberacoes)} detalhe={`${inteiro(r.linhas_contagem)} linhas de contagem`} />
            </div>
          )}

          {libs.length > 0 && (
            <div className="bg-white border border-gray-100 rounded-xl shadow-sm p-4 text-sm space-y-1">
              <p className="font-semibold text-gray-900">Saídas urgentes liberadas durante o inventário</p>
              {libs.map((l) => (
                <p key={l.id} className="text-gray-700">
                  {dataHora(l.liberado_em)} · {nomes[l.liberado_por] ?? '—'} · motivo: {l.motivo}
                </p>
              ))}
            </div>
          )}

          {inv.status === 'fechado' && (
            <>
              <div className="bg-white border border-gray-100 rounded-xl shadow-sm p-3 flex flex-wrap gap-3 items-end">
                <div className="flex-1 min-w-[14rem]">
                  <Label htmlFor="rel-busca">Buscar</Label>
                  <Input id="rel-busca" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Nome ou código" className="mt-1" />
                </div>
                <div className="flex gap-1 flex-wrap">
                  {([['diferenca', 'Com diferença'], ['contados', 'Contados'], ['nao_contados', 'Não contados'], ['todos', 'Todos']] as Array<[FiltroRel, string]>).map(([v, rot]) => (
                    <Button key={v} size="sm" variant={filtro === v ? 'default' : 'outline'} onClick={() => setFiltro(v)}>{rot}</Button>
                  ))}
                </div>
              </div>
              <TabelaResultado linhas={visiveis} carregando={carregando} comLotes />
            </>
          )}
        </>
      )}
    </div>
  )
}
