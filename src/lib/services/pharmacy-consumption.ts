import { supabase } from '../supabase'
import { format } from 'date-fns'
import { saveAs } from 'file-saver'
import * as XLSX from 'xlsx'

export interface PharmacyConsumptionEntry {
  id: string
  item_id: string
  department_id: string
  date: string
  quantity: number
  notes?: string
  created_by: string
  created_at: string
}

export interface PharmacyConsumptionData {
  id?: string
  item: {
    id: string
    name: string
    code: string
    category: string
    unit: string
    price?: number
  }
  department: {
    id: string
    name: string
    code: string
  }
  quantity: number
  date: string
  notes?: string
  created_by: string
  created_at: string
}

class PharmacyConsumptionService {
  private static instance: PharmacyConsumptionService
  
  private constructor() {}

  static getInstance(): PharmacyConsumptionService {
    if (!PharmacyConsumptionService.instance) {
      PharmacyConsumptionService.instance = new PharmacyConsumptionService()
    }
    return PharmacyConsumptionService.instance
  }

  async getAll(): Promise<PharmacyConsumptionData[]> {
    try {
      const { data, error } = await supabase
        .from('consumption_entries')
        .select(`
          *,
          item:pharmacy_items!consumption_entries_item_id_fkey(
            id,
            name,
            code,
            category,
            unit,
            price
          ),
          department:departments!consumption_entries_department_id_fkey(
            id,
            name,
            code
          ),
          created_by_user:users!consumption_entries_created_by_fkey(
            full_name
          )
        `)
        .order('created_at', { ascending: false })

      if (error) {
        console.error('Error fetching pharmacy consumption:', error)
        // Return empty array instead of throwing to prevent crashes
        return []
      }

      if (!data || !Array.isArray(data)) {
        console.warn('No consumption data found or invalid format')
        return []
      }

      return data.filter(entry => entry && entry.item && entry.department).map(entry => ({
        id: entry.id,
        item: entry.item,
        department: entry.department,
        quantity: entry.quantity,
        date: entry.date,
        notes: entry.notes,
        created_by: entry.created_by_user?.full_name || 'Sistema',
        created_at: entry.created_at
      }))
    } catch (error) {
      console.error('Error in getAll:', error)
      // Return empty array instead of throwing to prevent app crashes
      return []
    }
  }

  async create(data: {
    item_id: string
    department_id: string
    date: string
    quantity: number
    notes?: string
  }): Promise<PharmacyConsumptionEntry> {
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('User not authenticated')

      const { data: entry, error } = await supabase
        .from('consumption_entries')
        .insert({
          ...data,
          created_by: user.id
        })
        .select()
        .single()

      if (error) {
        console.error('Error creating pharmacy consumption entry:', error)
        throw error
      }

      return entry
    } catch (error) {
      console.error('Error in create:', error)
      throw error
    }
  }

  async delete(id: string): Promise<void> {
    try {
      const { error } = await supabase
        .from('consumption_entries')
        .delete()
        .eq('id', id)

      if (error) {
        console.error('Error deleting pharmacy consumption entry:', error)
        throw error
      }
    } catch (error) {
      console.error('Error in delete:', error)
      throw error
    }
  }

  async exportToCSV(entries: PharmacyConsumptionData[]): Promise<void> {
    try {
      const headers = ['Data', 'Item', 'Categoria', 'Departamento', 'Quantidade', 'Valor Unitário', 'Valor Total', 'Observações', 'Criado por']
      const rows = entries.map(entry => [
        entry.date,
        entry.item.name,
        entry.item.category,
        entry.department.name,
        entry.quantity.toString(),
        (entry.item.price || 0).toFixed(2),
        ((entry.item.price || 0) * entry.quantity).toFixed(2),
        entry.notes || '',
        entry.created_by
      ])

      const csvContent = [
        headers.join(','),
        ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
      ].join('\n')

      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
      saveAs(blob, `consumo_farmacia_${format(new Date(), 'dd-MM-yyyy')}.csv`)
    } catch (error) {
      console.error('Error exporting to CSV:', error)
      throw error
    }
  }

  async exportToExcel(entries: PharmacyConsumptionData[]): Promise<void> {
    try {
      const wb = XLSX.utils.book_new()
      
      const headers = ['Data', 'Item', 'Código', 'Categoria', 'Departamento', 'Quantidade', 'Unidade', 'Valor Unitário', 'Valor Total', 'Observações', 'Criado por', 'Data de Criação']
      const rows = entries.map(entry => [
        entry.date,
        entry.item.name,
        entry.item.code,
        entry.item.category,
        entry.department.name,
        entry.quantity,
        entry.item.unit,
        entry.item.price || 0,
        (entry.item.price || 0) * entry.quantity,
        entry.notes || '',
        entry.created_by,
        format(new Date(entry.created_at), 'dd/MM/yyyy HH:mm')
      ])

      const ws = XLSX.utils.aoa_to_sheet([headers, ...rows])
      
      // Set column widths
      const colWidths = [
        { wch: 12 }, // Data
        { wch: 40 }, // Item
        { wch: 20 }, // Código
        { wch: 25 }, // Categoria
        { wch: 25 }, // Departamento
        { wch: 12 }, // Quantidade
        { wch: 10 }, // Unidade
        { wch: 15 }, // Valor Unitário
        { wch: 15 }, // Valor Total
        { wch: 30 }, // Observações
        { wch: 25 }, // Criado por
        { wch: 20 }, // Data de Criação
      ]
      ws['!cols'] = colWidths

      XLSX.utils.book_append_sheet(wb, ws, 'Consumo Farmácia')
      
      const excelBuffer = XLSX.write(wb, { 
        bookType: 'xlsx', 
        type: 'array',
        bookSST: false,
        compression: true
      })
      
      const blob = new Blob(
        [excelBuffer], 
        { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }
      )
      
      saveAs(blob, `consumo_farmacia_${format(new Date(), 'dd-MM-yyyy')}.xlsx`)
    } catch (error) {
      console.error('Error exporting to Excel:', error)
      throw error
    }
  }
}

export const pharmacyConsumptionService = PharmacyConsumptionService.getInstance()