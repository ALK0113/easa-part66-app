import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { getSupabaseErrorMessage } from '../lib/supabaseErrors.js'
import { KIND_LABEL, groupLabel } from '../lib/academic.js'
import Modal from './Modal.jsx'

// Revisión de un alta por la coordinación: datos, curso y módulos (alumno) o módulo + grupo (profesor), todo editable.
// Aprobar crea la ficha y la matrícula del alumno (con su grupo) o las asignaciones del profesor.
// Devolver pide un motivo; rechazar cierra la solicitud.

const PERSONAL = [
  ['full_name', 'Nombre completo', 'text'], ['dni', 'DNI / NIE', 'text'], ['birth_year', 'Año de nacimiento', 'number'],
  ['phone', 'Teléfono', 'tel'], ['address', 'Dirección', 'text'], ['emergency_name', 'Contacto de emergencia', 'text'], ['emergency_phone', 'Teléfono de emergencia', 'tel'],
]
const pairKey = (pair) => `${pair.degree_module_id}|${pair.group_id}`

export default function SignupReview({ request, onClose, onDone }) {
  const isStudent = request.role !== 'profesor'
  const initial = request.form || {}
  const [form, setForm] = useState(() => ({
    full_name: initial.full_name || '', dni: initial.dni || '', birth_year: initial.birth_year || '', phone: initial.phone || '',
    address: initial.address || '', emergency_name: initial.emergency_name || '', emergency_phone: initial.emergency_phone || '',
    level: initial.level || 1, module_ids: initial.module_ids || [], teaching: initial.teaching || [],
  }))
  const [modules, setModules] = useState(null)
  const [groups, setGroups] = useState([])
  const [groupId, setGroupId] = useState('')
  const [extraGroups, setExtraGroups] = useState({})
  const [mode, setMode] = useState(null)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  // Módulos de los grados de la escuela y grupos del curso actual
  useEffect(() => {
    let active = true
    Promise.all([
      supabase.from('degree_modules').select('id,module_id,kind,level,degree_id,degrees!inner(code,school_id),modules(name)').eq('degrees.school_id', request.school_id).order('level').order('module_id'),
      supabase.from('class_groups').select('id,level,name,degree_id,academic_years!inner(is_current,school_id)').eq('academic_years.is_current', true).eq('academic_years.school_id', request.school_id).order('level').order('name'),
    ]).then(([moduleResult, groupResult]) => {
      if (!active) return
      setModules(moduleResult.data || [])
      setGroups(groupResult.data || [])
    })
    return () => { active = false }
  }, [request.school_id])

  const levels = useMemo(() => [...new Set((modules || []).map((item) => item.level))].sort(), [modules])
  const levelGroups = groups.filter((group) => group.level === Number(form.level))
  // '' = asignar más tarde
  const chosenGroup = groupId === 'later' ? '' : groupId || (levelGroups.length === 1 ? levelGroups[0].id : '')
  const homeGroup = groups.find((group) => group.id === chosenGroup)
  // Módulos marcados de otro curso o grado: con qué grupo los cursa
  const offLevel = (modules || []).filter((item) => form.module_ids.includes(item.id) && homeGroup && !(item.level === homeGroup.level && item.degree_id === homeGroup.degree_id))

  const toggleModule = (id) => setForm({ ...form, module_ids: form.module_ids.includes(id) ? form.module_ids.filter((item) => item !== id) : [...form.module_ids, id] })
  const togglePair = (pair) => {
    const key = pairKey(pair)
    setForm({ ...form, teaching: form.teaching.some((item) => pairKey(item) === key) ? form.teaching.filter((item) => pairKey(item) !== key) : [...form.teaching, pair] })
  }

  async function act(action) {
    if (action === 'reject' && !window.confirm(`¿Rechazar la solicitud de ${form.full_name || request.email}? No podrá entrar.`)) return
    setBusy(true)
    setError('')
    const { error: reviewError } = await supabase.rpc('review_signup', {
      p_profile_id: request.id,
      p_action: action,
      p_data: action === 'reject' ? null : { ...form, level: Number(form.level) },
      p_group_id: action === 'approve' && isStudent ? chosenGroup : null,
      p_reason: action === 'return' ? reason : null,
      p_extra_groups: extraGroups,
    })
    setBusy(false)
    if (reviewError) { setError(getSupabaseErrorMessage(reviewError)); return }
    onDone()
  }

  return (
    <Modal title={`Alta de ${form.full_name || request.email}`} onClose={onClose} wide>
      <p className="-mt-1 text-sm text-muted">{isStudent ? 'Alumno' : 'Profesor'} · {request.email}</p>
      {request.flag === 'profesor' && <p className="mt-3 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">Se ha registrado como <strong>profesor</strong>: confirma que lo es antes de aprobar.</p>}
      {request.flag === 'curso' && <p className="mt-3 rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn">Ha elegido <strong>{initial.level}º curso</strong>: verifica que es correcto.</p>}
      {request.form?.status !== 'enviado' && <p className="notice mt-3 text-sm">Todavía no ha enviado la ficha{request.form?.status === 'devuelto' ? ' corregida' : ''}. Puedes revisarla igualmente.</p>}

      <section className="mt-4 space-y-3">
        <h3 className="text-sm font-semibold text-ink">Datos</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          {PERSONAL.filter(([key]) => isStudent || ['full_name', 'phone'].includes(key)).map(([key, label, type]) => (
            <label key={key} className={`field text-sm ${key === 'address' || key === 'full_name' ? 'sm:col-span-2' : ''}`}>{label}
              <input className="input" type={type} value={form[key] || ''} onChange={(event) => setForm({ ...form, [key]: event.target.value })} />
            </label>
          ))}
        </div>
      </section>

      {modules === null ? <p className="mt-4 text-sm text-muted">Cargando módulos…</p> : isStudent ? (
        <section className="mt-5 space-y-3">
          <h3 className="text-sm font-semibold text-ink">Curso, grupo y módulos</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="field text-sm">Curso
              <select className="input" value={form.level} onChange={(event) => { setForm({ ...form, level: Number(event.target.value) }); setGroupId('') }}>
                {(levels.length ? levels : [1]).map((level) => <option key={level} value={level}>{level}º</option>)}
              </select>
            </label>
            <label className="field text-sm">Grupo
              <select className="input" value={groupId === 'later' ? 'later' : chosenGroup || 'later'} onChange={(event) => setGroupId(event.target.value)}>
                <option value="later">Asignar más tarde</option>
                {levelGroups.map((group) => <option key={group.id} value={group.id}>{groupLabel(group)}</option>)}
              </select>
            </label>
          </div>
          {!chosenGroup && <p className="text-xs text-muted">Sin grupo: al aprobar, el alumno podrá entrar y se le asigna el grupo más tarde en Escuela → Alumnos.</p>}
          {levels.map((level) => (
            <div key={level}>
              <p className="mb-1 text-xs font-medium text-faint">{level}º curso</p>
              <ul className="grid gap-1.5 sm:grid-cols-2">
                {modules.filter((item) => item.level === level).map((item) => (
                  <li key={item.id}>
                    <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-line px-2.5 py-1.5 text-sm hover:bg-subtle">
                      <input type="checkbox" checked={form.module_ids.includes(item.id)} onChange={() => toggleModule(item.id)} />
                      <span className="font-semibold tabular-nums text-ink">{item.module_id}</span>
                      <span className="min-w-0 flex-1 truncate text-ink-soft">{KIND_LABEL[item.kind]} · {item.modules?.name}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          {offLevel.length > 0 && (
            <div className="rounded-xl border border-line p-3">
              <p className="mb-2 text-xs font-medium text-ink-soft">Módulos de otro curso: ¿con qué grupo los cursa?</p>
              {offLevel.map((item) => {
                const options = groups.filter((group) => group.level === item.level && group.degree_id === item.degree_id)
                return (
                  <label key={item.id} className="mb-1.5 flex items-center gap-3 text-sm">
                    <span className="w-40 shrink-0 truncate text-ink">{item.module_id} {KIND_LABEL[item.kind]}</span>
                    <select className="input h-9 py-0" value={extraGroups[item.id] || options[0]?.id || ''} onChange={(event) => setExtraGroups({ ...extraGroups, [item.id]: event.target.value })}>
                      {options.length === 0 && <option value="">Sin grupos de ese curso</option>}
                      {options.map((group) => <option key={group.id} value={group.id}>{groupLabel(group)}</option>)}
                    </select>
                  </label>
                )
              })}
            </div>
          )}
        </section>
      ) : (
        <section className="mt-5 space-y-2">
          <h3 className="text-sm font-semibold text-ink">Lo que imparte</h3>
          {modules.map((item) => {
            const options = groups.filter((group) => group.degree_id === item.degree_id && group.level === item.level)
            if (!options.length) return null
            return (
              <div key={item.id} className="rounded-lg border border-line px-3 py-2 text-sm">
                <p className="text-ink"><span className="font-semibold tabular-nums">{item.module_id}</span> <span className="text-ink-soft">{KIND_LABEL[item.kind]} · {item.modules?.name}</span></p>
                <div className="mt-1 flex flex-wrap gap-3">
                  {options.map((group) => {
                    const pair = { degree_module_id: item.id, group_id: group.id }
                    return (
                      <label key={group.id} className="inline-flex items-center gap-1.5 text-ink-soft">
                        <input type="checkbox" checked={form.teaching.some((entry) => pairKey(entry) === pairKey(pair))} onChange={() => togglePair(pair)} />{groupLabel(group)}
                      </label>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </section>
      )}

      {mode === 'return' && (
        <label className="field mt-5 text-sm">Motivo (lo verá al entrar)
          <textarea className="input" rows={3} maxLength={1000} autoFocus value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Por ejemplo: revisa tu DNI y marca también M07 práctica." />
        </label>
      )}
      {error && <p role="alert" className="notice-error mt-4">{error}</p>}

      <div className="mt-5 flex flex-wrap items-center justify-between gap-2">
        <button type="button" className="btn-ghost text-danger" disabled={busy} onClick={() => act('reject')}>Rechazar</button>
        <div className="flex flex-wrap gap-2">
          {mode === 'return'
            ? <button type="button" className="btn-secondary" disabled={busy || !reason.trim()} onClick={() => act('return')}>Enviar y devolver</button>
            : <button type="button" className="btn-secondary" disabled={busy} onClick={() => setMode('return')}>Devolver para corregir</button>}
          <button type="button" className="btn-primary" disabled={busy} onClick={() => act('approve')}>{busy ? 'Guardando…' : 'Aprobar'}</button>
        </div>
      </div>
    </Modal>
  )
}
