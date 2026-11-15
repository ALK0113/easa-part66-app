import { Component, lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from './lib/supabase.js'
import Login from './components/Login.jsx'
import Sidebar from './components/Sidebar.jsx'
import { subscribeToTables } from './lib/supabaseRealtime.js'
import { ROLES, canAccessPage, isManager } from './lib/roles.js'
import { ThemeProvider } from './contexts/ThemeContext.jsx'
import Icon from './components/Icon.jsx'
import TodayClasses from './components/TodayClasses.jsx'
import PendingApproval from './components/PendingApproval.jsx'
import PendingRequests from './components/PendingRequests.jsx'

const SchoolManagement = lazy(() => import('./components/SchoolManagement.jsx'))

const AcademicStructure = lazy(() => import('./components/AcademicStructure.jsx'))
const Timetable = lazy(() => import('./components/Timetable.jsx'))
const Grades = lazy(() => import('./components/Grades.jsx'))
const StudentList = lazy(() => import('./components/StudentList.jsx'))
const PracticeList = lazy(() => import('./components/PracticeList.jsx'))
const TLBList = lazy(() => import('./components/TLBList.jsx'))
const VideoList = lazy(() => import('./components/VideoList.jsx'))
const ModuleDetailPage = lazy(() => import('./components/ModuleDetail.jsx'))
const loadManagementPages = () => import('./components/ManagementPages.jsx')
const ModulesPage = lazy(() => loadManagementPages().then((mod) => ({ default: mod.ModulesPage })))
const AssignmentsPage = lazy(() => import('./components/Assignments.jsx'))
const AircraftPage = lazy(() => loadManagementPages().then((mod) => ({ default: mod.AircraftPage })))
const ReportsPage = lazy(() => loadManagementPages().then((mod) => ({ default: mod.ReportsPage })))
const SettingsPage = lazy(() => loadManagementPages().then((mod) => ({ default: mod.SettingsPage })))
const MyDataPage = lazy(() => loadManagementPages().then((mod) => ({ default: mod.MyDataPage })))

const ProfileManagement = lazy(() => import('./components/ProfileManagement.jsx'))
const ProfileSettings = lazy(() => import('./components/ProfileSettings.jsx'))

class PageErrorBoundary extends Component {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidUpdate(prevProps) {
    if (prevProps.resetKey !== this.props.resetKey && this.state.failed) this.setState({ failed: false })
  }
  render() {
    if (!this.state.failed) return this.props.children
    return (
      <div role="alert" className="card p-6 text-sm">
        <p className="font-semibold text-ink">No se pudo cargar esta sección</p>
        <p className="mt-1 text-muted">Comprueba tu conexión e inténtalo de nuevo.</p>
        <button type="button" className="btn-secondary mt-4" onClick={() => window.location.reload()}>Recargar la página</button>
      </div>
    )
  }
}

function App() {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)
  const [profileError, setProfileError] = useState('')
  const [activePage, setActivePage] = useState('dashboard')
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [selectedModuleId, setSelectedModuleId] = useState(null)
  const [selectedTlbId, setSelectedTlbId] = useState(null)

  const userIdRef = useRef(null)
  const inFlightRef = useRef(null)

  // La recuperación/invitación (elegir contraseña) la gestiona PasswordGate antes de montar App.
  const loadUserProfile = useCallback(async (authUser) => {
    if (inFlightRef.current === authUser.id) return
    inFlightRef.current = authUser.id
    try {
      const { data: profile, error } = await supabase
        .from('profiles')
        .select('role,full_name,status')
        .eq('id', authUser.id)
        .maybeSingle()

      if (error || !profile?.role) {
        setProfileError(error
          ? 'No se pudo cargar tu perfil. Inténtalo de nuevo en unos minutos.'
          : 'Tu cuenta aún no tiene un perfil configurado. Contacta con administración.')
        userIdRef.current = null
        setUser(null)
        await supabase.auth.signOut()
        return
      }

      setProfileError('')
      userIdRef.current = authUser.id
      setUser({
        id: authUser.id,
        email: authUser.email,
        role: profile.role,
        status: profile.status,
        name: profile.full_name || authUser.user_metadata?.full_name || 'Usuario',
      })
    } catch {
      setProfileError('No se pudo conectar con el servidor. Comprueba tu conexión.')
      userIdRef.current = null
      setUser(null)
    } finally {
      inFlightRef.current = null
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    let active = true

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'TOKEN_REFRESHED' || event === 'PASSWORD_RECOVERY') return
      if (!session?.user) {
        userIdRef.current = null
        setUser(null)
        setLoading(false)
        return
      }
      if (userIdRef.current === session.user.id && event !== 'USER_UPDATED') return
      setTimeout(() => { if (active) loadUserProfile(session.user) }, 0)
    })

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!active) return
      if (session?.user) loadUserProfile(session.user)
      else setLoading(false)
    }).catch(() => { if (active) setLoading(false) })

    return () => { active = false; subscription.unsubscribe() }
  }, [loadUserProfile])

  function handleLoginSuccess(loggedUser) {
    userIdRef.current = loggedUser.id
    setProfileError('')
    setUser(loggedUser)
  }

  async function handleLogout() {
    try { await supabase.auth.signOut() } catch { /* se cierra la sesión local igualmente */ }
    userIdRef.current = null
    setUser(null)
    setActivePage('dashboard')
    setSelectedModuleId(null)
    setSelectedTlbId(null)
    setSidebarOpen(false)
  }

  if (loading) return <FullScreenMessage>Cargando…</FullScreenMessage>

  if (!user && profileError) {
    return (
      <FullScreenMessage>
        <div role="alert" className="card max-w-md p-7 text-center">
          <p className="text-sm text-ink-soft">{profileError}</p>
          <button type="button" className="btn-primary mt-5" onClick={() => setProfileError('')}>Volver al inicio de sesión</button>
        </div>
      </FullScreenMessage>
    )
  }

  if (!user) {
    return <Login onLoginSuccess={handleLoginSuccess} />
  }

  // Cuenta registrada que la escuela aún no ha aprobado (o ha rechazado)
  if (user.status !== 'activo') {
    return <PendingApproval user={user} onLogout={handleLogout} />
  }

  const currentPage = canAccessPage(activePage, user.role) ? activePage : 'dashboard'
  const openModule = (moduleId) => { setSelectedModuleId(moduleId); setActivePage('module-detail') }

  const renderPage = () => {
    switch (currentPage) {
      case 'students': return <StudentList />
      case 'practices': return <PracticeList user={user} />
      case 'tlb': return <TLBList user={user} initialTlbId={selectedTlbId} onClearInitialTlb={() => setSelectedTlbId(null)} />
      case 'videos': return <VideoList user={user} />
      case 'modules': return <ModulesPage user={user} onOpenModule={openModule} />
      case 'module-detail': return <ModuleDetailPage moduleId={selectedModuleId} user={user} onBack={() => setActivePage('modules')} onOpenTLB={(tlbId) => { setSelectedTlbId(tlbId); setActivePage('tlb') }} />
      case 'assignments': return <AssignmentsPage user={user} />
      case 'teachers': return <ProfileManagement user={user} />
      case 'aircraft': return <AircraftPage user={user} />
      case 'reports': return <ReportsPage />
      case 'settings': return <SettingsPage user={user} />
      case 'mydata': return <ProfileSettings user={user} />
      case 'progress': return <MyDataPage user={user} />
      case 'schools': return <SchoolManagement user={user} />
      case 'structure': return <AcademicStructure />
      case 'timetable': return <Timetable user={user} />
      case 'grades': return <Grades user={user} />
      default: return <DashboardHome user={user} setActivePage={setActivePage} onOpenModule={openModule} />
    }
  }

  const pageTitles = {
    dashboard: 'Inicio',
    modules: user.role === ROLES.STUDENT ? 'Mis módulos' : 'Módulos Part-66',
    'module-detail': selectedModuleId ? `Módulo ${selectedModuleId}` : 'Módulo',
    students: user.role === ROLES.TEACHER ? 'Mis alumnos' : 'Alumnos',
    practices: 'Prácticas',
    tlb: user.role === ROLES.STUDENT ? 'Mi Task Log Book' : 'Task Log Book',
    videos: 'Vídeos formativos',
    assignments: 'Asignaciones',
    teachers: 'Perfiles',
    aircraft: 'Aviones',
    reports: 'Informes',
    settings: 'Configuración',
    mydata: 'Mis datos',
    progress: 'Mi progreso',
    schools: 'Escuelas',
    structure: 'Estructura académica',
    timetable: user.role === ROLES.STUDENT ? 'Mi horario' : 'Horario',
    grades: 'Notas',
  }

  return (
    <ThemeProvider user={user}>
      <div className="min-h-screen bg-canvas text-ink">
        <Sidebar
          activePage={currentPage}
          setActivePage={(page) => {
            setActivePage(page)
            setSidebarOpen(false)
            window.scrollTo({ top: 0 })
          }}
          user={user}
          onLogout={handleLogout}
          isOpen={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
        />
        {sidebarOpen && (
          <button
            type="button"
            aria-label="Cerrar menú"
            onClick={() => setSidebarOpen(false)}
            className="fixed inset-0 z-30 bg-black/20 backdrop-blur-[2px] md:hidden"
          />
        )}
        <main className="min-h-screen md:ml-[264px]">
          <header className="app-header sticky top-0 z-20 flex h-14 items-center gap-2 border-b border-line px-3 backdrop-blur md:hidden">
            <button
              type="button"
              aria-label="Abrir menú"
              onClick={() => setSidebarOpen(true)}
              className="rounded-lg p-2 text-ink-soft hover:bg-surface"
            >
              <Icon name="menu" size={20} />
            </button>
            <h1 className="truncate text-base font-semibold text-ink">{pageTitles[currentPage] || 'AviaTrack'}</h1>
          </header>
          <div key={currentPage} className="fade-in mx-auto max-w-6xl px-4 py-6 md:px-10 md:py-10">
            <PageErrorBoundary resetKey={currentPage}>
              <Suspense fallback={<div className="flex min-h-[40vh] items-center justify-center text-sm text-muted">Cargando…</div>}>
                {renderPage()}
              </Suspense>
            </PageErrorBoundary>
          </div>
        </main>
      </div>
    </ThemeProvider>
  )
}

