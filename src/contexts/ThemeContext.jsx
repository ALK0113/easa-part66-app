import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { DEFAULT_BRAND_COLOR } from '../lib/theme.js'
import { ThemeContext } from './useTheme.js'

export function ThemeProvider({ children, user }) {
  const [brandColor, setBrandColor] = useState(DEFAULT_BRAND_COLOR)
  const [loading, setLoading] = useState(true)
  const userId = user?.id

  useEffect(() => {
    let cancelled = false

    async function fetchSchoolTheme() {
      let color = DEFAULT_BRAND_COLOR
      try {
        if (userId) {
          const { data, error } = await supabase
            .from('school_profiles')
            .select('school_id, schools(brand_color)')
            .eq('profile_id', userId)
            .maybeSingle()
          if (error) throw error

          if (data?.schools?.brand_color) {
            color = data.schools.brand_color
          } else {
            const { data: defaultSchool } = await supabase
              .from('schools')
              .select('brand_color')
              .order('created_at', { ascending: true })
              .limit(1)
              .maybeSingle()
            color = defaultSchool?.brand_color || DEFAULT_BRAND_COLOR
          }
        }
      } catch (err) {
        console.error('Error al cargar el tema:', err)
      }
      if (!cancelled) {
        setBrandColor(color)
        setLoading(false)
      }
    }

    fetchSchoolTheme()
    return () => { cancelled = true }
  }, [userId])

  useEffect(() => {
    document.documentElement.style.setProperty('--brand-primary', brandColor)
    document.documentElement.style.setProperty('--brand-subtle', brandColor + '15')
  }, [brandColor])

  const value = useMemo(() => ({ brandColor, setPrimaryColor: setBrandColor, loading }), [brandColor, loading])

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}
