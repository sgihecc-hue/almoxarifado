import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { saveAs } from 'file-saver'
import * as XLSX from 'xlsx'
import type { Request } from './requests'

interface ExportOptions {
  format: 'csv' | 'excel'
  filename?: string
  includeHeaders?: boolean
}

class ExportService {
  private static instance: ExportService
  private constructor() {}

  static getInstance(): ExportService {
    if (!ExportService.instance) {
      ExportService.instance = new ExportService()
    }
    return ExportService.instance
  }

  async exportRequests(requests: Request[], options: ExportOptions = { format: 'csv', includeHeaders: true }) {
    try {
      // Remove any existing extension from filename
      const baseFilename = options.filename?.replace(/\.[^/.]+$/, '') || 
        `solicitacoes_${format(new Date(), 'dd-MM-yyyy')}`
      
      // Add the correct extension based on format
      const extension = options.format === 'excel' ? '.xlsx' : '.csv'
      const filename = baseFilename + extension
      
      // Define headers
      const headers = [
        'Nº Solicitação',
        'Status',
        'Prioridade',
        'Tipo',
        'Departamento',
        'Solicitante',
        'Data de Criação',
        'Itens',
        'Quantidades',
        'Status dos Itens',
        'Quantidades Aprovadas',
        'Observações'
      ]

      // Format data rows
      const rows = requests.map(request => [
        request.id,
        this.translateStatus(request.status),
        this.translatePriority(request.priority),
        request.type === 'pharmacy' ? 'Farmácia' : 'Almoxarifado',
        request.department,
        request.requester?.full_name || '',
        format(new Date(request.created_at), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR }),
        request.request_items.map(item => item.item.name).join('; '),
        request.request_items.map(item => item.quantity).join('; '),
        request.request_items.map(item => item.status === 'available' ? 'Disponível' : 'Estoque baixo').join('; '),
        request.request_items.map(item => item.approved_quantity || '-').join('; '),
        request.comments.map(c => `${c.user}: ${c.text}`).join(' | ')
      ])

      const data = [
        ...(options.includeHeaders ? [headers] : []),
        ...rows
      ]

      if (options.format === 'excel') {
        // Create Excel workbook
        const wb = XLSX.utils.book_new()
        const ws = XLSX.utils.aoa_to_sheet(data)
        
        // Set column widths
        const colWidths = [
          { wch: 15 }, // Nº Solicitação
          { wch: 12 }, // Status
          { wch: 10 }, // Prioridade
          { wch: 12 }, // Tipo
          { wch: 20 }, // Departamento
          { wch: 25 }, // Solicitante
          { wch: 20 }, // Data de Criação
          { wch: 40 }, // Itens
          { wch: 15 }, // Quantidades
          { wch: 20 }, // Status dos Itens
          { wch: 20 }, // Quantidades Aprovadas
          { wch: 50 }, // Observações
        ]
        ws['!cols'] = colWidths

        XLSX.utils.book_append_sheet(wb, ws, 'Solicitações')
        
        // Generate Excel file
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
        
        saveAs(blob, filename)
      } else {
        // Create CSV content with UTF-8 BOM for Excel compatibility
        const csvContent = data.map(row => row.map(this.formatCell).join(',')).join('\n')
        const blob = new Blob(
          ['\ufeff' + csvContent], 
          { type: 'text/csv;charset=utf-8;' }
        )
        saveAs(blob, filename)
      }

      return true
    } catch (error) {
      console.error('Error exporting requests:', error)
      throw error
    }
  }

  private translateStatus(status: string): string {
    const statusMap: Record<string, string> = {
      'pending': 'Pendente',
      'approved': 'Aprovado',
      'rejected': 'Rejeitado',
      'processing': 'Em Processamento',
      'delivered': 'Entregue',
      'completed': 'Concluído',
      'cancelled': 'Cancelado'
    }
    return statusMap[status] || status
  }

  private translatePriority(priority: string): string {
    const priorityMap: Record<string, string> = {
      'low': 'Baixa',
      'medium': 'Média',
      'high': 'Alta'
    }
    return priorityMap[priority] || priority
  }

  private formatCell(value: any): string {
    if (value === null || value === undefined) {
      return ''
    }
    
    // Convert to string and escape special characters
    let stringValue: string
    try {
      stringValue = String(value)
    } catch (error) {
      console.error('Error converting value to string:', error)
      return ''
    }
    
    // Check if the value contains commas, quotes, or newlines
    if (/[,"\n\r]/.test(stringValue)) {
      // Escape quotes by doubling them and wrap in quotes
      return `"${stringValue.replace(/"/g, '""')}"`
    }
    
    return stringValue
  }
}

export const exportService = ExportService.getInstance()