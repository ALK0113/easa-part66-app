import { useState } from 'react'
import { supabase } from '../lib/supabase.js'

const MIN_PASSWORD_LENGTH = 8

// Se muestra cuando el usuario llega desde el enlace de recuperación (evento PASSWORD_RECOVERY).
export default function UpdatePassword({ onDone }) {
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(event) {
    event.preventDefault()
    if (loading) return
    setError('')
    if (password.length < MIN_PASSWORD_LENGTH) { setError(`La contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres.`); return }
    if (password !== confirmPassword) { setError('Las contraseñas no coinciden.'); return }

    setLoading(true)
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password })
      if (updateError) { setError('No se pudo cambiar la contraseña. El enlace puede haber caducado; solicita uno nuevo.'); return }
      await supabase.auth.signOut()
      onDone?.()
    } catch {
      setError('No se pudo conectar con el servidor. Inténtalo de nuevo.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="login-screen">
      <section className="login-panel">
        <div className="login-brand">
          <span aria-hidden="true" className="login-mark">✈</span>
          <h1>Nueva contraseña</h1>
          <p className="login-subtitle">Elige una contraseña nueva para tu cuenta</p>
        </div>
        <form onSubmit={handleSubmit} className="login-form">
          <label className="login-field">
            <span>Nueva contraseña</span>
            <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" minLength={MIN_PASSWORD_LENGTH} required />
          </label>
          <label className="login-field">
            <span>Repetir contraseña</span>
            <input type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} autoComplete="new-password" minLength={MIN_PASSWORD_LENGTH} required />
          </label>
          {error && <p role="alert" className="login-message login-error">{error}</p>}
          <button type="submit" disabled={loading} className="login-submit">{loading ? 'Guardando…' : 'Guardar contraseña'}</button>
        </form>
      </section>
    </main>
  )
}