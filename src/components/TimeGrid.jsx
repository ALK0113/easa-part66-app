import { useMemo, useRef, useState } from 'react'

// Rejilla semanal por horas (columnas = días, filas = horas) con arrastre para mover clases.
// El arrastre usa pointer events: funciona con ratón y en tablet. Un toque sin mover abre la clase.
//
// items: [{ id, day (0 = lunes), start: 'HH:MM', end: 'HH:MM', ... }]
// days: [{ key, label, sublabel?, highlight?, note? }] (una columna por día)
// renderItem(item) → contenido del bloque · canDrag(item) → boolean
// conflicts: Map(id → [texto]) para marcar en rojo · onOpen(item) · onMove(item, day, start, end)
// Las horas sin ninguna clase en toda la semana se pliegan en una banda fina; al tocarla se despliega.

const SNAP = 5 // minutos
const HOUR_HEIGHT = 56 // px
const COLLAPSED_HEIGHT = 22 // px de una franja plegada
const toMinutes = (value) => { const [h, m] = String(value).slice(0, 5).split(':').map(Number); return h * 60 + m }
const toTime = (minutes) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`

// Bloques solapados del mismo día, lado a lado
function layoutDay(items) {
  const sorted = [...items].sort((a, b) => toMinutes(a.start) - toMinutes(b.start) || toMinutes(b.end) - toMinutes(a.end))
  const placed = []
  let cluster = []
  let clusterEnd = -1
  const flush = () => {
    const columns = []
    cluster.forEach((item) => {
      let column = columns.findIndex((end) => end <= toMinutes(item.start))
      if (column === -1) { column = columns.length; columns.push(0) }
      columns[column] = toMinutes(item.end)
      placed.push({ item, column })
    })
    const total = columns.length
    placed.slice(placed.length - cluster.length).forEach((entry) => { entry.total = total })
    cluster = []
  }
  sorted.forEach((item) => {
    if (cluster.length && toMinutes(item.start) >= clusterEnd) flush()
    cluster.push(item)
    clusterEnd = Math.max(clusterEnd, toMinutes(item.end))
  })
  if (cluster.length) flush()
  return placed
}

export default function TimeGrid({ items, days, renderItem, canDrag = () => false, conflicts = new Map(), onOpen, onMove, ghostItems = [] }) {
  const gridRef = useRef(null)
  const [drag, setDrag] = useState(null)
  const [expanded, setExpanded] = useState(() => new Set())

  // Rango de horas: el de las clases, como mínimo 8:00-15:00
  const [startHour, endHour] = useMemo(() => {
    const all = [...items, ...ghostItems]
    const min = Math.min(8 * 60, ...all.map((item) => toMinutes(item.start)))
    const max = Math.max(15 * 60, ...all.map((item) => toMinutes(item.end)))
    return [Math.floor(min / 60), Math.ceil(max / 60)]
  }, [items, ghostItems])

  // Filas por hora; las horas seguidas sin clases forman una franja plegada (salvo que se haya desplegado)
  const rows = useMemo(() => {
    const all = [...items, ...ghostItems]
    const busy = (hour) => all.some((item) => toMinutes(item.start) < (hour + 1) * 60 && toMinutes(item.end) > hour * 60)
    const list = []
    let hour = startHour
    while (hour < endHour) {
      if (busy(hour)) { list.push({ from: hour * 60, to: (hour + 1) * 60, px: HOUR_HEIGHT }); hour += 1; continue }
      let end = hour
      while (end < endHour && !busy(end)) end += 1
      const run = `${hour}-${end}`
      if (expanded.has(run)) {
        for (let h = hour; h < end; h += 1) list.push({ from: h * 60, to: (h + 1) * 60, px: HOUR_HEIGHT, run, runStart: h === hour })
      } else {
        list.push({ from: hour * 60, to: end * 60, px: COLLAPSED_HEIGHT, run, collapsed: true })
      }
      hour = end
    }
    let y = 0
    return list.map((row) => { const placed = { ...row, y }; y += row.px; return placed })
  }, [items, ghostItems, startHour, endHour, expanded])
  const height = rows.reduce((sum, row) => sum + row.px, 0)
  const top = (minutes) => {
    if (!rows.length || minutes <= rows[0].from) return 0
    const row = rows.find((item) => minutes >= item.from && minutes < item.to)
    if (!row) return height
    return row.y + ((minutes - row.from) / (row.to - row.from)) * row.px
  }
  const minutesAt = (y) => {
    const row = rows.find((item) => y >= item.y && y < item.y + item.px) || (y < 0 ? rows[0] : rows.at(-1))
    if (!row) return startHour * 60
    const ratio = Math.min(1, Math.max(0, (y - row.y) / row.px))
    return row.from + ratio * (row.to - row.from)
  }
  const toggleRun = (run) => setExpanded((current) => { const next = new Set(current); if (next.has(run)) next.delete(run); else next.add(run); return next })

  const layout = useMemo(() => days.map((_, dayIndex) => layoutDay(items.filter((item) => item.day === dayIndex))), [items, days])

  // Posición del puntero → día y minuto (ajustado a 5 minutos)
  function positionFrom(event, offsetMinutes) {
    const rect = gridRef.current.getBoundingClientRect()
    const columnWidth = rect.width / days.length
    const day = Math.min(days.length - 1, Math.max(0, Math.floor((event.clientX - rect.left) / columnWidth)))
    const raw = minutesAt(event.clientY - rect.top) - offsetMinutes
    return { day, minutes: Math.round(raw / SNAP) * SNAP }
  }

  function onPointerDown(event, item) {
    if (event.button !== 0) return
    const draggable = canDrag(item) && onMove
    const rect = event.currentTarget.getBoundingClientRect()
    const offsetMinutes = ((event.clientY - rect.top) / HOUR_HEIGHT) * 60
    const state = { item, offsetMinutes, startX: event.clientX, startY: event.clientY, moved: false, draggable, day: item.day, minutes: toMinutes(item.start) }
    event.currentTarget.setPointerCapture(event.pointerId)
    setDrag(state)
  }

  function onPointerMove(event) {
    if (!drag) return
    const distance = Math.abs(event.clientX - drag.startX) + Math.abs(event.clientY - drag.startY)
    if (!drag.draggable || (!drag.moved && distance < 6)) return
    const { day, minutes } = positionFrom(event, drag.offsetMinutes)
    const duration = toMinutes(drag.item.end) - toMinutes(drag.item.start)
    const clamped = Math.min(Math.max(minutes, 0), 24 * 60 - duration)
    setDrag({ ...drag, moved: true, day, minutes: clamped })
  }

  function onPointerUp() {
    if (!drag) return
    const { item, moved, day, minutes } = drag
    setDrag(null)
    if (!moved) { onOpen?.(item); return }
    const duration = toMinutes(item.end) - toMinutes(item.start)
    if (day === item.day && minutes === toMinutes(item.start)) return
    onMove(item, day, toTime(minutes), toTime(minutes + duration))
  }

  const columns = `3.25rem repeat(${days.length}, minmax(0, 1fr))`

  return (
    <div className="card overflow-hidden">
      <div className="grid border-b border-line" style={{ gridTemplateColumns: columns }}>
        <span />
        {days.map((day) => (
          <div key={day.key} className={`px-2 py-2 text-center ${day.highlight ? 'text-accent-strong' : 'text-ink'}`}>
            <span className="block text-sm font-semibold">{day.label}</span>
            {day.sublabel && <span className="block text-xs text-muted">{day.sublabel}</span>}
          </div>
        ))}
      </div>
      <div className="grid" style={{ gridTemplateColumns: columns }}>
        <div className="relative" style={{ height }}>
          {rows.filter((row) => !row.collapsed && row.y > 0).map((row) => (
            <span key={row.from} className="absolute right-2 -translate-y-1/2 text-[11px] tabular-nums text-faint" style={{ top: row.y }}>{toTime(row.from)}</span>
          ))}
          {rows.filter((row) => row.runStart).map((row) => (
            <button key={`fold-${row.run}`} type="button" className="absolute left-0.5 z-10 rounded px-1 text-[10px] text-muted hover:bg-subtle hover:text-ink" style={{ top: row.y + 2 }}
              title="Plegar las horas sin clases" onClick={() => toggleRun(row.run)}>plegar</button>
          ))}
        </div>
        <div ref={gridRef} className="relative grid select-none" style={{ height, gridColumn: '2 / -1', gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))` }}
          onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={() => setDrag(null)}>
          {/* Líneas de horas y medias horas */}
          {rows.filter((row) => !row.collapsed).map((row) => (
            <div key={row.from} className="pointer-events-none absolute inset-x-0 border-t border-line" style={{ top: row.y }}>
              <div className="absolute inset-x-0 border-t border-dashed border-line opacity-60" style={{ top: HOUR_HEIGHT / 2 }} />
            </div>
          ))}
          {/* Franjas sin clases en toda la semana: plegadas; al tocarlas se despliegan */}
          {rows.filter((row) => row.collapsed).map((row) => (
            <button key={`band-${row.run}`} type="button" onClick={() => toggleRun(row.run)} title="Desplegar estas horas"
              className="absolute inset-x-0 z-10 flex items-center justify-center gap-1 border-y border-line bg-subtle text-[11px] text-muted hover:text-ink"
              style={{ top: row.y, height: row.px }}>
              {toTime(row.from)}–{toTime(row.to)} · sin clases
            </button>
          ))}
          {days.map((day, dayIndex) => (
            <div key={day.key} className={`relative border-l border-line ${day.highlight ? 'bg-subtle' : ''}`}>
              {day.note && <p className="absolute inset-x-1 top-1 z-10 rounded-md bg-warn-soft px-1.5 py-0.5 text-[11px] font-medium text-warn">{day.note}</p>}
              {ghostItems.filter((item) => item.day === dayIndex).map((item) => (
                <div key={`ghost-${item.id}`} className="pointer-events-none absolute inset-x-1 rounded-lg border border-dashed border-line bg-subtle px-1.5 py-1 text-[11px] text-faint"
                  style={{ top: top(toMinutes(item.start)), height: Math.max(18, top(toMinutes(item.end)) - top(toMinutes(item.start))) }}>
                  {item.label}
                </div>
              ))}
              {layout[dayIndex].map(({ item, column, total }) => {
                const dragging = drag?.moved && drag.item.id === item.id
                const reasons = conflicts.get(item.id)
                const blockTop = top(toMinutes(item.start))
                const blockHeight = Math.max(22, top(toMinutes(item.end)) - blockTop)
                return (
                  <button key={item.id} type="button" title={reasons ? `Choque: ${reasons.join(' · ')}` : undefined}
                    onPointerDown={(event) => onPointerDown(event, item)}
                    onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onOpen?.(item) } }}
                    className={`absolute overflow-hidden rounded-lg border bg-surface px-1.5 py-1 text-left shadow-sm transition-shadow hover:shadow-lift focus-visible:ring-2 focus-visible:ring-accent
                      ${reasons ? 'border-danger ring-1 ring-danger' : 'border-line'} ${canDrag(item) && onMove ? 'cursor-grab touch-none active:cursor-grabbing' : 'cursor-pointer'} ${dragging ? 'opacity-40' : ''}`}
                    style={{ top: blockTop, height: blockHeight, left: `calc(${(column / total) * 100}% + 2px)`, width: `calc(${100 / total}% - 4px)` }}>
                    {reasons && <span aria-hidden="true" className="absolute right-1 top-0.5 text-[11px] font-bold text-danger">!</span>}
                    {renderItem(item)}
                  </button>
                )
              })}
              {drag?.moved && drag.day === dayIndex && (
                <div className="pointer-events-none absolute inset-x-1 z-20 rounded-lg border-2 border-dashed border-accent bg-accent-soft px-1.5 py-1 text-xs font-semibold text-accent-strong"
                  style={{ top: top(drag.minutes), height: Math.max(22, top(drag.minutes + toMinutes(drag.item.end) - toMinutes(drag.item.start)) - top(drag.minutes)) }}>
                  {toTime(drag.minutes)}–{toTime(drag.minutes + toMinutes(drag.item.end) - toMinutes(drag.item.start))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
