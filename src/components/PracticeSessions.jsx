import Icon from './Icon.jsx'
import { time } from '../lib/schedule.js'
import { formatHours, sessionHours, totalSessionHours, assignmentName } from '../lib/practiceSessions.js'

// Componentes de las sesiones de una práctica (la lógica está en src/lib/practiceSessions.js)

// Resumen de horas: rojo si faltan, verde si se llega al total
export function HoursStatus({ sessions, requiredHours, compact = false }) {
  const required = Number(requiredHours) || 0
  const planned = totalSessionHours(sessions)
  const missing = Math.max(0, required - planned)
  const complete = required > 0 && missing === 0
  const tone = complete ? 'text-success' : 'text-danger'
  if (compact) {
    return <span className={`font-medium ${tone}`} title={complete ? 'Horas completas' : `Faltan ${formatHours(missing)} h por programar`}>{formatHours(planned)}/{formatHours(required)} h</span>
  }
  return (
    <p className={`flex items-center gap-1.5 text-sm font-medium ${tone}`}>
      <Icon name={complete ? 'check' : 'clock'} size={16} />
      {formatHours(planned)} de {formatHours(required)} h programadas
      {!complete && required > 0 && <span>· faltan {formatHours(missing)} h</span>}
    </p>
  )
}

const shiftWeek = (date) => {
  if (!date) return ''
  const next = new Date(`${date}T00:00`)
  next.setDate(next.getDate() + 7)
  return next.toLocaleDateString('sv-SE')
}

// Sesión fuera del horario (recuperación, evento…): se escribe a mano
const manualSession = (sessions, assignments) => {
  const last = sessions[sessions.length - 1]
  return {
    key: Math.random().toString(36).slice(2),
    teaching_assignment_id: last?.teaching_assignment_id || assignments?.[0]?.id || '',
    date: '',
    start_time: last ? time(last.start_time) : '09:00',
    end_time: last ? time(last.end_time) : '13:00',
    note: '',
  }
}

