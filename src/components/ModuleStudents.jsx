import { useState } from 'react'
import { groupLabel } from '../lib/academic.js'
import { useModuleAssignments } from '../lib/practiceSessions.js'
import ClassStudents from './ClassStudents.jsx'

// Alumnos de las clases (grupo + módulo) de un módulo este curso: añadir o quitar a mano.
// El profesor ve solo sus clases; dirección, todas. Solo alumnos del mismo centro.
export default function ModuleStudents({ moduleId, user, onChanged }) {
  const assignments = useModuleAssignments(moduleId, user)
  const [chosen, setChosen] = useState('')

  if (assignments === null) return <p className="text-sm text-muted">Cargando clases…</p>
  if (!assignments.length) return <p className="text-sm text-muted">Este módulo no tiene clase asignada este curso. Asígnalo a un grupo y profesor en «Escuela».</p>
  const current = assignments.find((item) => item.id === chosen) || assignments[0]

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
      <ClassStudents key={current.id} groupId={current.group_id} degreeModuleId={current.degree_module_id} onChanged={onChanged} />
    </div>
  )
}
