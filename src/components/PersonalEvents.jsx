import { useMemo, useState } from 'react'
import { getSupabaseErrorMessage } from '../lib/supabaseErrors.js'
import { parseISODate, time } from '../lib/schedule.js'
import { defaultEventDraft, deleteEvent, eventShareText, eventTimeText, leaveEvent, saveEvent, useShareCandidates } from '../lib/personalEvents.js'
import Modal from './Modal.jsx'
import Icon from './Icon.jsx'

// Eventos personales del calendario: tarjeta, formulario (dueño) y vista (quien lo recibe compartido).

const longDate = (iso) => {
  const text = parseISODate(iso).toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' })
  return text.charAt(0).toUpperCase() + text.slice(1)
}

// Tarjeta de evento: distinta de una clase (borde discontinuo y fondo suave)
export function EventCard({ event, onOpen, compact = false }) {
  return (
    <button type="button" onClick={() => onOpen(event)}
      className={`w-full rounded-xl border border-dashed border-line-strong bg-subtle text-left transition-colors hover:bg-surface ${compact ? 'flex items-center gap-4 px-3 py-2.5' : 'px-3 py-2'}`}>
      {compact ? (
        <>
          <span className="w-14 shrink-0 text-sm tabular-nums text-muted">{event.all_day ? 'Día' : time(event.start_time)}</span>
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium text-ink">{event.title}</span>
            <span className="mt-0.5 block truncate text-xs text-muted">Evento · {eventShareText(event)}</span>
          </span>
          <Icon name="next" size={16} className="text-faint" />
        </>
      ) : (
        <>
          <span className="block text-xs tabular-nums text-muted">{eventTimeText(event)}</span>
          <span className="block truncate text-sm font-medium text-ink">{event.title}</span>
          <span className="block truncate text-xs text-muted">{eventShareText(event)}</span>
        </>
      )}
    </button>
  )
}

