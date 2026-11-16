import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { getSupabaseErrorMessage } from '../lib/supabaseErrors.js'
import { time, toISODate } from '../lib/schedule.js'
import { SESSION_FIELDS, assignmentName, formatHours, sessionHours, useFreeModuleSessions, useModuleAssignments } from '../lib/practiceSessions.js'
import { AttendanceControl, EvaluationControl } from './RecordControls.jsx'
import { HoursStatus } from './PracticeSessions.jsx'
import Icon from './Icon.jsx'
import Modal from './Modal.jsx'

const STATUS_LABEL = { P: ['Presente', 'text-success'], L: ['Tarde', 'text-warn'], A: ['Falta', 'text-danger'] }
const EVALUATION_TONE = { Apto: 'text-success', 'No Apto': 'text-danger' }
const shortDate = (date) => new Date(`${date}T00:00`).toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' })
const longDate = (date) => {
  const text = new Date(`${date}T00:00`).toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
  return text.charAt(0).toUpperCase() + text.slice(1)
}
const isPracticeSession = (session) => Boolean(session.practice_id)
const activeSessions = (sessions) => sessions.filter((session) => session.status !== 'cancelada')

// Comentario de un alumno: se abre al pulsar y se guarda al salir del cuadro
function CommentField({ value, disabled, onSave, label }) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(value || '')
  if (!open) {
    return (
      <button type="button" className={`rounded-lg p-2 ${value ? 'text-accent' : 'text-muted'} hover:bg-subtle hover:text-ink`} disabled={disabled} onClick={() => { setDraft(value || ''); setOpen(true) }} aria-label={label} title={value ? 'Editar comentario' : 'Añadir comentario'}>
        <Icon name="edit" size={16} />
      </button>
    )
  }
  return (
    <textarea autoFocus className="input mt-2 w-full text-sm" rows="2" maxLength={1000} aria-label={label} placeholder="Comentario para el alumno en esta sesión…" value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => { setOpen(false); if ((draft.trim() || null) !== (value || null)) onSave(draft) }} />
  )
}

