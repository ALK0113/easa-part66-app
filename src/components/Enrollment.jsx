import { useMemo, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { KIND_LABEL, groupLabel, levelLabel } from '../lib/academic.js'
import { useStudentConflicts } from '../lib/conflicts.js'
import Icon from './Icon.jsx'
import ConflictNotice from './StudentConflicts.jsx'

// Matrícula «Grupo + excepciones», en un solo sitio.
// Estar en un grupo = cursar todos los módulos de su curso con ese grupo (lo hace la base de datos).
// Aquí solo se apuntan las excepciones: convalidado, exento, no cursa, módulos de otro curso o grado,
// altas tardías, cambios de grupo y bajas.

const SUELTOS = '__sueltos'
const SIN = '__sin'
const MODES = [
  ['cursa', 'Cursa', 'border-success bg-success-soft text-success'],
  ['convalidado', 'Convalidado', 'border-accent bg-accent-soft text-accent-strong'],
  ['exento', 'Exento', 'border-accent bg-accent-soft text-accent-strong'],
  ['no_cursa', 'No cursa', 'border-line-strong bg-subtle text-ink-soft'],
]
const modeOf = (entry) => {
  if (!entry || entry.status === 'baja') return 'no_cursa'
  if (entry.status === 'convalidado' || entry.status === 'exento') return entry.status
  return 'cursa'
}
const shortDate = (date) => (date ? new Date(`${date}T00:00`).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' }) : '')
const today = () => new Date().toLocaleDateString('sv-SE')
const sortModules = (a, b) => (a.level || 99) - (b.level || 99) || a.module_id.localeCompare(b.module_id) || b.kind.localeCompare(a.kind)

export default function Enrollment({ data, run, busy }) {
  const groupById = useMemo(() => Object.fromEntries(data.groups.map((group) => [group.id, group])), [data.groups])
  const dmById = useMemo(() => Object.fromEntries(data.degrees.flatMap((degree) => (degree.degree_modules || []).map((item) => [item.id, { ...item, degree_id: degree.id, degree_code: degree.code }]))), [data.degrees])
  const enrollmentOf = useMemo(() => Object.fromEntries(data.enrollments.map((item) => [item.student_id, item])), [data.enrollments])
  const modulesOf = useMemo(() => {
    const map = {}
    data.moduleEnrollments.forEach((item) => { (map[item.student_id] ||= []).push(item) })
    return map
  }, [data.moduleEnrollments])
  const [view, setView] = useState(data.groups[0]?.id || SIN)
  const [studentId, setStudentId] = useState('')
  const [adding, setAdding] = useState(false)
  const [query, setQuery] = useState('')
  const [showConflicts, setShowConflicts] = useState(false)
  // Solapes de horario: se recalculan cada vez que se recargan los datos (cambios de matrícula u horario)
  const conflicts = useStudentConflicts(data.schoolId, null, data)
  const conflictsOf = (id) => conflicts.filter((row) => row.student_id === id)
  const conflictStudents = [...new Set(conflicts.map((row) => row.student_id))]

  // Módulos de «su curso» para un alumno: los del nivel de su grupo en su grado
  const homeModules = (student) => {
    const group = groupById[enrollmentOf[student]?.group_id]
    if (!group) return []
    return Object.values(dmById).filter((item) => item.degree_id === group.degree_id && item.level === group.level).sort(sortModules)
  }
  const isHome = (student, entry) => homeModules(student).some((item) => item.id === entry.degree_module_id)

  // Etiquetas discretas con las excepciones del alumno
  const tagsOf = (student) => {
    const enrollment = enrollmentOf[student]
    const tags = []
    if (enrollment?.status === 'baja') tags.push([`baja ${shortDate(enrollment.left_on)}`, 'text-danger'])
    const mine = modulesOf[student] || []
    const joined = mine.filter((entry) => isHome(student, entry) && entry.joined_on).map((entry) => entry.joined_on).sort()[0]
    if (joined && enrollment?.status !== 'baja') tags.push([`alta ${shortDate(joined)}`, 'text-muted'])
    mine.forEach((entry) => {
      const item = dmById[entry.degree_module_id]
      if (!item) return
      if (entry.status === 'convalidado' || entry.status === 'exento') tags.push([`${item.module_id} ${entry.status}`, 'text-accent-strong'])
      else if (entry.status === 'baja') tags.push([`${item.module_id} no cursa`, 'text-muted'])
      else if (!isHome(student, entry)) tags.push([`+${item.module_id} con ${groupLabel(groupById[entry.group_id])}${entry.is_carryover ? ' · pendiente' : ''}`, 'text-warn'])
    })
    return tags
  }

  // Módulos que cursa (sin convalidados, exentos ni bajas), en orden
  const takingOf = (student) => [...new Set((modulesOf[student] || [])
    .filter((entry) => !['convalidado', 'exento', 'baja'].includes(entry.status) && !entry.left_on)
    .map((entry) => dmById[entry.degree_module_id]?.module_id).filter(Boolean))].sort()

  const inView = (student) => {
    const enrollment = enrollmentOf[student.id]
    if (view === SIN) return !enrollment && !(modulesOf[student.id] || []).length
    if (view === SUELTOS) return !enrollment && (modulesOf[student.id] || []).length > 0
    return enrollment?.group_id === view
  }
  const text = query.trim().toLowerCase()
  const listed = data.students.filter((student) => inView(student) && (!text || `${student.name} ${student.student_number || ''}`.toLowerCase().includes(text)))
  const counts = (id) => data.students.filter((student) => {
    const enrollment = enrollmentOf[student.id]
    if (id === SIN) return !enrollment && !(modulesOf[student.id] || []).length
    if (id === SUELTOS) return !enrollment && (modulesOf[student.id] || []).length > 0
    return enrollment?.group_id === id
  }).length
  const student = data.students.find((item) => item.id === studentId)
  const currentGroup = groupById[view]

  // Ir a un alumno con solapes: su grupo y su ficha
  const goTo = (id) => {
    const enrollment = enrollmentOf[id]
    setView(enrollment?.group_id || ((modulesOf[id] || []).length ? SUELTOS : SIN))
    setStudentId(id)
    setQuery('')
  }

  return (
    <div className="space-y-4">
      {conflictStudents.length > 0 && (
        <div className="rounded-xl border border-danger/40 bg-danger-soft/40 px-4 py-2.5">
          <button type="button" className="flex w-full items-center justify-between gap-3 text-left text-sm font-semibold text-danger" onClick={() => setShowConflicts((value) => !value)} aria-expanded={showConflicts}>
            <span className="flex items-center gap-2"><Icon name="clock" size={16} />{conflictStudents.length === 1 ? '1 alumno tiene clases solapadas' : `${conflictStudents.length} alumnos tienen clases solapadas`}</span>
            <span className="text-xs font-medium">{showConflicts ? 'Ocultar' : 'Ver'}</span>
          </button>
          {showConflicts && (
            <div className="mt-2">
              <ConflictNotice rows={conflicts} title="Discrepancias de horario" onSelect={goTo} hint="Se permite, pero sigue en rojo hasta que cambies al alumno de grupo en ese módulo o ajustes el horario de una de las clases." />
            </div>
          )}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-1.5" role="radiogroup" aria-label="Grupo">
        {data.groups.map((group) => (
          <button key={group.id} type="button" role="radio" aria-checked={view === group.id} onClick={() => { setView(group.id); setAdding(false) }}
            className={`rounded-xl border px-3.5 py-1.5 text-sm font-semibold ${view === group.id ? 'border-accent bg-accent-soft text-accent-strong' : 'border-line text-ink-soft hover:bg-subtle'}`}>
            {groupLabel(group)} <span className="font-normal text-muted">{counts(group.id)}</span>
          </button>
        ))}
        <span className="mx-1 text-faint">·</span>
        {[[SUELTOS, 'Módulos sueltos'], [SIN, 'Sin matricular']].map(([id, label]) => (
          <button key={id} type="button" role="radio" aria-checked={view === id} onClick={() => { setView(id); setAdding(false) }}
            className={`rounded-xl px-3 py-1.5 text-sm ${view === id ? 'bg-accent-soft font-medium text-accent-strong' : 'text-muted hover:bg-subtle'}`}>
            {label} <span className="text-faint">{counts(id)}</span>
          </button>
        ))}
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_440px]">
        <section className="card overflow-hidden">
          <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
            <div className="relative min-w-[180px] flex-1">
              <Icon name="search" size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
              <input type="search" className="input pl-9" placeholder="Buscar alumno…" value={query} onChange={(event) => setQuery(event.target.value)} />
            </div>
            {currentGroup && <button type="button" className="btn-primary min-h-[38px] px-3 text-sm" onClick={() => setAdding((value) => !value)}><Icon name="plus" size={16} />Añadir alumnos</button>}
          </div>
          {currentGroup && <p className="border-b border-line bg-subtle/40 px-4 py-2 text-xs text-muted">Los alumnos de {groupLabel(currentGroup)} cursan todos los módulos de {levelLabel(currentGroup.level)} con este grupo. Toca un alumno para sus excepciones.</p>}
          {view === SUELTOS && <p className="border-b border-line bg-subtle/40 px-4 py-2 text-xs text-muted">Alumnos sin grupo principal que solo cursan algunos módulos.</p>}
          {view === SIN && <p className="border-b border-line bg-subtle/40 px-4 py-2 text-xs text-muted">Toca un alumno para ponerle grupo o módulos sueltos.</p>}
          {adding && currentGroup && <AddStudents data={data} group={currentGroup} enrollmentOf={enrollmentOf} run={run} busy={busy} onDone={() => setAdding(false)} />}
          <ul className="max-h-[65vh] divide-y divide-line overflow-y-auto">
            {listed.map((item) => (
              <li key={item.id}>
                <button type="button" onClick={() => setStudentId(item.id)} className={`block w-full px-4 py-2.5 text-left text-sm ${item.id === studentId ? 'bg-accent-soft' : 'hover:bg-subtle'}`}>
                  <span className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
                    <span className={`min-w-0 flex-1 truncate font-medium ${conflictsOf(item.id).length ? 'text-danger' : 'text-ink'}`}>{item.name}</span>
                    <span className="flex flex-wrap gap-x-2 gap-y-0.5 text-xs">
                      {conflictsOf(item.id).length > 0 && <span className="font-semibold text-danger">solape de horario</span>}
                      {tagsOf(item.id).map(([label, tone]) => <span key={label} className={tone}>{label}</span>)}
                    </span>
                  </span>
                  {takingOf(item.id).length > 0 && (
                    <span className="mt-1 flex flex-wrap gap-1">
                      {takingOf(item.id).map((code) => <span key={code} className="rounded-md bg-subtle px-1.5 py-px text-[11px] tabular-nums text-ink-soft">{code}</span>)}
                    </span>
                  )}
                </button>
              </li>
            ))}
            {!listed.length && <li className="px-4 py-8 text-center text-sm text-muted">{text ? 'Sin resultados.' : currentGroup ? 'Este grupo aún no tiene alumnos. Pulsa «Añadir alumnos».' : 'Nadie aquí.'}</li>}
          </ul>
        </section>

        {student
          ? <StudentEnrollment key={student.id} data={data} student={student} enrollment={enrollmentOf[student.id]} entries={modulesOf[student.id] || []} homeModules={homeModules(student.id)} conflicts={conflictsOf(student.id)} groupById={groupById} dmById={dmById} run={run} busy={busy} onClose={() => setStudentId('')} />
          : <div className="card empty hidden lg:block"><p className="font-medium text-ink-soft">Elige un alumno</p><p className="mt-1">Verás su grupo, sus módulos y sus excepciones.</p></div>}
      </div>
    </div>
  )
}

// Añadir alumnos a un grupo: buscar y marcar, o pegar una lista (nombres o números) de Excel
function AddStudents({ data, group, enrollmentOf, run, busy, onDone }) {
  const [search, setSearch] = useState('')
  const [chosen, setChosen] = useState(() => new Set())
  const [pasted, setPasted] = useState('')
  const [joinedOn, setJoinedOn] = useState('')
  const [unmatched, setUnmatched] = useState([])
  const started = data.year?.starts_on && data.year.starts_on < today()

  const candidates = data.students.filter((item) => enrollmentOf[item.id]?.group_id !== group.id)
  const text = search.trim().toLowerCase()
  const matches = text ? candidates.filter((item) => `${item.name} ${item.student_number || ''}`.toLowerCase().includes(text)).slice(0, 12) : []

  // Lista pegada: una persona por línea (nombre o número de alumno)
  function readPasted() {
    const lines = pasted.split(/\r?\n/).map((line) => line.split('\t')[0].trim()).filter(Boolean)
    const next = new Set(chosen)
    const missing = []
    lines.forEach((line) => {
      const key = line.toLowerCase()
      const found = candidates.find((item) => String(item.student_number || '') === line || item.name.toLowerCase() === key)
      if (found) next.add(found.id)
      else if (!data.students.some((item) => enrollmentOf[item.id]?.group_id === group.id && (item.name.toLowerCase() === key || String(item.student_number || '') === line))) missing.push(line)
    })
    setChosen(next)
    setUnmatched(missing)
    setPasted('')
  }

  async function save() {
    const ids = [...chosen]
    const ok = await run(async () => {
      for (const id of ids) {
        const result = await supabase.rpc('enroll_student', { p_student_id: id, p_group_id: group.id, p_joined_on: joinedOn || null })
        if (result.error) return result
      }
      return { data: null, error: null }
    }, `${ids.length} ${ids.length === 1 ? 'alumno añadido' : 'alumnos añadidos'} a ${groupLabel(group)}.`)
    if (ok) onDone()
  }

  const name = (id) => data.students.find((item) => item.id === id)
  return (
    <div className="space-y-3 border-b border-line bg-subtle/30 p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="field text-xs">Buscar en la escuela<input className="input" placeholder="Nombre o número…" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
          {matches.length > 0 && (
            <ul className="mt-1 max-h-48 divide-y divide-line overflow-y-auto rounded-xl border border-line bg-surface">
              {matches.map((item) => (
                <li key={item.id}>
                  <label className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm hover:bg-subtle">
                    <input type="checkbox" checked={chosen.has(item.id)} onChange={(event) => setChosen((current) => { const next = new Set(current); if (event.target.checked) next.add(item.id); else next.delete(item.id); return next })} />
                    <span className="min-w-0 flex-1 truncate text-ink">{item.name}</span>
                    <span className="text-xs text-muted">{enrollmentOf[item.id] ? `ahora en ${groupLabel(data.groups.find((g) => g.id === enrollmentOf[item.id].group_id))}` : 'sin grupo'}</span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <label className="field text-xs">O pega una lista de Excel (nombre o número por línea)
            <textarea className="input font-mono text-xs" rows="2" value={pasted} onChange={(event) => setPasted(event.target.value)} placeholder={'Ana Pérez\n1024'} />
          </label>
          <div className="mt-1 flex justify-end"><button type="button" className="btn-ghost min-h-[30px] px-2 text-xs" disabled={!pasted.trim()} onClick={readPasted}>Buscar estos</button></div>
        </div>
      </div>
      {unmatched.length > 0 && <p className="text-xs text-warn">No encontrados: {unmatched.join(', ')}. Créalos antes en Usuarios.</p>}
      {chosen.size > 0 && (
        <p className="flex flex-wrap gap-1.5 text-xs">
          {[...chosen].map((id) => (
            <button key={id} type="button" className="rounded-lg border border-accent bg-accent-soft px-2 py-0.5 text-accent-strong" onClick={() => setChosen((current) => { const next = new Set(current); next.delete(id); return next })} title="Quitar">
              {name(id)?.name} ×
            </button>
          ))}
        </p>
      )}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <label className="field text-xs">Fecha de alta {started ? '(si se incorpora ahora)' : '(opcional)'}
          <input className="input" type="date" value={joinedOn} onChange={(event) => setJoinedOn(event.target.value)} />
        </label>
        <div className="flex gap-2">
          <button type="button" className="btn-ghost" onClick={onDone}>Cancelar</button>
          <button type="button" className="btn-primary" disabled={busy || !chosen.size} onClick={save}>Añadir {chosen.size || ''} a {groupLabel(group)}</button>
        </div>
      </div>
      <p className="text-xs text-muted">Si un alumno ya estaba en otro grupo, se cambia a {groupLabel(group)} y le siguen sus módulos (sin perder notas ni asistencia).</p>
    </div>
  )
}

// Ficha de matrícula de un alumno: grupo, módulos de su curso, otros módulos, baja y cuenta
function StudentEnrollment({ data, student, enrollment, entries, homeModules, conflicts, groupById, dmById, run, busy, onClose }) {
  const [groupId, setGroupId] = useState(enrollment?.group_id || '')
  const [changeDate, setChangeDate] = useState('')
  const [extra, setExtra] = useState({ degree_module_id: '', group_id: '' })
  const [dropDate, setDropDate] = useState(today())
  const [dropping, setDropping] = useState(false)
  const homeIds = new Set(homeModules.map((item) => item.id))
  const others = entries.filter((entry) => !homeIds.has(entry.degree_module_id) && entry.status !== 'baja')
  const entryFor = (id) => entries.find((entry) => entry.degree_module_id === id)
  const allModules = Object.values(dmById).filter((item) => !homeIds.has(item.id) && !others.some((entry) => entry.degree_module_id === item.id)).sort(sortModules)
  const extraModule = dmById[extra.degree_module_id]
  const extraGroups = extraModule ? data.groups.filter((group) => group.degree_id === extraModule.degree_id).sort((a, b) => (a.level === extraModule.level ? -1 : 0) - (b.level === extraModule.level ? -1 : 0)) : []
  const linkedProfile = data.links.find((link) => link.student_id === student.id)?.profile_id || ''
  const title = (item) => `${item.module_id} · ${data.moduleNames[item.module_id] || ''}`
  const dropped = enrollment?.status === 'baja'

  const setGroup = () => run(() => supabase.rpc('enroll_student', { p_student_id: student.id, p_group_id: groupId, p_joined_on: changeDate || null }),
    enrollment ? `${student.name} pasa a ${groupLabel(groupById[groupId])}.` : `${student.name} matriculado en ${groupLabel(groupById[groupId])}.`)
  const setMode = (item, mode, group = null) => run(() => supabase.rpc('enrollment_set_module', { p_student_id: student.id, p_degree_module_id: item.id, p_mode: mode, p_group_id: group }))
  const addExtra = async () => {
    const ok = await setMode(extraModule, 'cursa', extra.group_id || extraGroups[0]?.id)
    if (ok) setExtra({ degree_module_id: '', group_id: '' })
  }

  return (
    <section className="card space-y-5 p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold text-ink">{student.name}</h3>
          <p className="text-sm text-muted">Nº {student.student_number || '—'}{dropped ? ` · baja desde ${shortDate(enrollment.left_on)}` : ''}</p>
        </div>
        <button type="button" className="rounded-lg p-1.5 text-muted hover:bg-subtle lg:hidden" aria-label="Cerrar ficha" onClick={onClose}><Icon name="x" size={16} /></button>
      </div>

      <ConflictNotice rows={conflicts} title="Clases solapadas" hint="Cambia de grupo el módulo que choca (en «Otros módulos») o ajusta el horario de una de las dos clases." />

      <div>
        <p className="mb-1.5 text-sm font-medium text-ink-soft">Grupo</p>
        <div className="flex flex-wrap items-end gap-2">
          <select className="input w-auto" aria-label="Grupo" value={groupId} onChange={(event) => setGroupId(event.target.value)} disabled={busy}>
            <option value="">{enrollment ? '—' : 'Sin grupo (solo módulos sueltos)'}</option>
            {data.groups.map((group) => <option key={group.id} value={group.id}>{groupLabel(group)}</option>)}
          </select>
          {groupId && groupId !== (enrollment?.group_id || '') && (
            <>
              <label className="field text-xs">Desde<input className="input" type="date" value={changeDate} onChange={(event) => setChangeDate(event.target.value)} /></label>
              <button type="button" className="btn-primary" disabled={busy} onClick={setGroup}>{enrollment ? 'Cambiar de grupo' : 'Matricular'}</button>
            </>
          )}
        </div>
        {enrollment && <p className="mt-1 text-xs text-muted">Cursa todos los módulos de {levelLabel(groupById[enrollment.group_id]?.level)} con {groupLabel(groupById[enrollment.group_id])}, salvo las excepciones de abajo.</p>}
      </div>

      {homeModules.length > 0 && (
        <div>
          <p className="mb-1.5 text-sm font-medium text-ink-soft">Módulos de su curso</p>
          <ul className="divide-y divide-line rounded-xl border border-line">
            {homeModules.map((item) => {
              const entry = entryFor(item.id)
              const mode = modeOf(entry)
              const graded = entry && (entry.theory_grade != null || entry.practical_result)
              return (
                <li key={item.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-ink">{title(item)}</span>
                    <span className="text-xs text-muted">{KIND_LABEL[item.kind]}{graded ? ' · con nota' : ''}</span>
                  </span>
                  <span className="inline-flex gap-1" role="group" aria-label={`Matrícula en ${item.module_id}`}>
                    {MODES.map(([id, label, active]) => (
                      <button key={id} type="button" aria-pressed={mode === id} disabled={busy || (graded && id !== mode)} onClick={() => mode !== id && setMode(item, id)}
                        className={`h-7 rounded-lg border px-2 text-[11px] font-semibold disabled:opacity-40 ${mode === id ? active : 'border-line bg-surface text-muted hover:text-ink'}`}>{label}</button>
                    ))}
                  </span>
                </li>
              )
            })}
          </ul>
        </div>
      )}

      <div>
        <p className="mb-1.5 text-sm font-medium text-ink-soft">{enrollment ? 'Otros módulos (de otro curso o grado)' : 'Módulos que cursa'}</p>
        {others.length > 0 && (
          <ul className="mb-2 divide-y divide-line rounded-xl border border-line">
            {others.map((entry) => {
              const item = dmById[entry.degree_module_id]
              if (!item) return null
              const graded = entry.theory_grade != null || entry.practical_result
              return (
                <li key={entry.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-ink">{title(item)}</span>
                    <span className="text-xs text-muted">{levelLabel(item.level)} · {item.degree_code}{entry.is_carryover ? ' · pendiente' : ''}{entry.status === 'convalidado' || entry.status === 'exento' ? ` · ${entry.status}` : ''}</span>
                  </span>
                  <select className="input h-8 w-auto py-0 text-xs" aria-label={`Grupo con el que cursa ${item.module_id}`} value={entry.group_id} disabled={busy}
                    onChange={(event) => setMode(item, modeOf(entry) === 'no_cursa' ? 'cursa' : modeOf(entry), event.target.value)}>
                    {data.groups.filter((group) => group.degree_id === item.degree_id).map((group) => <option key={group.id} value={group.id}>con {groupLabel(group)}</option>)}
                  </select>
                  <button type="button" className="rounded-lg p-1.5 text-danger/70 hover:bg-danger-soft hover:text-danger disabled:opacity-40" disabled={busy || graded} title={graded ? 'Tiene nota' : 'Quitar'} aria-label={`Quitar ${item.module_id}`} onClick={() => setMode(item, 'no_cursa')}><Icon name="trash" size={14} /></button>
                </li>
              )
            })}
          </ul>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <select className="input min-w-0 flex-1" aria-label="Módulo para añadir" value={extra.degree_module_id} onChange={(event) => setExtra({ degree_module_id: event.target.value, group_id: '' })}>
            <option value="">+ Añadir módulo…</option>
            {allModules.map((item) => <option key={item.id} value={item.id}>{title(item)} · {levelLabel(item.level)}{data.degrees.length > 1 ? ` · ${item.degree_code}` : ''}</option>)}
          </select>
          {extraModule && (
            <>
              <select className="input w-auto" aria-label="Grupo con el que lo cursa" value={extra.group_id || extraGroups[0]?.id || ''} onChange={(event) => setExtra({ ...extra, group_id: event.target.value })}>
                {extraGroups.map((group) => <option key={group.id} value={group.id}>con {groupLabel(group)}</option>)}
              </select>
              <button type="button" className="btn-secondary" disabled={busy || !extraGroups.length} onClick={addExtra}><Icon name="plus" size={14} />Añadir</button>
            </>
          )}
        </div>
      </div>

      {enrollment && (
        <div className="border-t border-line pt-4">
          {dropped ? (
            <button type="button" className="btn-secondary" disabled={busy} onClick={() => run(() => supabase.rpc('enroll_student', { p_student_id: student.id, p_group_id: enrollment.group_id, p_joined_on: today() }), `${student.name} se reincorpora.`)}>Reincorporar</button>
          ) : dropping ? (
            <div className="flex flex-wrap items-end gap-2">
              <label className="field text-xs">Baja desde<input className="input" type="date" value={dropDate} onChange={(event) => setDropDate(event.target.value)} /></label>
              <button type="button" className="btn-ghost" onClick={() => setDropping(false)}>Cancelar</button>
              <button type="button" className="btn-primary bg-danger hover:bg-danger" disabled={busy || !dropDate} onClick={async () => { if (await run(() => supabase.rpc('enrollment_drop', { p_student_id: student.id, p_left_on: dropDate }), `${student.name} dado de baja.`)) setDropping(false) }}>Dar de baja</button>
            </div>
          ) : (
            <button type="button" className="btn-ghost text-sm text-danger" onClick={() => setDropping(true)}>Dar de baja…</button>
          )}
          <p className="mt-1 text-xs text-muted">La baja conserva notas y asistencia; deja de salir en las listas desde esa fecha.</p>
        </div>
      )}

      <label className="field max-w-md border-t border-line pt-4">Cuenta de acceso
        <select className="input" value={linkedProfile} disabled={busy} onChange={(event) => run(() => supabase.rpc('admin_link_student_profile', { p_student_id: student.id, p_profile_id: event.target.value || null }), event.target.value ? 'Cuenta vinculada.' : 'Cuenta desvinculada.')}>
          <option value="">Sin vincular</option>
          {data.studentAccounts.map((profile) => <option key={profile.id} value={profile.id}>{profile.full_name || profile.email} · {profile.email}</option>)}
        </select>
      </label>
    </section>
  )
}
