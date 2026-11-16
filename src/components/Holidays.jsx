import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { getSupabaseErrorMessage } from '../lib/supabaseErrors.js'
import { buildHolidaysPlan, downloadHolidaysCsvTemplate, downloadHolidaysJsonTemplate, readHolidaysFile, readHolidaysText } from '../lib/importHolidays.js'
import Icon from './Icon.jsx'

const formatDay = (value) => new Date(`${value}T00:00:00`).toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' })
const days = (item) => Math.round((new Date(`${item.ends_on}T00:00`) - new Date(`${item.starts_on}T00:00`)) / 86400000) + 1

// Festivos y vacaciones de un curso escolar (dentro de su ficha): a mano o importados (CSV, JSON o tabla
// pegada de Excel). Esos días no hay clases: la base de datos quita (o cancela) las del calendario y las repone al quitarlos.
export default function Holidays({ year }) {
  const yearId = year?.id
  const [items, setItems] = useState(null)
  const [form, setForm] = useState({ starts_on: '', ends_on: '', name: '' })
  const [importing, setImporting] = useState(false)
  const [pasted, setPasted] = useState('')
  const [raw, setRaw] = useState(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState(null)

  const load = useCallback(async () => {
    if (!yearId) return
    const { data, error } = await supabase.from('school_holidays').select('id,starts_on,ends_on,name').eq('academic_year_id', yearId).order('starts_on')
    if (error) setNotice({ error: true, text: getSupabaseErrorMessage(error) })
    setItems(data || [])
  }, [yearId])

  useEffect(() => {
    let active = true
    if (!yearId) return undefined
    supabase.from('school_holidays').select('id,starts_on,ends_on,name').eq('academic_year_id', yearId).order('starts_on')
      .then(({ data, error }) => {
        if (!active) return
        if (error) setNotice({ error: true, text: getSupabaseErrorMessage(error) })
        setItems(data || [])
      })
    return () => { active = false }
  }, [yearId])

  const plan = useMemo(() => (raw && year && items ? buildHolidaysPlan(raw, year, items) : null), [raw, year, items])
  const toImport = plan ? plan.filter((row) => !row.errors.length && !row.duplicate) : []
  const totalDays = (items || []).reduce((sum, item) => sum + days(item), 0)

  async function save(rows, okText) {
    setBusy(true)
    const { error } = await supabase.from('school_holidays').insert(rows.map((row) => ({ ...row, academic_year_id: yearId })))
    setBusy(false)
    if (error) { setNotice({ error: true, text: getSupabaseErrorMessage(error) }); return false }
    setNotice({ error: false, text: okText })
    await load()
    return true
  }

  async function addOne(event) {
    event.preventDefault()
    const ends = form.ends_on || form.starts_on
    if (ends < form.starts_on) { setNotice({ error: true, text: 'La fecha de fin es anterior al inicio.' }); return }
    if (year && (form.starts_on < year.starts_on || ends > year.ends_on)) { setNotice({ error: true, text: 'La fecha está fuera del curso escolar.' }); return }
    const ok = await save([{ starts_on: form.starts_on, ends_on: ends, name: form.name.trim() || 'Festivo' }], 'Festivo añadido. Ese día ya no tiene clases en el calendario.')
    if (ok) setForm({ starts_on: '', ends_on: '', name: '' })
  }

  async function remove(item) {
    if (!window.confirm(`¿Quitar «${item.name}»? Las clases de la plantilla semanal de esos días vuelven al calendario.`)) return
    setBusy(true)
    const { error } = await supabase.from('school_holidays').delete().eq('id', item.id)
    setBusy(false)
    if (error) { setNotice({ error: true, text: getSupabaseErrorMessage(error) }); return }
    setNotice({ error: false, text: 'Festivo quitado. Sus clases han vuelto al calendario.' })
    await load()
  }

  async function readSource(read) {
    setNotice(null)
    try {
      const rows = await read()
      if (!rows.length) { setNotice({ error: true, text: 'No se reconoce ningún festivo. Incluye la cabecera (fecha, fin, nombre).' }); return }
      setRaw(rows)
    } catch (err) {
      setNotice({ error: true, text: `No se pudo leer: ${err.message}` })
    }
  }

  async function runImport() {
    const ok = await save(toImport.map((row) => row.values), `Importados ${toImport.length} festivos o periodos de vacaciones. Esos días ya no tienen clases.`)
    if (ok) { setRaw(null); setPasted(''); setImporting(false) }
  }

  if (!yearId) return null
  const holidays = (items || []).filter((item) => item.starts_on === item.ends_on)
  const vacations = (items || []).filter((item) => item.starts_on !== item.ends_on)
  const list = (title, entries, empty) => (
    <div>
      <h4 className="mb-1.5 text-xs font-semibold text-muted">{title} · {entries.length}</h4>
      {entries.length === 0 ? <p className="text-sm text-faint">{empty}</p> : (
        <ul className="divide-y divide-line rounded-xl border border-line">
          {entries.map((item) => (
            <li key={item.id} className="flex items-center gap-3 px-3 py-2 text-sm">
              <span className="w-44 shrink-0 tabular-nums text-ink">{item.starts_on === item.ends_on ? formatDay(item.starts_on) : `${formatDay(item.starts_on)} – ${formatDay(item.ends_on)}`}</span>
              <span className="min-w-0 flex-1 truncate text-ink-soft">{item.name}</span>
              {days(item) > 1 && <span className="shrink-0 text-xs text-muted">{days(item)} días</span>}
              <button type="button" className="rounded-lg p-1.5 text-muted hover:bg-danger-soft hover:text-danger" disabled={busy} aria-label={`Quitar ${item.name}`} onClick={() => remove(item)}><Icon name="x" size={16} /></button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )

  return (
    <section className="space-y-4 border-t border-line pt-5">
      <div>
        <h3 className="font-semibold text-ink">Festivos y vacaciones</h3>
        <p className="mt-0.5 text-sm text-muted">Esos días no hay clases: se quitan del calendario (o se cancelan si ya tenían asistencia o práctica) y vuelven si los quitas.</p>
      </div>

      {notice && <p role={notice.error ? 'alert' : 'status'} className={notice.error ? 'notice-error' : 'notice-success'}>{notice.text}</p>}

      <form className="grid gap-2 sm:grid-cols-[auto_auto_1fr_auto] sm:items-end" onSubmit={addOne}>
        <label className="field">Fecha<input className="input" type="date" required min={year?.starts_on} max={year?.ends_on} value={form.starts_on} onChange={(event) => setForm({ ...form, starts_on: event.target.value })} /></label>
        <label className="field">Hasta (vacaciones)<input className="input" type="date" min={form.starts_on || year?.starts_on} max={year?.ends_on} value={form.ends_on} onChange={(event) => setForm({ ...form, ends_on: event.target.value })} /></label>
        <label className="field">Nombre<input className="input" maxLength={120} placeholder="Fiesta local, Vacaciones de Navidad…" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
        <button type="submit" className="btn-primary" disabled={busy || !form.starts_on}><Icon name="plus" size={16} />Añadir</button>
      </form>

      {items === null ? <p className="text-sm text-muted">Cargando…</p> : (
        <>
          {list('Festivos', holidays, 'Sin festivos.')}
          {list('Vacaciones', vacations, 'Sin periodos de vacaciones.')}
          {items.length > 0 && <p className="text-xs text-muted">{totalDays} días no lectivos en el curso</p>}
        </>
      )}

      {!importing ? (
        <button type="button" className="btn-secondary" onClick={() => setImporting(true)}><Icon name="upload" size={16} />Importar festivos</button>
      ) : (
        <div className="space-y-3 rounded-xl border border-line p-4">
          <div className="flex items-center justify-between gap-2">
            <h4 className="text-sm font-semibold text-ink">Importar festivos</h4>
            <button type="button" className="btn-ghost text-sm" onClick={() => { setImporting(false); setRaw(null) }}>Cerrar</button>
          </div>
          {!plan ? (
            <>
              <p className="text-xs text-muted">CSV, JSON o tabla pegada de Excel con <strong>fecha</strong>, <strong>fin</strong> (opcional, para periodos) y <strong>nombre</strong>. Un JSON con «festivos» y «vacaciones_escolares» se lee directamente.</p>
              <div className="flex flex-wrap gap-2">
                <label className="btn-primary cursor-pointer">
                  <Icon name="upload" size={16} />Elegir archivo
                  <input type="file" accept=".csv,.tsv,.txt,.json,text/csv,application/json,text/plain" className="sr-only" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file) readSource(() => readHolidaysFile(file)) }} />
                </label>
                <button type="button" className="btn-secondary" onClick={downloadHolidaysCsvTemplate}><Icon name="download" size={16} />Plantilla CSV</button>
                <button type="button" className="btn-secondary" onClick={downloadHolidaysJsonTemplate}><Icon name="download" size={16} />Plantilla JSON</button>
              </div>
              <label className="field">O pega la tabla copiada de Excel
                <textarea className="input font-mono text-xs" rows="4" value={pasted} onChange={(event) => setPasted(event.target.value)} placeholder={'fecha\tfin\tnombre\n12/10/2026\t\tFiesta Nacional\n22/12/2026\t07/01/2027\tVacaciones de Navidad'} />
              </label>
              <div className="flex justify-end"><button type="button" className="btn-secondary" disabled={!pasted.trim()} onClick={() => readSource(() => readHolidaysText(pasted))}>Revisar tabla pegada</button></div>
            </>
          ) : (
            <>
              <ul className="max-h-64 divide-y divide-line overflow-auto rounded-xl border border-line text-sm">
                {plan.map((row) => (
                  <li key={row.line} className={`flex items-center gap-3 px-3 py-2 ${row.errors.length ? 'bg-danger-soft/40' : ''}`}>
                    <span className="w-44 shrink-0 tabular-nums">{row.values.starts_on ? (row.values.starts_on === row.values.ends_on ? formatDay(row.values.starts_on) : `${formatDay(row.values.starts_on)} – ${row.values.ends_on ? formatDay(row.values.ends_on) : '?'}`) : '—'}</span>
                    <span className="min-w-0 flex-1 truncate text-ink-soft">{row.values.name}</span>
                    <span className={`shrink-0 text-xs ${row.errors.length ? 'text-danger' : 'text-muted'}`}>{row.errors.length ? row.errors.join('. ') : row.duplicate ? 'Ya está' : 'Nuevo'}</span>
                  </li>
                ))}
              </ul>
              <div className="flex justify-end gap-2">
                <button type="button" className="btn-ghost" onClick={() => setRaw(null)} disabled={busy}>Volver</button>
                <button type="button" className="btn-primary" onClick={runImport} disabled={busy || !toImport.length}>{busy ? 'Importando…' : `Importar ${toImport.length}`}</button>
              </div>
            </>
          )}
        </div>
      )}
    </section>
  )
}
