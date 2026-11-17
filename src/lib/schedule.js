import { supabase } from './supabase.js'
import { ROLES } from './roles.js'

// Utilidades de fechas (siempre en hora local, formato YYYY-MM-DD).
export const toISODate = (date) => {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000)
  return local.toISOString().slice(0, 10)
}
export const parseISODate = (value) => new Date(`${value}T00:00:00`)
export const addDays = (date, days) => { const next = new Date(date); next.setDate(next.getDate() + days); return next }
export const startOfWeek = (date) => { const day = (date.getDay() + 6) % 7; return addDays(new Date(date.getFullYear(), date.getMonth(), date.getDate()), -day) }
export const time = (value) => String(value || '').slice(0, 5)
export const WEEKDAYS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo']

export const SESSION_COLUMNS = 'id,date,start_time,end_time,room,room_id,status,note,practice_id,theory_class_id,theory_classes(title),practices(title,module_id),slot_id,teaching_assignment_id,teaching_assignments!inner(id,profile_id,group_id,degree_module_id,profiles(full_name,email),class_groups(level,name),degree_modules(module_id,kind,modules(color)))'

// Grupo y módulo que cursa el alumno en el curso actual (para filtrar su horario).
async function studentClasses(userId) {
  const { data: link } = await supabase.from('student_profiles').select('student_id').eq('profile_id', userId).maybeSingle()
  if (!link) return { studentId: null, pairs: [] }
  const { data, error } = await supabase
    .from('module_enrollments')
    .select('group_id,degree_modules(module_id),academic_years!inner(is_current)')
    .eq('student_id', link.student_id)
    .eq('academic_years.is_current', true)
  if (error) throw error
  return { studentId: link.student_id, pairs: (data || []).map((row) => `${row.group_id}|${row.degree_modules?.module_id}`) }
}

// Alumno dado de alta sin grupo: va a todas las clases de su curso (el que eligió en su ficha; 1º si no lo indicó)
// hasta que la coordinación le asigne grupo en Escuela → Alumnos. Devuelve los grupos de ese curso.
export async function studentLevelGroups(userId) {
  const [{ data: form }, { data: link }] = await Promise.all([
    supabase.from('signup_forms').select('level').eq('profile_id', userId).maybeSingle(),
    supabase.from('school_profiles').select('school_id').eq('profile_id', userId).maybeSingle(),
  ])
  if (!link) return []
  const { data } = await supabase.from('class_groups').select('id,academic_years!inner(is_current,school_id)')
    .eq('level', form?.level || 1).eq('academic_years.is_current', true).eq('academic_years.school_id', link.school_id)
  return (data || []).map((group) => group.id)
}

// Clases entre dos fechas según el rol. filter: { groupId, profileId, roomId } para administración.
export async function fetchSessions(user, from, to, filter = {}) {
  let query = supabase.from('class_sessions').select(SESSION_COLUMNS).gte('date', from).lte('date', to).order('date').order('start_time')
  let pairs = null
  let studentId = null
  if (user.role === ROLES.TEACHER) query = query.eq('teaching_assignments.profile_id', user.id)
  else if (user.role === ROLES.STUDENT) {
    const classes = await studentClasses(user.id)
    studentId = classes.studentId
    let groups = [...new Set(classes.pairs.map((pair) => pair.split('|')[0]))]
    if (groups.length) {
      pairs = new Set(classes.pairs)
    } else if (studentId) {
      // Sin grupo todavía: todas las clases de su curso
      groups = await studentLevelGroups(user.id)
    }
    if (!groups.length) return { sessions: [], studentId }
    query = query.in('teaching_assignments.group_id', groups)
  } else {
    if (filter.groupId) query = query.eq('teaching_assignments.group_id', filter.groupId)
    if (filter.profileId) query = query.eq('teaching_assignments.profile_id', filter.profileId)
    if (filter.roomId) query = query.eq('room_id', filter.roomId)
  }
  const { data, error } = await query
  if (error) throw error
  let sessions = data || []
  if (pairs) sessions = sessions.filter((session) => pairs.has(`${session.teaching_assignments.group_id}|${session.teaching_assignments.degree_modules?.module_id}`))
  return { sessions, studentId }
}
