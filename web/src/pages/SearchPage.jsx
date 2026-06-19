import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import api from '../api/client'

function useDebounced(value, ms) {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}

export default function SearchPage() {
  const [q, setQ] = useState('')
  const debounced = useDebounced(q.trim(), 200)

  const { data: results = [], isFetching } = useQuery({
    queryKey: ['search', debounced],
    queryFn: async () => (await api.get('/parts/search', { params: { q: debounced } })).data,
    enabled: debounced.length > 0,
  })

  return (
    <div className="page">
      <input
        className="search-input"
        type="search"
        placeholder="Search parts — name, category, tag…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        autoFocus
      />

      {debounced && !isFetching && results.length === 0 && (
        <p className="muted">No parts match “{debounced}”.</p>
      )}

      <ul className="result-list">
        {results.map((p) => (
          <li key={p.id} className="card result">
            <div className="result-main">
              <span className="result-name">{p.name}</span>
              {p.category && <span className="chip">{p.category}</span>}
            </div>
            <Link className="result-location" to={`/containers/${p.container_id}`}>
              📍 {p.location} · {p.container_label}
            </Link>
            {p.tags?.length > 0 && (
              <div className="tags">{p.tags.map((t) => <span key={t} className="tag">{t}</span>)}</div>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
