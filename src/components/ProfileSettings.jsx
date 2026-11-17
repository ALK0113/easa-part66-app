import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { ROLE_LABELS } from '../lib/roles.js'

const inputClass = 'input'
const buttonClass = 'btn-primary'

export default function ProfileSettings({ user }) {
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [formData, setFormData] = useState({ full_name: '', phone: '', bio: '', role: '' })

  useEffect(() => {
    let cancelled = false
    async function loadProfile() {
      const { data, error } = await supabase
        .from('profiles')
        .select('full_name, email, phone, bio, role')
        .eq('id', user.id)
        .single()
      if (cancelled) return
      if (error) setMessage('❌ No se pudo cargar tu perfil: ' + error.message)
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
    loadProfile()
    return () => { cancelled = true }
  }, [user.id])

  const canEditData = user.role === 'admin'

  async function handleSave(event) {
    event.preventDefault()
    setSaving(true)
    setMessage('')

    // Nombre y teléfono solo los cambia la coordinación (o administración); cada uno edita su presentación
    const values = canEditData
      ? { full_name: formData.full_name.trim(), phone: formData.phone.trim(), bio: formData.bio.trim() }
      : { bio: formData.bio.trim() }
    const { error } = await supabase.from('profiles').update(values).eq('id', user.id)

    setSaving(false)
    if (error) setMessage('❌ Error al guardar: ' + error.message)
    else setMessage('✅ Perfil actualizado correctamente.')
  }

  if (loading) return <div className="flex min-h-[40vh] items-center justify-center text-sm text-muted">Cargando tu perfil…</div>

  const isError = message.startsWith('❌')
  const messageText = message.replace(/^(❌|✅)\s*/, '')

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="page-intro">
        <div>
          <h2>Mis datos</h2>
          <p>Tu información personal y de contacto.</p>
        </div>
      </div>

      <section className="card divide-y divide-line">
        <div className="flex items-center justify-between gap-4 px-6 py-4 text-sm">
          <span className="text-muted">Correo</span>
          <span className="truncate font-medium text-ink">{profile?.email || '—'}</span>
        </div>
        <div className="flex items-center justify-between gap-4 px-6 py-4 text-sm">
          <span className="text-muted">Rol</span>
          <span className="badge">{ROLE_LABELS[formData.role] || formData.role}</span>
        </div>
        <p className="px-6 py-3 text-xs text-faint">El correo y el rol los gestiona administración.</p>
      </section>

      <form className="card space-y-4 p-6" onSubmit={handleSave}>
        <label className="field">
          Nombre completo
          <input
            className={inputClass}
            value={formData.full_name}
            onChange={(e) => setFormData({...formData, full_name: e.target.value})}
            required
            disabled={!canEditData}
          />
        </label>

        <label className="field">
          Teléfono
          <input
            className={inputClass}
            value={formData.phone}
            onChange={(e) => setFormData({...formData, phone: e.target.value})}
            placeholder="+34 600 000 000"
            disabled={!canEditData}
          />
        </label>
        {!canEditData && <p className="-mt-2 text-xs text-muted">Para cambiar tu nombre o tu teléfono, habla con la coordinación de tu escuela.</p>}

        <label className="field">
          Sobre mí
          <textarea
            className={inputClass}
            rows="4"
            value={formData.bio}
            onChange={(e) => setFormData({...formData, bio: e.target.value})}
            placeholder="Especialidad, información adicional…"
          />
        </label>

        {message && <p role={isError ? 'alert' : 'status'} className={isError ? 'notice-error' : 'notice-success'}>{messageText}</p>}

        <div className="flex justify-end pt-1">
          <button className={buttonClass} disabled={saving}>
            {saving ? 'Guardando…' : 'Guardar cambios'}
          </button>
        </div>
      </form>
    </div>
  )
}
