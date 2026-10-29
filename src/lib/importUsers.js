// Plantilla y lectura de Excel (.xlsx) para la importación masiva de usuarios.
// ExcelJS se carga con import dinámico, solo cuando se usa.

export const MAX_ROWS = 500
export const MAX_FILE_BYTES = 2 * 1024 * 1024

// Columnas de la plantilla, en el orden en que aparecen en el Excel
export const COLUMNS = [
  { key: 'full_name', header: 'Nombre', required: true, width: 32, aliases: ['nombre completo'] },
  { key: 'birth_date', header: 'Fecha de nacimiento', width: 22, numFmt: 'dd/mm/yyyy', aliases: ['nacimiento'] },
  { key: 'class_name', header: 'Clase', width: 14 },
  { key: 'group_name', header: 'Grupo', width: 14 },
  { key: 'promo', header: 'Promoción', width: 14 },
  { key: 'modules', header: 'Módulos', width: 28 },
  { key: 'phone', header: 'Teléfono', width: 18, numFmt: '@' },
  { key: 'email', header: 'Email', required: true, width: 34, aliases: ['correo', 'correo electronico', 'e-mail'] },
  { key: 'identification', header: 'Identificación', width: 20, numFmt: '@', aliases: ['dni', 'nie', 'documento'] },
]

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const PHONE_RE = /^[+0-9 ()\-.]{6,20}$/
const ID_RE = /^[A-Za-z0-9 .\-/]{3,30}$/

// Sin tildes, en minúsculas y sin espacios repetidos
const norm = (s) =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()

const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim()

// Texto de una celda (Excel convierte los emails en hipervínculos, fórmulas, etc.)
function cellText(cell) {
  if (!cell) return ''
  const v = cell.value
  if (v === null || v === undefined) return ''
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  return String(cell.text ?? v).trim()
}

function parseBirthDate(cell) {
  if (!cell) return { value: null }
  const v = cell.value
  if (v === null || v === undefined) return { value: null }

  let y, m, d
  if (v instanceof Date) {
    y = v.getUTCFullYear()
    m = v.getUTCMonth() + 1
    d = v.getUTCDate()
  } else if (typeof v === 'number') {
    const date = new Date(Math.round((v - 25569) * 86400000)) // número de serie de Excel
    y = date.getUTCFullYear()
    m = date.getUTCMonth() + 1
    d = date.getUTCDate()
  } else {
    const text = cellText(cell)
    if (!text) return { value: null }
    let match = text.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})$/)
    if (match) {
      d = Number(match[1])
      m = Number(match[2])
      y = Number(match[3])
    } else {
      match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/)
      if (!match) return { error: 'Fecha de nacimiento no válida (usa dd/mm/aaaa).' }
      y = Number(match[1])
      m = Number(match[2])
      d = Number(match[3])
    }
  }

  const check = new Date(Date.UTC(y, m - 1, d))
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d) {
    return { error: 'Fecha de nacimiento no válida.' }
  }
  if (y < 1900 || check > new Date()) return { error: 'Fecha de nacimiento fuera de rango.' }

  return { value: `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}` }
}

function validateRow(raw) {
  const errors = []
  const data = {
    full_name: clean(raw.full_name),
    email: clean(raw.email).toLowerCase(),
    identification: clean(raw.identification).toUpperCase(),
    phone: clean(raw.phone),
    class_name: clean(raw.class_name),
    group_name: clean(raw.group_name),
    promo: clean(raw.promo),
    birth_date: null,
    modules: [],
  }

  if (!data.full_name) errors.push('Falta el nombre.')
  else if (data.full_name.length > 100) errors.push('El nombre supera los 100 caracteres.')

  if (!data.email) errors.push('Falta el email.')
  else if (data.email.length > 254 || !EMAIL_RE.test(data.email)) errors.push('Email no válido.')

  if (data.identification && !ID_RE.test(data.identification)) errors.push('Identificación no válida.')
  if (data.phone && !PHONE_RE.test(data.phone)) errors.push('Teléfono no válido.')

  for (const [key, label] of [['class_name', 'Clase'], ['group_name', 'Grupo'], ['promo', 'Promoción']]) {
    if (data[key].length > 50) errors.push(`${label} demasiado largo (máximo 50).`)
  }

  if (raw.birth_date?.error) errors.push(raw.birth_date.error)
  else data.birth_date = raw.birth_date?.value ?? null

  // Varios módulos separados por punto y coma, coma o salto de línea
  const seen = new Set()
  for (const part of String(raw.modules ?? '').split(/[;,\n]+/)) {
    const name = clean(part)
    if (name && !seen.has(name.toLowerCase())) {
      seen.add(name.toLowerCase())
      data.modules.push(name)
    }
  }
  if (data.modules.length > 30 || data.modules.some((m) => m.length > 50)) {
    errors.push('Lista de módulos no válida.')
  }

  return { data, errors }
}

