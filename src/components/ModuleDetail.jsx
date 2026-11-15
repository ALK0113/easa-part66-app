import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { useSchool } from '../contexts/useSchool.js'
import { getSupabaseErrorMessage } from '../lib/supabaseErrors.js'
import { subscribeToTables } from '../lib/supabaseRealtime.js'
import { formatDate } from '../lib/format.js'
import Icon from './Icon.jsx'
import { isManager, teachesLikeProfessor } from '../lib/roles.js'
import { youtubeId } from '../lib/youtube.js'
import { RecordSummary, StudentRecordRow } from './RecordControls.jsx'

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

  // Admin con una escuela elegida: solo prácticas, alumnos y profesores de esa escuela
  const { filterId } = useSchool()
  const bySchool = useCallback((query, column = 'school_id') => (filterId ? query.eq(column, filterId) : query), [filterId])

  useEffect(() => {
    let cancelled = false
    async function load() {
      const [moduleResult, practiceResult, studentModuleResult, teacherModuleResult, tlbResult, videoResult] = await Promise.all([
        supabase.from('modules').select('id,name,description,color').eq('id', moduleId).maybeSingle(),
        bySchool(supabase.from('practices').select('id,module_id,ata,title,detail,date,start_time,hours').eq('module_id', moduleId).order('date')),
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
          ? bySchool(supabase.from('students').select('id,student_number,name,group_name,promo').in('id', studentIds).order('student_number'))
          : Promise.resolve({ data: [], error: null }),
        teacherIds.length
          ? bySchool(supabase.from('profiles').select(filterId ? 'id,full_name,email,school_profiles!inner(school_id)' : 'id,full_name,email').in('id', teacherIds).order('full_name'), 'school_profiles.school_id')
          : Promise.resolve({ data: [], error: null }),
        practiceIds.length
          ? supabase.from('practice_records').select('student_id,practice_id,attendance,evaluation').in('practice_id', practiceIds)
          : Promise.resolve({ data: [], error: null }),
        tlbIds.length
          ? supabase.from('defects').select('id,tlb_id,defect_number,ata,pirep,defect_description').in('tlb_id', tlbIds).order('defect_number')
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
  }, [moduleId, user.id, bySchool, filterId])

  const canEdit = isManager(user.role) || teachesLikeProfessor(user.role)
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

  if (loading) return <div className="flex min-h-[40vh] items-center justify-center text-sm text-muted">Cargando módulo…</div>
  if (error) return <div role="alert" className="notice-error">{error}</div>
  if (!module) return <div className="card empty">Módulo no encontrado.</div>

  const runSave = async (save) => { setBusy(true); await save(); setBusy(false) }
  const tlbRow = (tlb, title) => (
    <li key={tlb.id}>
      <button className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left hover:bg-subtle" onClick={() => onOpenTLB(tlb.id)}>
        <Icon name="clipboard" className="text-faint" />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium text-ink">{title}</span>
          <span className="mt-0.5 block text-xs text-muted">{formatDate(tlb.date)} · {defectsForTLB(tlb.id).length} defectos</span>
        </span>
        <span className={`badge ${tlb.published ? 'bg-success-soft text-success' : ''}`}>{tlb.published ? 'Publicado' : 'Borrador'}</span>
      </button>
    </li>
  )

  if (selectedPractice) {
    const practiceRecords = recordsForPractice(selectedPractice.id)
    const counts = { P: 0, L: 0, A: 0, apto: 0 }
    practiceRecords.forEach((record) => {
      if (record.attendance) counts[record.attendance] += 1
      if (record.evaluation === 'Apto') counts.apto += 1
    })
    const practiceTLBs = tlbForPractice(selectedPractice.id)
    return <div className="space-y-6">
      <button type="button" className="back-link" onClick={() => { setSelectedPractice(null); setMessage('') }}>← {module.id} · {module.name}</button>
      <section>
        <p className="text-sm text-muted">{module.id} · {selectedPractice.ata}</p>
        <h2 className="mt-1 text-2xl font-semibold text-ink">{selectedPractice.title}</h2>
        {selectedPractice.detail && <p className="mt-1 text-sm text-muted">{selectedPractice.detail}</p>}
        <div className="mt-4 flex flex-wrap gap-2 text-sm">
          <span className="badge gap-1.5 bg-surface py-1"><Icon name="calendar" size={14} className="text-faint" />{formatDate(selectedPractice.date)}</span>
          {selectedPractice.start_time && <span className="badge gap-1.5 bg-surface py-1"><Icon name="clock" size={14} className="text-faint" />{String(selectedPractice.start_time).slice(0, 5)} · {selectedPractice.hours} h</span>}
          <span className="badge gap-1.5 bg-surface py-1"><Icon name="users" size={14} className="text-faint" />{students.length} alumnos</span>
        </div>
      </section>
      <RecordSummary items={[['Presentes', counts.P, 'bg-success'], ['Tarde', counts.L, 'bg-warn'], ['Faltas', counts.A, 'bg-danger'], ['Aptos', `${counts.apto}/${students.length}`, 'bg-accent']]} />
      <section className="card overflow-hidden">
        <div className="px-5 pb-3 pt-5">
          <h3 className="font-semibold text-ink">Asistencia y evaluación</h3>
          <p className="mt-0.5 text-xs text-muted">{canEdit ? 'Se guarda al instante y se sincroniza con otras sesiones.' : 'Solo lectura.'}</p>
        </div>
        {message && <p role="status" className="notice mx-5 mb-3">{message}</p>}
        <ul className="divide-y divide-line border-t border-line">
          {students.map((student) => (
            <StudentRecordRow
              key={student.id}
              student={student}
              record={getRecord(student.id, selectedPractice.id)}
              canEdit={canEdit}
              busy={busy}
              meta={student.group_name || '—'}
              onAttendance={(value) => runSave(() => saveAttendance(student, selectedPractice, value))}
              onEvaluation={(value) => runSave(() => saveEvaluation(student, selectedPractice, value))}
            />
          ))}
        </ul>
        {students.length === 0 && <p className="empty">No hay alumnos matriculados en este módulo.</p>}
      </section>
      <section className="card p-3">
        <h3 className="px-3 pb-1 pt-2 font-semibold text-ink">Task Log Book de la práctica</h3>
        {practiceTLBs.length ? <ul>{practiceTLBs.map((tlb) => tlbRow(tlb, `${tlb.aircraft} · ${tlb.registration}`))}</ul> : <p className="px-3 pb-3 pt-1 text-sm text-muted">No hay TLB para esta práctica.</p>}
      </section>
    </div>
  }

  const totalHours = practices.reduce((sum, practice) => sum + (practice.hours || 0), 0)
  const todayKey = new Date().toLocaleDateString('sv-SE')
  const upcomingPractices = practices.filter((practice) => String(practice.date || '') >= todayKey)
  const tabs = [['resumen', 'Resumen'], ['practicas', `Prácticas · ${practices.length}`], ['tlb', `TLB · ${tlbs.length}`], ['videos', `Vídeos · ${videos.length}`]]
  const practiceRow = (practice) => (
    <li key={practice.id}>
      <button className="flex w-full items-center gap-4 rounded-xl px-3 py-3 text-left hover:bg-subtle" onClick={() => { setSelectedPractice(practice); setSection('practicas') }}>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium text-ink">{practice.title}</span>
          <span className="mt-0.5 block text-xs text-muted">{practice.ata} · {practice.hours || 0} h</span>
        </span>
        <span className="text-right text-sm text-muted">{formatDate(practice.date)}{practice.start_time ? <span className="block text-xs text-faint">{String(practice.start_time).slice(0, 5)}</span> : null}</span>
        <Icon name="next" size={16} className="text-faint" />
      </button>
    </li>
  )

  return <div className="space-y-6">
    <button type="button" className="back-link" onClick={onBack}>← Módulos</button>
    <section>
      <span className="badge bg-accent-soft text-accent-strong">{module.id}</span>
      <h2 className="mt-2 text-2xl font-semibold text-ink">{module.name}</h2>
      <p className="mt-1 max-w-2xl text-sm text-muted">{module.description || 'Sin descripción'}</p>
      <dl className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-4">{[['Prácticas', practices.length], ['Horas', totalHours], ['Profesores', teachers.length], ['Alumnos', students.length]].map(([label, value]) => <div key={label} className="card px-5 py-4"><dt className="text-sm text-muted">{label}</dt><dd className="mt-1 text-xl font-semibold text-ink">{value}</dd></div>)}</dl>
    </section>
    <nav aria-label="Contenido del módulo" className="tabs">{tabs.map(([id, label]) => <button key={id} aria-current={section === id ? 'page' : undefined} className="tab" onClick={() => { setSection(id); setSelectedPractice(null) }}>{label}</button>)}</nav>

    {section === 'resumen' && <div className="grid gap-5 lg:grid-cols-2">
      <section className="card p-3 lg:col-span-2">
        <div className="flex items-center justify-between px-3 pb-1 pt-2"><h3 className="font-semibold text-ink">Próximas prácticas</h3>{practices.length > 0 && <button className="link" onClick={() => setSection('practicas')}>Ver todas</button>}</div>
        {upcomingPractices.length ? <ul>{upcomingPractices.slice(0, 5).map(practiceRow)}</ul> : <p className="px-3 pb-3 pt-1 text-sm text-muted">{practices.length ? 'No hay prácticas próximas.' : 'No hay prácticas asociadas.'}</p>}
      </section>
      <section className="card p-5"><h3 className="mb-3 font-semibold text-ink">Profesores</h3>{teachers.length ? <ul className="space-y-3">{teachers.map((teacher) => <li key={teacher.id} className="flex items-center gap-3"><span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent-soft text-xs font-semibold text-accent-strong">{(teacher.full_name || 'P')[0].toUpperCase()}</span><span className="min-w-0"><span className="block truncate text-sm font-medium text-ink">{teacher.full_name || 'Profesor'}</span><span className="block truncate text-xs text-muted">{teacher.email || ''}</span></span></li>)}</ul> : <p className="text-sm text-muted">No hay profesores asociados.</p>}</section>
      <section className="card p-5"><h3 className="mb-3 font-semibold text-ink">Alumnos</h3>{students.length ? <ul className="max-h-72 space-y-3 overflow-y-auto">{students.map((student) => <li key={student.id} className="flex items-center justify-between gap-3 text-sm"><span className="truncate font-medium text-ink">{student.name}</span><span className="shrink-0 text-xs text-muted">{student.group_name || '—'} · {student.promo || '—'}</span></li>)}</ul> : <p className="text-sm text-muted">No hay alumnos asociados.</p>}</section>
    </div>}

    {section === 'practicas' && <section className="card p-3">{practices.length ? <ul>{practices.map(practiceRow)}</ul> : <p className="empty">No hay prácticas en este módulo.</p>}</section>}

    {section === 'tlb' && <section className="card p-3">{tlbs.length ? <ul>{tlbs.map((tlb) => tlbRow(tlb, `${getPractice(tlb.practice_id)?.title || tlb.practice_id} · ${tlb.aircraft} (${tlb.registration})`))}</ul> : <p className="empty">No hay TLB asociados.</p>}</section>}

    {section === 'videos' && <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{videos.map((video) => <article key={video.id} className="card overflow-hidden"><div className="relative aspect-video bg-ink"><iframe className="absolute inset-0 h-full w-full border-0" src={`https://www.youtube-nocookie.com/embed/${youtubeId(video.youtube_url)}`} title={video.title} loading="lazy" allowFullScreen /></div><div className="p-4"><h3 className="font-medium text-ink">{video.title}</h3><span className="badge mt-2">{video.ata}</span></div></article>)}{videos.length === 0 && <p className="card empty sm:col-span-2 xl:col-span-3">No hay vídeos en este módulo.</p>}</section>}
  </div>
}
