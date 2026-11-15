import { useState } from 'react'
import { supabase } from '../lib/supabase.js'
import Icon from './Icon.jsx'
import { MAX_ROWS, downloadTemplate, parseUsersFile } from '../lib/importUsers.js'

const CHUNK_SIZE = 15

const inputClass = 'input w-auto'
const buttonClass = 'btn-primary'
const secondaryClass = 'btn-secondary'

async function getFunctionError(error, fallback) {
  try {
    const body = await error.context.json()
    if (body?.error) return body.error
  } catch {
    // sin cuerpo (error de red o de CORS)
  }
  return fallback
}

// `schools`: solo para el admin, que elige la escuela; el supervisor importa en la suya.
export default function ImportUsers({ schools, onBack, onImported }) {
  const [parsed, setParsed] = useState(null) // { fileName, rows }
  const [fileError, setFileError] = useState('')
  const [reading, setReading] = useState(false)
  const [role, setRole] = useState('alumno')
  const [schoolId, setSchoolId] = useState(schools?.length === 1 ? schools[0].id : '')
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
            school_id: schools ? schoolId : undefined,
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
    <div className="space-y-5">
      <button type="button" className="back-link" onClick={onBack} disabled={phase === 'running'}>← Perfiles</button>
      <div className="page-intro">
        <div>
          <h2>Importar usuarios</h2>
          <p>Crea muchos usuarios de una vez a partir de una plantilla de Excel.</p>
        </div>
      </div>

      {/* Instrucciones */}
      <div className="card p-5">
        <h3 className="mb-3 font-semibold text-ink">Cómo funciona</h3>
        <ol className="list-decimal space-y-1.5 pl-5 text-sm text-ink-soft marker:text-faint">
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
            <Icon name="download" size={16} />Descargar plantilla (.xlsx)
          </button>
        </div>
      </div>

      {/* Subida del archivo */}
      {phase === 'select' && (
        <div className="card p-5">
          <h3 className="mb-3 font-semibold text-ink">Subir archivo</h3>
          <input
            className="block w-full rounded-xl border border-dashed border-line-strong bg-subtle p-4 text-sm text-muted file:mr-4 file:rounded-lg file:border-0 file:bg-surface file:px-3 file:py-2 file:text-sm file:font-medium file:text-ink-soft"
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={handleFile}
            disabled={reading}
          />
          {reading && <p className="mt-2 text-sm text-muted">Leyendo el archivo…</p>}
          {fileError && <p role="alert" className="notice-error mt-3">{fileError}</p>}
        </div>
      )}

      {/* Vista previa y opciones */}
      {phase === 'select' && parsed && (
        <div className="space-y-4 card p-5">
          <div>
            <h3 className="font-semibold text-ink">Vista previa · {parsed.fileName}</h3>
            <p className="text-sm text-muted">
              {parsed.rows.length} filas · <span className="text-success">{validRows.length} válidas</span> ·{' '}
              <span className={invalidRows.length ? 'text-danger' : ''}>{invalidRows.length} con errores</span>
            </p>
          </div>

          <div className="max-h-96 overflow-auto rounded-xl border border-line">
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 bg-subtle text-xs text-muted">
                <tr>
                  {['Fila', 'Nombre', 'Email', 'Identificación', 'Nacimiento', 'Clase', 'Grupo', 'Promoción', 'Módulos', 'Teléfono', 'Estado'].map((h) => (
                    <th key={h} className="whitespace-nowrap p-2">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {parsed.rows.map((r) => (
                  <tr key={r.rowNumber} className={r.errors.length ? 'bg-danger-soft' : ''}>
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
                        <span className="text-danger">{r.errors.join(' ')}</span>
                      ) : (
                        <span className="text-success">OK</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-end gap-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-ink-soft">Rol de los usuarios</label>
              <select className={inputClass} value={role} onChange={(e) => setRole(e.target.value)}>
                <option value="alumno">Alumno</option>
                <option value="profesor">Profesor</option>
              </select>
            </div>
            {schools && (
              <div>
                <label className="mb-1.5 block text-sm font-medium text-ink-soft">Escuela</label>
                <select className={inputClass} value={schoolId} onChange={(e) => setSchoolId(e.target.value)}>
                  <option value="">Elige una escuela…</option>
                  {schools.map((school) => <option key={school.id} value={school.id}>{school.name}</option>)}
                </select>
              </div>
            )}
            <label className="flex items-center gap-2 text-sm text-ink">
              <input type="checkbox" checked={sendInvites} onChange={(e) => setSendInvites(e.target.checked)} />
              Enviar invitación por correo a cada usuario
            </label>
          </div>

          <div className="notice text-xs">
            El servicio de correo integrado de Supabase permite muy pocos envíos por hora. Para importaciones grandes
            configura un SMTP propio (Authentication → SMTP Settings) o desmarca la casilla: los usuarios se crearán
            sin enviar correo y podrán entrar con «¿Olvidaste tu contraseña?».
          </div>

          <div className="flex justify-end gap-2">
            <button className={secondaryClass} onClick={reset}>Cancelar</button>
            <button className={buttonClass} onClick={runImport} disabled={!validRows.length || (schools && !schoolId)}>
              Importar {validRows.length} usuarios
            </button>
          </div>
        </div>
      )}

      {/* Progreso */}
      {phase === 'running' && (
        <div className="card p-5">
          <h3 className="mb-3 font-semibold text-ink">Importando…</h3>
          <div className="h-1.5 overflow-hidden rounded-full bg-subtle">
            <div className="h-1.5 rounded-full bg-accent transition-[width] duration-300" style={{ width: `${percent}%` }} />
          </div>
          <p className="mt-2 text-sm text-muted">
            {progress.done} de {progress.total}. No cierres esta página hasta que termine.
          </p>
        </div>
      )}

      {/* Resultado */}
      {phase === 'done' && (
        <div className="space-y-4 card p-5">
          <h3 className="font-semibold text-ink">Importación terminada</h3>
          <p className="text-sm">
            <span className="text-success">{created.length} usuarios creados</span>
            {failed.length > 0 && <span className="text-danger"> · {failed.length} con errores</span>}
          </p>

          {failed.length > 0 && (
            <div className="max-h-80 overflow-auto rounded-xl border border-line">
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 bg-subtle text-xs text-muted">
                  <tr>
                    <th className="p-2">Fila</th>
                    <th className="p-2">Email</th>
                    <th className="p-2">Motivo</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {failed.map((r) => (
                    <tr key={r.row} className="bg-danger-soft">
                      <td className="p-2">{r.row}</td>
                      <td className="p-2">{r.email}</td>
                      <td className="p-2 text-danger">{r.error}</td>
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