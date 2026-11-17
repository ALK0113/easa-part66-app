import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { subscribeToTables } from '../lib/supabaseRealtime.js'
import { KIND_LABEL } from '../lib/academic.js'
import { addDays, fetchSessions, parseISODate, time, toISODate } from '../lib/schedule.js'
import { buildStudentView, useStudentData } from '../lib/studentData.js'
import TodayClasses from './TodayClasses.jsx'
import Icon from './Icon.jsx'

// Inicio del alumno: aviso de faltas, clases de hoy y próximas, próximos exámenes y últimas notas.

const MIN_ATTENDANCE = 85 // mismo umbral que la ficha
const dayLabel = (iso) => {
  const text = parseISODate(iso).toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'short' })
  return text.charAt(0).toUpperCase() + text.slice(1)
}
const shortDate = (iso) => parseISODate(String(iso).slice(0, 10)).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })
const number = (value) => String(Number(value)).replace('.', ',')

export default function StudentHome({ user, setActivePage, onOpenPractice }) {
  const [link, setLink] = useState(undefined)
  useEffect(() => {
    let active = true
    supabase.from('student_profiles').select('student_id').eq('profile_id', user.id).maybeSingle()
      .then(({ data }) => { if (active) setLink(data?.student_id || null) })
    return () => { active = false }
  }, [user.id])

  return (
    <>
      {link && <StudentSections studentId={link} onOpen={() => setActivePage('progress')} before={(
        <>
          <TodayClasses user={user} onOpen={() => setActivePage('timetable')} onOpenPractice={onOpenPractice} />
          <UpcomingClasses user={user} onOpen={() => setActivePage('timetable')} />
        </>
      )} />}
      {link === null && (
        <section className="card p-5 text-sm text-muted">
          Tu cuenta aún no está vinculada a una ficha de alumno. Cuando la escuela la vincule, aquí verás tus clases, exámenes y notas.
        </section>
      )}
    </>
  )
}

// Recarga los datos del alumno cuando cambian sus notas o su asistencia
function useRefreshKey(tables, name) {
  const [version, setVersion] = useState(0)
  useEffect(() => {
    let timer = null
    const unsubscribe = subscribeToTables(tables, () => { clearTimeout(timer); timer = setTimeout(() => setVersion((value) => value + 1), 400) }, name)
    return () => { clearTimeout(timer); unsubscribe() }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- las tablas son fijas por componente
  }, [name])
  return version
}

// Una sola carga de la ficha para el aviso de faltas y las notas
function StudentSections({ studentId, onOpen, before }) {
  const version = useRefreshKey(['session_attendance', 'assessment_grades', 'module_enrollments', 'assessments'], `home-student-${studentId}`)
  const { data } = useStudentData(studentId, version)
  return (
    <>
      <AttendanceWarning data={data} onOpen={onOpen} />
      {before}
      <ExamsAndGrades data={data} version={version} onOpen={onOpen} />
    </>
  )
}

function AttendanceWarning({ data, onOpen }) {
  const low = useMemo(() => {
    if (!data) return []
    return buildStudentView(data).byModule
      .map((item) => ({ ...item, rate: Math.round(((item.P + item.L) / (item.P + item.L + item.A)) * 100) }))
      .filter((item) => item.rate < MIN_ATTENDANCE)
  }, [data])
  if (!low.length) return null
  return (
    <button type="button" onClick={onOpen} className="card flex w-full items-start gap-3 bg-warn-soft p-4 text-left hover:shadow-lift">
      <Icon name="clock" size={18} className="mt-0.5 shrink-0 text-warn" />
      <span className="min-w-0 flex-1 text-sm">
        <span className="block font-medium text-ink">Ojo con la asistencia</span>
        <span className="mt-0.5 block text-ink-soft">
          {low.map((item) => `${item.id}: ${item.rate} % (${item.A} ${item.A === 1 ? 'falta' : 'faltas'})`).join(' · ')}
        </span>
        <span className="mt-0.5 block text-xs text-muted">El mínimo recomendado es el {MIN_ATTENDANCE} %.</span>
      </span>
      <Icon name="next" size={16} className="mt-0.5 text-faint" />
    </button>
  )
}

