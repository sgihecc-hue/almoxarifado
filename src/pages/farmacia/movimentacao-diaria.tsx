// =====================================================================
// Movimentação Diária — o que saiu por dispensação, por dia, no estoque atual.
// Fonte: dispensações concluídas (RPC farmacia_movimentacao_diaria).
// Filtros: período (dia/semana/mês/personalizado) + classe.
// =====================================================================
import { useMemo, useState } from 'react'
import { CalendarRange, Play, Download, Loader2, AlertCircle } from 'lucide-react'
import { saveAs } from 'file-saver'
import * as XLSX from 'xlsx'
import { Button } from '@/components/ui/button'
import { useTheme } from '@/contexts/theme'
import { useModule } from '@/contexts/module'
import { supabase } from '@/lib/supabase'
import { getErrorMessage } from '@/lib/utils/error-messages'
import { MEDICATION_CLASS_LABEL } from '@/lib/types/farmacia'
import type { MedicationClass } from '@/lib/types/farmacia'

interface MovRow {
  dia: string
  item_id: string
  item_name: string
  medication_class: string | null
  tipo: string
  quantidade: number
  ocorrencias: number
}

// Rótulos amigáveis dos tipos de saída (movement_type do stock_movements).
const TIPO_LABEL: Record<string, string> = {
  PRESCRICAO: 'Dispensação',
  SOLICITACAO: 'Solicitação (atendimento)',
  SAIDA_AVULSA: 'Quebra / Avulsa',
  AJUSTE: 'Ajuste',
}
const tipoLabel = (t: string) => TIPO_LABEL[t] ?? t

type Modo = 'dia' | 'semana' | 'mes' | 'personalizado'

// yyyy-mm-dd de hoje (horário local)
function hojeISO(): string {
  const d = new Date()
  const off = d.getTimezoneOffset()
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 10)
}
function addDias(iso: string, n: number): string {
  const d = new Date(iso + 'T00:00:00')
  d.setDate(d.getDate() + n)
  return d.toISOString().slice(0, 10)
}
// Segunda a domingo da semana que contém a data
function semanaDe(iso: string): { inicio: string; fim: string } {
  const d = new Date(iso + 'T00:00:00')
  const dow = (d.getDay() + 6) % 7 // 0 = segunda
  const inicio = addDias(iso, -dow)
  return { inicio, fim: addDias(inicio, 6) }
}
function fmtBR(iso: string) {
  return new Date(iso + 'T00:00:00').toLocaleDateString('pt-BR')
}

