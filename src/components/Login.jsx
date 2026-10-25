import { useState } from 'react'
import { supabase } from '../lib/supabase.js'

const MIN_PASSWORD_LENGTH = 8 // Configura el mismo mínimo en Supabase: Authentication > Providers > Email

function friendlyAuthError(error) {
  const code = error?.code || ''
  const message = (error?.message || '').toLowerCase()
  if (code === 'weak_password' || message.includes('password should be')) return `La contraseña es demasiado débil. Usa al menos ${MIN_PASSWORD_LENGTH} caracteres.`
  if (code === 'over_email_send_rate_limit' || code === 'over_request_rate_limit' || message.includes('rate limit')) return 'Demasiados intentos. Espera unos minutos e inténtalo de nuevo.'
  if (code === 'email_address_invalid' || message.includes('invalid email')) return 'El correo electrónico no es válido.'
  if (code === 'signup_disabled') return 'El registro está desactivado. Contacta con administración.'
  return 'No se pudo completar la operación. Inténtalo de nuevo.'
}

export default function Login({ onLoginSuccess }) {
  const [mode, setMode] = useState('login') // 'login' | 'register' | 'reset'
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [loading, setLoading] = useState(false)

  const isRegister = mode === 'register'
  const isReset = mode === 'reset'

  function changeMode(nextMode) {
    setMode(nextMode)
    setError('')
    setNotice('')
    setPassword('')
    setConfirmPassword('')
  }

  async function register() {
    if (!name.trim()) { setError('Introduce tu nombre completo.'); return }
    if (password.length < MIN_PASSWORD_LENGTH) { setError(`La contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres.`); return }
    if (password !== confirmPassword) { setError('Las contraseñas no coinciden.'); return }

    // Solo se envía el nombre. El rol NUNCA se pide desde el cliente.
    const { error: signUpError } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: {
        data: { full_name: name.trim() },
        emailRedirectTo: window.location.origin,
      },
    })
    if (signUpError) { setError(friendlyAuthError(signUpError)); return }
    changeMode('login')
    setNotice('Cuenta creada. Revisa tu correo para confirmar el registro.')
  }

  async function login() {
    const { data, error: signInError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    })

    if (signInError) {
      if (signInError.code === 'email_not_confirmed') setError('Debes confirmar tu correo antes de iniciar sesión. Revisa tu bandeja de entrada.')
      else setError('No se pudo iniciar sesión. Comprueba el correo y la contraseña.')
      return
    }

    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('role,full_name')
      .eq('id', data.user.id)
      .maybeSingle()

    // Sin perfil válido no se entra: nunca se asume un rol por defecto.
    if (profileError || !profile?.role) {
      await supabase.auth.signOut()
      setError(profileError
        ? 'No se pudo cargar tu perfil. Inténtalo de nuevo en unos minutos.'
        : 'Tu cuenta aún no tiene un perfil configurado. Contacta con administración.')
      return
    }

    onLoginSuccess({
      id: data.user.id,
      email: data.user.email,
      role: profile.role,
      name: profile.full_name || data.user.user_metadata?.full_name || 'Usuario',
    })
  }

  async function requestPasswordReset() {
    if (!email.trim()) { setError('Introduce tu correo para enviarte el enlace de recuperación.'); return }
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: window.location.origin,
    })
    // Solo se muestra el error si es por límite de envíos; en cualquier otro caso
    // se da el mismo mensaje para no revelar si la cuenta existe.
    if (['over_email_send_rate_limit', 'over_request_rate_limit'].includes(resetError?.code)) {
      setError(friendlyAuthError(resetError))
      return
    }
    setNotice('Si existe una cuenta con ese correo, recibirás un enlace de recuperación.')
  }

  async function handleSubmit(event) {
    event.preventDefault()
    if (loading) return
    setError('')
    setNotice('')
    setLoading(true)
    try {
      if (isRegister) await register()
      else if (isReset) await requestPasswordReset()
      else await login()
    } catch {
      setError('No se pudo conectar con el servidor. Comprueba tu conexión e inténtalo de nuevo.')
    } finally {
      setLoading(false)
    }
  }

  const submitLabel = loading
    ? (isReset ? 'Enviando…' : 'Procesando…')
    : isReset ? 'Enviar enlace de recuperación' : isRegister ? 'Crear cuenta' : 'Iniciar sesión'

  return (
    <main className="login-screen">
      <section className="login-panel">
        <div className="login-brand">
          <span aria-hidden="true" className="login-mark">✈</span>
          <p className="login-kicker">Formación y mantenimiento aeronáutico</p>
          <h1>EASA Part 66</h1>
          <p className="login-subtitle">Gestión académica por módulos</p>
        </div>

        <form onSubmit={handleSubmit} className="login-form">
          {isRegister && (
            <label className="login-field">
              <span>Nombre completo</span>
              <input type="text" value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" required />
            </label>
          )}
          <label className="login-field">
            <span>Correo electrónico</span>
            <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" required />
          </label>
          {!isReset && (
            <label className="login-field">
              <span>Contraseña</span>
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete={isRegister ? 'new-password' : 'current-password'}
                minLength={isRegister ? MIN_PASSWORD_LENGTH : undefined}
                required
              />
            </label>
          )}
          {isRegister && (
            <label className="login-field">
              <span>Repetir contraseña</span>
              <input
                type="password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                autoComplete="new-password"
                minLength={MIN_PASSWORD_LENGTH}
                required
              />
            </label>
          )}

          {error && <p role="alert" className="login-message login-error">{error}</p>}
          {notice && <p role="status" className="login-message login-notice">{notice}</p>}

          <button type="submit" disabled={loading} className="login-submit">{submitLabel}</button>
        </form>

        <div className="login-links">
          {mode === 'login' && (
            <button type="button" onClick={() => changeMode('reset')}>¿Olvidaste tu contraseña?</button>
          )}
          {mode === 'login' && (
            <button type="button" onClick={() => changeMode('register')}>Crear cuenta nueva</button>
          )}
          {mode !== 'login' && (
            <button type="button" onClick={() => changeMode('login')}>Volver al inicio de sesión</button>
          )}
        </div>
      </section>
    </main>
  )
}