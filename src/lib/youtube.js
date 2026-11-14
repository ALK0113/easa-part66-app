// Acepta una URL de YouTube (watch, youtu.be, embed, shorts) o un ID de 11 caracteres.
export function youtubeId(value) {
  const raw = String(value || '').trim()
  const match = raw.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/))([\w-]{11})/)
  return match?.[1] || (/^[\w-]{11}$/.test(raw) ? raw : '')
}
