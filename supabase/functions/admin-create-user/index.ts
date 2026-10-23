import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return respond({ error: 'Método no permitido.' }, 405)

  const authorization = request.headers.get('Authorization')
  const token = authorization?.replace(/^Bearer\s+/i, '')
  if (!token) return respond({ error: 'Sesión requerida.' }, 401)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !anonKey || !serviceRoleKey) return respond({ error: 'Configuración de servidor incompleta.' }, 500)

  const authClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  })
  const { data: authData, error: authError } = await authClient.auth.getUser(token)
  if (authError || !authData.user) return respond({ error: 'Sesión no válida.' }, 401)

  const adminClient = createClient(supabaseUrl, serviceRoleKey)
  const { data: callerProfile, error: profileError } = await adminClient
    .from('profiles')
    .select('role')
    .eq('id', authData.user.id)
    .single()

  if (profileError || callerProfile?.role !== 'admin') return respond({ error: 'Se requiere rol de administración.' }, 403)

  let body: {
    email?: string
    full_name?: string
    role?: string
    student?: { student_number?: number | string; name?: string; group_name?: string; promo?: string }
    module_ids?: string[]
  }
  try {
    body = await request.json()
  } catch {
    return respond({ error: 'Solicitud JSON no válida.' }, 400)
  }

  const email = body.email?.trim().toLowerCase()
  const fullName = body.full_name?.trim()
  const role = body.role
  if (!email || !fullName || !['alumno', 'profesor'].includes(role || '')) {
    return respond({ error: 'Correo, nombre y rol válido son obligatorios.' }, 400)
  }
  if (role === 'alumno' && (!body.student?.student_number || !body.student.name?.trim())) {
    return respond({ error: 'La ficha de alumno requiere número y nombre.' }, 400)
  }
  if (body.module_ids && (!Array.isArray(body.module_ids) || body.module_ids.some((id) => typeof id !== 'string'))) {
    return respond({ error: 'La lista de módulos no es válida.' }, 400)
  }

  const { data: inviteData, error: inviteError } = await adminClient.auth.admin.inviteUserByEmail(email, {
    data: { full_name: fullName },
    redirectTo: request.headers.get('origin') || undefined,
  })
  if (inviteError || !inviteData.user) return respond({ error: inviteError?.message || 'No se pudo enviar la invitación.' }, 400)

  const { error: updateError } = await adminClient
    .from('profiles')
    .update({ full_name: fullName, email, role })
    .eq('id', inviteData.user.id)

  if (updateError) {
    await adminClient.auth.admin.deleteUser(inviteData.user.id)
    return respond({ error: `No se pudo guardar el perfil; se canceló la invitación: ${updateError.message}` }, 500)
  }

  if (role === 'alumno' && body.student) {
    const { data: studentResult, error: studentError } = await adminClient.rpc('admin_create_student_with_profile', {
      p_student: {
        student_number: body.student.student_number,
        name: body.student.name.trim(),
        group_name: body.student.group_name?.trim() || null,
        promo: body.student.promo?.trim() || null,
      },
      p_profile_id: inviteData.user.id,
      p_module_ids: body.module_ids || [],
    })
    if (studentError) {
      await adminClient.auth.admin.deleteUser(inviteData.user.id)
      return respond({ error: `No se pudo crear la ficha; se canceló la invitación: ${studentError.message}` }, 400)
    }
    return respond({ userId: inviteData.user.id, studentId: studentResult.student_id, email })
  }

  return respond({ userId: inviteData.user.id, email })
})

function respond(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}