function FullScreenMessage({ children }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas p-4 text-sm text-muted">
      {children}
    </div>
  )
}

const PAGE_SIZE = 1000

async function fetchEnrolledStudentIds(moduleIds) {
  const ids = new Set()
  let from = 0
  for (;;) {
    const { data, error } = await supabase
      .from('student_modules')
      .select('student_id,module_id')
      .in('module_id', moduleIds)
      .order('student_id')
      .order('module_id')
      .range(from, from + PAGE_SIZE - 1)
    if (error) throw error
    ;(data || []).forEach((entry) => ids.add(String(entry.student_id)))
    if (!data || data.length < PAGE_SIZE) break
    from += PAGE_SIZE
  }
  return ids
}

const STAT_TABLES = ['students', 'practices', 'tlbs', 'videos', 'modules']

const todayISO = () => {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

function greeting() {
  const hour = new Date().getHours()
  if (hour < 13) return 'Buenos días'
  if (hour < 21) return 'Buenas tardes'
  return 'Buenas noches'
}

function DashboardHome({ user, setActivePage, onOpenModule }) {
  const [stats, setStats] = useState(null)
  const [upcoming, setUpcoming] = useState(null)

  useEffect(() => {
    let cancelled = false
    let timer = null

    async function fetchStats() {
      try {
        let moduleIds = []
        let studentCount = null

        if (user.role === ROLES.TEACHER) {
          const { data, error } = await supabase.from('teacher_modules').select('module_id').eq('profile_id', user.id)
          if (error) throw error
          moduleIds = (data || []).map((entry) => entry.module_id)
          studentCount = moduleIds.length ? (await fetchEnrolledStudentIds(moduleIds)).size : 0
        } else if (user.role === ROLES.STUDENT) {
          const { data: link, error: linkError } = await supabase.from('student_profiles').select('student_id').eq('profile_id', user.id).maybeSingle()
          if (linkError) throw linkError
          if (link) {
            const { data: memberships, error } = await supabase.from('student_modules').select('module_id').eq('student_id', link.student_id)
            if (error) throw error
            moduleIds = (memberships || []).map((entry) => entry.module_id)
          }
          studentCount = 0
        }

        const countTable = (table, moduleScoped) => {
          let query = supabase.from(table).select('id', { count: 'exact', head: true })
          if (moduleScoped) {
            if (!moduleIds.length) return Promise.resolve({ count: 0, error: null })
            query = query.in('module_id', moduleIds)
          }
          return query
        }

        const upcomingQuery = () => {
          if (!isManager(user.role) && !moduleIds.length) return Promise.resolve({ data: [], error: null })
          let query = supabase
            .from('practices')
            .select('id,module_id,title,date,start_time,hours')
            .gte('date', todayISO())
            .order('date')
            .order('start_time')
            .limit(4)
          if (!isManager(user.role)) query = query.in('module_id', moduleIds)
          return query
        }

        const [counts, upcomingResult] = await Promise.all([
          isManager(user.role)
            ? Promise.all(STAT_TABLES.map((table) => countTable(table, false)))
            : Promise.all([
              Promise.resolve({ count: studentCount, error: null }),
              countTable('practices', true),
              countTable('tlbs', true),
              countTable('videos', true),
              Promise.resolve({ count: moduleIds.length, error: null }),
            ]),
          upcomingQuery(),
        ])

        if (!cancelled) {
          setStats(Object.fromEntries(STAT_TABLES.map((table, index) => [
            table,
            counts[index].error ? '—' : counts[index].count ?? 0,
          ])))
          setUpcoming(upcomingResult.error ? [] : upcomingResult.data || [])
        }
      } catch {
        if (!cancelled) {
          setStats(Object.fromEntries(STAT_TABLES.map((table) => [table, '—'])))
          setUpcoming([])
        }
      }
    }

    const scheduleFetch = () => {
      clearTimeout(timer)
      timer = setTimeout(fetchStats, 400)
    }

    fetchStats()
    const unsubscribe = subscribeToTables(['students', 'practices', 'tlbs', 'videos', 'modules', 'student_modules', 'teacher_modules'], scheduleFetch, `dashboard-stats-${user.id}`)
    return () => { cancelled = true; clearTimeout(timer); unsubscribe() }
  }, [user.id, user.role])

  const isStudent = user.role === ROLES.STUDENT
  const cards = isStudent
    ? [['modules', 'Mis módulos', 'book', 'modules'], ['practices', 'Mis prácticas', 'chart', 'progress'], ['tlbs', 'Mi Task Log Book', 'clipboard', 'tlb'], ['videos', 'Vídeos', 'play', 'videos']]
    : [['students', user.role === ROLES.TEACHER ? 'Mis alumnos' : 'Alumnos', 'users', 'students'], ['modules', 'Módulos', 'book', 'modules'], ['tlbs', 'Task Log Books', 'clipboard', 'tlb'], ['videos', 'Vídeos', 'play', 'videos']]

  const firstName = (user.name || '').split(' ')[0]
  const todayText = new Date().toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' })
  const today = todayText.charAt(0).toUpperCase() + todayText.slice(1)
  const openPractice = (practice) => (isStudent ? onOpenModule(practice.module_id) : setActivePage('practices'))

  return (
    <div className="space-y-8">
      <section>
        <p className="text-sm text-muted">{today}</p>
        <h2 className="mt-1 text-2xl font-semibold text-ink md:text-[28px]">{greeting()}, {firstName}</h2>
      </section>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {cards.map(([statKey, label, icon, page]) => (
          <button
            type="button"
            key={statKey}
            onClick={() => setActivePage(page)}
            className="card group flex flex-col items-start gap-4 p-5 text-left transition-shadow hover:shadow-lift"
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent-soft text-accent">
              <Icon name={icon} />
            </span>
            <span>
              <span className="block text-2xl font-semibold text-ink">{stats?.[statKey] ?? '–'}</span>
              <span className="mt-0.5 flex items-center gap-1 text-sm text-muted group-hover:text-ink-soft">
                {label}
                <Icon name="next" size={14} className="opacity-0 transition-opacity group-hover:opacity-100" />
              </span>
            </span>
          </button>
        ))}
      </section>

      {!isStudent && <PendingRequests user={user} />}

      {user.role !== ROLES.ADMIN && <TodayClasses user={user} onOpen={() => setActivePage('timetable')} />}

      <section className="card">
        <div className="flex items-center justify-between px-5 pb-2 pt-5">
          <h3 className="font-semibold text-ink">Próximas prácticas</h3>
          {!isStudent && <button type="button" className="link" onClick={() => setActivePage('practices')}>Ver todas</button>}
        </div>
        {upcoming === null && <p className="empty">Cargando…</p>}
        {upcoming?.length === 0 && <p className="empty">No tienes prácticas próximas. Disfruta del día.</p>}
        {upcoming?.length > 0 && (
          <ul className="px-2 pb-2">
            {upcoming.map((practice) => (
              <li key={practice.id}>
                <button type="button" onClick={() => openPractice(practice)} className="flex w-full items-center gap-4 rounded-xl px-3 py-3 text-left hover:bg-subtle">
                  <span className="flex w-12 shrink-0 flex-col items-center rounded-lg bg-subtle py-1.5">
                    <span className="text-[11px]  text-muted">{new Date(`${practice.date}T00:00`).toLocaleDateString('es-ES', { month: 'short' }).replace('.', '')}</span>
                    <span className="text-lg font-semibold leading-none text-ink">{Number(practice.date.slice(8, 10))}</span>
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-ink">{practice.title}</span>
                    <span className="mt-0.5 block text-xs text-muted">{practice.module_id}{practice.start_time ? ` · ${String(practice.start_time).slice(0, 5)}` : ''}{practice.hours ? ` · ${practice.hours} h` : ''}</span>
                  </span>
                  <Icon name="next" size={16} className="text-faint" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

export default App