function UpcomingClasses({ user, onOpen }) {
  const [sessions, setSessions] = useState(null)
  useEffect(() => {
    let active = true
    const tomorrow = addDays(new Date(), 1)
    async function load() {
      try {
        const { sessions: rows } = await fetchSessions(user, toISODate(tomorrow), toISODate(addDays(tomorrow, 6)))
        if (active) setSessions(rows.filter((session) => session.status !== 'cancelada').slice(0, 6))
      } catch {
        if (active) setSessions([])
      }
    }
    load()
    const unsubscribe = subscribeToTables(['class_sessions'], load, `home-upcoming-${user.id}`)
    return () => { active = false; unsubscribe() }
  }, [user])

  const days = useMemo(() => {
    const map = new Map()
    ;(sessions || []).forEach((session) => { if (!map.has(session.date)) map.set(session.date, []); map.get(session.date).push(session) })
    return [...map.entries()]
  }, [sessions])

  return (
    <section className="card">
      <div className="flex items-center justify-between px-5 pb-2 pt-5">
        <h3 className="font-semibold text-ink">Próximos días</h3>
        <button type="button" className="link" onClick={onOpen}>Ver horario</button>
      </div>
      {sessions === null && <p className="empty">Cargando…</p>}
      {sessions?.length === 0 && <p className="empty">No tienes clases en los próximos días.</p>}
      {days.length > 0 && (
        <div className="space-y-3 px-5 pb-5">
          {days.map(([date, rows]) => (
            <div key={date}>
              <p className="mb-1 text-xs font-medium text-faint">{dayLabel(date)}</p>
              <ul className="divide-y divide-line rounded-xl border border-line">
                {rows.map((session) => {
                  const assignment = session.teaching_assignments
                  return (
                    <li key={session.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                      <span className="w-12 shrink-0 tabular-nums text-muted">{time(session.start_time)}</span>
                      <span className="min-w-0 flex-1 truncate text-ink">
                        {assignment.degree_modules?.module_id} · {session.theory_classes?.title || KIND_LABEL[assignment.degree_modules?.kind]}
                      </span>
                      <span className="hidden truncate text-xs text-muted sm:block">{[assignment.profiles?.full_name, session.room].filter(Boolean).join(' · ')}</span>
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

function ExamsAndGrades({ data, version, onOpen }) {
  const [exams, setExams] = useState(null)

  const moduleIds = useMemo(() => (data
    ? [...new Set(data.modules.filter((item) => item.academic_years?.is_current && !['convalidado', 'exento', 'baja'].includes(item.status)).map((item) => item.degree_modules?.module_id).filter(Boolean))].sort()
    : null), [data])
  const moduleKey = moduleIds?.join(',')

  useEffect(() => {
    if (!moduleKey) return undefined
    let active = true
    supabase.from('assessments').select('id,title,kind,scope,date,module_id,max_grade')
      .in('module_id', moduleKey.split(',')).gte('date', toISODate(new Date()))
      .order('date').limit(5)
      .then(({ data: rows }) => { if (active) setExams(rows || []) })
    return () => { active = false }
  }, [moduleKey, version])

  // Sin módulos este curso no hay exámenes que buscar
  const upcoming = moduleKey === '' ? [] : exams

  const latest = useMemo(() => {
    if (!data) return null
    const fromAssessments = data.grades.filter((row) => row.grade != null).map((row) => ({
      key: `a-${row.assessments?.title}-${row.updated_at}`,
      date: row.updated_at,
      module: row.assessments?.module_id,
      title: row.assessments?.title,
      detail: row.assessments?.kind === 'examen' ? 'Examen' : 'Evaluación',
      value: `${number(row.grade)}`,
      max: Number(row.assessments?.max_grade || 10),
      comment: row.comment,
    }))
    const fromModules = data.modules.filter((item) => item.graded_at && (item.theory_grade != null || item.practical_result)).map((item) => {
      const practice = item.degree_modules?.kind === 'practica'
      return {
        key: `m-${item.id}`,
        date: item.graded_at,
        module: item.degree_modules?.module_id,
        title: 'Nota final del módulo',
        detail: KIND_LABEL[item.degree_modules?.kind],
        value: practice ? (item.practical_result === 'apto' ? 'Apto' : 'No apto') : number(item.theory_grade),
        max: practice ? null : Number(item.academic_years?.schools?.grade_max ?? 100),
      }
    })
    return [...fromAssessments, ...fromModules].sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, 5)
  }, [data])

  return (
    <div className="grid items-start gap-5 lg:grid-cols-2">
      <section className="card">
        <h3 className="px-5 pb-2 pt-5 font-semibold text-ink">Próximos exámenes</h3>
        {upcoming === null && <p className="empty">Cargando…</p>}
        {upcoming?.length === 0 && <p className="empty">No tienes exámenes próximos.</p>}
        {upcoming?.length > 0 && (
          <ul className="px-2 pb-2">
            {upcoming.map((exam) => (
              <li key={exam.id} className="flex items-center gap-4 rounded-xl px-3 py-2.5">
                <span className="flex w-12 shrink-0 flex-col items-center rounded-lg bg-subtle py-1.5">
                  <span className="text-[11px] text-muted">{parseISODate(exam.date).toLocaleDateString('es-ES', { month: 'short' }).replace('.', '')}</span>
                  <span className="text-lg font-semibold leading-none text-ink">{Number(exam.date.slice(8, 10))}</span>
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-ink">{exam.title}</span>
                  <span className="mt-0.5 block text-xs text-muted">
                    {exam.module_id} · {exam.kind === 'examen' ? `Examen ${exam.scope === 'ra' ? 'de RA' : 'parcial'}` : 'Evaluación'}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card">
        <div className="flex items-center justify-between px-5 pb-2 pt-5">
          <h3 className="font-semibold text-ink">Últimas notas</h3>
          <button type="button" className="link" onClick={onOpen}>Ver todo</button>
        </div>
        {latest === null && <p className="empty">Cargando…</p>}
        {latest?.length === 0 && <p className="empty">Aún no tienes notas.</p>}
        {latest?.length > 0 && (
          <ul className="px-2 pb-2">
            {latest.map((item) => (
              <li key={item.key} className="rounded-xl px-3 py-2.5">
                <div className="flex items-center gap-3 text-sm">
                  <span className="w-12 shrink-0 font-semibold tabular-nums text-ink">{item.module}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-ink">{item.title}</span>
                    <span className="block text-xs text-muted">{item.detail} · {shortDate(item.date)}</span>
                  </span>
                  <span className="font-semibold tabular-nums text-ink">
                    {item.value}{item.max != null && <span className="text-xs font-normal text-muted">/{item.max}</span>}
                  </span>
                </div>
                {item.comment && <p className="ml-[3.75rem] mt-1 whitespace-pre-line rounded-lg bg-subtle/60 px-3 py-1.5 text-xs text-ink-soft">{item.comment}</p>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
