// =====================================================================
// Relatorios do modelo multi-estoque (farmacia)
// Consome 5 views criadas na Fase 6 do redesenho:
//   - v_consumo_por_prontuario
//   - v_consumo_por_local
//   - v_consumo_global
//   - v_valor_parado
//   - v_perdas
// =====================================================================

import { useState, useEffect } from 'react'
import { useTheme } from '@/contexts/theme'
import { Loader2, BarChart3, FileText, Pill, Download, AlertCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { supabase } from '@/lib/supabase'
import { stockService } from '@/lib/services/stock'
import { getErrorMessage } from '@/lib/utils/error-messages'
import { buscarTodas, hojeLocal } from '@/lib/utils/seguro'
import * as XLSX from 'xlsx'
import { saveAs } from 'file-saver'

type Tab = 'prontuario' | 'local' | 'usuario' | 'global' | 'parado' | 'perdas'

const TAB_LABELS: Record<Tab, string> = {
  prontuario: 'Por Prontuario',
  local: 'Por Estoque',
  usuario: 'Por Usuario',
  global: 'Consumo Global',
  parado: 'Valor Parado',
  perdas: 'Perdas (Quebra/Venc)',
}

function formatBRL(v: number | string | null | undefined) {
  if (v == null) return '—'
  const n = typeof v === 'string' ? parseFloat(v) : v
  if (!isFinite(n)) return '—'
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function formatMonth(m: string | null | undefined) {
  if (!m) return '—'
  // m vem como '2026-05-01' (date trunc)
  const d = new Date(m + 'T00:00:00')
  return d.toLocaleDateString('pt-BR', { month: '2-digit', year: 'numeric' })
}

export function FarmaciaMultiEstoqueReport() {
  const { mode } = useTheme()
  const txt = mode === 'dark' ? '#fff' : '#0d2e1c'
  const txtSec = mode === 'dark' ? 'rgba(255,255,255,0.7)' : 'rgba(13,46,28,0.65)'
  const txtMut = mode === 'dark' ? 'rgba(255,255,255,0.45)' : 'rgba(13,46,28,0.45)'

  const glass: React.CSSProperties = {
    background: mode === 'dark' ? 'rgba(10,15,20,0.55)' : 'rgba(255,255,255,0.65)',
    backdropFilter: 'blur(30px)',
    WebkitBackdropFilter: 'blur(30px)',
    border: `1px solid ${mode === 'dark' ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.5)'}`,
    borderRadius: 16,
  }

  const [tab, setTab] = useState<Tab>('prontuario')
  // Periodo por mes (as views sao mensais). Antes: .limit(500) sem ordem e
  // sem periodo — o total somava meses e modulos misturados, e cortava.
  const mesAtual = hojeLocal().slice(0, 7)
  const [mesDe, setMesDe] = useState(mesAtual)
  const [mesAte, setMesAte] = useState(mesAtual)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [rows, setRows] = useState<any[]>([])
  const [itemNames, setItemNames] = useState<Map<string, string>>(new Map())
  const [locationNames, setLocationNames] = useState<Map<string, string>>(new Map())

  useEffect(() => {
    ;(async () => {
      const locs = await stockService.getLocations()
      setLocationNames(new Map(locs.map((l) => [l.id, l.name])))
    })()
  }, [])

  const load = async (which: Tab) => {
    setLoading(true)
    setError('')
    try {
      const view = {
        prontuario: 'v_consumo_por_prontuario',
        local: 'v_consumo_por_local',
        usuario: 'v_consumo_por_usuario',
        global: 'v_consumo_global',
        parado: 'v_valor_parado',
        perdas: 'v_perdas',
      }[which]
      // Ordem completa pela chave de agrupamento de cada view: a paginacao
      // precisa de ordem estavel para nao pular/repetir linha.
      const ordem: Record<Tab, string[]> = {
        prontuario: ['mes', 'medical_record_number', 'item_id'],
        local: ['mes', 'source_location_id', 'movement_type'],
        usuario: ['mes', 'user_id', 'movement_type'],
        global: ['mes', 'item_id'],
        parado: ['location_id'],
        perdas: ['mes', 'source_location_id', 'reason'],
      }
      if (mesDe > mesAte) throw new Error('O mês inicial deve ser anterior ou igual ao mês final.')
      const rowsList = await buscarTodas<any>((de, ate) => {
        // So farmacia (as views tambem trazem movimentos do almoxarifado)
        let q = supabase.from(view).select('*').eq('item_type', 'pharmacy')
        if (which !== 'parado') q = q.gte('mes', `${mesDe}-01`).lte('mes', `${mesAte}-01`)
        for (const c of ordem[which]) q = q.order(c, { ascending: c !== 'mes', nullsFirst: false })
        return q.range(de, ate)
      })
      setRows(rowsList)

      // Buscar nomes de itens (para views que usam item_id)
      const ids = Array.from(new Set(rowsList.map((r: any) => r.item_id).filter(Boolean)))
      if (ids.length > 0) {
        const map = new Map<string, string>()
        const pharm = rowsList.filter((r: any) => r.item_type === 'pharmacy').map((r: any) => r.item_id)
        const ware = rowsList.filter((r: any) => r.item_type === 'warehouse').map((r: any) => r.item_id)
        const nomes = async (tabela: string, lista: string[]) => {
          const unicos = [...new Set(lista)]
          for (let i = 0; i < unicos.length; i += 300) {
            const { data: d, error: e } = await supabase.from(tabela).select('id, name').in('id', unicos.slice(i, i + 300))
            if (e) throw e
            ;(d || []).forEach((p: any) => map.set(p.id, p.name))
          }
        }
        await nomes('pharmacy_items', pharm)
        await nomes('warehouse_items', ware)
        setItemNames(map)
      } else {
        setItemNames(new Map())
      }
    } catch (e: any) {
      setError(getErrorMessage(e))
      setRows([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load(tab) }, [tab, mesDe, mesAte])

  const handleExport = () => {
    if (rows.length === 0) return
    // Enriquece linhas com nomes para exportacao
    const enriched = rows.map((r: any) => ({
      ...r,
      item_name: r.item_id ? itemNames.get(r.item_id) : undefined,
      location_name: r.location_id ? locationNames.get(r.location_id) : r.location_name,
    }))
    const ws = XLSX.utils.json_to_sheet(enriched)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, TAB_LABELS[tab])
    const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
    saveAs(new Blob([buf]), `relatorio_${tab}_${tab === 'parado' ? hojeLocal() : `${mesDe}_a_${mesAte}`}.xlsx`)
  }

  // Totais (consumo, custo, perda)
  const totals = (() => {
    let totalQty = 0
    let totalCost = 0
    let totalLoss = 0
    for (const r of rows) {
      if (r.qtd_total) totalQty += Number(r.qtd_total)
      if (r.custo_total) totalCost += Number(r.custo_total)
      if (r.valor_perdido) totalLoss += Number(r.valor_perdido)
      if (r.valor_parado) totalCost += Number(r.valor_parado)
    }
    return { totalQty, totalCost, totalLoss }
  })()

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="p-6" style={glass}>
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-lg" style={{ background: 'rgba(16,185,129,0.15)' }}>
              <Pill className="w-6 h-6" style={{ color: '#10b981' }} />
            </div>
            <div>
              <h1 className="text-2xl font-bold" style={{ color: txt }}>Relatorios da Farmacia (multi-estoque)</h1>
              <p className="text-sm" style={{ color: txtSec }}>
                Consumo por prontuario, por estoque e global · valor parado e perdas
              </p>
            </div>
          </div>
          <Button variant="outline" onClick={handleExport} disabled={rows.length === 0}>
            <Download className="w-4 h-4 mr-2" />Exportar
          </Button>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mt-6 border-b" style={{ borderColor: mode === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)' }}>
          {(Object.keys(TAB_LABELS) as Tab[]).map((t) => (
            <button key={t} onClick={() => setTab(t)} className="px-4 py-2 text-sm font-medium transition-colors -mb-px border-b-2"
              style={{
                borderColor: tab === t ? '#10b981' : 'transparent',
                color: tab === t ? '#10b981' : txtSec,
              }}>
              {TAB_LABELS[t]}
            </button>
          ))}
        </div>

        {/* Periodo */}
        {tab !== 'parado' && (
          <div className="flex flex-wrap items-end gap-3 mt-4 text-sm" style={{ color: txtSec }}>
            <label className="flex flex-col gap-1">
              Mês inicial
              <input type="month" value={mesDe} onChange={(e) => e.target.value && setMesDe(e.target.value)}
                className="rounded-md border px-2 py-1" style={{ color: txt, background: 'transparent' }} />
            </label>
            <label className="flex flex-col gap-1">
              Mês final
              <input type="month" value={mesAte} onChange={(e) => e.target.value && setMesAte(e.target.value)}
                className="rounded-md border px-2 py-1" style={{ color: txt, background: 'transparent' }} />
            </label>
            <span className="text-xs" style={{ color: txtMut }}>Somente itens da farmácia.</span>
          </div>
        )}

        {/* Resumo */}
        {!loading && rows.length > 0 && (
          <div className="grid grid-cols-3 gap-4 mt-4">
            <div className="p-3 rounded-lg" style={{ background: mode === 'dark' ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.02)' }}>
              <p className="text-xs" style={{ color: txtMut }}>Linhas</p>
              <p className="text-lg font-bold" style={{ color: txt }}>{rows.length}</p>
            </div>
            {totals.totalQty > 0 && (
              <div className="p-3 rounded-lg" style={{ background: mode === 'dark' ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.02)' }}>
                <p className="text-xs" style={{ color: txtMut }}>Quantidade total</p>
                <p className="text-lg font-bold" style={{ color: txt }}>{totals.totalQty.toLocaleString('pt-BR')}</p>
              </div>
            )}
            {(totals.totalCost > 0 || totals.totalLoss > 0) && (
              <div className="p-3 rounded-lg" style={{ background: mode === 'dark' ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.02)' }}>
                <p className="text-xs" style={{ color: txtMut }}>
                  {tab === 'perdas' ? 'Valor perdido total' : tab === 'parado' ? 'Valor parado total' : 'Custo total'}
                </p>
                <p className="text-lg font-bold" style={{ color: tab === 'perdas' ? '#ef4444' : txt }}>
                  {formatBRL(tab === 'perdas' ? totals.totalLoss : totals.totalCost)}
                </p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Erro */}
      {error && (
        <div className="p-4 rounded-xl bg-red-100 border border-red-200 flex items-center gap-2 text-red-800 text-sm">
          <AlertCircle size={16} /> <span className="flex-1">{error}</span>
          <Button variant="outline" size="sm" onClick={() => load(tab)}>Tentar de novo</Button>
        </div>
      )}

      {/* Tabela */}
      <div className="p-6" style={glass}>
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin" style={{ color: txtMut }} />
          </div>
        ) : error ? (
          <div className="text-center py-12 text-sm" style={{ color: '#ef4444' }}>Dados não carregados.</div>
        ) : rows.length === 0 ? (
          <div className="text-center py-12">
            <FileText className="w-10 h-10 mx-auto mb-3" style={{ color: txtMut }} />
            <p className="text-sm" style={{ color: txtMut }}>
              Sem dados para o periodo. As views populam conforme dispensacoes / movimentacoes acontecem.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b text-xs" style={{
                  borderColor: mode === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
                  color: txtMut,
                }}>
                  {tab === 'prontuario' && (<>
                    <th className="text-left p-2">Prontuario</th>
                    <th className="text-left p-2">Mes</th>
                    <th className="text-left p-2">Item</th>
                    <th className="text-right p-2">Qtd</th>
                    <th className="text-right p-2">Custo medio</th>
                    <th className="text-right p-2">Custo total</th>
                  </>)}
                  {tab === 'local' && (<>
                    <th className="text-left p-2">Estoque</th>
                    <th className="text-left p-2">Mes</th>
                    <th className="text-left p-2">Tipo de movimento</th>
                    <th className="text-right p-2">Qtd total</th>
                    <th className="text-right p-2">Custo total</th>
                  </>)}
                  {tab === 'usuario' && (<>
                    <th className="text-left p-2">Usuario</th>
                    <th className="text-left p-2">Mes</th>
                    <th className="text-left p-2">Tipo de movimento</th>
                    <th className="text-left p-2">Item</th>
                    <th className="text-right p-2">Movs.</th>
                    <th className="text-right p-2">Qtd</th>
                    <th className="text-right p-2">Custo total</th>
                  </>)}
                  {tab === 'global' && (<>
                    <th className="text-left p-2">Mes</th>
                    <th className="text-left p-2">Item</th>
                    <th className="text-right p-2">Qtd total</th>
                    <th className="text-right p-2">Custo total</th>
                  </>)}
                  {tab === 'parado' && (<>
                    <th className="text-left p-2">Estoque</th>
                    <th className="text-left p-2">Tipo de item</th>
                    <th className="text-right p-2">Valor parado</th>
                  </>)}
                  {tab === 'perdas' && (<>
                    <th className="text-left p-2">Mes</th>
                    <th className="text-left p-2">Estoque</th>
                    <th className="text-left p-2">Motivo</th>
                    <th className="text-right p-2">Qtd</th>
                    <th className="text-right p-2">Valor perdido</th>
                  </>)}
                </tr>
              </thead>
              <tbody>
                {rows.map((r: any, i) => (
                  <tr key={i} className="text-sm border-b" style={{ borderColor: mode === 'dark' ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)', color: txt }}>
                    {tab === 'prontuario' && (<>
                      <td className="p-2 font-medium">{r.medical_record_number}</td>
                      <td className="p-2" style={{ color: txtSec }}>{formatMonth(r.mes)}</td>
                      <td className="p-2">{itemNames.get(r.item_id) || r.item_name || r.item_id?.slice(0, 8)}</td>
                      <td className="p-2 text-right">{r.qtd_total}</td>
                      <td className="p-2 text-right" style={{ color: txtSec }}>{formatBRL(r.custo_medio)}</td>
                      <td className="p-2 text-right font-semibold">{formatBRL(r.custo_total)}</td>
                    </>)}
                    {tab === 'local' && (<>
                      <td className="p-2 font-medium">{r.location_name || locationNames.get(r.source_location_id) || '—'}</td>
                      <td className="p-2" style={{ color: txtSec }}>{formatMonth(r.mes)}</td>
                      <td className="p-2"><span className="px-2 py-0.5 text-xs rounded" style={{
                        background: mode === 'dark' ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)',
                      }}>{r.movement_type}</span></td>
                      <td className="p-2 text-right">{r.qtd_total}</td>
                      <td className="p-2 text-right font-semibold">{formatBRL(r.custo_total)}</td>
                    </>)}
                    {tab === 'usuario' && (<>
                      <td className="p-2 font-medium">{r.user_name || (r.user_id ? r.user_id.slice(0, 8) + '...' : '—')}</td>
                      <td className="p-2" style={{ color: txtSec }}>{formatMonth(r.mes)}</td>
                      <td className="p-2"><span className="px-2 py-0.5 text-xs rounded" style={{
                        background: mode === 'dark' ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)',
                      }}>{r.movement_type}</span></td>
                      <td className="p-2" style={{ color: txtSec }}>{r.item_type === 'pharmacy' ? 'Farmacia' : 'Almoxarifado'}</td>
                      <td className="p-2 text-right">{r.movimentos}</td>
                      <td className="p-2 text-right">{r.qtd_total}</td>
                      <td className="p-2 text-right font-semibold">{formatBRL(r.custo_total)}</td>
                    </>)}
                    {tab === 'global' && (<>
                      <td className="p-2" style={{ color: txtSec }}>{formatMonth(r.mes)}</td>
                      <td className="p-2">{itemNames.get(r.item_id) || r.item_id?.slice(0, 8)}</td>
                      <td className="p-2 text-right">{r.qtd_total}</td>
                      <td className="p-2 text-right font-semibold">{formatBRL(r.custo_total)}</td>
                    </>)}
                    {tab === 'parado' && (<>
                      <td className="p-2 font-medium">{r.location_name || locationNames.get(r.location_id) || '—'}</td>
                      <td className="p-2"><span className="px-2 py-0.5 text-xs rounded" style={{
                        background: mode === 'dark' ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)',
                      }}>{r.item_type}</span></td>
                      <td className="p-2 text-right font-semibold">{formatBRL(r.valor_parado)}</td>
                    </>)}
                    {tab === 'perdas' && (<>
                      <td className="p-2" style={{ color: txtSec }}>{formatMonth(r.mes)}</td>
                      <td className="p-2">{locationNames.get(r.source_location_id) || '—'}</td>
                      <td className="p-2"><span className="px-2 py-0.5 text-xs rounded" style={{
                        background: 'rgba(239,68,68,0.1)', color: '#ef4444',
                      }}>{r.reason}</span></td>
                      <td className="p-2 text-right">{r.qtd_total}</td>
                      <td className="p-2 text-right font-semibold" style={{ color: '#ef4444' }}>{formatBRL(r.valor_perdido)}</td>
                    </>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Dica */}
      <div className="p-4 rounded-xl text-sm" style={{
        background: mode === 'dark' ? 'rgba(59,130,246,0.1)' : 'rgba(59,130,246,0.05)',
        border: `1px solid ${mode === 'dark' ? 'rgba(59,130,246,0.2)' : 'rgba(59,130,246,0.15)'}`,
        color: mode === 'dark' ? '#93c5fd' : '#1e40af',
      }}>
        <div className="flex gap-2">
          <BarChart3 size={16} className="mt-0.5 flex-shrink-0" />
          <p>
            Os relatorios populam automaticamente conforme dispensacoes, transferencias, saidas
            avulsas e devolucoes sao registradas. Granularidade mensal.
          </p>
        </div>
      </div>
    </div>
  )
}
