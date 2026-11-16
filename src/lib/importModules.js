// Importación masiva de módulos de un grado (CSV, JSON o pegado desde Excel). Formato:
//   Módulo | Denominación EASA Part-66 | Horas totales | Teoría | Práctica | Curso (opcional) | Profesor (opcional)
// La fila «TOTAL» se ignora: el total lo calcula la aplicación.
import { downloadBlob, downloadCsv } from './download.js'
import { norm, readTabularFile, parseTabularText } from './tabularFile.js'

export const MAX_ROWS = 500

export const HEADERS = ['Módulo', 'Denominación EASA Part-66', 'Horas totales', 'Teoría', 'Práctica', 'Curso (opcional)', 'Profesor (opcional)']

// Cabecera -> clave (sin tildes, sin «(opcional)», por prefijo)
const PREFIXES = [
  ['horas_teoria', ['teoria', 'horas teoria', 'theory']],
  ['horas_practica', ['practica', 'horas practica', 'practice']],
  ['horas', ['horas totales', 'total horas', 'horas', 'total', 'hours']],
  ['nombre', ['denominacion', 'nombre', 'name', 'titulo']],
  ['numero', ['modulo', 'module', 'numero', 'codigo', 'code', 'n']],
  ['curso', ['curso', 'nivel', 'level']],
  ['profesor', ['profesor', 'docente', 'teacher']],
]
const keyFor = (header) => {
  const h = norm(header).replace(/\(.*?\)/g, '').replace(/[_.º-]/g, ' ').replace(/\s+/g, ' ').trim()
  if (!h) return null
  const found = PREFIXES.find(([, prefixes]) => prefixes.some((prefix) => h === prefix || h.startsWith(`${prefix} `)))
  return found ? found[0] : null
}

const OPTIONS = { maxRows: MAX_ROWS, listKeys: ['modulos', 'modules', 'rows'] }
export const readModulesFile = (file) => readTabularFile(file, keyFor, OPTIONS)
// Texto pegado desde Excel u hoja de cálculo (columnas separadas por tabulador)
export const readModulesText = (text) => parseTabularText(text, keyFor, OPTIONS)

const parseHours = (value) => {
  const text = String(value ?? '').trim().replace(',', '.')
  if (!text) return { empty: true }
  const number = Number(text)
  return Number.isFinite(number) && number >= 0 ? { value: Math.round(number) } : { invalid: true }
}

// «M1» -> «M01» si así está en el catálogo
const resolveCode = (value, catalog) => {
  const code = String(value ?? '').trim().toUpperCase().replace(/\s+/g, '')
  const padded = code.replace(/^M(\d)(?!\d)/, 'M0$1')
  if (!catalog.has(code) && catalog.has(padded)) return padded
  return code
}

