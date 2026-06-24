# Mnemo API Reference

Hand-maintained reference for the FastAPI backend (`api/app/`). Routers are mounted at
the app root (no global `/api` prefix in FastAPI); the `/mnemo/api` you see externally is
added by nginx in front of the service.

- **Production base:** `https://dresdengray.com/mnemo/api`
- **Local base:** `http://127.0.0.1:8001`
- **Auth:** JWT Bearer. Every route below except `POST /auth/login` and
  `POST /auth/refresh` requires `Authorization: Bearer <access_token>`.
- **Bodies:** JSON unless noted. Routers accept/return plain dicts with hand-written
  `serialize()` helpers — there are no Pydantic response models.

---

## Auth — `/auth`

| Method | Path | Body | Notes |
| --- | --- | --- | --- |
| POST | `/auth/login` | **form-encoded** `username`, `password` | OAuth2 password form. Returns `{access_token, refresh_token, token_type}`. |
| POST | `/auth/refresh` | `{refresh_token}` | Returns `{access_token, token_type}`. |
| GET | `/auth/me` | — | `{id, username}` |
| POST | `/auth/change-password` | `{current_password, new_password}` | `new_password` ≥ 8 chars. `204` on success. |

> Login is `application/x-www-form-urlencoded`, not JSON (it uses
> `OAuth2PasswordRequestForm`). This is the usual gotcha.

---

## Parts — `/parts`

The serialized **part** shape:

```json
{ "id", "name", "category", "tags": [], "notes",
  "container_id", "container_label", "location" }
```

`location` is the resolved human-readable string (e.g. `"W-A3:A1"`, a freeform string,
a parent chain, or `"benched"`).

| Method | Path | Body | Notes |
| --- | --- | --- | --- |
| GET | `/parts/search?q=` | — | `q` min length 1. Forgiving ILIKE across **name + category + tags**, ordered by name, limited to 100. The primary use case. |
| GET | `/parts/{id}` | — | Single part. |
| POST | `/parts` | `{name*, container_id*, category?, tags?, notes?}` | `201`. `name` and `container_id` required. |
| PUT | `/parts/{id}` | partial `{name?, container_id?, category?, tags?, notes?}` | Only provided keys change. |
| DELETE | `/parts/{id}` | — | `204`. |

---

## Containers — `/containers`

The serialized **container** shape:

```json
{ "id", "label", "type", "slot_id", "freeform_location",
  "parent_container_id", "location", "benched", "part_count" }
```

`type` ∈ `wall_drawer | tackle_box | printed_box | freeform | other` (default `other`).
`benched` is true when no position field is set.

| Method | Path | Body | Notes |
| --- | --- | --- | --- |
| GET | `/containers` | — | All containers, ordered by label. |
| GET | `/containers/benched` | — | Containers with no position — "where did I leave this" / reorg worklist. |
| GET | `/containers/{id}` | — | Container plus `parts[]` (`{id,name,category,tags}`) and `children[]` (`{id,label}`). |
| GET | `/containers/{id}/location` | — | `{id, label, location}` — resolves slot / freeform / parent chain. |
| POST | `/containers` | `{label*, type?, <one position key>}` | `201`. See **Position semantics**. |
| PUT | `/containers/{id}` | partial `{label?, type?, <one position key>}` | See **Position semantics**. |
| POST | `/containers/{id}/assign-slot` | `{slot_id}` | Assigns to a slot, **atomically bumping** any current occupant to benched. |
| POST | `/containers/{id}/bench` | — | Explicitly clears position (deliberate reorg). |
| DELETE | `/containers/{id}` | — | `204`. **Parts cascade-delete** with the container. `400` if it has nested children (move them first). |

### Position semantics (`positions.apply_position`)

A container's position is **at most one of** `slot_id` / `parent_container_id` /
`freeform_location`; none set = **benched**. On create/update:

- Provide **at most one** position key. More than one → `400`.
- A position key present but `null`/`""` → **bench** the container.
- No position key present → **leave position as-is**.
- `slot_id` → `assign_slot` (unique slot; bumps occupant atomically).
- `parent_container_id` → `assign_parent` (**nesting capped at 2 levels**; a container
  with a parent can't be a parent; a container with children can't be nested).
- `freeform_location` → free text.

---

## Layout (bins / chests / slots)

Read-only. No prefix on this router. There is **no create/update for bins, chests, or
slots via the API** — physical storage is defined by `api/scripts/seed_storage.py`.

The serialized **slot** shape (shared by all three):

```json
{ "id", "kind", "label", "address", "drawer_number",
  "box_position", "occupant_id", "occupant_label" }
```

`label` is the human address (`"W-B2:C3"` for wall, `"Tackle chest · drawer 3 · front"`
for chest). For wall slots `address` is `<col letter><row number>` (e.g. `C3`).

| Method | Path | Returns |
| --- | --- | --- |
| GET | `/bins` | `[{id, code, label, type, wall_row, wall_col, slots:[slot]}]`, ordered by code. |
| GET | `/chests` | `[{id, label, num_drawers, slots:[slot]}]`. |
| GET | `/slots?available_only=` | All slots (or only unoccupied). Wall slots first, then chest, each by label. |

- Bin `type` ∈ `all-narrow | all-wide | half-half` (drives the slot grid; see
  `seed_storage.py` and `prd/mnemo.prd`).
- The slot grid for a bin can be reconstructed on the client from the slot `address`es
  (column letters × row numbers) — useful for the visual location finder
  (`prd/locations.prd`) without any new endpoint.
