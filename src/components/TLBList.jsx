import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { fetchSchoolModuleIds, useSchool } from '../contexts/useSchool.js'
import { getSupabaseErrorMessage } from '../lib/supabaseErrors.js'
import { subscribeToTables } from '../lib/supabaseRealtime.js'
import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import emailjs from '@emailjs/browser'
import { formatDate } from '../lib/format.js'
import Icon from './Icon.jsx'
import Modal from './Modal.jsx'
import { teachesLikeProfessor } from '../lib/roles.js'

// Configuración de EmailJS desde variables de entorno (ver README)
const EMAILJS_CONFIG = {
  serviceId: import.meta.env.VITE_EMAILJS_SERVICE_ID,
  templateId: import.meta.env.VITE_EMAILJS_TEMPLATE_ID,
  publicKey: import.meta.env.VITE_EMAILJS_PUBLIC_KEY,
  teacherEmail: import.meta.env.VITE_EMAILJS_FALLBACK_EMAIL || '', // respaldo si no se encuentra el del profesor
}
const EMAILJS_READY = Boolean(EMAILJS_CONFIG.serviceId && EMAILJS_CONFIG.templateId && EMAILJS_CONFIG.publicKey)

const inputClass = 'input'
const buttonClass = 'btn-primary'

// Con moduleId se muestra dentro de un módulo: solo sus TLB y sin filtro de módulo
export default function TLBList({ user, moduleId = null, initialTlbId = null, onClearInitialTlb, initialCreate = null, onClearInitialCreate }) {
  const [tlbs, setTlbs] = useState([])
  const [defects, setDefects] = useState([])
  const [practices, setPractices] = useState([])
  const [modules, setModules] = useState([])
  const [aircraft, setAircraft] = useState([])
  const [teachers, setTeachers] = useState([])
  const [teacherModules, setTeacherModules] = useState([])
  const [selectedTLBId, setSelectedTLBId] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [pdfBusy, setPdfBusy] = useState(false)
  const [filters, setFilters] = useState({ module: '', practice: '', date: '', search: '' })
  const [createOpen, setCreateOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [editingTLB, setEditingTLB] = useState(null)
  const [editForm, setEditForm] = useState({
    module_id: '', practice_id: '', aircraft_id: '', date: '',
    teacher_ids: [],
    crs: '', defect_description: '', correct_action: ''
  })
  const [defectFormOpen, setDefectFormOpen] = useState(false)
  const [editingDefect, setEditingDefect] = useState(null)
  const [defectForm, setDefectForm] = useState({ ata: '', pirep: '', defect_description: '', correct_action: '' })
  const [newTLB, setNewTLB] = useState({ module_id: '', practice_id: '', aircraft_id: '', date: new Date().toISOString().slice(0, 10), defect_description: '', correct_action: '' })

  const [studentResponses, setStudentResponses] = useState({})
  const [ownSubmission, setOwnSubmission] = useState(null)
  const [saveState, setSaveState] = useState('idle') // idle | saving | saved | error
  const responsesDirty = useRef(false)
  const [submissions, setSubmissions] = useState([])
  // Firma y solicitudes de cambio
  const [changeRequests, setChangeRequests] = useState([])
  const [signOpen, setSignOpen] = useState(false)
  const [signForm, setSignForm] = useState({ name: '', confirm: false })
  const [changeOpen, setChangeOpen] = useState(false)
  const [changeReason, setChangeReason] = useState('')
  const [requestsVersion, setRequestsVersion] = useState(0)
  const [hiddenActions, setHiddenActions] = useState({})
  // Entrega que se imprime en el PDF del alumno (con su nº de control y revisión)
  const pdfSubmission = useRef(null)

  const userRole = user.role
  const { filterId } = useSchool()

  useEffect(() => {
    let cancelled = false
    async function load() {
      // Cada escuela tiene sus TLB y aviones; el admin ve los de la escuela elegida
      let scopeIds
      try { scopeIds = filterId ? await fetchSchoolModuleIds(filterId) : null } catch (err) { setError(err.message); setLoading(false); return }
      const inScope = (query, column = 'module_id') => (scopeIds ? query.in(column, scopeIds) : query)
      const [tlbResult, practiceResult, defectResult, answerResult, moduleResult, aircraftResult, teacherResult, profilesResult] = await Promise.all([
        filterId ? supabase.from('tlbs').select('*').eq('school_id', filterId).order('date', { ascending: false }) : supabase.from('tlbs').select('*').order('date', { ascending: false }),
        filterId ? supabase.from('practices').select('id,title,module_id,ata').eq('school_id', filterId) : supabase.from('practices').select('id,title,module_id,ata'),
        // Solo los defectos de los TLB de la escuela elegida (el resto ya los filtra la RLS)
        filterId
          ? supabase.from('defects').select('*,tlbs!defects_tlb_id_fkey!inner(school_id)').eq('tlbs.school_id', filterId).order('defect_number', { ascending: true })
          : supabase.from('defects').select('*').order('defect_number', { ascending: true }),
        // Las respuestas oficiales solo las devuelve la RLS al admin y a los profesores del módulo
        userRole === 'alumno'
          ? Promise.resolve({ data: [], error: null })
          : supabase.from('defect_answers').select('defect_id,correct_action'),
        inScope(supabase.from('modules').select('id,name'), 'id'),
        filterId ? supabase.from('aircraft').select('id,type,registration,msn').eq('school_id', filterId) : supabase.from('aircraft').select('id,type,registration,msn'),
        teachesLikeProfessor(userRole)
          ? supabase.from('teacher_modules').select('module_id').eq('profile_id', user.id)
          : Promise.resolve({ data: [], error: null }),
        filterId
          ? supabase.from('profiles').select('id,full_name,email,school_profiles!inner(school_id)').in('role', ['profesor', 'supervisor']).eq('school_profiles.school_id', filterId).order('full_name', { ascending: true })
          : supabase.from('profiles').select('id,full_name,email').in('role', ['profesor', 'supervisor']).order('full_name', { ascending: true }),
      ])
      if (cancelled) return
      const failure = tlbResult.error || practiceResult.error || defectResult.error || answerResult.error || moduleResult.error || aircraftResult.error || teacherResult.error || profilesResult.error
      if (failure) setError(failure.message)
      else {
        setTlbs(tlbResult.data || [])
        setPractices(practiceResult.data || [])
        const answers = new Map((answerResult.data || []).map((row) => [row.defect_id, row.correct_action]))
        setDefects((defectResult.data || []).map((defect) => ({ ...defect, tlbs: undefined, correct_action: answers.get(defect.id) || '' })))
        setModules(moduleResult.data || [])
        setAircraft(aircraftResult.data || [])
        setTeacherModules((teacherResult.data || []).map((item) => item.module_id))
        const normalizedTeachers = (profilesResult.data || []).map(p => ({
          id: p.id,
          name: p.full_name || 'Sin nombre',
          email: p.email || ''
        }))
        setTeachers(normalizedTeachers)
      }
      setLoading(false)
    }
    load()
    const unsubscribe = subscribeToTables(['tlbs', 'practices', 'defects', 'defect_answers', 'modules', 'aircraft', 'teacher_modules', 'profiles'], load, 'tlb-list')
    return () => { cancelled = true; unsubscribe() }
  }, [user.id, userRole, filterId])

  const activeTLBId = selectedTLBId || initialTlbId

  useEffect(() => {
    let cancelled = false
    async function loadStudentData() {
      if (userRole !== 'alumno' || !activeTLBId) return
      responsesDirty.current = false
      const { data: submission } = await supabase
        .from('tlb_submissions')
        .select('*')
        .eq('student_id', user.id)
        .eq('tlb_id', activeTLBId)
        .maybeSingle()
      if (cancelled) return
      setOwnSubmission(submission || null)
      setStudentResponses(submission?.defect_responses || {})
      setSaveState(submission ? 'saved' : 'idle')
    }
    loadStudentData()
    return () => { cancelled = true }
  }, [activeTLBId, userRole, user.id])

  // Guarda las respuestas como borrador mientras el alumno escribe.
  async function saveSubmission(responses) {
    const { data, error: saveError } = await supabase
      .from('tlb_submissions')
      .upsert({
        student_id: user.id,
        tlb_id: activeTLBId,
        defect_responses: responses,
      }, { onConflict: 'student_id,tlb_id' })
      .select()
      .single()
    if (saveError) throw saveError
    setOwnSubmission(data)
    return data
  }

  useEffect(() => {
    if (userRole !== 'alumno' || !activeTLBId || !responsesDirty.current || ownSubmission?.signed_at) return undefined
    const timer = setTimeout(async () => {
      setSaveState('saving')
      try {
        await saveSubmission(studentResponses)
        responsesDirty.current = false
        setSaveState('saved')
      } catch {
        setSaveState('error')
      }
    }, 900)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- solo debe reaccionar a lo que escribe el alumno
  }, [studentResponses])

  useEffect(() => {
    async function loadSubmissions() {
      if (userRole === 'alumno') return
      // tlb_submissions.student_id es el id de usuario (profiles.id), no el de la
      // ficha del alumno: se resuelve con student_profiles → students.
      const { data, error } = await supabase
        .from('tlb_submissions')
        .select('*')
        .order('completed_at', { ascending: false })
      if (error || !data) return
      const profileIds = [...new Set(data.map((s) => s.student_id))]
      const { data: links } = profileIds.length
        ? await supabase
          .from('student_profiles')
          .select('profile_id, students(name, student_number, group_name)')
          .in('profile_id', profileIds)
        : { data: [] }
      const studentByProfile = new Map((links || []).map((link) => [link.profile_id, link.students]))
      setSubmissions(data.map((s) => ({ ...s, students: studentByProfile.get(s.student_id) || null })))
    }
    loadSubmissions()
  }, [userRole, selectedTLBId])

  useEffect(() => {
    let active = true
    supabase.from('tlb_change_requests').select('id,submission_id,revision,reason,status,response,requested_at,resolved_at').order('requested_at', { ascending: false })
      .then(({ data }) => { if (active) setChangeRequests(data || []) })
    return () => { active = false }
  }, [activeTLBId, ownSubmission?.id, ownSubmission?.signed_at, submissions.length, requestsVersion])

  const isStudent = userRole === 'alumno'
  const selectedTLB = tlbs.find((item) => item.id === selectedTLBId)
    || tlbs.find((item) => item.id === initialTlbId)
    || null
  const editableModules = userRole === 'admin' ? modules.map((module) => module.id) : teacherModules
  const editableTLB = (tlb) => userRole === 'admin' || (teachesLikeProfessor(userRole) && teacherModules.includes(tlb.module_id))
  const getPractice = (id) => practices.find((practice) => practice.id === id)
  const getModule = (id) => modules.find((module) => module.id === id)
  const getDefects = (id) => defects.filter((defect) => defect.tlb_id === id).sort((a, b) => a.defect_number - b.defect_number)
  const availablePractices = practices.filter((practice) => practice.module_id === (editForm.module_id || newTLB.module_id))
  const scopedTLBs = moduleId ? tlbs.filter((tlb) => tlb.module_id === moduleId) : tlbs
  const availableModules = [...new Set(scopedTLBs.map((tlb) => tlb.module_id))]
  const availablePracticesFilter = [...new Set(scopedTLBs.map((tlb) => tlb.practice_id))]
  const availableDates = [...new Set(scopedTLBs.map((tlb) => tlb.date))].sort().reverse()

  const filteredTLBs = scopedTLBs.filter((tlb) => {
    const practice = getPractice(tlb.practice_id)
    const query = filters.search.trim().toLowerCase()
    const matchesSearch = !query || [practice?.title, tlb.practice_id, tlb.aircraft, tlb.registration, tlb.teacher_name]
      .some((value) => String(value || '').toLowerCase().includes(query))
    return (!filters.module || tlb.module_id === filters.module)
      && (!filters.practice || tlb.practice_id === filters.practice)
      && (!filters.date || tlb.date === filters.date)
      && matchesSearch
  })

  const toggleActionVisibility = (defectId) => {
    setHiddenActions(prev => ({ ...prev, [defectId]: !prev[defectId] }))
  }

  const updateStudentResponse = (defectId, value) => {
    responsesDirty.current = true
    setStudentResponses(prev => ({ ...prev, [defectId]: value }))
  }

  // Formulario de TLB nuevo con lo que ya se sabe: módulo, práctica (si solo hay una) y avión (si la escuela tiene uno)
  function openCreate(prefill = {}) {
    const targetModuleId = prefill.module_id || moduleId || editableModules[0] || ''
    const modulePractices = practices.filter((practice) => practice.module_id === targetModuleId)
    setMessage('')
    setNewTLB({
      module_id: targetModuleId,
      practice_id: prefill.practice_id || (modulePractices.length === 1 ? modulePractices[0].id : ''),
      aircraft_id: aircraft.length === 1 ? String(aircraft[0].id) : '',
      date: new Date().toISOString().slice(0, 10),
      defect_description: '',
      correct_action: '',
    })
    setCreateOpen(true)
  }

  // Llegada desde una práctica («Crear TLB»): el formulario se abre ya relleno
  useEffect(() => {
    if (loading || !initialCreate) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- abre el formulario una sola vez al llegar
    openCreate(initialCreate)
    onClearInitialCreate?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- solo al terminar de cargar
  }, [loading, initialCreate])

  // Al cambiar de módulo, si solo tiene una práctica se elige sola
  const withModule = (form, nextModuleId) => {
    const modulePractices = practices.filter((practice) => practice.module_id === nextModuleId)
    return { ...form, module_id: nextModuleId, practice_id: modulePractices.length === 1 ? modulePractices[0].id : '' }
  }

  const toggleTeacher = (teacherId) => {
    setEditForm(prev => ({
      ...prev,
      teacher_ids: prev.teacher_ids.includes(teacherId)
        ? prev.teacher_ids.filter(id => id !== teacherId)
        : [...prev.teacher_ids, teacherId]
    }))
  }

  function openEditForm(tlb) {
    setEditingTLB(tlb)
    let currentTeacherIds = []
    if (tlb.teacher_ids && Array.isArray(tlb.teacher_ids)) {
      currentTeacherIds = tlb.teacher_ids
    } else if (tlb.teacher_name) {
      const names = tlb.teacher_name.split(',').map(n => n.trim())
      currentTeacherIds = teachers
        .filter(t => names.includes(t.name))
        .map(t => t.id)
    }

    // Sin profesores guardados: se propone quien edita, si es profesor
    if (currentTeacherIds.length === 0 && teachers.some((teacher) => teacher.id === user.id)) currentTeacherIds = [user.id]
    const matchingAircraft = aircraft.find(p => p.registration === tlb.registration)

    setEditForm({
      module_id: tlb.module_id || '',
      practice_id: tlb.practice_id || '',
      aircraft_id: matchingAircraft ? String(matchingAircraft.id) : '',
      date: tlb.date?.slice(0, 10) || '',
      teacher_ids: currentTeacherIds,
      crs: tlb.crs || '',
      defect_description: '',
      correct_action: ''
    })
    setEditOpen(true)
    setMessage('')
  }

  async function saveEditTLB(event) {
    event.preventDefault()
    setBusy(true)
    setMessage('')

    const plane = aircraft.find((item) => String(item.id) === editForm.aircraft_id)
    if (!plane) {
      setMessage('Selecciona un avión válido.')
      setBusy(false)
      return
    }

    if (editForm.teacher_ids.length === 0) {
      setMessage('Selecciona al menos un profesor.')
      setBusy(false)
      return
    }

    const selectedTeachers = teachers.filter(t => editForm.teacher_ids.includes(t.id))
    const teacherNames = selectedTeachers.map(t => t.name).join(', ')

    const payload = {
      module_id: editForm.module_id,
      practice_id: editForm.practice_id,
      aircraft: plane.type,
      registration: plane.registration,
      msn: plane.msn,
      date: editForm.date,
      teacher_name: teacherNames,
      crs: editForm.crs.trim(),
    }

    const { error: updateError } = await supabase
      .from('tlbs')
      .update(payload)
      .eq('id', editingTLB.id)

    setBusy(false)
    if (updateError) {
      setMessage(getSupabaseErrorMessage(updateError))
      return
    }

    setTlbs((current) => current.map((item) =>
      item.id === editingTLB.id ? { ...item, ...payload } : item
    ))

    setEditOpen(false)
    setEditingTLB(null)
    setMessage('✅ TLB actualizado correctamente.')
  }

  function buildTlbPdf(tlbDefects, responses, isStudentVersion = true) {
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
    const pageWidth = doc.internal.pageSize.getWidth()
    const margin = 14

    doc.setFont('helvetica', 'bold')
    doc.setFontSize(16)
    doc.setTextColor(10, 37, 64)
    doc.text('EASA PART-147 · TASK LOG BOOK', margin, 17)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    doc.setTextColor(100, 110, 120)

    const subtitle = isStudentVersion
      ? `Entrega del alumno: ${user.name}`
      : `Informe oficial del TLB`
    doc.text(subtitle, margin, 23)
    const signedInfo = isStudentVersion && pdfSubmission.current?.control_number
      ? ` · Nº de control ${pdfSubmission.current.control_number} · Revisión ${pdfSubmission.current.revision ?? 0} · Firmado por ${pdfSubmission.current.signed_name || user.name}`
      : ''
    doc.text(`Generado: ${new Date().toLocaleString('es-ES')}${signedInfo}`, margin, 28)

    const practice = getPractice(selectedTLB.practice_id)
    const module = getModule(selectedTLB.module_id)

    autoTable(doc, {
      startY: 34,
      head: [['Datos del cuaderno', 'Detalle']],
      body: [
        ['Aeronave', selectedTLB.aircraft || '—'],
        ['Matrícula / MSN', `${selectedTLB.registration || '—'} / ${selectedTLB.msn || '—'}`],
        ['Módulo', `${module?.id || selectedTLB.module_id || '—'}${module?.name ? ` · ${module.name}` : ''}`],
        ['Práctica', `${practice?.id || selectedTLB.practice_id || '—'}${practice?.title ? ` · ${practice.title}` : ''}`],
        ['Fecha', formatDate(selectedTLB.date)],
        ['Profesor(es)', selectedTLB.teacher_name || '—'],
      ],
      theme: 'grid',
      margin: { left: margin, right: margin },
      headStyles: { fillColor: [10, 37, 64], textColor: 255, fontStyle: 'bold' },
      styles: { font: 'helvetica', fontSize: 9, cellPadding: 2.5, overflow: 'linebreak' },
      columnStyles: { 0: { cellWidth: 43, fontStyle: 'bold' }, 1: { cellWidth: pageWidth - margin * 2 - 43 } },
    })

    autoTable(doc, {
      startY: doc.lastAutoTable.finalY + 8,
      head: [['#', 'ATA', 'PIREP', 'Descripción del defecto', isStudentVersion ? 'Acción del alumno' : 'Acción correctiva oficial']],
      body: tlbDefects.map((defect) => [
        String(defect.defect_number),
        defect.ata || '—',
        defect.pirep || '—',
        defect.defect_description || '—',
        isStudentVersion ? (responses[defect.id] || '—') : (defect.correct_action || '—'),
      ]),
      theme: 'grid',
      margin: { left: margin, right: margin },
      headStyles: { fillColor: [10, 37, 64], textColor: 255, fontStyle: 'bold' },
      styles: { font: 'helvetica', fontSize: 8, cellPadding: 2, overflow: 'linebreak', valign: 'top' },
      columnStyles: {
        0: { cellWidth: 8 },
        1: { cellWidth: 18 },
        2: { cellWidth: 22 },
        3: { cellWidth: 63 },
        4: { cellWidth: 'auto' },
      },
    })

    let finalY = doc.lastAutoTable.finalY + 9
    if (selectedTLB.crs) {
      const crsLines = doc.splitTextToSize(`CRS · Certificate of Release to Service\n${selectedTLB.crs}`, pageWidth - margin * 2)
      if (finalY + crsLines.length * 4 > doc.internal.pageSize.getHeight() - 18) {
        doc.addPage()
        finalY = 18
      }
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(9)
      doc.setTextColor(46, 125, 50)
      doc.text(crsLines, margin, finalY)
    }

    const pageCount = doc.internal.getNumberOfPages()
    for (let page = 1; page <= pageCount; page += 1) {
      doc.setPage(page)
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(8)
      doc.setTextColor(120, 120, 120)
      doc.text(`EASA Part-147 · TLB ${selectedTLB.id} · ${page}/${pageCount}`, pageWidth - margin, doc.internal.pageSize.getHeight() - 8, { align: 'right' })
    }

    return doc
  }

  // Firma: guarda las respuestas, la base de datos registra la firma, el nº de control y la revisión,
  // y la entrega queda cerrada. Después se genera (y se envía) el PDF.
  async function signSubmission(event) {
    event.preventDefault()
    if (!selectedTLB) return
    setBusy(true)
    try {
      await saveSubmission(studentResponses)
      responsesDirty.current = false
      const { error: signError } = await supabase.rpc('tlb_sign', { p_tlb_id: selectedTLB.id, p_signed_name: signForm.name })
      if (signError) throw signError
      const { data: fresh } = await supabase.from('tlb_submissions').select('*').eq('student_id', user.id).eq('tlb_id', selectedTLB.id).maybeSingle()
      setOwnSubmission(fresh)
      setSaveState('saved')
      setSignOpen(false)
      setMessage(`✅ TLB firmado. Nº de control ${fresh?.control_number} · revisión ${fresh?.revision ?? 0}.`)
      await generateStudentPdf(fresh)
    } catch (signError) {
      setMessage(`❌ No se pudo firmar: ${getSupabaseErrorMessage(signError)}`)
    } finally {
      setBusy(false)
    }
  }

  async function requestChange(event) {
    event.preventDefault()
    setBusy(true)
    const { error: requestError } = await supabase.rpc('tlb_request_change', { p_tlb_id: selectedTLB.id, p_reason: changeReason })
    setBusy(false)
    if (requestError) { setMessage(`❌ ${getSupabaseErrorMessage(requestError)}`); return }
    setChangeOpen(false)
    setChangeReason('')
    setMessage('Solicitud de cambio enviada al profesor.')
    setRequestsVersion((value) => value + 1)
  }

  // Profesor: aprobar (reabre la entrega con la revisión siguiente) o rechazar
  async function resolveChange(request, approve) {
    const response = window.prompt(approve ? 'Aprobar el cambio. Comentario para el alumno (opcional):' : 'Rechazar el cambio. Motivo para el alumno (opcional):', '')
    if (response === null) return
    setBusy(true)
    const { error: resolveError } = await supabase.rpc('tlb_resolve_change', { p_request_id: request.id, p_approve: approve, p_response: response })
    setBusy(false)
    if (resolveError) { setMessage(`❌ ${getSupabaseErrorMessage(resolveError)}`); return }
    setMessage(approve ? 'Cambio aprobado: el alumno puede editar y volver a firmar (nueva revisión).' : 'Cambio rechazado.')
    setRequestsVersion((value) => value + 1)
    setSubmissions((current) => current.map((item) => (item.id === request.submission_id && approve ? { ...item, signed_at: null, completed_at: null, revision: (item.revision || 0) + 1 } : item)))
  }

  async function generateStudentPdf(signedSubmission = ownSubmission) {
    if (!selectedTLB) return
    const tlbDefects = getDefects(selectedTLB.id)
    pdfSubmission.current = signedSubmission

    const studentEmail = user.email

    if (!studentEmail) {
      setMessage('ℹ️ No tienes un correo registrado en tu perfil. El PDF se descargará. Por favor, envíalo manualmente a tu profesor.')
      const doc = buildTlbPdf(tlbDefects, studentResponses, true)
      doc.save(`TLB_${selectedTLB.id}_${user.name.replace(/\s+/g, '_')}.pdf`)
      return
    }

    setPdfBusy(true)
    setMessage('Generando el PDF y enviándolo a tu profesor…')

    try {
      // Correo del profesor asignado al TLB
      const assignedTeacherNames = selectedTLB.teacher_name 
        ? selectedTLB.teacher_name.split(',').map(n => n.trim()) 
        : []
      
      const assignedTeacherEmails = teachers
        .filter(t => assignedTeacherNames.includes(t.name) && t.email)
        .map(t => t.email)
        .join(', ')

      // Usamos el correo encontrado, o el de respaldo si no se encontró ninguno
      const targetEmail = assignedTeacherEmails || EMAILJS_CONFIG.teacherEmail

      if (!targetEmail || !EMAILJS_READY) {
        setMessage('⚠️ No se encontró el correo del profesor en el sistema. El PDF se descargará para que lo envíes manualmente.')
        const doc = buildTlbPdf(tlbDefects, studentResponses, true)
        doc.save(`TLB_${selectedTLB.id}_${user.name.replace(/\s+/g, '_')}.pdf`)
        setPdfBusy(false)
        return
      }

      const doc = buildTlbPdf(tlbDefects, studentResponses, true)
      const pdfBlob = doc.output('blob')
      const pdfFile = new File(
        [pdfBlob],
        `TLB_${selectedTLB.id}_${user.name.replace(/\s+/g, '_')}.pdf`,
        { type: 'application/pdf' }
      )

      const templateParams = {
        to_email: targetEmail, // se envía al profesor asignado
        from_name: user.name,
        student_email: studentEmail,
        tlb_id: selectedTLB.id,
        practice_title: getPractice(selectedTLB.practice_id)?.title || 'Práctica TLB',
        message: `El alumno ${user.name} ha completado el Task Log Book ${selectedTLB.id}.`,
        attachment: pdfFile,
      }

      await emailjs.send(
        EMAILJS_CONFIG.serviceId,
        EMAILJS_CONFIG.templateId,
        templateParams,
        EMAILJS_CONFIG.publicKey
      )

      doc.save(`TLB_${selectedTLB.id}_${user.name.replace(/\s+/g, '_')}.pdf`)
      setMessage(`✅ PDF generado, enviado a ${targetEmail} y descargado correctamente.`)

    } catch (error) {
      console.error('Error al enviar email:', error)
      setMessage(`❌ Error al enviar el correo: ${error.text || 'desconocido'}. El PDF se ha descargado, envíalo manualmente.`)
      const doc = buildTlbPdf(tlbDefects, studentResponses, true)
      doc.save(`TLB_${selectedTLB.id}_${user.name.replace(/\s+/g, '_')}.pdf`)
    } finally {
      setPdfBusy(false)
    }
  }

  async function togglePublish(tlb) {
    setBusy(true)
    const published = !tlb.published
    const { error: updateError } = await supabase.rpc('toggle_tlb_publish', {
      p_tlb_id: tlb.id,
      p_published: published,
    })
    setBusy(false)
    if (updateError) { setMessage(getSupabaseErrorMessage(updateError)); return }
    setTlbs((current) => current.map((item) => item.id === tlb.id ? { ...item, published } : item))
    setMessage(published ? 'TLB publicado para los alumnos.' : 'TLB despublicado.')
  }

  function openDefectForm(defect = null) {
    setEditingDefect(defect)
    setDefectForm(defect ? {
      ata: defect.ata || '',
      pirep: defect.pirep || '',
      defect_description: defect.defect_description || '',
      correct_action: defect.correct_action || '',
    } : { ata: '', pirep: '', defect_description: '', correct_action: '' })
    setDefectFormOpen(true)
    setMessage('')
  }

  async function saveDefect(event) {
    event.preventDefault()
    if (!selectedTLB) return
    setBusy(true)
    const content = {
      ata: defectForm.ata.trim(),
      pirep: defectForm.pirep.trim(),
      defect_description: defectForm.defect_description.trim(),
    }
    const correctAction = defectForm.correct_action.trim()
    if (editingDefect) {
      const { data, error: updateError } = await supabase.from('defects').update(content).eq('id', editingDefect.id).select().single()
      if (updateError) { setBusy(false); setMessage(getSupabaseErrorMessage(updateError)); return }
      const { error: answerError } = await supabase.from('defect_answers')
        .upsert({ defect_id: data.id, correct_action: correctAction, updated_at: new Date().toISOString() })
      setBusy(false)
      if (answerError) { setMessage(getSupabaseErrorMessage(answerError)); return }
      setDefects((current) => current.map((item) => item.id === data.id ? { ...data, correct_action: correctAction } : item))
    } else {
      const { data: defectId, error: insertError } = await supabase.rpc('add_defect_to_tlb', {
        p_tlb_id: selectedTLB.id,
        p_defect_number: getDefects(selectedTLB.id).length + 1,
        p_ata: content.ata,
        p_pirep: content.pirep,
        p_defect_description: content.defect_description,
        p_correct_action: correctAction,
      })
      if (insertError) { setBusy(false); setMessage(getSupabaseErrorMessage(insertError)); return }
      const { data, error: fetchError } = await supabase.from('defects').select('*').eq('id', defectId).single()
      setBusy(false)
      if (fetchError) { setMessage(getSupabaseErrorMessage(fetchError)); return }
      setDefects((current) => [...current, { ...data, correct_action: correctAction }])
    }
    setDefectFormOpen(false)
    setMessage(editingDefect ? 'Defecto actualizado.' : 'Defecto añadido.')
  }

  async function deleteDefect(defect) {
    if (!window.confirm(`¿Eliminar el defecto #${defect.defect_number}?`)) return
    const { error: deleteError } = await supabase.from('defects').delete().eq('id', defect.id)
    if (deleteError) { setMessage(deleteError.message); return }
    const remaining = getDefects(selectedTLB.id).filter((item) => item.id !== defect.id)
    const next = []
    for (const [index, item] of remaining.entries()) {
      if (item.defect_number === index + 1) next.push(item)
      else {
        const { data, error: updateError } = await supabase.from('defects').update({ defect_number: index + 1 }).eq('id', item.id).select().single()
        if (updateError) { setMessage(updateError.message); return }
        next.push({ ...data, correct_action: item.correct_action })
      }
    }
    setDefects((current) => [...current.filter((item) => item.tlb_id !== selectedTLB.id), ...next])
    setMessage('Defecto eliminado.')
  }

  async function createTLB(event) {
    event.preventDefault()
    setBusy(true)
    setMessage('')
    const plane = aircraft.find((item) => String(item.id) === newTLB.aircraft_id)
    const practice = practices.find((item) => item.id === newTLB.practice_id && item.module_id === newTLB.module_id)
    if (!plane || !practice || !editableModules.includes(newTLB.module_id)) {
      setMessage('Selecciona un módulo, una práctica y un avión válidos.')
      setBusy(false)
      return
    }
    const { data: result, error: createError } = await supabase.rpc('admin_create_tlb_with_defect', {
      p_module_id: newTLB.module_id,
      p_practice_id: newTLB.practice_id,
      p_aircraft_id: newTLB.aircraft_id,
      p_date: newTLB.date,
      p_teacher_name: user.name,
      p_defect_description: newTLB.defect_description.trim(),
      p_correct_action: newTLB.correct_action.trim(),
    })
    if (createError) { setMessage(getSupabaseErrorMessage(createError)); setBusy(false); return }
    const { tlb, defect } = result
    setTlbs((current) => [tlb, ...current])
    setDefects((current) => [...current, defect])
    setNewTLB({ module_id: '', practice_id: '', aircraft_id: '', date: new Date().toISOString().slice(0, 10), defect_description: '', correct_action: '' })
    setCreateOpen(false)
    setBusy(false)
    setMessage('TLB creado y pendiente de publicación.')
  }

  function downloadOfficialPdf() {
    if (!selectedTLB) return
    const doc = buildTlbPdf(getDefects(selectedTLB.id), {}, false)
    doc.save(`TLB_${selectedTLB.id}_informe.pdf`)
  }

  const isErrorMessage = /^(❌|⚠️)/.test(message)
  const messageText = message.replace(/^(❌|⚠️|✅|ℹ️)\s*/, '')
  const pageNotice = message && <p role={isErrorMessage ? 'alert' : 'status'} className={isErrorMessage ? 'notice-error' : 'notice'}>{messageText}</p>
  const formError = message && <p role="alert" className="notice-error">{messageText}</p>
  const tlbFormFields = (form, setForm) => <>
    <label className="field">Módulo<select className={inputClass} value={form.module_id} onChange={(event) => setForm(withModule(form, event.target.value))} required><option value="">Selecciona módulo</option>{modules.filter((module) => editableModules.includes(module.id)).map((module) => <option key={module.id} value={module.id}>{module.id} · {module.name}</option>)}</select></label>
    <label className="field">Práctica<select className={inputClass} value={form.practice_id} onChange={(event) => setForm({ ...form, practice_id: event.target.value })} required><option value="">Selecciona práctica</option>{availablePractices.map((practice) => <option key={practice.id} value={practice.id}>{practice.id} · {practice.title}</option>)}</select></label>
    <div className="grid gap-4 sm:grid-cols-2">
      <label className="field">Avión<select className={inputClass} value={form.aircraft_id} onChange={(event) => setForm({ ...form, aircraft_id: event.target.value })} required><option value="">Selecciona avión</option>{aircraft.map((plane) => <option key={plane.id} value={plane.id}>{plane.type} · {plane.registration}</option>)}</select></label>
      <label className="field">Fecha<input className={inputClass} type="date" value={form.date} onChange={(event) => setForm({ ...form, date: event.target.value })} required /></label>
    </div>
  </>

  if (loading) return <div className="flex min-h-[40vh] items-center justify-center text-sm text-muted">Cargando Task Log Book…</div>
  if (error) return <div role="alert" className="notice-error">No se pudo cargar el TLB: {error}</div>

  if (selectedTLB) {
    const practice = getPractice(selectedTLB.practice_id)
    const module = getModule(selectedTLB.module_id)
    const tlbDefects = getDefects(selectedTLB.id)
    const editable = editableTLB(selectedTLB)
    const completedSubmissions = submissions.filter((s) => s.tlb_id === selectedTLB.id && s.signed_at)
    const tlbSubmissionIds = new Set(submissions.filter((s) => s.tlb_id === selectedTLB.id).map((s) => s.id))
    const pendingRequests = changeRequests.filter((request) => request.status === 'pendiente' && tlbSubmissionIds.has(request.submission_id))
    const delivered = Boolean(ownSubmission?.signed_at)
    const ownRequests = ownSubmission ? changeRequests.filter((request) => request.submission_id === ownSubmission.id) : []
    const ownPending = ownRequests.find((request) => request.status === 'pendiente')
    const lastResolved = ownRequests.find((request) => request.status !== 'pendiente')
    const answeredCount = tlbDefects.filter((defect) => studentResponses[defect.id]?.trim()).length
    const saveLabel = { saving: 'Guardando…', saved: 'Borrador guardado', error: 'No se pudo guardar el borrador' }[saveState]

    return <div className="space-y-6">
      <button type="button" className="back-link" onClick={() => { setSelectedTLBId(null); onClearInitialTlb?.(); setMessage('') }}>← Task Log Book</button>

      <section className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm text-muted">{module?.id || selectedTLB.module_id}{practice ? ` · ${practice.title}` : ''}</p>
          <h2 className="mt-1 text-2xl font-semibold text-ink">{selectedTLB.aircraft}</h2>
          <div className="mt-3 flex flex-wrap gap-2 text-sm">
            <span className="badge bg-surface py-1">{selectedTLB.registration}{selectedTLB.msn ? ` · MSN ${selectedTLB.msn}` : ''}</span>
            <span className="badge gap-1.5 bg-surface py-1"><Icon name="calendar" size={14} className="text-faint" />{formatDate(selectedTLB.date)}</span>
            {selectedTLB.teacher_name && <span className="badge gap-1.5 bg-surface py-1"><Icon name="user" size={14} className="text-faint" />{selectedTLB.teacher_name}</span>}
            {!isStudent && <span className={`badge py-1 ${selectedTLB.published ? 'bg-success-soft text-success' : 'bg-warn-soft text-warn'}`}>{selectedTLB.published ? 'Publicado' : 'Borrador'}</span>}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {!isStudent && <button className="btn-secondary" onClick={downloadOfficialPdf}><Icon name="download" size={16} />Informe PDF</button>}
          {editable && <button className="btn-secondary" onClick={() => openEditForm(selectedTLB)}><Icon name="edit" size={16} />Editar</button>}
          {editable && <button className={selectedTLB.published ? 'btn-secondary' : 'btn-primary'} disabled={busy} onClick={() => togglePublish(selectedTLB)}>{selectedTLB.published ? 'Despublicar' : 'Publicar para alumnos'}</button>}
        </div>
      </section>

      {pageNotice}

      {isStudent && (
        <section className={`card space-y-3 px-5 py-4 ${delivered ? 'bg-success-soft' : ''}`}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              {delivered ? (
                <>
                  <p className="text-sm font-medium text-success">Firmado por {ownSubmission.signed_name} el {new Date(ownSubmission.signed_at).toLocaleString('es-ES')}</p>
                  <p className="mt-0.5 text-xs text-ink-soft">Nº de control <strong className="tabular-nums">{ownSubmission.control_number}</strong> · Revisión {ownSubmission.revision ?? 0} · ya no se puede editar</p>
                </>
              ) : (
                <>
                  <p className="text-sm font-medium text-ink">{answeredCount} de {tlbDefects.length} acciones completadas{ownSubmission?.revision ? ` · Revisión ${ownSubmission.revision} (reabierto)` : ''}</p>
                  <p className="mt-0.5 text-xs text-muted">{saveLabel || 'Tus respuestas se guardan solas mientras escribes. Al terminar, fírmalo.'}</p>
                </>
              )}
            </div>
            {!delivered && <button className="btn-primary" disabled={busy || tlbDefects.length === 0 || answeredCount < tlbDefects.length} title={answeredCount < tlbDefects.length ? 'Responde todas las acciones para poder firmar' : undefined} onClick={() => { setSignForm({ name: user.name || '', confirm: false }); setSignOpen(true) }}><Icon name="check" size={16} />Firmar y entregar</button>}
            {delivered && !ownPending && <button className="btn-secondary" disabled={busy} onClick={() => setChangeOpen(true)}><Icon name="edit" size={16} />Solicitar cambio</button>}
            {delivered && <button className="btn-ghost" disabled={pdfBusy} onClick={() => { pdfSubmission.current = ownSubmission; buildTlbPdf(tlbDefects, studentResponses, true).save(`TLB_${(ownSubmission.control_number || selectedTLB.id).replace(/\//g, '-')}_rev${ownSubmission.revision ?? 0}.pdf`) }}><Icon name="download" size={16} />PDF</button>}
          </div>
          {ownPending && <p className="rounded-lg bg-warn-soft px-3 py-2 text-xs text-warn">Solicitud de cambio enviada el {new Date(ownPending.requested_at).toLocaleString('es-ES')}: pendiente del profesor. «{ownPending.reason}»</p>}
          {!ownPending && lastResolved && (
            <p className={`rounded-lg px-3 py-2 text-xs ${lastResolved.status === 'aprobada' ? 'bg-subtle text-ink-soft' : 'bg-danger-soft text-danger'}`}>
              Última solicitud {lastResolved.status === 'aprobada' ? 'aprobada' : 'rechazada'}{lastResolved.response ? `: «${lastResolved.response}»` : ''}
            </p>
          )}
        </section>
      )}

      {signOpen && (
        <Modal title="Firmar y entregar" onClose={() => setSignOpen(false)}>
          <form className="space-y-4" onSubmit={signSubmission}>
            <p className="text-sm text-muted">Al firmar, tus respuestas quedan registradas con un número de control y <strong>ya no se pueden editar</strong>. Para cambiarlas tendrás que solicitarlo al profesor.</p>
            <label className="field">Firma: tu nombre completo<input className={inputClass} required minLength={3} value={signForm.name} onChange={(event) => setSignForm({ ...signForm, name: event.target.value })} /></label>
            <label className="choice"><input type="checkbox" checked={signForm.confirm} onChange={(event) => setSignForm({ ...signForm, confirm: event.target.checked })} />Confirmo que estas respuestas son mías y doy el TLB por terminado.</label>
            <div className="flex justify-end gap-2"><button type="button" className="btn-secondary" onClick={() => setSignOpen(false)}>Cancelar</button><button className={buttonClass} disabled={busy || !signForm.confirm || signForm.name.trim().length < 3}>{busy ? 'Firmando…' : 'Firmar'}</button></div>
          </form>
        </Modal>
      )}

      {changeOpen && (
        <Modal title="Solicitar cambio" onClose={() => setChangeOpen(false)}>
          <form className="space-y-4" onSubmit={requestChange}>
            <p className="text-sm text-muted">El profesor revisará tu solicitud. Si la aprueba, podrás editar y volver a firmar: se mantiene el nº de control {ownSubmission?.control_number} y pasa a la revisión {(ownSubmission?.revision ?? 0) + 1}.</p>
            <label className="field">¿Qué quieres cambiar y por qué?<textarea className={inputClass} rows="3" required maxLength={500} value={changeReason} onChange={(event) => setChangeReason(event.target.value)} /></label>
            <div className="flex justify-end gap-2"><button type="button" className="btn-secondary" onClick={() => setChangeOpen(false)}>Cancelar</button><button className={buttonClass} disabled={busy || !changeReason.trim()}>Enviar solicitud</button></div>
          </form>
        </Modal>
      )}

      {!isStudent && pendingRequests.length > 0 && (
        <section className="card border-warn/40 p-3">
          <h3 className="px-3 pb-1 pt-2 font-semibold text-warn">Solicitudes de cambio · {pendingRequests.length}</h3>
          <ul>
            {pendingRequests.map((request) => {
              const submission = submissions.find((item) => item.id === request.submission_id)
              return (
                <li key={request.id} className="flex flex-wrap items-center gap-3 rounded-xl px-3 py-3">
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium text-ink">{submission?.students?.name || 'Alumno'} <span className="text-xs font-normal text-muted">· {submission?.control_number} · rev {request.revision}</span></span>
                    <span className="block text-xs text-muted">«{request.reason}» · {new Date(request.requested_at).toLocaleString('es-ES')}</span>
                  </span>
                  <button className="btn-secondary h-8 px-3 text-xs" disabled={busy} onClick={() => resolveChange(request, false)}>Rechazar</button>
                  <button className="btn-primary h-8 px-3 text-xs" disabled={busy} onClick={() => resolveChange(request, true)}>Aprobar</button>
                </li>
              )
            })}
          </ul>
        </section>
      )}

      {!isStudent && completedSubmissions.length > 0 && (
        <section className="card p-3">
          <h3 className="px-3 pb-1 pt-2 font-semibold text-ink">Entregas · {completedSubmissions.length}</h3>
          <ul>
            {completedSubmissions.map((submission) => (
              <li key={submission.id} className="flex items-center gap-3 rounded-xl px-3 py-3">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-success-soft text-success"><Icon name="check" size={16} /></span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-ink">{submission.students?.name || 'Alumno'}</span>
                  <span className="block text-xs text-muted">{[submission.students?.student_number && `Nº ${submission.students.student_number}`, submission.students?.group_name].filter(Boolean).join(' · ')}{submission.students ? ' · ' : ''}Firmado {new Date(submission.signed_at).toLocaleString('es-ES')}</span>
                  <span className="block text-xs tabular-nums text-ink-soft">Nº de control {submission.control_number} · Revisión {submission.revision ?? 0}</span>
                </span>
                {submission.pdf_url && <a href={submission.pdf_url} target="_blank" rel="noopener noreferrer" className="link">Ver PDF</a>}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-ink">Defectos · {tlbDefects.length}</h3>
          {editable && <button className="btn-ghost min-h-[36px] text-accent" onClick={() => openDefectForm()}><Icon name="plus" size={16} />Añadir defecto</button>}
        </div>
        {tlbDefects.map((defect) => {
          const isActionHidden = hiddenActions[defect.id] || false
          return (
            <article key={defect.id} className="card p-5">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold text-ink">Defecto {defect.defect_number}</span>
                  {defect.ata && <span className="badge">{defect.ata}</span>}
                  {defect.pirep && <span className="badge">PIREP {defect.pirep}</span>}
                </div>
                {editable && <div className="-mr-1.5 flex text-muted">
                  <button className="rounded-lg p-1.5 hover:bg-subtle hover:text-ink" aria-label={`Editar defecto ${defect.defect_number}`} onClick={() => openDefectForm(defect)}><Icon name="edit" size={16} /></button>
                  <button className="rounded-lg p-1.5 hover:bg-danger-soft hover:text-danger" aria-label={`Eliminar defecto ${defect.defect_number}`} onClick={() => deleteDefect(defect)}><Icon name="trash" size={16} /></button>
                </div>}
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <p className="mb-1.5 text-xs font-medium text-muted">Descripción del defecto</p>
                  <p className="rounded-xl bg-warn-soft p-3.5 text-sm leading-relaxed text-ink-soft">{defect.defect_description}</p>
                </div>
                <div>
                  {isStudent ? (
                    <label className="block">
                      <span className="mb-1.5 block text-xs font-medium text-muted">Tu acción correctiva</span>
                      <textarea
                        className={`${inputClass} min-h-[96px] leading-relaxed`}
                        placeholder="Describe la acción que realizarías…"
                        value={studentResponses[defect.id] || ''}
                        onChange={(e) => updateStudentResponse(defect.id, e.target.value)}
                        disabled={delivered}
                      />
                    </label>
                  ) : (
                    <>
                      <div className="mb-1.5 flex items-center justify-between">
                        <p className="text-xs font-medium text-muted">Acción correctiva</p>
                        <button className="text-xs font-medium text-accent hover:text-accent-strong" onClick={() => toggleActionVisibility(defect.id)}>
                          {isActionHidden ? 'Mostrar' : 'Ocultar'}
                        </button>
                      </div>
                      {!isActionHidden
                        ? <p className="rounded-xl bg-success-soft p-3.5 text-sm leading-relaxed text-ink-soft">{defect.correct_action}</p>
                        : <p className="rounded-xl border border-dashed border-line-strong p-3.5 text-sm text-faint">Oculta para proyectar en clase</p>}
                    </>
                  )}
                </div>
              </div>
            </article>
          )
        })}
        {tlbDefects.length === 0 && <p className="card empty">No hay defectos registrados.</p>}
      </section>

      {selectedTLB.crs && <section className="card p-5"><h3 className="text-sm font-semibold text-ink">CRS · Certificate of Release to Service</h3><p className="mt-2 text-sm leading-relaxed text-ink-soft">{selectedTLB.crs}</p></section>}

      {editOpen && editingTLB && (
        <Modal title="Editar TLB" onClose={() => { setEditOpen(false); setEditingTLB(null) }}>
          <form className="space-y-4" onSubmit={saveEditTLB}>
            {tlbFormFields(editForm, setEditForm)}
            <fieldset>
              <legend className="mb-1.5 text-sm font-medium text-ink-soft">Profesores asignados</legend>
              <div className="max-h-52 space-y-1.5 overflow-y-auto">
                {teachers.length === 0 ? <p className="text-sm text-muted">No hay profesores registrados.</p> : teachers.map((teacher) => (
                  <label key={teacher.id} className="choice">
                    <input type="checkbox" checked={editForm.teacher_ids.includes(teacher.id)} onChange={() => toggleTeacher(teacher.id)} />
                    <span className="min-w-0"><span className="block text-sm font-medium text-ink">{teacher.name}</span>{teacher.email && <span className="block truncate text-xs text-muted">{teacher.email}</span>}</span>
                  </label>
                ))}
              </div>
              {editForm.teacher_ids.length === 0 && <p className="mt-1.5 text-xs text-danger">Selecciona al menos un profesor.</p>}
            </fieldset>
            <label className="field">CRS (Certificate of Release to Service)<textarea className={inputClass} rows="3" value={editForm.crs} onChange={(event) => setEditForm({ ...editForm, crs: event.target.value })} placeholder="Texto del certificado…" /></label>
            {formError}
            <div className="flex justify-end gap-2 pt-1">
              <button type="button" className="btn-secondary" onClick={() => { setEditOpen(false); setEditingTLB(null) }}>Cancelar</button>
              <button className={buttonClass} disabled={busy || editForm.teacher_ids.length === 0}>{busy ? 'Guardando…' : 'Guardar cambios'}</button>
            </div>
          </form>
        </Modal>
      )}

      {defectFormOpen && (
        <Modal title={editingDefect ? `Editar defecto ${editingDefect.defect_number}` : 'Añadir defecto'} onClose={() => setDefectFormOpen(false)}>
          <form className="space-y-4" onSubmit={saveDefect}>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="field">ATA<input className={inputClass} value={defectForm.ata} onChange={(event) => setDefectForm({ ...defectForm, ata: event.target.value })} required /></label>
              <label className="field">PIREP<input className={inputClass} value={defectForm.pirep} onChange={(event) => setDefectForm({ ...defectForm, pirep: event.target.value })} /></label>
            </div>
            <label className="field">Descripción<textarea className={inputClass} rows="3" value={defectForm.defect_description} onChange={(event) => setDefectForm({ ...defectForm, defect_description: event.target.value })} required /></label>
            <label className="field">Acción correctiva<textarea className={inputClass} rows="3" value={defectForm.correct_action} onChange={(event) => setDefectForm({ ...defectForm, correct_action: event.target.value })} required /></label>
            {formError}
            <div className="flex justify-end gap-2 pt-1"><button type="button" className="btn-secondary" onClick={() => setDefectFormOpen(false)}>Cancelar</button><button className={buttonClass} disabled={busy}>{busy ? 'Guardando…' : 'Guardar'}</button></div>
          </form>
        </Modal>
      )}
    </div>
  }

  const hasFilters = Boolean(filters.module || filters.practice || filters.date || filters.search)

  return <div className="space-y-5">
    {moduleId
      ? <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted">{isStudent ? 'Los TLB que tu profesor ha publicado.' : 'Publica un TLB para que lo vean tus alumnos.'}</p>
        {!isStudent && <button className={buttonClass} onClick={() => openCreate()}><Icon name="plus" size={16} />Nuevo TLB</button>}
      </div>
      : <div className="page-intro">
        <div><h2>{isStudent ? 'Mi Task Log Book' : 'Task Log Book'}</h2><p>{isStudent ? 'Los TLB que tu profesor ha publicado.' : 'Publica un TLB para que lo vean tus alumnos.'}</p></div>
        {!isStudent && <button className={buttonClass} onClick={() => openCreate()}><Icon name="plus" size={16} />Nuevo TLB</button>}
      </div>}
    <section className={`grid gap-2 ${moduleId ? 'md:grid-cols-[2fr_1fr_1fr]' : 'md:grid-cols-[2fr_1fr_1fr_1fr]'}`}>
      <div className="relative"><Icon name="search" size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" /><input className={`${inputClass} pl-9`} placeholder="Buscar matrícula, práctica o profesor…" value={filters.search} onChange={(event) => setFilters({ ...filters, search: event.target.value })} /></div>
      {!moduleId && <select className={inputClass} value={filters.module} onChange={(event) => setFilters({ ...filters, module: event.target.value })}><option value="">Todos los módulos</option>{availableModules.map((id) => <option key={id} value={id}>{id} · {getModule(id)?.name || ''}</option>)}</select>}
      <select className={inputClass} value={filters.practice} onChange={(event) => setFilters({ ...filters, practice: event.target.value })}><option value="">Todas las prácticas</option>{availablePracticesFilter.map((id) => <option key={id} value={id}>{id} · {getPractice(id)?.title || ''}</option>)}</select>
      <select className={inputClass} value={filters.date} onChange={(event) => setFilters({ ...filters, date: event.target.value })}><option value="">Todas las fechas</option>{availableDates.map((date) => <option key={date} value={date}>{formatDate(date)}</option>)}</select>
    </section>
    {!createOpen && pageNotice}

    <div className="space-y-2">{filteredTLBs.map((tlb) => {
      const practice = getPractice(tlb.practice_id)
      const editable = editableTLB(tlb)
      const tlbDefects = getDefects(tlb.id)
      const completedCount = submissions.filter((s) => s.tlb_id === tlb.id && s.signed_at).length

      return <article key={tlb.id} className="card group flex items-center gap-3 p-2 pr-3 transition-shadow hover:shadow-lift">
        <button className="flex min-w-0 flex-1 items-center gap-4 rounded-xl p-2 text-left" onClick={() => { setSelectedTLBId(tlb.id); setMessage('') }}>
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-subtle text-muted"><Icon name="clipboard" /></span>
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium text-ink">{practice ? practice.title : `Práctica ${tlb.practice_id}`}</span>
            <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
              {!moduleId && <span className="badge py-0">{tlb.module_id}</span>}
              <span>{tlb.aircraft} · {tlb.registration}</span>
              <span>· {formatDate(tlb.date)}</span>
              <span>· {tlbDefects.length} {tlbDefects.length === 1 ? 'defecto' : 'defectos'}</span>
              {!isStudent && completedCount > 0 && <span className="text-success">· {completedCount} {completedCount === 1 ? 'entrega' : 'entregas'}</span>}
            </span>
          </span>
        </button>
        {!isStudent && (editable
          ? <button className={`badge shrink-0 py-1 ${tlb.published ? 'bg-success-soft text-success' : 'bg-warn-soft text-warn'} hover:opacity-80`} title={tlb.published ? 'Pulsa para despublicar' : 'Pulsa para publicar'} disabled={busy} onClick={() => togglePublish(tlb)}>{tlb.published ? 'Publicado' : 'Borrador'}</button>
          : <span className={`badge shrink-0 py-1 ${tlb.published ? 'bg-success-soft text-success' : 'bg-warn-soft text-warn'}`}>{tlb.published ? 'Publicado' : 'Borrador'}</span>)}
        <Icon name="next" size={16} className="hidden text-faint group-hover:text-accent sm:block" />
      </article>
    })}</div>
    {filteredTLBs.length === 0 && <div className="card empty">{hasFilters ? 'No hay TLB que coincidan con los filtros.' : isStudent ? 'Todavía no hay TLB publicados para ti.' : 'Aún no hay TLB. Crea el primero.'}</div>}

    {createOpen && (
      <Modal title="Nuevo TLB" onClose={() => setCreateOpen(false)}>
        <form className="space-y-4" onSubmit={createTLB}>
          {tlbFormFields(newTLB, setNewTLB)}
          <label className="field">Defecto inicial<textarea className={inputClass} rows="3" value={newTLB.defect_description} onChange={(event) => setNewTLB({ ...newTLB, defect_description: event.target.value })} required /></label>
          <label className="field">Acción correctiva inicial<textarea className={inputClass} rows="3" value={newTLB.correct_action} onChange={(event) => setNewTLB({ ...newTLB, correct_action: event.target.value })} required /></label>
          {formError}
          <div className="flex justify-end gap-2 pt-1"><button type="button" className="btn-secondary" onClick={() => setCreateOpen(false)}>Cancelar</button><button className={buttonClass} disabled={busy}>{busy ? 'Creando…' : 'Crear TLB'}</button></div>
        </form>
      </Modal>
    )}
  </div>
}
