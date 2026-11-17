import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { fetchSchoolModuleIds, useSchool } from '../contexts/useSchool.js'
import { subscribeToTables } from '../lib/supabaseRealtime.js'
import { aircraft as starterAircraft } from '../data/aircraft.js'
import { modules as starterModules } from '../data/modules.js'
import { practices as starterPractices } from '../data/practices.js'
import { students as starterStudents } from '../data/students.js'
import { videos as starterVideos } from '../data/videos.js'
import { getSupabaseErrorMessage } from '../lib/supabaseErrors.js'
import { downloadBlob, downloadCsv } from '../lib/download.js'
import { ROLES, isManager, teachesLikeProfessor } from '../lib/roles.js'
import Icon from './Icon.jsx'

/* ------------------------------------------------------------------ */
/* Constantes                                                          */
/* ------------------------------------------------------------------ */

const STARTER_MODULE_ID = 'M11'
const MAX_COLOR = 18
const PAGE_SIZE = 1000

const cardClass = 'card p-5 md:p-6'
const inputClass = 'input'
const primaryButton = 'btn-primary'
const secondaryButton = 'btn-secondary'

/* ------------------------------------------------------------------ */
/* Utilidades                                                          */
/* ------------------------------------------------------------------ */

/**
 * Lee TODAS las filas de una tabla paginando (Supabase devuelve 1000 como máximo por petición).
 * orderCols: columnas para ordenar de forma estable entre páginas.
 * applyFilters: función opcional para añadir filtros (.eq, .in, ...).
 */
async function fetchAll(table, columns = '*', orderCols = ['id'], applyFilters = (query) => query) {
  const all = []
  let from = 0
  for (;;) {
    let query = applyFilters(supabase.from(table).select(columns))
    orderCols.forEach((column) => { query = query.order(column, { ascending: true }) })
    const { data, error } = await query.range(from, from + PAGE_SIZE - 1)
    if (error) throw error
    const page = data || []
    all.push(...page)
    if (page.length < PAGE_SIZE) break
    from += PAGE_SIZE
  }
  return all
}

const errorText = getSupabaseErrorMessage

function useNotice() {
  const [notice, setNotice] = useState(null)
  const notify = useCallback((text, error = false) => setNotice(text ? { text, error } : null), [])
  return [notice, notify]
}

/* ------------------------------------------------------------------ */
/* Hook de datos                                                       */
/* ------------------------------------------------------------------ */

// scope: { column, value } filtra en la base de datos (p. ej. la escuela elegida por el admin); null = todo lo que permite la RLS
function useRows(table, columns = '*', scope = null) {
  const scopeColumn = scope?.value ? scope.column : null
  const scopeValue = scope?.value || null
  const channelId = useId()
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const mountedRef = useRef(true)
  const requestRef = useRef(0)

  const load = useCallback(async (showLoading = false) => {
    const requestId = ++requestRef.current
    if (showLoading) setLoading(true)
    // Se ordena solo por columnas propias (no por las de tablas relacionadas como «practices!inner(school_id)»)
    const orderCols = columns === '*' ? ['id'] : columns.split(',').map((column) => column.trim()).filter((column) => /^\w+$/.test(column))
    try {
      const data = await fetchAll(table, columns, orderCols, (query) => (scopeColumn ? query.eq(scopeColumn, scopeValue) : query))
      if (!mountedRef.current || requestId !== requestRef.current) return
      setRows(data)
      setError('')
    } catch (queryError) {
      if (!mountedRef.current || requestId !== requestRef.current) return
      setError(queryError.message || 'Error al cargar datos.')
    } finally {
      if (mountedRef.current && requestId === requestRef.current) setLoading(false)
    }
  }, [table, columns, scopeColumn, scopeValue])

  useEffect(() => {
    mountedRef.current = true
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carga inicial: el setState ocurre tras el await
    load(false)
    const unsubscribe = subscribeToTables([table], () => load(false), `${table}-updates-${channelId}`)
    return () => {
      mountedRef.current = false
      unsubscribe()
    }
  }, [table, columns, load, channelId])

  const reload = useCallback(() => load(true), [load])
  return { rows, setRows, loading, error, reload }
}

/* ------------------------------------------------------------------ */
/* Componentes comunes                                                 */
/* ------------------------------------------------------------------ */

function Notice({ children, error = false }) {
  return <p role={error ? 'alert' : 'status'} className={error ? 'notice-error' : 'notice'}>{children}</p>
}

function NoticeBar({ notice }) {
  return notice ? <Notice error={notice.error}>{notice.text}</Notice> : null
}

