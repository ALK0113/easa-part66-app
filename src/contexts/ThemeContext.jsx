import { useEffect, useMemo, useState } from 'react'
import { DEFAULT_BRAND_COLOR } from '../lib/theme.js'
import { ThemeContext } from './useTheme.js'

// Color de marca. Lo fija SchoolProvider con la escuela en la que se trabaja
// (la propia o la elegida por el admin), así no se consulta la escuela dos veces.
export function ThemeProvider({ children }) {
  const [brandColor, setBrandColor] = useState(DEFAULT_BRAND_COLOR)

  useEffect(() => {
    document.documentElement.style.setProperty('--brand-primary', brandColor)
    document.documentElement.style.setProperty('--brand-subtle', brandColor + '15')
  }, [brandColor])

  const value = useMemo(() => ({ brandColor, setPrimaryColor: setBrandColor, loading: false }), [brandColor])

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}
