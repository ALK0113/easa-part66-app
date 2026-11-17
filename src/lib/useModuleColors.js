import { useEffect, useState } from 'react'
import { supabase } from './supabase.js'

// Mapa id de módulo → color (1-24), cargado una sola vez por sesión. Lo usan las listas de clases teóricas,
// submódulos, prácticas y TLB para pintarse con el color de su módulo.
let cache = null
let pending = null

export function clearModuleColorCache() {
  cache = null
  pending = null
}

export function useModuleColors() {
  const [map, setMap] = useState(() => cache || {})
  useEffect(() => {
    if (cache) return undefined
    let active = true
    pending ||= supabase.from('modules').select('id,color').then(({ data }) => {
      cache = Object.fromEntries((data || []).map((item) => [item.id, item.color]))
      return cache
    })
    pending.then((result) => { if (active) setMap(result) })
    return () => { active = false }
  }, [])
  return map
}
