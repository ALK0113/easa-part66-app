import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { useSchool } from '../contexts/useSchool.js'
import { getSupabaseErrorMessage } from '../lib/supabaseErrors.js'
import { groupLabel } from '../lib/academic.js'
import { teachesLikeProfessor } from '../lib/roles.js'
import { WEEKDAYS } from '../lib/schedule.js'
import { buildPlan, downloadCsvTemplate, downloadJsonTemplate, readScheduleFile, readScheduleText } from '../lib/importSchedule.js'
import Icon from './Icon.jsx'

// Subida masiva de calendarios (administración y supervisión). Crea lo que falte
// (módulos propios, módulos del grado y clases) y después el horario:
// las filas semanales van a la plantilla (generan todo el curso) y las de fecha son clases sueltas.

async function loadSchoolContext(schoolId) {
  const year = await supabase.from('academic_years').select('id').eq('school_id', schoolId).eq('is_current', true).maybeSingle()
  if (year.error) throw year.error
  if (!year.data) return null
  const [groups, degrees, modules, members, practices] = await Promise.all([
    supabase.from('class_groups').select('id,level,name,degree_id').eq('academic_year_id', year.data.id),
    supabase.from('degrees').select('id,code,degree_modules(id,module_id,kind,level)').eq('school_id', schoolId),
    supabase.from('modules').select('id,school_id'),
    supabase.from('school_profiles').select('profiles(id,full_name,email,role)').eq('school_id', schoolId),
    supabase.from('practices').select('id').eq('school_id', schoolId),
  ])
  const failed = [groups, degrees, modules, members, practices].find((result) => result.error)
  if (failed) throw failed.error
  const groupIds = (groups.data || []).map((group) => group.id)
  const assignments = groupIds.length
    ? await supabase.from('teaching_assignments').select('id,profile_id,degree_module_id,group_id').in('group_id', groupIds)
    : { data: [] }
  if (assignments.error) throw assignments.error
  return {
    schoolId,
    groups: groups.data || [],
    degrees: degrees.data || [],
    modules: modules.data || [],
    teachers: (members.data || []).map((row) => row.profiles).filter((profile) => profile && teachesLikeProfessor(profile.role))
      .sort((a, b) => (a.full_name || a.email).localeCompare(b.full_name || b.email)),
    assignments: assignments.data || [],
    practiceIds: new Set((practices.data || []).map((row) => row.id)),
  }
}

