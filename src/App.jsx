import { Component, lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from './lib/supabase.js'
import Login from './components/Login.jsx'
import UpdatePassword from './components/UpdatePassword.jsx'
import Sidebar from './components/Sidebar.jsx'
import { subscribeToTables } from './lib/supabaseRealtime.js'

// 1. IMPORTAR ThemeProvider
import { ThemeProvider } from './contexts/ThemeContext.jsx'
import SchoolManagement from './components/SchoolManagement.jsx'

const StudentList = lazy(() => import('./components/StudentList.jsx'))
const PracticeList = lazy(() => import('./components/PracticeList.jsx'))
const TLBList = lazy(() => import('./components/TLBList.jsx'))
const VideoList = lazy(() => import('./components/VideoList.jsx'))
const ModuleDetailPage = lazy(() => import('./components/ModuleDetail.jsx'))
const loadManagementPages = () => import('./components/ManagementPages.jsx')
const ModulesPage = lazy(() => loadManagementPages().then((mod) => ({ default: mod.ModulesPage })))
const AssignmentsPage = lazy(() => loadManagementPages().then((mod) => ({ default: mod.AssignmentsPage })))
const AircraftPage = lazy(() => loadManagementPages().then((mod) => ({ default: mod.AircraftPage })))
const ReportsPage = lazy(() => loadManagementPages().then((mod) => ({ default: mod.ReportsPage })))
const SettingsPage = lazy(() => loadManagementPages().then((mod) => ({ default: mod.SettingsPage })))

const ProfileManagement = lazy(() => import('./components/ProfileManagement.jsx'))
const ProfileSettings = lazy(() => import('./components/ProfileSettings.jsx'))

const ROLES = { ADMIN: 'admin', TEACHER: 'profesor', STUDENT: 'alumno' }
const ALL_ROLES = Object.values(ROLES)

const PAGE_ACCESS = {
  dashboard: ALL_ROLES,
  modules: ALL_ROLES,
  'module-detail': ALL_ROLES,
  students: [ROLES.ADMIN, ROLES.TEACHER],
  practices: ALL_ROLES,
  tlb: ALL_ROLES,
  videos: ALL_ROLES,
  assignments: [ROLES.ADMIN],
  teachers: [ROLES.ADMIN],
  aircraft: ALL_ROLES,
  reports: [ROLES.ADMIN, ROLES.TEACHER],
  settings: [ROLES.ADMIN],
  mydata: ALL_ROLES,
  schools: [ROLES.ADMIN],
}

const isRecoveryUrl = () => typeof window !== 'undefined' && window.location.hash.includes('type=recovery')

class PageErrorBoundary extends Component {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidUpdate(prevProps) {
    if (prevProps.resetKey !== this.props.resetKey && this.state.failed) this.setState({ failed: false })
  }
  render() {
    if (!this.state.failed) return this.props.children
    return (
      <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-5 text-sm text-red-800">
        <p className="font-semibold">No se pudo cargar esta sección.</p>
        <p className="mt-1">Comprueba tu conexión e inténtalo de nuevo.</p>
        <button type="button" className="mt-3 rounded bg-red-700 px-4 py-2 font-semibold text-white" onClick={() => window.location.reload()}>Recargar la página</button>
      </div>
    )
  }
}

function App() {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)
  const [profileError, setProfileError] = useState('')
  const [recovering, setRecovering] = useState(isRecoveryUrl)
  const [activePage, setActivePage] = useState('dashboard')
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [selectedModuleId, setSelectedModuleId] = useState(null)
  const [selectedTlbId, setSelectedTlbId] = useState(null)

  const userIdRef = useRef(null)
  const inFlightRef = useRef(null)
  const recoveringRef = useRef(isRecoveryUrl())

  const loadUserProfile = useCallback(async (authUser) => {
    if (recoveringRef.current || inFlightRef.current === authUser.id) return
    inFlightRef.current = authUser.id
    try {
      const { data: profile, error } = await supabase
        .from('profiles')
        .select('role,full_name')
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
      if (event === 'PASSWORD_RECOVERY') {
        recoveringRef.current = true
        setRecovering(true)
        setLoading(false)
        return
      }
      if (event === 'TOKEN_REFRESHED') return
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
      else if (!recoveringRef.current) setLoading(false)
    }).catch(() => { if (active) setLoading(false) })

    return () => { active = false; subscription.unsubscribe() }
  }, [loadUserProfile])

  function handleLoginSuccess(loggedUser) {
    userIdRef.current = loggedUser.id
    setProfileError('')
    setUser(loggedUser)
  }

  function handlePasswordUpdated() {
    recoveringRef.current = false
    setRecovering(false)
    userIdRef.current = null
    setUser(null)
    window.history.replaceState(null, '', window.location.pathname)
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

  if (recovering) return <UpdatePassword onDone={handlePasswordUpdated} />

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100">
        <p className="text-blue-900 text-xl font-semibold">Cargando...</p>
      </div>
    )
  }

  if (!user && profileError) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-100 p-4">
        <div role="alert" className="max-w-md rounded-lg bg-white p-6 text-center shadow">
          <p className="text-sm text-red-800">{profileError}</p>
          <button type="button" className="mt-4 rounded bg-[#1e88e5] px-4 py-2 text-sm font-semibold text-white" onClick={() => setProfileError('')}>Volver al inicio de sesión</button>
        </div>
      </div>
    )
  }

  if (!user) {
    return <Login onLoginSuccess={handleLoginSuccess} />
  }

  const currentPage = PAGE_ACCESS[activePage]?.includes(user.role) ? activePage : 'dashboard'

  const renderPage = () => {
    switch (currentPage) {
      case 'students': return <StudentList user={user} />
      case 'practices': return <PracticeList user={user} />
      case 'tlb': return <TLBList user={user} initialTlbId={selectedTlbId} onClearInitialTlb={() => setSelectedTlbId(null)} />
      case 'videos': return <VideoList user={user} />
      case 'modules': return <ModulesPage user={user} onOpenModule={(moduleId) => { setSelectedModuleId(moduleId); setActivePage('module-detail') }} />
      case 'module-detail': return <ModuleDetailPage moduleId={selectedModuleId} user={user} onBack={() => setActivePage('modules')} onOpenTLB={(tlbId) => { setSelectedTlbId(tlbId); setActivePage('tlb') }} />
      case 'assignments': return <AssignmentsPage user={user} />
      case 'teachers': return <ProfileManagement user={user} />
      case 'aircraft': return <AircraftPage user={user} />
      case 'reports': return <ReportsPage />
      case 'settings': return <SettingsPage user={user} />
      case 'mydata': return <ProfileSettings user={user} />
      case 'schools': return <SchoolManagement user={user} />
      default: return <DashboardHome user={user} setActivePage={setActivePage} />
    }
  }

  const pageTitles = {
    dashboard: 'Dashboard',
    modules: user.role === ROLES.STUDENT ? 'Mis módulos' : 'Módulos EASA Part 66',
    'module-detail': selectedModuleId ? `Detalle ${selectedModuleId}` : 'Detalle del módulo',
    students: user.role === ROLES.TEACHER ? 'Mis alumnos' : 'Gestión de alumnos',
    practices: 'Prácticas',
    tlb: user.role === ROLES.STUDENT ? 'Mi Task Log Book' : 'Task Log Book',
    videos: 'Vídeos formativos',
    assignments: 'Asignaciones',
    teachers: 'Gestión de perfiles',
    aircraft: 'Tipos de avión',
    reports: 'Informes globales',
    settings: 'Configuración',
    mydata: 'Mis datos',
    schools: 'Gestión de Escuelas',
  }

  // 2. ENVOLVER TODO EL RETORNO CON ThemeProvider
  return (
    <ThemeProvider user={user}>
      <div className="min-h-screen bg-[#f4f6f9] text-[#1a1a1a]">
        <Sidebar
          activePage={currentPage}
          setActivePage={(page) => {
            setActivePage(page)
            setSidebarOpen(false)
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
            className="fixed inset-0 z-30 bg-black/40 md:hidden"
          />
        )}
        <main className="min-h-screen md:ml-[280px]">
          <header className="sticky top-0 z-20 flex min-h-[76px] items-center justify-between gap-4 border-b border-[#e5e7eb] bg-white px-5 shadow-sm md:px-8">
            <div className="flex items-center gap-3">
              <button
                type="button"
                aria-label="Abrir menú"
                onClick={() => setSidebarOpen(true)}
                className="rounded-md border border-[#e5e7eb] px-3 py-2 text-lg text-[#0a2540] md:hidden"
              >
                ☰
              </button>
              <h1 className="text-lg font-bold text-[#0a2540] md:text-xl">{pageTitles[currentPage] || 'EASA Part 66'}</h1>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[#1e88e5] font-semibold text-white">
                {user.name?.[0]?.toUpperCase() || 'U'}
              </div>
              <div className="hidden sm:block">
                <div className="max-w-[180px] truncate text-sm font-semibold text-[#0a2540]">{user.name}</div>
                <div className="text-xs capitalize text-[#6b7280]">{user.role}</div>
              </div>
            </div>
          </header>
          <div className="p-4 md:p-7">
            <PageErrorBoundary resetKey={currentPage}>
              <Suspense fallback={<div className="flex min-h-[40vh] items-center justify-center text-sm text-[#6b7280]">Cargando sección…</div>}>
                {renderPage()}
              </Suspense>
            </PageErrorBoundary>
          </div>
        </main>
      </div>
    </ThemeProvider>
  )
}

