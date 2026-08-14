// =====================================================================
// Cadastro de Fornecedores — CRUD simples (nome + CNPJ).
// Acesso: pharmacist, gestor, administrador, manager, admin.
// =====================================================================

import { useEffect, useState, useMemo } from 'react'
import { Building2, Plus, Edit2, Trash2, Search, Loader2, AlertCircle, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/contexts/auth'
import { useTheme } from '@/contexts/theme'
import { suppliersService, formatCNPJ } from '@/lib/services/farmacia-cadastros'
import type { Supplier } from '@/lib/types/farmacia'
import { getErrorMessage } from '@/lib/utils/error-messages'

const ALLOWED_ROLES = new Set([
  'admin', 'manager', 'administrador', 'gestor', 'pharmacist',
])

export function Fornecedores() {
  const { user } = useAuth()
  const { mode } = useTheme()
  const canManage = !!user?.role && ALLOWED_ROLES.has(user.role)

  const txt = mode === 'dark' ? '#fff' : '#0d2e1c'
  const txtSec = mode === 'dark' ? 'rgba(255,255,255,0.7)' : 'rgba(13,46,28,0.65)'
  const txtMut = mode === 'dark' ? 'rgba(255,255,255,0.45)' : 'rgba(13,46,28,0.45)'

  const card: React.CSSProperties = {
    background: mode === 'dark' ? 'rgba(10,15,20,0.55)' : 'rgba(255,255,255,0.65)',
    backdropFilter: 'blur(30px)', WebkitBackdropFilter: 'blur(30px)',
    border: `1px solid ${mode === 'dark' ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.5)'}`,
    borderRadius: 16,
  }
  const input: React.CSSProperties = {
    background: mode === 'dark' ? 'rgba(0,0,0,0.3)' : 'rgba(255,255,255,0.7)',
    border: `1px solid ${mode === 'dark' ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.1)'}`,
    borderRadius: 10, padding: '10px 14px', fontSize: 14,
    color: txt, outline: 'none', width: '100%',
  }

  const [rows, setRows] = useState<Supplier[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [error, setError] = useState('')

  // Form state
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<Supplier | null>(null)
  const [formName, setFormName] = useState('')
  const [formCnpj, setFormCnpj] = useState('')
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true); setError('')
    try {
      setRows(await suppliersService.list())
    } catch (e: any) { setError(getErrorMessage(e)) }
    finally { setLoading(false) }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return rows
    // BUG anterior: quando a busca era por NOME, `q.replace(/\D/g,'')` virava ''
    // e `cnpj.includes('')` era sempre true → a lista não filtrava nada. Agora
    // só cruza o CNPJ quando o usuário digitou dígitos.
    const digits = q.replace(/\D/g, '')
    return rows.filter(r =>
      r.name.toLowerCase().includes(q) || (digits.length > 0 && r.cnpj.includes(digits))
    )
  }, [rows, search])

  function openNew() {
    setEditing(null); setFormName(''); setFormCnpj(''); setFormError(''); setShowForm(true)
  }
  function openEdit(s: Supplier) {
    setEditing(s); setFormName(s.name); setFormCnpj(s.cnpj); setFormError(''); setShowForm(true)
  }

  async function save() {
    setSaving(true); setFormError('')
    try {
      if (editing) await suppliersService.update(editing.id, { name: formName, cnpj: formCnpj })
      else await suppliersService.create({ name: formName, cnpj: formCnpj })
      setShowForm(false); await load()
    } catch (e: any) { setFormError(getErrorMessage(e)) }
    finally { setSaving(false) }
  }

  async function remove(s: Supplier) {
    if (!confirm(`Desativar fornecedor "${s.name}"?`)) return
    try { await suppliersService.deactivate(s.id); await load() }
    catch (e: any) { setError(getErrorMessage(e)) }
  }

  // CNPJ mask
  function onCnpjChange(v: string) {
    const d = v.replace(/\D/g, '').slice(0, 14)
    let out = d
    if (d.length > 2) out = d.slice(0, 2) + '.' + d.slice(2)
    if (d.length > 5) out = out.slice(0, 6) + '.' + d.slice(5)
    if (d.length > 8) out = out.slice(0, 10) + '/' + d.slice(8)
    if (d.length > 12) out = out.slice(0, 15) + '-' + d.slice(12)
    setFormCnpj(out)
  }

  if (!canManage) {
    return (
      <div className="max-w-3xl mx-auto p-6">
        <div className="p-6" style={card}>
          <h1 className="text-xl font-semibold" style={{ color: txt }}>Sem permissão</h1>
          <p className="text-sm mt-2" style={{ color: txtSec }}>
            Apenas a coordenação/farmacêutico podem cadastrar fornecedores.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="p-3 rounded-lg bg-blue-100"><Building2 className="w-6 h-6 text-blue-600" /></div>
          <div>
            <h1 className="text-2xl font-bold" style={{ color: txt }}>Fornecedores</h1>
            <p className="text-sm" style={{ color: txtSec }}>Cadastro de fornecedores de medicamentos</p>
          </div>
        </div>
        <Button onClick={openNew} className="bg-emerald-600 hover:bg-emerald-700 text-white">
          <Plus className="w-4 h-4 mr-2" /> Novo Fornecedor
        </Button>
      </div>

      {error && (
        <div className="p-3 rounded-lg bg-red-100 border border-red-200 text-red-800 text-sm flex items-center gap-2">
          <AlertCircle size={16} /> {error}
        </div>
      )}

      <div className="p-4" style={card}>
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: txtMut }} />
          <input placeholder="Buscar por nome ou CNPJ..." value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ ...input, paddingLeft: 36 }} />
        </div>
      </div>

      <div className="p-2" style={card}>
        {loading ? (
          <div className="flex items-center justify-center p-8" style={{ color: txtMut }}>
            <Loader2 className="w-5 h-5 animate-spin mr-2" /> Carregando...
          </div>
        ) : filtered.length === 0 ? (
          <p className="p-6 text-sm text-center" style={{ color: txtMut }}>
            Nenhum fornecedor cadastrado.
          </p>
        ) : (
          <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr style={{ background: mode === 'dark' ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)' }}>
                <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wide" style={{ color: txtSec }}>Nome</th>
                <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wide" style={{ color: txtSec }}>CNPJ</th>
                <th className="text-right px-4 py-3 text-xs font-semibold uppercase tracking-wide" style={{ color: txtSec }}>Ações</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((s) => (
                <tr key={s.id} style={{ borderTop: `1px solid ${mode === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)'}` }}>
                  <td className="px-4 py-3 text-sm font-medium" style={{ color: txt }}>{s.name}</td>
                  <td className="px-4 py-3 text-sm" style={{ color: txtSec }}>{formatCNPJ(s.cnpj)}</td>
                  <td className="px-4 py-3 text-right">
                    <Button variant="outline" size="sm" onClick={() => openEdit(s)} className="h-8 px-2 mr-1">
                      <Edit2 size={14} />
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => remove(s)} className="h-8 px-2 text-red-600 border-red-200 hover:bg-red-50">
                      <Trash2 size={14} />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </div>

      {/* Modal Form */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.5)' }}>
          <div className="w-full max-w-md p-6 space-y-4" style={card}>
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold" style={{ color: txt }}>
                {editing ? 'Editar Fornecedor' : 'Novo Fornecedor'}
              </h2>
              <button onClick={() => setShowForm(false)} style={{ color: txtMut }}><X size={18} /></button>
            </div>
            {formError && (
              <div className="p-2 rounded bg-red-100 border border-red-200 text-red-800 text-sm">{formError}</div>
            )}
            <div>
              <label className="text-xs font-semibold uppercase tracking-wide" style={{ color: txtSec }}>Nome *</label>
              <input value={formName} onChange={(e) => setFormName(e.target.value)} style={input} placeholder="Razão social" />
            </div>
            <div>
              <label className="text-xs font-semibold uppercase tracking-wide" style={{ color: txtSec }}>CNPJ *</label>
              <input value={formCnpj} onChange={(e) => onCnpjChange(e.target.value)} style={input} placeholder="00.000.000/0000-00" />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setShowForm(false)}>Cancelar</Button>
              <Button onClick={save} disabled={saving} className="bg-emerald-600 hover:bg-emerald-700 text-white">
                {saving && <Loader2 size={14} className="mr-2 animate-spin" />}Salvar
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
