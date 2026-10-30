import { useEffect, useState, useCallback, useRef, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { getSupabaseErrorMessage } from '../lib/supabaseErrors'
import { useTheme, COLOR_PRESETS } from '../contexts/ThemeContext'

const ITEMS_PER_PAGE = 6
const DEBOUNCE_DELAY = 300
const DEFAULT_BRAND_COLOR = '#3B82F6'

const inputClass = 'w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none transition-all'
const buttonPrimary = 'rounded-lg px-4 py-2 text-sm font-semibold text-white transition-all hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer'
const buttonSecondary = 'rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 transition-all cursor-pointer'

function parseSupabaseError(err) {
  const code = err?.code
  const detail = err?.details
  switch (code) {
    case 'P0001': return { message: 'No tienes permisos' }
    case 'P0002': return { message: detail === 'school_not_found' ? 'Escuela no encontrada' : 'Recurso no encontrado' }
    case '22023': return { message: detail === 'name_required' ? 'Nombre obligatorio' : detail === 'color_must_be_hex' ? 'Color inválido (formato #RRGGBB)' : 'Datos inválidos', field: detail === 'name_required' ? 'name' : undefined }
    case '23505': return { message: detail === 'name_already_exists' ? 'Nombre ya existe' : 'Conflicto', field: detail === 'name_already_exists' ? 'name' : undefined }
    default: return { message: getSupabaseErrorMessage(err) }
  }
}

function generateId() {
  return Math.random().toString(36).substring(2, 11)
}

function escapeCSV(value) {
  const str = String(value ?? '')
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`
  }
  return str
}

function exportToCSV(schools, filename = 'escuelas') {
  const headers = ['ID', 'Nombre', 'Dirección', 'Ciudad', 'Teléfono', 'Email', 'Color', 'Alumnos', 'Profesores', 'Supervisores']
  const rows = schools.map(s => [
    s.school_id, s.school_name, s.school_address || '', s.school_city || '',
    s.school_phone || '', s.school_email || '', s.brand_color || '',
    s.total_students, s.total_teachers, s.total_supervisors,
  ])
  const csv = [headers.join(','), ...rows.map(r => r.map(escapeCSV).join(','))].join('\n')
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' })
  const link = document.createElement('a')
  link.href = URL.createObjectURL(blob)
  link.download = `${filename}_${new Date().toISOString().split('T')[0]}.csv`
  link.click()
  URL.revokeObjectURL(link.href)
}

function isValidHexColor(color) {
  return /^#[0-9A-Fa-f]{6}$/.test(color)
}

export default function SchoolManagement({ user }) {
  const { setPrimaryColor } = useTheme()
  const isAdmin = user?.role === 'admin'

  const [schools, setSchools] = useState([])
  const [unassignedSupervisors, setUnassignedSupervisors] = useState([])
  const [selectedSchool, setSelectedSchool] = useState(null)
  const [schoolSupervisors, setSchoolSupervisors] = useState([])
  const [loading, setLoading] = useState(true)
  const [toasts, setToasts] = useState([])

  const [activeSchoolId, setActiveSchoolId] = useState(() => {
    return localStorage.getItem('activeSchoolId')
  })

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

  const emptyForm = { name: '', address: '', city: '', phone: '', email: '', brand_color: DEFAULT_BRAND_COLOR }
  const [createForm, setCreateForm] = useState(emptyForm)
  const [editForm, setEditForm] = useState({ ...emptyForm, id: '' })
  const [assignForm, setAssignForm] = useState({ profileId: '' })
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

  const loadAbortRef = useRef(null)
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

  useEffect(() => {
    setPrimaryColor(activeSchoolColor || DEFAULT_BRAND_COLOR)
  }, [activeSchoolColor, setPrimaryColor])

  const handleSetActiveSchool = useCallback((id) => {
    setActiveSchoolId(id)
    if (id) {
      localStorage.setItem('activeSchoolId', id)
    } else {
      localStorage.removeItem('activeSchoolId')
    }
  }, [])

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

  const loadSchools = useCallback(async () => {
    if (loadAbortRef.current) loadAbortRef.current.abort()
    loadAbortRef.current = new AbortController()
    setLoading(true)
    try {
      const { data, error } = await supabase.rpc('admin_list_schools_with_stats')
      if (loadAbortRef.current?.signal.aborted) return
      if (error) throw error
      setSchools(data || [])
    } catch (err) {
      if (err?.name === 'AbortError') return
      const { message } = parseSupabaseError(err)
      addToast('error', `Error: ${message}`)
    } finally {
      if (!loadAbortRef.current?.signal.aborted) setLoading(false)
    }
  }, [addToast])

  const loadUnassignedSupervisors = useCallback(async () => {
    try {
      const { data, error } = await supabase.rpc('admin_list_unassigned_supervisors')
      if (error) throw error
      setUnassignedSupervisors(data || [])
    } catch (err) {
      console.error('Error:', err)
    }
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
    loadSchools()
    loadUnassignedSupervisors()
    return () => { loadAbortRef.current?.abort() }
  }, [loadSchools, loadUnassignedSupervisors])

  function validateForm(form) {
    const errors = {}
    if (!form.name.trim()) errors.name = 'Nombre obligatorio'
    if (form.name.length > 200) errors.name = 'Máximo 200 caracteres'
    if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) errors.email = 'Email inválido'
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
      brand_color: school.brand_color || DEFAULT_BRAND_COLOR,
    })
    setEditErrors({})
    setEditModalOpen(true)
  }

  function openAssignModal(school) {
    setSelectedSchool(school)
    loadSchoolSupervisors(school.school_id)
    loadUnassignedSupervisors()
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

      if (createForm.brand_color && createForm.brand_color !== DEFAULT_BRAND_COLOR && data) {
        await supabase.rpc('admin_update_school_brand_color', {
          p_school_id: data.school_id,
          p_brand_color: createForm.brand_color,
        })
      }

      addToast('success', 'Escuela creada correctamente')
      setCreateModalOpen(false)
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
      await supabase.rpc('admin_update_school', {
        p_school_id: editForm.id,
        p_name: editForm.name.trim(),
        p_address: editForm.address.trim() || null,
        p_city: editForm.city.trim() || null,
        p_phone: editForm.phone.trim() || null,
        p_email: editForm.email.trim() || null,
      })
      addToast('success', 'Escuela actualizada')
      setEditModalOpen(false)
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

    if (!window.confirm(`¿Cambiar el color de "${colorEditingSchool.school_name}"?\n\nEsto afectará a todos los usuarios del centro.`)) {
      return
    }

    setSavingColor(true)
    try {
      await supabase.rpc('admin_update_school_brand_color', {
        p_school_id: colorEditingSchool.school_id,
        p_brand_color: color,
      })
      addToast('success', `Color actualizado para "${colorEditingSchool.school_name}"`)
      setColorModalOpen(false)
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
      await supabase.rpc('admin_assign_supervisor', {
        p_school_id: selectedSchool.school_id,
        p_profile_id: assignForm.profileId,
      })
      addToast('success', 'Supervisor asignado')
      setAssignForm({ profileId: '' })
      await Promise.all([
        loadSchoolSupervisors(selectedSchool.school_id),
        loadUnassignedSupervisors(),
        loadSchools(),
      ])
    } catch (err) {
      addToast('error', parseSupabaseError(err).message)
    } finally {
      setAssigning(false)
    }
  }

  async function handleRemoveSupervisor(supervisor) {
    if (!selectedSchool) return
    if (!window.confirm(`¿Quitar a ${supervisor.full_name}?`)) return
    setRemoving(supervisor.profile_id)
    try {
      await supabase.rpc('admin_remove_supervisor', {
        p_school_id: selectedSchool.school_id,
        p_profile_id: supervisor.profile_id,
      })
      addToast('success', 'Supervisor quitado')
      await Promise.all([
        loadSchoolSupervisors(selectedSchool.school_id),
        loadUnassignedSupervisors(),
        loadSchools(),
      ])
    } catch (err) {
      addToast('error', parseSupabaseError(err).message)
    } finally {
      setRemoving(null)
    }
  }

  if (user?.role !== 'admin') {
    return (
      <div className="p-8 text-center">
        <div className="text-5xl mb-4">🔒</div>
        <p className="text-lg font-semibold text-red-500">Solo administradores pueden gestionar escuelas</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Toasts */}
      <div className="fixed top-4 right-4 z-[100] space-y-2 max-w-sm">
        {toasts.map(toast => (
          <div
            key={toast.id}
            className={`rounded-lg p-4 shadow-lg border animate-[slideIn_0.3s_ease-out] ${
              toast.type === 'success' ? 'bg-green-50 border-green-200 text-green-800' :
              toast.type === 'error' ? 'bg-red-50 border-red-200 text-red-800' :
              'bg-blue-50 border-blue-200 text-blue-800'
            }`}
          >
            <div className="flex items-start justify-between gap-2">
              <p className="text-sm font-medium">{toast.message}</p>
              <button type="button" onClick={() => setToasts(prev => prev.filter(t => t.id !== toast.id))} className="opacity-60 hover:opacity-100 cursor-pointer text-lg leading-none">×</button>
            </div>
          </div>
        ))}
      </div>

      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-800">
            Gestión de Escuelas
            <span className="ml-2 text-sm font-normal text-gray-500">({schools.length})</span>
          </h2>
          <p className="text-sm text-gray-500 mt-1">Administra centros, colores de marca y supervisores</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button type="button" onClick={() => exportToCSV(filteredAndSortedSchools)} className={buttonSecondary} title="Exportar CSV">
            📥 CSV
          </button>
          <button type="button" onClick={openCreateModal} className={`${buttonPrimary} bg-blue-600 hover:bg-blue-700`}>
            ➕ Nueva Escuela
          </button>
        </div>
      </div>

      {/* Selector de Centro Activo */}
      <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
        <label className="block text-sm font-semibold text-gray-700 mb-2">
          🎨 Simular vista de centro (color del centro se aplica a la UI)
        </label>
        <select
          value={activeSchoolId || ''}
          onChange={(e) => handleSetActiveSchool(e.target.value || null)}
          className={inputClass}
        >
          <option value="">— Sin centro (color por defecto) —</option>
          {schools.map(s => (
            <option key={s.school_id} value={s.school_id}>
              {s.school_name} {s.brand_color ? `(${s.brand_color})` : '(sin color)'}
            </option>
          ))}
        </select>
        {activeSchoolId && (
          <p className="mt-2 text-xs text-gray-500">
            ✨ Los títulos y acentos ahora usan el color de este centro
          </p>
        )}
      </div>

      {/* Búsqueda y filtros */}
      <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="flex-1 relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">🔍</span>
            <input
              type="text"
              placeholder="Buscar por nombre, ciudad o email..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className={`${inputClass} pl-10`}
            />
            {searchQuery && (
              <button type="button" onClick={() => setSearchQuery('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 cursor-pointer">×</button>
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
          <p className="mt-2 text-xs text-gray-500">
            {filteredAndSortedSchools.length} resultado{filteredAndSortedSchools.length !== 1 ? 's' : ''} para "{debouncedSearch}"
          </p>
        )}
      </div>

      {/* Contenido */}
      {loading ? (
        <div className="py-16 text-center">
          <div className="inline-block h-10 w-10 rounded-full border-4 border-gray-200 border-t-blue-500 animate-spin"></div>
          <p className="mt-4 text-gray-500">Cargando...</p>
        </div>
      ) : filteredAndSortedSchools.length === 0 ? (
        <div className="rounded-lg border-2 border-dashed border-gray-300 bg-white p-12 text-center">
          <div className="text-5xl mb-4">🏫</div>
          <p className="text-lg font-semibold text-gray-700">
            {debouncedSearch ? 'Sin resultados' : 'No hay escuelas'}
          </p>
          <p className="text-sm text-gray-500 mt-2">
            {debouncedSearch ? 'Prueba con otros términos' : 'Clic en "Nueva Escuela"'}
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
                  className={`group rounded-lg border bg-white p-5 shadow-sm hover:shadow-md transition-all ${
                    isActive ? 'ring-2 ring-offset-2' : 'border-gray-200'
                  }`}
                  style={isActive ? { borderColor: schoolColor, '--tw-ring-color': schoolColor } : {}}
                >
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      <div
                        className="h-4 w-4 rounded-full flex-shrink-0 border border-gray-200"
                        style={{ backgroundColor: schoolColor }}
                        title={`Color: ${schoolColor}`}
                      />
                      <h3 className="text-lg font-bold text-gray-800 truncate">{school.school_name}</h3>
                    </div>
                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      {isAdmin && (
                        <button
                          type="button"
                          onClick={() => openColorModal(school)}
                          className="rounded p-1.5 hover:bg-gray-100 transition-colors cursor-pointer"
                          title="Cambiar color"
                        >
                          🎨
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => openEditModal(school)}
                        className="rounded p-1.5 hover:bg-gray-100 transition-colors cursor-pointer"
                        title="Editar"
                      >
                        ✏️
                      </button>
                      <button
                        type="button"
                        onClick={() => openAssignModal(school)}
                        className="rounded p-1.5 hover:bg-blue-50 transition-colors cursor-pointer"
                        title="Supervisores"
                      >
                        👥
                      </button>
                    </div>
                  </div>

                  <div className="space-y-1 text-sm text-gray-500">
                    {school.school_city && <p>📍 {school.school_city}</p>}
                    {school.school_email && (
                      <p>📧 <a href={`mailto:${school.school_email}`} className="hover:underline" style={{ color: schoolColor }}>{school.school_email}</a></p>
                    )}
                    {school.school_phone && (
                      <p>📞 <a href={`tel:${school.school_phone}`} className="hover:underline" style={{ color: schoolColor }}>{school.school_phone}</a></p>
                    )}
                  </div>

                  <div className="mt-4 grid grid-cols-3 gap-2 border-t border-gray-100 pt-3">
                    <div className="text-center">
                      <div className="text-lg font-bold text-gray-800">{school.total_students}</div>
                      <div className="text-[10px] text-gray-500">Alumnos</div>
                    </div>
                    <div className="text-center">
                      <div className="text-lg font-bold text-gray-800">{school.total_teachers}</div>
                      <div className="text-[10px] text-gray-500">Profesores</div>
                    </div>
                    <div className="text-center">
                      <div className="text-lg font-bold text-gray-800">{school.total_supervisors}</div>
                      <div className="text-[10px] text-gray-500">Supervisores</div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 pt-4">
              <button
                type="button"
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                className={buttonSecondary + ' disabled:opacity-50'}
              >
                ← Anterior
              </button>
              <div className="flex gap-1">
                {Array.from({ length: totalPages }, (_, i) => i + 1).map(page => (
                  <button
                    type="button"
                    key={page}
                    onClick={() => setCurrentPage(page)}
                    className={`h-9 w-9 rounded-lg text-sm font-semibold transition-all cursor-pointer ${
                      page === currentPage ? 'bg-blue-600 text-white' : 'border border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
                    }`}
                  >
                    {page}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
                className={buttonSecondary + ' disabled:opacity-50'}
              >
                Siguiente →
              </button>
            </div>
          )}
        </>
      )}

      {/* Modal Crear */}
      {createModalOpen && (
        <Modal onClose={() => setCreateModalOpen(false)} title="Nueva Escuela">
          <form className="space-y-4" onSubmit={handleCreate} noValidate>
            <FormField label="Nombre" required error={createErrors.name}>
              <input className={inputClass} value={createForm.name} onChange={e => setCreateForm({ ...createForm, name: e.target.value })} placeholder="Escuela Ejemplo" maxLength={200} />
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
              <input type="email" className={inputClass} value={createForm.email} onChange={e => setCreateForm({ ...createForm, email: e.target.value })} placeholder="info@escuela.com" />
            </FormField>
            <ColorPickerField
              label="Color de marca del centro"
              value={createForm.brand_color}
              onChange={(color) => setCreateForm({ ...createForm, brand_color: color })}
            />
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" className={buttonSecondary} onClick={() => setCreateModalOpen(false)} disabled={creating}>Cancelar</button>
              <button type="submit" className={`${buttonPrimary} bg-blue-600 hover:bg-blue-700`} disabled={creating}>
                {creating ? 'Creando...' : 'Crear'}
              </button>
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
              <button type="submit" className={`${buttonPrimary} bg-blue-600 hover:bg-blue-700`} disabled={editing}>
                {editing ? 'Guardando...' : 'Guardar'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* Modal Color */}
      {colorModalOpen && colorEditingSchool && (
        <Modal onClose={() => setColorModalOpen(false)} title={`Color de marca: ${colorEditingSchool.school_name}`}>
          <div className="space-y-4">
            <p className="text-sm text-gray-600">
              Este color se aplicará sutilmente en la interfaz para todos los usuarios de este centro.
            </p>

            <div className="rounded-lg border border-gray-200 p-4">
              <p className="text-xs text-gray-500 mb-2">Vista previa:</p>
              <div className="space-y-2">
                <h3 className="text-xl font-bold" style={{ color: customColor || selectedColor }}>
                  Título del centro
                </h3>
                <p className="text-sm" style={{ color: customColor || selectedColor }}>
                  Enlace de ejemplo →
                </p>
                <div className="flex gap-2">
                  <div className="rounded px-3 py-1 text-white text-sm" style={{ backgroundColor: customColor || selectedColor }}>
                    Botón
                  </div>
                  <div className="rounded border px-3 py-1 text-sm" style={{ borderColor: customColor || selectedColor, color: customColor || selectedColor }}>
                    Botón outline
                  </div>
                </div>
              </div>
            </div>

            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">Colores sugeridos</label>
              <div className="grid grid-cols-5 gap-2">
                {COLOR_PRESETS.map(preset => (
                  <button
                    type="button"
                    key={preset.value}
                    onClick={() => { setSelectedColor(preset.value); setCustomColor(''); setColorError('') }}
                    className={`h-10 rounded-lg border-2 transition-all cursor-pointer ${
                      selectedColor === preset.value && !customColor ? 'border-gray-800 scale-110' : 'border-gray-200 hover:border-gray-400'
                    }`}
                    style={{ backgroundColor: preset.value }}
                    title={preset.name}
                  />
                ))}
              </div>
            </div>

            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">Color personalizado</label>
              <div className="flex gap-2">
                <input
                  type="color"
                  value={customColor || selectedColor}
                  onChange={(e) => handleColorChange(e.target.value)}
                  className="h-10 w-14 rounded border border-gray-300 cursor-pointer"
                />
                <input
                  type="text"
                  value={customColor || selectedColor}
                  onChange={(e) => handleColorChange(e.target.value)}
                  placeholder="#3B82F6"
                  className={inputClass}
                  maxLength={7}
                />
              </div>
              {colorError && (
                <p className="mt-1 text-xs text-red-600">{colorError}</p>
              )}
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button type="button" className={buttonSecondary} onClick={() => setColorModalOpen(false)}>Cancelar</button>
              <button
                type="button"
                className={`${buttonPrimary} bg-blue-600 hover:bg-blue-700`}
                onClick={handleSaveColor}
                disabled={savingColor || !!colorError}
              >
                {savingColor ? 'Guardando...' : 'Guardar color'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Modal Supervisores */}
      {assignModalOpen && selectedSchool && (
        <Modal onClose={() => setAssignModalOpen(false)} title={`Supervisores: ${selectedSchool.school_name}`} size="lg">
          <div className="space-y-4">
            <div>
              <h4 className="mb-2 text-sm font-semibold text-gray-700">Asignados ({schoolSupervisors.length})</h4>
              {schoolSupervisors.length === 0 ? (
                <p className="text-sm text-gray-500 bg-gray-50 p-3 rounded">Sin supervisores</p>
              ) : (
                <div className="space-y-2">
                  {schoolSupervisors.map(sup => (
                    <div key={sup.profile_id} className="flex items-center justify-between rounded border border-gray-200 p-3 hover:bg-gray-50">
                      <div className="flex-1 min-w-0 mr-3">
                        <div className="font-semibold text-gray-800 truncate">{sup.full_name}</div>
                        <div className="text-xs text-gray-500 truncate">{sup.email}</div>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleRemoveSupervisor(sup)}
                        disabled={removing !== null}
                        className="rounded border border-red-200 px-3 py-1 text-xs font-semibold text-red-600 hover:bg-red-50 cursor-pointer disabled:opacity-50"
                      >
                        {removing === sup.profile_id ? '...' : 'Quitar'}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="border-t border-gray-200 pt-4">
              <h4 className="mb-2 text-sm font-semibold text-gray-700">Asignar nuevo</h4>
              {unassignedSupervisors.length === 0 ? (
                <p className="text-sm text-gray-500">No hay supervisores disponibles</p>
              ) : (
                <form className="flex gap-2" onSubmit={handleAssign}>
                  <select
                    className={inputClass}
                    value={assignForm.profileId}
                    onChange={e => setAssignForm({ profileId: e.target.value })}
                    required
                  >
                    <option value="">Seleccionar...</option>
                    {unassignedSupervisors.map(s => (
                      <option key={s.profile_id} value={s.profile_id}>{s.full_name} ({s.email})</option>
                    ))}
                  </select>
                  <button type="submit" className={`${buttonPrimary} bg-blue-600 hover:bg-blue-700 whitespace-nowrap`} disabled={assigning || !assignForm.profileId}>
                    {assigning ? '...' : 'Asignar'}
                  </button>
                </form>
              )}
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}

function Modal({ children, onClose, title, size = 'md' }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <div className={`w-full ${size === 'lg' ? 'max-w-2xl' : 'max-w-lg'} rounded-lg bg-white p-6 shadow-xl max-h-[90vh] overflow-y-auto`}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold text-gray-800">{title}</h3>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl leading-none cursor-pointer w-8 h-8 flex items-center justify-center rounded hover:bg-gray-100">×</button>
        </div>
        {children}
      </div>
    </div>
  )
}

function FormField({ label, required, error, children }) {
  return (
    <div>
      <label className="mb-1 block text-sm font-semibold text-gray-700">
        {label} {required && <span className="text-red-500">*</span>}
      </label>
      {children}
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  )
}

function ColorPickerField({ label, value, onChange }) {
  return (
    <div>
      <label className="mb-2 block text-sm font-semibold text-gray-700">{label}</label>
      <div className="space-y-2">
        <div className="flex gap-2">
          <input
            type="color"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="h-10 w-14 rounded border border-gray-300 cursor-pointer"
          />
          <input
            type="text"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className={inputClass}
            maxLength={7}
            placeholder="#3B82F6"
          />
        </div>
        <div className="flex gap-1.5 flex-wrap">
          {COLOR_PRESETS.map(preset => (
            <button
              type="button"
              key={preset.value}
              onClick={() => onChange(preset.value)}
              className={`h-7 w-7 rounded-full border-2 transition-all cursor-pointer ${
                value === preset.value ? 'border-gray-800 scale-110' : 'border-gray-200 hover:border-gray-400'
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
