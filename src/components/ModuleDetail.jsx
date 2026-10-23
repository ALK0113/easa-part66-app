import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { getSupabaseErrorMessage } from '../lib/supabaseErrors.js'
import { subscribeToTables } from '../lib/supabaseRealtime.js'

const inputClass = 'rounded border border-[#d1d5db] px-3 py-2 text-sm focus:border-[#1e88e5]'

function formatDate(value) {
  if (!value) return '—'
  const [year, month, day] = value.slice(0, 10).split('-')
  return `${day}/${month}/${year}`
}

export default function ModuleDetail({ moduleId, user, onBack, onOpenTLB }) {
  const [module, setModule] = useState(null)
  const [practices, setPractices] = useState([])
  const [students, setStudents] = useState([])
  const [teachers, setTeachers] = useState([])
  const [records, setRecords] = useState([])
  const [tlbs, setTLBs] = useState([])
  const [defects, setDefects] = useState([])
  const [videos, setVideos] = useState([])
  const [selectedPractice, setSelectedPractice] = useState(null)
  const [section, setSection] = useState('resumen')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  useEffect(() => {
    let cancelled = false
    async function load() {
      const [moduleResult, practiceResult, studentModuleResult, teacherModuleResult, tlbResult, videoResult] = await Promise.all([
        supabase.from('modules').select('id,name,description,color').eq('id', moduleId).maybeSingle(),
        supabase.from('practices').select('id,module_id,ata,title,detail,date,start_time,hours').eq('module_id', moduleId).order('date'),
        supabase.from('student_modules').select('student_id').eq('module_id', moduleId),
        supabase.from('teacher_modules').select('profile_id').eq('module_id', moduleId),
        supabase.from('tlbs').select('id,practice_id,module_id,aircraft,registration,msn,date,teacher_name,published,crs').eq('module_id', moduleId).order('date', { ascending: false }),
        supabase.from('videos').select('id,module_id,ata,title,youtube_url').eq('module_id', moduleId).order('ata'),
      ])
      if (cancelled) return
      const baseError = moduleResult.error || practiceResult.error
      if (baseError) {
        setError(getSupabaseErrorMessage(baseError))
        setLoading(false)
        return
      }
      const studentIds = (studentModuleResult.data || []).map((entry) => entry.student_id)
      const teacherIds = (teacherModuleResult.data || []).map((entry) => entry.profile_id)
      const practiceIds = (practiceResult.data || []).map((practice) => practice.id)
      const tlbIds = (tlbResult.data || []).map((tlb) => tlb.id)
      const [studentResult, teacherResult, recordResult, defectResult] = await Promise.all([
        studentIds.length
          ? supabase.from('students').select('id,student_number,name,group_name,promo').in('id', studentIds).order('student_number')
          : Promise.resolve({ data: [], error: null }),
        teacherIds.length
          ? supabase.from('profiles').select('id,full_name,email').in('id', teacherIds).order('full_name')
          : Promise.resolve({ data: [], error: null }),
        practiceIds.length
          ? supabase.from('practice_records').select('student_id,practice_id,attendance,evaluation').in('practice_id', practiceIds)
          : Promise.resolve({ data: [], error: null }),
        tlbIds.length
          ? supabase.from('defects').select('id,tlb_id,defect_number,ata,pirep,defect_description,correct_action').in('tlb_id', tlbIds).order('defect_number')
          : Promise.resolve({ data: [], error: null }),
      ])
      if (cancelled) return
      const relationError = studentModuleResult.error || teacherModuleResult.error || tlbResult.error || videoResult.error || studentResult.error || teacherResult.error || recordResult.error || defectResult.error
      if (relationError) setError(getSupabaseErrorMessage(relationError))
      setModule(moduleResult.data)
      setPractices(practiceResult.data || [])
      setStudents(studentResult.data || [])
      setTeachers(teacherResult.data || [])
      setRecords(recordResult.data || [])
      setTLBs(tlbResult.data || [])
      setDefects(defectResult.data || [])
      setVideos(videoResult.data || [])
      setLoading(false)
    }
    load()
    const unsubscribe = subscribeToTables(
      ['modules', 'practices', 'student_modules', 'teacher_modules', 'students', 'profiles', 'practice_records', 'tlbs', 'defects', 'videos'],
      load,
      `module-detail-${moduleId}`,
    )
    return () => { cancelled = true; unsubscribe() }
  }, [moduleId, user.id])

  const canEdit = user.role === 'admin' || user.role === 'profesor'
  const recordsForPractice = (practiceId) => records.filter((record) => record.practice_id === practiceId)
  const getRecord = (studentId, practiceId) => records.find((record) => record.student_id === String(studentId) && record.practice_id === practiceId) || {}
  const tlbForPractice = (practiceId) => tlbs.filter((tlb) => tlb.practice_id === practiceId)
  const getPractice = (practiceId) => practices.find((practice) => practice.id === practiceId)
  const defectsForTLB = (tlbId) => defects.filter((defect) => defect.tlb_id === tlbId)

  async function saveAttendance(student, practice, value) {
    const { error: saveError } = await supabase.rpc('set_attendance', {
      p_student_id: student.id,
      p_practice_id: practice.id,
      p_attendance: value,
    })
    if (saveError) { setMessage(getSupabaseErrorMessage(saveError)); return }
    setRecords((current) => {
      const previous = getRecord(student.id, practice.id)
      const updated = { ...previous, student_id: String(student.id), practice_id: practice.id, attendance: value }
      return [...current.filter((record) => !(record.student_id === updated.student_id && record.practice_id === practice.id)), updated]
    })
    setMessage('Asistencia guardada.')
  }

  async function saveEvaluation(student, practice, value) {
    const { error: saveError } = await supabase.rpc('set_evaluation', {
      p_student_id: student.id,
      p_practice_id: practice.id,
      p_evaluation: value || null,
    })
    if (saveError) { setMessage(getSupabaseErrorMessage(saveError)); return }
    setRecords((current) => {
      const previous = getRecord(student.id, practice.id)
      const updated = { ...previous, student_id: String(student.id), practice_id: practice.id, evaluation: value || null }
      return [...current.filter((record) => !(record.student_id === updated.student_id && record.practice_id === practice.id)), updated]
    })
    setMessage('Evaluación guardada.')
  }

  if (loading) return <div className="flex min-h-[40vh] items-center justify-center text-sm text-[#6b7280]">Cargando detalle del módulo…</div>
  if (error) return <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-5 text-sm text-red-800">{error}</div>
  if (!module) return <div className="rounded-lg border border-[#e5e7eb] bg-white p-6">Módulo no encontrado.</div>

  if (selectedPractice) {
    const practiceRecords = recordsForPractice(selectedPractice.id)
    const counts = { P: 0, L: 0, A: 0, apto: 0 }
    practiceRecords.forEach((record) => {
      if (record.attendance) counts[record.attendance] += 1
      if (record.evaluation === 'Apto') counts.apto += 1
    })
    return <div className="space-y-5">
      <button className="text-sm font-semibold text-[#1565c0]" onClick={() => { setSelectedPractice(null); setMessage('') }}>← Volver a {module.id}</button>
      <section className="rounded-lg bg-gradient-to-r from-[#0a2540] to-[#1e88e5] p-6 text-white">
        <p className="text-xs font-semibold uppercase text-blue-100">{module.id} · {selectedPractice.ata} · {formatDate(selectedPractice.date)}</p>
        <h2 className="mt-2 text-2xl font-bold">{selectedPractice.title}</h2>
        <p className="mt-1 text-sm text-blue-100">{selectedPractice.detail}</p>
        <p className="mt-4 text-sm">{selectedPractice.start_time} · {selectedPractice.hours} h · {students.length} alumnos</p>
      </section>
      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">{[['Presentes', counts.P], ['Tarde', counts.L], ['Faltas', counts.A], ['Aptos', `${counts.apto}/${students.length}`]].map(([label, value]) => <div key={label} className="rounded-lg border border-[#e5e7eb] border-l-4 border-l-[#1e88e5] bg-white p-4"><p className="text-xs uppercase text-[#6b7280]">{label}</p><p className="mt-1 text-2xl font-bold text-[#0a2540]">{value}</p></div>)}</section>
      {message && <p role="status" className="rounded bg-blue-50 p-3 text-sm text-blue-900">{message}</p>}
      <section className="overflow-hidden rounded-lg border border-[#e5e7eb] bg-white">
        <div className="border-b border-[#e5e7eb] p-4"><h3 className="font-bold text-[#0a2540]">Alumnos · asistencia y evaluación</h3><p className="mt-1 text-xs text-[#6b7280]">Los cambios se guardan en Supabase y se sincronizan con otras sesiones.</p></div>
        <div className="overflow-x-auto"><table className="w-full min-w-[720px] text-left text-sm"><thead className="bg-[#0a2540] text-xs uppercase text-white"><tr>{['Alumno', 'Grupo', 'Asistencia', 'Evaluación'].map((label) => <th key={label} className="p-3">{label}</th>)}</tr></thead><tbody>{students.map((student) => {
          const record = getRecord(student.id, selectedPractice.id)
          return <tr key={student.id} className="border-b border-[#e5e7eb]"><td className="p-3 font-semibold">{student.name}</td><td className="p-3">{student.group_name || '—'}</td><td className="p-3"><div className="flex gap-1">{[['P', 'Presente', '#2e7d32'], ['L', 'Tarde', '#ef6c00'], ['A', 'Falta', '#c62828']].map(([value, label, color]) => <button key={value} title={label} aria-pressed={record.attendance === value} disabled={!canEdit || busy} onClick={async () => { setBusy(true); await saveAttendance(student, selectedPractice, value); setBusy(false) }} className={`h-8 w-9 rounded border text-xs font-bold ${record.attendance === value ? 'text-white' : 'bg-white text-[#374151] disabled:opacity-50'}`} style={record.attendance === value ? { backgroundColor: color, borderColor: color } : undefined}>{value}</button>)}</div></td><td className="p-3"><select className={`${inputClass} max-w-40`} disabled={!canEdit || busy} value={record.evaluation || ''} onChange={async (event) => { setBusy(true); await saveEvaluation(student, selectedPractice, event.target.value); setBusy(false) }}><option value="">Sin evaluar</option><option value="Apto">Apto</option><option value="No Apto">No apto</option></select></td></tr>
        })}</tbody></table></div>
        {students.length === 0 && <p className="p-8 text-center text-sm text-[#6b7280]">No hay alumnos matriculados en este módulo.</p>}
      </section>
      <section className="rounded-lg border border-[#e5e7eb] bg-white p-4"><h3 className="mb-3 font-bold text-[#0a2540]">Task Log Book de la práctica</h3>{tlbForPractice(selectedPractice.id).length ? <div className="space-y-2">{tlbForPractice(selectedPractice.id).map((tlb) => <button key={tlb.id} className="flex w-full flex-wrap items-center justify-between gap-2 rounded border border-[#e5e7eb] p-3 text-left hover:bg-[#f4f6f9]" onClick={() => onOpenTLB(tlb.id)}><span className="font-semibold">{tlb.aircraft} · {tlb.registration}</span><span className="text-xs text-[#6b7280]">{formatDate(tlb.date)} · {tlb.published ? 'Publicado' : 'Pendiente'} · {defectsForTLB(tlb.id).length} defectos</span></button>)}</div> : <p className="text-sm text-[#6b7280]">No hay TLB para esta práctica.</p>}</section>
    </div>
  }

  const tabs = [['resumen', 'Resumen'], ['practicas', `Prácticas (${practices.length})`], ['tlb', `TLB (${tlbs.length})`], ['videos', `Vídeos (${videos.length})`]]
  return <div className="space-y-5">
    <button className="text-sm font-semibold text-[#1565c0]" onClick={onBack}>← Volver a módulos</button>
    <section className="rounded-lg bg-gradient-to-r from-[#0a2540] to-[#1e88e5] p-6 text-white">
      <p className="text-xs font-semibold uppercase text-blue-100">Módulo EASA Part 66</p><h2 className="mt-2 text-2xl font-bold">{module.id} · {module.name}</h2><p className="mt-1 text-sm text-blue-100">{module.description || 'Sin descripción'}</p>
      <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">{[['Prácticas', practices.length], ['Horas', practices.reduce((sum, practice) => sum + (practice.hours || 0), 0)], ['Profesores', teachers.length], ['Alumnos', students.length]].map(([label, value]) => <div key={label} className="rounded bg-white/15 p-3"><p className="text-[10px] uppercase text-blue-100">{label}</p><p className="mt-1 text-lg font-bold">{value}</p></div>)}</div>
    </section>
    <nav aria-label="Contenido del módulo" className="flex flex-wrap gap-2 border-b border-[#d1d5db]">{tabs.map(([id, label]) => <button key={id} aria-current={section === id ? 'page' : undefined} className={`border-b-2 px-3 py-2 text-sm font-semibold ${section === id ? 'border-[#1e88e5] text-[#0a2540]' : 'border-transparent text-[#6b7280]'}`} onClick={() => { setSection(id); setSelectedPractice(null) }}>{label}</button>)}</nav>

    {section === 'resumen' && <div className="grid gap-5 lg:grid-cols-2">
      <section className="rounded-lg border border-[#e5e7eb] bg-white p-5"><h3 className="mb-3 font-bold text-[#0a2540]">Profesores asociados</h3>{teachers.length ? <ul className="space-y-2">{teachers.map((teacher) => <li key={teacher.id} className="flex items-center justify-between rounded border border-[#e5e7eb] p-3"><span className="font-semibold">{teacher.full_name || 'Profesor'}</span><span className="text-xs text-[#6b7280]">{teacher.email || ''}</span></li>)}</ul> : <p className="text-sm text-[#6b7280]">No hay profesores asociados.</p>}</section>
      <section className="rounded-lg border border-[#e5e7eb] bg-white p-5"><h3 className="mb-3 font-bold text-[#0a2540]">Alumnos asociados</h3>{students.length ? <ul className="max-h-72 space-y-2 overflow-y-auto">{students.map((student) => <li key={student.id} className="flex items-center justify-between rounded border border-[#e5e7eb] p-3"><span className="font-semibold">{student.name}</span><span className="text-xs text-[#6b7280]">{student.group_name || '—'} · {student.promo || '—'}</span></li>)}</ul> : <p className="text-sm text-[#6b7280]">No hay alumnos asociados.</p>}</section>
      <section className="rounded-lg border border-[#e5e7eb] bg-white p-5 lg:col-span-2"><div className="mb-3 flex items-center justify-between"><h3 className="font-bold text-[#0a2540]">Próximas prácticas</h3><button className="text-sm font-semibold text-[#1565c0]" onClick={() => setSection('practicas')}>Ver todas</button></div>{practices.slice(0, 5).map((practice) => <button key={practice.id} className="flex w-full flex-wrap items-center justify-between gap-2 border-t border-[#e5e7eb] py-3 text-left" onClick={() => { setSelectedPractice(practice); setSection('practicas') }}><span><strong>{practice.title}</strong><span className="ml-2 text-xs text-[#6b7280]">{practice.id} · {practice.ata}</span></span><span className="text-sm text-[#6b7280]">{formatDate(practice.date)} · {practice.start_time}</span></button>)}{practices.length === 0 && <p className="text-sm text-[#6b7280]">No hay prácticas asociadas.</p>}</section>
    </div>}

    {section === 'practicas' && <section className="rounded-lg border border-[#e5e7eb] bg-white p-4">{practices.length ? <div className="space-y-2">{practices.map((practice) => <button key={practice.id} className="flex w-full flex-wrap items-center justify-between gap-3 rounded border border-[#e5e7eb] p-4 text-left hover:border-l-4 hover:border-l-[#1e88e5] hover:bg-[#f9fbfd]" onClick={() => setSelectedPractice(practice)}><span><span className="block font-bold text-[#0a2540]">{practice.title}</span><span className="mt-1 block text-xs text-[#6b7280]">{practice.id} · {practice.ata} · {practice.hours || 0} h</span></span><span className="text-sm text-[#6b7280]">{formatDate(practice.date)} · {practice.start_time}</span></button>)}</div> : <p className="p-8 text-center text-sm text-[#6b7280]">No hay prácticas en este módulo.</p>}</section>}

    {section === 'tlb' && <section className="rounded-lg border border-[#e5e7eb] bg-white p-4"><h3 className="mb-3 font-bold text-[#0a2540]">Task Log Book asociados</h3>{tlbs.length ? <div className="space-y-2">{tlbs.map((tlb) => <button key={tlb.id} className="flex w-full flex-wrap items-center justify-between gap-2 rounded border border-[#e5e7eb] p-3 text-left hover:bg-[#f4f6f9]" onClick={() => onOpenTLB(tlb.id)}><span className="font-semibold">{getPractice(tlb.practice_id)?.title || tlb.practice_id} · {tlb.aircraft} ({tlb.registration})</span><span className="text-xs text-[#6b7280]">{formatDate(tlb.date)} · {tlb.published ? 'Publicado' : 'Pendiente'} · {defectsForTLB(tlb.id).length} defectos</span></button>)}</div> : <p className="text-sm text-[#6b7280]">No hay TLB asociados.</p>}</section>}

    {section === 'videos' && <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{videos.map((video) => <article key={video.id} className="overflow-hidden rounded-lg border border-[#e5e7eb] bg-white"><div className="relative aspect-video bg-[#0a2540]"><iframe className="absolute inset-0 h-full w-full border-0" src={`https://www.youtube-nocookie.com/embed/${video.youtube_url}`} title={video.title} loading="lazy" allowFullScreen /></div><div className="p-4"><h3 className="font-semibold text-[#0a2540]">{video.title}</h3><span className="mt-2 inline-block rounded bg-[#d1ecf1] px-2 py-1 text-xs text-[#0c5460]">{video.ata}</span></div></article>)}{videos.length === 0 && <p className="text-sm text-[#6b7280]">No hay vídeos en este módulo.</p>}</section>}
  </div>
}