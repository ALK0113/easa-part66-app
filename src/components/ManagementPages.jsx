import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { subscribeToTables } from '../lib/supabaseRealtime.js'
import { aircraft as starterAircraft } from '../data/aircraft.js'
import { modules as starterModules } from '../data/modules.js'
import { practices as starterPractices } from '../data/practices.js'
import { students as starterStudents } from '../data/students.js'
import { videos as starterVideos } from '../data/videos.js'
import { getSupabaseErrorMessage, isMissingTable } from '../lib/supabaseErrors.js'

const cardClass = 'rounded-lg border border-[#e5e7eb] bg-white p-5 shadow-sm'
const inputClass = 'w-full rounded border border-[#d1d5db] px-3 py-2 text-sm focus:border-[#1e88e5]'
const primaryButton = 'rounded bg-[#1e88e5] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1565c0] disabled:opacity-50'
const secondaryButton = 'rounded border border-[#d1d5db] bg-white px-4 py-2 text-sm font-semibold text-[#0a2540] hover:bg-[#f4f6f9]'

function useRows(table, columns = '*') {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  async function reload() {
    setLoading(true)
    const { data, error: queryError } = await supabase.from(table).select(columns)
    if (queryError) setError(queryError.message)
    else {
      setRows(data || [])
      setError('')
    }
    setLoading(false)
  }

  useEffect(() => {
    let cancelled = false
    async function load(showLoading = false) {
      if (showLoading) setLoading(true)
      const { data, error: queryError } = await supabase.from(table).select(columns)
      if (cancelled) return
      if (queryError) setError(queryError.message)
      else setRows(data || [])
      setLoading(false)
    }
    load()
    const unsubscribe = subscribeToTables([table], () => load(), `${table}-updates`)
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [table, columns])

  return { rows, setRows, loading, error, reload }
}

function Notice({ children, error = false }) {
  return <p role={error ? 'alert' : 'status'} className={`rounded p-3 text-sm ${error ? 'bg-red-50 text-red-800' : 'bg-blue-50 text-blue-900'}`}>{children}</p>
}

function Dialog({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section role="dialog" aria-modal="true" aria-label={title} className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-lg bg-white shadow-2xl">
        <header className="flex items-center justify-between border-b border-[#e5e7eb] px-5 py-4">
          <h2 className="font-bold text-[#0a2540]">{title}</h2>
          <button type="button" className="px-2 text-2xl text-[#6b7280]" aria-label="Cerrar" onClick={onClose}>×</button>
        </header>
        <div className="space-y-4 p-5">{children}</div>
      </section>
    </div>
  )
}

function FormField({ label, value, onChange, type = 'text', required = false }) {
  return (
    <label className="grid gap-1.5 text-sm font-semibold text-[#0a2540]">
      {label}
      <input className={inputClass} type={type} value={value} onChange={(event) => onChange(event.target.value)} required={required} />
    </label>
  )
}

function ErrorOrLoading({ loading, error }) {
  if (loading) return <Notice>Cargando datos…</Notice>
  if (error) return <Notice error>{error}</Notice>
  return null
}

export function ModulesPage({ user, onOpenModule }) {
  const { rows: modules, loading, error, reload } = useRows('modules', 'id,name,description,color')
  const { rows: practices } = useRows('practices', 'id,module_id,hours')
  const { rows: teacherAssignments } = useRows('teacher_modules', 'profile_id,module_id')
  const { rows: studentAssignments } = useRows('student_modules', 'student_id,module_id')
  const { rows: studentProfiles } = useRows('student_profiles', 'student_id,profile_id')
  const [editing, setEditing] = useState(null)
  const [formOpen, setFormOpen] = useState(false)
  const [form, setForm] = useState({ id: '', name: '', description: '', color: 1 })
  const [message, setMessage] = useState('')
  const canEdit = user.role === 'admin'
  const ownStudentId = studentProfiles.find((entry) => entry.profile_id === user.id)?.student_id
  const assignedModuleIds = user.role === 'profesor'
    ? teacherAssignments.filter((entry) => entry.profile_id === user.id).map((entry) => entry.module_id)
    : user.role === 'alumno'
      ? studentAssignments.filter((entry) => entry.student_id === ownStudentId).map((entry) => entry.module_id)
      : modules.map((module) => module.id)
  const visibleModules = modules.filter((module) => assignedModuleIds.includes(module.id))

  function openForm(module = null) {
    setEditing(module)
    setFormOpen(true)
    setForm(module ? { ...module } : { id: '', name: '', description: '', color: (modules.length % 17) + 1 })
    setMessage('')
  }

  async function saveModule(event) {
    event.preventDefault()
    const payload = { id: form.id.trim(), name: form.name.trim(), description: form.description.trim(), color: Number(form.color) || 1 }
    const result = editing
      ? await supabase.from('modules').update(payload).eq('id', editing.id)
      : await supabase.from('modules').insert(payload)
    if (result.error) { setMessage(result.error.message); return }
    setEditing(null)
    setFormOpen(false)
    setMessage('Módulo guardado.')
    await reload()
  }

  async function deleteModule(module) {
    if (!window.confirm(`¿Eliminar el módulo ${module.id}?`)) return
    const [practiceUse, tlbUse] = await Promise.all([
      supabase.from('practices').select('id', { count: 'exact', head: true }).eq('module_id', module.id),
      supabase.from('tlbs').select('id', { count: 'exact', head: true }).eq('module_id', module.id),
    ])
    if (practiceUse.error || tlbUse.error) { setMessage((practiceUse.error || tlbUse.error).message); return }
    if (practiceUse.count || tlbUse.count) { setMessage('No se puede eliminar: hay prácticas o TLB asociados a este módulo.'); return }
    for (const table of ['student_modules', 'teacher_modules']) {
      const { error: unlinkError } = await supabase.from(table).delete().eq('module_id', module.id)
      if (unlinkError) { setMessage(unlinkError.message); return }
    }
    const { error: deleteError } = await supabase.from('modules').delete().eq('id', module.id)
    if (deleteError) setMessage(deleteError.message)
    else { setMessage('Módulo eliminado.'); await reload() }
  }

  return (
    <div className="space-y-5">
      <section className={cardClass}>
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div><h2 className="text-lg font-bold text-[#0a2540]">{user.role === 'alumno' ? 'Mis módulos' : 'Módulos EASA Part 66'}</h2><p className="mt-1 text-sm text-[#6b7280]">{visibleModules.length} módulos · datos de Supabase</p></div>
          {canEdit && <button className={primaryButton} onClick={() => openForm()}>+ Nuevo módulo</button>}
        </div>
        <ErrorOrLoading loading={loading} error={error} />
        {message && <Notice>{message}</Notice>}
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {visibleModules.map((module) => {
            const count = practices.filter((practice) => practice.module_id === module.id).length
            const studentCount = studentAssignments.filter((entry) => entry.module_id === module.id).length
            return (
              <article key={module.id} className="rounded-md border border-[#e5e7eb] border-t-4 border-t-[#1e88e5] p-4">
                <button className="w-full text-left" onClick={() => onOpenModule(module.id)}>
                  <p className="text-xs font-bold uppercase text-[#6b7280]">{module.id}</p>
                  <h3 className="mt-1 font-bold text-[#0a2540]">{module.name}</h3>
                  <p className="mt-1 min-h-10 text-sm text-[#6b7280]">{module.description || 'Sin descripción'}</p>
                  <span className="mt-2 inline-block text-xs font-semibold text-[#1565c0]">Abrir detalle →</span>
                </button>
                <div className="mt-3 flex items-center justify-between border-t border-[#e5e7eb] pt-3 text-xs text-[#6b7280]">
                  <span><strong className="text-[#0a2540]">{count}</strong> prácticas</span>
                  <span><strong className="text-[#0a2540]">{studentCount}</strong> alumnos</span>
                  {canEdit && <div className="flex gap-2"><button className="text-[#1565c0]" onClick={() => openForm(module)}>Editar</button><button className="text-red-700" onClick={() => deleteModule(module)}>Eliminar</button></div>}
                </div>
              </article>
            )
          })}
        </div>
      </section>
      {formOpen && (
        <Dialog title={editing ? `Editar módulo ${editing.id}` : 'Nuevo módulo'} onClose={() => setFormOpen(false)}>
          <form className="space-y-4" onSubmit={saveModule}>
            <FormField label="Código" value={form.id} onChange={(id) => setForm({ ...form, id })} required />
            <FormField label="Nombre" value={form.name} onChange={(name) => setForm({ ...form, name })} required />
            <FormField label="Descripción" value={form.description || ''} onChange={(description) => setForm({ ...form, description })} />
            <FormField label="Color (1-18)" type="number" value={form.color} onChange={(color) => setForm({ ...form, color })} />
            {message && <Notice error>{message}</Notice>}
            <div className="flex justify-end gap-2"><button type="button" className={secondaryButton} onClick={() => setFormOpen(false)}>Cancelar</button><button className={primaryButton}>Guardar</button></div>
          </form>
        </Dialog>
      )}
    </div>
  )
}

export function AssignmentsPage({ user }) {
  const { rows: students, loading: studentsLoading, error: studentsError } = useRows('students', 'id,name,student_number,group_name,promo')
  const { rows: modules, loading: modulesLoading } = useRows('modules', 'id,name')
  const { rows: profiles, loading: profilesLoading } = useRows('profiles', 'id,full_name,email,role')
  const { rows: studentModules, reload: reloadStudentModules } = useRows('student_modules', 'student_id,module_id')
  const { rows: teacherModules, reload: reloadTeacherModules } = useRows('teacher_modules', 'profile_id,module_id')
  const { rows: studentProfiles, reload: reloadStudentProfiles } = useRows('student_profiles', 'student_id,profile_id')
  const [selectedStudent, setSelectedStudent] = useState('')
  const [selectedTeacher, setSelectedTeacher] = useState('')
  const [selectedGroup, setSelectedGroup] = useState('')
  const [selectedPromo, setSelectedPromo] = useState('')
  const [bulkModuleIds, setBulkModuleIds] = useState([])
  const [bulkBusy, setBulkBusy] = useState(false)
  const [message, setMessage] = useState('')

  const activeStudentModules = studentModules.filter((entry) => entry.student_id === selectedStudent).map((entry) => entry.module_id)
  const activeTeacherModules = teacherModules.filter((entry) => entry.profile_id === selectedTeacher).map((entry) => entry.module_id)
  const linkedProfile = studentProfiles.find((entry) => entry.student_id === selectedStudent)?.profile_id || ''
  const teachers = profiles.filter((profile) => profile.role === 'profesor')
  const groups = [...new Set(students.map((student) => student.group_name).filter(Boolean))].sort()
  const promos = [...new Set(students.map((student) => String(student.promo || '')).filter(Boolean))].sort()
  const selectedClassCount = students.filter((student) => student.group_name === selectedGroup && String(student.promo || '') === selectedPromo).length
  const canEdit = user.role === 'admin'

  async function replaceLinks(table, ownerId, values) {
    const result = table === 'student_modules'
      ? await supabase.rpc('admin_replace_student_modules', { p_student_id: ownerId, p_module_ids: values })
      : await supabase.rpc('admin_replace_teacher_modules', { p_profile_id: ownerId, p_module_ids: values })
    if (result.error) { setMessage(getSupabaseErrorMessage(result.error)); return false }
    setMessage('Asignaciones guardadas.')
    return true
  }

  async function toggleStudentModule(moduleId, checked) {
    const next = new Set(activeStudentModules)
    if (checked) next.add(moduleId)
    else next.delete(moduleId)
    if (await replaceLinks('student_modules', selectedStudent, [...next])) await reloadStudentModules()
  }

  async function toggleTeacherModule(moduleId, checked) {
    const next = new Set(activeTeacherModules)
    if (checked) next.add(moduleId)
    else next.delete(moduleId)
    if (await replaceLinks('teacher_modules', selectedTeacher, [...next])) await reloadTeacherModules()
  }

  async function linkProfile(profileId) {
    const { error: saveError } = await supabase.rpc('admin_link_student_profile', {
      p_student_id: selectedStudent,
      p_profile_id: profileId || null,
    })
    if (saveError) { setMessage(getSupabaseErrorMessage(saveError)); return }
    setMessage('Cuenta vinculada.')
    await reloadStudentProfiles()
  }

  async function assignClassModules(event) {
    event.preventDefault()
    if (!selectedGroup || !selectedPromo || !bulkModuleIds.length) {
      setMessage('Selecciona clase, promoción y al menos un módulo.')
      return
    }
    if (!window.confirm(`Se agregarán ${bulkModuleIds.length} módulo(s) a ${selectedClassCount} alumno(s) de ${selectedGroup}, promoción ${selectedPromo}. Las matrículas existentes se conservan. ¿Continuar?`)) return
    setBulkBusy(true)
    setMessage('')
    const { data, error: assignmentError } = await supabase.rpc('admin_assign_class_modules', {
      p_group_name: selectedGroup,
      p_promo: selectedPromo,
      p_module_ids: bulkModuleIds,
    })
    setBulkBusy(false)
    if (assignmentError) { setMessage(getSupabaseErrorMessage(assignmentError)); return }
    setMessage(`Asignación completada: ${data.assignments_added} matrícula(s) nueva(s) para ${data.students} alumno(s).`)
    await reloadStudentModules()
  }

  if (!canEdit) return <Notice error>Solo administración puede gestionar asignaciones.</Notice>

  return (
    <div className="space-y-5">
      {(studentsLoading || modulesLoading || profilesLoading) && <Notice>Cargando asignaciones…</Notice>}
      {studentsError && <Notice error>{studentsError}</Notice>}
      {message && <Notice>{message}</Notice>}
      <section className={cardClass}>
        <div className="mb-4"><h2 className="text-lg font-bold text-[#0a2540]">Asignación por clase y promoción</h2><p className="mt-1 text-sm text-[#6b7280]">Añade módulos a todos los alumnos seleccionados; las matrículas ya existentes se mantienen.</p></div>
        <form className="space-y-4" onSubmit={assignClassModules}>
          <div className="grid gap-3 md:grid-cols-3">
            <label className="grid gap-1 text-sm font-semibold text-[#0a2540]">Clase<select className={inputClass} value={selectedGroup} onChange={(event) => setSelectedGroup(event.target.value)} required><option value="">Selecciona clase</option>{groups.map((group) => <option key={group} value={group}>{group}</option>)}</select></label>
            <label className="grid gap-1 text-sm font-semibold text-[#0a2540]">Promoción<select className={inputClass} value={selectedPromo} onChange={(event) => setSelectedPromo(event.target.value)} required><option value="">Selecciona promoción</option>{promos.map((promo) => <option key={promo} value={promo}>{promo}</option>)}</select></label>
            <div className="self-end rounded border border-[#e5e7eb] bg-[#f9fafb] px-3 py-2 text-sm text-[#4b5563]">Alumnos incluidos: <strong className="text-[#0a2540]">{selectedClassCount}</strong></div>
          </div>
          <fieldset className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            <legend className="mb-2 text-sm font-semibold text-[#0a2540]">Módulos que se agregarán</legend>
            {modules.map((module) => <label key={module.id} className="flex items-center gap-2 rounded border border-[#e5e7eb] p-2 text-sm"><input type="checkbox" checked={bulkModuleIds.includes(module.id)} onChange={(event) => setBulkModuleIds((current) => event.target.checked ? [...current, module.id] : current.filter((id) => id !== module.id))} />{module.id} · {module.name}</label>)}
          </fieldset>
          <button className={primaryButton} disabled={bulkBusy || studentsLoading || selectedClassCount === 0}>{bulkBusy ? 'Asignando…' : 'Asignar a toda la clase'}</button>
        </form>
      </section>
      <section className={cardClass}>
        <h2 className="mb-4 text-lg font-bold text-[#0a2540]">Alumnos: módulos y cuentas</h2>
        <label className="mb-4 block max-w-xl text-sm font-semibold text-[#0a2540]">Alumno
          <select className={`${inputClass} mt-1`} value={selectedStudent} onChange={(event) => { setSelectedStudent(event.target.value); setMessage('') }}>
            <option value="">Selecciona un alumno</option>
            {students.map((student) => <option key={student.id} value={String(student.id)}>{student.name} · {student.student_number}</option>)}
          </select>
        </label>
        {selectedStudent && <>
          <fieldset className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            <legend className="mb-2 text-sm font-semibold text-[#0a2540]">Módulos matriculados</legend>
            {modules.map((module) => <label key={module.id} className="flex items-center gap-2 rounded border border-[#e5e7eb] p-2 text-sm"><input type="checkbox" checked={activeStudentModules.includes(module.id)} onChange={(event) => toggleStudentModule(module.id, event.target.checked)} />{module.id} · {module.name}</label>)}
          </fieldset>
          <label className="mt-5 block max-w-xl text-sm font-semibold text-[#0a2540]">Cuenta de acceso asociada
            <select className={`${inputClass} mt-1`} value={linkedProfile} onChange={(event) => linkProfile(event.target.value)}>
              <option value="">Sin vincular</option>
              {profiles.filter((profile) => profile.role === 'alumno').map((profile) => <option key={profile.id} value={profile.id}>{profile.full_name || profile.email} · {profile.email}</option>)}
            </select>
          </label>
        </>}
      </section>
      <section className={cardClass}>
        <h2 className="mb-4 text-lg font-bold text-[#0a2540]">Profesores: módulos impartidos</h2>
        <label className="mb-4 block max-w-xl text-sm font-semibold text-[#0a2540]">Profesor
          <select className={`${inputClass} mt-1`} value={selectedTeacher} onChange={(event) => setSelectedTeacher(event.target.value)}>
            <option value="">Selecciona un profesor</option>
            {teachers.map((teacher) => <option key={teacher.id} value={teacher.id}>{teacher.full_name || teacher.email}</option>)}
          </select>
        </label>
        {selectedTeacher && <fieldset className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          <legend className="mb-2 text-sm font-semibold text-[#0a2540]">Módulos asignados</legend>
          {modules.map((module) => <label key={module.id} className="flex items-center gap-2 rounded border border-[#e5e7eb] p-2 text-sm"><input type="checkbox" checked={activeTeacherModules.includes(module.id)} onChange={(event) => toggleTeacherModule(module.id, event.target.checked)} />{module.id} · {module.name}</label>)}
        </fieldset>}
      </section>
    </div>
  )
}

export function TeachersPage({ user }) {
  const { rows: profiles, loading, error, reload } = useRows('profiles', 'id,full_name,email,role')
  const { rows: assignments } = useRows('teacher_modules', 'profile_id,module_id')
  const { rows: modules } = useRows('modules', 'id,name')
  const [message, setMessage] = useState('')
  const [email, setEmail] = useState('')
  const [fullName, setFullName] = useState('')
  const [busy, setBusy] = useState(false)
  const teachers = profiles.filter((profile) => profile.role === 'profesor')

  async function promoteProfile(profile) {
    const nextRole = profile.role === 'profesor' ? 'alumno' : 'profesor'
    const { error: updateError } = await supabase.rpc('admin_set_profile_role', { p_profile_id: profile.id, p_role: nextRole })
    if (updateError) setMessage(getSupabaseErrorMessage(updateError))
    else {
      setMessage(`Rol actualizado a ${nextRole}.`)
      await reload()
    }
  }

  async function createTeacher(event) {
    event.preventDefault()
    setBusy(true)
    setMessage('')
    const { data, error: invokeError } = await supabase.functions.invoke('admin-create-user', {
      body: { email: email.trim(), full_name: fullName.trim(), role: 'profesor' },
    })
    setBusy(false)
    if (invokeError || data?.error) setMessage(invokeError?.message || data.error)
    else { setEmail(''); setFullName(''); setMessage('Profesor creado; se ha enviado la invitación.'); await reload() }
  }

  if (user.role !== 'admin') return <Notice error>Solo administración puede gestionar profesores.</Notice>

  return (
    <div className="space-y-5">
      <section className={cardClass}>
        <h2 className="mb-4 text-lg font-bold text-[#0a2540]">Invitar profesor</h2>
        <form className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]" onSubmit={createTeacher}>
          <input className={inputClass} type="text" placeholder="Nombre completo" value={fullName} onChange={(event) => setFullName(event.target.value)} required />
          <input className={inputClass} type="email" placeholder="Correo electrónico" value={email} onChange={(event) => setEmail(event.target.value)} required />
          <button className={primaryButton} disabled={busy}>{busy ? 'Enviando…' : 'Enviar invitación'}</button>
        </form>
        <p className="mt-2 text-xs text-[#6b7280]">Requiere desplegar la función segura `admin-create-user` incluida en `supabase/functions`.</p>
        {message && <div className="mt-3"><Notice error={Boolean(message.includes('error') || message.includes('Error'))}>{message}</Notice></div>}
      </section>
      <section className={cardClass}>
        <h2 className="mb-4 text-lg font-bold text-[#0a2540]">Profesores ({teachers.length})</h2>
        <ErrorOrLoading loading={loading} error={error} />
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-[#0a2540] text-xs uppercase text-white"><tr><th className="p-3">Nombre</th><th className="p-3">Correo</th><th className="p-3">Módulos</th><th className="p-3">Acción</th></tr></thead>
            <tbody>{teachers.map((teacher) => <tr key={teacher.id} className="border-b border-[#e5e7eb]">
              <td className="p-3 font-semibold">{teacher.full_name || 'Sin nombre'}</td>
              <td className="p-3">{teacher.email}</td>
              <td className="p-3">{assignments.filter((entry) => entry.profile_id === teacher.id).map((entry) => modules.find((module) => module.id === entry.module_id)?.id || entry.module_id).join(', ') || 'Sin asignar'}</td>
              <td className="p-3"><button className="text-sm font-semibold text-red-700" onClick={() => promoteProfile(teacher)}>Retirar rol</button></td>
            </tr>)}</tbody>
          </table>
        </div>
      </section>
    </div>
  )
}

export function AircraftPage({ user }) {
  const { rows: aircraft, loading, error, reload } = useRows('aircraft', 'id,type,registration,msn,engines,seats,category')
  const [editing, setEditing] = useState(null)
  const [formOpen, setFormOpen] = useState(false)
  const [form, setForm] = useState({ type: '', registration: '', msn: '', engines: '', seats: '', category: 'Narrow Body' })
  const [message, setMessage] = useState('')
  const canEdit = user.role === 'admin' || user.role === 'profesor'

  function openForm(item = null) {
    setEditing(item)
    setFormOpen(true)
    setForm(item ? { ...item, seats: item.seats ?? '' } : { type: '', registration: '', msn: '', engines: '', seats: '', category: 'Narrow Body' })
  }

  async function save(event) {
    event.preventDefault()
    const payload = { ...form, seats: form.seats === '' ? null : Number(form.seats) }
    const result = editing
      ? await supabase.from('aircraft').update(payload).eq('id', editing.id)
      : await supabase.from('aircraft').insert(payload)
    if (result.error) setMessage(result.error.message)
    else { setEditing(null); setFormOpen(false); setMessage('Avión guardado.'); await reload() }
  }

  async function remove(item) {
    if (!window.confirm(`¿Eliminar ${item.type} (${item.registration})?`)) return
    const { error: deleteError } = await supabase.from('aircraft').delete().eq('id', item.id)
    if (deleteError) setMessage(deleteError.message)
    else { setMessage('Avión eliminado.'); await reload() }
  }

  return (
    <div className="space-y-5">
      <section className={cardClass}>
        <div className="mb-5 flex items-center justify-between gap-3"><div><h2 className="text-lg font-bold text-[#0a2540]">Tipos de avión</h2><p className="mt-1 text-sm text-[#6b7280]">{aircraft.length} aeronaves</p></div>{canEdit && <button className={primaryButton} onClick={() => openForm()}>+ Nuevo avión</button>}</div>
        <ErrorOrLoading loading={loading} error={error} />
        {message && <Notice>{message}</Notice>}
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {aircraft.map((item) => <article key={item.id} className="rounded-lg bg-gradient-to-br from-[#0a2540] to-[#1e88e5] p-5 text-white">
            <div className="flex justify-between gap-2"><div><p className="text-xs uppercase text-blue-100">{item.category || 'Aeronave'}</p><h3 className="mt-1 text-lg font-bold">{item.type}</h3></div>{canEdit && <div className="flex gap-2 text-xs"><button onClick={() => openForm(item)}>Editar</button><button onClick={() => remove(item)}>Eliminar</button></div>}</div>
            <dl className="mt-4 grid grid-cols-2 gap-2 text-sm">{[['Matrícula', item.registration], ['MSN', item.msn], ['Motor', item.engines], ['Asientos', item.seats]].map(([label, value]) => <div key={label} className="rounded bg-white/10 p-2"><dt className="text-[10px] uppercase text-blue-100">{label}</dt><dd className="mt-1 font-semibold">{value || '—'}</dd></div>)}</dl>
          </article>)}
        </div>
      </section>
      {formOpen && <Dialog title={editing ? 'Editar avión' : 'Nuevo avión'} onClose={() => setFormOpen(false)}><form className="space-y-4" onSubmit={save}>
        <FormField label="Tipo" value={form.type} onChange={(type) => setForm({ ...form, type })} required />
        <FormField label="Matrícula" value={form.registration} onChange={(registration) => setForm({ ...form, registration })} required />
        <FormField label="MSN" value={form.msn || ''} onChange={(msn) => setForm({ ...form, msn })} />
        <FormField label="Motores" value={form.engines || ''} onChange={(engines) => setForm({ ...form, engines })} />
        <FormField label="Asientos" type="number" value={form.seats} onChange={(seats) => setForm({ ...form, seats })} />
        <label className="grid gap-1.5 text-sm font-semibold text-[#0a2540]">Categoría<select className={inputClass} value={form.category || ''} onChange={(event) => setForm({ ...form, category: event.target.value })}>{['Light Jet', 'Narrow Body', 'Wide Body', 'Regional'].map((item) => <option key={item}>{item}</option>)}</select></label>
        <div className="flex justify-end gap-2"><button type="button" className={secondaryButton} onClick={() => setFormOpen(false)}>Cancelar</button><button className={primaryButton}>Guardar</button></div>
      </form></Dialog>}
    </div>
  )
}

function csvCell(value) {
  const text = String(value ?? '')
  return `"${(/^[=+@-]/.test(text) ? `'${text}` : text).replaceAll('"', '""')}"`
}

export function ReportsPage() {
  const { rows: students, loading: studentsLoading, error: studentsError } = useRows('students', 'id,name,group_name,promo')
  const { rows: practices, loading: practicesLoading } = useRows('practices', 'id,module_id,title')
  const { rows: memberships, loading: membershipsLoading } = useRows('student_modules', 'student_id,module_id')
  const { rows: records, loading: recordsLoading, error: recordsError } = useRows('practice_records', 'student_id,practice_id,attendance,evaluation')
  const [promo, setPromo] = useState('')
  const [group, setGroup] = useState('')
  const promos = [...new Set(students.map((student) => student.promo).filter(Boolean))].sort()
  const groups = [...new Set(students.map((student) => student.group_name).filter(Boolean))].sort()

  const report = students.filter((student) => (!promo || String(student.promo) === promo) && (!group || student.group_name === group)).map((student) => {
    const moduleIds = memberships.filter((entry) => entry.student_id === String(student.id)).map((entry) => entry.module_id)
    const relevant = practices.filter((practice) => moduleIds.includes(practice.module_id))
    const studentRecords = records.filter((record) => record.student_id === String(student.id))
    const present = studentRecords.filter((record) => record.attendance === 'P').length
    const late = studentRecords.filter((record) => record.attendance === 'L').length
    const absent = studentRecords.filter((record) => record.attendance === 'A').length
    const apto = studentRecords.filter((record) => record.evaluation === 'Apto').length
    const attendanceRate = present + late + absent ? Math.round(((present + late) / (present + late + absent)) * 100) : 0
    const aptitudeRate = studentRecords.filter((record) => record.evaluation).length ? Math.round((apto / studentRecords.filter((record) => record.evaluation).length) * 100) : 0
    return { ...student, relevantCount: relevant.length, present, late, absent, apto, attendanceRate, aptitudeRate }
  })

  const classReports = [...report.reduce((classes, student) => {
    const key = `${student.group_name || 'Sin clase'} · ${student.promo || 'Sin promoción'}`
    const current = classes.get(key) || { key, group: student.group_name || 'Sin clase', promo: student.promo || '—', students: 0, present: 0, late: 0, absent: 0, apto: 0, evaluated: 0 }
    current.students += 1
    current.present += student.present
    current.late += student.late
    current.absent += student.absent
    current.apto += student.apto
    current.evaluated += records.filter((record) => record.student_id === String(student.id) && record.evaluation).length
    classes.set(key, current)
    return classes
  }, new Map()).values()].map((classReport) => ({
    ...classReport,
    attendanceRate: classReport.present + classReport.late + classReport.absent
      ? Math.round(((classReport.present + classReport.late) / (classReport.present + classReport.late + classReport.absent)) * 100)
      : 0,
    aptitudeRate: classReport.evaluated ? Math.round((classReport.apto / classReport.evaluated) * 100) : 0,
  }))

  function exportCsv() {
    const rows = [['Nombre', 'Grupo', 'Promoción', 'Prácticas', 'Presente', 'Tarde', 'Falta', 'Aptos', '% Asistencia', '% Aptos'], ...report.map((student) => [student.name, student.group_name, student.promo, student.relevantCount, student.present, student.late, student.absent, student.apto, `${student.attendanceRate}%`, `${student.aptitudeRate}%`])]
    const blob = new Blob([rows.map((row) => row.map(csvCell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'informe_easa.csv'
    link.click()
    URL.revokeObjectURL(url)
  }

  const loading = studentsLoading || practicesLoading || membershipsLoading || recordsLoading
  return <section className={cardClass}>
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3"><div><h2 className="text-lg font-bold text-[#0a2540]">Informe de asistencia por alumno y clase</h2><p className="mt-1 text-sm text-[#6b7280]">Asistencia y evaluación agregadas desde Supabase</p></div><div className="flex flex-wrap gap-2"><select className={`${inputClass} min-w-36`} value={group} onChange={(event) => setGroup(event.target.value)}><option value="">Todas las clases</option>{groups.map((item) => <option key={item}>{item}</option>)}</select><select className={`${inputClass} min-w-40`} value={promo} onChange={(event) => setPromo(event.target.value)}><option value="">Todas las promociones</option>{promos.map((item) => <option key={item}>{item}</option>)}</select><button className={secondaryButton} onClick={() => window.print()}>Imprimir</button><button className={primaryButton} disabled={loading || Boolean(recordsError)} onClick={exportCsv}>Exportar CSV</button></div></div>
    <ErrorOrLoading loading={loading} error={studentsError || recordsError} />
    <h3 className="mb-2 font-bold text-[#0a2540]">Resumen por clase</h3>
    <div className="mb-6 overflow-x-auto"><table className="w-full text-left text-sm"><thead className="bg-[#0a2540] text-xs uppercase text-white"><tr>{['Clase', 'Promoción', 'Alumnos', 'P', 'T', 'F', 'Aptos', '% Asistencia', '% Aptos'].map((label) => <th key={label} className="p-3">{label}</th>)}</tr></thead><tbody>{classReports.map((item) => <tr key={item.key} className="border-b border-[#e5e7eb]"><td className="p-3 font-semibold">{item.group}</td><td className="p-3">{item.promo}</td><td className="p-3">{item.students}</td><td className="p-3">{item.present}</td><td className="p-3">{item.late}</td><td className="p-3">{item.absent}</td><td className="p-3">{item.apto}/{item.evaluated}</td><td className="p-3">{item.attendanceRate}%</td><td className="p-3">{item.aptitudeRate}%</td></tr>)}</tbody></table>{classReports.length === 0 && <p className="p-4 text-center text-sm text-[#6b7280]">No hay datos para estos filtros.</p>}</div>
    <h3 className="mb-2 font-bold text-[#0a2540]">Detalle por alumno</h3>
    <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="bg-[#0a2540] text-xs uppercase text-white"><tr>{['Alumno', 'Grupo', 'Promoción', 'Prácticas', 'P', 'T', 'F', 'Aptos', '% Asistencia', '% Aptos'].map((label) => <th key={label} className="p-3">{label}</th>)}</tr></thead><tbody>{report.map((student) => <tr key={student.id} className="border-b border-[#e5e7eb] hover:bg-gray-50"><td className="p-3 font-semibold">{student.name}</td><td className="p-3">{student.group_name}</td><td className="p-3">{student.promo || '—'}</td><td className="p-3">{student.relevantCount}</td><td className="p-3">{student.present}</td><td className="p-3">{student.late}</td><td className="p-3">{student.absent}</td><td className="p-3">{student.apto}</td><td className="p-3">{student.attendanceRate}%</td><td className="p-3">{student.aptitudeRate}%</td></tr>)}</tbody></table></div>
  </section>
}

export function MyDataPage({ user }) {
  const [student, setStudent] = useState(null)
  const [modules, setModules] = useState([])
  const [practices, setPractices] = useState([])
  const [records, setRecords] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    async function load() {
      const { data: link, error: linkError } = await supabase.from('student_profiles').select('student_id').eq('profile_id', user.id).maybeSingle()
      if (linkError) {
        if (!cancelled) { setError(linkError.message); setLoading(false) }
        return
      }
      if (!link) {
        if (!cancelled) setLoading(false)
        return
      }
      const [studentResult, membershipResult, moduleResult, practiceResult, recordResult] = await Promise.all([
        supabase.from('students').select('id,student_number,name,group_name,promo').eq('id', link.student_id).maybeSingle(),
        supabase.from('student_modules').select('module_id').eq('student_id', link.student_id),
        supabase.from('modules').select('id,name,description,color'),
        supabase.from('practices').select('id,module_id,ata,title,date,start_time,hours'),
        supabase.from('practice_records').select('practice_id,attendance,evaluation').eq('student_id', link.student_id),
      ])
      if (cancelled) return
      const failure = studentResult.error || membershipResult.error || moduleResult.error || practiceResult.error || recordResult.error
      if (failure) setError(failure.message)
      else {
        const moduleIds = (membershipResult.data || []).map((entry) => entry.module_id)
        setStudent(studentResult.data)
        setModules((moduleResult.data || []).filter((module) => moduleIds.includes(module.id)))
        setPractices((practiceResult.data || []).filter((practice) => moduleIds.includes(practice.module_id)).sort((a, b) => a.date.localeCompare(b.date)))
        setRecords(recordResult.data || [])
      }
      setLoading(false)
    }
    load()
    const unsubscribe = subscribeToTables(['student_profiles', 'student_modules', 'practice_records', 'practices', 'modules'], load, `my-data-${user.id}`)
    return () => { cancelled = true; unsubscribe() }
  }, [user.id])

  if (loading) return <Notice>Cargando tus datos…</Notice>
  if (error) return <Notice error>{error}</Notice>
  if (!student) return <section className={cardClass}><h2 className="font-bold text-[#0a2540]">Perfil de alumno sin vincular</h2><p className="mt-2 text-sm text-[#6b7280]">Pide a administración que asocie tu cuenta a una ficha de alumno.</p></section>

  const recordFor = (practiceId) => records.find((record) => record.practice_id === practiceId) || {}
  const attendance = records.filter((record) => record.attendance)
  const present = attendance.filter((record) => record.attendance === 'P' || record.attendance === 'L').length
  const evaluations = records.filter((record) => record.evaluation)
  const apto = evaluations.filter((record) => record.evaluation === 'Apto').length
  const attendanceRate = attendance.length ? Math.round((present / attendance.length) * 100) : 0
  const aptitudeRate = evaluations.length ? Math.round((apto / evaluations.length) * 100) : 0

  return <div className="space-y-5">
    <section className="rounded-lg bg-gradient-to-r from-[#0a2540] to-[#1e88e5] p-6 text-white"><p className="text-xs font-semibold uppercase text-blue-100">Mi formación</p><h2 className="mt-2 text-2xl font-bold">{student.name}</h2><p className="mt-1 text-sm text-blue-100">Alumno {student.student_number} · {student.group_name || 'Sin grupo'} · Promoción {student.promo || '—'}</p></section>
    <section className="grid grid-cols-2 gap-3 md:grid-cols-4">{[['Módulos', modules.length], ['Prácticas', practices.length], ['Asistencia', `${attendanceRate}%`], ['Aptos', `${aptitudeRate}%`]].map(([label, value]) => <div key={label} className={cardClass}><p className="text-xs uppercase text-[#6b7280]">{label}</p><p className="mt-2 text-2xl font-bold text-[#0a2540]">{value}</p></div>)}</section>
    <section className={cardClass}><h3 className="mb-4 font-bold text-[#0a2540]">Mis módulos</h3><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{modules.map((module) => <article key={module.id} className="rounded-md border border-[#e5e7eb] border-t-4 border-t-[#1e88e5] p-4"><p className="text-xs font-bold text-[#6b7280]">{module.id}</p><h4 className="mt-1 font-bold text-[#0a2540]">{module.name}</h4><p className="mt-1 text-sm text-[#6b7280]">{module.description || 'Sin descripción'}</p></article>)}</div></section>
    <section className={`${cardClass} overflow-x-auto`}><h3 className="mb-4 font-bold text-[#0a2540]">Historial de prácticas</h3><table className="w-full min-w-[700px] text-left text-sm"><thead className="bg-[#0a2540] text-xs uppercase text-white"><tr>{['Fecha', 'Hora', 'Módulo', 'Práctica', 'Asistencia', 'Evaluación'].map((label) => <th key={label} className="p-3">{label}</th>)}</tr></thead><tbody>{practices.map((practice) => { const record = recordFor(practice.id); return <tr key={practice.id} className="border-b border-[#e5e7eb]"><td className="p-3">{practice.date ? new Date(`${practice.date}T00:00:00`).toLocaleDateString('es-ES') : '—'}</td><td className="p-3">{practice.start_time || '—'}</td><td className="p-3">{practice.module_id}</td><td className="p-3">{practice.title}</td><td className="p-3">{({ P: 'Presente', L: 'Tarde', A: 'Falta' })[record.attendance] || 'Pendiente'}</td><td className="p-3">{record.evaluation || 'Pendiente'}</td></tr>})}</tbody></table>{practices.length === 0 && <p className="mt-4 text-center text-sm text-[#6b7280]">No hay prácticas asignadas.</p>}</section>
  </div>
}

const backupTables = {
  modules: 'id',
  students: 'id',
  student_profiles: 'student_id',
  student_modules: 'student_id,module_id',
  teacher_modules: 'profile_id,module_id',
  practices: 'id',
  aircraft: 'id',
  videos: 'id',
  tlbs: 'id',
  defects: 'id',
  practice_records: 'student_id,practice_id',
}

const resetKeys = {
  student_profiles: 'student_id',
  student_modules: 'student_id',
  teacher_modules: 'profile_id',
  practice_records: 'student_id',
  tlbs: 'id',
  defects: 'id',
  practices: 'id',
  students: 'id',
  modules: 'id',
  aircraft: 'id',
  videos: 'id',
}

async function insertMissingRows(table, key, rows) {
  const { data: existing, error: queryError } = await supabase.from(table).select(key)
  if (queryError) throw new Error(`${table}: ${queryError.message}`)
  const existingKeys = new Set((existing || []).map((row) => String(row[key])))
  const missing = rows.filter((row) => !existingKeys.has(String(row[key])))
  if (!missing.length) return []
  const { data, error: insertError } = await supabase.from(table).insert(missing).select('*')
  if (insertError) throw new Error(`${table}: ${insertError.message}`)
  return data || []
}

export function SettingsPage({ user }) {
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  async function loadStarterData() {
    setBusy(true)
    setMessage('')
    try {
      const requiredTables = ['modules', 'students', 'practices', 'aircraft', 'videos']
      for (const table of requiredTables) {
        const { error } = await supabase.from(table).select('*').limit(0)
        if (error) throw new Error(`${table}: ${error.message}`)
      }

      const modulesInserted = await insertMissingRows('modules', 'id', starterModules)
      const studentRows = starterStudents.map((student) => ({
        student_number: student.id,
        name: student.name,
        group_name: student.group,
        promo: student.promo,
      }))
      const studentsInserted = await insertMissingRows('students', 'student_number', studentRows)
      const { data: allStudents, error: studentsError } = await supabase.from('students').select('id,student_number')
      if (studentsError) throw new Error(`students: ${studentsError.message}`)

      const studentIds = new Map((allStudents || []).map((student) => [String(student.student_number), String(student.id)]))
      let membershipsToInsert = []
      let assignmentsNotice = ''
      const { data: currentMemberships, error: membershipsError } = await supabase.from('student_modules').select('student_id,module_id')
      if (membershipsError && isMissingTable(membershipsError)) {
        assignmentsNotice = ' Para matrículas y asistencia, aplica primero la migración de Supabase.'
      } else if (membershipsError) {
        throw new Error(`student_modules: ${membershipsError.message}`)
      } else {
        const existingMemberships = new Set((currentMemberships || []).map((row) => `${row.student_id}:${row.module_id}`))
        membershipsToInsert = starterStudents
          .map((student) => ({ student_id: studentIds.get(String(student.id)), module_id: 'M11' }))
          .filter((row) => row.student_id && !existingMemberships.has(`${row.student_id}:${row.module_id}`))
        if (membershipsToInsert.length) {
          const { error } = await supabase.from('student_modules').insert(membershipsToInsert)
          if (error) throw new Error(`student_modules: ${error.message}`)
        }
      }

      const practiceRows = starterPractices.map((practice) => ({
        id: practice.id,
        module_id: practice.moduleId,
        ata: practice.ata,
        title: practice.title,
        detail: practice.detail,
        date: practice.date,
        start_time: practice.startTime,
        hours: practice.hours,
      }))
      const practicesInserted = await insertMissingRows('practices', 'id', practiceRows)
      const aircraftInserted = await insertMissingRows('aircraft', 'registration', starterAircraft)
      const videoRows = starterVideos.map((video) => ({
        module_id: video.moduleId,
        ata: video.ata,
        title: video.title,
        youtube_url: video.url,
      }))
      const videosInserted = await insertMissingRows('videos', 'youtube_url', videoRows)

      setMessage(`Datos cargados: ${modulesInserted.length} módulos, ${studentsInserted.length} alumnos, ${membershipsToInsert.length} matrículas, ${practicesInserted.length} prácticas, ${aircraftInserted.length} aviones y ${videosInserted.length} vídeos nuevos. No se modificaron filas existentes ni se crearon cuentas.${assignmentsNotice}`)
    } catch (seedError) {
      setMessage(seedError.message || 'No se pudieron cargar los datos iniciales.')
    } finally {
      setBusy(false)
    }
  }

  async function exportBackup() {
    setBusy(true)
    const backup = { version: 1, exportedAt: new Date().toISOString(), tables: {} }
    for (const table of Object.keys(backupTables)) {
      const { data, error } = await supabase.from(table).select('*')
      if (error) { setMessage(`${table}: ${error.message}`); setBusy(false); return }
      backup.tables[table] = data || []
    }
    const link = document.createElement('a')
    link.href = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' }))
    link.download = `backup_easa_${new Date().toISOString().slice(0, 10)}.json`
    link.click()
    URL.revokeObjectURL(link.href)
    setBusy(false)
    setMessage('Backup exportado. No incluye contraseñas ni usuarios de Auth.')
  }

  async function importBackup(event) {
    const file = event.target.files?.[0]
    if (!file) return
    setBusy(true)
    setMessage('')
    try {
      const backup = JSON.parse(await file.text())
      if (backup.version !== 1 || !backup.tables || typeof backup.tables !== 'object') throw new Error('Formato de backup no reconocido.')
      const { data: importResult, error: importError } = await supabase.rpc('admin_import_academic_backup', { p_tables: backup.tables })
      if (importError) throw new Error(getSupabaseErrorMessage(importError))
      const inserted = Object.values(importResult || {}).reduce((total, count) => total + Number(count || 0), 0)
      setMessage(`Importación transaccional completada: ${inserted} filas nuevas. Las filas existentes no se sobrescribieron.`)
    } catch (importError) {
      setMessage(importError.message || 'No se pudo importar el backup.')
    } finally {
      setBusy(false)
      event.target.value = ''
    }
  }

  async function resetData() {
    const phrase = window.prompt('Esto eliminará los datos académicos de Supabase, pero conservará cuentas y perfiles. Escribe BORRAR para continuar.')
    if (phrase !== 'BORRAR') return
    setBusy(true)
    const order = ['defects', 'practice_records', 'student_modules', 'teacher_modules', 'student_profiles', 'tlbs', 'practices', 'students', 'modules', 'aircraft', 'videos']
    for (const table of order) {
      const { error } = await supabase.from(table).delete().not(resetKeys[table], 'is', null)
      if (error) { setMessage(`${table}: ${error.message}`); setBusy(false); return }
    }
    setBusy(false)
    setMessage('Datos académicos eliminados. Las cuentas siguen intactas.')
  }

  if (user.role !== 'admin') return <Notice error>Solo administración puede acceder a configuración.</Notice>
  return <div className="space-y-5">
    <section className={cardClass}><h2 className="text-lg font-bold text-[#0a2540]">Datos iniciales</h2><p className="mt-2 text-sm text-[#6b7280]">Carga los módulos, alumnos, prácticas, vídeos y aeronaves de ejemplo que ya están en el proyecto. Solo añade registros que falten; no modifica ni elimina datos existentes.</p><button className={`${primaryButton} mt-4`} disabled={busy} onClick={loadStarterData}>{busy ? 'Comprobando y cargando…' : 'Cargar datos iniciales en Supabase'}</button></section>
    <section className={cardClass}><h2 className="text-lg font-bold text-[#0a2540]">Configuración y copias de seguridad</h2><p className="mt-2 text-sm text-[#6b7280]">Las copias excluyen credenciales; la importación hace upsert y no elimina filas ausentes.</p>
      <div className="mt-5 flex flex-wrap gap-3"><button className={primaryButton} disabled={busy} onClick={exportBackup}>{busy ? 'Procesando…' : 'Exportar backup'}</button><label className={`${secondaryButton} cursor-pointer`}>Importar backup<input className="sr-only" type="file" accept="application/json,.json" disabled={busy} onChange={importBackup} /></label><button className="rounded bg-red-700 px-4 py-2 text-sm font-semibold text-white hover:bg-red-800 disabled:opacity-50" disabled={busy} onClick={resetData}>Resetear datos académicos</button></div>
      {message && <div className="mt-4"><Notice>{message}</Notice></div>}
    </section>
    <section className={cardClass}><h2 className="text-lg font-bold text-[#0a2540]">Datos y acceso</h2><dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2"><div><dt className="text-[#6b7280]">Estándar</dt><dd className="font-semibold">EASA Part 66</dd></div><div><dt className="text-[#6b7280]">Persistencia</dt><dd className="font-semibold">Supabase</dd></div><div><dt className="text-[#6b7280]">Cuenta</dt><dd className="font-semibold">{user.email}</dd></div><div><dt className="text-[#6b7280]">Rol</dt><dd className="font-semibold capitalize">{user.role}</dd></div></dl></section>
  </div>
}