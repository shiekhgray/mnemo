import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import api from '../api/client'
import ConfirmModal from './ConfirmModal'

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'

// Client-side twin of positions.addresses_for_grid: walk bands top->bottom with
// continuous row numbering and per-row column letters. Used to preview a grid and
// to compute an edit's blast radius (which addresses disappear) before saving.
function addressesForGrid(gridSpec) {
  const out = []
  let row = 1
  for (const band of gridSpec || []) {
    for (let r = 0; r < band.rows; r++) {
      for (let c = 0; c < band.cols; c++) out.push(`${LETTERS[c]}${row}`)
      row++
    }
  }
  return out
}

// Row height weight, matching LocationsPage.rowFlex (narrow rows shorter than wide).
function rowFlex(cols) {
  return cols > 4 ? 1 / 8 : 1 / 6
}

// A non-interactive sketch of a grid_spec, same look as the wall's MiniCabinet but
// driven straight from bands rather than a bin's slots.
function GridPreview({ gridSpec }) {
  const rows = useMemo(() => {
    const out = []
    for (const band of gridSpec || []) {
      for (let r = 0; r < band.rows; r++) out.push(band.cols)
    }
    return out
  }, [gridSpec])
  return (
    <div className="mini-cabinet preview">
      {rows.map((cols, i) => (
        <div key={i} className="mini-row" style={{ flex: rowFlex(cols) }}>
          {Array.from({ length: cols }, (_, c) => (
            <span key={c} className="mini-cell" />
          ))}
        </div>
      ))}
    </div>
  )
}

// A compact picker of the wall's cells for placing/moving a cabinet. Bounds are the
// current extent of the wall plus one extra row and column so you can grow it. Cells
// occupied by *other* cabinets show their code; tapping one swaps (move_bin swaps on
// collision). `self` (the cabinet being edited) is excluded from occupancy.
function WallCellPicker({ bins, selfId, value, onPick }) {
  const others = bins.filter((b) => b.id !== selfId && b.wall_row && b.wall_col)
  const maxRow = Math.max(1, ...others.map((b) => b.wall_row))
  const maxCol = Math.max(1, ...others.map((b) => b.wall_col))
  const rows = maxRow + 1
  const cols = maxCol + 1
  const occupant = (r, c) => others.find((b) => b.wall_row === r && b.wall_col === c)
  return (
    <div className="cell-picker" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
      {Array.from({ length: rows }, (_, ri) =>
        Array.from({ length: cols }, (_, ci) => {
          const r = ri + 1
          const c = ci + 1
          const occ = occupant(r, c)
          const selected = value && value.row === r && value.col === c
          return (
            <button
              type="button"
              key={`${r}-${c}`}
              className={`cell-pick${selected ? ' selected' : ''}${occ ? ' taken' : ''}`}
              onClick={() => onPick({ row: r, col: c })}
              title={occ ? `Swap with ${occ.code}` : `Row ${r}, col ${c}`}
            >
              {occ ? occ.code : selected ? '●' : ''}
            </button>
          )
        }),
      )}
    </div>
  )
}

