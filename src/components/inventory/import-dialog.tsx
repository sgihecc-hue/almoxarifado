import { useState, useRef } from 'react'
import { 
  FileSpreadsheet, Upload, Download, 
  AlertTriangle, CheckCircle2, Loader2, X 
} from 'lucide-react'
import { 
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { itemsService } from '@/lib/services/items'
import type { ImportItemData } from '@/lib/services/items'

interface ImportDialogProps {
  type: 'pharmacy' | 'warehouse'
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess: () => void
}

export function ImportDialog({ type, open, onOpenChange, onSuccess }: ImportDialogProps) {
  const [file, setFile] = useState<File | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [results, setResults] = useState<{
    success: ImportItemData[]
    errors: { row: number; error: string }[]
    warnings: { row: number; warning: string }[]
    summary: {
      totalRows: number
      processedRows: number
      successfulInserts: number
      duplicatesSkipped: number
    }
  } | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0]
    if (selectedFile) {
      // Validate file type - check both extension and MIME type
      const validExtension = selectedFile.name.match(/\.(xlsx|xls)$/i);
      const validMimeType = selectedFile.type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' || 
                           selectedFile.type === 'application/vnd.ms-excel' ||
                           selectedFile.type === 'application/octet-stream'; // Some browsers use this for Excel files
      
      if (!validExtension && !validMimeType) {
        setError('Por favor, selecione um arquivo Excel (.xlsx ou .xls)')
        return
      }
      setFile(selectedFile)
      setError(null)
      setResults(null)
    }
  }

  const handleDownloadTemplate = async () => {
    try {
      setError(null)
      await itemsService.getTemplateWorkbook(type)
    } catch (error) {
      console.error('Error downloading template:', error)
      setError('Erro ao baixar modelo. Por favor, tente novamente.')
    }
  }

  const handleImport = async () => {
    if (!file) return

    try {
      setLoading(true)
      setError(null)
      try {
        const results = await itemsService.importFromExcel(file, type)
        setResults(results)
      
        if (results.success.length > 0) {
          onSuccess()
        }
      } catch (importError) {
        console.error('Error in import process:', importError)
        setError('Erro ao processar o arquivo. Verifique se o formato está correto e tente novamente.')
      }
    } catch (error) {
      console.error('Error importing items:', error)
      setError('Erro ao importar itens. Por favor, tente novamente.')
    } finally {
      setLoading(false)
    }
  }

  const resetForm = () => {
    setFile(null)
    setError(null)
    setResults(null)
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  return (
    <Dialog 
      open={open} 
      onOpenChange={(isOpen) => {
        if (!isOpen) resetForm()
        onOpenChange(isOpen)
      }}
    >
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle>Importar Itens</DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          {/* Template Download */}
          <div className="flex items-start gap-4 p-4 bg-blue-50 rounded-lg border border-blue-200">
            <FileSpreadsheet className="w-6 h-6 text-blue-500 mt-1" />
            <div className="flex-1">
              <h3 className="font-medium text-blue-900">Modelo de Importação</h3>
              <p className="text-sm text-blue-700 mt-1">
                Baixe o modelo de planilha e preencha com os dados dos itens que deseja importar.
                Certifique-se de seguir o formato correto para cada campo.
              </p>
              <div className="mt-2 text-xs text-blue-700">
                <p className="font-medium">Instruções importantes:</p>
                <ul className="list-disc pl-4 mt-1 space-y-1">
                  <li>Preencha todos os campos obrigatórios: Código, Nome, Unidade e Estoque Atual</li>
                  <li>Para unidades, use: Un (Unidade), Pc (Peça), Cx (Caixa), Fr (Frasco), Amp (Ampola), etc.</li>
                  <li>Para categorias de {type === 'pharmacy' ? 'Farmácia' : 'Almoxarifado'}, use: {
                    type === 'pharmacy' 
                      ? 'Medicamentos, Material Hospitalar' 
                      : 'Material de Escritório, Material de Limpeza, Equipamentos, Outros'
                  }</li>
                </ul>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={handleDownloadTemplate}
                className="mt-3"
              >
                <Download className="w-4 h-4 mr-2" />
                Baixar Modelo
              </Button>
            </div>
          </div>

          {/* File Upload */}
          <div className="space-y-4">
            <div className="flex items-center justify-center w-full">
              <label className="flex flex-col items-center justify-center w-full h-32 border-2 border-gray-300 border-dashed rounded-lg cursor-pointer bg-gray-50 hover:bg-gray-100" htmlFor="file-upload">
                <div className="flex flex-col items-center justify-center pt-5 pb-6">
                  <Upload className="w-8 h-8 mb-3 text-gray-400" />
                  <p className="mb-2 text-sm text-gray-500">
                    <span className="font-semibold">Clique para selecionar</span> um arquivo Excel
                  </p>
                  <p className="text-xs text-gray-500">
                    Formatos suportados: .xlsx, .xls
                  </p>
                </div>
                <input
                  id="file-upload"
                  ref={fileInputRef}
                  type="file"
                  accept=".xlsx,.xls"
                  className="hidden"
                  onChange={handleFileChange}
                />
              </label>
            </div>

            {file && (
              <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg border">
                <div className="flex items-center gap-3">
                  <FileSpreadsheet className="w-5 h-5 text-gray-500" />
                  <span className="text-sm font-medium text-gray-700">
                    {file.name}
                  </span>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setFile(null)
                    if (fileInputRef.current) {
                      fileInputRef.current.value = ''
                    }
                  }}
                >
                  <X className="w-4 h-4" />
                </Button>
              </div>
            )}

            {/* Error Message */}
            {error && (
              <div className="p-3 text-sm text-red-500 bg-red-50 rounded-md flex items-center gap-2">
                <AlertTriangle className="w-4 h-4" />
                {error}
              </div>
            )}

            {/* Import Results */}
            {results && (
              <div className="space-y-3">
                {/* Summary Information */}
                <div className="p-3 bg-blue-50 rounded-lg border border-blue-200">
                  <div className="text-sm text-blue-700">
                    <p><strong>Resumo da Importação:</strong></p>
                    <p>Total de linhas: {results.summary.totalRows}</p>
                    <p>Linhas processadas: {results.summary.processedRows}</p>
                    <p>Inserções bem-sucedidas: {results.summary.successfulInserts}</p>
                    <p>Duplicatas ignoradas: {results.summary.duplicatesSkipped}</p>
                  </div>
                </div>

                {results.success.length > 0 && (
                  <div className="p-3 bg-green-50 rounded-lg border border-green-200">
                    <div className="flex items-center gap-2 text-green-700">
                      <CheckCircle2 className="w-5 h-5" />
                      <p className="font-medium">
                        {results.success.length} itens importados com sucesso
                      </p>
                    </div>
                  </div>
                )}

                {results.warnings.length > 0 && (
                  <div className="p-3 bg-yellow-50 rounded-lg border border-yellow-200">
                    <div className="flex items-center gap-2 text-yellow-700 mb-2">
                      <AlertTriangle className="w-5 h-5 flex-shrink-0" />
                      <p className="font-medium">
                        {results.warnings.length} {results.warnings.length === 1 ? 'aviso encontrado' : 'avisos encontrados'}
                      </p>
                    </div>
                    <ul className="space-y-1 text-sm text-yellow-600 max-h-[150px] overflow-y-auto">
                      {results.warnings.map((warning, index) => (
                        <li key={index} className="border-l-2 border-yellow-300 pl-3 py-1">
                          Linha {warning.row}: {warning.warning}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {results.errors.length > 0 && (
                  <div className="p-3 bg-yellow-50 rounded-lg border border-yellow-200">
                    <div className="flex items-center gap-2 text-yellow-700 mb-2">
                      <AlertTriangle className="w-5 h-5 flex-shrink-0" />
                      <p className="font-medium">
                        {results.errors.length} {results.errors.length === 1 ? 'erro encontrado' : 'erros encontrados'} durante a importação
                      </p>
                    </div>
                    <ul className="space-y-1 text-sm text-yellow-600 max-h-[200px] overflow-y-auto">
                      {results.errors.map((error, index) => (
                        <li key={index} className="border-l-2 border-yellow-300 pl-3 py-1">
                          Linha {error.row}: {error.error}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button 
            onClick={handleImport}
            disabled={!file || loading}
            className="bg-primary-500 hover:bg-primary-600 text-white"
          >
            {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            {loading ? 'Importando...' : `Importar ${file ? 'Itens' : ''}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}