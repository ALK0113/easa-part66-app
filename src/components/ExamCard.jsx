import { MODULE_HOVER, moduleStyle } from '../lib/moduleColors.js'
import { examTimeText } from '../lib/exams.js'
import Icon from './Icon.jsx'

// Examen en el horario y en Inicio → Clases: con el color de su módulo y la etiqueta «Examen».
// Si no se ha avisado a los alumnos, el profesorado lo ve marcado como «Solo profesorado».
export default function ExamCard({ exam, color, onOpen, compact = false }) {
  const hidden = exam.visible_to_students === false
  const kind = `Examen${exam.scope === 'ra' ? ' de RA' : ' parcial'}`
  return (
    <button type="button" onClick={() => onOpen?.(exam)} style={moduleStyle(color)}
      className={`w-full rounded-xl border border-l-[3px] border-r-[3px] border-line text-left ${MODULE_HOVER} ${compact ? 'flex items-center gap-4 px-3 py-2.5' : 'px-3 py-2'}`}>
      {compact ? (
        <>
          <span className="w-14 shrink-0 text-sm tabular-nums text-muted">{exam.start_time ? String(exam.start_time).slice(0, 5) : 'Día'}</span>
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium text-ink">{exam.title}</span>
            <span className="mt-0.5 block truncate text-xs text-muted">{kind} · {exam.module_id}{hidden ? ' · Solo profesorado' : ''}</span>
          </span>
          <Icon name="grade" size={16} className="text-faint" />
        </>
      ) : (
        <>
          <span className="flex items-center gap-1 text-xs tabular-nums text-muted"><Icon name="grade" size={12} />{examTimeText(exam)}</span>
          <span className="block truncate text-sm font-medium text-ink">{exam.title}</span>
          <span className="block truncate text-xs text-muted">{kind} · {exam.module_id}</span>
          {hidden && <span className="mt-1 inline-block rounded-md bg-subtle px-1.5 py-px text-[11px] text-muted">Solo profesorado</span>}
        </>
      )}
    </button>
  )
}
