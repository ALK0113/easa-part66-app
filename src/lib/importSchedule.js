// Importación masiva de calendarios (CSV o JSON).
// Cada fila es una clase semanal (columna «dia»: va a la plantilla y genera todo el curso)
// o una clase suelta (columna «fecha»: un día concreto, con nota y práctica opcionales).
import { downloadBlob, downloadCsv } from './download.js'
import { groupLabel } from './academic.js'
import { norm, parseKind, parseTabularText, readTabularFile } from './tabularFile.js'

export const MAX_ROWS = 1000
export const MAX_FILE_BYTES = 2 * 1024 * 1024

export const COLUMNS = ['grupo', 'modulo', 'tipo', 'profesor', 'dia', 'fecha', 'inicio', 'fin', 'aula', 'nota', 'practica']

const compact = (value) => norm(value).replace(/[\s.ºª°-]/g, '')

const ALIASES = {
  grupo: ['grupo', 'group', 'clase grupo', 'curso grupo'],
  modulo: ['modulo', 'module', 'asignatura'],
  tipo: ['tipo', 'kind', 'clase tipo'],
  profesor: ['profesor', 'teacher', 'docente', 'email profesor'],
  dia: ['dia', 'dia semana', 'weekday', 'day'],
  fecha: ['fecha', 'date', 'dia concreto'],
  inicio: ['inicio', 'hora inicio', 'empieza', 'start', 'start time', 'desde'],
  fin: ['fin', 'final', 'hora fin', 'hora final', 'termina', 'end', 'end time', 'hasta'],
  aula: ['aula', 'room', 'lugar', 'hangar'],
  nota: ['nota', 'notas', 'note', 'observaciones'],
  practica: ['practica', 'practice', 'id practica'],
}
const keyFor = (header) => {
  const h = norm(header).replace(/_/g, ' ')
  return Object.keys(ALIASES).find((key) => ALIASES[key].includes(h)) || null
}

const WEEKDAYS = { lunes: 1, martes: 2, miercoles: 3, jueves: 4, viernes: 5, sabado: 6, domingo: 7, l: 1, m: 2, x: 3, j: 4, v: 5, s: 6, d: 7, lun: 1, mar: 2, mie: 3, jue: 4, vie: 5, sab: 6, dom: 7, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6, sunday: 7 }
const parseWeekday = (value) => {
  const v = norm(value)
  if (!v) return null
  if (/^[1-7]$/.test(v)) return Number(v)
  return WEEKDAYS[v] || NaN
}

const parseTime = (value) => {
  const match = String(value ?? '').trim().match(/^(\d{1,2})[:.h](\d{2})(?::\d{2})?$/)
  if (!match) return null
  const [h, m] = [Number(match[1]), Number(match[2])]
  return h < 24 && m < 60 ? `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}` : null
}

const parseDate = (value) => {
  const v = String(value ?? '').trim()
  let y, m, d
  let match = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)
  if (match) [, y, m, d] = match
  else if ((match = v.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/))) [, d, m, y] = match
  else return null
  const date = new Date(Number(y), Number(m) - 1, Number(d))
  if (date.getMonth() !== Number(m) - 1) return null
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}


const READ_OPTIONS = { maxRows: MAX_ROWS, maxBytes: MAX_FILE_BYTES, listKeys: ['clases', 'sesiones', 'calendario', 'rows'] }
export const readScheduleFile = (file) => readTabularFile(file, keyFor, READ_OPTIONS)
// Tabla copiada de Excel u hoja de cálculo (columnas separadas por tabulador)
export const readScheduleText = (text) => parseTabularText(text, keyFor, READ_OPTIONS)