// ... (El resto del código de DashboardHome se mantiene igual que en tu archivo anterior) ...
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

function DashboardHome({ user, setActivePage }) {
  const [stats, setStats] = useState(null)

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

        const counts = user.role === ROLES.ADMIN
          ? await Promise.all(STAT_TABLES.map((table) => countTable(table, false)))
          : await Promise.all([
            Promise.resolve({ count: studentCount, error: null }),
            countTable('practices', true),
            countTable('tlbs', true),
            countTable('videos', true),
            Promise.resolve({ count: moduleIds.length, error: null }),
          ])

        if (!cancelled) {
          setStats(Object.fromEntries(STAT_TABLES.map((table, index) => [
            table,
            counts[index].error ? '—' : counts[index].count ?? 0,
          ])))
        }
      } catch {
        if (!cancelled) setStats(Object.fromEntries(STAT_TABLES.map((table) => [table, '—'])))
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

  const cards = user.role === ROLES.STUDENT
    ? [['modules', 'Mis módulos', '📚', 'modules'], ['tlbs', 'Mi Task Log Book', '📋', 'tlb'], ['videos', 'Vídeos', '🎬', 'videos'], ['practices', 'Prácticas', '🔧', 'practices']]
    : [['students', user.role === ROLES.TEACHER ? 'Mis alumnos' : 'Alumnos', '👥', 'students'], ['modules', 'Módulos EASA', '📚', 'modules'], ['tlbs', 'Task Log Books', '📋', 'tlb'], ['videos', 'Vídeos formativos', '🎬', 'videos']]

  return (
    <div className="space-y-6">
      <section className="rounded-lg bg-[#0a2540] p-6 text-white md:p-8">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-blue-200">EASA Part 66 · Gestión académica</p>
        <h2 className="mt-3 text-2xl font-bold md:text-3xl">Bienvenido, {user.name}</h2>
        <p className="mt-2 text-sm text-blue-100">Resumen de actividad para tu perfil de {user.role}.</p>
      </section>

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map(([statKey, label, icon, page], index) => (
          <button
            type="button"
            key={statKey}
            onClick={() => setActivePage(page)}
            className="cursor-pointer rounded-lg border border-[#e5e7eb] border-l-4 bg-white p-5 text-left shadow-sm transition-all hover:-translate-y-1 hover:shadow-md"
            style={{ borderLeftColor: ['#1e88e5', '#2e7d32', '#ef6c00', '#ffb300'][index] }}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase text-[#6b7280]">{label}</h3>
              <span aria-hidden="true" className="text-lg">{icon}</span>
            </div>
            <p className="mt-3 text-3xl font-bold text-[#0a2540]">{stats?.[statKey] ?? '…'}</p>
          </button>
        ))}
      </section>
    </div>
  )
}

export default App