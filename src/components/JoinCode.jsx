import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase.js'

const formatCode = (code) => (code ? `${code.slice(0, 4)}-${code.slice(4)}` : '')

// Código con el que alumnos y profesores se registran en una escuela.
export default function JoinCode({ schoolId }) {
  const [code, setCode] = useState('')
  const [feedback, setFeedback] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!schoolId) return
    let active = true
    supabase.from('schools').select('join_code').eq('id', schoolId).maybeSingle()
      .then(({ data }) => { if (active) setCode(data?.join_code || '') })
    return () => { active = false }
  }, [schoolId])

  async function copy() {
    try {
      await navigator.clipboard.writeText(formatCode(code))
      setFeedback('Copiado')
    } catch {
      setFeedback('No se pudo copiar')
    }
  }

  async function regenerate() {
    if (!window.confirm('El código actual dejará de funcionar. Quien ya tenga cuenta no se ve afectado. ¿Generar uno nuevo?')) return
    setBusy(true)
    const { data, error } = await supabase.rpc('regenerate_join_code', { p_school_id: schoolId })
    setBusy(false)
    if (error) { setFeedback(error.message); return }
    setCode(data)
    setFeedback('Código nuevo generado')
  }

  if (!code) return null

  return (
    <div>
      <h4 className="mb-1 text-sm font-semibold text-ink-soft">Código de registro</h4>
      <p className="mb-2 text-xs text-muted">Compártelo con alumnos y profesores. Se registran con él y su cuenta queda pendiente hasta que la apruebas.</p>
      <div className="flex flex-wrap items-center gap-2">
        <code className="rounded-lg bg-subtle px-3 py-2 text-base font-semibold tracking-widest text-ink">{formatCode(code)}</code>
        <button type="button" className="btn-secondary h-9" onClick={copy}>Copiar</button>
        <button type="button" className="btn-ghost h-9 text-muted" onClick={regenerate} disabled={busy}>Generar otro</button>
        {feedback && <span role="status" className="text-xs text-muted">{feedback}</span>}
      </div>
    </div>
  )
}
