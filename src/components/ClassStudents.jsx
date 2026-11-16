import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { getSupabaseErrorMessage } from '../lib/supabaseErrors.js'
import Icon from './Icon.jsx'

// Alumnos de una clase (grupo + módulo). Se pueden añadir alumnos de cualquier curso
// del centro (nunca de otro centro: lo garantiza la base de datos) o quitarlos.
export default function ClassStudents({ groupId, degreeModuleId, onChanged }) {
  const [students, setStudents] = useState(null)
  const [candidates, setCandidates] = useState([])
  const [search, setSearch] = useState('')
  const [busyId, setBusyId] = useState(null)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    const [inClass, available] = await Promise.all([
      supabase.rpc('class_students', { p_group_id: groupId, p_degree_module_id: degreeModuleId }),
      supabase.rpc('class_candidates', { p_group_id: groupId, p_degree_module_id: degreeModuleId }),
    ])
    const failed = inClass.error || available.error
    if (failed) setError(getSupabaseErrorMessage(failed))
    setStudents(inClass.data || [])
    setCandidates(available.data || [])
  }, [groupId, degreeModuleId])

  useEffect(() => {
    let active = true
    Promise.all([
      supabase.rpc('class_students', { p_group_id: groupId, p_degree_module_id: degreeModuleId }),
      supabase.rpc('class_candidates', { p_group_id: groupId, p_degree_module_id: degreeModuleId }),
    ]).then(([inClass, available]) => {
      if (!active) return
      const failed = inClass.error || available.error
      if (failed) setError(getSupabaseErrorMessage(failed))
      setStudents(inClass.data || [])
      setCandidates(available.data || [])
    })
    return () => { active = false }
  }, [groupId, degreeModuleId])

  async function setStudent(student, inClass) {
    if (!inClass && !window.confirm(`¿Quitar a ${student.name} de esta clase?`)) return
    setBusyId(student.student_id)
    setError('')
    const { error: saveError } = await supabase.rpc('class_set_student', { p_group_id: groupId, p_degree_module_id: degreeModuleId, p_student_id: student.student_id, p_in: inClass })
    setBusyId(null)
    if (saveError) { setError(getSupabaseErrorMessage(saveError)); return }
    await load()
    onChanged?.()
  }

  // Búsqueda por nombre, número o curso
  const matches = useMemo(() => {
    const query = search.trim().toLowerCase()
    if (!query) return []
    return candidates.filter((student) => `${student.name} ${student.student_number || ''} ${student.home_group || ''}`.toLowerCase().includes(query)).slice(0, 8)
  }, [candidates, search])

  if (students === null) return <p className="text-sm text-muted">Cargando alumnos…</p>

  return (
    <div className="space-y-3">
      {error && <p role="alert" className="notice-error">{error}</p>}

      <div className="relative">
        <Icon name="search" size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
        <input className="input pl-9" placeholder="Añadir alumno del centro: nombre, nº o curso…" value={search} onChange={(event) => setSearch(event.target.value)} aria-label="Buscar alumno para añadir" />
      </div>
      {search.trim() && (
        <ul className="divide-y divide-line rounded-xl border border-line">
          {matches.map((student) => (
            <li key={student.student_id} className="flex items-center justify-between gap-3 px-4 py-2">
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium text-ink">{student.name}</span>
                <span className="block text-xs text-muted">
                  {student.home_group ? `Curso ${student.home_group}` : 'Sin curso'}
                  {student.other_class ? ` · ahora en la clase de ${student.other_class}: se cambiará aquí` : ''}
                </span>
              </span>
              <button type="button" className="btn-secondary h-8 shrink-0 px-3 text-xs" disabled={busyId === student.student_id} onClick={() => { setStudent(student, true); setSearch('') }}>
                <Icon name="plus" size={14} />Añadir
              </button>
            </li>
          ))}
          {matches.length === 0 && <li className="px-4 py-3 text-sm text-muted">Ningún alumno del centro coincide.</li>}
        </ul>
      )}

      <div>
        <h4 className="mb-1.5 text-xs font-semibold text-muted">{students.length} {students.length === 1 ? 'alumno' : 'alumnos'} en la clase</h4>
        {students.length === 0
          ? <p className="text-sm text-muted">Aún no hay alumnos. Búscalos arriba para añadirlos.</p>
          : <ul className="divide-y divide-line rounded-xl border border-line">
            {students.map((student) => (
              <li key={student.student_id} className="flex items-center justify-between gap-3 px-4 py-2">
                <span className="min-w-0">
                  <span className="block truncate text-sm text-ink">{student.name}</span>
                  <span className="block text-xs text-muted">{student.home_group ? `Curso ${student.home_group}` : 'Sin curso'}{student.has_grade ? ' · con nota' : ''}</span>
                </span>
                <button type="button" className="rounded-lg p-1.5 text-muted hover:bg-danger-soft hover:text-danger disabled:opacity-40" disabled={busyId === student.student_id || student.has_grade} title={student.has_grade ? 'Tiene nota: no se puede quitar' : 'Quitar de la clase'} aria-label={`Quitar a ${student.name}`} onClick={() => setStudent(student, false)}>
                  <Icon name="x" size={16} />
                </button>
              </li>
            ))}
          </ul>}
      </div>
    </div>
  )
}
