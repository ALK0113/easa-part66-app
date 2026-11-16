import { useEffect, useState } from 'react'
import { supabase } from './supabase.js'
import { useSchool } from '../contexts/useSchool.js'
import { groupLabel } from './academic.js'
import { isManager } from './roles.js'

// Sesiones de una práctica. Son clases del horario (class_sessions con practice_id),
// así que lo que se programa aquí aparece en el calendario y viceversa.

export const SESSION_FIELDS = 'id,teaching_assignment_id,slot_id,date,start_time,end_time,note,status,practice_id'

const minutes = (value) => {
  const [h, m] = String(value || '').split(':').map(Number)
  return Number.isFinite(h) ? h * 60 + (m || 0) : 0
}

// Horas de una sesión (las canceladas no cuentan)
export const sessionHours = (session) => (session.status === 'cancelada' ? 0 : Math.max(0, minutes(session.end_time) - minutes(session.start_time)) / 60)
export const totalSessionHours = (sessions) => sessions.reduce((sum, session) => sum + sessionHours(session), 0)
export const formatHours = (value) => (Number.isInteger(value) ? String(value) : value.toFixed(1).replace('.', ','))

// Clases (grupo + profesor) que imparten el módulo este curso: a una de ellas pertenece cada sesión
export function useModuleAssignments(moduleId, user) {
  const { filterId } = useSchool()
  const [assignments, setAssignments] = useState(null)
  useEffect(() => {
    if (!moduleId) return undefined
    let active = true
    let query = supabase
      .from('teaching_assignments')
      .select('id,profile_id,profiles(full_name,email),class_groups!inner(level,name,academic_years!inner(is_current,school_id)),degree_modules!inner(module_id)')
      .eq('degree_modules.module_id', moduleId)
      .eq('class_groups.academic_years.is_current', true)
    if (filterId) query = query.eq('class_groups.academic_years.school_id', filterId)
    // El profesor solo puede programar en sus propias clases
    if (!isManager(user.role)) query = query.eq('profile_id', user.id)
    query.then(({ data }) => { if (active) setAssignments(data || []) })
    return () => { active = false }
  }, [moduleId, user.id, user.role, filterId])
  return assignments
}

// Clases del horario del módulo que aún no tienen práctica (de hoy en adelante): de aquí salen las sesiones
export function useFreeModuleSessions(assignments) {
  const [free, setFree] = useState([])
  const ids = (assignments || []).map((assignment) => assignment.id).join(',')
  useEffect(() => {
    if (!ids) return undefined
    let active = true
    const today = new Date().toLocaleDateString('sv-SE')
    supabase.from('class_sessions').select(SESSION_FIELDS)
      .in('teaching_assignment_id', ids.split(','))
      .is('practice_id', null).eq('status', 'programada').gte('date', today)
      .order('date').order('start_time').limit(200)
      .then(({ data }) => { if (active) setFree(data || []) })
    return () => { active = false }
  }, [ids])
  return ids ? free : []
}

export const assignmentName = (assignment) => assignment
  ? `${groupLabel(assignment.class_groups)} · ${assignment.profiles?.full_name || assignment.profiles?.email || 'Profesor'}`
  : 'Clase'

export async function fetchPracticeSessions(practiceId) {
  const { data, error } = await supabase.from('class_sessions').select(SESSION_FIELDS).eq('practice_id', practiceId).order('date').order('start_time')
  if (error) throw error
  return data || []
}

// Guarda la lista editada: crea las nuevas, actualiza las cambiadas y borra las quitadas
export async function saveSessions(practiceId, original, edited) {
  const keep = new Set(edited.filter((session) => session.id).map((session) => session.id))
  const removed = original.filter((session) => !keep.has(session.id))
  for (const session of removed) {
    // Las que vienen de la plantilla semanal no se borran: solo se desvinculan de la práctica
    const { data: row } = await supabase.from('class_sessions').select('slot_id').eq('id', session.id).maybeSingle()
    const result = row?.slot_id
      ? await supabase.from('class_sessions').update({ practice_id: null }).eq('id', session.id)
      : await supabase.from('class_sessions').delete().eq('id', session.id)
    if (result.error) throw result.error
  }
  const byId = new Map(original.map((session) => [session.id, session]))
  for (const session of edited) {
    const values = {
      teaching_assignment_id: session.teaching_assignment_id,
      date: session.date,
      start_time: session.start_time,
      end_time: session.end_time,
      note: session.note?.trim() || null,
      // Una clase del horario movida a otro día pasa a ser clase suelta (slot_id null)
      slot_id: session.slot_id || null,
      practice_id: practiceId,
    }
    if (!session.id) {
      const { error } = await supabase.from('class_sessions').insert(values)
      if (error) throw error
      continue
    }
    const before = byId.get(session.id)
    const changed = ['teaching_assignment_id', 'slot_id', 'date', 'start_time', 'end_time', 'note'].some((key) => String(before?.[key] ?? '').slice(0, key.endsWith('time') ? 5 : undefined) !== String(values[key] ?? '').slice(0, key.endsWith('time') ? 5 : undefined))
    if (changed) {
      const { error } = await supabase.from('class_sessions').update(values).eq('id', session.id)
      if (error) throw error
    }
  }
}

// Validación previa: fecha, horas y clase de cada sesión
export function sessionErrors(sessions) {
  for (const [index, session] of sessions.entries()) {
    const label = `Sesión ${index + 1}`
    if (!session.teaching_assignment_id) return `${label}: elige la clase.`
    if (!session.date) return `${label}: falta la fecha.`
    if (!session.start_time || !session.end_time) return `${label}: faltan las horas.`
    if (minutes(session.end_time) <= minutes(session.start_time)) return `${label}: la hora final debe ser posterior a la de inicio.`
  }
  return ''
}

