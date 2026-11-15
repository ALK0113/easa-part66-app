import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { subscribeToTables } from '../lib/supabaseRealtime.js'
import { getSupabaseErrorMessage } from '../lib/supabaseErrors.js'
import { KIND_LABEL, groupLabel, levelLabel } from '../lib/academic.js'
import { ROLES } from '../lib/roles.js'
import Icon from './Icon.jsx'
import { isManager, teachesLikeProfessor } from '../lib/roles.js'

// Asignaciones del curso escolar actual:
//  - Grupos: matricular a todo un grupo en módulos del grado.
//  - Alumnos: grupo, módulos y cuenta de acceso de cada alumno.
//  - Profesores: qué módulo imparte cada profesor y a qué grupos.

const TABS = [
  { id: 'groups', label: 'Grupos' },
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
        const yearResult = await supabase.from('academic_years').select('id,name').eq('school_id', schoolId).eq('is_current', true).maybeSingle()
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
            supabase.from('enrollments').select('student_id,group_id,level').eq('academic_year_id', year.id),
            supabase.from('module_enrollments').select('id,student_id,degree_module_id,group_id,is_carryover,theory_grade,practical_result').eq('academic_year_id', year.id),
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

export default function Assignments({ user }) {
  const [schools, setSchools] = useState([])
  const [schoolId, setSchoolId] = useState('')
  const [tab, setTab] = useState('groups')
  const [notice, setNotice] = useState(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    supabase.from('schools').select('id,name').order('name').then(({ data, error }) => {
      if (error) { setNotice({ error: true, text: getSupabaseErrorMessage(error) }); return }
      setSchools(data || [])
      setSchoolId((current) => current || data?.[0]?.id || '')
    })
  }, [])

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
      <div className="page-intro">
        <div>
          <h2>Asignaciones</h2>
          <p>{data?.year ? `Curso ${data.year.name}: qué cursa cada alumno y qué imparte cada profesor.` : 'Qué cursa cada alumno y qué imparte cada profesor.'}</p>
        </div>
        {schools.length > 1 && (
          <select className="input w-auto min-w-48" value={schoolId} onChange={(event) => setSchoolId(event.target.value)} aria-label="Escuela">
            {schools.map((school) => <option key={school.id} value={school.id}>{school.name}</option>)}
          </select>
        )}
      </div>

      <div className="tabs" role="tablist">
        {TABS.map((item) => <button key={item.id} type="button" role="tab" className="tab" aria-selected={tab === item.id} onClick={() => { setTab(item.id); setNotice(null) }}>{item.label}</button>)}
      </div>

      {notice && <p role={notice.error ? 'alert' : 'status'} className={notice.error ? 'notice-error' : 'notice-success'}>{notice.text}</p>}
      {error && <p role="alert" className="notice-error">{error}</p>}
      {!data && !error && <p className="text-sm text-muted">Cargando…</p>}
      {data && !data.year && (
        <div className="card empty"><p className="font-medium text-ink-soft">No hay curso escolar actual</p><p className="mt-1">Créalo en Estructura académica → Cursos escolares.</p></div>
      )}

      {data?.year && tab === 'groups' && <GroupsTab data={data} run={run} busy={busy} />}
      {data?.year && tab === 'students' && <StudentsTab data={data} run={run} busy={busy} />}
      {data?.year && tab === 'teachers' && <TeachersTab data={data} run={run} busy={busy} />}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Grupos                                                              */
/* ------------------------------------------------------------------ */

function GroupsTab({ data, run, busy }) {
  const [groupId, setGroupId] = useState(data.groups[0]?.id || '')
  const [selected, setSelected] = useState([])
  const group = data.groups.find((item) => item.id === groupId)
  const degree = data.degrees.find((item) => item.id === group?.degree_id)
  const members = data.enrollments.filter((enrollment) => enrollment.group_id === groupId).map((enrollment) => enrollment.student_id)
  const modules = [...(degree?.degree_modules || [])].sort(sortModules)
  const enrolledCount = (degreeModuleId) => data.moduleEnrollments.filter((item) => item.degree_module_id === degreeModuleId && members.includes(item.student_id)).length

  function chooseGroup(id) {
    setGroupId(id)
    setSelected([])
  }

  async function enroll(event) {
    event.preventDefault()
    const ok = await run(
      () => supabase.rpc('admin_enroll_group', { p_group_id: groupId, p_degree_module_ids: selected }),
      (result) => `Hecho: ${result?.added ?? 0} matrícula(s) nueva(s) en ${groupLabel(group)}.`,
    )
    if (ok) setSelected([])
  }

  if (!data.groups.length) return <div className="card empty"><p className="font-medium text-ink-soft">No hay grupos en el curso actual</p><p className="mt-1">Créalos en Estructura académica → Grupos.</p></div>

  return (
    <form className="card space-y-5 p-5 md:p-6" onSubmit={enroll}>
      <div>
        <h3 className="font-semibold text-ink">Matricular un grupo en módulos</h3>
        <p className="mt-1 text-sm text-muted">Todos los alumnos del grupo cursarán los módulos marcados. Lo que ya cursan se mantiene.</p>
      </div>
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Grupo">
        {data.groups.map((item) => (
          <button key={item.id} type="button" role="radio" aria-checked={item.id === groupId} onClick={() => chooseGroup(item.id)}
            className={`rounded-xl border px-4 py-2 text-sm font-semibold ${item.id === groupId ? 'border-accent bg-accent-soft text-accent-strong' : 'border-line text-ink-soft hover:bg-subtle'}`}>
            {groupLabel(item)}
          </button>
        ))}
      </div>
      <p className="text-sm text-muted">{members.length} {members.length === 1 ? 'alumno' : 'alumnos'} en {groupLabel(group)}</p>

      {modules.length === 0 ? <p className="text-sm text-muted">El grado {degree?.code} aún no tiene módulos. Añádelos en Estructura académica.</p> : (
        <fieldset className="grid gap-2 sm:grid-cols-2" disabled={busy}>
          <legend className="sr-only">Módulos</legend>
          {modules.map((item) => {
            const count = enrolledCount(item.id)
            const complete = members.length > 0 && count === members.length
            return (
              <label key={item.id} className={`choice ${item.level === group?.level ? '' : 'opacity-70'}`}>
                <input type="checkbox" disabled={complete} checked={complete || selected.includes(item.id)}
                  onChange={(event) => setSelected((current) => (event.target.checked ? [...current, item.id] : current.filter((id) => id !== item.id)))} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{moduleTitle(item, data.moduleNames)}</span>
                  <span className="text-xs text-muted">{KIND_LABEL[item.kind]} · {levelLabel(item.level)}</span>
                </span>
                <span className="text-xs tabular-nums text-muted">{count}/{members.length}</span>
              </label>
            )
          })}
        </fieldset>
      )}
      <div className="flex justify-end">
        <button type="submit" className="btn-primary" disabled={busy || !selected.length || !members.length}>Matricular {selected.length ? `(${selected.length})` : ''}</button>
      </div>
    </form>
  )
}

/* ------------------------------------------------------------------ */
/* Alumnos                                                             */
/* ------------------------------------------------------------------ */

function StudentsTab({ data, run, busy }) {
  const [studentId, setStudentId] = useState('')
  const [query, setQuery] = useState('')
  const enrollmentByStudent = useMemo(() => Object.fromEntries(data.enrollments.map((item) => [item.student_id, item])), [data.enrollments])
  const groupById = useMemo(() => Object.fromEntries(data.groups.map((group) => [group.id, group])), [data.groups])

  const matches = data.students.filter((student) => {
    const text = query.trim().toLowerCase()
    return !text || student.name?.toLowerCase().includes(text) || String(student.student_number || '').includes(text)
  })
  const student = data.students.find((item) => item.id === studentId)
  const enrollment = enrollmentByStudent[studentId]
  const group = groupById[enrollment?.group_id]
  const degree = data.degrees.find((item) => item.id === group?.degree_id) || data.degrees[0]
  const mine = data.moduleEnrollments.filter((item) => item.student_id === studentId)
  const linkedProfile = data.links.find((link) => link.student_id === studentId)?.profile_id || ''

  // Cambiar de grupo: se escribe el curso/grupo del alumno y la matrícula se recalcula sola.
  function changeGroup(newGroupId) {
    const target = groupById[newGroupId]
    if (!target) return
    run(() => supabase.from('students').update({ class_name: `${target.level}º`, group_name: groupLabel(target) }).eq('id', studentId), `${student.name} pasa a ${groupLabel(target)}.`)
  }

  function toggleModule(item, checked) {
    const current = mine.find((entry) => entry.degree_module_id === item.id)
    if (checked) {
      if (!enrollment) return
      run(() => supabase.from('module_enrollments').insert({ student_id: studentId, degree_module_id: item.id, academic_year_id: data.year.id, group_id: enrollment.group_id }))
    } else if (current) {
      run(() => supabase.from('module_enrollments').delete().eq('id', current.id))
    }
  }

  function linkAccount(profileId) {
    run(() => supabase.rpc('admin_link_student_profile', { p_student_id: studentId, p_profile_id: profileId || null }), profileId ? 'Cuenta vinculada.' : 'Cuenta desvinculada.')
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
      <section className="card flex max-h-[70vh] flex-col overflow-hidden">
        <div className="relative border-b border-line p-3">
          <Icon name="search" size={16} className="pointer-events-none absolute left-6 top-1/2 -translate-y-1/2 text-faint" />
          <input type="search" className="input pl-9" placeholder="Buscar alumno…" value={query} onChange={(event) => setQuery(event.target.value)} />
        </div>
        <ul className="flex-1 overflow-y-auto p-1.5">
          {matches.map((item) => (
            <li key={item.id}>
              <button type="button" onClick={() => setStudentId(item.id)}
                className={`flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm ${item.id === studentId ? 'bg-accent-soft font-medium text-accent-strong' : 'text-ink-soft hover:bg-subtle'}`}>
                <span className="truncate">{item.name}</span>
                <span className="shrink-0 text-xs text-muted">{groupLabel(groupById[enrollmentByStudent[item.id]?.group_id]) === '—' ? '' : groupLabel(groupById[enrollmentByStudent[item.id]?.group_id])}</span>
              </button>
            </li>
          ))}
          {!matches.length && <li className="px-3 py-6 text-center text-sm text-muted">Sin resultados</li>}
        </ul>
      </section>

      {!student ? (
        <div className="card empty self-start"><p className="font-medium text-ink-soft">Elige un alumno</p><p className="mt-1">Verás su grupo, sus módulos y su cuenta de acceso.</p></div>
      ) : (
        <section className="card space-y-5 self-start p-5 md:p-6">
          <div>
            <h3 className="text-lg font-semibold text-ink">{student.name}</h3>
            <p className="text-sm text-muted">Nº {student.student_number || '—'}</p>
          </div>

          <label className="field max-w-xs">Grupo
            <select className="input" value={enrollment?.group_id || ''} disabled={busy} onChange={(event) => changeGroup(event.target.value)}>
              {!enrollment && <option value="">Sin grupo</option>}
              {data.groups.map((item) => <option key={item.id} value={item.id}>{groupLabel(item)}</option>)}
            </select>
          </label>

          <fieldset disabled={busy || !enrollment}>
            <legend className="mb-2 text-sm font-medium text-ink-soft">Módulos que cursa este curso</legend>
            {!enrollment && <p className="mb-2 text-sm text-muted">Asígnale un grupo para poder matricularlo en módulos.</p>}
            <div className="grid gap-2 sm:grid-cols-2">
              {[...(degree?.degree_modules || [])].sort(sortModules).map((item) => {
                const entry = mine.find((row) => row.degree_module_id === item.id)
                const graded = entry && (entry.theory_grade != null || entry.practical_result)
                return (
                  <label key={item.id} className="choice" title={graded ? 'Tiene nota: no se puede quitar' : undefined}>
                    <input type="checkbox" checked={Boolean(entry)} disabled={graded} onChange={(event) => toggleModule(item, event.target.checked)} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{moduleTitle(item, data.moduleNames)}</span>
                      <span className="text-xs text-muted">
                        {KIND_LABEL[item.kind]} · {levelLabel(item.level)}
                        {entry?.is_carryover && <span className="text-warn"> · Arrastrado con {groupLabel(groupById[entry.group_id])}</span>}
                      </span>
                    </span>
                  </label>
                )
              })}
            </div>
          </fieldset>

          <label className="field max-w-md">Cuenta de acceso
            <select className="input" value={linkedProfile} disabled={busy} onChange={(event) => linkAccount(event.target.value)}>
              <option value="">Sin vincular</option>
              {data.studentAccounts.map((profile) => <option key={profile.id} value={profile.id}>{profile.full_name || profile.email} · {profile.email}</option>)}
            </select>
          </label>
        </section>
      )}
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

  function toggle(item, group) {
    const current = assigned(item.id, group.id)
    const label = `${item.module_id} ${KIND_LABEL[item.kind].toLowerCase()} · ${groupLabel(group)}`
    if (current) run(() => supabase.from('teaching_assignments').delete().eq('id', current.id), `Quitado: ${label}.`)
    else run(() => supabase.from('teaching_assignments').insert({ profile_id: teacherId, degree_module_id: item.id, group_id: group.id }), `Asignado: ${label}.`)
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
