const navigation = [
  { id: 'dashboard', label: 'Dashboard', icon: '📊', roles: ['admin', 'profesor', 'alumno'] },
  { id: 'schools', label: 'Escuelas', icon: '🏫', roles: ['admin'] }, 
  { id: 'modules', label: 'Módulos', icon: '📚', roles: ['admin', 'profesor', 'alumno'] },
  { id: 'students', label: 'Alumnos', icon: '👥', roles: ['admin', 'profesor'] },
  { id: 'practices', label: 'Prácticas', icon: '🔧', roles: ['admin', 'profesor'] },
  { id: 'tlb', label: 'Task Log Book', icon: '📋', roles: ['admin', 'profesor', 'alumno'] },
  { id: 'videos', label: 'Vídeos', icon: '🎬', roles: ['admin', 'profesor', 'alumno'] },
  { id: 'assignments', label: 'Asignaciones', icon: '🔗', roles: ['admin'] },
  { id: 'teachers', label: 'Gestión de perfiles', icon: '👥', roles: ['admin'] },  
  { id: 'aircraft', label: 'Aviones', icon: '✈️', roles: ['admin'] },
  { id: 'reports', label: 'Informes', icon: '📈', roles: ['admin'] },
  { id: 'settings', label: 'Configuración', icon: '⚙️', roles: ['admin'] },
  { id: 'mydata', label: 'Mis datos', icon: '👤', roles: ['admin', 'profesor', 'alumno'] },
]

export default function Sidebar({ activePage, setActivePage, user, onLogout, isOpen, onClose }) {
  const visibleItems = navigation.filter((item) => item.roles.includes(user.role))

  return (
    <aside className={`fixed inset-y-0 left-0 z-40 flex w-[280px] flex-col bg-[#0a2540] text-white shadow-xl transition-transform duration-200 md:translate-x-0 ${isOpen ? 'translate-x-0' : '-translate-x-full'}`}>
      <div className="border-b border-white/10 px-6 py-5">
        <div className="flex items-center gap-3">
          <span aria-hidden="true" className="text-2xl">✈️</span>
          <div>
            <h2 className="text-base font-bold">AviaTrack</h2>
            <p className="mt-1 text-[11px] text-blue-100/70">EASA Part 66 · Gestión 26-27</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Cerrar menú" className="ml-auto rounded p-2 text-white/70 hover:bg-white/10 md:hidden">×</button>
        </div>
      </div>

      <div className="border-b border-white/10 bg-white/[0.04] px-5 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#1e88e5] font-bold">
            {user.name?.[0]?.toUpperCase() || 'U'}
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{user.name}</p>
            <p className="mt-0.5 text-xs capitalize text-blue-100/70">{user.role}</p>
          </div>
        </div>
      </div>

      <nav aria-label="Navegación principal" className="flex-1 overflow-y-auto px-3 py-4">
        <p className="px-3 pb-2 pt-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-white/50">
          {user.role === 'alumno' ? 'Mi formación' : 'Gestión académica'}
        </p>
        <div className="space-y-1">
          {visibleItems.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setActivePage(item.id)}
              aria-current={activePage === item.id || (activePage === 'module-detail' && item.id === 'modules') ? 'page' : undefined}
              className={`flex w-full items-center gap-3 border-l-[3px] px-3 py-2.5 text-left text-sm transition-colors ${
                activePage === item.id || (activePage === 'module-detail' && item.id === 'modules')
                  ? 'border-[#ffb300] bg-white/10 font-semibold text-white'
                  : 'border-transparent text-blue-100/85 hover:bg-white/[0.07] hover:text-white'
              }`}
            >
              <span aria-hidden="true" className="w-5 text-center text-base">{item.icon}</span>
              {item.label}
            </button>
          ))}
        </div>
      </nav>

      <div className="border-t border-white/10 p-3">
        <button
          type="button"
          onClick={onLogout}
          className="flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm text-blue-100/85 transition-colors hover:bg-[#c62828] hover:text-white"
        >
          <span aria-hidden="true" className="w-5 text-center">🚪</span>
          Cerrar sesión
        </button>
      </div>
    </aside>
  )
}