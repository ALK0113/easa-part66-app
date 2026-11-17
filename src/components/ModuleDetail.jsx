import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { useSchool } from '../contexts/useSchool.js'
import { getSupabaseErrorMessage } from '../lib/supabaseErrors.js'
import { subscribeToTables } from '../lib/supabaseRealtime.js'
import { formatDate } from '../lib/format.js'
import Icon from './Icon.jsx'
import { ROLES, canAccessPage, isManager, teachesLikeProfessor } from '../lib/roles.js'
import { RecordSummary, StudentRecordRow } from './RecordControls.jsx'
import { StudentPracticeResult, StudentPracticeSessions } from './SessionAttendance.jsx'
import UpcomingSessions from './UpcomingSessions.jsx'
import { MODULE_HOVER, moduleColor, moduleStyle } from '../lib/moduleColors.js'
import { useStudentModule } from '../lib/studentModule.js'
import StudentModuleSummary from './StudentModuleSummary.jsx'
import PracticeDescription from './PracticeDescription.jsx'

// Prácticas, TLB y vídeos viven dentro del módulo: se reutilizan sus páginas completas filtradas al módulo
const PracticeList = lazy(() => import('./PracticeList.jsx'))
const TLBList = lazy(() => import('./TLBList.jsx'))
const VideoList = lazy(() => import('./VideoList.jsx'))
const ModuleStudents = lazy(() => import('./ModuleStudents.jsx'))
const TheoryClassList = lazy(() => import('./TheoryClassList.jsx'))
const tabFallback = <div className="flex min-h-[20vh] items-center justify-center text-sm text-muted">Cargando…</div>

