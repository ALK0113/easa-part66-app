import { supabase } from './supabase.js'
import { pendingModules } from './studentData.js'

// Boletines y hojas de notas en PDF.
// - Hoja de una asignatura (módulo + grupo + evaluación): la saca el profesor de sus clases.
// - Boletín de un alumno (todas sus asignaturas): lo saca la gestión, de uno o de todo un grupo.
// La «Final» no es una evaluación guardada: es el curso entero y usa la nota final de cada módulo.

export const FINAL = 'final'
export const KIND_SHORT = { teoria: 'Teoría', practica: 'Práctica' }
const STATUS_TEXT = { aprobado: 'Aprobado', suspendido: 'Suspendido', cursando: 'Pendiente', convalidado: 'Convalidado', exento: 'Exento', baja: 'No cursa' }
const PAGE_SIZE = 1000
const ID_CHUNK = 80

const fmtDate = (iso) => (iso ? new Date(`${String(iso).slice(0, 10)}T00:00`).toLocaleDateString('es-ES') : '')
const num = (value) => String(Number(value)).replace('.', ',')
const chunks = (list, size) => Array.from({ length: Math.ceil(list.length / size) }, (_, index) => list.slice(index * size, (index + 1) * size))

// Lee todas las páginas de una consulta (PostgREST devuelve como mucho 1000 filas)
async function readAll(build) {
  const rows = []
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await build().range(from, from + PAGE_SIZE - 1)
    if (error) throw error
    rows.push(...(data || []))
    if (!data || data.length < PAGE_SIZE) return rows
  }
}

// Consulta por lotes de alumnos para no pasar URLs enormes
async function readByStudents(ids, build) {
  const parts = await Promise.all(chunks(ids, ID_CHUNK).map((part) => readAll(() => build(part))))
  return parts.flat()
}

// Periodo elegido: evaluación guardada o la final (curso entero)
export function periodInfo(period, year) {
  if (!period || period === FINAL) return { id: FINAL, name: 'Evaluación final', from: year?.starts_on, to: year?.ends_on }
  return { id: period.id, name: period.name, from: period.starts_on, to: period.ends_on }
}

// Nota del periodo de una matrícula (con el módulo y la escala de la escuela)
export function gradeFor(enrollment, periodId, scale) {
  const practice = enrollment.degree_modules?.kind === 'practica'
  if (['convalidado', 'exento', 'baja'].includes(enrollment.status)) {
    return { value: '', status: STATUS_TEXT[enrollment.status], comment: periodId === FINAL ? enrollment.grade_comment : '' }
  }
  if (periodId === FINAL) {
    const value = practice
      ? ({ apto: 'Apto', no_apto: 'No apto' }[enrollment.practical_result] || '')
      : (enrollment.theory_grade != null ? num(enrollment.theory_grade) : '')
    return { value, status: STATUS_TEXT[enrollment.status] || 'Pendiente', comment: enrollment.grade_comment || '' }
  }
  const row = (enrollment.period_grades || []).find((item) => item.period_id === periodId)
  if (!row) return { value: '', status: 'Sin nota', comment: '' }
  if (practice) {
    return { value: row.practical_result === 'apto' ? 'Apto' : row.practical_result === 'no_apto' ? 'No apto' : '', status: row.practical_result === 'apto' ? 'Aprobado' : row.practical_result ? 'Suspendido' : 'Sin nota', comment: row.comment || '' }
  }
  if (row.theory_grade == null) return { value: '', status: 'Sin nota', comment: row.comment || '' }
  return { value: num(row.theory_grade), status: Number(row.theory_grade) >= Number(scale.pass_mark) ? 'Aprobado' : 'Suspendido', comment: row.comment || '' }
}

export async function fetchSchoolForPdf(schoolId) {
  const { data, error } = await supabase.from('schools').select('id,name,address,city,phone,email,brand_color,logo_path,grade_max,pass_mark,updated_at').eq('id', schoolId).single()
  if (error) throw error
  return data
}

export function logoUrl(school) {
  if (!school?.logo_path) return ''
  const { data } = supabase.storage.from('school-logos').getPublicUrl(school.logo_path)
  return `${data.publicUrl}?v=${encodeURIComponent(school.updated_at || '')}`
}

// Logo como dataURL con sus proporciones. Si falla, el PDF sale sin logo.
export async function loadLogo(school) {
  const url = logoUrl(school)
  if (!url) return null
  try {
    const blob = await fetch(url).then((response) => (response.ok ? response.blob() : Promise.reject(new Error('logo'))))
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result)
      reader.onerror = reject
      reader.readAsDataURL(blob)
    })
    const size = await new Promise((resolve, reject) => {
      const image = new Image()
      image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight })
      image.onerror = reject
      image.src = dataUrl
    })
    return { dataUrl, format: blob.type === 'image/png' ? 'PNG' : 'JPEG', ...size }
  } catch {
    return null
  }
}

