/**
 * Periodo das listas de solicitacoes. endDate = null significa "ate agora,
 * sem limite": antes o fim era fixado no instante em que a tela abria, e
 * pedido criado depois disso nao aparecia ate recarregar a pagina.
 * Quando o usuario escolhe um periodo, endDate vem como fim do dia escolhido.
 */
export interface PeriodoLista {
  startDate: Date
  endDate: Date | null
}

export function isWithinPeriod(date: string | Date, startDate: Date, endDate: Date | null): boolean {
  const checkDate = new Date(date)
  if (checkDate < startDate) return false
  return endDate === null || checkDate <= endDate
}

export function getDefaultDateRange(): PeriodoLista {
  const startDate = new Date()
  startDate.setDate(startDate.getDate() - 30) // Default to last 30 days
  startDate.setHours(0, 0, 0, 0)
  return { startDate, endDate: null }
}
