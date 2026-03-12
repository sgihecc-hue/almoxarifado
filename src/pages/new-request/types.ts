export type RequestType = 'pharmacy' | 'warehouse'

export type RequestDetails = {
  department: string
  priority: 'low' | 'medium' | 'high'
  justification_option: string
  requestDate: string
}

export type RequestItem = {
  id: string
  quantity: number
}