export default function ImportSchedule({ user }) {
  const { isAdmin, schoolId } = useSchool()
  const [ctx, setCtx] = useState(undefined) // undefined: cargando · null: sin curso actual
  const [file, setFile] = useState(null) // { name, raw }
  const [defaultTeacher, setDefaultTeacher] = useState('')
  const [pasted, setPasted] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState(null)
  const [version, setVersion] = useState(0)
  // El admin elige antes la escuela: los nombres de grupo se repiten entre escuelas
  const needsSchool = isAdmin && !schoolId

  useEffect(() => {
    if (!schoolId) return undefined
    let active = true
    loadSchoolContext(schoolId)
      .then((data) => { if (active) setCtx(data) })
      .catch((err) => { if (active) { setCtx(null); setNotice({ error: true, text: getSupabaseErrorMessage(err) }) } })
    return () => { active = false }
  }, [schoolId, user.id, version])

  // El plan se rehace al cambiar el profesor por defecto
  const plan = useMemo(() => (file && ctx ? buildPlan(file.raw, ctx, defaultTeacher) : null), [file, ctx, defaultTeacher])

  async function onFile(event) {
    const chosen = event.target.files?.[0]
    event.target.value = ''
    if (!chosen) return
    setNotice(null)
    try {
      const raw = await readScheduleFile(chosen)
      if (!raw.length) { setNotice({ error: true, text: 'El archivo no tiene filas.' }); return }
      setFile({ name: chosen.name, raw })
    } catch (err) {
      setFile(null)
      setNotice({ error: true, text: `No se pudo leer el archivo: ${err.message}` })
    }
  }

  // Tabla copiada directamente de Excel
  function onPaste() {
    setNotice(null)
    try {
      const raw = readScheduleText(pasted)
      if (!raw.length) { setNotice({ error: true, text: 'No se reconoce ninguna fila. Copia también la fila de cabecera (grupo, modulo, dia…).' }); return }
      setFile({ name: 'Tabla pegada', raw })
    } catch (err) {
      setNotice({ error: true, text: `No se pudo leer la tabla: ${err.message}` })
    }
  }

  async function runImport() {
    const valid = plan.rows.filter((row) => !row.errors.length)
    setBusy(true)
    let step = 'los módulos'
    try {
      // 1) Módulos propios (códigos que no están en el catálogo)
      if (plan.modules.length) {
        const { error } = await supabase.from('modules').insert(plan.modules.map((mod) => ({ id: mod.id, name: mod.id, school_id: schoolId })))
        if (error) throw error
      }
      // 2) Módulos que faltan en el grado
      step = 'los módulos del grado'
      const degreeModuleIds = new Map()
      if (plan.degreeModules.length) {
        const { data, error } = await supabase.from('degree_modules').insert(plan.degreeModules).select('id,degree_id,module_id,kind')
        if (error) throw error
        data.forEach((dm) => degreeModuleIds.set(`${dm.degree_id}|${String(dm.module_id).toUpperCase()}|${dm.kind}`, dm.id))
      }
      ctx.degrees.forEach((degree) => (degree.degree_modules || []).forEach((dm) => degreeModuleIds.set(`${degree.id}|${String(dm.module_id).toUpperCase()}|${dm.kind}`, dm.id)))
      // 3) Clases (grupo + módulo + profesor)
      step = 'las clases'
      const classIds = new Map()
      if (plan.classes.length) {
        const { data, error } = await supabase.from('teaching_assignments')
          .insert(plan.classes.map((item) => ({ group_id: item.group.id, degree_module_id: degreeModuleIds.get(`${item.degreeId}|${item.code}|${item.kind}`), profile_id: item.teacherId })))
          .select('id,group_id,degree_module_id,profile_id')
        if (error) throw error
        plan.classes.forEach((item) => {
          const dmId = degreeModuleIds.get(`${item.degreeId}|${item.code}|${item.kind}`)
          const created = data.find((ta) => ta.group_id === item.group.id && ta.degree_module_id === dmId && ta.profile_id === item.teacherId)
          if (created) classIds.set(item.key, created.id)
        })
      }
      const resolved = valid.map((row) => ({ ...row.values, teaching_assignment_id: row.assignmentId || classIds.get(row.classKey), type: row.type }))

      // 4) Horario, sin duplicar lo que ya existe
      step = 'el horario'
      const weekly = resolved.filter((row) => row.type === 'semanal')
      const oneOff = resolved.filter((row) => row.type === 'suelta')
      const ids = [...new Set(resolved.map((row) => row.teaching_assignment_id))]
      const [slotResult, sessionResult] = await Promise.all([
        weekly.length ? supabase.from('schedule_slots').select('teaching_assignment_id,weekday,start_time,end_time').in('teaching_assignment_id', ids) : { data: [] },
        oneOff.length ? supabase.from('class_sessions').select('teaching_assignment_id,date,start_time').in('teaching_assignment_id', ids).in('date', [...new Set(oneOff.map((row) => row.date))]) : { data: [] },
      ])
      if (slotResult.error || sessionResult.error) throw slotResult.error || sessionResult.error
      const slotKey = (s) => `${s.teaching_assignment_id}|${s.weekday}|${String(s.start_time).slice(0, 5)}|${String(s.end_time).slice(0, 5)}`
      const sessionKey = (s) => `${s.teaching_assignment_id}|${s.date}|${String(s.start_time).slice(0, 5)}`
      const existingSlots = new Set((slotResult.data || []).map(slotKey))
      const existingSessions = new Set((sessionResult.data || []).map(sessionKey))
      const newSlots = []
      const newSessions = []
      weekly.forEach((row) => { const key = slotKey(row); if (!existingSlots.has(key)) { existingSlots.add(key); newSlots.push({ teaching_assignment_id: row.teaching_assignment_id, weekday: row.weekday, start_time: row.start_time, end_time: row.end_time, room: row.room }) } })
      oneOff.forEach((row) => { const key = sessionKey(row); if (!existingSessions.has(key)) { existingSessions.add(key); newSessions.push({ teaching_assignment_id: row.teaching_assignment_id, date: row.date, start_time: row.start_time, end_time: row.end_time, room: row.room, note: row.note, practice_id: row.practice_id }) } })
      if (newSlots.length) { const { error } = await supabase.from('schedule_slots').insert(newSlots); if (error) throw error }
      if (newSessions.length) { const { error } = await supabase.from('class_sessions').insert(newSessions); if (error) throw error }

      const skipped = valid.length - newSlots.length - newSessions.length
      const created = [
        plan.modules.length && `${plan.modules.length} módulos propios`,
        plan.degreeModules.length && `${plan.degreeModules.length} módulos añadidos al grado`,
        plan.classes.length && `${plan.classes.length} clases`,
      ].filter(Boolean)
      setNotice({ error: false, text: `Importado: ${newSlots.length} clases semanales (generadas hasta fin de curso) y ${newSessions.length} clases sueltas.${created.length ? ` Creado: ${created.join(', ')}.` : ''}${skipped ? ` ${skipped} ya existían y no se han duplicado.` : ''}${plan.modules.length ? ' Pon nombre a los módulos propios en Escuela → Grado y módulos.' : ''}` })
      setFile(null)
    } catch (err) {
      setNotice({ error: true, text: `Se ha parado al crear ${step}: ${getSupabaseErrorMessage(err)}. Lo creado hasta ahí se mantiene; puedes volver a importar el archivo y no se duplicará.` })
    } finally {
      setBusy(false)
      setVersion((value) => value + 1)
    }
  }

  if (needsSchool) return <div className="card empty">Elige una escuela en el selector de arriba para importar su calendario.</div>
  if (ctx === null && !notice) return <div className="card empty">Esta escuela no tiene curso escolar actual. Créalo en Escuela → Curso escolar.</div>

  const rows = plan?.rows || []
  const validCount = rows.filter((row) => !row.errors.length).length
  const invalid = rows.filter((row) => row.errors.length)
  // Errores agrupados: el mismo motivo una sola vez, con sus filas
  const errorGroups = Object.entries(invalid.reduce((acc, row) => { row.errors.forEach((error) => { (acc[error] ||= []).push(row.line) }); return acc }, {}))
  const needsDefaultTeacher = rows.some((row) => row.errors.includes('Elige un «profesor por defecto» para las clases nuevas'))

  return (
    <div className="space-y-5">
      <section className="card space-y-4 p-5">
        <div>
          <h3 className="font-semibold text-ink">Importar calendario</h3>
          <p className="mt-1 text-sm text-muted">
            Sube un CSV o un JSON. Cada fila es una clase de un grupo y módulo: con <strong>dia</strong> (lunes…domingo) se añade a la plantilla semanal y se genera hasta fin de curso;
            con <strong>fecha</strong> es una clase suelta, que puede llevar <strong>nota</strong> y <strong>practica</strong>. Si faltan módulos o clases, se crean al importar.
          </p>
          <p className="mt-1 text-xs text-muted">Columnas: grupo, modulo, tipo (teoría/práctica), profesor (email o nombre), dia o fecha, inicio, fin, aula, nota, practica.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <label className={`btn-primary cursor-pointer ${!ctx ? 'pointer-events-none opacity-50' : ''}`}>
            <Icon name="upload" size={16} />Elegir archivo
            <input type="file" accept=".csv,.json,text/csv,application/json" className="sr-only" onChange={onFile} disabled={!ctx} />
          </label>
          <button type="button" className="btn-secondary" onClick={downloadCsvTemplate}><Icon name="download" size={16} />Plantilla CSV</button>
          <button type="button" className="btn-secondary" onClick={downloadJsonTemplate}><Icon name="download" size={16} />Plantilla JSON</button>
        </div>
        {!plan && (
          <div className="space-y-2">
            <label className="field">O pega la tabla copiada de Excel (con la fila de cabecera)
              <textarea className="input font-mono text-xs" rows="5" value={pasted} onChange={(event) => setPasted(event.target.value)} placeholder={'grupo\tmodulo\ttipo\tprofesor\tdia\tfecha\tinicio\tfin\taula\n2ºA\tM11\tpráctica\t\tmartes\t\t17:00\t21:30\tHANGAR 8'} />
            </label>
            <div className="flex justify-end"><button type="button" className="btn-secondary" disabled={!pasted.trim() || !ctx} onClick={onPaste}>Revisar tabla pegada</button></div>
          </div>
        )}
        {notice && <p role={notice.error ? 'alert' : 'status'} className={notice.error ? 'notice-error' : 'notice-success'}>{notice.text}</p>}
      </section>

      {plan && (
        <section className="card space-y-4 p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="font-semibold text-ink">Antes de importar · {file.name}</h3>
              <p className="mt-0.5 text-sm text-muted">{rows.length} filas · <span className="text-success">{validCount} se importan</span>{invalid.length > 0 && <> · <span className="text-danger">{invalid.length} no</span></>}</p>
            </div>
            <div className="flex gap-2">
              <button type="button" className="btn-ghost" onClick={() => setFile(null)} disabled={busy}>Descartar</button>
              <button type="button" className="btn-primary" onClick={runImport} disabled={busy || validCount === 0}>{busy ? 'Importando…' : `Importar ${validCount} ${validCount === 1 ? 'clase' : 'clases'}`}</button>
            </div>
          </div>

          <label className="field max-w-md">Profesor por defecto
            <select className="input" value={defaultTeacher} onChange={(event) => setDefaultTeacher(event.target.value)}>
              <option value="">{needsDefaultTeacher ? 'Elige uno para las clases sin profesor…' : 'Ninguno'}</option>
              {ctx.teachers.map((teacher) => <option key={teacher.id} value={teacher.id}>{teacher.full_name || teacher.email}</option>)}
            </select>
            <span className="text-xs font-normal text-muted">Para las filas sin profesor o con un profesor que no existe en la escuela. Después puedes cambiarlo en Escuela → Profesores.</span>
          </label>

          {(plan.modules.length > 0 || plan.degreeModules.length > 0 || plan.classes.length > 0 || plan.unknownTeachers.length > 0 || plan.groupAliases.length > 0) && (
            <div className="rounded-xl border border-line bg-subtle/50 p-4 text-sm">
              <h4 className="mb-2 font-semibold text-ink">Se creará</h4>
              <ul className="space-y-1.5 text-ink-soft">
                {plan.modules.length > 0 && <li><strong>{plan.modules.length} módulos propios</strong> (no están en el catálogo EASA): {plan.modules.map((mod) => mod.id).join(', ')}</li>}
                {plan.degreeModules.length > 0 && <li><strong>{plan.degreeModules.length} módulos en el grado</strong>: {plan.degreeModules.map((dm) => `${dm.module_id} ${dm.kind === 'practica' ? 'práctica' : 'teoría'}`).join(', ')}</li>}
                {plan.classes.length > 0 && <li><strong>{plan.classes.length} clases</strong>: {plan.classes.map((item) => `${groupLabel(item.group)} ${item.code} ${item.kind === 'practica' ? 'P' : 'T'} (${item.teacher})`).join(', ')}</li>}
                {plan.groupAliases.length > 0 && <li>Grupos interpretados: {plan.groupAliases.map(([from, to]) => `«${from}» → ${to}`).join(', ')}</li>}
                {plan.unknownTeachers.length > 0 && <li className="text-warn">Profesores del archivo que no existen en la escuela: {plan.unknownTeachers.map(([name]) => name).join(', ')}{defaultTeacher ? ` → se asignan a ${ctx.teachers.find((t) => t.id === defaultTeacher)?.full_name || 'el profesor por defecto'}` : ''}</li>}
              </ul>
            </div>
          )}

          {errorGroups.length > 0 && (
            <div className="rounded-xl border border-danger/40 bg-danger-soft/40 p-4 text-sm">
              <h4 className="mb-2 font-semibold text-danger">No se importan</h4>
              <ul className="space-y-1 text-ink-soft">
                {errorGroups.map(([error, lines]) => <li key={error}>{error} <span className="text-muted">· filas {lines.slice(0, 12).join(', ')}{lines.length > 12 ? '…' : ''}</span></li>)}
              </ul>
            </div>
          )}

          <details>
            <summary className="cursor-pointer text-sm text-muted">Ver todas las filas</summary>
            <div className="mt-2 max-h-[28rem] overflow-auto rounded-xl border border-line">
              <table className="w-full text-left text-sm">
                <thead className="sticky top-0 bg-surface">
                  <tr><th className="px-4 py-2">Fila</th><th className="px-4 py-2">Clase</th><th className="px-4 py-2">Cuándo</th><th className="px-4 py-2">Horas</th><th className="px-4 py-2">Aula / nota</th><th className="px-4 py-2">Estado</th></tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.line} className={`border-t border-line ${row.errors.length ? 'bg-danger-soft/40' : ''}`}>
                      <td className="px-4 py-2 text-muted">{row.line}</td>
                      <td className="px-4 py-2 text-ink">{row.label}</td>
                      <td className="px-4 py-2">{row.type === 'semanal' ? `Cada ${WEEKDAYS[(row.values.weekday || 1) - 1]?.toLowerCase() || '?'}` : row.values.date || row.raw.fecha || '—'}</td>
                      <td className="px-4 py-2 tabular-nums">{row.values.start_time || row.raw.inicio || '?'}–{row.values.end_time || row.raw.fin || '?'}</td>
                      <td className="px-4 py-2 text-muted">{[row.values.room, row.values.note, row.values.practice_id && `Práctica ${row.values.practice_id}`].filter(Boolean).join(' · ') || '—'}</td>
                      <td className="px-4 py-2">{row.errors.length ? <span className="text-danger">{row.errors.join('. ')}</span> : <span className="text-success">{row.classKey ? 'Lista · clase nueva' : 'Lista'}</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </section>
      )}
    </div>
  )
}
