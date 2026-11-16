import { useEffect, useState, useCallback, useRef, useMemo } from 'react'
import { supabase } from '../lib/supabase.js'
import Icon from './Icon.jsx'
import JoinCode from './JoinCode.jsx'
import { getSupabaseErrorMessage } from '../lib/supabaseErrors.js'
import { useTheme } from '../contexts/useTheme.js'
import { COLOR_PRESETS, DEFAULT_BRAND_COLOR } from '../lib/theme.js'
import { downloadCsv } from '../lib/download.js'
import { ROLES } from '../lib/roles.js'
import { useSchool } from '../contexts/useSchool.js'

const ITEMS_PER_PAGE = 6
const DEBOUNCE_DELAY = 300

const inputClass = 'input'
const buttonPrimary = 'btn-primary'
const buttonSecondary = 'btn-secondary'

function parseSupabaseError(err) {
  const code = err?.code
  const detail = err?.details
  switch (code) {
    case 'P0001': return { message: 'No tienes permisos para esta acción' }
    case 'P0002': return { message: detail === 'school_not_found' ? 'Centro no encontrado' : 'Recurso no encontrado' }
    case '22023': return { message: detail === 'name_required' ? 'El nombre es obligatorio' : detail === 'color_must_be_hex' ? 'Color inválido (formato #RRGGBB)' : 'Datos inválidos', field: detail === 'name_required' ? 'name' : undefined }
    case '23505': return { message: detail === 'name_already_exists' ? 'Ya existe un centro con este nombre' : 'Conflicto de datos', field: detail === 'name_already_exists' ? 'name' : undefined }
    default: return { message: getSupabaseErrorMessage(err) || 'Error desconocido' }
  }
}

function generateId() {
  return Math.random().toString(36).substring(2, 11)
}

function exportToCSV(schools, filename = 'centros') {
  const headers = ['ID', 'Nombre', 'Dirección', 'Ciudad', 'Teléfono', 'Email', 'Color', 'Alumnos', 'Profesores', 'Supervisores']
  const rows = schools.map(s => [
    s.school_id, s.school_name, s.school_address || '', s.school_city || '',
    s.school_phone || '', s.school_email || '', s.brand_color || '',
    s.total_students, s.total_teachers, s.total_supervisors,
  ])
  downloadCsv([headers, ...rows], `${filename}_${new Date().toISOString().split('T')[0]}.csv`)
}

const ACTIVE_SCHOOL_KEY = 'activeSchoolId'
function readActiveSchool() {
  try { return localStorage.getItem(ACTIVE_SCHOOL_KEY) } catch { return null }
}
function writeActiveSchool(id) {
  try {
    if (id) localStorage.setItem(ACTIVE_SCHOOL_KEY, id)
    else localStorage.removeItem(ACTIVE_SCHOOL_KEY)
  } catch { /* almacenamiento no disponible */ }
}

function isValidHexColor(color) {
  return /^#[0-9A-Fa-f]{6}$/.test(color)
}

