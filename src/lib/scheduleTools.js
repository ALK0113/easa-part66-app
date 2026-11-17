import { useEffect, useState } from 'react'
import { supabase } from './supabase.js'
import { subscribeToTables } from './supabaseRealtime.js'

// Aulas de la escuela y choques del horario (mismo profesor, aula o grupo a la misma hora).
// Los choques solo avisan: se puede guardar igualmente.

const KIND_TEXT = { profesor: 'Mismo profesor', aula: 'Misma aula', grupo: 'Mismo grupo' }
export const conflictText = (row) => `${KIND_TEXT[row.kind] || row.kind}: ${row.other_label}`

export function useRooms(schoolId) {
  const [rooms, setRooms] = useState([])
  useEffect(() => {
    if (!schoolId) return undefined
    let active = true
    const load = () => supabase.from('rooms').select('id,name').eq('school_id', schoolId).order('name')
      .then(({ data }) => { if (active) setRooms(data || []) })
    load()
    const unsubscribe = subscribeToTables(['rooms'], load, `rooms-${schoolId}`)
    return () => { active = false; unsubscribe() }
  }, [schoolId])
  return schoolId ? rooms : []
}

// Agrupa filas { id, kind, other_label } en Map(id → [textos])
function toMap(rows, idKey) {
  const map = new Map()
  ;(rows || []).forEach((row) => {
    const list = map.get(row[idKey]) || []
    const text = conflictText(row)
    if (!list.includes(text)) list.push(text)
    map.set(row[idKey], list)
  })
  return map
}

export async function fetchWeekConflicts(schoolId, from, to) {
  if (!schoolId) return new Map()
  const { data, error } = await supabase.rpc('schedule_conflicts', { p_school_id: schoolId, p_from: from, p_to: to })
  if (error) return new Map()
  return toMap(data, 'session_id')
}

export async function fetchTemplateConflicts(schoolId) {
  if (!schoolId) return new Map()
  const { data, error } = await supabase.rpc('template_conflicts', { p_school_id: schoolId })
  if (error) return new Map()
  return toMap(data, 'slot_id')
}

// Choques que tendría una clase en una posición nueva. Si la comprobación falla, no bloquea.
export async function checkConflicts({ kind, id = null, assignmentId, date = null, weekday = null, start, end, roomId = null }) {
  const { data, error } = await supabase.rpc('check_schedule_conflict', {
    p_kind: kind, p_id: id, p_assignment_id: assignmentId, p_date: date, p_weekday: weekday,
    p_start: start, p_end: end, p_room_id: roomId || null,
  })
  if (error) return []
  return [...new Set((data || []).map(conflictText))]
}

// Valores de aula para guardar desde el selector: aula de la lista, aula nueva (texto) o ninguna
export function roomValues(form) {
  if (form.room_id === 'new') return { room_id: null, room: (form.room_new || '').trim() || null }
  return { room_id: form.room_id || null, room: form.room_id ? undefined : null }
}
