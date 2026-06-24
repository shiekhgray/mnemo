import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import api from '../api/client'
import { useDrag, useDraggable } from '../dnd/DragContext'

/*
 * The bench: a collapsible, every-page sidebar of un-placed containers
 * (prd/drag-reorg.prd). It replaces the standalone /benched page. It is both a
 * drop target (drag a drawer here to bench it) and a drag source (drag a chip
 * onto a drawer to place it) — the required bridge for cross-cabinet moves, since
 * only one cabinet is on screen at a time.
 *
 * Its dock is reactive to the viewport's aspect ratio: a left-edge drawer when
 * wider than tall, a bottom sheet when taller than wide (so it lands on whichever
 * edge has room and along the screen's long axis). It defaults collapsed to a thin
 * handle, and peeks open automatically while a drag is in progress so the drop
 * zone is obviously there.
 */

const STORAGE_KEY = 'mnemo.bench.expanded'

function useMediaQuery(query) {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches)
  useEffect(() => {
    const mq = window.matchMedia(query)
    const handler = (e) => setMatches(e.matches)
    mq.addEventListener('change', handler)
    // Resync in case the match changed between render and effect (e.g. query prop
    // change); harmless no-op when it didn't.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMatches(mq.matches)
    return () => mq.removeEventListener('change', handler)
  }, [query])
  return matches
}

function BenchChip({ container }) {
  const navigate = useNavigate()
  const drag = useDraggable(
    { kind: 'chip', containerId: container.id, label: container.label, fromSlotId: null },
    { onTap: () => navigate(`/containers/${container.id}`) },
  )
  return (
    <button type="button" className="bench-chip" {...drag}>
      <span className="bench-chip-label">{container.label}</span>
      <span className="chip">{container.part_count}</span>
    </button>
  )
}

export default function BenchSidebar() {
  const { isDragging } = useDrag()
  const landscape = useMediaQuery('(min-aspect-ratio: 1/1)')
  const [userExpanded, setUserExpanded] = useState(
    () => localStorage.getItem(STORAGE_KEY) === '1',
  )

  const { data: benched = [] } = useQuery({
    queryKey: ['benched'],
    queryFn: async () => (await api.get('/containers/benched')).data,
  })

  function toggle() {
    setUserExpanded((v) => {
      const next = !v
      localStorage.setItem(STORAGE_KEY, next ? '1' : '0')
      return next
    })
  }

  // Auto-peek while dragging so the drop zone is visible, then revert.
  const expanded = userExpanded || isDragging
  const dock = landscape ? 'dock-left' : 'dock-bottom'

  return (
    <aside
      className={`bench-sidebar ${dock} ${expanded ? 'expanded' : 'collapsed'}`}
      data-drop-id="bench"
      data-drop-kind="bench"
    >
      <button type="button" className="bench-handle" onClick={toggle}>
        <span className="bench-handle-label">Bench</span>
        <span className="chip">{benched.length}</span>
      </button>
      {expanded && (
        <div className="bench-body">
          {benched.length === 0 ? (
            <p className="hint bench-empty">Nothing benched. Drag a drawer here to bench it.</p>
          ) : (
            <div className="bench-chips">
              {benched.map((c) => (
                <BenchChip key={c.id} container={c} />
              ))}
            </div>
          )}
        </div>
      )}
    </aside>
  )
}
