// Festivos y vacaciones del curso escolar: lectura de CSV, tabla pegada de Excel o JSON.
// Columnas: fecha (o inicio), fin (opcional, para vacaciones de varios días) y nombre.
// El JSON puede ser una lista o traer «festivos» y «vacaciones_escolares» (en cualquier nivel).
import { downloadBlob, downloadCsv } from './download.js'
import { norm, parseTabularText } from './tabularFile.js'

const PREFIXES = [
  ['fin', ['fin', 'hasta', 'fecha fin', 'end', 'ends on']],
  ['inicio', ['fecha', 'inicio', 'desde', 'fecha inicio', 'dia', 'date', 'start', 'starts on']],
  ['nombre', ['nombre', 'descripcion', 'motivo', 'festivo', 'name', 'description']],
  ['tipo', ['tipo', 'type']],
]
const keyFor = (header) => {
  const h = norm(header).replace(/\(.*?\)/g, '').replace(/[_.-]/g, ' ').replace(/\s+/g, ' ').trim()
  const found = PREFIXES.find(([, prefixes]) => prefixes.includes(h))
  return found ? found[0] : null
}

const LIST_KEYS = ['festivos', 'vacaciones_escolares', 'vacaciones', 'holidays', 'no_lectivos', 'dias_no_lectivos']

// Busca listas de festivos dentro del JSON (también anidadas, p. ej. en «reglas_aplicadas»)
function collectJson(data, out = []) {
  if (Array.isArray(data)) { data.forEach((item) => out.push(item)); return out }
  if (data && typeof data === 'object') {
    Object.entries(data).forEach(([key, value]) => {
      if (LIST_KEYS.includes(norm(key).replace(/ /g, '_')) && Array.isArray(value)) value.forEach((item) => out.push(item))
      else if (value && typeof value === 'object' && !Array.isArray(value)) collectJson(value, out)
    })
  }
  return out
}

export function readHolidaysText(text) {
  const trimmed = String(text || '').replace(/^\uFEFF/, '').trim()
  if (/^[[{]/.test(trimmed)) {
    const items = collectJson(JSON.parse(trimmed))
    if (!items.length) throw new Error('No se encuentran festivos en el JSON (lista, «festivos» o «vacaciones_escolares»).')
    return items.map((item) => Object.fromEntries(Object.entries(item || {}).map(([k, v]) => [keyFor(k), v]).filter(([key]) => key)))
  }
  return parseTabularText(trimmed, keyFor, { maxRows: 500 })
}

export async function readHolidaysFile(file) {
  if (file.size > 3 * 1024 * 1024) throw new Error('El archivo supera 3 MB.')
  return readHolidaysText(await file.text())
}

const parseDate = (value) => {
  const v = String(value ?? '').trim()
  let y, m, d
  let match = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)
  if (match) [, y, m, d] = match
  else if ((match = v.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/))) [, d, m, y] = match
  else return null
  const date = new Date(Number(y), Number(m) - 1, Number(d))
  if (date.getMonth() !== Number(m) - 1) return null
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

// Cada fila -> { starts_on, ends_on, name } o errores. year: { starts_on, ends_on }; existing: festivos ya guardados
export function buildHolidaysPlan(raw, year, existing) {
  const known = new Set(existing.map((item) => `${item.starts_on}|${item.ends_on}`))
  const seen = new Set()
  return raw.map((row, index) => {
    const errors = []
    const start = parseDate(row.inicio)
    const end = String(row.fin ?? '').trim() ? parseDate(row.fin) : start
    const name = [String(row.nombre ?? '').trim(), String(row.tipo ?? '').trim()].filter(Boolean).join(' · ').slice(0, 120) || 'Festivo'
    if (!start) errors.push('Fecha no válida (AAAA-MM-DD o DD/MM/AAAA)')
    else if (!end) errors.push('Fecha de fin no válida')
    else if (end < start) errors.push('La fecha de fin es anterior al inicio')
    else if (start < year.starts_on || end > year.ends_on) errors.push('Fuera de las fechas del curso escolar')
    const key = `${start}|${end}`
    const duplicate = known.has(key) || seen.has(key)
    seen.add(key)
    return { line: index + 2, errors, duplicate, values: { starts_on: start, ends_on: end, name } }
  })
}

export function downloadHolidaysCsvTemplate() {
  downloadCsv([
    ['fecha', 'fin', 'nombre'],
    ['2026-10-12', '', 'Fiesta Nacional de España'],
    ['2026-12-22', '2027-01-07', 'Vacaciones de Navidad'],
  ], 'plantilla-festivos.csv')
}

export function downloadHolidaysJsonTemplate() {
  const example = {
    festivos: [{ fecha: '2026-10-12', descripcion: 'Fiesta Nacional de España' }],
    vacaciones_escolares: [{ inicio: '2026-12-22', fin: '2027-01-07', nombre: 'Vacaciones de Navidad' }],
  }
  downloadBlob(new Blob([JSON.stringify(example, null, 2)], { type: 'application/json' }), 'plantilla-festivos.json')
}
