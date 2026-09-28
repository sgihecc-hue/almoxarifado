// =============================================================================
// MAPA ÚNICO DE PERMISSÕES POR PAPEL E MÓDULO (auditoria 28/09/2026, X-07/X-08)
//
// Uma fonte só para as duas perguntas:
//   1. o item aparece no MENU?           (components/sidebar.tsx)
//   2. a ROTA pode ser aberta pela URL?  (components/guarda-acesso.tsx)
// Antes o menu escondia telas, mas qualquer um abria a URL direto (atendente do
// almoxarifado abria /farmacia/dispensacao/new), e o menu mostrava botões que o
// banco recusava (Unidades Internas para atendente/farmacêutico).
//
// Módulo do usuário = SETOR dele (departments):
//   - "Almoxarifado"                          -> almoxarifado
//   - CAF ou uma Farmácia Satélite            -> farmacia
//   - qualquer outro setor / sem setor        -> nenhum
// Papéis:
//   - administrador: os dois módulos, tudo.
//   - gestor: lotado em farmácia => só farmácia; outro setor => os dois.
//   - pharmacist (farmacêutico): sempre farmácia.
//   - atendente: SÓ o módulo do setor. Sem setor de farmácia/almox => nenhum
//     (vê só as telas de todos e recebe o aviso "procure o administrador").
//   - solicitante: só as telas de todos (pedir material, perfil...).
//
// O espelho no banco é public.fn_user_module() / fn_user_pode_modulo(text)
// (migration 20260928150000). Mudou a regra aqui? Mude lá também.
// =============================================================================

import { PHARMACY_STOCKS, departmentBelongsToStock } from '@/lib/constants/stock-locations'

export type Papel = 'solicitante' | 'atendente' | 'pharmacist' | 'gestor' | 'administrador'
export type Modulo = 'farmacia' | 'almoxarifado'

export const NOME_PAPEL: Record<Papel, string> = {
  solicitante: 'Solicitante',
  atendente: 'Atendente',
  pharmacist: 'Farmacêutico',
  gestor: 'Gestor',
  administrador: 'Administrador',
}

export const NOME_MODULO: Record<Modulo, string> = {
  farmacia: 'Farmácia',
  almoxarifado: 'Almoxarifado',
}

/** Papel do banco -> papel canônico ('admin'/'manager' aparecem em código antigo). */
export function normalizarPapel(role?: string | null): Papel | null {
  switch ((role ?? '').trim().toLowerCase()) {
    case 'administrador':
    case 'admin':
      return 'administrador'
    case 'gestor':
    case 'manager':
      return 'gestor'
    case 'pharmacist':
    case 'farmaceutico':
      return 'pharmacist'
    case 'atendente':
      return 'atendente'
    case 'solicitante':
      return 'solicitante'
    default:
      return null
  }
}

/** Módulo a que o SETOR pertence (nome do departamento). */
export function moduloDoSetor(nomeSetor?: string | null): Modulo | null {
  const nome = (nomeSetor ?? '').trim().toLowerCase()
  if (!nome) return null
  if (nome === 'almoxarifado') return 'almoxarifado'
  if (PHARMACY_STOCKS.some((s) => departmentBelongsToStock(nomeSetor, s))) return 'farmacia'
  return null
}

export interface PerfilAcesso {
  papel: Papel | null
  /** Módulos que o usuário pode OPERAR. */
  modulos: Modulo[]
  /** Papel operacional (atendente) sem setor de farmácia/almoxarifado. */
  semSetor: boolean
}

export function montarPerfil(role: string | null | undefined, nomeSetor: string | null | undefined): PerfilAcesso {
  const papel = normalizarPapel(role)
  const doSetor = moduloDoSetor(nomeSetor)
  let modulos: Modulo[] = []
  switch (papel) {
    case 'administrador':
      modulos = ['farmacia', 'almoxarifado']
      break
    case 'gestor':
      modulos = doSetor === 'farmacia' ? ['farmacia'] : ['farmacia', 'almoxarifado']
      break
    case 'pharmacist':
      modulos = ['farmacia']
      break
    case 'atendente':
      modulos = doSetor ? [doSetor] : []
      break
    default:
      modulos = []
  }
  return { papel, modulos, semSetor: papel === 'atendente' && !doSetor }
}

// -----------------------------------------------------------------------------
// Regras por rota. A PRIMEIRA que casar vale (das mais específicas às gerais).
// Rota sem regra = liberada para qualquer usuário logado (e a 404 cuida do resto).
// -----------------------------------------------------------------------------

/** todos: qualquer logado | operador: atendente, farmacêutico, gestor, admin |
 *  gestao: gestor e admin | admin: só administrador */
export type NivelAcesso = 'todos' | 'operador' | 'gestao' | 'admin'

interface RegraRota {
  padrao: RegExp
  nivel: NivelAcesso
  /** Módulo exigido. 'prefixo' = tirado do começo da URL (/farmacia ou /almox);
   *  'tipo' = tirado do ?type=pharmacy|warehouse; sem nada = qualquer módulo do usuário. */
  modulo?: Modulo | 'prefixo' | 'tipo'
}

const PAPEIS_POR_NIVEL: Record<NivelAcesso, Papel[] | null> = {
  todos: null,
  operador: ['atendente', 'pharmacist', 'gestor', 'administrador'],
  gestao: ['gestor', 'administrador'],
  admin: ['administrador'],
}

const PFX = '(?:/farmacia|/almox)?'

