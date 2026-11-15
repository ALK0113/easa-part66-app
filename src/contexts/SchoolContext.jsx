import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { subscribeToTables } from '../lib/supabaseRealtime.js'
import { ROLES } from '../lib/roles.js'
import { SchoolContext } from './useSchool.js'

const STORAGE_KEY = 'aviatrack.adminSchool'

function readStored() {
  try { return window.localStorage.getItem(STORAGE_KEY) || '' } catch { return '' }
}

export function SchoolProvider({ user, children }) {
  const isAdmin = user.role === ROLES.ADMIN
  const [schools, setSchools] = useState([])
  const [ownSchoolId, setOwnSchoolId] = useState('')
  const [selected, setSelected] = useState(() => (isAdmin ? readStored() : ''))

  useEffect(() => {
    let active = true
    async function load() {
      if (isAdmin) {
        const { data } = await supabase.from('schools').select('id,name,brand_color').order('name')
        if (active) setSchools(data || [])
      } else {
        const { data } = await supabase.from('school_profiles').select('school_id,schools(id,name,brand_color)').eq('profile_id', user.id).maybeSingle()
        if (!active) return
        setOwnSchoolId(data?.school_id || '')
        setSchools(data?.schools ? [data.schools] : [])
      }
    }
    load()
    const unsubscribe = isAdmin ? subscribeToTables(['schools'], load, `school-context-${user.id}`) : () => {}
    return () => { active = false; unsubscribe() }
  }, [isAdmin, user.id])

  const setSchoolId = useCallback((id) => {
    setSelected(id || '')
    try { window.localStorage.setItem(STORAGE_KEY, id || '') } catch { /* solo es una comodidad */ }
  }, [])

  // Si la escuela guardada ya no existe, se vuelve a «todas»
  const adminChoice = isAdmin && schools.some((school) => school.id === selected) ? selected : ''
  const schoolId = isAdmin ? adminChoice : ownSchoolId

  const value = useMemo(() => ({
    isAdmin,
    schools,
    schoolId,
    filterId: adminChoice || null,
    school: schools.find((school) => school.id === schoolId) || null,
    setSchoolId,
  }), [isAdmin, schools, schoolId, adminChoice, setSchoolId])

  return <SchoolContext.Provider value={value}>{children}</SchoolContext.Provider>
}
