import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { useSchool } from '../contexts/useSchool.js'
import { groupLabel } from '../lib/academic.js'
import { ROLES } from '../lib/roles.js'
import { time } from '../lib/schedule.js'

// Próximas sesiones de teoría y de práctica del módulo: tipo, módulo, submódulo, ATA, fecha y horas.
// El alumno ve solo las de sus grupos.
// Se ven tres a la vez; el resto con scroll
const LIMIT = 40

export default function UpcomingSessions({ moduleId, user, onOpenPractice, onOpenTheory }) {
  const { filterId } = useSchool()
  const [rows, setRows] = useState(null)
  const [submodules, setSubmodules] = useState({})

  useEffect(() => {
    let active = true
    async function load() {
      const today = new Date().toLocaleDateString('sv-SE')
      let query = supabase.from('class_sessions')
        .select('id,date,start_time,end_time,recovery,practice_id,theory_class_id,practices(id,title,ata,submodule_id),theory_classes(id,title,submodule_id),teaching_assignments!inner(group_id,degree_modules!inner(module_id),class_groups!inner(level,name,academic_years!inner(school_id)))')
        .eq('teaching_assignments.degree_modules.module_id', moduleId)
        .eq('status', 'programada').gte('date', today)
        .or('practice_id.not.is.null,theory_class_id.not.is.null')
        .order('date').order('start_time').limit(60)
      if (filterId) query = query.eq('teaching_assignments.class_groups.academic_years.school_id', filterId)
      const [sessionResult, subResult, ownResult] = await Promise.all([
        query,
        supabase.from('submodules').select('id,code,name').eq('module_id', moduleId),
        user.role === ROLES.STUDENT ? supabase.from('module_enrollments').select('group_id') : Promise.resolve({ data: null }),
      ])
      if (!active) return
      const ownGroups = ownResult.data ? new Set(ownResult.data.map((row) => row.group_id)) : null
      const list = (sessionResult.data || []).filter((row) => !ownGroups || ownGroups.has(row.teaching_assignments.group_id))
      setSubmodules(Object.fromEntries((subResult.data || []).map((sub) => [sub.id, sub])))
      setRows(list.slice(0, LIMIT))
    }
    load()
    return () => { active = false }
  }, [moduleId, filterId, user.role])

  if (rows === null) return <p className="px-3 pb-3 pt-1 text-sm text-muted">Cargando sesiones…</p>
  if (!rows.length) return <p className="px-3 pb-3 pt-1 text-sm text-muted">No hay sesiones de teoría ni de práctica programadas.</p>

  return (
    <ul className="max-h-[12.75rem] overflow-y-auto overscroll-contain pr-1" aria-label="Próximas sesiones">
      {rows.map((row) => {
        const practice = row.practices
        const theory = row.theory_classes
        const sub = submodules[practice?.submodule_id || theory?.submodule_id]
        const date = new Date(`${row.date}T00:00`)
        return (
          <li key={row.id}>
            <button type="button" onClick={() => (practice ? onOpenPractice?.(practice.id) : onOpenTheory?.(theory?.id))}
              className="flex w-full items-center gap-4 rounded-xl px-3 py-2.5 text-left hover:bg-subtle">
              <span className="flex w-12 shrink-0 flex-col items-center rounded-xl bg-subtle py-1.5">
                <span className="text-[11px] text-muted">{date.toLocaleDateString('es-ES', { month: 'short' }).replace('.', '')}</span>
                <span className="text-base font-semibold leading-none text-ink">{date.getDate()}</span>
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-faint">
                  <span className={`rounded-md px-1.5 py-px normal-case tracking-normal ${practice ? 'bg-accent-soft text-accent-strong' : 'bg-subtle text-ink-soft'}`}>{practice ? (row.recovery ? 'Práctica · recuperación' : 'Práctica') : 'Teoría'}</span>
                  <span>{moduleId}</span>
                  {sub && <span>· {sub.code}</span>}
                  {practice?.ata && <span>· {practice.ata}</span>}
                </span>
                <span className="mt-0.5 block truncate text-sm font-medium text-ink">{practice?.title || theory?.title}</span>
              </span>
              <span className="shrink-0 text-right text-sm text-ink-soft">
                {date.toLocaleDateString('es-ES', { weekday: 'short' })} {time(row.start_time)}–{time(row.end_time)}
                <span className="block text-xs text-faint">{groupLabel(row.teaching_assignments.class_groups)}</span>
              </span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}
