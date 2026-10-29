import { useEffect, useState, useMemo } from 'react'
import { supabase } from '../lib/supabase.js'
import { getSupabaseErrorMessage, isMissingTable } from '../lib/supabaseErrors.js'
import { subscribeToTables } from '../lib/supabaseRealtime.js'

const inputClass = 'w-full rounded border border-[#d1d5db] px-3 py-2 text-sm focus:border-[#1e88e5]'
const buttonClass = 'rounded bg-[#1e88e5] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1565c0] disabled:opacity-50'
const secondaryButton = 'rounded border border-[#d1d5db] bg-white px-4 py-2 text-sm font-semibold text-[#0a2540] hover:bg-[#f4f6f9]'

const CLASS_OPTIONS = ['1º', '2º', '3º', '4º']
const GROUP_OPTIONS = ['A', 'B', 'C', 'D', 'E', 'F']

const STUDENT_COLUMNS = 'id, student_number, name, class_name, group_name, promo, school_id'

function groupLetter(groupName) {
  const match = String(groupName || '').match(/([A-Za-z])\s*$/)
  return match ? match[1].toUpperCase() : ''
}

function studentClass(student) {
  if (student?.class_name) return student.class_name
  const match = String(student?.group_name || '').match(/^\s*(\d+)/)
  return match ? `${match[1]}º` : ''
}

async function getFunctionErrorMessage(error, fallback) {
  try {
    const body = await error.context.json()
    if (body?.error) return body.error
  } catch {
    // sin cuerpo
  }
  return fallback
}

