import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import api from '../api/client'

export default function BenchedPage() {
  const { data: benched = [] } = useQuery({
    queryKey: ['benched'],
    queryFn: async () => (await api.get('/containers/benched')).data,
  })

  return (
    <div className="page">
      <p className="muted">Containers with no known position — assign them a slot on their detail page.</p>
      {benched.length === 0 && <p className="muted">Nothing is benched. 🎉</p>}
      <ul className="result-list">
        {benched.map((c) => (
          <li key={c.id} className="card result">
            <Link to={`/containers/${c.id}`} className="result-main">
              <span className="result-name">{c.label}</span>
              <span className="chip">{c.part_count} parts</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