// Editor dentro del formulario de la práctica
// Las sesiones se toman del horario del módulo (freeSessions); solo si no quedan se escriben a mano
export function SessionsEditor({ sessions, onChange, assignments, freeSessions = [], requiredHours }) {
  const required = Number(requiredHours) || 0
  const short = required > 0 && totalSessionHours(sessions) < required
  const usedIds = new Set(sessions.map((session) => session.id).filter(Boolean))
  const available = freeSessions.filter((session) => !usedIds.has(session.id))
  const fromSchedule = (session) => ({ ...session, note: session.note || '' })
  const addNext = () => onChange([...sessions, available.length ? fromSchedule(available[0]) : manualSession(sessions, assignments)])
  // Añade clases del horario seguidas hasta llegar a las horas de la práctica
  const fillHours = () => {
    const next = [...sessions]
    let planned = totalSessionHours(next)
    for (const session of available) {
      if (planned >= required) break
      next.push(fromSchedule(session))
      planned += sessionHours(session)
    }
    onChange(next)
  }
  const update = (index, patch) => onChange(sessions.map((session, i) => (i === index ? { ...session, ...patch } : session)))
  const remove = (index) => onChange(sessions.filter((_, i) => i !== index))
  // Cambiar el día de una clase del horario la convierte en clase suelta de ese día
  const changeDate = (index, date) => update(index, sessions[index].slot_id && date !== sessions[index].date ? { date, slot_id: null } : { date })
  // Copia debajo: misma clase, horas y notas, una semana después; se puede editar todo
  const duplicate = (index) => {
    const source = sessions[index]
    const copy = { key: Math.random().toString(36).slice(2), teaching_assignment_id: source.teaching_assignment_id, date: shiftWeek(source.date), start_time: time(source.start_time), end_time: time(source.end_time), note: source.note || '' }
    onChange([...sessions.slice(0, index + 1), copy, ...sessions.slice(index + 1)])
  }
  // Edición por partes: las horas de una sesión se llevan a todas
  const applyTimesToAll = (index) => {
    const { start_time: start, end_time: end } = sessions[index]
    onChange(sessions.map((session) => ({ ...session, start_time: time(start), end_time: time(end) })))
  }
  const noClasses = assignments && assignments.length === 0

  return (
    <div className="sm:col-span-2">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-medium text-ink-soft">Sesiones</span>
        <HoursStatus sessions={sessions} requiredHours={requiredHours} />
      </div>
      {noClasses && <p className="notice mb-2">Este módulo aún no tiene clase asignada este curso. Asígnalo a un grupo y profesor en «Escuela» para poder programar sesiones.</p>}
      <ul className="space-y-2">
        {sessions.map((session, index) => {
          const cancelled = session.status === 'cancelada'
          return (
            <li key={session.id || session.key} className={`rounded-xl border p-3 ${short ? 'border-danger/50 bg-danger-soft/40' : 'border-line'}`}>
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className={`text-xs font-semibold ${short ? 'text-danger' : 'text-muted'}`}>
                  Sesión {index + 1} · {formatHours(sessionHours(session))} h{cancelled ? ' · cancelada' : ''}{session.slot_id ? ' · horario del módulo' : ' · fuera de horario'}
                </span>
                <span className="flex items-center gap-0.5 text-muted">
                  {sessions.length > 1 && <button type="button" className="rounded-lg px-1.5 py-1 text-xs hover:bg-subtle hover:text-ink" onClick={() => applyTimesToAll(index)} title="Poner estas horas en todas las sesiones">Horas a todas</button>}
                  <button type="button" className="rounded-lg p-1 hover:bg-subtle hover:text-ink" onClick={() => duplicate(index)} aria-label={`Duplicar sesión ${index + 1}`} title="Duplicar (una semana después)"><Icon name="copy" size={16} /></button>
                  <button type="button" className="rounded-lg p-1 hover:bg-danger-soft hover:text-danger" onClick={() => remove(index)} aria-label={`Quitar sesión ${index + 1}`} title="Quitar"><Icon name="x" size={16} /></button>
                </span>
              </div>
              <div className="grid gap-2 sm:grid-cols-[1.4fr_1fr_1fr]">
                <label className="field text-xs">Fecha<input className="input" type="date" value={session.date || ''} onChange={(event) => changeDate(index, event.target.value)} required /></label>
                <label className="field text-xs">Inicio<input className="input" type="time" value={time(session.start_time)} onChange={(event) => update(index, { start_time: event.target.value })} required /></label>
                <label className="field text-xs">Final<input className="input" type="time" value={time(session.end_time)} onChange={(event) => update(index, { end_time: event.target.value })} required /></label>
              </div>
              {assignments && assignments.length > 1 && (
                <label className="field mt-2 text-xs">Clase
                  <select className="input" value={session.teaching_assignment_id} onChange={(event) => update(index, { teaching_assignment_id: event.target.value })} required>
                    {assignments.map((assignment) => <option key={assignment.id} value={assignment.id}>{assignmentName(assignment)}</option>)}
                  </select>
                </label>
              )}
              <label className="field mt-2 text-xs">Notas
                <textarea className="input" rows="2" maxLength={300} placeholder="Eventos ocurridos o programados, TLB a realizar, sesión de recuperación…" value={session.note || ''} onChange={(event) => update(index, { note: event.target.value })} />
              </label>
            </li>
          )
        })}
      </ul>
      <div className="mt-2 flex flex-wrap items-center gap-1">
        <button type="button" className={`btn-ghost min-h-[34px] px-2 text-xs ${short ? 'text-danger' : 'text-accent'}`} disabled={noClasses || !assignments} onClick={addNext}>
          <Icon name="plus" size={14} />{available.length ? `Añadir sesión (${new Date(`${available[0].date}T00:00`).toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' })} ${time(available[0].start_time)}–${time(available[0].end_time)})` : 'Añadir sesión'}
        </button>
        {short && available.length > 1 && <button type="button" className="btn-ghost min-h-[34px] px-2 text-xs text-danger" onClick={fillHours}><Icon name="calendar" size={14} />Completar horas con el horario</button>}
        {available.length > 0 && <button type="button" className="btn-ghost min-h-[34px] px-2 text-xs text-muted" onClick={() => onChange([...sessions, manualSession(sessions, assignments)])}>Sesión fuera de horario</button>}
      </div>
      {assignments?.length > 0 && available.length === 0 && <p className="mt-1 text-xs text-muted">No quedan clases libres en el horario del módulo: la sesión se añade a mano.</p>}
    </div>
  )
}

// Lista de solo lectura en el detalle de la práctica
export function SessionsCard({ sessions, requiredHours }) {
  return (
    <section className="card p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold text-ink">Sesiones</h3>
        <HoursStatus sessions={sessions} requiredHours={requiredHours} />
      </div>
      {sessions.length === 0
        ? <p className="text-sm text-muted">Sin sesiones programadas. Edita la práctica para añadirlas.</p>
        : <ul className="divide-y divide-line">
          {sessions.map((session, index) => (
            <li key={session.id} className="flex gap-4 py-2.5 text-sm">
              <span className="w-24 shrink-0 text-muted">Sesión {index + 1}</span>
              <span className="min-w-0 flex-1">
                <span className={`block ${session.status === 'cancelada' ? 'text-muted line-through' : 'text-ink'}`}>
                  {new Date(`${session.date}T00:00`).toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' })} · {time(session.start_time)}–{time(session.end_time)} · {formatHours(sessionHours(session))} h
                </span>
                {session.note && <span className="mt-0.5 block whitespace-pre-line text-xs text-muted">{session.note}</span>}
              </span>
            </li>
          ))}
        </ul>}
    </section>
  )
}
