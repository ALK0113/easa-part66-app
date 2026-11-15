import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { subscribeToTables } from '../lib/supabaseRealtime.js'
import { getSupabaseErrorMessage } from '../lib/supabaseErrors.js'
import { KIND_LABEL, groupLabel } from '../lib/academic.js'
import Icon from './Icon.jsx'

// «Mis grupos» del profesor: alumnos de cada grupo donde imparte y en qué módulos suyos están.
// Puede añadir alumnos de su escuela que aún no tienen grupo y matricularlos en sus módulos.
export default function TeacherGroups({ user, onOpenGrades }) {
  const [assignments, setAssignments] = useState(null)
  const [groupId, setGroupId] = useState('')
  const [roster, setRoster] = useState([])
  const [enrollable, setEnrollable] = useState([])
  const [toAdd, setToAdd] = useState('')
  const [notice, setNotice] = useState(null)
  const [busy, setBusy] = useState(false)
  const [version, setVersion] = useState(0)

  useEffect(() => {
    let active = true
    async function load() {
      const { data, error } = await supabase.from('teaching_assignments')
        .select('id,group_id,degree_module_id,class_groups!inner(id,level,name,academic_years!inner(is_current)),degree_modules(id,module_id,kind)')
        .eq('profile_id', user.id).eq('class_groups.academic_years.is_current', true)
      if (!active) return
      if (error) setNotice({ error: true, text: getSupabaseErrorMessage(error) })
      setAssignments(data || [])
    }
    load()
    const unsubscribe = subscribeToTables(['teaching_assignments'], load, `my-groups-${user.id}`)
    return () => { active = false; unsubscribe() }
  }, [user.id])

  const groups = useMemo(() => {
    const byId = new Map()
    ;(assignments || []).forEach((item) => byId.set(item.group_id, item.class_groups))
    return [...byId.values()].sort((a, b) => a.level - b.level || a.name.localeCompare(b.name))
  }, [assignments])
  const activeGroup = groupId || groups[0]?.id || ''
  const myModules = (assignments || []).filter((item) => item.group_id === activeGroup).map((item) => item.degree_modules)
    .sort((a, b) => a.module_id.localeCompare(b.module_id) || b.kind.localeCompare(a.kind))

  useEffect(() => {
    if (!activeGroup) return undefined
    let active = true
    async function load() {
      const [rosterResult, enrollableResult] = await Promise.all([
        supabase.rpc('teacher_group_roster', { p_group_id: activeGroup }),
        supabase.rpc('teacher_list_enrollable_students'),
      ])
      if (!active) return
      const failed = rosterResult.error || enrollableResult.error
      if (failed) setNotice({ error: true, text: getSupabaseErrorMessage(failed) })
      setRoster(rosterResult.data || [])
      setEnrollable(enrollableResult.data || [])
    }
    load()
    const unsubscribe = subscribeToTables(['enrollments', 'module_enrollments'], load, `my-group-roster-${activeGroup}`)
    return () => { active = false; unsubscribe() }
  }, [activeGroup, version])

  // Un cambio cada vez; tras guardar se recarga la lista
  const run = useCallback(async (action, okText) => {
    setBusy(true)
    const { error } = await action()
    setBusy(false)
    if (error) { setNotice({ error: true, text: getSupabaseErrorMessage(error) }); return false }
    setNotice(okText ? { error: false, text: okText } : null)
    setVersion((value) => value + 1)
    return true
  }, [])

  // Casilla de módulo: se marca al momento y se confirma después (si falla, vuelve atrás); no recarga toda la lista
  async function toggleModule(student, mod, enrolled) {
    const flip = (on) => setRoster((current) => current.map((item) => (item.student_id !== student.student_id ? item : {
      ...item,
      my_modules: on ? [...item.my_modules, mod.id] : item.my_modules.filter((id) => id !== mod.id),
    })))
    flip(!enrolled)
    const { error } = await supabase.rpc('teacher_set_module_enrollment', { p_student_id: student.student_id, p_group_id: activeGroup, p_degree_module_id: mod.id, p_enrolled: !enrolled })
    if (error) { flip(enrolled); setNotice({ error: true, text: getSupabaseErrorMessage(error) }) }
  }

  async function addStudent(event) {
    event.preventDefault()
    const student = enrollable.find((item) => item.student_id === toAdd)
    const ok = await run(() => supabase.rpc('teacher_add_student_to_group', { p_student_id: toAdd, p_group_id: activeGroup }), `${student?.name} añadido al grupo y a tus módulos.`)
    if (ok) setToAdd('')
  }

  if (assignments === null) return <p className="text-sm text-muted">Cargando…</p>

  return (
    <div className="space-y-5">
      <div className="page-intro">
        <div>
          <h2>Mis grupos</h2>
          <p>Tus alumnos de este curso y los módulos tuyos que cursan.</p>
        </div>
      </div>

      {!groups.length ? (
        <div className="card empty">
          <p className="font-medium text-ink-soft">Aún no tienes grupos asignados este curso</p>
          <p className="mt-1">La supervisión te asigna los módulos y grupos que impartes.</p>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Grupo">
            {groups.map((group) => (
              <button key={group.id} type="button" role="radio" aria-checked={group.id === activeGroup} onClick={() => { setGroupId(group.id); setNotice(null) }}
                className={`rounded-xl border px-4 py-2 text-sm font-semibold ${group.id === activeGroup ? 'border-accent bg-accent-soft text-accent-strong' : 'border-line text-ink-soft hover:bg-subtle'}`}>
                {groupLabel(group)}
              </button>
            ))}
          </div>

          {notice && <p role={notice.error ? 'alert' : 'status'} className={notice.error ? 'notice-error' : 'notice-success'}>{notice.text}</p>}

          <section className="card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr>
                    <th className="px-5 py-3">Alumno</th>
                    {myModules.map((mod) => (
                      <th key={mod.id} className="px-3 py-3 text-center">{mod.module_id}<span className="block text-xs font-normal text-muted">{KIND_LABEL[mod.kind]}</span>
                        {onOpenGrades && <button type="button" className="link mt-1 text-xs font-normal" onClick={() => onOpenGrades(activeGroup, mod.id)}>Notas</button>}
                      </th>
                    ))}
                    <th className="px-5 py-3"><span className="sr-only">Acciones</span></th>
                  </tr>
                </thead>
                <tbody>
                  {roster.map((student) => (
                    <tr key={student.student_id} className="border-t border-line">
                      <td className="px-5 py-3">
                        <span className="block font-medium text-ink">{student.name}</span>
                        <span className="text-xs text-muted">Nº {student.student_number || '—'}</span>
                      </td>
                      {myModules.map((mod) => {
                        const enrolled = student.my_modules.includes(mod.id)
                        return (
                          <td key={mod.id} className="px-3 py-3 text-center">
                            <input type="checkbox" checked={enrolled} disabled={busy} aria-label={`${student.name} en ${mod.module_id} ${KIND_LABEL[mod.kind]}`}
                              onChange={() => toggleModule(student, mod, enrolled)} />
                          </td>
                        )
                      })}
                      <td className="px-5 py-3 text-right">
                        {student.other_modules === 0 && (
                          <button type="button" className="rounded-lg p-1.5 text-muted hover:bg-danger-soft hover:text-danger" disabled={busy} aria-label={`Sacar a ${student.name} del grupo`}
                            onClick={() => window.confirm(`¿Sacar a ${student.name} de ${groupLabel(groups.find((group) => group.id === activeGroup))}?`)
                              && run(() => supabase.rpc('teacher_remove_student_from_group', { p_student_id: student.student_id, p_group_id: activeGroup }), `${student.name} ya no está en el grupo.`)}>
                            <Icon name="trash" size={16} />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                  {!roster.length && <tr><td colSpan={myModules.length + 2} className="empty">Este grupo aún no tiene alumnos.</td></tr>}
                </tbody>
              </table>
            </div>
          </section>

          <form className="card flex flex-wrap items-end gap-3 p-5" onSubmit={addStudent}>
            <label className="field min-w-64 flex-1">Añadir un alumno al grupo
              <select className="input" value={toAdd} onChange={(event) => setToAdd(event.target.value)} disabled={!enrollable.length}>
                <option value="">{enrollable.length ? 'Elige un alumno sin grupo…' : 'No hay alumnos sin grupo en tu escuela'}</option>
                {enrollable.map((item) => <option key={item.student_id} value={item.student_id}>{item.name}{item.student_number ? ` · Nº ${item.student_number}` : ''}</option>)}
              </select>
            </label>
            <button type="submit" className="btn-primary" disabled={busy || !toAdd}>Añadir</button>
            <p className="w-full text-xs text-muted">Se le matricula en tus módulos de este grupo. Los alumnos que se registran solos aparecen aquí cuando apruebas su solicitud.</p>
          </form>
        </>
      )}
    </div>
  )
}
