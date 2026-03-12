import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Loader2, Download, FileSpreadsheet, FileText } from 'lucide-react'
import { 
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { exportService } from '@/lib/services/export'
import type { Request } from '@/lib/services/requests'

const exportSchema = z.object({
  filename: z.string().min(1, 'Nome do arquivo é obrigatório'),
  format: z.enum(['csv', 'excel']),
  includeHeaders: z.boolean()
})

type ExportFormData = z.infer<typeof exportSchema>

interface ExportDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  requests: Request[]
  defaultFilename?: string
}

export function ExportDialog({ 
  open, 
  onOpenChange, 
  requests,
  defaultFilename = `solicitacoes_${new Date().toISOString().split('T')[0]}`
}: ExportDialogProps) {
  const [loading, setLoading] = useState(false)
  
  const { register, handleSubmit, formState: { errors } } = useForm<ExportFormData>({
    resolver: zodResolver(exportSchema),
    defaultValues: {
      filename: defaultFilename,
      format: 'csv',
      includeHeaders: true
    }
  })

  const onSubmit = async (data: ExportFormData) => {
    try {
      setLoading(true)
      await exportService.exportRequests(requests, {
        format: data.format,
        filename: `${data.filename}.${data.format}`,
        includeHeaders: data.includeHeaders
      })
      onOpenChange(false)
    } catch (error) {
      console.error('Error exporting data:', error)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Exportar Solicitações</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
          <div className="space-y-4">
            {/* Filename */}
            <div>
              <Label htmlFor="filename">Nome do Arquivo</Label>
              <Input
                id="filename"
                {...register('filename')}
                className="mt-1"
              />
              {errors.filename && (
                <p className="text-sm text-red-500 mt-1">{errors.filename.message}</p>
              )}
            </div>

            {/* Format Selection */}
            <div>
              <Label>Formato</Label>
              <div className="grid grid-cols-2 gap-4 mt-2">
                <div className="relative">
                  <input
                    type="radio"
                    {...register('format')}
                    value="csv"
                    id="format-csv"
                    className="peer sr-only"
                  />
                  <label
                    htmlFor="format-csv"
                    className="flex items-center justify-center gap-2 p-4 border-2 rounded-lg cursor-pointer peer-checked:border-primary-500 peer-checked:bg-primary-50 hover:bg-gray-50"
                  >
                    <FileText className="w-5 h-5" />
                    <span className="font-medium">CSV</span>
                  </label>
                </div>
                <div className="relative">
                  <input
                    type="radio"
                    {...register('format')}
                    value="excel"
                    id="format-excel"
                    className="peer sr-only"
                  />
                  <label
                    htmlFor="format-excel"
                    className="flex items-center justify-center gap-2 p-4 border-2 rounded-lg cursor-pointer peer-checked:border-primary-500 peer-checked:bg-primary-50 hover:bg-gray-50"
                  >
                    <FileSpreadsheet className="w-5 h-5" />
                    <span className="font-medium">Excel</span>
                  </label>
                </div>
              </div>
            </div>

            {/* Include Headers */}
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                {...register('includeHeaders')}
                id="includeHeaders"
                className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
              />
              <Label htmlFor="includeHeaders">
                Incluir cabeçalhos das colunas
              </Label>
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Exportando...
                </>
              ) : (
                <>
                  <Download className="w-4 h-4 mr-2" />
                  Exportar
                </>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}