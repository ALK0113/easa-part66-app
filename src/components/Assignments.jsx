import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { useSchool } from '../contexts/useSchool.js'
import { subscribeToTables } from '../lib/supabaseRealtime.js'
import { getSupabaseErrorMessage } from '../lib/supabaseErrors.js'
import { KIND_LABEL, groupLabel, levelLabel } from '../lib/academic.js'
import { ROLES } from '../lib/roles.js'
import { isManager, teachesLikeProfessor } from '../lib/roles.js'
import { WEEKDAYS } from '../lib/schedule.js'
import Enrollment from './Enrollment.jsx'
import { RoomSelect } from './ScheduleControls.jsx'
import { roomValues, useRooms } from '../lib/scheduleTools.js'

// Asignaciones del curso escolar actual:
//  - Alumnos: matrícula «grupo + excepciones» (src/components/Enrollment.jsx).
//  - Profesores: qué módulo imparte cada profesor y a qué grupos.

const TABS = [
  { id: 'students', label: 'Alumnos' },
  { id: 'teachers', label: 'Profesores' },
]

const moduleTitle = (item, names) => `${item.module_id} · ${names[item.module_id] || ''}`
const sortModules = (a, b) => (a.level || 99) - (b.level || 99) || a.module_id.localeCompare(b.module_id) || b.kind.localeCompare(a.kind)

function useAssignmentData(schoolId) {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [version, setVersion] = useState(0)
  const reload = useCallback(() => setVersion((value) => value + 1), [])

  useEffect(() => {
    if (!schoolId) return undefined
    let active = true
    async function load() {
      try {
        const yearResult = await supabase.from('academic_years').select('id,name,starts_on').eq('school_id', schoolId).eq('is_current', true).maybeSingle()
        if (yearResult.error) throw yearResult.error
        const year = yearResult.data
        const [degrees, modules, students, members, links] = await Promise.all([
          supabase.from('degrees').select('id,code,degree_modules(id,module_id,kind,level)').eq('school_id', schoolId).order('created_at'),
          supabase.from('modules').select('id,name'),
          supabase.from('students').select('id,name,student_number,class_name,group_name').eq('school_id', schoolId).order('name'),
          supabase.from('school_profiles').select('profile_id,profiles(id,full_name,email,role)').eq('school_id', schoolId),
          supabase.from('student_profiles').select('student_id,profile_id'),
        ])
        const yearData = year
          ? await Promise.all([
            supabase.from('class_groups').select('id,degree_id,level,name').eq('academic_year_id', year.id).order('level').order('name'),
            supabase.from('enrollments').select('student_id,group_id,level,status,left_on').eq('academic_year_id', year.id),
            supabase.from('module_enrollments').select('id,student_id,degree_module_id,group_id,is_carryover,theory_grade,practical_result,status,joined_on,left_on').eq('academic_year_id', year.id),
            supabase.from('teaching_assignments').select('id,profile_id,degree_module_id,group_id'),
          ])
          : [{ data: [] }, { data: [] }, { data: [] }, { data: [] }]
        const failed = [degrees, modules, students, members, links, ...yearData].find((result) => result.error)
        if (failed) throw failed.error
        if (!active) return
        const [groups, enrollments, moduleEnrollments, teaching] = yearData.map((result) => result.data || [])
        const groupIds = new Set(groups.map((group) => group.id))
        const profiles = (members.data || []).map((member) => member.profiles).filter(Boolean)
        setData({
          schoolId,
          year,
          degrees: degrees.data || [],
          moduleNames: Object.fromEntries((modules.data || []).map((mod) => [mod.id, mod.name])),
          students: students.data || [],
          teachers: profiles.filter((profile) => teachesLikeProfessor(profile.role)).sort((a, b) => (a.full_name || a.email).localeCompare(b.full_name || b.email)),
          studentAccounts: profiles.filter((profile) => profile.role === ROLES.STUDENT),
          links: links.data || [],
          groups,
          enrollments,
          moduleEnrollments,
          teaching: teaching.filter((item) => groupIds.has(item.group_id)),
        })
        setError('')
      } catch (err) {
        if (active) setError(getSupabaseErrorMessage(err))
      }
    }
    load()
    const unsubscribe = subscribeToTables(['class_groups', 'enrollments', 'module_enrollments', 'teaching_assignments', 'degree_modules', 'students', 'student_profiles'], load, `assignments-${schoolId}`)
    return () => { active = false; unsubscribe() }
  }, [schoolId, version])

  return { data: data?.schoolId === schoolId ? data : null, error, reload }
}

