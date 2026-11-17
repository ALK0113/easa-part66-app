import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { getSupabaseErrorMessage } from '../lib/supabaseErrors.js'
import { formatDate } from '../lib/format.js'
import { outcomeLabel } from '../lib/curriculum.js'
import { groupLabel } from '../lib/academic.js'
import Icon from './Icon.jsx'
import Modal from './Modal.jsx'

const KIND = { examen: 'Examen', evaluacion: 'Evaluación' }
const SCOPE = { parcial: 'parcial', ra: 'de RA entera' }

// Exámenes (parciales o de una RA entera) y evaluaciones de una clase teórica o práctica,
// con la nota de cada alumno. La nota final del módulo se sigue poniendo a mano en «Notas».
export default function Assessments({ user, schoolId, moduleId, theoryClassId = null, practiceId = null, outcomes = [], canEdit }) {
  const isStudent = user.role === 'alumno'
  const [items, setItems] = useState(null)
  const [grades, setGrades] = useState([])
  const [students, setStudents] = useState([])
  const [openId, setOpenId] = useState(null)
  const [form, setForm] = useState(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState(null)
  const ownerColumn = theoryClassId ? 'theory_class_id' : 'practice_id'
  const ownerId = theoryClassId || practiceId

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('assessments').select('id,kind,scope,learning_outcome_id,title,date,start_time,end_time,visible_to_students,max_grade').eq(ownerColumn, ownerId).order('date', { nullsFirst: false }).order('created_at')
    if (error) { setNotice({ error: true, text: getSupabaseErrorMessage(error) }); return }
    setItems(data || [])
    const ids = (data || []).map((item) => item.id)
    // El alumno solo recibe sus propias notas (lo garantiza la base de datos)
    const gradeResult = ids.length ? await supabase.from('assessment_grades').select('assessment_id,student_id,grade,comment').in('assessment_id', ids) : { data: [] }
    setGrades(gradeResult.data || [])
  }, [ownerColumn, ownerId])

  useEffect(() => {
    let active = true
    supabase.from('assessments').select('id,kind,scope,learning_outcome_id,title,date,start_time,end_time,visible_to_students,max_grade').eq(ownerColumn, ownerId).order('date', { nullsFirst: false }).order('created_at')
      .then(async ({ data, error }) => {
        if (!active) return
        if (error) { setNotice({ error: true, text: getSupabaseErrorMessage(error) }); return }
        setItems(data || [])
        const ids = (data || []).map((item) => item.id)
        const gradeResult = ids.length ? await supabase.from('assessment_grades').select('assessment_id,student_id,grade,comment').in('assessment_id', ids) : { data: [] }
        if (active) setGrades(gradeResult.data || [])
      })
    return () => { active = false }
  }, [ownerColumn, ownerId])

  // Alumnos del módulo este curso (para poner notas)
  useEffect(() => {
    if (!canEdit) return undefined
    let active = true
    let query = supabase.from('module_enrollments')
      .select('student_id,students(id,name,student_number),class_groups(level,name),degree_modules!inner(module_id),academic_years!inner(is_current,school_id)')
      .eq('degree_modules.module_id', moduleId).eq('academic_years.is_current', true)
    if (schoolId) query = query.eq('academic_years.school_id', schoolId)
    query.then(({ data }) => {
      if (!active) return
      const byId = new Map()
      ;(data || []).forEach((row) => { if (row.students && !byId.has(row.student_id)) byId.set(row.student_id, { ...row.students, group: groupLabel(row.class_groups) }) })
      setStudents([...byId.values()].sort((a, b) => a.name.localeCompare(b.name)))
    })
    return () => { active = false }
  }, [canEdit, moduleId, schoolId])

  async function save(event) {
    event.preventDefault()
    if (!schoolId) { setNotice({ error: true, text: 'Elige una escuela en el selector de arriba.' }); return }
    setBusy(true)
    const values = {
      kind: form.kind,
      scope: form.kind === 'examen' ? form.scope : null,
      learning_outcome_id: form.learning_outcome_id || null,
      title: form.title.trim(),
      date: form.date || null,
      start_time: form.date && form.start_time ? form.start_time : null,
      end_time: form.date && form.start_time && form.end_time ? form.end_time : null,
      visible_to_students: form.visible_to_students !== false,
      max_grade: Number(form.max_grade) || 10,
    }
    if (values.start_time && values.end_time && values.end_time <= values.start_time) { setBusy(false); setNotice({ error: true, text: 'La hora de fin tiene que ser posterior al inicio.' }); return }
    const { error } = form.id
      ? await supabase.from('assessments').update(values).eq('id', form.id)
      : await supabase.from('assessments').insert({ ...values, school_id: schoolId, module_id: moduleId, [ownerColumn]: ownerId })
    setBusy(false)
    if (error) { setNotice({ error: true, text: getSupabaseErrorMessage(error) }); return }
    setForm(null)
    setNotice({ error: false, text: form.id ? 'Guardado.' : `${KIND[values.kind]} creado. Ábrelo para poner las notas.` })
    await load()
  }

  async function remove(item) {
    if (!window.confirm(`¿Eliminar «${item.title}» y sus notas?`)) return
    const { error } = await supabase.from('assessments').delete().eq('id', item.id)
    if (error) { setNotice({ error: true, text: getSupabaseErrorMessage(error) }); return }
    setOpenId(null)
    await load()
  }

  async function saveGrade(item, student, text) {
    const value = text.trim() === '' ? null : Number(text.replace(',', '.'))
    if (value !== null && (!Number.isFinite(value) || value < 0 || value > Number(item.max_grade))) {
      setNotice({ error: true, text: `Nota de ${student.name}: debe estar entre 0 y ${item.max_grade}.` })
      return
    }
    const current = grades.find((row) => row.assessment_id === item.id && row.student_id === student.id)
    if ((current?.grade ?? null) === value) return
    const { error } = await supabase.from('assessment_grades').upsert({ assessment_id: item.id, student_id: student.id, grade: value, updated_by: user.id, updated_at: new Date().toISOString() })
    if (error) { setNotice({ error: true, text: getSupabaseErrorMessage(error) }); return }
    setNotice(null)
    setGrades((rows) => [...rows.filter((row) => !(row.assessment_id === item.id && row.student_id === student.id)), { assessment_id: item.id, student_id: student.id, grade: value }])
  }

  const outcomeOf = (id) => outcomes.find((outcome) => outcome.id === id)
  const describe = (item) => [item.kind === 'examen' ? `${KIND.examen} ${SCOPE[item.scope] || ''}` : KIND.evaluacion, outcomeOf(item.learning_outcome_id) && outcomeLabel(outcomeOf(item.learning_outcome_id)), item.date && `${formatDate(item.date)}${item.start_time ? ` · ${String(item.start_time).slice(0, 5)}${item.end_time ? `–${String(item.end_time).slice(0, 5)}` : ''}` : ''}`, `sobre ${Number(item.max_grade)}`, item.kind === 'examen' && item.date && item.visible_to_students === false && 'solo profesorado'].filter(Boolean).join(' · ')

  return (
    <section className="card p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold text-ink">Exámenes y evaluaciones</h3>
        {canEdit && <button type="button" className="btn-secondary h-9" onClick={() => setForm({ kind: 'examen', scope: 'parcial', learning_outcome_id: '', title: '', date: '', start_time: '', end_time: '', visible_to_students: true, max_grade: 10 })}><Icon name="plus" size={14} />Nuevo</button>}
      </div>
      {notice && <p role={notice.error ? 'alert' : 'status'} className={`mb-3 ${notice.error ? 'notice-error' : 'notice-success'}`}>{notice.text}</p>}
      {items === null ? <p className="text-sm text-muted">Cargando…</p> : items.length === 0 ? <p className="text-sm text-muted">Sin exámenes ni evaluaciones.</p> : (
        <ul className="divide-y divide-line rounded-xl border border-line">
          {items.map((item) => {
            const itemGrades = grades.filter((row) => row.assessment_id === item.id && row.grade != null)
            const own = isStudent ? itemGrades[0] : null
            return (
              <li key={item.id}>
                <button type="button" className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-subtle" onClick={() => setOpenId(openId === item.id ? null : item.id)} disabled={isStudent}>
                  <span className={`badge ${item.kind === 'examen' ? 'bg-accent-soft text-accent-strong' : ''}`}>{KIND[item.kind]}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-ink">{item.title}</span>
                    <span className="block text-xs text-muted">{describe(item)}</span>
                  </span>
                  {isStudent
                    ? <span className="shrink-0 text-sm font-semibold tabular-nums text-ink">{own ? `${Number(own.grade)} / ${Number(item.max_grade)}` : 'Sin nota'}</span>
                    : <span className="shrink-0 text-xs text-muted">{itemGrades.length}/{students.length} notas</span>}
                </button>
                {canEdit && openId === item.id && (
                  <div className="space-y-2 border-t border-line bg-subtle/40 px-4 py-3">
                    {students.length === 0 ? <p className="text-sm text-muted">No hay alumnos matriculados en {moduleId} este curso.</p> : (
                      <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
                        {students.map((student) => {
                          const row = grades.find((grade) => grade.assessment_id === item.id && grade.student_id === student.id)
                          return (
                            <li key={student.id} className="flex items-center gap-3 px-3 py-1.5 text-sm">
                              <span className="min-w-0 flex-1 truncate text-ink">{student.name} <span className="text-xs text-muted">{student.group}</span></span>
                              <input key={`${student.id}-${row?.grade ?? ''}`} className="input h-8 w-20 py-0 text-right tabular-nums" inputMode="decimal" aria-label={`Nota de ${student.name}`} defaultValue={row?.grade ?? ''}
                                onBlur={(event) => saveGrade(item, student, event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur() }} />
                              <span className="w-10 text-xs text-muted">/ {Number(item.max_grade)}</span>
                            </li>
                          )
                        })}
                      </ul>
                    )}
                    <div className="flex justify-end gap-2">
                      <button type="button" className="btn-ghost text-sm" onClick={() => setForm({ ...item, learning_outcome_id: item.learning_outcome_id || '', date: item.date || '', start_time: item.start_time ? String(item.start_time).slice(0, 5) : '', end_time: item.end_time ? String(item.end_time).slice(0, 5) : '', visible_to_students: item.visible_to_students !== false })}><Icon name="edit" size={14} />Editar</button>
                      <button type="button" className="btn-ghost text-sm text-danger" onClick={() => remove(item)}><Icon name="trash" size={14} />Eliminar</button>
                    </div>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {form && (
        <Modal title={form.id ? 'Editar' : 'Nuevo examen o evaluación'} onClose={() => setForm(null)}>
          <form className="space-y-4" onSubmit={save}>
            <div className="flex gap-2" role="radiogroup" aria-label="Tipo">
              {Object.entries(KIND).map(([value, label]) => (
                <label key={value} className="choice flex-1"><input type="radio" name="kind" checked={form.kind === value} onChange={() => setForm({ ...form, kind: value })} />{label}</label>
              ))}
            </div>
            {form.kind === 'examen' && (
              <div className="flex gap-2" role="radiogroup" aria-label="Alcance">
                <label className="choice flex-1"><input type="radio" name="scope" checked={form.scope === 'parcial'} onChange={() => setForm({ ...form, scope: 'parcial' })} />Parcial</label>
                <label className="choice flex-1"><input type="radio" name="scope" checked={form.scope === 'ra'} onChange={() => setForm({ ...form, scope: 'ra' })} />De una RA entera</label>
              </div>
            )}
            <label className="field">RA{form.kind === 'examen' && form.scope === 'ra' ? '' : ' (opcional)'}
              <select className="input" value={form.learning_outcome_id} required={form.kind === 'examen' && form.scope === 'ra'} onChange={(event) => setForm({ ...form, learning_outcome_id: event.target.value })}>
                <option value="">{outcomes.length ? 'Sin RA' : 'Este módulo aún no tiene RA (Escuela → Grado y módulos)'}</option>
                {outcomes.map((outcome) => <option key={outcome.id} value={outcome.id}>{outcomeLabel(outcome)} – {outcome.description.slice(0, 80)}</option>)}
              </select>
            </label>
            <label className="field">Título<input className="input" required maxLength={200} value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder={form.kind === 'examen' ? 'Examen parcial 1' : 'Evaluación de la práctica'} /></label>
            <div className="grid grid-cols-2 gap-3">
              <label className="field">Fecha<input className="input" type="date" value={form.date} onChange={(event) => setForm({ ...form, date: event.target.value })} /></label>
              <label className="field">Nota máxima<input className="input" type="number" min="1" step="0.5" required value={form.max_grade} onChange={(event) => setForm({ ...form, max_grade: event.target.value })} /></label>
            </div>
            {form.kind === 'examen' && form.date && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <label className="field">Empieza (opcional)<input className="input" type="time" value={form.start_time || ''} onChange={(event) => setForm({ ...form, start_time: event.target.value })} /></label>
                  <label className="field">Termina (opcional)<input className="input" type="time" value={form.end_time || ''} disabled={!form.start_time} onChange={(event) => setForm({ ...form, end_time: event.target.value })} /></label>
                </div>
                <label className="flex items-start gap-2 text-sm text-ink-soft">
                  <input type="checkbox" className="mt-0.5" checked={form.visible_to_students !== false} onChange={(event) => setForm({ ...form, visible_to_students: event.target.checked })} />
                  <span>Avisar a los alumnos
                    <span className="block text-xs text-muted">{form.visible_to_students !== false ? 'Saldrá en el horario y en las próximas clases de los alumnos del módulo, de su profesorado y de coordinación.' : 'Solo lo verán el profesorado del módulo y coordinación; los alumnos no.'}</span>
                  </span>
                </label>
              </>
            )}
            <div className="flex justify-end gap-2"><button type="button" className="btn-secondary" onClick={() => setForm(null)}>Cancelar</button><button className="btn-primary" disabled={busy}>{busy ? 'Guardando…' : 'Guardar'}</button></div>
          </form>
        </Modal>
      )}
    </section>
  )
}
