import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { useSchool } from '../contexts/useSchool.js'
import { formatDate } from '../lib/format.js'
import { getSupabaseErrorMessage, isMissingTable } from '../lib/supabaseErrors.js'
import { subscribeToTables } from '../lib/supabaseRealtime.js'
import Icon from './Icon.jsx'
import { RecordSummary, StudentRecordRow } from './RecordControls.jsx'
import { ROLES, isManager, teachesLikeProfessor } from '../lib/roles.js'
import { HoursStatus, SessionsEditor } from './PracticeSessions.jsx'
import { ClassSessions, PracticeResults, SessionPage } from './SessionAttendance.jsx'
import ModuleStudents from './ModuleStudents.jsx'
import { SESSION_FIELDS, saveSessions, sessionErrors, useFreeModuleSessions, useModuleAssignments } from '../lib/practiceSessions.js'
import { compareCodes, outcomeLabel, useModuleStructure } from '../lib/curriculum.js'
import Assessments from './Assessments.jsx'
import { MODULE_HOVER, moduleStyle } from '../lib/moduleColors.js'
import { useModuleColors } from '../lib/useModuleColors.js'

const inputClass = 'input'
const buttonClass = 'btn-primary'


// Parsear objectives (puede venir como string o array desde Supabase)
function parseObjectives(value) {
  if (!value) return []
  if (Array.isArray(value)) return value
  try { return JSON.parse(value) } catch { return [] }
}

// Con una escuela elegida por el admin, solo sus prácticas y alumnos
const bySchool = (query, filterId) => (filterId ? query.eq('school_id', filterId) : query)

