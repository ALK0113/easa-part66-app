import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { getSupabaseErrorMessage } from '../lib/supabaseErrors.js'
import { KIND_LABEL, groupLabel } from '../lib/academic.js'
import Icon from './Icon.jsx'

// Asistente para cerrar el curso escolar actual en tres pasos:
// 1. Curso de destino  2. Revisar a cada alumno  3. Confirmar.
// Cada alumno pasa de curso; los módulos no aprobados se arrastran con el grupo elegido.

const FINISHED = '__finalizado'
const DROPPED = '__baja'

function nextYearName(year) {
  const start = Number(year.starts_on.slice(0, 4)) + 1
  return { name: `${start}-${String((start + 1) % 100).padStart(2, '0')}`, starts_on: `${start}-09-01`, ends_on: `${start + 1}-07-31` }
}

export default function CloseYear({ schoolId, years, degrees, onClose, onDone }) {
  const current = years.find((year) => year.is_current)
  const futureYears = years.filter((year) => current && year.id !== current.id && year.starts_on > current.starts_on).sort((a, b) => a.starts_on.localeCompare(b.starts_on))
  const [step, setStep] = useState(1)
  const [targetId, setTargetId] = useState(futureYears[0]?.id || '')
  const [enrollLevel, setEnrollLevel] = useState(true)
  const [data, setData] = useState(null)
  const [plan, setPlan] = useState({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const maxLevel = useMemo(() => Math.max(1, ...degrees.flatMap((degree) => degree.degree_modules.map((item) => item.level || 1))), [degrees])

  async function createNextYear() {
    setBusy(true)
    setError('')
    try {
      const draft = nextYearName(current)
      const { data: year, error: yearError } = await supabase.from('academic_years').insert({ ...draft, school_id: schoolId }).select('id').single()
      if (yearError) throw yearError
      const { data: groups, error: groupsError } = await supabase.from('class_groups').select('degree_id,level,name').eq('academic_year_id', current.id)
      if (groupsError) throw groupsError
      if (groups.length) {
        const { error: copyError } = await supabase.from('class_groups').insert(groups.map((group) => ({ ...group, academic_year_id: year.id })))
        if (copyError) throw copyError
      }
      setTargetId(year.id)
      onDone(false)
    } catch (err) {
      setError(getSupabaseErrorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  // Paso 2: alumnos del curso actual, sus módulos y los grupos del curso nuevo
  useEffect(() => {
    if (step !== 2 || !targetId) return undefined
    let active = true
    Promise.all([
      supabase.from('enrollments').select('student_id,level,group_id,students(name,student_number),class_groups(level,name,degree_id)').eq('academic_year_id', current.id),
      supabase.from('module_enrollments').select('student_id,degree_module_id,status,degree_modules(module_id,kind,level)').eq('academic_year_id', current.id),
      supabase.from('class_groups').select('id,level,name,degree_id').eq('academic_year_id', targetId).order('level').order('name'),
    ]).then(([enrollments, modules, groups]) => {
      if (!active) return
      const failed = enrollments.error || modules.error || groups.error
      if (failed) { setError(getSupabaseErrorMessage(failed)); return }
      const targetGroups = groups.data || []
      const findGroup = (degreeId, level, name) => targetGroups.find((group) => group.degree_id === degreeId && group.level === level && group.name === name)
        || targetGroups.find((group) => group.degree_id === degreeId && group.level === level)
      const students = (enrollments.data || []).map((enrollment) => {
        const pending = (modules.data || []).filter((item) => item.student_id === enrollment.student_id && item.status !== 'aprobado')
        return { ...enrollment, pending }
      }).sort((a, b) => (a.students?.name || '').localeCompare(b.students?.name || ''))

      const initial = {}
      students.forEach((student) => {
        const degreeId = student.class_groups?.degree_id
        const letter = student.class_groups?.name
        const isLast = student.level >= maxLevel
        const mainGroup = isLast
          ? (student.pending.length ? findGroup(degreeId, student.level, letter) : null)
          : findGroup(degreeId, student.level + 1, letter)
        initial[student.student_id] = {
          group: mainGroup?.id || (isLast && !student.pending.length ? FINISHED : ''),
          carry: Object.fromEntries(student.pending.map((item) => [item.degree_module_id, findGroup(degreeId, item.degree_modules?.level || student.level, letter)?.id || mainGroup?.id || ''])),
        }
      })
      setData({ students, groups: targetGroups })
      setPlan(initial)
    })
    return () => { active = false }
  }, [step, targetId, current?.id, maxLevel])

  const summary = useMemo(() => {
    const values = Object.values(plan)
    return {
      promote: values.filter((item) => item.group && item.group !== FINISHED && item.group !== DROPPED).length,
      finished: values.filter((item) => item.group === FINISHED).length,
      dropped: values.filter((item) => item.group === DROPPED).length,
      missing: values.filter((item) => !item.group).length,
      carry: values.reduce((total, item) => total + (item.group === DROPPED ? 0 : Object.values(item.carry).filter(Boolean).length), 0),
    }
  }, [plan])

  async function confirm() {
    setBusy(true)
    setError('')
    const payload = data.students.map((student) => {
      const item = plan[student.student_id]
      const hasGroup = item.group && item.group !== FINISHED && item.group !== DROPPED
      const carryovers = item.group === DROPPED ? [] : Object.entries(item.carry).filter(([, groupId]) => groupId).map(([degreeModuleId, groupId]) => ({ degree_module_id: degreeModuleId, group_id: groupId }))
      const groupId = hasGroup ? item.group : (carryovers[0]?.group_id || null)  // si termina pero arrastra, se matricula con el grupo del arrastre
      return {
        student_id: student.student_id,
        status: item.group === DROPPED ? 'baja' : item.group === FINISHED ? 'finalizado'
          : (data.groups.find((group) => group.id === item.group)?.level || 0) > student.level ? 'promociona' : 'cursando',
        group_id: item.group === DROPPED ? null : groupId,
        carryovers,
      }
    })
    const { data: result, error: closeError } = await supabase.rpc('admin_close_academic_year', {
      p_from_year: current.id, p_to_year: targetId, p_plan: payload, p_enroll_level_modules: enrollLevel,
    })
    setBusy(false)
    if (closeError) { setError(getSupabaseErrorMessage(closeError)); return }
    onDone(true, `Curso ${current.name} cerrado: ${result?.students ?? 0} alumnos matriculados en ${years.find((year) => year.id === targetId)?.name}, ${result?.carryovers ?? 0} módulos arrastrados.`)
  }

  if (!current) return <div className="card empty"><p className="font-medium text-ink-soft">No hay curso actual que cerrar</p></div>
  const target = years.find((year) => year.id === targetId)

  return (
    <section className="card space-y-5 p-5 md:p-6">
      <header className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium text-faint">Paso {step} de 3</p>
          <h3 className="mt-1 text-lg font-semibold text-ink">Cerrar el curso {current.name}</h3>
        </div>
        <button type="button" className="btn-ghost" onClick={onClose}>Salir</button>
      </header>
      {error && <p role="alert" className="notice-error">{error}</p>}

      {step === 1 && (
        <div className="space-y-4">
          <p className="text-sm text-muted">Los alumnos pasarán al curso escolar que elijas. Las notas de {current.name} quedan guardadas y ese curso pasa a solo lectura para los profesores.</p>
          {futureYears.length ? (
            <label className="field max-w-xs">Curso de destino
              <select className="input" value={targetId} onChange={(event) => setTargetId(event.target.value)}>
                {futureYears.map((year) => <option key={year.id} value={year.id}>{year.name}</option>)}
              </select>
            </label>
          ) : (
            <button type="button" className="btn-secondary" disabled={busy} onClick={createNextYear}><Icon name="plus" size={16} />Crear {nextYearName(current).name} con los mismos grupos</button>
          )}
          <label className="flex items-center gap-2.5 text-sm text-ink-soft">
            <input type="checkbox" checked={enrollLevel} onChange={(event) => setEnrollLevel(event.target.checked)} />
            Matricular a cada alumno en los módulos de su nuevo curso
          </label>
          <div className="flex justify-end"><button type="button" className="btn-primary" disabled={!targetId} onClick={() => setStep(2)}>Continuar</button></div>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-4">
          <p className="text-sm text-muted">Revisa el grupo de cada alumno en {target?.name}. Los módulos no aprobados se arrastran con el grupo indicado.</p>
          {!data && <p className="text-sm text-muted">Cargando alumnos…</p>}
          {data && !data.groups.length && <p className="notice-error">{target?.name} no tiene grupos. Créalos en la pestaña Grupos.</p>}
          {data && (
            <ul className="divide-y divide-line rounded-xl border border-line">
              {data.students.map((student) => {
                const item = plan[student.student_id] || { group: '', carry: {} }
                const setItem = (changes) => setPlan((state) => ({ ...state, [student.student_id]: { ...item, ...changes } }))
                return (
                  <li key={student.student_id} className="space-y-2 px-4 py-3">
                    <div className="flex flex-wrap items-center gap-3">
                      <div className="min-w-[160px] flex-1">
                        <p className="font-medium text-ink">{student.students?.name}</p>
                        <p className="text-xs text-muted">{groupLabel(student.class_groups)} · {student.pending.length ? `${student.pending.length} sin aprobar` : 'Todo aprobado'}</p>
                      </div>
                      <select className="input w-auto" aria-label={`Grupo de ${student.students?.name}`} value={item.group} onChange={(event) => setItem({ group: event.target.value })}>
                        <option value="">Elige…</option>
                        {data.groups.map((group) => <option key={group.id} value={group.id}>Pasa a {groupLabel(group)}</option>)}
                        <option value={FINISHED}>Termina sus estudios</option>
                        <option value={DROPPED}>Baja</option>
                      </select>
                    </div>
                    {student.pending.length > 0 && item.group !== DROPPED && (
                      <div className="flex flex-wrap gap-2 pl-0 sm:pl-4">
                        {student.pending.map((pending) => (
                          <label key={pending.degree_module_id} className="flex items-center gap-2 rounded-lg bg-warn-soft px-2.5 py-1.5 text-xs text-ink-soft">
                            Arrastra {pending.degree_modules?.module_id} {KIND_LABEL[pending.degree_modules?.kind]?.toLowerCase()}
                            <select className="rounded-md border border-line bg-surface px-1.5 py-1 text-xs" value={item.carry[pending.degree_module_id] || ''}
                              onChange={(event) => setItem({ carry: { ...item.carry, [pending.degree_module_id]: event.target.value } })}>
                              <option value="">No arrastrar</option>
                              {data.groups.map((group) => <option key={group.id} value={group.id}>con {groupLabel(group)}</option>)}
                            </select>
                          </label>
                        ))}
                      </div>
                    )}
                  </li>
                )
              })}
              {data.students.length === 0 && <li className="px-4 py-6 text-center text-sm text-muted">No hay alumnos matriculados en {current.name}.</li>}
            </ul>
          )}
          <div className="flex justify-between">
            <button type="button" className="btn-ghost" onClick={() => setStep(1)}>Atrás</button>
            <button type="button" className="btn-primary" disabled={!data || summary.missing > 0} onClick={() => setStep(3)}>{summary.missing ? `Faltan ${summary.missing} por decidir` : 'Continuar'}</button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="space-y-4">
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[['Pasan de curso', summary.promote], ['Terminan', summary.finished], ['Bajas', summary.dropped], ['Módulos arrastrados', summary.carry]].map(([label, value]) => (
              <div key={label} className="stat"><dt>{label}</dt><dd>{value}</dd></div>
            ))}
          </dl>
          <p className="text-sm text-muted">{target?.name} pasará a ser el curso actual. Después podrás asignar profesores y horarios del nuevo curso.</p>
          <div className="flex justify-between">
            <button type="button" className="btn-ghost" onClick={() => setStep(2)}>Atrás</button>
            <button type="button" className="btn-primary" disabled={busy} onClick={confirm}>{busy ? 'Cerrando…' : `Cerrar ${current.name}`}</button>
          </div>
        </div>
      )}
    </section>
  )
}
