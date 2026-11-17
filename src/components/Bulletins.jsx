import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { useSchool } from '../contexts/useSchool.js'
import { getSupabaseErrorMessage } from '../lib/supabaseErrors.js'
import { groupLabel } from '../lib/academic.js'
import { FINAL, createPdf, drawBulletin, fetchBulletinData, fetchSchoolForPdf, finishPdf, loadLogo, pdfFileName, periodInfo } from '../lib/bulletin.js'
import { toISODate } from '../lib/schedule.js'
import Icon from './Icon.jsx'

// Boletines de notas (coordinación y administración): de un alumno o de todo un grupo, por evaluación o la final.
// Incluyen todas las asignaturas, asistencia del periodo, exámenes, pendientes y los comentarios del profesorado.
export default function Bulletins() {
  const { schoolId } = useSchool()
  const [years, setYears] = useState(null)
  const [yearId, setYearId] = useState('')
  const [periods, setPeriods] = useState([])
  const [period, setPeriod] = useState(FINAL)
  const [groups, setGroups] = useState([])
  const [groupId, setGroupId] = useState('')
  const [students, setStudents] = useState(null)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')

  // Cursos escolares de la escuela (el actual primero)
  useEffect(() => {
    if (!schoolId) return undefined
    let active = true
    supabase.from('academic_years').select('id,name,starts_on,ends_on,is_current').eq('school_id', schoolId).order('starts_on', { ascending: false })
      .then(({ data, error: loadError }) => {
        if (!active) return
        if (loadError) { setError(getSupabaseErrorMessage(loadError)); return }
        const list = data || []
        setYears(list)
        setYearId((list.find((item) => item.is_current) || list[0])?.id || '')
      })
    return () => { active = false }
  }, [schoolId])

  // Evaluaciones y grupos del curso elegido
  useEffect(() => {
    if (!yearId) return undefined
    let active = true
    Promise.all([
      supabase.from('evaluation_periods').select('id,name,position,starts_on,ends_on').eq('academic_year_id', yearId).order('position'),
      supabase.from('class_groups').select('id,level,name,degrees(code)').eq('academic_year_id', yearId).order('level').order('name'),
    ]).then(([periodResult, groupResult]) => {
      if (!active) return
      const failed = [periodResult, groupResult].find((result) => result.error)
      if (failed) { setError(getSupabaseErrorMessage(failed.error)); return }
      const periodList = periodResult.data || []
      // Por defecto, la última evaluación ya empezada (o la final si no hay)
      const today = toISODate(new Date())
      const started = periodList.filter((item) => item.starts_on <= today)
      setPeriods(periodList)
      setPeriod(started.at(-1)?.id || FINAL)
      setGroups(groupResult.data || [])
      setGroupId((current) => ((groupResult.data || []).some((item) => item.id === current) ? current : groupResult.data?.[0]?.id || ''))
    })
    return () => { active = false }
  }, [yearId])

  // Alumnos del grupo (por su grupo principal del curso)
  useEffect(() => {
    if (!groupId) return undefined
    let active = true
    supabase.from('enrollments').select('student_id,status,students(name,student_number)').eq('group_id', groupId)
      .then(({ data, error: loadError }) => {
        if (!active) return
        if (loadError) { setError(getSupabaseErrorMessage(loadError)); return }
        setStudents((data || []).sort((a, b) => (a.students?.name || '').localeCompare(b.students?.name || '')))
      })
    return () => { active = false }
  }, [groupId])

  const year = years?.find((item) => item.id === yearId)
  const group = groups.find((item) => item.id === groupId)
  const selected = useMemo(() => periodInfo(periods.find((item) => item.id === period), year), [periods, period, year])

  async function download(list, key) {
    if (!list.length || !year) return
    setBusy(key)
    setError('')
    try {
      const school = await fetchSchoolForPdf(schoolId)
      const [logo, entries, pdf] = await Promise.all([
        loadLogo(school),
        fetchBulletinData({ year, studentIds: list.map((item) => item.student_id), from: selected.from, to: selected.to }),
        createPdf(),
      ])
      entries.forEach((entry, index) => {
        if (index > 0) pdf.doc.addPage()
        drawBulletin(pdf.doc, pdf.autoTable, { school, logo, year, period: selected, entry })
      })
      finishPdf(pdf.doc, school, `Boletín · ${selected.name} · ${year.name}`)
      const who = list.length === 1 ? list[0].students?.name : `Grupo_${groupLabel(group)}`
      pdf.doc.save(pdfFileName('Boletin', who, selected.name, year.name))
    } catch (err) {
      setError(getSupabaseErrorMessage(err))
    } finally {
      setBusy('')
    }
  }

  if (years === null && !error) return <p className="text-sm text-muted">Cargando…</p>

  return (
    <div className="space-y-5">
      <div className="page-intro">
        <div>
          <h2>Boletines</h2>
          <p>Boletín de notas de cada alumno: todas sus asignaturas, asistencia y faltas del periodo, exámenes, pendientes y los comentarios del profesorado.</p>
        </div>
      </div>

      {error && <p role="alert" className="notice-error">{error}</p>}

      {years?.length === 0 ? (
        <div className="card empty">Aún no hay cursos escolares. Créalos en Escuela → Curso escolar.</div>
      ) : (
        <>
          <div className="card grid gap-3 p-4 sm:grid-cols-3">
            <label className="field">Curso escolar
              <select className="input" value={yearId} onChange={(event) => { setStudents(null); setYearId(event.target.value) }}>
                {years?.map((item) => <option key={item.id} value={item.id}>{item.name}{item.is_current ? ' (actual)' : ''}</option>)}
              </select>
            </label>
            <label className="field">Evaluación
              <select className="input" value={period} onChange={(event) => setPeriod(event.target.value)}>
                {periods.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                <option value={FINAL}>Evaluación final</option>
              </select>
            </label>
            <label className="field">Grupo
              <select className="input" value={groupId} onChange={(event) => { setStudents(null); setGroupId(event.target.value) }} disabled={!groups.length}>
                {groups.length === 0 && <option value="">Sin grupos</option>}
                {groups.map((item) => <option key={item.id} value={item.id}>{groupLabel(item)}{item.degrees?.code ? ` · ${item.degrees.code}` : ''}</option>)}
              </select>
            </label>
            {periods.length === 0 && <p className="text-xs text-faint sm:col-span-3">Este curso no tiene evaluaciones: solo hay boletín final. Se crean en Escuela → Curso escolar.</p>}
          </div>

          {group && (
            <section className="card overflow-hidden">
              <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-5 py-3.5">
                <div>
                  <h3 className="font-semibold text-ink">{groupLabel(group)} · {selected.name}</h3>
                  {selected.from && <p className="text-xs text-muted">{new Date(`${selected.from}T00:00`).toLocaleDateString('es-ES')} - {new Date(`${selected.to}T00:00`).toLocaleDateString('es-ES')}</p>}
                </div>
                <button type="button" className="btn-primary" disabled={!students?.length || Boolean(busy)} onClick={() => download(students, 'group')}>
                  <Icon name="download" size={16} />{busy === 'group' ? 'Preparando…' : `PDF del grupo${students?.length ? ` (${students.length})` : ''}`}
                </button>
              </header>
              {students === null && <p className="empty">Cargando…</p>}
              {students?.length === 0 && <p className="empty">No hay alumnos en este grupo.</p>}
              {students?.length > 0 && (
                <ul className="divide-y divide-line">
                  {students.map((item) => (
                    <li key={item.student_id} className="flex items-center gap-3 px-5 py-2.5 text-sm">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium text-ink">{item.students?.name || 'Alumno'}</span>
                        <span className="block text-xs text-muted">Nº {item.students?.student_number || '—'}{item.status === 'baja' ? ' · Baja' : ''}</span>
                      </span>
                      <button type="button" className="btn-ghost min-h-[34px] px-3 text-sm text-accent" disabled={Boolean(busy)} onClick={() => download([item], item.student_id)}>
                        <Icon name="download" size={15} />{busy === item.student_id ? 'Preparando…' : 'PDF'}
                      </button>
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
