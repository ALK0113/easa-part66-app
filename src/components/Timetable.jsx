import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { useSchool } from '../contexts/useSchool.js'
import { subscribeToTables } from '../lib/supabaseRealtime.js'
import { getSupabaseErrorMessage } from '../lib/supabaseErrors.js'
import { KIND_LABEL, groupLabel } from '../lib/academic.js'
import { ROLES, isManager, teachesLikeProfessor } from '../lib/roles.js'
import { WEEKDAYS, addDays, fetchSessions, parseISODate, startOfWeek, time, toISODate } from '../lib/schedule.js'
import { AttendanceSheet } from './SessionAttendance.jsx'
import Icon from './Icon.jsx'
import Modal from './Modal.jsx'
import ImportSchedule from './ImportSchedule.jsx'
import { ConflictConfirm, RoomSelect } from './ScheduleControls.jsx'
import { checkConflicts, fetchTemplateConflicts, fetchWeekConflicts, roomValues, useRooms } from '../lib/scheduleTools.js'

// Horario semanal. Profesor: sus clases y pasar lista. Alumno: sus clases.
// Administración: por grupo, profesor o aula, y la plantilla semanal de cada grupo.
// Columnas por día; en pantalla grande se arrastra una tarjeta a otro día (la hora se cambia en su formulario).
// Los choques (mismo profesor, aula o grupo a la misma hora) se marcan en rojo y se avisan antes de guardar.
// Al tocar una clase con práctica vinculada se va a esa práctica; si no, a la página de la clase.

const formRoom = (item) => ({ room_id: item?.room_id || '', room_new: '' })

// Rejilla solo en pantalla grande (md); en el móvil, la lista por días
function useWideScreen() {
  const query = '(min-width: 768px)'
  const [wide, setWide] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches)
  useEffect(() => {
    const media = window.matchMedia(query)
    const update = () => setWide(media.matches)
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])
  return wide
}

// Arrastrar una tarjeta a otra columna (otro día). Pointer events: ratón y tablet. Un toque sin mover abre la clase.
// Las columnas llevan data-day con su índice.
function useDayDrag({ canDrag, onDrop, onOpen }) {
  const [drag, setDrag] = useState(null)
  const bind = (item, dayIndex) => ({
    onPointerDown: (event) => {
      if (event.button !== 0) return
      if (canDrag(item)) event.currentTarget.setPointerCapture(event.pointerId)
      setDrag({ item, from: dayIndex, x: event.clientX, y: event.clientY, moved: false, over: null, draggable: canDrag(item) })
    },
    onPointerMove: (event) => {
      if (!drag?.draggable) return
      if (!drag.moved && Math.abs(event.clientX - drag.x) + Math.abs(event.clientY - drag.y) < 8) return
      const column = document.elementFromPoint(event.clientX, event.clientY)?.closest('[data-day]')
      const over = column ? Number(column.dataset.day) : null
      if (!drag.moved || over !== drag.over) setDrag({ ...drag, moved: true, over })
    },
    onPointerUp: () => {
      const current = drag
      setDrag(null)
      if (!current) return
      if (!current.moved) onOpen(item)
      else if (current.over !== null && current.over !== current.from) onDrop(item, current.over)
    },
    onPointerCancel: () => setDrag(null),
    onKeyDown: (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onOpen(item) } },
  })
  const dragging = (item) => Boolean(drag?.moved && drag.item === item)
  const isTarget = (dayIndex) => Boolean(drag?.moved && drag.over === dayIndex && drag.over !== drag.from)
  return { bind, dragging, isTarget, active: Boolean(drag?.moved) }
}

// Comprueba choques antes de guardar: si los hay, pide confirmación
function useConflictGuard() {
  const [pending, setPending] = useState(null)
  const guard = useCallback(async (check, action, label) => {
    const reasons = await checkConflicts(check)
    if (!reasons.length) return action()
    setPending({ reasons, action, label })
    return undefined
  }, [])
  const modal = pending && (
    <ConflictConfirm reasons={pending.reasons} action={pending.label}
      onCancel={() => setPending(null)}
      onConfirm={() => { const { action } = pending; setPending(null); action() }} />
  )
  return [guard, modal]
}

