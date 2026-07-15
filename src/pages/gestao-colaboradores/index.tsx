import { useState, useEffect, useMemo } from 'react'
import { Search, Loader2, AlertCircle, CheckCircle2, Users, Pill, Building2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAuth } from '@/contexts/auth'
import { usersService } from '@/lib/services/users'
import { departmentsService } from '@/lib/services/departments'
import { supabase } from '@/lib/supabase'
import { getErrorMessage } from '@/lib/utils/error-messages'
import { UserRoleBadge } from '../users/components/user-role-badge'
import type { User } from '@/lib/types'
import type { Department } from '@/lib/types/departments'

const GESTOR_ROLES = new Set(['gestor', 'administrador'])

// Papéis que o gestor pode atribuir (não inclui gestor/administrador).
const ASSIGNABLE_ROLES: Array<{ value: string; label: string }> = [
  { value: 'solicitante', label: 'Solicitante' },
  { value: 'atendente', label: 'Atendente' },
  { value: 'pharmacist', label: 'Farmacêutico' },
]

// Setor de farmácia = CAF ou "Farmácia Satélite ...". Usa prefixo ASCII
// ("Farm"/"CAF") para não depender de acento.
function isPharmacyDept(name: string) {
  return name.startsWith('CAF') || name.startsWith('Farm')
}

export function GestaoColaboradores() {
  const { user } = useAuth()
  const canUse = !!user?.role && GESTOR_ROLES.has(user.role)

  const [users, setUsers] = useState<User[]>([])
  const [departments, setDepartments] = useState<Department[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<User | null>(null)
  const [editRole, setEditRole] = useState<string>('solicitante')
  const [editDept, setEditDept] = useState<string>('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const load = async () => {
    setLoading(true)
    try {
      const [u, d] = await Promise.all([usersService.getAll(), departmentsService.getAll()])
      setUsers(u)
      setDepartments(d)
    } catch (e: any) {
      setError(getErrorMessage(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (canUse) load()
  }, [canUse])

  const pharmacyDepartments = useMemo(
    () => departments.filter((d) => isPharmacyDept(d.name)),
    [departments]
  )

  // Colaboradores editáveis: exclui administradores e gestores.
  const editable = useMemo(
    () => users.filter((u) => u.role !== 'administrador' && u.role !== 'gestor'),
    [users]
  )

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase()
    if (!term) return editable.slice(0, 50)
    return editable
      .filter((u) =>
        u.full_name?.toLowerCase().includes(term) ||
        u.email?.toLowerCase().includes(term) ||
        (u.department?.name || '').toLowerCase().includes(term)
      )
      .slice(0, 50)
  }, [editable, search])

  const openEdit = (u: User) => {
    setSelected(u)
    setEditRole(['solicitante', 'atendente', 'pharmacist'].includes(u.role) ? u.role : 'solicitante')
    setEditDept(u.department_id || '')
    setError(null)
    setSuccess(null)
  }

  const handleSave = async () => {
    if (!selected) return
    setError(null)
    if (!editDept) { setError('Selecione o setor de farmácia.'); return }
    try {
      setSaving(true)
      const { data, error: rpcError } = await supabase.rpc('gestor_atualizar_colaborador', {
        p_user_id: selected.id,
        p_role: editRole,
        p_department_id: editDept,
      })
      if (rpcError) throw rpcError
      const res = data as { success?: boolean; error?: string } | null
      if (!res?.success) throw new Error(res?.error || 'Falha ao salvar')
      setSuccess(`${selected.full_name} atualizado com sucesso.`)
      setSelected(null)
      await load()
      setTimeout(() => setSuccess(null), 4000)
    } catch (e: any) {
      setError(getErrorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  if (!canUse) {
    return (
      <div className="max-w-2xl mx-auto p-6">
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
          <h1 className="text-xl font-semibold text-gray-900">Sem permissão</h1>
          <p className="text-sm text-gray-500 mt-2">
            Apenas a coordenação (gestor) pode gerenciar colaboradores.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <div className="p-3 bg-blue-100 rounded-lg">
          <Users className="w-6 h-6 text-blue-600" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Colaboradores da Farmácia</h1>
          <p className="text-sm text-gray-500">
            Encontre um colaborador para ajustar o setor e o nível de acesso (Solicitante, Atendente ou Farmacêutico).
          </p>
        </div>
      </div>

      {success && (
        <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 flex items-center gap-2 text-emerald-800 text-sm">
          <CheckCircle2 className="w-5 h-5" /> {success}
        </div>
      )}

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
        <div className="relative">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <Input
            placeholder="Buscar colaborador por nome, e-mail ou setor..."
            className="pl-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        {loading ? (
          <div className="text-center py-12 text-gray-500">
            <Loader2 className="w-6 h-6 animate-spin inline-block mr-2" /> Carregando...
          </div>
        ) : filtered.length === 0 ? (
          <p className="text-sm text-gray-500 text-center py-10">Nenhum colaborador encontrado.</p>
        ) : (
          <div className="divide-y divide-gray-100">
            {filtered.map((u) => (
              <div key={u.id} className="px-5 py-3 flex items-center justify-between gap-3 hover:bg-gray-50">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">{u.full_name}</p>
                  <p className="text-xs text-gray-500 truncate">
                    {u.department?.name || 'Sem setor'}
                  </p>
                </div>
                <div className="flex items-center gap-3 flex-shrink-0">
                  <UserRoleBadge role={u.role} />
                  <Button variant="outline" size="sm" onClick={() => openEdit(u)}>Editar</Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Painel de edição */}
      {selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => !saving && setSelected(null)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6 space-y-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">{selected.full_name}</h2>
                <p className="text-sm text-gray-500">{selected.email}</p>
              </div>
              <button onClick={() => !saving && setSelected(null)} className="text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div>
              <Label className="flex items-center gap-1"><Pill className="w-4 h-4" /> Nível de acesso</Label>
              <select
                value={editRole}
                onChange={(e) => setEditRole(e.target.value)}
                className="mt-1 w-full rounded-md border border-input bg-white px-3 py-2 text-sm"
              >
                {ASSIGNABLE_ROLES.map((r) => (
                  <option key={r.value} value={r.value}>{r.label}</option>
                ))}
              </select>
              <p className="text-xs text-gray-400 mt-1">
                Farmacêutico tem acesso a dispensações, devoluções e operações de estoque da farmácia.
              </p>
            </div>

            <div>
              <Label className="flex items-center gap-1"><Building2 className="w-4 h-4" /> Setor de farmácia</Label>
              <select
                value={editDept}
                onChange={(e) => setEditDept(e.target.value)}
                className="mt-1 w-full rounded-md border border-input bg-white px-3 py-2 text-sm"
              >
                <option value="">Selecione o setor...</option>
                {pharmacyDepartments.map((d) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
            </div>

            {error && (
              <div className="p-3 rounded-lg bg-red-50 border border-red-200 flex items-center gap-2 text-sm text-red-700">
                <AlertCircle className="w-4 h-4 flex-shrink-0" /> {error}
              </div>
            )}

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setSelected(null)} disabled={saving}>Cancelar</Button>
              <Button
                onClick={handleSave}
                disabled={saving || !editDept}
                className="bg-blue-600 hover:bg-blue-700 text-white"
              >
                {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Salvar
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
