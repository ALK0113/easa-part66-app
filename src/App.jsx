import { lazy, Suspense, useState, useEffect } from 'react'
import { supabase } from './lib/supabase.js'
import Login from './components/Login.jsx'
import Sidebar from './components/Sidebar.jsx'
import { subscribeToTables } from './lib/supabaseRealtime.js'

const StudentList = lazy(() => import('./components/StudentList.jsx'))
const PracticeList = lazy(() => import('./components/PracticeList.jsx'))
const TLBList = lazy(() => import('./components/TLBList.jsx'))
const VideoList = lazy(() => import('./components/VideoList.jsx'))
const ModuleDetailPage = lazy(() => import('./components/ModuleDetail.jsx'))
const loadManagementPages = () => import('./components/ManagementPages.jsx')
const ModulesPage = lazy(() => loadManagementPages().then((module) => ({ default: module.ModulesPage })))
const AssignmentsPage = lazy(() => loadManagementPages().then((module) => ({ default: module.AssignmentsPage })))
const AircraftPage = lazy(() => loadManagementPages().then((module) => ({ default: module.AircraftPage })))
const ReportsPage = lazy(() => loadManagementPages().then((module) => ({ default: module.ReportsPage })))
const SettingsPage = lazy(() => loadManagementPages().then((module) => ({ default: module.SettingsPage })))

const ProfileManagement = lazy(() => import('./components/ProfileManagement.jsx'))
const ProfileSettings = lazy(() => import('./components/ProfileSettings.jsx'))

function App() {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)
  const [activePage, setActivePage] = useState('dashboard')
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [selectedModuleId, setSelectedModuleId] = useState(null)
  const [selectedTlbId, setSelectedTlbId] = useState(null)

  async function loadUserProfile(authUser) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', authUser.id)
      .single()

    setUser({
      id: authUser.id,
      email: authUser.email,
      role: profile?.role || 'alumno',
      name: profile?.full_name || 'Usuario'
    })
    setLoading(false)
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        loadUserProfile(session.user)
      } else {
        setLoading(false)
      }
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        loadUserProfile(session.user)
      } else {
        setUser(null)
        setLoading(false)
      }
    })

    return () => subscription.unsubscribe()
  }, [])

  async function handleLogout() {
    await supabase.auth.signOut()
    setUser(null)
    setActivePage('dashboard')
    setSidebarOpen(false)
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100">
        <p className="text-blue-900 text-xl font-semibold">Cargando...</p>
      </div>
    )
  }

  if (!user) {
    return <Login onLoginSuccess={setUser} />
  }

  const renderPage = () => {
    switch (activePage) {
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
      case 'dashboard': return <DashboardHome user={user} setActivePage={setActivePage} />
      default: return <DashboardHome user={user} setActivePage={setActivePage} />
    }
  }

  const pageTitles = {
    dashboard: 'Dashboard',
    modules: user.role === 'alumno' ? 'Mis módulos' : 'Módulos EASA Part 66',
    'module-detail': selectedModuleId ? `Detalle ${selectedModuleId}` : 'Detalle del módulo',
    students: user.role === 'profesor' ? 'Mis alumnos' : 'Gestión de alumnos',
    practices: 'Prácticas',
    tlb: user.role === 'alumno' ? 'Mi Task Log Book' : 'Task Log Book',
    videos: 'Vídeos formativos',
    assignments: 'Asignaciones',
    teachers: 'Gestión de perfiles',
    aircraft: 'Tipos de avión',
    reports: 'Informes globales',
    settings: 'Configuración',
    mydata: 'Mis datos',
  }

  return (
    <div className="min-h-screen bg-[#f4f6f9] text-[#1a1a1a]">
      <Sidebar
        activePage={activePage} 
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
            <h1 className="text-lg font-bold text-[#0a2540] md:text-xl">{pageTitles[activePage]}</h1>
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
          <Suspense fallback={<div className="flex min-h-[40vh] items-center justify-center text-sm text-[#6b7280]">Cargando sección…</div>}>
            {renderPage()}
          </Suspense>
        </div>
      </main>
    </div>
  )
}

