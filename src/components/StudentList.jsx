import { useState, useMemo } from 'react'


const inputClass = 'w-full rounded border border-[#d1d5db] px-3 py-2 text-sm focus:border-[#1e88e5] focus:outline-none focus:ring-1 focus:ring-[#1e88e5] transition-colors'
const buttonClass = 'rounded bg-[#1e88e5] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1565c0] disabled:opacity-50 transition-colors cursor-pointer'
const secondaryButton = 'rounded border border-[#d1d5db] bg-white px-4 py-2 text-sm font-semibold text-[#0a2540] hover:bg-[#f4f6f9] transition-colors cursor-pointer'
const dangerButton = 'rounded bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50 transition-colors cursor-pointer'

const CLASS_OPTIONS = ['1º', '2º', '3º']
const GROUP_OPTIONS = ['A', 'B', 'C', 'D']

export default function StudentList({ user }) {
  const [students, setStudents] = useState(mockStudents)
  const [modules] = useState(mockModules)
  const [search, setSearch] = useState('')
  const [filterPromo, setFilterPromo] = useState('')
  const [filterClass, setFilterClass] = useState('')
  const [filterGroup, setFilterGroup] = useState('')
  const [editModalOpen, setEditModalOpen] = useState(false)
  const [createModalOpen, setCreateModalOpen] = useState(false)
  const [detailModalOpen, setDetailModalOpen] = useState(false)
  const [editingStudent, setEditingStudent] = useState(null)
  const [viewingStudent, setViewingStudent] = useState(null)
  const [formData, setFormData] = useState({})
  const [originalData, setOriginalData] = useState({})
  const [sensitiveUnlocked, setSensitiveUnlocked] = useState(false)
  const [confirmSaveOpen, setConfirmSaveOpen] = useState(false)
  const [sendInvite, setSendInvite] = useState(true)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  const isAdmin = user?.role === 'admin'

  const filteredStudents = useMemo(() => {
    return students.filter(s => {
      const searchLower = search.toLowerCase()
      const matchSearch = !search ||
        s.name.toLowerCase().includes(searchLower) ||
        String(s.student_number || '').includes(searchLower) ||
        (s.class_name && s.class_name.toLowerCase().includes(searchLower)) ||
        (s.group_name && s.group_name.toLowerCase().includes(searchLower))

      const matchPromo = !filterPromo || s.promo === filterPromo
      const matchClass = !filterClass || s.class_name === filterClass
      const matchGroup = !filterGroup || s.group_name === filterGroup

      return matchSearch && matchPromo && matchClass && matchGroup
    })
  }, [students, search, filterPromo, filterClass, filterGroup])

  const uniquePromos = [...new Set(students.map(s => s.promo).filter(Boolean))].sort()
  const uniqueClasses = [...new Set(students.map(s => s.class_name).filter(Boolean))].sort()
  const uniqueGroups = [...new Set(students.map(s => s.group_name).filter(Boolean))].sort()

  function openEditModal(student) {
    const data = {
      student_number: student.student_number || '',
      name: student.name || '',
      class_name: student.class_name || '',
      group_name: student.group_name || '',
      promo: student.promo || '',
    }
    setEditingStudent(student)
    setFormData(data)
    setOriginalData({ ...data })
    setSensitiveUnlocked(false)
    setEditModalOpen(true)
    setMessage('')
  }

  function openDetailModal(student) {
    setViewingStudent(student)
    setDetailModalOpen(true)
  }

  function openCreateModal() {
    setFormData({
      email: '',
      full_name: '',
      student_number: '',
      class_name: '',
      group_name: '',
      promo: '',
      identification: '',
      birth_date: '',
      selectedModules: [],
    })
    setSendInvite(true)
    setCreateModalOpen(true)
    setMessage('')
  }

  function handleUnlockSensitive() {
    if (window.confirm(
      'Cambiar el nombre, el número o la promoción afecta a las asistencias, evaluaciones e informes del alumno.\n\n¿Seguro que quieres modificarlos?'
    )) {
      setSensitiveUnlocked(true)
    }
  }

  function handleSaveClick() {
    const nameChanged = formData.name !== originalData.name
    const numberChanged = String(formData.student_number) !== String(originalData.student_number)
    const promoChanged = formData.promo !== originalData.promo

    if (nameChanged || numberChanged || promoChanged) {
      setConfirmSaveOpen(true)
    } else {
      performSave()
    }
  }

  async function performSave() {
    setBusy(true)
    setConfirmSaveOpen(false)
    setMessage('')

    try {
      if (formData.student_number && formData.student_number !== originalData.student_number) {
        const existing = students.find(
          s => s.student_number === parseInt(formData.student_number) && s.id !== editingStudent?.id
        )
        if (existing) {
          setMessage(`❌ El número de alumno ${formData.student_number} ya está asignado a otro alumno.`)
          setBusy(false)
          return
        }
      }

      const finalGroupName = formData.class_name && formData.group_name
        ? `${formData.class_name}${formData.group_name}`
        : formData.group_name || null

      const updateData = {
        student_number: formData.student_number ? parseInt(formData.student_number) : null,
        name: formData.name.trim(),
        class_name: formData.class_name || null,
        group_name: finalGroupName,
        promo: formData.promo.trim() || null,
      }

      setStudents(prev => prev.map(s =>
        s.id === editingStudent?.id ? { ...s, ...updateData } : s
      ))

      setMessage('✅ Alumno actualizado correctamente.')
      setEditModalOpen(false)
    } catch (err) {
      setMessage('❌ Error: ' + (err.message || 'Desconocido'))
    } finally {
      setBusy(false)
    }
  }

  async function performCreate() {
    setBusy(true)
    setMessage('')

    try {
      const { email, full_name, student_number, class_name, group_name, promo, selectedModules } = formData

      if (!email || !full_name) {
        setMessage('❌ Email y nombre son obligatorios.')
        setBusy(false)
        return
      }

      const finalGroupName = class_name && group_name ? `${class_name}${group_name}` : group_name || null
      const studentNumber = student_number ? parseInt(student_number) : null

      const newId = String(Math.max(...students.map(s => parseInt(s.id))) + 1)
      const newStudent = {
        id: newId,
        student_number: studentNumber,
        name: full_name.trim(),
        class_name: class_name || null,
        group_name: finalGroupName,
        promo: promo || null,
        student_modules: (selectedModules || []).map(moduleId => ({ module_id: moduleId })),
      }

      setStudents(prev => [...prev, newStudent])

      const inviteMsg = sendInvite
        ? 'Se ha enviado la invitación por correo.'
        : 'Usuario creado sin enviar correo (contraseña temporal generada).'
      setMessage(`✅ Alumno creado correctamente. ${inviteMsg}`)
      setCreateModalOpen(false)
    } catch (err) {
      setMessage('❌ Error: ' + (err.message || 'Desconocido'))
    } finally {
      setBusy(false)
    }
  }

  async function deleteStudent(student) {
    if (!window.confirm(`¿Eliminar permanentemente a ${student.name}? Esta acción no se puede deshacer.`)) return

    setBusy(true)
    setMessage('')
    try {
      setStudents(prev => prev.filter(s => s.id !== student.id))
      setMessage('✅ Alumno eliminado correctamente.')
    } catch (err) {
      setMessage('❌ Error al eliminar: ' + (err.message || 'Desconocido'))
    } finally {
      setBusy(false)
    }
  }

  function getModuleCount(student) {
    return student.student_modules?.length || 0
  }

  function getModuleIds(student) {
    return (student.student_modules || []).map(m => m.module_id)
  }

  function toggleModule(moduleId) {
    setFormData(prev => {
      const current = prev.selectedModules || []
      const updated = current.includes(moduleId)
        ? current.filter(id => id !== moduleId)
        : [...current, moduleId]
      return { ...prev, selectedModules: updated }
    })
  }

  function getAttendancePercent() {
    return `${Math.floor(Math.random() * 30 + 70)}%`
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-[#0a2540]">
            Alumnos ({filteredStudents.length})
          </h2>
          <p className="text-sm text-[#6b7280]">
            {isAdmin ? 'Gestión completa de alumnos' : 'Alumnos matriculados en tus módulos'}
          </p>
        </div>
        {isAdmin && (
          <div className="flex gap-2">
            <button className={buttonClass} onClick={openCreateModal}>
              ➕ Nuevo alumno
            </button>
          </div>
        )}
      </div>

      {message && (
        <div className={`rounded p-3 text-sm ${message.includes('✅') ? 'bg-green-50 text-green-800 border border-green-200' : 'bg-red-50 text-red-800 border border-red-200'}`}>
          {message}
        </div>
      )}

      {/* Filtros y búsqueda */}
      <div className="rounded-lg border border-[#e5e7eb] bg-white p-4 shadow-sm">
        <div className="grid gap-3 md:grid-cols-4">
          <div className="md:col-span-2">
            <input
              className={inputClass}
              type="text"
              placeholder="Buscar por nombre, número, clase..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <select className={inputClass} value={filterClass} onChange={(e) => setFilterClass(e.target.value)}>
            <option value="">Todas las clases</option>
            {uniqueClasses.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <select className={inputClass} value={filterGroup} onChange={(e) => setFilterGroup(e.target.value)}>
            <option value="">Todos los grupos</option>
            {uniqueGroups.map(g => <option key={g} value={g}>{g}</option>)}
          </select>
        </div>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <select className={inputClass} value={filterPromo} onChange={(e) => setFilterPromo(e.target.value)}>
            <option value="">Todas las promociones</option>
            {uniquePromos.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
          {(search || filterPromo || filterClass || filterGroup) && (
            <button
              className={secondaryButton}
              onClick={() => { setSearch(''); setFilterPromo(''); setFilterClass(''); setFilterGroup('') }}
            >
              Limpiar filtros
            </button>
          )}
        </div>
      </div>

      {/* Tabla de alumnos */}
      <div className="overflow-hidden rounded-lg border border-[#e5e7eb] bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-[#0a2540] text-xs uppercase text-white">
              <tr>
                <th className="p-3">#</th>
                <th className="p-3">Nombre</th>
                <th className="p-3">Clase</th>
                <th className="p-3">Grupo</th>
                <th className="p-3">Promoción</th>
                <th className="p-3">Módulos</th>
                <th className="p-3">Asistencia</th>
                <th className="p-3 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#e5e7eb]">
              {filteredStudents.map((student, index) => {
                const moduleIds = getModuleIds(student)
                const attendance = getAttendancePercent()
                return (
                  <tr key={student.id} className="hover:bg-[#f9fafb] transition-colors">
                    <td className="p-3 text-[#6b7280]">{index + 1}</td>
                    <td className="p-3 font-medium text-[#0a2540]">{student.name}</td>
                    <td className="p-3">{student.class_name || '—'}</td>
                    <td className="p-3">{student.group_name || '—'}</td>
                    <td className="p-3">{student.promo || '—'}</td>
                    <td className="p-3">
                      <div className="flex flex-wrap gap-1">
                        {moduleIds.slice(0, 3).map(modId => (
                          <span key={modId} className="rounded bg-blue-50 px-2 py-0.5 text-xs font-mono font-semibold text-blue-700">
                            {modId}
                          </span>
                        ))}
                        {moduleIds.length > 3 && (
                          <span className="rounded bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-600">
                            +{moduleIds.length - 3}
                          </span>
                        )}
                        {moduleIds.length === 0 && <span className="text-[#6b7280]">—</span>}
                      </div>
                    </td>
                    <td className="p-3">
                      <span className={`rounded px-2 py-1 text-xs font-semibold ${
                        parseInt(attendance) >= 80 ? 'bg-green-50 text-green-700' :
                        parseInt(attendance) >= 60 ? 'bg-yellow-50 text-yellow-700' :
                        'bg-red-50 text-red-700'
                      }`}>
                        {attendance}
                      </span>
                    </td>
                    <td className="p-3 text-right">
                      <div className="flex justify-end gap-2">
                        <button
                          className="rounded border border-[#1e88e5] px-3 py-1 text-xs font-semibold text-[#1e88e5] hover:bg-[#e3f2fd] transition-colors cursor-pointer"
                          onClick={() => openDetailModal(student)}
                        >
                          👁️ Ver
                        </button>
                        {isAdmin && (
                          <>
                            <button
                              className="rounded border border-[#d1d5db] px-3 py-1 text-xs font-semibold text-[#0a2540] hover:bg-[#f4f6f9] transition-colors cursor-pointer"
                              onClick={() => openEditModal(student)}
                            >
                              ✏️ Editar
                            </button>
                            <button
                              className="rounded border border-red-200 px-3 py-1 text-xs font-semibold text-red-700 hover:bg-red-50 transition-colors cursor-pointer"
                              onClick={() => deleteStudent(student)}
                              disabled={busy}
                            >
                              🗑️ Eliminar
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
              {filteredStudents.length === 0 && (
                <tr>
                  <td colSpan={8} className="p-8 text-center text-[#6b7280]">
                    No hay alumnos que coincidan con los filtros.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal de DETALLE del alumno */}
      {detailModalOpen && viewingStudent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onMouseDown={(e) => e.target === e.currentTarget && setDetailModalOpen(false)}>
          <div className="w-full max-w-2xl rounded-lg bg-white p-6 shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-[#0a2540]">
                👁️ Detalle del Alumno
              </h3>
              <button
                onClick={() => setDetailModalOpen(false)}
                className="text-[#6b7280] hover:text-[#0a2540] text-2xl leading-none cursor-pointer"
              >
                ×
              </button>
            </div>

            <div className="space-y-4">
              {/* Información personal */}
              <div className="rounded-lg border border-[#e5e7eb] p-4">
                <h4 className="mb-3 text-sm font-bold text-[#0a2540] uppercase">Información Personal</h4>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <span className="text-[#6b7280]">Nombre:</span>
                    <p className="font-semibold text-[#0a2540]">{viewingStudent.name}</p>
                  </div>
                  <div>
                    <span className="text-[#6b7280]">Nº Alumno:</span>
                    <p className="font-semibold text-[#0a2540]">{viewingStudent.student_number || '—'}</p>
                  </div>
                  <div>
                    <span className="text-[#6b7280]">Clase:</span>
                    <p className="font-semibold text-[#0a2540]">{viewingStudent.class_name || '—'}</p>
                  </div>
                  <div>
                    <span className="text-[#6b7280]">Grupo:</span>
                    <p className="font-semibold text-[#0a2540]">{viewingStudent.group_name || '—'}</p>
                  </div>
                  <div>
                    <span className="text-[#6b7280]">Promoción:</span>
                    <p className="font-semibold text-[#0a2540]">{viewingStudent.promo || '—'}</p>
                  </div>
                </div>
              </div>

              {/* Módulos matriculados */}
              <div className="rounded-lg border border-[#e5e7eb] p-4">
                <h4 className="mb-3 text-sm font-bold text-[#0a2540] uppercase">
                  Módulos Matriculados ({getModuleCount(viewingStudent)})
                </h4>
                <div className="flex flex-wrap gap-2">
                  {getModuleIds(viewingStudent).map(modId => {
                    const mod = modules.find(m => m.id === modId)
                    return (
                      <div key={modId} className="rounded bg-blue-50 border border-blue-200 px-3 py-2">
                        <div className="font-mono text-xs font-bold text-blue-700">{modId}</div>
                        <div className="text-xs text-[#374151]">{mod?.name || '—'}</div>
                      </div>
                    )
                  })}
                  {getModuleIds(viewingStudent).length === 0 && (
                    <p className="text-sm text-[#6b7280]">Sin módulos matriculados</p>
                  )}
                </div>
              </div>

              {/* Asistencia y progreso */}
              <div className="rounded-lg border border-[#e5e7eb] p-4">
                <h4 className="mb-3 text-sm font-bold text-[#0a2540] uppercase">Progreso</h4>
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded bg-green-50 p-3">
                    <div className="text-xs text-[#6b7280]">Asistencia</div>
                    <div className="text-2xl font-bold text-green-700">{getAttendancePercent()}</div>
                  </div>
                  <div className="rounded bg-blue-50 p-3">
                    <div className="text-xs text-[#6b7280]">Aptos</div>
                    <div className="text-2xl font-bold text-blue-700">{Math.floor(Math.random() * 20 + 80)}%</div>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-4 border-t border-[#e5e7eb]">
              <button className={secondaryButton} onClick={() => setDetailModalOpen(false)}>
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de CREAR nuevo alumno */}
      {createModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onMouseDown={(e) => e.target === e.currentTarget && setCreateModalOpen(false)}>
          <div className="w-full max-w-2xl rounded-lg bg-white p-6 shadow-2xl max-h-[90vh] overflow-y-auto">
            <h3 className="mb-4 text-lg font-bold text-[#0a2540]">➕ Nuevo Alumno</h3>

            <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); performCreate() }}>
              <div className="rounded border border-blue-200 bg-blue-50 p-3">
                <h4 className="mb-2 text-sm font-semibold text-[#0a2540]">📧 Cuenta de usuario</h4>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-[#0a2540]">Email *</label>
                    <input
                      className={inputClass}
                      type="email"
                      value={formData.email}
                      onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                      required
                      placeholder="alumno@escuela.com"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-[#0a2540]">Nombre Completo *</label>
                    <input
                      className={inputClass}
                      value={formData.full_name}
                      onChange={(e) => setFormData({ ...formData, full_name: e.target.value })}
                      required
                      placeholder="Apellido, Nombre"
                    />
                  </div>
                </div>

                <label className="mt-3 flex items-start gap-2 text-sm text-[#0a2540] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={sendInvite}
                    onChange={(e) => setSendInvite(e.target.checked)}
                    className="mt-1 rounded border-gray-300"
                  />
                  <div>
                    <span className="font-semibold">📧 Enviar invitación por correo al alumno</span>
                    <p className="mt-1 text-xs text-[#6b7280]">
                      {sendInvite
                        ? 'El alumno recibirá un email para establecer su contraseña.'
                        : 'El alumno se creará sin enviar correo. Podrá entrar con "¿Olvidaste tu contraseña?".'}
                    </p>
                  </div>
                </label>
              </div>

              <div className="rounded border border-gray-200 bg-gray-50 p-3">
                <h4 className="mb-2 text-sm font-semibold text-[#0a2540]">📋 Ficha de alumno</h4>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-[#0a2540]">Nº de Alumno</label>
                    <input
                      className={inputClass}
                      type="number"
                      value={formData.student_number}
                      onChange={(e) => setFormData({ ...formData, student_number: e.target.value })}
                      placeholder="12345"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-[#0a2540]">Promoción</label>
                    <input
                      className={inputClass}
                      type="text"
                      value={formData.promo}
                      onChange={(e) => setFormData({ ...formData, promo: e.target.value })}
                      placeholder="2025"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-[#0a2540]">Clase</label>
                    <select
                      className={inputClass}
                      value={formData.class_name}
                      onChange={(e) => setFormData({ ...formData, class_name: e.target.value })}
                    >
                      <option value="">Seleccionar</option>
                      {CLASS_OPTIONS.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-[#0a2540]">Grupo</label>
                    <select
                      className={inputClass}
                      value={formData.group_name}
                      onChange={(e) => setFormData({ ...formData, group_name: e.target.value })}
                    >
                      <option value="">Seleccionar</option>
                      {GROUP_OPTIONS.map(g => <option key={g} value={g}>{g}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-[#0a2540]">Identificación (DNI/NIE)</label>
                    <input
                      className={inputClass}
                      value={formData.identification}
                      onChange={(e) => setFormData({ ...formData, identification: e.target.value })}
                      placeholder="12345678Z"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-[#0a2540]">Fecha de Nacimiento</label>
                    <input
                      className={inputClass}
                      type="date"
                      value={formData.birth_date}
                      onChange={(e) => setFormData({ ...formData, birth_date: e.target.value })}
                    />
                  </div>
                </div>
              </div>

              <div className="rounded border border-gray-200 bg-gray-50 p-3">
                <h4 className="mb-2 text-sm font-semibold text-[#0a2540]">📚 Módulos iniciales</h4>
                <div className="grid grid-cols-2 gap-2 max-h-48 overflow-y-auto">
                  {modules.map(mod => (
                    <label key={mod.id} className="flex items-center gap-2 text-sm cursor-pointer hover:bg-white p-1 rounded">
                      <input
                        type="checkbox"
                        checked={(formData.selectedModules || []).includes(mod.id)}
                        onChange={() => toggleModule(mod.id)}
                        className="rounded border-gray-300"
                      />
                      <span className="font-mono text-xs text-[#1e88e5]">{mod.id}</span>
                      <span className="text-[#374151] truncate">{mod.name}</span>
                    </label>
                  ))}
                </div>
                <p className="mt-2 text-xs text-[#6b7280]">
                  Seleccionados: {(formData.selectedModules || []).length} módulos
                </p>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button type="button" className={secondaryButton} onClick={() => setCreateModalOpen(false)}>
                  Cancelar
                </button>
                <button className={buttonClass} disabled={busy}>
                  {busy ? 'Creando...' : 'Crear Alumno'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal de edición */}
      {editModalOpen && editingStudent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onMouseDown={(e) => e.target === e.currentTarget && setEditModalOpen(false)}>
          <div className="w-full max-w-lg rounded-lg bg-white p-6 shadow-2xl max-h-[90vh] overflow-y-auto">
            <h3 className="mb-4 text-lg font-bold text-[#0a2540]">
              Editar Alumno: {editingStudent.name}
            </h3>

            <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); handleSaveClick() }}>
              <div className="rounded border border-amber-200 bg-amber-50 p-3">
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-semibold text-[#0a2540]">Nombre Completo *</label>
                  {!sensitiveUnlocked && (
                    <button
                      type="button"
                      onClick={handleUnlockSensitive}
                      className="text-xs text-[#1e88e5] hover:underline cursor-pointer"
                    >
                      🔒 Desbloquear
                    </button>
                  )}
                </div>
                <input
                  className={`${inputClass} ${!sensitiveUnlocked ? 'bg-gray-100 text-gray-500 cursor-not-allowed' : ''}`}
                  value={formData.name}
                  onChange={(e) => sensitiveUnlocked && setFormData({ ...formData, name: e.target.value })}
                  disabled={!sensitiveUnlocked}
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="rounded border border-amber-200 bg-amber-50 p-3">
                  <label className="mb-1 block text-sm font-semibold text-[#0a2540]">Nº de Alumno</label>
                  <input
                    className={`${inputClass} ${!sensitiveUnlocked ? 'bg-gray-100 text-gray-500 cursor-not-allowed' : ''}`}
                    type="number"
                    value={formData.student_number}
                    onChange={(e) => sensitiveUnlocked && setFormData({ ...formData, student_number: e.target.value })}
                    disabled={!sensitiveUnlocked}
                  />
                </div>
                <div className="rounded border border-amber-200 bg-amber-50 p-3">
                  <label className="mb-1 block text-sm font-semibold text-[#0a2540]">Promoción</label>
                  <input
                    className={`${inputClass} ${!sensitiveUnlocked ? 'bg-gray-100 text-gray-500 cursor-not-allowed' : ''}`}
                    type="text"
                    placeholder="2025"
                    value={formData.promo}
                    onChange={(e) => sensitiveUnlocked && setFormData({ ...formData, promo: e.target.value })}
                    disabled={!sensitiveUnlocked}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-sm font-semibold text-[#0a2540]">Clase *</label>
                  <select
                    className={inputClass}
                    value={formData.class_name}
                    onChange={(e) => setFormData({ ...formData, class_name: e.target.value })}
                  >
                    <option value="">Seleccionar</option>
                    {CLASS_OPTIONS.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-sm font-semibold text-[#0a2540]">Grupo *</label>
                  <select
                    className={inputClass}
                    value={formData.group_name}
                    onChange={(e) => setFormData({ ...formData, group_name: e.target.value })}
                  >
                    <option value="">Seleccionar</option>
                    {GROUP_OPTIONS.map(g => <option key={g} value={g}>{g}</option>)}
                  </select>
                </div>
              </div>

              {formData.class_name && formData.group_name && (
                <div className="text-xs text-[#6b7280] bg-blue-50 p-2 rounded">
                  <strong>Grupo completo:</strong> {formData.class_name}{formData.group_name}
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button type="button" className={secondaryButton} onClick={() => setEditModalOpen(false)}>
                  Cancelar
                </button>
                <button className={buttonClass} disabled={busy}>
                  {busy ? 'Guardando...' : 'Guardar Cambios'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal de confirmación para cambios sensibles */}
      {confirmSaveOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-2xl">
            <h3 className="mb-3 text-lg font-bold text-[#0a2540]">⚠️ Confirmar cambios sensibles</h3>
            <p className="mb-4 text-sm text-[#374151]">
              Estás a punto de modificar datos que afectan a asistencias, evaluaciones e informes. Revisa los cambios:
            </p>

            <div className="mb-4 space-y-2 rounded bg-amber-50 p-3 text-sm">
              {formData.name !== originalData.name && (
                <div>
                  <span className="font-semibold">Nombre:</span>{' '}
                  <span className="text-red-600 line-through">{originalData.name}</span>
                  {' → '}
                  <span className="text-green-700 font-semibold">{formData.name}</span>
                </div>
              )}
              {String(formData.student_number) !== String(originalData.student_number) && (
                <div>
                  <span className="font-semibold">Nº Alumno:</span>{' '}
                  <span className="text-red-600 line-through">{originalData.student_number || '—'}</span>
                  {' → '}
                  <span className="text-green-700 font-semibold">{formData.student_number || '—'}</span>
                </div>
              )}
              {formData.promo !== originalData.promo && (
                <div>
                  <span className="font-semibold">Promoción:</span>{' '}
                  <span className="text-red-600 line-through">{originalData.promo || '—'}</span>
                  {' → '}
                  <span className="text-green-700 font-semibold">{formData.promo || '—'}</span>
                </div>
              )}
            </div>

            <p className="mb-4 text-xs text-[#6b7280]">
              Estos cambios no se pueden deshacer automáticamente. Asegúrate de que los datos son correctos.
            </p>

            <div className="flex justify-end gap-2">
              <button className={secondaryButton} onClick={() => setConfirmSaveOpen(false)}>
                Cancelar
              </button>
              <button className={dangerButton} onClick={performSave} disabled={busy}>
                {busy ? 'Guardando...' : 'Sí, guardar cambios'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
