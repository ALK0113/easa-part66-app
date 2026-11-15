// Reglas de contraseña compartidas por el registro y la pantalla de nueva contraseña.
// Mantener MIN_PASSWORD_LENGTH igual que en Supabase: Authentication > Providers > Email.
export const MIN_PASSWORD_LENGTH = 10

// Comprueba en Have I Been Pwned si la contraseña aparece en filtraciones conocidas.
// Solo se envían los 5 primeros caracteres del SHA-1 (k-anonimato), nunca la contraseña.
// Si el servicio no responde, devuelve false para no bloquear al usuario.
export async function isPasswordPwned(password) {
  try {
    const bytes = new TextEncoder().encode(password)
    const digest = await crypto.subtle.digest('SHA-1', bytes)
    const hash = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('').toUpperCase()
    const prefix = hash.slice(0, 5)
    const suffix = hash.slice(5)

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 4000)
    const response = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
      headers: { 'Add-Padding': 'true' },
      signal: controller.signal,
    })
    clearTimeout(timer)
    if (!response.ok) return false

    const text = await response.text()
    return text.split('\n').some((line) => {
      const [lineSuffix, count] = line.trim().split(':')
      return lineSuffix === suffix && Number(count) > 0
    })
  } catch {
    return false
  }
}

// Devuelve un mensaje de error en español o '' si la contraseña es válida.
export async function validateNewPassword(password, confirm) {
  if (password.length < MIN_PASSWORD_LENGTH) return `La contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres.`
  if (password !== confirm) return 'Las contraseñas no coinciden.'
  if (await isPasswordPwned(password)) return 'Esa contraseña aparece en filtraciones de datos conocidas. Elige otra distinta.'
  return ''
}
