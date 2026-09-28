import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Loader2, Printer, AlertTriangle } from 'lucide-react'
import { format } from 'date-fns'
import { dataBR } from '@/lib/utils/seguro'
import { ptBR } from 'date-fns/locale'
import { Button } from '@/components/ui/button'
import {
  pharmacyLoanService,
  LOAN_TYPE_LABELS,
  LOAN_SCOPE_LABELS,
  type LoanDetail,
  type LoanType,
} from '@/lib/services/pharmacy-loan'
import { getErrorMessage } from '@/lib/utils/error-messages'

const TYPES: LoanType[] = [
  'emprestimo',
  'devolucao_emprestimo',
  'troca_validade',
  'permuta',
  'consignacao',
  'doacao',
]

const fmtBRL = (n: number | null | undefined) =>
  n == null
    ? '—'
    : n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

const fmtDate = (s: string | null | undefined, withTime = false) => {
  if (!s) return '—'
  // 'YYYY-MM-DD' (form_date): sem hora, nao passar por new Date() (UTC = dia anterior)
  if (!withTime && /^\d{4}-\d{2}-\d{2}$/.test(s)) return dataBR(s)
  try {
    return format(new Date(s), withTime ? "dd/MM/yyyy HH:mm" : 'dd/MM/yyyy', { locale: ptBR })
  } catch {
    return '—'
  }
}

