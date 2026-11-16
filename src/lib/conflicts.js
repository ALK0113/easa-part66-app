import { useEffect, useState } from 'react'
import { supabase } from './supabase.js'

// Solapes de horario de los alumnos (RPC student_conflicts): dos clases a la misma hora el mismo día.

const WEEKDAY = ['', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo']
const hhmm = (value) => String(value || '').slice(0, 5)
const shortDate = (date) => new Date(`${date}T00:00`).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })

export const conflictText = (row) => `${row.module_a} (${row.group_a}) y ${row.module_b} (${row.group_b}) · ${(row.weekdays || []).map((day) => WEEKDAY[day]).join(', ')} ${hhmm(row.first_start)}–${hhmm(row.first_end)} · ${row.sessions} ${row.sessions === 1 ? 'sesión' : 'sesiones'} desde el ${shortDate(row.first_date)}`

// refreshKey: cualquier valor que cambie cuando cambian la matrícula o el horario
export function useStudentConflicts(schoolId, studentId = null, refreshKey = null) {
  const [rows, setRows] = useState([])
  useEffect(() => {
    if (!schoolId) return undefined
    let active = true
    supabase.rpc('student_conflicts', { p_school_id: schoolId, p_student_id: studentId })
      .then(({ data }) => { if (active) setRows(data || []) })
    return () => { active = false }
  }, [schoolId, studentId, refreshKey])
  return schoolId ? rows : []
}
