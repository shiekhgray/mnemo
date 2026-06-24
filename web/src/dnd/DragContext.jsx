import {
  createContext, useCallback, useContext, useMemo, useRef, useState,
} from 'react'
import { useQueryClient } from '@tanstack/react-query'
import api from '../api/client'

/*
 * Pointer-events drag system for reorganizing containers (prd/drag-reorg.prd).
 *
 * HTML5 drag-and-drop doesn't work on touch, so this is built on Pointer Events
 * and works identically with finger and mouse. The central interaction detail is
 * tap-vs-drag discrimination: a short tap still does what it always did, a plain
 * drag still scrolls the page, and only a *press-and-hold* lifts a container.
 *
 * Architecture:
 *  - `useDraggable(item, { onTap })` owns one drag source. It runs the long-press
 *    timer and the tap/scroll/drag decision, then forwards raw pointer coords to
 *    the provider's imperative API (dragStart/dragMove/dragEnd).
 *  - The provider owns the floating ghost, hit-tests drop targets via
 *    elementFromPoint against `data-drop-id` attributes, toggles a highlight class
 *    directly on the hovered DOM node (kept out of React's render path so a
 *    64-cell cabinet stays smooth), and performs the resolved mutation with an
 *    optimistic `['bins']` update + rollback + an Undo toast.
 *
 * Drop targets render: data-drop-id (change-detection key), data-drop-kind
 * ("slot" | "bench"), and for slots data-slot-id + data-occupant-id.
 */

const LONG_PRESS_MS = 350
const MOVE_CANCEL_PX = 12

const DragCtx = createContext(null)

// eslint-disable-next-line react-refresh/only-export-components
export function useDrag() {
  const ctx = useContext(DragCtx)
  if (!ctx) throw new Error('useDrag must be used inside <DragProvider>')
  return ctx
}

// --- optimistic cache helpers (operate on the ['bins'] wall snapshot) ----------

function withSlotOccupant(bins, slotId, occupant) {
  // occupant === null clears the slot; otherwise {id, label}.
  return bins.map((b) => ({
    ...b,
    slots: b.slots.map((s) =>
      s.id === slotId
        ? {
            ...s,
            occupant_id: occupant ? occupant.id : null,
            occupant_label: occupant ? occupant.label : null,
          }
        : s,
    ),
  }))
}

// Resolve what dropping `item` on `targetEl` would do, or null for a no-op.
function computeDrop(item, targetEl) {
  if (!targetEl) return null
  const kind = targetEl.getAttribute('data-drop-kind')

  if (kind === 'bench') {
    // A benched chip dropped back on the bench is a no-op; only placed drawers bench.
    if (item.fromSlotId == null) return null
    return { type: 'bench' }
  }

  if (kind === 'slot') {
    const slotId = Number(targetEl.getAttribute('data-slot-id'))
    const occAttr = targetEl.getAttribute('data-occupant-id')
    const occupantId = occAttr ? Number(occAttr) : null
    if (slotId === item.fromSlotId) return null // dropped on its own slot
    if (occupantId === item.containerId) return null // already here (stale dup listing)
    if (occupantId == null) return { type: 'move', slotId }
    const occupantLabel = targetEl.getAttribute('data-occupant-label') || 'a container'
    // Placed drawer onto occupied → true swap. Benched chip onto occupied → the
    // existing assign-bump (chip takes the slot, occupant goes to the bench).
    return {
      type: item.fromSlotId != null ? 'swap' : 'bump',
      slotId,
      occupantId,
      occupantLabel,
    }
  }
  return null
}

const HIGHLIGHT_CLASS = {
  move: 'drop-move',
  swap: 'drop-swap',
  bump: 'drop-swap',
  bench: 'drop-bench',
}

// With Pointer Events, scrolling is governed by `touch-action`, NOT preventDefault:
// a pointermove handler can't stop the page from panning, so the first finger-move
// after a lift pans the page and fires pointercancel, killing the drag. Touch events
// *can* be prevented, so we block the native (non-passive) touchmove for the duration
// of a drag only — a plain swipe (no lift) still scrolls normally.
function blockTouchScroll(e) {
  e.preventDefault()
}

