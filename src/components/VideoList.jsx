import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { fetchSchoolModuleIds, useSchool } from '../contexts/useSchool.js'
import { subscribeToTables } from '../lib/supabaseRealtime.js'
import { youtubeId } from '../lib/youtube.js'
import Icon from './Icon.jsx'
import { teachesLikeProfessor } from '../lib/roles.js'

const inputClass = 'input'
const buttonClass = 'btn-primary'

// Con moduleId se muestra dentro de un módulo: solo sus vídeos
export default function VideoList({ user, moduleId = null, initialModuleId = null, onClearInitial }) {
  const { filterId } = useSchool()
  const [videos, setVideos] = useState([])
  const [modules, setModules] = useState([])
  const [teacherModules, setTeacherModules] = useState([])
  const [filterAta, setFilterAta] = useState('')
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [busy, setBusy] = useState(false)
  const [form, setForm] = useState({ module_id: '', ata: '', title: '', youtube_url: '' })

  useEffect(() => {
    let cancelled = false
    async function load() {
      // Cada escuela tiene sus vídeos; el admin ve los de la escuela elegida
      let scopeIds
      try { scopeIds = filterId ? await fetchSchoolModuleIds(filterId) : null } catch (err) { setError(err.message); setLoading(false); return }
      const videos = supabase.from('videos').select('*').order('id', { ascending: true })
      const modules = supabase.from('modules').select('id,name')
      const [videoResult, moduleResult, assignmentResult] = await Promise.all([
        filterId ? videos.eq('school_id', filterId) : videos,
        scopeIds ? modules.in('id', scopeIds) : modules,
        teachesLikeProfessor(user.role)
          ? supabase.from('teacher_modules').select('module_id').eq('profile_id', user.id)
          : Promise.resolve({ data: [], error: null }),
      ])
      if (cancelled) return
      const failure = videoResult.error || moduleResult.error || assignmentResult.error
      if (failure) setError(failure.message)
      else {
        setVideos(videoResult.data || [])
        setModules(moduleResult.data || [])
        setTeacherModules((assignmentResult.data || []).map((entry) => entry.module_id))
      }
      setLoading(false)
    }
    load()
    const unsubscribe = subscribeToTables(['videos', 'modules', 'teacher_modules'], load, 'video-list')
    return () => { cancelled = true; unsubscribe() }
  }, [user.id, user.role, filterId])

  const canEditVideo = (video) => user.role === 'admin' || (teachesLikeProfessor(user.role) && teacherModules.includes(video.module_id))
  const visibleVideos = videos.filter((video) => (!teachesLikeProfessor(user.role) || teacherModules.includes(video.module_id)) && (!moduleId || video.module_id === moduleId))
  const visibleModules = teachesLikeProfessor(user.role) ? modules.filter((module) => teacherModules.includes(module.id)) : modules
  const atas = [...new Set(visibleVideos.map((video) => video.ata).filter(Boolean))].sort()
  const filteredVideos = visibleVideos.filter((video) => {
    const query = search.trim().toLowerCase()
    return (!filterAta || video.ata === filterAta) && (!query || `${video.title} ${video.ata} ${video.module_id}`.toLowerCase().includes(query))
  })

  // Llegada desde un módulo («Añadir vídeo a M7»): el formulario se abre con ese módulo
  useEffect(() => {
    if (loading || !initialModuleId) return
    openForm(null, initialModuleId)
    onClearInitial?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- solo al terminar de cargar
  }, [loading, initialModuleId])

  function openForm(video = null, targetModuleId = null) {
    setEditing(video)
    setForm(video ? { module_id: video.module_id, ata: video.ata, title: video.title, youtube_url: video.youtube_url } : { module_id: targetModuleId || moduleId || visibleModules[0]?.id || '', ata: '', title: '', youtube_url: '' })
    setMessage('')
    setFormOpen(true)
  }

  async function saveVideo(event) {
    event.preventDefault()
    const id = youtubeId(form.youtube_url)
    if (!id) { setMessage('Introduce un ID de YouTube válido o una URL estándar de vídeo.'); return }
    if (teachesLikeProfessor(user.role) && !teacherModules.includes(form.module_id)) { setMessage('No tienes permiso para editar ese módulo.'); return }
    setBusy(true)
    const payload = { module_id: form.module_id, ata: form.ata.trim(), title: form.title.trim(), youtube_url: id }
    const result = editing
      ? await supabase.from('videos').update(payload).eq('id', editing.id).select().single()
      : await supabase.from('videos').insert(filterId ? { ...payload, school_id: filterId } : payload).select().single()
    setBusy(false)
    if (result.error) { setMessage(result.error.message); return }
    setVideos((current) => editing ? current.map((video) => video.id === editing.id ? result.data : video) : [...current, result.data])
    setFormOpen(false)
    setMessage(editing ? 'Vídeo actualizado.' : 'Vídeo añadido.')
  }

  async function deleteVideo(video) {
    if (!window.confirm(`¿Eliminar «${video.title}»?`)) return
    const { error: deleteError } = await supabase.from('videos').delete().eq('id', video.id)
    if (deleteError) setMessage(deleteError.message)
    else { setVideos((current) => current.filter((item) => item.id !== video.id)); setMessage('Vídeo eliminado.') }
  }

  if (loading) return <div className="flex min-h-[40vh] items-center justify-center text-sm text-muted">Cargando vídeos…</div>
  if (error) return <div role="alert" className="notice-error">Error al cargar vídeos: {error}</div>

  return <div className="space-y-5">
    {moduleId
      ? <div className="flex items-center justify-between gap-3"><p className="text-sm text-muted">{filteredVideos.length} {filteredVideos.length === 1 ? 'vídeo' : 'vídeos'}</p>{user.role !== 'alumno' && <button className={buttonClass} onClick={() => openForm()}><Icon name="plus" size={16} />Nuevo vídeo</button>}</div>
      : <div className="page-intro"><div><h2>Vídeos formativos</h2><p>{filteredVideos.length} {filteredVideos.length === 1 ? 'vídeo' : 'vídeos'}</p></div>{user.role !== 'alumno' && <button className={buttonClass} onClick={() => openForm()}><Icon name="plus" size={16} />Nuevo vídeo</button>}</div>}
    <section>
      <div className="grid gap-2 sm:grid-cols-[2fr_1fr]"><div className="relative"><Icon name="search" size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" /><input className={`${inputClass} pl-9`} placeholder="Buscar vídeo…" value={search} onChange={(event) => setSearch(event.target.value)} /></div><select className={inputClass} value={filterAta} onChange={(event) => setFilterAta(event.target.value)}><option value="">Todos los ATA</option>{atas.map((ata) => <option key={ata}>{ata}</option>)}</select></div>
      {message && !formOpen && <p role="status" className="notice mt-3">{message}</p>}
    </section>

    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{filteredVideos.map((video) => <article key={video.id} className="card overflow-hidden">
      <div className="relative aspect-video bg-ink"><iframe className="absolute inset-0 h-full w-full border-0" src={`https://www.youtube-nocookie.com/embed/${youtubeId(video.youtube_url)}`} title={video.title} loading="lazy" referrerPolicy="strict-origin-when-cross-origin" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowFullScreen /></div>
      <div className="p-4"><div className="flex items-start justify-between gap-3"><h3 className="line-clamp-2 text-sm font-medium text-ink">{video.title}</h3>{canEditVideo(video) && <div className="-mr-1.5 -mt-1 flex shrink-0 text-muted"><button className="rounded-lg p-1.5 hover:bg-subtle hover:text-ink" aria-label={`Editar ${video.title}`} onClick={() => openForm(video)}><Icon name="edit" size={16} /></button><button className="rounded-lg p-1.5 hover:bg-danger-soft hover:text-danger" aria-label={`Eliminar ${video.title}`} onClick={() => deleteVideo(video)}><Icon name="trash" size={16} /></button></div>}</div><div className="mt-2.5 flex flex-wrap gap-1.5">{!moduleId && <span className="badge">{video.module_id}</span>}{video.ata && <span className="badge">{video.ata}</span>}</div></div>
    </article>)}</div>
    {filteredVideos.length === 0 && <p className="card empty">{moduleId && !search && !filterAta ? 'Este módulo aún no tiene vídeos.' : 'No hay vídeos que coincidan con los filtros.'}</p>}

    {formOpen && <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/25 backdrop-blur-[2px] sm:items-center sm:p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) setFormOpen(false) }}><section role="dialog" aria-modal="true" aria-label={editing ? 'Editar vídeo' : 'Nuevo vídeo'} className="fade-in w-full max-w-xl rounded-t-2xl bg-surface p-6 shadow-lift sm:rounded-2xl"><h2 className="mb-5 text-lg font-semibold text-ink">{editing ? 'Editar vídeo' : 'Nuevo vídeo'}</h2><form className="space-y-4" onSubmit={saveVideo}>
      <label className="field">Módulo<select className={inputClass} value={form.module_id} onChange={(event) => setForm({ ...form, module_id: event.target.value })} required>{visibleModules.map((module) => <option key={module.id} value={module.id}>{module.id} · {module.name}</option>)}</select></label>
      <label className="field">ATA<input className={inputClass} value={form.ata} onChange={(event) => setForm({ ...form, ata: event.target.value })} placeholder="ATA 21" required /></label>
      <label className="field">Título<input className={inputClass} value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} required /></label>
      <label className="field">URL o ID de YouTube<input className={inputClass} value={form.youtube_url || ''} onChange={(event) => setForm({ ...form, youtube_url: event.target.value })} placeholder="https://youtu.be/…" required /></label>
      {message && <p role="alert" className="notice-error">{message}</p>}
      <div className="flex justify-end gap-2"><button type="button" className="btn-secondary" onClick={() => setFormOpen(false)}>Cancelar</button><button className={buttonClass} disabled={busy}>{busy ? 'Guardando…' : 'Guardar'}</button></div>
    </form></section></div>}
  </div>
}