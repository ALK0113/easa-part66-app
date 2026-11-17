import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { useSchool } from '../contexts/useSchool.js'
import { subscribeToTables } from '../lib/supabaseRealtime.js'
import { getSupabaseErrorMessage } from '../lib/supabaseErrors.js'
import Icon from './Icon.jsx'

// Aulas, talleres y hangares de la escuela. Se eligen al poner el horario; con ellas se detectan
// los choques de aula y se puede ver el horario de cada una (Horario → Aulas).
export default function Rooms() {
  const { schoolId } = useSchool()
  const [rooms, setRooms] = useState(null)
  const [name, setName] = useState('')
  const [editing, setEditing] = useState(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState(null)

  useEffect(() => {
    if (!schoolId) return undefined
    let active = true
    const load = () => supabase.from('rooms').select('id,name,schedule_slots(count)').eq('school_id', schoolId).order('name')
      .then(({ data, error }) => {
        if (!active) return
        if (error) setNotice({ error: true, text: getSupabaseErrorMessage(error) })
        setRooms(data || [])
      })
    load()
    const unsubscribe = subscribeToTables(['rooms', 'schedule_slots'], load, `rooms-page-${schoolId}`)
    return () => { active = false; unsubscribe() }
  }, [schoolId])

  async function run(query, okText) {
    setBusy(true)
    const { error } = await query
    setBusy(false)
    if (error) {
      setNotice({ error: true, text: error.code === '23505' ? 'Ya hay un aula con ese nombre.' : getSupabaseErrorMessage(error) })
      return false
    }
    setNotice({ error: false, text: okText })
    return true
  }

  async function add(event) {
    event.preventDefault()
    if (await run(supabase.from('rooms').insert({ school_id: schoolId, name: name.trim() }), `Aula «${name.trim()}» añadida.`)) setName('')
  }

  async function rename(event) {
    event.preventDefault()
    if (await run(supabase.from('rooms').update({ name: editing.name.trim() }).eq('id', editing.id), 'Aula renombrada. El horario ya muestra el nombre nuevo.')) setEditing(null)
  }

  async function remove(room, uses) {
    const text = uses ? `«${room.name}» se usa en ${uses} ${uses === 1 ? 'clase' : 'clases'} de la plantilla, que quedarán sin aula. ¿Borrarla?` : `¿Borrar «${room.name}»?`
    if (!window.confirm(text)) return
    await run(supabase.from('rooms').delete().eq('id', room.id), 'Aula borrada.')
  }

  return (
    <div className="max-w-2xl space-y-4">
      {notice && <p role={notice.error ? 'alert' : 'status'} className={notice.error ? 'notice-error' : 'notice-success'}>{notice.text}</p>}

      <form className="card flex flex-wrap items-end gap-2 p-4" onSubmit={add}>
        <label className="field min-w-[200px] flex-1">Nueva aula, taller o hangar
          <input className="input" required maxLength={40} placeholder="p. ej. Hangar 2, Taller de aviónica" value={name} onChange={(event) => setName(event.target.value)} />
        </label>
        <button type="submit" className="btn-primary" disabled={busy || !name.trim()}><Icon name="plus" size={16} />Añadir</button>
      </form>

      {rooms === null ? <p className="text-sm text-muted">Cargando…</p> : rooms.length === 0 ? (
        <div className="card empty">Aún no hay aulas. Añádelas aquí o escríbelas al poner el horario: se crean solas.</div>
      ) : (
        <ul className="card divide-y divide-line overflow-hidden">
          {rooms.map((room) => {
            const uses = room.schedule_slots?.[0]?.count || 0
            return (
              <li key={room.id} className="px-4 py-2.5">
                {editing?.id === room.id ? (
                  <form className="flex flex-wrap items-center gap-2" onSubmit={rename}>
                    <input className="input min-w-[180px] flex-1" autoFocus required maxLength={40} aria-label="Nombre del aula" value={editing.name} onChange={(event) => setEditing({ ...editing, name: event.target.value })} />
                    <button type="button" className="btn-ghost" onClick={() => setEditing(null)}>Cancelar</button>
                    <button type="submit" className="btn-primary" disabled={busy}>Guardar</button>
                  </form>
                ) : (
                  <div className="flex items-center gap-3 text-sm">
                    <span className="min-w-0 flex-1 truncate font-medium text-ink">{room.name}</span>
                    <span className="shrink-0 text-xs text-muted">{uses ? `${uses} ${uses === 1 ? 'clase semanal' : 'clases semanales'}` : 'Sin uso'}</span>
                    <button type="button" className="rounded-lg p-1.5 text-muted hover:bg-subtle hover:text-ink" aria-label={`Renombrar ${room.name}`} onClick={() => setEditing({ id: room.id, name: room.name })}><Icon name="edit" size={15} /></button>
                    <button type="button" className="rounded-lg p-1.5 text-muted hover:bg-danger-soft hover:text-danger" aria-label={`Borrar ${room.name}`} disabled={busy} onClick={() => remove(room, uses)}><Icon name="trash" size={15} /></button>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
