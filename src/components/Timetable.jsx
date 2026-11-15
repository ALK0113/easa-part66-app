import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { useSchool } from '../contexts/useSchool.js'
import { subscribeToTables } from '../lib/supabaseRealtime.js'
import { getSupabaseErrorMessage } from '../lib/supabaseErrors.js'
import { KIND_LABEL, groupLabel } from '../lib/academic.js'
import { ROLES, isManager, teachesLikeProfessor } from '../lib/roles.js'
import { WEEKDAYS, addDays, fetchSessions, parseISODate, startOfWeek, time, toISODate } from '../lib/schedule.js'
import { AttendanceControl } from './RecordControls.jsx'
import Icon from './Icon.jsx'
import Modal from './Modal.jsx'

// Horario semanal. Profesor: sus clases y pasar lista. Alumno: sus clases.
// Administración: por grupo o por profesor, y la plantilla semanal de cada grupo.

const assignmentLabel = (assignment) => assignment
  ? `${assignment.degree_modules?.module_id} ${KIND_LABEL[assignment.degree_modules?.kind]?.toLowerCase() || ''}`
  : ''

export default function Timetable({ user }) {
  const isAdmin = isManager(user.role)
  // El profesor también edita la plantilla semanal, pero solo de sus clases
  const canEditTemplate = isAdmin || teachesLikeProfessor(user.role)
  const [tab, setTab] = useState('week')

  return (
    <div className="space-y-5">
      <div className="page-intro">
        <div>
          <h2>Horario</h2>
          <p>{user.role === ROLES.STUDENT ? 'Tus clases de la semana.' : user.role === ROLES.TEACHER ? 'Tus clases. Toca una para pasar lista.' : 'Clases de cada grupo y profesor.'}</p>
        </div>
      </div>
      {canEditTemplate && (
        <div className="tabs" role="tablist">
          <button type="button" role="tab" className="tab" aria-selected={tab === 'week'} onClick={() => setTab('week')}>Semana</button>
          <button type="button" role="tab" className="tab" aria-selected={tab === 'template'} onClick={() => setTab('template')}>Plantilla semanal</button>
        </div>
      )}
      {tab === 'week' ? <WeekView user={user} /> : <TemplateEditor user={user} />}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Datos comunes de administración: grupos actuales y asignaciones      */
/* ------------------------------------------------------------------ */

function useCurrentAssignments(enabled, profileId) {
  const { filterId } = useSchool()
  const [state, setState] = useState({ groups: [], teachers: [], assignments: [] })
  useEffect(() => {
    if (!enabled) return undefined
    let active = true
    async function load() {
      const [groups, assignments] = await Promise.all([
        (() => {
          const query = supabase.from('class_groups').select('id,level,name,academic_years!inner(is_current,name,school_id)').eq('academic_years.is_current', true).order('level').order('name')
          return filterId ? query.eq('academic_years.school_id', filterId) : query
        })(),
        (() => {
          let query = supabase.from('teaching_assignments').select('id,profile_id,group_id,degree_module_id,profiles(full_name,email),class_groups!inner(level,name,academic_years!inner(is_current,school_id)),degree_modules(module_id,kind)').eq('class_groups.academic_years.is_current', true)
          if (profileId) query = query.eq('profile_id', profileId)
          if (filterId) query = query.eq('class_groups.academic_years.school_id', filterId)
          return query
        })(),
      ])
      if (!active) return
      const list = assignments.data || []
      const teachers = new Map()
      list.forEach((item) => teachers.set(item.profile_id, item.profiles?.full_name || item.profiles?.email || 'Profesor'))
      setState({
        groups: groups.data || [],
        teachers: [...teachers.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)),
        assignments: list.sort((a, b) => assignmentLabel(a).localeCompare(assignmentLabel(b))),
      })
    }
    load()
    const unsubscribe = subscribeToTables(['teaching_assignments', 'class_groups'], load, `timetable-assignments-${profileId || 'all'}`)
    return () => { active = false; unsubscribe() }
  }, [enabled, profileId, filterId])
  return state
}

/* ------------------------------------------------------------------ */
/* Semana                                                              */
/* ------------------------------------------------------------------ */

function WeekView({ user }) {
  const isAdmin = isManager(user.role)
  const canManageSessions = user.role !== ROLES.STUDENT
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()))
  const [filter, setFilter] = useState({ kind: 'group', id: '' })
  const [sessions, setSessions] = useState(null)
  const [error, setError] = useState('')
  const [open, setOpen] = useState(null)
  const [creating, setCreating] = useState(false)
  const [version, setVersion] = useState(0)
  const reload = useCallback(() => setVersion((value) => value + 1), [])
  const { groups, teachers, assignments } = useCurrentAssignments(canManageSessions, isAdmin ? null : user.id)

  const from = toISODate(weekStart)
  const to = toISODate(addDays(weekStart, 6))
  const effectiveFilter = isAdmin ? (filter.id ? filter : { kind: 'group', id: groups[0]?.id || '' }) : null

  useEffect(() => {
    if (isAdmin && !effectiveFilter?.id) return undefined
    let active = true
    async function load() {
      try {
        const scope = isAdmin ? (effectiveFilter.kind === 'group' ? { groupId: effectiveFilter.id } : { profileId: effectiveFilter.id }) : {}
        const result = await fetchSessions(user, from, to, scope)
        if (active) { setSessions(result.sessions); setError('') }
      } catch (err) {
        if (active) setError(getSupabaseErrorMessage(err))
      }
    }
    load()
    const unsubscribe = subscribeToTables(['class_sessions', 'schedule_slots'], load, `timetable-week-${user.id}`)
    return () => { active = false; unsubscribe() }
  }, [user, from, to, isAdmin, effectiveFilter?.kind, effectiveFilter?.id, version])

  const days = useMemo(() => {
    const list = WEEKDAYS.map((label, index) => ({ label, date: toISODate(addDays(weekStart, index)), sessions: [] }))
    ;(sessions || []).forEach((session) => list.find((day) => day.date === session.date)?.sessions.push(session))
    return list.filter((day, index) => index < 5 || day.sessions.length)
  }, [sessions, weekStart])

  const today = toISODate(new Date())
  const weekTitle = `${weekStart.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })} – ${addDays(weekStart, 6).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })}`
  const showTeacher = user.role === ROLES.STUDENT || (isAdmin && effectiveFilter?.kind === 'group')
  const showGroup = user.role === ROLES.TEACHER || (isAdmin && effectiveFilter?.kind === 'teacher')

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <button type="button" className="btn-ghost px-2.5" aria-label="Semana anterior" onClick={() => setWeekStart((value) => addDays(value, -7))}><Icon name="back" /></button>
          <span className="min-w-[132px] text-center text-sm font-medium text-ink">{weekTitle}</span>
          <button type="button" className="btn-ghost px-2.5" aria-label="Semana siguiente" onClick={() => setWeekStart((value) => addDays(value, 7))}><Icon name="next" /></button>
        </div>
        {from > today || to < today ? <button type="button" className="btn-secondary" onClick={() => setWeekStart(startOfWeek(new Date()))}>Hoy</button> : null}
        {isAdmin && (
          <select className="input w-auto" aria-label="Ver horario de" value={`${effectiveFilter?.kind}:${effectiveFilter?.id}`}
            onChange={(event) => { const [kind, id] = event.target.value.split(':'); setFilter({ kind, id }) }}>
            <optgroup label="Grupos">{groups.map((group) => <option key={group.id} value={`group:${group.id}`}>{groupLabel(group)}</option>)}</optgroup>
            {teachers.length > 0 && <optgroup label="Profesores">{teachers.map((teacher) => <option key={teacher.id} value={`teacher:${teacher.id}`}>{teacher.name}</option>)}</optgroup>}
          </select>
        )}
        {canManageSessions && assignments.length > 0 && (
          <button type="button" className="btn-secondary ml-auto" onClick={() => setCreating(true)}><Icon name="plus" size={16} />Clase suelta</button>
        )}
      </div>

      {error && <p role="alert" className="notice-error">{error}</p>}
      {isAdmin && !groups.length && <div className="card empty"><p className="font-medium text-ink-soft">No hay grupos en el curso actual</p></div>}
      {sessions === null && !error && (!isAdmin || groups.length > 0) && <p className="text-sm text-muted">Cargando…</p>}

      {sessions && (
        <div className="grid gap-3 md:grid-cols-5">
          {days.map((day) => (
            <section key={day.date} className={`card p-3 ${day.date === today ? 'ring-1 ring-accent' : ''}`}>
              <h3 className="mb-2 flex items-baseline justify-between px-1">
                <span className={`text-sm font-semibold ${day.date === today ? 'text-accent-strong' : 'text-ink'}`}>{day.label}</span>
                <span className="text-xs text-muted">{parseISODate(day.date).getDate()}</span>
              </h3>
              {day.sessions.length === 0 ? <p className="px-1 py-2 text-xs text-faint">Sin clases</p> : (
                <ul className="space-y-1.5">
                  {day.sessions.map((session) => {
                    const assignment = session.teaching_assignments
                    const cancelled = session.status === 'cancelada'
                    return (
                      <li key={session.id}>
                        <button type="button" onClick={() => setOpen(session)}
                          className={`w-full rounded-xl border px-3 py-2 text-left transition-colors hover:bg-subtle ${cancelled ? 'border-line opacity-60' : assignment.degree_modules?.kind === 'practica' ? 'border-line border-l-2 border-l-accent' : 'border-line'}`}>
                          <span className="block text-xs tabular-nums text-muted">{time(session.start_time)}–{time(session.end_time)}{session.room ? ` · ${session.room}` : ''}</span>
                          <span className={`block text-sm font-medium text-ink ${cancelled ? 'line-through' : ''}`}>{assignmentLabel(assignment)}</span>
                          <span className="block truncate text-xs text-muted">
                            {cancelled ? 'Cancelada' : [showGroup && groupLabel(assignment.class_groups), showTeacher && (assignment.profiles?.full_name || '')].filter(Boolean).join(' · ')}
                          </span>
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )}
            </section>
          ))}
        </div>
      )}

      {open && <SessionDetail session={open} user={user} onClose={() => setOpen(null)} onChanged={reload} />}
      {creating && <OneOffForm assignments={assignments} onClose={() => setCreating(false)} onSaved={() => { setCreating(false); reload() }} />}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Detalle de una clase: pasar lista, cambiar hora o cancelar           */
/* ------------------------------------------------------------------ */

function SessionDetail({ session, user, onClose, onChanged }) {
  const assignment = session.teaching_assignments
  const canEdit = isManager(user.role) || assignment.profile_id === user.id
  const [roster, setRoster] = useState(null)
  const [ownStatus, setOwnStatus] = useState(undefined)
  const [practices, setPractices] = useState([])
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState({ date: session.date, start_time: time(session.start_time), end_time: time(session.end_time), room: session.room || '', note: session.note || '', practice_id: session.practice_id || '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const cancelled = session.status === 'cancelada'

  const loadRoster = useCallback(async () => {
    const { data, error: rosterError } = await supabase.rpc('session_roster', { p_session_id: session.id })
    if (rosterError) setError(getSupabaseErrorMessage(rosterError))
    else setRoster(data || [])
  }, [session.id])

  useEffect(() => {
    let active = true
    if (canEdit) {
      supabase.rpc('session_roster', { p_session_id: session.id }).then(({ data, error: rosterError }) => {
        if (!active) return
        if (rosterError) setError(getSupabaseErrorMessage(rosterError))
        else setRoster(data || [])
      })
      supabase.from('practices').select('id,title,date').eq('module_id', assignment.degree_modules?.module_id).order('date').then(({ data }) => { if (active) setPractices(data || []) })
    } else {
      supabase.from('session_attendance').select('status').eq('session_id', session.id).maybeSingle().then(({ data }) => { if (active) setOwnStatus(data?.status || null) })
    }
    return () => { active = false }
  }, [canEdit, session.id, assignment.degree_modules?.module_id])

  async function mark(studentIds, status) {
    setBusy(true)
    setRoster((current) => current.map((row) => (studentIds.includes(row.student_id) ? { ...row, status: status || null } : row)))
    const { error: saveError } = await supabase.rpc('set_session_attendance', { p_session_id: session.id, p_student_ids: studentIds, p_status: status || null })
    if (saveError) { setError(getSupabaseErrorMessage(saveError)); await loadRoster() }
    setBusy(false)
  }

  async function update(values, close = false) {
    setBusy(true)
    const { error: saveError } = await supabase.from('class_sessions').update(values).eq('id', session.id)
    setBusy(false)
    if (saveError) { setError(getSupabaseErrorMessage(saveError)); return }
    onChanged()
    if (close) onClose()
  }

  async function remove() {
    if (!window.confirm('¿Eliminar esta clase suelta?')) return
    const { error: deleteError } = await supabase.from('class_sessions').delete().eq('id', session.id)
    if (deleteError) { setError(getSupabaseErrorMessage(deleteError)); return }
    onChanged()
    onClose()
  }

  const longDate = parseISODate(session.date).toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' })
  const dateText = longDate.charAt(0).toUpperCase() + longDate.slice(1)
  const marked = roster?.filter((row) => row.status).length || 0
  const linkedPractice = practices.find((practice) => practice.id === session.practice_id)

  return (
    <Modal title={assignmentLabel(assignment)} onClose={onClose} wide>
      <p className="-mt-1 text-sm text-muted">
        {dateText} · {time(session.start_time)}–{time(session.end_time)}
        {session.room ? ` · ${session.room}` : ''} · {groupLabel(assignment.class_groups)}{assignment.profiles?.full_name ? ` · ${assignment.profiles.full_name}` : ''}
      </p>
      {cancelled && <p className="notice mt-3">Esta clase está cancelada.</p>}
      {session.note && !editing && <p className="mt-3 text-sm text-ink-soft">{session.note}</p>}
      {linkedPractice && !editing && <p className="mt-2 text-sm text-ink-soft">Práctica: {linkedPractice.title}</p>}
      {error && <p role="alert" className="notice-error mt-3">{error}</p>}

      {!canEdit && ownStatus !== undefined && (
        <p className="mt-4 text-sm text-ink-soft">Tu asistencia: <strong className="text-ink">{{ P: 'Presente', L: 'Tarde', A: 'Falta' }[ownStatus] || 'sin registrar'}</strong></p>
      )}

      {canEdit && !editing && (
        <>
          <section className="mt-5">
            <div className="mb-2 flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-ink">Asistencia <span className="font-normal text-muted">{roster ? `${marked}/${roster.length}` : ''}</span></h3>
              {roster?.length > 0 && !cancelled && (
                <button type="button" className="btn-ghost text-sm" disabled={busy} onClick={() => mark(roster.filter((row) => !row.status).map((row) => row.student_id), 'P')}>
                  <Icon name="check" size={16} />Resto presentes
                </button>
              )}
            </div>
            {roster === null && <p className="text-sm text-muted">Cargando lista…</p>}
            {roster?.length === 0 && <p className="text-sm text-muted">No hay alumnos matriculados en este módulo con este grupo.</p>}
            {roster?.length > 0 && (
              <ul className="divide-y divide-line rounded-xl border border-line">
                {roster.map((row) => (
                  <li key={row.student_id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                    <span className="min-w-0 truncate text-sm text-ink">{row.name}</span>
                    <AttendanceControl value={row.status} disabled={busy || cancelled} onChange={(status) => mark([row.student_id], status === row.status ? null : status)} />
                  </li>
                ))}
              </ul>
            )}
          </section>
          <div className="mt-5 flex flex-wrap justify-between gap-2">
            <div className="flex gap-2">
              <button type="button" className="btn-secondary" onClick={() => setEditing(true)}><Icon name="edit" size={16} />Cambiar</button>
              <button type="button" className="btn-ghost" disabled={busy} onClick={() => update({ status: cancelled ? 'programada' : 'cancelada' })}>{cancelled ? 'Recuperar clase' : 'Cancelar clase'}</button>
            </div>
            {!session.slot_id && <button type="button" className="btn-ghost text-danger" onClick={remove}><Icon name="trash" size={16} />Eliminar</button>}
          </div>
        </>
      )}

      {canEdit && editing && (
        <form className="mt-4 space-y-4" onSubmit={(event) => { event.preventDefault(); update({ ...form, room: form.room || null, note: form.note || null, practice_id: form.practice_id || null }, true) }}>
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="field">Día<input className="input" type="date" required value={form.date} onChange={(event) => setForm({ ...form, date: event.target.value })} /></label>
            <label className="field">Empieza<input className="input" type="time" required value={form.start_time} onChange={(event) => setForm({ ...form, start_time: event.target.value })} /></label>
            <label className="field">Termina<input className="input" type="time" required value={form.end_time} onChange={(event) => setForm({ ...form, end_time: event.target.value })} /></label>
          </div>
          <label className="field">Aula<input className="input" maxLength={40} value={form.room} onChange={(event) => setForm({ ...form, room: event.target.value })} /></label>
          {practices.length > 0 && (
            <label className="field">Práctica de esta clase
              <select className="input" value={form.practice_id} onChange={(event) => setForm({ ...form, practice_id: event.target.value })}>
                <option value="">Ninguna</option>
                {practices.map((practice) => <option key={practice.id} value={practice.id}>{practice.title}</option>)}
              </select>
            </label>
          )}
          <label className="field">Nota para la clase<textarea className="input" rows={2} maxLength={300} value={form.note} onChange={(event) => setForm({ ...form, note: event.target.value })} /></label>
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-ghost" onClick={() => setEditing(false)}>Volver</button>
            <button type="submit" className="btn-primary" disabled={busy}>Guardar</button>
          </div>
        </form>
      )}
    </Modal>
  )
}

function OneOffForm({ assignments, onClose, onSaved }) {
  const [form, setForm] = useState({ teaching_assignment_id: assignments[0]?.id || '', date: toISODate(new Date()), start_time: '09:00', end_time: '10:00', room: '' })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function save(event) {
    event.preventDefault()
    setBusy(true)
    const { error: saveError } = await supabase.from('class_sessions').insert({ ...form, room: form.room || null })
    setBusy(false)
    if (saveError) setError(getSupabaseErrorMessage(saveError))
    else onSaved()
  }

  return (
    <Modal title="Clase suelta" onClose={onClose}>
      <form className="space-y-4" onSubmit={save}>
        <label className="field">Clase
          <select className="input" value={form.teaching_assignment_id} onChange={(event) => setForm({ ...form, teaching_assignment_id: event.target.value })}>
            {assignments.map((item) => <option key={item.id} value={item.id}>{assignmentLabel(item)} · {groupLabel(item.class_groups)} · {item.profiles?.full_name || ''}</option>)}
          </select>
        </label>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="field">Día<input className="input" type="date" required value={form.date} onChange={(event) => setForm({ ...form, date: event.target.value })} /></label>
          <label className="field">Empieza<input className="input" type="time" required value={form.start_time} onChange={(event) => setForm({ ...form, start_time: event.target.value })} /></label>
          <label className="field">Termina<input className="input" type="time" required value={form.end_time} onChange={(event) => setForm({ ...form, end_time: event.target.value })} /></label>
        </div>
        <label className="field">Aula<input className="input" maxLength={40} value={form.room} onChange={(event) => setForm({ ...form, room: event.target.value })} /></label>
        {error && <p role="alert" className="notice-error">{error}</p>}
        <div className="flex justify-end"><button type="submit" className="btn-primary" disabled={busy}>Crear clase</button></div>
      </form>
    </Modal>
  )
}

/* ------------------------------------------------------------------ */
/* Plantilla semanal (administración: todo; profesor: sus clases)      */
/* ------------------------------------------------------------------ */

function TemplateEditor({ user }) {
  const ownOnly = !isManager(user.role)
  const { groups: allGroups, assignments } = useCurrentAssignments(true, ownOnly ? user.id : null)
  // El profesor solo ve los grupos donde imparte
  const groups = ownOnly ? allGroups.filter((group) => assignments.some((item) => item.group_id === group.id)) : allGroups
  const [groupId, setGroupId] = useState('')
  const [slots, setSlots] = useState([])
  const [editing, setEditing] = useState(null)
  const [notice, setNotice] = useState(null)
  const [version, setVersion] = useState(0)
  const activeGroup = groupId || groups[0]?.id || ''
  const groupAssignments = assignments.filter((item) => item.group_id === activeGroup)

  useEffect(() => {
    if (!activeGroup) return undefined
    let active = true
    async function load() {
      const { data, error } = await supabase.from('schedule_slots')
        .select('id,weekday,start_time,end_time,room,teaching_assignment_id,teaching_assignments!inner(group_id,profiles(full_name),degree_modules(module_id,kind))')
        .eq('teaching_assignments.group_id', activeGroup).order('weekday').order('start_time')
      if (!active) return
      if (error) setNotice({ error: true, text: getSupabaseErrorMessage(error) })
      else setSlots(data || [])
    }
    load()
    const unsubscribe = subscribeToTables(['schedule_slots'], load, `template-${activeGroup}`)
    return () => { active = false; unsubscribe() }
  }, [activeGroup, version])

  async function save(form) {
    const values = { teaching_assignment_id: form.teaching_assignment_id, weekday: Number(form.weekday), start_time: form.start_time, end_time: form.end_time, room: form.room || null }
    const { error } = editing.id
      ? await supabase.from('schedule_slots').update(values).eq('id', editing.id)
      : await supabase.from('schedule_slots').insert(values)
    if (error) { setNotice({ error: true, text: getSupabaseErrorMessage(error) }); return }
    setNotice({ error: false, text: 'Horario guardado. Las clases de aquí a fin de curso ya están en el calendario.' })
    setEditing(null)
    setVersion((value) => value + 1)
  }

  async function remove() {
    if (!window.confirm('¿Quitar esta clase de la plantilla? Se borran las clases futuras sin asistencia.')) return
    const { error } = await supabase.from('schedule_slots').delete().eq('id', editing.id)
    if (error) { setNotice({ error: true, text: getSupabaseErrorMessage(error) }); return }
    setNotice({ error: false, text: 'Clase quitada de la plantilla.' })
    setEditing(null)
    setVersion((value) => value + 1)
  }

  if (!groups.length) {
    return (
      <div className="card empty">
        <p className="font-medium text-ink-soft">{ownOnly ? 'Aún no tienes clases asignadas este curso' : 'No hay grupos en el curso actual'}</p>
        {ownOnly && <p className="mt-1">La supervisión te asigna los módulos y grupos; después podrás fijar aquí su horario.</p>}
      </div>
    )
  }
  const isMine = (slot) => groupAssignments.some((item) => item.id === slot.teaching_assignment_id)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Grupo">
        {groups.map((group) => (
          <button key={group.id} type="button" role="radio" aria-checked={group.id === activeGroup} onClick={() => setGroupId(group.id)}
            className={`rounded-xl border px-4 py-2 text-sm font-semibold ${group.id === activeGroup ? 'border-accent bg-accent-soft text-accent-strong' : 'border-line text-ink-soft hover:bg-subtle'}`}>
            {groupLabel(group)}
          </button>
        ))}
      </div>
      {notice && <p role={notice.error ? 'alert' : 'status'} className={notice.error ? 'notice-error' : 'notice-success'}>{notice.text}</p>}

      {groupAssignments.length === 0 ? (
        <div className="card empty"><p className="font-medium text-ink-soft">Este grupo aún no tiene profesores asignados</p><p className="mt-1">Asígnalos en Asignaciones → Profesores.</p></div>
      ) : (
        <>
          <div className="grid gap-3 md:grid-cols-5">
            {WEEKDAYS.slice(0, 5).map((label, index) => {
              const items = slots.filter((slot) => slot.weekday === index + 1)
              return (
                <section key={label} className="card p-3">
                  <h3 className="mb-2 px-1 text-sm font-semibold text-ink">{label}</h3>
                  <ul className="space-y-1.5">
                    {items.map((slot) => (
                      <li key={slot.id}>
                        <button type="button" onClick={() => setEditing(slot)} disabled={!isMine(slot)} className="w-full rounded-xl border border-line px-3 py-2 text-left enabled:hover:bg-subtle disabled:cursor-default disabled:opacity-60">
                          <span className="block text-xs tabular-nums text-muted">{time(slot.start_time)}–{time(slot.end_time)}{slot.room ? ` · ${slot.room}` : ''}</span>
                          <span className="block text-sm font-medium text-ink">{assignmentLabel(slot.teaching_assignments)}</span>
                          <span className="block truncate text-xs text-muted">{slot.teaching_assignments.profiles?.full_name}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                  <button type="button" className="mt-1.5 flex w-full items-center justify-center gap-1 rounded-xl py-1.5 text-xs text-muted hover:bg-subtle hover:text-ink"
                    onClick={() => setEditing({ weekday: index + 1, teaching_assignment_id: groupAssignments[0].id, start_time: '09:00', end_time: '10:00', room: '' })}>
                    <Icon name="plus" size={14} />Añadir
                  </button>
                </section>
              )
            })}
          </div>
        </>
      )}

      {editing && <SlotForm slot={editing} assignments={groupAssignments} onSave={save} onDelete={editing.id ? remove : null} onClose={() => setEditing(null)} />}
    </div>
  )
}

function SlotForm({ slot, assignments, onSave, onDelete, onClose }) {
  const [form, setForm] = useState({
    teaching_assignment_id: slot.teaching_assignment_id,
    weekday: String(slot.weekday),
    start_time: time(slot.start_time),
    end_time: time(slot.end_time),
    room: slot.room || '',
  })
  const [busy, setBusy] = useState(false)
  return (
    <Modal title={slot.id ? 'Clase semanal' : 'Nueva clase semanal'} onClose={onClose}>
      <form className="space-y-4" onSubmit={async (event) => { event.preventDefault(); setBusy(true); await onSave(form); setBusy(false) }}>
        <label className="field">Módulo y profesor
          <select className="input" value={form.teaching_assignment_id} onChange={(event) => setForm({ ...form, teaching_assignment_id: event.target.value })}>
            {assignments.map((item) => <option key={item.id} value={item.id}>{assignmentLabel(item)} · {item.profiles?.full_name || item.profiles?.email}</option>)}
          </select>
        </label>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="field">Día
            <select className="input" value={form.weekday} onChange={(event) => setForm({ ...form, weekday: event.target.value })}>
              {WEEKDAYS.map((label, index) => <option key={label} value={index + 1}>{label}</option>)}
            </select>
          </label>
          <label className="field">Empieza<input className="input" type="time" required value={form.start_time} onChange={(event) => setForm({ ...form, start_time: event.target.value })} /></label>
          <label className="field">Termina<input className="input" type="time" required value={form.end_time} onChange={(event) => setForm({ ...form, end_time: event.target.value })} /></label>
        </div>
        <label className="field">Aula<input className="input" maxLength={40} value={form.room} onChange={(event) => setForm({ ...form, room: event.target.value })} /></label>
        <div className="flex items-center justify-between pt-1">
          {onDelete ? <button type="button" className="btn-ghost text-danger" onClick={onDelete}><Icon name="trash" size={16} />Quitar</button> : <span />}
          <button type="submit" className="btn-primary" disabled={busy}>{busy ? 'Guardando…' : 'Guardar'}</button>
        </div>
      </form>
    </Modal>
  )
}