// Crear o editar un evento propio, con a quién se comparte
export function EventForm({ event = null, date, onClose, onSaved }) {
  const [form, setForm] = useState(() => (event
    ? { title: event.title, note: event.note || '', date: event.date, all_day: event.all_day, start_time: event.start_time ? time(event.start_time) : '16:00', end_time: event.end_time ? time(event.end_time) : '17:00', repeat_weekly: event.repeat_weekly, repeat_until: event.repeat_until || event.date }
    : defaultEventDraft(date)))
  const [shared, setShared] = useState(() => event?.shared_with || [])
  const [search, setSearch] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const candidates = useShareCandidates(true)
  const shown = useMemo(() => {
    const text = search.trim().toLowerCase()
    return (candidates || []).filter((item) => !text || (item.full_name || '').toLowerCase().includes(text) || (item.detail || '').toLowerCase().includes(text))
  }, [candidates, search])

  async function save(submit) {
    submit.preventDefault()
    if (!form.all_day && form.end_time <= form.start_time) { setError('La hora de fin tiene que ser posterior al inicio.'); return }
    if (form.repeat_weekly && form.repeat_until < form.date) { setError('La repetición termina antes de empezar.'); return }
    setBusy(true)
    setError('')
    try {
      await saveEvent(event?.id, form, shared, event?.shared_with || [])
      onSaved(shared.length ? `Evento guardado y compartido con ${shared.length} ${shared.length === 1 ? 'persona' : 'personas'}.` : 'Evento guardado. Solo lo ves tú.')
    } catch (saveError) {
      setError(getSupabaseErrorMessage(saveError))
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    if (!window.confirm(event.repeat_weekly ? '¿Borrar este evento y todas sus repeticiones?' : '¿Borrar este evento?')) return
    setBusy(true)
    try {
      await deleteEvent(event.id)
      onSaved('Evento borrado.')
    } catch (deleteError) {
      setError(getSupabaseErrorMessage(deleteError))
      setBusy(false)
    }
  }

  const toggle = (profileId) => setShared((list) => (list.includes(profileId) ? list.filter((id) => id !== profileId) : [...list, profileId]))

  return (
    <Modal title={event ? 'Evento' : 'Nuevo evento'} onClose={onClose}>
      <form className="space-y-4" onSubmit={save}>
        <label className="field">Título<input className="input" required maxLength={120} autoFocus={!event} placeholder="Estudiar M07, tutoría, entrega…" value={form.title} onChange={(change) => setForm({ ...form, title: change.target.value })} /></label>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="field">Día<input className="input" type="date" required value={form.date} onChange={(change) => setForm({ ...form, date: change.target.value })} /></label>
          {!form.all_day && <label className="field">Empieza<input className="input" type="time" required value={form.start_time} onChange={(change) => setForm({ ...form, start_time: change.target.value })} /></label>}
          {!form.all_day && <label className="field">Termina<input className="input" type="time" required value={form.end_time} onChange={(change) => setForm({ ...form, end_time: change.target.value })} /></label>}
        </div>
        <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-ink-soft">
          <label className="inline-flex items-center gap-2"><input type="checkbox" checked={form.all_day} onChange={(change) => setForm({ ...form, all_day: change.target.checked })} />Todo el día</label>
          <label className="inline-flex items-center gap-2"><input type="checkbox" checked={form.repeat_weekly} onChange={(change) => setForm({ ...form, repeat_weekly: change.target.checked })} />Repetir cada semana</label>
        </div>
        {form.repeat_weekly && (
          <label className="field">Hasta<input className="input" type="date" required min={form.date} value={form.repeat_until} onChange={(change) => setForm({ ...form, repeat_until: change.target.value })} /></label>
        )}
        <label className="field">Nota<textarea className="input" rows={2} maxLength={1000} value={form.note} onChange={(change) => setForm({ ...form, note: change.target.value })} /></label>

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-ink-soft">Compartir con <span className="font-normal text-muted">(opcional · si no eliges a nadie, solo lo ves tú)</span></legend>
          {candidates === null ? <p className="text-sm text-muted">Cargando compañeros…</p> : candidates.length === 0 ? (
            <p className="text-sm text-muted">No hay compañeros con los que compartir.</p>
          ) : (
            <>
              <input className="input" type="search" placeholder="Buscar por nombre o grupo…" aria-label="Buscar compañeros" value={search} onChange={(change) => setSearch(change.target.value)} />
              <ul className="max-h-48 divide-y divide-line overflow-y-auto rounded-xl border border-line">
                {shown.map((item) => (
                  <li key={item.profile_id}>
                    <label className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-subtle">
                      <input type="checkbox" checked={shared.includes(item.profile_id)} onChange={() => toggle(item.profile_id)} />
                      <span className="min-w-0 flex-1 truncate text-ink">{item.full_name || 'Sin nombre'}</span>
                      <span className="shrink-0 text-xs text-muted">{item.detail}</span>
                    </label>
                  </li>
                ))}
                {shown.length === 0 && <li className="px-3 py-2 text-sm text-muted">Nadie coincide con la búsqueda.</li>}
              </ul>
              {shared.length > 0 && <p className="text-xs text-muted">Lo verán {shared.length} {shared.length === 1 ? 'persona' : 'personas'}; no podrán cambiarlo.</p>}
            </>
          )}
        </fieldset>

        {error && <p role="alert" className="notice-error">{error}</p>}
        <div className="flex items-center justify-between gap-2 pt-1">
          {event ? <button type="button" className="btn-ghost text-danger" disabled={busy} onClick={remove}><Icon name="trash" size={16} />Borrar</button> : <span />}
          <div className="flex gap-2">
            <button type="button" className="btn-ghost" onClick={onClose}>Cancelar</button>
            <button type="submit" className="btn-primary" disabled={busy}>{busy ? 'Guardando…' : 'Guardar'}</button>
          </div>
        </div>
      </form>
    </Modal>
  )
}

// Evento que me han compartido: se ve, no se edita, y me lo puedo quitar
export function EventView({ event, userId, onClose, onLeft }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function leave() {
    if (!window.confirm('¿Quitar este evento de tu calendario? Quien lo compartió lo seguirá teniendo.')) return
    setBusy(true)
    try {
      await leaveEvent(event.id, userId)
      onLeft('Evento quitado de tu calendario.')
    } catch (leaveError) {
      setError(getSupabaseErrorMessage(leaveError))
      setBusy(false)
    }
  }

  return (
    <Modal title={event.title} onClose={onClose}>
      <p className="-mt-1 text-sm text-muted">{longDate(event.occurrence || event.date)} · {eventTimeText(event)}{event.repeat_weekly ? ' · cada semana' : ''}</p>
      <p className="mt-2 text-sm text-ink-soft">Compartido por <strong className="text-ink">{event.owner_name || 'un compañero'}</strong></p>
      {event.note && <p className="mt-3 whitespace-pre-line text-sm text-ink">{event.note}</p>}
      {error && <p role="alert" className="notice-error mt-3">{error}</p>}
      <div className="mt-5 flex justify-end gap-2">
        <button type="button" className="btn-ghost text-danger" disabled={busy} onClick={leave}>Quitar de mi calendario</button>
        <button type="button" className="btn-primary" onClick={onClose}>Cerrar</button>
      </div>
    </Modal>
  )
}
