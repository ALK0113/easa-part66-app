import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { subscribeToTables } from '../lib/supabaseRealtime.js'
import { KIND_LABEL, groupLabel } from '../lib/academic.js'
import { ROLES, teachesLikeProfessor } from '../lib/roles.js'
import { addDays, fetchSessions, parseISODate, time, toISODate } from '../lib/schedule.js'
import Icon from './Icon.jsx'
import { moduleColor } from '../lib/moduleColors.js'
import { fetchEvents } from '../lib/personalEvents.js'
import { EventCard } from './PersonalEvents.jsx'

// «Clases» en el inicio (profesor y alumno): hoy y los próximos días en una sola lista por día,
// con unas 4 clases a la vista y desplazamiento para el resto.
// Al tocar una clase con práctica vinculada se abre esa práctica en su módulo; si no, el horario.
// El profesor ve también las prácticas de sus módulos que no van en ninguna clase. Salen también los eventos personales.
const DAYS_AHEAD = 7

function dayLabel(iso, today) {
  if (iso === today) return 'Hoy'
  if (iso === toISODate(addDays(parseISODate(today), 1))) return 'Mañana'
  const text = parseISODate(iso).toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'short' })
  return text.charAt(0).toUpperCase() + text.slice(1)
}

export default function TodayClasses({ user, onOpen, onOpenPractice }) {
  const [sessions, setSessions] = useState(null)
  const [practices, setPractices] = useState([])
  const [events, setEvents] = useState([])
  const today = toISODate(new Date())

  useEffect(() => {
    let active = true
    const from = toISODate(new Date())
    const to = toISODate(addDays(new Date(), DAYS_AHEAD - 1))
    async function load() {
      try {
        // El coordinador ve en el inicio sus propias clases
        const [result, practiceRows, eventRows] = await Promise.all([
          fetchSessions(user, from, to, user.role === ROLES.SUPERVISOR ? { profileId: user.id } : {}),
          teachesLikeProfessor(user.role) ? ownPractices(user.id, from, to) : [],
          fetchEvents(from, to).catch(() => []),
        ])
        if (!active) return
        setEvents(eventRows)
        setSessions(result.sessions)
        const linked = new Set(result.sessions.map((session) => session.practice_id).filter(Boolean))
        setPractices(practiceRows.filter((practice) => !linked.has(practice.id)))
      } catch {
        if (active) setSessions([])
      }
    }
    load()
    const unsubscribe = subscribeToTables(['class_sessions', 'practices'], load, `agenda-${user.id}`)
    return () => { active = false; unsubscribe() }
  }, [user])

  // Clases y prácticas sueltas juntas, por día y hora
  const days = useMemo(() => {
    const entries = [
      ...(sessions || []).map((session) => ({ key: session.id, date: session.date, start: time(session.start_time), session })),
      ...practices.map((practice) => ({ key: `p-${practice.id}`, date: practice.date, start: practice.start_time ? time(practice.start_time) : '', practice })),
      ...events.map((event) => ({ key: `e-${event.id}-${event.occurrence}`, date: event.occurrence, start: event.all_day ? '00:00' : time(event.start_time), event })),
    ].sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start))
    const map = new Map()
    entries.forEach((entry) => { if (!map.has(entry.date)) map.set(entry.date, []); map.get(entry.date).push(entry) })
    return [...map.entries()]
  }, [sessions, practices, events])

  const now = new Date().toTimeString().slice(0, 5)
  const openSession = (session) => {
    const moduleId = session.practices?.module_id || session.teaching_assignments?.degree_modules?.module_id
    if (session.practice_id && moduleId && onOpenPractice) onOpenPractice(session.practice_id, moduleId)
    else onOpen()
  }

  return (
    <section className="card">
      <div className="flex items-center justify-between px-5 pb-2 pt-5">
        <h3 className="font-semibold text-ink">Clases</h3>
        <button type="button" className="link" onClick={onOpen}>Ver horario</button>
      </div>
      {sessions === null && <p className="empty">Cargando…</p>}
      {sessions && days.length === 0 && <p className="empty">No tienes clases en los próximos días.</p>}
      {days.length > 0 && (
        <div className="max-h-[18rem] overflow-y-auto px-4 pb-4">
          {days.map(([date, entries]) => (
            <div key={date}>
              <p className={`sticky top-0 z-10 bg-surface py-1.5 text-xs font-medium ${date === today ? 'text-accent-strong' : 'text-faint'}`}>{dayLabel(date, today)}</p>
              <ul className="space-y-1.5 pb-2">
                {entries.map(({ key, session, practice, event }) => {
                  if (event) return <li key={key}><EventCard event={event} compact onOpen={() => onOpen()} /></li>
                  if (practice) {
                    return (
                      <li key={key}>
                        <button type="button" onClick={() => onOpenPractice?.(practice.id, practice.module_id)}
                          className="flex w-full items-center gap-4 rounded-xl border border-line px-3 py-2.5 text-left hover:bg-subtle">
                          <span className="w-14 shrink-0 text-sm tabular-nums text-muted">{practice.start_time ? time(practice.start_time) : '—'}</span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate font-medium text-ink">{practice.title}</span>
                            <span className="mt-0.5 block text-xs text-muted">Práctica · {practice.module_id} · pasar lista y evaluar</span>
                          </span>
                          <Icon name="next" size={16} className="text-faint" />
                        </button>
                      </li>
                    )
                  }
                  const assignment = session.teaching_assignments
                  const cancelled = session.status === 'cancelada'
                  const live = !cancelled && date === today && time(session.start_time) <= now && now < time(session.end_time)
                  const detail = teachesLikeProfessor(user.role) ? groupLabel(assignment.class_groups) : assignment.profiles?.full_name
                  return (
                    <li key={key}>
                      {/* Al pasar el cursor, un pastel muy suave del color del módulo */}
                      <button type="button" onClick={() => openSession(session)}
                        style={{ '--module': moduleColor(assignment.degree_modules?.modules?.color), borderLeftColor: 'var(--module)', borderRightColor: 'var(--module)' }}
                        className={`flex w-full items-center gap-4 rounded-xl border border-l-[3px] border-r-[3px] border-line px-3 py-2.5 text-left transition-colors duration-300 ease-out hover:bg-[color-mix(in_srgb,var(--module)_10%,var(--surface))] focus-visible:bg-[color-mix(in_srgb,var(--module)_10%,var(--surface))] ${cancelled ? 'opacity-60' : ''}`}>
                        <span className={`w-14 shrink-0 text-sm tabular-nums ${live ? 'font-semibold text-accent-strong' : 'text-muted'}`}>{time(session.start_time)}</span>
                        <span className="min-w-0 flex-1">
                          <span className={`block truncate font-medium text-ink ${cancelled ? 'line-through' : ''}`}>
                            {assignment.degree_modules?.module_id} · {session.practices?.title || session.theory_classes?.title || KIND_LABEL[assignment.degree_modules?.kind]}
                          </span>
                          <span className="mt-0.5 block truncate text-xs text-muted">
                            {cancelled ? 'Cancelada' : [detail, session.room, live && 'Ahora'].filter(Boolean).join(' · ')}
                          </span>
                        </span>
                        <Icon name="next" size={16} className="text-faint" />
                      </button>
                    </li>
                  )
                })}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

// Prácticas de estos días de los módulos que imparte el profesor
async function ownPractices(profileId, from, to) {
  const { data: own } = await supabase.from('teacher_modules').select('module_id').eq('profile_id', profileId)
  const moduleIds = (own || []).map((row) => row.module_id)
  if (!moduleIds.length) return []
  const { data } = await supabase.from('practices').select('id,title,module_id,date,start_time').gte('date', from).lte('date', to).in('module_id', moduleIds).order('date').order('start_time')
  return data || []
}
