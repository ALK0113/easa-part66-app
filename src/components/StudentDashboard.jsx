import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { getSupabaseErrorMessage } from '../lib/supabaseErrors.js'
import { KIND_LABEL, groupLabel } from '../lib/academic.js'
import { isManager } from '../lib/roles.js'
import { useStudentConflicts } from '../lib/conflicts.js'
import Icon from './Icon.jsx'
import ConflictNotice from './StudentConflicts.jsx'

// Ficha completa del alumno a modo de panel: datos personales, matrícula, módulos pendientes,
// asistencia y faltas, notas (módulos, exámenes, prácticas), comentarios y su historial por curso.

const STATUS = {
  aprobado: ['Aprobado', 'bg-success-soft text-success'],
  suspendido: ['Suspendido', 'bg-danger-soft text-danger'],
  cursando: ['Cursando', 'bg-subtle text-ink-soft'],
  convalidado: ['Convalidado', 'bg-accent-soft text-accent-strong'],
  exento: ['Exento', 'bg-accent-soft text-accent-strong'],
  baja: ['No cursa', 'bg-subtle text-muted'],
}
const ATTENDANCE = { P: ['Presente', 'text-success'], L: ['Tarde', 'text-warn'], A: ['Falta', 'text-danger'] }
const fmtDate = (date) => (date ? new Date(`${String(date).slice(0, 10)}T00:00`).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' }) : '—')
const shortDate = (date) => (date ? new Date(`${String(date).slice(0, 10)}T00:00`).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' }) : '')
const percent = (part, total) => (total ? Math.round((part / total) * 100) : null)
const resultOf = (item) => (item.degree_modules?.kind === 'practica'
  ? (item.practical_result === 'apto' ? 'Apto' : item.practical_result === 'no_apto' ? 'No apto' : '')
  : (item.theory_grade != null ? String(Number(item.theory_grade)) : ''))
const PERSONAL = [
  ['dni', 'DNI / NIE', 'text'], ['birth_date', 'Fecha de nacimiento', 'date'], ['email', 'Correo', 'email'], ['phone', 'Teléfono', 'tel'],
  ['address', 'Dirección', 'text'], ['emergency_name', 'Contacto de emergencia', 'text'], ['emergency_phone', 'Teléfono de emergencia', 'tel'],
]

function useStudentData(studentId, version) {
  const [state, setState] = useState({ data: null, error: '' })
  useEffect(() => {
    let active = true
    async function load() {
      const [student, link, enrollments, modules, attendance, practices, grades, names] = await Promise.all([
        supabase.from('students').select('*, cohorts(name)').eq('id', studentId).single(),
        supabase.from('student_profiles').select('profile_id, profiles(full_name, email, phone, status)').eq('student_id', studentId).maybeSingle(),
        supabase.from('enrollments').select('academic_year_id, level, status, left_on, academic_years(name, starts_on, is_current), class_groups(level, name)').eq('student_id', studentId),
        supabase.from('module_enrollments').select('id, academic_year_id, is_carryover, theory_grade, practical_result, status, joined_on, left_on, degree_modules(module_id, kind, level), class_groups(level, name), academic_years(name, starts_on, is_current)').eq('student_id', studentId),
        supabase.from('session_attendance').select('session_id, status, evaluation, comment, updated_at, class_sessions(date, start_time, end_time, status, recovery, practices(title), theory_classes(title), teaching_assignments(degree_modules(module_id)))').eq('student_id', studentId),
        supabase.from('practice_records').select('practice_id, attendance, evaluation, comment, updated_at, practices(title, module_id)').eq('student_id', studentId),
        supabase.from('assessment_grades').select('grade, comment, updated_at, assessments(title, kind, scope, max_grade, module_id, date)').eq('student_id', studentId),
        supabase.from('modules').select('id, name'),
      ])
      const failed = [student, enrollments, modules].find((result) => result.error)
      if (failed) { if (active) setState({ data: null, error: getSupabaseErrorMessage(failed.error) }); return }
      const profileId = link.data?.profile_id
      const tlbs = profileId
        ? await supabase.from('tlb_submissions').select('id, signed_at, control_number, revision, tlbs(aircraft, registration, module_id)').eq('student_id', profileId)
        : { data: [] }
      if (!active) return
      setState({
        error: '',
        data: {
          student: student.data,
          profile: link.data?.profiles || null,
          enrollments: enrollments.data || [],
          modules: modules.data || [],
          attendance: (attendance.data || []).filter((row) => row.class_sessions),
          practices: practices.data || [],
          grades: grades.data || [],
          tlbs: tlbs.data || [],
          names: Object.fromEntries((names.data || []).map((item) => [item.id, item.name])),
        },
      })
    }
    load()
    return () => { active = false }
  }, [studentId, version])
  return state
}

export default function StudentDashboard({ studentId, user, onBack }) {
  const [version, setVersion] = useState(0)
  const { data, error } = useStudentData(studentId, version)
  const [editing, setEditing] = useState(false)
  const conflicts = useStudentConflicts(data?.student?.school_id, studentId, version)

  const view = useMemo(() => {
    if (!data) return null
    const currentEnrollment = data.enrollments.find((item) => item.academic_years?.is_current)
    const current = data.modules.filter((item) => item.academic_years?.is_current).sort((a, b) => (a.degree_modules?.module_id || '').localeCompare(b.degree_modules?.module_id || ''))
    // Pendientes: arrastrados este curso + suspendidos de cursos anteriores que no se han aprobado después
    const approved = new Set(data.modules.filter((item) => ['aprobado', 'convalidado', 'exento'].includes(item.status)).map((item) => `${item.degree_modules?.module_id}-${item.degree_modules?.kind}`))
    const pending = [
      ...current.filter((item) => item.is_carryover),
      ...data.modules.filter((item) => !item.academic_years?.is_current && item.status === 'suspendido' && !approved.has(`${item.degree_modules?.module_id}-${item.degree_modules?.kind}`)
        && !current.some((cur) => cur.degree_modules?.module_id === item.degree_modules?.module_id && cur.degree_modules?.kind === item.degree_modules?.kind)),
    ]
    const marked = data.attendance.filter((row) => row.status && row.class_sessions.status !== 'cancelada')
    const count = (status) => marked.filter((row) => row.status === status).length
    const byModule = {}
    marked.forEach((row) => {
      const id = row.class_sessions.teaching_assignments?.degree_modules?.module_id || '—'
      const item = (byModule[id] ||= { id, P: 0, L: 0, A: 0 })
      item[row.status] += 1
    })
    const absences = marked.filter((row) => row.status === 'A').sort((a, b) => b.class_sessions.date.localeCompare(a.class_sessions.date))
    const className = (row) => row.class_sessions.practices?.title || row.class_sessions.theory_classes?.title || ''
    const comments = [
      ...data.attendance.filter((row) => row.comment).map((row) => ({ date: row.class_sessions.date, source: `${row.class_sessions.teaching_assignments?.degree_modules?.module_id || ''} · sesión${className(row) ? ` · ${className(row)}` : ''}`, text: row.comment })),
      ...data.practices.filter((row) => row.comment).map((row) => ({ date: row.updated_at, source: `${row.practices?.module_id || ''} · práctica · ${row.practices?.title || ''}`, text: row.comment })),
      ...data.grades.filter((row) => row.comment).map((row) => ({ date: row.assessments?.date || row.updated_at, source: `${row.assessments?.module_id || ''} · ${row.assessments?.kind === 'examen' ? 'examen' : 'evaluación'} · ${row.assessments?.title || ''}`, text: row.comment })),
    ].sort((a, b) => String(b.date).localeCompare(String(a.date)))
    const graded = current.filter((item) => item.degree_modules?.kind === 'teoria' && item.theory_grade != null)
    const average = graded.length ? graded.reduce((sum, item) => sum + Number(item.theory_grade), 0) / graded.length : null
    const evaluatedPractices = data.practices.filter((row) => row.evaluation)
    const years = [...new Map([...data.enrollments, ...data.modules].map((item) => [item.academic_year_id, item.academic_years])).entries()]
      .map(([id, year]) => ({ id, year, enrollment: data.enrollments.find((item) => item.academic_year_id === id), modules: data.modules.filter((item) => item.academic_year_id === id) }))
      .sort((a, b) => (b.year?.starts_on || '').localeCompare(a.year?.starts_on || ''))
    return { currentEnrollment, current, pending, marked, present: count('P'), late: count('L'), absent: count('A'), byModule: Object.values(byModule).sort((a, b) => a.id.localeCompare(b.id)), absences, className, comments, average, evaluatedPractices, years }
  }, [data])

  if (error) return <div className="space-y-4"><button type="button" className="back-link" onClick={onBack}>← Alumnos</button><p role="alert" className="notice-error">{error}</p></div>
  if (!data || !view) return <div className="flex min-h-[40vh] items-center justify-center text-sm text-muted">Cargando ficha…</div>

  const { student, profile } = data
  const group = view.currentEnrollment?.class_groups
  const dropped = view.currentEnrollment?.status === 'baja'
  const rate = percent(view.present + view.late, view.marked.length)
  const initials = (student.name || '?').split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase()
  const aptas = view.evaluatedPractices.filter((row) => row.evaluation === 'Apto').length
  const tiles = [
    ['Asistencia', rate === null ? '—' : `${rate}%`, rate !== null && rate < 85 ? 'text-danger' : 'text-ink', `${view.marked.length} sesiones registradas`],
    ['Faltas', view.absent, view.absent ? 'text-danger' : 'text-ink', view.late ? `${view.late} retrasos` : 'sin retrasos'],
    ['Módulos este curso', view.current.filter((item) => !['convalidado', 'exento', 'baja'].includes(item.status)).length, 'text-ink', `${view.current.filter((item) => item.status === 'aprobado').length} aprobados`],
    ['Pendientes', view.pending.length, view.pending.length ? 'text-warn' : 'text-ink', 'de cursos anteriores'],
    ['Nota media teoría', view.average === null ? '—' : view.average.toFixed(1).replace('.', ','), 'text-ink', 'módulos con nota este curso'],
    ['Prácticas aptas', `${aptas}/${view.evaluatedPractices.length}`, 'text-ink', 'con nota general'],
  ]

  return (
    <div className="space-y-5">
      <button type="button" className="back-link" onClick={onBack}>← Alumnos</button>

      <section className="card flex flex-wrap items-center gap-4 p-5">
        <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-accent-soft text-lg font-semibold text-accent-strong">{initials}</span>
        <div className="min-w-0 flex-1">
          <h2 className="text-2xl font-semibold text-ink">{student.name}</h2>
          <p className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-sm text-muted">
            {student.student_number && <span>Nº {student.student_number}</span>}
            <span>{group ? groupLabel(group) : 'Sin grupo'}{view.currentEnrollment?.academic_years?.name ? ` · ${view.currentEnrollment.academic_years.name}` : ''}</span>
            {(student.cohorts?.name || student.promo) && <span>Promoción {student.cohorts?.name || student.promo}</span>}
            {profile?.email && <span className="inline-flex items-center gap-1"><Icon name="mail" size={13} />{profile.email}</span>}
          </p>
        </div>
        {dropped && <span className="badge bg-danger-soft text-danger">Baja desde {shortDate(view.currentEnrollment.left_on)}</span>}
        {!profile && <span className="badge text-muted">Sin cuenta de acceso</span>}
      </section>

      <ConflictNotice rows={conflicts} title="Clases solapadas" hint="Se puede reubicar al alumno en Escuela → Alumnos o ajustar el horario de una de las clases." />

      <dl className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {tiles.map(([label, value, tone, hint]) => (
          <div key={label} className="card px-4 py-3">
            <dt className="text-xs text-muted">{label}</dt>
            <dd className={`mt-1 text-2xl font-semibold tabular-nums ${tone}`}>{value}</dd>
            <dd className="mt-0.5 truncate text-[11px] text-faint">{hint}</dd>
          </div>
        ))}
      </dl>

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div className="space-y-5">
          <Card title="Módulos este curso" icon="layers">
            {view.current.length === 0 ? <Empty>Sin módulos este curso.</Empty> : (
              <ul className="divide-y divide-line">
                {view.current.map((item) => {
                  const [label, tone] = STATUS[item.status] || STATUS.cursando
                  const result = resultOf(item)
                  return (
                    <li key={item.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
                      <span className="w-12 font-semibold tabular-nums text-ink">{item.degree_modules?.module_id}</span>
                      <span className="min-w-0 flex-1 truncate text-ink-soft">{data.names[item.degree_modules?.module_id] || ''} <span className="text-xs text-muted">· {KIND_LABEL[item.degree_modules?.kind]}{item.class_groups && groupLabel(item.class_groups) !== groupLabel(group) ? ` · con ${groupLabel(item.class_groups)}` : ''}{item.is_carryover ? ' · pendiente' : ''}</span></span>
                      {result && <span className="font-semibold tabular-nums text-ink">{result}</span>}
                      <span className={`badge ${tone}`}>{label}</span>
                    </li>
                  )
                })}
              </ul>
            )}
          </Card>

          {view.pending.length > 0 && (
            <Card title="Módulos pendientes" icon="clock" tone="text-warn">
              <ul className="divide-y divide-line">
                {view.pending.map((item) => (
                  <li key={item.id} className="flex items-center gap-3 py-2 text-sm">
                    <span className="w-12 font-semibold tabular-nums text-ink">{item.degree_modules?.module_id}</span>
                    <span className="min-w-0 flex-1 truncate text-ink-soft">{data.names[item.degree_modules?.module_id] || ''} · {KIND_LABEL[item.degree_modules?.kind]}</span>
                    <span className="text-xs text-muted">{item.academic_years?.is_current ? `este curso con ${groupLabel(item.class_groups)}` : `suspendido en ${item.academic_years?.name || ''}`}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <Card title="Exámenes y evaluaciones" icon="grade">
            {data.grades.length === 0 ? <Empty>Sin notas de exámenes ni evaluaciones.</Empty> : (
              <ul className="divide-y divide-line">
                {[...data.grades].sort((a, b) => String(b.assessments?.date || '').localeCompare(String(a.assessments?.date || ''))).map((row, index) => (
                  <li key={index} className="flex items-center gap-3 py-2 text-sm">
                    <span className="w-12 font-semibold tabular-nums text-ink">{row.assessments?.module_id}</span>
                    <span className="min-w-0 flex-1 truncate text-ink-soft">{row.assessments?.title} <span className="text-xs text-muted">· {row.assessments?.kind === 'examen' ? `examen ${row.assessments?.scope === 'ra' ? 'de RA' : 'parcial'}` : 'evaluación'}{row.assessments?.date ? ` · ${shortDate(row.assessments.date)}` : ''}</span></span>
                    <span className="font-semibold tabular-nums text-ink">{row.grade == null ? '—' : String(Number(row.grade)).replace('.', ',')}<span className="text-xs font-normal text-muted">/{Number(row.assessments?.max_grade || 10)}</span></span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="Prácticas" icon="wrench">
            {data.practices.length === 0 ? <Empty>Sin prácticas registradas.</Empty> : (
              <ul className="divide-y divide-line">
                {data.practices.map((row) => (
                  <li key={row.practice_id} className="flex items-center gap-3 py-2 text-sm">
                    <span className="w-12 font-semibold tabular-nums text-ink">{row.practices?.module_id}</span>
                    <span className="min-w-0 flex-1 truncate text-ink-soft">{row.practices?.title || row.practice_id}</span>
                    {row.attendance && <span className={`text-xs ${ATTENDANCE[row.attendance][1]}`}>{ATTENDANCE[row.attendance][0]}</span>}
                    <span className={`badge ${row.evaluation === 'Apto' ? 'bg-success-soft text-success' : row.evaluation === 'No Apto' ? 'bg-danger-soft text-danger' : 'text-faint'}`}>{row.evaluation === 'No Apto' ? 'No apto' : row.evaluation || 'Pendiente'}</span>
                  </li>
                ))}
              </ul>
            )}
            {data.tlbs.length > 0 && <p className="mt-3 text-xs text-muted">Task Log Book: {data.tlbs.filter((row) => row.signed_at).length} firmados de {data.tlbs.length}.</p>}
          </Card>

          <Card title="Comentarios" icon="edit">
            {view.comments.length === 0 && !student.notes ? <Empty>Sin comentarios.</Empty> : (
              <ul className="space-y-3">
                {view.comments.slice(0, 30).map((item, index) => (
                  <li key={index} className="rounded-xl bg-subtle/50 px-3 py-2">
                    <p className="text-xs text-muted">{shortDate(item.date)} · {item.source}</p>
                    <p className="mt-0.5 whitespace-pre-line text-sm text-ink">{item.text}</p>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="space-y-5">
          <PersonalData student={student} profile={profile} canEdit={isManager(user.role)} editing={editing} setEditing={setEditing} onSaved={() => { setEditing(false); setVersion((value) => value + 1) }} />

          <Card title="Asistencia por módulo" icon="chart">
            {view.byModule.length === 0 ? <Empty>Aún no hay asistencia registrada.</Empty> : (
              <ul className="space-y-2.5">
                {view.byModule.map((item) => {
                  const total = item.P + item.L + item.A
                  const value = percent(item.P + item.L, total)
                  return (
                    <li key={item.id} className="text-sm">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium text-ink">{item.id} <span className="text-xs font-normal text-muted">{data.names[item.id] || ''}</span></span>
                        <span className={`tabular-nums ${value < 85 ? 'text-danger' : 'text-ink-soft'}`}>{value}%</span>
                      </div>
                      <div className="mt-1 flex h-1.5 overflow-hidden rounded-full bg-subtle" aria-hidden="true">
                        <span className="bg-success" style={{ width: `${(item.P / total) * 100}%` }} />
                        <span className="bg-warn" style={{ width: `${(item.L / total) * 100}%` }} />
                        <span className="bg-danger" style={{ width: `${(item.A / total) * 100}%` }} />
                      </div>
                      <p className="mt-0.5 text-[11px] text-muted">{item.P} presente · {item.L} tarde · {item.A} falta</p>
                    </li>
                  )
                })}
              </ul>
            )}
          </Card>

          <Card title={`Faltas${view.absences.length ? ` · ${view.absences.length}` : ''}`} icon="calendar" tone={view.absences.length ? 'text-danger' : ''}>
            {view.absences.length === 0 ? <Empty>Sin faltas.</Empty> : (
              <ul className="divide-y divide-line">
                {view.absences.slice(0, 20).map((row) => (
                  <li key={row.session_id} className="flex items-center gap-3 py-2 text-sm">
                    <span className="w-16 shrink-0 tabular-nums text-muted">{shortDate(row.class_sessions.date)}</span>
                    <span className="w-12 font-semibold text-ink">{row.class_sessions.teaching_assignments?.degree_modules?.module_id}</span>
                    <span className="min-w-0 flex-1 truncate text-ink-soft">{view.className(row) || (row.class_sessions.recovery ? 'Recuperación' : 'Clase')}</span>
                    <span className="text-xs text-faint">{String(row.class_sessions.start_time).slice(0, 5)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="Historial por curso" icon="book">
            {view.years.length === 0 ? <Empty>Sin matrículas registradas.</Empty> : (
              <div className="space-y-3">
                {view.years.map((item) => (
                  <details key={item.id} open={item.year?.is_current} className="rounded-xl border border-line">
                    <summary className="flex cursor-pointer items-center justify-between gap-2 px-3 py-2 text-sm">
                      <span className="font-medium text-ink">{item.year?.name || 'Curso'}</span>
                      <span className="text-xs text-muted">{item.enrollment?.class_groups ? groupLabel(item.enrollment.class_groups) : 'módulos sueltos'}{item.enrollment?.status && item.enrollment.status !== 'cursando' ? ` · ${item.enrollment.status}` : ''}</span>
                    </summary>
                    <ul className="divide-y divide-line border-t border-line">
                      {item.modules.sort((a, b) => (a.degree_modules?.module_id || '').localeCompare(b.degree_modules?.module_id || '')).map((mod) => {
                        const [label, tone] = STATUS[mod.status] || STATUS.cursando
                        return (
                          <li key={mod.id} className="flex items-center gap-2 px-3 py-1.5 text-xs">
                            <span className="w-10 font-semibold text-ink">{mod.degree_modules?.module_id}</span>
                            <span className="flex-1 text-muted">{KIND_LABEL[mod.degree_modules?.kind]}</span>
                            <span className="tabular-nums text-ink">{resultOf(mod)}</span>
                            <span className={`badge py-0 ${tone}`}>{label}</span>
                          </li>
                        )
                      })}
                    </ul>
                  </details>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  )
}

function Card({ title, icon, tone = '', children }) {
  return (
    <section className="card p-5">
      <h3 className={`mb-3 flex items-center gap-2 font-semibold ${tone || 'text-ink'}`}><Icon name={icon} size={16} className="text-faint" />{title}</h3>
      {children}
    </section>
  )
}

function Empty({ children }) {
  return <p className="text-sm text-muted">{children}</p>
}

// Datos personales: los ve el personal; los edita administración y supervisión
function PersonalData({ student, profile, canEdit, editing, setEditing, onSaved }) {
  const [form, setForm] = useState(() => Object.fromEntries([...PERSONAL.map(([key]) => [key, student[key] || '']), ['notes', student.notes || '']]))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function save(event) {
    event.preventDefault()
    setBusy(true)
    setError('')
    const values = Object.fromEntries(Object.entries(form).map(([key, value]) => [key, String(value).trim() || null]))
    const { error: saveError } = await supabase.from('students').update(values).eq('id', student.id)
    setBusy(false)
    if (saveError) { setError(getSupabaseErrorMessage(saveError)); return }
    onSaved()
  }

  if (editing) {
    return (
      <section className="card p-5">
        <h3 className="mb-3 flex items-center gap-2 font-semibold text-ink"><Icon name="idcard" size={16} className="text-faint" />Datos personales</h3>
        <form className="grid gap-3 sm:grid-cols-2" onSubmit={save}>
          {PERSONAL.map(([key, label, type]) => (
            <label key={key} className={`field text-xs ${key === 'address' ? 'sm:col-span-2' : ''}`}>{label}
              <input className="input" type={type} value={form[key]} onChange={(event) => setForm({ ...form, [key]: event.target.value })} />
            </label>
          ))}
          <label className="field text-xs sm:col-span-2">Observaciones
            <textarea className="input" rows="3" maxLength={4000} value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} placeholder="Necesidades, adaptaciones, información relevante…" />
          </label>
          {error && <p role="alert" className="notice-error sm:col-span-2">{error}</p>}
          <div className="flex justify-end gap-2 sm:col-span-2">
            <button type="button" className="btn-ghost" onClick={() => setEditing(false)}>Cancelar</button>
            <button type="submit" className="btn-primary" disabled={busy}>{busy ? 'Guardando…' : 'Guardar'}</button>
          </div>
        </form>
      </section>
    )
  }

  const rows = PERSONAL.map(([key, label]) => [label, key === 'birth_date' ? (student.birth_date ? fmtDate(student.birth_date) : '') : student[key]])
  return (
    <section className="card p-5">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 font-semibold text-ink"><Icon name="idcard" size={16} className="text-faint" />Datos personales</h3>
        {canEdit && <button type="button" className="btn-ghost min-h-[30px] px-2 text-xs text-accent" onClick={() => setEditing(true)}><Icon name="edit" size={14} />Editar</button>}
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-muted">{label}</dt>
            <dd className={value ? 'text-ink' : 'text-faint'}>{value || '—'}</dd>
          </div>
        ))}
        <dt className="text-muted">Cuenta</dt>
        <dd className={profile ? 'text-ink' : 'text-faint'}>{profile ? `${profile.email}${profile.status && profile.status !== 'active' ? ` · ${profile.status}` : ''}` : 'Sin vincular'}</dd>
      </dl>
      {student.notes && <div className="mt-3 rounded-xl bg-subtle/60 px-3 py-2"><p className="text-xs font-medium text-muted">Observaciones</p><p className="mt-0.5 whitespace-pre-line text-sm text-ink">{student.notes}</p></div>}
    </section>
  )
}
