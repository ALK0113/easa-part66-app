import { useState } from 'react'
import { supabase } from '../lib/supabase.js'

export default function Login({ onLoginSuccess }) {
  const [mode, setMode] = useState('login')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(event) {
    event.preventDefault()
    setError('')
    setNotice('')
    setLoading(true)

    if (mode === 'register') {
      const { error: signUpError } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: { data: { full_name: name.trim() } },
      })

      if (signUpError) setError(signUpError.message)
      else {
        setNotice('Cuenta creada. Revisa tu correo para confirmar el registro.')
        setMode('login')
      }
      setLoading(false)
      return
    }

    const { data, error: signInError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    })

    if (signInError) {
      setError('No se pudo iniciar sesión. Comprueba el correo y la contraseña.')
      setLoading(false)
      return
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', data.user.id)
      .single()

    onLoginSuccess({
      id: data.user.id,
      email: data.user.email,
      role: profile?.role || 'alumno',
      name: profile?.full_name || data.user.user_metadata?.full_name || 'Usuario',
    })
    setLoading(false)
  }

  async function handlePasswordReset() {
    setError('')
    setNotice('')
    if (!email.trim()) {
      setError('Introduce tu correo para enviarte el enlace de recuperación.')
      return
    }

    setLoading(true)
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.trim())
    setLoading(false)
    if (resetError) setError(resetError.message)
    else setNotice('Si existe una cuenta con ese correo, recibirás un enlace de recuperación.')
  }

  const isRegister = mode === 'register'

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
          {mode !== 'reset' && (
            <label className="login-field">
              <span>Contraseña</span>
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete={isRegister ? 'new-password' : 'current-password'}
                minLength={isRegister ? 6 : undefined}
                required
              />
            </label>
          )}

          {error && <p role="alert" className="login-message login-error">{error}</p>}
          {notice && <p role="status" className="login-message login-notice">{notice}</p>}

          {mode === 'reset' ? (
            <button type="button" onClick={handlePasswordReset} disabled={loading} className="login-submit">
              {loading ? 'Enviando…' : 'Enviar enlace de recuperación'}
            </button>
          ) : (
            <button type="submit" disabled={loading} className="login-submit">
              {loading ? 'Procesando…' : isRegister ? 'Crear cuenta' : 'Iniciar sesión'}
            </button>
          )}
        </form>

        <div className="login-links">
          {mode === 'login' && (
            <button type="button" onClick={() => { setMode('reset'); setError(''); setNotice('') }}>
              ¿Olvidaste tu contraseña?
            </button>
          )}
          <button type="button" onClick={() => {
            setMode(isRegister ? 'login' : 'register')
            setError('')
            setNotice('')
          }}>
            {isRegister ? 'Volver al inicio de sesión' : 'Crear cuenta nueva'}
          </button>
          {mode === 'reset' && (
            <button type="button" onClick={() => { setMode('login'); setError(''); setNotice('') }}>
              Volver al inicio de sesión
            </button>
          )}
        </div>
      </section>
    </main>
  )
}