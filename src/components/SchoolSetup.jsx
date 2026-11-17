import AcademicStructure from './AcademicStructure.jsx'
import Assignments from './Assignments.jsx'
import { TemplateEditor } from './Timetable.jsx'
import { useSchool } from '../contexts/useSchool.js'

// «Escuela»: toda la puesta en marcha en una sola página, con los pasos en el orden en que se hacen.
// Reúne lo que antes estaba repartido entre Estructura académica, Asignaciones y la plantilla del Horario.
const SETUP_STEPS = [
  { id: 'degrees', label: 'Grado y módulos', hint: 'Elige los módulos del catálogo EASA o crea los propios de tu escuela.' },
  { id: 'years', label: 'Curso escolar', hint: 'El curso actual es el que usan grupos, matrículas y horario.' },
  { id: 'groups', label: 'Grupos', hint: 'Por ejemplo 1ºA y 2ºA. Puedes crearlos todos de una vez.' },
  { id: 'teachers', label: 'Profesores', hint: 'Toca un grupo para asignar el módulo; después puedes poner su horario.' },
  { id: 'students', label: 'Alumnos', hint: 'Pon a cada alumno en su grupo: cursa sola todos los módulos de su curso. Después apunta solo las excepciones (convalidados, módulos de otro curso, altas y bajas).' },
  { id: 'timetable', label: 'Horario', hint: 'La plantilla semanal de cada grupo genera las clases hasta fin de curso.' },
]
const EXTRA_STEPS = [
  { id: 'cohorts', label: 'Promociones', hint: 'Se crean solas al matricular en 1º; aquí puedes renombrarlas o crear otras.' },
  { id: 'grading', label: 'Calificación y boletines', hint: 'Escala de notas, nota de aprobado y logo de los boletines.' },
]

export default function SchoolSetup({ user, step, onStep }) {
  const { school } = useSchool()
  // Enlaces antiguos a las vistas «por clase» / «por alumno» llevan al paso Alumnos
  const baseStep = String(step || '').startsWith('students') ? 'students' : step
  const current = [...SETUP_STEPS, ...EXTRA_STEPS].find((item) => item.id === baseStep) || SETUP_STEPS[0]

  return (
    <div className="space-y-5">
      <div className="page-intro">
        <div>
          <h2>Escuela{school?.name ? ` · ${school.name}` : ''}</h2>
          <p>Ponla en marcha paso a paso. Puedes volver a cualquier paso cuando quieras.</p>
        </div>
      </div>

      <nav aria-label="Pasos de la escuela" className="flex flex-wrap gap-2">
        {SETUP_STEPS.map((item, index) => (
          <button key={item.id} type="button" aria-current={current.id === item.id ? 'step' : undefined} onClick={() => onStep(item.id)}
            className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-sm font-medium ${current.id === item.id ? 'border-accent bg-accent-soft text-accent-strong' : 'border-line text-ink-soft hover:bg-subtle'}`}>
            <span className={`flex h-5 w-5 items-center justify-center rounded-full text-xs ${current.id === item.id ? 'bg-accent text-white' : 'bg-subtle text-muted'}`}>{index + 1}</span>
            {item.label}
          </button>
        ))}
        <span className="mx-1 hidden self-center text-faint sm:inline">·</span>
        {EXTRA_STEPS.map((item) => (
          <button key={item.id} type="button" aria-current={current.id === item.id ? 'step' : undefined} onClick={() => onStep(item.id)}
            className={`rounded-xl px-3 py-2 text-sm ${current.id === item.id ? 'bg-accent-soft font-medium text-accent-strong' : 'text-muted hover:bg-subtle'}`}>
            {item.label}
          </button>
        ))}
      </nav>

      <p className="text-sm text-muted">{current.hint}</p>

      {['degrees', 'years', 'groups', 'cohorts', 'grading'].includes(current.id) && <AcademicStructure key={current.id} tab={current.id} embedded />}
      {current.id === 'teachers' && <Assignments user={user} tab="teachers" embedded />}
      {current.id === 'students' && <Assignments user={user} tab="students" embedded />}
      {current.id === 'timetable' && <TemplateEditor user={user} />}
    </div>
  )
}
