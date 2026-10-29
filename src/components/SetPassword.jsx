import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase.js'

const inputClass = 'w-full rounded border border-[#d1d5db] px-3 py-2 text-sm focus:border-[#1e88e5]'
const buttonClass = 'w-full rounded bg-[#1e88e5] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1565c0] disabled:opacity-50'

export default function SetPassword({ onDone }) {
  const [checking, setChecking] = useState(true)
  const [hasSession, setHasSession] = useState(false)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  // getSession espera a que Supabase termine de procesar el enlace
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setHasSession(Boolean(data.session))
      setChecking(false)
    })
  }, [])

  async function handleSubmit(event) {
    event.preventDefault()
    setError('')

    if (password.length < 8) {
      setError('La contraseña debe tener al menos 8 caracteres.')
      return
    }
    if (password !== confirm) {
      setError('Las contraseñas no coinciden.')
      return
    }

    setBusy(true)
    const { error: updateError } = await supabase.auth.updateUser({ password })
    setBusy(false)

    if (updateError) {
      setError(
        updateError.message.includes('different from the old')
          ? 'La nueva contraseña debe ser distinta de la anterior.'
          : 'No se pudo guardar la contraseña: ' + updateError.message
      )
      return
    }
    onDone()
  }

  async function handleCancel() {
    await supabase.auth.signOut()
  }

  if (checking) {
    return <div className="p-8 text-center text-[#0a2540]">Verificando enlace...</div>
  }

  if (!hasSession) {
    return (
      <div className="mx-auto mt-16 max-w-md rounded-lg border border-[#e5e7eb] bg-white p-6 text-center shadow">
        <h1 className="mb-2 text-lg font-bold text-[#0a2540]">Enlace no válido</h1>
        <p className="mb-4 text-sm text-[#6b7280]">
          El enlace ha caducado o ya se ha usado. Pide una nueva invitación al administrador
          o usa «¿Olvidaste tu contraseña?» en la pantalla de acceso.
        </p>
        <button className={buttonClass} onClick={() => window.location.replace(window.location.pathname)}>
          Ir al inicio
        </button>
      </div>
    )
  }

  return (
    <div className="mx-auto mt-16 max-w-md rounded-lg border border-[#e5e7eb] bg-white p-6 shadow">
      <h1 className="mb-1 text-lg font-bold text-[#0a2540]">Elige tu contraseña</h1>
      <p className="mb-4 text-sm text-[#6b7280]">
        Mínimo 8 caracteres. La usarás para entrar en Aviatrack.
      </p>

      <form className="space-y-4" onSubmit={handleSubmit}>
        <div>
          <label className="mb-1 block text-sm font-semibold text-[#0a2540]">Nueva contraseña</label>
          <input
            className={inputClass}
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>

        <div>
          <label className="mb-1 block text-sm font-semibold text-[#0a2540]">Repite la contraseña</label>
          <input
            className={inputClass}
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            required
          />
        </div>

        {error && <div className="rounded bg-red-50 p-3 text-sm text-red-800">{error}</div>}

        <button className={buttonClass} disabled={busy}>
          {busy ? 'Guardando...' : 'Guardar contraseña'}
        </button>
        <button type="button" className="w-full text-xs text-[#6b7280] underline" onClick={handleCancel}>
          Cancelar y cerrar sesión
        </button>
      </form>
    </div>
  )
}