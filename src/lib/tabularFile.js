// Lectura común de archivos CSV o JSON para las importaciones masivas.

// Sin tildes, en minúsculas y sin espacios repetidos
export const norm = (value) => String(value ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toLowerCase()

// «teoría» / «práctica» (o T / P); '' si viene vacío y null si no se entiende
export const parseKind = (value) => {
  const v = norm(value)
  if (!v) return ''
  if (['teoria', 't', 'theory'].includes(v)) return 'teoria'
  if (['practica', 'p', 'practice'].includes(v)) return 'practica'
  return null
}

// CSV con «,», «;» (Excel en español) o tabulador (copiado de una hoja de cálculo), con comillas
function parseCsv(text) {
  const firstLine = text.split(/\r?\n/, 1)[0] || ''
  const count = (ch) => firstLine.split(ch).length - 1
  const delimiter = ['\t', ';', ','].reduce((best, ch) => (count(ch) > count(best) ? ch : best), ',')
  // Sin separador pero con columnas alineadas por varios espacios: se tratan como tabuladores
  if (!count('\t') && !count(';') && !count(',') && / {2,}/.test(firstLine)) return parseCsv(text.replace(/ {2,}/g, '\t'))
  const rows = []
  let row = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i += 1 }
      else if (ch === '"') quoted = false
      else cell += ch
    } else if (ch === '"') quoted = true
    else if (ch === delimiter) { row.push(cell); cell = '' }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i += 1
      row.push(cell); rows.push(row); row = []; cell = ''
    } else cell += ch
  }
  if (cell || row.length) { row.push(cell); rows.push(row) }
  const [header = [], ...body] = rows.filter((r) => r.some((c) => String(c).trim()))
  return { header, body }
}

// Devuelve una lista de objetos con las claves que reconoce keyFor(cabecera)
export async function readTabularFile(file, keyFor, options = {}) {
  const { maxBytes = 2 * 1024 * 1024 } = options
  if (file.size > maxBytes) throw new Error(`El archivo supera ${Math.round(maxBytes / 1024 / 1024)} MB.`)
  return parseTabularText(await file.text(), keyFor, { ...options, json: /\.json$/i.test(file.name) })
}

// Lo mismo a partir de texto (archivo leído o pegado): JSON, CSV o columnas con tabulador
export function parseTabularText(input, keyFor, { maxRows = 1000, listKeys = ['rows'], json = false } = {}) {
  const text = String(input || '').replace(/^\uFEFF/, '')
  const isJson = json || /^\s*[[{]/.test(text)
  let rows
  if (isJson) {
    const data = JSON.parse(text)
    const list = Array.isArray(data) ? data : listKeys.map((key) => data?.[key]).find(Array.isArray)
    if (!Array.isArray(list)) throw new Error(`El JSON debe ser una lista o un objeto con «${listKeys[0]}».`)
    rows = list.map((item) => Object.fromEntries(Object.entries(item || {}).map(([k, v]) => [keyFor(k), v]).filter(([key]) => key)))
  } else {
    const { header, body } = parseCsv(text)
    const keys = header.map(keyFor)
    rows = body.map((cells) => Object.fromEntries(keys.map((key, i) => [key, cells[i] ?? '']).filter(([key]) => key)))
  }
  if (rows.length > maxRows) throw new Error(`Máximo ${maxRows} filas por archivo.`)
  return rows
}
