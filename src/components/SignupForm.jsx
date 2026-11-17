import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { getSupabaseErrorMessage } from '../lib/supabaseErrors.js'
import { KIND_LABEL } from '../lib/academic.js'
import Icon from './Icon.jsx'

// Acceso temporal tras confirmar el correo: la persona rellena su ficha y la envía a coordinación.
// Alumno: datos personales, curso (1º por defecto) y módulos. Profesor: datos y módulo + grupo que imparte.
// Mientras está enviada se ve en solo lectura; si la coordinación la devuelve, se ve el motivo y se puede corregir.

const PERSONAL = [
  ['full_name', 'Nombre completo', 'text', true],
  ['dni', 'DNI / NIE', 'text', false],
  ['birth_year', 'Año de nacimiento', 'number', false],
  ['phone', 'Teléfono', 'tel', false],
  ['address', 'Dirección', 'text', false],
  ['emergency_name', 'Contacto de emergencia', 'text', false],
  ['emergency_phone', 'Teléfono de emergencia', 'tel', false],
]
const EMPTY = { full_name: '', dni: '', birth_year: '', phone: '', address: '', emergency_name: '', emergency_phone: '', level: 1, module_ids: [], teaching: [] }
const pairKey = (pair) => `${pair.degree_module_id}|${pair.group_id}`

