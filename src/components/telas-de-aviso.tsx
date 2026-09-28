import { useNavigate } from 'react-router-dom'
import { AlertTriangle, ArrowLeft, Home, RefreshCw, SearchX, ShieldOff, UserX } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { ErrorFallbackProps } from '@/components/ui/error-boundary'

// Telas de aviso mostradas DENTRO do layout (o menu continua visível):
// erro de render de uma tela, página inexistente e acesso negado.

function Quadro({ icone, titulo, children, acoes }: {
  icone: React.ReactNode
  titulo: string
  children: React.ReactNode
  acoes: React.ReactNode
}) {
  return (
    <div className="flex items-center justify-center py-12 px-4">
      <div className="max-w-lg w-full bg-white rounded-xl shadow-sm border border-gray-200 p-6 text-center">
        <div className="mx-auto mb-4 w-14 h-14 rounded-full bg-gray-100 flex items-center justify-center">{icone}</div>
        <h1 className="text-xl font-bold text-gray-900 mb-2">{titulo}</h1>
        <div className="text-gray-600 mb-6">{children}</div>
        <div className="flex flex-col sm:flex-row gap-2 justify-center">{acoes}</div>
      </div>
    </div>
  )
}

function BotoesNavegacao() {
  const navigate = useNavigate()
  return (
    <>
      <Button variant="outline" onClick={() => navigate(-1)}>
        <ArrowLeft className="w-4 h-4 mr-2" />
        Voltar
      </Button>
      <Button onClick={() => navigate('/')}>
        <Home className="w-4 h-4 mr-2" />
        Ir para o início
      </Button>
    </>
  )
}

/** Fallback do ErrorBoundary por tela. */
export function ErroDeTela({ error, retry }: ErrorFallbackProps) {
  return (
    <Quadro
      icone={<AlertTriangle className="w-8 h-8 text-red-500" />}
      titulo="Esta tela encontrou um erro"
      acoes={
        <>
          <Button variant="outline" onClick={retry}>
            <RefreshCw className="w-4 h-4 mr-2" />
            Tentar de novo
          </Button>
          <BotoesNavegacao />
        </>
      }
    >
      <p>Nada foi salvo por causa deste erro. Você pode tentar de novo, voltar ou ir para o início; o resto do sistema continua funcionando.</p>
      <details className="mt-3 text-left">
        <summary className="cursor-pointer text-xs text-gray-500">Detalhes técnicos (para o suporte)</summary>
        <pre className="mt-2 text-xs bg-gray-100 p-2 rounded overflow-auto whitespace-pre-wrap">{error.message}</pre>
      </details>
    </Quadro>
  )
}

export function PaginaNaoEncontrada() {
  return (
    <Quadro icone={<SearchX className="w-8 h-8 text-gray-500" />} titulo="Página não encontrada" acoes={<BotoesNavegacao />}>
      <p>O endereço que você abriu não existe no sistema. Confira o link ou use o menu.</p>
    </Quadro>
  )
}

export function SemAcesso({ mensagem }: { mensagem: string }) {
  return (
    <Quadro icone={<ShieldOff className="w-8 h-8 text-amber-600" />} titulo="Sem acesso a esta tela" acoes={<BotoesNavegacao />}>
      <p>{mensagem}</p>
      <p className="text-sm text-gray-500 mt-2">Se você precisa usar esta tela, procure o administrador do sistema.</p>
    </Quadro>
  )
}

export const MSG_SEM_SETOR = 'Seu usuário está sem setor da Farmácia ou do Almoxarifado. Procure o administrador do sistema para ser lotado no setor certo.'

export function AvisoSemSetor() {
  return (
    <Quadro icone={<UserX className="w-8 h-8 text-amber-600" />} titulo="Seu usuário está sem setor" acoes={<BotoesNavegacao />}>
      <p>{MSG_SEM_SETOR}</p>
      <p className="text-sm text-gray-500 mt-2">Enquanto isso você pode fazer e acompanhar solicitações pelo menu.</p>
    </Quadro>
  )
}
