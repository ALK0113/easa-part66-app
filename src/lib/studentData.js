import { useEffect, useState } from 'react'
import { supabase } from './supabase.js'
import { getSupabaseErrorMessage } from './supabaseErrors.js'

// Datos de la ficha de un alumno y sus cálculos. Los usan la ficha (personal y alumno) y el inicio del alumno.

export function useStudentData(studentId, version) {
  const [state, setState] = useState({ data: null, error: '' })
  useEffect(() => {
    let active = true
    async function load() {
      const [student, link, enrollments, modules, attendance, practices, grades, names] = await Promise.all([
        supabase.from('students').select('*, cohorts(name)').eq('id', studentId).single(),
        supabase.from('student_profiles').select('profile_id, profiles(full_name, email, phone, status)').eq('student_id', studentId).maybeSingle(),
        supabase.from('enrollments').select('academic_year_id, level, status, left_on, academic_years(name, starts_on, is_current), class_groups(level, name)').eq('student_id', studentId),
        supabase.from('module_enrollments').select('id, academic_year_id, is_carryover, theory_grade, practical_result, status, graded_at, joined_on, left_on, degree_modules(module_id, kind, level), class_groups(level, name), academic_years(name, starts_on, is_current, schools(grade_max))').eq('student_id', studentId),
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

const moduleKey = (item) => `${item.degree_modules?.module_id}-${item.degree_modules?.kind}`

// Pendientes: arrastrados en el curso de referencia + suspendidos de cursos anteriores que no se han aprobado después.
// `isCurrent` marca el curso de referencia (por defecto, el curso actual); el boletín de un curso pasado pasa el suyo.
export function pendingModules(modules, isCurrent = (item) => item.academic_years?.is_current) {
  const current = modules.filter(isCurrent)
  const currentStart = current[0]?.academic_years?.starts_on || ''
  const approved = new Set(modules.filter((item) => ['aprobado', 'convalidado', 'exento'].includes(item.status)).map(moduleKey))
  return [
    ...current.filter((item) => item.is_carryover),
    ...modules.filter((item) => !isCurrent(item) && item.status === 'suspendido' && !approved.has(moduleKey(item))
      && (!currentStart || (item.academic_years?.starts_on || '') < currentStart)
      && !current.some((cur) => moduleKey(cur) === moduleKey(item))),
  ]
}

// Cálculos de la ficha (también los usa el inicio del alumno)
export function buildStudentView(data) {
  const currentEnrollment = data.enrollments.find((item) => item.academic_years?.is_current)
  const current = data.modules.filter((item) => item.academic_years?.is_current).sort((a, b) => (a.degree_modules?.module_id || '').localeCompare(b.degree_modules?.module_id || ''))
  const pending = pendingModules(data.modules)
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
}
