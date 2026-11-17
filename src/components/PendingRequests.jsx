import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { ROLES, isManager } from '../lib/roles.js'
import SignupReview from './SignupReview.jsx'

// Solicitudes de alta para la coordinación (y admin). Cada persona rellena su ficha tras confirmar el correo;
// aquí se revisa: rojo = se registra como profesor (confirmar), ámbar = alumno en un curso distinto de 1º (verificar).
// Las que aún se están rellenando salen aparte y atenuadas. `schoolId` (admin) limita la lista a esa escuela.
const FLAG = {
  profesor: ['Profesor · confirmar', 'bg-danger-soft text-danger'],
  curso: ['verificar curso', 'bg-warn-soft text-warn'],
}

export default function PendingRequests({ user, schoolId = null }) {
  const [requests, setRequests] = useState([])
  const [open, setOpen] = useState(null)

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('list_signup_requests')
    if (error) return
    setRequests((data || []).filter((request) => !schoolId || request.school_id === schoolId))
  }, [schoolId])

  useEffect(() => {
    if (!isManager(user.role)) return undefined
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carga inicial: el setState ocurre tras el await
    load()
    // Las altas llegan sin aviso: se revisa cada minuto mientras el panel está abierto
    const timer = setInterval(load, 60000)
    return () => clearInterval(timer)
  }, [load, user.role])

  if (!isManager(user.role) || !requests.length) return null
  const sent = requests.filter((request) => request.form?.status === 'enviado')
  const waiting = requests.filter((request) => request.form?.status !== 'enviado')

  const row = (request, dim) => {
    const [flagText, flagTone] = FLAG[request.flag] || []
    const name = request.form?.full_name || request.email
    return (
      <li key={request.id}>
        <button type="button" onClick={() => setOpen(request)} className={`flex w-full flex-wrap items-center gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-subtle ${dim ? 'opacity-60' : ''}`}>
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium text-ink">{name}</span>
            <span className="block truncate text-xs text-muted">
              {[request.role === ROLES.TEACHER ? 'Profesor' : 'Alumno', request.email, user.role === ROLES.ADMIN && !schoolId && request.school_name,
                request.form?.submitted_at && `enviada ${new Date(request.form.submitted_at).toLocaleDateString('es-ES')}`].filter(Boolean).join(' · ')}
            </span>
          </span>
          {flagText && <span className={`badge ${flagTone}`}>{request.flag === 'curso' ? `Curso ${request.form?.level}º · ${flagText}` : flagText}</span>}
          {dim && <span className="text-xs text-muted">{request.form?.status === 'devuelto' ? 'Devuelta, pendiente de corregir' : 'Aún rellenando'}</span>}
        </button>
      </li>
    )
  }

  return (
    <section className="card">
      <div className="px-5 pb-2 pt-5">
        <h3 className="font-semibold text-ink">Solicitudes de alta {sent.length > 0 && <span className="badge ml-1">{sent.length}</span>}</h3>
        <p className="mt-1 text-sm text-muted">Revisa los datos y los módulos de cada persona: corrige lo que haga falta y apruébala, o devuélvela con un motivo.</p>
      </div>
      {sent.length > 0 && <ul className="px-2 pb-2">{sent.map((request) => row(request, false))}</ul>}
      {waiting.length > 0 && (
        <div className="px-2 pb-3">
          <p className="px-3 pb-1 text-xs font-medium text-faint">Todavía no la han enviado</p>
          <ul>{waiting.map((request) => row(request, true))}</ul>
        </div>
      )}
      {open && <SignupReview request={open} onClose={() => setOpen(null)} onDone={() => { setOpen(null); load() }} />}
    </section>
  )
}
