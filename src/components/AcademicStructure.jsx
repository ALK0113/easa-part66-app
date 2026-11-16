import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { useSchool } from '../contexts/useSchool.js'
import { subscribeToTables } from '../lib/supabaseRealtime.js'
import { getSupabaseErrorMessage } from '../lib/supabaseErrors.js'
import Modal from './Modal.jsx'
import Icon from './Icon.jsx'
import { KIND_LABEL, groupLabel, levelLabel } from '../lib/academic.js'
import CloseYear from './CloseYear.jsx'
import ImportModules from './ImportModules.jsx'
import Holidays from './Holidays.jsx'

// Estructura académica de una escuela: grados y sus módulos, grupos por curso escolar,
// promociones, cursos escolares y escala de calificación.

const TABS = [
  { id: 'degrees', label: 'Grados y módulos' },
  { id: 'groups', label: 'Grupos' },
  { id: 'cohorts', label: 'Promociones' },
  { id: 'years', label: 'Cursos escolares' },
  { id: 'grading', label: 'Calificación' },
]


function friendlyError(error) {
  const message = getSupabaseErrorMessage(error)
  if (error?.code === '23505') return 'Ya existe uno con ese nombre.'
  if (error?.code === '23503') return 'No se puede eliminar: tiene alumnos o datos asociados.'
  return message
}

function useSchoolStructure(schoolId) {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [version, setVersion] = useState(0)
  const reload = useCallback(() => setVersion((value) => value + 1), [])

  useEffect(() => {
    if (!schoolId) return undefined
    let active = true
    async function load() {
      try {
        const [degrees, years, cohorts, modules, school] = await Promise.all([
          supabase.from('degrees').select('id,code,name,created_at,degree_modules(id,module_id,kind,level,hours)').eq('school_id', schoolId).order('created_at'),
          supabase.from('academic_years').select('id,name,starts_on,ends_on,is_current').eq('school_id', schoolId).order('starts_on', { ascending: false }),
          supabase.from('cohorts').select('id,name,degree_id,students(count)').eq('school_id', schoolId).order('name', { ascending: false }),
          supabase.from('modules').select('id,name,school_id').order('id'),
          supabase.from('schools').select('id,name,grade_max,pass_mark').eq('id', schoolId).maybeSingle(),
        ])
        const failed = [degrees, years, cohorts, modules, school].find((result) => result.error)
        if (failed) throw failed.error
        const yearIds = (years.data || []).map((year) => year.id)
        const groups = yearIds.length
          ? await supabase.from('class_groups').select('id,academic_year_id,degree_id,level,name,enrollments(count)').in('academic_year_id', yearIds).order('level').order('name')
          : { data: [] }
        if (groups.error) throw groups.error
        if (!active) return
        setData({
          schoolId,
          degrees: degrees.data || [],
          years: years.data || [],
          cohorts: cohorts.data || [],
          modules: modules.data || [],
          school: school.data,
          groups: groups.data || [],
        })
        setError('')
      } catch (err) {
        if (active) setError(getSupabaseErrorMessage(err))
      }
    }
    load()
    const unsubscribe = subscribeToTables(['degrees', 'degree_modules', 'academic_years', 'cohorts', 'class_groups', 'enrollments', 'modules'], load, `structure-${schoolId}`)
    return () => { active = false; unsubscribe() }
  }, [schoolId, version])

  return { data: data?.schoolId === schoolId ? data : null, error, reload }
}

