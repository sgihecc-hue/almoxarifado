// =====================================================================
// Relatório de Consumo da Enfermagem (fase 2) — kits e material avulso
// pedidos pelos Postos e atendidos pela Satélite Térreo.
//
// Lê duas views:
//   v_consumo_enfermagem  — uma linha por (pedido, paciente, item). O kit já
//                           vem explodido pela composição GRAVADA no pedido.
//   v_kits_enfermagem     — uma linha por (pedido, kit, paciente). É daqui que
//                           sai a contagem de kits: na outra view a coluna
//                           "kits" se repete em cada item do mesmo kit.
// =====================================================================

import { useState, useEffect, useMemo } from 'react'
import { BarChart3, Loader2, Download, RefreshCw, Users, Boxes, Package } from 'lucide-react'
import * as XLSX from 'xlsx'
import { saveAs } from 'file-saver'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { supabase } from '@/lib/supabase'
import { getErrorMessage } from '@/lib/utils/error-messages'

interface LinhaItem {
  request_id: string
  numero: number
  data: string
  status: string
  setor: string | null
  origem: 'kit' | 'avulso'
  kit: string | null
  paciente: string | null
  prontuario: string | null
  item: string
  unidade: string | null
  quantidade: number
}

interface LinhaKit {
  request_id: string
  numero: number
  data: string
  status: string
  setor: string | null
  kit: string
  paciente: string | null
  prontuario: string | null
  kits: number
}

type Aba = 'paciente' | 'kit' | 'item' | 'detalhe'

// Só conta o que a satélite realmente entregou. Pedido pendente ou recusado
// não é consumo — apareceria como consumo que nunca saiu da prateleira.
const STATUS_ENTREGUE = ['delivered', 'completed']

const iso = (d: Date) => d.toISOString().slice(0, 10)
const dataBR = (d: string | null) => (d ? new Date(d).toLocaleDateString('pt-BR') : '—')

