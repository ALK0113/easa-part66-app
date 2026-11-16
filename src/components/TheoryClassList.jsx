import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { getSupabaseErrorMessage } from '../lib/supabaseErrors.js'
import { isManager, teachesLikeProfessor } from '../lib/roles.js'
import { compareCodes, outcomeLabel, useModuleStructure } from '../lib/curriculum.js'
import { SESSION_FIELDS, saveSessions, sessionErrors, useFreeModuleSessions, useModuleAssignments } from '../lib/practiceSessions.js'
import { HoursStatus, SessionsCard, SessionsEditor } from './PracticeSessions.jsx'
import Assessments from './Assessments.jsx'
import Icon from './Icon.jsx'
import Modal from './Modal.jsx'

const NONE = 'sin'

// Clases teóricas de un módulo, agrupadas por submódulo EASA. Cada una lleva su RA, comentarios,
// presentaciones (enlaces), sesiones en el calendario y sus exámenes/evaluaciones.
export default function TheoryClassList({ user, moduleId }) {
  const { submodules, outcomes, schoolId } = useModuleStructure(moduleId)
  const [classes, setClasses] = useState(null)
  const [links, setLinks] = useState([])
  const [sessions, setSessions] = useState([])
  const [teaches, setTeaches] = useState(false)
  const [filter, setFilter] = useState('')
  const [selectedId, setSelectedId] = useState(null)
  const [form, setForm] = useState(null)
  const [linksDraft, setLinksDraft] = useState([])
  const [sessionDraft, setSessionDraft] = useState([])
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const canEdit = isManager(user.role) || (teachesLikeProfessor(user.role) && teaches)

  const load = useCallback(async () => {
    let query = supabase.from('theory_classes').select('id,school_id,submodule_id,learning_outcome_id,title,comments,hours,created_at').eq('module_id', moduleId).order('created_at')
    if (schoolId) query = query.eq('school_id', schoolId)
    const { data, error } = await query
    if (error) { setMessage(getSupabaseErrorMessage(error)); setClasses([]); return }
    const ids = (data || []).map((item) => item.id)
    const [linkResult, sessionResult] = ids.length
      ? await Promise.all([
        supabase.from('theory_class_links').select('id,theory_class_id,title,url').in('theory_class_id', ids).order('created_at'),
        supabase.from('class_sessions').select(SESSION_FIELDS).in('theory_class_id', ids).order('date').order('start_time'),
      ])
      : [{ data: [] }, { data: [] }]
    setClasses(data || [])
    setLinks(linkResult.data || [])
    setSessions(sessionResult.data || [])
  }, [moduleId, schoolId])

  useEffect(() => {
    let active = true
    Promise.resolve().then(() => { if (active) load() })
    if (teachesLikeProfessor(user.role)) {
      supabase.from('teacher_modules').select('module_id').eq('profile_id', user.id).eq('module_id', moduleId).maybeSingle()
        .then(({ data }) => { if (active) setTeaches(Boolean(data)) })
    }
    return () => { active = false }
  }, [load, user.id, user.role, moduleId])

  const formAssignments = useModuleAssignments(form ? moduleId : null, user)
  const freeSessions = useFreeModuleSessions(form ? formAssignments : null)

  const subById = useMemo(() => new Map(submodules.map((sub) => [sub.id, sub])), [submodules])
  const outcomeOf = (id) => outcomes.find((outcome) => outcome.id === id)
  const sessionsOf = (id) => sessions.filter((session) => session.theory_class_id === id)
  const linksOf = (id) => links.filter((link) => link.theory_class_id === id)
  const visible = (classes || []).filter((item) => !filter || (filter === NONE ? !item.submodule_id : item.submodule_id === filter))
  // Agrupadas por submódulo (en orden 11.1, 11.2…), al final las que no tienen
  const groups = useMemo(() => {
    const map = new Map()
    visible.forEach((item) => { const key = item.submodule_id || NONE; map.set(key, [...(map.get(key) || []), item]) })
    return [...map.entries()].sort(([a], [b]) => (a === NONE ? 1 : b === NONE ? -1 : compareCodes(subById.get(a)?.code, subById.get(b)?.code)))
  }, [visible, subById])

  function openForm(item = null) {
    setMessage('')
    setForm(item
      ? { id: item.id, title: item.title, submodule_id: item.submodule_id || '', learning_outcome_id: item.learning_outcome_id || '', hours: item.hours ?? '', comments: item.comments || '' }
      : { title: '', submodule_id: filter && filter !== NONE ? filter : '', learning_outcome_id: '', hours: '', comments: '' })
    setLinksDraft(item ? linksOf(item.id).map((link) => ({ ...link })) : [])
    setSessionDraft(item ? sessionsOf(item.id) : [])
  }

  async function save(event) {
    event.preventDefault()
    if (!schoolId) { setMessage('Elige una escuela en el selector de arriba.'); return }
    const invalidSession = sessionErrors(sessionDraft)
    if (invalidSession) { setMessage(invalidSession); return }
    const badLink = linksDraft.find((link) => !/^https?:\/\//i.test(link.url.trim()) || !link.title.trim())
    if (badLink) { setMessage('Cada presentación necesita un nombre y un enlace que empiece por http:// o https://'); return }
    setBusy(true)
    try {
      const values = {
        title: form.title.trim(),
        submodule_id: form.submodule_id || null,
        learning_outcome_id: form.learning_outcome_id || null,
        hours: form.hours === '' ? null : Number(form.hours),
        comments: form.comments.trim() || null,
      }
      let classId = form.id
      if (classId) {
        const { error } = await supabase.from('theory_classes').update(values).eq('id', classId)
        if (error) throw error
      } else {
        const { data, error } = await supabase.from('theory_classes').insert({ ...values, school_id: schoolId, module_id: moduleId }).select('id').single()
        if (error) throw error
        classId = data.id
      }
      // Presentaciones: se sustituyen por la lista editada
      const before = form.id ? linksOf(form.id) : []
      const keep = new Set(linksDraft.filter((link) => link.id).map((link) => link.id))
      const removed = before.filter((link) => !keep.has(link.id)).map((link) => link.id)
      if (removed.length) { const { error } = await supabase.from('theory_class_links').delete().in('id', removed); if (error) throw error }
      for (const link of linksDraft) {
        const row = { theory_class_id: classId, title: link.title.trim(), url: link.url.trim() }
        const { error } = link.id ? await supabase.from('theory_class_links').update(row).eq('id', link.id) : await supabase.from('theory_class_links').insert(row)
        if (error) throw error
      }
      await saveSessions({ theory_class_id: classId }, form.id ? sessionsOf(form.id) : [], sessionDraft)
      setForm(null)
      setMessage('Clase teórica guardada.')
      await load()
    } catch (err) {
      setMessage(getSupabaseErrorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  async function remove(item) {
    if (!window.confirm(`¿Eliminar la clase «${item.title}»? Sus sesiones del calendario quedan como clases normales y se borran sus exámenes.`)) return
    const { error } = await supabase.from('theory_classes').delete().eq('id', item.id)
    if (error) { setMessage(getSupabaseErrorMessage(error)); return }
    setSelectedId(null)
    await load()
  }

  if (classes === null) return <p className="text-sm text-muted">Cargando clases teóricas…</p>

  const selected = classes.find((item) => item.id === selectedId)
  if (selected) {
    const sub = subById.get(selected.submodule_id)
    const outcome = outcomeOf(selected.learning_outcome_id)
    return (
      <div className="space-y-5">
        <button type="button" className="back-link" onClick={() => setSelectedId(null)}>← Clases teóricas</button>
        <section className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm text-muted">{[moduleId, sub && `${sub.code} ${sub.name}`].filter(Boolean).join(' · ')}</p>
            <h2 className="mt-1 text-2xl font-semibold text-ink">{selected.title}</h2>
            {outcome && <p className="mt-2 text-sm text-ink-soft"><span className="badge bg-accent-soft text-accent-strong">{outcomeLabel(outcome)}</span> {outcome.description}</p>}
          </div>
          {canEdit && <div className="flex gap-2"><button type="button" className="btn-secondary" onClick={() => openForm(selected)}><Icon name="edit" size={16} />Editar</button><button type="button" className="btn-ghost text-danger" onClick={() => remove(selected)}><Icon name="trash" size={16} /></button></div>}
        </section>
        {message && <p role="status" className="notice">{message}</p>}
        {selected.comments && <section className="card p-5"><h3 className="mb-2 text-sm font-semibold text-ink">Comentarios</h3><p className="whitespace-pre-line text-sm leading-relaxed text-ink-soft">{selected.comments}</p></section>}
        <section className="card p-5">
          <h3 className="mb-2 text-sm font-semibold text-ink">Presentaciones</h3>
          {linksOf(selected.id).length ? (
            <ul className="space-y-1.5">
              {linksOf(selected.id).map((link) => <li key={link.id}><a className="link inline-flex items-center gap-1.5 text-sm" href={link.url} target="_blank" rel="noopener noreferrer"><Icon name="link" size={14} />{link.title}</a></li>)}
            </ul>
          ) : <p className="text-sm text-muted">Sin presentaciones.</p>}
        </section>
        <SessionsCard sessions={sessionsOf(selected.id)} requiredHours={selected.hours} />
        <Assessments user={user} schoolId={schoolId || selected.school_id} moduleId={moduleId} theoryClassId={selected.id} outcomes={outcomes} canEdit={canEdit} />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted">{classes.length} {classes.length === 1 ? 'clase teórica' : 'clases teóricas'}</p>
        {canEdit && <button type="button" className="btn-primary" onClick={() => openForm()}><Icon name="plus" size={16} />Nueva clase teórica</button>}
      </div>
      {submodules.length > 0 && (
        <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Submódulo">
          {[['', 'Todos'], ...[...submodules].sort((a, b) => compareCodes(a.code, b.code)).map((sub) => [sub.id, sub.code]), [NONE, 'Sin submódulo']].map(([id, label]) => (
            <button key={id || 'all'} type="button" role="radio" aria-checked={filter === id} onClick={() => setFilter(id)}
              className={`rounded-lg border px-2.5 py-1 text-xs font-medium ${filter === id ? 'border-accent bg-accent-soft text-accent-strong' : 'border-line text-ink-soft hover:bg-subtle'}`}>{label}</button>
          ))}
        </div>
      )}
      {message && <p role="status" className="notice">{message}</p>}
      {groups.map(([key, items]) => {
        const sub = subById.get(key)
        return (
          <section key={key}>
            <h3 className="mb-1.5 text-xs font-semibold text-muted">{sub ? `${sub.code} · ${sub.name}` : 'Sin submódulo'}</h3>
            <div className="space-y-2">
              {items.map((item) => {
                const outcome = outcomeOf(item.learning_outcome_id)
                return (
                  <button key={item.id} type="button" onClick={() => setSelectedId(item.id)} className="card flex w-full items-center gap-4 p-4 text-left transition-shadow hover:shadow-lift">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium text-ink">{item.title}</span>
                      <span className="mt-1 flex flex-wrap gap-x-2 gap-y-1 text-xs text-muted">
                        {outcome && <span className="badge py-0">{outcomeLabel(outcome)}</span>}
                        {linksOf(item.id).length > 0 && <span>{linksOf(item.id).length} presentación{linksOf(item.id).length === 1 ? '' : 'es'}</span>}
                        {item.hours ? <span>· <HoursStatus compact sessions={sessionsOf(item.id)} requiredHours={item.hours} /></span> : null}
                      </span>
                    </span>
                    <Icon name="next" size={16} className="text-faint" />
                  </button>
                )
              })}
            </div>
          </section>
        )
      })}
      {visible.length === 0 && <p className="card empty">{classes.length ? 'No hay clases en este submódulo.' : 'Este módulo aún no tiene clases teóricas.'}</p>}

      {form && (
        <Modal title={form.id ? 'Editar clase teórica' : 'Nueva clase teórica'} onClose={() => setForm(null)} wide>
          <form className="grid gap-4 sm:grid-cols-2" onSubmit={save}>
            <label className="field sm:col-span-2">Título<input className="input" required maxLength={200} value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} /></label>
            <label className="field">Submódulo
              <select className="input" value={form.submodule_id} onChange={(event) => setForm({ ...form, submodule_id: event.target.value })}>
                <option value="">{submodules.length ? 'Sin submódulo' : 'Sin submódulos (Escuela → Grado y módulos)'}</option>
                {[...submodules].sort((a, b) => compareCodes(a.code, b.code)).map((sub) => <option key={sub.id} value={sub.id}>{sub.code} · {sub.name}</option>)}
              </select>
            </label>
            <label className="field">RA
              <select className="input" value={form.learning_outcome_id} onChange={(event) => setForm({ ...form, learning_outcome_id: event.target.value })}>
                <option value="">{outcomes.length ? 'Sin RA' : 'Sin RA (Escuela → Currículum oficial)'}</option>
                {outcomes.map((outcome) => <option key={outcome.id} value={outcome.id}>{outcomeLabel(outcome)} – {outcome.description.slice(0, 70)}</option>)}
              </select>
            </label>
            <label className="field sm:col-span-2">Comentarios<textarea className="input" rows="3" maxLength={4000} value={form.comments} onChange={(event) => setForm({ ...form, comments: event.target.value })} placeholder="Contenidos, observaciones, material…" /></label>
            <div className="sm:col-span-2">
              <span className="mb-1.5 block text-sm font-medium text-ink-soft">Presentaciones (enlaces)</span>
              <div className="space-y-2">
                {linksDraft.map((link, index) => (
                  <div key={link.id || index} className="grid gap-2 sm:grid-cols-[1fr_2fr_auto]">
                    <input className="input" placeholder="Nombre" aria-label={`Nombre de la presentación ${index + 1}`} value={link.title} onChange={(event) => setLinksDraft(linksDraft.map((item, i) => (i === index ? { ...item, title: event.target.value } : item)))} />
                    <input className="input" type="url" placeholder="https://drive.google.com/…" aria-label={`Enlace de la presentación ${index + 1}`} value={link.url} onChange={(event) => setLinksDraft(linksDraft.map((item, i) => (i === index ? { ...item, url: event.target.value } : item)))} />
                    <button type="button" className="rounded-lg px-2 text-muted hover:bg-danger-soft hover:text-danger" aria-label="Quitar presentación" onClick={() => setLinksDraft(linksDraft.filter((_, i) => i !== index))}><Icon name="x" size={16} /></button>
                  </div>
                ))}
              </div>
              <button type="button" className="btn-ghost mt-1 min-h-[34px] px-2 text-xs text-accent" onClick={() => setLinksDraft([...linksDraft, { title: '', url: '' }])}><Icon name="plus" size={14} />Añadir enlace</button>
            </div>
            <label className="field">Horas de la clase<input className="input" type="number" min="0" value={form.hours} onChange={(event) => setForm({ ...form, hours: event.target.value })} /></label>
            <div className="hidden sm:block" />
            <SessionsEditor sessions={sessionDraft} onChange={setSessionDraft} assignments={formAssignments} freeSessions={freeSessions} requiredHours={form.hours} />
            {message && <p role="alert" className="notice-error sm:col-span-2">{message}</p>}
            <div className="flex justify-end gap-2 sm:col-span-2"><button type="button" className="btn-secondary" onClick={() => setForm(null)}>Cancelar</button><button className="btn-primary" disabled={busy}>{busy ? 'Guardando…' : 'Guardar'}</button></div>
          </form>
        </Modal>
      )}
    </div>
  )
}
