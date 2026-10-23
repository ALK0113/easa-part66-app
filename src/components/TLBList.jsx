import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { getSupabaseErrorMessage } from '../lib/supabaseErrors.js'
import { subscribeToTables } from '../lib/supabaseRealtime.js'
import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import emailjs from '@emailjs/browser'

// ⚙️ CONFIGURACIÓN DE EMAILJS CON TUS CLAVES REALES
const EMAILJS_CONFIG = {
  serviceId: 'service_x223chc',
  templateId: 'template_bsfqabf',
  publicKey: 'L1mQ2kzKhmBsUZ5bq',
  teacherEmail: 'arafatlaarajb1@gmail.com' // Correo de respaldo por si no encuentra el del profesor
};

const inputClass = 'w-full rounded border border-[#d1d5db] px-3 py-2 text-sm focus:border-[#1e88e5]'
const buttonClass = 'rounded bg-[#1e88e5] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1565c0] disabled:opacity-50'

function formatDate(value) {
  if (!value) return '—'
  const [year, month, day] = value.slice(0, 10).split('-')
  return `${day}/${month}/${year}`
}

export default function TLBList({ user, initialTlbId = null, onClearInitialTlb }) {
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
  const [submissions, setSubmissions] = useState([])
  const [hiddenActions, setHiddenActions] = useState({})

  const userRole = user.role

  useEffect(() => {
    let cancelled = false
    async function load() {
      const [tlbResult, practiceResult, defectResult, moduleResult, aircraftResult, teacherResult, profilesResult] = await Promise.all([
        supabase.from('tlbs').select('*').order('date', { ascending: false }),
        supabase.from('practices').select('id,title,module_id,ata'),
        supabase.from('defects').select('*').order('defect_number', { ascending: true }),
        supabase.from('modules').select('id,name'),
        supabase.from('aircraft').select('id,type,registration,msn'),
        userRole === 'profesor'
          ? supabase.from('teacher_modules').select('module_id').eq('profile_id', user.id)
          : Promise.resolve({ data: [], error: null }),
        supabase.from('profiles').select('id,full_name,email').eq('role', 'profesor').order('full_name', { ascending: true }),
      ])
      if (cancelled) return
      const failure = tlbResult.error || practiceResult.error || defectResult.error || moduleResult.error || aircraftResult.error || teacherResult.error || profilesResult.error
      if (failure) setError(failure.message)
      else {
        setTlbs(tlbResult.data || [])
        setPractices(practiceResult.data || [])
        setDefects(defectResult.data || [])
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
    const unsubscribe = subscribeToTables(['tlbs', 'practices', 'defects', 'modules', 'aircraft', 'teacher_modules', 'profiles'], load, 'tlb-list')
    return () => { cancelled = true; unsubscribe() }
  }, [user.id, userRole])

  useEffect(() => {
    async function loadStudentData() {
      if (userRole !== 'alumno' || !selectedTLBId) return
      const { data: submission, error } = await supabase
        .from('tlb_submissions')
        .select('*')
        .eq('student_id', user.id)
        .eq('tlb_id', selectedTLBId)
        .maybeSingle()
      if (submission) {
        setStudentResponses(submission.defect_responses || {})
      } else {
        setStudentResponses({})
      }
    }
    loadStudentData()
  }, [selectedTLBId, userRole, user.id])

  useEffect(() => {
    async function loadSubmissions() {
      if (userRole !== 'profesor' && userRole !== 'admin') return
      const { data, error } = await supabase
        .from('tlb_submissions')
        .select('*, students!inner(name, student_number, group_name)')
        .order('completed_at', { ascending: false })
      if (!error && data) {
        setSubmissions(data)
      }
    }
    loadSubmissions()
  }, [userRole, selectedTLBId])

  const isStudent = userRole === 'alumno'
  const selectedTLB = tlbs.find((item) => item.id === selectedTLBId)
    || tlbs.find((item) => item.id === initialTlbId)
    || null
  const editableModules = userRole === 'admin' ? modules.map((module) => module.id) : teacherModules
  const editableTLB = (tlb) => userRole === 'admin' || (userRole === 'profesor' && teacherModules.includes(tlb.module_id))
  const getPractice = (id) => practices.find((practice) => practice.id === id)
  const getModule = (id) => modules.find((module) => module.id === id)
  const getDefects = (id) => defects.filter((defect) => defect.tlb_id === id).sort((a, b) => a.defect_number - b.defect_number)
  const availablePractices = practices.filter((practice) => practice.module_id === (editForm.module_id || newTLB.module_id))
  const availableModules = [...new Set(tlbs.map((tlb) => tlb.module_id))]
  const availablePracticesFilter = [...new Set(tlbs.map((tlb) => tlb.practice_id))]
  const availableDates = [...new Set(tlbs.map((tlb) => tlb.date))].sort().reverse()

  const filteredTLBs = tlbs.filter((tlb) => {
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
    setStudentResponses(prev => ({ ...prev, [defectId]: value }))
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
    doc.text('EASA PART 66 · TASK LOG BOOK', margin, 17)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    doc.setTextColor(100, 110, 120)

    const subtitle = isStudentVersion
      ? `Entrega del alumno: ${user.name}`
      : `Informe oficial del TLB`
    doc.text(subtitle, margin, 23)
    doc.text(`Generado: ${new Date().toLocaleString('es-ES')}`, margin, 28)

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
      doc.text(`EASA Part 66 · TLB ${selectedTLB.id} · ${page}/${pageCount}`, pageWidth - margin, doc.internal.pageSize.getHeight() - 8, { align: 'right' })
    }

    return doc
  }

  async function generateStudentPdf() {
    if (!selectedTLB) return
    const tlbDefects = getDefects(selectedTLB.id)
    const allAnswered = tlbDefects.every(defect => studentResponses[defect.id]?.trim())

    if (!allAnswered) {
      setMessage('⚠️ Debes completar todas las acciones antes de generar el PDF.')
      return
    }

    const studentEmail = user.email

    if (!studentEmail) {
      setMessage('ℹ️ No tienes un correo registrado en tu perfil. El PDF se descargará. Por favor, envíalo manualmente a tu profesor.')
      const doc = buildTlbPdf(tlbDefects, studentResponses, true)
      doc.save(`TLB_${selectedTLB.id}_${user.name.replace(/\s+/g, '_')}.pdf`)
      return
    }

    setPdfBusy(true)
    setMessage('📧 Buscando correo del profesor y generando PDF...')

    try {
      // 🆕 LÓGICA PARA ENCONTRAR EL CORREO DEL PROFESOR ASIGNADO
      const assignedTeacherNames = selectedTLB.teacher_name 
        ? selectedTLB.teacher_name.split(',').map(n => n.trim()) 
        : []
      
      const assignedTeacherEmails = teachers
        .filter(t => assignedTeacherNames.includes(t.name) && t.email)
        .map(t => t.email)
        .join(', ')

      // Usamos el correo encontrado, o el de respaldo si no se encontró ninguno
      const targetEmail = assignedTeacherEmails || EMAILJS_CONFIG.teacherEmail

      if (!targetEmail || targetEmail === 'respaldo@escuela.com') {
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
        to_email: targetEmail, // 📧 Se envía dinámicamente al profesor asignado
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
      correct_action: defectForm.correct_action.trim(),
    }
    if (editingDefect) {
      const { data, error: updateError } = await supabase.from('defects').update(content).eq('id', editingDefect.id).select().single()
      setBusy(false)
      if (updateError) { setMessage(getSupabaseErrorMessage(updateError)); return }
      setDefects((current) => current.map((item) => item.id === data.id ? data : item))
    } else {
      const { data: defectId, error: insertError } = await supabase.rpc('add_defect_to_tlb', {
        p_tlb_id: selectedTLB.id,
        p_defect_number: getDefects(selectedTLB.id).length + 1,
        p_ata: content.ata,
        p_pirep: content.pirep,
        p_defect_description: content.defect_description,
        p_correct_action: content.correct_action,
      })
      if (insertError) { setBusy(false); setMessage(getSupabaseErrorMessage(insertError)); return }
      const { data, error: fetchError } = await supabase.from('defects').select('*').eq('id', defectId).single()
      setBusy(false)
      if (fetchError) { setMessage(getSupabaseErrorMessage(fetchError)); return }
      setDefects((current) => [...current, data])
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
        next.push(data)
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

  if (loading) return <div className="flex min-h-[40vh] items-center justify-center text-[#0a2540]">Cargando Task Log Book…</div>
  if (error) return <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-5 text-sm text-red-800">Error al cargar TLB: {error}</div>

  if (selectedTLB) {
    const practice = getPractice(selectedTLB.practice_id)
    const module = getModule(selectedTLB.module_id)
    const tlbDefects = getDefects(selectedTLB.id)
    const editable = editableTLB(selectedTLB)

    const studentSubmission = submissions.find(s =>
      s.student_id === user.id && s.tlb_id === selectedTLB.id
    )

    return <div className="space-y-5">
      <button className="text-sm font-semibold text-[#1565c0]" onClick={() => { setSelectedTLBId(null); onClearInitialTlb?.(); setMessage('') }}>← Volver al TLB</button>
      <section className="rounded-lg bg-gradient-to-r from-[#0a2540] to-[#1e88e5] p-6 text-white shadow-sm">
        <h2 className="text-2xl font-bold">✈️ {selectedTLB.aircraft}</h2>
        <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">{[['Matrícula', selectedTLB.registration], ['MSN', selectedTLB.msn], ['Módulo', module?.id], ['Práctica', practice?.id], ['Fecha', formatDate(selectedTLB.date)], ['Profesor(es)', selectedTLB.teacher_name], ['Estado', selectedTLB.published ? 'Publicado' : 'Pendiente']].map(([label, value]) => <div key={label} className="rounded bg-white/15 p-3"><p className="text-[10px] uppercase text-blue-100">{label}</p><p className="mt-1 text-sm font-semibold">{value || '—'}</p></div>)}</div>
      </section>

      {!isStudent && submissions.length > 0 && (
        <section className="rounded-lg border border-[#e5e7eb] bg-white p-5">
          <h3 className="mb-3 text-sm font-bold text-[#0a2540]">Alumnos que han completado este TLB</h3>
          <div className="space-y-2">
            {submissions
              .filter(s => s.tlb_id === selectedTLB.id)
              .map(submission => (
                <div key={submission.id} className="flex items-center justify-between rounded border border-[#e5e7eb] p-3">
                  <div>
                    <p className="font-semibold text-sm">{submission.students?.name || 'Alumno'}</p>
                    <p className="text-xs text-[#6b7280]">Nº: {submission.students?.student_number} · Grupo: {submission.students?.group_name}</p>
                    <p className="text-xs text-[#6b7280]">Completado: {new Date(submission.completed_at).toLocaleString('es-ES')}</p>
                  </div>
                  {submission.pdf_url && (
                    <a
                      href={submission.pdf_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="rounded bg-[#1e88e5] px-3 py-2 text-xs font-semibold text-white hover:bg-[#1565c0]"
                    >
                      Ver PDF
                    </a>
                  )}
                </div>
              ))}
          </div>
        </section>
      )}

      <section className="rounded-lg border border-[#e5e7eb] bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#e5e7eb] p-4">
          <h3 className="font-bold text-[#0a2540]">Defectos ({tlbDefects.length})</h3>
          <div className="flex flex-wrap gap-2">
            {isStudent && (
              <button
                className="rounded bg-[#2e7d32] px-3 py-2 text-xs font-bold text-white hover:bg-[#1b5e20] disabled:opacity-50"
                disabled={pdfBusy}
                onClick={generateStudentPdf}
              >
                {pdfBusy ? 'Generando…' : '✓ Generar PDF y enviar'}
              </button>
            )}
            <button className="rounded border border-[#d1d5db] bg-white px-3 py-2 text-xs font-semibold text-[#0a2540] hover:bg-[#f4f6f9] disabled:opacity-50" disabled={pdfBusy} onClick={() => {
              setMessage('Función de descarga de PDF para profesor en desarrollo')
            }}>
              ↓ Descargar informe PDF
            </button>
            {editable && (
              <>
                <button className="rounded bg-[#1e88e5] px-3 py-2 text-xs font-bold text-white hover:bg-[#1565c0]" onClick={() => openEditForm(selectedTLB)}>
                  ✏️ Editar TLB
                </button>
                <button className={`rounded border px-3 py-2 text-xs font-bold ${selectedTLB.published ? 'border-green-200 bg-green-50 text-green-800' : 'border-amber-200 bg-amber-50 text-amber-900'}`} disabled={busy} onClick={() => togglePublish(selectedTLB)}>
                  {selectedTLB.published ? 'Publicado · Despublicar' : 'Pendiente · Publicar'}
                </button>
                <button className={buttonClass} onClick={() => openDefectForm()}>+ Añadir defecto</button>
              </>
            )}
          </div>
        </div>
        {message && <p role="status" className="m-4 rounded bg-blue-50 p-3 text-sm text-blue-900">{message}</p>}
        <div className="space-y-3 p-4">
          {tlbDefects.map((defect) => {
            const isActionHidden = hiddenActions[defect.id] || false

            return (
              <article key={defect.id} className="rounded-md border border-[#e5e7eb] border-l-4 border-l-[#ef6c00] p-4">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <strong className="text-sm text-[#0a2540]">DEFECT #{defect.defect_number}</strong>
                    <span className="rounded bg-[#d1ecf1] px-2 py-1 text-xs text-[#0c5460]">{defect.ata}</span>
                    {defect.pirep && <span className="rounded bg-blue-100 px-2 py-1 text-xs text-blue-900">PIREP: {defect.pirep}</span>}
                  </div>
                  {editable && <div className="flex gap-3 text-xs font-semibold">
                    <button className="text-[#1565c0]" onClick={() => openDefectForm(defect)}>Editar</button>
                    <button className="text-red-700" onClick={() => deleteDefect(defect)}>Eliminar</button>
                  </div>}
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  <div>
                    <p className="mb-1 text-[10px] font-bold uppercase text-[#6b7280]">Descripción del defecto</p>
                    <p className="rounded border-l-4 border-[#ef6c00] bg-[#fff8e1] p-3 text-sm leading-relaxed">{defect.defect_description}</p>
                  </div>

                  <div>
                    {isStudent ? (
                      <>
                        <p className="mb-1 text-[10px] font-bold uppercase text-[#6b7280]">Tu acción correctiva</p>
                        <textarea
                          className={`${inputClass} min-h-[80px]`}
                          placeholder="Describe la acción correctiva que realizarías..."
                          value={studentResponses[defect.id] || ''}
                          onChange={(e) => updateStudentResponse(defect.id, e.target.value)}
                          disabled={!!studentSubmission}
                        />
                        {studentSubmission && (
                          <p className="mt-1 text-xs text-[#2e7d32]">✓ Ya completado</p>
                        )}
                      </>
                    ) : (
                      <>
                        <div className="mb-1 flex items-center justify-between">
                          <p className="text-[10px] font-bold uppercase text-[#6b7280]">Acción correctiva</p>
                          <button
                            className="text-xs text-[#1e88e5] hover:underline"
                            onClick={() => toggleActionVisibility(defect.id)}
                          >
                            {isActionHidden ? '👁️ Mostrar' : '🙈 Ocultar'}
                          </button>
                        </div>
                        {!isActionHidden ? (
                          <p className="rounded border-l-4 border-[#2e7d32] bg-[#e8f5e9] p-3 text-sm leading-relaxed">{defect.correct_action}</p>
                        ) : (
                          <p className="rounded border border-dashed border-[#d1d5db] bg-[#f9fafb] p-3 text-sm text-[#6b7280] italic">
                            Acción oculta - Haz clic en "Mostrar" para verla
                          </p>
                        )}
                      </>
                    )}
                  </div>
                </div>
              </article>
            )
          })}
          {tlbDefects.length === 0 && <p className="p-8 text-center text-sm text-[#6b7280]">No hay defectos registrados.</p>}
        </div>
      </section>
      {selectedTLB.crs && <section className="rounded-lg border-l-4 border-[#2e7d32] bg-[#e8f5e9] p-5"><h3 className="text-sm font-bold text-[#2e7d32]">CRS · Certificate of Release to Service</h3><p className="mt-2 text-sm leading-relaxed">{selectedTLB.crs}</p></section>}

      {editOpen && editingTLB && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) setEditOpen(false) }}>
          <section role="dialog" aria-modal="true" aria-label="Editar TLB" className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-lg bg-white p-5 shadow-2xl">
            <h2 className="mb-4 text-lg font-bold text-[#0a2540]">Editar TLB {editingTLB.id}</h2>
            <form className="space-y-4" onSubmit={saveEditTLB}>
              <label className="grid gap-1 text-sm font-semibold text-[#0a2540]">
                Módulo
                <select className={inputClass} value={editForm.module_id} onChange={(event) => setEditForm({ ...editForm, module_id: event.target.value, practice_id: '' })} required>
                  <option value="">Selecciona módulo</option>
                  {modules.filter((module) => editableModules.includes(module.id)).map((module) => (
                    <option key={module.id} value={module.id}>{module.id} · {module.name}</option>
                  ))}
                </select>
              </label>

              <label className="grid gap-1 text-sm font-semibold text-[#0a2540]">
                Práctica
                <select className={inputClass} value={editForm.practice_id} onChange={(event) => setEditForm({ ...editForm, practice_id: event.target.value })} required>
                  <option value="">Selecciona práctica</option>
                  {availablePractices.map((practice) => (
                    <option key={practice.id} value={practice.id}>{practice.id} · {practice.title}</option>
                  ))}
                </select>
              </label>

              <label className="grid gap-1 text-sm font-semibold text-[#0a2540]">
                Avión
                <select className={inputClass} value={editForm.aircraft_id} onChange={(event) => setEditForm({ ...editForm, aircraft_id: event.target.value })} required>
                  <option value="">Selecciona avión</option>
                  {aircraft.map((plane) => (
                    <option key={plane.id} value={plane.id}>{plane.type} · {plane.registration} · MSN {plane.msn}</option>
                  ))}
                </select>
              </label>

              <label className="grid gap-1 text-sm font-semibold text-[#0a2540]">
                Fecha
                <input className={inputClass} type="date" value={editForm.date} onChange={(event) => setEditForm({ ...editForm, date: event.target.value })} required />
              </label>

              <div className="grid gap-1">
                <p className="text-sm font-semibold text-[#0a2540]">Profesores asignados ({editForm.teacher_ids.length} seleccionados)</p>
                <div className="max-h-48 overflow-y-auto rounded border border-[#d1d5db] p-3 space-y-2">
                  {teachers.length === 0 ? (
                    <p className="text-sm text-[#6b7280]">No hay profesores registrados.</p>
                  ) : (
                    teachers.map((teacher) => (
                      <label key={teacher.id} className="flex items-center gap-2 cursor-pointer hover:bg-[#f9fafb] p-1 rounded">
                        <input
                          type="checkbox"
                          checked={editForm.teacher_ids.includes(teacher.id)}
                          onChange={() => toggleTeacher(teacher.id)}
                          className="h-4 w-4 rounded border-[#d1d5db] text-[#1e88e5] focus:ring-[#1e88e5]"
                        />
                        <div className="flex-1">
                          <p className="text-sm font-medium text-[#0a2540]">{teacher.name}</p>
                          {teacher.email && <p className="text-xs text-[#6b7280]">{teacher.email}</p>}
                        </div>
                      </label>
                    ))
                  )}
                </div>
                {editForm.teacher_ids.length === 0 && (
                  <p className="text-xs text-red-600">⚠️ Selecciona al menos un profesor</p>
                )}
              </div>

              <label className="grid gap-1 text-sm font-semibold text-[#0a2540]">
                CRS (Certificate of Release to Service)
                <textarea className={inputClass} rows="3" value={editForm.crs} onChange={(event) => setEditForm({ ...editForm, crs: event.target.value })} placeholder="Texto del certificado..." />
              </label>

              {message && <p role="alert" className="rounded bg-red-50 p-3 text-sm text-red-800">{message}</p>}

              <div className="flex justify-end gap-2">
                <button type="button" className="rounded border border-[#d1d5db] px-4 py-2 text-sm" onClick={() => { setEditOpen(false); setEditingTLB(null) }}>
                  Cancelar
                </button>
                <button className={buttonClass} disabled={busy || editForm.teacher_ids.length === 0}>
                  {busy ? 'Guardando…' : 'Guardar cambios'}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}

      {defectFormOpen && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) setDefectFormOpen(false) }}><section role="dialog" aria-modal="true" aria-label={editingDefect ? 'Editar defecto' : 'Añadir defecto'} className="w-full max-w-xl rounded-lg bg-white p-5 shadow-2xl"><h3 className="mb-4 text-lg font-bold text-[#0a2540]">{editingDefect ? 'Editar defecto' : 'Añadir defecto'}</h3><form className="space-y-4" onSubmit={saveDefect}>
        <div className="grid gap-3 sm:grid-cols-2"><label className="grid gap-1 text-sm font-semibold text-[#0a2540]">ATA<input className={inputClass} value={defectForm.ata} onChange={(event) => setDefectForm({ ...defectForm, ata: event.target.value })} required /></label><label className="grid gap-1 text-sm font-semibold text-[#0a2540]">PIREP<input className={inputClass} value={defectForm.pirep} onChange={(event) => setDefectForm({ ...defectForm, pirep: event.target.value })} /></label></div>
        <label className="grid gap-1 text-sm font-semibold text-[#0a2540]">Descripción<textarea className={inputClass} rows="3" value={defectForm.defect_description} onChange={(event) => setDefectForm({ ...defectForm, defect_description: event.target.value })} required /></label>
        <label className="grid gap-1 text-sm font-semibold text-[#0a2540]">Acción correctiva<textarea className={inputClass} rows="3" value={defectForm.correct_action} onChange={(event) => setDefectForm({ ...defectForm, correct_action: event.target.value })} required /></label>
        {message && <p role="alert" className="rounded bg-red-50 p-3 text-sm text-red-800">{message}</p>}
        <div className="flex justify-end gap-2"><button type="button" className="rounded border border-[#d1d5db] px-4 py-2 text-sm" onClick={() => setDefectFormOpen(false)}>Cancelar</button><button className={buttonClass} disabled={busy}>{busy ? 'Guardando…' : 'Guardar'}</button></div>
      </form></section></div>}
    </div>
  }

  return <div className="space-y-4">
    <section className="rounded-lg border border-[#e5e7eb] bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-lg font-bold text-[#0a2540]">Task Log Book ({filteredTLBs.length})</h2><p className="mt-1 text-sm text-[#6b7280]">{isStudent ? 'Solo se muestran TLB publicados y autorizados.' : 'Publica un TLB para habilitar su consulta a los alumnos.'}</p></div>{!isStudent && <button className={buttonClass} onClick={() => { setNewTLB({ module_id: editableModules[0] || '', practice_id: '', aircraft_id: '', date: new Date().toISOString().slice(0, 10), defect_description: '', correct_action: '' }); setCreateOpen(true) }}>+ Nuevo TLB</button>}</div>
      <div className="mt-4 grid gap-3 md:grid-cols-4"><select className={inputClass} value={filters.module} onChange={(event) => setFilters({ ...filters, module: event.target.value })}><option value="">Todos los módulos</option>{availableModules.map((id) => <option key={id} value={id}>{id} · {getModule(id)?.name || ''}</option>)}</select><select className={inputClass} value={filters.practice} onChange={(event) => setFilters({ ...filters, practice: event.target.value })}><option value="">Todas las prácticas</option>{availablePracticesFilter.map((id) => <option key={id} value={id}>{id} · {getPractice(id)?.title || ''}</option>)}</select><select className={inputClass} value={filters.date} onChange={(event) => setFilters({ ...filters, date: event.target.value })}><option value="">Todas las fechas</option>{availableDates.map((date) => <option key={date} value={date}>{formatDate(date)}</option>)}</select><input className={inputClass} placeholder="Buscar matrícula, práctica o profesor…" value={filters.search} onChange={(event) => setFilters({ ...filters, search: event.target.value })} /></div>
      {message && <p role="status" className="mt-3 rounded bg-blue-50 p-3 text-sm text-blue-900">{message}</p>}
    </section>

    <div className="space-y-3">{filteredTLBs.map((tlb) => {
      const practice = getPractice(tlb.practice_id)
      const editable = editableTLB(tlb)
      const tlbDefects = getDefects(tlb.id)
      const completedCount = submissions.filter(s => s.tlb_id === tlb.id).length

      return <article key={tlb.id} className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-[#e5e7eb] border-l-4 border-l-[#1e88e5] bg-white p-4 shadow-sm transition hover:border-l-[#ffb300] hover:shadow-md">
        <button className="min-w-0 flex-1 text-left" onClick={() => { setSelectedTLBId(tlb.id); setMessage('') }}><h3 className="font-bold text-[#0a2540]">{practice ? `${practice.id} · ${practice.title}` : `Práctica ${tlb.practice_id}`}</h3><div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[#6b7280]"><span>✈️ {tlb.aircraft} ({tlb.registration})</span><span> {tlb.module_id}</span><span>📅 {formatDate(tlb.date)}</span><span>📝 {tlbDefects.length} defectos</span>{tlb.teacher_name && <span>👨‍🏫 {tlb.teacher_name}</span>}
          {!isStudent && completedCount > 0 && (
            <span className="rounded-full bg-[#2e7d32] px-2 py-1 text-xs font-bold text-white">
              ✓ {completedCount} alumno{completedCount !== 1 ? 's' : ''}
            </span>
          )}
        </div></button>
        <div className="flex items-center gap-2">{tlb.published ? <span className="rounded bg-[#d4edda] px-3 py-1 text-xs font-semibold text-[#155724]">Publicado</span> : <span className="rounded bg-[#fff3cd] px-3 py-1 text-xs font-semibold text-[#856404]">Pendiente</span>}{editable && <button className="rounded border border-[#d1d5db] px-3 py-2 text-xs font-semibold" disabled={busy} onClick={() => togglePublish(tlb)}>{tlb.published ? 'Despublicar' : 'Publicar'}</button>}<button className="px-2 text-xl text-[#6b7280]" aria-label="Abrir TLB" onClick={() => setSelectedTLBId(tlb.id)}>→</button></div>
      </article>
    })}</div>
    {filteredTLBs.length === 0 && <div className="rounded-lg border border-dashed border-[#d1d5db] p-10 text-center text-sm text-[#6b7280]">No hay TLB que coincidan con los filtros.</div>}

    {createOpen && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) setCreateOpen(false) }}><section role="dialog" aria-modal="true" aria-label="Crear TLB" className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-lg bg-white p-5 shadow-2xl"><h2 className="mb-4 text-lg font-bold text-[#0a2540]">Crear nuevo TLB</h2><form className="space-y-4" onSubmit={createTLB}>
      <label className="grid gap-1 text-sm font-semibold text-[#0a2540]">Módulo<select className={inputClass} value={newTLB.module_id} onChange={(event) => setNewTLB({ ...newTLB, module_id: event.target.value, practice_id: '' })} required><option value="">Selecciona módulo</option>{modules.filter((module) => editableModules.includes(module.id)).map((module) => <option key={module.id} value={module.id}>{module.id} · {module.name}</option>)}</select></label>
      <label className="grid gap-1 text-sm font-semibold text-[#0a2540]">Práctica<select className={inputClass} value={newTLB.practice_id} onChange={(event) => setNewTLB({ ...newTLB, practice_id: event.target.value })} required><option value="">Selecciona práctica</option>{availablePractices.map((practice) => <option key={practice.id} value={practice.id}>{practice.id} · {practice.title}</option>)}</select></label>
      <label className="grid gap-1 text-sm font-semibold text-[#0a2540]">Avión<select className={inputClass} value={newTLB.aircraft_id} onChange={(event) => setNewTLB({ ...newTLB, aircraft_id: event.target.value })} required><option value="">Selecciona avión</option>{aircraft.map((plane) => <option key={plane.id} value={plane.id}>{plane.type} · {plane.registration} · MSN {plane.msn}</option>)}</select></label>
      <label className="grid gap-1 text-sm font-semibold text-[#0a2540]">Fecha<input className={inputClass} type="date" value={newTLB.date} onChange={(event) => setNewTLB({ ...newTLB, date: event.target.value })} required /></label>
      <label className="grid gap-1 text-sm font-semibold text-[#0a2540]">Defecto inicial<textarea className={inputClass} rows="3" value={newTLB.defect_description} onChange={(event) => setNewTLB({ ...newTLB, defect_description: event.target.value })} required /></label>
      <label className="grid gap-1 text-sm font-semibold text-[#0a2540]">Acción correctiva inicial<textarea className={inputClass} rows="3" value={newTLB.correct_action} onChange={(event) => setNewTLB({ ...newTLB, correct_action: event.target.value })} required /></label>
      {message && <p role="alert" className="rounded bg-red-50 p-3 text-sm text-red-800">{message}</p>}
      <div className="flex justify-end gap-2"><button type="button" className="rounded border border-[#d1d5db] px-4 py-2 text-sm" onClick={() => setCreateOpen(false)}>Cancelar</button><button className={buttonClass} disabled={busy}>{busy ? 'Guardando…' : 'Crear TLB'}</button></div>
    </form></section></div>}
  </div>
}