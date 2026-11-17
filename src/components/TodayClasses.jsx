import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { subscribeToTables } from '../lib/supabaseRealtime.js'
import { KIND_LABEL, groupLabel } from '../lib/academic.js'
import { ROLES, teachesLikeProfessor } from '../lib/roles.js'
import { fetchSessions, time, toISODate } from '../lib/schedule.js'
import Icon from './Icon.jsx'
import { moduleColor } from '../lib/moduleColors.js'

// Clases de hoy en el inicio (profesor y alumno). Al tocar una se abre el horario.
// El profesor ve también las prácticas de hoy de sus módulos que no van en una clase: se abren para pasar lista.
export default function TodayClasses({ user, onOpen, onOpenPractice }) {
  const [sessions, setSessions] = useState(null)
  const [practices, setPractices] = useState([])

  useEffect(() => {
    let active = true
    const today = toISODate(new Date())
    async function load() {
      try {
        // El supervisor ve en el inicio sus propias clases
        const [result, practiceRows] = await Promise.all([
          fetchSessions(user, today, today, user.role === ROLES.SUPERVISOR ? { profileId: user.id } : {}),
          teachesLikeProfessor(user.role) ? todayPractices(user.id, today) : [],
        ])
        if (!active) return
        setSessions(result.sessions)
        const linked = new Set(result.sessions.map((session) => session.practice_id).filter(Boolean))
        setPractices(practiceRows.filter((practice) => !linked.has(practice.id)))
      } catch {
        if (active) setSessions([])
      }
    }
    load()
    const unsubscribe = subscribeToTables(['class_sessions', 'practices'], load, `today-${user.id}`)
    return () => { active = false; unsubscribe() }
  }, [user])

  const now = new Date().toTimeString().slice(0, 5)

  return (
    <section className="card">
      <div className="flex items-center justify-between px-5 pb-2 pt-5">
        <h3 className="font-semibold text-ink">Hoy</h3>
        <button type="button" className="link" onClick={onOpen}>Ver horario</button>
      </div>
      {sessions === null && <p className="empty">Cargando…</p>}
      {sessions?.length === 0 && !practices.length && <p className="empty">Hoy no tienes clases.</p>}
      {practices.length > 0 && onOpenPractice && (
        <ul className="px-2">
          {practices.map((practice) => (
            <li key={practice.id}>
              <button type="button" onClick={() => onOpenPractice(practice.id)} className="flex w-full items-center gap-4 rounded-xl px-3 py-3 text-left hover:bg-subtle">
                <span className="w-14 shrink-0 text-sm tabular-nums text-muted">{practice.start_time ? time(practice.start_time) : '—'}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-ink">{practice.title}</span>
                  <span className="mt-0.5 block text-xs text-muted">Práctica · {practice.module_id} · pasar lista y evaluar</span>
                </span>
                <Icon name="next" size={16} className="text-faint" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {sessions?.length > 0 && (
        <ul className="space-y-1.5 px-4 pb-4">
          {sessions.map((session) => {
            const assignment = session.teaching_assignments
            const cancelled = session.status === 'cancelada'
            const live = !cancelled && time(session.start_time) <= now && now < time(session.end_time)
            const detail = teachesLikeProfessor(user.role) ? groupLabel(assignment.class_groups) : assignment.profiles?.full_name
            return (
              <li key={session.id}>
                <button type="button" onClick={onOpen} style={{ borderLeftColor: moduleColor(assignment.degree_modules?.modules?.color) }}
                  className={`flex w-full items-center gap-4 rounded-xl border border-l-[3px] border-line px-3 py-2.5 text-left hover:bg-subtle ${cancelled ? 'opacity-60' : ''}`}>
                  <span className={`w-14 shrink-0 text-sm tabular-nums ${live ? 'font-semibold text-accent-strong' : 'text-muted'}`}>{time(session.start_time)}</span>
                  <span className="min-w-0 flex-1">
                    <span className={`block truncate font-medium text-ink ${cancelled ? 'line-through' : ''}`}>
                      {assignment.degree_modules?.module_id} · {KIND_LABEL[assignment.degree_modules?.kind]}
                    </span>
                    <span className="mt-0.5 block text-xs text-muted">
                      {cancelled ? 'Cancelada' : [detail, session.room, live && 'Ahora'].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                  <Icon name="next" size={16} className="text-faint" />
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

// Prácticas de hoy de los módulos que imparte el profesor
async function todayPractices(profileId, today) {
  const { data: own } = await supabase.from('teacher_modules').select('module_id').eq('profile_id', profileId)
  const moduleIds = (own || []).map((row) => row.module_id)
  if (!moduleIds.length) return []
  const { data } = await supabase.from('practices').select('id,title,module_id,start_time').eq('date', today).in('module_id', moduleIds).order('start_time')
  return data || []
}
