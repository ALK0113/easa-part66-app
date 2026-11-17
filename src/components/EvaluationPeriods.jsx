import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { getSupabaseErrorMessage } from '../lib/supabaseErrors.js'
import Icon from './Icon.jsx'

const formatDay = (value) => new Date(`${value}T00:00:00`).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' })
const toISO = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`

// Reparte el curso en tramos iguales: 1ª, 2ª, 3ª evaluación
function splitYear(year, count) {
  const start = new Date(`${year.starts_on}T00:00`)
  const end = new Date(`${year.ends_on}T00:00`)
  const span = (end - start) / count
  return Array.from({ length: count }, (_, index) => {
    const from = new Date(start.getTime() + span * index)
    const to = index === count - 1 ? end : new Date(start.getTime() + span * (index + 1) - 86400000)
    return { name: `${index + 1}ª evaluación`, position: index + 1, starts_on: toISO(from), ends_on: toISO(to) }
  })
}

// Evaluaciones de un curso escolar (dentro de su ficha). La final no se crea: es el curso entero
// y usa la nota final de cada módulo. Cada evaluación tiene su nota por módulo y sale en los boletines.
export default function EvaluationPeriods({ year }) {
  const yearId = year?.id
  const [items, setItems] = useState(null)
  const [editing, setEditing] = useState(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState(null)

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('evaluation_periods').select('id,name,position,starts_on,ends_on').eq('academic_year_id', yearId).order('position')
    if (error) setNotice({ error: true, text: getSupabaseErrorMessage(error) })
    return data || []
  }, [yearId])

  useEffect(() => {
    if (!yearId) return undefined
    let active = true
    supabase.from('evaluation_periods').select('id,name,position,starts_on,ends_on').eq('academic_year_id', yearId).order('position')
      .then(({ data, error }) => {
        if (!active) return
        if (error) setNotice({ error: true, text: getSupabaseErrorMessage(error) })
        setItems(data || [])
      })
    return () => { active = false }
  }, [yearId])

  async function run(query, okText) {
    setBusy(true)
    const { error } = await query
    setBusy(false)
    if (error) { setNotice({ error: true, text: getSupabaseErrorMessage(error) }); return false }
    setNotice({ error: false, text: okText })
    setItems(await load())
    return true
  }

  const createThree = () => run(supabase.from('evaluation_periods').insert(splitYear(year, 3).map((item) => ({ ...item, academic_year_id: yearId }))), 'Creadas 3 evaluaciones. Ajusta las fechas si hace falta.')

  async function save(event) {
    event.preventDefault()
    if (editing.ends_on < editing.starts_on) { setNotice({ error: true, text: 'La fecha de fin es anterior al inicio.' }); return }
    const values = { name: editing.name.trim(), starts_on: editing.starts_on, ends_on: editing.ends_on }
    const ok = editing.id
      ? await run(supabase.from('evaluation_periods').update(values).eq('id', editing.id), 'Evaluación guardada.')
      : await run(supabase.from('evaluation_periods').insert({ ...values, academic_year_id: yearId, position: Math.max(0, ...(items || []).map((item) => item.position)) + 1 }), 'Evaluación añadida.')
    if (ok) setEditing(null)
  }

  async function remove(item) {
    if (!window.confirm(`¿Borrar «${item.name}»? Se borrarán también las notas y comentarios puestos en esa evaluación.`)) return
    if (await run(supabase.from('evaluation_periods').delete().eq('id', item.id), 'Evaluación borrada.')) setEditing(null)
  }

  if (!yearId) return null

  return (
    <section className="space-y-3 border-t border-line pt-5">
      <div>
        <h3 className="font-semibold text-ink">Evaluaciones</h3>
        <p className="mt-0.5 text-sm text-muted">Cada evaluación tiene su nota por módulo y su boletín. La evaluación final es el curso entero y usa la nota final de cada módulo.</p>
      </div>

      {notice && <p role={notice.error ? 'alert' : 'status'} className={notice.error ? 'notice-error' : 'notice-success'}>{notice.text}</p>}

      {items === null ? <p className="text-sm text-muted">Cargando…</p> : (
        <ul className="divide-y divide-line rounded-xl border border-line">
          {items.map((item) => (
            <li key={item.id}>
              {editing?.id === item.id ? <PeriodForm value={editing} year={year} busy={busy} onChange={setEditing} onSubmit={save} onCancel={() => setEditing(null)} onDelete={() => remove(item)} /> : (
                <button type="button" onClick={() => setEditing({ ...item })} className="flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm hover:bg-subtle">
                  <span className="min-w-0 flex-1 font-medium text-ink">{item.name}</span>
                  <span className="tabular-nums text-muted">{formatDay(item.starts_on)} - {formatDay(item.ends_on)}</span>
                  <Icon name="edit" size={14} className="text-faint" />
                </button>
              )}
            </li>
          ))}
          <li className="flex items-center gap-3 px-3 py-2.5 text-sm text-muted">
            <span className="min-w-0 flex-1">Evaluación final</span>
            <span className="tabular-nums">{formatDay(year.starts_on)} - {formatDay(year.ends_on)}</span>
          </li>
          {editing && !editing.id && <li><PeriodForm value={editing} year={year} busy={busy} onChange={setEditing} onSubmit={save} onCancel={() => setEditing(null)} /></li>}
        </ul>
      )}

      {items && !editing && (
        <div className="flex flex-wrap gap-2">
          {items.length === 0 && <button type="button" className="btn-primary" disabled={busy} onClick={createThree}><Icon name="plus" size={16} />Crear 3 evaluaciones</button>}
          <button type="button" className={items.length === 0 ? 'btn-ghost' : 'btn-secondary'} disabled={busy}
            onClick={() => setEditing({ name: `${items.length + 1}ª evaluación`, starts_on: items.at(-1) ? toISO(new Date(new Date(`${items.at(-1).ends_on}T00:00`).getTime() + 86400000)) : year.starts_on, ends_on: year.ends_on })}>
            <Icon name="plus" size={16} />Añadir evaluación
          </button>
        </div>
      )}
    </section>
  )
}

function PeriodForm({ value, year, busy, onChange, onSubmit, onCancel, onDelete }) {
  return (
    <form className="grid gap-2 p-3 sm:grid-cols-[1fr_auto_auto] sm:items-end" onSubmit={onSubmit}>
      <label className="field">Nombre<input className="input" required maxLength={60} value={value.name} onChange={(event) => onChange({ ...value, name: event.target.value })} /></label>
      <label className="field">Desde<input className="input" type="date" required min={year.starts_on} max={year.ends_on} value={value.starts_on} onChange={(event) => onChange({ ...value, starts_on: event.target.value })} /></label>
      <label className="field">Hasta<input className="input" type="date" required min={value.starts_on || year.starts_on} max={year.ends_on} value={value.ends_on} onChange={(event) => onChange({ ...value, ends_on: event.target.value })} /></label>
      <div className="flex flex-wrap justify-end gap-2 sm:col-span-3">
        {onDelete && <button type="button" className="btn-ghost mr-auto text-danger" disabled={busy} onClick={onDelete}>Borrar</button>}
        <button type="button" className="btn-ghost" onClick={onCancel}>Cancelar</button>
        <button type="submit" className="btn-primary" disabled={busy}>{busy ? 'Guardando…' : 'Guardar'}</button>
      </div>
    </form>
  )
}
