// =====================================================================
// Pedidos com valor (09/10/2026, pedido da Rafaela): valor em R$ do que foi
// solicitado, aprovado e atendido em cada pedido, para o financeiro.
// Valor do item = última compra; nunca comprado = valor referencial.
// Fonte: RPC relatorio_pedidos_valor (migration 20261009170000).
// =====================================================================
import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import * as XLSX from 'xlsx'
import { saveAs } from 'file-saver'
import { Loader2, Printer, FileSpreadsheet, RefreshCw, Receipt } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { supabase } from '@/lib/supabase'
import { getErrorMessage } from '@/lib/utils/error-messages'
import { hojeLocal } from '@/lib/utils/seguro'

interface Linha {
  request_id: string
  request_number: number
  criado_em: string
  status: string
  setor: string
  solicitante: string
  itens: number
  valor_solicitado: number
  valor_aprovado: number
  valor_atendido: number
}

const STATUS: Record<string, string> = {
  pending: 'Pendente', approved: 'Aprovado', processing: 'Em atendimento', delivered: 'Entregue',
  completed: 'Concluído', rejected: 'Rejeitado', cancelled: 'Cancelado',
}
const moeda = (v: number) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const dataHora = (s: string) => new Date(s).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
const esc = (t: unknown) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!))

