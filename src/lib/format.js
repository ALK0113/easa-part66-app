// 'AAAA-MM-DD…' → 'DD/MM/AAAA' (sin pasar por Date para evitar desfases de zona horaria)
export function formatDate(value) {
  if (!value) return '—'
  const [year, month, day] = String(value).slice(0, 10).split('-')
  return `${day}/${month}/${year}`
}
