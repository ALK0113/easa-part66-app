import { useEffect, useState } from 'react'
import { supabase } from './supabase.js'

// Lo que el alumno ve de un módulo: su asistencia (con cada falta y su sesión) y sus notas
// (evaluaciones del curso actual, nota final y exámenes del módulo).
// profileId: el del alumno (null para el resto de roles: no carga nada)
export function useStudentModule(moduleId, profileId) {
  const [state, setState] = useState(null)
  useEffect(() => {
    if (!profileId || !moduleId) return undefined
    let active = true
    async function load() {
      const { data: link } = await supabase.from('student_profiles').select('student_id').eq('profile_id', profileId).maybeSingle()
      if (!link) { if (active) setState({ linked: false }); return }
      const studentId = link.student_id
      const [attendance, submodules, exams, enrollments] = await Promise.all([
        supabase.from('session_attendance')
          .select('status,comment,class_sessions!inner(id,date,start_time,end_time,status,recovery,practices(id,title,ata,submodule_id),theory_classes(title,submodule_id),teaching_assignments!inner(degree_modules!inner(module_id,kind)))')
          .eq('student_id', studentId).eq('class_sessions.teaching_assignments.degree_modules.module_id', moduleId),
        supabase.from('submodules').select('id,code,name').eq('module_id', moduleId),
        supabase.from('assessment_grades').select('grade,comment,assessments!inner(title,kind,scope,max_grade,date,module_id)')
          .eq('student_id', studentId).eq('assessments.module_id', moduleId),
        supabase.from('module_enrollments')
          .select('id,status,theory_grade,practical_result,grade_comment,academic_year_id,degree_modules!inner(module_id,kind),academic_years!inner(is_current,schools(grade_max)),period_grades(period_id,theory_grade,practical_result,comment)')
          .eq('student_id', studentId).eq('degree_modules.module_id', moduleId).eq('academic_years.is_current', true),
      ])
      const yearIds = [...new Set((enrollments.data || []).map((row) => row.academic_year_id))]
      const periods = yearIds.length
        ? (await supabase.from('evaluation_periods').select('id,name,position,ends_on').in('academic_year_id', yearIds).order('position')).data || []
        : []
      if (!active) return
      const marked = (attendance.data || []).filter((row) => row.status && row.class_sessions.status !== 'cancelada')
      const absences = marked.filter((row) => row.status === 'A').sort((a, b) => b.class_sessions.date.localeCompare(a.class_sessions.date))
      const present = marked.filter((row) => row.status === 'P' || row.status === 'L').length
      setState({
        linked: true,
        marked: marked.length,
        late: marked.filter((row) => row.status === 'L').length,
        absences,
        rate: marked.length ? Math.round((present / marked.length) * 100) : null,
        submodules: Object.fromEntries((submodules.data || []).map((sub) => [sub.id, sub])),
        exams: (exams.data || []).sort((a, b) => String(b.assessments?.date || '').localeCompare(String(a.assessments?.date || ''))),
        enrollments: enrollments.data || [],
        periods,
      })
    }
    load()
    return () => { active = false }
  }, [moduleId, profileId])
  return state
}