// Con moduleId se muestra dentro de un módulo: solo sus prácticas y sin filtro de módulo
export default function PracticeList({ user, moduleId = null, initialModuleId = null, initialPracticeId = null, onClearInitial, onCreateTLB }) {
  const { filterId } = useSchool()
  const [practices, setPractices] = useState([])
  const [modules, setModules] = useState([])
  const moduleColors = useModuleColors()
  const [students, setStudents] = useState([])
  const [memberships, setMemberships] = useState([])
  const [records, setRecords] = useState([])
  const [teacherModules, setTeacherModules] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [setupNotice, setSetupNotice] = useState('')
  const [message, setMessage] = useState('')
  const [selectedPractice, setSelectedPractice] = useState(null)
  const [openSessionId, setOpenSessionId] = useState(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [search, setSearch] = useState('')
  const [moduleFilter, setModuleFilter] = useState('')
  const [subFilter, setSubFilter] = useState('')
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
  // Sesiones (clases del horario enlazadas a cada práctica) y borrador del formulario
  const [sessions, setSessions] = useState([])
  const [sessionDraft, setSessionDraft] = useState([])

  // 🆕 Estado para objetivos en el formulario (array de strings)
  const [objectivesInput, setObjectivesInput] = useState([''])

  useEffect(() => {
    let cancelled = false
    async function load() {
      const [practiceResult, moduleResult, studentResult, membershipResult, recordResult, teacherResult, sessionResult] = await Promise.all([
        bySchool(supabase.from('practices').select('id,module_id,ata,title,detail,date,start_time,hours,description,objectives,school_id,submodule_id,learning_outcome_id').order('date', { ascending: true }), filterId),
        supabase.from('modules').select('id,name'),
        bySchool(supabase.from('students').select('id,student_number,name,group_name,promo').order('student_number', { ascending: true }), filterId),
        supabase.from('student_modules').select('student_id,module_id'),
        supabase.from('practice_records').select('student_id,practice_id,attendance,evaluation,comment'),
        teachesLikeProfessor(user?.role) ? supabase.from('teacher_modules').select('module_id').eq('profile_id', user.id) : Promise.resolve({ data: [], error: null }),
        supabase.from('class_sessions').select(SESSION_FIELDS).not('practice_id', 'is', null).order('date').order('start_time'),
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
        setSessions(sessionResult.error ? [] : sessionResult.data || [])
        if (setupErrors.length) setSetupNotice('Faltan tablas de asignaciones/asistencia. Las prácticas se muestran, pero matrículas y evaluación requieren aplicar la migración de Supabase.')
        else if (optionalError) setError(optionalError.message)
      }
      setLoading(false)
    }
    load()
    const unsubscribe = subscribeToTables(['practices', 'modules', 'students', 'student_modules', 'practice_records', 'teacher_modules', 'class_sessions'], load, 'practice-list')
    return () => { cancelled = true; unsubscribe() }
  }, [user?.id, user?.role, filterId, reloadKey])

  const visibleModules = isManager(user?.role) ? modules : modules.filter((module) => teacherModules.includes(module.id))
  const visiblePractices = practices.filter((practice) => isManager(user?.role) || teacherModules.includes(practice.module_id))
  const filtered = visiblePractices.filter((practice) => {
    const query = search.trim().toLowerCase()
    const matchesSearch = !query || [practice.id, practice.title, practice.detail, practice.ata, practice.description].some((value) => String(value || '').toLowerCase().includes(query))
    const matchesModule = moduleId ? practice.module_id === moduleId : !moduleFilter || practice.module_id === moduleFilter
    const matchesSub = !subFilter || (subFilter === 'sin' ? !practice.submodule_id : practice.submodule_id === subFilter)
    return matchesSearch && matchesModule && matchesSub && (!ataFilter || practice.ata === ataFilter)
  })
  const atas = [...new Set(visiblePractices.filter((practice) => !moduleId || practice.module_id === moduleId).map((practice) => practice.ata).filter(Boolean))].sort()
  const canCreate = isManager(user?.role) || visibleModules.length > 0
  const formAssignments = useModuleAssignments(formOpen ? form.module_id : null, user)
  // Submódulos y RA del módulo con el que se trabaja (el del formulario, la práctica abierta o el fijo)
  const structure = useModuleStructure(formOpen ? form.module_id : selectedPractice?.module_id || moduleId)
  const freeSessions = useFreeModuleSessions(formOpen ? formAssignments : null)
  const sessionsOf = (practiceId) => sessions.filter((session) => session.practice_id === practiceId)
  // Las de recuperación se gestionan aparte (no se editan en el formulario de la práctica)
  const regularSessionsOf = (practiceId) => sessionsOf(practiceId).filter((session) => !session.recovery)
  const canEdit = (practice) => isManager(user?.role) || teacherModules.includes(practice.module_id) // 🆕 helper

  function openForm(practice = null, targetModuleId = null) {
    setEditing(practice)
    const objectives = practice ? parseObjectives(practice.objectives) : ['']
    setObjectivesInput(objectives.length ? objectives : [''])
    setForm(practice 
      ? { 
          ...practice, 
          date: practice.date?.slice(0, 10) || '',
          description: practice.description || '',
          objectives: objectives,
          submodule_id: practice.submodule_id || '',
          learning_outcome_id: practice.learning_outcome_id || '',
        } 
      : { id: '', module_id: targetModuleId || moduleId || moduleFilter || visibleModules[0]?.id || '', ata: '', title: '', detail: '', date: '', start_time: '09:00', hours: 1, description: '', objectives: [], submodule_id: subFilter && subFilter !== 'sin' ? subFilter : '', learning_outcome_id: '' })
    setSessionDraft(practice ? regularSessionsOf(practice.id) : [])
    setFormOpen(true)
    window.scrollTo({ top: 0 })
    setMessage('')
  }

  // Llegada desde «Hoy» en el inicio: se abre directamente la práctica para pasar lista y evaluar
  useEffect(() => {
    if (loading || !initialPracticeId) return
    const practice = practices.find((item) => item.id === initialPracticeId)
    // eslint-disable-next-line react-hooks/set-state-in-effect -- se aplica una sola vez al llegar
    if (practice) setSelectedPractice(practice)
    onClearInitial?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- solo al terminar de cargar
  }, [loading, initialPracticeId])

  // Llegada desde un módulo («Nueva práctica en M7»): filtro y formulario con ese módulo
  useEffect(() => {
    if (loading || !initialModuleId) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- se aplica una sola vez al llegar
    setModuleFilter(initialModuleId)
    openForm(null, initialModuleId)
    onClearInitial?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- solo al terminar de cargar
  }, [loading, initialModuleId])

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
    if (!sessionDraft.length) { setMessage(formAssignments?.length === 0 ? 'Este módulo no tiene clase en el horario: asígnalo a un grupo y profesor en «Escuela» para programar sus sesiones.' : 'Programa al menos una sesión en el horario: todas las clases se imparten en sesiones con control de asistencia.'); return }
    const invalidSession = sessionErrors(sessionDraft)
    if (invalidSession) { setMessage(invalidSession); return }
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
      objectives: cleanObjectives,          //  se guarda como array (Supabase JSONB)
      submodule_id: form.submodule_id || null,
      learning_outcome_id: form.learning_outcome_id || null,
    }
    delete payload.school_id
    // Con sesiones, la fecha y la hora de la práctica son las de la primera sesión
    const firstSession = [...sessionDraft].sort((a, b) => `${a.date} ${a.start_time}`.localeCompare(`${b.date} ${b.start_time}`))[0]
    if (firstSession) { payload.date = firstSession.date; payload.start_time = firstSession.start_time }
    const result = editing
      ? await supabase.from('practices').update(payload).eq('id', editing.id)
      : await supabase.from('practices').insert(filterId ? { ...payload, school_id: filterId } : payload)
    if (result.error) { setBusy(false); setMessage(result.error.message); return }
    try {
      await saveSessions(payload.id, editing ? regularSessionsOf(editing.id) : [], sessionDraft)
    } catch (sessionError) {
      setBusy(false)
      setMessage(`Práctica guardada, pero las sesiones no: ${getSupabaseErrorMessage(sessionError)}`)
      return
    }
    setBusy(false)
    setFormOpen(false)
    setMessage('Práctica guardada.')
    const { data: sessionRows } = await supabase.from('class_sessions').select(SESSION_FIELDS).not('practice_id', 'is', null).order('date').order('start_time')
    setSessions(sessionRows || [])
    const { data } = await bySchool(supabase.from('practices').select('id,module_id,ata,title,detail,date,start_time,hours,description,objectives,school_id,submodule_id,learning_outcome_id').order('date', { ascending: true }), filterId)
    setPractices(data || [])
    // Si se editó desde el detalle, el detalle muestra los datos nuevos
    setSelectedPractice((current) => (current ? (data || []).find((item) => item.id === current.id) || current : current))
  }

  async function refreshSessions() {
    const { data } = await supabase.from('class_sessions').select(SESSION_FIELDS).not('practice_id', 'is', null).order('date').order('start_time')
    if (data) setSessions(data)
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

  if (loading) return <div className="flex min-h-[40vh] items-center justify-center text-sm text-muted">Cargando prácticas…</div>
  if (error) return <div role="alert" className="notice-error">Error al cargar prácticas: {error}</div>

  // Edición en la misma página (sin ventana): sustituye al detalle o al listado mientras se edita
  if (formOpen) return <div className="fade-in space-y-5">
    <button type="button" className="back-link" onClick={() => setFormOpen(false)}>← {editing ? editing.title : 'Prácticas'}</button>
    <section className="card p-6"><h2 className="mb-5 text-xl font-semibold text-ink">{editing ? 'Editar práctica' : 'Nueva práctica'}</h2><form className="grid gap-4 sm:grid-cols-2" onSubmit={savePractice}>
      <label className="field">Módulo<select className={inputClass} value={form.module_id} onChange={(event) => setForm({ ...form, module_id: event.target.value })} required>{visibleModules.map((module) => <option key={module.id} value={module.id}>{module.id} · {module.name}</option>)}</select></label>
      <label className="field">ID práctica<input className={inputClass} value={form.id} onChange={(event) => setForm({ ...form, id: event.target.value })} required disabled={Boolean(editing)} /></label>
      <label className="field">ATA<input className={inputClass} value={form.ata} onChange={(event) => setForm({ ...form, ata: event.target.value })} required /></label>
      <label className="field">Título<input className={inputClass} value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} required /></label>
      <label className="field">Submódulo
        <select className={inputClass} value={form.submodule_id || ''} onChange={(event) => setForm({ ...form, submodule_id: event.target.value })}>
          <option value="">{structure.submodules.length ? 'Sin submódulo' : 'Sin submódulos (Escuela → Grado y módulos)'}</option>
          {[...structure.submodules].sort((a, b) => compareCodes(a.code, b.code)).map((sub) => <option key={sub.id} value={sub.id}>{sub.code} · {sub.name}</option>)}
        </select>
      </label>
      <label className="field">RA
        <select className={inputClass} value={form.learning_outcome_id || ''} onChange={(event) => setForm({ ...form, learning_outcome_id: event.target.value })}>
          <option value="">{structure.outcomes.length ? 'Sin RA' : 'Sin RA (Escuela → Currículum oficial)'}</option>
          {structure.outcomes.map((outcome) => <option key={outcome.id} value={outcome.id}>{outcomeLabel(outcome)} – {outcome.description.slice(0, 60)}</option>)}
        </select>
      </label>
      <label className="field sm:col-span-2">Detalle<textarea className={inputClass} rows="2" value={form.detail || ''} onChange={(event) => setForm({ ...form, detail: event.target.value })} /></label>
      
      {/*  Descripción completa */}
      <label className="field sm:col-span-2">Descripción de la práctica
        <textarea className={inputClass} rows="4" placeholder="Explica en qué consiste la práctica..." value={form.description || ''} onChange={(event) => setForm({ ...form, description: event.target.value })} />
      </label>
      
      {/*  Objetivos editables */}
      <div className="sm:col-span-2">
        <label className="mb-2 block text-sm font-medium text-ink-soft">Objetivos de aprendizaje</label>
        <div className="space-y-2">
          {objectivesInput.map((obj, idx) => (
            <div key={idx} className="flex gap-2">
              <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-accent-soft text-xs font-semibold text-ink">{idx + 1}</span>
              <input className={inputClass} placeholder={`Objetivo ${idx + 1}`} value={obj} onChange={(event) => updateObjective(idx, event.target.value)} />
              <button type="button" className="rounded-lg px-2 text-muted hover:bg-danger-soft hover:text-danger" onClick={() => removeObjective(idx)} aria-label="Eliminar objetivo"><Icon name="x" size={16} /></button>
            </div>
          ))}
        </div>
        <button type="button" className="btn-ghost mt-2 min-h-[34px] px-2 text-xs text-accent" onClick={addObjective}><Icon name="plus" size={14} />Añadir objetivo</button>
      </div>

      <label className="field">Duración total (h)<input className={inputClass} type="number" min="1" value={form.hours} onChange={(event) => setForm({ ...form, hours: event.target.value })} required /></label>
      <div className="hidden sm:block" />
      <SessionsEditor sessions={sessionDraft} onChange={setSessionDraft} assignments={formAssignments} freeSessions={freeSessions} requiredHours={form.hours} />
      {message && <p role="alert" className="notice-error sm:col-span-2">{message}</p>}
      <div className="flex justify-end gap-2 sm:col-span-2"><button type="button" className="btn-secondary" onClick={() => setFormOpen(false)}>Cancelar</button><button className={buttonClass} disabled={busy}>{busy ? 'Guardando…' : 'Guardar'}</button></div>
    </form></section>
  </div>

  if (selectedPractice) {
    const enrolled = getEnrolledStudents(selectedPractice)
    const summary = { P: 0, L: 0, A: 0, apto: 0 }
    enrolled.forEach((student) => {
      const record = getRecord(student.id, selectedPractice.id)
      if (record.attendance) summary[record.attendance] += 1
      if (record.evaluation === 'Apto') summary.apto += 1
    })
    const objectives = parseObjectives(selectedPractice.objectives)
    const hasSessions = sessionsOf(selectedPractice.id).length > 0
    const practiceSessions = sessionsOf(selectedPractice.id)
    const openSession = practiceSessions.find((session) => session.id === openSessionId)
    if (openSession) {
      return <SessionPage session={openSession} index={practiceSessions.filter((session) => session.recovery === openSession.recovery).indexOf(openSession)} className={selectedPractice.title} canEdit={canEdit(selectedPractice)} onBack={() => setOpenSessionId(null)} onChanged={refreshSessions} onRemoved={async () => { setOpenSessionId(null); await refreshSessions() }} />
    }
    const moduleName = modules.find((module) => module.id === selectedPractice.module_id)?.name
    const practiceSub = structure.submodules.find((sub) => sub.id === selectedPractice.submodule_id)
    const practiceOutcome = structure.outcomes.find((outcome) => outcome.id === selectedPractice.learning_outcome_id)
    const meta = [selectedPractice.ata].filter(Boolean).join(' · ')
    return <div className="space-y-6">
      <button type="button" className="back-link" onClick={() => { setSelectedPractice(null); setOpenSessionId(null) }}>← Prácticas</button>
      <section>
        <p className="text-xs font-medium uppercase tracking-wide text-faint">{selectedPractice.module_id}{moduleName ? ` · ${moduleName}` : ''}</p>
        <div className="mt-1 flex items-start justify-between gap-4">
          <h2 className="min-w-0 text-2xl font-semibold text-ink">{selectedPractice.title}</h2>
          <span className="shrink-0 text-right"><span className="block text-[11px] font-medium uppercase tracking-wide text-faint">Nº de práctica</span><span className="block text-2xl font-semibold tabular-nums text-ink">{selectedPractice.id}</span></span>
        </div>
        {meta && <p className="mt-1 text-sm text-muted">{meta}</p>}
        {(practiceSub || practiceOutcome) && (
          <div className="mt-2 flex flex-wrap gap-1.5 text-xs">
            {practiceSub && <span className="badge bg-subtle py-0.5 text-ink-soft" title="Submódulo">{practiceSub.code} · {practiceSub.name}</span>}
            {practiceOutcome && <span className="badge max-w-full bg-accent-soft py-0.5 text-accent-strong" title={practiceOutcome.description}><span className="truncate">{outcomeLabel(practiceOutcome)} – {practiceOutcome.description}</span></span>}
          </div>
        )}
        {selectedPractice.detail && <p className="mt-2 text-sm text-muted">{selectedPractice.detail}</p>}
        <div className="mt-4 flex flex-wrap gap-2 text-sm">
          {canEdit(selectedPractice) && <button type="button" className="btn-secondary h-8 px-3 text-xs" onClick={() => openForm(selectedPractice)}><Icon name="edit" size={14} />Editar práctica</button>}
          {canEdit(selectedPractice) && onCreateTLB && <button type="button" className="btn-ghost h-8 px-3 text-xs" onClick={() => onCreateTLB({ module_id: selectedPractice.module_id, practice_id: selectedPractice.id })}><Icon name="plus" size={14} />Crear TLB</button>}
          <span className="badge gap-1.5 bg-surface py-1"><Icon name="calendar" size={14} className="text-faint" />{formatDate(selectedPractice.date)}</span>
          {selectedPractice.start_time && <span className="badge gap-1.5 bg-surface py-1"><Icon name="clock" size={14} className="text-faint" />{String(selectedPractice.start_time).slice(0, 5)} · {selectedPractice.hours} h</span>}
          <span className="badge gap-1.5 bg-surface py-1"><Icon name="users" size={14} className="text-faint" />{enrolled.length} alumnos</span>
        </div>
      </section>

      {(selectedPractice.description || objectives.length > 0) && (
        <section className="card grid gap-5 p-6 md:grid-cols-2">
          {selectedPractice.description && (
            <div>
              <h3 className="mb-2 text-sm font-semibold text-ink">Descripción</h3>
              <p className="text-sm leading-relaxed text-ink-soft">{selectedPractice.description}</p>
            </div>
          )}
          {objectives.length > 0 && (
            <div>
              <h3 className="mb-2 text-sm font-semibold text-ink">Objetivos</h3>
              <ul className="space-y-2 text-sm text-ink-soft">
                {objectives.map((obj, idx) => (
                  <li key={idx} className="flex gap-2.5">
                    <Icon name="check" size={16} className="mt-0.5 text-accent" />
                    <span>{obj}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      <ClassSessions key={reloadKey} sessions={practiceSessions} requiredHours={selectedPractice.hours} canEdit={canEdit(selectedPractice)} isStudent={user.role === ROLES.STUDENT} editHint={canEdit(selectedPractice) ? 'Edita la práctica para añadir sus sesiones.' : ''} onOpenSession={setOpenSessionId} owner={{ practice_id: selectedPractice.id }} moduleId={selectedPractice.module_id} user={user} onSessionsChanged={refreshSessions} />

      <RecordSummary items={[['Presentes', summary.P, 'bg-success'], ['Tarde', summary.L, 'bg-warn'], ['Faltas', summary.A, 'bg-danger'], ['Aptos', `${summary.apto}/${enrolled.length}`, 'bg-accent']]} />

      {canEdit(selectedPractice) && (
        <details className="card group">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-5">
            <span><span className="font-semibold text-ink">Alumnos de la clase</span> <span className="text-sm text-muted">· {enrolled.length}</span></span>
            <span className="flex items-center gap-1 text-xs font-medium text-accent">{isManager(user.role) ? <><Icon name="plus" size={14} />Añadir o ver</> : 'Ver lista'}</span>
          </summary>
          <div className="border-t border-line p-5">
            <ModuleStudents moduleId={selectedPractice.module_id} user={user} onChanged={() => setReloadKey((value) => value + 1)} />
          </div>
        </details>
      )}

      {hasSessions && <PracticeResults key={`${selectedPractice.id}-${reloadKey}`} practice={selectedPractice} sessions={practiceSessions} students={enrolled} records={records.filter((record) => record.practice_id === selectedPractice.id)} canEdit={canEdit(selectedPractice)} onSessionsChanged={refreshSessions} />}

      {!hasSessions && <section className="card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 pb-3 pt-5">
          <div>
            <h3 className="font-semibold text-ink">{hasSessions ? 'Evaluación' : 'Asistencia y evaluación'}</h3>
            <p className="mt-0.5 text-xs text-muted">{hasSessions ? 'La asistencia se pasa en cada sesión; aquí se ve el resumen (falta si faltó a alguna sesión, tarde si llegó tarde a alguna).' : 'Se guarda al instante.'}</p>
          </div>
          {enrolled.length > 0 && !hasSessions && (
            <div className="flex gap-2">
              <button className="btn-secondary min-h-[36px] px-3 text-xs" disabled={busy} onClick={() => markAll('P')}><Icon name="check" size={14} className="text-success" />Todos presentes</button>
              <button className="btn-ghost min-h-[36px] px-3 text-xs text-muted" disabled={busy} onClick={() => markAll('A')}>Todos falta</button>
            </div>
          )}
        </div>
        {message && <p role="status" className="notice mx-5 mb-3">{message}</p>}
        <ul className="divide-y divide-line border-t border-line">
          {enrolled.map((student) => (
            <StudentRecordRow
              key={student.id}
              student={student}
              record={getRecord(student.id, selectedPractice.id)}
              busy={busy}
              meta={[student.group_name, student.promo].filter(Boolean).join(' · ') || '—'}
              attendanceLocked={hasSessions}
              onAttendance={(value) => setRecord(student.id, selectedPractice.id, 'attendance', value)}
              onEvaluation={(value) => setRecord(student.id, selectedPractice.id, 'evaluation', value)}
            />
          ))}
        </ul>
        {enrolled.length === 0 && <p className="empty">No hay alumnos matriculados en este módulo.</p>}
      </section>}

      <Assessments user={user} schoolId={filterId || selectedPractice.school_id} moduleId={selectedPractice.module_id} practiceId={selectedPractice.id} outcomes={structure.outcomes} canEdit={canEdit(selectedPractice)} />
    </div>
  }

  const unscheduled = filtered.filter((practice) => canEdit(practice) && !sessionsOf(practice.id).length).length
  return <div className="space-y-5">
    {moduleId
      ? <div className="flex items-center justify-between gap-3"><p className="text-sm text-muted">{filtered.length} {filtered.length === 1 ? 'práctica' : 'prácticas'}</p>{canCreate && <button className={buttonClass} onClick={() => openForm()}><Icon name="plus" size={16} />Nueva práctica</button>}</div>
      : <div className="page-intro"><div><h2>Prácticas</h2><p>{filtered.length} {filtered.length === 1 ? 'práctica' : 'prácticas'} de tus módulos</p></div>{canCreate && <button className={buttonClass} onClick={() => openForm()}><Icon name="plus" size={16} />Nueva práctica</button>}</div>}
    <section>
      <div className={`grid gap-2 ${moduleId ? 'sm:grid-cols-[2fr_1fr]' : 'sm:grid-cols-[2fr_1fr_1fr]'}`}><div className="relative"><Icon name="search" size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" /><input className={`${inputClass} pl-9`} placeholder="Buscar práctica…" value={search} onChange={(event) => setSearch(event.target.value)} /></div>{!moduleId && <select className={inputClass} value={moduleFilter} onChange={(event) => setModuleFilter(event.target.value)}><option value="">Todos los módulos</option>{visibleModules.map((module) => <option key={module.id} value={module.id}>{module.id} · {module.name}</option>)}</select>}<select className={inputClass} value={ataFilter} onChange={(event) => setAtaFilter(event.target.value)}><option value="">Todos los ATA</option>{atas.map((ata) => <option key={ata}>{ata}</option>)}</select></div>
      {moduleId && structure.submodules.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5" role="radiogroup" aria-label="Submódulo">
          {[['', 'Todos'], ...[...structure.submodules].sort((a, b) => compareCodes(a.code, b.code)).map((sub) => [sub.id, sub.code]), ['sin', 'Sin submódulo']].map(([id, label]) => (
            <button key={id || 'all'} type="button" role="radio" aria-checked={subFilter === id} onClick={() => setSubFilter(id)}
              className={`rounded-lg border px-2.5 py-1 text-xs font-medium ${subFilter === id ? 'border-accent bg-accent-soft text-accent-strong' : 'border-line text-ink-soft hover:bg-subtle'}`}>{label}</button>
          ))}
        </div>
      )}
      {(setupNotice || message) && <p role="status" className="notice mt-3">{setupNotice || message}</p>}
      {unscheduled > 0 && <p className="notice-error mt-3">{unscheduled === 1 ? '1 práctica sin programar en el horario.' : `${unscheduled} prácticas sin programar en el horario.`} Edítalas para añadir sus sesiones.</p>}
    </section>
    <div className="space-y-2">{filtered.map((practice) => {
      const enrolledCount = memberships.filter((entry) => entry.module_id === practice.module_id).length
      return <article key={practice.id} className={`card group flex items-center gap-4 border-l-[3px] border-r-[3px] p-2 pr-3 ${MODULE_HOVER}`} style={moduleStyle(moduleColors[practice.module_id])}>
        <button className="flex min-w-0 flex-1 items-center gap-4 rounded-xl p-2 text-left" onClick={() => setSelectedPractice(practice)}>
          <span className="flex w-14 shrink-0 flex-col items-center rounded-xl bg-subtle py-2">
            <span className="text-[11px] text-muted">{practice.date ? new Date(`${practice.date}T00:00`).toLocaleDateString('es-ES', { month: 'short' }).replace('.', '') : '—'}</span>
            <span className="text-lg font-semibold leading-none text-ink">{practice.date ? Number(String(practice.date).slice(8, 10)) : ''}</span>
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[11px] font-medium uppercase tracking-wide text-faint tabular-nums">{practice.module_id}{structure.submodules.find((sub) => sub.id === practice.submodule_id) && <><span className="mx-1.5 text-line-strong">·</span>{structure.submodules.find((sub) => sub.id === practice.submodule_id).code}</>}</span>
            <span className="mt-0.5 block truncate font-medium text-ink">{practice.title}</span>
            <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
              {structure.outcomes.find((outcome) => outcome.id === practice.learning_outcome_id) && <span className="badge py-0">{outcomeLabel(structure.outcomes.find((outcome) => outcome.id === practice.learning_outcome_id))}</span>}
              <span>{practice.ata}</span>
              {practice.start_time && <span>· {String(practice.start_time).slice(0, 5)}</span>}
              {sessionsOf(practice.id).length ? <span>· <HoursStatus compact sessions={sessionsOf(practice.id)} requiredHours={practice.hours} /></span> : <span className="font-medium text-danger">· Sin programar</span>}
              <span>· {enrolledCount} alumnos</span>
            </span>
          </span>
          <span className="shrink-0 rounded-lg px-2 py-1 text-sm font-semibold tabular-nums text-ink" style={{ backgroundColor: 'color-mix(in srgb, var(--module) 12%, var(--surface))' }} title="Nº de práctica">Nº {practice.id}</span>
        </button>
        {canEdit(practice) && <div className="flex gap-1 text-muted">
          {onCreateTLB && <button className="rounded-lg p-2 hover:bg-subtle hover:text-ink" aria-label={`Crear TLB de ${practice.title}`} title="Crear TLB" onClick={() => onCreateTLB({ module_id: practice.module_id, practice_id: practice.id })}><Icon name="clipboard" size={16} /></button>}
          <button className="rounded-lg p-2 hover:bg-subtle hover:text-ink" aria-label={`Editar ${practice.title}`} onClick={() => openForm(practice)}><Icon name="edit" size={16} /></button>
          {isManager(user.role) && <button className="rounded-lg p-2 hover:bg-danger-soft hover:text-danger" aria-label={`Eliminar ${practice.title}`} onClick={() => deletePractice(practice)}><Icon name="trash" size={16} /></button>}
        </div>}
        <Icon name="next" size={16} className="hidden text-faint group-hover:text-accent sm:block" />
      </article>
    })}</div>
    {filtered.length === 0 && <p className="card empty">{moduleId && !search && !ataFilter ? 'Este módulo aún no tiene prácticas.' : visiblePractices.length === 0 ? 'No hay prácticas asignadas. Administración debe cargar los datos iniciales y asignar el módulo al profesor.' : 'No hay prácticas que coincidan con los filtros.'}</p>}

  </div>
}