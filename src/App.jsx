import { Component, Fragment, lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
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
import GettingStarted from './components/GettingStarted.jsx'
import AdminOverview, { SchoolPicker } from './components/AdminOverview.jsx'
import { SchoolProvider } from './contexts/SchoolContext.jsx'
import { useSchool } from './contexts/useSchool.js'

const SchoolManagement = lazy(() => import('./components/SchoolManagement.jsx'))

const Timetable = lazy(() => import('./components/Timetable.jsx'))
const Grades = lazy(() => import('./components/Grades.jsx'))
const StudentList = lazy(() => import('./components/StudentList.jsx'))
const PracticeList = lazy(() => import('./components/PracticeList.jsx'))
const TLBList = lazy(() => import('./components/TLBList.jsx'))
const VideoList = lazy(() => import('./components/VideoList.jsx'))
const ModuleDetailPage = lazy(() => import('./components/ModuleDetail.jsx'))
const loadManagementPages = () => import('./components/ManagementPages.jsx')
const ModulesPage = lazy(() => loadManagementPages().then((mod) => ({ default: mod.ModulesPage })))
const SchoolSetup = lazy(() => import('./components/SchoolSetup.jsx'))
const TeacherGroups = lazy(() => import('./components/TeacherGroups.jsx'))
const AircraftPage = lazy(() => loadManagementPages().then((mod) => ({ default: mod.AircraftPage })))
const ReportsPage = lazy(() => loadManagementPages().then((mod) => ({ default: mod.ReportsPage })))
const SettingsPage = lazy(() => loadManagementPages().then((mod) => ({ default: mod.SettingsPage })))
const StudentDashboard = lazy(() => import('./components/StudentDashboard.jsx'))
const StudentHome = lazy(() => import('./components/StudentHome.jsx'))

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
  // Lo que una página pide a otra al navegar (p. ej. «Crear TLB» desde una práctica): { page, ...datos }
  const [pageIntent, setPageIntent] = useState(null)
  // Paso abierto en la página «Escuela»
  const [setupStep, setSetupStep] = useState('degrees')
  // Al ir a otra página, lo pedido para la anterior ya no vale
  if (pageIntent && pageIntent.page !== activePage) setPageIntent(null)

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
  const goWith = (page, data) => { setPageIntent({ page, ...data }); setActivePage(page) }
  const openSetup = (step) => { setSetupStep(step); setActivePage('setup') }
  const intentFor = (page) => (pageIntent?.page === page ? pageIntent : null)
  const clearIntent = () => setPageIntent(null)

  const renderPage = () => {
    switch (currentPage) {
      case 'students': return <StudentList user={user} />
      case 'practices': return <PracticeList user={user} initialModuleId={intentFor('practices')?.module_id} initialPracticeId={intentFor('practices')?.practice_id} onClearInitial={clearIntent} onCreateTLB={(prefill) => goWith('tlb', prefill)} />
      case 'tlb': return <TLBList user={user} initialTlbId={selectedTlbId} onClearInitialTlb={() => setSelectedTlbId(null)} initialCreate={intentFor('tlb')} onClearInitialCreate={clearIntent} />
      case 'videos': return <VideoList user={user} initialModuleId={intentFor('videos')?.module_id} onClearInitial={clearIntent} />
      case 'modules': return <ModulesPage user={user} onOpenModule={openModule} />
      case 'module-detail': return <ModuleDetailPage moduleId={selectedModuleId} user={user} onBack={() => setActivePage('modules')} />
      // Estructura académica y Asignaciones viven ahora dentro de «Escuela» (los accesos antiguos siguen llevando allí)
      case 'setup': case 'structure': case 'assignments': return <SchoolSetup user={user} step={setupStep} onStep={setSetupStep} />
      case 'mygroups': return <TeacherGroups user={user} onOpenGrades={(groupId, degreeModuleId) => goWith('grades', { group_id: groupId, degree_module_id: degreeModuleId })} />
      case 'teachers': return <ProfileManagement user={user} />
      case 'aircraft': return <AircraftPage user={user} />
      case 'reports': return <ReportsPage />
      case 'settings': return <SettingsPage user={user} />
      case 'mydata': return <ProfileSettings user={user} />
      case 'progress': return <MyProgress user={user} />
      case 'schools': return <SchoolManagement user={user} />
      case 'timetable': return <Timetable user={user} />
      case 'grades': return <Grades user={user} initialClass={intentFor('grades')} />
      default: return <Home user={user} setActivePage={setActivePage} onOpenModule={openModule} onOpenPractice={(practiceId) => goWith('practices', { practice_id: practiceId })} openSetup={openSetup} />
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
    assignments: 'Escuela',
    setup: 'Escuela',
    mygroups: 'Mis grupos',
    teachers: 'Perfiles',
    aircraft: 'Aviones',
    reports: 'Informes',
    settings: 'Configuración',
    mydata: 'Mis datos',
    progress: 'Mi progreso',
    schools: 'Centros',
    structure: 'Escuela',
    timetable: user.role === ROLES.STUDENT ? 'Mi horario' : 'Horario',
    grades: 'Notas',
  }

  return (
    <ThemeProvider>
      <SchoolProvider user={user}>
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
                <SchoolScoped page={currentPage}>{renderPage()}</SchoolScoped>
              </Suspense>
            </PageErrorBoundary>
          </div>
        </main>
      </div>
      </SchoolProvider>
    </ThemeProvider>
  )
}

// Páginas que no son de una escuela concreta. En todas las demás, cada escuela tiene sus propios
// datos y el admin tiene que elegir una: nunca se mezclan escuelas.
const GLOBAL_PAGES = new Set(['dashboard', 'schools', 'settings', 'mydata'])

// Al cambiar el admin de escuela, la página se vuelve a montar y carga los datos de la nueva.
function SchoolScoped({ page, children }) {
  const { isAdmin, schoolId } = useSchool()
  if (isAdmin && !schoolId && !GLOBAL_PAGES.has(page)) return <SchoolPicker />
  return (
    <>
      {isAdmin && !GLOBAL_PAGES.has(page) && <SchoolSwitch />}
      <Fragment key={schoolId || 'all'}>{children}</Fragment>
    </>
  )
}

// Admin: en qué escuela está trabajando, con cambio rápido sin salir de la página
function SchoolSwitch() {
  const { schools, schoolId, setSchoolId } = useSchool()
  return (
    <div className="mb-4 flex items-center justify-end gap-2 text-sm">
      <Icon name="school" size={16} className="text-faint" />
      <label className="sr-only" htmlFor="school-switch">Escuela</label>
      <select id="school-switch" className="input h-9 w-auto py-0 text-sm" value={schoolId} onChange={(event) => setSchoolId(event.target.value)}>
        {schools.map((school) => <option key={school.id} value={school.id}>{school.name}</option>)}
      </select>
    </div>
  )
}

function Home(props) {
  const { isAdmin, filterId } = useSchool()
  return isAdmin && !filterId ? <AdminOverview {...props} /> : <DashboardHome {...props} />
}

function FullScreenMessage({ children }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas p-4 text-sm text-muted">
      {children}
    </div>
  )
}