// Asistencia de una clase (módulo + grupo) en un periodo, por alumno
export async function fetchClassAttendance({ groupId, degreeModuleId, from, to }) {
  const sessions = await readAll(() => supabase.from('class_sessions')
    .select('id,teaching_assignments!inner(group_id,degree_module_id),session_attendance(student_id,status)')
    .eq('teaching_assignments.group_id', groupId).eq('teaching_assignments.degree_module_id', degreeModuleId)
    .neq('status', 'cancelada').gte('date', from).lte('date', to).order('id'))
  const byStudent = new Map()
  sessions.forEach((session) => (session.session_attendance || []).forEach((row) => {
    if (!row.status) return
    const item = byStudent.get(row.student_id) || { P: 0, L: 0, A: 0 }
    item[row.status] += 1
    byStudent.set(row.student_id, item)
  }))
  return byStudent
}

// Todo lo necesario para los boletines de varios alumnos de un curso escolar
export async function fetchBulletinData({ year, studentIds, from, to }) {
  if (!studentIds.length) return []
  const [students, enrollments, modules, attendance, grades, names] = await Promise.all([
    readByStudents(studentIds, (ids) => supabase.from('students').select('id,name,student_number').in('id', ids).order('id')),
    readByStudents(studentIds, (ids) => supabase.from('enrollments').select('student_id,status,class_groups(level,name)').eq('academic_year_id', year.id).in('student_id', ids).order('id')),
    readByStudents(studentIds, (ids) => supabase.from('module_enrollments')
      .select('id,student_id,academic_year_id,is_carryover,theory_grade,practical_result,status,grade_comment,degree_modules(module_id,kind),class_groups(level,name),academic_years(name,starts_on,is_current),period_grades(period_id,theory_grade,practical_result,comment)')
      .in('student_id', ids).order('id')),
    readByStudents(studentIds, (ids) => supabase.from('session_attendance')
      .select('student_id,status,class_sessions!inner(date,status,teaching_assignments(degree_modules(module_id,kind)))')
      .in('student_id', ids).gte('class_sessions.date', from).lte('class_sessions.date', to).neq('class_sessions.status', 'cancelada')
      .order('session_id').order('student_id')),
    readByStudents(studentIds, (ids) => supabase.from('assessment_grades')
      .select('student_id,grade,comment,assessments!inner(title,kind,scope,max_grade,module_id,date)')
      .in('student_id', ids).gte('assessments.date', from).lte('assessments.date', to)
      .order('assessment_id').order('student_id')),
    supabase.from('modules').select('id,name').then(({ data }) => Object.fromEntries((data || []).map((item) => [item.id, item.name]))),
  ])

  return studentIds.map((id) => {
    const own = modules.filter((item) => item.student_id === id)
    const current = own.filter((item) => item.academic_year_id === year.id)
      .sort((a, b) => (a.degree_modules?.module_id || '').localeCompare(b.degree_modules?.module_id || '') || (b.degree_modules?.kind || '').localeCompare(a.degree_modules?.kind || ''))
    const presence = {}
    attendance.filter((row) => row.student_id === id && row.status).forEach((row) => {
      const module = row.class_sessions?.teaching_assignments?.degree_modules
      const key = `${module?.module_id}|${module?.kind}`
      const item = (presence[key] ||= { P: 0, L: 0, A: 0 })
      item[row.status] += 1
    })
    return {
      student: students.find((item) => item.id === id) || { id, name: 'Alumno' },
      enrollment: enrollments.find((item) => item.student_id === id) || null,
      modules: current,
      pending: pendingModules(own, (item) => item.academic_year_id === year.id),
      attendance: presence,
      exams: grades.filter((row) => row.student_id === id).sort((a, b) => String(a.assessments?.date).localeCompare(String(b.assessments?.date))),
      names,
    }
  })
}

/* ------------------------------------------------------------------ */
/* PDF                                                                 */
/* ------------------------------------------------------------------ */

const hexToRgb = (hex) => {
  const clean = /^#?([0-9a-f]{6})$/i.exec(hex || '')?.[1] || '1f4e79'
  return [0, 2, 4].map((index) => parseInt(clean.slice(index, index + 2), 16))
}
const attendanceText = (counts) => {
  if (!counts) return ['', '']
  const total = counts.P + counts.L + counts.A
  return total ? [`${Math.round(((counts.P + counts.L) / total) * 100)} %`, String(counts.A)] : ['', '']
}

