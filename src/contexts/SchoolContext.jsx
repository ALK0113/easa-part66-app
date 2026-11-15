import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { subscribeToTables } from '../lib/supabaseRealtime.js'
import { ROLES } from '../lib/roles.js'
import { SchoolContext } from './useSchool.js'
import { useTheme } from './useTheme.js'
import { DEFAULT_BRAND_COLOR } from '../lib/theme.js'

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
        const { data } = await supabase.from('schools').select('id,name,brand_color,created_at').order('name')
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

  const school = schools.find((item) => item.id === schoolId) || null

  // El color sigue a la escuela en la que se trabaja; el admin sin escuela ve el de la primera creada
  const { setPrimaryColor } = useTheme()
  const fallbackColor = isAdmin
    ? [...schools].sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))[0]?.brand_color
    : null
  const brandColor = school?.brand_color || fallbackColor || DEFAULT_BRAND_COLOR
  useEffect(() => { setPrimaryColor(brandColor) }, [brandColor, setPrimaryColor])

  const value = useMemo(() => ({
    isAdmin,
    schools,
    schoolId,
    filterId: adminChoice || null,
    school,
    setSchoolId,
  }), [isAdmin, schools, schoolId, adminChoice, school, setSchoolId])

  return <SchoolContext.Provider value={value}>{children}</SchoolContext.Provider>
}
