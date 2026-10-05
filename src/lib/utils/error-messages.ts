// Maps internal/backend error details to safe user-facing messages.
// NEVER expose raw error objects or stack traces to the UI.
import { registrarErro } from '@/lib/registro-erros'

const CODE_MAP: Record<string, string> = {
  '23505': 'Este registro já existe no sistema.',
  '23503': 'Operação inválida: registro referenciado em outro cadastro.',
  '23502': 'Campo obrigatório não preenchido.',
  '42501': 'Você não tem permissão para realizar esta operação.',
  'PGRST116': 'Registro não encontrado.',
  'PGRST301': 'Sessão expirada. Faça login novamente.',
}

const MESSAGE_PATTERNS: Array<[RegExp, string]> = [
  [/duplicate key|unique constraint/i, 'Este registro já existe no sistema.'],
  [/foreign key/i, 'Operação inválida: registro referenciado em outro cadastro.'],
  [/not.null constraint/i, 'Campo obrigatório não preenchido.'],
  [/check constraint/i, 'Valor inválido para o campo. Verifique os dados informados.'],
  [/permission denied|insufficient privilege/i, 'Você não tem permissão para realizar esta operação.'],
  [/jwt|token.*expired|pgrst301/i, 'Sessão expirada. Faça login novamente.'],
  [/not found|PGRST116/i, 'Registro não encontrado.'],
  [/network|fetch|conexão/i, 'Erro de conexão. Verifique sua internet e tente novamente.'],
  [/timeout/i, 'O servidor demorou muito para responder. Tente novamente.'],
]

// Mensagens vindas do próprio código (não do banco/framework) e que são
// seguras + úteis pro usuário. Se a mensagem for curta, em português, sem
// termos técnicos, mostra ela direto em vez do genérico "erro inesperado".
// Padrões que identificam mensagens técnicas (não devem vazar pro usuário).
// Cuidado: "error" bate com "Erro" em português case-insensitive — evitar.
const TECH_PATTERNS = /\bfailed\b|\bexception\b|supabase|postgres|pgrst|\bjwt\b|typeerror|referenceerror|syntaxerror|\bstack\b|\bat \w+\.\w+/i

// Mensagens longas mas escritas para o usuario (Modo Inventario do almox:
// bloqueio e fechamento recusado listam itens/datas e passam de 200 letras).
const PREFIXOS_LONGOS_OK = /^(Almoxarifado em inventário|Fechamento recusado)/

function isUserFriendly(msg: string): boolean {
  if (!msg) return false
  if (msg.length > (PREFIXOS_LONGOS_OK.test(msg.trim()) ? 600 : 200)) return false
  if (TECH_PATTERNS.test(msg)) return false
  // Aceita: começa com maiúscula ou letra latina, termina com '.' ou letra
  return /^[A-ZÁÉÍÓÚÂÊÔÃÕÇ]/.test(msg.trim())
}

export function getErrorMessage(error: unknown): string {
  const msg = traduzirErro(error)
  // Registro interno (app_erros): toda mensagem de erro mostrada ao usuario.
  registrarErro(error, { mensagemUsuario: msg })
  return msg
}

function traduzirErro(error: unknown): string {
  if (!error) return 'Erro desconhecido. Tente novamente.'

  // Always log full error server-side for debugging
  console.error('[SGI-HECC]', error)

  const code = (error as any)?.code as string | undefined
  if (code && CODE_MAP[code]) return CODE_MAP[code]

  const raw = (error as any)?.message ?? (error as any)?.error_description ?? ''

  for (const [pattern, msg] of MESSAGE_PATTERNS) {
    if (pattern.test(raw)) return msg
  }

  // Mensagens que os próprios services lançam (ex: 'CNPJ inválido.',
  // 'Nome é obrigatório.', 'Quantidade deve ser maior que zero.') devem
  // passar direto — engolir com o genérico atrapalha o usuário sem motivo.
  if (isUserFriendly(raw)) return raw

  return 'Ocorreu um erro inesperado. Se o problema persistir, contate o suporte.'
}