const assignmentLabel = (assignment) => assignment
  ? `${assignment.degree_modules?.module_id} ${KIND_LABEL[assignment.degree_modules?.kind]?.toLowerCase() || ''}`
  : ''

export default function Timetable({ user, onOpenPractice }) {
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
          {isAdmin && <button type="button" role="tab" className="tab" aria-selected={tab === 'import'} onClick={() => setTab('import')}>Importar</button>}
        </div>
      )}
      {tab === 'week' && <WeekView user={user} onOpenPractice={onOpenPractice} />}
      {tab === 'template' && <TemplateEditor user={user} />}
      {tab === 'import' && isAdmin && <ImportSchedule user={user} />}
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

function WeekView({ user, onOpenPractice }) {
  const isAdmin = isManager(user.role)
  const canManageSessions = user.role !== ROLES.STUDENT
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()))
  const [filter, setFilter] = useState({ kind: 'group', id: '' })
  const [sessions, setSessions] = useState(null)
  const [holidays, setHolidays] = useState([])
  const [error, setError] = useState('')
  const [open, setOpen] = useState(null)
  const [creating, setCreating] = useState(false)
  const [version, setVersion] = useState(0)
  const [conflicts, setConflicts] = useState(new Map())
  const [notice, setNotice] = useState(null)
  const reload = useCallback(() => setVersion((value) => value + 1), [])
  const { groups, teachers, assignments } = useCurrentAssignments(canManageSessions, isAdmin ? null : user.id)
  const { schoolId } = useSchool()
  const rooms = useRooms(canManageSessions ? schoolId : null)
  const wide = useWideScreen()
  const [guard, conflictModal] = useConflictGuard()

  const from = toISODate(weekStart)
  const to = toISODate(addDays(weekStart, 6))
  const effectiveFilter = isAdmin ? (filter.id ? filter : { kind: 'group', id: groups[0]?.id || '' }) : null

  useEffect(() => {
    if (isAdmin && !effectiveFilter?.id) return undefined
    let active = true
    async function load() {
      try {
        const scope = isAdmin ? ({ group: { groupId: effectiveFilter.id }, teacher: { profileId: effectiveFilter.id }, room: { roomId: effectiveFilter.id } })[effectiveFilter.kind] : {}
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

  // Choques de la semana (profesorado y gestión)
  useEffect(() => {
    if (!canManageSessions || !schoolId) return undefined
    let active = true
    fetchWeekConflicts(schoolId, from, to).then((map) => { if (active) setConflicts(map) })
    return () => { active = false }
  }, [canManageSessions, schoolId, from, to, sessions])

  // Festivos de la semana (se ven en su día)
  const { filterId } = useSchool()
  useEffect(() => {
    let active = true
    let query = supabase.from('school_holidays').select('starts_on,ends_on,name,academic_years!inner(school_id,is_current)').lte('starts_on', to).gte('ends_on', from)
    if (filterId) query = query.eq('academic_years.school_id', filterId)
    query.then(({ data }) => { if (active) setHolidays(data || []) })
    return () => { active = false }
  }, [from, to, filterId])

  const days = useMemo(() => {
    const list = WEEKDAYS.map((label, index) => {
      const date = toISODate(addDays(weekStart, index))
      return { label, date, sessions: [], holiday: holidays.find((item) => item.starts_on <= date && item.ends_on >= date)?.name || null }
    })
    ;(sessions || []).forEach((session) => list.find((day) => day.date === session.date)?.sessions.push(session))
    return list.filter((day, index) => index < 5 || day.sessions.length)
  }, [sessions, weekStart, holidays])

  const today = toISODate(new Date())
  const weekTitle = `${weekStart.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })} – ${addDays(weekStart, 6).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })}`
  const showTeacher = user.role === ROLES.STUDENT || (isAdmin && effectiveFilter?.kind !== 'teacher')
  const showGroup = user.role === ROLES.TEACHER || (isAdmin && effectiveFilter?.kind !== 'group')
  const canEditSession = (session) => session.status !== 'cancelada' && (isAdmin || session.teaching_assignments?.profile_id === user.id)
  const visibleConflicts = useMemo(() => new Map([...conflicts].filter(([id]) => (sessions || []).some((session) => session.id === id))), [conflicts, sessions])

  // Al tocar una clase: atajo a su práctica, dentro de su módulo, si la tiene; si no, la página de la clase
  const openClass = (session) => {
    const moduleId = session.practices?.module_id || session.teaching_assignments?.degree_modules?.module_id
    if (session.practice_id && moduleId && onOpenPractice && user.role !== ROLES.STUDENT) onOpenPractice(session.practice_id, moduleId)
    else setOpen(session)
  }

  // Arrastrar una tarjeta a otro día cambia solo ese día (misma hora)
  function moveSession(session, dayIndex) {
    const date = days[dayIndex].date
    const start = time(session.start_time)
    const end = time(session.end_time)
    guard(
      { kind: 'session', id: session.id, assignmentId: session.teaching_assignment_id, date, start, end, roomId: session.room_id },
      async () => {
        const { error: moveError } = await supabase.from('class_sessions').update({ date, start_time: start, end_time: end }).eq('id', session.id)
        if (moveError) { setNotice({ error: true, text: getSupabaseErrorMessage(moveError) }); return }
        setNotice({ error: false, text: `${assignmentLabel(session.teaching_assignments)} movida al ${days[dayIndex].label.toLowerCase()} ${parseISODate(date).getDate()}, de ${start} a ${end}. Solo cambia ese día.` })
        reload()
      },
      'Mover igualmente',
    )
  }
  const dayDrag = useDayDrag({ canDrag: (session) => wide && canManageSessions && canEditSession(session), onDrop: moveSession, onOpen: openClass })

  // Página de la clase (con los datos al día tras cada cambio)
  const openSession = open ? (sessions || []).find((session) => session.id === open.id) || open : null
  if (openSession) {
    return <SessionDetail asPage session={openSession} user={user} rooms={rooms} conflicts={visibleConflicts.get(openSession.id)} onClose={() => setOpen(null)} onChanged={reload} />
  }

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
            {rooms.length > 0 && <optgroup label="Aulas">{rooms.map((room) => <option key={room.id} value={`room:${room.id}`}>{room.name}</option>)}</optgroup>}
          </select>
        )}
        {canManageSessions && assignments.length > 0 && (
          <button type="button" className="btn-secondary ml-auto" onClick={() => setCreating(true)}><Icon name="plus" size={16} />Clase suelta</button>
        )}
      </div>

      {error && <p role="alert" className="notice-error">{error}</p>}
      {notice && <p role={notice.error ? 'alert' : 'status'} className={notice.error ? 'notice-error' : 'notice-success'}>{notice.text}</p>}
      {visibleConflicts.size > 0 && (
        <p className="notice-error">{visibleConflicts.size === 1 ? '1 clase choca' : `${visibleConflicts.size} clases chocan`} con otra esta semana (mismo profesor, aula o grupo). Están marcadas en rojo; toca una para ver con cuál.</p>
      )}
      {wide && sessions && canManageSessions && <p className="text-xs text-faint">Arrastra una tarjeta a otro día para moverla solo esa semana; la hora se cambia al abrirla. Para cambiarla todas las semanas, usa la plantilla semanal.</p>}
      {isAdmin && !groups.length && <div className="card empty"><p className="font-medium text-ink-soft">No hay grupos en el curso actual</p></div>}
      {sessions === null && !error && (!isAdmin || groups.length > 0) && <p className="text-sm text-muted">Cargando…</p>}

      {sessions && (
        <div className="grid gap-3 md:grid-cols-5">
          {days.map((day, dayIndex) => (
            <section key={day.date} data-day={dayIndex} className={`card p-3 transition-shadow ${dayDrag.isTarget(dayIndex) ? 'ring-2 ring-accent' : day.date === today ? 'ring-1 ring-accent' : ''}`}>
              <h3 className="mb-2 flex items-baseline justify-between px-1">
                <span className={`text-sm font-semibold ${day.date === today ? 'text-accent-strong' : 'text-ink'}`}>{day.label}</span>
                <span className="text-xs text-muted">{parseISODate(day.date).getDate()}</span>
              </h3>
              {day.holiday && <p className="mb-1.5 rounded-lg bg-warn-soft px-2 py-1 text-xs font-medium text-warn">Festivo · {day.holiday}</p>}
              {day.sessions.length === 0 ? <p className="px-1 py-2 text-xs text-faint">{day.holiday ? 'No lectivo' : 'Sin clases'}</p> : (
                <ul className="space-y-1.5">
                  {day.sessions.map((session) => {
                    const assignment = session.teaching_assignments
                    const cancelled = session.status === 'cancelada'
                    const conflict = visibleConflicts.get(session.id)
                    return (
                      <li key={session.id}>
                        <button type="button" {...dayDrag.bind(session, dayIndex)} title={conflict ? `Choque: ${conflict.join(' · ')}` : session.practice_id && user.role !== ROLES.STUDENT ? 'Ir a la práctica en su módulo' : undefined}
                          className={`w-full select-none rounded-xl border px-3 py-2 text-left transition-colors hover:bg-subtle
                            ${conflict ? 'border-danger' : 'border-line'} ${cancelled ? 'opacity-60' : assignment.degree_modules?.kind === 'practica' && !conflict ? 'border-l-2 border-l-accent' : ''}
                            ${dayDrag.dragging(session) ? 'opacity-40' : ''} ${wide && canManageSessions && canEditSession(session) ? 'cursor-grab active:cursor-grabbing' : ''}`}>
                          <span className="block text-xs tabular-nums text-muted">{time(session.start_time)}–{time(session.end_time)}{session.room ? ` · ${session.room}` : ''}</span>
                          <span className={`block text-sm font-medium text-ink ${cancelled ? 'line-through' : ''}`}>{assignmentLabel(assignment)}{conflict && <span className="ml-1 text-danger">· choque</span>}</span>
                          {(session.theory_classes?.title || session.practices?.title) && <span className="block truncate text-xs text-ink-soft">{session.theory_classes?.title || session.practices?.title}</span>}
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

      {creating && <OneOffForm assignments={assignments} rooms={rooms} onClose={() => setCreating(false)} onSaved={() => { setCreating(false); reload() }} />}
      {conflictModal}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Detalle de una clase: pasar lista, cambiar hora o cancelar           */
/* ------------------------------------------------------------------ */

// Página de la clase (desde la semana) o ventana: la lista, el comentario, cambiar día, hora o aula, cancelar
function PageShell({ title, onClose, children }) {
  return (
    <div className="space-y-4">
      <button type="button" className="back-link" onClick={onClose}>← Horario</button>
      <h2 className="text-2xl font-semibold text-ink">{title}</h2>
      <div>{children}</div>
    </div>
  )
}

function SessionDetail({ session, user, rooms = [], conflicts, asPage = false, onClose, onChanged }) {
  const Shell = asPage ? PageShell : Modal
  const assignment = session.teaching_assignments
  const canEdit = isManager(user.role) || assignment.profile_id === user.id
  const [ownStatus, setOwnStatus] = useState(undefined)
  const [practices, setPractices] = useState([])
  const [theoryClasses, setTheoryClasses] = useState([])
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState({ date: session.date, start_time: time(session.start_time), end_time: time(session.end_time), ...formRoom(session), note: session.note || '', content: session.theory_class_id ? `t:${session.theory_class_id}` : session.practice_id ? `p:${session.practice_id}` : '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [guard, conflictModal] = useConflictGuard()
  const cancelled = session.status === 'cancelada'

  useEffect(() => {
    let active = true
    if (canEdit) {
      supabase.from('practices').select('id,title,date').eq('module_id', assignment.degree_modules?.module_id).order('date').then(({ data }) => { if (active) setPractices(data || []) })
      supabase.from('theory_classes').select('id,title').eq('module_id', assignment.degree_modules?.module_id).order('created_at').then(({ data }) => { if (active) setTheoryClasses(data || []) })
    } else {
      supabase.from('session_attendance').select('status,evaluation,comment').eq('session_id', session.id).maybeSingle().then(({ data }) => { if (active) setOwnStatus(data || null) })
    }
    return () => { active = false }
  }, [canEdit, session.id, assignment.degree_modules?.module_id])

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
  const linkedPractice = practices.find((practice) => practice.id === session.practice_id)

  return (
    <Shell title={assignmentLabel(assignment)} onClose={onClose} wide>
      <p className={`${asPage ? '' : '-mt-1 '}text-sm text-muted`}>
        {dateText} · {time(session.start_time)}–{time(session.end_time)}
        {session.room ? ` · ${session.room}` : ''} · {groupLabel(assignment.class_groups)}{assignment.profiles?.full_name ? ` · ${assignment.profiles.full_name}` : ''}
      </p>
      {cancelled && <p className="notice mt-3">Esta clase está cancelada.</p>}
      {conflicts?.length > 0 && !cancelled && (
        <div className="notice-error mt-3 text-sm">
          <p className="font-medium">Choca con:</p>
          <ul className="mt-1 list-disc pl-5">{conflicts.map((text) => <li key={text}>{text}</li>)}</ul>
        </div>
      )}
      {session.note && !editing && <p className="mt-3 text-sm text-ink-soft">{session.note}</p>}
      {session.theory_classes?.title && !editing && <p className="mt-2 text-sm text-ink-soft">Clase teórica: {session.theory_classes.title}</p>}
      {linkedPractice && !editing && <p className="mt-2 text-sm text-ink-soft">Práctica: {linkedPractice.title}{canEdit ? ' · Apto / No apto por sesión; la nota general se pone en la práctica' : ''}</p>}
      {error && <p role="alert" className="notice-error mt-3">{error}</p>}

      {!canEdit && ownStatus !== undefined && (
        <div className="mt-4 space-y-1 text-sm text-ink-soft">
          <p>Tu asistencia: <strong className="text-ink">{{ P: 'Presente', L: 'Tarde', A: 'Falta' }[ownStatus?.status] || 'sin registrar'}</strong></p>
          {ownStatus?.evaluation && <p>Evaluación de la sesión: <strong className={ownStatus.evaluation === 'Apto' ? 'text-success' : 'text-danger'}>{ownStatus.evaluation === 'Apto' ? 'Apto' : 'No apto'}</strong></p>}
          {ownStatus?.comment && <p className="whitespace-pre-line">Comentario: {ownStatus.comment}</p>}
        </div>
      )}

      {canEdit && !editing && (
        <>
          <div className="mt-5">
            <AttendanceSheet session={session} />
          </div>
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
        <form className="mt-4 space-y-4" onSubmit={(event) => {
          event.preventDefault()
          const values = {
            date: form.date, start_time: form.start_time, end_time: form.end_time, ...roomValues(form), note: form.note || null,
            practice_id: form.content.startsWith('p:') ? form.content.slice(2) : null, theory_class_id: form.content.startsWith('t:') ? form.content.slice(2) : null,
          }
          const roomId = form.room_id && form.room_id !== 'new' ? form.room_id : null
          guard({ kind: 'session', id: session.id, assignmentId: session.teaching_assignment_id, date: form.date, start: form.start_time, end: form.end_time, roomId }, () => update(values, true))
        }}>
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="field">Día<input className="input" type="date" required value={form.date} onChange={(event) => setForm({ ...form, date: event.target.value })} /></label>
            <label className="field">Empieza<input className="input" type="time" required value={form.start_time} onChange={(event) => setForm({ ...form, start_time: event.target.value })} /></label>
            <label className="field">Termina<input className="input" type="time" required value={form.end_time} onChange={(event) => setForm({ ...form, end_time: event.target.value })} /></label>
          </div>
          <RoomSelect rooms={rooms} form={form} setForm={setForm} />
          {(practices.length > 0 || theoryClasses.length > 0) && (
            <label className="field">Clase que se imparte en esta sesión
              <select className="input" value={form.content} onChange={(event) => setForm({ ...form, content: event.target.value })}>
                <option value="">Ninguna</option>
                {theoryClasses.length > 0 && <optgroup label="Clases teóricas">{theoryClasses.map((item) => <option key={item.id} value={`t:${item.id}`}>{item.title}</option>)}</optgroup>}
                {practices.length > 0 && <optgroup label="Clases prácticas">{practices.map((practice) => <option key={practice.id} value={`p:${practice.id}`}>{practice.title}</option>)}</optgroup>}
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
      {conflictModal}
    </Shell>
  )
}

function OneOffForm({ assignments, rooms, onClose, onSaved }) {
  const [form, setForm] = useState({ teaching_assignment_id: assignments[0]?.id || '', date: toISODate(new Date()), start_time: '09:00', end_time: '10:00', room_id: '', room_new: '' })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [guard, conflictModal] = useConflictGuard()

  async function insert() {
    setBusy(true)
    const { error: saveError } = await supabase.from('class_sessions').insert({
      teaching_assignment_id: form.teaching_assignment_id, date: form.date, start_time: form.start_time, end_time: form.end_time, ...roomValues(form),
    })
    setBusy(false)
    if (saveError) setError(getSupabaseErrorMessage(saveError))
    else onSaved()
  }

  function save(event) {
    event.preventDefault()
    const roomId = form.room_id && form.room_id !== 'new' ? form.room_id : null
    guard({ kind: 'session', assignmentId: form.teaching_assignment_id, date: form.date, start: form.start_time, end: form.end_time, roomId }, insert, 'Crear igualmente')
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
        <RoomSelect rooms={rooms} form={form} setForm={setForm} />
        {error && <p role="alert" className="notice-error">{error}</p>}
        <div className="flex justify-end"><button type="submit" className="btn-primary" disabled={busy}>Crear clase</button></div>
      </form>
      {conflictModal}
    </Modal>
  )
}

/* ------------------------------------------------------------------ */
/* Plantilla semanal (administración: todo; profesor: sus clases)      */
/* ------------------------------------------------------------------ */

export function TemplateEditor({ user }) {
  const ownOnly = !isManager(user.role)
  const { groups: allGroups, assignments } = useCurrentAssignments(true, ownOnly ? user.id : null)
  // El profesor solo ve los grupos donde imparte
  const groups = ownOnly ? allGroups.filter((group) => assignments.some((item) => item.group_id === group.id)) : allGroups
  const { schoolId } = useSchool()
  const rooms = useRooms(schoolId)
  const wide = useWideScreen()
  const [guard, conflictModal] = useConflictGuard()
  const [groupId, setGroupId] = useState('')
  const [slots, setSlots] = useState([])
  const [conflicts, setConflicts] = useState(new Map())
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
        .select('id,weekday,start_time,end_time,room,room_id,teaching_assignment_id,teaching_assignments!inner(group_id,profile_id,profiles(full_name),degree_modules(module_id,kind))')
        .eq('teaching_assignments.group_id', activeGroup).order('weekday').order('start_time')
      if (!active) return
      if (error) setNotice({ error: true, text: getSupabaseErrorMessage(error) })
      else setSlots(data || [])
    }
    load()
    const unsubscribe = subscribeToTables(['schedule_slots'], load, `template-${activeGroup}`)
    return () => { active = false; unsubscribe() }
  }, [activeGroup, version])

  useEffect(() => {
    if (!schoolId) return undefined
    let active = true
    fetchTemplateConflicts(schoolId).then((map) => { if (active) setConflicts(map) })
    return () => { active = false }
  }, [schoolId, slots])

  async function persist(id, values, okText) {
    const { error } = id
      ? await supabase.from('schedule_slots').update(values).eq('id', id)
      : await supabase.from('schedule_slots').insert(values)
    if (error) { setNotice({ error: true, text: getSupabaseErrorMessage(error) }); return false }
    setNotice({ error: false, text: okText })
    setVersion((value) => value + 1)
    return true
  }

  function save(form) {
    const values = { teaching_assignment_id: form.teaching_assignment_id, weekday: Number(form.weekday), start_time: form.start_time, end_time: form.end_time, ...roomValues(form) }
    const roomId = form.room_id && form.room_id !== 'new' ? form.room_id : null
    return guard(
      { kind: 'slot', id: editing.id || null, assignmentId: values.teaching_assignment_id, weekday: values.weekday, start: values.start_time, end: values.end_time, roomId },
      async () => { if (await persist(editing.id, values, 'Horario guardado. Las clases de aquí a fin de curso ya están en el calendario.')) setEditing(null) },
    )
  }

  // Arrastrar en la plantilla cambia ese hueco para el resto del curso
  function moveSlot(slot, dayIndex) {
    const weekday = dayIndex + 1
    const start = time(slot.start_time)
    const end = time(slot.end_time)
    guard(
      { kind: 'slot', id: slot.id, assignmentId: slot.teaching_assignment_id, weekday, start, end, roomId: slot.room_id },
      () => persist(slot.id, { weekday }, `${assignmentLabel(slot.teaching_assignments)} pasa al ${WEEKDAYS[dayIndex].toLowerCase()} de ${start} a ${end}. Se han movido las clases de aquí a fin de curso (las que ya tienen asistencia o se cambiaron a mano se quedan como estaban).`),
      'Mover igualmente',
    )
  }

  async function remove() {
    if (!window.confirm('¿Quitar esta clase de la plantilla? Se borran las clases futuras sin asistencia.')) return
    const { error } = await supabase.from('schedule_slots').delete().eq('id', editing.id)
    if (error) { setNotice({ error: true, text: getSupabaseErrorMessage(error) }); return }
    setNotice({ error: false, text: 'Clase quitada de la plantilla.' })
    setEditing(null)
    setVersion((value) => value + 1)
  }

  const slotDrag = useDayDrag({ canDrag: (slot) => wide && isMine(slot), onDrop: moveSlot, onOpen: (slot) => isMine(slot) && setEditing(slot) })

  if (!groups.length) {
    return (
      <div className="card empty">
        <p className="font-medium text-ink-soft">{ownOnly ? 'Aún no tienes clases asignadas este curso' : 'No hay grupos en el curso actual'}</p>
        {ownOnly && <p className="mt-1">La coordinación te asigna los módulos y grupos; después podrás fijar aquí su horario.</p>}
      </div>
    )
  }
  const isMine = (slot) => groupAssignments.some((item) => item.id === slot.teaching_assignment_id)
  const groupConflicts = new Map([...conflicts].filter(([id]) => slots.some((slot) => slot.id === id)))
  const newSlot = (weekday, start = '09:00', end = '10:00') => setEditing({ weekday, teaching_assignment_id: groupAssignments[0].id, start_time: start, end_time: end, room_id: '' })
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
      {groupConflicts.size > 0 && (
        <p className="notice-error">{groupConflicts.size === 1 ? '1 clase de este grupo choca' : `${groupConflicts.size} clases de este grupo chocan`} con otra (mismo profesor, aula o grupo). Están marcadas en rojo; toca una para ver con cuál.</p>
      )}

      {groupAssignments.length === 0 ? (
        <div className="card empty"><p className="font-medium text-ink-soft">Este grupo aún no tiene profesores asignados</p><p className="mt-1">Asígnalos en Escuela → Profesores.</p></div>
      ) : (
        <>
        {wide && <p className="text-xs text-faint">Arrastra una tarjeta a otro día para cambiarla todas las semanas; la hora se cambia al abrirla.</p>}
        <div className="grid gap-3 md:grid-cols-5">
          {WEEKDAYS.slice(0, 5).map((label, index) => {
            const items = slots.filter((slot) => slot.weekday === index + 1)
            return (
              <section key={label} data-day={index} className={`card p-3 transition-shadow ${slotDrag.isTarget(index) ? 'ring-2 ring-accent' : ''}`}>
                <h3 className="mb-2 px-1 text-sm font-semibold text-ink">{label}</h3>
                <ul className="space-y-1.5">
                  {items.map((slot) => (
                    <li key={slot.id}>
                      <button type="button" {...slotDrag.bind(slot, index)} disabled={!isMine(slot)} title={groupConflicts.has(slot.id) ? `Choque: ${groupConflicts.get(slot.id).join(' · ')}` : undefined}
                        className={`w-full select-none rounded-xl border px-3 py-2 text-left enabled:hover:bg-subtle disabled:cursor-default disabled:opacity-60 ${groupConflicts.has(slot.id) ? 'border-danger' : 'border-line'} ${slotDrag.dragging(slot) ? 'opacity-40' : ''} ${wide && isMine(slot) ? 'cursor-grab active:cursor-grabbing' : ''}`}>
                        <span className="block text-xs tabular-nums text-muted">{time(slot.start_time)}–{time(slot.end_time)}{slot.room ? ` · ${slot.room}` : ''}</span>
                        <span className="block text-sm font-medium text-ink">{assignmentLabel(slot.teaching_assignments)}{groupConflicts.has(slot.id) && <span className="ml-1 text-danger">· choque</span>}</span>
                        <span className="block truncate text-xs text-muted">{slot.teaching_assignments.profiles?.full_name}</span>
                      </button>
                    </li>
                  ))}
                </ul>
                <button type="button" className="mt-1.5 flex w-full items-center justify-center gap-1 rounded-xl py-1.5 text-xs text-muted hover:bg-subtle hover:text-ink" onClick={() => newSlot(index + 1)}>
                  <Icon name="plus" size={14} />Añadir
                </button>
              </section>
            )
          })}
        </div>
        </>
      )}

      {editing && <SlotForm slot={editing} assignments={groupAssignments} rooms={rooms} conflicts={editing.id ? groupConflicts.get(editing.id) : null} onSave={save} onDelete={editing.id ? remove : null} onClose={() => setEditing(null)} />}
      {conflictModal}
    </div>
  )
}

function SlotForm({ slot, assignments, rooms, conflicts, onSave, onDelete, onClose }) {
  const [form, setForm] = useState({
    teaching_assignment_id: slot.teaching_assignment_id,
    weekday: String(slot.weekday),
    start_time: time(slot.start_time),
    end_time: time(slot.end_time),
    ...formRoom(slot),
  })
  const [busy, setBusy] = useState(false)
  return (
    <Modal title={slot.id ? 'Clase semanal' : 'Nueva clase semanal'} onClose={onClose}>
      {conflicts?.length > 0 && (
        <div className="notice-error mb-4 text-sm">
          <p className="font-medium">Choca con:</p>
          <ul className="mt-1 list-disc pl-5">{conflicts.map((text) => <li key={text}>{text}</li>)}</ul>
        </div>
      )}
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
        <RoomSelect rooms={rooms} form={form} setForm={setForm} />
        <div className="flex items-center justify-between pt-1">
          {onDelete ? <button type="button" className="btn-ghost text-danger" onClick={onDelete}><Icon name="trash" size={16} />Quitar</button> : <span />}
          <button type="submit" className="btn-primary" disabled={busy}>{busy ? 'Guardando…' : 'Guardar'}</button>
        </div>
      </form>
    </Modal>
  )
}
