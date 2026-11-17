// 'AAAA-MM-DD…' → 'DD/MM/AAAA' (sin pasar por Date para evitar desfases de zona horaria)
export function formatDate(value) {
  if (!value) return '—'
  const [year, month, day] = String(value).slice(0, 10).split('-')
  return `${day}/${month}/${year}`
}

// Objetivos de una práctica: pueden venir como texto JSON o como lista desde Supabase
export function parseObjectives(value) {
  if (!value) return []
  if (Array.isArray(value)) return value.filter(Boolean)
  try { return (JSON.parse(value) || []).filter(Boolean) } catch { return [] }
}
