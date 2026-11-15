import { createContext, useContext } from 'react'
import { supabase } from '../lib/supabase.js'

export const SchoolContext = createContext(null)

// Escuela en la que se trabaja.
// - schoolId: la elegida por el admin ('' = todas) o la propia del resto de usuarios.
// - filterId: solo la elección del admin; las páginas filtran por ella. Al resto ya les filtra la RLS.
export function useSchool() {
  const context = useContext(SchoolContext)
  if (!context) throw new Error('useSchool debe usarse dentro de un SchoolProvider')
  return context
}

// Módulos que usa una escuela: los de sus grados (catálogo EASA o propios) y los propios sin grado aún.
export async function fetchSchoolModuleIds(schoolId) {
  const [linked, own] = await Promise.all([
    supabase.from('degree_modules').select('module_id,degrees!inner(school_id)').eq('degrees.school_id', schoolId),
    supabase.from('modules').select('id').eq('school_id', schoolId),
  ])
  const failed = linked.error || own.error
  if (failed) throw failed
  return [...new Set([...(linked.data || []).map((row) => row.module_id), ...(own.data || []).map((row) => row.id)])]
}
