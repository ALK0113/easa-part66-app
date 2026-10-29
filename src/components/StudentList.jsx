import { useEffect, useState, useMemo } from 'react'
import { supabase } from '../lib/supabase.js'
import { getSupabaseErrorMessage } from '../lib/supabaseErrors.js'
import { subscribeToTables } from '../lib/supabaseRealtime.js'

const inputClass = 'w-full rounded border border-[#d1d5db] px-3 py-2 text-sm focus:border-[#1e88e5]'
const buttonClass = 'rounded bg-[#1e88e5] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1565c0] disabled:opacity-50'
const secondaryButton = 'rounded border border-[#d1d5db] bg-white px-4 py-2 text-sm font-semibold text-[#0a2540] hover:bg-[#f4f6f9]'
const dangerButton = 'rounded bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50'

const CLASS_OPTIONS = ['1º', '2º', '3º']
const GROUP_OPTIONS = ['A', 'B', 'C', 'D']

export default function StudentList({ user }) {
  const [students, setStudents] = useState([])
  const [modules, setModules] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterPromo, setFilterPromo] = useState('')
  const [filterClass, setFilterClass] = useState('')
  const [filterGroup, setFilterGroup] = useState('')
  const [editModalOpen, setEditModalOpen] = useState(false)
  const [createModalOpen, setCreateModalOpen] = useState(false)
  const [editingStudent, setEditingStudent] = useState(null)
  const [formData, setFormData] = useState({})
  const [originalData, setOriginalData] = useState({})
  const [sensitiveUnlocked, setSensitiveUnlocked] = useState(false)
  const [confirmSaveOpen, setConfirmSaveOpen] = useState(false)
  const [sendInvite, setSendInvite] = useState(true)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  const isAdmin = user?.role === 'admin'
  const isTeacher = user?.role === 'profesor'

  useEffect(() => {
    loadStudents()
    loadModules()
    const unsub = subscribeToTables(['students', 'student_modules', 'student_profiles'], () => loadStudents(), 'students-list')
    return () => unsub()
  }, [user?.id])

  async function loadModules() {
    const { data } = await supabase.from('modules').select('id, name').order('id')
    setModules(data || [])
  }

  async function loadStudents() {
    setLoading(true)
    setMessage('')
    try {
      let query = supabase
        .from('students')
        .select(`
          id,
          student_number,
          name,
          class_name,
          group_name,
          promo,
          student_modules (module_id)
        `)
        .order('name')

      if (isTeacher) {
        const { data: teacherModules, error: tmError } = await supabase
          .from('teacher_modules')
          .select('module_id')
          .eq('profile_id', user.id)
        
        if (tmError) throw tmError
        const moduleIds = (teacherModules || []).map(m => m.module_id)
        
        if (moduleIds.length === 0) {
          setStudents([])
          setLoading(false)
          return
        }

        const { data: studentIds } = await supabase
          .from('student_modules')
          .select('student_id')
          .in('module_id', moduleIds)
        
        const uniqueIds = [...new Set((studentIds || []).map(s => s.student_id))]
        query = query.in('id', uniqueIds)
      }

      const { data, error } = await query
      if (error) throw error
      setStudents(data || [])
    } catch (err) {
      setMessage('Error al cargar alumnos: ' + getSupabaseErrorMessage(err))
    } finally {
      setLoading(false)
    }
  }

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
        const { data: existing } = await supabase
          .from('students')
          .select('id')
          .eq('student_number', parseInt(formData.student_number))
          .neq('id', editingStudent.id)
          .maybeSingle()
        
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

      const { error } = await supabase
        .from('students')
        .update(updateData)
        .eq('id', editingStudent.id)

      if (error) {
        if (error.code === '23505') {
          setMessage('❌ El número de alumno ya existe en la base de datos.')
        } else {
          setMessage('❌ Error al guardar: ' + getSupabaseErrorMessage(error))
        }
      } else {
        setMessage('✅ Alumno actualizado correctamente.')
        setEditModalOpen(false)
        await loadStudents()
      }
    } catch (err) {
      setMessage(' Error: ' + (err.message || 'Desconocido'))
    } finally {
      setBusy(false)
    }
  }

  async function performCreate() {
    setBusy(true)
    setMessage('')

    try {
      const { email, full_name, student_number, class_name, group_name, promo, identification, birth_date, selectedModules } = formData

      if (!email || !full_name) {
        setMessage('❌ Email y nombre son obligatorios.')
        setBusy(false)
        return
      }

      // 1. Crear usuario en Auth vía Edge Function
      const { data: inviteData, error: inviteError } = await supabase.functions.invoke('admin-create-user', {
        body: {
          email: email.trim().toLowerCase(),
          full_name: full_name.trim(),
          role: 'alumno',
          send_invite: sendInvite
        }
      })

      if (inviteError) {
        const msg = inviteError.context?.error || inviteError.message || 'No se pudo crear el usuario.'
        setMessage('❌ ' + msg)
        setBusy(false)
        return
      }

      const userId = inviteData.user_id

      // 2. Crear ficha de estudiante
      const finalGroupName = class_name && group_name ? `${class_name}${group_name}` : group_name || null
      const studentNumber = student_number ? parseInt(student_number) : null

      const { data: newStudent, error: studentError } = await supabase
        .from('students')
        .insert({
          student_number: studentNumber,
          name: full_name.trim(),
          class_name: class_name || null,
          group_name: finalGroupName,
          promo: promo || null,
        })
        .select('id')
        .single()

      if (studentError) {
        setMessage('️ Usuario creado, pero error al crear ficha: ' + getSupabaseErrorMessage(studentError))
        setBusy(false)
        return
      }

      // 3. Vincular profile con student
      await supabase.from('student_profiles').insert({
        profile_id: userId,
        student_id: newStudent.id
      })

      // 4. Matricular en módulos
      if (selectedModules && selectedModules.length > 0) {
        const enrollments = selectedModules.map(moduleId => ({
          student_id: newStudent.id,
          module_id: moduleId
        }))
        await supabase.from('student_modules').insert(enrollments)
      }

      const inviteMsg = sendInvite 
        ? 'Se ha enviado la invitación por correo.' 
        : 'Usuario creado sin enviar correo (contraseña temporal generada).'
      setMessage(`✅ Alumno creado correctamente. ${inviteMsg}`)
      setCreateModalOpen(false)
      await loadStudents()
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
      await supabase.from('student_modules').delete().eq('student_id', student.id)
      await supabase.from('student_profiles').delete().eq('student_id', student.id)
      
      const { error } = await supabase.from('students').delete().eq('id', student.id)
      if (error) throw error
      
      setMessage('✅ Alumno eliminado correctamente.')
      await loadStudents()
    } catch (err) {
      setMessage('❌ Error al eliminar: ' + getSupabaseErrorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  function getModuleCount(student) {
    return student.student_modules?.length || 0
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

  if (loading) return <div className="p-8 text-center text-[#0a2540]">Cargando alumnos...</div>

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-[#0a2540]">
            Alumnos ({filteredStudents.length})
          </h2>
          <p className="text-sm text-[#6b7280]">
            {isTeacher ? 'Alumnos matriculados en tus módulos' : 'Gestión completa de alumnos'}
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
        <div className={`rounded p-3 text-sm ${message.includes('✅') ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'}`}>
          {message}
        </div>
      )}

      {/* Filtros y búsqueda */}
      <div className="rounded-lg border border-[#e5e7eb] bg-white p-4">
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
      <div className="overflow-hidden rounded-lg border border-[#e5e7eb] bg-white">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-[#0a2540] text-xs uppercase text-white">
              <tr>
                <th className="p-3">#</th>
                <th className="p-3">Nombre</th>
                <th className="p-3">Nº Alumno</th>
                <th className="p-3">Clase</th>
                <th className="p-3">Grupo</th>
                <th className="p-3">Promoción</th>
                <th className="p-3">Módulos</th>
                {isAdmin && <th className="p-3 text-right">Acciones</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-[#e5e7eb]">
              {filteredStudents.map((student, index) => (
                <tr key={student.id} className="hover:bg-[#f9fafb]">
                  <td className="p-3 text-[#6b7280]">{index + 1}</td>
                  <td className="p-3 font-medium text-[#0a2540]">{student.name}</td>
                  <td className="p-3 text-[#6b7280]">{student.student_number || '—'}</td>
                  <td className="p-3">{student.class_name || '—'}</td>
                  <td className="p-3">{student.group_name || '—'}</td>
                  <td className="p-3">{student.promo || '—'}</td>
                  <td className="p-3">
                    <span className="rounded bg-blue-50 px-2 py-1 text-xs font-semibold text-blue-700">
                      {getModuleCount(student)} módulos
                    </span>
                  </td>
                  {isAdmin && (
                    <td className="p-3 text-right">
                      <div className="flex justify-end gap-2">
                        <button
                          className="rounded border border-[#d1d5db] px-3 py-1 text-xs font-semibold text-[#0a2540] hover:bg-[#f4f6f9]"
                          onClick={() => openEditModal(student)}
                        >
                          ✏️ Editar
                        </button>
                        <button
                          className="rounded border border-red-200 px-3 py-1 text-xs font-semibold text-red-700 hover:bg-red-50"
                          onClick={() => deleteStudent(student)}
                          disabled={busy}
                        >
                          🗑️ Eliminar
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
              {filteredStudents.length === 0 && (
                <tr>
                  <td colSpan={isAdmin ? 8 : 7} className="p-8 text-center text-[#6b7280]">
                    No hay alumnos que coincidan con los filtros.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal de CREAR nuevo alumno */}
      {createModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onMouseDown={(e) => e.target === e.currentTarget && setCreateModalOpen(false)}>
          <div className="w-full max-w-2xl rounded-lg bg-white p-6 shadow-2xl max-h-[90vh] overflow-y-auto">
            <h3 className="mb-4 text-lg font-bold text-[#0a2540]">➕ Nuevo Alumno</h3>
            
            <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); performCreate() }}>
              {/* Datos de usuario (Auth) */}
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

                {/* Checkbox de invitación */}
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

              {/* Datos de estudiante */}
              <div className="rounded border border-gray-200 bg-gray-50 p-3">
                <h4 className="mb-2 text-sm font-semibold text-[#0a2540]"> Ficha de alumno</h4>
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

              {/* Módulos */}
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
                      className="text-xs text-[#1e88e5] hover:underline"
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