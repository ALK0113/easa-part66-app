// Fuente única de roles y permisos de navegación (App y Sidebar la usan).
export const ROLES = { ADMIN: 'admin', SUPERVISOR: 'supervisor', TEACHER: 'profesor', STUDENT: 'alumno' }
export const ALL_ROLES = Object.values(ROLES)

export const ROLE_LABELS = {
  [ROLES.ADMIN]: 'Administración',
  [ROLES.SUPERVISOR]: 'Supervisor',
  [ROLES.TEACHER]: 'Profesor',
  [ROLES.STUDENT]: 'Alumno',
}

// Gestiona una escuela: el admin todas, el supervisor la suya.
export const isManager = (role) => role === ROLES.ADMIN || role === ROLES.SUPERVISOR
// Da clase de los módulos que tiene asignados (el supervisor también puede dar clase).
export const teachesLikeProfessor = (role) => role === ROLES.TEACHER || role === ROLES.SUPERVISOR

const STAFF = [ROLES.ADMIN, ROLES.SUPERVISOR, ROLES.TEACHER]
const MANAGERS = [ROLES.ADMIN, ROLES.SUPERVISOR]
const ADMIN_ONLY = [ROLES.ADMIN]

// Páginas accesibles por rol. Las que no aparecen en el menú (module-detail) también se controlan aquí.
export const PAGE_ACCESS = {
  dashboard: ALL_ROLES,
  schools: ADMIN_ONLY,
  structure: MANAGERS,
  modules: ALL_ROLES,
  'module-detail': ALL_ROLES,
  students: STAFF,
  practices: STAFF,
  timetable: ALL_ROLES,
  grades: STAFF,
  tlb: ALL_ROLES,
  videos: ALL_ROLES,
  assignments: MANAGERS,
  mygroups: [ROLES.TEACHER],
  teachers: MANAGERS,
  aircraft: STAFF,
  reports: MANAGERS,
  settings: ADMIN_ONLY,
  mydata: ALL_ROLES,
  progress: [ROLES.STUDENT],
}

export const canAccessPage = (page, role) => Boolean(PAGE_ACCESS[page]?.includes(role))
