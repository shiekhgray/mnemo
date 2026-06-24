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

// A non-interactive sketch of a grid_spec, same look (and the same band-slice row
// weighting) as the wall's MiniCabinet, but driven straight from bands rather than a
// bin's slots — so the preview is WYSIWYG against the finder.
function GridPreview({ gridSpec }) {
  const rows = useMemo(() => {
    const spec = gridSpec || []
    const out = []
    for (const band of spec) {
      const w = 1 / spec.length / band.rows // each band an equal vertical slice
      for (let r = 0; r < band.rows; r++) out.push({ cols: band.cols, flex: w })
    }
    return out
  }, [gridSpec])
  return (
    <div className="mini-cabinet preview">
      {rows.map((row, i) => (
        <div key={i} className="mini-row" style={{ flex: row.flex }}>
          {Array.from({ length: row.cols }, (_, c) => (
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

// Create or edit a grid fixture. `mode` is 'create' (placed at `cell`) or 'edit'
// (acting on `bin`). With `standalone`, the fixture lives off the wall (a "storage
// system" — same Bin grid model, just no wall position), so the wall-cell picker is
// hidden and saving doesn't require a position. On any successful change, onSaved()
// is called so the parent can invalidate ['bins'] and close.
export default function CabinetEditModal({ mode, bin, cell, bins, standalone = false, onClose, onSaved }) {
  const isEdit = mode === 'edit'
  const noun = standalone ? 'storage system' : 'cabinet'
  const { data: presets = [] } = useQuery({
    queryKey: ['presets'],
    queryFn: async () => (await api.get('/presets')).data,
  })

  const [label, setLabel] = useState(bin?.label || '')
  // `preset` is a preset name or the literal 'custom'; `bands` holds the working band
  // list while custom (seeded from whatever grid was selected when you switched in).
  const [preset, setPreset] = useState(bin?.type || 'all-narrow')
  const [bands, setBands] = useState(() =>
    bin?.type === 'custom' && Array.isArray(bin.grid_spec)
      ? bin.grid_spec.map((b) => ({ ...b }))
      : null,
  )
  const [pos, setPos] = useState(
    isEdit && bin.wall_row ? { row: bin.wall_row, col: bin.wall_col } : cell || null,
  )
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [confirm, setConfirm] = useState(null) // { title, message } for destructive save
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  // The effective grid_spec: the named preset's bands, or the custom band list.
  const presetSpec = useMemo(() => {
    if (preset === 'custom') return bands
    return presets.find((p) => p.name === preset)?.grid_spec
  }, [presets, preset, bands])

  // Switching to custom seeds the band editor from the currently-shown grid so it's a
  // starting point to tweak, not a blank slate.
  function pickPreset(name) {
    if (name === 'custom' && !bands) {
      const seed = presetSpec && presetSpec.length ? presetSpec : [{ cols: 4, rows: 4 }]
      setBands(seed.map((b) => ({ ...b })))
    }
    setPreset(name)
  }

  function updateBand(i, key, raw) {
    const max = key === 'cols' ? LETTERS.length : 99
    const v = Math.max(1, Math.min(max, Number(raw) || 1))
    setBands((bs) => bs.map((b, j) => (j === i ? { ...b, [key]: v } : b)))
  }
  const addBand = () => setBands((bs) => [...bs, { cols: 4, rows: 1 }])
  const removeBand = (i) => setBands((bs) => bs.filter((_, j) => j !== i))

  // For an edit, which occupied drawers would the new grid bench? Surviving addresses
  // keep their occupant; removed ones bump (positions.reconcile_bin_slots). When the
  // grid is unchanged every current address survives, so this is naturally empty.
  const bumped = useMemo(() => {
    if (!isEdit || !presetSpec) return []
    const surviving = new Set(addressesForGrid(presetSpec))
    return bin.slots.filter((s) => s.occupant_id && !surviving.has(s.address))
  }, [isEdit, presetSpec, bin])

  async function doSave() {
    setSaving(true)
    setError('')
    try {
      const gridBody = preset === 'custom' ? { grid_spec: bands } : { preset }
      if (isEdit) {
        const body = { label: label.trim() || null }
        // Send the grid only when it could have changed (a preset switch, or any
        // custom edit) so a label-only save doesn't needlessly reconcile slots.
        if (preset === 'custom' || preset !== bin.type) Object.assign(body, gridBody)
        await api.put(`/bins/${bin.id}`, body)
        const moved = pos && (pos.row !== bin.wall_row || pos.col !== bin.wall_col)
        if (moved) {
          await api.post(`/bins/${bin.id}/move`, { wall_row: pos.row, wall_col: pos.col })
        }
      } else {
        await api.post('/bins', {
          label: label.trim() || null,
          ...gridBody,
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
        message: `The new grid removes ${bumped.length} occupied drawer${
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
        <h3>{isEdit ? `Edit ${noun}` : `Add ${noun}`}</h3>
        <form onSubmit={onSubmit}>
          <label className="field">
            <span>Name</span>
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder={standalone ? 'e.g. Printer chest' : 'e.g. Cabinet 13'}
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
                  onClick={() => pickPreset(p.name)}
                >
                  <GridPreview gridSpec={p.grid_spec} />
                  <span className="preset-name">{p.name}</span>
                </button>
              ))}
              <button
                type="button"
                className={`preset-opt${preset === 'custom' ? ' active' : ''}`}
                onClick={() => pickPreset('custom')}
              >
                <GridPreview gridSpec={bands || [{ cols: 4, rows: 4 }]} />
                <span className="preset-name">custom</span>
              </button>
            </div>

            {preset === 'custom' && bands && (
              <div className="band-editor">
                {bands.map((b, i) => (
                  <div className="band-row" key={i}>
                    <label>
                      cols
                      <input
                        type="number"
                        min="1"
                        max={LETTERS.length}
                        value={b.cols}
                        onChange={(e) => updateBand(i, 'cols', e.target.value)}
                      />
                    </label>
                    <label>
                      rows
                      <input
                        type="number"
                        min="1"
                        value={b.rows}
                        onChange={(e) => updateBand(i, 'rows', e.target.value)}
                      />
                    </label>
                    <button
                      type="button"
                      className="band-rm"
                      onClick={() => removeBand(i)}
                      disabled={bands.length === 1}
                      aria-label="Remove band"
                    >
                      ×
                    </button>
                  </div>
                ))}
                <button type="button" className="link-btn band-add" onClick={addBand}>
                  + Add band
                </button>
              </div>
            )}

            {drawerCount > 0 && (
              <em className="muted">
                {drawerCount} drawers
                {bumped.length > 0 && ` · ${bumped.length} occupied will be benched`}
              </em>
            )}
          </div>

          {!standalone && (
            <div className="field">
              <span>Wall position {isEdit && <em className="muted">(tap to move)</em>}</span>
              <WallCellPicker bins={bins} selfId={bin?.id} value={pos} onPick={setPos} />
            </div>
          )}

          {error && <p className="error">{error}</p>}
          <div className="modal-actions">
            <button type="button" className="btn-secondary" onClick={onClose} disabled={saving}>
              Cancel
            </button>
            <button type="submit" disabled={saving || (!standalone && !pos)}>
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
            Delete {noun}
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
          title={`Delete this ${noun}?`}
          message={
            occupiedCount > 0
              ? `${occupiedCount} occupied drawer${
                  occupiedCount === 1 ? '' : 's'
                } will be benched (containers kept), then the ${noun} is removed.`
              : `This empty ${noun} will be removed.`
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
