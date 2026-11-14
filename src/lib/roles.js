// Fuente única de roles y permisos de navegación (App y Sidebar la usan).
export const ROLES = { ADMIN: 'admin', TEACHER: 'profesor', STUDENT: 'alumno' }
export const ALL_ROLES = Object.values(ROLES)

const STAFF = [ROLES.ADMIN, ROLES.TEACHER]
const ADMIN_ONLY = [ROLES.ADMIN]

// Páginas accesibles por rol. Las que no aparecen en el menú (module-detail) también se controlan aquí.
export const PAGE_ACCESS = {
  dashboard: ALL_ROLES,
  schools: ADMIN_ONLY,
  structure: ADMIN_ONLY,
  modules: ALL_ROLES,
  'module-detail': ALL_ROLES,
  students: STAFF,
  practices: STAFF,
  tlb: ALL_ROLES,
  videos: ALL_ROLES,
  assignments: ADMIN_ONLY,
  teachers: ADMIN_ONLY,
  aircraft: STAFF,
  reports: ADMIN_ONLY,
  settings: ADMIN_ONLY,
  mydata: ALL_ROLES,
  progress: [ROLES.STUDENT],
}

export const canAccessPage = (page, role) => Boolean(PAGE_ACCESS[page]?.includes(role))