// initialPracticeId: al llegar desde el horario se abre directamente esa práctica en la pestaña Prácticas
export default function ModuleDetail({ moduleId, user, onBack, initialPracticeId = null }) {
  const [module, setModule] = useState(null)
  const [practices, setPractices] = useState([])
  const [students, setStudents] = useState([])
  const [teachers, setTeachers] = useState([])
  const [records, setRecords] = useState([])
  const [tlbs, setTLBs] = useState([])
  const [defects, setDefects] = useState([])
  const [videos, setVideos] = useState([])
  const [theoryCount, setTheoryCount] = useState(null)
  const [selectedPractice, setSelectedPractice] = useState(null)
  const [section, setSection] = useState(initialPracticeId ? 'practicas' : 'resumen')
  // Qué abrir al saltar a una pestaña (una práctica, un TLB o el formulario de TLB nuevo)
  const [practiceToOpen, setPracticeToOpen] = useState(initialPracticeId)
  // El alumno ve la práctica en la vista de lectura de aquí: se abre al cargar, una sola vez
  const studentPracticeToOpen = useRef(canAccessPage('practices', user.role) ? null : initialPracticeId)
  const [tlbToOpen, setTlbToOpen] = useState(null)
  const [tlbToCreate, setTlbToCreate] = useState(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  // El alumno no ve la lista de alumnos: ve su asistencia, sus faltas y sus notas del módulo
  const isStudent = user.role === ROLES.STUDENT
  const studentData = useStudentModule(moduleId, isStudent ? user.id : null)

  // Admin con una escuela elegida: solo los datos de esa escuela
  const { filterId } = useSchool()
  const bySchool = useCallback((query, column = 'school_id') => (filterId ? query.eq(column, filterId) : query), [filterId])

  useEffect(() => {
    let cancelled = false
    async function load() {
      const [moduleResult, practiceResult, studentModuleResult, teacherModuleResult, tlbResult, videoResult, theoryResult] = await Promise.all([
        supabase.from('modules').select('id,name,description,color').eq('id', moduleId).maybeSingle(),
        bySchool(supabase.from('practices').select('id,module_id,ata,title,detail,description,objectives,date,start_time,hours').eq('module_id', moduleId).order('date')),
        supabase.from('student_modules').select('student_id').eq('module_id', moduleId),
        supabase.from('teacher_modules').select('profile_id').eq('module_id', moduleId),
        bySchool(supabase.from('tlbs').select('id,practice_id,module_id,aircraft,registration,msn,date,teacher_name,published,crs').eq('module_id', moduleId).order('date', { ascending: false })),
        bySchool(supabase.from('videos').select('id,module_id,ata,title,youtube_url').eq('module_id', moduleId).order('ata')),
        bySchool(supabase.from('theory_classes').select('id', { count: 'exact', head: true }).eq('module_id', moduleId)),
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
          ? supabase.from('practice_records').select('student_id,practice_id,attendance,evaluation,comment').in('practice_id', practiceIds)
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
      if (studentPracticeToOpen.current) {
        const practice = (practiceResult.data || []).find((item) => item.id === studentPracticeToOpen.current)
        if (practice) setSelectedPractice(practice)
        studentPracticeToOpen.current = null
      }
      setStudents(studentResult.data || [])
      setTeachers(teacherResult.data || [])
      setRecords(recordResult.data || [])
      setTLBs(tlbResult.data || [])
      setDefects(defectResult.data || [])
      setVideos(videoResult.data || [])
      setTheoryCount(theoryResult.error ? null : theoryResult.count ?? 0)
      setLoading(false)
    }
    load()
    const unsubscribe = subscribeToTables(
      ['modules', 'practices', 'student_modules', 'teacher_modules', 'students', 'profiles', 'practice_records', 'tlbs', 'defects', 'videos', 'theory_classes'],
      load,
      `module-detail-${moduleId}`,
    )
    return () => { cancelled = true; unsubscribe() }
  }, [moduleId, user.id, bySchool, filterId])

  const canEdit = isManager(user.role) || teachesLikeProfessor(user.role)
  // El personal usa la página completa de prácticas; el alumno, la vista de solo lectura de aquí
  const usesPracticePage = canAccessPage('practices', user.role)
  const openTLB = (tlbId) => { setSelectedPractice(null); setTlbToOpen(tlbId); setSection('tlb') }
  const createTLB = (prefill) => { setSelectedPractice(null); setTlbToCreate(prefill); setSection('tlb') }
  const openPractice = (practice) => {
    if (usesPracticePage) setPracticeToOpen(practice.id)
    else setSelectedPractice(practice)
    setSection('practicas')
  }
  const recordsForPractice = (practiceId) => records.filter((record) => record.practice_id === practiceId)
  const getRecord = (studentId, practiceId) => records.find((record) => record.student_id === String(studentId) && record.practice_id === practiceId) || {}
  const tlbForPractice = (practiceId) => tlbs.filter((tlb) => tlb.practice_id === practiceId)
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
  // Tarjeta de TLB igual que en la sección Technical Log Book: práctica asociada, título, avión y estado
  const tlbRow = (tlb) => {
    const practice = practices.find((item) => item.id === tlb.practice_id)
    const defectCount = defectsForTLB(tlb.id).length
    return (
      <li key={tlb.id}>
        <button className={`card flex w-full items-center gap-4 border-l-[3px] border-r-[3px] p-3 text-left ${MODULE_HOVER}`} style={moduleStyle(module.color)} onClick={() => openTLB(tlb.id)}>
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-subtle text-muted"><Icon name="clipboard" /></span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[11px] font-medium uppercase tracking-wide text-faint tabular-nums">
              <span className="font-semibold text-ink-soft">{tlb.module_id}</span><span className="mx-1.5 text-line-strong">·</span><span className="font-semibold text-ink-soft">Práctica {tlb.practice_id}</span>
            </span>
            <span className="mt-0.5 block truncate font-medium text-ink">{practice ? practice.title : `Práctica ${tlb.practice_id}`}</span>
            <span className="mt-1 block truncate text-xs text-muted">{tlb.aircraft} · {tlb.registration} · {formatDate(tlb.date)} · {defectCount} {defectCount === 1 ? 'defecto' : 'defectos'}</span>
          </span>
          {canEdit && <span className={`badge shrink-0 py-1 ${tlb.published ? 'bg-success-soft text-success' : 'bg-warn-soft text-warn'}`}>{tlb.published ? 'Publicado' : 'Borrador'}</span>}
        </button>
      </li>
    )
  }

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
      <section className="border-l-[3px] pl-4" style={{ borderLeftColor: moduleColor(module.color) }}>
        {/* Encima del título: módulo y nº de práctica, en negro */}
        <p className="text-sm font-semibold uppercase tracking-wide text-ink tabular-nums">{module.id} · {selectedPractice.id}</p>
        <h2 className="mt-1 text-2xl font-semibold text-ink">{selectedPractice.title}</h2>
        {(selectedPractice.ata || selectedPractice.detail) && <p className="mt-1 text-sm text-muted">{[selectedPractice.ata, selectedPractice.detail].filter(Boolean).join(' · ')}</p>}
        <div className="mt-4 flex flex-wrap gap-2 text-sm">
          <span className="badge gap-1.5 bg-surface py-1"><Icon name="calendar" size={14} className="text-faint" />{formatDate(selectedPractice.date)}</span>
          {selectedPractice.start_time && <span className="badge gap-1.5 bg-surface py-1"><Icon name="clock" size={14} className="text-faint" />{String(selectedPractice.start_time).slice(0, 5)} · {selectedPractice.hours} h</span>}
          <span className="badge gap-1.5 bg-surface py-1"><Icon name="users" size={14} className="text-faint" />{students.length} alumnos</span>
        </div>
      </section>
      <PracticeDescription practice={selectedPractice} />
      {!canEdit && <>
        <StudentPracticeResult record={practiceRecords[0]} />
        <StudentPracticeSessions practiceId={selectedPractice.id} requiredHours={selectedPractice.hours} moduleId={module.id} />
      </>}
      {canEdit && <RecordSummary items={[['Presentes', counts.P, 'bg-success'], ['Tarde', counts.L, 'bg-warn'], ['Faltas', counts.A, 'bg-danger'], ['Aptos', `${counts.apto}/${students.length}`, 'bg-accent']]} />}
      {canEdit && <section className="card overflow-hidden">
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
      </section>}
      <section className="card p-3">
        <div className="flex items-center justify-between px-3 pb-1 pt-2">
          <h3 className="font-semibold text-ink">Technical Log Book de la práctica</h3>
          {canEdit && <button type="button" className="btn-secondary h-9" onClick={() => createTLB({ module_id: module.id, practice_id: selectedPractice.id })}><Icon name="plus" size={14} />Crear TLB</button>}
        </div>
        {practiceTLBs.length ? <ul className="space-y-2 px-1 pb-1 pt-1">{practiceTLBs.map(tlbRow)}</ul> : <p className="px-3 pb-3 pt-1 text-sm text-muted">No hay TLB para esta práctica.</p>}
      </section>
    </div>
  }

  const totalHours = practices.reduce((sum, practice) => sum + (practice.hours || 0), 0)
  // Módulo → (submódulos) → clases teóricas y clases prácticas. El Technical Log Book es una subcategoría
  // de las clases prácticas (sección «tlb» dentro de la pestaña Práctica).
  // El número de cada pestaña va en pequeño junto al nombre
  const tabs = [['resumen', 'Resumen'], ['teoria', 'Teoría', theoryCount], ['practicas', 'Práctica', practices.length], ['videos', 'Vídeos', videos.length], ...(usesPracticePage ? [['alumnos', 'Alumnos', students.length]] : [])]
  const inPractices = section === 'practicas' || section === 'tlb'
  const practiceViews = [['practicas', `Clases prácticas · ${practices.length}`], ['tlb', `Technical Log Book · ${tlbs.length}`]]
  const practiceRow = (practice) => (
    <li key={practice.id}>
      <button className={`flex w-full items-center gap-4 rounded-xl border border-l-[3px] border-r-[3px] border-line px-3 py-3 text-left ${MODULE_HOVER}`} style={moduleStyle(module.color)} onClick={() => openPractice(practice)}>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[11px] font-medium uppercase tracking-wide text-faint tabular-nums"><span className="font-semibold text-ink-soft">{practice.module_id}</span><span className="mx-1.5 text-line-strong">·</span><span className="font-semibold text-ink-soft">{practice.id}</span></span>
          <span className="mt-0.5 block truncate font-medium text-ink">{practice.title}</span>
          <span className="mt-0.5 block text-xs text-muted">{practice.ata} · {practice.hours || 0} h</span>
        </span>
        {!canEdit && (() => {
          const evaluation = recordsForPractice(practice.id)[0]?.evaluation
          return <span className={`badge ${evaluation === 'Apto' ? 'bg-success-soft text-success' : evaluation === 'No Apto' ? 'bg-danger-soft text-danger' : 'text-faint'}`}>{evaluation === 'Apto' ? 'Apto' : evaluation === 'No Apto' ? 'No apto' : 'Pendiente'}</span>
        })()}
        <span className="text-right text-sm text-muted">{formatDate(practice.date)}{practice.start_time ? <span className="block text-xs text-faint">{String(practice.start_time).slice(0, 5)}</span> : null}</span>
        <Icon name="next" size={16} className="text-faint" />
      </button>
    </li>
  )

  return <div className="space-y-6">
    <button type="button" className="back-link" onClick={onBack}>← Módulos</button>
    <section className="border-l-[3px] pl-4" style={{ borderLeftColor: moduleColor(module.color) }}>
      <span className="badge bg-accent-soft text-accent-strong">{module.id}</span>
      <h2 className="mt-2 text-2xl font-semibold text-ink">{module.name}</h2>
      <p className="mt-1 max-w-2xl text-sm text-muted">{module.description || 'Sin descripción'}</p>
      <dl className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-4">{(isStudent
        ? [['Prácticas', practices.length], ['Horas', totalHours], ['Mi asistencia', studentData?.rate == null ? '—' : `${studentData.rate}%`], ['Mis faltas', studentData?.linked ? studentData.absences.length : '—']]
        : [['Prácticas', practices.length], ['Horas', totalHours], ['Profesores', teachers.length], ['Alumnos', students.length]]).map(([label, value]) => <div key={label} className="card px-5 py-4"><dt className="text-sm text-muted">{label}</dt><dd className="mt-1 text-xl font-semibold text-ink">{value}</dd></div>)}</dl>
    </section>
    <nav aria-label="Contenido del módulo" className="tabs">{tabs.map(([id, label, count]) => <button key={id} aria-current={(id === 'practicas' ? inPractices : section === id) ? 'page' : undefined} className="tab" onClick={() => { setSection(id); setSelectedPractice(null); setPracticeToOpen(null); setTlbToOpen(null) }}>{label}{count != null && <span className="ml-1.5 text-xs font-normal tabular-nums text-muted">{count}</span>}</button>)}</nav>

    {inPractices && (
      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Prácticas y Technical Log Book">
        {practiceViews.map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={section === id} onClick={() => { setSection(id); setSelectedPractice(null); setPracticeToOpen(null); setTlbToOpen(null) }}
            className={`rounded-xl border px-3.5 py-1.5 text-sm font-medium ${section === id ? 'border-accent bg-accent-soft text-accent-strong' : 'border-line text-ink-soft hover:bg-subtle'}`}>
            {label}
          </button>
        ))}
      </div>
    )}

    {section === 'resumen' && <div className="grid gap-5 lg:grid-cols-2">
      <section className="card p-3 lg:col-span-2">
        <div className="flex items-center justify-between px-3 pb-1 pt-2"><h3 className="font-semibold text-ink">Próximas sesiones</h3></div>
        <UpcomingSessions moduleId={moduleId} user={user}
          onOpenPractice={(id) => { const practice = practices.find((item) => item.id === id); if (practice) openPractice(practice); else setSection('practicas') }}
          onOpenTheory={() => setSection('teoria')} />
      </section>
      {isStudent && <StudentModuleSummary data={studentData} moduleId={moduleId} color={moduleColor(module.color)} />}
      <section className="card p-5"><h3 className="mb-3 font-semibold text-ink">Profesores</h3>{teachers.length ? <ul className="space-y-3">{teachers.map((teacher) => <li key={teacher.id} className="flex items-center gap-3"><span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent-soft text-xs font-semibold text-accent-strong">{(teacher.full_name || 'P')[0].toUpperCase()}</span><span className="min-w-0"><span className="block truncate text-sm font-medium text-ink">{teacher.full_name || 'Profesor'}</span><span className="block truncate text-xs text-muted">{teacher.email || ''}</span></span></li>)}</ul> : <p className="text-sm text-muted">No hay profesores asociados.</p>}</section>
      {!isStudent && <section className="card p-5"><h3 className="mb-3 font-semibold text-ink">Alumnos</h3>{students.length ? <ul className="max-h-72 space-y-3 overflow-y-auto">{students.map((student) => <li key={student.id} className="flex items-center justify-between gap-3 text-sm"><span className="truncate font-medium text-ink">{student.name}</span><span className="shrink-0 text-xs text-muted">{student.group_name || '—'} · {student.promo || '—'}</span></li>)}</ul> : <p className="text-sm text-muted">No hay alumnos asociados.</p>}</section>}
    </div>}

    {section === 'teoria' && <Suspense fallback={tabFallback}><TheoryClassList key={`th-${moduleId}`} user={user} moduleId={moduleId} /></Suspense>}
    {section === 'alumnos' && usesPracticePage && (
      <section className="card p-5">
        <h3 className="font-semibold text-ink">Alumnos del módulo</h3>
        <p className="mb-4 mt-0.5 text-xs text-muted">Quién cursa este módulo: los alumnos del grupo y los que vienen de otros cursos.</p>
        <Suspense fallback={tabFallback}><ModuleStudents moduleId={moduleId} user={user} /></Suspense>
      </section>
    )}

    {section === 'practicas' && usesPracticePage && <Suspense fallback={tabFallback}><PracticeList key={`p-${moduleId}`} user={user} moduleId={moduleId} initialPracticeId={practiceToOpen} onClearInitial={() => setPracticeToOpen(null)} onCreateTLB={createTLB} /></Suspense>}
    {section === 'practicas' && !usesPracticePage && <section className="card p-3">{practices.length ? <ul className="space-y-1.5">{practices.map(practiceRow)}</ul> : <p className="empty">No hay prácticas en este módulo.</p>}</section>}

    {section === 'tlb' && <Suspense fallback={tabFallback}><TLBList key={`t-${moduleId}`} user={user} moduleId={moduleId} initialTlbId={tlbToOpen} onClearInitialTlb={() => setTlbToOpen(null)} initialCreate={tlbToCreate} onClearInitialCreate={() => setTlbToCreate(null)} /></Suspense>}

    {section === 'videos' && <Suspense fallback={tabFallback}><VideoList key={`v-${moduleId}`} user={user} moduleId={moduleId} /></Suspense>}
  </div>
}
