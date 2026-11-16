import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { getSupabaseErrorMessage } from '../lib/supabaseErrors.js'
import { groupLabel } from '../lib/academic.js'
import { isManager } from '../lib/roles.js'
import { useModuleAssignments } from '../lib/practiceSessions.js'
import { conflictText, useStudentConflicts } from '../lib/conflicts.js'
import Icon from './Icon.jsx'

// Alumnos de la clase (grupo + módulo) con la regla «grupo + excepciones»:
// «Del grupo», «De otros cursos» y «No cursan». Dirección puede añadir alumnos de otro curso;
// el resto de la matrícula se gestiona en Escuela → Alumnos. El profesor solo la ve.
export default function ModuleStudents({ moduleId, user, onChanged }) {
  const assignments = useModuleAssignments(moduleId, user)
  const [chosen, setChosen] = useState('')
  const current = assignments?.find((item) => item.id === chosen) || assignments?.[0]

  if (assignments === null) return <p className="text-sm text-muted">Cargando clases…</p>
  if (!assignments.length) return <p className="text-sm text-muted">Este módulo no tiene clase asignada este curso. Asígnalo a un grupo y profesor en «Escuela».</p>

  return (
    <div className="space-y-3">
      {assignments.length > 1 && (
        <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Grupo">
          {assignments.map((item) => (
            <button key={item.id} type="button" role="radio" aria-checked={item.id === current.id} onClick={() => setChosen(item.id)}
              className={`rounded-lg border px-2.5 py-1 text-xs font-medium ${item.id === current.id ? 'border-accent bg-accent-soft text-accent-strong' : 'border-line text-ink-soft hover:bg-subtle'}`}>
              {groupLabel(item.class_groups)}{item.profiles?.full_name ? ` · ${item.profiles.full_name}` : ''}
            </button>
          ))}
        </div>
      )}
      <ClassList key={current.id} assignment={current} canManage={isManager(user.role)} onChanged={onChanged} />
    </div>
  )
}

