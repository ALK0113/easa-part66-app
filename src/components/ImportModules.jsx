import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { getSupabaseErrorMessage } from '../lib/supabaseErrors.js'
import { groupLabel } from '../lib/academic.js'
import { teachesLikeProfessor } from '../lib/roles.js'
import { HEADERS, buildModulesPlan, downloadModulesCsvTemplate, downloadModulesJsonTemplate, readModulesFile, readModulesText } from '../lib/importModules.js'
import Modal from './Modal.jsx'
import Icon from './Icon.jsx'

// Importa de golpe los módulos de un grado con el formato
//   Módulo | Denominación EASA Part-66 | Horas totales | Teoría | Práctica | Curso (opcional) | Profesor (opcional)
// desde CSV, JSON o pegando la tabla desde Excel. El total lo calcula la aplicación.
export default function ImportModules({ degree, modules, schoolId, onClose, onDone }) {
  const [source, setSource] = useState(null) // { name, raw }
  const [pasted, setPasted] = useState('')
  const [ctx, setCtx] = useState(null) // grupos del curso actual, profesores y clases (para la columna Profesor)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    async function load() {
      const year = await supabase.from('academic_years').select('id').eq('school_id', schoolId).eq('is_current', true).maybeSingle()
      const [groups, members] = await Promise.all([
        year.data ? supabase.from('class_groups').select('id,level,name,degree_id').eq('academic_year_id', year.data.id) : { data: [] },
        supabase.from('school_profiles').select('profiles(id,full_name,email,role)').eq('school_id', schoolId),
      ])
      const groupIds = (groups.data || []).map((group) => group.id)
      const assignments = groupIds.length ? await supabase.from('teaching_assignments').select('group_id,degree_module_id').in('group_id', groupIds) : { data: [] }
      if (!active) return
      setCtx({
        groups: groups.data || [],
        teachers: (members.data || []).map((row) => row.profiles).filter((profile) => profile && teachesLikeProfessor(profile.role)),
        assignments: assignments.data || [],
      })
    }
    load()
    return () => { active = false }
  }, [schoolId])

  const plan = useMemo(() => (source && ctx ? buildModulesPlan(source.raw, { schoolId, degree, modules, ...ctx }) : null), [source, ctx, schoolId, degree, modules])
  const valid = plan ? plan.rows.filter((row) => !row.errors.length) : []
  const invalid = plan ? plan.rows.filter((row) => row.errors.length) : []
  const warnings = valid.flatMap((row) => row.warnings.map((text) => `${row.code}: ${text}`))

  async function onFile(event) {
    const chosen = event.target.files?.[0]
    event.target.value = ''
    if (!chosen) return
    setError('')
    try {
      const raw = await readModulesFile(chosen)
      if (!raw.length) { setError('El archivo no tiene filas.'); return }
      setSource({ name: chosen.name, raw })
    } catch (err) {
      setSource(null)
      setError(`No se pudo leer el archivo: ${err.message}`)
    }
  }

  function onPaste() {
    setError('')
    try {
      const raw = readModulesText(pasted)
      if (!raw.length) { setError('No se reconoce ninguna fila. Copia también la fila de cabecera (Módulo, Denominación…).'); return }
      setSource({ name: 'Tabla pegada', raw })
    } catch (err) {
      setError(`No se pudo leer la tabla: ${err.message}`)
    }
  }

  async function runImport() {
    setBusy(true)
    setError('')
    try {
      // 1) Módulos nuevos (propios de la escuela) y nombres de los propios
      const fresh = valid.filter((row) => row.action === 'nuevo')
      if (fresh.length) {
        const { error: insertError } = await supabase.from('modules').insert(fresh.map((row) => ({ id: row.moduleId, name: row.name, school_id: schoolId })))
        if (insertError) throw insertError
      }
      for (const row of valid.filter((item) => item.rename)) {
        const { error: renameError } = await supabase.from('modules').update({ name: row.rename }).eq('id', row.moduleId)
        if (renameError) throw renameError
      }
      // 2) Teoría y práctica en el grado: se añaden las nuevas y se actualizan horas (y curso) de las existentes
      const partIds = new Map()
      const toInsert = []
      const toUpdate = []
      valid.forEach((row) => row.parts.forEach((part) => {
        if (part.existing) {
          partIds.set(`${row.code}|${part.kind}`, part.existing.id)
          toUpdate.push({ id: part.existing.id, values: { hours: part.hours, ...(row.level ? { level: row.level } : {}) } })
        } else toInsert.push({ degree_id: degree.id, module_id: row.moduleId, kind: part.kind, hours: part.hours, level: row.level })
      }))
      if (toInsert.length) {
        const { data, error: insertError } = await supabase.from('degree_modules').insert(toInsert).select('id,module_id,kind')
        if (insertError) throw insertError
        data.forEach((dm) => partIds.set(`${String(dm.module_id).toUpperCase()}|${dm.kind}`, dm.id))
      }
      for (let i = 0; i < toUpdate.length; i += 20) {
        const results = await Promise.all(toUpdate.slice(i, i + 20).map((item) => supabase.from('degree_modules').update(item.values).eq('id', item.id)))
        const failed = results.find((result) => result.error)
        if (failed) throw failed.error
      }
      // 3) Profesor (opcional): imparte el módulo en los grupos de su curso
      const classes = valid.flatMap((row) => row.classes.map((item) => ({ group_id: item.group.id, degree_module_id: partIds.get(`${row.code}|${item.kind}`), profile_id: row.teacher.id })))
        .filter((item) => item.degree_module_id)
      if (classes.length) {
        const { error: classError } = await supabase.from('teaching_assignments').insert(classes)
        if (classError) throw classError
      }
      onDone(`Importado en ${degree.code}: ${plan.created} módulos nuevos, ${plan.added} partes añadidas al grado, ${plan.updated} actualizadas${classes.length ? ` y ${classes.length} clases con su profesor` : ''}. Total: ${plan.totals.theory + plan.totals.practice} h.`)
    } catch (err) {
      setError(`Se ha parado: ${getSupabaseErrorMessage(err)}. Lo guardado hasta ahí se mantiene; puedes volver a importar sin duplicar nada.`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title={`Importar módulos · ${degree.code}`} onClose={onClose} wide>
      <div className="space-y-4">
        {!plan && (
          <>
            <p className="text-sm text-muted">
              Columnas: <strong>{HEADERS.slice(0, 5).join(' · ')}</strong> y, opcionales, <strong>Curso</strong> y <strong>Profesor</strong>.
              No hace falta la fila de total: la calcula la aplicación (si viene, se ignora).
            </p>
            <div className="flex flex-wrap gap-2">
              <label className={`btn-primary cursor-pointer ${!ctx ? 'pointer-events-none opacity-50' : ''}`}>
                <Icon name="upload" size={16} />Elegir archivo CSV o JSON
                <input type="file" accept=".csv,.tsv,.txt,.json,text/csv,application/json,text/plain" className="sr-only" onChange={onFile} disabled={!ctx} />
              </label>
              <button type="button" className="btn-secondary" onClick={downloadModulesCsvTemplate}><Icon name="download" size={16} />Plantilla CSV</button>
              <button type="button" className="btn-secondary" onClick={downloadModulesJsonTemplate}><Icon name="download" size={16} />Plantilla JSON</button>
            </div>
            <label className="field">O pega la tabla copiada de Excel (con la fila de cabecera)
              <textarea className="input font-mono text-xs" rows="5" value={pasted} onChange={(event) => setPasted(event.target.value)} placeholder={`${HEADERS.join('\t')}\nM1\tMathematics – Matemáticas\t33\t33\t0`} />
            </label>
            <div className="flex justify-end"><button type="button" className="btn-secondary" disabled={!pasted.trim() || !ctx} onClick={onPaste}>Revisar tabla pegada</button></div>
          </>
        )}
        {error && <p role="alert" className="notice-error">{error}</p>}

        {plan && (
          <>
            <div className="rounded-xl border border-line bg-subtle/50 p-4 text-sm text-ink-soft">
              <p className="font-medium text-ink">{source.name} · {plan.rows.length} módulos{plan.ignoredTotal ? ' · fila de total ignorada (la calcula la aplicación)' : ''}</p>
              <p className="mt-1">
                {plan.created > 0 && <>{plan.created} módulos nuevos (propios de la escuela) · </>}
                {plan.added} partes se añaden al grado · {plan.updated} ya estaban y se actualizan sus horas
                {plan.renamed > 0 && <> · {plan.renamed} cambian de nombre</>}
                {plan.classes > 0 && <> · {plan.classes} clases con profesor</>}
              </p>
              {valid.some((row) => row.action === 'catalogo') && <p className="mt-1 text-xs text-muted">Los módulos del catálogo EASA conservan su denominación oficial.</p>}
            </div>

            {invalid.length > 0 && (
              <div className="rounded-xl border border-danger/40 bg-danger-soft/40 p-4 text-sm">
                <p className="mb-1 font-semibold text-danger">No se importan ({invalid.length})</p>
                <ul className="space-y-0.5 text-ink-soft">{invalid.slice(0, 15).map((row) => <li key={row.line}>Fila {row.line}{row.code ? ` · ${row.code}` : ''}: {row.errors.join('. ')}</li>)}</ul>
              </div>
            )}
            {warnings.length > 0 && (
              <ul className="space-y-0.5 rounded-xl border border-line p-3 text-sm text-warn">{warnings.map((text) => <li key={text}>{text}</li>)}</ul>
            )}

            <div className="max-h-80 overflow-auto rounded-xl border border-line">
              <table className="w-full text-left text-sm">
                <thead className="sticky top-0 bg-surface">
                  <tr><th className="px-3 py-2">Módulo</th><th className="px-3 py-2">Denominación</th><th className="px-3 py-2 text-right">Total</th><th className="px-3 py-2 text-right">Teoría</th><th className="px-3 py-2 text-right">Práctica</th><th className="px-3 py-2">Curso</th><th className="px-3 py-2">Profesor</th></tr>
                </thead>
                <tbody>
                  {valid.map((row) => (
                    <tr key={row.line} className="border-t border-line">
                      <td className="px-3 py-2 font-semibold text-ink">{row.code}</td>
                      <td className="max-w-[14rem] truncate px-3 py-2 text-ink-soft" title={row.rename || row.name}>{row.rename || row.name}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{row.theoryHours + row.practiceHours}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{row.theoryHours}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{row.practiceHours}</td>
                      <td className="px-3 py-2">{row.level ? `${row.level}º` : '—'}</td>
                      <td className="px-3 py-2 text-xs text-muted">{row.teacher ? `${row.teacher.full_name || row.teacher.email}${row.classes.length ? ` · ${[...new Set(row.classes.map((item) => groupLabel(item.group)))].join(', ')}` : ''}` : '—'}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="sticky bottom-0 bg-surface">
                  <tr className="border-t-2 border-line font-semibold text-ink">
                    <td className="px-3 py-2" colSpan="2">Total módulos (calculado)</td>
                    <td className="px-3 py-2 text-right tabular-nums">{plan.totals.theory + plan.totals.practice}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{plan.totals.theory}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{plan.totals.practice}</td>
                    <td colSpan="2" />
                  </tr>
                </tfoot>
              </table>
            </div>

            <div className="flex justify-end gap-2">
              <button type="button" className="btn-ghost" onClick={() => setSource(null)} disabled={busy}>Volver</button>
              <button type="button" className="btn-primary" onClick={runImport} disabled={busy || !valid.length}>{busy ? 'Importando…' : `Importar ${valid.length} ${valid.length === 1 ? 'módulo' : 'módulos'}`}</button>
            </div>
          </>
        )}
      </div>
    </Modal>
  )
}
