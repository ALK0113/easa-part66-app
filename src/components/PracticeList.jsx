import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { getSupabaseErrorMessage, isMissingTable } from '../lib/supabaseErrors.js'
import { subscribeToTables } from '../lib/supabaseRealtime.js'

const inputClass = 'w-full rounded border border-[#d1d5db] px-3 py-2 text-sm focus:border-[#1e88e5]'
const buttonClass = 'rounded bg-[#1e88e5] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1565c0] disabled:opacity-50'

function formatDate(value) {
  if (!value) return '—'
  const [year, month, day] = value.slice(0, 10).split('-')
  return `${day}/${month}/${year}`
}

// 🆕 Parsear objectives (puede venir como string o array desde Supabase)
function parseObjectives(value) {
  if (!value) return []
  if (Array.isArray(value)) return value
  try { return JSON.parse(value) } catch { return [] }
}

export default function PracticeList({ user }) {
  const [practices, setPractices] = useState([])
  const [modules, setModules] = useState([])
  const [students, setStudents] = useState([])
  const [memberships, setMemberships] = useState([])
  const [records, setRecords] = useState([])
  const [teacherModules, setTeacherModules] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [setupNotice, setSetupNotice] = useState('')
  const [message, setMessage] = useState('')
  const [selectedPractice, setSelectedPractice] = useState(null)
  const [search, setSearch] = useState('')
  const [moduleFilter, setModuleFilter] = useState('')
  const [ataFilter, setAtaFilter] = useState('')
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState({ 
    id: '', module_id: '', ata: '', title: '', detail: '', 
    date: '', start_time: '09:00', hours: 1,
    description: '', // 🆕
    objectives: []    // 🆕
  })
  const [busy, setBusy] = useState(false)

  // 🆕 Estado para objetivos en el formulario (array de strings)
  const [objectivesInput, setObjectivesInput] = useState([''])

  useEffect(() => {
    let cancelled = false
    async function load() {
      const [practiceResult, moduleResult, studentResult, membershipResult, recordResult, teacherResult] = await Promise.all([
        supabase.from('practices').select('id,module_id,ata,title,detail,date,start_time,hours,description,objectives').order('date', { ascending: true }), // 🆕 añadido description,objectives
        supabase.from('modules').select('id,name'),
        supabase.from('students').select('id,student_number,name,group_name,promo').order('student_number', { ascending: true }),
        supabase.from('student_modules').select('student_id,module_id'),
        supabase.from('practice_records').select('student_id,practice_id,attendance,evaluation'),
        user?.role === 'profesor' ? supabase.from('teacher_modules').select('module_id').eq('profile_id', user.id) : Promise.resolve({ data: [], error: null }),
      ])
      if (cancelled) return
      const requiredError = practiceResult.error || moduleResult.error || studentResult.error
      const setupErrors = [membershipResult.error, recordResult.error, teacherResult.error].filter((item) => isMissingTable(item))
      const optionalError = [membershipResult.error, recordResult.error, teacherResult.error].find((item) => item && !isMissingTable(item))
      if (requiredError) setError(requiredError.message)
      else {
        setPractices(practiceResult.data || [])
        setModules(moduleResult.data || [])
        setStudents(studentResult.data || [])
        setMemberships(membershipResult.error ? [] : membershipResult.data || [])
        setRecords(recordResult.error ? [] : recordResult.data || [])
        setTeacherModules((teacherResult.error ? [] : teacherResult.data || []).map((entry) => entry.module_id))
        if (setupErrors.length) setSetupNotice('Faltan tablas de asignaciones/asistencia. Las prácticas se muestran, pero matrículas y evaluación requieren aplicar la migración de Supabase.')
        else if (optionalError) setError(optionalError.message)
      }
      setLoading(false)
    }
    load()
    const unsubscribe = subscribeToTables(['practices', 'modules', 'students', 'student_modules', 'practice_records', 'teacher_modules'], load, 'practice-list')
    return () => { cancelled = true; unsubscribe() }
  }, [user?.id, user?.role])

  const visibleModules = user?.role === 'admin' ? modules : modules.filter((module) => teacherModules.includes(module.id))
  const visiblePractices = practices.filter((practice) => user?.role === 'admin' || teacherModules.includes(practice.module_id))
  const filtered = visiblePractices.filter((practice) => {
    const query = search.trim().toLowerCase()
    const matchesSearch = !query || [practice.id, practice.title, practice.detail, practice.ata, practice.description].some((value) => String(value || '').toLowerCase().includes(query))
    return matchesSearch && (!moduleFilter || practice.module_id === moduleFilter) && (!ataFilter || practice.ata === ataFilter)
  })
  const atas = [...new Set(visiblePractices.map((practice) => practice.ata).filter(Boolean))].sort()
  const canCreate = user?.role === 'admin' || visibleModules.length > 0
  const canEdit = (practice) => user?.role === 'admin' || teacherModules.includes(practice.module_id) // 🆕 helper

  function openForm(practice = null) {
    setEditing(practice)
    const objectives = practice ? parseObjectives(practice.objectives) : ['']
    setObjectivesInput(objectives.length ? objectives : [''])
    setForm(practice 
      ? { 
          ...practice, 
          date: practice.date?.slice(0, 10) || '',
          description: practice.description || '',
          objectives: objectives
        } 
      : { id: '', module_id: visibleModules[0]?.id || '', ata: '', title: '', detail: '', date: '', start_time: '09:00', hours: 1, description: '', objectives: [] })
    setFormOpen(true)
    setMessage('')
  }

  // 🆕 Handlers para objetivos en el formulario
  const addObjective = () => setObjectivesInput([...objectivesInput, ''])
  const updateObjective = (index, value) => {
    const updated = [...objectivesInput]
    updated[index] = value
    setObjectivesInput(updated)
  }
  const removeObjective = (index) => setObjectivesInput(objectivesInput.filter((_, i) => i !== index))

  async function savePractice(event) {
    event.preventDefault()
    setBusy(true)
    //  Filtrar objetivos vacíos
    const cleanObjectives = objectivesInput.map(o => o.trim()).filter(o => o.length > 0)
    const payload = { 
      ...form, 
      id: form.id.trim(), 
      title: form.title.trim(), 
      ata: form.ata.trim(), 
      detail: form.detail.trim(), 
      hours: Number(form.hours),
      description: form.description.trim(), // 
      objectives: cleanObjectives           //  se guarda como array (Supabase JSONB)
    }
    const result = editing
      ? await supabase.from('practices').update(payload).eq('id', editing.id)
      : await supabase.from('practices').insert(payload)
    setBusy(false)
    if (result.error) { setMessage(result.error.message); return }
    setFormOpen(false)
    setMessage('Práctica guardada.')
    const { data } = await supabase.from('practices').select('id,module_id,ata,title,detail,date,start_time,hours,description,objectives').order('date', { ascending: true }) // 🆕
    setPractices(data || [])
  }

  async function deletePractice(practice) {
    if (!window.confirm(`¿Eliminar la práctica ${practice.id}?`)) return
    const { error: deleteError } = await supabase.rpc('admin_delete_practice', { p_practice_id: String(practice.id) })
    if (deleteError) setMessage(getSupabaseErrorMessage(deleteError))
    else { setPractices(practices.filter((item) => item.id !== practice.id)); setMessage('Práctica eliminada.') }
  }

  function getRecord(studentId, practiceId) {
    return records.find((record) => record.student_id === String(studentId) && record.practice_id === practiceId) || { attendance: '', evaluation: '' }
  }

  function getEnrolledStudents(practice) {
    const ids = new Set(memberships.filter((entry) => entry.module_id === practice.module_id).map((entry) => entry.student_id))
    return students.filter((student) => ids.has(String(student.id)))
  }

  async function setRecord(studentId, practiceId, field, value) {
    const existing = getRecord(studentId, practiceId)
    if (field === 'attendance' && (existing.attendance === 'A' || value === 'A') && existing.attendance !== value) {
      if (!window.confirm('Vas a modificar una falta. ¿Quieres continuar?')) return
    }
    const rpcName = field === 'attendance' ? 'set_attendance' : 'set_evaluation'
    const rpcArgs = field === 'attendance'
      ? { p_student_id: studentId, p_practice_id: practiceId, p_attendance: value }
      : { p_student_id: studentId, p_practice_id: practiceId, p_evaluation: value || null }
    const { error: saveError } = await supabase.rpc(rpcName, rpcArgs)
    if (saveError) { setMessage(getSupabaseErrorMessage(saveError)); return }
    const saved = {
      ...existing,
      student_id: String(studentId),
      practice_id: practiceId,
      attendance: field === 'attendance' ? value : existing.attendance || null,
      evaluation: field === 'evaluation' ? value || null : existing.evaluation || null,
      updated_by: user.id,
      updated_at: new Date().toISOString(),
    }
    setRecords((current) => [...current.filter((record) => !(record.student_id === saved.student_id && record.practice_id === practiceId)), saved])
    setMessage('Registro guardado.')
  }

  async function markAll(attendance) {
    const enrolled = getEnrolledStudents(selectedPractice)
    if (attendance === 'A' && !window.confirm('¿Marcar a todos los alumnos como falta?')) return
    setBusy(true)
    const studentIds = enrolled.map((student) => student.id)
    if (studentIds.length) {
      const { error: saveError } = await supabase.rpc('set_attendance_bulk', {
        p_student_ids: studentIds,
        p_practice_id: selectedPractice.id,
        p_attendance: attendance,
      })
      if (saveError) setMessage(getSupabaseErrorMessage(saveError))
      else {
        const studentIdSet = new Set(studentIds.map(String))
        setRecords((current) => [
          ...current.filter((record) => !(record.practice_id === selectedPractice.id && studentIdSet.has(record.student_id))),
          ...enrolled.map((student) => ({
            ...getRecord(student.id, selectedPractice.id),
            student_id: String(student.id),
            practice_id: selectedPractice.id,
            attendance,
            updated_by: user.id,
            updated_at: new Date().toISOString(),
          })),
        ])
        setMessage('Asistencia actualizada para todo el grupo.')
      }
    }
    setBusy(false)
  }

  if (loading) return <div className="flex min-h-[40vh] items-center justify-center text-[#0a2540]">Cargando prácticas…</div>
  if (error) return <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-5 text-sm text-red-800">Error al cargar prácticas: {error}</div>

  if (selectedPractice) {
    const enrolled = getEnrolledStudents(selectedPractice)
    const summary = { P: 0, L: 0, A: 0, apto: 0 }
    enrolled.forEach((student) => {
      const record = getRecord(student.id, selectedPractice.id)
      if (record.attendance) summary[record.attendance] += 1
      if (record.evaluation === 'Apto') summary.apto += 1
    })
    const objectives = parseObjectives(selectedPractice.objectives)
    return <div className="space-y-5">
      <button className="text-sm font-semibold text-[#1565c0]" onClick={() => setSelectedPractice(null)}>← Volver a prácticas</button>
      <section className="rounded-lg bg-gradient-to-r from-[#0a2540] to-[#1e88e5] p-6 text-white">
        <p className="text-xs font-semibold uppercase text-blue-100">{selectedPractice.id} · {selectedPractice.module_id} · {selectedPractice.ata}</p>
        <h2 className="mt-2 text-2xl font-bold">{selectedPractice.title}</h2>
        <p className="mt-1 text-sm text-blue-100">{selectedPractice.detail}</p>
        <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-sm"><span>📅 {formatDate(selectedPractice.date)}</span><span>⏰ {selectedPractice.start_time}</span><span>⏱️ {selectedPractice.hours} h</span><span> {enrolled.length} alumnos</span></div>
      </section>

      {/* 🆕 Descripción compacta */}
      {selectedPractice.description && (
        <section className="rounded-lg border border-[#e5e7eb] bg-white p-5">
          <p className="mb-2 text-xs font-bold uppercase tracking-wide text-[#6b7280]">Description:</p>
          <p className="text-sm leading-relaxed text-[#374151]">{selectedPractice.description}</p>
        </section>
      )}

      {/* 🆕 Objetivos compactos */}
      {objectives.length > 0 && (
        <section className="rounded-lg border border-[#e5e7eb] bg-white p-5">
          <p className="mb-2 text-xs font-bold uppercase tracking-wide text-[#6b7280]">Objectives:</p>
          <ul className="space-y-1.5 text-sm text-[#374151]">
            {objectives.map((obj, idx) => (
              <li key={idx} className="flex gap-2">
                <span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-[#1e88e5]"></span>
                <span>{obj}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">{[['Presentes', summary.P, 'border-l-[#2e7d32]'], ['Tarde', summary.L, 'border-l-[#ef6c00]'], ['Faltas', summary.A, 'border-l-[#c62828]'], ['Aptos', `${summary.apto}/${enrolled.length}`, 'border-l-[#ffb300]']].map(([label, value, color]) => <div key={label} className={`rounded-lg border border-[#e5e7eb] border-l-4 bg-white p-4 ${color}`}><p className="text-xs uppercase text-[#6b7280]">{label}</p><p className="mt-1 text-2xl font-bold text-[#0a2540]">{value}</p></div>)}</section>
      <section className="overflow-hidden rounded-lg border border-[#e5e7eb] bg-white">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#e5e7eb] p-4"><h3 className="font-bold text-[#0a2540]">Asistencia y evaluación</h3><div className="flex gap-2"><button className="rounded bg-[#2e7d32] px-3 py-2 text-xs font-bold text-white" disabled={busy} onClick={() => markAll('P')}>✓ Todos presentes</button><button className="rounded bg-[#ef6c00] px-3 py-2 text-xs font-bold text-white" disabled={busy} onClick={() => markAll('A')}>✗ Todos falta</button></div></div>
        {message && <p role="status" className="m-4 rounded bg-blue-50 p-3 text-sm text-blue-900">{message}</p>}
        <div className="overflow-x-auto"><table className="w-full min-w-[720px] text-left text-sm"><thead className="bg-[#0a2540] text-xs uppercase text-white"><tr>{['Alumno', 'Grupo', 'Promoción', 'Asistencia', 'Evaluación'].map((title) => <th key={title} className="p-3">{title}</th>)}</tr></thead><tbody>{enrolled.map((student) => {
          const record = getRecord(student.id, selectedPractice.id)
          return <tr key={student.id} className="border-b border-[#e5e7eb]"><td className="p-3 font-semibold">{student.name}</td><td className="p-3">{student.group_name || '—'}</td><td className="p-3">{student.promo || '—'}</td><td className="p-3"><div className="flex gap-1">{[['P', 'Presente', '#2e7d32'], ['L', 'Tarde', '#ef6c00'], ['A', 'Falta', '#c62828']].map(([value, label, color]) => <button key={value} title={label} aria-pressed={record.attendance === value} className={`h-8 w-9 rounded border text-xs font-bold ${record.attendance === value ? 'text-white' : 'bg-white text-[#374151]'}`} style={record.attendance === value ? { backgroundColor: color, borderColor: color } : undefined} disabled={busy} onClick={() => setRecord(student.id, selectedPractice.id, 'attendance', value)}>{value}</button>)}</div></td><td className="p-3"><select className={`${inputClass} max-w-40`} value={record.evaluation || ''} disabled={busy} onChange={(event) => setRecord(student.id, selectedPractice.id, 'evaluation', event.target.value)}><option value="">Sin evaluar</option><option value="Apto">Apto</option><option value="No Apto">No apto</option></select></td></tr>
        })}</tbody></table></div>
        {enrolled.length === 0 && <p className="p-8 text-center text-sm text-[#6b7280]">No hay alumnos matriculados en este módulo.</p>}
      </section>
    </div>
  }

  return <div className="space-y-4">
    <section className="rounded-lg border border-[#e5e7eb] bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-end justify-between gap-3"><div><h2 className="text-lg font-bold text-[#0a2540]">Prácticas ({filtered.length})</h2><p className="mt-1 text-sm text-[#6b7280]">Consulta y administra prácticas de tus módulos.</p></div>{canCreate && <button className={buttonClass} onClick={() => openForm()}>+ Nueva práctica</button>}</div>
      <div className="mt-4 grid gap-3 sm:grid-cols-3"><input className={inputClass} placeholder="Buscar por ID, título, ATA o descripción…" value={search} onChange={(event) => setSearch(event.target.value)} /><select className={inputClass} value={moduleFilter} onChange={(event) => setModuleFilter(event.target.value)}><option value="">Todos los módulos</option>{visibleModules.map((module) => <option key={module.id} value={module.id}>{module.id} · {module.name}</option>)}</select><select className={inputClass} value={ataFilter} onChange={(event) => setAtaFilter(event.target.value)}><option value="">Todos los ATA</option>{atas.map((ata) => <option key={ata}>{ata}</option>)}</select></div>
      {(setupNotice || message) && <p role="status" className="mt-3 rounded bg-blue-50 p-3 text-sm text-blue-900">{setupNotice || message}</p>}
    </section>
    <div className="space-y-3">{filtered.map((practice) => {
      const enrolledCount = memberships.filter((entry) => entry.module_id === practice.module_id).length
      return <article key={practice.id} className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-[#e5e7eb] border-l-4 border-l-[#1e88e5] bg-white p-4 shadow-sm transition hover:border-l-[#ffb300] hover:shadow-md">
        <button className="min-w-0 flex-1 text-left" onClick={() => setSelectedPractice(practice)}>
          <div className="mb-2 flex flex-wrap gap-2 text-xs"><code className="rounded bg-[#f0f7ff] px-2 py-1 font-bold text-[#0a2540]">{practice.id}</code><span className="rounded bg-[#d1ecf1] px-2 py-1 text-[#0c5460]">{practice.ata}</span><span className="rounded bg-[#fff3cd] px-2 py-1 text-[#856404]">{formatDate(practice.date)}</span><span className="rounded bg-blue-100 px-2 py-1 text-blue-900">{practice.start_time}</span></div>
          <h3 className="font-bold text-[#0a2540]">{practice.title}</h3><p className="mt-1 truncate text-sm text-[#6b7280]">{practice.detail}</p>
          {/*  Mini preview de descripción en la tarjeta */}
          {practice.description && <p className="mt-1 line-clamp-2 text-xs text-[#9ca3af]">{practice.description}</p>}
          <p className="mt-2 text-xs text-[#6b7280]">{practice.module_id} · {practice.hours} h · {enrolledCount} alumnos</p>
        </button>
        <div className="flex gap-2">{canEdit(practice) && <><button className="rounded border border-[#d1d5db] px-3 py-2 text-xs font-semibold" onClick={() => openForm(practice)}>Editar</button>{user.role === 'admin' && <button className="rounded border border-red-200 px-3 py-2 text-xs font-semibold text-red-700" onClick={() => deletePractice(practice)}>Eliminar</button>}</>}</div>
      </article>
    })}</div>
    {filtered.length === 0 && <p className="rounded-lg border border-dashed border-[#d1d5db] p-8 text-center text-sm text-[#6b7280]">{visiblePractices.length === 0 ? 'No hay prácticas asignadas. Administración debe cargar los datos iniciales y asignar el módulo al profesor.' : 'No hay prácticas que coincidan con los filtros.'}</p>}

    {formOpen && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) setFormOpen(false) }}><section role="dialog" aria-modal="true" aria-label={editing ? 'Editar práctica' : 'Nueva práctica'} className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-lg bg-white p-5 shadow-2xl"><h2 className="mb-4 text-lg font-bold text-[#0a2540]">{editing ? 'Editar práctica' : 'Nueva práctica'}</h2><form className="grid gap-4 sm:grid-cols-2" onSubmit={savePractice}>
      <label className="grid gap-1 text-sm font-semibold text-[#0a2540]">Módulo<select className={inputClass} value={form.module_id} onChange={(event) => setForm({ ...form, module_id: event.target.value })} required>{visibleModules.map((module) => <option key={module.id} value={module.id}>{module.id} · {module.name}</option>)}</select></label>
      <label className="grid gap-1 text-sm font-semibold text-[#0a2540]">ID práctica<input className={inputClass} value={form.id} onChange={(event) => setForm({ ...form, id: event.target.value })} required disabled={Boolean(editing)} /></label>
      <label className="grid gap-1 text-sm font-semibold text-[#0a2540]">ATA<input className={inputClass} value={form.ata} onChange={(event) => setForm({ ...form, ata: event.target.value })} required /></label>
      <label className="grid gap-1 text-sm font-semibold text-[#0a2540]">Título<input className={inputClass} value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} required /></label>
      <label className="grid gap-1 text-sm font-semibold text-[#0a2540] sm:col-span-2">Detalle<textarea className={inputClass} rows="2" value={form.detail || ''} onChange={(event) => setForm({ ...form, detail: event.target.value })} /></label>
      
      {/*  Descripción completa */}
      <label className="grid gap-1 text-sm font-semibold text-[#0a2540] sm:col-span-2">Descripción de la práctica
        <textarea className={inputClass} rows="4" placeholder="Explica en qué consiste la práctica..." value={form.description || ''} onChange={(event) => setForm({ ...form, description: event.target.value })} />
      </label>
      
      {/*  Objetivos editables */}
      <div className="sm:col-span-2">
        <label className="mb-2 block text-sm font-semibold text-[#0a2540]">Objetivos de aprendizaje</label>
        <div className="space-y-2">
          {objectivesInput.map((obj, idx) => (
            <div key={idx} className="flex gap-2">
              <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded bg-[#f0f7ff] text-xs font-bold text-[#0a2540]">{idx + 1}</span>
              <input className={inputClass} placeholder={`Objetivo ${idx + 1}`} value={obj} onChange={(event) => updateObjective(idx, event.target.value)} />
              <button type="button" className="rounded border border-red-200 px-2 text-xs text-red-700 hover:bg-red-50" onClick={() => removeObjective(idx)} title="Eliminar objetivo">✕</button>
            </div>
          ))}
        </div>
        <button type="button" className="mt-2 rounded border border-dashed border-[#1e88e5] px-3 py-1.5 text-xs font-semibold text-[#1e88e5] hover:bg-blue-50" onClick={addObjective}>+ Añadir objetivo</button>
      </div>

      <label className="grid gap-1 text-sm font-semibold text-[#0a2540]">Fecha<input className={inputClass} type="date" value={form.date} onChange={(event) => setForm({ ...form, date: event.target.value })} required /></label>
      <label className="grid gap-1 text-sm font-semibold text-[#0a2540]">Hora<input className={inputClass} type="time" value={form.start_time || ''} onChange={(event) => setForm({ ...form, start_time: event.target.value })} required /></label>
      <label className="grid gap-1 text-sm font-semibold text-[#0a2540]">Duración (h)<input className={inputClass} type="number" min="1" value={form.hours} onChange={(event) => setForm({ ...form, hours: event.target.value })} required /></label>
      {message && <p role="alert" className="rounded bg-red-50 p-3 text-sm text-red-800 sm:col-span-2">{message}</p>}
      <div className="flex justify-end gap-2 sm:col-span-2"><button type="button" className="rounded border border-[#d1d5db] px-4 py-2 text-sm" onClick={() => setFormOpen(false)}>Cancelar</button><button className={buttonClass} disabled={busy}>{busy ? 'Guardando…' : 'Guardar'}</button></div>
    </form></section></div>}
  </div>
}