import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { MIN_PASSWORD_LENGTH, validateNewPassword } from '../lib/password.js'

const inputClass = 'input'
const buttonClass = 'btn-primary h-11 w-full'

// Pantalla común para enlaces de invitación/recuperación caducados o ya usados.
export function InvalidLinkNotice() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas px-4"><div className="card fade-in w-full max-w-md p-8 text-center">
      <h1 className="mb-2 text-xl font-semibold text-ink">Enlace no válido</h1>
      <p className="mb-4 text-sm text-muted">
        El enlace ha caducado o ya se ha usado. Pide una nueva invitación al administrador
        o usa «¿Olvidaste tu contraseña?» en la pantalla de acceso.
      </p>
      <button type="button" className={buttonClass} onClick={() => window.location.replace(window.location.pathname)}>
        Ir al inicio
      </button>
    </div></div>
  )
}

export default function SetPassword({ onDone }) {
  const [checking, setChecking] = useState(true)
  const [hasSession, setHasSession] = useState(false)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  // getSession espera a que Supabase termine de procesar el enlace
  useEffect(() => {
    supabase.auth.getSession()
      .then(({ data }) => setHasSession(Boolean(data.session)))
      .catch(() => setHasSession(false))
      .finally(() => setChecking(false))
  }, [])

  async function handleSubmit(event) {
    event.preventDefault()
    setError('')

    setBusy(true)
    const passwordError = await validateNewPassword(password, confirm)
    if (passwordError) {
      setBusy(false)
      setError(passwordError)
      return
    }

    const { error: updateError } = await supabase.auth.updateUser({ password })

    if (updateError) {
      setBusy(false)
      setError(
        updateError.message.includes('different from the old')
          ? 'La nueva contraseña debe ser distinta de la anterior.'
          : updateError.code === 'weak_password'
            ? `La contraseña es demasiado débil. Usa al menos ${MIN_PASSWORD_LENGTH} caracteres.`
            : 'No se pudo guardar la contraseña: ' + updateError.message
      )
      return
    }

    // Cierra todas las demás sesiones abiertas y conserva la actual
    const { error: signOutError } = await supabase.auth.signOut({ scope: 'others' })
    if (signOutError) {
      console.error('No se pudieron cerrar las otras sesiones:', signOutError.message)
    }

    setBusy(false)
    onDone()
  }

  async function handleCancel() {
    await supabase.auth.signOut()
  }

  if (checking) {
    return <div className="flex min-h-screen items-center justify-center bg-canvas text-sm text-muted">Verificando enlace…</div>
  }

  if (!hasSession) return <InvalidLinkNotice />

  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas px-4"><div className="card fade-in w-full max-w-md p-8">
      <h1 className="mb-1 text-xl font-semibold text-ink">Elige tu contraseña</h1>
      <p className="mb-6 text-sm text-muted">
        Mínimo {MIN_PASSWORD_LENGTH} caracteres. La usarás para entrar en AviaTrack.
      </p>

      <form className="space-y-4" onSubmit={handleSubmit}>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-ink-soft">Nueva contraseña</label>
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
          <label className="mb-1.5 block text-sm font-medium text-ink-soft">Repite la contraseña</label>
          <input
            className={inputClass}
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            required
          />
        </div>

        {error && <div className="notice-error">{error}</div>}

        <button className={buttonClass} disabled={busy}>
          {busy ? 'Guardando...' : 'Guardar contraseña'}
        </button>
        <button type="button" className="w-full text-sm text-muted hover:text-ink" onClick={handleCancel}>
          Cancelar y cerrar sesión
        </button>
      </form>
    </div></div>
  )
}