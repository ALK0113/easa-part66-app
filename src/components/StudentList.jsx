import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { useSchool } from '../contexts/useSchool.js'
import { subscribeToTables } from '../lib/supabaseRealtime.js'
import { getSupabaseErrorMessage } from '../lib/supabaseErrors.js'
import { KIND_LABEL, groupLabel } from '../lib/academic.js'
import Icon from './Icon.jsx'
import Modal from './Modal.jsx'

// Curso, grupo y promoción salen de la estructura académica (matrícula del curso actual).
const STUDENT_COLUMNS = 'id, name, student_number, class_name, group_name, promo, cohorts(name), enrollments(level, status, academic_years(name, is_current), class_groups(level, name))'

function toRow(student) {
  const current = (student.enrollments || []).find((enrollment) => enrollment.academic_years?.is_current)
  const group = current?.class_groups
  return {
    id: student.id,
    name: student.name,
    number: student.student_number,
    level: current ? `${current.level}º` : student.class_name || '',
    group: group ? groupLabel(group) : student.group_name || '',
    promo: student.cohorts?.name || student.promo || '',
  }
}

const unique = (values) => [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es', { numeric: true }))

export default function StudentList() {
  const { filterId } = useSchool()
  const [students, setStudents] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [filters, setFilters] = useState({ level: '', group: '', promo: '' })
  const [selected, setSelected] = useState(null)

  useEffect(() => {
    let active = true
    async function load() {
      let query = supabase.from('students').select(STUDENT_COLUMNS).order('name')
      if (filterId) query = query.eq('school_id', filterId)
      const { data, error: loadError } = await query
      if (!active) return
      if (loadError) setError(getSupabaseErrorMessage(loadError))
      else { setStudents((data || []).map(toRow)); setError('') }
      setLoading(false)
    }
    load()
    const unsubscribe = subscribeToTables(['students', 'enrollments', 'class_groups', 'cohorts'], load, 'student-list')
    return () => { active = false; unsubscribe() }
  }, [filterId])

  const options = useMemo(() => ({
    level: unique(students.map((student) => student.level)),
    group: unique(students.filter((student) => !filters.level || student.level === filters.level).map((student) => student.group)),
    promo: unique(students.map((student) => student.promo)),
  }), [students, filters.level])

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase()
    return students.filter((student) =>
      (!query || [student.name, String(student.number || ''), student.group, student.promo].some((value) => value?.toLowerCase().includes(query)))
      && (!filters.level || student.level === filters.level)
      && (!filters.group || student.group === filters.group)
      && (!filters.promo || student.promo === filters.promo))
  }, [students, search, filters])

  const hasFilters = search || filters.level || filters.group || filters.promo
  const setFilter = (key, value) => setFilters((current) => ({ ...current, [key]: value, ...(key === 'level' ? { group: '' } : {}) }))

  if (loading) return <div className="flex min-h-[40vh] items-center justify-center text-sm text-muted">Cargando alumnos…</div>

  if (error) {
    return (
      <div role="alert" className="card p-6 text-center">
        <p className="font-medium text-ink">No se pudo cargar el listado</p>
        <p className="mt-1 text-sm text-muted">{error}</p>
        <button onClick={() => window.location.reload()} className="btn-secondary mt-4">Reintentar</button>
      </div>
    )
  }

  const filterSelect = (key, placeholder, format = (value) => value) => (
    <select value={filters[key]} onChange={(event) => setFilter(key, event.target.value)} className="input" aria-label={placeholder}>
      <option value="">{placeholder}</option>
      {options[key].map((option) => <option key={option} value={option}>{format(option)}</option>)}
    </select>
  )

  return (
    <div className="space-y-5">
      <div className="page-intro">
        <div>
          <h2>Alumnos</h2>
          <p>{hasFilters ? `${filtered.length} de ${students.length}` : `${students.length} ${students.length === 1 ? 'alumno' : 'alumnos'}`}</p>
        </div>
        {hasFilters && <button type="button" onClick={() => { setSearch(''); setFilters({ level: '', group: '', promo: '' }) }} className="btn-ghost text-muted">Limpiar filtros</button>}
      </div>

      <div className="grid gap-2 md:grid-cols-[2fr_1fr_1fr_1fr]">
        <div className="relative">
          <Icon name="search" size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
          <input type="search" placeholder="Buscar alumno…" value={search} onChange={(event) => setSearch(event.target.value)} className="input pl-9" />
        </div>
        {filterSelect('level', 'Todos los cursos', (value) => `${value} curso`)}
        {filterSelect('group', 'Todos los grupos')}
        {filterSelect('promo', 'Todas las promociones', (value) => `Promoción ${value}`)}
      </div>

      {filtered.length === 0 ? (
        <div className="card empty">
          <p className="font-medium text-ink-soft">{hasFilters ? 'Ningún alumno coincide con la búsqueda' : 'Todavía no hay alumnos'}</p>
          <p className="mt-1">{hasFilters ? 'Prueba con otros criterios.' : 'Aparecerán aquí cuando estén matriculados en tus módulos.'}</p>
        </div>
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm" aria-label="Tabla de alumnos">
              <thead>
                <tr>
                  <th className="px-5 py-3">Nombre</th>
                  <th className="px-5 py-3">Nº</th>
                  <th className="px-5 py-3">Grupo</th>
                  <th className="hidden px-5 py-3 sm:table-cell">Promoción</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((student) => (
                  <tr key={student.id} className="cursor-pointer border-t border-line" onClick={() => setSelected(student)}>
                    <td className="px-5 py-3.5 font-medium text-ink">
                      <button type="button" className="text-left" onClick={(event) => { event.stopPropagation(); setSelected(student) }}>{student.name || 'Sin nombre'}</button>
                    </td>
                    <td className="px-5 py-3.5 tabular-nums text-muted">{student.number || '—'}</td>
                    <td className="px-5 py-3.5 text-ink-soft">{student.group || student.level || '—'}</td>
                    <td className="hidden px-5 py-3.5 text-ink-soft sm:table-cell">{student.promo || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {selected && <StudentHistory student={selected} onClose={() => setSelected(null)} />}
    </div>
  )
}

const STATUS = {
  aprobado: { label: 'Aprobado', className: 'bg-success-soft text-success' },
  suspendido: { label: 'Suspendido', className: 'bg-danger-soft text-danger' },
  cursando: { label: 'Cursando', className: '' },
}

// Historial del alumno: un bloque por curso escolar con sus módulos y notas.
function StudentHistory({ student, onClose }) {
  const [years, setYears] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    Promise.all([
      supabase.from('enrollments').select('academic_year_id, level, status, academic_years(name, starts_on), class_groups(level, name)').eq('student_id', student.id),
      supabase.from('module_enrollments').select('id, academic_year_id, is_carryover, theory_grade, practical_result, status, degree_modules(module_id, kind), class_groups(level, name)').eq('student_id', student.id),
    ]).then(([enrollments, modules]) => {
      if (!active) return
      const failed = enrollments.error || modules.error
      if (failed) { setError(getSupabaseErrorMessage(failed)); return }
      const byYear = new Map()
      for (const enrollment of enrollments.data || []) {
        byYear.set(enrollment.academic_year_id, { ...enrollment, modules: [] })
      }
      for (const item of modules.data || []) {
        if (!byYear.has(item.academic_year_id)) byYear.set(item.academic_year_id, { academic_year_id: item.academic_year_id, modules: [] })
        byYear.get(item.academic_year_id).modules.push(item)
      }
      const list = [...byYear.values()].sort((a, b) => (b.academic_years?.starts_on || '').localeCompare(a.academic_years?.starts_on || ''))
      list.forEach((year) => year.modules.sort((a, b) => (a.degree_modules?.module_id || '').localeCompare(b.degree_modules?.module_id || '')))
      setYears(list)
    })
    return () => { active = false }
  }, [student.id])

  return (
    <Modal title={student.name || 'Alumno'} onClose={onClose}>
      <p className="-mt-1 mb-4 text-sm text-muted">
        {[student.number && `Nº ${student.number}`, student.group, student.promo && `Promoción ${student.promo}`].filter(Boolean).join(' · ')}
      </p>
      {error && <p role="alert" className="notice-error">{error}</p>}
      {!years && !error && <p className="text-sm text-muted">Cargando…</p>}
      {years?.length === 0 && <p className="text-sm text-muted">Sin matrículas registradas.</p>}
      <div className="space-y-5">
        {years?.map((year) => (
          <section key={year.academic_year_id}>
            <h3 className="mb-2 flex items-baseline gap-2 text-sm font-semibold text-ink">
              {year.academic_years?.name || 'Curso escolar'}
              {year.class_groups && <span className="font-normal text-muted">{groupLabel(year.class_groups)}</span>}
            </h3>
            {year.modules.length === 0 ? <p className="text-sm text-muted">Sin módulos.</p> : (
              <ul className="divide-y divide-line rounded-xl border border-line">
                {year.modules.map((item) => {
                  const status = STATUS[item.status] || STATUS.cursando
                  const result = item.degree_modules?.kind === 'practica'
                    ? (item.practical_result === 'apto' ? 'Apto' : item.practical_result === 'no_apto' ? 'No apto' : '')
                    : (item.theory_grade != null ? String(Number(item.theory_grade)) : '')
                  return (
                    <li key={item.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                      <span className="w-12 font-semibold tabular-nums text-ink">{item.degree_modules?.module_id}</span>
                      <span className="flex-1 text-ink-soft">
                        {KIND_LABEL[item.degree_modules?.kind] || ''}
                        {item.is_carryover && <span className="ml-2 text-xs text-warn">Arrastrado · {groupLabel(item.class_groups)}</span>}
                      </span>
                      {result && <span className="tabular-nums text-ink">{result}</span>}
                      <span className={`badge ${status.className}`}>{status.label}</span>
                    </li>
                  )
                })}
              </ul>
            )}
          </section>
        ))}
      </div>
    </Modal>
  )
}