export function PedidosValor() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const tipo = params.get('type') === 'pharmacy' ? 'pharmacy' : 'warehouse'
  const titulo = tipo === 'pharmacy' ? 'Pedidos com valor — Farmácia' : 'Pedidos com valor — Almoxarifado'
  const hoje = hojeLocal()
  const [inicio, setInicio] = useState(hoje.slice(0, 8) + '01')
  const [fim, setFim] = useState(hoje)
  const [setor, setSetor] = useState('')
  const [status, setStatus] = useState('')
  const [linhas, setLinhas] = useState<Linha[]>([])
  const [carregando, setCarregando] = useState(false)
  const [erro, setErro] = useState('')

  async function carregar() {
    setCarregando(true); setErro('')
    try {
      const { data, error } = await supabase.rpc('relatorio_pedidos_valor', { p_tipo: tipo, p_inicio: inicio, p_fim: fim })
      if (error) throw error
      setLinhas((data ?? []) as Linha[])
    } catch (e) {
      setErro(getErrorMessage(e))
    } finally {
      setCarregando(false)
    }
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void carregar() }, [tipo])

  const setores = useMemo(() => [...new Set(linhas.map((l) => l.setor).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR')), [linhas])
  const vis = useMemo(() => linhas.filter((l) => (!setor || l.setor === setor) && (!status || l.status === status)), [linhas, setor, status])
  const tot = useMemo(() => vis.reduce((a, l) => ({
    sol: a.sol + Number(l.valor_solicitado), apr: a.apr + Number(l.valor_aprovado), ate: a.ate + Number(l.valor_atendido),
  }), { sol: 0, apr: 0, ate: 0 }), [vis])
  const periodo = `${inicio.split('-').reverse().join('/')} a ${fim.split('-').reverse().join('/')}`

  function exportar() {
    const wb = XLSX.utils.book_new()
    const dados = vis.map((l) => ({
      Pedido: l.request_number, Data: dataHora(l.criado_em), Setor: l.setor, Solicitante: l.solicitante,
      Status: STATUS[l.status] ?? l.status, Itens: l.itens,
      'Valor solicitado (R$)': Number(l.valor_solicitado), 'Valor aprovado (R$)': Number(l.valor_aprovado), 'Valor atendido (R$)': Number(l.valor_atendido),
    }))
    dados.push({ Pedido: '' as any, Data: '', Setor: 'TOTAL', Solicitante: '', Status: '', Itens: '' as any,
      'Valor solicitado (R$)': Math.round(tot.sol * 100) / 100, 'Valor aprovado (R$)': Math.round(tot.apr * 100) / 100, 'Valor atendido (R$)': Math.round(tot.ate * 100) / 100 })
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(dados), 'Pedidos')
    const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
    saveAs(new Blob([buf], { type: 'application/octet-stream' }), `pedidos_valor_${tipo}_${inicio}_a_${fim}.xlsx`)
  }

  function imprimir() {
    const corpo = vis.map((l) => `<tr><td>${l.request_number}</td><td>${esc(dataHora(l.criado_em))}</td><td>${esc(l.setor)}</td><td>${esc(l.solicitante)}</td>
      <td>${esc(STATUS[l.status] ?? l.status)}</td><td class="r">${l.itens}</td><td class="r">${moeda(l.valor_solicitado)}</td>
      <td class="r">${moeda(l.valor_aprovado)}</td><td class="r">${moeda(l.valor_atendido)}</td></tr>`).join('')
    const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${esc(titulo)}</title><style>
      @page{size:A4 landscape;margin:10mm}body{font-family:Arial,sans-serif;font-size:10px;color:#111}
      h1{font-size:15px;margin:0 0 2px}.sub{color:#555;margin-bottom:8px}table{width:100%;border-collapse:collapse}
      th,td{border:1px solid #999;padding:3px 5px}th{background:#e8f3ee;font-size:9px;text-transform:uppercase}.r{text-align:right;white-space:nowrap}
      tfoot td{font-weight:bold;background:#f2f2f2}thead{display:table-header-group}tr{page-break-inside:avoid}
      </style></head><body><h1>${esc(titulo)}</h1>
      <div class="sub">Período ${periodo}${setor ? ' · ' + esc(setor) : ''}${status ? ' · ' + esc(STATUS[status] ?? status) : ''} · ${vis.length} pedidos · valor = última compra (nunca comprado = valor referencial) · emitido em ${new Date().toLocaleString('pt-BR')}</div>
      <table><thead><tr><th>Pedido</th><th>Data</th><th>Setor</th><th>Solicitante</th><th>Status</th><th>Itens</th><th>Solicitado</th><th>Aprovado</th><th>Atendido</th></tr></thead>
      <tbody>${corpo}</tbody><tfoot><tr><td colspan="6">Total</td><td class="r">${moeda(tot.sol)}</td><td class="r">${moeda(tot.apr)}</td><td class="r">${moeda(tot.ate)}</td></tr></tfoot></table>
      <script>window.onload=function(){window.print()}</script></body></html>`
    const w = window.open('', '_blank')
    if (!w) { setErro('O navegador bloqueou a janela de impressão. Libere pop-ups para este site.'); return }
    w.document.open(); w.document.write(html); w.document.close()
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2"><Receipt className="w-6 h-6 text-emerald-600" /> {titulo}</h1>
        <p className="text-sm text-gray-600 mt-1">
          Valor em R$ de cada pedido: o que foi solicitado, o que foi aprovado e o que foi atendido. Valor do item = última compra
          (item nunca comprado = valor referencial).
        </p>
      </div>

      <div className="bg-white border border-gray-100 rounded-xl shadow-sm p-4 flex flex-wrap gap-3 items-end">
        <label className="text-xs text-gray-600">De<Input type="date" value={inicio} onChange={(e) => setInicio(e.target.value)} className="mt-1" /></label>
        <label className="text-xs text-gray-600">Até<Input type="date" value={fim} onChange={(e) => setFim(e.target.value)} className="mt-1" /></label>
        <Button size="sm" onClick={() => void carregar()} disabled={carregando} className="gap-1 bg-emerald-600 hover:bg-emerald-700 text-white">
          {carregando ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />} Gerar
        </Button>
        <label className="text-xs text-gray-600">Setor
          <select value={setor} onChange={(e) => setSetor(e.target.value)} className="mt-1 block h-9 rounded-md border border-gray-200 px-2 text-sm">
            <option value="">Todos os setores</option>
            {setores.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <label className="text-xs text-gray-600">Status
          <select value={status} onChange={(e) => setStatus(e.target.value)} className="mt-1 block h-9 rounded-md border border-gray-200 px-2 text-sm">
            <option value="">Todos</option>
            {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <div className="ml-auto flex gap-2">
          <Button size="sm" variant="outline" onClick={imprimir} disabled={vis.length === 0} className="gap-1"><Printer className="w-4 h-4" /> Imprimir</Button>
          <Button size="sm" variant="outline" onClick={exportar} disabled={vis.length === 0} className="gap-1"><FileSpreadsheet className="w-4 h-4" /> Exportar .xlsx</Button>
        </div>
      </div>

      {erro && <div className="p-3 text-sm rounded-lg border border-red-200 bg-red-50 text-red-800">{erro}</div>}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[['Pedidos', String(vis.length)], ['Valor solicitado', moeda(tot.sol)], ['Valor aprovado', moeda(tot.apr)], ['Valor atendido', moeda(tot.ate)]].map(([t, v]) => (
          <div key={t} className="bg-white border border-gray-100 rounded-xl p-4">
            <p className="text-xs uppercase text-gray-500">{t}</p>
            <p className="text-xl font-bold text-gray-900">{v}</p>
          </div>
        ))}
      </div>

      <div className="bg-white border border-gray-100 rounded-xl shadow-sm overflow-x-auto">
        <table className="w-full text-sm min-w-[900px]">
          <thead className="bg-gray-50 text-xs uppercase text-gray-500">
            <tr>
              <th className="text-left px-3 py-2">Pedido</th><th className="text-left px-3 py-2">Data</th><th className="text-left px-3 py-2">Setor</th>
              <th className="text-left px-3 py-2">Solicitante</th><th className="text-left px-3 py-2">Status</th><th className="text-right px-3 py-2">Itens</th>
              <th className="text-right px-3 py-2">Solicitado</th><th className="text-right px-3 py-2">Aprovado</th><th className="text-right px-3 py-2">Atendido</th>
            </tr>
          </thead>
          <tbody>
            {carregando && linhas.length === 0 ? (
              <tr><td colSpan={9} className="p-8 text-center"><Loader2 className="w-5 h-5 animate-spin inline text-gray-400" /></td></tr>
            ) : vis.length === 0 ? (
              <tr><td colSpan={9} className="p-8 text-center text-gray-400">Nenhum pedido no período.</td></tr>
            ) : vis.map((l) => (
              <tr key={l.request_id} className="border-t border-gray-100 hover:bg-gray-50 cursor-pointer" onClick={() => navigate(`/requests/${l.request_id}`)}>
                <td className="px-3 py-2 font-medium">#{l.request_number}</td>
                <td className="px-3 py-2 whitespace-nowrap text-gray-600">{dataHora(l.criado_em)}</td>
                <td className="px-3 py-2">{l.setor}</td>
                <td className="px-3 py-2 text-gray-600">{l.solicitante}</td>
                <td className="px-3 py-2 text-gray-600">{STATUS[l.status] ?? l.status}</td>
                <td className="px-3 py-2 text-right">{l.itens}</td>
                <td className="px-3 py-2 text-right whitespace-nowrap">{moeda(l.valor_solicitado)}</td>
                <td className="px-3 py-2 text-right whitespace-nowrap font-semibold">{moeda(l.valor_aprovado)}</td>
                <td className="px-3 py-2 text-right whitespace-nowrap">{moeda(l.valor_atendido)}</td>
              </tr>
            ))}
          </tbody>
          {vis.length > 0 && (
            <tfoot className="bg-gray-50 font-semibold">
              <tr><td colSpan={6} className="px-3 py-2">Total</td>
                <td className="px-3 py-2 text-right">{moeda(tot.sol)}</td><td className="px-3 py-2 text-right">{moeda(tot.apr)}</td><td className="px-3 py-2 text-right">{moeda(tot.ate)}</td></tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  )
}
