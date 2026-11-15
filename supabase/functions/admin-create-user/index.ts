import { handler, requireManager, resolveTargetSchool, attachToSchool, readJson, HttpError } from '../_shared/utils.ts'

const ALLOWED_ROLES = ['alumno', 'profesor']
// El admin además puede crear el supervisor de una escuela nueva
const ADMIN_ROLES = [...ALLOWED_ROLES, 'supervisor']
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

Deno.serve(handler(async (req) => {
  const caller = await requireManager(req)
  const { adminClient } = caller

  const body = await readJson(req)
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
  const fullName = typeof body.full_name === 'string' ? body.full_name.trim() : ''
  const role = body.role ?? 'alumno'
  const sendInvite = body.send_invite !== false // por defecto true

  if (!EMAIL_RE.test(email) || email.length > 254 || !fullName || fullName.length > 100) {
    throw new HttpError(400, 'Correo y nombre válidos son obligatorios.')
  }
  const allowedRoles = caller.callerRole === 'admin' ? ADMIN_ROLES : ALLOWED_ROLES
  if (typeof role !== 'string' || !allowedRoles.includes(role)) {
    throw new HttpError(400, 'Rol no válido.')
  }
  const schoolId = await resolveTargetSchool(caller, body.school_id)
  // Grupo opcional para un alumno: queda matriculado en el curso actual y sus módulos
  const groupId = role === 'alumno' && typeof body.group_id === 'string' && body.group_id ? body.group_id : null
  if (groupId && !/^[0-9a-f-]{36}$/i.test(groupId)) throw new HttpError(400, 'Grupo no válido.')

  // Un correo = una sola cuenta
  const { data: existing } = await adminClient.from('profiles').select('id').eq('email', email).limit(1)
  if (existing?.length) throw new HttpError(409, 'Ya existe un usuario con ese correo.')

  let userId: string

  if (sendInvite) {
    // Modo invitación: envía email para que el usuario establezca su contraseña
    const { data: inviteData, error: inviteError } = await adminClient.auth.admin.inviteUserByEmail(email, {
      data: { full_name: fullName },
      redirectTo: Deno.env.get('SITE_URL') || req.headers.get('origin') || undefined,
    })
    if (inviteError || !inviteData.user) {
      console.error(inviteError)
      const e = inviteError as { code?: string; message?: string } | null
      if (e?.code === 'email_exists' || /already.*registered/i.test(e?.message ?? '')) {
        throw new HttpError(409, 'Ya existe un usuario con ese correo.')
      }
      throw new HttpError(400, 'No se pudo enviar la invitación.')
    }
    userId = inviteData.user.id
  } else {
    // Modo directo: crea el usuario sin enviar correo (contraseña temporal)
    // Contraseña temporal aleatoria criptográficamente segura (el usuario la cambiará)
    const tempPass = 'Tmp-' + crypto.randomUUID() + '!'
    const { data: userData, error: userError } = await adminClient.auth.admin.createUser({
      email,
      password: tempPass,
      email_confirm: true,
      user_metadata: { full_name: fullName },
    })
    if (userError || !userData.user) {
      console.error(userError)
      const e = userError as { code?: string; message?: string } | null
      if (e?.code === 'email_exists' || /already.*registered/i.test(e?.message ?? '')) {
        throw new HttpError(409, 'Ya existe un usuario con ese correo.')
      }
      throw new HttpError(400, 'No se pudo crear el usuario.')
    }
    userId = userData.user.id
  }

  // Perfil con su rol; lo crea alguien de confianza, así que nace activo
  const { error: profileError } = await adminClient
    .from('profiles')
    .upsert({ id: userId, full_name: fullName, email, role, status: 'activo' })

  if (profileError) {
    console.error(profileError)
    await adminClient.auth.admin.deleteUser(userId)
    throw new HttpError(500, 'No se pudo guardar el perfil; se canceló la creación.')
  }

  try {
    await attachToSchool(caller, userId, schoolId)
    // Un alumno nace con su ficha (y su grupo, si se eligió): no hace falta un segundo paso
    if (role === 'alumno') {
      const { error: studentError } = await adminClient.rpc('service_setup_student', { p_profile_id: userId, p_group_id: groupId })
      if (studentError) {
        console.error(studentError)
        throw new HttpError(400, studentError.code === '23503' ? studentError.message : 'No se pudo crear la ficha del alumno.')
      }
    }
  } catch (e) {
    await adminClient.auth.admin.deleteUser(userId)
    throw e
  }

  return { 
    success: true, 
    user_id: userId, 
    email, 
    send_invite: sendInvite,
  }
}))