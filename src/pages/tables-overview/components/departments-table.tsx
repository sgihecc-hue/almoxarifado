import { useState, useEffect } from 'react'
import {
  Building2, Search, Download, Plus,
  Pencil, Trash2, Loader2, ArrowUpDown,
  Calendar
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { departmentsService } from '@/lib/services/departments'
import { NewDepartmentDialog } from './new-department-dialog'
import { EditDepartmentDialog } from './edit-department-dialog'
import { DeleteDepartmentDialog } from './delete-department-dialog'
import type { Department } from '@/lib/types/departments'

export function DepartmentsTable() {
  const [departments, setDepartments] = useState<Department[]>([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [showNewDialog, setShowNewDialog] = useState(false)
  const [selectedDepartment, setSelectedDepartment] = useState<Department | null>(null)
  const [showEditDialog, setShowEditDialog] = useState(false)
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)

  useEffect(() => {
    loadDepartments()
  }, [])

  async function loadDepartments() {
    try {
      setLoading(true)
      const data = await departmentsService.getAll()
      setDepartments(data)
    } catch (error) {
      console.error('Error loading departments:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleExport = async () => {
    try {
      const csvContent = await departmentsService.exportToCSV(departments)
      
      // Create blob and download
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
      const link = document.createElement('a')
      const url = URL.createObjectURL(blob)
      
      link.setAttribute('href', url)
      link.setAttribute('download', `setores_${format(new Date(), 'dd-MM-yyyy')}.csv`)
      link.style.visibility = 'hidden'
      
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
    } catch (error) {
      console.error('Error exporting departments:', error)
    }
  }

  const filteredDepartments = departments.filter(department => {
    return searchTerm === '' ||
      department.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      department.description?.toLowerCase().includes(searchTerm.toLowerCase())
  })

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <Loader2 className="w-8 h-8 text-primary-500 animate-spin mx-auto mb-4" />
          <p className="text-gray-500">Carregando setores...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-blue-100 rounded-lg">
              <Building2 className="w-6 h-6 text-blue-600" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Setores</h1>
              <p className="text-sm text-gray-500 mt-1">
                Gerencie os setores e departamentos do hospital
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button 
              variant="outline" 
              size="sm"
              onClick={handleExport}
            >
              <Download className="w-4 h-4 mr-2" />
              Exportar
            </Button>
            <Button 
              className="bg-primary-500 hover:bg-primary-600 text-white"
              onClick={() => setShowNewDialog(true)}
            >
              <Plus className="w-4 h-4 mr-2" />
              Novo Setor
            </Button>
          </div>
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="w-4 h-4 absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" />
          <Input
            placeholder="Buscar por nome ou descrição..."
            className="pl-9"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
      </div>

      {/* Departments List */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100">
        <div className="p-6 border-b border-gray-100">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">
                Lista de Setores
              </h2>
              <p className="text-sm text-gray-500 mt-1">
                {filteredDepartments.length} setores encontrados
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm">
                <ArrowUpDown className="w-4 h-4 mr-2" />
                Ordenar
              </Button>
            </div>
          </div>
        </div>

        <div className="divide-y divide-gray-100">
          {filteredDepartments.length > 0 ? (
            filteredDepartments.map((department) => (
              <div 
                key={department.id} 
                className="p-6 hover:bg-gray-50 transition-colors"
              >
                <div className="flex items-center justify-between">
                  <div className="space-y-1">
                    <h3 className="font-medium text-gray-900">{department.name}</h3>
                    {department.description && (
                      <p className="text-sm text-gray-500">{department.description}</p>
                    )}
                    <div className="flex items-center gap-2 text-gray-500">
                      <Calendar className="w-4 h-4" />
                      <span className="text-sm">
                        Criado em {format(new Date(department.created_at), "dd 'de' MMMM 'de' yyyy", {
                          locale: ptBR,
                        })}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <Button 
                      variant="outline" 
                      size="sm"
                      onClick={() => {
                        setSelectedDepartment(department)
                        setShowEditDialog(true)
                      }}
                    >
                      <Pencil className="w-4 h-4 mr-2" />
                      Editar
                    </Button>
                    <Button 
                      variant="outline" 
                      size="sm"
                      className="text-red-500 hover:text-red-600"
                      onClick={() => {
                        setSelectedDepartment(department)
                        setShowDeleteDialog(true)
                      }}
                    >
                      <Trash2 className="w-4 h-4 mr-2" />
                      Excluir
                    </Button>
                  </div>
                </div>
              </div>
            ))
          ) : (
            <div className="p-8 text-center">
              <p className="text-gray-500">Nenhum setor encontrado</p>
            </div>
          )}
        </div>
      </div>

      {/* Dialogs */}
      <NewDepartmentDialog
        open={showNewDialog}
        onOpenChange={setShowNewDialog}
        onSuccess={loadDepartments}
      />

      {selectedDepartment && (
        <>
          <EditDepartmentDialog
            department={selectedDepartment}
            open={showEditDialog}
            onOpenChange={setShowEditDialog}
            onSuccess={loadDepartments}
          />

          <DeleteDepartmentDialog
            department={selectedDepartment}
            open={showDeleteDialog}
            onOpenChange={setShowDeleteDialog}
            onSuccess={loadDepartments}
          />
        </>
      )}
    </div>
  )
}