import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase.js'

const ThemeContext = createContext()
export const DEFAULT_BRAND_COLOR = '#3B82F6' // Azul moderno por defecto

export const COLOR_PRESETS = [
  { name: 'Azul', value: '#3B82F6' },
  { name: 'Rojo', value: '#EF4444' },
  { name: 'Verde', value: '#10B981' },
  { name: 'Ámbar', value: '#F59E0B' },
  { name: 'Púrpura', value: '#8B5CF6' },
  { name: 'Rosa', value: '#EC4899' },
  { name: 'Cian', value: '#06B6D4' },
  { name: 'Gris', value: '#6B7280' },
  { name: 'Oscuro', value: '#1F2937' },
  { name: 'Indigo', value: '#6366F1' },
]

export function ThemeProvider({ children, user }) {
  const [brandColor, setBrandColor] = useState(DEFAULT_BRAND_COLOR)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function fetchSchoolTheme() {
      if (!user) {
        setBrandColor(DEFAULT_BRAND_COLOR)
        setLoading(false)
        return
      }

      try {
        const { data, error } = await supabase
          .from('school_profiles')
          .select('school_id, schools(brand_color)')
          .eq('profile_id', user.id)
          .maybeSingle()

        if (error) throw error

        if (data?.schools?.brand_color) {
          setBrandColor(data.schools.brand_color)
        } else {
          const { data: defaultSchool } = await supabase
            .from('schools')
            .select('brand_color')
            .order('created_at', { ascending: true })
            .limit(1)
            .maybeSingle()
          
          setBrandColor(defaultSchool?.brand_color || DEFAULT_BRAND_COLOR)
        }
      } catch (err) {
        console.error('Error al cargar el tema:', err)
        setBrandColor(DEFAULT_BRAND_COLOR)
      } finally {
        setLoading(false)
      }
    }

    fetchSchoolTheme()
  }, [user])

  useEffect(() => {
    document.documentElement.style.setProperty('--brand-primary', brandColor)
    document.documentElement.style.setProperty('--brand-subtle', brandColor + '15')
  }, [brandColor])

  return (
    <ThemeContext.Provider value={{ brandColor, setPrimaryColor: setBrandColor, loading }}>
      {children}
    </ThemeContext.Provider>
  )
}

export const useTheme = () => {
  const context = useContext(ThemeContext)
  if (!context) throw new Error('useTheme debe usarse dentro de un ThemeProvider')
  return context
}