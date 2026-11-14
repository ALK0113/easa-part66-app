// Controles de registro de prácticas: asistencia y evaluación con un toque.
// Los usan Prácticas y el detalle de módulo.

const ATTENDANCE_OPTIONS = [
  { value: 'P', label: 'Presente', short: 'P', active: 'bg-success-soft text-success border-success' },
  { value: 'L', label: 'Tarde', short: 'T', active: 'bg-warn-soft text-warn border-warn' },
  { value: 'A', label: 'Falta', short: 'F', active: 'bg-danger-soft text-danger border-danger' },
]

const EVALUATION_OPTIONS = [
  { value: 'Apto', label: 'Apto', active: 'bg-success-soft text-success border-success' },
  { value: 'No Apto', label: 'No apto', active: 'bg-danger-soft text-danger border-danger' },
]

function Segmented({ options, value, onChange, disabled, label, clearable = false }) {
  return (
    <div role="group" aria-label={label} className="inline-flex gap-1">
      {options.map((option) => {
        const selected = value === option.value
        return (
          <button
            key={option.value}
            type="button"
            title={clearable && selected ? `${option.label} · pulsa de nuevo para quitar` : option.label}
            aria-pressed={selected}
            disabled={disabled}
            onClick={() => onChange(clearable && selected ? '' : option.value)}
            className={`h-9 min-w-[40px] rounded-lg border px-2.5 text-xs font-semibold transition-colors disabled:opacity-50 ${
              selected ? option.active : 'border-line bg-surface text-muted hover:border-line-strong hover:text-ink'
            }`}
          >
            <span className="sm:hidden">{option.short || option.label}</span>
            <span className="hidden sm:inline">{option.label}</span>
          </button>
        )
      })}
    </div>
  )
}

export function AttendanceControl({ value, onChange, disabled }) {
  return <Segmented label="Asistencia" options={ATTENDANCE_OPTIONS} value={value} onChange={onChange} disabled={disabled} />
}

export function EvaluationControl({ value, onChange, disabled }) {
  return <Segmented label="Evaluación" options={EVALUATION_OPTIONS} value={value || ''} onChange={onChange} disabled={disabled} clearable />
}

// Fila de alumno con sus dos controles; se apila en móvil.
export function StudentRecordRow({ student, record, canEdit = true, busy, onAttendance, onEvaluation, meta }) {
  return (
    <li className="flex flex-wrap items-center gap-x-6 gap-y-3 px-5 py-3.5">
      <div className="min-w-[160px] flex-1">
        <p className="font-medium text-ink">{student.name}</p>
        <p className="mt-0.5 text-xs text-muted">{meta}</p>
      </div>
      <AttendanceControl value={record.attendance} disabled={!canEdit || busy} onChange={onAttendance} />
      <EvaluationControl value={record.evaluation} disabled={!canEdit || busy} onChange={onEvaluation} />
    </li>
  )
}

export function RecordSummary({ items }) {
  return (
    <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">
      {items.map(([label, value, tone]) => (
        <div key={label} className="card px-5 py-4">
          <dt className="flex items-center gap-2 text-sm text-muted">
            <span className={`h-2 w-2 rounded-full ${tone}`} />
            {label}
          </dt>
          <dd className="mt-1 text-2xl font-semibold text-ink">{value}</dd>
        </div>
      ))}
    </dl>
  )
}
