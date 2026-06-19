import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import api from '../api/client'
import { SUGGESTED_CATEGORIES } from '../constants'

// Bulk-add flow: pick a container once, then keep adding parts to it without
// re-selecting — cataloguing a tackle box of ~30 parts should be fast (per PRD).
export default function AddPartPage() {
  const { data: containers = [] } = useQuery({
    queryKey: ['containers'],
    queryFn: async () => (await api.get('/containers')).data,
  })

  const [containerId, setContainerId] = useState('')
  const [name, setName] = useState('')
  const [category, setCategory] = useState('')
  const [tags, setTags] = useState('')
  const [notes, setNotes] = useState('')
  const [added, setAdded] = useState([])
  const [saving, setSaving] = useState(false)

  async function handleAdd(e) {
    e.preventDefault()
    if (!containerId || !name.trim()) return
    setSaving(true)
    try {
      const { data } = await api.post('/parts', {
        name: name.trim(),
        category: category.trim() || null,
        container_id: Number(containerId),
        tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
        notes: notes.trim() || null,
      })
      setAdded((prev) => [data, ...prev])
      // Stay in the container; clear the per-part fields, keep category sticky.
      setName('')
      setTags('')
      setNotes('')
    } finally {
      setSaving(false)
    }
  }

  const containerLabel = containers.find((c) => String(c.id) === String(containerId))?.label

  return (
    <div className="page">
      <label className="field">
        <span>Container</span>
        <select value={containerId} onChange={(e) => setContainerId(e.target.value)}>
          <option value="">— choose a container —</option>
          {containers.map((c) => (
            <option key={c.id} value={c.id}>{c.label} · {c.location}</option>
          ))}
        </select>
      </label>

      {containerId && (
        <form className="card add-form" onSubmit={handleAdd}>
          <p className="muted">Adding to <strong>{containerLabel}</strong></p>
          <label className="field">
            <span>Name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} autoFocus required
              placeholder="e.g. 10kΩ 1/4W through-hole resistor" />
          </label>
          <label className="field">
            <span>Category</span>
            <input list="categories" value={category} onChange={(e) => setCategory(e.target.value)}
              placeholder="resistor" />
            <datalist id="categories">
              {SUGGESTED_CATEGORIES.map((c) => <option key={c} value={c} />)}
            </datalist>
          </label>
          <label className="field">
            <span>Tags <em className="muted">(comma-separated)</em></span>
            <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="smd, keyboard" />
          </label>
          <label className="field">
            <span>Notes</span>
            <input value={notes} onChange={(e) => setNotes(e.target.value)} />
          </label>
          <button type="submit" disabled={saving}>{saving ? 'Adding…' : 'Add part'}</button>
        </form>
      )}

      {added.length > 0 && (
        <>
          <h3>Added this session ({added.length})</h3>
          <ul className="result-list">
            {added.map((p) => (
              <li key={p.id} className="card result">
                <span className="result-name">{p.name}</span>
                {p.category && <span className="chip">{p.category}</span>}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}
