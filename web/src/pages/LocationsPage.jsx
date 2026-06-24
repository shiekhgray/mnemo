import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import api from '../api/client'
import { useDraggable } from '../dnd/DragContext'
import CabinetEditModal from '../components/CabinetEditModal'
import ChestEditModal from '../components/ChestEditModal'

const TABS = [
  { key: 'wall', label: 'Wall' },
  { key: 'tackle', label: 'Tackle' },
  { key: 'storage', label: 'Storage' },
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

// Row height weights (flex-grow) top-to-bottom, dividing the fixed cabinet box.
// Derived from the band model: each band is an equal vertical slice of the unit
// (1/numBands), split evenly among its rows. This reproduces the three Akro-Mils
// presets exactly — a single band gives uniform rows (all-narrow → 1/8, all-wide →
// 1/6); half-half's two bands split the box in half (4 narrow rows over 3 wide) —
// and renders arbitrary custom grids correctly (prd/layout-editor.prd). Falls back
// to the old per-row heuristic for any bin predating grid_spec.
function rowWeights(bin, rows) {
  const spec = bin.grid_spec
  if (Array.isArray(spec) && spec.length) {
    const total = spec.reduce((n, b) => n + b.rows, 0)
    if (total === rows.length) {
      const out = []
      for (const band of spec) {
        const w = 1 / spec.length / band.rows
        for (let r = 0; r < band.rows; r++) out.push(w)
      }
      return out
    }
  }
  return rows.map((r) => (r.cells.length > 4 ? 1 / 8 : 1 / 6))
}

// A miniature, non-interactive sketch of one cabinet's drawer grid. Renders into a
// fixed-aspect box (CSS) so every unit reads as the same physical size.
function MiniCabinet({ bin }) {
  const rows = useMemo(() => binRows(bin), [bin])
  const weights = useMemo(() => rowWeights(bin, rows), [bin, rows])
  return (
    <div className="mini-cabinet">
      {rows.map((r, i) => (
        <div key={r.row} className="mini-row" style={{ flex: weights[i] }}>
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

// The wall in edit-layout mode (prd/layout-editor.prd): every existing cabinet is a
// tap-to-edit target, and each empty cell (within the wall's extent plus one growth
// row/col) is a "+ Add cabinet" affordance. Read-only browsing stays in WallGrid.
function EditableWallGrid({ bins, onEdit, onAdd }) {
  const placed = bins.filter((b) => b.wall_row && b.wall_col)
  const maxRow = Math.max(1, ...placed.map((b) => b.wall_row))
  const maxCol = Math.max(1, ...placed.map((b) => b.wall_col))
  const rows = maxRow + 1
  const cols = maxCol + 1
  const at = (r, c) => placed.find((b) => b.wall_row === r && b.wall_col === c)
  const cells = []
  for (let r = 1; r <= rows; r++) {
    for (let c = 1; c <= cols; c++) cells.push([r, c])
  }
  return (
    <div
      className="wall-grid overview editing"
      style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}
    >
      {cells.map(([r, c]) => {
        const bin = at(r, c)
        if (bin) {
          return (
            <button
              key={bin.id}
              className="wall-cabinet"
              style={{ gridRow: r, gridColumn: c }}
              onClick={() => onEdit(bin)}
            >
              <span className="wall-cabinet-name">{binName(bin)} ✎</span>
              <MiniCabinet bin={bin} />
            </button>
          )
        }
        return (
          <button
            key={`add-${r}-${c}`}
            className="wall-cabinet add-cell"
            style={{ gridRow: r, gridColumn: c }}
            onClick={() => onAdd({ row: r, col: c })}
          >
            + Add
          </button>
        )
      })}
    </div>
  )
}

// A drawer cell's class and the drop-target data attributes the drag layer reads
// (prd/drag-reorg.prd). Every cell is a drop zone; occupied cells are also drag
// sources (see OccupiedCell). The data-* attrs let DragContext hit-test the cell
// under the finger without going through React.
function cellClass(cell, flashed) {
  return `drawer-cell${cell.occupant_id ? ' filled' : ''}${flashed ? ' flash' : ''}`
}
function dropAttrs(cell) {
  return {
    'data-drop-id': cell.id,
    'data-drop-kind': 'slot',
    'data-slot-id': cell.id,
    'data-occupant-id': cell.occupant_id || undefined,
    'data-occupant-label': cell.occupant_label || undefined,
  }
}
// A compact "N types" badge for a drawer holding several distinct parts. Hidden for
// 0–1 types so single-item drawers (the common case) stay uncluttered.
function TypesBadge({ count }) {
  if (!count || count < 2) return null
  return <span className="drawer-types">{count} types</span>
}

function CellInner({ cell }) {
  return (
    <>
      <span className="drawer-addr">{cell.address}</span>
      <span className="drawer-label">{cell.occupant_label || ''}</span>
      <TypesBadge count={cell.occupant_part_count} />
    </>
  )
}

// An occupied drawer: tap opens its container, long-press lifts it to drag (move /
// swap / bench). fromSlotId is the *slot* id this container currently sits in.
function OccupiedCell({ cell, flashed, busy, onOpenDrawer }) {
  const drag = useDraggable(
    {
      kind: 'drawer',
      containerId: cell.occupant_id,
      label: cell.occupant_label || '(unnamed)',
      fromSlotId: cell.id,
    },
    { onTap: () => onOpenDrawer(cell) },
  )
  return (
    <button
      type="button"
      className={cellClass(cell, flashed)}
      disabled={busy}
      {...dropAttrs(cell)}
      {...drag}
    >
      <CellInner cell={cell} />
    </button>
  )
}

// An empty drawer: nothing to drag, but still a valid drop target. Tap creates a
// container in this slot (the existing behavior).
function EmptyCell({ cell, flashed, busy, onOpenDrawer }) {
  return (
    <button
      type="button"
      className={cellClass(cell, flashed)}
      disabled={busy}
      {...dropAttrs(cell)}
      onClick={() => onOpenDrawer(cell)}
    >
      <CellInner cell={cell} />
    </button>
  )
}

// One cabinet, full size: every drawer is a tappable cell and a drop target.
// Occupied drawers are draggable (move/swap/bench); empty ones accept drops and,
// on tap, create a container. The teleport target (flashAddress) is highlighted.
function CabinetDetail({ bin, flashAddress, onOpenDrawer, busy }) {
  const rows = useMemo(() => binRows(bin), [bin])
  const weights = useMemo(() => rowWeights(bin, rows), [bin, rows])
  return (
    <div className="cabinet-detail">
      {rows.map((r, i) => (
        <div key={r.row} className="drawer-row" style={{ flex: weights[i] }}>
          {r.cells.map((c) => {
            const flashed = flashAddress && c.address === flashAddress
            const Cell = c.occupant_id ? OccupiedCell : EmptyCell
            return (
              <Cell
                key={c.id}
                cell={c}
                flashed={flashed}
                busy={busy}
                onOpenDrawer={onOpenDrawer}
              />
            )
          })}
        </div>
      ))}
    </div>
  )
}

function WallTab({ selectedId, setSelectedId, flashAddress, setFlashAddress }) {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [editMode, setEditMode] = useState(false)
  const [editing, setEditing] = useState(null) // { mode, bin?, cell? } for the modal
  const { data: allBins = [], isLoading } = useQuery({
    queryKey: ['bins'],
    queryFn: async () => (await api.get('/bins')).data,
  })
  // The Wall tab shows only wall-placed cabinets; off-wall bins are standalone
  // storage systems and live in the Storage tab.
  const bins = allBins.filter((b) => b.wall_row != null)

  // Tapping an empty drawer creates a container in that slot, then opens it in
  // rename mode; an occupied drawer just opens its container. Either way you land
  // on the container's edit page.
  const create = useMutation({
    mutationFn: (cell) =>
      api.post('/containers', { label: cell.label, type: 'other', slot_id: cell.id }),
    onSuccess: ({ data }) => {
      qc.invalidateQueries({ queryKey: ['bins'] })
      navigate(`/containers/${data.id}`, { state: { rename: true } })
    },
  })

  const openDrawer = (cell) => {
    if (cell.occupant_id) navigate(`/containers/${cell.occupant_id}`)
    else if (!create.isPending) create.mutate(cell)
  }

  // Entering edit-layout mode forces the overview (edits act on the whole wall).
  const toggleEdit = () => {
    setFlashAddress(null)
    setSelectedId(null)
    setEditMode((v) => !v)
  }

  // After a create/edit/delete/move, refresh the wall and close the modal.
  const onSaved = () => {
    qc.invalidateQueries({ queryKey: ['bins'] })
    setEditing(null)
  }

  const editModal = editing && (
    <CabinetEditModal
      mode={editing.mode}
      bin={editing.bin}
      cell={editing.cell}
      bins={bins}
      onClose={() => setEditing(null)}
      onSaved={onSaved}
    />
  )

  if (isLoading) return <p className="muted">Loading wall…</p>

  const selected = bins.find((b) => b.id === selectedId)

  // Switching cabinets clears any teleport highlight from the previous one.
  const selectBin = (id) => {
    setFlashAddress(null)
    setSelectedId(id)
  }

  if (editMode) {
    return (
      <div className="locations-body">
        <div className="edit-bar">
          <span className="hint">Tap a cabinet to edit, or an empty cell to add one.</span>
          <button className="btn-secondary" onClick={toggleEdit}>Done</button>
        </div>
        <EditableWallGrid
          bins={bins}
          onEdit={(bin) => setEditing({ mode: 'edit', bin })}
          onAdd={(cell) => setEditing({ mode: 'create', cell })}
        />
        {editModal}
      </div>
    )
  }

  if (bins.length === 0) {
    return (
      <div className="locations-body">
        <p className="muted">No wall cabinets yet.</p>
        <button className="link-btn" onClick={toggleEdit}>+ Add your first cabinet</button>
        {editModal}
      </div>
    )
  }

  if (!selected) {
    return (
      <div className="locations-body">
        <div className="edit-bar">
          <p className="hint">Tap a cabinet to see its drawers.</p>
          <button className="link-btn" onClick={toggleEdit}>Edit layout</button>
        </div>
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
      <CabinetDetail
        bin={selected}
        flashAddress={flashAddress}
        onOpenDrawer={openDrawer}
        busy={create.isPending}
      />
    </div>
  )
}

// A chest's slots grouped into drawers (front + back box per drawer), drawer order.
function chestDrawers(chest) {
  const byNum = new Map()
  for (const s of chest.slots) {
    if (!byNum.has(s.drawer_number)) byNum.set(s.drawer_number, {})
    byNum.get(s.drawer_number)[s.box_position] = s
  }
  return [...byNum.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([n, boxes]) => ({ n, front: boxes.front, back: boxes.back }))
}

// One tackle-box slot (front/back). Tap opens its container, or creates one in the
// empty box — mirroring the wall's drawer behavior.
function ChestBox({ slot, onOpen }) {
  if (!slot) return <span className="drawer-cell" />
  return (
    <button
      type="button"
      className={`drawer-cell${slot.occupant_id ? ' filled' : ''}`}
      onClick={() => onOpen(slot)}
    >
      <span className="drawer-addr">{slot.box_position}</span>
      <span className="drawer-label">{slot.occupant_label || ''}</span>
      <TypesBadge count={slot.occupant_part_count} />
    </button>
  )
}

// The Tackle tab: the read-only finder for drawer chests plus an Edit-layout mode
// for chest CRUD (prd/layout-editor.prd Phase 3).
function TackleTab() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [editMode, setEditMode] = useState(false)
  const [editing, setEditing] = useState(null) // { mode, chest? } for the modal
  const { data: chests = [], isLoading } = useQuery({
    queryKey: ['chests'],
    queryFn: async () => (await api.get('/chests')).data,
  })

  const create = useMutation({
    mutationFn: (slot) =>
      api.post('/containers', { label: slot.label, type: 'other', slot_id: slot.id }),
    onSuccess: ({ data }) => {
      qc.invalidateQueries({ queryKey: ['chests'] })
      navigate(`/containers/${data.id}`, { state: { rename: true } })
    },
  })

  const openBox = (slot) => {
    if (slot.occupant_id) navigate(`/containers/${slot.occupant_id}`)
    else if (!create.isPending) create.mutate(slot)
  }

  const onSaved = () => {
    qc.invalidateQueries({ queryKey: ['chests'] })
    setEditing(null)
  }

  const editModal = editing && (
    <ChestEditModal
      mode={editing.mode}
      chest={editing.chest}
      onClose={() => setEditing(null)}
      onSaved={onSaved}
    />
  )

  if (isLoading) return <p className="muted">Loading chests…</p>

  if (chests.length === 0) {
    return (
      <div className="locations-body">
        <p className="muted">No chests yet.</p>
        <button className="link-btn" onClick={() => setEditing({ mode: 'create' })}>
          + Add your first chest
        </button>
        {editModal}
      </div>
    )
  }

  return (
    <div className="locations-body">
      <div className="edit-bar">
        <span className="hint">
          {editMode ? 'Tap a chest to edit, or add one.' : 'Tap a box to open or fill it.'}
        </span>
        <button className="link-btn" onClick={() => setEditMode((v) => !v)}>
          {editMode ? 'Done' : 'Edit layout'}
        </button>
      </div>

      {editMode && (
        <button className="wall-cabinet add-cell add-chest" onClick={() => setEditing({ mode: 'create' })}>
          + Add chest
        </button>
      )}

      {chests.map((chest) =>
        editMode ? (
          <button
            key={chest.id}
            className="card chest-edit-row"
            onClick={() => setEditing({ mode: 'edit', chest })}
          >
            <strong>{chest.label} ✎</strong>
            <span className="muted">{chest.num_drawers} drawers</span>
          </button>
        ) : (
          <div key={chest.id} className="card chest-card">
            <h3>{chest.label}</h3>
            {chestDrawers(chest).map((d) => (
              <div key={d.n} className="chest-drawer">
                <span className="chest-drawer-no">#{d.n}</span>
                <ChestBox slot={d.front} onOpen={openBox} />
                <ChestBox slot={d.back} onOpen={openBox} />
              </div>
            ))}
          </div>
        ),
      )}
      {editModal}
    </div>
  )
}

// The browse/edit list of standalone storage systems — each an off-wall grid fixture
// drawn as a tappable MiniCabinet. Mirrors the wall overview, minus 2D placement.
function StorageOverview({ bins, editMode, onSelect, onEdit, onAdd }) {
  return (
    <div className="storage-list">
      {bins.map((bin) => (
        <button
          key={bin.id}
          className="wall-cabinet"
          onClick={() => (editMode ? onEdit(bin) : onSelect(bin.id))}
        >
          <span className="wall-cabinet-name">
            {binName(bin)}
            {editMode ? ' ✎' : ''}
          </span>
          <MiniCabinet bin={bin} />
        </button>
      ))}
      {editMode && (
        <button className="wall-cabinet add-cell" onClick={onAdd}>
          + Add
        </button>
      )}
    </div>
  )
}

// The Storage tab: free-form grid fixtures that aren't on the wall (a printer chest,
// a shelf, …). Structurally identical to a wall cabinet — same Bin grid model, same
// CabinetDetail renderer and CabinetEditModal (in `standalone` mode) — just without a
// wall position. The '+' here is the generic "add a storage system" affordance that
// replaced the old Printer stub.
function StorageTab({ selectedId, setSelectedId, flashAddress, setFlashAddress }) {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [editMode, setEditMode] = useState(false)
  const [editing, setEditing] = useState(null) // { mode, bin? } for the modal
  const { data: allBins = [], isLoading } = useQuery({
    queryKey: ['bins'],
    queryFn: async () => (await api.get('/bins')).data,
  })
  const bins = allBins.filter((b) => b.wall_row == null)

  const create = useMutation({
    mutationFn: (cell) =>
      api.post('/containers', { label: cell.label, type: 'other', slot_id: cell.id }),
    onSuccess: ({ data }) => {
      qc.invalidateQueries({ queryKey: ['bins'] })
      navigate(`/containers/${data.id}`, { state: { rename: true } })
    },
  })

  const openDrawer = (cell) => {
    if (cell.occupant_id) navigate(`/containers/${cell.occupant_id}`)
    else if (!create.isPending) create.mutate(cell)
  }

  const onSaved = () => {
    qc.invalidateQueries({ queryKey: ['bins'] })
    setEditing(null)
  }

  const selectBin = (id) => {
    setFlashAddress(null)
    setSelectedId(id)
  }

  // Entering edit-layout mode forces the overview (edits act on the whole list).
  const toggleEdit = () => {
    setFlashAddress(null)
    setSelectedId(null)
    setEditMode((v) => !v)
  }

  const editModal = editing && (
    <CabinetEditModal
      mode={editing.mode}
      bin={editing.bin}
      bins={allBins}
      standalone
      onClose={() => setEditing(null)}
      onSaved={onSaved}
    />
  )

  if (isLoading) return <p className="muted">Loading storage…</p>

  const selected = bins.find((b) => b.id === selectedId)

  if (bins.length === 0 && !editMode) {
    return (
      <div className="locations-body">
        <p className="muted">No storage systems yet.</p>
        <button className="link-btn" onClick={() => setEditing({ mode: 'create' })}>
          + Add your first storage system
        </button>
        {editModal}
      </div>
    )
  }

  if (selected) {
    return (
      <div className="locations-body">
        <div className="detail-bar">
          <button className="link-btn" onClick={() => selectBin(null)}>← Storage</button>
          <strong>{binName(selected)}</strong>
        </div>
        <CabinetDetail
          bin={selected}
          flashAddress={flashAddress}
          onOpenDrawer={openDrawer}
          busy={create.isPending}
        />
      </div>
    )
  }

  return (
    <div className="locations-body">
      <div className="edit-bar">
        <span className="hint">
          {editMode ? 'Tap a system to edit, or add one.' : 'Tap a system to see its drawers.'}
        </span>
        <button className="link-btn" onClick={toggleEdit}>
          {editMode ? 'Done' : 'Edit layout'}
        </button>
      </div>
      <StorageOverview
        bins={bins}
        editMode={editMode}
        onSelect={selectBin}
        onEdit={(bin) => setEditing({ mode: 'edit', bin })}
        onAdd={() => setEditing({ mode: 'create' })}
      />
      {editModal}
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
      {tab === 'tackle' && <TackleTab />}
      {tab === 'storage' && (
        <StorageTab
          selectedId={selectedId}
          setSelectedId={setSelectedId}
          flashAddress={flashAddress}
          setFlashAddress={setFlashAddress}
        />
      )}
    </div>
  )
}
