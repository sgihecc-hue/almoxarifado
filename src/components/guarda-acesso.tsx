import { useLocation } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { useModule } from '@/contexts/module'
import { podeAcessar, NOME_MODULO, NOME_PAPEL } from '@/lib/permissoes'
import { ErroCarregamento } from '@/components/ui/erro-carregamento'
import { AvisoSemSetor, SemAcesso } from '@/components/telas-de-aviso'

// Guarda de rota por papel + módulo (auditoria 28/09/2026, X-08). Usa o MESMO
// mapa do menu (lib/permissoes.ts). O banco continua sendo a última palavra
// (RLS); isto evita que a pessoa abra pela URL uma tela que não é dela.
export function GuardaAcesso({ children }: { children: React.ReactNode }) {
  const location = useLocation()
  const { perfil, setorPronto, erroSetor, recarregarSetor } = useModule()

  if (erroSetor) {
    return (
      <div className="py-8">
        <ErroCarregamento
          titulo="Não foi possível verificar o seu setor."
          erro="O banco não respondeu ao ler o setor do seu usuário."
          onTentar={recarregarSetor}
        />
      </div>
    )
  }
  if (!setorPronto) {
    return (
      <div className="flex items-center justify-center py-16 text-gray-500 gap-3">
        <Loader2 className="w-5 h-5 animate-spin" />
        Verificando suas permissões...
      </div>
    )
  }

  const r = podeAcessar(perfil, location.pathname + location.search)
  if (r.ok) return <>{children}</>
  if (r.motivo === 'sem-setor') return <AvisoSemSetor />
  if (r.motivo === 'outro-modulo') {
    const meus = perfil.modulos.map((m) => NOME_MODULO[m]).join(' e ')
    return <SemAcesso mensagem={`Esta tela é do módulo ${NOME_MODULO[r.modulo]}. Seu usuário opera ${meus || 'nenhum módulo'}.`} />
  }
  const papel = perfil.papel ? NOME_PAPEL[perfil.papel] : 'sem perfil definido'
  const quem = r.nivel === 'admin' ? 'administradores' : r.nivel === 'gestao' ? 'gestores e administradores' : 'a equipe da Farmácia e do Almoxarifado'
  return <SemAcesso mensagem={`Esta tela é só para ${quem}. Seu perfil: ${papel}.`} />
}