function ClassList({ assignment, canManage, onChanged }) {
  const [rows, setRows] = useState(null)
  const [homes, setHomes] = useState({})
  const [candidates, setCandidates] = useState([])
  const [search, setSearch] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [version, setVersion] = useState(0)
  // Solapes de horario que afectan a esta clase
  const conflicts = useStudentConflicts(assignment.class_groups?.academic_years?.school_id, null, version)
    .filter((row) => row.assignment_a === assignment.id || row.assignment_b === assignment.id)

  useEffect(() => {
    let active = true
    async function load() {
      const { data, error: loadError } = await supabase.from('module_enrollments')
        .select('id,student_id,status,is_carryover,joined_on,left_on,academic_year_id,students(name,student_number)')
        .eq('group_id', assignment.group_id).eq('degree_module_id', assignment.degree_module_id)
      if (!active) return
      if (loadError) { setError(getSupabaseErrorMessage(loadError)); setRows([]); return }
      const list = data || []
      const ids = list.map((row) => row.student_id)
      const [homeResult, candidateResult] = await Promise.all([
        ids.length ? supabase.from('enrollments').select('student_id,group_id,class_groups(level,name)').in('student_id', ids).eq('academic_year_id', list[0].academic_year_id) : Promise.resolve({ data: [] }),
        canManage ? supabase.rpc('class_candidates', { p_group_id: assignment.group_id, p_degree_module_id: assignment.degree_module_id }) : Promise.resolve({ data: [] }),
      ])
      if (!active) return
      setHomes(Object.fromEntries((homeResult.data || []).map((row) => [row.student_id, row])))
      setCandidates(candidateResult.data || [])
      setRows(list.sort((a, b) => (a.students?.name || '').localeCompare(b.students?.name || '', 'es')))
    }
    load()
    return () => { active = false }
  }, [assignment.group_id, assignment.degree_module_id, canManage, version])

  async function setMode(studentId, mode) {
    setBusy(true)
    setError('')
    const { error: saveError } = await supabase.rpc('enrollment_set_module', { p_student_id: studentId, p_degree_module_id: assignment.degree_module_id, p_mode: mode, p_group_id: assignment.group_id })
    setBusy(false)
    if (saveError) { setError(getSupabaseErrorMessage(saveError)); return }
    setSearch('')
    setVersion((value) => value + 1)
    onChanged?.()
  }

  const matches = useMemo(() => {
    const text = search.trim().toLowerCase()
    if (!text) return []
    return candidates.filter((item) => `${item.name} ${item.student_number || ''} ${item.home_group || ''}`.toLowerCase().includes(text)).slice(0, 8)
  }, [candidates, search])

  if (rows === null) return <p className="text-sm text-muted">Cargando alumnos…</p>
  const active = rows.filter((row) => !['convalidado', 'exento', 'baja'].includes(row.status))
  const fromGroup = active.filter((row) => homes[row.student_id]?.group_id === assignment.group_id)
  const fromOthers = active.filter((row) => homes[row.student_id]?.group_id !== assignment.group_id)
  const notTaking = rows.filter((row) => ['convalidado', 'exento', 'baja'].includes(row.status))
  const dates = (row) => [row.joined_on && `alta ${new Date(`${row.joined_on}T00:00`).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })}`, row.left_on && 'baja'].filter(Boolean).join(' · ')

  const section = (title, items, note, removable = false) => items.length > 0 && (
    <div>
      <p className="mb-1 text-xs font-semibold text-muted">{title} · {items.length}</p>
      <ul className="divide-y divide-line rounded-xl border border-line">
        {items.map((row) => (
          <li key={row.id} className="flex items-center gap-3 px-3 py-2 text-sm">
            <span className={`min-w-0 flex-1 truncate ${conflicts.some((item) => item.student_id === row.student_id) ? 'font-medium text-danger' : 'text-ink'}`}
              title={conflicts.filter((item) => item.student_id === row.student_id).map(conflictText).join('\n') || undefined}>{row.students?.name}</span>
            {conflicts.some((item) => item.student_id === row.student_id) && <span className="text-xs font-semibold text-danger">solape</span>}
            <span className="text-xs text-muted">{note(row)}</span>
            {removable && canManage && <button type="button" className="rounded-lg p-1 text-danger/70 hover:bg-danger-soft hover:text-danger" disabled={busy} aria-label={`Quitar a ${row.students?.name}`} title="Quitar de esta clase" onClick={() => { if (window.confirm(`¿Quitar a ${row.students?.name} de esta clase?`)) setMode(row.student_id, 'no_cursa') }}><Icon name="trash" size={14} /></button>}
          </li>
        ))}
      </ul>
    </div>
  )

  return (
    <div className="space-y-3">
      {error && <p role="alert" className="notice-error">{error}</p>}
      {conflicts.length > 0 && (
        <div role="alert" className="rounded-xl border border-danger/40 bg-danger-soft/50 px-3 py-2 text-xs text-danger">
          <p className="font-semibold">{conflicts.length === 1 ? '1 alumno tiene otra clase a la misma hora' : `${conflicts.length} solapes con otras clases`}</p>
          <ul className="mt-1 space-y-0.5">{conflicts.map((item) => <li key={`${item.student_id}-${item.assignment_a}-${item.assignment_b}`}><strong>{item.student_name}</strong>: {conflictText(item)}</li>)}</ul>
        </div>
      )}
      {section(`Del grupo ${groupLabel(assignment.class_groups)}`, fromGroup, dates)}
      {section('De otros cursos', fromOthers, (row) => [homes[row.student_id] ? `de ${groupLabel(homes[row.student_id].class_groups)}` : 'módulo suelto', row.is_carryover && 'pendiente', dates(row)].filter(Boolean).join(' · '), true)}
      {section('No cursan', notTaking, (row) => (row.status === 'baja' ? 'no cursa' : row.status))}
      {!rows.length && <p className="text-sm text-muted">Aún no hay alumnos en esta clase.</p>}

      {canManage && (
        <div className="relative">
          <Icon name="plus" size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-accent" />
          <input className="input pl-8" placeholder="Añadir alumno de otro curso (nombre, número o curso)…" value={search} onChange={(event) => setSearch(event.target.value)} disabled={busy} />
          {matches.length > 0 && (
            <ul className="absolute z-10 mt-1 w-full divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface shadow-lift">
              {matches.map((item) => (
                <li key={item.student_id}>
                  <button type="button" className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-subtle" onClick={() => setMode(item.student_id, 'cursa')}>
                    <span className="truncate text-ink">{item.name}</span>
                    <span className="text-xs text-muted">{[item.home_group, item.other_class && `ahora con ${item.other_class}`].filter(Boolean).join(' · ') || 'sin grupo'}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      <p className="text-xs text-muted">{canManage ? 'Los alumnos del grupo vienen solos. Convalidaciones, altas, bajas y cambios de grupo: Escuela → Alumnos.' : 'La matrícula la gestionan administración y supervisión.'}</p>
    </div>
  )
}