// Create or edit a wall cabinet. `mode` is 'create' (placed at `cell`) or 'edit'
// (acting on `bin`). On any successful change, onSaved() is called so the parent can
// invalidate ['bins'] and close.
export default function CabinetEditModal({ mode, bin, cell, bins, onClose, onSaved }) {
  const isEdit = mode === 'edit'
  const { data: presets = [] } = useQuery({
    queryKey: ['presets'],
    queryFn: async () => (await api.get('/presets')).data,
  })

  const [label, setLabel] = useState(bin?.label || '')
  const [preset, setPreset] = useState(bin?.type || 'all-narrow')
  const [pos, setPos] = useState(
    isEdit && bin.wall_row ? { row: bin.wall_row, col: bin.wall_col } : cell || null,
  )
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [confirm, setConfirm] = useState(null) // { title, message } for destructive save
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  const presetSpec = useMemo(
    () => presets.find((p) => p.name === preset)?.grid_spec,
    [presets, preset],
  )

  // For an edit, which occupied drawers would the new grid bench? Surviving
  // addresses keep their occupant; removed ones bump (positions.reconcile_bin_slots).
  const bumped = useMemo(() => {
    if (!isEdit || !presetSpec || preset === bin.type) return []
    const surviving = new Set(addressesForGrid(presetSpec))
    return bin.slots.filter((s) => s.occupant_id && !surviving.has(s.address))
  }, [isEdit, presetSpec, preset, bin])

  async function doSave() {
    setSaving(true)
    setError('')
    try {
      if (isEdit) {
        const body = { label: label.trim() || null }
        if (preset !== bin.type) body.preset = preset
        await api.put(`/bins/${bin.id}`, body)
        const moved = pos && (pos.row !== bin.wall_row || pos.col !== bin.wall_col)
        if (moved) {
          await api.post(`/bins/${bin.id}/move`, { wall_row: pos.row, wall_col: pos.col })
        }
      } else {
        await api.post('/bins', {
          label: label.trim() || null,
          preset,
          wall_row: pos?.row ?? null,
          wall_col: pos?.col ?? null,
        })
      }
      onSaved()
    } catch (err) {
      setError(err.response?.data?.detail ?? 'Could not save')
      setSaving(false)
      setConfirm(null)
    }
  }

  function onSubmit(e) {
    e.preventDefault()
    if (bumped.length > 0) {
      setConfirm({
        title: 'Reshape this cabinet?',
        message: `Switching to “${preset}” removes ${bumped.length} occupied drawer${
          bumped.length === 1 ? '' : 's'
        }; ${bumped.length === 1 ? 'its' : 'their'} container${
          bumped.length === 1 ? '' : 's'
        } will be benched (not deleted).`,
      })
    } else {
      doSave()
    }
  }

  async function doDelete() {
    setSaving(true)
    try {
      await api.delete(`/bins/${bin.id}`)
      onSaved()
    } catch (err) {
      setError(err.response?.data?.detail ?? 'Could not delete')
      setSaving(false)
      setConfirmingDelete(false)
    }
  }

  const occupiedCount = isEdit ? bin.slots.filter((s) => s.occupant_id).length : 0
  const drawerCount = presetSpec ? addressesForGrid(presetSpec).length : 0

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal card" onMouseDown={(e) => e.stopPropagation()}>
        <h3>{isEdit ? 'Edit cabinet' : 'Add cabinet'}</h3>
        <form onSubmit={onSubmit}>
          <label className="field">
            <span>Name</span>
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. Cabinet 13"
              autoFocus
            />
          </label>

          <div className="field">
            <span>Grid</span>
            <div className="preset-pick">
              {presets.map((p) => (
                <button
                  type="button"
                  key={p.name}
                  className={`preset-opt${preset === p.name ? ' active' : ''}`}
                  onClick={() => setPreset(p.name)}
                >
                  <GridPreview gridSpec={p.grid_spec} />
                  <span className="preset-name">{p.name}</span>
                </button>
              ))}
            </div>
            {drawerCount > 0 && (
              <em className="muted">
                {drawerCount} drawers
                {bumped.length > 0 && ` · ${bumped.length} occupied will be benched`}
              </em>
            )}
          </div>

          <div className="field">
            <span>Wall position {isEdit && <em className="muted">(tap to move)</em>}</span>
            <WallCellPicker bins={bins} selfId={bin?.id} value={pos} onPick={setPos} />
          </div>

          {error && <p className="error">{error}</p>}
          <div className="modal-actions">
            <button type="button" className="btn-secondary" onClick={onClose} disabled={saving}>
              Cancel
            </button>
            <button type="submit" disabled={saving || !pos}>
              {saving ? 'Saving…' : isEdit ? 'Save' : 'Create'}
            </button>
          </div>
        </form>

        {isEdit && (
          <button
            type="button"
            className="danger"
            onClick={() => {
              setError('')
              setConfirmingDelete(true)
            }}
          >
            Delete cabinet
          </button>
        )}
      </div>

      {confirm && (
        <ConfirmModal
          title={confirm.title}
          message={confirm.message}
          confirmLabel="Apply"
          busy={saving}
          onClose={() => setConfirm(null)}
          onConfirm={doSave}
        />
      )}

      {confirmingDelete && (
        <ConfirmModal
          title="Delete this cabinet?"
          message={
            occupiedCount > 0
              ? `${occupiedCount} occupied drawer${
                  occupiedCount === 1 ? '' : 's'
                } will be benched (containers kept), then the cabinet is removed.`
              : 'This empty cabinet will be removed.'
          }
          confirmLabel="Delete"
          busy={saving}
          onClose={() => setConfirmingDelete(false)}
          onConfirm={doDelete}
        />
      )}
    </div>
  )
}