export async function parseUsersFile(file) {
  if (!file.name.toLowerCase().endsWith('.xlsx')) {
    throw new Error('El archivo debe ser un Excel .xlsx. Usa la plantilla.')
  }
  if (file.size > MAX_FILE_BYTES) throw new Error('El archivo es demasiado grande (máximo 2 MB).')

  const buffer = await file.arrayBuffer()
  const head = new Uint8Array(buffer.slice(0, 2))
  if (head[0] !== 0x50 || head[1] !== 0x4b) throw new Error('El archivo no es un Excel .xlsx válido.')

  const { default: ExcelJS } = await import('exceljs')
  const wb = new ExcelJS.Workbook()
  try {
    await wb.xlsx.load(buffer)
  } catch {
    throw new Error('No se pudo leer el Excel. Comprueba que no esté dañado ni protegido con contraseña.')
  }

  const ws = wb.getWorksheet('Usuarios') ?? wb.worksheets[0]
  if (!ws) throw new Error('El Excel no contiene hojas.')

  // Localiza cada columna por el texto de su encabezado (fila 1)
  const colByKey = {}
  ws.getRow(1).eachCell((cell, colNumber) => {
    const header = norm(cellText(cell))
    const column = COLUMNS.find((c) => [c.header, ...(c.aliases ?? [])].some((name) => norm(name) === header))
    if (column && !colByKey[column.key]) colByKey[column.key] = colNumber
  })

  const missing = COLUMNS.filter((c) => c.required && !colByKey[c.key]).map((c) => c.header)
  if (missing.length) {
    throw new Error(
      `Faltan columnas obligatorias: ${missing.join(', ')}. Descarga la plantilla y no cambies los encabezados.`
    )
  }

  const rows = []
  ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1 || !row.hasValues) return

    const raw = {}
    for (const c of COLUMNS) {
      const cell = colByKey[c.key] ? row.getCell(colByKey[c.key]) : null
      raw[c.key] = c.key === 'birth_date' ? parseBirthDate(cell) : cellText(cell)
    }
    if (COLUMNS.every((c) => c.key === 'birth_date' ? !raw.birth_date.value && !raw.birth_date.error : !raw[c.key])) return

    rows.push({ rowNumber, ...validateRow(raw) })
  })

  if (rows.length === 0) throw new Error('El archivo no contiene filas de usuarios.')
  if (rows.length > MAX_ROWS) throw new Error(`Demasiadas filas: el máximo es ${MAX_ROWS} por archivo.`)

  // Duplicados dentro del propio archivo
  const emails = new Map()
  const ids = new Map()
  for (const item of rows) {
    const { email, identification } = item.data
    if (email) {
      if (emails.has(email)) item.errors.push(`Email repetido (también en la fila ${emails.get(email)}).`)
      else emails.set(email, item.rowNumber)
    }
    if (identification) {
      if (ids.has(identification)) item.errors.push(`Identificación repetida (también en la fila ${ids.get(identification)}).`)
      else ids.set(identification, item.rowNumber)
    }
  }

  return rows
}

export async function downloadTemplate() {
  const { default: ExcelJS } = await import('exceljs')
  const wb = new ExcelJS.Workbook()

  // Hoja con los datos
  const ws = wb.addWorksheet('Usuarios', { views: [{ state: 'frozen', ySplit: 1 }] })
  ws.columns = COLUMNS.map((c) => ({ header: c.header, key: c.key, width: c.width }))
  COLUMNS.forEach((c, i) => {
    if (c.numFmt) ws.getColumn(i + 1).numFmt = c.numFmt
    const cell = ws.getRow(1).getCell(i + 1)
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: c.required ? 'FFC62828' : 'FF0A2540' }, // rojo = obligatorio
    }
  })

  // Hoja con las instrucciones
  const info = wb.addWorksheet('Instrucciones')
  info.columns = [{ width: 110 }]
  const lines = [
    'INSTRUCCIONES',
    '1. Rellena una fila por usuario en la hoja «Usuarios». Máximo 500 filas por archivo.',
    '2. Los encabezados en ROJO son obligatorios (Nombre y Email). El resto es opcional.',
    '3. No cambies ni borres los encabezados. Puedes reordenar las columnas.',
    '4. Fecha de nacimiento: formato dd/mm/aaaa (por ejemplo, 15/03/2001).',
    '5. Módulos: separa varios con punto y coma (por ejemplo, M1; M2; M3), tal como aparecen en la aplicación.',
    '6. Cada email debe ser único. Si un usuario ya existe, esa fila se marcará como error.',
    '7. Guarda el archivo como .xlsx y súbelo desde «Importar usuarios».',
  ]
  lines.forEach((text, i) => {
    const row = info.addRow([text])
    row.getCell(1).alignment = { wrapText: true, vertical: 'top' }
    if (i === 0) row.font = { bold: true, size: 14 }
  })

  const buffer = await wb.xlsx.writeBuffer()
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = 'plantilla_usuarios.xlsx'
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}