export default function StudentList({ user }) {
  const [students, setStudents] = useState([])
  const [modules, setModules] = useState([])
  const [studentModules, setStudentModules] = useState([])
  const [records, setRecords] = useState([])
  const [practices, setPractices] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  
  const [search, setSearch] = useState('')
  const [promo, setPromo] = useState('')
  const [classFilter, setClassFilter] = useState('')
  const [groupFilter, setGroupFilter] = useState('')
  
  const [formOpen, setFormOpen] = useState(false)
  const [viewing, setViewing] = useState(null)
  const [editing, setEditing] = useState(null)
  const [busy, setBusy] = useState(false)
  const [unlocked, setUnlocked] = useState(false)
  const [unlockWarning, setUnlockWarning] = useState(false)
  const [confirmSave, setConfirmSave] = useState(false)
  const [sendInvite, setSendInvite] = useState(true)
  
  const [form, setForm] = useState({
    student_number: '', name: '', class_name: '', letter: '', promo: '', email: '', moduleIds: []
  })

  const isAdmin = user?.role === 'admin'
  const isTeacher = user?.role === 'profesor'

  async function fetchAll() {
    const [studentResult, moduleResult, membershipResult, recordResult, practiceResult] = await Promise.all([
      supabase.from('students').select(STUDENT_COLUMNS).order('name', { ascending: true }),
      supabase.from('modules').select('id, name'),
      supabase.from('student_modules').select('student_id, module_id'),
      // FIX CRÍTICO: Se añade 'practice_id' para que el modal "Ver" pueda cruzar los datos
      supabase.from('practice_records').select('practice_id, student_id, attendance, evaluation'),
      supabase.from('practices').select('id, module_id, title, date, start_time'),
    ])
    return { studentResult, moduleResult, membershipResult, recordResult, practiceResult }
  }

  function applyResults({ studentResult, moduleResult, membershipResult, recordResult, practiceResult }) {
    const requiredError = studentResult.error || moduleResult.error || practiceResult.error
    const optionalErrors = [membershipResult.error, recordResult.error].filter(Boolean)
    
    if (requiredError) {
      setError(requiredError.message)
    } else {
      setStudents(studentResult.data || [])
      setModules(moduleResult.data || [])
      setStudentModules(membershipResult.error ? [] : membershipResult.data || [])
      setRecords(recordResult.error ? [] : recordResult.data || [])
      setPractices(practiceResult.data || [])
      setError('')
      setMessage(optionalErrors.some(isMissingTable)
        ? 'La migración de asignaciones/asistencia aún no está aplicada. Puedes consultar los alumnos; matrículas e informes se activarán al aplicarla.'
        : optionalErrors[0]?.message || '')
    }
    setLoading(false)
  }

  async function reload() {
    setLoading(true)
    applyResults(await fetchAll())
  }

  useEffect(() => {
    let cancelled = false
    async function load() {
      const results = await fetchAll()
      if (!cancelled) applyResults(results)
    }
    load()
    const unsubscribe = subscribeToTables(['students', 'modules', 'student_modules', 'practice_records', 'practices'], load, 'student-list')
    return () => { cancelled = true; unsubscribe() }
  }, [])

  function closeForm() {
    setFormOpen(false)
    setUnlockWarning(false)
    setConfirmSave(false)
    setSendInvite(true)
  }

  function openForm(student = null) {
    setEditing(student)
    setForm({
      student_number: student?.student_number ?? '',
      name: student?.name ?? '',
      class_name: student ? studentClass(student) : '',
      letter: student ? groupLetter(student.group_name) : '',
      promo: student?.promo ?? '',
      email: '',
      // Se usa String() para asegurar compatibilidad con los tipos de la BD
      moduleIds: student ? studentModules.filter((entry) => String(entry.student_id) === String(student.id)).map((entry) => entry.module_id) : [],
    })
    setUnlocked(false)
    setUnlockWarning(false)
    setConfirmSave(false)
    setMessage('')
    setFormOpen(true)
  }

  function getSensitiveChanges() {
    if (!editing) return []
    const changes = []
    const name = form.name.trim()
    const number = String(form.student_number).trim()
    const promoValue = form.promo.trim()
    if (name !== (editing.name ?? '')) changes.push({ label: 'Nombre', from: editing.name || '—', to: name || '—' })
    if (number !== String(editing.student_number ?? '')) changes.push({ label: 'Nº de alumno', from: String(editing.student_number ?? '—'), to: number || '—' })
    if (promoValue !== (editing.promo ?? '')) changes.push({ label: 'Promoción', from: editing.promo || '—', to: promoValue || '—' })
    return changes
  }

  function validateForm() {
    if (!form.name.trim()) return 'El nombre es obligatorio.'
    const number = String(form.student_number).trim()
    if (editing && !number) return 'El número de alumno es obligatorio.'
    if (number && !/^\d{1,6}$/.test(number)) return 'El número de alumno debe ser un número.'
    if (Boolean(form.class_name) !== Boolean(form.letter)) return 'Elige la clase y el grupo, o deja ambos vacíos.'
    return ''
  }

  function handleSubmit(event) {
    event.preventDefault()
    const problem = validateForm()
    if (problem) { setMessage(problem); return }
    setMessage('')
    if (getSensitiveChanges().length) { setConfirmSave(true); return }
    persist()
  }

  async function persist() {
    setConfirmSave(false)
    setBusy(true)
    setMessage('')

    const group_name = form.class_name && form.letter ? `${form.class_name}${form.letter}` : ''
    const payload = {
      student_number: String(form.student_number).trim(),
      name: form.name.trim(),
      group_name,
      promo: form.promo.trim(),
      class_name: form.class_name || null,
    }

    if (editing) {
      // Actualización segura mediante RPC
      const { error: updateError } = await supabase.rpc('admin_update_student_with_modules', {
        p_student_id: String(editing.id),
        p_student: payload,
        p_module_ids: form.moduleIds,
      })
      
      if (updateError) { 
        setMessage(getSupabaseErrorMessage(updateError))
        setBusy(false)
        return 
      }
      setMessage('✅ Alumno actualizado correctamente.')
    } else {
      // Creación mediante Edge Function (atómica y segura)
      const { data: result, error: createError } = await supabase.functions.invoke('admin-import-users', {
        body: {
          role: 'alumno',
          send_invites: sendInvite,
          rows: [{
            row: 1,
            full_name: payload.name,
            email: form.email.trim(),
            student_number: payload.student_number,
            class_name: form.class_name,
            group_name: form.letter, 
            promo: payload.promo,
            modules: form.moduleIds,
          }],
        },
      })
      
      if (createError) {
        setMessage(await getFunctionErrorMessage(createError, 'No se pudo crear el alumno.'))
        setBusy(false)
        return
      }
      
      const outcome = result?.results?.[0]
      if (!outcome?.ok) {
        setMessage(outcome?.error || 'No se pudo crear el alumno.')
        setBusy(false)
        return
      }
      setMessage(`✅ Alumno creado. ${sendInvite ? 'Se ha enviado la invitación por correo.' : 'Usuario creado sin enviar correo.'}`)
    }

    setBusy(false)
    closeForm()
    await reload()
  }

  async function deleteStudent(student) {
    if (!window.confirm(`¿Eliminar a ${student.name}? Se quitarán sus matrículas y registros.`)) return
    setBusy(true)
    // Se pasa como String para coincidir con el tipo 'text' de la función SQL
    const { error: deleteError } = await supabase.rpc('admin_delete_student', { p_student_id: String(student.id) })
    if (deleteError) setMessage(getSupabaseErrorMessage(deleteError))
    else { 
      setMessage('✅ Alumno eliminado correctamente.')
      await reload() 
    }
    setBusy(false)
  }

  const promos = [...new Set(students.map((s) => s.promo).filter(Boolean))].sort()
  const classes = [...new Set(students.map(studentClass).filter(Boolean))].sort()
  const groups = [...new Set(students.map((s) => groupLetter(s.group_name)).filter(Boolean))].sort()
  
  const filtered = students.filter((student) => {
    const query = search.trim().toLowerCase()
    const matchesQuery = !query || [student.name, student.student_number, student.group_name, studentClass(student)].some((value) => String(value || '').toLowerCase().includes(query))
    return matchesQuery
      && (!promo || String(student.promo) === promo)
      && (!classFilter || studentClass(student) === classFilter)
      && (!groupFilter || groupLetter(student.group_name) === groupFilter)
  })

  const locked = Boolean(editing) && !unlocked
  const classOptions = [...new Set([...CLASS_OPTIONS, form.class_name].filter(Boolean))]
  const groupOptions = [...new Set([...GROUP_OPTIONS, form.letter].filter(Boolean))]
  const sensitiveChanges = confirmSave ? getSensitiveChanges() : []

  if (loading) return <div className="flex min-h-[40vh] items-center justify-center text-[#0a2540]">Cargando alumnos…</div>
  if (error) return <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-5 text-sm text-red-800">Error al cargar alumnos: {error}</div>

  return (
    <div className="space-y-4">
      <section className="rounded-lg border border-[#e5e7eb] bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-[#0a2540]">Alumnos ({filtered.length})</h2>
            <p className="mt-1 text-sm text-[#6b7280]">Filtra por nombre, número, clase, grupo o promoción.</p>
          </div>
          {isAdmin && <button className={buttonClass} onClick={() => openForm()}>+ Nuevo alumno</button>}
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_140px_140px_180px]">
          <input className={inputClass} placeholder="Buscar alumno…" value={search} onChange={(e) => setSearch(e.target.value)} />
          <select className={inputClass} value={classFilter} onChange={(e) => setClassFilter(e.target.value)}>
            <option value="">Todas las clases</option>
            {classes.map((item) => <option key={item}>{item}</option>)}
          </select>
          <select className={inputClass} value={groupFilter} onChange={(e) => setGroupFilter(e.target.value)}>
            <option value="">Todos los grupos</option>
            {groups.map((item) => <option key={item}>{item}</option>)}
          </select>
          <select className={inputClass} value={promo} onChange={(e) => setPromo(e.target.value)}>
            <option value="">Todas las promociones</option>
            {promos.map((item) => <option key={item}>{item}</option>)}
          </select>
        </div>
        {(search || promo || classFilter || groupFilter) && (
          <div className="mt-3">
            <button className={secondaryButton} onClick={() => { setSearch(''); setPromo(''); setClassFilter(''); setGroupFilter('') }}>
              Limpiar filtros
            </button>
          </div>
        )}
        {message && <p role="status" className={`mt-3 rounded p-3 text-sm ${message.includes('✅') ? 'bg-green-50 text-green-800' : 'bg-blue-50 text-blue-900'}`}>{message}</p>}
      </section>

      <section className="overflow-hidden rounded-lg border border-[#e5e7eb] bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-left text-sm">
            <thead className="bg-[#0a2540] text-xs uppercase text-white">
              <tr>{['#', 'Nombre', 'Clase', 'Grupo', 'Promoción', 'Módulos', 'Asistencia', 'Acciones'].map((label) => <th key={label} className="px-4 py-3">{label}</th>)}</tr>
            </thead>
            <tbody>
              {filtered.map((student, index) => {
                const id = String(student.id)
                const attendance = records.filter((record) => record.student_id === id && record.attendance)
                const present = attendance.filter((record) => record.attendance === 'P' || record.attendance === 'L').length
                const rate = attendance.length ? Math.round((present / attendance.length) * 100) : 0
                const moduleIds = studentModules.filter((entry) => String(entry.student_id) === id).map((entry) => entry.module_id)
                
                return (
                  <tr key={student.id} className="border-b border-[#e5e7eb] hover:bg-gray-50">
                    <td className="px-4 py-3 text-[#6b7280]">{student.student_number || '—'}</td>
                    <td className="px-4 py-3 font-semibold">{student.name}</td>
                    <td className="px-4 py-3">{studentClass(student) || '—'}</td>
                    <td className="px-4 py-3">{groupLetter(student.group_name) || '—'}</td>
                    <td className="px-4 py-3">{student.promo || '—'}</td>
                    <td className="px-4 py-3">
                      {moduleIds.length
                        ? moduleIds.map((idValue) => <span key={idValue} className="mr-1 inline-block rounded bg-blue-100 px-2 py-0.5 text-xs text-blue-900">{idValue}</span>)
                        : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`rounded px-2 py-1 text-xs font-semibold ${rate >= 80 ? 'bg-green-100 text-green-800' : rate >= 50 ? 'bg-yellow-100 text-yellow-800' : 'bg-red-100 text-red-800'}`}>
                        {rate}%
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-3">
                        <button className="font-semibold text-[#1565c0]" onClick={() => setViewing(student)}>Ver</button>
                        {isAdmin && (
                          <>
                            <button className="font-semibold text-[#1565c0]" onClick={() => openForm(student)}>Editar</button>
                            <button className="font-semibold text-red-700" disabled={busy} onClick={() => deleteStudent(student)}>Eliminar</button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        {filtered.length === 0 && (
          <p className="p-8 text-center text-sm text-[#6b7280]">
            {students.length === 0 ? 'No hay alumnos cargados.' : 'No hay alumnos que coincidan con los filtros.'}
          </p>
        )}
      </section>

      {/* Modal VER (Detalle del alumno) */}
      {viewing && (() => {
        const studentId = String(viewing.id)
        const moduleIds = studentModules.filter((entry) => String(entry.student_id) === studentId).map((entry) => entry.module_id)
        const history = practices.filter((practice) => moduleIds.includes(practice.module_id)).sort((a, b) => String(a.date).localeCompare(String(b.date)))
        const studentRecords = records.filter((record) => record.student_id === studentId)
        
        // FIX CRÍTICO: Ahora coincide correctamente gracias a que fetchAll incluye 'practice_id'
        const checked = (practiceId) => studentRecords.find((record) => String(record.practice_id) === String(practiceId)) || {}
        const presentCount = studentRecords.filter((record) => record.attendance === 'P' || record.attendance === 'L').length
        const attendedCount = studentRecords.filter((record) => record.attendance).length
        const aptoCount = studentRecords.filter((record) => record.evaluation === 'Apto').length
        const evaluatedCount = studentRecords.filter((record) => record.evaluation).length
        
        return (
          <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) setViewing(null) }}>
            <section role="dialog" aria-modal="true" className="max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-lg bg-white p-5 shadow-2xl">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-lg font-bold text-[#0a2540]">Informe · {viewing.name}</h2>
                  <p className="mt-1 text-sm text-[#6b7280]">Promoción {viewing.promo || '—'} · {viewing.group_name || 'Sin grupo'}</p>
                </div>
                <button type="button" className="px-2 text-2xl text-[#6b7280]" onClick={() => setViewing(null)}>×</button>
              </div>
              <div className="my-4 grid grid-cols-2 gap-3 md:grid-cols-4">
                {[
                  ['Asistencia', attendedCount ? `${Math.round((presentCount / attendedCount) * 100)}%` : '0%'],
                  ['Aptos', evaluatedCount ? `${Math.round((aptoCount / evaluatedCount) * 100)}%` : '0%'],
                  ['Prácticas', history.length],
                  ['Módulos', moduleIds.length],
                ].map(([label, value]) => (
                  <div key={label} className="rounded border border-[#e5e7eb] border-l-4 border-l-[#1e88e5] p-3">
                    <p className="text-xs uppercase text-[#6b7280]">{label}</p>
                    <p className="mt-1 text-xl font-bold text-[#0a2540]">{value}</p>
                  </div>
                ))}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[700px] text-left text-sm">
                  <thead className="bg-[#0a2540] text-xs uppercase text-white">
                    <tr>{['Fecha', 'Hora', 'Módulo', 'Práctica', 'Asistencia', 'Evaluación'].map((label) => <th key={label} className="p-3">{label}</th>)}</tr>
                  </thead>
                  <tbody>
                    {history.map((practice) => {
                      const record = checked(practice.id)
                      return (
                        <tr key={practice.id} className="border-b border-[#e5e7eb]">
                          <td className="p-3">{practice.date || '—'}</td>
                          <td className="p-3">{practice.start_time || '—'}</td>
                          <td className="p-3">{practice.module_id}</td>
                          <td className="p-3">{practice.title}</td>
                          <td className="p-3">{({ P: 'Presente', L: 'Tarde', A: 'Falta' })[record.attendance] || 'Pendiente'}</td>
                          <td className="p-3">{record.evaluation || 'Pendiente'}</td>
                        </tr>
                      )
                    })}
                    {history.length === 0 && (
                      <tr><td colSpan="6" className="p-4 text-center text-[#6b7280]">No hay prácticas registradas para este alumno.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
              <div className="mt-4 flex justify-end">
                <button className={secondaryButton} onClick={() => setViewing(null)}>Cerrar</button>
              </div>
            </section>
          </div>
        )
      })()}

      {/* Modal CREAR / EDITAR */}
      {formOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) closeForm() }}>
          <section role="dialog" aria-modal="true" className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-lg bg-white p-5 shadow-2xl">
            <h2 className="mb-4 text-lg font-bold text-[#0a2540]">{editing ? 'Editar alumno' : 'Nuevo alumno'}</h2>

            {editing && (
              <div className="mb-4 flex items-center justify-between gap-3 rounded border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                {unlocked
                  ? <span>⚠️ Nombre, número y promoción desbloqueados. Los cambios se confirmarán al guardar.</span>
                  : <span>🔒 Nombre, número de alumno y promoción están bloqueados. Clase y grupo se pueden cambiar libremente.</span>}
                {!unlocked && (
                  <button type="button" className="shrink-0 rounded border border-amber-400 px-3 py-1 font-semibold hover:bg-amber-100" onClick={() => setUnlockWarning(true)}>
                    Desbloquear
                  </button>
                )}
              </div>
            )}

            <form className="space-y-4" onSubmit={handleSubmit}>
              <label className="grid gap-1.5 text-sm font-semibold text-[#0a2540]">
                Número de alumno
                <input
                  className={`${inputClass} ${locked ? 'cursor-not-allowed bg-[#f3f4f6] text-[#6b7280]' : ''}`}
                  value={form.student_number}
                  onChange={(e) => setForm({ ...form, student_number: e.target.value })}
                  disabled={locked}
                  required={Boolean(editing)}
                  placeholder={editing ? '' : 'Automático si se deja vacío'}
                />
              </label>
              <label className="grid gap-1.5 text-sm font-semibold text-[#0a2540]">
                Nombre completo
                <input
                  className={`${inputClass} ${locked ? 'cursor-not-allowed bg-[#f3f4f6] text-[#6b7280]' : ''}`}
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  disabled={locked}
                  required
                />
              </label>

              <div className="grid gap-3 sm:grid-cols-2">
                <label className="grid gap-1.5 text-sm font-semibold text-[#0a2540]">
                  Clase
                  <select className={inputClass} value={form.class_name} onChange={(e) => setForm({ ...form, class_name: e.target.value })}>
                    <option value="">Sin clase</option>
                    {classOptions.map((item) => <option key={item} value={item}>{item}</option>)}
                  </select>
                </label>
                <label className="grid gap-1.5 text-sm font-semibold text-[#0a2540]">
                  Grupo
                  <select className={inputClass} value={form.letter} onChange={(e) => setForm({ ...form, letter: e.target.value })}>
                    <option value="">Sin grupo</option>
                    {groupOptions.map((item) => <option key={item} value={item}>{item}</option>)}
                  </select>
                </label>
              </div>

              <label className="grid gap-1.5 text-sm font-semibold text-[#0a2540]">
                Promoción
                <input
                  className={`${inputClass} ${locked ? 'cursor-not-allowed bg-[#f3f4f6] text-[#6b7280]' : ''}`}
                  value={form.promo}
                  onChange={(e) => setForm({ ...form, promo: e.target.value })}
                  disabled={locked}
                />
              </label>

              {!editing && (
                <>
                  <label className="grid gap-1.5 text-sm font-semibold text-[#0a2540]">
                    Correo para invitar
                    <input className={inputClass} type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
                  </label>
                  <label className="flex items-center gap-2 text-sm text-[#0a2540]">
                    <input type="checkbox" checked={sendInvite} onChange={(e) => setSendInvite(e.target.checked)} className="rounded border-gray-300" />
                    Enviar invitación por correo al alumno
                  </label>
                </>
              )}

              <fieldset className="grid max-h-40 gap-2 overflow-y-auto sm:grid-cols-2">
                <legend className="mb-2 text-sm font-semibold text-[#0a2540]">Módulos iniciales</legend>
                {modules.map((module) => (
                  <label key={module.id} className="flex items-center gap-2 rounded border border-[#e5e7eb] p-2 text-sm">
                    <input
                      type="checkbox"
                      checked={form.moduleIds.includes(module.id)}
                      onChange={(e) => setForm({
                        ...form,
                        moduleIds: e.target.checked ? [...form.moduleIds, module.id] : form.moduleIds.filter((id) => id !== module.id),
                      })}
                    />
                    {module.id} · {module.name}
                  </label>
                ))}
              </fieldset>

              {message && <p role="alert" className="rounded bg-red-50 p-3 text-sm text-red-800">{message}</p>}
              <div className="flex justify-end gap-2">
                <button type="button" className={secondaryButton} onClick={closeForm}>Cancelar</button>
                <button className={buttonClass} disabled={busy}>{busy ? 'Guardando…' : 'Guardar'}</button>
              </div>
            </form>
          </section>
        </div>
      )}

      {/* Aviso desbloquear */}
      {unlockWarning && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) setUnlockWarning(false) }}>
          <section role="alertdialog" aria-modal="true" className="w-full max-w-md rounded-lg bg-white p-5 shadow-2xl">
            <h3 className="mb-2 text-lg font-bold text-[#0a2540]">⚠️ Antes de continuar</h3>
            <p className="text-sm text-[#374151]">
              El nombre, el número de alumno y la promoción identifican al alumno en asistencias, evaluaciones e informes.
              Cámbialos solo para corregir un error.
            </p>
            <p className="mt-2 text-sm text-[#374151]">
              Para pasar al alumno de curso, usa <strong>Clase</strong> y <strong>Grupo</strong>, que no necesitan desbloqueo.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" className={secondaryButton} onClick={() => setUnlockWarning(false)}>Cancelar</button>
              <button type="button" className={buttonClass} onClick={() => { setUnlocked(true); setUnlockWarning(false) }}>Sí, desbloquear</button>
            </div>
          </section>
        </div>
      )}

      {/* Confirmar cambios sensibles */}
      {confirmSave && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) setConfirmSave(false) }}>
          <section role="alertdialog" aria-modal="true" className="w-full max-w-md rounded-lg bg-white p-5 shadow-2xl">
            <h3 className="mb-2 text-lg font-bold text-[#0a2540]">Confirma los cambios</h3>
            <p className="mb-3 text-sm text-[#374151]">Vas a modificar datos que identifican al alumno:</p>
            <ul className="space-y-2 text-sm">
              {sensitiveChanges.map((change) => (
                <li key={change.label} className="rounded border border-[#e5e7eb] p-2">
                  <span className="font-semibold text-[#0a2540]">{change.label}:</span>{' '}
                  <span className="text-[#6b7280] line-through">{change.from}</span> → <span className="font-semibold">{change.to}</span>
                </li>
              ))}
            </ul>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" className={secondaryButton} onClick={() => setConfirmSave(false)}>Volver</button>
              <button type="button" className={buttonClass} onClick={persist}>Confirmar y guardar</button>
            </div>
          </section>
        </div>
      )}
    </div>
  )
}