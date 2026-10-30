import { useEffect, useState, useMemo } from 'react'
import { supabase } from '../lib/supabase.js'

export default function StudentList({ user, schoolId }) {
  const [students, setStudents] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // Estados de búsqueda y filtros
  const [searchQuery, setSearchQuery] = useState('')
  const [filterClass, setFilterClass] = useState('')
  const [filterGroup, setFilterGroup] = useState('')
  const [filterPromo, setFilterPromo] = useState('')

  useEffect(() => {
    let isMounted = true

    async function loadStudents() {
      try {
        setLoading(true)
        setError('')
        
        let query = supabase
          .from('students')
          .select('id, name, student_number, class_name, group_name, promo, school_id')
          .order('name', { ascending: true })
        
        if (schoolId) {
          query = query.eq('school_id', schoolId)
        }
        
        const { data, error: supabaseError } = await query
        
        if (!isMounted) return

        if (supabaseError) throw supabaseError
        
        setStudents(data || [])
      } catch (err) {
        if (!isMounted) return
        const errorMessage = err.message || 'Error desconocido al cargar los datos'
        setError(`Error al cargar alumnos: ${errorMessage}`)
        console.error('StudentList Error:', err)
      } finally {
        if (isMounted) setLoading(false)
      }
    }

    loadStudents()

    return () => {
      isMounted = false
    }
  }, [schoolId])

  // Extraer valores únicos para los filtros
  const uniqueClasses = useMemo(() => {
    const classes = students.map(s => s.class_name).filter(Boolean)
    return [...new Set(classes)].sort()
  }, [students])

  const uniqueGroups = useMemo(() => {
    const groups = students.map(s => s.group_name).filter(Boolean)
    return [...new Set(groups)].sort()
  }, [students])

  const uniquePromos = useMemo(() => {
    const promos = students.map(s => s.promo).filter(Boolean)
    return [...new Set(promos)].sort()
  }, [students])

  // Filtrar alumnos según búsqueda y filtros
  const filteredStudents = useMemo(() => {
    return students.filter(student => {
      // Búsqueda por texto (nombre, número, clase, grupo, promo)
      const matchesSearch = !searchQuery || 
        student.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        student.student_number?.toString().includes(searchQuery) ||
        student.class_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        student.group_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        student.promo?.toLowerCase().includes(searchQuery.toLowerCase())

      // Filtros por clase, grupo y promoción
      const matchesClass = !filterClass || student.class_name === filterClass
      const matchesGroup = !filterGroup || student.group_name === filterGroup
      const matchesPromo = !filterPromo || student.promo === filterPromo

      return matchesSearch && matchesClass && matchesGroup && matchesPromo
    })
  }, [students, searchQuery, filterClass, filterGroup, filterPromo])

  // Limpiar todos los filtros
  function clearFilters() {
    setSearchQuery('')
    setFilterClass('')
    setFilterGroup('')
    setFilterPromo('')
  }

  const hasActiveFilters = searchQuery || filterClass || filterGroup || filterPromo

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center p-12 text-gray-500">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-gray-200 border-t-blue-600"></div>
        <p className="mt-3 text-sm font-medium">Cargando listado de alumnos...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-center text-red-700">
        <p className="font-semibold">⚠️ Error de conexión</p>
        <p className="mt-1 text-sm">{error}</p>
        <button 
          onClick={() => window.location.reload()} 
          className="mt-4 rounded bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 transition-colors"
        >
          Reintentar
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-gray-800">
          Alumnos <span className="text-gray-500 text-lg font-normal">({filteredStudents.length} de {students.length})</span>
        </h2>
      </div>

      {/* Barra de búsqueda y filtros */}
      <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm space-y-3">
        {/* Búsqueda */}
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">🔍</span>
          <input
            type="text"
            placeholder="Buscar por nombre, número, clase, grupo o promoción..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-lg border border-gray-300 bg-white pl-10 pr-4 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none transition-all"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 cursor-pointer text-lg"
            >
              ×
            </button>
          )}
        </div>

        {/* Filtros */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <select
            value={filterClass}
            onChange={(e) => setFilterClass(e.target.value)}
            className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none transition-all"
          >
            <option value="">Todas las clases</option>
            {uniqueClasses.map(cls => (
              <option key={cls} value={cls}>{cls}</option>
            ))}
          </select>

          <select
            value={filterGroup}
            onChange={(e) => setFilterGroup(e.target.value)}
            className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none transition-all"
          >
            <option value="">Todos los grupos</option>
            {uniqueGroups.map(grp => (
              <option key={grp} value={grp}>{grp}</option>
            ))}
          </select>

          <select
            value={filterPromo}
            onChange={(e) => setFilterPromo(e.target.value)}
            className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none transition-all"
          >
            <option value="">Todas las promociones</option>
            {uniquePromos.map(promo => (
              <option key={promo} value={promo}>{promo}</option>
            ))}
          </select>
        </div>

        {/* Botón limpiar filtros */}
        {hasActiveFilters && (
          <button
            type="button"
            onClick={clearFilters}
            className="text-sm text-blue-600 hover:text-blue-800 font-medium transition-colors"
          >
            🗑️ Limpiar todos los filtros
          </button>
        )}
      </div>

      {/* Resultados */}
      {filteredStudents.length === 0 ? (
        <div className="rounded-lg border-2 border-dashed border-gray-300 bg-white p-12 text-center">
          <div className="text-5xl mb-4">👥</div>
          <p className="text-lg font-semibold text-gray-700">
            {hasActiveFilters ? 'No hay alumnos que coincidan con los filtros' : 'No hay alumnos registrados'}
          </p>
          <p className="text-sm text-gray-500 mt-2">
            {hasActiveFilters 
              ? 'Prueba a cambiar los criterios de búsqueda o limpia los filtros.' 
              : schoolId 
                ? 'No hay alumnos asignados a esta escuela todavía.' 
                : 'Los alumnos aparecerán aquí cuando se asignen a una escuela.'}
          </p>
          {hasActiveFilters && (
            <button
              type="button"
              onClick={clearFilters}
              className="mt-4 rounded bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 transition-colors"
            >
              Limpiar filtros
            </button>
          )}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white shadow-sm">
          <table className="w-full text-left text-sm" aria-label="Tabla de alumnos">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="p-4 font-semibold text-gray-700">Nombre</th>
                <th className="p-4 font-semibold text-gray-700">Nº Alumno</th>
                <th className="p-4 font-semibold text-gray-700">Clase</th>
                <th className="p-4 font-semibold text-gray-700">Grupo</th>
                <th className="p-4 font-semibold text-gray-700">Promo</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {filteredStudents.map((student) => (
                <tr key={student.id} className="hover:bg-blue-50/50 transition-colors duration-150">
                  <td className="p-4 font-medium text-gray-900">{student.name || 'Sin nombre'}</td>
                  <td className="p-4 font-mono text-xs text-gray-600 bg-gray-50/50 rounded">
                    {student.student_number || '—'}
                  </td>
                  <td className="p-4 text-gray-600">{student.class_name || '—'}</td>
                  <td className="p-4 text-gray-600">{student.group_name || '—'}</td>
                  <td className="p-4 text-gray-600">{student.promo || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}