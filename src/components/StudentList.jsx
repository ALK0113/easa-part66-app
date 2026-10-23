import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { getSupabaseErrorMessage, isMissingTable } from '../lib/supabaseErrors.js'
import { subscribeToTables } from '../lib/supabaseRealtime.js'

const inputClass = 'w-full rounded border border-[#d1d5db] px-3 py-2 text-sm focus:border-[#1e88e5]'
const buttonClass = 'rounded bg-[#1e88e5] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1565c0] disabled:opacity-50'

export default function StudentList({ user }) {
  const [students, setStudents] = useState([])
  const [modules, setModules] = useState([])
  const [studentModules, setStudentModules] = useState([])
  const [records, setRecords] = useState([])
  const [practices, setPractices] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [setupNotice, setSetupNotice] = useState('')
  const [message, setMessage] = useState('')
  const [search, setSearch] = useState('')
  const [promo, setPromo] = useState('')
  const [formOpen, setFormOpen] = useState(false)
  const [viewing, setViewing] = useState(null)
  const [editing, setEditing] = useState(null)
  const [busy, setBusy] = useState(false)
  const [form, setForm] = useState({ student_number: '', name: '', group_name: '', promo: '', email: '', moduleIds: [] })

  async function reload() {
    const [studentResult, moduleResult, membershipResult, recordResult, practiceResult] = await Promise.all([
      supabase.from('students').select('id,student_number,name,group_name,promo').order('student_number', { ascending: true }),
      supabase.from('modules').select('id,name'),
      supabase.from('student_modules').select('student_id,module_id'),
      supabase.from('practice_records').select('student_id,attendance,evaluation'),
      supabase.from('practices').select('id,module_id,ata,title,date,start_time'),
    ])
    const requiredError = studentResult.error || moduleResult.error || practiceResult.error
    const optionalErrors = [membershipResult.error, recordResult.error].filter(Boolean)
    if (requiredError) setError(requiredError.message)
    else {
      setStudents(studentResult.data || [])
      setModules(moduleResult.data || [])
      setStudentModules(membershipResult.error ? [] : membershipResult.data || [])
      setRecords(recordResult.error ? [] : recordResult.data || [])
      setPractices(practiceResult.data || [])
      setError('')
      setSetupNotice(optionalErrors.some(isMissingTable)
        ? 'La migración de asignaciones/asistencia aún no está aplicada. Puedes consultar los alumnos; matrículas e informes se activarán al aplicarla.'
        : optionalErrors[0]?.message || '')
    }
    setLoading(false)
  }

  useEffect(() => {
    let cancelled = false
    async function load() {
      const [studentResult, moduleResult, membershipResult, recordResult, practiceResult] = await Promise.all([
        supabase.from('students').select('id,student_number,name,group_name,promo').order('student_number', { ascending: true }),
        supabase.from('modules').select('id,name'),
        supabase.from('student_modules').select('student_id,module_id'),
        supabase.from('practice_records').select('student_id,attendance,evaluation'),
        supabase.from('practices').select('id,module_id,ata,title,date,start_time'),
      ])
      if (cancelled) return
      const requiredError = studentResult.error || moduleResult.error || practiceResult.error
      const optionalErrors = [membershipResult.error, recordResult.error].filter(Boolean)
      if (requiredError) setError(requiredError.message)
      else {
        setStudents(studentResult.data || [])
        setModules(moduleResult.data || [])
        setStudentModules(membershipResult.error ? [] : membershipResult.data || [])
        setRecords(recordResult.error ? [] : recordResult.data || [])
        setPractices(practiceResult.data || [])
        setSetupNotice(optionalErrors.some(isMissingTable)
          ? 'La migración de asignaciones/asistencia aún no está aplicada. Puedes consultar los alumnos; matrículas e informes se activarán al aplicarla.'
          : optionalErrors[0]?.message || '')
      }
      setLoading(false)
    }
    load()
    const unsubscribe = subscribeToTables(['students', 'modules', 'student_modules', 'practice_records', 'practices'], load, 'student-list')
    return () => { cancelled = true; unsubscribe() }
  }, [])

  function openForm(student = null) {
    setEditing(student)
    setForm({
      student_number: student?.student_number ?? '',
      name: student?.name ?? '',
      group_name: student?.group_name ?? '',
      promo: student?.promo ?? '',
      email: '',
      moduleIds: student ? studentModules.filter((entry) => entry.student_id === String(student.id)).map((entry) => entry.module_id) : [],
    })
    setMessage('')
    setFormOpen(true)
  }

  async function saveStudent(event) {
    event.preventDefault()
    setBusy(true)
    setMessage('')
    const payload = {
      student_number: form.student_number.trim(),
      name: form.name.trim(),
      group_name: form.group_name.trim(),
      promo: form.promo.trim(),
    }

    if (editing) {
      const { error: updateError } = await supabase.rpc('admin_update_student_with_modules', {
        p_student_id: String(editing.id),
        p_student: payload,
        p_module_ids: form.moduleIds,
      })
      if (updateError) { setMessage(getSupabaseErrorMessage(updateError)); setBusy(false); return }
      setMessage('Alumno actualizado.')
    } else {
      const { data: invite, error: inviteError } = await supabase.functions.invoke('admin-create-user', {
        body: {
          email: form.email.trim(),
          full_name: payload.name,
          role: 'alumno',
          student: payload,
          module_ids: form.moduleIds,
        },
      })
      if (inviteError || invite?.error) {
        setMessage(inviteError?.message || invite.error)
        setBusy(false)
        return
      }
      setMessage('Alumno creado y cuenta invitada por correo.')
    }

    setBusy(false)
    setFormOpen(false)
    await reload()
  }

  async function deleteStudent(student) {
    if (!window.confirm(`¿Eliminar a ${student.name}? Se quitarán sus matrículas y registros, pero la cuenta de acceso no se borrará.`)) return
    setBusy(true)
    const { error: deleteError } = await supabase.rpc('admin_delete_student', { p_student_id: String(student.id) })
    if (deleteError) setMessage(getSupabaseErrorMessage(deleteError))
    else { setMessage('Alumno eliminado. La cuenta Auth se conserva para evitar eliminarla accidentalmente.'); await reload() }
    setBusy(false)
  }

  const promos = [...new Set(students.map((student) => student.promo).filter(Boolean))].sort()
  const filtered = students.filter((student) => {
    const query = search.trim().toLowerCase()
    const matchesQuery = !query || [student.name, student.student_number, student.group_name].some((value) => String(value || '').toLowerCase().includes(query))
    return matchesQuery && (!promo || String(student.promo) === promo)
  })
  const isAdmin = user?.role === 'admin'

  if (loading) return <div className="flex min-h-[40vh] items-center justify-center text-[#0a2540]">Cargando alumnos…</div>
  if (error) return <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-5 text-sm text-red-800">Error al cargar alumnos: {error}</div>

  return (
    <div className="space-y-4">
      <section className="rounded-lg border border-[#e5e7eb] bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div><h2 className="text-lg font-bold text-[#0a2540]">Alumnos ({filtered.length})</h2><p className="mt-1 text-sm text-[#6b7280]">Filtra por nombre, número, grupo o promoción.</p></div>
          {isAdmin && <button className={buttonClass} onClick={() => openForm()}>+ Nuevo alumno</button>}
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_220px]">
          <input className={inputClass} placeholder="Buscar alumno…" value={search} onChange={(event) => setSearch(event.target.value)} />
          <select className={inputClass} value={promo} onChange={(event) => setPromo(event.target.value)}><option value="">Todas las promociones</option>{promos.map((item) => <option key={item}>{item}</option>)}</select>
        </div>
        {setupNotice && <p role="status" className="mt-3 rounded bg-amber-50 p-3 text-sm text-amber-900">{setupNotice}</p>}
        {message && <p role="status" className="mt-3 rounded bg-blue-50 p-3 text-sm text-blue-900">{message}</p>}
      </section>

      <section className="overflow-hidden rounded-lg border border-[#e5e7eb] bg-white shadow-sm">
        <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-sm">
          <thead className="bg-[#0a2540] text-xs uppercase text-white"><tr>{['#', 'Nombre', 'Grupo', 'Promoción', 'Módulos', 'Asistencia', 'Aptos', 'Acciones'].map((label) => <th key={label} className="px-4 py-3">{label}</th>)}</tr></thead>
          <tbody>{filtered.map((student) => {
            const id = String(student.id)
            const attendance = records.filter((record) => record.student_id === id && record.attendance)
            const present = attendance.filter((record) => record.attendance === 'P' || record.attendance === 'L').length
            const rate = attendance.length ? Math.round((present / attendance.length) * 100) : 0
            const evaluated = records.filter((record) => record.student_id === id && record.evaluation)
            const apto = evaluated.length ? Math.round((evaluated.filter((record) => record.evaluation === 'Apto').length / evaluated.length) * 100) : 0
            const moduleIds = studentModules.filter((entry) => entry.student_id === id).map((entry) => entry.module_id)
            return <tr key={student.id} className="border-b border-[#e5e7eb] hover:bg-gray-50">
              <td className="px-4 py-3 text-[#6b7280]">{student.student_number}</td><td className="px-4 py-3 font-semibold">{student.name}</td><td className="px-4 py-3">{student.group_name || '—'}</td><td className="px-4 py-3">{student.promo || '—'}</td>
              <td className="px-4 py-3">{moduleIds.length ? moduleIds.map((idValue) => <span key={idValue} className="mr-1 inline-block rounded bg-blue-100 px-2 py-0.5 text-xs text-blue-900">{idValue}</span>) : '—'}</td><td className="px-4 py-3">{rate}%</td><td className="px-4 py-3">{apto}%</td>
              <td className="px-4 py-3"><div className="flex gap-3"><button className="font-semibold text-[#1565c0]" onClick={() => setViewing(student)}>Ver</button>{isAdmin && <><button className="font-semibold text-[#1565c0]" onClick={() => openForm(student)}>Editar</button><button className="font-semibold text-red-700" disabled={busy} onClick={() => deleteStudent(student)}>Eliminar</button></>}</div></td>
            </tr>
          })}</tbody>
        </table></div>
        {filtered.length === 0 && <p className="p-8 text-center text-sm text-[#6b7280]">{students.length === 0 ? 'No hay alumnos cargados. Administración puede usar Configuración para cargar los datos iniciales.' : 'No hay alumnos que coincidan con los filtros.'}</p>}
      </section>

      {viewing && (() => {
        const studentId = String(viewing.id)
        const moduleIds = studentModules.filter((entry) => entry.student_id === studentId).map((entry) => entry.module_id)
        const history = practices.filter((practice) => moduleIds.includes(practice.module_id)).sort((a, b) => String(a.date).localeCompare(String(b.date)))
        const studentRecords = records.filter((record) => record.student_id === studentId)
        const checked = (practiceId) => studentRecords.find((record) => record.practice_id === practiceId) || {}
        const present = studentRecords.filter((record) => record.attendance === 'P' || record.attendance === 'L').length
        const attended = studentRecords.filter((record) => record.attendance).length
        const apto = studentRecords.filter((record) => record.evaluation === 'Apto').length
        const evaluated = studentRecords.filter((record) => record.evaluation).length
        return <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) setViewing(null) }}><section role="dialog" aria-modal="true" aria-label={`Informe de ${viewing.name}`} className="max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-lg bg-white p-5 shadow-2xl"><div className="flex items-start justify-between gap-4"><div><h2 className="text-lg font-bold text-[#0a2540]">Informe · {viewing.name}</h2><p className="mt-1 text-sm text-[#6b7280]">Promoción {viewing.promo || '—'} · {viewing.group_name || 'Sin grupo'}</p></div><button type="button" className="px-2 text-2xl text-[#6b7280]" aria-label="Cerrar" onClick={() => setViewing(null)}>×</button></div><div className="my-4 grid grid-cols-2 gap-3 md:grid-cols-4">{[['Asistencia', attended ? `${Math.round((present / attended) * 100)}%` : '0%'], ['Aptos', evaluated ? `${Math.round((apto / evaluated) * 100)}%` : '0%'], ['Prácticas', history.length], ['Módulos', moduleIds.length]].map(([label, value]) => <div key={label} className="rounded border border-[#e5e7eb] border-l-4 border-l-[#1e88e5] p-3"><p className="text-xs uppercase text-[#6b7280]">{label}</p><p className="mt-1 text-xl font-bold text-[#0a2540]">{value}</p></div>)}</div><div className="overflow-x-auto"><table className="w-full min-w-[700px] text-left text-sm"><thead className="bg-[#0a2540] text-xs uppercase text-white"><tr>{['Fecha', 'Hora', 'Módulo', 'Práctica', 'Asistencia', 'Evaluación'].map((label) => <th key={label} className="p-3">{label}</th>)}</tr></thead><tbody>{history.map((practice) => { const record = checked(practice.id); return <tr key={practice.id} className="border-b border-[#e5e7eb]"><td className="p-3">{practice.date || '—'}</td><td className="p-3">{practice.start_time || '—'}</td><td className="p-3">{practice.module_id}</td><td className="p-3">{practice.title}</td><td className="p-3">{({ P: 'Presente', L: 'Tarde', A: 'Falta' })[record.attendance] || 'Pendiente'}</td><td className="p-3">{record.evaluation || 'Pendiente'}</td></tr>})}</tbody></table></div></section></div>
      })()}

      {formOpen && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) setFormOpen(false) }}>
        <section role="dialog" aria-modal="true" aria-label={editing ? 'Editar alumno' : 'Nuevo alumno'} className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-lg bg-white p-5 shadow-2xl">
          <h2 className="mb-4 text-lg font-bold text-[#0a2540]">{editing ? 'Editar alumno' : 'Nuevo alumno'}</h2>
          <form className="space-y-4" onSubmit={saveStudent}>
            <label className="grid gap-1.5 text-sm font-semibold text-[#0a2540]">Número de alumno<input className={inputClass} value={form.student_number} onChange={(event) => setForm({ ...form, student_number: event.target.value })} required /></label>
            <label className="grid gap-1.5 text-sm font-semibold text-[#0a2540]">Nombre completo<input className={inputClass} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required /></label>
            <div className="grid gap-3 sm:grid-cols-2"><label className="grid gap-1.5 text-sm font-semibold text-[#0a2540]">Grupo<input className={inputClass} value={form.group_name} onChange={(event) => setForm({ ...form, group_name: event.target.value })} /></label><label className="grid gap-1.5 text-sm font-semibold text-[#0a2540]">Promoción<input className={inputClass} value={form.promo} onChange={(event) => setForm({ ...form, promo: event.target.value })} /></label></div>
            {!editing && <label className="grid gap-1.5 text-sm font-semibold text-[#0a2540]">Correo para invitar<input className={inputClass} type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} required /></label>}
            <fieldset className="grid max-h-40 gap-2 overflow-y-auto sm:grid-cols-2"><legend className="mb-2 text-sm font-semibold text-[#0a2540]">Módulos iniciales</legend>{modules.map((module) => <label key={module.id} className="flex items-center gap-2 rounded border border-[#e5e7eb] p-2 text-sm"><input type="checkbox" checked={form.moduleIds.includes(module.id)} onChange={(event) => setForm({ ...form, moduleIds: event.target.checked ? [...form.moduleIds, module.id] : form.moduleIds.filter((id) => id !== module.id) })} />{module.id} · {module.name}</label>)}</fieldset>
            {message && <p role="alert" className="rounded bg-red-50 p-3 text-sm text-red-800">{message}</p>}
            <div className="flex justify-end gap-2"><button type="button" className="rounded border border-[#d1d5db] px-4 py-2 text-sm" onClick={() => setFormOpen(false)}>Cancelar</button><button className={buttonClass} disabled={busy}>{busy ? 'Guardando…' : 'Guardar'}</button></div>
          </form>
        </section>
      </div>}
    </div>
  )
}