import { handler, requireAdmin, readJson, HttpError } from '../_shared/utils.ts'

const ALLOWED_ROLES = ['alumno', 'profesor']
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

Deno.serve(handler(async (req) => {
  const { adminClient } = await requireAdmin(req)

  const body = await readJson(req)
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
  const fullName = typeof body.full_name === 'string' ? body.full_name.trim() : ''
  const role = body.role ?? 'alumno'

  if (!EMAIL_RE.test(email) || email.length > 254 || !fullName || fullName.length > 100) {
    throw new HttpError(400, 'Correo y nombre válidos son obligatorios.')
  }
  if (typeof role !== 'string' || !ALLOWED_ROLES.includes(role)) {
    throw new HttpError(400, 'Rol no válido.')
  }

  const { data: inviteData, error: inviteError } = await adminClient.auth.admin.inviteUserByEmail(email, {
    data: { full_name: fullName },
    redirectTo: Deno.env.get('SITE_URL') || undefined,
  })
  if (inviteError || !inviteData.user) {
    console.error(inviteError)
    throw new HttpError(400, 'No se pudo enviar la invitación.')
  }

  const { error: profileError } = await adminClient
    .from('profiles')
    .upsert({ id: inviteData.user.id, full_name: fullName, email, role })

  if (profileError) {
    console.error(profileError)
    await adminClient.auth.admin.deleteUser(inviteData.user.id)
    throw new HttpError(500, 'No se pudo guardar el perfil; se canceló la invitación.')
  }

  return { success: true, user_id: inviteData.user.id, email }
}))