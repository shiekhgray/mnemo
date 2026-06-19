import { useState } from 'react'
import api from '../api/client'
import { SUGGESTED_CATEGORIES } from '../constants'
import ConfirmModal from './ConfirmModal'

// Edit or delete a single part. onSaved is called with { deleted, part } so the
// parent can refresh (a query) or update local state (the bulk-add session list).
export default function PartEditModal({ part, onClose, onSaved }) {
  const [name, setName] = useState(part.name)
  const [category, setCategory] = useState(part.category ?? '')
  const [tags, setTags] = useState((part.tags ?? []).join(', '))
  const [notes, setNotes] = useState(part.notes ?? '')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)

  async function save(e) {
    e.preventDefault()
    if (!name.trim()) { setError('Name is required'); return }
    setError('')
    setSaving(true)
    try {
      const { data } = await api.put(`/parts/${part.id}`, {
        name: name.trim(),
        category: category.trim() || null,
        tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
        notes: notes.trim() || null,
      })
      onSaved({ deleted: false, part: data })
      onClose()
    } catch (err) {
      setError(err.response?.data?.detail ?? 'Could not save')
    } finally {
      setSaving(false)
    }
  }

  async function doDelete() {
    setDeleting(true)
    try {
      await api.delete(`/parts/${part.id}`)
      onSaved({ deleted: true, part })
      onClose()
    } catch (err) {
      setError(err.response?.data?.detail ?? 'Could not delete')
      setDeleting(false)
      setConfirmingDelete(false)
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal card" onMouseDown={(e) => e.stopPropagation()}>
        <h3>Edit part</h3>
        <form onSubmit={save}>
          <label className="field">
            <span>Name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} autoFocus required />
          </label>
          <label className="field">
            <span>Category</span>
            <input list="part-edit-categories" value={category} onChange={(e) => setCategory(e.target.value)} />
            <datalist id="part-edit-categories">
              {SUGGESTED_CATEGORIES.map((c) => <option key={c} value={c} />)}
            </datalist>
          </label>
          <label className="field">
            <span>Tags <em className="muted">(comma-separated)</em></span>
            <input value={tags} onChange={(e) => setTags(e.target.value)} />
          </label>
          <label className="field">
            <span>Notes</span>
            <input value={notes} onChange={(e) => setNotes(e.target.value)} />
          </label>
          {error && <p className="error">{error}</p>}
          <div className="modal-actions">
            <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
          </div>
        </form>
        <button type="button" className="danger" onClick={() => { setError(''); setConfirmingDelete(true) }}>
          Delete part
        </button>
      </div>

      {confirmingDelete && (
        <ConfirmModal
          title="Delete this part?"
          message={`“${part.name}” will be permanently deleted.`}
          confirmLabel="Delete"
          busy={deleting}
          onClose={() => setConfirmingDelete(false)}
          onConfirm={doDelete}
        />
      )}
    </div>
  )
}
