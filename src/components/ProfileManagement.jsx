import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase.js'

const inputClass = 'w-full rounded border border-[#d1d5db] px-3 py-2 text-sm focus:border-[#1e88e5]'
const buttonClass = 'rounded bg-[#1e88e5] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1565c0] disabled:opacity-50'
const dangerButtonClass = 'rounded bg-[#c62828] px-4 py-2 text-sm font-semibold text-white hover:bg-[#b71c1c] disabled:opacity-50'

export default function ProfileManagement({ user }) {
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
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    loadProfiles()
  }, [])

  async function loadProfiles() {
    setLoading(true)
    const { data, error } = await supabase
      .from('profiles')
      .select('id, full_name, email, phone, bio, role, created_at')
      .order('full_name', { ascending: true })
    
    if (error) setMessage('Error al cargar perfiles: ' + error.message)
    else setProfiles(data || [])
    setLoading(false)
  }

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
    setAddModalOpen(true)
    setMessage('')
  }

  async function saveProfile(event) {
    event.preventDefault()
    setBusy(true)
    
    const { error } = await supabase
      .from('profiles')
      .update({
        full_name: formData.full_name.trim(),
        phone: formData.phone.trim(),
        bio: formData.bio.trim(),
        role: formData.role
      })
      .eq('id', editingProfile.id)

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

    // Paso 1: Crear usuario en Supabase Auth
    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email: newUserEmail,
      password: 'TempPass123!', // Contraseña temporal
      email_confirm: true,
      user_metadata: { 
        full_name: formData.full_name.trim(),
        role: newUserRole 
      }
    })

    if (authError) {
      setBusy(false)
      setMessage(' Error al crear usuario: ' + authError.message)
      return
    }

    // Paso 2: Crear perfil en la tabla profiles
    const { error: profileError } = await supabase
      .from('profiles')
      .insert({
        id: authData.user.id,
        full_name: formData.full_name.trim(),
        email: newUserEmail,
        phone: formData.phone.trim(),
        bio: formData.bio.trim(),
        role: newUserRole
      })

    setBusy(false)
    if (profileError) {
      setMessage('⚠️ Usuario creado pero error al guardar perfil: ' + profileError.message)
    } else {
      setMessage('✅ Usuario y perfil creados correctamente. Contraseña temporal: TempPass123!')
      setAddModalOpen(false)
      loadProfiles()
    }
  }

  async function deleteProfile(profile) {
    if (!window.confirm(`¿Eliminar permanentemente el perfil de ${profile.full_name}?`)) return
    
    setBusy(true)
    
    // Eliminar de la tabla profiles
    const { error } = await supabase
      .from('profiles')
      .delete()
      .eq('id', profile.id)

    setBusy(false)
    if (error) {
      setMessage('❌ Error al eliminar: ' + error.message)
    } else {
      setMessage('✅ Perfil eliminado correctamente.')
      loadProfiles()
    }
  }

  if (loading) return <div className="p-8 text-center text-[#0a2540]">Cargando perfiles...</div>

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-[#0a2540]">Gestión de Perfiles</h2>
          <p className="text-sm text-[#6b7280]">Administra todos los usuarios del sistema.</p>
        </div>
        <button className={buttonClass} onClick={openAddModal}>
          ➕ Añadir Usuario
        </button>
      </div>

      {message && (
        <div className={`rounded p-3 text-sm ${message.includes('✅') ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'}`}>
          {message}
        </div>
      )}

      <div className="overflow-hidden rounded-lg border border-[#e5e7eb] bg-white">
        <table className="w-full text-left text-sm">
          <thead className="bg-[#0a2540] text-xs uppercase text-white">
            <tr>
              <th className="p-4">Nombre</th>
              <th className="p-4">Correo</th>
              <th className="p-4">Rol</th>
              <th className="p-4">Teléfono</th>
              <th className="p-4 text-right">Acciones</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#e5e7eb]">
            {profiles.map((profile) => (
              <tr key={profile.id} className="hover:bg-[#f9fafb]">
                <td className="p-4 font-medium text-[#0a2540]">{profile.full_name || 'Sin nombre'}</td>
                <td className="p-4 text-[#6b7280]">{profile.email || '—'}</td>
                <td className="p-4">
                  <span className={`rounded px-2 py-1 text-xs font-semibold ${
                    profile.role === 'admin' ? 'bg-purple-100 text-purple-800' :
                    profile.role === 'profesor' ? 'bg-blue-100 text-blue-800' :
                    'bg-gray-100 text-gray-800'
                  }`}>
                    {profile.role}
                  </span>
                </td>
                <td className="p-4 text-[#6b7280]">{profile.phone || '—'}</td>
                <td className="p-4 text-right">
                  <div className="flex justify-end gap-2">
                    <button 
                      className="rounded border border-[#d1d5db] px-3 py-1.5 text-xs font-semibold text-[#0a2540] hover:bg-[#f4f6f9]"
                      onClick={() => openEditModal(profile)}
                    >
                      ✏️ Editar
                    </button>
                    {profile.id !== user.id && (
                      <button 
                        className="rounded border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50"
                        onClick={() => deleteProfile(profile)}
                        disabled={busy}
                      >
                        🗑️ Eliminar
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {profiles.length === 0 && (
              <tr>
                <td colSpan="5" className="p-8 text-center text-[#6b7280]">No hay perfiles registrados.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Modal de Edición */}
      {editModalOpen && editingProfile && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onMouseDown={(e) => e.target === e.currentTarget && setEditModalOpen(false)}>
          <div className="w-full max-w-lg rounded-lg bg-white p-6 shadow-2xl">
            <h3 className="mb-4 text-lg font-bold text-[#0a2540]">Editar Perfil: {editingProfile.full_name}</h3>
            <form className="space-y-4" onSubmit={saveProfile}>
              <div>
                <label className="mb-1 block text-sm font-semibold text-[#0a2540]">Nombre Completo</label>
                <input 
                  className={inputClass} 
                  value={formData.full_name} 
                  onChange={(e) => setFormData({...formData, full_name: e.target.value})} 
                  required 
                />
              </div>
              
              <div>
                <label className="mb-1 block text-sm font-semibold text-[#0a2540]">Correo Electrónico</label>
                <input className={`${inputClass} bg-[#f3f4f6] text-[#6b7280]`} value={formData.email} disabled />
              </div>

              <div>
                <label className="mb-1 block text-sm font-semibold text-[#0a2540]">Rol</label>
                <select 
                  className={inputClass} 
                  value={formData.role} 
                  onChange={(e) => setFormData({...formData, role: e.target.value})}
                >
                  <option value="alumno">Alumno</option>
                  <option value="profesor">Profesor</option>
                  <option value="admin">Administrador</option>
                </select>
              </div>

              <div>
                <label className="mb-1 block text-sm font-semibold text-[#0a2540]">Teléfono</label>
                <input 
                  className={inputClass} 
                  value={formData.phone} 
                  onChange={(e) => setFormData({...formData, phone: e.target.value})} 
                  placeholder="+34 600 000 000"
                />
              </div>

              <div>
                <label className="mb-1 block text-sm font-semibold text-[#0a2540]">Biografía / Notas</label>
                <textarea 
                  className={inputClass} 
                  rows="3" 
                  value={formData.bio} 
                  onChange={(e) => setFormData({...formData, bio: e.target.value})} 
                  placeholder="Especialidad, horarios, notas internas..."
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button type="button" className="rounded border border-[#d1d5db] px-4 py-2 text-sm" onClick={() => setEditModalOpen(false)}>Cancelar</button>
                <button className={buttonClass} disabled={busy}>{busy ? 'Guardando...' : 'Guardar Cambios'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal de Añadir Usuario */}
      {addModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onMouseDown={(e) => e.target === e.currentTarget && setAddModalOpen(false)}>
          <div className="w-full max-w-lg rounded-lg bg-white p-6 shadow-2xl">
            <h3 className="mb-4 text-lg font-bold text-[#0a2540]">Añadir Nuevo Usuario</h3>
            <form className="space-y-4" onSubmit={addNewProfile}>
              <div>
                <label className="mb-1 block text-sm font-semibold text-[#0a2540]">Correo Electrónico *</label>
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
                <label className="mb-1 block text-sm font-semibold text-[#0a2540]">Nombre Completo *</label>
                <input 
                  className={inputClass} 
                  value={formData.full_name} 
                  onChange={(e) => setFormData({...formData, full_name: e.target.value})} 
                  required 
                />
              </div>

              <div>
                <label className="mb-1 block text-sm font-semibold text-[#0a2540]">Rol *</label>
                <select 
                  className={inputClass} 
                  value={newUserRole} 
                  onChange={(e) => setNewUserRole(e.target.value)}
                >
                  <option value="alumno">Alumno</option>
                  <option value="profesor">Profesor</option>
                  <option value="admin">Administrador</option>
                </select>
              </div>

              <div>
                <label className="mb-1 block text-sm font-semibold text-[#0a2540]">Teléfono</label>
                <input 
                  className={inputClass} 
                  value={formData.phone} 
                  onChange={(e) => setFormData({...formData, phone: e.target.value})} 
                  placeholder="+34 600 000 000"
                />
              </div>

              <div>
                <label className="mb-1 block text-sm font-semibold text-[#0a2540]">Biografía / Notas</label>
                <textarea 
                  className={inputClass} 
                  rows="3" 
                  value={formData.bio} 
                  onChange={(e) => setFormData({...formData, bio: e.target.value})} 
                  placeholder="Especialidad, horarios, notas internas..."
                />
              </div>

              <div className="rounded bg-amber-50 p-3 text-xs text-amber-800">
                ️ Se creará el usuario con contraseña temporal: <strong>TempPass123!</strong><br/>
                El usuario deberá cambiarla en su primer inicio de sesión.
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button type="button" className="rounded border border-[#d1d5db] px-4 py-2 text-sm" onClick={() => setAddModalOpen(false)}>Cancelar</button>
                <button className={buttonClass} disabled={busy}>{busy ? 'Creando...' : 'Crear Usuario'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}