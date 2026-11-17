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
  if (code === 'user_already_exists' || code === 'email_exists' || message.includes('already registered')) return 'Ya existe una cuenta con este correo. Inicia sesión o recupera tu contraseña.'
  if (code === 'signup_disabled') return 'El registro está desactivado. Contacta con administración.'
  return 'No se pudo completar la operación. Inténtalo de nuevo.'
}

export default function Login({ onLoginSuccess }) {
  const [mode, setMode] = useState('login') // 'login' | 'register' | 'reset'
  const [joinCode, setJoinCode] = useState('')
  const [schoolName, setSchoolName] = useState('')
  const [requestedRole, setRequestedRole] = useState('alumno')
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

  // Comprueba el código de escuela y muestra su nombre
  async function checkJoinCode(code = joinCode) {
    setSchoolName('')
    if (code.replace(/[^A-Za-z0-9]/g, '').length < 8) return ''
    const { data } = await supabase.rpc('check_join_code', { p_code: code })
    setSchoolName(data || '')
    return data || ''
  }

  async function register() {
    if (!(await checkJoinCode())) { setError('El código de escuela no es válido. Pídeselo a tu escuela.'); return }
    const passwordError = await validateNewPassword(password, confirmPassword)
    if (passwordError) { setError(passwordError); return }

    // La cuenta queda pendiente: tras confirmar el correo, la persona rellena su ficha y la coordinación la aprueba. El rol pedido
    // solo puede ser alumno o profesor (lo garantiza la base de datos).
    const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: {
        data: { join_code: joinCode, requested_role: requestedRole },
        emailRedirectTo: window.location.origin,
      },
    })
    if (signUpError) { setError(friendlyAuthError(signUpError)); return }
    // Cada correo es una sola cuenta: Supabase no da error si ya existe, pero no le crea identidad nueva
    if (signUpData?.user && !signUpData.user.identities?.length) {
      setError('Ya existe una cuenta con este correo. Inicia sesión o recupera tu contraseña.')
      return
    }
    changeMode('login')
    setNotice(`Cuenta creada. Revisa tu correo para confirmarlo y después entra con tu contraseña para completar tu ficha. ${schoolName} la revisará.`)
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
      .select('role,full_name,status')
      .eq('id', data.user.id)
      .maybeSingle()

    // Sin perfil válido no se entra: nunca se asume un rol por defecto.
    if (profileError || !profile?.role) {
      await supabase.auth.signOut({ scope: 'local' })
      setError(profileError
        ? 'No se pudo cargar tu perfil. Inténtalo de nuevo en unos minutos.'
        : 'Tu cuenta aún no tiene un perfil configurado. Contacta con administración.')
      return
    }

    onLoginSuccess({
      id: data.user.id,
      email: data.user.email,
      role: profile.role,
      status: profile.status,
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
    register: ['Crear cuenta', 'Tu escuela revisará tu solicitud antes de darte acceso.'],
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
                <span>Código de escuela</span>
                <input
                  className="input uppercase tracking-wider"
                  type="text"
                  value={joinCode}
                  onChange={(event) => { setJoinCode(event.target.value); checkJoinCode(event.target.value) }}
                  placeholder="ABCD-2345"
                  autoComplete="off"
                  required
                />
                <span className="text-xs font-normal text-muted">{schoolName ? `Escuela: ${schoolName}` : 'Te lo da tu escuela.'}</span>
              </label>
            )}
            {isRegister && (
              <fieldset className="field">
                <legend className="mb-1.5">Me registro como</legend>
                <div className="grid grid-cols-2 gap-2">
                  {[['alumno', 'Alumno'], ['profesor', 'Profesor']].map(([value, label]) => (
                    <label key={value} className={`btn h-10 cursor-pointer border ${requestedRole === value ? 'border-accent bg-accent-soft text-accent-strong' : 'border-line-strong bg-surface text-ink-soft'}`}>
                      <input type="radio" name="requested-role" value={value} checked={requestedRole === value} onChange={() => setRequestedRole(value)} className="sr-only" />
                      {label}
                    </label>
                  ))}
                </div>
              </fieldset>
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
