// IMPORTANTE: debe importarse ANTES que cualquier módulo que cree el cliente de Supabase.
const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''))
const type = hash.get('type')

export const authIntent = {
  error: hash.get('error_description') || null, // enlace caducado o ya usado
}

const KEY = 'passwordPending'

export const isPasswordPending = () => {
  try {
    return sessionStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
}
export const markPasswordPending = () => {
  try {
    sessionStorage.setItem(KEY, '1')
  } catch { /* nada */ }
}
export const clearPasswordPending = () => {
  try {
    sessionStorage.removeItem(KEY)
  } catch { /* nada */ }
}

// Invitación o restablecimiento: el usuario debe elegir contraseña
if (type === 'invite' || type === 'recovery') markPasswordPending()