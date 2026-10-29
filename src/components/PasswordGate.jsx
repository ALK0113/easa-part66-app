import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import SetPassword from './SetPassword.jsx'
import {
  authIntent,
  isPasswordPending,
  markPasswordPending,
  clearPasswordPending,
} from '../lib/authIntent.js'

export default function PasswordGate({ children }) {
  const [pending, setPending] = useState(isPasswordPending)

  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') {
        markPasswordPending()
        setPending(true)
      }
      if (event === 'SIGNED_OUT') {
        clearPasswordPending()
        setPending(false)
      }
    })
    return () => data.subscription.unsubscribe()
  }, [])

  // El enlace del correo ha caducado o ya se usó
  if (authIntent.error) {
    return (
      <div className="mx-auto mt-16 max-w-md rounded-lg border border-[#e5e7eb] bg-white p-6 text-center shadow">
        <h1 className="mb-2 text-lg font-bold text-[#0a2540]">Enlace no válido</h1>
        <p className="mb-4 text-sm text-[#6b7280]">
          El enlace ha caducado o ya se ha usado. Pide una nueva invitación al administrador
          o usa «¿Olvidaste tu contraseña?» en la pantalla de acceso.
        </p>
        <button
          className="w-full rounded bg-[#1e88e5] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1565c0]"
          onClick={() => window.location.replace(window.location.pathname)}
        >
          Ir al inicio
        </button>
      </div>
    )
  }

  if (pending) {
    return (
      <SetPassword
        onDone={() => {
          clearPasswordPending()
          setPending(false)
        }}
      />
    )
  }

  return children
}
