import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { useSchool } from '../contexts/useSchool.js'
import { subscribeToTables } from '../lib/supabaseRealtime.js'
import { getSupabaseErrorMessage } from '../lib/supabaseErrors.js'
import { KIND_LABEL, groupLabel } from '../lib/academic.js'
import { isManager } from '../lib/roles.js'
import Icon from './Icon.jsx'

// Notas del curso actual por clase (módulo + grupo).
// Teoría: nota con la escala de la escuela. Práctica: Apto / No apto. Se guarda sola.

const classKey = (groupId, degreeModuleId) => `${groupId}|${degreeModuleId}`
const STATUS_STYLE = { aprobado: 'bg-success-soft text-success', suspendido: 'bg-danger-soft text-danger' }
const STATUS_LABEL = { aprobado: 'Aprobado', suspendido: 'Suspendido', cursando: 'Pendiente' }

// initialClass: { group_id, degree_module_id } al llegar desde «Mis grupos» (se abre esa hoja directamente)
export default function Grades({ user, initialClass = null }) {
  const { filterId } = useSchool()
  const isAdmin = isManager(user.role)
  const [classes, setClasses] = useState(null)
  const [selected, setSelected] = useState(() => (initialClass ? classKey(initialClass.group_id, initialClass.degree_module_id) : ''))
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState({})

  // Clases que puede calificar: las suyas (profesor) o todas las que tienen alumnos (administración)
  useEffect(() => {
    let active = true
    async function load() {
      try {
        let list = []
        if (isAdmin) {
          const { data, error: loadError } = await supabase
            .from('module_enrollments')
            .select('group_id,degree_module_id,class_groups(level,name),degree_modules(module_id,kind),academic_years!inner(is_current,school_id,schools(grade_max,pass_mark))')
            .eq('academic_years.is_current', true)
            .match(filterId ? { 'academic_years.school_id': filterId } : {})
          if (loadError) throw loadError
          const seen = new Map()
          ;(data || []).forEach((row) => {
            const key = classKey(row.group_id, row.degree_module_id)
            if (!seen.has(key)) seen.set(key, { key, groupId: row.group_id, degreeModuleId: row.degree_module_id, group: row.class_groups, module: row.degree_modules, scale: row.academic_years?.schools })
          })
          list = [...seen.values()]
        } else {
          const { data, error: loadError } = await supabase
            .from('teaching_assignments')
            .select('group_id,degree_module_id,class_groups!inner(level,name,academic_years!inner(is_current,schools(grade_max,pass_mark))),degree_modules(module_id,kind)')
            .eq('profile_id', user.id)
            .eq('class_groups.academic_years.is_current', true)
          if (loadError) throw loadError
          list = (data || []).map((row) => ({ key: classKey(row.group_id, row.degree_module_id), groupId: row.group_id, degreeModuleId: row.degree_module_id, group: row.class_groups, module: row.degree_modules, scale: row.class_groups?.academic_years?.schools }))
        }
        list.sort((a, b) => a.module.module_id.localeCompare(b.module.module_id) || b.module.kind.localeCompare(a.module.kind) || groupLabel(a.group).localeCompare(groupLabel(b.group)))
        if (!active) return
        setClasses(list)
        setSelected((current) => (list.some((item) => item.key === current) ? current : list[0]?.key || ''))
      } catch (err) {
        if (active) setError(getSupabaseErrorMessage(err))
      }
    }
    load()
    const unsubscribe = subscribeToTables(['teaching_assignments', 'module_enrollments'], load, `grades-classes-${user.id}`)
    return () => { active = false; unsubscribe() }
  }, [isAdmin, user.id, filterId])

  const current = classes?.find((item) => item.key === selected)
  const scale = current?.scale || { grade_max: 100, pass_mark: 75 }

  useEffect(() => {
    if (!current) return undefined
    let active = true
    supabase
      .from('module_enrollments')
      .select('id,student_id,is_carryover,theory_grade,practical_result,status,students(name,student_number),academic_years!inner(is_current)')
      .eq('group_id', current.groupId)
      .eq('degree_module_id', current.degreeModuleId)
      .eq('academic_years.is_current', true)
      .then(({ data, error: loadError }) => {
        if (!active) return
        if (loadError) { setError(getSupabaseErrorMessage(loadError)); return }
        setRows((data || []).sort((a, b) => (a.students?.name || '').localeCompare(b.students?.name || '')))
        setError('')
      })
    return () => { active = false }
  }, [current])

  async function save(row, values) {
    setSaving((state) => ({ ...state, [row.id]: true }))
    const { data, error: saveError } = await supabase.rpc('set_module_grade', {
      p_module_enrollment_id: row.id,
      p_theory_grade: values.theory_grade ?? null,
      p_practical_result: values.practical_result ?? null,
    })
    setSaving((state) => ({ ...state, [row.id]: false }))
    if (saveError) { setError(getSupabaseErrorMessage(saveError)); return false }
    setError('')
    setRows((list) => list.map((item) => (item.id === row.id ? { ...item, ...data } : item)))
    return true
  }

  const summary = useMemo(() => {
    const list = rows || []
    return {
      total: list.length,
      passed: list.filter((row) => row.status === 'aprobado').length,
      failed: list.filter((row) => row.status === 'suspendido').length,
    }
  }, [rows])

  if (classes === null && !error) return <p className="text-sm text-muted">Cargando…</p>

  return (
    <div className="space-y-5">
      <div className="page-intro">
        <div>
          <h2>Notas</h2>
          <p>Teoría sobre {Number(scale.grade_max)} (aprueba con {Number(scale.pass_mark)}). Práctica: Apto o No apto. Se guarda sola.</p>
        </div>
      </div>

      {error && <p role="alert" className="notice-error">{error}</p>}

      {classes?.length === 0 ? (
        <div className="card empty">
          <p className="font-medium text-ink-soft">{isAdmin ? 'Aún no hay alumnos matriculados en módulos' : 'No tienes clases asignadas este curso'}</p>
          <p className="mt-1">{isAdmin ? 'Matricula los grupos en Asignaciones.' : 'Administración te asigna módulos y grupos.'}</p>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Clase">
            {classes?.map((item) => (
              <button key={item.key} type="button" role="radio" aria-checked={item.key === selected} onClick={() => { setRows(null); setSelected(item.key) }}
                className={`rounded-xl border px-3.5 py-2 text-sm ${item.key === selected ? 'border-accent bg-accent-soft font-semibold text-accent-strong' : 'border-line text-ink-soft hover:bg-subtle'}`}>
                {item.module.module_id} {KIND_LABEL[item.module.kind].toLowerCase()} · {groupLabel(item.group)}
              </button>
            ))}
          </div>

          {current && (
            <section className="card overflow-hidden">
              <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-5 py-3.5">
                <h3 className="font-semibold text-ink">{current.module.module_id} · {KIND_LABEL[current.module.kind]} · {groupLabel(current.group)}</h3>
                <p className="text-sm text-muted">{summary.passed} aprobados · {summary.failed} suspendidos · {summary.total - summary.passed - summary.failed} pendientes</p>
              </header>
              {rows === null && <p className="empty">Cargando…</p>}
              {rows?.length === 0 && <p className="empty">No hay alumnos en esta clase.</p>}
              {rows?.length > 0 && (
                <ul className="divide-y divide-line">
                  {rows.map((row) => (
                    <li key={row.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3">
                      <div className="min-w-[160px] flex-1">
                        <p className="font-medium text-ink">{row.students?.name || 'Alumno'}</p>
                        <p className="text-xs text-muted">Nº {row.students?.student_number || '—'}{row.is_carryover ? ' · Arrastrado' : ''}</p>
                      </div>
                      {current.module.kind === 'teoria'
                        ? <GradeInput row={row} max={Number(scale.grade_max)} busy={saving[row.id]} onSave={(value) => save(row, { theory_grade: value })} />
                        : <PracticalInput value={row.practical_result} busy={saving[row.id]} onChange={(value) => save(row, { practical_result: value })} />}
                      <span className={`badge w-24 justify-center ${STATUS_STYLE[row.status] || ''}`}>{STATUS_LABEL[row.status] || 'Pendiente'}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}
        </>
      )}
    </div>
  )
}

function GradeInput({ row, max, busy, onSave }) {
  const [value, setValue] = useState(row.theory_grade == null ? '' : String(Number(row.theory_grade)))
  const lastSaved = useRef(value)

  async function commit() {
    const trimmed = value.trim().replace(',', '.')
    if (trimmed === lastSaved.current) return
    const number = trimmed === '' ? null : Number(trimmed)
    if (number !== null && (Number.isNaN(number) || number < 0 || number > max)) { setValue(lastSaved.current); return }
    if (await onSave(number)) lastSaved.current = trimmed
    else setValue(lastSaved.current)
  }

  return (
    <label className="flex items-center gap-2 text-sm text-muted">
      <span className="sr-only">Nota</span>
      <input className="input w-24 text-right tabular-nums" inputMode="decimal" placeholder="—" value={value} disabled={busy}
        onChange={(event) => setValue(event.target.value)} onBlur={commit}
        onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur() }} />
      <span className="w-10">/ {max}</span>
      {busy && <Icon name="clock" size={14} className="text-faint" />}
    </label>
  )
}

const PRACTICAL = [
  { value: 'apto', label: 'Apto', active: 'bg-success-soft text-success border-success' },
  { value: 'no_apto', label: 'No apto', active: 'bg-danger-soft text-danger border-danger' },
]

function PracticalInput({ value, busy, onChange }) {
  return (
    <div role="group" aria-label="Resultado" className="inline-flex gap-1">
      {PRACTICAL.map((option) => {
        const selected = value === option.value
        return (
          <button key={option.value} type="button" disabled={busy} aria-pressed={selected} onClick={() => onChange(selected ? null : option.value)}
            className={`h-9 min-w-[72px] rounded-lg border px-3 text-xs font-semibold disabled:opacity-50 ${selected ? option.active : 'border-line bg-surface text-muted hover:border-line-strong hover:text-ink'}`}>
            {option.label}
          </button>
        )
      })}
    </div>
  )
}
