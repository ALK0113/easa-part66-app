import { createClient } from 'npm:@supabase/supabase-js@2.45.4'

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message)
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

function getServiceKey(): string {
  const direct = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (direct) return direct
  try {
    const keys = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}')
    return (Object.values(keys)[0] as string) ?? ''
  } catch {
    return ''
  }
}

export async function readJson(req: Request): Promise<Record<string, unknown>> {
  try {
    const body = await req.json()
    if (body && typeof body === 'object' && !Array.isArray(body)) return body
  } catch {
    // cae al error de abajo
  }
  throw new HttpError(400, 'Solicitud JSON no válida.')
}

// Verifica sesión y rol admin. Devuelve un cliente con service role.
export async function requireAdmin(req: Request) {
  const url = Deno.env.get('SUPABASE_URL') ?? ''
  const serviceKey = getServiceKey()
  if (!url || !serviceKey) throw new HttpError(500, 'Configuración de servidor incompleta.')

  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!token) throw new HttpError(401, 'Sesión requerida.')

  const adminClient = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { data: authData, error: authError } = await adminClient.auth.getUser(token)
  if (authError || !authData.user) throw new HttpError(401, 'Sesión no válida.')

  const { data: profile, error: profileError } = await adminClient
    .from('profiles')
    .select('role')
    .eq('id', authData.user.id)
    .single()

  if (profileError || profile?.role !== 'admin') {
    throw new HttpError(403, 'Se requiere rol de administración.')
  }

  return { adminClient, callerId: authData.user.id }
}

// Envuelve la lógica: CORS, método POST, errores controlados y respuesta JSON
export function handler(fn: (req: Request) => Promise<unknown>) {
  return async (req: Request) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
    try {
      if (req.method !== 'POST') throw new HttpError(405, 'Método no permitido.')
      return json(await fn(req), 200)
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message }, e.status)
      console.error(e)
      return json({ error: 'Error interno.' }, 500)
    }
  }
}