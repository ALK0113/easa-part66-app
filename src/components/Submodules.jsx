import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { getSupabaseErrorMessage } from '../lib/supabaseErrors.js'
import { buildSubmodulesPlan, compareCodes, downloadSubmodulesTemplate, readSubmodules } from '../lib/curriculum.js'
import Modal from './Modal.jsx'
import Icon from './Icon.jsx'

// Submódulos EASA (11.1, 11.2…) de los módulos de un grado: a mano o importados.
export default function Submodules({ degree, schoolId, moduleNames, onClose }) {
  const moduleIds = [...new Set((degree.degree_modules || []).map((item) => item.module_id))].sort(compareCodes)
  const [items, setItems] = useState(null)
  const [moduleId, setModuleId] = useState(moduleIds[0] || '')
  const [form, setForm] = useState({ code: '', name: '' })
  const [pasted, setPasted] = useState('')
  const [plan, setPlan] = useState(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState(null)

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('submodules').select('id,module_id,code,name').eq('school_id', schoolId).in('module_id', moduleIds.length ? moduleIds : ['-'])
    if (error) setNotice({ error: true, text: getSupabaseErrorMessage(error) })
    setItems(data || [])
    // eslint-disable-next-line react-hooks/exhaustive-deps -- moduleIds sale del grado, que no cambia con la ventana abierta
  }, [schoolId, degree.id])

  useEffect(() => {
    let active = true
    supabase.from('submodules').select('id,module_id,code,name').eq('school_id', schoolId).in('module_id', moduleIds.length ? moduleIds : ['-'])
      .then(({ data, error }) => {
        if (!active) return
        if (error) setNotice({ error: true, text: getSupabaseErrorMessage(error) })
        setItems(data || [])
      })
    return () => { active = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- solo al abrir
  }, [schoolId, degree.id])

  const ofModule = (items || []).filter((item) => item.module_id === moduleId).sort((a, b) => compareCodes(a.code, b.code))

  async function add(event) {
    event.preventDefault()
    setBusy(true)
    const { error } = await supabase.from('submodules').insert({ school_id: schoolId, module_id: moduleId, code: form.code.trim(), name: form.name.trim() })
    setBusy(false)
    if (error) { setNotice({ error: true, text: error.code === '23505' ? `Ya existe el submódulo ${form.code} en ${moduleId}.` : getSupabaseErrorMessage(error) }); return }
    setForm({ code: '', name: '' })
    setNotice(null)
    await load()
  }

  async function remove(item) {
    if (!window.confirm(`¿Quitar el submódulo ${item.code}? Sus clases quedarán «sin submódulo».`)) return
    setBusy(true)
    const { error } = await supabase.from('submodules').delete().eq('id', item.id)
    setBusy(false)
    if (error) { setNotice({ error: true, text: getSupabaseErrorMessage(error) }); return }
    await load()
  }

  async function readSource(read) {
    setNotice(null)
    try {
      const result = buildSubmodulesPlan(await read(), moduleIds)
      if (!result.items.length && !result.errors.length) { setNotice({ error: true, text: 'No se reconoce ningún submódulo. Incluye la cabecera (Módulo, Submódulo, Nombre).' }); return }
      setPlan(result)
    } catch (err) {
      setNotice({ error: true, text: `No se pudo leer: ${err.message}` })
    }
  }

  async function runImport() {
    setBusy(true)
    const rows = plan.items.map((item) => ({ school_id: schoolId, module_id: item.moduleId, code: item.code, name: item.name }))
    const { error } = await supabase.from('submodules').upsert(rows, { onConflict: 'school_id,module_id,code' })
    setBusy(false)
    if (error) { setNotice({ error: true, text: getSupabaseErrorMessage(error) }); return }
    setNotice({ error: false, text: `Importados ${rows.length} submódulos.` })
    setPlan(null)
    setPasted('')
    await load()
  }

  return (
    <Modal title={`Submódulos · ${degree.code}`} onClose={onClose} wide>
      <div className="space-y-4">
        {notice && <p role={notice.error ? 'alert' : 'status'} className={notice.error ? 'notice-error' : 'notice-success'}>{notice.text}</p>}
        {!moduleIds.length ? <p className="text-sm text-muted">Este grado aún no tiene módulos.</p> : (
          <>
            <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Módulo">
              {moduleIds.map((id) => (
                <button key={id} type="button" role="radio" aria-checked={id === moduleId} onClick={() => setModuleId(id)}
                  className={`rounded-lg border px-2.5 py-1 text-xs font-semibold ${id === moduleId ? 'border-accent bg-accent-soft text-accent-strong' : 'border-line text-ink-soft hover:bg-subtle'}`}>
                  {id} <span className="font-normal text-muted">{(items || []).filter((item) => item.module_id === id).length || ''}</span>
                </button>
              ))}
            </div>
            <p className="text-sm text-muted">{moduleId} · {moduleNames[moduleId] || ''}</p>
            {items === null ? <p className="text-sm text-muted">Cargando…</p> : (
              <ul className="divide-y divide-line rounded-xl border border-line">
                {ofModule.map((item) => (
                  <li key={item.id} className="flex items-center gap-3 px-4 py-2 text-sm">
                    <span className="w-14 shrink-0 font-semibold tabular-nums text-ink">{item.code}</span>
                    <span className="min-w-0 flex-1 truncate text-ink-soft">{item.name}</span>
                    <button type="button" className="rounded-lg p-1 text-muted hover:bg-danger-soft hover:text-danger" disabled={busy} aria-label={`Quitar ${item.code}`} onClick={() => remove(item)}><Icon name="x" size={14} /></button>
                  </li>
                ))}
                {!ofModule.length && <li className="px-4 py-3 text-sm text-muted">Sin submódulos todavía.</li>}
              </ul>
            )}
            <form className="grid gap-2 sm:grid-cols-[6rem_1fr_auto]" onSubmit={add}>
              <input className="input" required maxLength={20} placeholder="11.1" aria-label="Código del submódulo" value={form.code} onChange={(event) => setForm({ ...form, code: event.target.value })} />
              <input className="input" required maxLength={200} placeholder="Nombre del submódulo" aria-label="Nombre del submódulo" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
              <button type="submit" className="btn-secondary" disabled={busy}><Icon name="plus" size={14} />Añadir</button>
            </form>
          </>
        )}

        <div className="space-y-3 rounded-xl border border-line p-4">
          <h4 className="text-sm font-semibold text-ink">Importar submódulos de todo el grado</h4>
          {!plan ? (
            <>
              <p className="text-xs text-muted"><strong>Módulo · Submódulo · Nombre</strong> (si falta el módulo se deduce del código: 11.3 → M11). Si ya existe, se actualiza el nombre.</p>
              <div className="flex flex-wrap gap-2">
                <label className="btn-secondary cursor-pointer">
                  <Icon name="upload" size={16} />Elegir archivo
                  <input type="file" accept=".csv,.tsv,.txt,.json,text/csv,application/json,text/plain" className="sr-only" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file) readSource(() => readSubmodules(file)) }} />
                </label>
                <button type="button" className="btn-ghost" onClick={downloadSubmodulesTemplate}><Icon name="download" size={16} />Plantilla CSV</button>
              </div>
              <textarea className="input font-mono text-xs" rows="3" aria-label="Tabla pegada de Excel" value={pasted} onChange={(event) => setPasted(event.target.value)} placeholder={'Módulo\tSubmódulo\tNombre\nM11\t11.1\tTeoría de vuelo'} />
              <div className="flex justify-end"><button type="button" className="btn-secondary" disabled={!pasted.trim()} onClick={() => readSource(() => readSubmodules(pasted))}>Revisar tabla pegada</button></div>
            </>
          ) : (
            <>
              <p className="text-sm text-ink-soft">{plan.items.length} submódulos: {[...new Set(plan.items.map((item) => item.moduleId))].map((id) => `${id} (${plan.items.filter((item) => item.moduleId === id).length})`).join(', ')}</p>
              {plan.errors.length > 0 && <ul className="rounded-lg bg-danger-soft/40 p-3 text-xs text-danger">{plan.errors.slice(0, 10).map((error) => <li key={error.line}>Fila {error.line}: {error.text}</li>)}</ul>}
              <div className="flex justify-end gap-2">
                <button type="button" className="btn-ghost" onClick={() => setPlan(null)} disabled={busy}>Volver</button>
                <button type="button" className="btn-primary" onClick={runImport} disabled={busy || !plan.items.length}>{busy ? 'Importando…' : `Importar ${plan.items.length}`}</button>
              </div>
            </>
          )}
        </div>
      </div>
    </Modal>
  )
}
