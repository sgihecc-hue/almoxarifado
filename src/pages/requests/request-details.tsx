import { useState, useEffect, useRef } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '@/contexts/auth'
import { useModule } from '@/contexts/module'
import {
  ArrowLeft, MessageSquare, AlertCircle, Loader2,
  Download, Printer, CheckCircle2
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { requestService } from '@/lib/services/requests'
import { RequestActions } from '@/components/request-actions'
import { RequestStatusBadge } from '@/components/request-status-badge'
import { RequestTimeline } from '@/components/request-timeline'
import { templatesService } from '@/lib/services/templates'
import type { Request } from '@/lib/services/requests'
import { formatRequestNumber } from '@/lib/utils/request'
import { getDepartmentName } from '@/lib/constants/departments'
import { supabase } from '@/lib/supabase'

interface LotOption { id: string; batch_number: string; expiry_date: string | null; current_quantity: number }

function ItemRow({ item, canEdit, isAdmin, canSeeStock, requestType }: {
  item: Request['request_items'][0]
  canEdit: boolean
  isAdmin: boolean
  canSeeStock: boolean
  requestType?: 'pharmacy' | 'warehouse'
}) {
  // Estoque de quem está ATENDENDO (CAF ou satélite). O isolamento dos lotes
  // depende disto — nunca mais fixar no CAF.
  const { activeStock } = useModule()
  const [suppliedQty, setSuppliedQty] = useState<number | ''>(item.supplied_quantity ?? '')
  // FA3: um item pode sair de VÁRIOS lotes. As linhas ficam em
  // request_item_lots (lote + quantidade). O campo antigo
  // request_items.expiry_tracking_id continua como fallback de 1 lote só.
  const [lots, setLots] = useState<LotOption[]>([])
  // Cada linha é um lote do item. `manual` = lote digitado na hora (item
  // zerado, sem lote cadastrado): guarda batch_number/expiry_date até o
  // saveLots criar o registro real (RPC farmacia_garantir_lote).
  const [itemLots, setItemLots] = useState<Array<{
    expiry_tracking_id: string; quantity: number
    manual?: boolean; batch_number?: string; expiry_date?: string
  }>>([])
  const isPharmacy = requestType === 'pharmacy'
  // ALMOXARIFADO: lote e validade sao dois campos livres e OPCIONAIS, gravados
  // em colunas proprias de request_items. De proposito NAO existe quantidade
  // por lote aqui: no fluxo da farmacia a soma dos lotes sobrescreve
  // supplied_quantity, que e exatamente o numero que o trigger
  // trg_deduct_stock_on_request_delivered subtrai de warehouse_items.current_stock.
  // Estes campos nao encostam em saldo nenhum — so viajam ate a conferencia
  // de recebimento do satelite.
  const [almoxLote, setAlmoxLote] = useState<string>((item as any).almox_batch_number ?? '')
  const [almoxValidade, setAlmoxValidade] = useState<string>((item as any).almox_expiry_date ?? '')

  // Carrega SÓ as opções de lote do dropdown. Pode ser chamada a qualquer
  // momento — não mexe nas linhas que o usuário está preenchendo.
  const carregarOpcoesLotes = async () => {
    const pharmacyItemId = (item as any).pharmacy_item_id ?? item.item?.id
    if (!pharmacyItemId) return
    // FA4: só lotes DO LOCAL que ATENDE a solicitação — que é o estoque ativo
    // (CAF ou satélite). Antes estava FIXO no CAF, então quem atendia num
    // satélite via os lotes/saldo do CAF. Agora cada estoque mostra só o seu.
    // NÃO filtramos por saldo > 0: com o FA5 o item pode sair sem saldo
    // (existe no físico, não foi lançado) e mesmo assim precisa ter o lote
    // atribuído. O saldo aparece ao lado de cada lote pra ficar explícito.
    const locId = activeStock?.id
    let q = supabase
      .from('expiry_tracking')
      .select('id, batch_number, expiry_date, current_quantity')
      .eq('item_id', pharmacyItemId)
      .order('expiry_date', { ascending: true, nullsFirst: false }) // FEFO
    if (locId) q = q.eq('location_id', locId)
    const { data, error } = await q
    if (error) { console.error('lots', error); return }
    setLots((data || []) as LotOption[])
  }

  // Recarrega opções + as linhas do item a partir do banco.
  // ATENÇÃO: sobrescreve o que estiver sendo digitado, então só deve rodar na
  // montagem. (Chamá-la depois de gravar apagava a linha de lote manual que
  // ainda estava sem quantidade — a tela "resetava".)
  const reloadLots = async () => {
    await carregarOpcoesLotes()

    // Lotes já informados neste item. Traz o SNAPSHOT de lote/validade gravado
    // no atendimento — assim quem confirma o recebimento (setor solicitante,
    // cujo activeStock é o satélite de destino) enxerga lote/validade mesmo
    // sem ter esses lotes nas suas opções (que são do estoque de quem atende).
    const { data: ril } = await supabase
      .from('request_item_lots')
      .select('expiry_tracking_id, quantity, batch_number, expiry_date')
      .eq('request_item_id', item.id)
    const existentes = (ril || []).map((r: any) => ({
      expiry_tracking_id: r.expiry_tracking_id, quantity: r.quantity,
      batch_number: r.batch_number ?? undefined, expiry_date: r.expiry_date ?? undefined,
    }))
    // Compatibilidade: se não há linhas novas mas existe o lote antigo, mostra ele.
    const legado = (item as any).expiry_tracking_id
    if (existentes.length === 0 && legado) {
      setItemLots([{ expiry_tracking_id: legado, quantity: item.supplied_quantity ?? 0 }])
    } else {
      setItemLots(existentes)
    }
  }

  useEffect(() => {
    if (!isPharmacy) return
    reloadLots()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPharmacy, item, activeStock?.id])

  // Serializa o salvamento: onChange + onBlur podiam disparar dois saveLots ao
  // mesmo tempo e, como cada um faz delete+insert em request_item_lots, isso
  // DUPLICAVA as linhas (o mesmo lote aparecendo N vezes). Agora só um roda por
  // vez e sempre grava o estado mais recente que ficou pendente.
  const savingLotsRef = useRef(false)
  const pendingLotsRef = useRef<Array<{
    expiry_tracking_id: string; quantity: number
    manual?: boolean; batch_number?: string; expiry_date?: string
  }> | null>(null)
  const saveLots = (novos: Array<{
    expiry_tracking_id: string; quantity: number
    manual?: boolean; batch_number?: string; expiry_date?: string
  }>) => {
    pendingLotsRef.current = novos
    if (savingLotsRef.current) return
    savingLotsRef.current = true
    ;(async () => {
      try {
        while (pendingLotsRef.current) {
          const atual = pendingLotsRef.current
          pendingLotsRef.current = null
          await doSaveLots(atual)
        }
      } finally {
        savingLotsRef.current = false
      }
    })()
  }

  // Grava os lotes do item (substitui as linhas anteriores).
  const doSaveLots = async (novos: Array<{
    expiry_tracking_id: string; quantity: number
    manual?: boolean; batch_number?: string; expiry_date?: string
  }>) => {
    try {
      const pharmacyItemId = (item as any).pharmacy_item_id ?? item.item?.id
      let criouManual = false
      // Resolve lotes DIGITADOS na hora: cria/acha o registro real e pega o id.
      // Importante: a linha NUNCA é descartada aqui. Se ainda está incompleta
      // (sem número, ou sem quantidade), ela apenas não é gravada — mas
      // continua na tela pro usuário terminar de preencher.
      const resolvidos: Array<{ expiry_tracking_id: string; quantity: number; batch_number?: string; expiry_date?: string } | null> = []
      const idPorIndice: Record<number, string> = {}
      for (let i = 0; i < novos.length; i++) {
        const l = novos[i]
        let etid = l.expiry_tracking_id
        if (l.manual) {
          if (!l.batch_number || !l.batch_number.trim()) { resolvidos.push(null); continue }
          const { data, error } = await supabase.rpc('farmacia_garantir_lote', {
            p_item_id: pharmacyItemId,
            p_batch_number: l.batch_number.trim(),
            p_expiry_date: l.expiry_date || null,
          })
          if (error) { console.error('garantir_lote', error); resolvidos.push(null); continue }
          etid = data as string
          idPorIndice[i] = etid
          criouManual = true
        }
        resolvidos.push({ expiry_tracking_id: etid, quantity: l.quantity, batch_number: l.batch_number, expiry_date: l.expiry_date })
      }

      // Guarda o id do lote recém-criado na própria linha, SEM recarregar a
      // tela e sem tirar o modo "manual" (o usuário ainda pode estar digitando
      // a validade). Só preenche onde ainda não havia id.
      if (criouManual) {
        setItemLots((prev) => prev.map((x, i) =>
          idPorIndice[i] && !x.expiry_tracking_id
            ? { ...x, expiry_tracking_id: idPorIndice[i] }
            : x))
      }

      await supabase.from('request_item_lots').delete().eq('request_item_id', item.id)
      const validos = resolvidos.filter((l): l is NonNullable<typeof l> =>
        !!l && !!l.expiry_tracking_id && l.quantity > 0)
      if (validos.length > 0) {
        await supabase.from('request_item_lots').insert(
          validos.map((l) => {
            const lo = lots.find((x) => x.id === l.expiry_tracking_id)
            return {
              request_item_id: item.id,
              expiry_tracking_id: l.expiry_tracking_id,
              batch_number: lo?.batch_number ?? l.batch_number ?? null,
              expiry_date: lo?.expiry_date ?? l.expiry_date ?? null,
              quantity: l.quantity,
            }
          })
        )
      }
      // Mantém o campo antigo coerente (1º lote) para telas/relatórios legados.
      await saveField('expiry_tracking_id', validos[0]?.expiry_tracking_id ?? null)
      // Só atualiza as OPÇÕES de lote (pro lote novo aparecer no dropdown e na
      // coluna Validade). Não recarrega as linhas — era isso que apagava o
      // lote manual em digitação.
      if (criouManual) await carregarOpcoesLotes()
    } catch (e) {
      console.error('Erro ao salvar lotes:', e)
    }
  }

  const somaLotes = itemLots.reduce((s, l) => s + (Number(l.quantity) || 0), 0)

  // --- Sincronia Qtd Fornecida <-> quantidades dos lotes -------------------
  // Antes era preciso digitar a quantidade DUAS vezes (uma na Qtd Fornecida e
  // outra na linha do lote). Agora:
  //  - ao escolher um lote, a qtd dele já vem com o que falta pra fechar o
  //    fornecido (preencherQtdFaltante);
  //  - ao digitar a qtd de um lote, a Qtd Fornecida vira a soma dos lotes
  //    (sincronizarFornecido).
  // Resultado: 1 lote => digita uma vez; N lotes => uma vez por lote.

  // Preenche a qtd da linha `idx` com o que falta pra bater o fornecido.
  // Não sobrescreve uma quantidade já digitada pelo usuário.
  const preencherQtdFaltante = (
    linhas: typeof itemLots,
    idx: number,
  ): typeof itemLots => {
    const fornecido = Number(suppliedQty) || 0
    if (!fornecido) return linhas
    if ((Number(linhas[idx]?.quantity) || 0) > 0) return linhas
    const outros = linhas.reduce(
      (s, l, i) => (i === idx ? s : s + (Number(l.quantity) || 0)), 0)
    const falta = Math.max(0, fornecido - outros)
    if (falta <= 0) return linhas
    return linhas.map((x, i) => (i === idx ? { ...x, quantity: falta } : x))
  }

  // Qtd Fornecida passa a refletir a soma dos lotes informados.
  const sincronizarFornecido = async (linhas: typeof itemLots) => {
    const soma = linhas.reduce((s, l) => s + (Number(l.quantity) || 0), 0)
    if (soma > 0 && soma !== Number(suppliedQty)) {
      setSuppliedQty(soma)
      await saveField('supplied_quantity', soma)
    }
  }
  // Observations stored as lines separated by \n
  const [observations, setObservations] = useState<string[]>(() => {
    const raw = item.observation || ''
    return raw ? raw.split('\n').filter(Boolean) : []
  })
  const [newNote, setNewNote] = useState('')
  const [checked, setChecked] = useState(item.is_checked || false)
  const saveField = async (field: string, value: any) => {
    try {
      await supabase
        .from('request_items')
        .update({ [field]: value })
        .eq('id', item.id)
    } catch (e) {
      console.error('Error saving field:', e)
    }
  }

  // Saldo exibido na coluna "Estoque": para farmácia, é o saldo do ESTOQUE
  // ATIVO (soma dos lotes já carregados desse local — CAF ou satélite, quem
  // está atendendo). Nunca o saldo global do item nem o CAF fixo.
  const estoqueLocal = isPharmacy
    ? lots.reduce((s, l) => s + (l.current_quantity || 0), 0)
    : (item.item.current_stock ?? 0)

  return (
    <tr className={`border-b border-gray-100 ${checked ? 'bg-green-50' : 'hover:bg-gray-50'} transition-colors`}>
      <td className="py-3 px-2">
        <p className="font-medium text-gray-900 text-sm">{item.item.name}</p>
        <p className="text-xs text-gray-400">{item.item.code}</p>
      </td>
      <td className="text-center py-3 px-2 text-gray-600">{item.item.unit || 'UN'}</td>
      <td className="text-center py-3 px-2 font-medium">{item.quantity}</td>
      {canSeeStock && (
        <td className="text-center py-3 px-2">
          <span className={`font-medium ${estoqueLocal < item.quantity ? 'text-red-600' : 'text-green-600'}`}>
            {estoqueLocal}
          </span>
        </td>
      )}
      <td className="text-center py-3 px-2">
        {canEdit ? (
          <Input
            type="number"
            min="0"
            value={suppliedQty === 0 ? '' : suppliedQty}
            placeholder="0"
            onFocus={(e) => e.target.select()}
            onChange={(e) => {
              const val = e.target.value === '' ? 0 : Math.max(0, parseInt(e.target.value) || 0)
              setSuppliedQty(val)
            }}
            onBlur={async () => {
              await saveField('supplied_quantity', suppliedQty)
              // Se já existe UMA linha de lote sem quantidade, ela recebe o
              // fornecido — evita ter que digitar o mesmo número de novo.
              if (itemLots.length === 1 && !(Number(itemLots[0].quantity) || 0)) {
                const novos = preencherQtdFaltante(itemLots, 0)
                setItemLots(novos)
                saveLots(novos)
              }
            }}
            className="w-20 text-center mx-auto h-8 text-sm"
          />
        ) : (
          <span>{item.supplied_quantity ?? '—'}</span>
        )}
      </td>
      {isPharmacy && (
        <>
          {/* FA3: multi-lote — o item pode sair de vários lotes. A soma é
              conferida contra a Qtd Fornecida. FA2: lote NÃO é obrigatório;
              sem lote informado o item ainda pode ser atendido. */}
          <td className="py-3 px-2">
            {canEdit ? (
              <div className="space-y-1">
                {itemLots.map((l, idx) => (
                  <div key={idx} className="flex items-center gap-1">
                    {l.manual ? (
                      // Lote DIGITADO na hora (item zerado, sem lote cadastrado).
                      <div className="flex-1 flex items-center gap-1 min-w-[150px]">
                        <input
                          type="text" value={l.batch_number || ''} placeholder="Nº do lote"
                          onChange={(e) => setItemLots(itemLots.map((x, i) => i === idx ? { ...x, batch_number: e.target.value } : x))}
                          onBlur={() => {
                            // Já preenche a qtd com o que falta pro fornecido,
                            // senão a linha ficaria com 0 e não seria gravada.
                            const novos = (l.batch_number || '').trim()
                              ? preencherQtdFaltante(itemLots, idx)
                              : itemLots
                            setItemLots(novos)
                            saveLots(novos)
                          }}
                          className="flex-1 min-w-[80px] h-7 px-1 text-xs rounded border border-blue-300"
                        />
                        <input
                          type="date" value={l.expiry_date || ''} title="Validade"
                          onChange={(e) => setItemLots(itemLots.map((x, i) => i === idx ? { ...x, expiry_date: e.target.value } : x))}
                          onBlur={() => saveLots(itemLots)}
                          className="w-[120px] h-7 px-1 text-xs rounded border border-blue-300"
                        />
                      </div>
                    ) : (
                      <select
                        value={l.expiry_tracking_id}
                        onChange={(e) => {
                          if (e.target.value === '__novo__') {
                            setItemLots(itemLots.map((x, i) => i === idx ? { expiry_tracking_id: '', quantity: x.quantity, manual: true, batch_number: '', expiry_date: '' } : x))
                            return
                          }
                          const base = itemLots.map((x, i) =>
                            i === idx ? { ...x, expiry_tracking_id: e.target.value } : x)
                          // Já preenche a qtd deste lote com o que falta pra
                          // fechar o fornecido (não precisa redigitar).
                          const novos = e.target.value
                            ? preencherQtdFaltante(base, idx)
                            : base
                          setItemLots(novos); saveLots(novos)
                        }}
                        className="flex-1 min-w-[150px] h-7 px-1 text-xs rounded border border-gray-300 bg-white"
                      >
                        <option value="">{lots.length ? '— Lote —' : 'Sem lotes cadastrados'}</option>
                        {lots.map((lo, i) => (
                          <option key={lo.id} value={lo.id}>
                            {i === 0 ? '★ ' : ''}{lo.batch_number}
                            {lo.current_quantity > 0
                              ? ` · saldo ${lo.current_quantity}`
                              : ' · sem saldo'}
                          </option>
                        ))}
                        <option value="__novo__">➕ Digitar lote novo…</option>
                      </select>
                    )}
                    <input
                      type="number" min={0} value={l.quantity || ''} placeholder="qtd"
                      onChange={(e) => {
                        const q = Math.max(0, parseInt(e.target.value) || 0)
                        setItemLots(itemLots.map((x, i) => i === idx ? { ...x, quantity: q } : x))
                      }}
                      onBlur={async () => {
                        // A Qtd Fornecida passa a ser a soma dos lotes.
                        await sincronizarFornecido(itemLots)
                        saveLots(itemLots)
                      }}
                      className="w-14 h-7 px-1 text-xs text-center rounded border border-gray-300"
                    />
                    <button
                      type="button"
                      onClick={() => { const novos = itemLots.filter((_, i) => i !== idx); setItemLots(novos); saveLots(novos) }}
                      className="text-red-500 hover:text-red-700 text-xs px-1"
                      title="Remover lote"
                    >✕</button>
                  </div>
                ))}
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setItemLots([...itemLots, { expiry_tracking_id: '', quantity: 0 }])}
                    disabled={lots.length === 0}
                    className="text-xs text-blue-600 hover:text-blue-800 disabled:text-gray-300"
                    title={lots.length === 0 ? 'Nenhum lote cadastrado — use "Digitar lote"' : ''}
                  >+ Adicionar lote</button>
                  <button
                    type="button"
                    onClick={() => setItemLots([...itemLots, { expiry_tracking_id: '', quantity: 0, manual: true, batch_number: '', expiry_date: '' }])}
                    className="text-xs text-blue-600 hover:text-blue-800"
                  >+ Digitar lote</button>
                </div>
                {itemLots.length > 0 && suppliedQty !== '' && somaLotes !== Number(suppliedQty) && (
                  <p className="text-[10px] text-amber-600">
                    Soma dos lotes ({somaLotes}) ≠ fornecido ({suppliedQty})
                  </p>
                )}
              </div>
            ) : (
              <div className="text-xs space-y-0.5">
                {itemLots.length === 0 ? <span>—</span> : itemLots.map((l, i) => {
                  const lo = lots.find((x) => x.id === l.expiry_tracking_id)
                  const batch = l.batch_number ?? lo?.batch_number
                  return <div key={i}>{batch ? `${batch} · ${l.quantity}` : `${l.quantity}`}</div>
                })}
              </div>
            )}
          </td>
          <td className="text-center py-3 px-2 text-xs">
            {itemLots.length === 0 ? '—' : itemLots.map((l, i) => {
              const lo = lots.find((x) => x.id === l.expiry_tracking_id)
              const val = l.expiry_date ?? lo?.expiry_date
              return (
                <div key={i}>
                  {val
                    ? new Date(val + 'T00:00:00').toLocaleDateString('pt-BR')
                    : '—'}
                </div>
              )
            })}
          </td>
        </>
      )}
      {!isPharmacy && (
        <>
          <td className="py-3 px-2">
            {canEdit ? (
              <input
                type="text"
                value={almoxLote}
                onChange={(e) => setAlmoxLote(e.target.value)}
                onBlur={() => saveField('almox_batch_number', almoxLote.trim() || null)}
                placeholder="Lote (opcional)"
                className="w-full text-sm border rounded px-2 h-8"
              />
            ) : (
              <span className="text-xs">{almoxLote || '—'}</span>
            )}
          </td>
          <td className="text-center py-3 px-2 text-xs">
            {canEdit ? (
              <input
                type="date"
                value={almoxValidade}
                onChange={(e) => setAlmoxValidade(e.target.value)}
                onBlur={() => saveField('almox_expiry_date', almoxValidade || null)}
                className="w-full text-sm border rounded px-2 h-8"
              />
            ) : (
              <span>{almoxValidade ? new Date(almoxValidade + 'T00:00:00').toLocaleDateString('pt-BR') : '—'}</span>
            )}
          </td>
        </>
      )}
      <td className="py-3 px-2">
        {observations.length > 0 && (
          <div className="space-y-1 mb-1">
            {observations.map((obs, idx) => (
              <div key={idx} className="flex items-center gap-1">
                <span className="text-xs bg-yellow-50 border border-yellow-200 text-yellow-800 px-2 py-1 rounded flex-1">{obs}</span>
                {isAdmin && (
                  <button
                    onClick={() => {
                      const updated = observations.filter((_, i) => i !== idx)
                      setObservations(updated)
                      saveField('observation', updated.join('\n'))
                    }}
                    className="text-red-400 hover:text-red-600 text-xs px-1"
                    title="Apagar"
                  >✕</button>
                )}
              </div>
            ))}
          </div>
        )}
        {canEdit && (
          <div className="flex gap-1">
            <input
              type="text"
              value={newNote}
              onChange={(e) => setNewNote(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && newNote.trim()) {
                  const updated = [...observations, newNote.trim()]
                  setObservations(updated)
                  saveField('observation', updated.join('\n'))
                  setNewNote('')
                }
              }}
              placeholder="Anotar..."
              className="flex-1 h-7 px-2 text-xs border border-gray-300 rounded bg-white"
            />
            <button
              onClick={() => {
                if (newNote.trim()) {
                  const updated = [...observations, newNote.trim()]
                  setObservations(updated)
                  saveField('observation', updated.join('\n'))
                  setNewNote('')
                }
              }}
              className="text-xs bg-emerald-500 text-white px-2 rounded hover:bg-emerald-600"
            >+</button>
          </div>
        )}
        {!canEdit && observations.length === 0 && <span className="text-xs text-gray-300">—</span>}
      </td>
      <td className="text-center py-3 px-2">
        {canEdit ? (
          <input
            type="checkbox"
            checked={checked}
            onChange={(e) => {
              setChecked(e.target.checked)
              saveField('is_checked', e.target.checked)
            }}
            className="w-5 h-5 rounded border-gray-300 text-green-600 focus:ring-green-500 cursor-pointer"
          />
        ) : (
          checked ? <CheckCircle2 className="w-5 h-5 text-green-500 mx-auto" /> : <span className="text-gray-300">—</span>
        )}
      </td>
    </tr>
  )
}

