import { handler, requireAdmin, readJson, HttpError } from '../_shared/utils.ts'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

Deno.serve(handler(async (req) => {
  const { adminClient, callerId } = await requireAdmin(req)
  const { user_id } = await readJson(req)

  if (typeof user_id !== 'string' || !UUID_RE.test(user_id)) {
    throw new HttpError(400, 'Datos no válidos.')
  }
  if (user_id === callerId) {
    throw new HttpError(400, 'No puedes eliminar tu propia cuenta.')
  }

  // Borra el usuario de Auth; su fila en profiles se elimina en cascada (FK on delete cascade)
  const { error } = await adminClient.auth.admin.deleteUser(user_id)
  if (error) {
    console.error(error)
    throw new HttpError(500, 'No se pudo eliminar el usuario.')
  }

  return { success: true }
}))