export const REGRAS_ROTAS: RegraRota[] = [
  // --- telas de todos ---
  { padrao: /^\/$/, nivel: 'todos' },
  { padrao: /^\/(profile|profile\/advanced|settings)$/, nivel: 'todos' },
  { padrao: /^\/enfermagem\/novo-pedido$/, nivel: 'todos' },
  // Qualquer setor pede material e confirma o recebimento; atender é outra regra.
  { padrao: new RegExp(`^${PFX}/requests(/new|/receipt-confirmation)?$`), nivel: 'todos' },
  { padrao: new RegExp(`^${PFX}/requests/(inbox|processing|history|pending)$`), nivel: 'operador', modulo: 'prefixo' },
  { padrao: new RegExp(`^${PFX}/requests/[^/]+$`), nivel: 'todos' },
  // Devolução interna: o setor devolve o que sobrou (menu mostra para todos).
  { padrao: new RegExp(`^${PFX}/estoque/devolucao$`), nivel: 'todos' },

  // --- administração ---
  { padrao: /^\/users-advanced$/, nivel: 'admin' },
  { padrao: /^\/historico-global$/, nivel: 'admin' },
  { padrao: new RegExp(`^${PFX}/reports/pharmacy-admin-consumption$`), nivel: 'admin', modulo: 'farmacia' },
  { padrao: new RegExp(`^${PFX}/reports/warehouse-admin-consumption$`), nivel: 'admin', modulo: 'almoxarifado' },
  // Setores: INSERT/UPDATE em departments é só administrador/gestor no banco.
  { padrao: /^\/tables(\/departments)?$/, nivel: 'gestao' },
  // gestor_atualizar_colaborador só lota em setor de farmácia.
  { padrao: /^\/colaboradores$/, nivel: 'gestao', modulo: 'farmacia' },
  { padrao: /^\/farmacia\/kits$/, nivel: 'gestao', modulo: 'farmacia' },
  // Unidades Internas = tabela departments (mesma regra de Setores).
  { padrao: /^\/farmacia\/(cadastros\/)?unidades-internas$/, nivel: 'gestao', modulo: 'farmacia' },

  // --- farmácia ---
  { padrao: /^\/farmacia(\/|$)/, nivel: 'operador', modulo: 'farmacia' },
  { padrao: /^\/dispensacao(\/|$)/, nivel: 'operador', modulo: 'farmacia' },
  { padrao: /^\/inventory\/(pharmacy|stock)(\/|$)/, nivel: 'operador', modulo: 'farmacia' },
  { padrao: /^\/reports\/(pharmacy-|farmacia-|consumo-enfermagem)/, nivel: 'operador', modulo: 'farmacia' },

  // --- almoxarifado ---
  { padrao: /^\/(almox|almoxarifado|saida-direta)(\/|$)/, nivel: 'operador', modulo: 'almoxarifado' },
  { padrao: /^\/inventory\/warehouse(\/|$)/, nivel: 'operador', modulo: 'almoxarifado' },
  { padrao: /^\/reports\/warehouse-/, nivel: 'operador', modulo: 'almoxarifado' },

  // --- comuns aos dois módulos (o módulo vem do ?type= quando houver) ---
  { padrao: /^\/estoque\//, nivel: 'operador' },
  { padrao: /^\/reports\/(stock-expiry|movimentacoes)$/, nivel: 'operador', modulo: 'tipo' },
]

export type ResultadoAcesso =
  | { ok: true }
  | { ok: false; motivo: 'sem-setor' | 'sem-permissao'; nivel: NivelAcesso }
  | { ok: false; motivo: 'outro-modulo'; modulo: Modulo }

function moduloExigido(regra: RegraRota, pathname: string, search: string): Modulo | null {
  if (!regra.modulo) return null
  if (regra.modulo === 'prefixo') {
    if (pathname.startsWith('/farmacia/')) return 'farmacia'
    if (pathname.startsWith('/almox/')) return 'almoxarifado'
    return null
  }
  if (regra.modulo === 'tipo') {
    const tipo = new URLSearchParams(search).get('type')
    if (tipo === 'pharmacy') return 'farmacia'
    if (tipo === 'warehouse') return 'almoxarifado'
    return null
  }
  return regra.modulo
}

/**
 * O usuário pode abrir esta URL? Aceita href com query ('/reports/x?type=pharmacy').
 */
export function podeAcessar(perfil: PerfilAcesso, href: string): ResultadoAcesso {
  const q = href.indexOf('?')
  const pathname = (q >= 0 ? href.slice(0, q) : href).replace(/\/+$/, '') || '/'
  const search = q >= 0 ? href.slice(q) : ''
  const regra = REGRAS_ROTAS.find((r) => r.padrao.test(pathname))
  if (!regra || regra.nivel === 'todos') return { ok: true }

  const papeis = PAPEIS_POR_NIVEL[regra.nivel]
  if (!perfil.papel || (papeis && !papeis.includes(perfil.papel))) {
    return { ok: false, motivo: 'sem-permissao', nivel: regra.nivel }
  }
  if (perfil.modulos.length === 0) {
    return { ok: false, motivo: perfil.semSetor ? 'sem-setor' : 'sem-permissao', nivel: regra.nivel }
  }
  const mod = moduloExigido(regra, pathname, search)
  if (mod && !perfil.modulos.includes(mod)) {
    return { ok: false, motivo: 'outro-modulo', modulo: mod }
  }
  return { ok: true }
}