export default function SchoolManagement({ user }) {
  const { setPrimaryColor } = useTheme()
  const isAdmin = user?.role === ROLES.ADMIN
  const { reloadSchools } = useSchool()

  const [schools, setSchools] = useState([])
  const [supervisorCandidates, setSupervisorCandidates] = useState([])
  const [selectedSchool, setSelectedSchool] = useState(null)
  const [schoolSupervisors, setSchoolSupervisors] = useState([])
  const [loading, setLoading] = useState(true)
  const [toasts, setToasts] = useState([])

  const [activeSchoolId, setActiveSchoolId] = useState(readActiveSchool)
  const [searchQuery, setSearchQuery] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [currentPage, setCurrentPage] = useState(1)
  const [sortBy, setSortBy] = useState('name')
  const [sortOrder, setSortOrder] = useState('asc')

  const [createModalOpen, setCreateModalOpen] = useState(false)
  const [editModalOpen, setEditModalOpen] = useState(false)
  const [assignModalOpen, setAssignModalOpen] = useState(false)
  const [colorModalOpen, setColorModalOpen] = useState(false)
  const [colorEditingSchool, setColorEditingSchool] = useState(null)

  const emptyForm = { name: '', address: '', city: '', phone: '', email: '', brand_color: DEFAULT_BRAND_COLOR, supervisor_name: '', supervisor_email: '' }
  const [createForm, setCreateForm] = useState(emptyForm)
  // Nota: brand_color se gestiona en su propio modal, no en el formulario de edición general
  const [editForm, setEditForm] = useState({ id: '', name: '', address: '', city: '', phone: '', email: '' })
  const [assignForm, setAssignForm] = useState({ profileId: '' })
  const [newSupervisor, setNewSupervisor] = useState({ full_name: '', email: '' })
  const [creatingSupervisor, setCreatingSupervisor] = useState(false)
  
  const [selectedColor, setSelectedColor] = useState(DEFAULT_BRAND_COLOR)
  const [customColor, setCustomColor] = useState('')
  const [colorError, setColorError] = useState('')

  const [createErrors, setCreateErrors] = useState({})
  const [editErrors, setEditErrors] = useState({})

  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState(false)
  const [assigning, setAssigning] = useState(false)
  const [removing, setRemoving] = useState(null)
  const [savingColor, setSavingColor] = useState(false)

  const loadRequestRef = useRef(0)
  const debounceRef = useRef(null)

  const addToast = useCallback((type, message) => {
    const id = generateId()
    setToasts(prev => [...prev, { id, type, message }])
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 4000)
  }, [])

  const activeSchoolColor = useMemo(() => {
    if (!activeSchoolId) return null
    return schools.find(s => s.school_id === activeSchoolId)?.brand_color || null
  }, [activeSchoolId, schools])

  // Solo se aplica cuando hay un color concreto: así no se pisa el tema de la escuela
  // del usuario mientras la lista aún se está cargando.
  useEffect(() => {
    if (activeSchoolColor) setPrimaryColor(activeSchoolColor)
  }, [activeSchoolColor, setPrimaryColor])

  const handleSetActiveSchool = useCallback((id) => {
    setActiveSchoolId(id)
    writeActiveSchool(id)
    if (!id) setPrimaryColor(DEFAULT_BRAND_COLOR)
  }, [setPrimaryColor])

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      setDebouncedSearch(searchQuery)
      setCurrentPage(1)
    }, DEBOUNCE_DELAY)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [searchQuery])

  const filteredAndSortedSchools = useMemo(() => {
    let result = schools
    if (debouncedSearch) {
      const q = debouncedSearch.toLowerCase()
      result = result.filter(s =>
        s.school_name.toLowerCase().includes(q) ||
        (s.school_city && s.school_city.toLowerCase().includes(q)) ||
        (s.school_email && s.school_email.toLowerCase().includes(q))
      )
    }
    result = [...result].sort((a, b) => {
      let cmp = 0
      if (sortBy === 'name') cmp = a.school_name.localeCompare(b.school_name)
      else if (sortBy === 'students') cmp = a.total_students - b.total_students
      else if (sortBy === 'teachers') cmp = a.total_teachers - b.total_teachers
      return sortOrder === 'asc' ? cmp : -cmp
    })
    return result
  }, [schools, debouncedSearch, sortBy, sortOrder])

  const totalPages = Math.ceil(filteredAndSortedSchools.length / ITEMS_PER_PAGE)
  const paginatedSchools = filteredAndSortedSchools.slice((currentPage - 1) * ITEMS_PER_PAGE, currentPage * ITEMS_PER_PAGE)

  // Las recargas tras guardar se hacen en segundo plano (sin ocultar la lista).
  // Un contador descarta respuestas de peticiones ya superadas.
  const loadSchools = useCallback(async () => {
    const requestId = ++loadRequestRef.current
    try {
      const { data, error } = await supabase.rpc('admin_list_schools_with_stats')
      if (requestId !== loadRequestRef.current) return
      if (error) throw error
      setSchools(data || [])
    } catch (err) {
      if (requestId !== loadRequestRef.current) return
      const { message } = parseSupabaseError(err)
      addToast('error', `Error: ${message}`)
    } finally {
      if (requestId === loadRequestRef.current) setLoading(false)
    }
  }, [addToast])

  // Candidatos a supervisor: los profesores de esa escuela
  const loadSupervisorCandidates = useCallback(async (schoolId) => {
    const { data, error } = await supabase
      .from('school_profiles')
      .select('profile_id,profiles!inner(full_name,email,role)')
      .eq('school_id', schoolId)
      .eq('profiles.role', 'profesor')
    if (error) { console.error('Error cargando profesores:', error); return }
    setSupervisorCandidates((data || [])
      .map((row) => ({ profile_id: row.profile_id, full_name: row.profiles.full_name || row.profiles.email, email: row.profiles.email }))
      .sort((a, b) => a.full_name.localeCompare(b.full_name)))
  }, [])

  const loadSchoolSupervisors = useCallback(async (schoolId) => {
    try {
      const { data, error } = await supabase.rpc('admin_list_school_supervisors', { p_school_id: schoolId })
      if (error) throw error
      setSchoolSupervisors(data || [])
    } catch (err) {
      addToast('error', parseSupabaseError(err).message)
    }
  }, [addToast])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carga inicial: el setState ocurre tras el await
    loadSchools()
    return () => { loadRequestRef.current += 1 }
  }, [loadSchools])

  function validateForm(form) {
    const errors = {}
    if (!form.name.trim()) errors.name = 'Nombre obligatorio'
    if (form.name.length > 200) errors.name = 'Máximo 200 caracteres'
    if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) errors.email = 'Email inválido'
    // Supervisor opcional al crear: si se rellena uno de los dos campos, hacen falta ambos
    if (form.supervisor_email !== undefined && (form.supervisor_email.trim() || form.supervisor_name.trim())) {
      if (!form.supervisor_name.trim()) errors.supervisor_name = 'Nombre del supervisor obligatorio'
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.supervisor_email.trim())) errors.supervisor_email = 'Email inválido'
    }
    return errors
  }

  function openCreateModal() {
    setCreateForm(emptyForm)
    setCreateErrors({})
    setCreateModalOpen(true)
  }

  function openEditModal(school) {
    setEditForm({
      id: school.school_id,
      name: school.school_name,
      address: school.school_address || '',
      city: school.school_city || '',
      phone: school.school_phone || '',
      email: school.school_email || '',
    })
    setEditErrors({})
    setEditModalOpen(true)
  }

  function openAssignModal(school) {
    setSelectedSchool(school)
    loadSchoolSupervisors(school.school_id)
    loadSupervisorCandidates(school.school_id)
    setAssignForm({ profileId: '' })
    setAssignModalOpen(true)
  }

  function openColorModal(school) {
    setColorEditingSchool(school)
    setSelectedColor(school.brand_color || DEFAULT_BRAND_COLOR)
    setCustomColor(school.brand_color || '')
    setColorError('')
    setColorModalOpen(true)
  }

  function handleColorChange(value) {
    setCustomColor(value)
    if (value && !isValidHexColor(value)) {
      setColorError('Formato inválido. Usa #RRGGBB')
    } else {
      setColorError('')
    }
  }

  async function handleCreate(e) {
    e.preventDefault()
    const errors = validateForm(createForm)
    setCreateErrors(errors)
    if (Object.keys(errors).length > 0) return

    setCreating(true)
    try {
      const { data, error } = await supabase.rpc('admin_create_school', {
        p_name: createForm.name.trim(),
        p_address: createForm.address.trim() || null,
        p_city: createForm.city.trim() || null,
        p_phone: createForm.phone.trim() || null,
        p_email: createForm.email.trim() || null,
      })
      if (error) throw error

      // Actualizar color si es diferente al por defecto
      if (createForm.brand_color && createForm.brand_color !== DEFAULT_BRAND_COLOR && data) {
        const { error: brandError } = await supabase.rpc('admin_update_school_brand', {
          p_school_id: data.school_id,
          p_brand_color: createForm.brand_color,
        })
        if (brandError) addToast('error', `Centro creado, pero el color no se guardó: ${parseSupabaseError(brandError).message}`)
      }

      // La escuela nace con su supervisor (recibe una invitación por correo)
      const supervisorEmail = createForm.supervisor_email.trim().toLowerCase()
      if (supervisorEmail && data?.school_id) {
        const { error: supError } = await supabase.functions.invoke('admin-create-user', {
          body: { email: supervisorEmail, full_name: createForm.supervisor_name.trim(), role: 'supervisor', school_id: data.school_id },
        })
        if (supError) {
          let message = 'No se pudo crear el supervisor.'
          try { message = (await supError.context.json())?.error || message } catch { /* sin cuerpo */ }
          addToast('error', `Centro creado, pero el supervisor no: ${message} Créalo desde «Supervisores».`)
        } else {
          addToast('success', `Centro creado. Invitación enviada a ${supervisorEmail}`)
        }
      } else {
        addToast('success', 'Centro creado correctamente')
      }
      setCreateModalOpen(false)
      reloadSchools()
      await loadSchools()
    } catch (err) {
      const { message, field } = parseSupabaseError(err)
      addToast('error', message)
      if (field) setCreateErrors(prev => ({ ...prev, [field]: message }))
    } finally {
      setCreating(false)
    }
  }

  async function handleEdit(e) {
    e.preventDefault()
    const errors = validateForm(editForm)
    setEditErrors(errors)
    if (Object.keys(errors).length > 0) return

    setEditing(true)
    try {
      const { error } = await supabase.rpc('admin_update_school', {
        p_school_id: editForm.id,
        p_name: editForm.name.trim(),
        p_address: editForm.address.trim() || null,
        p_city: editForm.city.trim() || null,
        p_phone: editForm.phone.trim() || null,
        p_email: editForm.email.trim() || null,
      })
      if (error) throw error
      addToast('success', 'Centro actualizado')
      setEditModalOpen(false)
      reloadSchools()
      await loadSchools()
    } catch (err) {
      const { message, field } = parseSupabaseError(err)
      addToast('error', message)
      if (field) setEditErrors(prev => ({ ...prev, [field]: message }))
    } finally {
      setEditing(false)
    }
  }

  async function handleSaveColor() {
    if (!colorEditingSchool) return
    const color = customColor.trim() || selectedColor
    
    if (!isValidHexColor(color)) {
      addToast('error', 'Color inválido. Usa formato #RRGGBB')
      return
    }

    if (!window.confirm(`¿Cambiar el color de "${colorEditingSchool.school_name}"?\n\nEsto afectará a la interfaz de todos los usuarios de este centro.`)) {
      return
    }

    setSavingColor(true)
    try {
      const { error } = await supabase.rpc('admin_update_school_brand', {
        p_school_id: colorEditingSchool.school_id,
        p_brand_color: color,
      })
      if (error) throw error
      addToast('success', `Color actualizado para "${colorEditingSchool.school_name}"`)
      setColorModalOpen(false)
      reloadSchools()
      await loadSchools()
    } catch (err) {
      addToast('error', parseSupabaseError(err).message)
    } finally {
      setSavingColor(false)
    }
  }

  async function handleAssign(e) {
    e.preventDefault()
    if (!assignForm.profileId || !selectedSchool) return
    setAssigning(true)
    try {
      const { error } = await supabase.rpc('admin_make_supervisor', {
        p_profile_id: assignForm.profileId,
        p_school_id: selectedSchool.school_id,
      })
      if (error) throw error
      addToast('success', 'Supervisor nombrado correctamente')
      setAssignForm({ profileId: '' })
      await Promise.all([
        loadSchoolSupervisors(selectedSchool.school_id),
        loadSupervisorCandidates(selectedSchool.school_id),
        loadSchools(),
      ])
    } catch (err) {
      addToast('error', parseSupabaseError(err).message)
    } finally {
      setAssigning(false)
    }
  }

  // Escuela nueva sin profesores: el admin crea directamente su supervisor (recibe una invitación)
  async function handleCreateSupervisor(e) {
    e.preventDefault()
    if (!selectedSchool) return
    setCreatingSupervisor(true)
    try {
      const { error } = await supabase.functions.invoke('admin-create-user', {
        body: {
          email: newSupervisor.email.trim().toLowerCase(),
          full_name: newSupervisor.full_name.trim(),
          role: 'supervisor',
          school_id: selectedSchool.school_id,
        },
      })
      if (error) {
        let message = 'No se pudo crear el supervisor.'
        try { message = (await error.context.json())?.error || message } catch { /* sin cuerpo */ }
        throw new Error(message)
      }
      addToast('success', `Invitación enviada a ${newSupervisor.email.trim()}`)
      setNewSupervisor({ full_name: '', email: '' })
      await Promise.all([loadSchoolSupervisors(selectedSchool.school_id), loadSchools()])
    } catch (err) {
      addToast('error', err.message)
    } finally {
      setCreatingSupervisor(false)
    }
  }

  async function handleRemoveSupervisor(supervisor) {
    if (!selectedSchool) return
    if (!window.confirm(`¿Quitar a ${supervisor.full_name} como supervisor? Su rol cambiará a profesor.`)) return
    setRemoving(supervisor.profile_id)
    try {
      const { error } = await supabase.rpc('admin_remove_supervisor', {
        p_school_id: selectedSchool.school_id,
        p_profile_id: supervisor.profile_id,
      })
      if (error) throw error
      addToast('success', 'Supervisor retirado correctamente')
      await Promise.all([
        loadSchoolSupervisors(selectedSchool.school_id),
        loadSupervisorCandidates(selectedSchool.school_id),
        loadSchools(),
      ])
    } catch (err) {
      addToast('error', parseSupabaseError(err).message)
    } finally {
      setRemoving(null)
    }
  }

  if (!isAdmin) {
    return (
      <div className="p-8 text-center">
        <p className="text-lg font-semibold text-danger">Solo los administradores pueden gestionar centros</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Toasts */}
      <div className="fixed top-4 right-4 z-[100] space-y-2 max-w-sm">
        {toasts.map(toast => (
          <div key={toast.id} className={`fade-in rounded-xl border border-line bg-surface p-4 shadow-lift ${
            toast.type === 'success' ? 'text-success' :
            toast.type === 'error' ? 'text-danger' :
            'text-ink-soft'
          }`}>
            <div className="flex items-start justify-between gap-2">
              <p className="text-sm font-medium">{toast.message}</p>
              <button type="button" onClick={() => setToasts(prev => prev.filter(t => t.id !== toast.id))} className="opacity-60 hover:opacity-100 cursor-pointer text-lg leading-none">×</button>
            </div>
          </div>
        ))}
      </div>

      {/* Header */}
      <div className="page-intro">
        <div>
          <h2>Centros</h2>
          <p>{schools.length} {schools.length === 1 ? 'centro' : 'centros'} · colores de marca y supervisores</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => exportToCSV(filteredAndSortedSchools)} className={buttonSecondary}>
            <Icon name="download" size={16} />CSV
          </button>
          <button type="button" onClick={openCreateModal} className={buttonPrimary}>
            <Icon name="plus" size={16} />Nuevo centro
          </button>
        </div>
      </div>

      {/* Selector de Escuela */}
