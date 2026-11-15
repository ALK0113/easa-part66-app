import { useState } from 'react'
import { supabase } from '../lib/supabase.js'
import Icon from './Icon.jsx'

// Pantalla para una cuenta registrada que la escuela aún no ha aprobado o ha rechazado.
export default function PendingApproval({ user, onLogout }) {
  const [checking, setChecking] = useState(false)
  const [stillPending, setStillPending] = useState(false)
  const rejected = user.status === 'rechazado'

  async function checkAgain() {
    setChecking(true)
    setStillPending(false)
    const { data } = await supabase.from('profiles').select('status').eq('id', user.id).maybeSingle()
    setChecking(false)
    if (data?.status === 'activo') window.location.reload()
    else setStillPending(true)
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-canvas px-4 py-10">
      <section className="card fade-in w-full max-w-[420px] p-7 text-center sm:p-8">
        <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl bg-accent-soft text-accent">
          <Icon name={rejected ? 'x' : 'clock'} size={20} />
        </span>
        <h1 className="mt-4 text-xl font-semibold text-ink">
          {rejected ? 'Solicitud no aprobada' : 'Tu solicitud está en revisión'}
        </h1>
        <p className="mt-2 text-sm text-muted">
          {rejected
            ? 'Tu escuela no ha aprobado esta cuenta. Si crees que es un error, habla con la secretaría o con tu profesor.'
            : `Hola, ${(user.name || '').split(' ')[0]}. Tu escuela revisará tu cuenta en breve. Cuando la aprueben podrás entrar con tu correo y contraseña.`}
        </p>
        {stillPending && <p role="status" className="mt-4 text-sm text-ink-soft">Todavía está pendiente.</p>}
        <div className="mt-6 flex justify-center gap-2">
          <button type="button" className="btn-secondary" onClick={onLogout}>Cerrar sesión</button>
          {!rejected && <button type="button" className="btn-primary" disabled={checking} onClick={checkAgain}>{checking ? 'Comprobando…' : 'Comprobar de nuevo'}</button>}
        </div>
      </section>
    </main>
  )
}