export function PharmacyLoanDetail({ printMode = false }: { printMode?: boolean }) {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [loan, setLoan] = useState<LoanDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const baseRoute =
    loan?.scope === 'warehouse' ? '/almoxarifado/movimentacoes' : '/farmacia/movimentacoes'

  useEffect(() => {
    if (id) load(id)
  }, [id])

  // Auto-imprimir quando entra em /imprimir
  useEffect(() => {
    if (printMode && loan && !loading) {
      setTimeout(() => window.print(), 300)
    }
  }, [printMode, loan, loading])

  async function load(loanId: string) {
    try {
      setLoading(true)
      const data = await pharmacyLoanService.getById(loanId)
      setLoan(data)
    } catch (e: any) {
      setError(getErrorMessage(e))
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="text-center py-12">
        <Loader2 className="w-6 h-6 animate-spin inline-block mr-2" /> Carregando...
      </div>
    )
  }

  if (error || !loan) {
    return (
      <div className="text-center py-12">
        <AlertTriangle className="w-12 h-12 mx-auto text-red-500 mb-3" />
        <p className="text-gray-600 mb-4">{error || 'Formulário não encontrado'}</p>
        <Button onClick={() => navigate(baseRoute)}>Voltar</Button>
      </div>
    )
  }

  const enviando = loan.items.filter((i) => i.direction === 'enviando')
  const recebendo = loan.items.filter((i) => i.direction === 'recebendo')

  const totalEnviado = enviando.reduce(
    (acc, r) => acc + Number(r.quantity || 0) * Number(r.unit_price || 0),
    0
  )
  const totalRecebido = recebendo.reduce(
    (acc, r) => acc + Number(r.quantity || 0) * Number(r.unit_price || 0),
    0
  )

  return (
    <div className={printMode ? 'p-6 bg-white min-h-screen' : 'max-w-5xl mx-auto space-y-4'}>
      {/* Toolbar (some no print) */}
      {!printMode && (
        <div className="flex items-center justify-between print:hidden">
          <Button variant="ghost" size="sm" onClick={() => navigate(baseRoute)}>
            <ArrowLeft className="w-4 h-4 mr-2" /> Voltar
          </Button>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              onClick={() => navigate(`/farmacia/movimentacoes/${loan.id}/imprimir`)}
            >
              <Printer className="w-4 h-4 mr-2" /> Imprimir
            </Button>
            {loan.status === 'cancelled' && (
              <span className="px-3 py-1 text-xs rounded-full bg-gray-100 text-gray-700 border border-gray-200">
                Estornada
              </span>
            )}
          </div>
        </div>
      )}

      {/* Conteúdo do formulário (estilo da foto) */}
      <div
        id="loan-print"
        className={`bg-white ${printMode ? '' : 'p-8 rounded-xl shadow-sm border border-gray-100'}`}
      >
        {/* Cabeçalho — logos institucionais + título centralizado */}
        <div className="grid grid-cols-[80px_1fr_80px] items-center gap-3 border-b-2 border-gray-800 pb-3 mb-4">
          <div className="flex items-center justify-center h-14">
            <img
              src="/assets/logo-fesf.svg"
              alt="FESF-SUS"
              className="max-h-14 max-w-full object-contain"
              onError={(e) => {
                const el = e.currentTarget
                el.style.display = 'none'
                if (el.nextElementSibling) (el.nextElementSibling as HTMLElement).style.display = 'block'
              }}
            />
            <span className="hidden text-xs font-bold text-gray-800 text-center leading-tight">FESF-SUS</span>
          </div>
          <div className="text-center">
            <div className="text-lg font-bold text-gray-900 leading-tight">HOSPITAL ESTADUAL COSTA DOS COQUEIROS</div>
            <div className="text-sm font-semibold text-gray-700 mt-1">
              FORMULÁRIO DE SAÍDA DE MATERIAL — {LOAN_SCOPE_LABELS[loan.scope]}
            </div>
          </div>
          <div className="flex items-center justify-center h-14">
            <img
              src="/assets/logo-bahia.svg"
              alt="Governo do Estado da Bahia"
              className="max-h-14 max-w-full object-contain"
              onError={(e) => {
                const el = e.currentTarget
                el.style.display = 'none'
                if (el.nextElementSibling) (el.nextElementSibling as HTMLElement).style.display = 'block'
              }}
            />
            <span className="hidden text-xs font-bold text-gray-800 text-center leading-tight">GOVERNO BAHIA</span>
          </div>
        </div>

        {/* Origem/Destino */}
        <table className="w-full text-sm border border-gray-800 mb-4">
          <tbody>
            <tr className="border-b border-gray-800">
              <td className="p-2 border-r border-gray-800 w-1/6 font-bold">ORIGEM:</td>
              <td className="p-2 border-r border-gray-800">{loan.origem}</td>
              <td className="p-2 border-r border-gray-800 w-1/6 font-bold">CONTATO:</td>
              <td className="p-2">{loan.contato_origem || '—'}</td>
            </tr>
            <tr>
              <td className="p-2 border-r border-gray-800 font-bold">DESTINO:</td>
              <td className="p-2 border-r border-gray-800">{loan.destino}</td>
              <td className="p-2 border-r border-gray-800 font-bold">CONTATO:</td>
              <td className="p-2">{loan.contato_destino || '—'}</td>
            </tr>
          </tbody>
        </table>

        {/* ENVIANDO */}
        <DirectionSection
          title="ENVIANDO"
          activeType={loan.enviando_type}
          items={enviando}
          total={totalEnviado}
        />

        {/* RECEBENDO */}
        <DirectionSection
          title="RECEBENDO"
          activeType={loan.recebendo_type}
          items={recebendo}
          total={totalRecebido}
        />

        {/* Observações */}
        {loan.notes && (
          <div className="mt-4 p-3 border border-gray-300 rounded text-sm">
            <strong>Observações:</strong> {loan.notes}
          </div>
        )}

        {/* Rodapé com assinaturas */}
        <table className="w-full text-sm border border-gray-800 mt-6">
          <thead>
            <tr className="border-b border-gray-800 bg-gray-50">
              <th className="p-2 border-r border-gray-800 w-1/4">DATA</th>
              <th className="p-2 border-r border-gray-800">ASSINATURA DO SOLICITANTE</th>
              <th className="p-2">ASSINATURA DO CEDENTE</th>
            </tr>
          </thead>
          <tbody>
            <tr style={{ height: 80 }}>
              <td className="p-2 border-r border-gray-800 text-center align-bottom">
                {fmtDate(loan.form_date)}
              </td>
              <td className="p-2 border-r border-gray-800 text-center align-bottom">
                <div className="border-t border-gray-400 pt-1 text-xs">
                  {loan.signature_solicitante_name || ''}
                </div>
              </td>
              <td className="p-2 text-center align-bottom">
                <div className="border-t border-gray-400 pt-1 text-xs">
                  {loan.signature_cedente_name || ''}
                </div>
              </td>
            </tr>
          </tbody>
        </table>

        <div className="mt-3 text-center text-xs text-gray-600">
          <strong>Hospital Estadual Costa dos Coqueiros</strong>
          <br />
          Av. Santos Dumont, Lauro de Freitas, BA, 42712-740
        </div>

        {/* Status + nº */}
        <div className="mt-4 flex justify-between text-[10px] text-gray-500 print:hidden">
          <span>Formulário nº {loan.form_number}</span>
          <span>Registrado em {fmtDate(loan.created_at, true)} por {loan.created_by_name || '—'}</span>
        </div>
      </div>

      {/* Print CSS */}
      <style>{`
        @media print {
          @page { size: A4; margin: 12mm; }
          body, html { background: white !important; }
          .print\\:hidden { display: none !important; }
          nav, aside, header { display: none !important; }
          #loan-print { box-shadow: none !important; border: 0 !important; padding: 0 !important; }
        }
      `}</style>
    </div>
  )
}

