import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import Icon from './Icon.jsx'
import JoinCode from './JoinCode.jsx'
import { useSchool } from '../contexts/useSchool.js'

// Primeros pasos de una escuela (panel del supervisor). Cada paso se marca solo
// según los datos, y la tarjeta desaparece cuando la escuela ya está en marcha.
// `schoolId`: la escuela elegida por el admin; el supervisor usa la suya.
export default function GettingStarted({ schoolId: chosenSchool, setActivePage, openSetup }) {
  const [state, setState] = useState(null)
  const { schoolId: contextSchool } = useSchool()

  useEffect(() => {
    let active = true
    async function load() {
      // La escuela ya la conoce el contexto: no hace falta volver a consultarla
      const schoolId = chosenSchool || contextSchool
      if (!schoolId) return
      const [degrees, year, members] = await Promise.all([
        supabase.from('degrees').select('id,degree_modules(id)').eq('school_id', schoolId),
        supabase.from('academic_years').select('id,class_groups(id)').eq('school_id', schoolId).eq('is_current', true).maybeSingle(),
        supabase.from('school_profiles').select('profiles!inner(role,status)').eq('school_id', schoolId).eq('profiles.role', 'profesor').eq('profiles.status', 'activo'),
      ])
      const groupIds = (year.data?.class_groups || []).map((group) => group.id)
      const [assignments, enrollments] = groupIds.length
        ? await Promise.all([
          supabase.from('teaching_assignments').select('id,schedule_slots(id)').in('group_id', groupIds),
          supabase.from('enrollments').select('id', { count: 'exact', head: true }).eq('academic_year_id', year.data.id),
        ])
        : [{ data: [] }, { count: 0 }]
      if (!active) return
      setState({
        schoolId,
        modules: (degrees.data || []).some((degree) => degree.degree_modules?.length),
        groups: groupIds.length > 0,
        teachers: (members.data || []).length > 0,
        timetable: (assignments.data || []).some((item) => item.schedule_slots?.length),
        students: (enrollments.count || 0) > 0,
      })
    }
    load()
    return () => { active = false }
  }, [contextSchool, chosenSchool])

  if (!state) return null
  const steps = [
    { done: state.modules, title: 'Crea el grado y sus módulos', text: 'Elige módulos del catálogo EASA o crea los propios de tu escuela.', step: 'degrees', action: 'Escuela → Grado y módulos' },
    { done: state.groups, title: 'Abre el curso escolar y sus grupos', text: 'Por ejemplo 1ºA y 2ºA del curso actual. Puedes crearlos todos de una vez.', step: 'groups', action: 'Escuela → Grupos' },
    { done: state.teachers, title: 'Añade a los profesores', text: 'Créalos en Perfiles → Añadir personas o comparte el código de la escuela y aprueba sus solicitudes.', page: 'teachers', action: 'Perfiles', code: true },
    { done: state.timetable, title: 'Asigna módulos y horario a cada profesor', text: 'Al asignar un grupo puedes poner ya el día, la hora y el aula.', step: 'teachers', action: 'Escuela → Profesores' },
    { done: state.students, title: 'Matricula a los alumnos', text: 'Créalos o impórtalos, o deja que se registren con el código y apruébalos.', step: 'students', action: 'Escuela → Alumnos', code: true },
  ]
  if (steps.every((step) => step.done)) return null
  const next = steps.findIndex((step) => !step.done)

  return (
    <section className="card p-5 md:p-6">
      <h3 className="font-semibold text-ink">Pon en marcha tu escuela</h3>
      <p className="mt-1 text-sm text-muted">{steps.filter((step) => step.done).length} de {steps.length} pasos hechos.</p>
      <ol className="mt-4 space-y-3">
        {steps.map((step, index) => (
          <li key={step.title} className="flex gap-3">
            <span className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${step.done ? 'bg-success-soft text-success' : index === next ? 'bg-accent text-white' : 'bg-subtle text-muted'}`}>
              {step.done ? <Icon name="check" size={14} /> : index + 1}
            </span>
            <div className="min-w-0 flex-1">
              <p className={`text-sm font-medium ${step.done ? 'text-muted line-through' : 'text-ink'}`}>{step.title}</p>
              {index === next && (
                <div className="mt-1 space-y-3">
                  <p className="text-sm text-muted">{step.text}</p>
                  {step.code && <JoinCode schoolId={state.schoolId} />}
                  <button type="button" className="btn-secondary h-9" onClick={() => (step.step && openSetup ? openSetup(step.step) : setActivePage(step.page || 'setup'))}>Ir a {step.action}</button>
                </div>
              )}
            </div>
          </li>
        ))}
      </ol>
    </section>
  )
}
