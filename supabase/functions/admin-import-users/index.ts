import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'

const corsHeaders = {
  'Access-Control-Allow-Origin': Deno.env.get('ALLOWED_ORIGIN') ?? '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function getServiceRoleKey(): string {
  try {
    const keys = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}')
    return (Object.values(keys)[0] as string) ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  } catch {
    return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return new Response('Método no permitido', { status: 405 })

  try {
    const url = Deno.env.get('SUPABASE_URL') ?? ''
    const serviceKey = getServiceRoleKey()
    const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')

    if (!url || !serviceKey || !token) throw new Error('Configuración o sesión no válida')

    const adminClient = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
    
    // 1. Verificar admin
    const { data: authData, error: authError } = await adminClient.auth.getUser(token)
    if (authError || !authData.user) throw new Error('Sesión no válida')
    
    const { data: profile } = await adminClient.from('profiles').select('role').eq('id', authData.user.id).single()
    if (profile?.role !== 'admin') throw new Error('Se requiere rol de administración')

    // 2. Recibir datos
    const body = await req.json()
    const { role, send_invites, rows } = body
    if (!Array.isArray(rows)) throw new Error('Formato de filas no válido')
    if (role !== 'alumno' && role !== 'profesor') throw new Error('Rol no válido')

    const results = []

    for (const r of rows) {
      try {
        const { row, full_name, email, identification, birth_date, class_name, group_name, promo, modules, phone } = r
        
        if (!full_name || !email) throw new Error('Nombre y email son obligatorios')
        
        // 3. Crear o invitar usuario
        let userId = null
        if (send_invites) {
          const { data: inviteData, error: inviteError } = await adminClient.auth.admin.inviteUserByEmail(email, {
            data: { full_name },
            redirectTo: req.headers.get('origin') || Deno.env.get('ALLOWED_ORIGIN') || undefined,
          })
          if (inviteError || !inviteData.user) throw new Error(inviteError?.message || 'No se pudo enviar la invitación')
          userId = inviteData.user.id
        } else {
          const tempPass = 'Temp' + Math.random().toString(36).slice(-8) + '!'
          const { data: userData, error: userError } = await adminClient.auth.admin.createUser({
            email,
            password: tempPass,
            email_confirm: true,
            user_metadata: { full_name }
          })
          if (userError || !userData.user) throw new Error(userError?.message || 'No se pudo crear el usuario')
          userId = userData.user.id
        }

        // 4. Actualizar perfil
        const profileUpdates: any = { full_name, email, role }
        if (phone) profileUpdates.phone = phone
        
        const { error: updateProfileError } = await adminClient.from('profiles').update(profileUpdates).eq('id', userId)
        if (updateProfileError) throw new Error(`Error al actualizar perfil: ${updateProfileError.message}`)

        // 5. Si es alumno, crear/actualizar ficha
        if (role === 'alumno') {
          // Extraer número de identificación para student_number (integer)
          let studentNumber = null
          if (identification) {
            const numMatch = String(identification).match(/\d+/)
            studentNumber = numMatch ? parseInt(numMatch[0], 10) : null
          }

          const studentData: any = {
            name: full_name,
            group_name: group_name || null,
            year: class_name || null,
            promo: promo || null,
            birth_date: birth_date || null,
            identification: identification || null,
          }
          if (studentNumber !== null) studentData.student_number = studentNumber

          let studentId = null
          
          // Buscar existente por identificación
          if (identification) {
            const { data: existing } = await adminClient.from('students').select('id').eq('identification', identification).maybeSingle()
            if (existing) {
              studentId = existing.id
              await adminClient.from('students').update(studentData).eq('id', studentId)
            }
          }
          
          // Buscar existente por student_number
          if (!studentId && studentNumber) {
            const { data: existing } = await adminClient.from('students').select('id').eq('student_number', studentNumber).maybeSingle()
            if (existing) {
              studentId = existing.id
              await adminClient.from('students').update(studentData).eq('id', studentId)
            }
          }

          // Crear nuevo si no existe
          if (!studentId) {
            const { data: newStudent, error: insertError } = await adminClient.from('students').insert(studentData).select('id').single()
            if (insertError) throw new Error(`Error al crear alumno: ${insertError.message}`)
            studentId = newStudent.id
          }

          // Vincular profile con student
          await adminClient.from('student_profiles').upsert({
            profile_id: userId,
            student_id: studentId
          })

          // Matricular en módulos (buscar por ID o por nombre)
          if (Array.isArray(modules) && modules.length > 0) {
            const validModules = []
            for (const modName of modules) {
              const { data: modData } = await adminClient.from('modules').select('id').eq('id', modName).maybeSingle()
              let moduleId = modData?.id
              
              if (!moduleId) {
                const { data: modDataByName } = await adminClient.from('modules').select('id').ilike('name', modName).maybeSingle()
                moduleId = modDataByName?.id
              }
              
              if (moduleId) {
                validModules.push({ student_id: studentId, module_id: moduleId })
              }
            }
            
            if (validModules.length > 0) {
              await adminClient.from('student_modules').upsert(validModules, { onConflict: 'student_id,module_id' })
            }
          }
        }

        results.push({ row, ok: true, user_id: userId })
      } catch (err: any) {
        results.push({ row: r.row, ok: false, error: err.message || 'Error desconocido' })
      }
    }

    return new Response(JSON.stringify({ results }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    })

  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    })
  }
})