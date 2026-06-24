// Quantity input for a part: an exact number, or a "Many" checkbox for when the
// exact count doesn't matter. Checking "Many" disables and clears the number.
export default function CountField({ count, setCount, isMany, setIsMany }) {
  return (
    <label className="field">
      <span>Count <em className="muted">(optional)</em></span>
      <div className="count-field">
        <input
          type="number"
          min="0"
          inputMode="numeric"
          value={isMany ? '' : count}
          onChange={(e) => setCount(e.target.value)}
          disabled={isMany}
          placeholder="—"
        />
        <label className="count-many">
          <input type="checkbox" checked={isMany} onChange={(e) => setIsMany(e.target.checked)} />
          <span>Many</span>
        </label>
      </div>
    </label>
  )
}
