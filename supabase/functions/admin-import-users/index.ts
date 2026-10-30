import { handler, requireAdmin, readJson, HttpError } from '../_shared/utils.ts'

const MAX_ROWS_PER_REQUEST = 25
const ALLOWED_ROLES = ['alumno', 'profesor', 'supervisor'] // nunca admin
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const PHONE_RE = /^[+0-9 ()\-.]{6,20}$/
const ID_RE = /^[A-Za-z0-9 .\-/]{3,30}$/

class RowError extends Error {}

type RowResult = { row: number; ok: boolean; user_id?: string; error?: string }

const str = (v: unknown) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '')

const normalizeText = (s: string) =>
  s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim().toUpperCase()

// "M1" → "M01", "m7a" → "M07A"
function normalizeModuleId(s: string): string {
  const key = s.replace(/\s+/g, '').toUpperCase()
  const m = key.match(/^M0?(\d{1,2})([A-Z]?)$/)
  return m ? `M${m[1].padStart(2, '0')}${m[2]}` : key
}

function normalizeClass(v: string): string {
  if (!v) return ''
  const m = v.match(/^([1-9]\d?)\s*[ºo°ª]?$/i)
  if (!m) throw new RowError('Clase no válida (usa 1º, 2º, 3º...).')
  return `${m[1]}º`
}

function normalizeGroup(v: string): string {
  if (!v) return ''
  if (!/^[A-Za-z]$/.test(v)) throw new RowError('Grupo no válido (usa una letra: A, B, C...).')
  return v.toUpperCase()
}

function validBirthDate(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) {
    throw new RowError('Fecha de nacimiento no válida.')
  }
  const [y, m, d] = v.split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1, d))
  if (
    date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d ||
    y < 1900 || date > new Date()
  ) {
    throw new RowError('Fecha de nacimiento fuera de rango.')
  }
  return v
}

function cleanRow(r: Record<string, unknown>, role: string) {
  const full_name = str(r.full_name)
  const email = str(r.email).toLowerCase()
  const phone = str(r.phone)

  if (!full_name || full_name.length > 100) throw new RowError('Nombre no válido.')
  if (email.length > 254 || !EMAIL_RE.test(email)) throw new RowError('Email no válido.')
  if (phone && !PHONE_RE.test(phone)) throw new RowError('Teléfono no válido.')

  const rawModules = Array.isArray(r.modules) ? r.modules : []
  if (rawModules.length > 30 || rawModules.some((m) => typeof m !== 'string' || m.length > 80)) {
    throw new RowError('Lista de módulos no válida.')
  }
  const modules = rawModules.map((m) => str(m)).filter(Boolean)

  // Los datos académicos solo se usan para alumnos
  let class_name = ''
  let group_name = ''
  let promo = ''
  let identification = ''
  let birth_date: string | null = null

  if (role === 'alumno') {
    class_name = normalizeClass(str(r.class_name))
    const letter = normalizeGroup(str(r.group_name))
    if (letter && !class_name) throw new RowError('Para indicar el Grupo hay que indicar también la Clase.')
    group_name = letter ? `${class_name}${letter}` : '' // convención de la app: "2ºA"
    promo = str(r.promo)
    if (promo.length > 50) throw new RowError('Promoción demasiado larga (máximo 50).')
    identification = str(r.identification).toUpperCase()
    if (identification && !ID_RE.test(identification)) throw new RowError('Identificación no válida.')
    birth_date = validBirthDate(r.birth_date)
  }

  return { full_name, email, phone, modules, class_name, group_name, promo, identification, birth_date }
}