// Módulos propios de un profesor (para sus próximas prácticas). El alumno tiene su propio inicio.
async function fetchOwnModuleIds(user) {
  const { data } = await supabase.from('teacher_modules').select('module_id').eq('profile_id', user.id)
  return (data || []).map((entry) => entry.module_id)
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

function DashboardHome({ user, setActivePage, onOpenPractice, openSetup }) {
  const { isAdmin, filterId, school, setSchoolId } = useSchool()
  const [stats, setStats] = useState(null)
  const [upcoming, setUpcoming] = useState(null)

  useEffect(() => {
    // El alumno tiene su propio inicio (StudentHome) y no usa estas cifras
    if (user.role === ROLES.STUDENT) return undefined
    let cancelled = false
    let timer = null

    async function fetchStats() {
      // Cifras en una sola llamada (la RLS decide qué cuenta cada rol); las próximas prácticas, en paralelo
      const upcomingQuery = async () => {
        let query = supabase
          .from('practices')
          .select('id,module_id,title,date,start_time,hours')
          .gte('date', todayISO())
          .order('date')
          .order('start_time')
          .limit(4)
        if (filterId) query = query.eq('school_id', filterId)
        else if (!isManager(user.role)) {
          const moduleIds = await fetchOwnModuleIds({ id: user.id, role: user.role })
          if (!moduleIds.length) return { data: [], error: null }
          query = query.in('module_id', moduleIds)
        }
        return query
      }
      try {
        const [statsResult, upcomingResult] = await Promise.all([
          supabase.rpc('dashboard_stats', { p_school_id: filterId }),
          upcomingQuery(),
        ])
        if (cancelled) return
        setStats(Object.fromEntries(STAT_TABLES.map((table) => [table, statsResult.error ? '—' : statsResult.data?.[table] ?? 0])))
        setUpcoming(upcomingResult.error ? [] : upcomingResult.data || [])
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
  }, [user.id, user.role, filterId])

  const isStudent = user.role === ROLES.STUDENT
  const cards = [['students', user.role === ROLES.TEACHER ? 'Mis alumnos' : 'Alumnos', 'users', 'students'], ['modules', 'Módulos', 'book', 'modules'], ['tlbs', 'Task Log Books', 'clipboard', 'tlb'], ['videos', 'Vídeos', 'play', 'videos']]

  const firstName = (user.name || '').split(' ')[0]
  const todayText = new Date().toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' })
  const today = todayText.charAt(0).toUpperCase() + todayText.slice(1)

  return (
    <div className="space-y-8">
      <section>
        <p className="text-sm text-muted">{today}</p>
        <h2 className="mt-1 text-2xl font-semibold text-ink md:text-[28px]">{isAdmin && school ? school.name : `${greeting()}, ${firstName}`}</h2>
        {isAdmin && school && <button type="button" className="link mt-2" onClick={() => setSchoolId('')}>← Volver a todas las escuelas</button>}
      </section>

      {isStudent ? <StudentHome user={user} setActivePage={setActivePage} onOpenPractice={onOpenPractice} /> : <>
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

      <PendingRequests user={user} schoolId={filterId} />

      {(user.role === ROLES.SUPERVISOR || filterId) && <GettingStarted schoolId={filterId} setActivePage={setActivePage} openSetup={openSetup} />}

      {user.role !== ROLES.ADMIN && <TodayClasses user={user} onOpen={() => setActivePage('timetable')} onOpenPractice={onOpenPractice} />}

      <section className="card">
        <div className="flex items-center justify-between px-5 pb-2 pt-5">
          <h3 className="font-semibold text-ink">Próximas prácticas</h3>
          <button type="button" className="link" onClick={() => setActivePage('practices')}>Ver todas</button>
        </div>
        {upcoming === null && <p className="empty">Cargando…</p>}
        {upcoming?.length === 0 && <p className="empty">No tienes prácticas próximas. Disfruta del día.</p>}
        {upcoming?.length > 0 && (
          <ul className="px-2 pb-2">
            {upcoming.map((practice) => (
              <li key={practice.id}>
                <button type="button" onClick={() => setActivePage('practices')} className="flex w-full items-center gap-4 rounded-xl px-3 py-3 text-left hover:bg-subtle">
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
      </>}
    </div>
  )
}

// «Mi progreso»: el alumno ve su propia ficha en modo lectura
function MyProgress({ user }) {
  const [studentId, setStudentId] = useState(undefined)
  useEffect(() => {
    let active = true
    supabase.from('student_profiles').select('student_id').eq('profile_id', user.id).maybeSingle()
      .then(({ data }) => { if (active) setStudentId(data?.student_id || null) })
    return () => { active = false }
  }, [user.id])
  if (studentId === undefined) return <FullScreenMessage>Cargando tus datos…</FullScreenMessage>
  if (!studentId) {
    return (
      <section className="card p-6 text-center">
        <h2 className="font-semibold text-ink">Tu cuenta aún no está vinculada</h2>
        <p className="mt-2 text-sm text-muted">Pide a la escuela que asocie tu cuenta a tu ficha de alumno.</p>
      </section>
    )
  }
  return <StudentDashboard studentId={studentId} user={user} selfView />
}

export default App