// Lista de una sesión: asistencia, Apto/No apto de la sesión (solo prácticas) y comentario por alumno.
export function AttendanceSheet({ session, onRoster, onSaved }) {
  const [rows, setRows] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState(null)
  const cancelled = session.status === 'cancelada'
  const evaluates = isPracticeSession(session)

  const apply = useCallback((next) => { setRows(next); onRoster?.(next) }, [onRoster])
  const fetchRows = useCallback(() => supabase.rpc('sessions_sheet', { p_session_ids: [session.id] }), [session.id])

  useEffect(() => {
    let active = true
    fetchRows().then(({ data, error: loadError }) => {
      if (!active) return
      if (loadError) setError(getSupabaseErrorMessage(loadError))
      else apply(data || [])
    })
    return () => { active = false }
  }, [fetchRows, apply])

  async function reload() {
    const { data, error: loadError } = await fetchRows()
    if (loadError) setError(getSupabaseErrorMessage(loadError))
    else apply(data || [])
  }

  async function mark(studentIds, status) {
    if (!studentIds.length) return
    setBusy(true)
    // Una falta quita el Apto/No apto de la sesión (se recupera en una sesión extra)
    apply(rows.map((row) => (studentIds.includes(row.student_id) ? { ...row, status: status || null, evaluation: status === 'A' ? null : row.evaluation } : row)))
    const { error: saveError } = await supabase.rpc('set_session_attendance', { p_session_id: session.id, p_student_ids: studentIds, p_status: status || null })
    if (saveError) { setError(getSupabaseErrorMessage(saveError)); await reload() } else onSaved?.()
    setBusy(false)
  }

  async function saveRecord(row, patch) {
    const next = { ...row, ...patch }
    apply(rows.map((item) => (item.student_id === row.student_id ? next : item)))
    const { error: saveError } = await supabase.rpc('set_session_record', { p_session_id: session.id, p_student_id: row.student_id, p_evaluation: next.evaluation || null, p_comment: next.comment || null })
    if (saveError) { setError(getSupabaseErrorMessage(saveError)); await reload() } else onSaved?.()
  }

  const marked = rows?.filter((row) => row.status).length || 0
  const evaluated = rows?.filter((row) => row.evaluation).length || 0
  return (
    <section className="card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 px-5 pb-3 pt-5">
        <div>
          <h3 className="font-semibold text-ink">{evaluates ? 'Asistencia y evaluación de la sesión' : 'Asistencia'}</h3>
          <p className="mt-0.5 text-xs text-muted">
            {rows ? `${marked}/${rows.length} con asistencia${evaluates ? ` · ${evaluated}/${rows.length} evaluados` : ''}` : ''} · se guarda al instante
          </p>
        </div>
        {rows?.length > 0 && !cancelled && (
          <button type="button" className="btn-secondary min-h-[36px] px-3 text-xs" disabled={busy || marked === rows.length} onClick={() => mark(rows.filter((row) => !row.status).map((row) => row.student_id), 'P')}>
            <Icon name="check" size={14} className="text-success" />Resto presentes
          </button>
        )}
      </div>
      {error && <p role="alert" className="notice-error mx-5 mb-3">{error}</p>}
      {cancelled && <p className="notice mx-5 mb-3">Sesión cancelada: no se pasa lista.</p>}
      {rows === null && !error && <p className="px-5 pb-5 text-sm text-muted">Cargando lista…</p>}
      {rows?.length === 0 && <p className="px-5 pb-5 text-sm text-muted">{session.recovery ? 'Esta recuperación no tiene alumnos.' : 'No hay alumnos en esta clase. Se matriculan en Escuela → Alumnos.'}</p>}
      {rows?.length > 0 && (
        <ul className="divide-y divide-line border-t border-line">
          {rows.map((row) => (
            <li key={row.student_id} className="px-5 py-3">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <span className="min-w-[150px] flex-1">
                  <span className="block text-sm font-medium text-ink">{row.name}</span>
                  {row.comment && editing !== row.student_id && <span className="mt-0.5 block whitespace-pre-line text-xs text-muted">{row.comment}</span>}
                </span>
                <AttendanceControl value={row.status} disabled={busy || cancelled} onChange={(status) => mark([row.student_id], status === row.status ? null : status)} />
                {evaluates && (row.status === 'A'
                  ? <span className="w-[150px] text-xs text-danger" title="No se evalúa a quien faltó">Falta · se recupera en una sesión extra</span>
                  : <EvaluationControl value={row.evaluation} disabled={cancelled} onChange={(value) => saveRecord(row, { evaluation: value || null })} />)}
                <span onFocus={() => setEditing(row.student_id)} onBlur={() => setEditing(null)}>
                  <CommentField value={row.comment} disabled={cancelled} label={`Comentario de ${row.name}`} onSave={(comment) => saveRecord(row, { comment: comment.trim() || null })} />
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

// Quitar una sesión de su clase: la del horario sigue en el horario como clase normal; la suelta o de recuperación se borra
async function removeSessionFromClass(session) {
  const fromSchedule = Boolean(session.slot_id)
  const text = fromSchedule
    ? '¿Quitar esta sesión de la clase? Seguirá en el horario como clase normal; se conservan la lista y los comentarios.'
    : '¿Eliminar esta sesión? Se borran su lista, evaluaciones y comentarios.'
  if (!window.confirm(text)) return false
  const owner = session.practice_id ? { practice_id: null } : { theory_class_id: null }
  const { error } = fromSchedule
    ? await supabase.from('class_sessions').update(owner).eq('id', session.id)
    : await supabase.from('class_sessions').delete().eq('id', session.id)
  if (error) throw error
  return true
}

// Añadir una sesión desde el detalle: una clase libre del horario del módulo o una sesión fuera de horario
function AddSession({ owner, moduleId, user, onAdded, onCancel }) {
  const assignments = useModuleAssignments(moduleId, user)
  const free = useFreeModuleSessions(assignments)
  const [mode, setMode] = useState('horario')
  const [slotId, setSlotId] = useState('')
  const [manual, setManual] = useState({ teaching_assignment_id: '', date: toISODate(new Date()), start_time: '09:00', end_time: '10:00' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const chosenSlot = slotId || free[0]?.id || ''
  const useSchedule = mode === 'horario' && free.length > 0

  async function add(event) {
    event.preventDefault()
    setBusy(true)
    setError('')
    const { error: saveError } = useSchedule
      ? await supabase.from('class_sessions').update(owner).eq('id', chosenSlot)
      : await supabase.from('class_sessions').insert({ ...manual, teaching_assignment_id: manual.teaching_assignment_id || assignments?.[0]?.id, ...owner })
    setBusy(false)
    if (saveError) { setError(getSupabaseErrorMessage(saveError)); return }
    onAdded()
  }

  if (assignments === null) return <p className="mt-3 text-sm text-muted">Cargando horario…</p>
  if (!assignments.length) return <p className="notice mt-3">Este módulo no tiene clase en el horario este curso. Asígnalo a un grupo y profesor en «Escuela».</p>
  return (
    <form className="mt-3 space-y-3 rounded-xl border border-line bg-subtle/40 p-3" onSubmit={add}>
      <div className="flex flex-wrap gap-1.5 text-xs" role="radiogroup" aria-label="Tipo de sesión">
        {[['horario', 'Del horario'], ['fuera', 'Fuera de horario']].map(([id, label]) => (
          <button key={id} type="button" role="radio" aria-checked={(id === 'horario') === useSchedule} disabled={id === 'horario' && !free.length} onClick={() => setMode(id)}
            className={`rounded-lg border px-2.5 py-1 font-medium disabled:opacity-40 ${(id === 'horario') === useSchedule ? 'border-accent bg-accent-soft text-accent-strong' : 'border-line text-ink-soft hover:bg-subtle'}`}>{label}</button>
        ))}
      </div>
      {useSchedule ? (
        <select className="input" aria-label="Clase libre del horario" value={chosenSlot} onChange={(event) => setSlotId(event.target.value)}>
          {free.slice(0, 60).map((item) => <option key={item.id} value={item.id}>{shortDate(item.date)} · {time(item.start_time)}–{time(item.end_time)}</option>)}
        </select>
      ) : (
        <div className="grid gap-2 sm:grid-cols-3">
          <label className="field text-xs">Fecha<input className="input" type="date" required value={manual.date} onChange={(event) => setManual({ ...manual, date: event.target.value })} /></label>
          <label className="field text-xs">Inicio<input className="input" type="time" required value={manual.start_time} onChange={(event) => setManual({ ...manual, start_time: event.target.value })} /></label>
          <label className="field text-xs">Final<input className="input" type="time" required value={manual.end_time} onChange={(event) => setManual({ ...manual, end_time: event.target.value })} /></label>
          {assignments.length > 1 && (
            <label className="field text-xs sm:col-span-3">Clase
              <select className="input" value={manual.teaching_assignment_id || assignments[0].id} onChange={(event) => setManual({ ...manual, teaching_assignment_id: event.target.value })}>
                {assignments.map((item) => <option key={item.id} value={item.id}>{assignmentName(item)}</option>)}
              </select>
            </label>
          )}
        </div>
      )}
      {error && <p role="alert" className="notice-error">{error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" className="btn-ghost min-h-[34px] px-3 text-xs" onClick={onCancel}>Cancelar</button>
        <button type="submit" className="btn-primary min-h-[34px] px-3 text-xs" disabled={busy || (useSchedule && !chosenSlot)}>{busy ? 'Añadiendo…' : 'Añadir sesión'}</button>
      </div>
    </form>
  )
}

// Página de una sesión (desde el detalle de la clase): datos, comentario de la sesión y lista.
export function SessionPage({ session, index, className, canEdit, onBack, onChanged, onRemoved }) {
  const [note, setNote] = useState(session.note || '')
  const [saved, setSaved] = useState('')
  const [error, setError] = useState('')
  const cancelled = session.status === 'cancelada'

  async function removeSession() {
    try {
      if (await removeSessionFromClass(session)) onRemoved?.()
    } catch (removeError) {
      setError(getSupabaseErrorMessage(removeError))
    }
  }

  async function saveNote() {
    setError('')
    const { error: saveError } = await supabase.from('class_sessions').update({ note: note.trim() || null }).eq('id', session.id)
    if (saveError) { setError(getSupabaseErrorMessage(saveError)); return }
    setSaved('Comentario guardado.')
    onChanged?.()
  }

  return (
    <div className="space-y-5">
      <button type="button" className="back-link" onClick={onBack}>← {className}</button>
      <section>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <p className="text-sm text-muted">{className} · {session.recovery ? `Recuperación ${index + 1}` : `Sesión ${index + 1}`}{isPracticeSession(session) ? ' · práctica' : ' · teoría'}</p>
          {canEdit && onRemoved && <button type="button" className="btn-ghost min-h-[32px] px-2 text-xs text-danger" onClick={removeSession}><Icon name="trash" size={14} />{session.slot_id ? 'Quitar de la clase' : 'Eliminar sesión'}</button>}
        </div>
        <h2 className={`mt-1 text-2xl font-semibold ${cancelled ? 'text-muted line-through' : 'text-ink'}`}>{longDate(session.date)}</h2>
        <p className="mt-1 text-sm text-muted">{time(session.start_time)}–{time(session.end_time)} · {formatHours(sessionHours(session))} h{cancelled ? ' · cancelada' : ''}</p>
      </section>
      <section className="card p-5">
        <h3 className="mb-2 text-sm font-semibold text-ink">Comentario de la sesión</h3>
        {canEdit ? (
          <>
            <textarea className="input w-full" rows="3" maxLength={300} placeholder="Qué se ha hecho, incidencias, TLB realizados, recuperación…" value={note} onChange={(event) => { setNote(event.target.value); setSaved('') }} />
            <div className="mt-2 flex items-center justify-end gap-3">
              {saved && <span role="status" className="text-xs text-success">{saved}</span>}
              {error && <span role="alert" className="text-xs text-danger">{error}</span>}
              <button type="button" className="btn-secondary" disabled={(note.trim() || '') === (session.note || '')} onClick={saveNote}>Guardar comentario</button>
            </div>
          </>
        ) : <p className="whitespace-pre-line text-sm text-ink-soft">{session.note || 'Sin comentario.'}</p>}
      </section>
      {canEdit && <AttendanceSheet session={session} />}
    </div>
  )
}

// Sesiones de una clase con el estado de la lista de cada una. El personal entra en la página
// de la sesión; el alumno ve aquí su asistencia, su evaluación y el comentario de cada sesión.
export function ClassSessions({ sessions: allSessions, requiredHours, canEdit, isStudent, editHint, onOpenSession, owner, moduleId, user, onSessionsChanged }) {
  const [rows, setRows] = useState(null)
  const [adding, setAdding] = useState(false)
  const manage = canEdit && owner && onSessionsChanged
  const [ownRecoveries, setOwnRecoveries] = useState(null)
  const [error, setError] = useState('')
  const key = allSessions.map((session) => session.id).join(',')

  useEffect(() => {
    if (!key || (!canEdit && !isStudent)) return undefined
    let active = true
    const sessionIds = key.split(',')
    const request = canEdit
      ? supabase.rpc('sessions_sheet', { p_session_ids: sessionIds })
      : supabase.from('session_attendance').select('session_id,student_id,status,evaluation,comment').in('session_id', sessionIds)
    request.then(({ data, error: loadError }) => {
      if (!active) return
      if (loadError) setError(getSupabaseErrorMessage(loadError))
      else setRows(data || [])
    })
    // El alumno solo ve las recuperaciones en las que está
    if (!canEdit) {
      supabase.from('session_recovery_students').select('session_id').in('session_id', sessionIds)
        .then(({ data }) => { if (active) setOwnRecoveries(new Set((data || []).map((row) => row.session_id))) })
    }
    return () => { active = false }
  }, [key, canEdit, isStudent])
  const sessions = canEdit ? allSessions : allSessions.filter((session) => !session.recovery || ownRecoveries?.has(session.id))
  const numberOf = (session) => sessions.filter((item) => item.recovery === session.recovery).indexOf(session) + 1

  const today = toISODate(new Date())
  const ofSession = (id) => (rows || []).filter((row) => row.session_id === id)

  const staffStatus = (session) => {
    if (session.status === 'cancelada') return [['Cancelada', 'text-muted']]
    if (!rows) return []
    const list = ofSession(session.id)
    if (!list.length) return [['Sin alumnos', 'text-muted']]
    const marked = list.filter((row) => row.status).length
    const evaluated = list.filter((row) => row.evaluation).length
    const absent = list.filter((row) => row.status === 'A').length
    const evaluable = list.length - absent
    const past = session.date <= today
    const out = [marked === list.length ? [`Lista ${marked}/${list.length}`, 'text-success'] : past ? [`Falta pasar lista · ${marked}/${list.length}`, 'text-danger'] : ['Pendiente', 'text-faint']]
    if (isPracticeSession(session) && (past || evaluated)) out.push([`Evaluados ${evaluated}/${evaluable}`, evaluated === evaluable ? 'text-success' : 'text-danger'])
    if (isPracticeSession(session) && absent) out.push([absent === 1 ? '1 falta a recuperar' : `${absent} faltas a recuperar`, 'text-warn'])
    return out
  }

  const summary = canEdit && rows ? Object.values(rows.reduce((acc, row) => {
    const session = sessions.find((item) => item.id === row.session_id)
    if (!session || session.status === 'cancelada') return acc
    const item = acc[row.student_id] || (acc[row.student_id] = { id: row.student_id, name: row.name, P: 0, L: 0, A: 0, pending: 0, apto: 0, noApto: 0 })
    if (row.status) item[row.status] += 1
    else if (session.date <= today) item.pending += 1
    if (row.evaluation === 'Apto') item.apto += 1
    if (row.evaluation === 'No Apto') item.noApto += 1
    return acc
  }, {})).sort((a, b) => a.name.localeCompare(b.name, 'es')) : []
  const hasPractice = sessions.some(isPracticeSession)
  const pendingLists = canEdit && rows ? activeSessions(sessions).filter((session) => session.date <= today && ofSession(session.id).some((row) => !row.status)).length : 0

  return (
    <section className="card p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold text-ink">Sesiones</h3>
        <span className="flex flex-wrap items-center gap-3">
          <HoursStatus sessions={sessions} requiredHours={requiredHours} />
          {manage && <button type="button" className="rounded-lg border border-line p-1.5 text-accent hover:bg-accent-soft" onClick={() => setAdding((value) => !value)} aria-label="Añadir sesión" title="Añadir sesión"><Icon name="plus" size={14} /></button>}
        </span>
      </div>
      {error && <p role="alert" className="notice-error mb-2">{error}</p>}
      {adding && manage && <AddSession owner={owner} moduleId={moduleId} user={user} onCancel={() => setAdding(false)} onAdded={() => { setAdding(false); onSessionsChanged() }} />}
      {pendingLists > 0 && <p className="notice-error mb-3">{pendingLists === 1 ? 'Hay 1 sesión pasada sin lista completa.' : `Hay ${pendingLists} sesiones pasadas sin lista completa.`}</p>}
      {sessions.length === 0
        ? <p className="text-sm text-danger">Sin programar en el horario. {editHint}</p>
        : <ul className="divide-y divide-line">
          {sessions.map((session) => {
            const own = isStudent && !canEdit ? ofSession(session.id)[0] : null
            const content = (
              <>
                <span className={`w-24 shrink-0 ${session.recovery ? 'font-medium text-warn' : 'text-muted'}`}>{session.recovery ? `Recuperación ${numberOf(session)}` : `Sesión ${numberOf(session)}`}</span>
                <span className="min-w-0 flex-1">
                  <span className={`block ${session.status === 'cancelada' ? 'text-muted line-through' : 'text-ink'}`}>
                    {shortDate(session.date)} · {time(session.start_time)}–{time(session.end_time)} · {formatHours(sessionHours(session))} h{session.recovery && canEdit && rows ? ` · ${ofSession(session.id).length} ${ofSession(session.id).length === 1 ? 'alumno' : 'alumnos'}` : ''}
                  </span>
                  {session.note && <span className="mt-0.5 block whitespace-pre-line text-xs text-muted">{session.note}</span>}
                  {own?.comment && <span className="mt-1 block whitespace-pre-line text-xs text-ink-soft">Comentario: {own.comment}</span>}
                </span>
                {canEdit && staffStatus(session).map(([label, tone]) => <span key={label} className={`text-xs font-medium ${tone}`}>{label}</span>)}
                {isStudent && !canEdit && session.status !== 'cancelada' && (
                  <span className="flex gap-3 text-xs font-medium">
                    {own?.status ? <span className={STATUS_LABEL[own.status][1]}>{STATUS_LABEL[own.status][0]}</span> : <span className="text-faint">{session.date <= today ? 'Sin registrar' : 'Pendiente'}</span>}
                    {own?.evaluation && <span className={EVALUATION_TONE[own.evaluation]}>{own.evaluation === 'No Apto' ? 'No apto' : 'Apto'}</span>}
                  </span>
                )}
                {canEdit && <Icon name="next" size={16} className="text-faint" />}
              </>
            )
            return (
              <li key={session.id} className="flex items-center gap-1">
                {canEdit && onOpenSession
                  ? <button type="button" className="-ml-2 flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-1 rounded-xl px-2 py-2.5 text-left text-sm hover:bg-subtle" onClick={() => onOpenSession(session.id)}>{content}</button>
                  : <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-1 py-2.5 text-sm">{content}</div>}
                {manage && (
                  <button type="button" className="shrink-0 rounded-lg p-1.5 text-danger/70 hover:bg-danger-soft hover:text-danger" aria-label={`Eliminar ${session.recovery ? 'recuperación' : 'sesión'} del ${shortDate(session.date)}`} title="Eliminar sesión"
                    onClick={async () => { try { if (await removeSessionFromClass(session)) onSessionsChanged() } catch (removeError) { setError(getSupabaseErrorMessage(removeError)) } }}>
                    <Icon name="trash" size={14} />
                  </button>
                )}
              </li>
            )
          })}
        </ul>}

      {canEdit && summary.length > 0 && (
        <details className="mt-4 rounded-xl border border-line">
          <summary className="cursor-pointer px-4 py-2.5 text-sm font-medium text-ink">Asistencia por alumno</summary>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted"><tr><th className="px-4 py-2 text-left font-medium">Alumno</th><th className="px-2 py-2 font-medium">Presente</th><th className="px-2 py-2 font-medium">Tarde</th><th className="px-2 py-2 font-medium">Falta</th>{hasPractice && <th className="px-2 py-2 font-medium">Aptos</th>}<th className="px-4 py-2 text-right font-medium">Asistencia</th></tr></thead>
              <tbody className="divide-y divide-line">
                {summary.map((item) => {
                  const markedCount = item.P + item.L + item.A
                  const rate = markedCount ? Math.round(((item.P + item.L) / markedCount) * 100) : null
                  return (
                    <tr key={item.id}>
                      <td className="px-4 py-2 text-ink">{item.name}</td>
                      <td className="px-2 py-2 text-center tabular-nums">{item.P}</td>
                      <td className="px-2 py-2 text-center tabular-nums">{item.L}</td>
                      <td className={`px-2 py-2 text-center tabular-nums ${item.A ? 'font-semibold text-danger' : ''}`}>{item.A}</td>
                      {hasPractice && <td className={`px-2 py-2 text-center tabular-nums ${item.noApto ? 'text-danger' : ''}`}>{item.apto}{item.noApto ? ` · ${item.noApto} no` : ''}</td>}
                      <td className="px-4 py-2 text-right tabular-nums">{rate === null ? '—' : `${rate}%`}{item.pending ? <span className="text-xs text-danger"> · {item.pending} sin marcar</span> : null}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </section>
  )
}

// Nota general de la práctica por alumno: se habilita cuando todas sus sesiones están evaluadas.
// Estado de un alumno en la práctica: sesiones sin evaluar, faltas y recuperaciones
function practiceProgress(rows, sessions, studentId) {
  const ownRow = (session) => rows.find((row) => row.session_id === session.id && row.student_id === studentId)
  const regular = sessions.filter((session) => !session.recovery).map((session) => ownRow(session)).filter(Boolean)
  const recovery = sessions.filter((session) => session.recovery).map((session) => ownRow(session)).filter(Boolean)
  const pending = regular.filter((row) => !row.evaluation && row.status !== 'A').length
  const absences = regular.filter((row) => row.status === 'A').length
  const recovered = recovery.filter((row) => row.evaluation).length
  const toRecover = Math.max(0, absences - recovered)
  return { regular, recovery, pending, toRecover, complete: regular.length > 0 && pending === 0 && toRecover === 0 }
}

function SessionChip({ row, label }) {
  const absent = row.status === 'A'
  const tone = absent ? 'text-danger' : row.evaluation ? EVALUATION_TONE[row.evaluation] : 'text-faint'
  const mark = absent ? 'falta' : row.evaluation === 'Apto' ? '✓' : row.evaluation === 'No Apto' ? '✗' : '·'
  return <span className={`rounded-md border border-line px-1.5 py-0.5 ${tone}`}>{label} {mark}</span>
}

// Nota general de la práctica por alumno: se habilita cuando todas sus sesiones están evaluadas
// y cada falta está recuperada en una sesión extra.
export function PracticeResults({ practice, sessions, students, records, canEdit, onSessionsChanged }) {
  const [rows, setRows] = useState(null)
  const [results, setResults] = useState(() => Object.fromEntries(records.map((record) => [record.student_id, { evaluation: record.evaluation || null, comment: record.comment || '' }])))
  const [error, setError] = useState('')
  const [recoveryOpen, setRecoveryOpen] = useState(false)
  const active = activeSessions(sessions)
  const key = active.map((session) => session.id).join(',')

  useEffect(() => {
    if (!key) return undefined
    let alive = true
    supabase.rpc('sessions_sheet', { p_session_ids: key.split(',') }).then(({ data, error: loadError }) => {
      if (!alive) return
      if (loadError) setError(getSupabaseErrorMessage(loadError))
      else setRows(data || [])
    })
    return () => { alive = false }
  }, [key])

  async function save(studentId, patch) {
    const previous = results[String(studentId)] || { evaluation: null, comment: '' }
    const next = { ...previous, ...patch }
    setResults((current) => ({ ...current, [String(studentId)]: next }))
    setError('')
    const { error: saveError } = await supabase.rpc('set_practice_result', { p_student_id: studentId, p_practice_id: practice.id, p_evaluation: next.evaluation || null, p_comment: next.comment || null })
    if (saveError) { setError(getSupabaseErrorMessage(saveError)); setResults((current) => ({ ...current, [String(studentId)]: previous })) }
  }

  const progress = (studentId) => practiceProgress(rows || [], active, studentId)
  const needRecovery = rows ? students.filter((student) => progress(student.id).toRecover > 0) : []

  return (
    <section className="card overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-3 px-5 pb-3 pt-5">
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold text-ink">Nota general de la práctica</h3>
          <p className="mt-0.5 text-xs text-muted">Cada sesión se evalúa en su página. Quien falta no se evalúa en esa sesión: la recupera en una sesión extra. Con todo evaluado y recuperado se pone la nota general, que es la que ve el alumno en su listado.</p>
        </div>
        {canEdit && rows && <button type="button" className={`btn-secondary min-h-[36px] px-3 text-xs ${needRecovery.length ? 'text-warn' : ''}`} onClick={() => setRecoveryOpen(true)}><Icon name="plus" size={14} />Sesión de recuperación{needRecovery.length ? ` · ${needRecovery.length}` : ''}</button>}
      </div>
      {error && <p role="alert" className="notice-error mx-5 mb-3">{error}</p>}
      {rows === null && key && !error && <p className="px-5 pb-5 text-sm text-muted">Cargando…</p>}
      {rows && (
        <ul className="divide-y divide-line border-t border-line">
          {students.map((student) => {
            const state = progress(student.id)
            const result = results[String(student.id)] || { evaluation: null, comment: '' }
            const status = state.complete
              ? ['Sesiones completas', 'text-success']
              : [[state.pending && `${state.pending} sin evaluar`, state.toRecover && `${state.toRecover} por recuperar`].filter(Boolean).join(' · ') || 'Sin sesiones', state.toRecover ? 'text-warn' : 'text-muted']
            return (
              <li key={student.id} className="px-5 py-3.5">
                <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
                  <div className="min-w-[160px] flex-1">
                    <p className="font-medium text-ink">{student.name}</p>
                    <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
                      {state.regular.map((row, index) => <SessionChip key={row.session_id} row={row} label={`S${index + 1}`} />)}
                      {state.recovery.map((row, index) => <SessionChip key={row.session_id} row={row} label={`R${index + 1}`} />)}
                      <span className={status[1]}>{status[0]}</span>
                    </p>
                  </div>
                  <span title={state.complete ? '' : 'Se habilita al evaluar todas las sesiones y recuperar las faltas'}>
                    <EvaluationControl value={result.evaluation} disabled={!canEdit || (!state.complete && !result.evaluation)} onChange={(value) => save(student.id, { evaluation: value || null })} />
                  </span>
                </div>
                {canEdit && (state.complete || result.evaluation || result.comment) && (
                  <textarea className="input mt-2 w-full text-sm" rows="1" maxLength={2000} placeholder="Comentario general de la práctica…" aria-label={`Comentario general de ${student.name}`}
                    defaultValue={result.comment}
                    onBlur={(event) => { if (event.target.value.trim() !== (result.comment || '')) save(student.id, { comment: event.target.value.trim() }) }} />
                )}
              </li>
            )
          })}
        </ul>
      )}
      {students.length === 0 && <p className="empty">No hay alumnos matriculados en este módulo.</p>}
      {recoveryOpen && rows && (
        <RecoveryForm practice={practice} sessions={active} rows={rows} preselected={needRecovery.map((student) => student.id)}
          onClose={() => setRecoveryOpen(false)}
          onSaved={() => { setRecoveryOpen(false); onSessionsChanged?.() }} />
      )}
    </section>
  )
}

// Sesión extra para recuperar faltas: solo los alumnos elegidos están en su lista y no suma horas
function RecoveryForm({ practice, sessions, rows, preselected, onClose, onSaved }) {
  const regular = sessions.filter((session) => !session.recovery)
  const last = regular[regular.length - 1]
  // Alumnos de las sesiones normales y la clase (grupo) en la que están
  const candidates = []
  regular.forEach((session) => rows.filter((row) => row.session_id === session.id).forEach((row) => {
    if (!candidates.some((item) => item.id === row.student_id)) candidates.push({ id: row.student_id, name: row.name, assignment: session.teaching_assignment_id })
  }))
  candidates.sort((a, b) => a.name.localeCompare(b.name, 'es'))
  const [form, setForm] = useState({ date: toISODate(new Date()), start: last ? time(last.start_time) : '09:00', end: last ? time(last.end_time) : '10:00', note: '' })
  const [chosen, setChosen] = useState(() => new Set(preselected))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit(event) {
    event.preventDefault()
    if (!chosen.size) { setError('Elige al menos un alumno.'); return }
    if (form.end <= form.start) { setError('La hora de final debe ser posterior a la de inicio.'); return }
    setBusy(true)
    setError('')
    // Una recuperación por clase (grupo), por si hay alumnos de varios grupos
    const byAssignment = new Map()
    candidates.filter((item) => chosen.has(item.id)).forEach((item) => byAssignment.set(item.assignment, [...(byAssignment.get(item.assignment) || []), item.id]))
    for (const [assignment, studentIds] of byAssignment) {
      const { error: saveError } = await supabase.rpc('add_recovery_session', { p_practice_id: practice.id, p_assignment_id: assignment, p_date: form.date, p_start: form.start, p_end: form.end, p_student_ids: studentIds, p_note: form.note || null })
      if (saveError) { setBusy(false); setError(getSupabaseErrorMessage(saveError)); return }
    }
    setBusy(false)
    onSaved()
  }

  return (
    <Modal title="Sesión de recuperación" onClose={onClose}>
      <form className="space-y-4" onSubmit={submit}>
        <p className="text-sm text-muted">{practice.title}. Solo los alumnos elegidos estarán en la lista; no suma horas a la práctica.</p>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="field">Día<input className="input" type="date" required value={form.date} onChange={(event) => setForm({ ...form, date: event.target.value })} /></label>
          <label className="field">Empieza<input className="input" type="time" required value={form.start} onChange={(event) => setForm({ ...form, start: event.target.value })} /></label>
          <label className="field">Termina<input className="input" type="time" required value={form.end} onChange={(event) => setForm({ ...form, end: event.target.value })} /></label>
        </div>
        <fieldset>
          <legend className="mb-1.5 text-sm font-medium text-ink-soft">Alumnos <span className="font-normal text-muted">· marcados los que tienen faltas sin recuperar</span></legend>
          <ul className="max-h-64 divide-y divide-line overflow-y-auto rounded-xl border border-line">
            {candidates.map((item) => (
              <li key={item.id}>
                <label className="flex cursor-pointer items-center gap-3 px-4 py-2 text-sm hover:bg-subtle">
                  <input type="checkbox" checked={chosen.has(item.id)} onChange={(event) => setChosen((current) => { const next = new Set(current); if (event.target.checked) next.add(item.id); else next.delete(item.id); return next })} />
                  <span className="text-ink">{item.name}</span>
                  {preselected.includes(item.id) && <span className="ml-auto text-xs text-warn">falta por recuperar</span>}
                </label>
              </li>
            ))}
          </ul>
        </fieldset>
        <label className="field">Nota<textarea className="input" rows="2" maxLength={300} placeholder="Qué se recupera…" value={form.note} onChange={(event) => setForm({ ...form, note: event.target.value })} /></label>
        {error && <p role="alert" className="notice-error">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancelar</button>
          <button type="submit" className="btn-primary" disabled={busy}>{busy ? 'Creando…' : `Crear recuperación${chosen.size ? ` · ${chosen.size}` : ''}`}</button>
        </div>
      </form>
    </Modal>
  )
}

// Vista del alumno de una práctica: su nota general, comentario general y cada sesión.
export function StudentPracticeResult({ record }) {
  const evaluation = record?.evaluation
  return (
    <section className="card p-5">
      <h3 className="text-sm font-semibold text-ink">Nota de la práctica</h3>
      <p className={`mt-1 text-2xl font-semibold ${evaluation ? EVALUATION_TONE[evaluation] : 'text-faint'}`}>{evaluation ? (evaluation === 'No Apto' ? 'No apto' : 'Apto') : 'Pendiente'}</p>
      {record?.comment && <p className="mt-2 whitespace-pre-line text-sm text-ink-soft">{record.comment}</p>}
    </section>
  )
}

// Sesiones de una práctica vistas por el alumno (asistencia, Apto/No apto y comentario de cada una)
export function StudentPracticeSessions({ practiceId, requiredHours }) {
  const [sessions, setSessions] = useState(null)
  useEffect(() => {
    let active = true
    supabase.from('class_sessions').select(SESSION_FIELDS).eq('practice_id', practiceId).order('date').order('start_time')
      .then(({ data }) => { if (active) setSessions(data || []) })
    return () => { active = false }
  }, [practiceId])
  if (!sessions) return <p className="text-sm text-muted">Cargando sesiones…</p>
  return <ClassSessions sessions={sessions} requiredHours={requiredHours} canEdit={false} isStudent />
}