Deno.serve(handler(async (req) => {
  // 1. Autorización primero
  const { adminClient } = await requireAdmin(req)
  const body = await readJson(req)

  // 2. Validación de la petición
  const role = body.role
  if (typeof role !== 'string' || !ALLOWED_ROLES.includes(role)) {
    throw new HttpError(400, 'Rol no válido.')
  }
  const sendInvites = body.send_invites === true
  const rows = body.rows
  if (!Array.isArray(rows) || rows.length === 0 || rows.length > MAX_ROWS_PER_REQUEST) {
    throw new HttpError(400, `Se admiten entre 1 y ${MAX_ROWS_PER_REQUEST} filas por petición.`)
  }

  // 3. Módulos existentes (para traducir "M1" o "Mathematics" a su id)
  const { data: modules, error: modulesError } = await adminClient.from('modules').select('id, name')
  if (modulesError) {
    console.error(modulesError)
    throw new HttpError(500, 'No se pudieron leer los módulos.')
  }
  const byId = new Map<string, string>()
  const byName = new Map<string, string>()
  for (const m of modules ?? []) {
    byId.set(normalizeModuleId(m.id), m.id)
    byName.set(normalizeText(m.name), m.id)
  }

  const siteUrl = Deno.env.get('SITE_URL') || undefined
  let mailBlocked = false

  const processRow = async (raw: unknown): Promise<RowResult> => {
    const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
    const rowNumber = Number.isInteger(r.row) ? (r.row as number) : 0
    let userId: string | null = null

    try {
      const data = cleanRow(r, role)

      const moduleIds: string[] = []
      for (const name of data.modules) {
        const id = byId.get(normalizeModuleId(name)) ?? byName.get(normalizeText(name))
        if (!id) throw new RowError(`Módulo no reconocido: ${name}.`)
        if (!moduleIds.includes(id)) moduleIds.push(id)
      }

      if (sendInvites && mailBlocked) {
        throw new RowError('No procesado: se alcanzó el límite de correos de Supabase.')
      }

      // Crear el usuario (con invitación por correo o sin ella)
      const { data: created, error: createError } = sendInvites
        ? await adminClient.auth.admin.inviteUserByEmail(data.email, {
            data: { full_name: data.full_name },
            redirectTo: siteUrl,
          })
        : await adminClient.auth.admin.createUser({
            email: data.email,
            email_confirm: true,
            user_metadata: { full_name: data.full_name },
          })

      if (createError || !created.user) {
        const e = createError as { code?: string; status?: number; message?: string } | null
        if (e?.code === 'over_email_send_rate_limit' || e?.status === 429) {
          mailBlocked = true
          throw new RowError('Límite de correos alcanzado. Configura un SMTP propio o importa sin invitaciones.')
        }
        if (e?.code === 'email_exists' || /already.*registered/i.test(e?.message ?? '')) {
          throw new RowError('Ya existe un usuario con ese email.')
        }
        console.error('Error creando usuario:', createError)
        throw new RowError('No se pudo crear el usuario.')
      }
      const uid = created.user.id
      userId = uid

      // Perfil con su rol
      const { error: profileError } = await adminClient.from('profiles').upsert({
        id: uid,
        email: data.email,
        full_name: data.full_name,
        phone: data.phone || null,
        role,
      })
      if (profileError) {
        console.error(profileError)
        throw new RowError('No se pudo guardar el perfil.')
      }

      if (role === 'alumno') {
        // Ficha, datos privados, vínculo y módulos, todo en una sola transacción
        const { error: studentError } = await adminClient.rpc('admin_import_student', {
          p_profile_id: uid,
          p_student: {
            name: data.full_name,
            class_name: data.class_name,
            group_name: data.group_name,
            promo: data.promo,
            birth_date: data.birth_date,
            identification: data.identification,
          },
          p_module_ids: moduleIds,
        })
        if (studentError) {
          console.error(studentError)
          if (studentError.code === '23505') {
            throw new RowError('Ya existe un alumno con esa identificación o número.')
          }
          if (studentError.code === '23503' || studentError.code === '22023') {
            throw new RowError(studentError.message)
          }
          throw new RowError('No se pudo crear la ficha del alumno.')
        }
      } else if (moduleIds.length > 0) {
        // Profesor: sus módulos van a teacher_modules
        const { error: tmError } = await adminClient
          .from('teacher_modules')
          .insert(moduleIds.map((module_id) => ({ profile_id: uid, module_id })))
        if (tmError) {
          console.error(tmError)
          throw new RowError('No se pudieron asignar los módulos.')
        }
      }

      return { row: rowNumber, ok: true, user_id: uid }
    } catch (e) {
      // Si algo falló después de crear el usuario, se deshace
      if (userId) {
        await adminClient.auth.admin.deleteUser(userId).catch((err) => console.error('Rollback fallido:', err))
      }
      if (e instanceof RowError) return { row: rowNumber, ok: false, error: e.message }
      console.error(e)
      return { row: rowNumber, ok: false, error: 'Error interno.' }
    }
  }

  const results: RowResult[] = []
  for (const raw of rows) results.push(await processRow(raw))
  return { results }
}))