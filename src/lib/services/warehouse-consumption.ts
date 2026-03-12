import { supabase } from '../supabase'
import { format } from 'date-fns'
import { saveAs } from 'file-saver'
import * as XLSX from 'xlsx'

export interface WarehouseConsumptionEntry {
  id: string
  item_id: string
  department_id: string
  date: string
  quantity: number
  notes?: string
  created_by: string
  created_at: string
}

export interface WarehouseConsumptionData {
  id: string
  item: {
    id: string
    name: string
    code: string
    category: string
    unit: string
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

class WarehouseConsumptionService {
  private static instance: WarehouseConsumptionService
  
  private constructor() {}

  static getInstance(): WarehouseConsumptionService {
    if (!WarehouseConsumptionService.instance) {
      WarehouseConsumptionService.instance = new WarehouseConsumptionService()
    }
    return WarehouseConsumptionService.instance
  }

  async getAll(): Promise<WarehouseConsumptionData[]> {
    try {
      const { data, error } = await supabase
        .from('warehouse_consumption_entries')
        .select(`
          *,
          item:warehouse_items!warehouse_consumption_entries_item_id_fkey(
            id,
            name,
            code,
            category,
            unit
          ),
          department:departments!warehouse_consumption_entries_department_id_fkey(
            id,
            name
          ),
          created_by_user:users!warehouse_consumption_entries_created_by_fkey(
            full_name
          )
        `)
        .order('created_at', { ascending: false })

      if (error) {
        if (error.code === 'PGRST205' || error.message?.includes('not find the table')) {
          console.warn('Table warehouse_consumption_entries does not exist yet')
          return []
        }
        console.error('Error fetching warehouse consumption:', error)
        throw error
      }

      return (data || []).map(entry => ({
        id: entry.id,
        item: entry.item,
        department: {
          ...entry.department,
          code: entry.department?.code || ''
        },
        quantity: entry.quantity,
        date: entry.date,
        notes: entry.notes,
        created_by: entry.created_by_user?.full_name || 'Sistema',
        created_at: entry.created_at
      }))
    } catch (error) {
      console.error('Error in getAll:', error)
      return []
    }
  }

  async create(data: {
    item_id: string
    department_id: string
    date: string
    quantity: number
    notes?: string
  }): Promise<WarehouseConsumptionEntry> {
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('User not authenticated')

      const { data: entry, error } = await supabase
        .from('warehouse_consumption_entries')
        .insert({
          ...data,
          created_by: user.id
        })
        .select()
        .single()

      if (error) {
        console.error('Error creating warehouse consumption entry:', error)
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
        .from('warehouse_consumption_entries')
        .delete()
        .eq('id', id)

      if (error) {
        console.error('Error deleting warehouse consumption entry:', error)
        throw error
      }
    } catch (error) {
      console.error('Error in delete:', error)
      throw error
    }
  }

  async exportToCSV(entries: WarehouseConsumptionData[]): Promise<void> {
    try {
      const headers = ['Data', 'Item', 'Categoria', 'Departamento', 'Quantidade', 'Observações', 'Criado por']
      const rows = entries.map(entry => [
        entry.date,
        entry.item.name,
        entry.item.category,
        entry.department.name,
        entry.quantity.toString(),
        entry.notes || '',
        entry.created_by
      ])

      const csvContent = [
        headers.join(','),
        ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
      ].join('\n')

      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
      saveAs(blob, `consumo_almoxarifado_${format(new Date(), 'dd-MM-yyyy')}.csv`)
    } catch (error) {
      console.error('Error exporting to CSV:', error)
      throw error
    }
  }

  async exportToExcel(entries: WarehouseConsumptionData[]): Promise<void> {
    try {
      const wb = XLSX.utils.book_new()
      
      const headers = ['Data', 'Item', 'Código', 'Categoria', 'Departamento', 'Quantidade', 'Unidade', 'Observações', 'Criado por', 'Data de Criação']
      const rows = entries.map(entry => [
        entry.date,
        entry.item.name,
        entry.item.code,
        entry.item.category,
        entry.department.name,
        entry.quantity,
        entry.item.unit,
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
        { wch: 30 }, // Observações
        { wch: 25 }, // Criado por
        { wch: 20 }, // Data de Criação
      ]
      ws['!cols'] = colWidths

      XLSX.utils.book_append_sheet(wb, ws, 'Consumo Almoxarifado')
      
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
      
      saveAs(blob, `consumo_almoxarifado_${format(new Date(), 'dd-MM-yyyy')}.xlsx`)
    } catch (error) {
      console.error('Error exporting to Excel:', error)
      throw error
    }
  }
}

export const warehouseConsumptionService = WarehouseConsumptionService.getInstance()