export function ConsumoEnfermagemReport() {
  const hoje = new Date()
  const trintaDias = new Date(hoje.getTime() - 30 * 24 * 60 * 60 * 1000)

  const [inicio, setInicio] = useState(iso(trintaDias))
  const [fim, setFim] = useState(iso(hoje))
  const [somenteEntregues, setSomenteEntregues] = useState(true)
  const [busca, setBusca] = useState('')
  const [aba, setAba] = useState<Aba>('paciente')

  const [itens, setItens] = useState<LinhaItem[]>([])
  const [kits, setKits] = useState<LinhaKit[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function carregar() {
    setLoading(true); setError(null)
    try {
      // Fuso: o banco guarda em UTC. Sem o -03:00 o dia começava às 21h da
      // véspera no horário da Bahia (mesmo problema já corrigido no relatório
      // de consumo da farmácia).
      const de = `${inicio}T00:00:00-03:00`
      const ate = `${fim}T23:59:59-03:00`

      let qi = supabase.from('v_consumo_enfermagem').select('*').gte('data', de).lte('data', ate)
      let qk = supabase.from('v_kits_enfermagem').select('*').gte('data', de).lte('data', ate)
      if (somenteEntregues) {
        qi = qi.in('status', STATUS_ENTREGUE)
        qk = qk.in('status', STATUS_ENTREGUE)
      }
      const [ri, rk] = await Promise.all([qi.limit(20000), qk.limit(20000)])
      if (ri.error) throw ri.error
      if (rk.error) throw rk.error
      setItens((ri.data || []) as LinhaItem[])
      setKits((rk.data || []) as LinhaKit[])
    } catch (e) {
      setError(getErrorMessage(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { carregar() }, [])

  const q = busca.trim().toLowerCase()
  const itensFiltrados = useMemo(() => !q ? itens : itens.filter((l) =>
    (l.paciente || '').toLowerCase().includes(q) ||
    (l.prontuario || '').toLowerCase().includes(q) ||
    (l.kit || '').toLowerCase().includes(q) ||
    l.item.toLowerCase().includes(q) ||
    (l.setor || '').toLowerCase().includes(q)), [itens, q])
  const kitsFiltrados = useMemo(() => !q ? kits : kits.filter((l) =>
    (l.paciente || '').toLowerCase().includes(q) ||
    (l.prontuario || '').toLowerCase().includes(q) ||
    l.kit.toLowerCase().includes(q) ||
    (l.setor || '').toLowerCase().includes(q)), [kits, q])

  const porPaciente = useMemo(() => {
    const m = new Map<string, { paciente: string; prontuario: string; kits: number; itens: number; pedidos: Set<string> }>()
    const chave = (p: string | null, pr: string | null) => `${p || '—'}|${pr || ''}`
    for (const l of kitsFiltrados) {
      const k = chave(l.paciente, l.prontuario)
      const a = m.get(k) || { paciente: l.paciente || '—', prontuario: l.prontuario || '—', kits: 0, itens: 0, pedidos: new Set<string>() }
      a.kits += l.kits; a.pedidos.add(l.request_id); m.set(k, a)
    }
    for (const l of itensFiltrados) {
      const k = chave(l.paciente, l.prontuario)
      const a = m.get(k) || { paciente: l.paciente || '—', prontuario: l.prontuario || '—', kits: 0, itens: 0, pedidos: new Set<string>() }
      a.itens += l.quantidade; a.pedidos.add(l.request_id); m.set(k, a)
    }
    return [...m.values()].sort((a, b) => b.itens - a.itens)
  }, [itensFiltrados, kitsFiltrados])

  const porKit = useMemo(() => {
    const m = new Map<string, { kit: string; kits: number; pacientes: Set<string>; pedidos: Set<string> }>()
    for (const l of kitsFiltrados) {
      const a = m.get(l.kit) || { kit: l.kit, kits: 0, pacientes: new Set<string>(), pedidos: new Set<string>() }
      a.kits += l.kits; a.pacientes.add(l.paciente || '—'); a.pedidos.add(l.request_id); m.set(l.kit, a)
    }
    return [...m.values()].sort((a, b) => b.kits - a.kits)
  }, [kitsFiltrados])

  const porItem = useMemo(() => {
    const m = new Map<string, { item: string; unidade: string; viaKit: number; avulso: number; total: number }>()
    for (const l of itensFiltrados) {
      const a = m.get(l.item) || { item: l.item, unidade: l.unidade || '—', viaKit: 0, avulso: 0, total: 0 }
      if (l.origem === 'kit') a.viaKit += l.quantidade; else a.avulso += l.quantidade
      a.total += l.quantidade
      m.set(l.item, a)
    }
    return [...m.values()].sort((a, b) => b.total - a.total)
  }, [itensFiltrados])

  const totalItens = itensFiltrados.reduce((s, l) => s + l.quantidade, 0)
  const totalKits = kitsFiltrados.reduce((s, l) => s + l.kits, 0)
  const totalPacientes = new Set([...kitsFiltrados.map((l) => l.paciente), ...itensFiltrados.map((l) => l.paciente)]).size

  function exportar() {
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(porPaciente.map((p) => ({
      Paciente: p.paciente, Prontuário: p.prontuario, Kits: p.kits, 'Itens (un)': p.itens, Pedidos: p.pedidos.size,
    }))), 'Por paciente')
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(porKit.map((k) => ({
      Kit: k.kit, Kits: k.kits, Pacientes: k.pacientes.size, Pedidos: k.pedidos.size,
    }))), 'Por kit')
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(porItem.map((i) => ({
      Item: i.item, Unidade: i.unidade, 'Via kit': i.viaKit, Avulso: i.avulso, Total: i.total,
    }))), 'Por item')
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(itensFiltrados.map((l) => ({
      Pedido: l.numero, Data: dataBR(l.data), Setor: l.setor || '—', Origem: l.origem === 'kit' ? 'Kit' : 'Avulso',
      Kit: l.kit || '—', Paciente: l.paciente || '—', Prontuário: l.prontuario || '—',
      Item: l.item, Unidade: l.unidade || '—', Quantidade: l.quantidade,
    }))), 'Detalhado')
    const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
    saveAs(new Blob([buf]), `consumo-enfermagem-${inicio}-a-${fim}.xlsx`)
  }

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <BarChart3 className="w-6 h-6 text-emerald-600" /> Consumo da Enfermagem
          </h1>
          <p className="text-sm text-gray-500">
            Kits e material avulso por paciente. O kit é contado pela composição gravada no pedido.
          </p>
        </div>
        <Button variant="outline" onClick={exportar} className="gap-2" disabled={itens.length === 0 && kits.length === 0}>
          <Download className="w-4 h-4" /> Excel
        </Button>
      </div>

      <div className="bg-white border border-gray-100 rounded-xl shadow-sm p-6">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
          <div>
            <Label htmlFor="ini">De</Label>
            <Input id="ini" type="date" value={inicio} onChange={(e) => setInicio(e.target.value)} className="mt-1" />
          </div>
          <div>
            <Label htmlFor="fim">Até</Label>
            <Input id="fim" type="date" value={fim} onChange={(e) => setFim(e.target.value)} className="mt-1" />
          </div>
          <div>
            <Label htmlFor="busca">Buscar</Label>
            <Input id="busca" value={busca} onChange={(e) => setBusca(e.target.value)}
              placeholder="Paciente, prontuário, kit, item ou setor" className="mt-1" />
          </div>
          <div className="flex items-center gap-3">
            <Button onClick={carregar} disabled={loading} className="gap-2">
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />} Atualizar
            </Button>
          </div>
        </div>
        <label className="flex items-center gap-2 mt-4 text-sm text-gray-600">
          <input type="checkbox" checked={somenteEntregues} onChange={(e) => setSomenteEntregues(e.target.checked)} />
          Contar só o que foi entregue (pedido pendente ou recusado não é consumo)
        </label>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white border border-gray-100 rounded-xl p-4">
          <div className="text-xs text-gray-500 flex items-center gap-1"><Users className="w-3.5 h-3.5" /> Pacientes</div>
          <div className="text-2xl font-bold text-gray-900">{totalPacientes}</div>
        </div>
        <div className="bg-white border border-gray-100 rounded-xl p-4">
          <div className="text-xs text-gray-500 flex items-center gap-1"><Boxes className="w-3.5 h-3.5" /> Kits entregues</div>
          <div className="text-2xl font-bold text-gray-900">{totalKits}</div>
        </div>
        <div className="bg-white border border-gray-100 rounded-xl p-4">
          <div className="text-xs text-gray-500 flex items-center gap-1"><Package className="w-3.5 h-3.5" /> Itens (unidades)</div>
          <div className="text-2xl font-bold text-gray-900">{totalItens}</div>
        </div>
      </div>

      <div className="flex gap-2 flex-wrap">
        {([['paciente', 'Por paciente'], ['kit', 'Por kit'], ['item', 'Por item'], ['detalhe', 'Detalhado']] as Array<[Aba, string]>)
          .map(([v, label]) => (
            <Button key={v} variant={aba === v ? 'default' : 'outline'} size="sm" onClick={() => setAba(v)}>{label}</Button>
          ))}
      </div>

      {error && <div className="text-sm text-red-600">{error}</div>}

      <div className="bg-white border border-gray-100 rounded-xl shadow-sm overflow-x-auto">
        {loading ? (
          <div className="p-10 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>
        ) : itens.length === 0 && kits.length === 0 ? (
          <div className="p-10 text-center text-gray-400 text-sm">
            Nenhum consumo no período. Assim que a enfermagem enviar pedidos e a satélite entregar, eles aparecem aqui.
          </div>
        ) : aba === 'paciente' ? (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-600">
              <tr>
                <th className="text-left px-4 py-2">Paciente</th>
                <th className="text-left px-4 py-2">Prontuário</th>
                <th className="text-right px-4 py-2">Kits</th>
                <th className="text-right px-4 py-2">Itens (un)</th>
                <th className="text-right px-4 py-2">Pedidos</th>
              </tr>
            </thead>
            <tbody>
              {porPaciente.map((p) => (
                <tr key={p.paciente + p.prontuario} className="border-t border-gray-100">
                  <td className="px-4 py-2">{p.paciente}</td>
                  <td className="px-4 py-2 text-gray-500">{p.prontuario}</td>
                  <td className="px-4 py-2 text-right">{p.kits}</td>
                  <td className="px-4 py-2 text-right font-medium">{p.itens}</td>
                  <td className="px-4 py-2 text-right text-gray-500">{p.pedidos.size}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : aba === 'kit' ? (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-600">
              <tr>
                <th className="text-left px-4 py-2">Kit</th>
                <th className="text-right px-4 py-2">Kits entregues</th>
                <th className="text-right px-4 py-2">Pacientes</th>
                <th className="text-right px-4 py-2">Pedidos</th>
              </tr>
            </thead>
            <tbody>
              {porKit.map((k) => (
                <tr key={k.kit} className="border-t border-gray-100">
                  <td className="px-4 py-2">{k.kit}</td>
                  <td className="px-4 py-2 text-right font-medium">{k.kits}</td>
                  <td className="px-4 py-2 text-right text-gray-500">{k.pacientes.size}</td>
                  <td className="px-4 py-2 text-right text-gray-500">{k.pedidos.size}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : aba === 'item' ? (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-600">
              <tr>
                <th className="text-left px-4 py-2">Item</th>
                <th className="text-left px-4 py-2">Un.</th>
                <th className="text-right px-4 py-2">Via kit</th>
                <th className="text-right px-4 py-2">Avulso</th>
                <th className="text-right px-4 py-2">Total</th>
              </tr>
            </thead>
            <tbody>
              {porItem.map((i) => (
                <tr key={i.item} className="border-t border-gray-100">
                  <td className="px-4 py-2">{i.item}</td>
                  <td className="px-4 py-2 text-gray-500">{i.unidade}</td>
                  <td className="px-4 py-2 text-right text-gray-500">{i.viaKit}</td>
                  <td className="px-4 py-2 text-right text-gray-500">{i.avulso}</td>
                  <td className="px-4 py-2 text-right font-medium">{i.total}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-600">
              <tr>
                <th className="text-left px-4 py-2">Pedido</th>
                <th className="text-left px-4 py-2">Data</th>
                <th className="text-left px-4 py-2">Setor</th>
                <th className="text-left px-4 py-2">Origem</th>
                <th className="text-left px-4 py-2">Paciente</th>
                <th className="text-left px-4 py-2">Item</th>
                <th className="text-right px-4 py-2">Qtd</th>
              </tr>
            </thead>
            <tbody>
              {itensFiltrados.slice(0, 500).map((l, i) => (
                <tr key={`${l.request_id}-${i}`} className="border-t border-gray-100">
                  <td className="px-4 py-2">{l.numero}</td>
                  <td className="px-4 py-2 text-gray-500">{dataBR(l.data)}</td>
                  <td className="px-4 py-2 text-gray-500">{l.setor || '—'}</td>
                  <td className="px-4 py-2">{l.origem === 'kit' ? (l.kit || 'Kit') : 'Avulso'}</td>
                  <td className="px-4 py-2">{l.paciente || '—'}</td>
                  <td className="px-4 py-2">{l.item}</td>
                  <td className="px-4 py-2 text-right font-medium">{l.quantidade}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {aba === 'detalhe' && itensFiltrados.length > 500 && (
        <p className="text-xs text-gray-400">
          Mostrando as primeiras 500 linhas de {itensFiltrados.length}. O Excel traz tudo.
        </p>
      )}
    </div>
  )
}
