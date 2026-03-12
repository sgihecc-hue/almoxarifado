export function isWithinPeriod(date: string | Date, startDate: Date, endDate: Date): boolean {
  const checkDate = new Date(date)
  return checkDate >= startDate && checkDate <= endDate
}

export function getDefaultDateRange() {
  const endDate = new Date()
  const startDate = new Date()
  startDate.setDate(startDate.getDate() - 30) // Default to last 30 days
  
  return { startDate, endDate }
}