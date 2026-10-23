import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { subscribeToTables } from '../lib/supabaseRealtime.js'

const inputClass = 'w-full rounded border border-[#d1d5db] px-3 py-2 text-sm focus:border-[#1e88e5]'
const buttonClass = 'rounded bg-[#1e88e5] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1565c0] disabled:opacity-50'

function youtubeId(value) {
  const raw = value.trim()
  const match = raw.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/))([\w-]{11})/)
  return match?.[1] || (/^[\w-]{11}$/.test(raw) ? raw : '')
}

export default function VideoList({ user }) {
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
      const [videoResult, moduleResult, assignmentResult] = await Promise.all([
        supabase.from('videos').select('*').order('id', { ascending: true }),
        supabase.from('modules').select('id,name'),
        user.role === 'profesor'
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
  }, [user.id, user.role])

  const canEditVideo = (video) => user.role === 'admin' || (user.role === 'profesor' && teacherModules.includes(video.module_id))
  const visibleVideos = videos.filter((video) => user.role !== 'profesor' || teacherModules.includes(video.module_id))
  const visibleModules = user.role === 'profesor' ? modules.filter((module) => teacherModules.includes(module.id)) : modules
  const atas = [...new Set(visibleVideos.map((video) => video.ata).filter(Boolean))].sort()
  const filteredVideos = visibleVideos.filter((video) => {
    const query = search.trim().toLowerCase()
    return (!filterAta || video.ata === filterAta) && (!query || `${video.title} ${video.ata} ${video.module_id}`.toLowerCase().includes(query))
  })

  function openForm(video = null) {
    setEditing(video)
    setForm(video ? { module_id: video.module_id, ata: video.ata, title: video.title, youtube_url: video.youtube_url } : { module_id: visibleModules[0]?.id || '', ata: '', title: '', youtube_url: '' })
    setMessage('')
    setFormOpen(true)
  }

  async function saveVideo(event) {
    event.preventDefault()
    const id = youtubeId(form.youtube_url)
    if (!id) { setMessage('Introduce un ID de YouTube válido o una URL estándar de vídeo.'); return }
    if (user.role === 'profesor' && !teacherModules.includes(form.module_id)) { setMessage('No tienes permiso para editar ese módulo.'); return }
    setBusy(true)
    const payload = { module_id: form.module_id, ata: form.ata.trim(), title: form.title.trim(), youtube_url: id }
    const result = editing
      ? await supabase.from('videos').update(payload).eq('id', editing.id).select().single()
      : await supabase.from('videos').insert(payload).select().single()
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

  if (loading) return <div className="flex min-h-[40vh] items-center justify-center text-[#0a2540]">Cargando vídeos…</div>
  if (error) return <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-5 text-sm text-red-800">Error al cargar vídeos: {error}</div>

  return <div className="space-y-4">
    <section className="rounded-lg border border-[#e5e7eb] bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-end justify-between gap-3"><div><h2 className="text-lg font-bold text-[#0a2540]">Vídeos formativos ({filteredVideos.length})</h2><p className="mt-1 text-sm text-[#6b7280]">Filtra recursos por ATA o busca por título.</p></div>{user.role !== 'alumno' && <button className={buttonClass} onClick={() => openForm()}>+ Nuevo vídeo</button>}</div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2"><input className={inputClass} placeholder="Buscar vídeo…" value={search} onChange={(event) => setSearch(event.target.value)} /><select className={inputClass} value={filterAta} onChange={(event) => setFilterAta(event.target.value)}><option value="">Todos los ATA</option>{atas.map((ata) => <option key={ata}>{ata}</option>)}</select></div>
      {message && <p role="status" className="mt-3 rounded bg-blue-50 p-3 text-sm text-blue-900">{message}</p>}
    </section>

    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{filteredVideos.map((video) => <article key={video.id} className="overflow-hidden rounded-lg border border-[#e5e7eb] bg-white shadow-sm">
      <div className="relative aspect-video bg-[#0a2540]"><iframe className="absolute inset-0 h-full w-full border-0" src={`https://www.youtube-nocookie.com/embed/${youtubeId(video.youtube_url)}`} title={video.title} loading="lazy" referrerPolicy="strict-origin-when-cross-origin" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowFullScreen /></div>
      <div className="p-4"><div className="flex items-start justify-between gap-3"><h3 className="line-clamp-2 text-sm font-bold text-[#0a2540]">{video.title}</h3>{canEditVideo(video) && <div className="flex shrink-0 gap-2 text-xs font-semibold"><button className="text-[#1565c0]" onClick={() => openForm(video)}>Editar</button><button className="text-red-700" onClick={() => deleteVideo(video)}>Eliminar</button></div>}</div><div className="mt-3 flex flex-wrap gap-2"><span className="rounded bg-[#d1ecf1] px-2 py-1 text-xs font-semibold text-[#0c5460]">{video.ata}</span><span className="rounded bg-blue-100 px-2 py-1 text-xs font-semibold text-blue-900">{video.module_id}</span></div></div>
    </article>)}</div>
    {filteredVideos.length === 0 && <p className="rounded-lg border border-dashed border-[#d1d5db] p-10 text-center text-sm text-[#6b7280]">No hay vídeos que coincidan con los filtros.</p>}

    {formOpen && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) setFormOpen(false) }}><section role="dialog" aria-modal="true" aria-label={editing ? 'Editar vídeo' : 'Nuevo vídeo'} className="w-full max-w-xl rounded-lg bg-white p-5 shadow-2xl"><h2 className="mb-4 text-lg font-bold text-[#0a2540]">{editing ? 'Editar vídeo' : 'Nuevo vídeo'}</h2><form className="space-y-4" onSubmit={saveVideo}>
      <label className="grid gap-1 text-sm font-semibold text-[#0a2540]">Módulo<select className={inputClass} value={form.module_id} onChange={(event) => setForm({ ...form, module_id: event.target.value })} required>{visibleModules.map((module) => <option key={module.id} value={module.id}>{module.id} · {module.name}</option>)}</select></label>
      <label className="grid gap-1 text-sm font-semibold text-[#0a2540]">ATA<input className={inputClass} value={form.ata} onChange={(event) => setForm({ ...form, ata: event.target.value })} placeholder="ATA 21" required /></label>
      <label className="grid gap-1 text-sm font-semibold text-[#0a2540]">Título<input className={inputClass} value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} required /></label>
      <label className="grid gap-1 text-sm font-semibold text-[#0a2540]">URL o ID de YouTube<input className={inputClass} value={form.youtube_url || ''} onChange={(event) => setForm({ ...form, youtube_url: event.target.value })} placeholder="https://youtu.be/…" required /></label>
      {message && <p role="alert" className="rounded bg-red-50 p-3 text-sm text-red-800">{message}</p>}
      <div className="flex justify-end gap-2"><button type="button" className="rounded border border-[#d1d5db] px-4 py-2 text-sm" onClick={() => setFormOpen(false)}>Cancelar</button><button className={buttonClass} disabled={busy}>{busy ? 'Guardando…' : 'Guardar'}</button></div>
    </form></section></div>}
  </div>
}