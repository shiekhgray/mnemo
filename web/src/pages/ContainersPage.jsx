import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import api from '../api/client'
import { CONTAINER_TYPES } from '../constants'

export default function ContainersPage() {
  const qc = useQueryClient()
  const { data: containers = [] } = useQuery({
    queryKey: ['containers'],
    queryFn: async () => (await api.get('/containers')).data,
  })

  const [label, setLabel] = useState('')
  const [type, setType] = useState('other')

  const create = useMutation({
    mutationFn: (body) => api.post('/containers', body),
    onSuccess: () => {
      setLabel('')
      qc.invalidateQueries({ queryKey: ['containers'] })
    },
  })

  return (
    <div className="page">
      <form
        className="card inline-form"
        onSubmit={(e) => {
          e.preventDefault()
          if (label.trim()) create.mutate({ label: label.trim(), type })
        }}
      >
        <input value={label} onChange={(e) => setLabel(e.target.value)}
          placeholder="New container label" />
        <select value={type} onChange={(e) => setType(e.target.value)}>
          {CONTAINER_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <button type="submit">Add</button>
      </form>

      <ul className="result-list">
        {containers.map((c) => (
          <li key={c.id} className="card result">
            <Link to={`/containers/${c.id}`} className="result-main">
              <span className="result-name">{c.label}</span>
              <span className="chip">{c.part_count} parts</span>
            </Link>
            <span className={c.benched ? 'result-location benched' : 'result-location'}>
              📍 {c.location}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
