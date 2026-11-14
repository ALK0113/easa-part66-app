// Etiquetas comunes de la estructura académica.
export const levelLabel = (level) => (level ? `${level}º` : 'Sin curso')
export const groupLabel = (group) => (group ? `${group.level}º${group.name}` : '—')
export const KIND_LABEL = { teoria: 'Teoría', practica: 'Práctica' }