export async function createPdf() {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')])
  return { doc: new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' }), autoTable }
}

const MARGIN = 14

function drawHeader(doc, { school, logo, title, subtitle }) {
  const width = doc.internal.pageSize.getWidth()
  const color = hexToRgb(school.brand_color)
  doc.setFillColor(...color)
  doc.rect(0, 0, width, 3, 'F')
  let textX = MARGIN
  if (logo) {
    const height = 16
    const logoWidth = Math.min(40, (logo.width / logo.height) * height)
    try {
      doc.addImage(logo.dataUrl, logo.format, MARGIN, 8, logoWidth, height)
      textX = MARGIN + logoWidth + 5
    } catch { /* imagen no válida: sin logo */ }
  }
  doc.setTextColor(30)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(13)
  doc.text(school.name || '', textX, 13)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8.5)
  doc.setTextColor(100)
  const contact = [[school.address, school.city].filter(Boolean).join(', '), [school.phone, school.email].filter(Boolean).join(' · ')].filter(Boolean)
  contact.forEach((line, index) => doc.text(line, textX, 18 + index * 4))
  doc.setDrawColor(220)
  doc.line(MARGIN, 29, width - MARGIN, 29)
  doc.setTextColor(30)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(12)
  doc.text(title, MARGIN, 37)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(90)
  doc.text(subtitle, MARGIN, 42.5)
  doc.setTextColor(30)
  return 48
}

function tableTheme(school) {
  return {
    theme: 'grid',
    margin: { left: MARGIN, right: MARGIN },
    styles: { font: 'helvetica', fontSize: 8.5, cellPadding: 1.8, lineColor: [225, 225, 225], textColor: [40, 40, 40], overflow: 'linebreak' },
    headStyles: { fillColor: hexToRgb(school.brand_color), textColor: 255, fontStyle: 'bold' },
  }
}

function sectionTitle(doc, text, y) {
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10)
  doc.text(text, MARGIN, y)
  doc.setFont('helvetica', 'normal')
  return y + 2
}

function ensureSpace(doc, y, needed) {
  if (y + needed <= doc.internal.pageSize.getHeight() - 20) return y
  doc.addPage()
  return 20
}

function drawSignature(doc, y, label) {
  const width = doc.internal.pageSize.getWidth()
  y = ensureSpace(doc, y + 6, 30)
  doc.setFontSize(9)
  doc.setTextColor(60)
  doc.text(`Fecha: ${new Date().toLocaleDateString('es-ES')}`, MARGIN, y + 6)
  doc.setDrawColor(150)
  doc.line(width - MARGIN - 70, y + 22, width - MARGIN, y + 22)
  doc.text(label, width - MARGIN - 70, y + 27)
  doc.setTextColor(30)
}

// Numeración de páginas al final, con el nombre de la escuela
export function finishPdf(doc, school, label) {
  const total = doc.getNumberOfPages()
  const width = doc.internal.pageSize.getWidth()
  const height = doc.internal.pageSize.getHeight()
  for (let page = 1; page <= total; page += 1) {
    doc.setPage(page)
    doc.setFontSize(7.5)
    doc.setTextColor(140)
    doc.text(`${school.name || ''} · ${label}`, MARGIN, height - 8)
    doc.text(`${page}/${total}`, width - MARGIN, height - 8, { align: 'right' })
  }
}

