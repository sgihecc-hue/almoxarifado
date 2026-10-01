// Registro INTERNO de erros (01/10/2026). Grava em public.app_erros todo erro
// mostrado ao usuário, para o suporte saber o que aconteceu quando alguém diz
// "tentei e deu erro". O usuário não vê nada disso. Nunca lança exceção.
import { supabase } from '@/lib/supabase'

type Tipo = 'mensagem' | 'tela' | 'navegador'

const recentes = new Map<string, number>()
const JANELA_MS = 15000 // mesma mensagem na mesma tela: grava uma vez a cada 15 s

function texto(v: unknown, max: number): string | null {
  if (v === null || v === undefined) return null
  const s = typeof v === 'string' ? v : (() => { try { return JSON.stringify(v) } catch { return String(v) } })()
  return s.slice(0, max)
}

export function registrarErro(erro: unknown, opts: { tipo?: Tipo; mensagemUsuario?: string; detalhe?: Record<string, unknown> } = {}) {
  try {
    const rota = typeof window !== 'undefined' ? window.location.pathname + window.location.search : null
    const e = erro as any
    const tecnica = texto(e?.message ?? e?.error_description ?? e, 4000)
    const chave = `${opts.tipo ?? 'mensagem'}|${rota}|${opts.mensagemUsuario ?? ''}|${tecnica ?? ''}`
    const agora = Date.now()
    const ultimo = recentes.get(chave)
    if (ultimo && agora - ultimo < JANELA_MS) return
    recentes.set(chave, agora)
    if (recentes.size > 200) recentes.clear()

    const linha = {
      tipo: opts.tipo ?? 'mensagem',
      rota: texto(rota, 500),
      mensagem_usuario: texto(opts.mensagemUsuario, 1000),
      mensagem_tecnica: tecnica,
      codigo: texto(e?.code, 100),
      detalhe: {
        ...(e?.details ? { details: texto(e.details, 1000) } : {}),
        ...(e?.hint ? { hint: texto(e.hint, 500) } : {}),
        ...(e?.stack ? { stack: texto(e.stack, 2000) } : {}),
        ...(opts.detalhe ?? {}),
      },
      navegador: typeof navigator !== 'undefined' ? texto(navigator.userAgent, 500) : null,
    }
    // Fire-and-forget: falha no registro nunca atrapalha a tela.
    void supabase.from('app_erros').insert(linha as any).then(() => undefined, () => undefined)
  } catch {
    /* nunca propaga */
  }
}
