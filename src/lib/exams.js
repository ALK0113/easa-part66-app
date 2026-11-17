import { supabase } from './supabase.js'
import { ROLES, isManager } from './roles.js'
import { studentLevelGroups } from './schedule.js'

// Exámenes con fecha que se ven en el horario y en Inicio → Clases.
// Alumno: los de sus módulos del curso actual (los no avisados ya los oculta la base de datos).
// Profesor: los de los módulos que imparte. Coordinación y administración: los de la escuela,
// o los de los módulos indicados (moduleIds) cuando se mira el horario de un grupo o profesor.

async function ownModuleIds(user) {
  if (user.role === ROLES.STUDENT) {
    const { data: link } = await supabase.from('student_profiles').select('student_id').eq('profile_id', user.id).maybeSingle()
    if (!link) return []
    const { data } = await supabase.from('module_enrollments').select('status,degree_modules(module_id),academic_years!inner(is_current)')
      .eq('student_id', link.student_id).eq('academic_years.is_current', true)
    const ids = (data || []).filter((row) => !['baja', 'convalidado', 'exento'].includes(row.status)).map((row) => row.degree_modules?.module_id).filter(Boolean)
    if (ids.length || data?.length) return ids
    // Sin grupo todavía: los exámenes de los módulos que se imparten en los grupos de su curso
    const groups = await studentLevelGroups(user.id)
    if (!groups.length) return []
    const { data: taught } = await supabase.from('teaching_assignments').select('degree_modules(module_id)').in('group_id', groups)
    return (taught || []).map((row) => row.degree_modules?.module_id).filter(Boolean)
  }
  const { data } = await supabase.from('teaching_assignments').select('degree_modules(module_id),class_groups!inner(academic_years!inner(is_current))')
    .eq('profile_id', user.id).eq('class_groups.academic_years.is_current', true)
  return (data || []).map((row) => row.degree_modules?.module_id).filter(Boolean)
}

export async function fetchExams(user, from, to, { moduleIds = null, schoolId = null } = {}) {
  let ids = moduleIds
  if (!ids && !isManager(user.role)) ids = await ownModuleIds(user)
  if (ids && !ids.length) return []
  let query = supabase.from('assessments')
    .select('id,title,scope,date,start_time,end_time,visible_to_students,module_id,practice_id,theory_class_id,school_id')
    .eq('kind', 'examen').gte('date', from).lte('date', to).order('date').order('start_time', { nullsFirst: true })
  if (ids) query = query.in('module_id', [...new Set(ids)])
  if (schoolId) query = query.eq('school_id', schoolId)
  const { data, error } = await query
  if (error) return []
  return data || []
}

export const examTimeText = (exam) => (exam.start_time ? `${String(exam.start_time).slice(0, 5)}${exam.end_time ? `–${String(exam.end_time).slice(0, 5)}` : ''}` : 'Sin hora')
