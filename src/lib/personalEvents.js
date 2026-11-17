import { useEffect, useState } from 'react'
import { supabase } from './supabase.js'
import { addDays, parseISODate, time, toISODate } from './schedule.js'

// Eventos personales del calendario: privados por defecto; el dueño puede compartirlos con compañeros concretos.
// Quien los recibe los ve pero no los edita (puede quitárselos). Los semanales se repiten hasta repeat_until.

// Eventos propios y compartidos conmigo en unas fechas, con las repeticiones semanales ya expandidas
export async function fetchEvents(from, to) {
  const { data, error } = await supabase.rpc('my_personal_events', { p_from: from, p_to: to })
  if (error) throw error
  const occurrences = []
  ;(data || []).forEach((event) => {
    if (!event.repeat_weekly) {
      if (event.date >= from && event.date <= to) occurrences.push({ ...event, occurrence: event.date })
      return
    }
    const last = event.repeat_until < to ? event.repeat_until : to
    for (let day = parseISODate(event.date); toISODate(day) <= last; day = addDays(day, 7)) {
      const iso = toISODate(day)
      if (iso >= from) occurrences.push({ ...event, occurrence: iso })
    }
  })
  return occurrences.sort((a, b) => a.occurrence.localeCompare(b.occurrence) || Number(b.all_day) - Number(a.all_day) || String(a.start_time).localeCompare(String(b.start_time)))
}

export const eventTimeText = (event) => (event.all_day ? 'Todo el día' : `${time(event.start_time)}–${time(event.end_time)}`)

// Texto corto de con quién está: privado, compartido con N o de quién es
export const eventShareText = (event) => {
  if (!event.is_owner) return `De ${event.owner_name || 'un compañero'}`
  const count = event.shared_with?.length || 0
  return count ? `Compartido con ${count}` : 'Privado'
}

// Guarda el evento y deja compartido exactamente con shareIds
export async function saveEvent(id, values, shareIds, previousIds = []) {
  const row = {
    title: values.title.trim(),
    note: values.note?.trim() || null,
    date: values.date,
    all_day: values.all_day,
    start_time: values.all_day ? null : values.start_time,
    end_time: values.all_day ? null : values.end_time,
    repeat_weekly: values.repeat_weekly,
    repeat_until: values.repeat_weekly ? values.repeat_until : null,
  }
  const result = id
    ? await supabase.from('personal_events').update(row).eq('id', id).select('id').single()
    : await supabase.from('personal_events').insert(row).select('id').single()
  if (result.error) throw result.error
  const eventId = result.data.id
  const removed = previousIds.filter((profileId) => !shareIds.includes(profileId))
  const added = shareIds.filter((profileId) => !previousIds.includes(profileId))
  if (removed.length) {
    const { error } = await supabase.from('personal_event_shares').delete().eq('event_id', eventId).in('profile_id', removed)
    if (error) throw error
  }
  if (added.length) {
    const { error } = await supabase.from('personal_event_shares').insert(added.map((profileId) => ({ event_id: eventId, profile_id: profileId })))
    if (error) throw error
  }
  return eventId
}

export async function deleteEvent(id) {
  const { error } = await supabase.from('personal_events').delete().eq('id', id)
  if (error) throw error
}

// El destinatario se quita el evento de su calendario
export async function leaveEvent(id, profileId) {
  const { error } = await supabase.from('personal_event_shares').delete().eq('event_id', id).eq('profile_id', profileId)
  if (error) throw error
}

export function useShareCandidates(enabled) {
  const [list, setList] = useState(null)
  useEffect(() => {
    if (!enabled) return undefined
    let active = true
    supabase.rpc('event_share_candidates').then(({ data }) => { if (active) setList(data || []) })
    return () => { active = false }
  }, [enabled])
  return list
}

export const defaultEventDraft = (date) => ({
  title: '', note: '', date, all_day: false, start_time: '16:00', end_time: '17:00',
  repeat_weekly: false, repeat_until: toISODate(addDays(parseISODate(date), 28)),
})
