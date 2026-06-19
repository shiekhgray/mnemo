import { useState } from 'react'
import api from '../api/client'

export default function ChangePasswordModal({ onClose }) {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    if (next.length < 8) { setError('New password must be at least 8 characters'); return }
    if (next !== confirm) { setError('New passwords do not match'); return }
    setLoading(true)
    try {
      await api.post('/auth/change-password', { current_password: current, new_password: next })
      setDone(true)
    } catch (err) {
      setError(err.response?.data?.detail ?? 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal card" onMouseDown={(e) => e.stopPropagation()}>
        <h3>Change password</h3>
        {done ? (
          <>
            <p className="modal-success">Password updated.</p>
            <div className="modal-actions">
              <button onClick={onClose}>Done</button>
            </div>
          </>
        ) : (
          <form onSubmit={handleSubmit}>
            <label className="field">
              <span>Current password</span>
              <input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoFocus required />
            </label>
            <label className="field">
              <span>New password</span>
              <input type="password" value={next} onChange={(e) => setNext(e.target.value)} required />
            </label>
            <label className="field">
              <span>Confirm new password</span>
              <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
            </label>
            {error && <p className="error">{error}</p>}
            <div className="modal-actions">
              <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
              <button type="submit" disabled={loading}>{loading ? 'Saving…' : 'Update password'}</button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