function Dialog({ title, onClose, children }) {
  const ref = useRef(null)

  useEffect(() => {
    ref.current?.focus()
    function onKeyDown(event) { if (event.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  // No se cierra al hacer clic fuera, para no perder formularios a medias.
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/25 p-0 backdrop-blur-[2px] sm:items-center sm:p-4">
      <section ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label={title} className="fade-in max-h-[92vh] w-full max-w-xl overflow-y-auto rounded-t-2xl bg-surface shadow-lift outline-none sm:rounded-2xl">
        <header className="flex items-center justify-between px-6 pb-2 pt-5">
          <h2 className="text-lg font-semibold text-ink">{title}</h2>
          <button type="button" className="-mr-2 rounded-lg p-2 text-muted hover:bg-subtle hover:text-ink" aria-label="Cerrar" onClick={onClose}><Icon name="x" /></button>
        </header>
        <div className="space-y-4 px-6 pb-6 pt-2">{children}</div>
      </section>
    </div>
  )
}

function FormField({ label, value, onChange, type = 'text', required = false, disabled = false, min, max }) {
  return (
    <label className="field">
      {label}
      <input className={inputClass} type={type} value={value} min={min} max={max} disabled={disabled} onChange={(event) => onChange(event.target.value)} required={required} />
    </label>
  )
}

function ErrorOrLoading({ loading, error }) {
  if (loading) return <Notice>Cargando datos…</Notice>
  if (error) return <Notice error>{error}</Notice>
  return null
}

/* ------------------------------------------------------------------ */
/* Módulos                                                             */
/* ------------------------------------------------------------------ */

export function ModulesPage({ user, onOpenModule }) {
  const { rows: modules, loading, error, reload } = useRows('modules', 'id,name,description,color,school_id')
  const { rows: teacherAssignments } = useRows('teacher_modules', 'profile_id,module_id')
  const { rows: studentAssignments } = useRows('student_modules', 'student_id,module_id')
  const { rows: studentProfiles } = useRows('student_profiles', 'student_id,profile_id')
  const [editing, setEditing] = useState(null)
  const [formOpen, setFormOpen] = useState(false)
  const [form, setForm] = useState({ id: '', name: '', description: '', color: 1 })
  const [notice, notify] = useNotice()
  const [busy, setBusy] = useState(false)
  const isAdmin = user.role === ROLES.ADMIN
  const isSupervisor = user.role === ROLES.SUPERVISOR
  // El supervisor crea módulos propios de su escuela; el admin, de la escuela elegida o, sin escuela, del catálogo EASA
  const canCreate = isManager(user.role)
  const { schoolId: ownSchoolId, filterId } = useSchool()
  const schoolId = isSupervisor ? ownSchoolId : filterId
  const [schoolModuleIds, setSchoolModuleIds] = useState(null)
  const closeForm = useCallback(() => setFormOpen(false), [])
  const { rows: practices } = useRows('practices', 'id,module_id,hours,school_id', { column: 'school_id', value: filterId })

  // Admin con una escuela elegida: solo los módulos que usa esa escuela
  useEffect(() => {
    if (!filterId) return undefined
    let active = true
    fetchSchoolModuleIds(filterId)
      .then((ids) => { if (active) setSchoolModuleIds(ids) })
      .catch(() => { if (active) setSchoolModuleIds([]) })
    return () => { active = false }
  }, [filterId, modules])

  const ownStudentId = studentProfiles.find((entry) => entry.profile_id === user.id)?.student_id
  const assignedModuleIds = user.role === ROLES.TEACHER
    ? teacherAssignments.filter((entry) => entry.profile_id === user.id).map((entry) => entry.module_id)
    : user.role === ROLES.STUDENT
      ? studentAssignments.filter((entry) => String(entry.student_id) === String(ownStudentId)).map((entry) => entry.module_id)
      : filterId ? schoolModuleIds || [] : modules.map((mod) => mod.id)
  const visibleModules = modules.filter((mod) => assignedModuleIds.includes(mod.id))
  const teaches = (mod) => teacherAssignments.some((entry) => entry.profile_id === user.id && entry.module_id === mod.id)
  // Catálogo EASA: solo el admin. Módulo de escuela: su supervisor o un profesor que lo imparte.
  const canEditModule = (mod) => isAdmin || (Boolean(mod.school_id) && (isSupervisor || (teachesLikeProfessor(user.role) && teaches(mod))))
  const canDeleteModule = (mod) => isAdmin || (Boolean(mod.school_id) && isSupervisor)

  function openForm(mod = null) {
    setEditing(mod)
    setFormOpen(true)
    setForm(mod ? { ...mod } : { id: '', name: '', description: '', color: (modules.length % MAX_COLOR) + 1 })
    notify('')
  }

  async function saveModule(event) {
    event.preventDefault()
    const color = Math.min(MAX_COLOR, Math.max(1, Math.round(Number(form.color)) || 1))
    const payload = { id: form.id.trim(), name: form.name.trim(), description: form.description?.trim() || '', color }
    setBusy(true)
    try {
      const result = editing
        ? await supabase.rpc('update_module_content', { p_module_id: editing.id, p_name: payload.name, p_description: payload.description, p_color: color })
        : await supabase.from('modules').insert(schoolId ? { ...payload, school_id: schoolId } : payload)
      if (result.error) {
        notify(result.error.code === '23505' ? 'Ese código ya existe. Usa otro (por ejemplo, añade las siglas de tu escuela).' : errorText(result.error), true)
        return
      }
      setEditing(null)
      setFormOpen(false)
      notify('Módulo guardado.')
      await reload()
    } finally {
      setBusy(false)
    }
  }

  async function deleteModule(mod) {
    if (!window.confirm(`¿Eliminar el módulo ${mod.id}?`)) return
    // Todo ocurre en una única transacción en la base de datos (ver migración SQL).
    const { data, error: rpcError } = await supabase.rpc('admin_delete_module', { p_module_id: mod.id })
    if (rpcError) { notify(errorText(rpcError), true); return }
    if (!data?.deleted) { notify(data?.reason || 'No se pudo eliminar el módulo.', true); return }
    notify('Módulo eliminado.')
    await reload()
  }

  return (
    <div className="space-y-5">
      <div className="page-intro">
        <div>
          <h2>{user.role === ROLES.STUDENT ? 'Mis módulos' : 'Módulos Part-66'}</h2>
          <p>{visibleModules.length} {visibleModules.length === 1 ? 'módulo' : 'módulos'}</p>
        </div>
        {canCreate && <button className={primaryButton} onClick={() => openForm()} disabled={isSupervisor && !schoolId}><Icon name="plus" size={16} />{schoolId ? 'Nuevo módulo de la escuela' : 'Nuevo módulo EASA'}</button>}
      </div>
      <ErrorOrLoading loading={loading} error={error} />
      {!formOpen && <NoticeBar notice={notice} />}
      {!loading && !error && visibleModules.length === 0 && (
        <div className="card empty">{canCreate ? 'Aún no hay módulos. Crea el primero.' : 'Todavía no tienes módulos asignados. Administración te los asignará en breve.'}</div>
      )}
      <section>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {visibleModules.map((mod) => {
            const count = practices.filter((practice) => practice.module_id === mod.id).length
            const studentCount = studentAssignments.filter((entry) => entry.module_id === mod.id).length
            return (
              <article key={mod.id} className="card group flex flex-col transition-shadow hover:shadow-lift">
                <button className="flex-1 p-5 text-left" onClick={() => onOpenModule(mod.id)}>
                  <span className="badge bg-accent-soft text-accent-strong">{mod.id}</span>
                  {user.role !== ROLES.STUDENT && <span className="badge ml-1.5">{mod.school_id ? 'Escuela' : 'EASA'}</span>}
                  <h3 className="mt-3 font-semibold text-ink">{mod.name}</h3>
                  <p className="mt-1 line-clamp-2 text-sm text-muted">{mod.description || 'Sin descripción'}</p>
                </button>
                <div className="flex items-center gap-4 border-t border-line px-5 py-3 text-xs text-muted">
                  <span><strong className="font-semibold text-ink-soft">{count}</strong> {count === 1 ? 'práctica' : 'prácticas'}</span>
                  {user.role !== ROLES.STUDENT && <span><strong className="font-semibold text-ink-soft">{studentCount}</strong> {studentCount === 1 ? 'alumno' : 'alumnos'}</span>}
                  {canEditModule(mod) ? (
                    <span className="ml-auto flex gap-1">
                      <button className="rounded-lg p-1.5 hover:bg-subtle hover:text-ink" aria-label={`Editar ${mod.id}`} onClick={() => openForm(mod)}><Icon name="edit" size={16} /></button>
                      {canDeleteModule(mod) && <button className="rounded-lg p-1.5 hover:bg-danger-soft hover:text-danger" aria-label={`Eliminar ${mod.id}`} onClick={() => deleteModule(mod)}><Icon name="trash" size={16} /></button>}
                    </span>
                  ) : <Icon name="next" size={16} className="ml-auto text-faint transition-colors group-hover:text-accent" />}
                </div>
              </article>
            )
          })}
        </div>
      </section>
      {formOpen && (
        <Dialog title={editing ? `Editar módulo ${editing.id}` : 'Nuevo módulo'} onClose={closeForm}>
          <form className="space-y-4" onSubmit={saveModule}>
            <FormField label="Código" value={form.id} onChange={(id) => setForm({ ...form, id })} required disabled={Boolean(editing)} />
            <FormField label="Nombre" value={form.name} onChange={(name) => setForm({ ...form, name })} required />
            <FormField label="Descripción" value={form.description || ''} onChange={(description) => setForm({ ...form, description })} />
            <FormField label={`Color (1-${MAX_COLOR})`} type="number" min={1} max={MAX_COLOR} value={form.color} onChange={(color) => setForm({ ...form, color })} />
            <NoticeBar notice={notice} />
            <div className="flex justify-end gap-2"><button type="button" className={secondaryButton} onClick={closeForm}>Cancelar</button><button className={primaryButton} disabled={busy}>{busy ? 'Guardando…' : 'Guardar'}</button></div>
          </form>
        </Dialog>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Asignaciones                                                        */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/* Aviones                                                             */
/* ------------------------------------------------------------------ */

const EMPTY_AIRCRAFT = { type: '', registration: '', msn: '', engines: '', seats: '', category: 'Narrow Body' }

export function AircraftPage({ user }) {
  const { filterId } = useSchool()
  // Cada escuela tiene sus aviones; el admin ve los de la escuela elegida (filtrado en la base de datos)
  const { rows: aircraft, loading, error, reload } = useRows('aircraft', 'id,type,registration,msn,engines,seats,category,school_id', { column: 'school_id', value: filterId })
  const [editing, setEditing] = useState(null)
  const [formOpen, setFormOpen] = useState(false)
  const [form, setForm] = useState(EMPTY_AIRCRAFT)
  const [notice, notify] = useNotice()
  const [busy, setBusy] = useState(false)
  const canEdit = isManager(user.role)
  const closeForm = useCallback(() => setFormOpen(false), [])

  function openForm(item = null) {
    setEditing(item)
    setFormOpen(true)
    setForm(item ? { ...item, seats: item.seats ?? '' } : EMPTY_AIRCRAFT)
    notify('')
  }

  async function save(event) {
    event.preventDefault()
    const payload = {
      type: form.type.trim(),
      registration: form.registration.trim(),
      msn: form.msn?.trim() || null,
      engines: form.engines?.trim() || null,
      seats: form.seats === '' || form.seats == null ? null : Number(form.seats),
      category: form.category || null,
    }
    if (!editing && filterId) payload.school_id = filterId
    setBusy(true)
    try {
      const result = editing
        ? await supabase.from('aircraft').update(payload).eq('id', editing.id)
        : await supabase.from('aircraft').insert(payload)
      if (result.error) notify(errorText(result.error), true) // se muestra dentro del diálogo
      else { setEditing(null); setFormOpen(false); notify('Avión guardado.'); await reload() }
    } finally {
      setBusy(false)
    }
  }

  async function remove(item) {
    if (!window.confirm(`¿Eliminar ${item.type} (${item.registration})?`)) return
    const { error: deleteError } = await supabase.from('aircraft').delete().eq('id', item.id)
    if (deleteError) notify(errorText(deleteError), true)
    else { notify('Avión eliminado.'); await reload() }
  }

  return (
    <div className="space-y-5">
      <section className="space-y-5">
        <div className="page-intro"><div><h2>Aviones</h2><p>{aircraft.length} {aircraft.length === 1 ? 'aeronave' : 'aeronaves'} para prácticas y TLB</p></div>{canEdit && <button className={primaryButton} onClick={() => openForm()}><Icon name="plus" size={16} />Nuevo avión</button>}</div>
        <ErrorOrLoading loading={loading} error={error} />
        {!formOpen && <NoticeBar notice={notice} />}
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {aircraft.map((item) => <article key={item.id} className="card p-5">
            <div className="flex items-start justify-between gap-2"><div><span className="badge">{item.category || 'Aeronave'}</span><h3 className="mt-2.5 text-lg font-semibold text-ink">{item.type}</h3></div>{canEdit && <div className="flex gap-1 text-muted"><button className="rounded-lg p-1.5 hover:bg-subtle hover:text-ink" aria-label={`Editar ${item.type}`} onClick={() => openForm(item)}><Icon name="edit" size={16} /></button><button className="rounded-lg p-1.5 hover:bg-danger-soft hover:text-danger" aria-label={`Eliminar ${item.type}`} onClick={() => remove(item)}><Icon name="trash" size={16} /></button></div>}</div>
            <dl className="mt-4 grid grid-cols-2 gap-2 text-sm">{[['Matrícula', item.registration], ['MSN', item.msn], ['Motor', item.engines], ['Asientos', item.seats]].map(([label, value]) => <div key={label} className="stat py-2"><dt>{label}</dt><dd className="!text-sm">{value || '—'}</dd></div>)}</dl>
          </article>)}
        </div>
      </section>
      {formOpen && <Dialog title={editing ? 'Editar avión' : 'Nuevo avión'} onClose={closeForm}><form className="space-y-4" onSubmit={save}>
        <FormField label="Tipo" value={form.type} onChange={(type) => setForm({ ...form, type })} required />
        <FormField label="Matrícula" value={form.registration} onChange={(registration) => setForm({ ...form, registration })} required />
        <FormField label="MSN" value={form.msn || ''} onChange={(msn) => setForm({ ...form, msn })} />
        <FormField label="Motores" value={form.engines || ''} onChange={(engines) => setForm({ ...form, engines })} />
        <FormField label="Asientos" type="number" min={0} value={form.seats} onChange={(seats) => setForm({ ...form, seats })} />
        <label className="field">Categoría<select className={inputClass} value={form.category || ''} onChange={(event) => setForm({ ...form, category: event.target.value })}>{['Light Jet', 'Narrow Body', 'Wide Body', 'Regional'].map((item) => <option key={item}>{item}</option>)}</select></label>
        <NoticeBar notice={notice} />
        <div className="flex justify-end gap-2"><button type="button" className={secondaryButton} onClick={closeForm}>Cancelar</button><button className={primaryButton} disabled={busy}>{busy ? 'Guardando…' : 'Guardar'}</button></div>
      </form></Dialog>}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Informes                                                            */
/* ------------------------------------------------------------------ */

const percent = (part, total) => (total ? Math.round((part / total) * 100) : 0)

export function ReportsPage() {
  const { filterId } = useSchool()
  // Admin con una escuela elegida: solo sus alumnos, prácticas y registros (filtrado en la base de datos)
  const { rows: students, loading: studentsLoading, error: studentsError } = useRows('students', 'id,name,group_name,promo,school_id', { column: 'school_id', value: filterId })
  const { rows: practices, loading: practicesLoading } = useRows('practices', 'id,module_id,title,school_id', { column: 'school_id', value: filterId })
  const { rows: memberships, loading: membershipsLoading } = useRows('student_modules', filterId ? 'student_id,module_id,students!inner(school_id)' : 'student_id,module_id', { column: 'students.school_id', value: filterId })
  const { rows: records, loading: recordsLoading, error: recordsError } = useRows('practice_records', filterId ? 'student_id,practice_id,attendance,evaluation,practices!inner(school_id)' : 'student_id,practice_id,attendance,evaluation', { column: 'practices.school_id', value: filterId })
  const [promo, setPromo] = useState('')
  const [group, setGroup] = useState('')
  const promos = useMemo(() => [...new Set(students.map((student) => String(student.promo || '')).filter(Boolean))].sort(), [students])
  const groups = useMemo(() => [...new Set(students.map((student) => student.group_name).filter(Boolean))].sort(), [students])

  const report = useMemo(() => {
    const modulesByStudent = new Map()
    memberships.forEach((entry) => {
      const key = String(entry.student_id)
      if (!modulesByStudent.has(key)) modulesByStudent.set(key, new Set())
      modulesByStudent.get(key).add(entry.module_id)
    })
    const practiceCountByModule = new Map()
    const moduleByPractice = new Map()
    practices.forEach((practice) => {
      practiceCountByModule.set(practice.module_id, (practiceCountByModule.get(practice.module_id) || 0) + 1)
      moduleByPractice.set(String(practice.id), practice.module_id)
    })
    const recordsByStudent = new Map()
    records.forEach((record) => {
      const key = String(record.student_id)
      if (!recordsByStudent.has(key)) recordsByStudent.set(key, [])
      recordsByStudent.get(key).push(record)
    })

    return students
      .filter((student) => (!promo || String(student.promo || '') === promo) && (!group || student.group_name === group))
      .map((student) => {
        const key = String(student.id)
        const moduleIds = modulesByStudent.get(key) || new Set()
        const relevantCount = [...moduleIds].reduce((total, id) => total + (practiceCountByModule.get(id) || 0), 0)
        // Solo cuentan los registros de prácticas de módulos en los que el alumno está matriculado.
        const studentRecords = (recordsByStudent.get(key) || []).filter((record) => moduleIds.has(moduleByPractice.get(String(record.practice_id))))
        const present = studentRecords.filter((record) => record.attendance === 'P').length
        const late = studentRecords.filter((record) => record.attendance === 'L').length
        const absent = studentRecords.filter((record) => record.attendance === 'A').length
        const evaluated = studentRecords.filter((record) => record.evaluation).length
        const apto = studentRecords.filter((record) => record.evaluation === 'Apto').length
        return {
          ...student, relevantCount, present, late, absent, apto, evaluated,
          attendanceRate: percent(present + late, present + late + absent),
          aptitudeRate: percent(apto, evaluated),
        }
      })
  }, [students, practices, memberships, records, promo, group])

  const classReports = useMemo(() => {
    const classes = new Map()
    report.forEach((student) => {
      const key = `${student.group_name || 'Sin clase'} · ${student.promo || 'Sin promoción'}`
      const current = classes.get(key) || { key, group: student.group_name || 'Sin clase', promo: student.promo || '—', students: 0, present: 0, late: 0, absent: 0, apto: 0, evaluated: 0 }
      current.students += 1
      current.present += student.present
      current.late += student.late
      current.absent += student.absent
      current.apto += student.apto
      current.evaluated += student.evaluated
      classes.set(key, current)
    })
    return [...classes.values()].map((item) => ({
      ...item,
      attendanceRate: percent(item.present + item.late, item.present + item.late + item.absent),
      aptitudeRate: percent(item.apto, item.evaluated),
    }))
  }, [report])

  function exportCsv() {
    const header = ['Nombre', 'Grupo', 'Promoción', 'Prácticas', 'Presente', 'Tarde', 'Falta', 'Aptos', '% Asistencia', '% Aptos']
    const rows = [header, ...report.map((student) => [student.name, student.group_name, student.promo, student.relevantCount, student.present, student.late, student.absent, student.apto, `${student.attendanceRate}%`, `${student.aptitudeRate}%`])]
    downloadCsv(rows, 'informe_easa.csv')
  }

  const loading = studentsLoading || practicesLoading || membershipsLoading || recordsLoading
  const classHeaders = ['Clase', 'Promoción', 'Alumnos', 'P', 'T', 'F', 'Aptos', '% Asistencia', '% Aptos']
  const studentHeaders = ['Alumno', 'Grupo', 'Promoción', 'Prácticas', 'P', 'T', 'F', 'Aptos', '% Asistencia', '% Aptos']

  return <div className="space-y-5"><div className="page-intro"><div><h2>Informes</h2><p>Asistencia y evaluación por clase y por alumno.</p></div></div><section className={cardClass}>
    <div className="mb-6 flex flex-wrap items-end justify-end gap-3">
      <div className="flex flex-wrap gap-2">
        <select className={`${inputClass} min-w-36`} value={group} onChange={(event) => setGroup(event.target.value)}><option value="">Todas las clases</option>{groups.map((item) => <option key={item}>{item}</option>)}</select>
        <select className={`${inputClass} min-w-40`} value={promo} onChange={(event) => setPromo(event.target.value)}><option value="">Todas las promociones</option>{promos.map((item) => <option key={item}>{item}</option>)}</select>
        <button className={secondaryButton} onClick={() => window.print()}>Imprimir</button>
        <button className={primaryButton} disabled={loading || Boolean(recordsError)} onClick={exportCsv}>Exportar CSV</button>
      </div>
    </div>
    <ErrorOrLoading loading={loading} error={studentsError || recordsError} />
    <h3 className="mb-2 text-sm font-semibold text-ink-soft">Resumen por clase</h3>
    <div className="mb-6 overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="bg-subtle text-xs text-muted"><tr>{classHeaders.map((label) => <th key={label} className="p-3">{label}</th>)}</tr></thead>
        <tbody>{classReports.map((item) => <tr key={item.key} className="border-b border-line">
          <td className="p-3 font-medium text-ink">{item.group}</td><td className="p-3">{item.promo}</td><td className="p-3">{item.students}</td>
          <td className="p-3">{item.present}</td><td className="p-3">{item.late}</td><td className="p-3">{item.absent}</td>
          <td className="p-3">{item.apto}/{item.evaluated}</td><td className="p-3">{item.attendanceRate}%</td><td className="p-3">{item.aptitudeRate}%</td>
        </tr>)}</tbody>
      </table>
      {classReports.length === 0 && <p className="p-4 text-center text-sm text-muted">No hay datos para estos filtros.</p>}
    </div>
    <h3 className="mb-2 text-sm font-semibold text-ink-soft">Detalle por alumno</h3>
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="bg-subtle text-xs text-muted"><tr>{studentHeaders.map((label) => <th key={label} className="p-3">{label}</th>)}</tr></thead>
        <tbody>{report.map((student) => <tr key={student.id} className="border-b border-line hover:bg-subtle">
          <td className="p-3 font-medium text-ink">{student.name}</td><td className="p-3">{student.group_name}</td><td className="p-3">{student.promo || '—'}</td>
          <td className="p-3">{student.relevantCount}</td><td className="p-3">{student.present}</td><td className="p-3">{student.late}</td><td className="p-3">{student.absent}</td>
          <td className="p-3">{student.apto}</td><td className="p-3">{student.attendanceRate}%</td><td className="p-3">{student.aptitudeRate}%</td>
        </tr>)}</tbody>
      </table>
    </div>
  </section></div>
}

/* ------------------------------------------------------------------ */
/* Configuración: datos iniciales, backup y reseteo                    */
/* ------------------------------------------------------------------ */

// tabla -> columnas para ordenar de forma estable al paginar
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
  defect_answers: 'defect_id',
  practice_records: 'student_id,practice_id',
  // Estructura académica: se exporta para archivo (la importación aún no la restaura)
  degrees: 'id',
  degree_modules: 'id',
  academic_years: 'id',
  cohorts: 'id',
  class_groups: 'id',
  enrollments: 'id',
  module_enrollments: 'id',
  teaching_assignments: 'id',
  schedule_slots: 'id',
  class_sessions: 'id',
  session_attendance: 'session_id,student_id',
}

async function insertMissingRows(table, key, rows) {
  const existing = await fetchAll(table, key, [key])
  const existingKeys = new Set(existing.map((row) => String(row[key])))
  const missing = rows.filter((row) => !existingKeys.has(String(row[key])))
  if (!missing.length) return []
  const { data, error: insertError } = await supabase.from(table).insert(missing).select('*')
  if (insertError) throw new Error(`${table}: ${insertError.message}`)
  return data || []
}

async function buildBackup() {
  const backup = { version: 1, exportedAt: new Date().toISOString(), tables: {} }
  for (const [table, order] of Object.entries(backupTables)) {
    try {
      backup.tables[table] = await fetchAll(table, '*', order.split(','))
    } catch (tableError) {
      throw new Error(`${table}: ${tableError.message}`, { cause: tableError })
    }
  }
  return backup
}

function downloadBackup(backup, prefix = 'backup_easa') {
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' })
  downloadBlob(blob, `${prefix}_${new Date().toISOString().slice(0, 10)}.json`)
}

export function SettingsPage({ user }) {
  const [notice, notify] = useNotice()
  const [busy, setBusy] = useState(false)

  async function loadStarterData() {
    setBusy(true)
    notify('')
    try {
      const requiredTables = ['modules', 'students', 'practices', 'aircraft', 'videos']
      for (const table of requiredTables) {
        const { error } = await supabase.from(table).select('*').limit(0)
        if (error) throw new Error(`${table}: ${error.message}`)
      }

      const modulesInserted = await insertMissingRows('modules', 'id', starterModules)
      // Alumnos de ejemplo: ficha y, después, su grupo, promoción y módulo en la estructura académica
      const studentRows = starterStudents.map((student) => ({ student_number: student.id, name: student.name }))
      const studentsInserted = await insertMissingRows('students', 'student_number', studentRows)
      let assignmentsNotice = ''
      const newNumbers = new Set(studentsInserted.map((row) => String(row.student_number)))
      for (const student of starterStudents.filter((item) => newNumbers.has(String(item.id)))) {
        const row = studentsInserted.find((item) => String(item.student_number) === String(student.id))
        const { error } = await supabase.rpc('admin_place_student', {
          p_student_id: row.id, p_class: null, p_group: student.group, p_promo: student.promo, p_module_ids: [STARTER_MODULE_ID],
        })
        if (error) { assignmentsNotice = ` Algún alumno no se pudo matricular: ${errorText(error)}`; break }
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

      notify(`Datos cargados: ${modulesInserted.length} módulos, ${studentsInserted.length} alumnos (con su grupo y módulo), ${practicesInserted.length} prácticas, ${aircraftInserted.length} aviones y ${videosInserted.length} vídeos nuevos. No se modificaron filas existentes ni se crearon cuentas.${assignmentsNotice}`)
    } catch (seedError) {
      notify(seedError.message || 'No se pudieron cargar los datos iniciales.', true)
    } finally {
      setBusy(false)
    }
  }

  async function exportBackup() {
    setBusy(true)
    notify('')
    try {
      downloadBackup(await buildBackup())
      notify('Backup completo exportado. No incluye contraseñas ni usuarios de Auth. Contiene datos personales de alumnos: guárdalo en un lugar seguro y no lo compartas.')
    } catch (backupError) {
      notify(backupError.message || 'No se pudo exportar el backup.', true)
    } finally {
      setBusy(false)
    }
  }

  async function importBackup(event) {
    const input = event.target
    const file = input.files?.[0]
    if (!file) return
    setBusy(true)
    notify('')
    try {
      const backup = JSON.parse(await file.text())
      if (backup.version !== 1 || !backup.tables || typeof backup.tables !== 'object') throw new Error('Formato de backup no reconocido.')
      const { data: importResult, error: importError } = await supabase.rpc('admin_import_academic_backup', { p_tables: backup.tables })
      if (importError) throw new Error(errorText(importError))
      const inserted = Object.values(importResult || {}).reduce((total, count) => total + Number(count || 0), 0)
      notify(`Importación transaccional completada: ${inserted} filas nuevas. Las filas existentes no se sobrescribieron.`)
    } catch (importError) {
      notify(importError.message || 'No se pudo importar el backup.', true)
    } finally {
      setBusy(false)
      input.value = ''
    }
  }

  async function resetData() {
    const phrase = window.prompt('Esto eliminará los datos académicos de Supabase, pero conservará cuentas y perfiles. Antes se descargará un backup automático. Escribe BORRAR para continuar.')
    if (phrase !== 'BORRAR') return
    setBusy(true)
    notify('')
    try {
      // 1) Backup automático: si falla, no se borra nada.
      downloadBackup(await buildBackup(), 'backup_antes_de_reset')
      // 2) Borrado en una única transacción (ver migración SQL).
      const { error } = await supabase.rpc('admin_reset_academic_data')
      if (error) throw new Error(errorText(error))
      notify('Datos académicos eliminados (se descargó un backup previo). Las cuentas siguen intactas.')
    } catch (resetError) {
      notify(`No se borró nada o la operación se revirtió: ${resetError.message}`, true)
    } finally {
      setBusy(false)
    }
  }

  if (user.role !== ROLES.ADMIN) return <Notice error>Solo administración puede acceder a configuración.</Notice>
  return <div className="space-y-5">
    <div className="page-intro"><div><h2>Configuración</h2><p>Datos iniciales, copias de seguridad y acceso.</p></div></div>
    <section className={cardClass}><h2 className="text-lg font-semibold text-ink">Datos iniciales</h2><p className="mt-2 text-sm text-muted">Carga los módulos, alumnos, prácticas, vídeos y aeronaves de ejemplo que ya están en el proyecto. Solo añade registros que falten; no modifica ni elimina datos existentes.</p><button className={`${primaryButton} mt-4`} disabled={busy} onClick={loadStarterData}>{busy ? 'Procesando…' : 'Cargar datos iniciales en Supabase'}</button></section>
    <section className={cardClass}><h2 className="text-lg font-semibold text-ink">Configuración y copias de seguridad</h2><p className="mt-2 text-sm text-muted">Las copias excluyen credenciales. La importación solo añade las filas que faltan: no elimina ni sobrescribe las existentes. El archivo contiene datos personales (RGPD): guárdalo cifrado o en un sitio de acceso restringido.</p>
      <div className="mt-5 flex flex-wrap gap-3"><button className={primaryButton} disabled={busy} onClick={exportBackup}>{busy ? 'Procesando…' : 'Exportar backup'}</button><label className={`${secondaryButton} cursor-pointer`}>Importar backup<input className="sr-only" type="file" accept="application/json,.json" disabled={busy} onChange={importBackup} /></label><button className="btn-danger sm:ml-auto" disabled={busy} onClick={resetData}>Resetear datos académicos</button></div>
      {notice && <div className="mt-4"><NoticeBar notice={notice} /></div>}
    </section>
    <section className={cardClass}><h2 className="text-lg font-semibold text-ink">Datos y acceso</h2><dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2"><div><dt className="text-muted">Estándar</dt><dd className="font-semibold">EASA Part-147 · Módulos Part-66</dd></div><div><dt className="text-muted">Persistencia</dt><dd className="font-semibold">Supabase</dd></div><div><dt className="text-muted">Cuenta</dt><dd className="font-semibold">{user.email}</dd></div><div><dt className="text-muted">Rol</dt><dd className="font-semibold capitalize">{user.role}</dd></div></dl></section>
  </div>
}