export function DragProvider({ children }) {
  const qc = useQueryClient()
  const [dragItem, setDragItem] = useState(null) // {kind, containerId, label, fromSlotId}
  const [toast, setToast] = useState(null) // {message, undo}

  const ghostRef = useRef(null)
  const hoverElRef = useRef(null) // currently highlighted DOM node
  const dropRef = useRef(null) // resolved {type, ...} for pointerup
  const itemRef = useRef(null) // dragItem, in a ref for the imperative handlers
  const toastTimer = useRef(null)

  const showToast = useCallback((message, undo) => {
    if (toastTimer.current) clearTimeout(toastTimer.current)
    setToast({ message, undo })
    toastTimer.current = setTimeout(() => setToast(null), 6000)
  }, [])

  const dismissToast = useCallback(() => {
    if (toastTimer.current) clearTimeout(toastTimer.current)
    setToast(null)
  }, [])

  const clearHighlight = useCallback(() => {
    if (hoverElRef.current) {
      hoverElRef.current.classList.remove('drop-move', 'drop-swap', 'drop-bench')
      hoverElRef.current = null
    }
    dropRef.current = null
  }, [])

  // --- the mutation performed on release ---------------------------------------

  const invalidate = useCallback(() => {
    qc.invalidateQueries({ queryKey: ['bins'] })
    qc.invalidateQueries({ queryKey: ['benched'] })
  }, [qc])

  const performDrop = useCallback(
    async (item, drop) => {
      if (!drop) return
      const snapshot = qc.getQueryData(['bins'])
      const occupant = { id: item.containerId, label: item.label }
      let request
      let undo
      let message

      if (drop.type === 'move') {
        qc.setQueryData(['bins'], (bins) => {
          let next = bins
          if (item.fromSlotId != null) next = withSlotOccupant(next, item.fromSlotId, null)
          return withSlotOccupant(next, drop.slotId, occupant)
        })
        request = () =>
          api.post(`/containers/${item.containerId}/assign-slot`, { slot_id: drop.slotId })
        undo = () =>
          item.fromSlotId != null
            ? api.post(`/containers/${item.containerId}/assign-slot`, { slot_id: item.fromSlotId })
            : api.post(`/containers/${item.containerId}/bench`)
        message = `Moved ${item.label}`
      } else if (drop.type === 'bench') {
        qc.setQueryData(['bins'], (bins) => withSlotOccupant(bins, item.fromSlotId, null))
        request = () => api.post(`/containers/${item.containerId}/bench`)
        undo = () =>
          api.post(`/containers/${item.containerId}/assign-slot`, { slot_id: item.fromSlotId })
        message = `Benched ${item.label}`
      } else if (drop.type === 'swap') {
        qc.setQueryData(['bins'], (bins) => {
          let next = withSlotOccupant(bins, item.fromSlotId, {
            id: drop.occupantId,
            label: drop.occupantLabel,
          })
          return withSlotOccupant(next, drop.slotId, occupant)
        })
        request = () =>
          api.post(`/containers/${item.containerId}/swap-slot`, {
            slot_id: drop.slotId,
            expected_source_slot_id: item.fromSlotId,
          })
        // After the swap, item.containerId sits in drop.slotId; swapping it with
        // its old slot restores both.
        undo = () =>
          api.post(`/containers/${item.containerId}/swap-slot`, { slot_id: item.fromSlotId })
        message = `Swapped ${item.label} ⇄ ${drop.occupantLabel}`
      } else if (drop.type === 'bump') {
        // Benched chip onto an occupied drawer: chip takes the slot, occupant benched.
        qc.setQueryData(['bins'], (bins) => withSlotOccupant(bins, drop.slotId, occupant))
        request = () =>
          api.post(`/containers/${item.containerId}/assign-slot`, { slot_id: drop.slotId })
        // Undo: put the bumped occupant back, which re-benches our chip.
        undo = () =>
          api.post(`/containers/${drop.occupantId}/assign-slot`, { slot_id: drop.slotId })
        message = `Placed ${item.label}, benched ${drop.occupantLabel}`
      } else {
        return
      }

      try {
        await request()
        invalidate()
        showToast(message, async () => {
          dismissToast()
          try {
            await undo()
          } finally {
            invalidate()
          }
        })
      } catch {
        qc.setQueryData(['bins'], snapshot) // rollback
        invalidate()
        showToast('Move failed — nothing changed', null)
      }
    },
    [qc, invalidate, showToast, dismissToast],
  )

  // --- imperative API driven by useDraggable -----------------------------------

  const dragStart = useCallback((item, x, y) => {
    itemRef.current = item
    setDragItem(item)
    document.body.classList.add('dnd-dragging')
    // Stop the page panning out from under an active drag (see blockTouchScroll).
    document.addEventListener('touchmove', blockTouchScroll, { passive: false })
    // Position the ghost on the next frame, once it's mounted.
    requestAnimationFrame(() => {
      if (ghostRef.current) ghostRef.current.style.transform = `translate(${x}px, ${y}px)`
    })
  }, [])

  const dragMove = useCallback((x, y) => {
    if (ghostRef.current) ghostRef.current.style.transform = `translate(${x}px, ${y}px)`
    // The ghost has pointer-events:none, so elementFromPoint sees through it.
    const under = document.elementFromPoint(x, y)
    const target = under ? under.closest('[data-drop-id]') : null
    if (target === hoverElRef.current) return
    clearHighlight()
    const drop = computeDrop(itemRef.current, target)
    dropRef.current = drop
    if (target && drop) {
      target.classList.add(HIGHLIGHT_CLASS[drop.type])
      hoverElRef.current = target
    }
  }, [clearHighlight])

  const finish = useCallback(() => {
    document.body.classList.remove('dnd-dragging')
    document.removeEventListener('touchmove', blockTouchScroll, { passive: false })
    setDragItem(null)
    itemRef.current = null
  }, [])

  const dragEnd = useCallback(() => {
    const item = itemRef.current
    const drop = dropRef.current
    clearHighlight()
    finish()
    if (item && drop) performDrop(item, drop)
  }, [clearHighlight, finish, performDrop])

  const dragCancel = useCallback(() => {
    clearHighlight()
    finish()
  }, [clearHighlight, finish])

  const value = useMemo(
    () => ({
      draggingId: dragItem ? dragItem.containerId : null,
      isDragging: dragItem != null,
      dragStart,
      dragMove,
      dragEnd,
      dragCancel,
    }),
    [dragItem, dragStart, dragMove, dragEnd, dragCancel],
  )

  return (
    <DragCtx.Provider value={value}>
      {children}
      {dragItem && (
        <div ref={ghostRef} className="drag-ghost" aria-hidden="true">
          {dragItem.label}
        </div>
      )}
      {toast && (
        <div className="dnd-toast" role="status">
          <span>{toast.message}</span>
          {toast.undo && (
            <button type="button" className="dnd-undo" onClick={toast.undo}>
              Undo
            </button>
          )}
        </div>
      )}
    </DragCtx.Provider>
  )
}

