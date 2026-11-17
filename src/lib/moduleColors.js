// Color de cada módulo: se guarda como número (1-18) en modules.color y es del módulo, no del curso,
// así que se mantiene de un curso a otro. Los módulos nuevos reciben uno al azar (por defecto en la BD).
export const MODULE_COLORS = [
  '#2563eb', '#16a34a', '#dc2626', '#9333ea', '#ea580c', '#0891b2',
  '#ca8a04', '#db2777', '#4f46e5', '#059669', '#b45309', '#7c3aed',
  '#0d9488', '#e11d48', '#65a30d', '#0284c7', '#c026d3', '#57534e',
]
const NEUTRAL = '#a8a29e'

export const moduleColor = (index) => (Number.isInteger(Number(index)) && Number(index) >= 1 ? MODULE_COLORS[(Number(index) - 1) % MODULE_COLORS.length] : NEUTRAL)
export const randomModuleColor = () => 1 + Math.floor(Math.random() * MODULE_COLORS.length)
