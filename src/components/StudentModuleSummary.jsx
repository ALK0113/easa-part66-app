import { KIND_LABEL } from '../lib/academic.js'
import { time } from '../lib/schedule.js'
import Icon from './Icon.jsx'

// Lo que el alumno ve en el resumen de un módulo: su asistencia con cada falta y sus notas.
// data: lo que devuelve useStudentModule. moduleId: el módulo (para describir las sesiones de teoría).

const MIN_ATTENDANCE = 85
const fmtDate = (iso) => new Date(`${iso}T00:00`).toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' })
const number = (value) => String(Number(value)).replace('.', ',')

// Qué se dio en la sesión: práctica (nº y ATA) o teoría (módulo y submódulo)
function sessionDetail(session, moduleId, submodules) {
  const practice = session.practices
  const theory = session.theory_classes
  if (practice) {
    return [`Práctica Nº ${practice.id}`, practice.ata && `ATA ${practice.ata}`, practice.title].filter(Boolean).join(' · ')
  }
  const sub = submodules[theory?.submodule_id]
  const kind = session.teaching_assignments?.degree_modules?.kind
  return [theory ? 'Teoría' : KIND_LABEL[kind] || 'Clase', moduleId, sub && `${sub.code}${sub.name ? ` ${sub.name}` : ''}`, theory?.title].filter(Boolean).join(' · ')
}

export default function StudentModuleSummary({ data, moduleId }) {
  if (!data) return <p className="text-sm text-muted">Cargando tus datos…</p>
  if (!data.linked) return <p className="card p-5 text-sm text-muted">Tu cuenta aún no está vinculada a una ficha de alumno.</p>

  const low = data.rate !== null && data.rate < MIN_ATTENDANCE
  // Notas por evaluación y la final, de cada parte del módulo (teoría / práctica)
  const gradeRows = data.enrollments.flatMap((item) => {
    const practice = item.degree_modules?.kind === 'practica'
    const max = Number(item.academic_years?.schools?.grade_max ?? 100)
    const value = (row) => (practice
      ? ({ apto: 'Apto', no_apto: 'No apto' }[row?.practical_result] || '')
      : (row?.theory_grade != null ? `${number(row.theory_grade)} / ${number(max)}` : ''))
    const partial = data.periods.map((period) => {
      const row = (item.period_grades || []).find((entry) => entry.period_id === period.id)
      return { key: `${item.id}-${period.id}`, part: KIND_LABEL[item.degree_modules?.kind], label: period.name, value: value(row), comment: row?.comment }
    })
    const final = ['convalidado', 'exento'].includes(item.status)
      ? { key: `${item.id}-final`, part: KIND_LABEL[item.degree_modules?.kind], label: 'Final', value: item.status === 'convalidado' ? 'Convalidado' : 'Exento' }
      : { key: `${item.id}-final`, part: KIND_LABEL[item.degree_modules?.kind], label: 'Final', value: value(item), comment: item.grade_comment }
    return [...partial, final]
  })

  return (
    <>
      <section className="card p-5">
        <h3 className="mb-3 flex items-center gap-2 font-semibold text-ink"><Icon name="chart" size={16} className="text-faint" />Mi asistencia</h3>
        {data.marked === 0 ? <p className="text-sm text-muted">Aún no hay asistencia registrada en este módulo.</p> : (
          <>
            <p className="text-sm text-ink-soft">
              <span className={`text-2xl font-semibold tabular-nums ${low ? 'text-warn' : 'text-ink'}`}>{data.rate}%</span>
              <span className="ml-2 text-muted">{data.absences.length} {data.absences.length === 1 ? 'falta' : 'faltas'}{data.late ? ` · ${data.late} ${data.late === 1 ? 'retraso' : 'retrasos'}` : ''} · {data.marked} sesiones</span>
            </p>
            {low && <p className="mt-1 text-xs text-warn">Por debajo del {MIN_ATTENDANCE} % recomendado.</p>}
            {data.absences.length > 0 && (
              <ul className="mt-4 max-h-64 space-y-1.5 overflow-y-auto pr-1">
                {data.absences.map((row) => {
                  const session = row.class_sessions
                  return (
                    <li key={session.id} className="rounded-xl border border-line px-3 py-2 text-sm">
                      <p className="text-ink"><span className="font-medium">{fmtDate(session.date)}</span> <span className="text-muted">· {time(session.start_time)}–{time(session.end_time)}{session.recovery ? ' · recuperación' : ''}</span></p>
                      <p className="mt-0.5 truncate text-xs text-muted">{sessionDetail(session, moduleId, data.submodules)}</p>
                      {row.comment && <p className="mt-1 whitespace-pre-line text-xs text-ink-soft">{row.comment}</p>}
                    </li>
                  )
                })}
              </ul>
            )}
          </>
        )}
      </section>

      <section className="card p-5">
        <h3 className="mb-3 flex items-center gap-2 font-semibold text-ink"><Icon name="grade" size={16} className="text-faint" />Mis notas</h3>
        {gradeRows.length === 0 && data.exams.length === 0 ? <p className="text-sm text-muted">Aún no tienes notas en este módulo.</p> : (
          <div className="space-y-4">
            {gradeRows.length > 0 && (
              <ul className="space-y-1.5">
                {gradeRows.map((row) => (
                  <li key={row.key} className="rounded-xl border border-line px-3 py-2 text-sm">
                    <div className="flex items-center gap-3">
                      <span className="min-w-0 flex-1 text-ink">{row.label} <span className="text-xs text-muted">· {row.part}</span></span>
                      <span className={`font-semibold tabular-nums ${row.value ? 'text-ink' : 'text-faint'}`}>{row.value || 'Sin nota'}</span>
                    </div>
                    {row.comment && <p className="mt-1 whitespace-pre-line text-xs text-ink-soft">{row.comment}</p>}
                  </li>
                ))}
              </ul>
            )}
            {data.exams.length > 0 && (
              <div>
                <p className="mb-1.5 text-xs font-medium text-faint">Exámenes y evaluaciones</p>
                <ul className="space-y-1.5">
                  {data.exams.map((row, index) => (
                    <li key={index} className="rounded-xl border border-line px-3 py-2 text-sm">
                      <div className="flex items-center gap-3">
                        <span className="min-w-0 flex-1 truncate text-ink">{row.assessments?.title} <span className="text-xs text-muted">· {row.assessments?.kind === 'examen' ? `examen ${row.assessments?.scope === 'ra' ? 'de RA' : 'parcial'}` : 'evaluación'}{row.assessments?.date ? ` · ${fmtDate(row.assessments.date)}` : ''}</span></span>
                        <span className="font-semibold tabular-nums text-ink">{row.grade == null ? '—' : number(row.grade)}<span className="text-xs font-normal text-muted">/{number(row.assessments?.max_grade || 10)}</span></span>
                      </div>
                      {row.comment && <p className="mt-1 whitespace-pre-line text-xs text-ink-soft">{row.comment}</p>}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </section>
    </>
  )
}
