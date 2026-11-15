import { ROLE_LABELS, canAccessPage } from '../lib/roles.js'
import Icon from './Icon.jsx'
import { useSchool } from '../contexts/useSchool.js'

// Los permisos de cada entrada salen de PAGE_ACCESS (src/lib/roles.js).
// Agrupado por uso: lo diario arriba, la administración abajo.
const sections = [
  {
    id: 'daily',
    items: [
      { id: 'dashboard', label: 'Inicio', icon: 'home' },
      { id: 'timetable', label: 'Horario', icon: 'calendar' },
      { id: 'modules', label: 'Módulos', icon: 'book' },
      { id: 'progress', label: 'Mi progreso', icon: 'chart' },
      { id: 'practices', label: 'Prácticas', icon: 'wrench' },
      { id: 'grades', label: 'Notas', icon: 'grade' },
      { id: 'tlb', label: 'Task Log Book', icon: 'clipboard' },
      { id: 'videos', label: 'Vídeos', icon: 'play' },
      { id: 'students', label: 'Alumnos', icon: 'users' },
      { id: 'mygroups', label: 'Mis grupos', icon: 'link' },
      { id: 'aircraft', label: 'Aviones', icon: 'plane' },
    ],
  },
  {
    id: 'admin',
    label: 'Administración',
    items: [
      { id: 'schools', label: 'Escuelas', icon: 'school' },
      { id: 'structure', label: 'Estructura académica', icon: 'layers' },
      { id: 'assignments', label: 'Asignaciones', icon: 'link' },
      { id: 'teachers', label: 'Perfiles', icon: 'idcard' },
      { id: 'reports', label: 'Informes', icon: 'chart' },
      { id: 'settings', label: 'Configuración', icon: 'settings' },
    ],
  },
]


export default function Sidebar({ activePage, setActivePage, user, onLogout, isOpen, onClose }) {
  const { isAdmin, schools, schoolId, setSchoolId } = useSchool()
  const isActive = (id) => activePage === id || (activePage === 'module-detail' && id === 'modules')

  const navButton = (item) => (
    <button
      key={item.id}
      type="button"
      onClick={() => setActivePage(item.id)}
      aria-current={isActive(item.id) ? 'page' : undefined}
      className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition-colors ${
        isActive(item.id)
          ? 'bg-accent-soft font-semibold text-accent-strong'
          : 'text-ink-soft hover:bg-subtle hover:text-ink'
      }`}
    >
      <Icon name={item.icon} className={isActive(item.id) ? 'text-accent' : 'text-faint'} />
      {item.label}
    </button>
  )

  return (
    <aside className={`fixed inset-y-0 left-0 z-40 flex w-[264px] flex-col border-r border-line bg-surface transition-transform duration-200 md:translate-x-0 ${isOpen ? 'translate-x-0 shadow-lift' : '-translate-x-full'}`}>
      <div className="flex items-center gap-3 px-5 pb-4 pt-6">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent-soft text-accent">
          <Icon name="plane" size={18} />
        </span>
        <div className="min-w-0">
          <p className="text-[15px] font-semibold leading-tight text-ink">AviaTrack</p>
          <p className="text-xs text-muted">EASA Part-147</p>
        </div>
        <button type="button" onClick={onClose} aria-label="Cerrar menú" className="ml-auto rounded-lg p-2 text-muted hover:bg-subtle md:hidden">
          <Icon name="x" />
        </button>
      </div>

      {isAdmin && schools.length > 0 && (
        <div className="px-4 pb-1">
          <label className="block text-xs font-medium text-faint">Escuela
            <select className="input mt-1 h-9 w-full text-sm" value={schoolId} onChange={(event) => setSchoolId(event.target.value)}>
              <option value="">Todas las escuelas</option>
              {schools.map((school) => <option key={school.id} value={school.id}>{school.name}</option>)}
            </select>
          </label>
        </div>
      )}

      <nav aria-label="Navegación principal" className="flex-1 space-y-6 overflow-y-auto px-3 py-3">
        {sections.map((section) => {
          const items = section.items.filter((item) => canAccessPage(item.id, user.role))
          if (!items.length) return null
          return (
            <div key={section.id}>
              {section.label && <p className="px-3 pb-2 text-xs font-medium text-faint">{section.label}</p>}
              <div className="space-y-0.5">{items.map(navButton)}</div>
            </div>
          )
        })}
      </nav>

      <div className="border-t border-line p-3">
        <button
          type="button"
          onClick={() => setActivePage('mydata')}
          aria-current={activePage === 'mydata' ? 'page' : undefined}
          className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors ${activePage === 'mydata' ? 'bg-accent-soft' : 'hover:bg-subtle'}`}
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent-soft text-sm font-semibold text-accent-strong">
            {user.name?.[0]?.toUpperCase() || 'U'}
          </span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium text-ink">{user.name}</span>
            <span className="block text-xs text-muted">{ROLE_LABELS[user.role] || user.role} · Mis datos</span>
          </span>
        </button>
        <button
          type="button"
          onClick={onLogout}
          className="mt-1 flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm text-muted transition-colors hover:bg-danger-soft hover:text-danger"
        >
          <Icon name="logout" className="text-faint" />
          Cerrar sesión
        </button>
      </div>
    </aside>
  )
}
