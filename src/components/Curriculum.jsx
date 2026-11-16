import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { getSupabaseErrorMessage } from '../lib/supabaseErrors.js'
import { buildCurriculumPlan, downloadCurriculumTemplate, readCurriculum } from '../lib/curriculum.js'
import Icon from './Icon.jsx'

// Currículum oficial (Departament d'Educació): módulos profesionales (MP) con sus RA,
// y qué MP usa cada módulo EASA. Se crea a mano o se importa (CSV, JSON o tabla pegada de Excel).
export default function Curriculum({ schoolId, easaModules }) {
  const [mps, setMps] = useState(null)
  const [links, setLinks] = useState([])
  const [open, setOpen] = useState(null) // MP desplegado
  const [newMp, setNewMp] = useState({ code: '', name: '' })
  const [newRa, setNewRa] = useState({ number: '', description: '' })
  const [importing, setImporting] = useState(false)
  const [pasted, setPasted] = useState('')
  const [plan, setPlan] = useState(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState(null)

  const load = useCallback(async () => {
    const [mpResult, linkResult] = await Promise.all([
      supabase.from('professional_modules').select('id,code,name,learning_outcomes(id,number,description)').eq('school_id', schoolId).order('code'),
      supabase.from('module_professional_modules').select('module_id,professional_module_id').eq('school_id', schoolId),
    ])
    if (mpResult.error) setNotice({ error: true, text: getSupabaseErrorMessage(mpResult.error) })
    setMps(mpResult.data || [])
    setLinks(linkResult.data || [])
  }, [schoolId])

  useEffect(() => {
    let active = true
    Promise.all([
      supabase.from('professional_modules').select('id,code,name,learning_outcomes(id,number,description)').eq('school_id', schoolId).order('code'),
      supabase.from('module_professional_modules').select('module_id,professional_module_id').eq('school_id', schoolId),
    ]).then(([mpResult, linkResult]) => {
      if (!active) return
      if (mpResult.error) setNotice({ error: true, text: getSupabaseErrorMessage(mpResult.error) })
      setMps(mpResult.data || [])
      setLinks(linkResult.data || [])
    })
    return () => { active = false }
  }, [schoolId])

  const linkedModules = useMemo(() => {
    const map = new Map()
    links.forEach((link) => map.set(link.professional_module_id, [...(map.get(link.professional_module_id) || []), link.module_id]))
    return map
  }, [links])

  async function run(action, okText) {
    setBusy(true)
    const { error } = await action()
    setBusy(false)
    if (error) { setNotice({ error: true, text: getSupabaseErrorMessage(error) }); return false }
    if (okText) setNotice({ error: false, text: okText })
    await load()
    return true
  }

  async function addMp(event) {
    event.preventDefault()
    if (await run(() => supabase.from('professional_modules').insert({ school_id: schoolId, code: newMp.code.trim(), name: newMp.name.trim() || newMp.code.trim() }), `MP ${newMp.code} añadido.`)) setNewMp({ code: '', name: '' })
  }

  async function addRa(event, mp) {
    event.preventDefault()
    if (await run(() => supabase.from('learning_outcomes').insert({ professional_module_id: mp.id, number: Number(newRa.number), description: newRa.description.trim() }), `RA${newRa.number} añadido a ${mp.code}.`)) setNewRa({ number: '', description: '' })
  }

  const toggleModule = (mp, moduleId) => (linkedModules.get(mp.id) || []).includes(moduleId)
    ? run(() => supabase.from('module_professional_modules').delete().eq('school_id', schoolId).eq('module_id', moduleId).eq('professional_module_id', mp.id))
    : run(() => supabase.from('module_professional_modules').insert({ school_id: schoolId, module_id: moduleId, professional_module_id: mp.id }))

  async function readSource(read) {
    setNotice(null)
    try {
      const raw = await read()
      const result = buildCurriculumPlan(raw)
      if (!result.mps.length) { setNotice({ error: true, text: 'No se reconoce ningún MP. Incluye la cabecera (MP, Nombre MP, RA, Descripción RA).' }); return }
      setPlan(result)
    } catch (err) {
      setNotice({ error: true, text: `No se pudo leer: ${err.message}` })
    }
  }

  async function runImport() {
    setBusy(true)
    try {
      const { data: saved, error: mpError } = await supabase.from('professional_modules')
        .upsert(plan.mps.map((mp) => ({ school_id: schoolId, code: mp.code, name: mp.name })), { onConflict: 'school_id,code' })
        .select('id,code')
      if (mpError) throw mpError
      const idByCode = new Map(saved.map((mp) => [mp.code, mp.id]))
      const outcomes = plan.mps.flatMap((mp) => mp.outcomes.map((ra) => ({ professional_module_id: idByCode.get(mp.code), number: ra.number, description: ra.description })))
      if (outcomes.length) {
        const { error: raError } = await supabase.from('learning_outcomes').upsert(outcomes, { onConflict: 'professional_module_id,number' })
        if (raError) throw raError
      }
      setNotice({ error: false, text: `Importado: ${plan.mps.length} módulos profesionales y ${outcomes.length} RA. Ahora indica qué módulos EASA usa cada MP.` })
      setPlan(null)
      setPasted('')
      setImporting(false)
      await load()
    } catch (err) {
      setNotice({ error: true, text: `No se pudo importar: ${getSupabaseErrorMessage(err)}` })
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="card space-y-4 p-5 md:p-6">
      <div>
        <h3 className="text-lg font-semibold text-ink">Currículum oficial · MP y RA</h3>
        <p className="mt-0.5 text-sm text-muted">Módulos profesionales y resultados de aprendizaje del Departament d'Educació. Cada módulo EASA usa los RA de uno o varios MP; las clases y los exámenes eligen su RA de aquí.</p>
      </div>
      {notice && <p role={notice.error ? 'alert' : 'status'} className={notice.error ? 'notice-error' : 'notice-success'}>{notice.text}</p>}

      {mps === null ? <p className="text-sm text-muted">Cargando…</p> : (
        <ul className="divide-y divide-line rounded-xl border border-line">
          {mps.map((mp) => {
            const outcomes = [...(mp.learning_outcomes || [])].sort((a, b) => a.number - b.number)
            const used = linkedModules.get(mp.id) || []
            return (
              <li key={mp.id}>
                <button type="button" className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-subtle" onClick={() => setOpen(open === mp.id ? null : mp.id)}>
                  <span className="w-14 shrink-0 font-semibold tabular-nums text-ink">{mp.code}</span>
                  <span className="min-w-0 flex-1 truncate text-sm text-ink-soft">{mp.name}</span>
                  <span className="shrink-0 text-xs text-muted">{outcomes.length} RA{used.length ? ` · ${used.join(', ')}` : ' · sin módulo EASA'}</span>
                  <Icon name="next" size={16} className={`text-faint transition-transform ${open === mp.id ? 'rotate-90' : ''}`} />
                </button>
                {open === mp.id && (
                  <div className="space-y-3 border-t border-line bg-subtle/40 px-4 py-3">
                    <div>
                      <p className="mb-1.5 text-xs font-semibold text-muted">Módulos EASA que usan este MP</p>
                      <div className="flex flex-wrap gap-1.5">
                        {easaModules.map((moduleId) => (
                          <button key={moduleId} type="button" disabled={busy} onClick={() => toggleModule(mp, moduleId)}
                            className={`rounded-lg border px-2.5 py-1 text-xs font-medium ${used.includes(moduleId) ? 'border-accent bg-accent-soft text-accent-strong' : 'border-line text-ink-soft hover:bg-surface'}`}>
                            {moduleId}
                          </button>
                        ))}
                      </div>
                    </div>
                    <ul className="space-y-1">
                      {outcomes.map((ra) => (
                        <li key={ra.id} className="flex items-start gap-3 text-sm">
                          <span className="w-12 shrink-0 font-semibold text-ink">RA{ra.number}</span>
                          <span className="min-w-0 flex-1 text-ink-soft">{ra.description}</span>
                          <button type="button" className="rounded-lg p-1 text-muted hover:bg-danger-soft hover:text-danger" disabled={busy} aria-label={`Quitar RA${ra.number}`}
                            onClick={() => window.confirm(`¿Quitar ${mp.code} RA${ra.number}? Las clases y exámenes que lo usan quedarán sin RA.`) && run(() => supabase.from('learning_outcomes').delete().eq('id', ra.id))}><Icon name="x" size={14} /></button>
                        </li>
                      ))}
                      {!outcomes.length && <li className="text-sm text-faint">Sin RA todavía.</li>}
                    </ul>
                    <form className="grid gap-2 sm:grid-cols-[5rem_1fr_auto]" onSubmit={(event) => addRa(event, mp)}>
                      <input className="input" type="number" min="1" max="50" required placeholder="Nº" aria-label="Número de RA" value={newRa.number} onChange={(event) => setNewRa({ ...newRa, number: event.target.value })} />
                      <input className="input" required maxLength={1000} placeholder="Descripción del RA" aria-label="Descripción del RA" value={newRa.description} onChange={(event) => setNewRa({ ...newRa, description: event.target.value })} />
                      <button type="submit" className="btn-secondary" disabled={busy}><Icon name="plus" size={14} />RA</button>
                    </form>
                    <button type="button" className="btn-ghost text-xs text-danger" disabled={busy}
                      onClick={() => window.confirm(`¿Eliminar el MP ${mp.code} y sus RA?`) && run(() => supabase.from('professional_modules').delete().eq('id', mp.id), `MP ${mp.code} eliminado.`)}>
                      <Icon name="trash" size={14} />Eliminar MP
                    </button>
                  </div>
                )}
              </li>
            )
          })}
          {!mps.length && <li className="px-4 py-4 text-sm text-muted">Aún no hay módulos profesionales. Añádelos o impórtalos.</li>}
        </ul>
      )}

      <form className="grid gap-2 sm:grid-cols-[7rem_1fr_auto]" onSubmit={addMp}>
        <input className="input" required maxLength={20} placeholder="Código MP" aria-label="Código del MP" value={newMp.code} onChange={(event) => setNewMp({ ...newMp, code: event.target.value })} />
        <input className="input" maxLength={200} placeholder="Nombre del módulo profesional" aria-label="Nombre del MP" value={newMp.name} onChange={(event) => setNewMp({ ...newMp, name: event.target.value })} />
        <button type="submit" className="btn-secondary" disabled={busy}><Icon name="plus" size={16} />MP</button>
      </form>

      {!importing ? (
        <button type="button" className="btn-secondary" onClick={() => setImporting(true)}><Icon name="upload" size={16} />Importar MP y RA</button>
      ) : (
        <div className="space-y-3 rounded-xl border border-line p-4">
          <div className="flex items-center justify-between gap-2">
            <h4 className="text-sm font-semibold text-ink">Importar MP y RA</h4>
            <button type="button" className="btn-ghost text-sm" onClick={() => { setImporting(false); setPlan(null) }}>Cerrar</button>
          </div>
          {!plan ? (
            <>
              <p className="text-xs text-muted">Una fila por RA: <strong>MP · Nombre MP · RA · Descripción RA</strong>. Si un RA ya existe, se actualiza su descripción.</p>
              <div className="flex flex-wrap gap-2">
                <label className="btn-primary cursor-pointer">
                  <Icon name="upload" size={16} />Elegir archivo
                  <input type="file" accept=".csv,.tsv,.txt,.json,text/csv,application/json,text/plain" className="sr-only" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file) readSource(() => readCurriculum(file)) }} />
                </label>
                <button type="button" className="btn-secondary" onClick={downloadCurriculumTemplate}><Icon name="download" size={16} />Plantilla CSV</button>
              </div>
              <label className="field">O pega la tabla copiada de Excel
                <textarea className="input font-mono text-xs" rows="4" value={pasted} onChange={(event) => setPasted(event.target.value)} placeholder={'MP\tNombre MP\tRA\tDescripción RA\n1440\tSistemas de aeronaves\tRA1\tDescribe …'} />
              </label>
              <div className="flex justify-end"><button type="button" className="btn-secondary" disabled={!pasted.trim()} onClick={() => readSource(() => readCurriculum(pasted))}>Revisar tabla pegada</button></div>
            </>
          ) : (
            <>
              <ul className="max-h-64 space-y-2 overflow-auto text-sm">
                {plan.mps.map((mp) => (
                  <li key={mp.code} className="rounded-lg border border-line px-3 py-2">
                    <p className="font-medium text-ink">{mp.code} · {mp.name} <span className="text-xs font-normal text-muted">· {mp.outcomes.length} RA</span></p>
                    <p className="mt-0.5 line-clamp-2 text-xs text-muted">{mp.outcomes.map((ra) => `RA${ra.number}`).join(', ')}</p>
                  </li>
                ))}
              </ul>
              {plan.errors.length > 0 && <ul className="rounded-lg bg-danger-soft/40 p-3 text-xs text-danger">{plan.errors.slice(0, 10).map((error) => <li key={error.line}>Fila {error.line}: {error.text}</li>)}</ul>}
              <div className="flex justify-end gap-2">
                <button type="button" className="btn-ghost" onClick={() => setPlan(null)} disabled={busy}>Volver</button>
                <button type="button" className="btn-primary" onClick={runImport} disabled={busy}>{busy ? 'Importando…' : `Importar ${plan.mps.length} MP`}</button>
              </div>
            </>
          )}
        </div>
      )}
    </section>
  )
}
