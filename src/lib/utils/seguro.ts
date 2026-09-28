// =============================================================================
// Utilitarios compartilhados pela correcao da auditoria de 28/09/2026.
// Use estes em vez de reinventar em cada tela:
//   - datas 'YYYY-MM-DD' sem deslocar um dia (UTC x America/Bahia)
//   - "hoje" no fuso local (toISOString() vira amanha depois das 21h)
//   - termo de busca seguro para .or(...ilike...) do PostgREST (virgula,
//     parenteses e aspas quebravam a busca: 400 PGRST100)
//   - quantidade digitada: vazio fica vazio, virgula aceita, inteiro validado
//   - update/delete que o banco recusou por RLS (volta 0 linhas sem erro)
// =============================================================================

/** Data de hoje no fuso do navegador, 'YYYY-MM-DD'. */
export function hojeLocal(d: Date = new Date()): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${dd}`
}

/**
 * Converte 'YYYY-MM-DD' (coluna date) em Date local, sem o deslocamento de
 * new Date('YYYY-MM-DD') (que e meia-noite UTC = dia anterior em UTC-3).
 * Aceita tambem timestamps completos (esses ja tem hora/fuso).
 */
export function parseDataLocal(s: string | null | undefined): Date | null {
  if (!s) return null
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.trim())
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  const d = new Date(s)
  return isNaN(d.getTime()) ? null : d
}

/** 'YYYY-MM-DD' ou timestamp -> 'DD/MM/AAAA' (vazio vira '—'). */
export function dataBR(s: string | null | undefined): string {
  if (!s) return '—'
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.trim())
  if (m) return `${m[3]}/${m[2]}/${m[1]}`
  const d = new Date(s)
  return isNaN(d.getTime()) ? '—' : d.toLocaleDateString('pt-BR')
}

/** Inicio do dia local em ISO com fuso (para filtros >= em timestamptz). */
export function inicioDiaISO(data: string): string {
  return `${data}T00:00:00-03:00`
}

/** Fim do dia local em ISO com fuso (para filtros <= em timestamptz). */
export function fimDiaISO(data: string): string {
  return `${data}T23:59:59.999-03:00`
}

/**
 * Valor para usar dentro de .or('campo.ilike.<valor>,...') do PostgREST.
 * Envolve em aspas duplas (virgula e parenteses deixam de ser sintaxe) e
 * escapa aspas/barra. Ex.: .or(`name.ilike.${termoIlike(q)},code.ilike.${termoIlike(q)}`)
 */
export function termoIlike(q: string): string {
  const limpo = q.trim().replace(/[%*]/g, ' ')
  const escapado = limpo.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
  return `"%${escapado}%"`
}

/** Compara textos ignorando acento e maiusculas (busca no navegador). */
export function normalizarBusca(s: string | null | undefined): string {
  return (s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
}

/**
 * Le quantidade digitada. Guarde o valor do input como TEXTO no estado e
 * converta so ao validar/enviar. Retorna null se vazio ou invalido.
 * Aceita '1,5' quando inteiro=false.
 */
export function lerQuantidade(texto: string | number | null | undefined, opts: { inteiro?: boolean } = {}): number | null {
  const { inteiro = true } = opts
  if (texto === null || texto === undefined) return null
  const t = String(texto).trim().replace(/\s/g, '').replace(',', '.')
  if (t === '') return null
  const n = Number(t)
  if (!Number.isFinite(n)) return null
  if (inteiro && !Number.isInteger(n)) return null
  return n
}

/** Mensagem padrao para quantidade invalida. */
export function erroQuantidade(texto: string | number | null | undefined, opts: { inteiro?: boolean; min?: number } = {}): string | null {
  const { inteiro = true, min = 1 } = opts
  const n = lerQuantidade(texto, { inteiro })
  if (n === null) return inteiro ? 'Informe uma quantidade inteira (sem casas decimais).' : 'Informe uma quantidade valida.'
  if (n < min) return `A quantidade deve ser no minimo ${min}.`
  return null
}

/**
 * Para update/delete: o PostgREST devolve sucesso com 0 linhas quando a RLS
 * nega. Chame com .select('id') no final e passe o resultado aqui.
 *   const r = await supabase.from('x').update(v).eq('id', id).select('id')
 *   exigirLinhas(r)
 */
export function exigirLinhas<T>(r: { data: T[] | null; error: unknown }, msg = 'Nao foi possivel salvar: sem permissao ou registro nao encontrado.'): T[] {
  if (r.error) throw r.error
  if (!r.data || r.data.length === 0) throw new Error(msg)
  return r.data
}

/**
 * Busca todas as linhas de uma consulta paginando de 1000 em 1000
 * (PGRST_DB_MAX_ROWS=1000 corta em silencio). Recebe uma funcao que monta a
 * consulta com .range(de, ate).
 *   const linhas = await buscarTodas((de, ate) => supabase.from('v').select('*').order('id').range(de, ate))
 * A consulta PRECISA ter .order(...) estavel.
 */
export async function buscarTodas<T>(
  montar: (de: number, ate: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
  opts: { tamanho?: number; maximo?: number } = {},
): Promise<T[]> {
  const { tamanho = 1000, maximo = 200000 } = opts
  const todas: T[] = []
  for (let de = 0; de < maximo; de += tamanho) {
    const { data, error } = await montar(de, de + tamanho - 1)
    if (error) throw error
    const lote = data ?? []
    todas.push(...lote)
    if (lote.length < tamanho) break
  }
  return todas
}