/*
 * Hook for a drag source (a drawer cell or a bench chip). Spread the returned
 * props onto the element. `item` is {kind, containerId, label, fromSlotId};
 * `onTap` fires for a plain tap (no long-press, no scroll).
 */
// eslint-disable-next-line react-refresh/only-export-components
export function useDraggable(item, { onTap } = {}) {
  const { dragStart, dragMove, dragEnd, dragCancel } = useDrag()
  const state = useRef({ timer: null, startX: 0, startY: 0, started: false, moved: false, pointerId: null })

  const begin = useCallback(
    (el, x, y) => {
      state.current.started = true
      try {
        el.setPointerCapture(state.current.pointerId)
      } catch {
        /* capture may fail if the pointer is already gone — harmless */
      }
      dragStart(item, x, y)
    },
    [dragStart, item],
  )

  const onPointerDown = useCallback(
    (e) => {
      if (e.button != null && e.button !== 0) return // primary button / touch only
      const s = state.current
      s.startX = e.clientX
      s.startY = e.clientY
      s.started = false
      s.moved = false
      s.pointerId = e.pointerId
      const el = e.currentTarget
      const { clientX, clientY } = e
      if (s.timer) clearTimeout(s.timer)
      // Press-and-hold to lift. We deliberately do NOT capture the pointer yet, so
      // a finger that moves before the timer fires scrolls the page normally.
      s.timer = setTimeout(() => {
        s.timer = null
        begin(el, clientX, clientY)
      }, LONG_PRESS_MS)
    },
    [begin],
  )

  const onPointerMove = useCallback(
    (e) => {
      const s = state.current
      if (s.started) {
        e.preventDefault() // suppress scroll/gestures while actively dragging
        dragMove(e.clientX, e.clientY)
        return
      }
      const dist = Math.hypot(e.clientX - s.startX, e.clientY - s.startY)
      if (dist > MOVE_CANCEL_PX) {
        s.moved = true // it's a scroll/swipe, not a press — abandon the lift
        if (s.timer) {
          clearTimeout(s.timer)
          s.timer = null
        }
      }
    },
    [dragMove],
  )

  const endPress = useCallback(
    (e) => {
      const s = state.current
      if (s.timer) {
        clearTimeout(s.timer)
        s.timer = null
      }
      if (s.started) {
        s.started = false
        dragEnd()
      } else if (!s.moved && onTap) {
        onTap(e)
      }
    },
    [dragEnd, onTap],
  )

  const onPointerCancel = useCallback(() => {
    const s = state.current
    if (s.timer) {
      clearTimeout(s.timer)
      s.timer = null
    }
    if (s.started) {
      s.started = false
      dragCancel()
    }
  }, [dragCancel])

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp: endPress,
    onPointerCancel,
    // A held press on mobile otherwise pops the context menu / text-selection
    // callout, which steals the gesture from the lift.
    onContextMenu: (e) => e.preventDefault(),
    style: { touchAction: 'manipulation' },
  }
}
