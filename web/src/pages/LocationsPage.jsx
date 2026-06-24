import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import api from '../api/client'

const TABS = [
  { key: 'wall', label: 'Wall' },
  { key: 'tackle', label: 'Tackle' },
  { key: 'printer', label: 'Printer' },
]

// A bin's drawer name to show in the UI: human label when present, else the code.
function binName(bin) {
  return bin.label || bin.code
}

// Group a bin's slots into rows of cells. Addresses are spreadsheet-style
// (column letters + row number, e.g. "C3"); half-half bins change column count
// at their midpoint, so we render row-by-row rather than as one fixed grid.
function binRows(bin) {
  const byRow = new Map()
  for (const s of bin.slots) {
    const m = /^([A-Z]+)(\d+)$/.exec(s.address || '')
    if (!m) continue
    const row = Number(m[2])
    if (!byRow.has(row)) byRow.set(row, [])
    byRow.get(row).push({ ...s, col: m[1] })
  }
  return [...byRow.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([row, cells]) => ({
      row,
      cells: cells.sort((a, b) => a.col.localeCompare(b.col)),
    }))
}

// A miniature, non-interactive sketch of one cabinet's drawer grid.
function MiniCabinet({ bin }) {
  const rows = useMemo(() => binRows(bin), [bin])
  return (
    <div className="mini-cabinet">
      {rows.map((r) => (
        <div key={r.row} className="mini-row">
          {r.cells.map((c) => (
            <span
              key={c.id}
              className={c.occupant_id ? 'mini-cell filled' : 'mini-cell'}
            />
          ))}
        </div>
      ))}
    </div>
  )
}

// The 3x4 wall, each position drawn as a mini cabinet. Used both as the cold
// browsing overview (large, tappable) and as the in-detail minimap (small).
function WallGrid({ bins, selectedId, onSelect, variant }) {
  const cols = Math.max(1, ...bins.map((b) => b.wall_col || 1))
  return (
    <div
      className={`wall-grid ${variant}`}
      style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}
    >
      {bins.map((bin) => (
        <button
          key={bin.id}
          className={`wall-cabinet${bin.id === selectedId ? ' current' : ''}`}
          style={{ gridRow: bin.wall_row, gridColumn: bin.wall_col }}
          onClick={() => onSelect(bin.id)}
        >
          <span className="wall-cabinet-name">{binName(bin)}</span>
          <MiniCabinet bin={bin} />
        </button>
      ))}
    </div>
  )
}

// One cabinet, full size: every drawer as a labelled cell. Occupied drawers link
// to their container; the teleport target (flashAddress) is highlighted.
function CabinetDetail({ bin, flashAddress }) {
  const rows = useMemo(() => binRows(bin), [bin])
  return (
    <div className="cabinet-detail">
      {rows.map((r) => (
        <div key={r.row} className="drawer-row">
          {r.cells.map((c) => {
            const flashed = flashAddress && c.address === flashAddress
            const cls = `drawer-cell${c.occupant_id ? ' filled' : ''}${flashed ? ' flash' : ''}`
            const inner = (
              <>
                <span className="drawer-addr">{c.address}</span>
                <span className="drawer-label">{c.occupant_label || ''}</span>
              </>
            )
            return c.occupant_id ? (
              <Link key={c.id} to={`/containers/${c.occupant_id}`} className={cls}>
                {inner}
              </Link>
            ) : (
              <div key={c.id} className={cls}>{inner}</div>
            )
          })}
        </div>
      ))}
    </div>
  )
}

function WallTab({ selectedId, setSelectedId, flashAddress, setFlashAddress }) {
  const { data: bins = [], isLoading } = useQuery({
    queryKey: ['bins'],
    queryFn: async () => (await api.get('/bins')).data,
  })

  if (isLoading) return <p className="muted">Loading wall…</p>
  if (bins.length === 0) return <p className="muted">No wall bins seeded yet.</p>

  const selected = bins.find((b) => b.id === selectedId)

  // Switching cabinets clears any teleport highlight from the previous one.
  const selectBin = (id) => {
    setFlashAddress(null)
    setSelectedId(id)
  }

  if (!selected) {
    return (
      <div className="locations-body">
        <p className="hint">Tap a cabinet to see its drawers.</p>
        <WallGrid bins={bins} selectedId={null} onSelect={selectBin} variant="overview" />
      </div>
    )
  }

  return (
    <div className="locations-body">
      <div className="detail-bar">
        <button className="link-btn" onClick={() => selectBin(null)}>← Wall</button>
        <strong>{binName(selected)}</strong>
        <WallGrid bins={bins} selectedId={selectedId} onSelect={selectBin} variant="minimap" />
      </div>
      <CabinetDetail bin={selected} flashAddress={flashAddress} />
    </div>
  )
}

function StubTab({ name }) {
  return (
    <div className="locations-body">
      <div className="card stub-card">
        <h3>{name}</h3>
        <p className="muted">Coming soon — this tab isn’t built out yet.</p>
      </div>
    </div>
  )
}

export default function LocationsPage() {
  const [params, setParams] = useSearchParams()

  const [tab, setTab] = useState(params.get('tab') || 'wall')
  const [selectedId, setSelectedId] = useState(
    params.get('bin') ? Number(params.get('bin')) : null,
  )
  const [flashAddress, setFlashAddress] = useState(params.get('address') || null)

  // The teleport params (?tab=&bin=&address=) seed the initial state above; once
  // mounted, strip them from the URL so a refresh/back doesn't re-trigger the jump.
  useEffect(() => {
    if (params.get('tab') || params.get('bin') || params.get('address')) {
      setParams({}, { replace: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function changeTab(key) {
    setTab(key)
    setSelectedId(null)
    setFlashAddress(null)
  }

  return (
    <div className="page">
      <div className="seg-tabs">
        {TABS.map((t) => (
          <button
            key={t.key}
            className={`seg-tab${tab === t.key ? ' active' : ''}`}
            onClick={() => changeTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'wall' && (
        <WallTab
          selectedId={selectedId}
          setSelectedId={setSelectedId}
          flashAddress={flashAddress}
          setFlashAddress={setFlashAddress}
        />
      )}
      {tab === 'tackle' && <StubTab name="Tackle drawers" />}
      {tab === 'printer' && <StubTab name="Printer drawers" />}
    </div>
  )
}
