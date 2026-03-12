import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import * as XLSX from 'xlsx'
import { saveAs } from 'file-saver'
import type { Request } from './requests'
import { formatRequestNumber } from '@/lib/utils/request'
import { getDepartmentName } from '@/lib/constants/departments'

class TemplatesService {
  private static instance: TemplatesService

  private constructor() {}

  static getInstance(): TemplatesService {
    if (!TemplatesService.instance) {
      TemplatesService.instance = new TemplatesService()
    }
    return TemplatesService.instance
  }

  async generateRequestTemplate(request: Request): Promise<void> {
    try {
      const wb = XLSX.utils.book_new()

      const headers = [
        'Item',
        'Código',
        'Nome',
        'Categoria',
        'Unidade',
        'Quantidade Solicitada',
        'Quantidade Aprovada',
        'Status'
      ]

      const rows = request.request_items.map((item, index) => [
        index + 1,
        item.item.code || '',
        item.item.name || '',
        item.item.category || '',
        'UN',
        item.quantity || 0,
        item.approved_quantity || '-',
        item.status === 'available' ? 'Disponível' : 'Estoque Baixo'
      ])

      const infoSection = [
        ['SOLICITAÇÃO DE MATERIAIS'],
        [],
        ['Número da Solicitação:', formatRequestNumber(request.id)],
        ['Data:', format(new Date(request.created_at), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })],
        ['Solicitante:', request.requester?.full_name || ''],
        ['Departamento:', getDepartmentName(request.department)],
        ['Tipo:', request.type === 'pharmacy' ? 'Farmácia' : 'Almoxarifado'],
        ['Prioridade:', request.priority === 'high' ? 'Alta' : request.priority === 'medium' ? 'Média' : 'Baixa'],
        ['Status:', this.translateStatus(request.status)],
        [],
        ['ITENS SOLICITADOS'],
        []
      ]

      const allData = [
        ...infoSection,
        headers,
        ...rows,
        [],
        ['Total de Itens:', request.request_items.length]
      ]

      const ws = XLSX.utils.aoa_to_sheet(allData)

      const colWidths = [
        { wch: 8 },
        { wch: 20 },
        { wch: 50 },
        { wch: 25 },
        { wch: 10 },
        { wch: 20 },
        { wch: 20 },
        { wch: 15 }
      ]
      ws['!cols'] = colWidths

      const merges = [
        { s: { r: 0, c: 0 }, e: { r: 0, c: 7 } }
      ]
      ws['!merges'] = merges

      XLSX.utils.book_append_sheet(wb, ws, 'Solicitação')

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

      const filename = `solicitacao_${formatRequestNumber(request.id)}_${format(new Date(), 'dd-MM-yyyy')}.xlsx`
      saveAs(blob, filename)
    } catch (error) {
      console.error('Error generating request template:', error)
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
}

export const templatesService = TemplatesService.getInstance()
