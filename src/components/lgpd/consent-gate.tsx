import { useState, useEffect, useRef, type ReactNode } from 'react'
import { Shield, FileText, Lock, UserCheck, AlertCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/auth'

const CONSENT_VERSION = '1.0'

interface ConsentGateProps {
  children: ReactNode
}

export function ConsentGate({ children }: ConsentGateProps) {
  const { user, loading: authLoading, signOut } = useAuth()
  const [status, setStatus] = useState<'loading' | 'accepted' | 'pending' | 'erro'>('loading')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Para qual usuário o status acima vale (evita mostrar o app por um instante
  // antes de conferir o aceite de quem acabou de entrar).
  const [verificadoPara, setVerificadoPara] = useState<string | null>(null)

  useEffect(() => {
    // Auth still initializing — wait
    if (authLoading) return
    // Unauthenticated (login/register pages) — pass through
    if (!user) { setStatus('accepted'); return }
    // Authenticated: re-check from scratch (evita flash do app antes do modal)
    setStatus('loading')
    checkConsent()
  }, [user?.id, authLoading])

  async function checkConsent() {
    setStatus('loading')
    const { data, error: err } = await supabase
      .from('lgpd_consents')
      .select('id')
      .eq('user_id', user!.id)
      .eq('version', CONSENT_VERSION)
      .limit(1)
    // Erro de consulta NÃO é "não aceitou": antes pedia o aceite de novo a
    // cada falha de rede (e gravava consentimento repetido).
    setVerificadoPara(user!.id)
    if (err) { setError(err.message); setStatus('erro'); return }
    setError(null)
    setStatus(data && data.length > 0 ? 'accepted' : 'pending')
  }

  const aceitandoRef = useRef(false)
  async function handleAccept() {
    if (aceitandoRef.current) return
    aceitandoRef.current = true
    setSubmitting(true)
    setError(null)
    try {
      const { error: err } = await supabase
        .from('lgpd_consents')
        .insert({ user_id: user!.id, version: CONSENT_VERSION })
      if (err) throw err
      setStatus('accepted')
    } catch {
      setError('Não foi possível registrar o consentimento. Tente novamente.')
    } finally {
      aceitandoRef.current = false
      setSubmitting(false)
    }
  }

  async function handleReject() {
    await signOut()
  }

  // Enquanto o login carrega, ou sem usuário (login, painéis de TV), deixa as
  // rotas cuidarem da tela (a ProtectedRoute mostra o progresso).
  if (authLoading || !user) return <>{children}</>

  if (verificadoPara !== user.id && status !== 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="flex items-center gap-3 text-gray-500">
          <Shield className="w-6 h-6 animate-pulse" />
          <span>Verificando conformidade LGPD...</span>
        </div>
      </div>
    )
  }

  if (status === 'erro') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
        <div className="max-w-md w-full bg-white rounded-lg shadow-lg p-6 text-center space-y-4">
          <AlertCircle className="w-12 h-12 text-red-500 mx-auto" />
          <h1 className="text-lg font-bold text-gray-900">Não foi possível verificar o termo LGPD</h1>
          <p className="text-sm text-gray-600">O servidor não respondeu. {error}</p>
          <div className="flex flex-col gap-2">
            <Button onClick={() => checkConsent()}>Tentar de novo</Button>
            <Button variant="outline" onClick={handleReject}>Sair</Button>
          </div>
        </div>
      </div>
    )
  }

  if (status === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="flex items-center gap-3 text-gray-500">
          <Shield className="w-6 h-6 animate-pulse" />
          <span>Verificando conformidade LGPD...</span>
        </div>
      </div>
    )
  }

  if (status === 'accepted') return <>{children}</>

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center gap-3 px-6 pt-6 pb-4 border-b">
          <div className="p-2 bg-blue-100 rounded-lg">
            <Shield className="w-6 h-6 text-blue-600" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Termo de Consentimento — LGPD</h2>
            <p className="text-sm text-gray-500">Lei nº 13.709/2018 · Versão {CONSENT_VERSION}</p>
          </div>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 px-6 py-4 space-y-4 text-sm text-gray-700">
          <p>
            O <strong>SGI-HECC</strong> (Sistema de Gestão Integrada — Hospital Estadual Costa das Baleias)
            trata dados pessoais e dados pessoais sensíveis de saúde para gerenciamento de medicamentos,
            dispensações e controle de estoque hospitalar.
          </p>

          <div className="space-y-3">
            <div className="flex gap-3">
              <FileText className="w-5 h-5 text-blue-500 flex-shrink-0 mt-0.5" />
              <div>
                <p className="font-medium text-gray-800">Dados tratados</p>
                <p className="text-gray-600">
                  Nome, e-mail e setor do colaborador; nome do paciente, prontuário e medicamentos dispensados;
                  lotes e validades de itens de estoque.
                </p>
              </div>
            </div>
            <div className="flex gap-3">
              <Lock className="w-5 h-5 text-green-500 flex-shrink-0 mt-0.5" />
              <div>
                <p className="font-medium text-gray-800">Base legal e finalidade</p>
                <p className="text-gray-600">
                  Execução de contrato de trabalho e tutela da saúde (Art. 7 II e Art. 11 II "f" da LGPD);
                  cumprimento de obrigações legais (Portaria 344/98, RDC 471/2021, CFM 1821/2007).
                </p>
              </div>
            </div>
            <div className="flex gap-3">
              <UserCheck className="w-5 h-5 text-purple-500 flex-shrink-0 mt-0.5" />
              <div>
                <p className="font-medium text-gray-800">Seus direitos (Arts. 17–22 LGPD)</p>
                <p className="text-gray-600">
                  Acesso, retificação, exclusão, portabilidade e oposição ao tratamento.
                  Solicitações podem ser feitas pelo menu <em>Meu Perfil → Privacidade</em> ou pelo
                  e-mail do Encarregado (DPO): <strong>privacidade@hecc.saude.ba.gov.br</strong>.
                  Prazo de resposta: 15 dias corridos (Art. 19 LGPD).
                </p>
              </div>
            </div>
          </div>

          <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 flex gap-2">
            <AlertCircle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
            <p className="text-amber-800">
              <strong>Retenção:</strong> Dados de prontuário são retidos por no mínimo 20 anos conforme
              CFM 1821/2007. Dados de controlados por 5 anos (Portaria 344/98 Art. 7 §2).
            </p>
          </div>

          <p className="text-gray-500 text-xs">
            Ao clicar em <strong>"Li e aceito"</strong>, você confirma que leu e compreende este termo
            e autoriza o tratamento dos dados descritos. Versão {CONSENT_VERSION} · {new Date().toLocaleDateString('pt-BR')}.
          </p>
        </div>

        {/* Footer */}
        {error && (
          <div className="mx-6 mb-2 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
            {error}
          </div>
        )}
        <div className="px-6 pb-6 pt-3 border-t flex justify-between items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            className="text-gray-500 hover:text-red-600"
            onClick={handleReject}
            disabled={submitting}
          >
            Recusar e sair
          </Button>
          <Button
            onClick={handleAccept}
            disabled={submitting}
            className="bg-blue-600 hover:bg-blue-700 text-white px-8"
          >
            {submitting ? 'Registrando...' : 'Li e aceito'}
          </Button>
        </div>
      </div>
    </div>
  )
}
