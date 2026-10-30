import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase.js'

export default function StudentList({ user, schoolId }) {
  const [students, setStudents] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let isMounted = true

    async function loadStudents() {
      try {
        setLoading(true)
        setError('')
        
        // CORREGIDO: Eliminada la columna 'email' que no existe en la tabla students
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
          Alumnos <span className="text-gray-500 text-lg font-normal">({students.length})</span>
        </h2>
      </div>

      {students.length === 0 ? (
        <div className="rounded-lg border-2 border-dashed border-gray-300 bg-white p-12 text-center">
          <div className="text-5xl mb-4">👥</div>
          <p className="text-lg font-semibold text-gray-700">No hay alumnos registrados</p>
          <p className="text-sm text-gray-500 mt-2">
            {schoolId 
              ? 'No hay alumnos asignados a esta escuela todavía.' 
              : 'Los alumnos aparecerán aquí cuando se asignen a una escuela.'}
          </p>
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
              {students.map((student) => (
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