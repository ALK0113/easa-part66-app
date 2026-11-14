import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import SetPassword, { InvalidLinkNotice } from './SetPassword.jsx'
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
  if (authIntent.error) return <InvalidLinkNotice />

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
