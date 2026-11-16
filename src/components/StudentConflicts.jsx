import { conflictText } from '../lib/conflicts.js'
import Icon from './Icon.jsx'

// Solapes de horario: se permiten, pero se muestran en rojo hasta que se reubique al alumno o se ajusten las clases.
// Aviso con las discrepancias de un alumno (o de varios)
export default function ConflictNotice({ rows, title, hint, onSelect }) {
  if (!rows.length) return null
  return (
    <section role="alert" className="rounded-xl border border-danger/40 bg-danger-soft/50 p-4">
      <p className="flex items-center gap-2 text-sm font-semibold text-danger"><Icon name="clock" size={16} />{title}</p>
      <ul className="mt-2 space-y-1 text-sm text-danger">
        {rows.map((row) => (
          <li key={`${row.student_id}-${row.assignment_a}-${row.assignment_b}`}>
            {onSelect
              ? <button type="button" className="text-left underline-offset-2 hover:underline" onClick={() => onSelect(row.student_id)}><strong>{row.student_name}</strong>: {conflictText(row)}</button>
              : conflictText(row)}
          </li>
        ))}
      </ul>
      {hint && <p className="mt-2 text-xs text-danger/80">{hint}</p>}
    </section>
  )
}
