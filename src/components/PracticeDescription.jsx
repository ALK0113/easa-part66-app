import Icon from './Icon.jsx'
import { parseObjectives } from '../lib/format.js'

// Descripción y objetivos de una práctica, tal como los escribe el profesor. Los ven profesorado y alumnos.
export default function PracticeDescription({ practice }) {
  const objectives = parseObjectives(practice.objectives)
  if (!practice.description && objectives.length === 0) return null
  return (
    <section className="card grid gap-5 p-6 md:grid-cols-2">
      {practice.description && (
        <div>
          <h3 className="mb-2 text-sm font-semibold text-ink">Descripción</h3>
          <p className="whitespace-pre-line text-sm leading-relaxed text-ink-soft">{practice.description}</p>
        </div>
      )}
      {objectives.length > 0 && (
        <div>
          <h3 className="mb-2 text-sm font-semibold text-ink">Objetivos</h3>
          <ul className="space-y-2 text-sm text-ink-soft">
            {objectives.map((objective, index) => (
              <li key={index} className="flex gap-2.5">
                <Icon name="check" size={16} className="mt-0.5 shrink-0 text-accent" />
                <span>{objective}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}
