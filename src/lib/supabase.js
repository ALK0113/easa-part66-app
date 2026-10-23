import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

// Esto nos ayudará a depurar si algo falla
console.log('Supabase URL cargada:', supabaseUrl ? 'SÍ' : 'NO')
console.log('Supabase Key cargada:', supabaseAnonKey ? 'SÍ' : 'NO')

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Faltan las variables de entorno VITE_SUPABASE_URL o VITE_SUPABASE_ANON_KEY')
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey)