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
  const [containerSearch, setContainerSearch] = useState('')
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

  const selected = containers.find((c) => String(c.id) === String(containerId))
  const q = containerSearch.trim().toLowerCase()
  const matches = q
    ? containers.filter(
        (c) => c.label.toLowerCase().includes(q) || (c.location ?? '').toLowerCase().includes(q)
      )
    : containers

  return (
    <div className="page">
      {selected ? (
        <div className="card selected-container">
          <div>
            <span className="muted">Adding to</span>
            <div className="result-name">{selected.label}</div>
            <span className="muted">📍 {selected.location}</span>
          </div>
          <button className="btn-secondary" onClick={() => { setContainerId(''); setContainerSearch('') }}>
            Change
          </button>
        </div>
      ) : (
        <div className="card">
          <label className="field">
            <span>Container</span>
            <input
              type="search"
              value={containerSearch}
              onChange={(e) => setContainerSearch(e.target.value)}
              placeholder="Search containers by name or location…"
              autoFocus
            />
          </label>
          {containers.length === 0 && (
            <p className="muted">No containers yet — create one on the Containers tab first.</p>
          )}
          {containers.length > 0 && matches.length === 0 && (
            <p className="muted">No containers match “{containerSearch}”.</p>
          )}
          <ul className="result-list">
            {matches.map((c) => (
              <li key={c.id}>
                <button className="picker-row" onClick={() => setContainerId(String(c.id))}>
                  <span className="result-name">{c.label}</span>
                  <span className="muted">📍 {c.location}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {containerId && (
        <form className="card add-form" onSubmit={handleAdd}>
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
