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
  { id: 'students', label: 'Alumnos', hint: 'Primero matricula cada grupo en sus módulos; después añade a cada clase los alumnos sueltos de otros cursos.' },
  { id: 'timetable', label: 'Horario', hint: 'La plantilla semanal de cada grupo genera las clases hasta fin de curso.' },
]
const EXTRA_STEPS = [
  { id: 'cohorts', label: 'Promociones', hint: 'Se crean solas al matricular en 1º; aquí puedes renombrarlas o crear otras.' },
  { id: 'grading', label: 'Calificación', hint: 'Escala de notas y nota de aprobado de la escuela.' },
]

export default function SchoolSetup({ user, step, onStep }) {
  const { school } = useSchool()
  // El paso Alumnos tiene tres vistas: «students» (por grupo), «students-class» (por clase) y «students-one» (por alumno)
  const STUDENT_VIEWS = { students: 'groups', 'students-class': 'classes', 'students-one': 'students' }
  const baseStep = STUDENT_VIEWS[step] ? 'students' : step
  const current = [...SETUP_STEPS, ...EXTRA_STEPS].find((item) => item.id === baseStep) || SETUP_STEPS[0]
  const studentsView = STUDENT_VIEWS[step] || 'groups'
  const setStudentsView = (view) => onStep(Object.keys(STUDENT_VIEWS).find((key) => STUDENT_VIEWS[key] === view))

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
      {current.id === 'students' && (
        <>
          <div className="tabs" role="tablist">
            <button type="button" role="tab" className="tab" aria-selected={studentsView === 'groups'} onClick={() => setStudentsView('groups')}>1 · Por grupo</button>
            <button type="button" role="tab" className="tab" aria-selected={studentsView === 'classes'} onClick={() => setStudentsView('classes')}>2 · Por clase</button>
            <button type="button" role="tab" className="tab" aria-selected={studentsView === 'students'} onClick={() => setStudentsView('students')}>Por alumno</button>
          </div>
          <Assignments key={studentsView} user={user} tab={studentsView} embedded />
        </>
      )}
      {current.id === 'timetable' && <TemplateEditor user={user} />}
    </div>
  )
}
