// Descarga un Blob en el navegador.
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link) // Firefox exige que el enlace esté en el DOM
  link.click()
  link.remove()
  // Revocar en el mismo tick puede cancelar la descarga en Safari/Firefox
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

// Celda CSV entrecomillada y protegida contra inyección de fórmulas (=, +, -, @).
export function csvCell(value) {
  const text = String(value ?? '')
  const safe = /^[=+@\-\t\r]/.test(text) ? `'${text}` : text
  return `"${safe.replaceAll('"', '""')}"`
}

// Descarga filas como CSV con BOM para que Excel muestre bien tildes y eñes.
export function downloadCsv(rows, filename) {
  const content = rows.map((row) => row.map(csvCell).join(',')).join('\r\n')
  downloadBlob(new Blob(['﻿' + content], { type: 'text/csv;charset=utf-8' }), filename)
}