function DashboardHome({ user, setActivePage }) {
  const [stats, setStats] = useState(null)

  useEffect(() => {
    let cancelled = false

    async function fetchStats() {
      const tables = ['students', 'practices', 'tlbs', 'videos', 'modules']
      let moduleIds = []
      let studentCount = null

      if (user.role === 'profesor') {
        const { data } = await supabase.from('teacher_modules').select('module_id').eq('profile_id', user.id)
        moduleIds = (data || []).map((entry) => entry.module_id)
        if (moduleIds.length) {
          const { data: memberships } = await supabase.from('student_modules').select('student_id').in('module_id', moduleIds)
          studentCount = new Set((memberships || []).map((entry) => entry.student_id)).size
        } else studentCount = 0
      } else if (user.role === 'alumno') {
        const { data: link } = await supabase.from('student_profiles').select('student_id').eq('profile_id', user.id).maybeSingle()
        if (link) {
          const { data: memberships } = await supabase.from('student_modules').select('module_id').eq('student_id', link.student_id)
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

      const counts = user.role === 'admin'
        ? await Promise.all(tables.map((table) => countTable(table, false)))
        : await Promise.all([
          Promise.resolve({ count: studentCount, error: null }),
          countTable('practices', true),
          countTable('tlbs', true),
          countTable('videos', true),
          Promise.resolve({ count: moduleIds.length, error: null }),
        ])

      if (!cancelled) {
        setStats(Object.fromEntries(tables.map((table, index) => [
          table,
          counts[index].error ? '—' : counts[index].count ?? 0,
        ])))
      }
    }

    fetchStats()
    const unsubscribe = subscribeToTables(['students', 'practices', 'tlbs', 'videos', 'modules', 'student_modules', 'teacher_modules'], fetchStats, 'dashboard-stats')
    return () => { cancelled = true; unsubscribe() }
  }, [user.id, user.role])

  // 4 PESTAÑAS: Alumnos, Módulos (antes Prácticas), TLB y Vídeos
  const cards = user.role === 'alumno'
    ? [['modules', 'Mis módulos', '📚'], ['tlbs', 'Mi Task Log Book', '📋'], ['videos', 'Vídeos', '🎬'], ['practices', 'Prácticas', '🔧']]
    : [['students', user.role === 'profesor' ? 'Mis alumnos' : 'Alumnos', '👥'], ['modules', 'Módulos EASA', '📚'], ['tlbs', 'Task Log Books', '📋'], ['videos', 'Vídeos formativos', '🎬']]

  return (
    <div className="space-y-6">
      <section className="rounded-lg bg-[#0a2540] p-6 text-white md:p-8">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-blue-200">EASA Part 66 · Gestión académica</p>
        <h2 className="mt-3 text-2xl font-bold md:text-3xl">Bienvenido, {user.name}</h2>
        <p className="mt-2 text-sm text-blue-100">Resumen de actividad para tu perfil de {user.role}.</p>
      </section>

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map(([key, label, icon], index) => (
          <div 
            key={key} 
            onClick={() => setActivePage(key === 'tlbs' ? 'tlb' : key)}
            className="cursor-pointer rounded-lg border border-[#e5e7eb] border-l-4 bg-white p-5 shadow-sm transition-all hover:shadow-md hover:-translate-y-1"
            style={{ borderLeftColor: ['#1e88e5', '#2e7d32', '#ef6c00', '#ffb300'][index] }}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase text-[#6b7280]">{label}</h3>
              <span aria-hidden="true" className="text-lg">{icon}</span>
            </div>
            <p className="mt-3 text-3xl font-bold text-[#0a2540]">{stats?.[key] ?? '…'}</p>
          </div>
        ))}
      </section>
    </div>
  )
}

export default App