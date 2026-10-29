import { useState } from 'react'
import { supabase } from '../lib/supabase.js'

export default function ForgotPassword() {
  const [open, setOpen] = useState(false)
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  async function handleSubmit(event) {
    event.preventDefault()
    setBusy(true)
    setMessage('')

    const { error } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
      redirectTo: window.location.origin,
    })

    setBusy(false)
    setMessage(
      error
        ? 'No se pudo enviar el correo. Inténtalo de nuevo en unos minutos.'
        : 'Si el correo está registrado, recibirás un enlace para restablecer tu contraseña.'
    )
  }

  if (!open) {
    return (
      <button type="button" className="text-sm text-[#1e88e5] underline" onClick={() => setOpen(true)}>
        ¿Olvidaste tu contraseña?
      </button>
    )
  }

  return (
    <form className="space-y-2" onSubmit={handleSubmit}>
      <input
        className="w-full rounded border border-[#d1d5db] px-3 py-2 text-sm"
        type="email"
        placeholder="Tu correo"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        required
      />
      <button
        className="rounded bg-[#1e88e5] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1565c0] disabled:opacity-50"
        disabled={busy}
      >
        {busy ? 'Enviando...' : 'Enviar enlace'}
      </button>
      {message && <p className="text-sm text-[#6b7280]">{message}</p>}
    </form>
  )
}