// tab + embedded: la página «Escuela» elige la sección y pone sus propios pasos
export default function AcademicStructure({ tab: fixedTab = null, embedded = false } = {}) {
  const { schoolId } = useSchool()
  const [ownTab, setTab] = useState('degrees')
  const tab = fixedTab || ownTab
  const [notice, setNotice] = useState(null)

  const { data, error, reload } = useSchoolStructure(schoolId)

  // Ejecuta un cambio y muestra el resultado de forma discreta.
  const run = useCallback(async (promise, okText) => {
    const { error: saveError } = await promise
    if (saveError) { setNotice({ error: true, text: friendlyError(saveError) }); return false }
    setNotice(okText ? { error: false, text: okText } : null)
    reload()
    return true
  }, [reload])

  return (
    <div className="space-y-5">
      {!embedded && (
        <>
          <div className="page-intro">
            <div>
              <h2>Estructura académica</h2>
              <p>Grados, módulos, grupos y promociones de la escuela.</p>
            </div>
          </div>

          <div className="tabs" role="tablist">
            {TABS.map((item) => (
              <button key={item.id} type="button" role="tab" className="tab" aria-selected={tab === item.id} onClick={() => setTab(item.id)}>{item.label}</button>
            ))}
          </div>
        </>
      )}

      {notice && <p role={notice.error ? 'alert' : 'status'} className={notice.error ? 'notice-error' : 'notice-success'}>{notice.text}</p>}
      {error && <p role="alert" className="notice-error">{error}</p>}
      {!data && !error && <p className="text-sm text-muted">Cargando…</p>}

      {data && tab === 'degrees' && <DegreesTab data={data} schoolId={schoolId} run={run} reload={reload} notify={setNotice} />}
      {data && tab === 'groups' && <GroupsTab data={data} run={run} />}
      {data && tab === 'cohorts' && <CohortsTab data={data} schoolId={schoolId} run={run} />}
      {data && tab === 'years' && <YearsTab data={data} schoolId={schoolId} run={run} reload={reload} notify={setNotice} />}
      {data && tab === 'grading' && <GradingTab school={data.school} run={run} />}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Grados y módulos                                                    */
/* ------------------------------------------------------------------ */

function DegreesTab({ data, schoolId, run, reload, notify }) {
  const [editingDegree, setEditingDegree] = useState(null) // {} nuevo · degree editar
  const [importingDegree, setImportingDegree] = useState(null) // grado al que se importan módulos
  const [editingModule, setEditingModule] = useState(null) // { degree, item? }
  const moduleName = useMemo(() => Object.fromEntries(data.modules.map((mod) => [mod.id, mod.name])), [data.modules])

  async function saveDegree(form) {
    const values = { code: form.code.trim(), name: form.name.trim() || null }
    const ok = editingDegree.id
      ? await run(supabase.from('degrees').update(values).eq('id', editingDegree.id), 'Grado guardado.')
      : await run(supabase.from('degrees').insert({ ...values, school_id: schoolId }), 'Grado creado.')
    if (ok) setEditingDegree(null)
  }

  async function deleteDegree(degree) {
    if (!window.confirm(`¿Eliminar el grado ${degree.code}? Se eliminarán también sus módulos y grupos.`)) return
    if (await run(supabase.from('degrees').delete().eq('id', degree.id), 'Grado eliminado.')) setEditingDegree(null)
  }

  async function saveModule(form) {
    const values = { module_id: form.module_id, kind: form.kind, level: form.level ? Number(form.level) : null, hours: form.hours === '' ? null : Number(form.hours) }
    const { degree, item } = editingModule
    const ok = item
      ? await run(supabase.from('degree_modules').update(values).eq('id', item.id), 'Módulo guardado.')
      : await run(supabase.from('degree_modules').insert({ ...values, degree_id: degree.id }), 'Módulo añadido.')
    if (ok) setEditingModule(null)
  }

  async function deleteModule(item) {
    if (!window.confirm(`¿Quitar ${item.module_id} (${KIND_LABEL[item.kind]}) del grado?`)) return
    if (await run(supabase.from('degree_modules').delete().eq('id', item.id), 'Módulo quitado del grado.')) setEditingModule(null)
  }

  return (
    <div className="space-y-4">
      {data.degrees.length === 0 && (
        <div className="card empty"><p className="font-medium text-ink-soft">Esta escuela aún no tiene grados</p><p className="mt-1">Crea el primero, por ejemplo B1.1.</p></div>
      )}

      {data.degrees.map((degree) => {
        const byLevel = new Map()
        ;[...degree.degree_modules]
          .sort((a, b) => a.module_id.localeCompare(b.module_id) || b.kind.localeCompare(a.kind))
          .forEach((item) => {
            const key = item.level || 0
            if (!byLevel.has(key)) byLevel.set(key, [])
            byLevel.get(key).push(item)
          })
        const levels = [...byLevel.keys()].sort((a, b) => (a || 99) - (b || 99))
        return (
          <section key={degree.id} className="card p-5 md:p-6">
            <header className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="text-lg font-semibold text-ink">{degree.code}</h3>
                {degree.name && <p className="text-sm text-muted">{degree.name}</p>}
                {degree.degree_modules.some((item) => item.hours != null) && (() => {
                  // Total del grado: lo calcula la aplicación a partir de las horas de cada módulo
                  const sum = (kind) => degree.degree_modules.filter((item) => !kind || item.kind === kind).reduce((acc, item) => acc + (item.hours || 0), 0)
                  return <p className="mt-1 text-xs tabular-nums text-muted">Total {sum()} h · {sum('teoria')} teoría · {sum('practica')} práctica</p>
                })()}
              </div>
              <div className="flex gap-2">
                <button type="button" className="btn-ghost" onClick={() => setEditingDegree(degree)}><Icon name="edit" size={16} />Editar</button>
                <button type="button" className="btn-ghost" onClick={() => setImportingDegree(degree)}><Icon name="upload" size={16} />Importar</button>
                <button type="button" className="btn-secondary" onClick={() => setEditingModule({ degree })}><Icon name="plus" size={16} />Módulo</button>
              </div>
            </header>

            {levels.length === 0 ? (
              <p className="mt-4 text-sm text-muted">Sin módulos todavía. Añádelos uno a uno o impórtalos todos de un archivo CSV o JSON.</p>
            ) : (
              <div className="mt-4 space-y-4">
                {levels.map((level) => (
                  <div key={level}>
                    <p className="mb-1.5 text-xs font-medium text-faint">{levelLabel(level)}</p>
                    <ul className="divide-y divide-line rounded-xl border border-line">
                      {byLevel.get(level).map((item) => (
                        <li key={item.id}>
                          <button type="button" className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-subtle" onClick={() => setEditingModule({ degree, item })}>
                            <span className="w-12 shrink-0 text-sm font-semibold tabular-nums text-ink">{item.module_id}</span>
                            <span className="min-w-0 flex-1 truncate text-sm text-ink-soft">{moduleName[item.module_id] || ''}</span>
                            <span className={`badge ${item.kind === 'practica' ? 'bg-accent-soft text-accent-strong' : ''}`}>{KIND_LABEL[item.kind]}</span>
                            {item.hours != null && <span className="hidden w-12 text-right text-xs tabular-nums text-muted sm:block">{item.hours} h</span>}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </section>
        )
      })}

      <button type="button" className="btn-secondary" onClick={() => setEditingDegree({})}><Icon name="plus" size={16} />Nuevo grado</button>

      {editingDegree && (
        <DegreeForm degree={editingDegree} onSave={saveDegree} onDelete={editingDegree.id ? () => deleteDegree(editingDegree) : null} onClose={() => setEditingDegree(null)} />
      )}
      {importingDegree && (
        <ImportModules
          degree={importingDegree}
          modules={data.modules}
          schoolId={schoolId}
          onClose={() => setImportingDegree(null)}
          onDone={(text) => { setImportingDegree(null); notify({ error: false, text }); reload() }}
        />
      )}
      {editingModule && (
        <DegreeModuleForm
          entry={editingModule}
          modules={data.modules}
          onSave={saveModule}
          onDelete={editingModule.item ? () => deleteModule(editingModule.item) : null}
          onClose={() => setEditingModule(null)}
        />
      )}
    </div>
  )
}

function FormActions({ onDelete, saving }) {
  return (
    <div className="flex items-center justify-between gap-3 pt-2">
      {onDelete ? <button type="button" className="btn-ghost text-danger" onClick={onDelete}><Icon name="trash" size={16} />Eliminar</button> : <span />}
      <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Guardando…' : 'Guardar'}</button>
    </div>
  )
}

function useSubmit(onSave) {
  const [saving, setSaving] = useState(false)
  const submit = async (event, form) => {
    event.preventDefault()
    setSaving(true)
    await onSave(form)
    setSaving(false)
  }
  return [saving, submit]
}

function DegreeForm({ degree, onSave, onDelete, onClose }) {
  const [form, setForm] = useState({ code: degree.code || '', name: degree.name || '' })
  const [saving, submit] = useSubmit(onSave)
  return (
    <Modal title={degree.id ? 'Editar grado' : 'Nuevo grado'} onClose={onClose}>
      <form className="space-y-4" onSubmit={(event) => submit(event, form)}>
        <label className="field">Código<input className="input" required maxLength={20} placeholder="B1.1" value={form.code} onChange={(event) => setForm({ ...form, code: event.target.value })} /></label>
        <label className="field">Nombre<input className="input" placeholder="Técnico de mantenimiento B1.1" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
        <FormActions onDelete={onDelete} saving={saving} />
      </form>
    </Modal>
  )
}

function DegreeModuleForm({ entry, modules, onSave, onDelete, onClose }) {
  const { degree, item } = entry
  const [form, setForm] = useState({
    module_id: item?.module_id || modules[0]?.id || '',
    kind: item?.kind || 'teoria',
    level: item?.level ? String(item.level) : '1',
    hours: item?.hours ?? '',
  })
  const [saving, submit] = useSubmit(onSave)
  return (
    <Modal title={item ? `${item.module_id} · ${degree.code}` : `Añadir módulo a ${degree.code}`} onClose={onClose}>
      <form className="space-y-4" onSubmit={(event) => submit(event, form)}>
        <label className="field">Módulo
          <select className="input" value={form.module_id} onChange={(event) => setForm({ ...form, module_id: event.target.value })} required>
            {modules.map((mod) => <option key={mod.id} value={mod.id}>{mod.id} · {mod.name}</option>)}
          </select>
        </label>
        <fieldset className="field">
          <legend className="mb-1.5">Tipo</legend>
          <div className="grid grid-cols-2 gap-2">
            {Object.entries(KIND_LABEL).map(([value, label]) => (
              <label key={value} className="choice"><input type="radio" name="kind" value={value} checked={form.kind === value} onChange={() => setForm({ ...form, kind: value })} />{label}</label>
            ))}
          </div>
        </fieldset>
        <div className="grid grid-cols-2 gap-3">
          <label className="field">Curso
            <select className="input" value={form.level} onChange={(event) => setForm({ ...form, level: event.target.value })}>
              <option value="">Sin curso</option>
              {[1, 2, 3, 4].map((level) => <option key={level} value={level}>{level}º</option>)}
            </select>
          </label>
          <label className="field">Horas<input className="input" type="number" min="0" inputMode="numeric" value={form.hours} onChange={(event) => setForm({ ...form, hours: event.target.value })} /></label>
        </div>
        <FormActions onDelete={onDelete} saving={saving} />
      </form>
    </Modal>
  )
}

/* ------------------------------------------------------------------ */
/* Grupos                                                              */
/* ------------------------------------------------------------------ */

function GroupsTab({ data, run }) {
  const currentYear = data.years.find((year) => year.is_current) || data.years[0]
  const [yearId, setYearId] = useState(currentYear?.id || '')
  const [editing, setEditing] = useState(null)
  const [bulkOpen, setBulkOpen] = useState(false)
  const groups = data.groups.filter((group) => group.academic_year_id === yearId)

  async function save(form) {
    const values = { degree_id: form.degree_id, level: Number(form.level), name: form.name.trim().toUpperCase() }
    const ok = editing.id
      ? await run(supabase.from('class_groups').update(values).eq('id', editing.id), 'Grupo guardado.')
      : await run(supabase.from('class_groups').insert({ ...values, academic_year_id: yearId }), 'Grupo creado.')
    if (ok) setEditing(null)
  }

  async function remove(group) {
    if (!window.confirm(`¿Eliminar el grupo ${groupLabel(group)}?`)) return
    if (await run(supabase.from('class_groups').delete().eq('id', group.id), 'Grupo eliminado.')) setEditing(null)
  }

  if (!data.years.length) return <div className="card empty"><p className="font-medium text-ink-soft">Primero crea un curso escolar</p><p className="mt-1">Los grupos pertenecen a un curso escolar.</p></div>
  if (!data.degrees.length) return <div className="card empty"><p className="font-medium text-ink-soft">Primero crea un grado</p></div>

  return (
    <div className="space-y-4">
      <select className="input w-auto" value={yearId} onChange={(event) => setYearId(event.target.value)} aria-label="Curso escolar">
        {data.years.map((year) => <option key={year.id} value={year.id}>{year.name}{year.is_current ? ' (actual)' : ''}</option>)}
      </select>

      {data.degrees.map((degree) => {
        const items = groups.filter((group) => group.degree_id === degree.id)
        return (
          <section key={degree.id} className="card p-5 md:p-6">
            <h3 className="font-semibold text-ink">{degree.code}</h3>
            {items.length === 0 ? <p className="mt-2 text-sm text-muted">Sin grupos en este curso escolar.</p> : (
              <ul className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {items.map((group) => {
                  const count = group.enrollments?.[0]?.count || 0
                  return (
                    <li key={group.id}>
                      <button type="button" onClick={() => setEditing(group)} className="flex w-full items-center justify-between rounded-xl border border-line px-4 py-3 text-left hover:bg-subtle">
                        <span className="font-semibold text-ink">{groupLabel(group)}</span>
                        <span className="text-sm text-muted">{count} {count === 1 ? 'alumno' : 'alumnos'}</span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </section>
        )
      })}

      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-primary" onClick={() => setBulkOpen(true)}><Icon name="plus" size={16} />Crear grupos de una vez</button>
        <button type="button" className="btn-secondary" onClick={() => setEditing({ degree_id: data.degrees[0].id, level: 1, name: '' })}><Icon name="plus" size={16} />Nuevo grupo</button>
      </div>

      {bulkOpen && <BulkGroupsForm degrees={data.degrees} existing={groups} onClose={() => setBulkOpen(false)} onSave={async (rows) => {
        if (await run(supabase.from('class_groups').insert(rows.map((row) => ({ ...row, academic_year_id: yearId }))), `${rows.length} ${rows.length === 1 ? 'grupo creado' : 'grupos creados'}.`)) setBulkOpen(false)
      }} />}

      {editing && (
        <GroupForm group={editing} degrees={data.degrees} onSave={save} onDelete={editing.id ? () => remove(editing) : null} onClose={() => setEditing(null)} />
      )}
    </div>
  )
}

// Varios grupos en un paso: los cursos del grado (según sus módulos) × las letras elegidas. Los que ya existen se saltan.
function BulkGroupsForm({ degrees, existing, onSave, onClose }) {
  const [degreeId, setDegreeId] = useState(degrees[0]?.id || '')
  const degree = degrees.find((item) => item.id === degreeId)
  const degreeLevels = [...new Set((degree?.degree_modules || []).map((item) => item.level).filter(Boolean))].sort()
  const [levels, setLevels] = useState(() => (degreeLevels.length ? degreeLevels : [1, 2]))
  const [perLevel, setPerLevel] = useState(1)
  const [saving, setSaving] = useState(false)
  const letters = 'ABCDEFGH'.slice(0, perLevel).split('')
  const rows = levels.flatMap((level) => letters.map((name) => ({ degree_id: degreeId, level, name })))
    .filter((row) => !existing.some((group) => group.degree_id === row.degree_id && group.level === row.level && group.name === row.name))
  const toggleLevel = (level) => setLevels((current) => (current.includes(level) ? current.filter((item) => item !== level) : [...current, level].sort()))
  return (
    <Modal title="Crear grupos de una vez" onClose={onClose}>
      <form className="space-y-4" onSubmit={async (event) => { event.preventDefault(); setSaving(true); await onSave(rows); setSaving(false) }}>
        {degrees.length > 1 && (
          <label className="field">Grado
            <select className="input" value={degreeId} onChange={(event) => setDegreeId(event.target.value)}>
              {degrees.map((item) => <option key={item.id} value={item.id}>{item.code}</option>)}
            </select>
          </label>
        )}
        <fieldset>
          <legend className="mb-1.5 text-sm font-medium text-ink-soft">Cursos</legend>
          <div className="flex flex-wrap gap-2">
            {[1, 2, 3, 4].map((level) => (
              <label key={level} className="choice"><input type="checkbox" checked={levels.includes(level)} onChange={() => toggleLevel(level)} />{level}º</label>
            ))}
          </div>
        </fieldset>
        <label className="field max-w-40">Grupos por curso
          <select className="input" value={perLevel} onChange={(event) => setPerLevel(Number(event.target.value))}>
            {[1, 2, 3, 4].map((count) => <option key={count} value={count}>{count} ({'ABCD'.slice(0, count).split('').join(', ')})</option>)}
          </select>
        </label>
        <p className="text-sm text-muted">{rows.length ? `Se crearán: ${rows.map((row) => `${row.level}º${row.name}`).join(', ')}.` : 'Ya existen todos esos grupos.'}</p>
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose}>Cancelar</button>
          <button type="submit" className="btn-primary" disabled={saving || !rows.length}>{saving ? 'Creando…' : 'Crear grupos'}</button>
        </div>
      </form>
    </Modal>
  )
}

function GroupForm({ group, degrees, onSave, onDelete, onClose }) {
  const [form, setForm] = useState({ degree_id: group.degree_id, level: String(group.level || 1), name: group.name || '' })
  const [saving, submit] = useSubmit(onSave)
  return (
    <Modal title={group.id ? `Grupo ${groupLabel(group)}` : 'Nuevo grupo'} onClose={onClose}>
      <form className="space-y-4" onSubmit={(event) => submit(event, form)}>
        {degrees.length > 1 && (
          <label className="field">Grado
            <select className="input" value={form.degree_id} onChange={(event) => setForm({ ...form, degree_id: event.target.value })}>
              {degrees.map((degree) => <option key={degree.id} value={degree.id}>{degree.code}</option>)}
            </select>
          </label>
        )}
        <div className="grid grid-cols-2 gap-3">
          <label className="field">Curso
            <select className="input" value={form.level} onChange={(event) => setForm({ ...form, level: event.target.value })}>
              {[1, 2, 3, 4].map((level) => <option key={level} value={level}>{level}º</option>)}
            </select>
          </label>
          <label className="field">Grupo<input className="input" required maxLength={20} placeholder="A" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
        </div>
        {group.id && <p className="text-xs text-muted">Si cambias el nombre, los alumnos del grupo se actualizan solos.</p>}
        <FormActions onDelete={onDelete} saving={saving} />
      </form>
    </Modal>
  )
}

/* ------------------------------------------------------------------ */
/* Promociones                                                         */
/* ------------------------------------------------------------------ */

function CohortsTab({ data, schoolId, run }) {
  const [editing, setEditing] = useState(null)

  async function save(form) {
    const values = { name: form.name.trim(), degree_id: form.degree_id || null }
    const ok = editing.id
      ? await run(supabase.from('cohorts').update(values).eq('id', editing.id), 'Promoción guardada.')
      : await run(supabase.from('cohorts').insert({ ...values, school_id: schoolId }), 'Promoción creada.')
    if (ok) setEditing(null)
  }

  async function remove(cohort) {
    if (!window.confirm(`¿Eliminar la promoción ${cohort.name}? Sus alumnos quedarán sin promoción.`)) return
    if (await run(supabase.from('cohorts').delete().eq('id', cohort.id), 'Promoción eliminada.')) setEditing(null)
  }

  const degreeCode = Object.fromEntries(data.degrees.map((degree) => [degree.id, degree.code]))

  return (
    <div className="space-y-4">
      {data.cohorts.length === 0 ? (
        <div className="card empty"><p className="font-medium text-ink-soft">Sin promociones</p><p className="mt-1">Una promoción agrupa a los alumnos que empezaron el mismo año.</p></div>
      ) : (
        <ul className="card divide-y divide-line overflow-hidden">
          {data.cohorts.map((cohort) => {
            const count = cohort.students?.[0]?.count || 0
            return (
              <li key={cohort.id}>
                <button type="button" onClick={() => setEditing(cohort)} className="flex w-full items-center gap-3 px-5 py-3.5 text-left hover:bg-subtle">
                  <span className="flex-1 font-medium text-ink">Promoción {cohort.name}</span>
                  {cohort.degree_id && <span className="badge">{degreeCode[cohort.degree_id]}</span>}
                  <span className="w-24 text-right text-sm text-muted">{count} {count === 1 ? 'alumno' : 'alumnos'}</span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
      <button type="button" className="btn-secondary" onClick={() => setEditing({ name: String(new Date().getFullYear()), degree_id: data.degrees[0]?.id || '' })}><Icon name="plus" size={16} />Nueva promoción</button>

      {editing && (
        <Modal title={editing.id ? `Promoción ${editing.name}` : 'Nueva promoción'} onClose={() => setEditing(null)}>
          <CohortForm cohort={editing} degrees={data.degrees} onSave={save} onDelete={editing.id ? () => remove(editing) : null} />
        </Modal>
      )}
    </div>
  )
}

function CohortForm({ cohort, degrees, onSave, onDelete }) {
  const [form, setForm] = useState({ name: cohort.name || '', degree_id: cohort.degree_id || '' })
  const [saving, submit] = useSubmit(onSave)
  return (
    <form className="space-y-4" onSubmit={(event) => submit(event, form)}>
      <label className="field">Nombre<input className="input" required maxLength={50} placeholder="2025" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
      {degrees.length > 0 && (
        <label className="field">Grado
          <select className="input" value={form.degree_id} onChange={(event) => setForm({ ...form, degree_id: event.target.value })}>
            <option value="">Sin grado</option>
            {degrees.map((degree) => <option key={degree.id} value={degree.id}>{degree.code}</option>)}
          </select>
        </label>
      )}
      <FormActions onDelete={onDelete} saving={saving} />
    </form>
  )
}

/* ------------------------------------------------------------------ */
/* Cursos escolares                                                    */
/* ------------------------------------------------------------------ */

function nextYearDraft(years) {
  const latest = years[0]
  const start = latest ? Number(latest.starts_on.slice(0, 4)) + 1 : new Date().getFullYear()
  return { name: `${start}-${String((start + 1) % 100).padStart(2, '0')}`, starts_on: `${start}-09-01`, ends_on: `${start + 1}-07-31`, is_current: false }
}

function YearsTab({ data, schoolId, run, reload, notify }) {
  const [editing, setEditing] = useState(null)
  const [closing, setClosing] = useState(false)

  async function save(form) {
    const values = { name: form.name.trim(), starts_on: form.starts_on, ends_on: form.ends_on }
    if (editing.id) {
      if (await run(supabase.from('academic_years').update(values).eq('id', editing.id), 'Curso escolar guardado.')) setEditing(null)
      return
    }
    // Al crearlo, la ficha sigue abierta para añadir sus festivos y vacaciones
    const { data: created, error: createError } = await supabase.from('academic_years').insert({ ...values, school_id: schoolId }).select('id,name,starts_on,ends_on,is_current').single()
    if (createError) { notify({ error: true, text: friendlyError(createError) }); return }
    notify({ error: false, text: 'Curso escolar creado. Añade ahora sus festivos y vacaciones.' })
    reload()
    setEditing(created)
  }

  async function makeCurrent(year) {
    const current = data.years.find((item) => item.is_current)
    if (current && !(await run(supabase.from('academic_years').update({ is_current: false }).eq('id', current.id)))) return
    if (await run(supabase.from('academic_years').update({ is_current: true }).eq('id', year.id), `${year.name} es ahora el curso actual.`)) setEditing(null)
  }

  async function remove(year) {
    if (!window.confirm(`¿Eliminar el curso escolar ${year.name}? Se eliminarán sus grupos y matrículas.`)) return
    if (await run(supabase.from('academic_years').delete().eq('id', year.id), 'Curso escolar eliminado.')) setEditing(null)
  }

  const formatDay = (value) => new Date(`${value}T00:00:00`).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' })

  if (closing) {
    return (
      <CloseYear
        schoolId={schoolId}
        years={data.years}
        degrees={data.degrees}
        onClose={() => setClosing(false)}
        onDone={(finished, text) => {
          reload()
          if (finished) { setClosing(false); notify({ error: false, text }) }
        }}
      />
    )
  }

  const current = data.years.find((year) => year.is_current)

  return (
    <div className="space-y-4">
      <ul className="card divide-y divide-line overflow-hidden">
        {data.years.map((year) => (
          <li key={year.id}>
            <button type="button" onClick={() => setEditing(year)} className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-5 py-3.5 text-left hover:bg-subtle">
              <span className="font-medium text-ink">{year.name}</span>
              {year.is_current && <span className="badge bg-success-soft text-success">Actual</span>}
              <span className="ml-auto text-sm text-muted">{formatDay(year.starts_on)} – {formatDay(year.ends_on)}</span>
              <span className="text-xs text-faint">Fechas, festivos y vacaciones ›</span>
            </button>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-secondary" onClick={() => setEditing(nextYearDraft(data.years))}><Icon name="plus" size={16} />Nuevo curso escolar</button>
        {current && <button type="button" className="btn-ghost" onClick={() => setClosing(true)}><Icon name="next" size={16} />Cerrar el curso {current.name}</button>}
      </div>

      {editing && (
        <Modal title={editing.id ? `Curso ${editing.name}` : 'Nuevo curso escolar'} onClose={() => setEditing(null)} wide>
          <YearForm
            key={editing.id || 'new'}
            year={editing}
            onSave={save}
            onMakeCurrent={editing.id && !editing.is_current ? () => makeCurrent(editing) : null}
            onDelete={editing.id && !editing.is_current ? () => remove(editing) : null}
          />
          {editing.id
            ? <div className="mt-5"><Holidays key={editing.id} year={editing} /></div>
            : <p className="mt-4 text-sm text-muted">Al crearlo podrás añadir aquí sus festivos y vacaciones.</p>}
        </Modal>
      )}
    </div>
  )
}

function YearForm({ year, onSave, onMakeCurrent, onDelete }) {
  const [form, setForm] = useState({ name: year.name, starts_on: year.starts_on, ends_on: year.ends_on })
  const [saving, submit] = useSubmit(onSave)
  return (
    <form className="space-y-4" onSubmit={(event) => submit(event, form)}>
      <label className="field">Nombre<input className="input" required maxLength={20} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
      <div className="grid grid-cols-2 gap-3">
        <label className="field">Empieza<input className="input" type="date" required value={form.starts_on} onChange={(event) => setForm({ ...form, starts_on: event.target.value })} /></label>
        <label className="field">Termina<input className="input" type="date" required value={form.ends_on} onChange={(event) => setForm({ ...form, ends_on: event.target.value })} /></label>
      </div>
      {onMakeCurrent && <button type="button" className="btn-secondary w-full" onClick={onMakeCurrent}><Icon name="check" size={16} />Marcar como curso actual</button>}
      <FormActions onDelete={onDelete} saving={saving} />
    </form>
  )
}

/* ------------------------------------------------------------------ */
/* Calificación                                                        */
/* ------------------------------------------------------------------ */

function GradingTab({ school, run }) {
  const [form, setForm] = useState({ grade_max: String(school?.grade_max ?? 100), pass_mark: String(school?.pass_mark ?? 75) })
  const [saving, submit] = useSubmit(async (values) => {
    const max = Number(values.grade_max)
    const pass = Number(values.pass_mark)
    await run(supabase.from('schools').update({ grade_max: max, pass_mark: Math.min(pass, max) }).eq('id', school.id), 'Escala guardada.')
  })
  const presets = [{ label: '0–100 %', max: 100, pass: 75 }, { label: '0–10', max: 10, pass: 5 }]

  return (
    <form className="card max-w-lg space-y-4 p-5 md:p-6" onSubmit={(event) => submit(event, form)}>
      <div>
        <h3 className="font-semibold text-ink">Nota de teoría</h3>
        <p className="mt-1 text-sm text-muted">Escala con la que se califican los módulos de teoría. Los de práctica se califican como Apto o No apto.</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {presets.map((preset) => (
          <button key={preset.label} type="button" className="btn-secondary" onClick={() => setForm({ grade_max: String(preset.max), pass_mark: String(preset.pass) })}>{preset.label}, aprueba con {preset.pass}</button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <label className="field">Nota máxima<input className="input" type="number" min="1" step="0.01" required value={form.grade_max} onChange={(event) => setForm({ ...form, grade_max: event.target.value })} /></label>
        <label className="field">Aprueba con<input className="input" type="number" min="0" step="0.01" max={form.grade_max} required value={form.pass_mark} onChange={(event) => setForm({ ...form, pass_mark: event.target.value })} /></label>
      </div>
      <div className="flex justify-end"><button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Guardando…' : 'Guardar'}</button></div>
    </form>
  )
}
