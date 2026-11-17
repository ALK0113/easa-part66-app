// Color de cada módulo: se guarda como número (1-24) en modules.color y es del módulo, no del curso,
// así que se mantiene de un curso a otro. Paleta tranquila: los 18 primeros separados 20° de tono y alternando
// claro y oscuro (ordenados para que módulos seguidos queden lejos); los 6 últimos, tonos neutros.
// La base de datos da a cada módulo nuevo un color que no use otro módulo del catálogo ni de su escuela.
export const MODULE_COLORS = [
  '#ab483f', '#8cd175', '#3f7eab', '#d175c9', '#ab903f', '#75d19c',
  '#483fab', '#d1758c', '#7eab3f', '#75c9d1', '#903fab', '#d19c75',
  '#3fab48', '#758cd1', '#ab3f7e', '#c9d175', '#3fab90', '#9c75d1',
  '#64748b', '#8b6b55', '#b5a17f', '#475569', '#a3867a', '#7c8a72',
]
const NEUTRAL = '#d6d3d1'

export const moduleColor = (index) => (Number.isInteger(Number(index)) && Number(index) >= 1 ? MODULE_COLORS[(Number(index) - 1) % MODULE_COLORS.length] : NEUTRAL)

// Primer color libre (al azar entre los libres) dados los colores ya usados
export function freeModuleColor(used) {
  const free = MODULE_COLORS.map((_, index) => index + 1).filter((value) => !used.has(value))
  return free.length ? free[Math.floor(Math.random() * free.length)] : null
}

// Variables de estilo de un elemento con el color de su módulo (líneas laterales y tinte al pasar el cursor)
export const moduleStyle = (index, { sides = true } = {}) => {
  const color = moduleColor(index)
  return sides ? { '--module': color, borderLeftColor: color, borderRightColor: color } : { '--module': color }
}

// Al pasar el cursor (o con el teclado), un pastel muy suave del color del módulo, con transición tranquila
export const MODULE_HOVER = 'transition-colors duration-300 ease-out hover:bg-[color-mix(in_srgb,var(--module)_10%,var(--surface))] focus-visible:bg-[color-mix(in_srgb,var(--module)_10%,var(--surface))]'
export const MODULE_HOVER_ENABLED = 'transition-colors duration-300 ease-out enabled:hover:bg-[color-mix(in_srgb,var(--module)_10%,var(--surface))] enabled:focus-visible:bg-[color-mix(in_srgb,var(--module)_10%,var(--surface))]'
