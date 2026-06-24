// Turn a structured location_ref (positions.location_ref on the API) into a "take me
// there" route, or null when the container has no physical spot to fly to
// (benched/freeform — the location text already tells you where to look). Shared by
// the search results and the container detail page.
export function takeMeThereTo(ref) {
  if (!ref) return null
  if (ref.kind === 'wall') {
    // A wall slot's cabinet is either placed on the 3x4 wall (Wall tab) or a
    // standalone grid fixture (Storage tab); `placed` decides which tab to open.
    const tab = ref.placed === false ? 'storage' : 'wall'
    return `/locations?tab=${tab}&bin=${ref.bin_id}&address=${encodeURIComponent(ref.address)}`
  }
  if (ref.kind === 'chest') {
    return `/locations?tab=tackle`
  }
  if (ref.kind === 'nested') {
    return `/containers/${ref.parent_container_id}`
  }
  return null
}
