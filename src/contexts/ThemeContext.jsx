import { createContext, useContext, useState, useEffect } from 'react'

const ThemeContext = createContext(undefined)

const DEFAULT_COLOR = '#3B82F6'

export function ThemeProvider({ children, initialColor }) {
  const [primaryColor, setPrimaryColor] = useState(initialColor || DEFAULT_COLOR)

  useEffect(() => {
    if (!/^#[0-9A-Fa-f]{6}$/.test(primaryColor)) {
      console.warn('Color inválido, usando default:', primaryColor)
      document.documentElement.style.setProperty('--primary-color', DEFAULT_COLOR)
      return
    }

    document.documentElement.style.setProperty('--primary-color', primaryColor)

    const lighterColor = adjustColor(primaryColor, 40)
    const veryLightColor = adjustColor(primaryColor, 85)
    const darkerColor = adjustColor(primaryColor, -20)

    document.documentElement.style.setProperty('--primary-color-light', lighterColor)
    document.documentElement.style.setProperty('--primary-color-very-light', veryLightColor)
    document.documentElement.style.setProperty('--primary-color-dark', darkerColor)
  }, [primaryColor])

  return (
    <ThemeContext.Provider value={{ primaryColor, setPrimaryColor }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  const context = useContext(ThemeContext)
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider')
  }
  return context
}

function adjustColor(color, amount) {
  const hex = color.replace('#', '')

  if (!/^[0-9A-Fa-f]{6}$/.test(hex)) {
    console.warn('Color inválido en adjustColor:', color)
    return DEFAULT_COLOR
  }

  const r = Math.max(0, Math.min(255, parseInt(hex.substring(0, 2), 16) + amount))
  const g = Math.max(0, Math.min(255, parseInt(hex.substring(2, 4), 16) + amount))
  const b = Math.max(0, Math.min(255, parseInt(hex.substring(4, 6), 16) + amount))

  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`
}

export const COLOR_PRESETS = [
  { name: 'Azul', value: '#3B82F6' },
  { name: 'Verde', value: '#10B981' },
  { name: 'Púrpura', value: '#8B5CF6' },
  { name: 'Rosa', value: '#EC4899' },
  { name: 'Naranja', value: '#F59E0B' },
  { name: 'Rojo', value: '#EF4444' },
  { name: 'Turquesa', value: '#14B8A6' },
  { name: 'Índigo', value: '#6366F1' },
  { name: 'Cyan', value: '#06B6D4' },
  { name: 'Lima', value: '#84CC16' },
]
