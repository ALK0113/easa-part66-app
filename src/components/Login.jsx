import { useState } from 'react'
import { supabase } from '../lib/supabase.js'
import Icon from './Icon.jsx'
import { MIN_PASSWORD_LENGTH, validateNewPassword } from '../lib/password.js'

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
    const passwordError = await validateNewPassword(password, confirmPassword)
    if (passwordError) { setError(passwordError); return }

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

  const titles = {
    login: ['Bienvenido', 'Accede con tu cuenta de la escuela.'],
    register: ['Crear cuenta', 'Solo te llevará un momento.'],
    reset: ['Recuperar contraseña', 'Te enviaremos un enlace a tu correo.'],
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-canvas px-4 py-10">
      <div className="fade-in w-full max-w-[400px]">
        <div className="mb-8 flex items-center justify-center gap-2.5">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent-soft text-accent">
            <Icon name="plane" size={20} />
          </span>
          <span className="text-left">
            <span className="block text-base font-semibold leading-tight text-ink">AviaTrack</span>
            <span className="block text-xs text-muted">EASA Part-147</span>
          </span>
        </div>

        <section className="card p-7 sm:p-8">
          <h1 className="text-xl font-semibold text-ink">{titles[mode][0]}</h1>
          <p className="mt-1 text-sm text-muted">{titles[mode][1]}</p>

          <form onSubmit={handleSubmit} className="mt-6 grid gap-4">
            {isRegister && (
              <label className="field">
                <span>Nombre completo</span>
                <input className="input" type="text" value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" required />
              </label>
            )}
            <label className="field">
              <span>Correo electrónico</span>
              <input className="input" type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" required />
            </label>
            {!isReset && (
              <label className="field">
                <span className="flex items-center justify-between">
                  Contraseña
                  {mode === 'login' && (
                    <button type="button" className="text-xs font-medium text-accent hover:text-accent-strong" onClick={() => changeMode('reset')}>¿La has olvidado?</button>
                  )}
                </span>
                <input
                  className="input"
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
              <label className="field">
                <span>Repetir contraseña</span>
                <input
                  className="input"
                  type="password"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  autoComplete="new-password"
                  minLength={MIN_PASSWORD_LENGTH}
                  required
                />
              </label>
            )}

            {error && <p role="alert" className="notice-error">{error}</p>}
            {notice && <p role="status" className="notice-success">{notice}</p>}

            <button type="submit" disabled={loading} className="btn-primary mt-1 h-11 w-full">{submitLabel}</button>
          </form>
        </section>

        <p className="mt-6 text-center text-sm text-muted">
          {mode === 'login' ? (
            <>¿Aún no tienes cuenta? <button type="button" className="link" onClick={() => changeMode('register')}>Crear cuenta</button></>
          ) : (
            <button type="button" className="link" onClick={() => changeMode('login')}>Volver a iniciar sesión</button>
          )}
        </p>
      </div>
    </main>
  )
}
