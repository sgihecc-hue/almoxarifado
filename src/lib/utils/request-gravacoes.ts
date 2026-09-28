// =============================================================================
// Gravacoes pendentes dos itens de uma solicitacao (quantidade fornecida,
// lotes, observacao) feitas no blur pela tela de detalhe.
//
// Antes, "Aprovar"/"Marcar como Entregue" liam o banco enquanto a gravacao do
// ultimo campo ainda estava a caminho, e erro de gravacao era so console.
// Agora cada gravacao se registra aqui; as acoes chamam aguardarGravacoes()
// antes de seguir, e se alguma falhou a acao para com a mensagem.
// =============================================================================

const pendentes = new Set<Promise<unknown>>()
let ultimoErro: string | null = null

export function registrarGravacao<T>(p: Promise<T>): Promise<T> {
  pendentes.add(p)
  p.then(
    () => { pendentes.delete(p) },
    (e) => {
      pendentes.delete(p)
      ultimoErro = e instanceof Error ? e.message : 'Falha ao gravar um item.'
    },
  )
  return p
}

/** Espera tudo que esta sendo gravado. Lanca erro se alguma gravacao falhou. */
export async function aguardarGravacoes(): Promise<void> {
  while (pendentes.size > 0) {
    await Promise.allSettled([...pendentes])
  }
  if (ultimoErro) {
    const msg = ultimoErro
    ultimoErro = null
    throw new Error(`Um campo do pedido não foi gravado (${msg}). Confira os itens e tente de novo.`)
  }
}