// Boletín de un alumno (empieza en la página actual)
export function drawBulletin(doc, autoTable, { school, logo, year, period, entry }) {
  const { student, enrollment, modules, pending, attendance, exams, names } = entry
  const group = enrollment?.class_groups ? `${enrollment.class_groups.level}º${enrollment.class_groups.name}` : ''
  let y = drawHeader(doc, {
    school,
    logo,
    title: `Boletín de notas · ${period.name}`,
    subtitle: [student.name, student.student_number && `Nº ${student.student_number}`, group && `Grupo ${group}`, `Curso ${year.name}`, period.from && `${fmtDate(period.from)} - ${fmtDate(period.to)}`].filter(Boolean).join('   ·   '),
  })

  const scale = { grade_max: Number(school.grade_max ?? 100), pass_mark: Number(school.pass_mark ?? 75) }
  const body = modules.map((item) => {
    const grade = gradeFor(item, period.id, scale)
    const [rate, absences] = attendanceText(attendance[`${item.degree_modules?.module_id}|${item.degree_modules?.kind}`])
    return [item.degree_modules?.module_id || '', names[item.degree_modules?.module_id] || '', KIND_SHORT[item.degree_modules?.kind] || '', grade.value, grade.status, rate, absences, grade.comment]
  })
  autoTable(doc, {
    ...tableTheme(school),
    startY: y,
    head: [['Módulo', 'Nombre', 'Tipo', 'Nota', 'Estado', 'Asist.', 'Faltas', 'Comentario']],
    body: body.length ? body : [['', 'Sin módulos en este curso', '', '', '', '', '', '']],
    columnStyles: { 0: { cellWidth: 14, fontStyle: 'bold' }, 1: { cellWidth: 36 }, 2: { cellWidth: 15 }, 3: { cellWidth: 13, halign: 'right' }, 4: { cellWidth: 20 }, 5: { cellWidth: 13, halign: 'right' }, 6: { cellWidth: 13, halign: 'right' } },
  })
  y = doc.lastAutoTable.finalY + 4
  doc.setFontSize(7.5)
  doc.setTextColor(110)
  doc.text(`Teoría sobre ${num(scale.grade_max)} (aprueba con ${num(scale.pass_mark)}). Práctica: Apto o No apto. Asistencia y faltas del periodo.`, MARGIN, y + 2)
  doc.setTextColor(30)
  y += 9

  if (exams.length) {
    y = sectionTitle(doc, 'Exámenes y evaluaciones del periodo', ensureSpace(doc, y, 20))
    autoTable(doc, {
      ...tableTheme(school),
      startY: y + 1,
      head: [['Fecha', 'Módulo', 'Prueba', 'Nota', 'Comentario']],
      body: exams.map((row) => [fmtDate(row.assessments?.date), row.assessments?.module_id || '', `${row.assessments?.title || ''}${row.assessments?.kind === 'examen' ? ` (examen ${row.assessments?.scope === 'ra' ? 'de RA' : 'parcial'})` : ' (evaluación)'}`, row.grade == null ? '' : `${num(row.grade)} / ${num(row.assessments?.max_grade || 10)}`, row.comment || '']),
      columnStyles: { 0: { cellWidth: 20 }, 1: { cellWidth: 15, fontStyle: 'bold' }, 3: { cellWidth: 20, halign: 'right' } },
    })
    y = doc.lastAutoTable.finalY + 7
  }

  if (pending.length) {
    y = sectionTitle(doc, 'Módulos pendientes de cursos anteriores', ensureSpace(doc, y, 20))
    autoTable(doc, {
      ...tableTheme(school),
      startY: y + 1,
      head: [['Módulo', 'Nombre', 'Tipo', 'Situación']],
      body: pending.map((item) => [item.degree_modules?.module_id || '', names[item.degree_modules?.module_id] || '', KIND_SHORT[item.degree_modules?.kind] || '', item.academic_year_id === year.id ? 'Se cursa este curso' : `Suspendido en ${item.academic_years?.name || ''}`]),
      columnStyles: { 0: { cellWidth: 15, fontStyle: 'bold' }, 2: { cellWidth: 20 } },
    })
    y = doc.lastAutoTable.finalY + 4
  }

  drawSignature(doc, y, 'Firma y sello de la escuela')
}

// Hoja de notas de una asignatura (módulo + grupo + periodo)
export function drawClassSheet(doc, autoTable, { school, logo, year, period, moduleLabel, groupLabel, teacher, rows, attendance, scale }) {
  const y = drawHeader(doc, {
    school,
    logo,
    title: `Notas de ${moduleLabel} · ${groupLabel} · ${period.name}`,
    subtitle: [`Curso ${year.name}`, period.from && `${fmtDate(period.from)} - ${fmtDate(period.to)}`, teacher && `Profesor/a: ${teacher}`].filter(Boolean).join('   ·   '),
  })
  autoTable(doc, {
    ...tableTheme(school),
    startY: y,
    head: [['Nº', 'Alumno', 'Nota', 'Estado', 'Asist.', 'Faltas', 'Comentario']],
    body: rows.map((row) => {
      const grade = gradeFor(row, period.id, scale)
      const [rate, absences] = attendanceText(attendance.get(row.student_id))
      return [row.students?.student_number || '', `${row.students?.name || ''}${row.is_carryover ? ' (pendiente)' : ''}`, grade.value, grade.status, rate, absences, grade.comment]
    }),
    columnStyles: { 0: { cellWidth: 14 }, 1: { cellWidth: 48 }, 2: { cellWidth: 14, halign: 'right' }, 3: { cellWidth: 21 }, 4: { cellWidth: 13, halign: 'right' }, 5: { cellWidth: 12, halign: 'right' } },
  })
  const end = doc.lastAutoTable.finalY + 4
  doc.setFontSize(7.5)
  doc.setTextColor(110)
  doc.text(`Teoría sobre ${num(scale.grade_max)} (aprueba con ${num(scale.pass_mark)}). Práctica: Apto o No apto. Asistencia y faltas del periodo.`, MARGIN, end + 2)
  doc.setTextColor(30)
  drawSignature(doc, end + 4, 'Firma del profesor/a')
}

export const pdfFileName = (...parts) => `${parts.filter(Boolean).join('_').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w.-]+/g, '_')}.pdf`
