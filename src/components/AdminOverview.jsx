import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { subscribeToTables } from '../lib/supabaseRealtime.js'
import { useSchool } from '../contexts/useSchool.js'
import Icon from './Icon.jsx'
import PendingRequests from './PendingRequests.jsx'

const show = (value) => (value == null ? '—' : value)

// Inicio del admin sin escuela elegida: resumen de todas las escuelas y acceso a cada una.
export default function AdminOverview({ user, setActivePage, openSetup }) {
  const { schools, setSchoolId } = useSchool()
  const [stats, setStats] = useState({})
  const [pending, setPending] = useState({})

  useEffect(() => {
    if (!schools.length) return undefined
    let active = true
    let timer = null
    async function load() {
      // Una sola llamada con las cifras de todas las escuelas
      const { data, error } = await supabase.rpc('admin_school_overview')
      if (!active || error) return
      const perSchool = {}
      const bySchool = {}
      ;(data || []).forEach((row) => {
        perSchool[row.school_id] = { students: row.students, teachers: row.teachers, groups: row.groups }
        bySchool[row.school_id] = row.pending
      })
      setStats(perSchool)
      setPending(bySchool)
    }
    load()
    const reload = () => { clearTimeout(timer); timer = setTimeout(load, 400) }
    const unsubscribe = subscribeToTables(['students', 'profiles', 'school_profiles', 'class_groups'], reload, `admin-overview-${user.id}`)
    return () => { active = false; clearTimeout(timer); unsubscribe() }
  }, [schools, user.id])

  const sum = (key) => {
    const values = schools.map((school) => stats[school.id]?.[key])
    return values.some((value) => value == null) ? '–' : values.reduce((total, value) => total + value, 0)
  }
  const totalPending = Object.values(pending).reduce((total, value) => total + value, 0)
  const totals = [
    ['Escuelas', schools.length, 'school'],
    ['Alumnos', sum('students'), 'users'],
    ['Profesores', sum('teachers'), 'idcard'],
    ['Solicitudes pendientes', totalPending, 'clock'],
  ]
  const firstName = (user.name || '').split(' ')[0]

  return (
    <div className="space-y-8">
      <section>
        <p className="text-sm text-muted">Todas las escuelas</p>
        <h2 className="mt-1 text-2xl font-semibold text-ink md:text-[28px]">Hola, {firstName}</h2>
      </section>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {totals.map(([label, value, icon]) => (
          <div key={label} className="card flex flex-col items-start gap-4 p-5">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent-soft text-accent"><Icon name={icon} /></span>
            <span>
              <span className="block text-2xl font-semibold text-ink">{value}</span>
              <span className="mt-0.5 block text-sm text-muted">{label}</span>
            </span>
          </div>
        ))}
      </section>

      <PendingRequests user={user} />

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-semibold text-ink">Escuelas</h3>
          <button type="button" className="link" onClick={() => setActivePage('schools')}>Gestionar escuelas</button>
        </div>
        {!schools.length && <div className="card empty">Aún no hay escuelas. Créalas en Escuelas.</div>}
        <div className="grid gap-3 md:grid-cols-2">
          {schools.map((school) => {
            const item = stats[school.id]
            // Cada cifra entra en la escuela y abre directamente lo que muestra
            const go = (page, step) => { setSchoolId(school.id); if (step && openSetup) openSetup(step); else if (page) setActivePage(page) }
            return (
              <div key={school.id} className="card flex flex-col gap-4 p-5 transition-shadow hover:shadow-lift">
                <span className="flex items-center gap-3">
                  <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: school.brand_color || 'var(--color-accent, currentColor)' }} aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate font-semibold text-ink">{school.name}</span>
                  {pending[school.id] > 0 && (
                    <button type="button" className="badge hover:opacity-80" onClick={() => go('dashboard')} title="Ver las solicitudes en el inicio de la escuela">
                      {pending[school.id]} pendiente{pending[school.id] === 1 ? '' : 's'}
                    </button>
                  )}
                </span>
                <span className="grid grid-cols-3 gap-2 text-sm">
                  {[['Alumnos', item?.students, 'students'], ['Profesores', item?.teachers, 'teachers'], ['Grupos', item?.groups, null, 'groups']].map(([label, value, page, step]) => (
                    <button key={label} type="button" onClick={() => go(page, step)} className="rounded-lg p-1 text-left hover:bg-subtle">
                      <span className="block text-lg font-semibold text-ink">{item ? show(value) : '–'}</span>
                      <span className="text-muted">{label}</span>
                    </button>
                  ))}
                </span>
                <button type="button" onClick={() => go('dashboard')} className="group flex items-center gap-1 self-start text-sm font-medium text-accent">
                  Entrar en la escuela <Icon name="next" size={14} />
                </button>
              </div>
            )
          })}
        </div>
      </section>
    </div>
  )
}

// Para cualquier sección cuando el admin aún no ha elegido escuela.
export function SchoolPicker() {
  const { schools, setSchoolId } = useSchool()
  return (
    <div className="card mx-auto max-w-lg p-6">
      <h2 className="font-semibold text-ink">Elige una escuela</h2>
      <p className="mt-1 text-sm text-muted">Cada escuela tiene sus propios datos. Elige cuál quieres ver; puedes cambiarla cuando quieras en el menú.</p>
      <div className="mt-4 space-y-2">
        {schools.map((school) => (
          <button key={school.id} type="button" onClick={() => setSchoolId(school.id)}
            className="flex w-full items-center gap-3 rounded-xl border border-line px-4 py-3 text-left text-sm font-medium text-ink hover:bg-subtle">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: school.brand_color || 'currentColor' }} aria-hidden="true" />
            {school.name}
            <Icon name="next" size={16} className="ml-auto text-faint" />
          </button>
        ))}
        {!schools.length && <p className="text-sm text-muted">Aún no hay escuelas.</p>}
      </div>
    </div>
  )
}
