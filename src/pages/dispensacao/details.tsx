import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useTheme } from '@/contexts/theme'
import { ArrowLeft, User, FileText, Pill as PillIcon, Clock, XCircle, CheckCircle2, Loader2, AlertCircle, Building2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { pharmacyDispensationService } from '@/lib/services/pharmacy-dispensation'
import { isMaterialDispensationId, loadMaterialDispensationById } from '@/lib/services/material-dispensations'
import { useModule } from '@/contexts/module'
import type { PharmacyDispensation } from '@/lib/types/dispensation'

// Validade do lote: coluna DATE no banco: fixa meia-noite local para nao
// deslocar o dia por fuso. Sem valor (dispensacao antiga) mostra travessao.
function fmtDate(d: string | null | undefined) {
  if (!d) return '—'
  return new Date(d + 'T00:00:00').toLocaleDateString('pt-BR')
}

export function DispensationDetails() {
  const { id } = useParams<{ id: string }>()
  const { activeStock } = useModule()
  const navigate = useNavigate()
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
    transition: 'background 0.4s, border-color 0.4s',
  }

  const [dispensation, setDispensation] = useState<PharmacyDispensation | null>(null)
  const [loading, setLoading] = useState(true)
  const [showCancel, setShowCancel] = useState(false)
  const [cancelReason, setCancelReason] = useState('')
  const [cancelling, setCancelling] = useState(false)

  useEffect(() => {
    if (id) loadData()
  }, [id])

  async function loadData() {
    setLoading(true)
    try {
      // Dispensacao de MATERIAL nao existe em pharmacy_dispensations: ela vive
      // em stock_movements e a lista monta uma chave sintetica. Por isso o
      // detalhe dava "nao encontrada" na Satelite Terreo.
      const data = isMaterialDispensationId(id!)
        ? await loadMaterialDispensationById(activeStock!.id, id!)
        : await pharmacyDispensationService.getById(id!)
      setDispensation(data)
    } catch (e) {
      console.error('Error:', e)
    } finally {
      setLoading(false)
    }
  }

  const handleCancel = async () => {
    if (!cancelReason.trim() || !id) return
    setCancelling(true)
    try {
      await pharmacyDispensationService.cancel(id, cancelReason)
      await loadData()
      setShowCancel(false)
      setCancelReason('')
    } catch (e) {
      console.error('Error:', e)
    } finally {
      setCancelling(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 size={32} className="animate-spin" style={{ color: txtMut }} />
      </div>
    )
  }

  if (!dispensation) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4">
        <AlertCircle size={48} style={{ color: txtMut }} />
        <p style={{ color: txtMut }}>Dispensacao nao encontrada</p>
        <Button variant="outline" onClick={() => navigate('/dispensacao')}>Voltar</Button>
      </div>
    )
  }

  const d = dispensation
  const totalItems = d.items.reduce((sum, i) => sum + i.quantity, 0)

  const infoItem = (label: string, value: string | undefined) => (
    <div>
      <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: txtMut }}>{label}</span>
      <p className="text-sm font-medium mt-1" style={{ color: txt }}>{value || '—'}</p>
    </div>
  )

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button onClick={() => navigate('/dispensacao')} style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            width: 40, height: 40, borderRadius: 10, cursor: 'pointer',
            background: mode === 'dark' ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.06)',
            border: `1px solid ${mode === 'dark' ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.08)'}`,
            color: txt,
          }}><ArrowLeft size={18} /></button>
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2" style={{ color: txt }}>
              Dispensacao #{d.dispensation_number}
              {d.tipo === 'requisicao' ? (
                <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-indigo-100 text-indigo-800">
                  <Building2 size={12} /> Requisicao
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                  <User size={12} /> Prescricao
                </span>
              )}</h1>
            <p className="text-sm" style={{ color: txtSec }}>
              {format(new Date(d.created_at), "dd 'de' MMMM 'de' yyyy 'as' HH:mm", { locale: ptBR })}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {d.status === 'completed' ? (
            <span className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium bg-green-100 text-green-800">
              <CheckCircle2 size={16} /> Concluida
            </span>
          ) : d.status === 'pending_approval' ? (
            <span className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium bg-amber-100 text-amber-800">
              <Clock size={16} /> Aguardando aprovacao
            </span>
          ) : (
            <span className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium bg-red-100 text-red-800">
              <XCircle size={16} /> Cancelada
            </span>
          )}
        </div>
      </div>

      {d.tipo === 'requisicao' ? (
        /* Requisição — só setor */
        <div className="p-6" style={glass}>
          <div className="flex items-center gap-2 mb-4">
            <Building2 size={18} style={{ color: txt }} />
            <h2 className="text-lg font-semibold" style={{ color: txt }}>Requisição de Setor</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {infoItem('Setor solicitante', d.sector)}
            {/* Data da RM: opcional — travessao quando nao informada. */}
            {infoItem('Data da RM', fmtDate(d.rm_date))}
            {d.patient_name && infoItem('Paciente', d.patient_name)}
            {d.notes && infoItem('Observacoes', d.notes)}
          </div>
        </div>
      ) : (
        <>
          {/* Patient Info */}
          <div className="p-6" style={glass}>
            <div className="flex items-center gap-2 mb-4">
              <User size={18} style={{ color: txt }} />
              <h2 className="text-lg font-semibold" style={{ color: txt }}>Dados do Paciente</h2>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {infoItem('Nome do Paciente', d.patient_name || undefined)}
              {infoItem('N. Prontuario', d.medical_record_number || undefined)}
              {infoItem('Leito / Quarto', d.patient_bed_room)}
              {infoItem('Setor', d.sector)}
            </div>
          </div>

          {/* Prescription Info */}
          <div className="p-6" style={glass}>
            <div className="flex items-center gap-2 mb-4">
              <FileText size={18} style={{ color: txt }} />
              <h2 className="text-lg font-semibold" style={{ color: txt }}>Prescricao Medica</h2>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {infoItem('Medico Prescritor', d.prescribing_doctor || undefined)}
              {infoItem('N. da Prescricao', d.prescription_number || undefined)}
              {d.notes && infoItem('Observacoes', d.notes)}
            </div>
          </div>
        </>
      )}

      {/* Items */}
      <div className="p-6" style={glass}>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <PillIcon size={18} style={{ color: txt }} />
            <h2 className="text-lg font-semibold" style={{ color: txt }}>Medicamentos Dispensados</h2>
          </div>
          <span className="text-sm" style={{ color: txtMut }}>
            {d.items.length} {d.items.length === 1 ? 'item' : 'itens'} | {totalItems} unidades
          </span>
        </div>
        <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr style={{ borderBottom: `1px solid ${mode === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)'}` }}>
              <th className="text-left px-4 py-2 text-xs font-semibold uppercase" style={{ color: txtMut }}>Codigo</th>
              <th className="text-left px-4 py-2 text-xs font-semibold uppercase" style={{ color: txtMut }}>Medicamento</th>
              <th className="text-left px-4 py-2 text-xs font-semibold uppercase" style={{ color: txtMut }}>Lote</th>
              <th className="text-center px-4 py-2 text-xs font-semibold uppercase" style={{ color: txtMut }}>Validade</th>
              <th className="text-center px-4 py-2 text-xs font-semibold uppercase" style={{ color: txtMut }}>Quantidade</th>
              <th className="text-center px-4 py-2 text-xs font-semibold uppercase" style={{ color: txtMut }}>Unidade</th>
            </tr>
          </thead>
          <tbody>
            {d.items.map((item, i) => (
              <tr key={item.id} style={{
                borderBottom: `1px solid ${mode === 'dark' ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)'}`,
                background: i % 2 === 0 ? (mode === 'dark' ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)') : 'transparent',
              }}>
                <td className="px-4 py-3 text-sm" style={{ color: txtMut }}>{item.item_code}</td>
                <td className="px-4 py-3 text-sm font-medium" style={{ color: txt }}>{item.item_name}</td>
                <td className="px-4 py-3 text-sm" style={{ color: txtSec }}>{item.batch_number || '—'}</td>
                <td className="px-4 py-3 text-sm text-center" style={{ color: txtSec }}>{fmtDate(item.expiry_date)}</td>
                <td className="px-4 py-3 text-sm text-center font-semibold" style={{ color: txt }}>{item.quantity}</td>
                <td className="px-4 py-3 text-sm text-center" style={{ color: txtMut }}>{item.item_unit}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>

      {/* Metadata */}
      <div className="p-6" style={glass}>
        <div className="flex items-center gap-2 mb-4">
          <Clock size={18} style={{ color: txt }} />
          <h2 className="text-lg font-semibold" style={{ color: txt }}>Informacoes do Registro</h2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {infoItem('Registrado por', d.created_by_name)}
          {infoItem('Data/Hora', format(new Date(d.created_at), "dd/MM/yyyy 'as' HH:mm:ss", { locale: ptBR }))}
          {d.cancelled_at && infoItem('Cancelado em', format(new Date(d.cancelled_at), "dd/MM/yyyy 'as' HH:mm:ss", { locale: ptBR }))}
          {d.cancellation_reason && infoItem('Motivo do cancelamento', d.cancellation_reason)}
        </div>
      </div>

      {/* Cancel Action */}
      {(d.status === 'completed' || d.status === 'pending_approval') && (
        <div className="flex justify-end">
          {showCancel ? (
            <div className="p-4 rounded-xl w-full max-w-md" style={{
              ...glass,
              borderColor: 'rgba(239,68,68,0.3)',
            }}>
              <h3 className="font-semibold text-sm mb-2" style={{ color: txt }}>Cancelar Dispensacao</h3>
              <textarea
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                placeholder="Motivo do cancelamento..."
                rows={2}
                style={{
                  width: '100%', borderRadius: 10, padding: '8px 12px', fontSize: 14,
                  color: txt, outline: 'none', resize: 'vertical' as const,
                  background: mode === 'dark' ? 'rgba(0,0,0,0.3)' : 'rgba(255,255,255,0.7)',
                  border: `1px solid ${mode === 'dark' ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.1)'}`,
                }}
              />
              <div className="flex justify-end gap-2 mt-3">
                <Button variant="outline" size="sm" onClick={() => setShowCancel(false)}>Voltar</Button>
                <Button
                  size="sm"
                  className="bg-red-600 hover:bg-red-700 text-white"
                  onClick={handleCancel}
                  disabled={!cancelReason.trim() || cancelling}
                >
                  {cancelling ? <Loader2 size={14} className="animate-spin mr-1" /> : null}
                  Confirmar Cancelamento
                </Button>
              </div>
            </div>
          ) : (
            <Button
              variant="outline"
              className="text-red-600 border-red-200 hover:bg-red-50"
              onClick={() => setShowCancel(true)}
            >
              <XCircle size={16} className="mr-2" /> Cancelar Dispensacao
            </Button>
          )}
        </div>
      )}
    </div>
  )
}
