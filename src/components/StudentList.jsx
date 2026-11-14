import { useEffect, useState, useMemo } from 'react'
import { supabase } from '../lib/supabase.js'
import Icon from './Icon.jsx'

export default function StudentList({ schoolId }) {
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
    return <div className="flex min-h-[40vh] items-center justify-center text-sm text-muted">Cargando alumnos…</div>
  }

  if (error) {
    return (
      <div role="alert" className="card p-6 text-center">
        <p className="font-medium text-ink">No se pudo cargar el listado</p>
        <p className="mt-1 text-sm text-muted">{error}</p>
        <button onClick={() => window.location.reload()} className="btn-secondary mt-4">Reintentar</button>
      </div>
    )
  }

  const filterSelect = (value, setValue, placeholder, options) => (
    <select value={value} onChange={(e) => setValue(e.target.value)} className="input">
      <option value="">{placeholder}</option>
      {options.map((option) => <option key={option} value={option}>{option}</option>)}
    </select>
  )

  return (
    <div className="space-y-5">
      <div className="page-intro">
        <div>
          <h2>Alumnos</h2>
          <p>{hasActiveFilters ? `${filteredStudents.length} de ${students.length}` : `${students.length} ${students.length === 1 ? 'alumno' : 'alumnos'}`}</p>
        </div>
        {hasActiveFilters && <button type="button" onClick={clearFilters} className="btn-ghost text-muted">Limpiar filtros</button>}
      </div>

      <div className="grid gap-2 md:grid-cols-[2fr_1fr_1fr_1fr]">
        <div className="relative">
          <Icon name="search" size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
          <input
            type="search"
            placeholder="Buscar alumno…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="input pl-9"
          />
        </div>
        {filterSelect(filterClass, setFilterClass, 'Todas las clases', uniqueClasses)}
        {filterSelect(filterGroup, setFilterGroup, 'Todos los grupos', uniqueGroups)}
        {filterSelect(filterPromo, setFilterPromo, 'Todas las promociones', uniquePromos)}
      </div>

      {filteredStudents.length === 0 ? (
        <div className="card empty">
          <p className="font-medium text-ink-soft">{hasActiveFilters ? 'Ningún alumno coincide con la búsqueda' : 'Todavía no hay alumnos'}</p>
          <p className="mt-1">
            {hasActiveFilters
              ? 'Prueba con otros criterios.'
              : 'Aparecerán aquí cuando estén matriculados en tus módulos.'}
          </p>
        </div>
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm" aria-label="Tabla de alumnos">
              <thead>
                <tr>
                  <th className="px-5 py-3">Nombre</th>
                  <th className="px-5 py-3">Nº</th>
                  <th className="px-5 py-3">Clase</th>
                  <th className="px-5 py-3">Grupo</th>
                  <th className="px-5 py-3">Promoción</th>
                </tr>
              </thead>
              <tbody>
                {filteredStudents.map((student) => (
                  <tr key={student.id} className="border-t border-line">
                    <td className="px-5 py-3.5 font-medium text-ink">{student.name || 'Sin nombre'}</td>
                    <td className="px-5 py-3.5 tabular-nums text-muted">{student.student_number || '—'}</td>
                    <td className="px-5 py-3.5 text-ink-soft">{student.class_name || '—'}</td>
                    <td className="px-5 py-3.5 text-ink-soft">{student.group_name || '—'}</td>
                    <td className="px-5 py-3.5 text-ink-soft">{student.promo || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