// tab + embedded: la página «Escuela» elige la sección y pone sus propios pasos
export default function Assignments({ user, tab: fixedTab = null, embedded = false }) {
  const { schoolId } = useSchool()
  const [ownTab, setTab] = useState('students')
  const tab = fixedTab || ownTab
  const [notice, setNotice] = useState(null)
  const [busy, setBusy] = useState(false)

  const { data, error, reload } = useAssignmentData(schoolId)

  // Un cambio cada vez: evita que dos clics rápidos se pisen.
  const run = useCallback(async (action, okText) => {
    setBusy(true)
    try {
      const { data: result, error: saveError } = await action()
      if (saveError) { setNotice({ error: true, text: getSupabaseErrorMessage(saveError) }); return null }
      setNotice(okText ? { error: false, text: typeof okText === 'function' ? okText(result) : okText } : null)
      reload()
      return result ?? true
    } finally {
      setBusy(false)
    }
  }, [reload])

  if (!isManager(user.role)) return <p role="alert" className="notice-error">Solo administración puede gestionar asignaciones.</p>

  return (
    <div className="space-y-5">
      {!embedded && (
        <>
          <div className="page-intro">
            <div>
              <h2>Asignaciones</h2>
              <p>{data?.year ? `Curso ${data.year.name}: qué cursa cada alumno y qué imparte cada profesor.` : 'Qué cursa cada alumno y qué imparte cada profesor.'}</p>
            </div>
          </div>

          <div className="tabs" role="tablist">
            {TABS.map((item) => <button key={item.id} type="button" role="tab" className="tab" aria-selected={tab === item.id} onClick={() => { setTab(item.id); setNotice(null) }}>{item.label}</button>)}
          </div>
        </>
      )}

      {notice && <p role={notice.error ? 'alert' : 'status'} className={notice.error ? 'notice-error' : 'notice-success'}>{notice.text}</p>}
      {error && <p role="alert" className="notice-error">{error}</p>}
      {!data && !error && <p className="text-sm text-muted">Cargando…</p>}
      {data && !data.year && (
        <div className="card empty"><p className="font-medium text-ink-soft">No hay curso escolar actual</p><p className="mt-1">Créalo en Escuela → Curso escolar.</p></div>
      )}

      {data?.year && tab === 'students' && <Enrollment data={data} run={run} busy={busy} />}
      {data?.year && tab === 'teachers' && <TeachersTab data={data} run={run} busy={busy} />}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Profesores                                                          */
/* ------------------------------------------------------------------ */

function TeachersTab({ data, run, busy }) {
  const [teacherId, setTeacherId] = useState(data.teachers[0]?.id || '')
  const teacher = data.teachers.find((item) => item.id === teacherId)
  const assignments = data.teaching.filter((item) => item.profile_id === teacherId)
  const assigned = (degreeModuleId, groupId) => assignments.find((item) => item.degree_module_id === degreeModuleId && item.group_id === groupId)

  // Tras asignar se ofrece poner ya su horario semanal (día, hora y aula) sin ir a Horario
  const [scheduleFor, setScheduleFor] = useState(null)

  async function toggle(item, group) {
    const current = assigned(item.id, group.id)
    const label = `${item.module_id} ${KIND_LABEL[item.kind].toLowerCase()} · ${groupLabel(group)}`
    if (current) { run(() => supabase.from('teaching_assignments').delete().eq('id', current.id), `Quitado: ${label}.`); return }
    const created = await run(() => supabase.from('teaching_assignments').insert({ profile_id: teacherId, degree_module_id: item.id, group_id: group.id }).select('id').single(), `Asignado: ${label}.`)
    if (created?.id) setScheduleFor({ id: created.id, label })
  }

  if (!data.teachers.length) return <div className="card empty"><p className="font-medium text-ink-soft">No hay profesores en esta escuela</p><p className="mt-1">Crea sus cuentas en Perfiles.</p></div>

  const total = assignments.length

  return (
    <div className="space-y-4">
      <label className="field max-w-sm">Profesor
        <select className="input" value={teacherId} onChange={(event) => setTeacherId(event.target.value)}>
          {data.teachers.map((item) => <option key={item.id} value={item.id}>{item.full_name || item.email}</option>)}
        </select>
      </label>
      {scheduleFor && <QuickSlotForm key={scheduleFor.id} assignment={scheduleFor} run={run} busy={busy} onDone={() => setScheduleFor(null)} />}
      <p className="text-sm text-muted">
        {total ? `${teacher?.full_name || 'Este profesor'} imparte ${total} ${total === 1 ? 'clase' : 'clases'}. Solo verá a los alumnos de esos grupos.` : 'Toca un grupo para asignarle el módulo.'}
      </p>

      {data.degrees.map((degree) => {
        const modules = [...degree.degree_modules].sort(sortModules)
        const groups = data.groups.filter((group) => group.degree_id === degree.id)
        if (!modules.length) return null
        return (
          <section key={degree.id} className="card overflow-hidden">
            {data.degrees.length > 1 && <h3 className="border-b border-line px-5 py-3 font-semibold text-ink">{degree.code}</h3>}
            <ul className="divide-y divide-line">
              {modules.map((item) => {
                // Primero los grupos del mismo curso que el módulo.
                const ordered = [...groups].sort((a, b) => (a.level === item.level ? 0 : 1) - (b.level === item.level ? 0 : 1) || a.level - b.level || a.name.localeCompare(b.name))
                return (
                  <li key={item.id} className="flex flex-col gap-2 px-5 py-3.5 sm:flex-row sm:items-center">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-ink">{moduleTitle(item, data.moduleNames)}</p>
                      <p className="text-xs text-muted">{KIND_LABEL[item.kind]} · {levelLabel(item.level)}</p>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {ordered.map((group) => {
                        const on = Boolean(assigned(item.id, group.id))
                        return (
                          <button key={group.id} type="button" disabled={busy} aria-pressed={on} onClick={() => toggle(item, group)}
                            className={`min-w-[52px] rounded-lg border px-2.5 py-1.5 text-sm font-medium ${on ? 'border-accent bg-accent text-white' : 'border-line text-ink-soft hover:bg-subtle'} ${!on && group.level !== item.level ? 'opacity-60' : ''}`}>
                            {groupLabel(group)}
                          </button>
                        )
                      })}
                      {!ordered.length && <span className="text-xs text-muted">Sin grupos</span>}
                    </div>
                  </li>
                )
              })}
            </ul>
          </section>
        )
      })}
    </div>
  )
}

// Horario semanal de una clase recién asignada. Se puede saltar y ponerlo luego en Horario → Plantilla semanal.
function QuickSlotForm({ assignment, run, busy, onDone }) {
  const { schoolId } = useSchool()
  const rooms = useRooms(schoolId)
  const [form, setForm] = useState({ weekday: '1', start_time: '09:00', end_time: '10:00', room_id: '', room_new: '' })
  async function save(event) {
    event.preventDefault()
    const ok = await run(() => supabase.from('schedule_slots').insert({
      teaching_assignment_id: assignment.id, weekday: Number(form.weekday), start_time: form.start_time, end_time: form.end_time, ...roomValues(form),
    }), `Horario guardado: ${assignment.label}, ${WEEKDAYS[Number(form.weekday) - 1].toLowerCase()} ${form.start_time}. Ya está en el calendario.`)
    if (ok) onDone()
  }
  return (
    <form className="card space-y-3 border-accent p-4" onSubmit={save}>
      <p className="text-sm font-medium text-ink">¿Cuándo es la clase de {assignment.label}?</p>
      <div className="grid gap-3 sm:grid-cols-4">
        <label className="field">Día
          <select className="input" value={form.weekday} onChange={(event) => setForm({ ...form, weekday: event.target.value })}>
            {WEEKDAYS.map((label, index) => <option key={label} value={index + 1}>{label}</option>)}
          </select>
        </label>
        <label className="field">Empieza<input className="input" type="time" required value={form.start_time} onChange={(event) => setForm({ ...form, start_time: event.target.value })} /></label>
        <label className="field">Termina<input className="input" type="time" required value={form.end_time} onChange={(event) => setForm({ ...form, end_time: event.target.value })} /></label>
        <RoomSelect rooms={rooms} form={form} setForm={setForm} />
      </div>
      <div className="flex justify-end gap-2">
        <button type="button" className="btn-ghost" onClick={onDone}>Ahora no</button>
        <button type="submit" className="btn-primary" disabled={busy}>Guardar horario</button>
      </div>
    </form>
  )
}
