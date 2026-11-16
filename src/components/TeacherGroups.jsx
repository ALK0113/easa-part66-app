import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { subscribeToTables } from '../lib/supabaseRealtime.js'
import { getSupabaseErrorMessage } from '../lib/supabaseErrors.js'
import { KIND_LABEL, groupLabel } from '../lib/academic.js'
import Icon from './Icon.jsx'
import Modal from './Modal.jsx'

// «Mis grupos» del profesor: alumnos de cada grupo donde imparte y en qué módulos suyos están.
// Puede añadir alumnos de su escuela que aún no tienen grupo y matricularlos en sus módulos,
// y crear grupos nuevos del curso actual eligiendo los módulos que imparte en ellos.
export default function TeacherGroups({ user, onOpenGrades }) {
  const [assignments, setAssignments] = useState(null)
  const [groupId, setGroupId] = useState('')
  const [roster, setRoster] = useState([])
  const [enrollable, setEnrollable] = useState([])
  const [toAdd, setToAdd] = useState('')
  const [notice, setNotice] = useState(null)
  const [busy, setBusy] = useState(false)
  const [version, setVersion] = useState(0)
  const [creatingGroup, setCreatingGroup] = useState(false)
  const [assignmentsVersion, setAssignmentsVersion] = useState(0)

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
  }, [user.id, assignmentsVersion])

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
        <button type="button" className="btn-secondary" onClick={() => setCreatingGroup(true)}><Icon name="plus" size={16} />Nuevo grupo</button>
      </div>

      {creatingGroup && (
        <NewGroupForm
          onClose={() => setCreatingGroup(false)}
          onCreated={(newGroupId, label) => {
            setCreatingGroup(false)
            setGroupId(newGroupId)
            setNotice({ error: false, text: `Grupo ${label} creado. Ya eres su profesor; añade sus alumnos abajo.` })
            setAssignmentsVersion((value) => value + 1)
          }}
        />
      )}

      {!groups.length ? (
        <div className="card empty">
          <p className="font-medium text-ink-soft">Aún no tienes grupos asignados este curso</p>
          <p className="mt-1">La supervisión te asigna los módulos y grupos que impartes, o crea tú uno con «Nuevo grupo».</p>
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

// Nuevo grupo del curso actual: curso, letra y los módulos que imparte el profesor en él
function NewGroupForm({ onClose, onCreated }) {
  const [degrees, setDegrees] = useState(null)
  const [form, setForm] = useState({ degreeId: '', level: 1, name: 'A', modules: [] })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let active = true
    supabase.from('degrees').select('id,code,degree_modules(id,module_id,kind,level)').order('created_at').then(({ data, error: loadError }) => {
      if (!active) return
      if (loadError) setError(getSupabaseErrorMessage(loadError))
      setDegrees(data || [])
      if (data?.[0]) setForm((current) => ({ ...current, degreeId: data[0].id }))
    })
    return () => { active = false }
  }, [])

  const degree = (degrees || []).find((item) => item.id === form.degreeId)
  // Primero los módulos del curso elegido
  const modules = [...(degree?.degree_modules || [])].sort((a, b) => (a.level === form.level ? 0 : 1) - (b.level === form.level ? 0 : 1) || a.module_id.localeCompare(b.module_id) || b.kind.localeCompare(a.kind))
  const toggle = (id) => setForm((current) => ({ ...current, modules: current.modules.includes(id) ? current.modules.filter((item) => item !== id) : [...current.modules, id] }))
  const label = `${form.level}º${form.name.trim().toUpperCase()}`

  async function submit(event) {
    event.preventDefault()
    setBusy(true)
    setError('')
    const { data, error: saveError } = await supabase.rpc('teacher_create_group', { p_degree_id: form.degreeId, p_level: Number(form.level), p_name: form.name, p_degree_module_ids: form.modules })
    setBusy(false)
    if (saveError) { setError(getSupabaseErrorMessage(saveError)); return }
    onCreated(data, label)
  }

  return (
    <Modal title="Nuevo grupo" onClose={onClose}>
      {degrees === null ? <p className="text-sm text-muted">Cargando…</p> : !degrees.length ? <p className="text-sm text-muted">La escuela aún no tiene grados. Coordinación debe crearlos en Escuela.</p> : (
        <form className="space-y-4" onSubmit={submit}>
          {degrees.length > 1 && (
            <label className="field">Grado
              <select className="input" value={form.degreeId} onChange={(event) => setForm({ ...form, degreeId: event.target.value, modules: [] })}>
                {degrees.map((item) => <option key={item.id} value={item.id}>{item.code}</option>)}
              </select>
            </label>
          )}
          <div className="grid grid-cols-2 gap-3">
            <label className="field">Curso
              <select className="input" value={form.level} onChange={(event) => setForm({ ...form, level: Number(event.target.value) })}>
                {[1, 2, 3, 4].map((level) => <option key={level} value={level}>{level}º</option>)}
              </select>
            </label>
            <label className="field">Grupo<input className="input" required maxLength={20} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="A" /></label>
          </div>
          <fieldset>
            <legend className="mb-1.5 text-sm font-medium text-ink-soft">Módulos que impartes en {label}</legend>
            <div className="grid max-h-60 gap-2 overflow-y-auto sm:grid-cols-2">
              {modules.map((item) => (
                <label key={item.id} className={`choice ${item.level === form.level ? '' : 'opacity-70'}`}>
                  <input type="checkbox" checked={form.modules.includes(item.id)} onChange={() => toggle(item.id)} />
                  <span>{item.module_id} · {KIND_LABEL[item.kind]}{item.level ? <span className="text-xs text-muted"> · {item.level}º</span> : null}</span>
                </label>
              ))}
            </div>
          </fieldset>
          {error && <p role="alert" className="notice-error">{error}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-secondary" onClick={onClose}>Cancelar</button>
            <button type="submit" className="btn-primary" disabled={busy || !form.name.trim() || !form.modules.length}>{busy ? 'Creando…' : `Crear ${label}`}</button>
          </div>
        </form>
      )}
    </Modal>
  )
}
