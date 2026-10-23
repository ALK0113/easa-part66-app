import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase.js'

const inputClass = 'w-full rounded border border-[#d1d5db] px-3 py-2 text-sm focus:border-[#1e88e5]'
const buttonClass = 'rounded bg-[#1e88e5] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1565c0] disabled:opacity-50'

export default function ProfileSettings({ user }) {
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [formData, setFormData] = useState({ full_name: '', phone: '', bio: '', role: '' })

  useEffect(() => {
    loadProfile()
  }, [user.id])

  async function loadProfile() {
    setLoading(true)
    const { data, error } = await supabase
      .from('profiles')
      .select('full_name, email, phone, bio, role')
      .eq('id', user.id)
      .single()

    if (error) setMessage('Error al cargar perfil: ' + error.message)
    else {
      setProfile(data)
      setFormData({
        full_name: data?.full_name || '',
        phone: data?.phone || '',
        bio: data?.bio || '',
        role: data?.role || 'alumno'
      })
    }
    setLoading(false)
  }

  async function handleSave(event) {
    event.preventDefault()
    setSaving(true)
    setMessage('')

    const { error } = await supabase
      .from('profiles')
      .update({
        full_name: formData.full_name.trim(),
        phone: formData.phone.trim(),
        bio: formData.bio.trim()
      })
      .eq('id', user.id)

    setSaving(false)
    if (error) setMessage('❌ Error al guardar: ' + error.message)
    else setMessage('✅ Perfil actualizado correctamente.')
  }

  if (loading) return <div className="p-8 text-center text-[#0a2540]">Cargando tu perfil...</div>

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h2 className="text-xl font-bold text-[#0a2540]">Mi Perfil</h2>
        <p className="text-sm text-[#6b7280]">Actualiza tu información personal y de contacto.</p>
      </div>

      {message && (
        <div className={`rounded p-3 text-sm ${message.includes('✅') ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'}`}>
          {message}
        </div>
      )}

      <form className="space-y-4 rounded-lg border border-[#e5e7eb] bg-white p-6" onSubmit={handleSave}>
        <div>
          <label className="mb-1 block text-sm font-semibold text-[#0a2540]">Correo Electrónico</label>
          <input className={`${inputClass} bg-[#f3f4f6] text-[#6b7280]`} value={profile?.email || ''} disabled />
          <p className="mt-1 text-xs text-[#6b7280]">Tu correo de inicio de sesión. Para cambiarlo, contacta al administrador.</p>
        </div>

        <div>
          <label className="mb-1 block text-sm font-semibold text-[#0a2540]">Rol</label>
          <input 
            className={`${inputClass} bg-[#f3f4f6] text-[#6b7280]`} 
            value={formData.role} 
            disabled 
          />
          <p className="mt-1 text-xs text-[#6b7280]">El rol solo puede ser modificado por el administrador.</p>
        </div>

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
            rows="4" 
            value={formData.bio} 
            onChange={(e) => setFormData({...formData, bio: e.target.value})} 
            placeholder="Especialidad, información adicional..."
          />
        </div>

        <div className="flex justify-end pt-2">
          <button className={buttonClass} disabled={saving}>
            {saving ? 'Guardando...' : 'Guardar Cambios'}
          </button>
        </div>
      </form>
    </div>
  )
}