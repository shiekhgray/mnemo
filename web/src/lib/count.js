// A part's quantity is three-state: an exact `count`, `count_is_many` ("plenty"),
// or neither (unspecified). `countLabel` returns a short display string, or null
// when there's nothing to show.
export function countLabel(part) {
  if (part.count_is_many) return 'many'
  if (part.count != null) return `×${part.count}`
  return null
}

// The {count, count_is_many} payload a create/update request sends from the form's
// number string + "Many" checkbox.
export function countPayload(count, isMany) {
  return isMany
    ? { count: null, count_is_many: true }
    : { count: count === '' ? null : Number(count), count_is_many: false }
}

// Total physical items across a container's parts: the sum of every exact count.
// A "many" part has no number, so its presence is shown with a trailing "+".
// Returns null when no part has any quantity recorded (don't claim "0 items" when
// the truth is just "uncounted"). Parts left unspecified simply don't contribute.
export function itemTotalLabel(parts) {
  let sum = 0
  let hasMany = false
  let counted = false
  for (const p of parts ?? []) {
    if (p.count_is_many) { hasMany = true; counted = true }
    else if (p.count != null) { sum += p.count; counted = true }
  }
  if (!counted) return null
  if (sum === 0 && hasMany) return 'many items'
  const n = hasMany ? `${sum}+` : String(sum)
  return `${n} item${sum === 1 && !hasMany ? '' : 's'}`
}