export default function SignupForm({ user, onLogout }) {
  const [options, setOptions] = useState(null)
  const [form, setForm] = useState(EMPTY)
  const [status, setStatus] = useState('borrador')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState(null)

  useEffect(() => {
    let active = true
    Promise.all([
      supabase.rpc('signup_options'),
      supabase.from('signup_forms').select('*').eq('profile_id', user.id).maybeSingle(),
    ]).then(([optionResult, formResult]) => {
      if (!active) return
      setOptions(optionResult.data || { modules: [], groups: [] })
      const saved = formResult.data
      if (saved) {
        setForm({ ...EMPTY, ...Object.fromEntries(Object.entries(saved).map(([key, value]) => [key, value ?? EMPTY[key] ?? ''])), teaching: saved.teaching || [], module_ids: saved.module_ids || [] })
        setStatus(saved.status)
        setReason(saved.return_reason || '')
      }
    })
    return () => { active = false }
  }, [user.id])

  const isStudent = (options?.role || user.role) !== 'profesor'
  const levels = useMemo(() => [...new Set((options?.modules || []).map((item) => item.level))].sort(), [options])
  const byLevel = useMemo(() => levels.map((level) => [level, (options?.modules || []).filter((item) => item.level === level)]), [levels, options])
  const sent = status === 'enviado'

  // Al cambiar de curso, se marcan por defecto los módulos de ese curso (y se quitan los del curso anterior)
  function chooseLevel(level) {
    const previous = (options?.modules || []).filter((item) => item.level === Number(form.level)).map((item) => item.id)
    const next = (options?.modules || []).filter((item) => item.level === level).map((item) => item.id)
    setForm({ ...form, level, module_ids: [...new Set([...form.module_ids.filter((id) => !previous.includes(id)), ...next])] })
  }
  // Primera vez: los módulos de 1º marcados
  useEffect(() => {
    if (!options || !isStudent || form.module_ids.length || status !== 'borrador') return
    const first = (options.modules || []).filter((item) => item.level === Number(form.level)).map((item) => item.id)
    // eslint-disable-next-line react-hooks/set-state-in-effect -- valor inicial al cargar las opciones
    if (first.length) setForm((current) => ({ ...current, module_ids: first }))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- solo al cargar
  }, [options])

  const toggleModule = (id) => setForm({ ...form, module_ids: form.module_ids.includes(id) ? form.module_ids.filter((item) => item !== id) : [...form.module_ids, id] })
  const togglePair = (pair) => {
    const key = pairKey(pair)
    setForm({ ...form, teaching: form.teaching.some((item) => pairKey(item) === key) ? form.teaching.filter((item) => pairKey(item) !== key) : [...form.teaching, pair] })
  }

  async function save(submit) {
    setBusy(true)
    setNotice(null)
    const { data, error } = await supabase.rpc('save_signup_form', { p_data: { ...form, level: Number(form.level) }, p_submit: submit })
    setBusy(false)
    if (error) { setNotice({ error: true, text: getSupabaseErrorMessage(error) }); return }
    setStatus(data)
    setNotice({ error: false, text: submit ? 'Enviada. La coordinación la revisará; te avisaremos cuando puedas entrar.' : 'Borrador guardado.' })
  }

  async function checkAgain() {
    const { data } = await supabase.from('profiles').select('status').eq('id', user.id).maybeSingle()
    if (data?.status === 'activo' || data?.status === 'rechazado') window.location.reload()
    else setNotice({ error: false, text: 'Todavía está en revisión.' })
  }

  if (!options) return <main className="flex min-h-screen items-center justify-center bg-canvas text-sm text-muted">Cargando…</main>

  return (
    <main className="min-h-screen bg-canvas px-4 py-8">
      <div className="mx-auto w-full max-w-2xl space-y-5">
        <header className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm text-muted">{options.school_name}</p>
            <h1 className="mt-1 text-2xl font-semibold text-ink">{sent ? 'Tu ficha está en revisión' : 'Completa tu ficha'}</h1>
            <p className="mt-1 text-sm text-muted">{sent
              ? 'La coordinación revisará tus datos y tus módulos. Cuando la apruebe podrás entrar con tu perfil.'
              : `Rellena tus datos y ${isStudent ? 'los módulos que cursas' : 'los módulos y grupos que impartes'}, y envíala a coordinación.`}</p>
          </div>
          <button type="button" className="btn-ghost shrink-0" onClick={onLogout}>Salir</button>
        </header>

        {status === 'devuelto' && reason && (
          <div className="notice-error text-sm"><p className="font-medium">La coordinación te pide que corrijas algo:</p><p className="mt-1 whitespace-pre-line">{reason}</p></div>
        )}
        {notice && <p role={notice.error ? 'alert' : 'status'} className={notice.error ? 'notice-error' : 'notice-success'}>{notice.text}</p>}

        <fieldset disabled={sent} className="space-y-5">
          <section className="card space-y-3 p-5">
            <div>
              <h2 className="font-semibold text-ink">Tus datos</h2>
              <p className="mt-0.5 text-xs text-muted">Solo el nombre es obligatorio. El resto son datos personales opcionales: solo los verá la coordinación de tu escuela.</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {PERSONAL.filter(([key]) => isStudent || ['full_name', 'phone'].includes(key)).map(([key, label, type, required]) => (
                <label key={key} className={`field text-sm ${key === 'address' || key === 'full_name' ? 'sm:col-span-2' : ''}`}>{label}{required ? ' *' : <span className="font-normal text-faint"> (opcional)</span>}
                  <input className="input" type={type} maxLength={150} min={type === 'number' ? 1900 : undefined} max={type === 'number' ? 2100 : undefined} placeholder={type === 'number' ? 'p. ej. 2005' : undefined} value={form[key] || ''} onChange={(event) => setForm({ ...form, [key]: event.target.value })} />
                </label>
              ))}
            </div>
          </section>

          {isStudent ? (
            <section className="card space-y-4 p-5">
              <div>
                <h2 className="font-semibold text-ink">Tu curso y tus módulos</h2>
                <p className="mt-0.5 text-sm text-muted">Elige tu curso: se marcan sus módulos. Desmarca los que no cursas y marca los de otro curso que tengas pendientes.</p>
              </div>
              <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Curso">
                {(levels.length ? levels : [1]).map((level) => (
                  <button key={level} type="button" role="radio" aria-checked={Number(form.level) === level} onClick={() => chooseLevel(level)}
                    className={`rounded-xl border px-4 py-2 text-sm font-semibold ${Number(form.level) === level ? 'border-accent bg-accent-soft text-accent-strong' : 'border-line text-ink-soft hover:bg-subtle'}`}>{level}º</button>
                ))}
              </div>
              {Number(form.level) !== 1 && <p className="rounded-lg bg-warn-soft px-3 py-2 text-xs text-warn">Has elegido {form.level}º: la coordinación lo verificará.</p>}
              {byLevel.map(([level, list]) => (
                <div key={level}>
                  <p className="mb-1.5 text-xs font-medium text-faint">{level}º curso</p>
                  <ul className="grid gap-1.5 sm:grid-cols-2">
                    {list.map((item) => (
                      <li key={item.id}>
                        <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-line px-3 py-2 text-sm hover:bg-subtle">
                          <input type="checkbox" checked={form.module_ids.includes(item.id)} onChange={() => toggleModule(item.id)} />
                          <span className="font-semibold tabular-nums text-ink">{item.module_id}</span>
                          <span className="min-w-0 flex-1 truncate text-ink-soft">{KIND_LABEL[item.kind]} · {item.name}</span>
                        </label>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </section>
          ) : (
            <section className="card space-y-4 p-5">
              <div>
                <h2 className="font-semibold text-ink">Lo que impartes</h2>
                <p className="mt-0.5 text-sm text-muted">Marca, en cada módulo, los grupos a los que das clase este curso.</p>
              </div>
              <ul className="space-y-2">
                {(options.modules || []).map((item) => {
                  const groups = (options.groups || []).filter((group) => group.degree_id === item.degree_id && group.level === item.level)
                  if (!groups.length) return null
                  return (
                    <li key={item.id} className="rounded-xl border border-line px-3 py-2 text-sm">
                      <p className="text-ink"><span className="font-semibold tabular-nums">{item.module_id}</span> <span className="text-ink-soft">{KIND_LABEL[item.kind]} · {item.name}</span></p>
                      <div className="mt-1.5 flex flex-wrap gap-3">
                        {groups.map((group) => {
                          const pair = { degree_module_id: item.id, group_id: group.id }
                          return (
                            <label key={group.id} className="inline-flex items-center gap-1.5 text-ink-soft">
                              <input type="checkbox" checked={form.teaching.some((entry) => pairKey(entry) === pairKey(pair))} onChange={() => togglePair(pair)} />{group.level}º{group.name}
                            </label>
                          )
                        })}
                      </div>
                    </li>
                  )
                })}
              </ul>
            </section>
          )}
        </fieldset>

        <div className="flex flex-wrap justify-end gap-2">
          {sent ? (
            <button type="button" className="btn-primary" onClick={checkAgain}><Icon name="clock" size={16} />Comprobar de nuevo</button>
          ) : (
            <>
              <button type="button" className="btn-secondary" disabled={busy} onClick={() => save(false)}>Guardar borrador</button>
              <button type="button" className="btn-primary" disabled={busy} onClick={() => save(true)}>{busy ? 'Enviando…' : 'Enviar a coordinación'}</button>
            </>
          )}
        </div>
      </div>
    </main>
  )
}
