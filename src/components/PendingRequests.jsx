import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { groupLabel } from '../lib/academic.js'
import { ROLES, ROLE_LABELS, isManager } from '../lib/roles.js'

// Solicitudes de alta pendientes que puede revisar el usuario:
// supervisión y admin → alumnos y profesores; profesor → alumnos de su escuela.
// Si no hay ninguna, no se muestra nada.
export default function PendingRequests({ user }) {
  const [requests, setRequests] = useState([])
  const [groups, setGroups] = useState([])
  const [groupFor, setGroupFor] = useState({})
  const [busyId, setBusyId] = useState(null)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    const { data, error: loadError } = await supabase.rpc('list_pending_profiles')
    if (loadError) return
    setRequests(data || [])
    if (!data?.some((request) => request.role === ROLES.STUDENT)) return

    // Grupos del curso actual donde se puede matricular al aprobar
    let query = supabase.from('class_groups').select('id,level,name,degrees(code),academic_years!inner(is_current)').eq('academic_years.is_current', true)
    if (!isManager(user.role)) {
      const { data: own } = await supabase.from('teaching_assignments').select('group_id').eq('profile_id', user.id)
      query = query.in('id', [...new Set((own || []).map((item) => item.group_id))])
    }
    const { data: groupRows } = await query.order('level').order('name')
    setGroups(groupRows || [])
  }, [user.id, user.role])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carga inicial: el setState ocurre tras el await
    load()
    // Las altas llegan sin aviso: se revisa cada minuto mientras el panel está abierto
    const timer = setInterval(load, 60000)
    return () => clearInterval(timer)
  }, [load])

  async function review(request, approve) {
    setBusyId(request.id)
    setError('')
    const { error: reviewError } = approve
      ? await supabase.rpc('approve_profile', { p_profile_id: request.id, p_group_id: groupFor[request.id] || null })
      : await supabase.rpc('reject_profile', { p_profile_id: request.id })
    setBusyId(null)
    if (reviewError) { setError(reviewError.message || 'No se pudo guardar. Inténtalo de nuevo.'); return }
    setRequests((current) => current.filter((item) => item.id !== request.id))
  }

  if (!requests.length) return null

  return (
    <section className="card">
      <div className="px-5 pb-2 pt-5">
        <h3 className="font-semibold text-ink">Solicitudes de acceso <span className="badge ml-1">{requests.length}</span></h3>
        <p className="mt-1 text-sm text-muted">Personas que se han registrado con el código de tu escuela.</p>
      </div>
      {error && <p role="alert" className="notice-error mx-5 mb-2">{error}</p>}
      <ul className="divide-y divide-line px-5 pb-3">
        {requests.map((request) => (
          <li key={request.id} className="flex flex-wrap items-center gap-3 py-3">
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium text-ink">{request.full_name || request.email}</span>
              <span className="block truncate text-xs text-muted">
                {[ROLE_LABELS[request.role], request.email, user.role === ROLES.ADMIN && request.school_name].filter(Boolean).join(' · ')}
              </span>
            </span>
            {request.role === ROLES.STUDENT && groups.length > 0 && (
              <select
                className="input h-9 w-auto py-0 text-sm"
                aria-label={`Grupo de ${request.full_name || request.email}`}
                value={groupFor[request.id] || ''}
                onChange={(event) => setGroupFor((current) => ({ ...current, [request.id]: event.target.value }))}
              >
                <option value="">Sin grupo</option>
                {groups.map((group) => <option key={group.id} value={group.id}>{group.degrees?.code} · {groupLabel(group)}</option>)}
              </select>
            )}
            <span className="flex gap-2">
              <button type="button" className="btn-secondary h-9" disabled={busyId === request.id} onClick={() => review(request, false)}>Rechazar</button>
              <button type="button" className="btn-primary h-9" disabled={busyId === request.id} onClick={() => review(request, true)}>Aprobar</button>
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}