// Prepara la importación: resuelve grupo, módulo, tipo y profesor de cada fila y anota lo que falta crear
// (módulos propios, módulos del grado y clases). ctx: datos de la escuela; defaultTeacherId: profesor
// para las filas sin profesor (o con uno que no existe).
export function buildPlan(raw, ctx, defaultTeacherId) {
  const teachers = ctx.teachers
  const teacherName = (id) => { const t = teachers.find((item) => item.id === id); return t ? (t.full_name || t.email) : '' }
  const catalog = new Map(ctx.modules.map((mod) => [String(mod.id).toUpperCase(), mod]))
  const newModules = new Map() // código -> { id }
  const newDegreeModules = new Map() // degree|code|kind -> { degree_id, module_id, kind, level }
  const newClasses = new Map() // group|code|kind|teacher -> { group, code, kind, teacherId }
  const unknownTeachers = new Map() // nombre del archivo -> profesor asignado
  const groupAliases = new Map() // «3º» -> 3ºA

  const findGroup = (value) => {
    const key = compact(value)
    const exact = ctx.groups.find((group) => compact(groupLabel(group)) === key)
    if (exact) return exact
    // «3º» sin letra: si solo hay un grupo de ese curso, es ese
    if (/^\d$/.test(key)) {
      const sameLevel = ctx.groups.filter((group) => String(group.level) === key)
      if (sameLevel.length === 1) { groupAliases.set(String(value).trim(), groupLabel(sameLevel[0])); return sameLevel[0] }
    }
    return null
  }
  const findTeacher = (value) => {
    const v = norm(value)
    if (!v) return null
    return teachers.find((t) => norm(t.email) === v || norm(t.full_name) === v)
      || teachers.find((t) => norm(t.full_name).includes(v) || v.includes(norm(t.full_name || '~')))
      || null
  }

  const rows = raw.map((row, index) => {
    const errors = []
    const line = index + 2
    const code = String(row.modulo ?? '').trim().toUpperCase()
    const kindInput = parseKind(row.tipo)
    const group = row.grupo ? findGroup(row.grupo) : null
    if (!String(row.grupo ?? '').trim()) errors.push('Falta el grupo')
    else if (!group) errors.push(`No existe el grupo ${row.grupo} en el curso actual (créalo en Escuela → Grupos)`)
    if (!code) errors.push('Falta el módulo')
    if (kindInput === null) errors.push('Tipo debe ser «teoría» o «práctica»')

    let assignmentId = null
    let classKey = null
    if (group && code && kindInput !== null) {
      const degree = ctx.degrees.find((item) => item.id === group.degree_id)
      const inDegree = (degree?.degree_modules || []).filter((dm) => String(dm.module_id).toUpperCase() === code)
      // Sin tipo: el único que tenga el grado o, si no, teoría
      const kind = kindInput || (inDegree.length === 1 ? inDegree[0].kind : 'teoria')
      const moduleRow = catalog.get(code)
      if (moduleRow && moduleRow.school_id && moduleRow.school_id !== ctx.schoolId) errors.push(`El módulo ${code} es de otra escuela`)
      if (!moduleRow) newModules.set(code, { id: code })
      const degreeModule = inDegree.find((dm) => dm.kind === kind)
      if (!degreeModule) newDegreeModules.set(`${group.degree_id}|${code}|${kind}`, { degree_id: group.degree_id, module_id: code, kind, level: group.level })

      // Profesor: el del archivo, si existe; si no, el que ya da esa clase; si no, el profesor por defecto
      const fileTeacher = findTeacher(row.profesor)
      const existing = degreeModule ? ctx.assignments.filter((ta) => ta.group_id === group.id && ta.degree_module_id === degreeModule.id) : []
      let teacherId = fileTeacher?.id || null
      if (!teacherId && existing.length) teacherId = existing[0].profile_id
      if (!teacherId) {
        if (String(row.profesor ?? '').trim()) unknownTeachers.set(String(row.profesor).trim(), defaultTeacherId ? teacherName(defaultTeacherId) : '')
        teacherId = defaultTeacherId || null
      }
      const match = existing.find((ta) => ta.profile_id === teacherId)
      if (match) assignmentId = match.id
      else if (!teacherId) errors.push('Elige un «profesor por defecto» para las clases nuevas')
      else {
        classKey = `${group.id}|${code}|${kind}|${teacherId}`
        newClasses.set(classKey, { group, degreeId: group.degree_id, code, kind, teacherId, teacher: teacherName(teacherId) })
      }
    }

    const hasDate = String(row.fecha ?? '').trim() !== ''
    const hasDay = String(row.dia ?? '').trim() !== ''
    const date = hasDate ? parseDate(row.fecha) : null
    const weekday = hasDay ? parseWeekday(row.dia) : null
    if (!hasDate && !hasDay) errors.push('Indica «dia» (semanal) o «fecha» (clase suelta)')
    if (hasDate && hasDay) errors.push('Usa «dia» o «fecha», no los dos')
    if (hasDate && !date) errors.push('Fecha no válida (AAAA-MM-DD o DD/MM/AAAA)')
    if (hasDay && Number.isNaN(weekday)) errors.push('Día no válido (lunes…domingo o 1…7)')

    const start = parseTime(row.inicio)
    const end = parseTime(row.fin)
    if (!start) errors.push('Hora de inicio no válida (HH:MM)')
    if (!end) errors.push('Hora final no válida (HH:MM)')
    if (start && end && end <= start) errors.push('La hora final debe ser posterior al inicio')

    const room = String(row.aula ?? '').trim()
    const note = String(row.nota ?? '').trim()
    const practiceId = String(row.practica ?? '').trim()
    if (room.length > 40) errors.push('Aula: máximo 40 caracteres')
    if (note.length > 300) errors.push('Nota: máximo 300 caracteres')
    if (hasDay && (note || practiceId)) errors.push('Nota y práctica solo en clases sueltas (con fecha)')
    if (practiceId && !ctx.practiceIds.has(practiceId)) errors.push(`La práctica ${practiceId} no existe en la escuela`)

    return {
      line,
      raw: row,
      errors,
      type: hasDate ? 'suelta' : 'semanal',
      label: `${group ? groupLabel(group) : row.grupo || '?'} · ${code || '?'}${kindInput ? ` ${kindInput}` : ''}`,
      assignmentId,
      classKey,
      values: {
        weekday: hasDay ? weekday : undefined,
        date: date || undefined,
        start_time: start,
        end_time: end,
        room: room || null,
        note: note || null,
        practice_id: practiceId || null,
      },
    }
  })

  // Solo se crea lo que usan filas válidas
  const valid = rows.filter((row) => !row.errors.length)
  const usedClasses = new Set(valid.map((row) => row.classKey).filter(Boolean))
  const classes = [...newClasses.entries()].filter(([key]) => usedClasses.has(key)).map(([key, value]) => ({ key, ...value }))
  const usedDegreeModules = new Set(classes.map((item) => `${item.degreeId}|${item.code}|${item.kind}`))
  const degreeModules = [...newDegreeModules.entries()].filter(([key]) => usedDegreeModules.has(key)).map(([, value]) => value)
  const modules = [...newModules.values()].filter((mod) => degreeModules.some((dm) => dm.module_id === mod.id))
  return { rows, modules, degreeModules, classes, unknownTeachers: [...unknownTeachers.entries()], groupAliases: [...groupAliases.entries()] }
}

export function downloadCsvTemplate() {
  downloadCsv([
    COLUMNS,
    ['2ºA', 'M11', 'práctica', '', 'martes', '', '17:00', '21:30', 'HANGAR 8', '', ''],
    ['2ºA', 'M11', 'práctica', '', '', '2026-12-15', '09:00', '13:00', 'HANGAR 8', 'Sesión de recuperación', ''],
  ], 'plantilla-calendario.csv')
}

export function downloadJsonTemplate() {
  const example = {
    clases: [
      { grupo: '2ºA', modulo: 'M11', tipo: 'práctica', dia: 'martes', inicio: '17:00', fin: '21:30', aula: 'HANGAR 8' },
      { grupo: '2ºA', modulo: 'M11', tipo: 'práctica', fecha: '2026-12-15', inicio: '09:00', fin: '13:00', aula: 'HANGAR 8', nota: 'Sesión de recuperación' },
    ],
  }
  downloadBlob(new Blob([JSON.stringify(example, null, 2)], { type: 'application/json' }), 'plantilla-calendario.json')
}
