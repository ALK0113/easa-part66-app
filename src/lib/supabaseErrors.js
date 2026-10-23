export function isMissingTable(error) {
  return error?.code === 'PGRST205' || error?.code === '42P01'
}

export function getSupabaseErrorMessage(error) {
  if (error?.code === 'PGRST202') {
    return 'Falta desplegar las funciones del backend. Desde la carpeta del proyecto ejecuta `npx supabase db push` y vuelve a cargar la app.'
  }
  if (isMissingTable(error)) {
    return 'Falta una tabla del esquema Supabase. Aplica las migraciones con `npx supabase db push` y vuelve a cargar la app.'
  }
  return error?.message || 'Error de comunicación con Supabase.'
}