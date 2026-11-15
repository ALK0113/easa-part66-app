import { useEffect, useState, useMemo } from 'react'
import { supabase } from '../lib/supabase.js'
import Icon from './Icon.jsx'
import Modal from './Modal.jsx'
import ImportUsers from './ImportUsers.jsx'
import { ROLES, ROLE_LABELS } from '../lib/roles.js'

const inputClass = 'input'
const buttonClass = 'btn-primary'

async function getFunctionErrorMessage(error, fallback) {
  try {
    const body = await error.context.json()
    if (body?.error) return body.error
  } catch {
    // sin cuerpo (por ejemplo, error de red o de CORS): se usa el mensaje genérico
  }
  return fallback
}

export default function ProfileManagement({ user }) {
  const isAdmin = user.role === ROLES.ADMIN
  // El supervisor solo gestiona alumnos y profesores; admin y supervisores se gestionan en Escuelas
  const canManage = (profile) => isAdmin || profile.role === ROLES.STUDENT || profile.role === ROLES.TEACHER
  const [profiles, setProfiles] = useState([])
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState('')
  const [editModalOpen, setEditModalOpen] = useState(false)
  const [addModalOpen, setAddModalOpen] = useState(false)
  const [editingProfile, setEditingProfile] = useState(null)
  const [formData, setFormData] = useState({
    full_name: '', email: '', phone: '', bio: '', role: 'alumno'
  })
  const [newUserEmail, setNewUserEmail] = useState('')
  const [newUserRole, setNewUserRole] = useState('alumno')
  // El admin elige la escuela del usuario nuevo; el supervisor siempre crea en la suya
  const [schools, setSchools] = useState([])
  const [newUserSchool, setNewUserSchool] = useState('')
  const [busy, setBusy] = useState(false)
  const [view, setView] = useState('list')
  
  // Nuevos estados para filtros y búsqueda
  const [search, setSearch] = useState('')
  const [filterRole, setFilterRole] = useState('')

  useEffect(() => {
    loadProfiles()
  }, [])

  useEffect(() => {
    if (!isAdmin) return
    supabase.from('schools').select('id,name').order('name').then(({ data }) => setSchools(data || []))
  }, [isAdmin])

  async function loadProfiles() {
    setLoading(true)
    const { data, error } = await supabase
      .from('profiles')
      .select('id, full_name, email, phone, bio, role, status, created_at')
      .order('full_name', { ascending: true })

    if (error) setMessage('Error al cargar perfiles: ' + error.message)
    else setProfiles(data || [])
    setLoading(false)
  }

  // Filtrado de perfiles
  const filteredProfiles = useMemo(() => {
    return profiles.filter(p => {
      const searchLower = search.toLowerCase()
      const matchSearch = !search || 
        (p.full_name && p.full_name.toLowerCase().includes(searchLower)) ||
        (p.email && p.email.toLowerCase().includes(searchLower)) ||
        (p.role && p.role.toLowerCase().includes(searchLower))
      
      const matchRole = !filterRole || (filterRole === 'pendiente' ? p.status === 'pendiente' : p.role === filterRole)
      
      return matchSearch && matchRole
    })
  }, [profiles, search, filterRole])

  function openEditModal(profile) {
    setEditingProfile(profile)
    setFormData({
      full_name: profile.full_name || '',
      email: profile.email || '',
      phone: profile.phone || '',
      bio: profile.bio || '',
      role: profile.role || 'alumno'
    })
    setEditModalOpen(true)
    setMessage('')
  }

  function openAddModal() {
    setFormData({ full_name: '', email: '', phone: '', bio: '', role: 'alumno' })
    setNewUserEmail('')
    setNewUserRole('alumno')
    setNewUserSchool(schools.length === 1 ? schools[0].id : '')
    setAddModalOpen(true)
    setMessage('')
  }

  async function saveProfile(event) {
    event.preventDefault()
    setBusy(true)

    let { error } = await supabase
      .from('profiles')
      .update({
        full_name: formData.full_name.trim(),
        phone: formData.phone.trim(),
        bio: formData.bio.trim(),
      })
      .eq('id', editingProfile.id)

    // El cambio de rol pasa por la función que limpia asignaciones y matrículas
    if (!error && formData.role !== editingProfile.role) {
      ;({ error } = formData.role === ROLES.ADMIN
        ? await supabase.from('profiles').update({ role: ROLES.ADMIN }).eq('id', editingProfile.id)
        : await supabase.rpc('admin_set_profile_role', { p_profile_id: editingProfile.id, p_role: formData.role }))
    }

    setBusy(false)
    if (error) {
      setMessage('❌ Error al guardar: ' + error.message)
    } else {
      setMessage('✅ Perfil actualizado correctamente.')
      setEditModalOpen(false)
      loadProfiles()
    }
  }

  async function addNewProfile(event) {
    event.preventDefault()
    setBusy(true)
    setMessage('')

    const { data: inviteData, error: inviteError } = await supabase.functions.invoke(
      'admin-create-user',
      {
        body: {
          email: newUserEmail.trim().toLowerCase(),
          full_name: formData.full_name.trim(),
          role: newUserRole,
          school_id: isAdmin ? newUserSchool : undefined,
        }
      }
    )

    if (inviteError) {
      const msg = await getFunctionErrorMessage(inviteError, 'No se pudo crear el usuario.')
      setBusy(false)
      setMessage('❌ ' + msg)
      return
    }

    const phone = formData.phone.trim()
    const bio = formData.bio.trim()
    let extraError = null

    if (phone || bio) {
      const { error } = await supabase
        .from('profiles')
        .update({ phone, bio })
        .eq('id', inviteData.user_id)
      extraError = error
    }

    setBusy(false)
    if (extraError) {
      setMessage('️ Invitación enviada, pero no se pudieron guardar teléfono y notas: ' + extraError.message)
    } else {
      setMessage(`✅ Invitación enviada a ${inviteData.email}. El usuario elegirá su contraseña desde el correo.`)
    }
    setAddModalOpen(false)
    loadProfiles()
  }

  async function deleteProfile(profile) {
    if (!window.confirm(`¿Eliminar permanentemente a ${profile.full_name || profile.email}?`)) return

    setBusy(true)
    setMessage('')

    const { error } = await supabase.functions.invoke('admin-delete-user', {
      body: { user_id: profile.id }
    })

    setBusy(false)
    if (error) {
      const msg = await getFunctionErrorMessage(error, 'No se pudo eliminar el usuario.')
      setMessage('❌ ' + msg)
    } else {
      setMessage('✅ Usuario eliminado correctamente.')
      loadProfiles()
    }
  }

  if (view === 'import') {
    return <ImportUsers schools={isAdmin ? schools : null} onBack={() => setView('list')} onImported={loadProfiles} />
  }

  if (loading) return <div className="flex min-h-[40vh] items-center justify-center text-sm text-muted">Cargando perfiles…</div>

  const isError = message.startsWith('❌')
  const messageText = message.replace(/^(❌|✅)\s*/, '')
  return (
    <div className="space-y-5">
      <div className="page-intro">
        <div>
          <h2>Perfiles</h2>
          <p>{profiles.length} usuarios</p>
        </div>
        <div className="flex gap-2">
          <button className="btn-secondary" onClick={() => setView('import')}>
            <Icon name="upload" size={16} />Importar
          </button>
          <button className={buttonClass} onClick={openAddModal}>
            <Icon name="plus" size={16} />Añadir usuario
          </button>
        </div>
      </div>

      {message && !editModalOpen && !addModalOpen && <p role={isError ? 'alert' : 'status'} className={isError ? 'notice-error' : 'notice-success'}>{messageText}</p>}

      <div>
        <div className="grid gap-2 md:grid-cols-[2fr_1fr]">
          <div className="relative">
            <Icon name="search" size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
            <input
              className={`${inputClass} pl-9`}
              type="search"
              placeholder="Buscar por nombre o correo…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <select className={inputClass} value={filterRole} onChange={(e) => setFilterRole(e.target.value)}>
            <option value="">Todos los roles</option>
            <option value="admin">Administrador</option>
            <option value="supervisor">Supervisor</option>
            <option value="profesor">Profesor</option>
            <option value="alumno">Alumno</option>
            <option value="pendiente">Pendientes de aprobar</option>
          </select>
        </div>
        {(search || filterRole) && (
          <div className="mt-2">
            <button
              className="btn-ghost text-muted"
              onClick={() => { setSearch(''); setFilterRole('') }}
            >
              Limpiar filtros
            </button>
          </div>
        )}
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr>
              <th className="px-5 py-3">Nombre</th>
              <th className="px-5 py-3">Correo</th>
              <th className="px-5 py-3">Rol</th>
              <th className="px-5 py-3">Teléfono</th>
              <th className="px-5 py-3"><span className="sr-only">Acciones</span></th>
            </tr>
          </thead>
          <tbody>
            {filteredProfiles.map((profile) => (
              <tr key={profile.id} className="border-t border-line">
                <td className="px-5 py-3 font-medium text-ink">{profile.full_name || 'Sin nombre'}</td>
                <td className="px-5 py-3 text-muted">{profile.email || '—'}</td>
                <td className="px-5 py-3">
                  <span className={`badge ${profile.role === 'admin' || profile.role === 'supervisor' ? 'bg-accent-soft text-accent-strong' : profile.role === 'profesor' ? 'bg-success-soft text-success' : ''}`}>
                    {ROLE_LABELS[profile.role] || profile.role}
                  </span>
                  {profile.status !== 'activo' && (
                    <span className="badge ml-1">{profile.status === 'pendiente' ? 'Pendiente' : 'Rechazado'}</span>
                  )}
                </td>
                <td className="px-5 py-3 text-muted">{profile.phone || '—'}</td>
                <td className="px-5 py-3">
                  <div className="flex justify-end gap-1 text-muted">
                    {canManage(profile) && <button className="rounded-lg p-1.5 hover:bg-subtle hover:text-ink" aria-label={`Editar ${profile.full_name || profile.email}`} onClick={() => openEditModal(profile)}>
                      <Icon name="edit" size={16} />
                    </button>}
                    {profile.id !== user.id && canManage(profile) && (
                      <button className="rounded-lg p-1.5 hover:bg-danger-soft hover:text-danger" aria-label={`Eliminar ${profile.full_name || profile.email}`} onClick={() => deleteProfile(profile)} disabled={busy}>
                        <Icon name="trash" size={16} />
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {filteredProfiles.length === 0 && (
              <tr>
                <td colSpan="5" className="empty">
                  {profiles.length === 0 ? 'No hay perfiles registrados.' : 'No hay perfiles que coincidan con los filtros.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
        </div>
      </div>

      {/* Modal de Edición */}
      {editModalOpen && editingProfile && (
        <Modal title={`Editar perfil · ${editingProfile.full_name || editingProfile.email}`} onClose={() => setEditModalOpen(false)}>
            <form className="space-y-4" onSubmit={saveProfile}>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-ink-soft">Nombre completo</label>
                <input
                  className={inputClass}
                  value={formData.full_name}
                  onChange={(e) => setFormData({ ...formData, full_name: e.target.value })}
                  required
                />
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-medium text-ink-soft">Correo electrónico</label>
                <input className={`${inputClass} bg-subtle text-muted`} value={formData.email} disabled />
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-medium text-ink-soft">Rol</label>
                <select
                  className={inputClass}
                  value={formData.role}
                  onChange={(e) => setFormData({ ...formData, role: e.target.value })}
                  disabled={editingProfile.id === user.id || editingProfile.role === ROLES.SUPERVISOR}
                >
                  <option value="alumno">Alumno</option>
                  <option value="profesor">Profesor</option>
                  {editingProfile.role === ROLES.SUPERVISOR && <option value="supervisor">Supervisor</option>}
                  {isAdmin && <option value="admin">Administrador</option>}
                </select>
                {editingProfile.id === user.id && (
                  <p className="mt-1 text-xs text-muted">No puedes cambiar tu propio rol.</p>
                )}
                {editingProfile.role === ROLES.SUPERVISOR && editingProfile.id !== user.id && (
                  <p className="mt-1 text-xs text-muted">Los supervisores se nombran y se quitan en Escuelas.</p>
                )}
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-medium text-ink-soft">Teléfono</label>
                <input
                  className={inputClass}
                  value={formData.phone}
                  onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                  placeholder="+34 600 000 000"
                />
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-medium text-ink-soft">Notas</label>
                <textarea
                  className={inputClass}
                  rows="3"
                  value={formData.bio}
                  onChange={(e) => setFormData({ ...formData, bio: e.target.value })}
                  placeholder="Especialidad, horarios, notas internas..."
                />
              </div>

              {message && <p role={isError ? 'alert' : 'status'} className={isError ? 'notice-error' : 'notice-success'}>{messageText}</p>}
              <div className="flex justify-end gap-2 pt-1">
                <button type="button" className="btn-secondary" onClick={() => setEditModalOpen(false)}>Cancelar</button>
                <button className={buttonClass} disabled={busy}>{busy ? 'Guardando…' : 'Guardar cambios'}</button>
              </div>
            </form>
        </Modal>
      )}

      {/* Modal de Añadir Usuario */}
      {addModalOpen && (
        <Modal title="Añadir usuario" onClose={() => setAddModalOpen(false)}>
            <form className="space-y-4" onSubmit={addNewProfile}>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-ink-soft">Correo electrónico</label>
                <input
                  className={inputClass}
                  type="email"
                  value={newUserEmail}
                  onChange={(e) => setNewUserEmail(e.target.value)}
                  required
                  placeholder="usuario@escuela.com"
                />
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-medium text-ink-soft">Nombre completo</label>
                <input
                  className={inputClass}
                  value={formData.full_name}
                  onChange={(e) => setFormData({ ...formData, full_name: e.target.value })}
                  required
                  maxLength={100}
                />
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-medium text-ink-soft">Rol</label>
                <select
                  className={inputClass}
                  value={newUserRole}
                  onChange={(e) => setNewUserRole(e.target.value)}
                >
                  <option value="alumno">Alumno</option>
                  <option value="profesor">Profesor</option>
                </select>
              </div>

              {isAdmin && (
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-ink-soft">Escuela</label>
                  <select className={inputClass} value={newUserSchool} onChange={(e) => setNewUserSchool(e.target.value)} required>
                    <option value="">Elige una escuela…</option>
                    {schools.map((school) => <option key={school.id} value={school.id}>{school.name}</option>)}
                  </select>
                </div>
              )}

              <div>
                <label className="mb-1.5 block text-sm font-medium text-ink-soft">Teléfono</label>
                <input
                  className={inputClass}
                  value={formData.phone}
                  onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                  placeholder="+34 600 000 000"
                />
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-medium text-ink-soft">Notas</label>
                <textarea
                  className={inputClass}
                  rows="3"
                  value={formData.bio}
                  onChange={(e) => setFormData({ ...formData, bio: e.target.value })}
                  placeholder="Especialidad, horarios, notas internas..."
                />
              </div>

              <p className="notice text-xs">
                Le enviaremos una invitación por correo para que elija su contraseña.
                Para crear un administrador, cambia el rol después desde «Editar».
              </p>
              {message && <p role={isError ? 'alert' : 'status'} className={isError ? 'notice-error' : 'notice-success'}>{messageText}</p>}

              <div className="flex justify-end gap-2 pt-1">
                <button type="button" className="btn-secondary" onClick={() => setAddModalOpen(false)}>Cancelar</button>
                <button className={buttonClass} disabled={busy}>{busy ? 'Enviando…' : 'Enviar invitación'}</button>
              </div>
            </form>
        </Modal>
      )}
    </div>
  )
}