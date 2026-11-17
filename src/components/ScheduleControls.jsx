import { createPortal } from 'react-dom'
import Modal from './Modal.jsx'

// Selector de aula de la escuela, con «Sin aula» y «+ Nueva aula…» (se crea al guardar).
// form.room_id: id del aula, '' (sin aula) o 'new' (con form.room_new)
export function RoomSelect({ rooms, form, setForm }) {
  return (
    <div className="space-y-2">
      <label className="field">Aula
        <select className="input" value={form.room_id} onChange={(event) => setForm({ ...form, room_id: event.target.value })}>
          <option value="">Sin aula</option>
          {rooms.map((room) => <option key={room.id} value={room.id}>{room.name}</option>)}
          <option value="new">+ Nueva aula…</option>
        </select>
      </label>
      {form.room_id === 'new' && (
        <input className="input" autoFocus required maxLength={40} placeholder="Nombre del aula (p. ej. Hangar 2)" aria-label="Nombre del aula nueva"
          value={form.room_new || ''} onChange={(event) => setForm({ ...form, room_new: event.target.value })} />
      )}
    </div>
  )
}

// Aviso antes de guardar una clase que choca con otras (se puede guardar igualmente).
// Va en un portal porque a menudo se abre encima de otro diálogo.
export function ConflictConfirm({ reasons, action = 'Guardar igualmente', onConfirm, onCancel }) {
  return createPortal(
    <Modal title="Esta clase chocará con otras" onClose={onCancel}>
      <ul className="space-y-1.5 text-sm">
        {reasons.map((reason) => <li key={reason} className="rounded-lg bg-danger-soft px-3 py-2 text-danger">{reason}</li>)}
      </ul>
      <p className="mt-3 text-sm text-muted">Puedes guardarla igualmente (por ejemplo, si es un desdoble o dos grupos juntos) o volver y elegir otra hora.</p>
      <div className="mt-5 flex justify-end gap-2">
        <button type="button" className="btn-ghost" onClick={onCancel}>Volver</button>
        <button type="button" className="btn-primary" onClick={onConfirm}>{action}</button>
      </div>
    </Modal>,
    document.body,
  )
}
