// Estructura de un módulo: submódulos EASA (11.1, 11.2…) y RA oficiales de los módulos profesionales
// (MP) que usa. Importación del currículum (MP + RA) y de submódulos desde CSV, JSON o tabla pegada.
import { useEffect, useState } from 'react'
import { supabase } from './supabase.js'
import { useSchool } from '../contexts/useSchool.js'
import { norm, parseTabularText, readTabularFile } from './tabularFile.js'
import { downloadCsv } from './download.js'

// «1440 · RA6»
export const outcomeLabel = (outcome) => (outcome ? `${outcome.mpCode} · RA${outcome.number}` : '')

// Submódulos y RA disponibles para un módulo EASA de la escuela actual
export function useModuleStructure(moduleId) {
  const { schoolId } = useSchool()
  const [state, setState] = useState({ submodules: [], outcomes: [], loaded: false })
  const [version, setVersion] = useState(0)
  useEffect(() => {
    if (!moduleId) return undefined
    let active = true
    async function load() {
      let subs = supabase.from('submodules').select('id,code,name,position,school_id').eq('module_id', moduleId).order('position').order('code')
      let links = supabase.from('module_professional_modules').select('professional_modules(id,code,name,learning_outcomes(id,number,description))').eq('module_id', moduleId)
      if (schoolId) { subs = subs.eq('school_id', schoolId); links = links.eq('school_id', schoolId) }
      const [subResult, linkResult] = await Promise.all([subs, links])
      if (!active) return
      const outcomes = (linkResult.data || []).flatMap((row) => (row.professional_modules?.learning_outcomes || []).map((ra) => ({
        id: ra.id, number: ra.number, description: ra.description, mpCode: row.professional_modules.code, mpName: row.professional_modules.name,
      }))).sort((a, b) => a.mpCode.localeCompare(b.mpCode) || a.number - b.number)
      setState({ submodules: subResult.data || [], outcomes, loaded: true })
    }
    load()
    return () => { active = false }
  }, [moduleId, schoolId, version])
  return { ...state, schoolId, reload: () => setVersion((value) => value + 1) }
}

// Orden natural de submódulos: 11.2 antes que 11.10
export const compareCodes = (a, b) => String(a).localeCompare(String(b), 'es', { numeric: true })

/* ----------------------------- Importación ----------------------------- */

const curriculumKey = (header) => {
  const h = norm(header).replace(/\(.*?\)/g, '').replace(/[_.º-]/g, ' ').replace(/\s+/g, ' ').trim()
  if (['mp', 'codigo mp', 'modulo profesional', 'codigo modulo', 'codigo', 'modulo'].includes(h)) return 'mp'
  if (['nombre mp', 'nombre modulo', 'nombre modulo profesional', 'denominacion', 'nombre'].includes(h)) return 'mpName'
  if (['ra', 'numero ra', 'n ra', 'resultado', 'num ra'].includes(h)) return 'ra'
  if (['descripcion ra', 'descripcion', 'resultado de aprendizaje', 'resultados de aprendizaje', 'texto ra'].includes(h)) return 'description'
  return null
}

const submoduleKey = (header) => {
  const h = norm(header).replace(/\(.*?\)/g, '').replace(/[_.º-]/g, ' ').replace(/\s+/g, ' ').trim()
  if (['modulo', 'module', 'modulo easa'].includes(h)) return 'module'
  if (['submodulo', 'codigo', 'code', 'submodule', 'codigo submodulo'].includes(h)) return 'code'
  if (['nombre', 'name', 'denominacion', 'titulo'].includes(h)) return 'name'
  return null
}

const OPTIONS = { maxRows: 2000, listKeys: ['ra', 'resultados', 'curriculum', 'submodulos', 'rows'] }
export const readCurriculum = (source) => (typeof source === 'string' ? parseTabularText(source, curriculumKey, OPTIONS) : readTabularFile(source, curriculumKey, OPTIONS))
export const readSubmodules = (source) => (typeof source === 'string' ? parseTabularText(source, submoduleKey, OPTIONS) : readTabularFile(source, submoduleKey, OPTIONS))

// «RA6», «6», «RA 6» -> 6
const parseRaNumber = (value) => {
  const match = String(value ?? '').match(/(\d+)/)
  return match ? Number(match[1]) : null
}

// Filas -> MP con sus RA (o errores por fila)
export function buildCurriculumPlan(raw) {
  const mps = new Map()
  const errors = []
  let lastMp = null
  raw.forEach((row, index) => {
    const line = index + 2
    // En una tabla agrupada el código del MP puede venir solo en la primera fila
    const code = String(row.mp ?? '').trim() || lastMp?.code || ''
    const name = String(row.mpName ?? '').trim()
    const number = parseRaNumber(row.ra)
    const description = String(row.description ?? '').trim()
    if (!code) { errors.push({ line, text: 'Falta el código del módulo profesional' }); return }
    if (!mps.has(code)) mps.set(code, { code, name: name || code, outcomes: new Map() })
    const mp = mps.get(code)
    if (name && mp.name === code) mp.name = name
    lastMp = mp
    if (!String(row.ra ?? '').trim() && !description) return
    if (!number || number < 1 || number > 50) { errors.push({ line, text: `RA no válido en ${code}` }); return }
    if (!description) { errors.push({ line, text: `${code} RA${number}: falta la descripción` }); return }
    mp.outcomes.set(number, description.slice(0, 1000))
  })
  return { mps: [...mps.values()].map((mp) => ({ ...mp, outcomes: [...mp.outcomes.entries()].map(([number, description]) => ({ number, description })) })), errors }
}

// Filas -> submódulos por módulo. modules: módulos del grado (ids)
export function buildSubmodulesPlan(raw, moduleIds) {
  const known = new Map(moduleIds.map((id) => [String(id).toUpperCase(), id]))
  const items = []
  const errors = []
  raw.forEach((row, index) => {
    const line = index + 2
    const code = String(row.code ?? '').trim()
    // El módulo puede venir en su columna o deducirse del código (11.3 -> M11)
    let moduleText = String(row.module ?? '').trim().toUpperCase().replace(/^M(\d)(?!\d)/, 'M0$1')
    if (!moduleText && /^\d+(\.|$)/.test(code)) moduleText = `M${code.split('.')[0].padStart(2, '0')}`
    const moduleId = known.get(moduleText)
    const name = String(row.name ?? '').trim()
    if (!code) errors.push({ line, text: 'Falta el código del submódulo' })
    else if (!moduleId) errors.push({ line, text: `El módulo ${moduleText || '?'} no está en el grado` })
    else if (!name) errors.push({ line, text: `${code}: falta el nombre` })
    else items.push({ moduleId, code, name: name.slice(0, 200) })
  })
  return { items, errors }
}

export function downloadCurriculumTemplate() {
  downloadCsv([
    ['MP', 'Nombre MP', 'RA', 'Descripción RA'],
    ['1440', 'Sistemas de aeronaves', 'RA1', 'Describe el funcionamiento de …'],
    ['1440', 'Sistemas de aeronaves', 'RA2', 'Realiza operaciones de mantenimiento de …'],
  ], 'plantilla-ra.csv')
}

export function downloadSubmodulesTemplate() {
  downloadCsv([
    ['Módulo', 'Submódulo', 'Nombre'],
    ['M11', '11.1', 'Teoría de vuelo'],
    ['M11', '11.2', 'Estructuras de la célula — conceptos generales'],
  ], 'plantilla-submodulos.csv')
}
