import { useState } from 'react'
import api from '../api/client'
import ConfirmModal from './ConfirmModal'

const MAX_DRAWERS = 40

// Create or edit a drawer chest. `mode` is 'create' or 'edit' (acting on `chest`).
// Each drawer holds a front + back slot; changing the count reconciles slots under
// the same bump-don't-delete rule as the wall (positions.reconcile_chest_slots).
export default function ChestEditModal({ mode, chest, onClose, onSaved }) {
  const isEdit = mode === 'edit'
  const [label, setLabel] = useState(chest?.label || '')
  const [count, setCount] = useState(chest?.num_drawers || 4)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [confirm, setConfirm] = useState(false) // shrink confirm
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  // Occupied boxes a shrink would bench: those in drawers above the new count.
  const bumped =
    isEdit && count < chest.num_drawers
      ? chest.slots.filter((s) => s.occupant_id && s.drawer_number > count)
      : []

  const occupiedCount = isEdit ? chest.slots.filter((s) => s.occupant_id).length : 0

  async function doSave() {
    if (!label.trim()) {
      setError('Name is required')
      return
    }
    setSaving(true)
    setError('')
    try {
      if (isEdit) {
        await api.put(`/chests/${chest.id}`, { label: label.trim(), num_drawers: count })
      } else {
        await api.post('/chests', { label: label.trim(), num_drawers: count })
      }
      onSaved()
    } catch (err) {
      setError(err.response?.data?.detail ?? 'Could not save')
      setSaving(false)
      setConfirm(false)
    }
  }

  function onSubmit(e) {
    e.preventDefault()
    if (bumped.length > 0) setConfirm(true)
    else doSave()
  }

  async function doDelete() {
    setSaving(true)
    try {
      await api.delete(`/chests/${chest.id}`)
      onSaved()
    } catch (err) {
      setError(err.response?.data?.detail ?? 'Could not delete')
      setSaving(false)
      setConfirmingDelete(false)
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal card" onMouseDown={(e) => e.stopPropagation()}>
        <h3>{isEdit ? 'Edit chest' : 'Add chest'}</h3>
        <form onSubmit={onSubmit}>
          <label className="field">
            <span>Name</span>
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. Tackle chest"
              autoFocus
            />
          </label>

          <label className="field">
            <span>Drawers <em className="muted">(each holds a front + back box)</em></span>
            <input
              type="number"
              min="1"
              max={MAX_DRAWERS}
              value={count}
              onChange={(e) =>
                setCount(Math.max(1, Math.min(MAX_DRAWERS, Number(e.target.value) || 1)))
              }
            />
          </label>

          <em className="muted">
            {count} drawers · {count * 2} boxes
            {bumped.length > 0 && ` · ${bumped.length} occupied will be benched`}
          </em>

          {error && <p className="error">{error}</p>}
          <div className="modal-actions">
            <button type="button" className="btn-secondary" onClick={onClose} disabled={saving}>
              Cancel
            </button>
            <button type="submit" disabled={saving}>
              {saving ? 'Saving…' : isEdit ? 'Save' : 'Create'}
            </button>
          </div>
        </form>

        {isEdit && (
          <button
            type="button"
            className="danger"
            onClick={() => {
              setError('')
              setConfirmingDelete(true)
            }}
          >
            Delete chest
          </button>
        )}
      </div>

      {confirm && (
        <ConfirmModal
          title="Shrink this chest?"
          message={`Removing drawers benches ${bumped.length} occupied box${
            bumped.length === 1 ? '' : 'es'
          } (containers kept, not deleted).`}
          confirmLabel="Apply"
          busy={saving}
          onClose={() => setConfirm(false)}
          onConfirm={doSave}
        />
      )}

      {confirmingDelete && (
        <ConfirmModal
          title="Delete this chest?"
          message={
            occupiedCount > 0
              ? `${occupiedCount} occupied box${
                  occupiedCount === 1 ? '' : 'es'
                } will be benched (containers kept), then the chest is removed.`
              : 'This empty chest will be removed.'
          }
          confirmLabel="Delete"
          busy={saving}
          onClose={() => setConfirmingDelete(false)}
          onConfirm={doDelete}
        />
      )}
    </div>
  )
}