export function MovimentacaoDiaria() {
  const { mode } = useTheme()
  const { activeStock } = useModule()

  const txt = mode === 'dark' ? '#fff' : '#0d2e1c'
  const txtSec = mode === 'dark' ? 'rgba(255,255,255,0.7)' : 'rgba(13,46,28,0.65)'
  const txtMut = mode === 'dark' ? 'rgba(255,255,255,0.45)' : 'rgba(13,46,28,0.45)'
  const glass: React.CSSProperties = {
    background: mode === 'dark' ? 'rgba(10,15,20,0.55)' : 'rgba(255,255,255,0.7)',
    border: `1px solid ${mode === 'dark' ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.06)'}`,
    borderRadius: 16,
  }
  const inputStyle: React.CSSProperties = {
    background: mode === 'dark' ? 'rgba(0,0,0,0.3)' : 'rgba(255,255,255,0.7)',
    border: `1px solid ${mode === 'dark' ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.1)'}`,
    borderRadius: 10, padding: '8px 12px', fontSize: 14, color: txt, outline: 'none',
  }
  const lbl: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: txtMut, textTransform: 'uppercase', letterSpacing: 0.4 }

  const [modo, setModo] = useState<Modo>('dia')
  const [dia, setDia] = useState(hojeISO())
  const [mesAno, setMesAno] = useState(() => hojeISO().slice(0, 7)) // yyyy-mm
  const [ini, setIni] = useState(hojeISO())
  const [fim, setFim] = useState(hojeISO())
  const [classe, setClasse] = useState<string>('') // '' = todas

  const [rows, setRows] = useState<MovRow[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // Resolve o período conforme o modo.
  const periodo = useMemo<{ inicio: string; fim: string }>(() => {
    if (modo === 'dia') return { inicio: dia, fim: dia }
    if (modo === 'semana') return semanaDe(dia)
    if (modo === 'mes') {
      const inicio = mesAno + '-01'
      const d = new Date(inicio + 'T00:00:00'); d.setMonth(d.getMonth() + 1); d.setDate(0)
      return { inicio, fim: d.toISOString().slice(0, 10) }
    }
    return { inicio: ini, fim: fim }
  }, [modo, dia, mesAno, ini, fim])

  async function gerar() {
    if (!activeStock) { setError('Selecione um estoque no topo.'); return }
    setLoading(true); setError(''); setRows(null)
    try {
      const { data, error: e } = await supabase.rpc('farmacia_movimentacao_diaria', {
        p_location_code: activeStock.code,
        p_inicio: periodo.inicio,
        p_fim: periodo.fim,
        p_classe: classe || null,
      })
      if (e) throw e
      setRows((data ?? []) as MovRow[])
    } catch (e) {
      setError(getErrorMessage(e))
    } finally {
      setLoading(false)
    }
  }

  function exportar() {
    if (!rows || rows.length === 0) return
    const dados = rows.map((r) => ({
      Data: fmtBR(r.dia),
      Tipo: tipoLabel(r.tipo),
      Medicamento: r.item_name,
      Classe: r.medication_class ? (MEDICATION_CLASS_LABEL[r.medication_class as MedicationClass] ?? r.medication_class) : '—',
      'Nº saídas': r.ocorrencias,
      Quantidade: r.quantidade,
    }))
    const ws = XLSX.utils.json_to_sheet(dados)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Movimentação')
    const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
    saveAs(new Blob([buf], { type: 'application/octet-stream' }),
      `movimentacao_${activeStock?.code}_${periodo.inicio}_a_${periodo.fim}.xlsx`)
  }

  const totalQtd = (rows ?? []).reduce((s, r) => s + Number(r.quantidade || 0), 0)

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="p-2.5 rounded-xl" style={{ background: mode === 'dark' ? 'rgba(45,180,140,0.15)' : 'rgba(45,180,140,0.12)' }}>
          <CalendarRange className="w-6 h-6" style={{ color: '#2da362' }} />
        </div>
        <div>
          <h1 className="text-2xl font-bold" style={{ color: txt }}>Movimentação Diária</h1>
          <p className="text-sm" style={{ color: txtSec }}>
            Todas as saídas do estoque, por dia (dispensações, quebras/avulsas, solicitações)
            {activeStock && <> — <strong>{activeStock.name}</strong></>}
          </p>
        </div>
      </div>

      {/* Filtros */}
      <div className="p-5" style={glass}>
        <div className="flex flex-wrap items-end gap-4">
          <div className="flex flex-col gap-1">
            <label style={lbl}>Período</label>
            <select value={modo} onChange={(e) => setModo(e.target.value as Modo)} style={{ ...inputStyle, minWidth: 180 }}>
              <option value="dia">Dia</option>
              <option value="semana">Semana</option>
              <option value="mes">Mês</option>
              <option value="personalizado">Período personalizado</option>
            </select>
          </div>

          {modo === 'dia' && (
            <div className="flex flex-col gap-1">
              <label style={lbl}>Data</label>
              <input type="date" value={dia} onChange={(e) => setDia(e.target.value)} style={inputStyle} />
            </div>
          )}
          {modo === 'semana' && (
            <div className="flex flex-col gap-1">
              <label style={lbl}>Dia da semana</label>
              <input type="date" value={dia} onChange={(e) => setDia(e.target.value)} style={inputStyle} />
            </div>
          )}
          {modo === 'mes' && (
            <div className="flex flex-col gap-1">
              <label style={lbl}>Mês</label>
              <input type="month" value={mesAno} onChange={(e) => setMesAno(e.target.value)} style={inputStyle} />
            </div>
          )}
          {modo === 'personalizado' && (
            <>
              <div className="flex flex-col gap-1">
                <label style={lbl}>De</label>
                <input type="date" value={ini} onChange={(e) => setIni(e.target.value)} style={inputStyle} />
              </div>
              <div className="flex flex-col gap-1">
                <label style={lbl}>Até</label>
                <input type="date" value={fim} onChange={(e) => setFim(e.target.value)} style={inputStyle} />
              </div>
            </>
          )}

          <div className="flex flex-col gap-1">
            <label style={lbl}>Classe</label>
            <select value={classe} onChange={(e) => setClasse(e.target.value)} style={{ ...inputStyle, minWidth: 220 }}>
              <option value="">Todas as classes</option>
              {(Object.entries(MEDICATION_CLASS_LABEL) as Array<[MedicationClass, string]>).map(([k, label]) => (
                <option key={k} value={k}>{label}</option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-2 ml-auto">
            <Button onClick={gerar} disabled={loading || !activeStock} className="bg-emerald-600 hover:bg-emerald-700 text-white">
              {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Play className="w-4 h-4 mr-2" />}
              Gerar
            </Button>
            <Button variant="outline" onClick={exportar} disabled={!rows || rows.length === 0}>
              <Download className="w-4 h-4 mr-2" /> Exportar XLSX
            </Button>
          </div>
        </div>
        <p className="text-xs mt-3" style={{ color: txtMut }}>
          Período: {fmtBR(periodo.inicio)} — {fmtBR(periodo.fim)}
        </p>
      </div>

      {error && (
        <div className="p-4 rounded-xl flex items-center gap-2 text-sm bg-red-100 border border-red-200 text-red-800">
          <AlertCircle size={16} /> {error}
        </div>
      )}

      {/* Resultado */}
      {rows && (
        <div style={glass} className="overflow-hidden">
          <div className="px-5 py-3 flex items-center justify-between" style={{ borderBottom: `1px solid ${mode === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)'}` }}>
            <span className="text-sm font-semibold" style={{ color: txt }}>
              {rows.length} linha(s) · total {totalQtd.toLocaleString('pt-BR')} un
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px]">
              <thead>
                <tr style={{ background: mode === 'dark' ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)', color: txtMut }}>
                  <th className="text-left px-4 py-2 text-xs font-medium">Data</th>
                  <th className="text-left px-4 py-2 text-xs font-medium">Tipo</th>
                  <th className="text-left px-4 py-2 text-xs font-medium">Medicamento</th>
                  <th className="text-left px-4 py-2 text-xs font-medium">Classe</th>
                  <th className="text-right px-4 py-2 text-xs font-medium">Nº saídas</th>
                  <th className="text-right px-4 py-2 text-xs font-medium">Quantidade</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr><td colSpan={6} className="text-center py-8 text-sm" style={{ color: txtMut }}>Nenhuma saída no período.</td></tr>
                ) : rows.map((r, i) => (
                  <tr key={`${r.dia}-${r.item_id}-${r.tipo}-${i}`} style={{ borderTop: `1px solid ${mode === 'dark' ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)'}` }}>
                    <td className="px-4 py-2 text-sm whitespace-nowrap" style={{ color: txt }}>{fmtBR(r.dia)}</td>
                    <td className="px-4 py-2 text-sm whitespace-nowrap" style={{ color: txtSec }}>{tipoLabel(r.tipo)}</td>
                    <td className="px-4 py-2 text-sm" style={{ color: txt }}>{r.item_name}</td>
                    <td className="px-4 py-2 text-sm" style={{ color: txtSec }}>
                      {r.medication_class ? (MEDICATION_CLASS_LABEL[r.medication_class as MedicationClass] ?? r.medication_class) : '—'}
                    </td>
                    <td className="px-4 py-2 text-sm text-right" style={{ color: txtSec }}>{r.ocorrencias}</td>
                    <td className="px-4 py-2 text-sm text-right font-semibold" style={{ color: txt }}>{Number(r.quantidade).toLocaleString('pt-BR')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