function DirectionSection({
  title,
  activeType,
  items,
  total,
}: {
  title: string
  activeType: LoanType | null
  items: LoanDetail['items']
  total: number
}) {
  const isActive = activeType !== null
  return (
    <div className="mt-4">
      <div className="text-center font-bold mb-1">
        ( {isActive ? 'X' : ' '} ) {title}
      </div>

      {/* Checkboxes de tipo (linha mostrando qual está marcado) */}
      <div className="flex flex-wrap justify-around text-sm mb-2 gap-y-1">
        {TYPES.map((t) => (
          <span key={t} className="whitespace-nowrap">
            ( {activeType === t ? 'X' : ' '} ) {LOAN_TYPE_LABELS[t]}
          </span>
        ))}
      </div>

      <table className="w-full text-xs border border-gray-800">
        <thead>
          <tr className="bg-gray-100 border-b border-gray-800">
            <th className="p-1 border-r border-gray-800 text-center">ITEM</th>
            <th className="p-1 border-r border-gray-800 text-center w-12">UF</th>
            <th className="p-1 border-r border-gray-800 text-center w-16">QTDE</th>
            <th className="p-1 border-r border-gray-800 text-center w-20">R$ UNIT.</th>
            <th className="p-1 border-r border-gray-800 text-center w-24">R$ TOTAL</th>
            <th className="p-1 border-r border-gray-800 text-center w-24">VALIDADE</th>
            <th className="p-1 border-r border-gray-800 text-center w-24">LOTE</th>
            <th className="p-1 border-r border-gray-800 text-center w-40">CÓDIGO SIMPAS</th>
            <th className="p-1 text-center">OBSERVAÇÃO</th>
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: Math.max(items.length, 5) }).map((_, idx) => {
            const it = items[idx]
            if (!it) {
              return (
                <tr key={`empty-${idx}`} className="border-b border-gray-800">
                  <td className="p-1 border-r border-gray-800" style={{ height: 22 }}>&nbsp;</td>
                  <td className="p-1 border-r border-gray-800">&nbsp;</td>
                  <td className="p-1 border-r border-gray-800">&nbsp;</td>
                  <td className="p-1 border-r border-gray-800">&nbsp;</td>
                  <td className="p-1 border-r border-gray-800">&nbsp;</td>
                  <td className="p-1 border-r border-gray-800">&nbsp;</td>
                  <td className="p-1 border-r border-gray-800">&nbsp;</td>
                  <td className="p-1 border-r border-gray-800">&nbsp;</td>
                  <td className="p-1">&nbsp;</td>
                </tr>
              )
            }
            const totalRow = Number(it.quantity || 0) * Number(it.unit_price || 0)
            return (
              <tr key={it.id} className="border-b border-gray-800">
                <td className="p-1 border-r border-gray-800">
                  {/* Badges FARM/ALMOX escondidos no modo impressão (poluíam o
                      formulário oficial). Ficam só na visualização digital. */}
                  {(it as any).warehouse_item_id && (
                    <span className="text-[9px] mr-1 px-1 py-0.5 rounded bg-purple-50 text-purple-700 border border-purple-200 print:hidden">ALMOX</span>
                  )}
                  {it.pharmacy_item_id && (
                    <span className="text-[9px] mr-1 px-1 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 print:hidden">FARM</span>
                  )}
                  {it.item_description}
                </td>
                <td className="p-1 border-r border-gray-800 text-center">{it.unit || '—'}</td>
                <td className="p-1 border-r border-gray-800 text-right">{it.quantity}</td>
                <td className="p-1 border-r border-gray-800 text-right">
                  {it.unit_price != null ? `R$ ${Number(it.unit_price).toFixed(2)}` : '—'}
                </td>
                <td className="p-1 border-r border-gray-800 text-right">
                  {totalRow ? `R$ ${totalRow.toFixed(2)}` : '—'}
                </td>
                <td className="p-1 border-r border-gray-800 text-center">
                  {it.validity_date
                    ? format(new Date(it.validity_date + 'T00:00:00'), 'dd/MM/yyyy')
                    : '—'}
                </td>
                <td className="p-1 border-r border-gray-800 text-center">{it.batch_number || '—'}</td>
                <td className="p-1 border-r border-gray-800 font-mono text-center whitespace-nowrap">{it.codigo_simpas || '—'}</td>
                <td className="p-1">{it.observation || '—'}</td>
              </tr>
            )
          })}
        </tbody>
        <tfoot>
          <tr className="bg-gray-50 border-t border-gray-800">
            <td colSpan={4} className="p-1 text-right font-bold border-r border-gray-800">
              TOTAL {title.toLowerCase() === 'enviando' ? 'ENVIADO' : 'RECEBIDO'}
            </td>
            <td colSpan={5} className="p-1 text-right font-bold">
              {fmtBRL(total)}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  )
}