// Qué pasará con cada fila. ctx: { schoolId, degree (con degree_modules), modules, groups, teachers, assignments }
export function buildModulesPlan(raw, ctx) {
  const catalog = new Map(ctx.modules.map((mod) => [String(mod.id).toUpperCase(), mod]))
  const inDegree = new Map((ctx.degree.degree_modules || []).map((dm) => [`${String(dm.module_id).toUpperCase()}|${dm.kind}`, dm]))
  const degreeGroups = (ctx.groups || []).filter((group) => group.degree_id === ctx.degree.id)
  const findTeacher = (value) => {
    const v = norm(value)
    if (!v) return null
    return (ctx.teachers || []).find((t) => norm(t.email) === v || norm(t.full_name) === v)
      || (ctx.teachers || []).find((t) => t.full_name && (norm(t.full_name).includes(v) || v.includes(norm(t.full_name))))
      || null
  }
  const seen = new Set()
  let ignoredTotal = false

  const rows = []
  raw.forEach((row, index) => {
    const line = index + 2
    const rawCode = String(row.numero ?? '').trim()
    const name = String(row.nombre ?? '').trim()
    // La fila de total no se importa: la aplicación lo calcula
    if (!rawCode && /total/i.test(name)) { ignoredTotal = true; return }
    if (/^total/i.test(rawCode)) { ignoredTotal = true; return }

    const errors = []
    const warnings = []
    const code = resolveCode(rawCode, catalog)
    const levelText = String(row.curso ?? '').trim().replace(/º|ª|°/g, '')
    const level = levelText ? Number(levelText) : null
    if (!code) errors.push('Falta el módulo')
    else if (code.length > 20) errors.push('Código de módulo demasiado largo (máx. 20)')
    if (levelText && !(Number.isInteger(level) && level >= 1 && level <= 9)) errors.push('Curso debe ser un número del 1 al 9')

    const total = parseHours(row.horas)
    const theory = parseHours(row.horas_teoria)
    const practice = parseHours(row.horas_practica)
    if (total.invalid || theory.invalid || practice.invalid) errors.push('Horas no válidas')
    let theoryHours = theory.value ?? 0
    const practiceHours = practice.value ?? 0
    // Solo horas totales: se entienden como teoría
    if (theory.empty && practice.empty && !total.empty && !total.invalid) theoryHours = total.value
    if (!total.empty && !total.invalid && (!theory.empty || !practice.empty) && total.value !== theoryHours + practiceHours) {
      errors.push(`Horas totales (${total.value}) no coinciden con teoría + práctica (${theoryHours + practiceHours})`)
    }
    // Cada parte con horas es una parte del módulo en el grado (teoría y/o práctica)
    const parts = []
    if (theoryHours > 0) parts.push({ kind: 'teoria', hours: theoryHours })
    if (practiceHours > 0) parts.push({ kind: 'practica', hours: practiceHours })
    if (!errors.length && !parts.length) errors.push('Sin horas: indica teoría, práctica u horas totales')

    const existing = catalog.get(code)
    if (existing?.school_id && existing.school_id !== ctx.schoolId) errors.push(`El código ${code} ya lo usa otra escuela`)
    if (!existing && !name) errors.push('Falta la denominación (el módulo es nuevo)')
    if (seen.has(code)) errors.push(`${code} está repetido en el archivo`)
    seen.add(code)

    // Profesor opcional: imparte el módulo en los grupos de ese curso que aún no tienen profesor
    const teacherText = String(row.profesor ?? '').trim()
    const teacher = teacherText ? findTeacher(teacherText) : null
    let classes = []
    if (teacherText && !teacher) warnings.push(`Profesor «${teacherText}» no encontrado en la escuela: no se asigna`)
    else if (teacher && !level) warnings.push('Para asignar el profesor indica el curso')
    else if (teacher) {
      const groups = degreeGroups.filter((group) => group.level === level)
      if (!groups.length) warnings.push(`No hay grupos de ${level}º este curso: el profesor no se asigna`)
      classes = groups.flatMap((group) => parts.map((part) => ({ group, kind: part.kind })))
        .filter(({ group, kind }) => {
          const dm = inDegree.get(`${code}|${kind}`)
          return !dm || !(ctx.assignments || []).some((ta) => ta.group_id === group.id && ta.degree_module_id === dm.id)
        })
    }

    const isCatalog = existing && !existing.school_id
    const action = !existing ? 'nuevo' : isCatalog ? 'catalogo' : 'propio'
    rows.push({
      line,
      errors,
      warnings,
      code,
      moduleId: existing?.id || code,
      name: isCatalog ? existing.name : name || existing?.name || '',
      // El nombre de un módulo EASA no se cambia; el de uno propio, sí
      rename: action === 'propio' && name && name !== existing.name ? name : null,
      action,
      level,
      theoryHours,
      practiceHours,
      teacher,
      classes,
      parts: parts.map((part) => ({ ...part, existing: inDegree.get(`${code}|${part.kind}`) || null })),
    })
  })

  const valid = rows.filter((row) => !row.errors.length)
  return {
    rows,
    ignoredTotal,
    created: valid.filter((row) => row.action === 'nuevo').length,
    renamed: valid.filter((row) => row.rename).length,
    added: valid.reduce((sum, row) => sum + row.parts.filter((part) => !part.existing).length, 0),
    updated: valid.reduce((sum, row) => sum + row.parts.filter((part) => part.existing).length, 0),
    classes: valid.reduce((sum, row) => sum + row.classes.length, 0),
    totals: valid.reduce((acc, row) => ({ theory: acc.theory + row.theoryHours, practice: acc.practice + row.practiceHours }), { theory: 0, practice: 0 }),
  }
}

const EXAMPLE = [
  ['M1', 'Mathematics – Matemáticas', 33, 33, 0, '', ''],
  ['M3', 'Electrical Fundamentals – Fundamentos de electricidad', 132, 110, 22, '', ''],
  ['M7', 'Maintenance Practices – Prácticas de mantenimiento', 440, 66, 374, '', ''],
  ['M11', 'Aeroplane Aerodynamics, Structures and Systems – Aerodinámica, estructuras y sistemas del avión', 561, 330, 231, '2', ''],
]

export function downloadModulesCsvTemplate() {
  downloadCsv([HEADERS, ...EXAMPLE], 'plantilla-modulos.csv')
}

export function downloadModulesJsonTemplate() {
  const keys = ['modulo', 'denominacion', 'horas_totales', 'teoria', 'practica', 'curso', 'profesor']
  const modulos = EXAMPLE.map((row) => Object.fromEntries(keys.map((key, i) => [key, row[i]]).filter(([, value]) => value !== '')))
  downloadBlob(new Blob([JSON.stringify({ modulos }, null, 2)], { type: 'application/json' }), 'plantilla-modulos.json')
}
