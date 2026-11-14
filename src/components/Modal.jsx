import { useEffect } from 'react'
import Icon from './Icon.jsx'

// Diálogo común: hoja inferior en móvil, ventana centrada en escritorio. Se cierra con Esc.
export default function Modal({ title, onClose, children, wide = false }) {
  useEffect(() => {
    function onKeyDown(event) { if (event.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/25 backdrop-blur-[2px] sm:items-center sm:p-4"
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`fade-in max-h-[92vh] w-full overflow-y-auto rounded-t-2xl bg-surface shadow-lift sm:rounded-2xl ${wide ? 'max-w-2xl' : 'max-w-xl'}`}
      >
        <header className="flex items-center justify-between px-6 pb-2 pt-5">
          <h2 className="text-lg font-semibold text-ink">{title}</h2>
          <button type="button" className="-mr-2 rounded-lg p-2 text-muted hover:bg-subtle hover:text-ink" aria-label="Cerrar" onClick={onClose}>
            <Icon name="x" />
          </button>
        </header>
        <div className="px-6 pb-6 pt-2">{children}</div>
      </section>
    </div>
  )
}
