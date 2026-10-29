import { useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { MAX_ROWS, downloadTemplate, parseUsersFile } from '../lib/importUsers.js'

const CHUNK_SIZE = 15

const inputClass = 'rounded border border-[#d1d5db] px-3 py-2 text-sm focus:border-[#1e88e5]'
const buttonClass = 'rounded bg-[#1e88e5] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1565c0] disabled:opacity-50'
const secondaryClass = 'rounded border border-[#d1d5db] px-4 py-2 text-sm font-semibold text-[#0a2540] hover:bg-[#f4f6f9] disabled:opacity-50'

async function getFunctionError(error, fallback) {
  try {
    const body = await error.context.json()
    if (body?.error) return body.error
  } catch {
    // sin cuerpo (error de red o de CORS)
  }
  return fallback
}

export default function ImportUsers({ onBack, onImported }) {
  const [parsed, setParsed] = useState(null) // { fileName, rows }
  const [fileError, setFileError] = useState('')
  const [reading, setReading] = useState(false)
  const [role, setRole] = useState('alumno')
  const [sendInvites, setSendInvites] = useState(true)
  const [phase, setPhase] = useState('select') // select | running | done
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [results, setResults] = useState([])

  const validRows = parsed ? parsed.rows.filter((r) => r.errors.length === 0) : []
  const invalidRows = parsed ? parsed.rows.filter((r) => r.errors.length > 0) : []
  const created = results.filter((r) => r.ok)
  const failed = results.filter((r) => !r.ok)
  const percent = progress.total ? Math.round((progress.done / progress.total) * 100) : 0

  async function handleTemplate() {
    try {
      await downloadTemplate()
    } catch (err) {
      console.error(err)
      setFileError('No se pudo generar la plantilla.')
    }
  }

  async function handleFile(event) {
    const file = event.target.files?.[0]
    event.target.value = '' // permite volver a elegir el mismo archivo
    if (!file) return

    setFileError('')
    setParsed(null)
    setReading(true)
    try {
      const rows = await parseUsersFile(file)
      setParsed({ fileName: file.name, rows })
    } catch (err) {
      setFileError(err.message)
    } finally {
      setReading(false)
    }
  }

  function reset() {
    setParsed(null)
    setResults([])
    setProgress({ done: 0, total: 0 })
    setPhase('select')
  }

  async function runImport() {
    if (!validRows.length) return
    const confirmed = window.confirm(
      `Se van a crear ${validRows.length} usuarios con rol "${role}"` +
        (sendInvites ? ' y se enviará una invitación por correo a cada uno.' : ', sin enviar correos.') +
        '\n\n¿Continuar?'
    )
    if (!confirmed) return

    const emailByRow = new Map(validRows.map((r) => [r.rowNumber, r.data.email]))
    const all = []
    let aborted = false

    setPhase('running')
    setResults([])
    setProgress({ done: 0, total: validRows.length })

    for (let i = 0; i < validRows.length; i += CHUNK_SIZE) {
      const chunk = validRows.slice(i, i + CHUNK_SIZE)

      if (aborted) {
        chunk.forEach((r) =>
          all.push({ row: r.rowNumber, email: r.data.email, ok: false, error: 'No procesado: la importación se detuvo.' })
        )
      } else {
        const { data, error } = await supabase.functions.invoke('admin-import-users', {
          body: {
            role,
            send_invites: sendInvites,
            rows: chunk.map((r) => ({ row: r.rowNumber, ...r.data })),
          },
        })

        if (error) {
          const message = await getFunctionError(error, 'Error de comunicación con el servidor.')
          chunk.forEach((r) => all.push({ row: r.rowNumber, email: r.data.email, ok: false, error: message }))
          const status = error.context?.status
          if (status === 401 || status === 403) aborted = true // sesión caducada o sin permisos
        } else {
          for (const res of data?.results ?? []) {
            all.push({ ...res, email: emailByRow.get(res.row) })
          }
        }
      }

      setProgress({ done: Math.min(i + CHUNK_SIZE, validRows.length), total: validRows.length })
      setResults([...all])
    }

    setPhase('done')
    onImported?.()
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-[#0a2540]">Importar usuarios desde Excel</h2>
          <p className="text-sm text-[#6b7280]">Crea muchos usuarios de una vez con una plantilla.</p>
        </div>
        <button className={secondaryClass} onClick={onBack} disabled={phase === 'running'}>
          ← Volver
        </button>
      </div>

      {/* Instrucciones */}
      <div className="rounded-lg border border-[#e5e7eb] bg-white p-5">
        <h3 className="mb-2 text-base font-bold text-[#0a2540]">Instrucciones</h3>
        <ol className="list-decimal space-y-1 pl-5 text-sm text-[#374151]">
          <li>Descarga la plantilla y ábrela con Excel.</li>
          <li>
            Rellena una fila por usuario en la hoja «Usuarios» (máximo {MAX_ROWS}). Los encabezados en rojo son
            obligatorios: <strong>Nombre</strong> y <strong>Email</strong>.
          </li>
          <li>
            Fecha de nacimiento con formato <strong>dd/mm/aaaa</strong>. Si hay varios módulos, sepáralos con punto y
            coma (;).
          </li>
          <li>No cambies ni borres los encabezados. Guarda el archivo como .xlsx.</li>
          <li>Súbelo aquí, revisa la vista previa y confirma. Las filas con errores no se importan.</li>
        </ol>
        <div className="mt-4">
          <button className={secondaryClass} onClick={handleTemplate}>
            ⬇️ Descargar plantilla (.xlsx)
          </button>
        </div>
      </div>

      {/* Subida del archivo */}
      {phase === 'select' && (
        <div className="rounded-lg border border-[#e5e7eb] bg-white p-5">
          <h3 className="mb-2 text-base font-bold text-[#0a2540]">Subir archivo</h3>
          <input
            className={`${inputClass} w-full`}
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={handleFile}
            disabled={reading}
          />
          {reading && <p className="mt-2 text-sm text-[#6b7280]">Leyendo el archivo...</p>}
          {fileError && <div className="mt-3 rounded bg-red-50 p-3 text-sm text-red-800">{fileError}</div>}
        </div>
      )}

      {/* Vista previa y opciones */}
      {phase === 'select' && parsed && (
        <div className="space-y-4 rounded-lg border border-[#e5e7eb] bg-white p-5">
          <div>
            <h3 className="text-base font-bold text-[#0a2540]">Vista previa: {parsed.fileName}</h3>
            <p className="text-sm text-[#6b7280]">
              {parsed.rows.length} filas · <span className="text-green-700">{validRows.length} válidas</span> ·{' '}
              <span className={invalidRows.length ? 'text-red-700' : ''}>{invalidRows.length} con errores</span>
            </p>
          </div>

          <div className="max-h-96 overflow-auto rounded border border-[#e5e7eb]">
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 bg-[#0a2540] text-white">
                <tr>
                  {['Fila', 'Nombre', 'Email', 'Identificación', 'Nacimiento', 'Clase', 'Grupo', 'Promoción', 'Módulos', 'Teléfono', 'Estado'].map((h) => (
                    <th key={h} className="whitespace-nowrap p-2">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[#e5e7eb]">
                {parsed.rows.map((r) => (
                  <tr key={r.rowNumber} className={r.errors.length ? 'bg-red-50' : ''}>
                    <td className="p-2">{r.rowNumber}</td>
                    <td className="p-2">{r.data.full_name}</td>
                    <td className="p-2">{r.data.email}</td>
                    <td className="p-2">{r.data.identification}</td>
                    <td className="p-2">{r.data.birth_date}</td>
                    <td className="p-2">{r.data.class_name}</td>
                    <td className="p-2">{r.data.group_name}</td>
                    <td className="p-2">{r.data.promo}</td>
                    <td className="p-2">{r.data.modules.join('; ')}</td>
                    <td className="p-2">{r.data.phone}</td>
                    <td className="p-2">
                      {r.errors.length ? (
                        <span className="text-red-700">{r.errors.join(' ')}</span>
                      ) : (
                        <span className="text-green-700">OK</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-end gap-4">
            <div>
              <label className="mb-1 block text-sm font-semibold text-[#0a2540]">Rol de los usuarios</label>
              <select className={inputClass} value={role} onChange={(e) => setRole(e.target.value)}>
                <option value="alumno">Alumno</option>
                <option value="profesor">Profesor</option>
              </select>
            </div>
            <label className="flex items-center gap-2 text-sm text-[#0a2540]">
              <input type="checkbox" checked={sendInvites} onChange={(e) => setSendInvites(e.target.checked)} />
              Enviar invitación por correo a cada usuario
            </label>
          </div>

          <div className="rounded bg-amber-50 p-3 text-xs text-amber-800">
            El servicio de correo integrado de Supabase permite muy pocos envíos por hora. Para importaciones grandes
            configura un SMTP propio (Authentication → SMTP Settings) o desmarca la casilla: los usuarios se crearán
            sin enviar correo y podrán entrar con «¿Olvidaste tu contraseña?».
          </div>

          <div className="flex justify-end gap-2">
            <button className={secondaryClass} onClick={reset}>Cancelar</button>
            <button className={buttonClass} onClick={runImport} disabled={!validRows.length}>
              Importar {validRows.length} usuarios
            </button>
          </div>
        </div>
      )}

      {/* Progreso */}
      {phase === 'running' && (
        <div className="rounded-lg border border-[#e5e7eb] bg-white p-5">
          <h3 className="mb-2 text-base font-bold text-[#0a2540]">Importando...</h3>
          <div className="h-2 rounded bg-[#e5e7eb]">
            <div className="h-2 rounded bg-[#1e88e5]" style={{ width: `${percent}%` }} />
          </div>
          <p className="mt-2 text-sm text-[#6b7280]">
            {progress.done} de {progress.total}. No cierres esta página hasta que termine.
          </p>
        </div>
      )}

      {/* Resultado */}
      {phase === 'done' && (
        <div className="space-y-4 rounded-lg border border-[#e5e7eb] bg-white p-5">
          <h3 className="text-base font-bold text-[#0a2540]">Importación terminada</h3>
          <p className="text-sm">
            <span className="text-green-700">✅ {created.length} usuarios creados</span>
            {failed.length > 0 && <span className="text-red-700"> · ❌ {failed.length} con errores</span>}
          </p>

          {failed.length > 0 && (
            <div className="max-h-80 overflow-auto rounded border border-[#e5e7eb]">
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 bg-[#0a2540] text-white">
                  <tr>
                    <th className="p-2">Fila</th>
                    <th className="p-2">Email</th>
                    <th className="p-2">Motivo</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#e5e7eb]">
                  {failed.map((r) => (
                    <tr key={r.row} className="bg-red-50">
                      <td className="p-2">{r.row}</td>
                      <td className="p-2">{r.email}</td>
                      <td className="p-2 text-red-700">{r.error}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="flex justify-end gap-2">
            <button className={secondaryClass} onClick={reset}>Importar otro archivo</button>
            <button className={buttonClass} onClick={onBack}>Volver a perfiles</button>
          </div>
        </div>
      )}
    </div>
  )
}