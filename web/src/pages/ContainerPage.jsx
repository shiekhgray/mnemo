import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import api from '../api/client'

export default function ContainerPage() {
  const { id } = useParams()
  const qc = useQueryClient()

  const { data: container } = useQuery({
    queryKey: ['container', id],
    queryFn: async () => (await api.get(`/containers/${id}`)).data,
  })
  const { data: slots = [] } = useQuery({
    queryKey: ['slots', 'available'],
    queryFn: async () => (await api.get('/slots', { params: { available_only: true } })).data,
  })

  const [slotId, setSlotId] = useState('')
  const [freeform, setFreeform] = useState('')

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['container', id] })
    qc.invalidateQueries({ queryKey: ['containers'] })
    qc.invalidateQueries({ queryKey: ['benched'] })
    qc.invalidateQueries({ queryKey: ['slots', 'available'] })
  }

  const assignSlot = useMutation({
    mutationFn: () => api.post(`/containers/${id}/assign-slot`, { slot_id: Number(slotId) }),
    onSuccess: () => { setSlotId(''); refresh() },
  })
  const setLocation = useMutation({
    mutationFn: () => api.put(`/containers/${id}`, { freeform_location: freeform.trim() }),
    onSuccess: () => { setFreeform(''); refresh() },
  })
  const bench = useMutation({
    mutationFn: () => api.post(`/containers/${id}/bench`),
    onSuccess: refresh,
  })

  if (!container) return <div className="page"><p className="muted">Loading…</p></div>

  return (
    <div className="page">
      <h2>{container.label}</h2>
      <p className={container.benched ? 'location-line benched' : 'location-line'}>
        📍 {container.location}
        <span className="chip">{container.type}</span>
      </p>

      <div className="card">
        <h3>Move</h3>
        <div className="inline-form">
          <select value={slotId} onChange={(e) => setSlotId(e.target.value)}>
            <option value="">— assign to slot —</option>
            {slots.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
          <button disabled={!slotId} onClick={() => assignSlot.mutate()}>Assign</button>
        </div>
        <p className="hint">Assigning an occupied slot bumps the current occupant to benched.</p>
        <div className="inline-form">
          <input value={freeform} onChange={(e) => setFreeform(e.target.value)}
            placeholder="Freeform location (e.g. Garage, box near mains)" />
          <button disabled={!freeform.trim()} onClick={() => setLocation.mutate()}>Set</button>
        </div>
        {!container.benched && (
          <button className="danger" onClick={() => bench.mutate()}>Bench this container</button>
        )}
      </div>

      {container.children?.length > 0 && (
        <div className="card">
          <h3>Nested containers</h3>
          <ul className="result-list">
            {container.children.map((ch) => (
              <li key={ch.id}>
                <Link to={`/containers/${ch.id}`}>{ch.label}</Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      <h3>Parts ({container.parts?.length ?? 0})</h3>
      <ul className="result-list">
        {container.parts?.map((p) => (
          <li key={p.id} className="card result">
            <span className="result-name">{p.name}</span>
            {p.category && <span className="chip">{p.category}</span>}
            {p.tags?.length > 0 && (
              <div className="tags">{p.tags.map((t) => <span key={t} className="tag">{t}</span>)}</div>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