export function RequestDetails() {
  const navigate = useNavigate()
  const { id } = useParams()
  const { user } = useAuth()
  const [request, setRequest] = useState<Request | null>(null)
  const [loading, setLoading] = useState(true)
  const [commenting, setCommenting] = useState(false)
  const [comment, setComment] = useState('')

  useEffect(() => {
    if (id) loadRequest(id)
  }, [id])

  // Add event listeners for print
  useEffect(() => {
    const beforePrint = () => {
      // This function intentionally left empty
    }
    
    const afterPrint = () => {
      // This function intentionally left empty
    }
    
    window.addEventListener('beforeprint', beforePrint)
    window.addEventListener('afterprint', afterPrint)
    
    return () => {
      window.removeEventListener('beforeprint', beforePrint)
      window.removeEventListener('afterprint', afterPrint)
    }
  }, [])

  // silent=true reloada os dados sem trocar loading -> nao remonta o
  // RequestActions (senao o modal de aprovacao some antes de renderizar).
  async function loadRequest(requestId: string, silent = false) {
    try {
      if (!silent) setLoading(true)
      const data = await requestService.getById(requestId)
      setRequest(data)
    } catch (error) {
      console.error('Error loading request:', error)
    } finally {
      if (!silent) setLoading(false)
    }
  }

  const handlePrint = () => {
    if (!request) { window.print(); return }
    const win = window.open('', '_blank', 'width=900,height=700')
    if (!win) { window.print(); return }

    const items = request.request_items || []
    const totalItems = items.length
    const totalQtd = items.reduce((sum, it) => sum + (it.approved_quantity ?? it.quantity), 0)

    const reqNumber = request.request_number ? '#' + request.request_number : request.id.substring(0, 8)
    const createdDate = new Date(request.created_at).toLocaleString('pt-BR')
    const deptName = (request as any).department?.name || request.department || '-'
    const requesterName = (request as any).requester?.full_name || '-'

    const html = `
<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<title>Lista de Separação - ${reqNumber}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Arial, Helvetica, sans-serif; padding: 20px; color: #000; font-size: 11pt; }
  .header { border-bottom: 2px solid #000; padding-bottom: 10px; margin-bottom: 15px; }
  .header h1 { font-size: 16pt; margin-bottom: 4px; }
  .header .sub { font-size: 10pt; color: #444; }
  .info { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 15px; font-size: 10pt; }
  .info div { padding: 4px; }
  .info strong { display: inline-block; min-width: 100px; }
  table { width: 100%; border-collapse: collapse; font-size: 10pt; margin-bottom: 15px; }
  thead { background: #f0f0f0; }
  th, td { border: 1px solid #888; padding: 6px 8px; text-align: left; vertical-align: top; }
  th { font-weight: bold; font-size: 9pt; text-transform: uppercase; }
  .col-num { width: 28px; text-align: center; }
  .col-code { width: 120px; font-family: monospace; font-size: 9pt; }
  .col-qty { width: 60px; text-align: center; font-weight: bold; }
  .col-check { width: 40px; text-align: center; }
  .qty-fornec { background: #fffacd; font-size: 14pt; }
  .checkbox { display: inline-block; width: 16px; height: 16px; border: 2px solid #000; }
  .totals { margin-top: 20px; padding: 10px; background: #f0f0f0; border: 1px solid #888; font-size: 10pt; }
  .totals strong { margin-right: 20px; }
  .signature { margin-top: 40px; display: grid; grid-template-columns: 1fr 1fr; gap: 40px; font-size: 10pt; }
  .signature div { border-top: 1px solid #000; padding-top: 4px; text-align: center; }
  .item-name { font-weight: 600; line-height: 1.3; }
  .item-code { font-size: 8pt; color: #666; margin-top: 2px; }
  @page { size: A4; margin: 1cm; }
  @media print {
    body { padding: 0; }
  }
</style>
</head>
<body>
  <div class="header">
    <h1>LISTA DE SEPARAÇÃO DE ITENS</h1>
    <div class="sub">HECC — Hospital Estadual Costa dos Coqueiros • Sistema de Gestão de Insumos</div>
  </div>

  <div class="info">
    <div><strong>Solicitação:</strong> ${reqNumber}</div>
    <div><strong>Data:</strong> ${createdDate}</div>
    <div><strong>Setor Solicitante:</strong> ${deptName}</div>
    <div><strong>Setor Solicitado:</strong> ${(request as any).destination_department ? getDepartmentName((request as any).destination_department) : '—'}</div>
    <div><strong>Solicitante:</strong> ${requesterName}</div>
    <div><strong>Prioridade:</strong> ${request.priority === 'high' ? 'Alta' : request.priority === 'medium' ? 'Média' : 'Baixa'}</div>
    <div><strong>Status:</strong> ${request.status}</div>
  </div>

  <table>
    <thead>
      <tr>
        <th class="col-num">#</th>
        <th>Item</th>
        <th class="col-qty">Qtd Sol.</th>
        <th class="col-qty qty-fornec">Qtd Fornec.</th>
        <th class="col-check">✓</th>
      </tr>
    </thead>
    <tbody>
      ${items.map((it, idx) => {
        const qtd = it.approved_quantity ?? it.quantity
        const fornec = it.supplied_quantity ?? ''
        return `
        <tr>
          <td class="col-num">${idx + 1}</td>
          <td>
            <div class="item-name">${(it.item?.name || '').replace(/</g, '&lt;')}</div>
            <div class="item-code">Código: ${it.item?.code || '-'} • Unidade: ${it.item?.unit || 'UN'}</div>
          </td>
          <td class="col-qty">${qtd}</td>
          <td class="col-qty qty-fornec">${fornec}</td>
          <td class="col-check"><span class="checkbox"></span></td>
        </tr>`
      }).join('')}
    </tbody>
  </table>

  <div class="totals">
    <strong>Total de Itens:</strong> ${totalItems}
    <strong>Quantidade Total Aprovada:</strong> ${totalQtd}
  </div>

  <div class="signature">
    <div>Assinatura de quem separou</div>
    <div>Assinatura de quem recebeu</div>
  </div>

  <script>
    window.onload = function() {
      setTimeout(function() { window.print(); }, 300);
    };
  </script>
</body>
</html>
    `

    win.document.write(html)
    win.document.close()
  }

  const handleExportTemplate = async () => {
    if (!request || !request.id) {
      console.error('No request data available for export')
      return
    }
    
    try {
      await templatesService.generateRequestTemplate(request)
    } catch (error) {
      console.error('Error generating template:', error)
    }
  }

  // Add error state
  const [error, setError] = useState<string | null>(null)

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <Loader2 className="w-8 h-8 text-primary-500 animate-spin mx-auto mb-4" />
          <p className="text-gray-500">Carregando solicitação...</p>
        </div>
      </div>
    )
  }

  if (!request) {
    return (
      <div className="text-center py-12">
        <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
        <h2 className="text-lg font-semibold text-gray-900 mb-2">
          Solicitação não encontrada
        </h2>
        <p className="text-gray-500 mb-6">
          A solicitação que você está procurando não existe ou foi removida.
        </p>
        <Button
          variant="outline"
          onClick={() => navigate('/requests')}
        >
          <ArrowLeft className="w-4 h-4 mr-2" />
          Voltar para Solicitações
        </Button>
      </div>
    )
  }

  return (
    <div className="max-w-7xl mx-auto space-y-6 print:space-y-1 print:max-w-full">
      {/* Header - Only visible on screen */}
      <div className="flex items-center justify-between print:hidden">
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            className="text-primary-600 hover:text-primary-700"
            onClick={() => {
              // Só no almoxarifado: volta pra tela de origem (Histórico, Caixa
              // de Entrada, Em Processamento, etc.) em vez de ir sempre pras
              // solicitações atuais. Farmácia mantém o comportamento anterior.
              if (request?.type === 'warehouse' && window.history.length > 1) {
                navigate(-1)
              } else {
                navigate('/requests')
              }
            }}
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            Voltar
          </Button>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">
              Solicitação #{request?.request_number || formatRequestNumber(request.id)}</h1>
            
            {/* Error Message */}
            {error && (
              <div className="mt-2 p-2 bg-red-50 rounded border border-red-200">
                <p className="text-sm text-red-600">{error}</p>
                <button onClick={() => setError(null)} className="text-xs text-red-500 underline">
                  Fechar
                </button>
              </div>
            )}
            <p className="text-sm text-gray-500">
              Criada em {format(new Date(request.created_at), "dd 'de' MMMM', às' HH:mm", {
                locale: ptBR,
              })}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleExportTemplate}>
            <Download className="w-4 h-4 mr-2" />
            Exportar
          </Button>
          <Button variant="outline" size="sm" onClick={handlePrint}>
            <Printer className="w-4 h-4 mr-2" />
            Imprimir
          </Button>
        </div>
      </div>

      {/* Status and Info */}
      {/* Grid mudou de md:grid-cols-3 para xl:grid-cols-3: em telas medias
          (tablet) a linha do tempo comprimia num "canto" estreito e o texto
          quebrava palavra-por-palavra. Agora so vira coluna lateral em xl+ */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 print:grid-cols-1 print:gap-2">
        <div className="xl:col-span-2 space-y-6 print:space-y-2 print:col-span-1">
          {/* Request Info */}
          <div className="bg-white rounded-xl p-6 border border-gray-100 print:p-2 print:border-0 print:shadow-none">
            <div className="flex items-center justify-between mb-6 print:mb-2">
              <div>
                <h2 className="text-lg font-semibold text-gray-900 print:text-base">
                  Informações da Solicitação
                </h2>
                <p className="text-sm text-gray-500 print:hidden">
                  Detalhes e status atual
                </p>
              </div>
              <RequestStatusBadge status={request.status} />
            </div>

            <div className="grid grid-cols-3 gap-6 print:grid-cols-5 print:gap-2 print:text-sm">
              <div>
                <p className="text-sm text-gray-500 print:text-xs">Solicitante</p>
                <p className="font-medium print:text-sm">{request.requester?.full_name}</p>
              </div>
              <div>
                <p className="text-sm text-gray-500 print:text-xs">Tipo</p>
                <p className="font-medium print:text-sm">
                  {request.type === 'pharmacy' ? 'Farmácia' : 'Almoxarifado'}
                </p>
              </div>
              <div>
                <p className="text-sm text-gray-500 print:text-xs">Prioridade</p>
                <p className="font-medium print:text-sm">
                  {request.priority === 'high' ? 'Alta' :
                   request.priority === 'medium' ? 'Média' : 'Baixa'}
                </p>
              </div>
              <div>
                <p className="text-sm text-gray-500 print:text-xs">Nº Solicitação</p>
                <p className="font-medium print:text-sm">#{request.request_number || formatRequestNumber(request.id)}</p>
              </div>
              <div>
                <p className="text-sm text-gray-500 print:text-xs">Setor Solicitante</p>
                <p className="font-medium print:text-sm">{getDepartmentName(request.department)}</p>
              </div>
              <div>
                <p className="text-sm text-gray-500 print:text-xs">Setor Solicitado</p>
                <p className="font-medium print:text-sm">
                  {request.destination_department ? getDepartmentName(request.destination_department) : '—'}
                </p>
              </div>
              <div>
                <p className="text-sm text-gray-500 print:text-xs">Data de Criação</p>
                <p className="font-medium print:text-sm">
                  {format(new Date(request.created_at), "dd/MM/yyyy 'às' HH:mm", {
                    locale: ptBR,
                  })}
                </p>
              </div>
            </div>

            {/* Dados do Paciente (Colchão Casca de Ovo e similares) */}
            {(request as any).notes && (request as any).notes.includes('[Dados do Paciente]') && (
              <div className="mt-6 border-t border-gray-100 pt-4">
                <h3 className="text-sm font-semibold text-blue-800 mb-3 flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-blue-500"></span>
                  Dados do(s) Paciente(s)
                </h3>
                <div className="space-y-2">
                  {((request as any).notes as string).split('\n').filter((line: string) => line.includes('[Dados do Paciente]')).map((line: string, idx: number) => {
                    const parts: Record<string, string> = {}
                    line.replace('[Dados do Paciente] ', '').split(' | ').forEach((part: string) => {
                      const [key, ...vals] = part.split(': ')
                      if (key && vals.length) parts[key.trim()] = vals.join(': ').trim()
                    })
                    return (
                      <div key={idx} className="p-3 bg-blue-50 border border-blue-200 rounded-lg text-sm">
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                          <div>
                            <span className="text-blue-600 font-medium">Paciente:</span>{' '}
                            <span className="text-blue-900 font-semibold">{parts['Nome'] || '—'}</span>
                          </div>
                          <div>
                            <span className="text-blue-600 font-medium">Leito:</span>{' '}
                            <span className="text-blue-900">{parts['Leito'] || '—'}</span>
                          </div>
                          <div>
                            <span className="text-blue-600 font-medium">Posto:</span>{' '}
                            <span className="text-blue-900">{parts['Posto'] || '—'}</span>
                          </div>
                          <div>
                            <span className="text-blue-600 font-medium">Enfermeira:</span>{' '}
                            <span className="text-blue-900">{parts['Enfermeira'] || '—'}</span>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Observações gerais (notes sem dados de paciente) */}
            {(request as any).notes && !(request as any).notes.includes('[Dados do Paciente]') && (
              <div className="mt-6 border-t border-gray-100 pt-4">
                <p className="text-sm text-gray-500">Observações</p>
                <p className="font-medium text-gray-900 whitespace-pre-line mt-1">{(request as any).notes}</p>
              </div>
            )}

          </div>
        </div>

        {/* Timeline - Hide when printing */}
        <div className="bg-white rounded-xl p-6 border border-gray-100 print:hidden">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">
                Linha do Tempo
              </h2>
              <p className="text-sm text-gray-500">
                Histórico da solicitação
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCommenting(!commenting)}
            >
              <MessageSquare className="w-4 h-4 mr-2" />
              Comentar
            </Button>
          </div>

          {commenting && (
            <div className="mb-6">
              <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                className="w-full min-h-[100px] p-3 rounded-lg border border-gray-200 text-sm"
                placeholder="Digite seu comentário..."
              />
              <div className="flex justify-end gap-2 mt-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setCommenting(false)
                    setComment('')
                  }}
                >
                  Cancelar
                </Button>
                <Button
                  size="sm"
                  disabled={!comment.trim() || !user}
                  onClick={async () => {
                    if (!comment.trim() || !user) return
                    try {
                      await requestService.addComment(
                        request.id,
                        comment
                      )
                      if (id) await loadRequest(id)
                      setCommenting(false)
                      setComment('')
                    } catch (error) {
                      console.error('Error adding comment:', error)
                    }
                  }}
                >
                  Enviar
                </Button>
              </div>
            </div>
          )}

          <RequestTimeline request={request} />
        </div>
      </div>

      {/* Items - Spreadsheet Table (Full Width) */}
      <div className="bg-white rounded-xl p-6 border border-gray-100 print:p-2 print:border print:border-gray-300 print:shadow-none">
        <h2 className="text-lg font-semibold text-gray-900 mb-6 print:mb-2 print:text-base">
          Itens Solicitados
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b-2 border-gray-200">
                <th className="text-left py-3 px-3 font-medium text-gray-600">Nome</th>
                <th className="text-center py-3 px-3 font-medium text-gray-600 w-20">UF</th>
                <th className="text-center py-3 px-3 font-medium text-gray-600 w-24">Qtd Solic.</th>
                {/* Coluna "Saldo" só aparece pra staff da farmácia/almox — solicitante
                    (setor solicitante) não deve ver o estoque, senão informa consumo. */}
                {(user?.role === 'administrador' || user?.role === 'gestor' || user?.role === 'atendente' ||
                  (user?.role === 'pharmacist' && request.type === 'pharmacy')) && (
                  <th className="text-center py-3 px-3 font-medium text-gray-600 w-24">Saldo</th>
                )}
                <th className="text-center py-3 px-3 font-medium text-gray-600 w-28">Qtd Fornec.</th>
                {/* Lote e Validade valem nos DOIS modulos, com naturezas
                    diferentes: na FARMACIA o staff escolhe o(s) lote(s) do
                    estoque (com quantidade por lote); no ALMOXARIFADO sao dois
                    campos livres e opcionais, que servem para o satelite
                    conferir na hora de receber. FA2: lote nunca e obrigatorio. */}
                <>
                  <th className="text-center py-3 px-3 font-medium text-gray-600 w-64">
                    Lote(s)
                  </th>
                  <th className="text-center py-3 px-3 font-medium text-gray-600 w-28">Validade</th>
                </>
                <th className="text-center py-3 px-3 font-medium text-gray-600 w-44">Observação</th>
                <th className="text-center py-3 px-3 font-medium text-gray-600 w-24">Confirmar</th>
              </tr>
            </thead>
            <tbody>
              {request.request_items.map((item) => {
                const isStaff = user?.role === 'administrador' || user?.role === 'gestor' || user?.role === 'atendente' ||
                  (user?.role === 'pharmacist' && request.type === 'pharmacy')
                const statusAllowsEdit = request.status === 'pending' || request.status === 'approved' || request.status === 'processing'
                return (
                  <ItemRow
                    key={item.id}
                    item={item}
                    canEdit={isStaff && statusAllowsEdit}
                    isAdmin={user?.role === 'administrador'}
                    canSeeStock={isStaff}
                    requestType={request.type}
                  />
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Request Actions - Below items, hide when printing */}
      <div className="print:hidden">
        <RequestActions
          request={request}
          onUpdate={() => { if (id) loadRequest(id, true) }}
        />
      </div>

      {/* Print Signature Section - Only visible when printing */}
      <div className="hidden print:block print:mt-4">
        <div className="grid grid-cols-3 gap-4">
          <div className="text-center">
            <div className="border-t border-gray-300 pt-1 mt-8">
              <p className="text-xs">Solicitante</p>
            </div>
          </div>
          <div className="text-center">
            <div className="border-t border-gray-300 pt-1 mt-8">
              <p className="text-xs">Aprovador</p>
            </div>
          </div>
          <div className="text-center">
            <div className="border-t border-gray-300 pt-1 mt-8">
              <p className="text-xs">Recebedor</p>
            </div>
          </div>
        </div>

        <div className="mt-4 text-center text-xs text-gray-500">
          <p>Data de impressão: {format(new Date(), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}</p>
        </div>
      </div>

      {/* Print-specific styles */}
      <style>
        {`
        @media print {
          @page {
            size: A4;
            margin: 0.5cm;
            scale: 90%;
          }
          body {
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
            font-size: 9pt;
          }
          .print\\:hidden {
            display: none !important;
          }
          header {
            display: none !important;
          }
          table {
            page-break-inside: auto;
          }
          tr {
            page-break-inside: avoid;
            page-break-after: auto;
          }
        }
        `}
      </style>
    </div>
  )
}