<div className="card p-5">
  <label className="mb-1.5 block text-sm font-medium text-ink-soft">
    Centro activo
  </label>
  <select
    value={activeSchoolId || ''}
    onChange={(e) => handleSetActiveSchool(e.target.value || null)}
    className={inputClass}
  >
    <option value="">No hay centro</option>
    {schools.map(s => (
      <option key={s.school_id} value={s.school_id}>
        {s.school_name}
      </option>
    ))}
  </select>
  {activeSchoolId && (
    <p className="mt-2 text-xs text-muted">
      Los acentos de la aplicación usan el color de este centro.
    </p>
  )}
</div>

      {/* Búsqueda y filtros */}
      <div>
        <div className="flex flex-col sm:flex-row gap-2">
          <div className="flex-1 relative">
            <Icon name="search" size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
            <input
              type="text"
              placeholder="Buscar por nombre, ciudad o correo…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className={`${inputClass} pl-9`}
            />
            {searchQuery && (
              <button type="button" onClick={() => setSearchQuery('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-faint hover:text-ink-soft cursor-pointer">×</button>
            )}
          </div>
          <select
            value={`${sortBy}-${sortOrder}`}
            onChange={(e) => {
              const [field, order] = e.target.value.split('-')
              setSortBy(field)
              setSortOrder(order)
            }}
            className={`${inputClass} w-auto`}
          >
            <option value="name-asc">Nombre A-Z</option>
            <option value="name-desc">Nombre Z-A</option>
            <option value="students-desc">Más alumnos</option>
            <option value="students-asc">Menos alumnos</option>
            <option value="teachers-desc">Más profesores</option>
            <option value="teachers-asc">Menos profesores</option>
          </select>
        </div>
        {debouncedSearch && (
          <p className="mt-2 text-xs text-muted">
            {filteredAndSortedSchools.length} resultado{filteredAndSortedSchools.length !== 1 ? 's' : ''} para "{debouncedSearch}"
          </p>
        )}
      </div>

      {/* Contenido Principal */}
      {loading ? (
        <div className="py-16 text-center text-sm text-muted">Cargando centros…</div>
      ) : filteredAndSortedSchools.length === 0 ? (
        <div className="card empty">
          <p className="font-medium text-ink-soft">
            {debouncedSearch ? 'Sin resultados' : 'No hay centros registrados'}
          </p>
          <p className="mt-1">
            {debouncedSearch ? 'Prueba con otros términos de búsqueda.' : 'Crea el primero con «Nuevo centro».'}
          </p>
        </div>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {paginatedSchools.map((school) => {
              const schoolColor = school.brand_color || DEFAULT_BRAND_COLOR
              const isActive = activeSchoolId === school.school_id
              return (
                <div
                  key={school.school_id}
                  className={`card group p-5 transition-shadow hover:shadow-lift ${
                    isActive ? 'ring-2 ring-offset-2 ring-offset-canvas' : ''
                  }`}
                  style={isActive ? { borderColor: schoolColor, '--tw-ring-color': schoolColor } : {}}
                >
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      <div
                        className="h-4 w-4 rounded-full flex-shrink-0 border border-line"
                        style={{ backgroundColor: schoolColor }}
                        title={`Color: ${schoolColor}`}
                      />
                      <h3 className="text-lg font-semibold text-ink truncate">{school.school_name}</h3>
                    </div>
                    <div className="-mr-1.5 -mt-1 flex text-muted">
                      <button type="button" onClick={() => openColorModal(school)} className="rounded-lg p-1.5 hover:bg-subtle hover:text-ink" title="Color de marca" aria-label={`Color de ${school.school_name}`}><Icon name="sun" size={16} /></button>
                      <button type="button" onClick={() => openEditModal(school)} className="rounded-lg p-1.5 hover:bg-subtle hover:text-ink" title="Editar" aria-label={`Editar ${school.school_name}`}><Icon name="edit" size={16} /></button>
                      <button type="button" onClick={() => openAssignModal(school)} className="rounded-lg p-1.5 hover:bg-subtle hover:text-ink" title="Supervisores" aria-label={`Supervisores de ${school.school_name}`}><Icon name="users" size={16} /></button>
                    </div>
                  </div>

                  <div className="space-y-1 text-sm text-muted">
                    {school.school_city && <p>{school.school_city}</p>}
                    {school.school_email && <p className="truncate"><a href={`mailto:${school.school_email}`} className="hover:underline" style={{ color: schoolColor }}>{school.school_email}</a></p>}
                    {school.school_phone && <p><a href={`tel:${school.school_phone}`} className="hover:underline" style={{ color: schoolColor }}>{school.school_phone}</a></p>}
                  </div>

                  <div className="mt-4 grid grid-cols-3 gap-2 border-t border-line pt-3">
                    <div className="text-center">
                      <div className="text-lg font-semibold text-ink">{school.total_students}</div>
                      <div className="text-xs text-muted">Alumnos</div>
                    </div>
                    <div className="text-center">
                      <div className="text-lg font-semibold text-ink">{school.total_teachers}</div>
                      <div className="text-xs text-muted">Profesores</div>
                    </div>
                    <div className="text-center">
                      <div className="text-lg font-semibold text-ink">{school.total_supervisors}</div>
                      <div className="text-xs text-muted">Supervisores</div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 pt-4">
              <button type="button" onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1} className={buttonSecondary}>Anterior</button>
              <div className="flex gap-1">
                {Array.from({ length: totalPages }, (_, i) => i + 1).map(page => (
                  <button
                    type="button" key={page} onClick={() => setCurrentPage(page)}
                    className={`h-9 w-9 rounded-lg text-sm font-semibold transition-all cursor-pointer ${
                      page === currentPage ? 'bg-accent text-white' : 'border border-line-strong bg-surface text-ink-soft hover:bg-subtle'
                    }`}
                  >{page}</button>
                ))}
              </div>
              <button type="button" onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages} className={buttonSecondary}>Siguiente</button>
            </div>
          )}
        </>
      )}

      {/* Modal Crear */}
      {createModalOpen && (
        <Modal onClose={() => setCreateModalOpen(false)} title="Nuevo centro">
          <form className="space-y-4" onSubmit={handleCreate} noValidate>
            <FormField label="Nombre" required error={createErrors.name}>
              <input className={inputClass} value={createForm.name} onChange={e => setCreateForm({ ...createForm, name: e.target.value })} placeholder="Centro Ejemplo" maxLength={200} />
            </FormField>
            <FormField label="Dirección">
              <input className={inputClass} value={createForm.address} onChange={e => setCreateForm({ ...createForm, address: e.target.value })} placeholder="Calle 123" />
            </FormField>
            <div className="grid grid-cols-2 gap-3">
              <FormField label="Ciudad">
                <input className={inputClass} value={createForm.city} onChange={e => setCreateForm({ ...createForm, city: e.target.value })} placeholder="Madrid" />
              </FormField>
              <FormField label="Teléfono">
                <input className={inputClass} value={createForm.phone} onChange={e => setCreateForm({ ...createForm, phone: e.target.value })} placeholder="+34..." />
              </FormField>
            </div>
            <FormField label="Email" error={createErrors.email}>
              <input type="email" className={inputClass} value={createForm.email} onChange={e => setCreateForm({ ...createForm, email: e.target.value })} placeholder="info@centro.com" />
            </FormField>
            <fieldset className="space-y-3 rounded-xl border border-line p-3">
              <legend className="px-1 text-sm font-semibold text-ink-soft">Supervisor (opcional)</legend>
              <p className="text-xs text-muted">Recibirá una invitación por correo y podrá poner en marcha el centro. También puedes nombrarlo después.</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <FormField label="Nombre" error={createErrors.supervisor_name}>
                  <input className={inputClass} value={createForm.supervisor_name} onChange={e => setCreateForm({ ...createForm, supervisor_name: e.target.value })} maxLength={100} autoComplete="off" />
                </FormField>
                <FormField label="Correo" error={createErrors.supervisor_email}>
                  <input type="email" className={inputClass} value={createForm.supervisor_email} onChange={e => setCreateForm({ ...createForm, supervisor_email: e.target.value })} autoComplete="off" />
                </FormField>
              </div>
            </fieldset>
            <ColorPickerField
              label="Color de marca del centro"
              value={createForm.brand_color}
              onChange={(color) => setCreateForm({ ...createForm, brand_color: color })}
            />
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" className={buttonSecondary} onClick={() => setCreateModalOpen(false)} disabled={creating}>Cancelar</button>
              <button type="submit" className={`${buttonPrimary} bg-accent hover:bg-accent-strong`} disabled={creating}>{creating ? 'Creando...' : 'Crear'}</button>
            </div>
          </form>
        </Modal>
      )}

      {/* Modal Editar */}
      {editModalOpen && (
        <Modal onClose={() => setEditModalOpen(false)} title="Editar Escuela">
          <form className="space-y-4" onSubmit={handleEdit} noValidate>
            <FormField label="Nombre" required error={editErrors.name}>
              <input className={inputClass} value={editForm.name} onChange={e => setEditForm({ ...editForm, name: e.target.value })} maxLength={200} />
            </FormField>
            <FormField label="Dirección">
              <input className={inputClass} value={editForm.address} onChange={e => setEditForm({ ...editForm, address: e.target.value })} />
            </FormField>
            <div className="grid grid-cols-2 gap-3">
              <FormField label="Ciudad">
                <input className={inputClass} value={editForm.city} onChange={e => setEditForm({ ...editForm, city: e.target.value })} />
              </FormField>
              <FormField label="Teléfono">
                <input className={inputClass} value={editForm.phone} onChange={e => setEditForm({ ...editForm, phone: e.target.value })} />
              </FormField>
            </div>
            <FormField label="Email" error={editErrors.email}>
              <input type="email" className={inputClass} value={editForm.email} onChange={e => setEditForm({ ...editForm, email: e.target.value })} />
            </FormField>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" className={buttonSecondary} onClick={() => setEditModalOpen(false)} disabled={editing}>Cancelar</button>
              <button type="submit" className={`${buttonPrimary} bg-accent hover:bg-accent-strong`} disabled={editing}>{editing ? 'Guardando...' : 'Guardar'}</button>
            </div>
          </form>
        </Modal>
      )}

      {/* Modal Color */}
      {colorModalOpen && colorEditingSchool && (
        <Modal onClose={() => setColorModalOpen(false)} title={`Color de marca: ${colorEditingSchool.school_name}`}>
          <div className="space-y-4">
            <p className="text-sm text-ink-soft">Este color se aplicará sutilmente en la interfaz para todos los usuarios de este centro.</p>
            <div className="rounded-lg border border-line p-4">
              <p className="text-xs text-muted mb-2">Vista previa:</p>
              <div className="space-y-2">
                <h3 className="text-xl font-semibold" style={{ color: customColor || selectedColor }}>Título del centro</h3>
                <p className="text-sm" style={{ color: customColor || selectedColor }}>Enlace de ejemplo →</p>
                <div className="flex gap-2">
                  <div className="rounded-lg px-3 py-1 text-white text-sm" style={{ backgroundColor: customColor || selectedColor }}>Botón</div>
                  <div className="rounded-lg border px-3 py-1 text-sm" style={{ borderColor: customColor || selectedColor, color: customColor || selectedColor }}>Botón outline</div>
                </div>
              </div>
            </div>
            <div>
              <label className="block text-sm font-semibold text-ink-soft mb-2">Colores sugeridos</label>
              <div className="grid grid-cols-5 gap-2">
                {COLOR_PRESETS.map(preset => (
                  <button
                    type="button" key={preset.value}
                    onClick={() => { setSelectedColor(preset.value); setCustomColor(''); setColorError('') }}
                    className={`h-10 rounded-lg border-2 transition-all cursor-pointer ${
                      selectedColor === preset.value && !customColor ? 'border-ink scale-110' : 'border-line hover:border-line-strong'
                    }`}
                    style={{ backgroundColor: preset.value }}
                    title={preset.name}
                  />
                ))}
              </div>
            </div>
            <div>
              <label className="block text-sm font-semibold text-ink-soft mb-2">Color personalizado</label>
              <div className="flex gap-2">
                <input type="color" value={customColor || selectedColor} onChange={(e) => handleColorChange(e.target.value)} className="h-10 w-14 rounded-lg border border-line-strong cursor-pointer" />
                <input type="text" value={customColor || selectedColor} onChange={(e) => handleColorChange(e.target.value)} placeholder="#3B82F6" className={inputClass} maxLength={7} />
              </div>
              {colorError && <p className="mt-1 text-xs text-danger">{colorError}</p>}
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" className={buttonSecondary} onClick={() => setColorModalOpen(false)}>Cancelar</button>
              <button type="button" className={`${buttonPrimary} bg-accent hover:bg-accent-strong`} onClick={handleSaveColor} disabled={savingColor || !!colorError}>{savingColor ? 'Guardando...' : 'Guardar color'}</button>
            </div>
          </div>
        </Modal>
      )}

      {/* Modal Supervisores */}
      {assignModalOpen && selectedSchool && (
        <Modal onClose={() => setAssignModalOpen(false)} title={`Supervisores: ${selectedSchool.school_name}`} size="lg">
          <div className="space-y-4">
            <JoinCode schoolId={selectedSchool.school_id} />
            <div className="border-t border-line pt-4">
              <h4 className="mb-2 text-sm font-semibold text-ink-soft">Asignados ({schoolSupervisors.length})</h4>
              {schoolSupervisors.length === 0 ? (
                <p className="text-sm text-muted bg-subtle p-3 rounded-lg">Sin supervisores asignados</p>
              ) : (
                <div className="space-y-2">
                  {schoolSupervisors.map(sup => (
                    <div key={sup.profile_id} className="flex items-center justify-between rounded-lg border border-line p-3 hover:bg-subtle">
                      <div className="flex-1 min-w-0 mr-3">
                        <div className="font-semibold text-ink truncate">{sup.full_name}</div>
                        <div className="text-xs text-muted truncate">{sup.email}</div>
                      </div>
                      <button
                        type="button" onClick={() => handleRemoveSupervisor(sup)}
                        disabled={removing !== null}
                        className="rounded-lg border border-danger-soft px-3 py-1 text-xs font-semibold text-danger hover:bg-danger-soft cursor-pointer disabled:opacity-50"
                      >
                        {removing === sup.profile_id ? '...' : 'Quitar'}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="border-t border-line pt-4">
              <h4 className="mb-1 text-sm font-semibold text-ink-soft">Nombrar supervisor</h4>
              <p className="mb-2 text-xs text-muted">Elige un profesor de este centro. Podrá gestionar sus usuarios, estructura, asignaciones y notas.</p>
              {supervisorCandidates.length === 0 ? (
                <p className="text-sm text-muted">No hay profesores en este centro</p>
              ) : (
                <form className="flex gap-2" onSubmit={handleAssign}>
                  <select className={inputClass} value={assignForm.profileId} onChange={e => setAssignForm({ profileId: e.target.value })} required>
                    <option value="">Seleccionar...</option>
                    {supervisorCandidates.map(s => (
                      <option key={s.profile_id} value={s.profile_id}>{s.full_name} ({s.email})</option>
                    ))}
                  </select>
                  <button type="submit" className={`${buttonPrimary} bg-accent hover:bg-accent-strong whitespace-nowrap`} disabled={assigning || !assignForm.profileId}>
                    {assigning ? '...' : 'Nombrar'}
                  </button>
                </form>
              )}
            </div>
            <div className="border-t border-line pt-4">
              <h4 className="mb-1 text-sm font-semibold text-ink-soft">Crear supervisor nuevo</h4>
              <p className="mb-2 text-xs text-muted">Para un centro que empieza: recibirá una invitación por correo para elegir su contraseña.</p>
              <form className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]" onSubmit={handleCreateSupervisor}>
                <input className={inputClass} placeholder="Nombre completo" value={newSupervisor.full_name} onChange={e => setNewSupervisor({ ...newSupervisor, full_name: e.target.value })} required maxLength={100} />
                <input className={inputClass} type="email" placeholder="correo@escuela.com" value={newSupervisor.email} onChange={e => setNewSupervisor({ ...newSupervisor, email: e.target.value })} required />
                <button type="submit" className={`${buttonPrimary} bg-accent hover:bg-accent-strong whitespace-nowrap`} disabled={creatingSupervisor}>
                  {creatingSupervisor ? 'Enviando…' : 'Crear e invitar'}
                </button>
              </form>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}

// ------------------------------------------------------------------
// Componentes Auxiliares
// ------------------------------------------------------------------

function Modal({ children, onClose, title, size = 'md' }) {
  // Cerrar con tecla Escape
  useEffect(() => {
    const handleEsc = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handleEsc)
    return () => window.removeEventListener('keydown', handleEsc)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/25 backdrop-blur-[2px] sm:items-center sm:p-4" onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label={title} className={`fade-in w-full ${size === 'lg' ? 'max-w-2xl' : 'max-w-lg'} max-h-[92vh] overflow-y-auto rounded-t-2xl bg-surface p-6 shadow-lift sm:rounded-2xl`}>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-ink">{title}</h3>
          <button type="button" onClick={onClose} aria-label="Cerrar" className="-mr-2 rounded-lg p-2 text-muted hover:bg-subtle hover:text-ink"><Icon name="x" /></button>
        </div>
        {children}
      </div>
    </div>
  )
}

function FormField({ label, required, error, children }) {
  return (
    <div>
      <label className="mb-1.5 block text-sm font-medium text-ink-soft">
        {label}{required && <span className="text-faint"> *</span>}
      </label>
      {children}
      {error && <p className="mt-1 text-xs text-danger">{error}</p>}
    </div>
  )
}

function ColorPickerField({ label, value, onChange }) {
  return (
    <div>
      <label className="mb-2 block text-sm font-medium text-ink-soft">{label}</label>
      <div className="space-y-2">
        <div className="flex gap-2">
          <input type="color" value={value} onChange={(e) => onChange(e.target.value)} className="h-10 w-14 rounded-lg border border-line-strong cursor-pointer" />
          <input type="text" value={value} onChange={(e) => onChange(e.target.value)} className={inputClass} maxLength={7} placeholder="#3B82F6" />
        </div>
        <div className="flex gap-1.5 flex-wrap">
          {COLOR_PRESETS.map(preset => (
            <button
              type="button" key={preset.value} onClick={() => onChange(preset.value)}
              className={`h-7 w-7 rounded-full border-2 transition-all cursor-pointer ${
                value === preset.value ? 'border-ink scale-110' : 'border-line hover:border-line-strong'
              }`}
              style={{ backgroundColor: preset.value }}
              title={preset.name}
            />
          ))}
        </div>
      </div>
    </div>
  )
}