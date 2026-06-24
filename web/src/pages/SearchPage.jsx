import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import api from '../api/client'

// Turn a structured location_ref into a "take me there" route, or null when the
// container has no physical spot to fly to (benched/freeform — the location text
// already tells the user where to look).
function takeMeThereTo(ref) {
  if (!ref) return null
  if (ref.kind === 'wall') {
    return `/locations?tab=wall&bin=${ref.bin_id}&address=${encodeURIComponent(ref.address)}`
  }
  if (ref.kind === 'chest') {
    return `/locations?tab=tackle`
  }
  if (ref.kind === 'nested') {
    return `/containers/${ref.parent_container_id}`
  }
  return null
}

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
        {results.map((p) => {
          const there = takeMeThereTo(p.location_ref)
          return (
            <li key={p.id} className="card result">
              <div className="result-main">
                <span className="result-name">{p.name}</span>
                {p.category && <span className="chip">{p.category}</span>}
              </div>
              <div className="result-actions">
                <Link className="result-location" to={`/containers/${p.container_id}`}>
                  📍 {p.location} · {p.container_label}
                </Link>
                {there && (
                  <Link className="take-me-there" to={there}>Take me there →</Link>
                )}
              </div>
              {p.tags?.length > 0 && (
                <div className="tags">{p.tags.map((t) => <span key={t} className="tag">{t}</span>)}</div>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
