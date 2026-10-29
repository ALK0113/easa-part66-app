import { handler, requireAdmin, readJson, HttpError } from '../_shared/utils.ts'

const ALLOWED_ROLES = ['alumno', 'profesor']
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

handler(async (req) => {
  const { adminClient } = await requireAdmin(req)

  const body = await readJson(req)
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
  const fullName = typeof body.full_name === 'string' ? body.full_name.trim() : ''
  const role = body.role ?? 'alumno'
  const sendInvite = body.send_invite !== false // por defecto true

  if (!EMAIL_RE.test(email) || email.length > 254 || !fullName || fullName.length > 100) {
    throw new HttpError(400, 'Correo y nombre válidos son obligatorios.')
  }
  if (typeof role !== 'string' || !ALLOWED_ROLES.includes(role)) {
    throw new HttpError(400, 'Rol no válido.')
  }

  let userId: string

  if (sendInvite) {
    // Modo invitación: envía email para que el usuario establezca su contraseña
    const { data: inviteData, error: inviteError } = await adminClient.auth.admin.inviteUserByEmail(email, {
      data: { full_name: fullName },
      redirectTo: Deno.env.get('SITE_URL') || req.headers.get('origin') || undefined,
    })
    if (inviteError || !inviteData.user) {
      console.error(inviteError)
      throw new HttpError(400, 'No se pudo enviar la invitación.')
    }
    userId = inviteData.user.id
  } else {
    // Modo directo: crea el usuario sin enviar correo (contraseña temporal)
    const tempPass = 'Temp' + Math.random().toString(36).slice(-8) + '!'
    const { data: userData, error: userError } = await adminClient.auth.admin.createUser({
      email,
      password: tempPass,
      email_confirm: true,
      user_metadata: { full_name },
    })
    if (userError || !userData.user) {
      console.error(userError)
      throw new HttpError(400, 'No se pudo crear el usuario.')
    }
    userId = userData.user.id
  }

  // Actualizar el perfil con el rol correcto
  const { error: profileError } = await adminClient
    .from('profiles')
    .upsert({ id: userId, full_name: fullName, email, role })

  if (profileError) {
    console.error(profileError)
    await adminClient.auth.admin.deleteUser(userId)
    throw new HttpError(500, 'No se pudo guardar el perfil; se canceló la creación.')
  }

  return { 
    success: true, 
    user_id: userId, 
    email, 
    send_invite: sendInvite 
  }
})