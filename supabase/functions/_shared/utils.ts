import { createClient } from 'npm:@supabase/supabase-js@2.45.4'

export const ROLES = ['alumno', 'profesor', 'admin']

const DEBUG = Deno.env.get('DEBUG') === 'true'
const debug = (...args: unknown[]) => {
  if (DEBUG) console.log('[debug]', ...args)
}

if (!Deno.env.get('ALLOWED_ORIGIN')) {
  console.warn('ALLOWED_ORIGIN no está definido: el navegador bloqueará las peticiones por CORS')
}

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message)
    this.name = 'HttpError'
  }
}

export const corsHeaders = {
  'Access-Control-Allow-Origin': Deno.env.get('ALLOWED_ORIGIN') ?? '',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Vary': 'Origin',
}

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

// Clave secreta: primero el diccionario nuevo, después la variable legacy
function getServiceRoleKey(): string {
  const secretKeysJson = Deno.env.get('SUPABASE_SECRET_KEYS')
  if (secretKeysJson) {
    try {
      const firstKey = Object.values(JSON.parse(secretKeysJson))[0]
      if (typeof firstKey === 'string' && firstKey) {
        debug('clave leída de SUPABASE_SECRET_KEYS')
        return firstKey
      }
    } catch (e) {
      console.error('No se pudo parsear SUPABASE_SECRET_KEYS:', e)
    }
  }

  const legacyKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (legacyKey) {
    debug('clave leída de SUPABASE_SERVICE_ROLE_KEY (legacy)')
    return legacyKey
  }

  console.error('No hay ninguna clave secreta en las variables de entorno')
  return ''
}

export async function readJson(req: Request): Promise<Record<string, unknown>> {
  try {
    const body = await req.json()
    if (body && typeof body === 'object' && !Array.isArray(body)) return body
  } catch {
    // cae al error de abajo
  }
  throw new HttpError(400, 'Cuerpo de la petición no válido')
}

type Caller = {
  adminClient: ReturnType<typeof createClient>
  callerId: string
  callerRole: string
  schoolId: string | null
}

// Verifica el token y devuelve quién llama, con su rol y su escuela
async function getCaller(req: Request): Promise<Caller> {
  const url = Deno.env.get('SUPABASE_URL') ?? ''
  const serviceKey = getServiceRoleKey()
  debug('SUPABASE_URL', url ? 'ok' : 'falta', '| clave', serviceKey ? 'ok' : 'falta')

  if (!url || !serviceKey) {
    console.error('Configuración incompleta: falta SUPABASE_URL o la clave secreta')
    throw new HttpError(500, 'Error de configuración del servidor')
  }

  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!token) throw new HttpError(401, 'Sesión no válida')

  const adminClient = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { data: authData, error: authError } = await adminClient.auth.getUser(token)
  if (authError || !authData.user) {
    console.error('Fallo al verificar el token:', authError?.message)
    throw new HttpError(401, 'Sesión no válida')
  }
  debug('token verificado')

  const [{ data: profile, error: profileError }, { data: membership }] = await Promise.all([
    adminClient.from('profiles').select('role').eq('id', authData.user.id).single(),
    adminClient.from('school_profiles').select('school_id').eq('profile_id', authData.user.id).maybeSingle(),
  ])

  if (profileError) {
    console.error('Fallo al consultar profiles:', profileError.message)
    throw new HttpError(403, 'No tienes permisos para esta acción')
  }

  return {
    adminClient,
    callerId: authData.user.id,
    callerRole: profile?.role ?? '',
    schoolId: membership?.school_id ?? null,
  }
}

export async function requireAdmin(req: Request) {
  const caller = await getCaller(req)
  if (caller.callerRole !== 'admin') {
    console.warn('Acceso denegado: el usuario no es admin (rol:', caller.callerRole || 'ninguno', ')')
    throw new HttpError(403, 'Se requiere rol de administración')
  }
  return caller
}

// Admin (todas las escuelas) o supervisor (solo la suya)
export async function requireManager(req: Request) {
  const caller = await getCaller(req)
  if (caller.callerRole === 'admin') return caller
  if (caller.callerRole === 'supervisor' && caller.schoolId) return caller
  console.warn('Acceso denegado: ni admin ni supervisor con escuela (rol:', caller.callerRole || 'ninguno', ')')
  throw new HttpError(403, 'Se requiere rol de administración o supervisión')
}

// Un supervisor solo gestiona alumnos y profesores de su escuela
export async function assertCanManageProfile(caller: Caller, profileId: string) {
  if (caller.callerRole === 'admin') return
  const [{ data: target }, { data: membership }] = await Promise.all([
    caller.adminClient.from('profiles').select('role').eq('id', profileId).maybeSingle(),
    caller.adminClient.from('school_profiles').select('school_id').eq('profile_id', profileId).maybeSingle(),
  ])
  if (!target || !['alumno', 'profesor'].includes(target.role) || membership?.school_id !== caller.schoolId) {
    throw new HttpError(403, 'Solo puedes gestionar alumnos y profesores de tu escuela.')
  }
}

// Tras crear un usuario: si lo crea un supervisor, pertenece a su escuela
export async function attachToCallerSchool(caller: Caller, profileId: string) {
  if (caller.callerRole !== 'supervisor') return
  const { error } = await caller.adminClient
    .from('school_profiles')
    .upsert({ profile_id: profileId, school_id: caller.schoolId }, { onConflict: 'profile_id' })
  if (error) {
    console.error('No se pudo asignar la escuela:', error.message)
    throw new HttpError(500, 'No se pudo asignar la escuela al usuario.')
  }
}

export function handler(fn: (req: Request) => Promise<unknown>) {
  return async (req: Request) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
    try {
      if (req.method !== 'POST') throw new HttpError(405, 'Método no permitido')
      return json(await fn(req), 200)
    } catch (e) {
      if (e instanceof HttpError) {
        console.error(`Error HTTP ${e.status}:`, e.message)
        return json({ error: e.message }, e.status)
      }
      console.error('Error interno no controlado:', e)
      return json({ error: 'Error interno del servidor' }, 500)
    }
  }
}