# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`mnemo` is a single-user electronics parts inventory system for Graham's home Linux server.
It's a **lookup-first** tool answering one question: *"Do I already have this part, and where is
it?"* Fast, forgiving part search **from a phone** is the most important UX. Quantity/low-stock
tracking is explicitly **out of scope for v1**. The full product definition is in `prd/mnemo.prd` —
read it for the rationale behind the rules below. Feature PRDs live alongside it in `prd/` (e.g.
`prd/locations.prd`, the visual location finder).

## Stack & layout

Mirrors the sibling `calliope` project's stack (FastAPI + React + Postgres in Docker).

- `api/` — FastAPI + SQLAlchemy 2.0 + Alembic, Postgres via psycopg2, JWT auth (python-jose +
  bcrypt). App code in `api/app/`: `config.py`, `database.py`, `models.py`, `auth.py`,
  `positions.py`, `main.py`, and `routers/`. Migrations in `api/alembic/`, one-off seed scripts in
  `api/scripts/`. Ubuntu-based Dockerfile runs uvicorn.
- `web/` — React 19 + Vite + React Router 7 + TanStack Query + axios. Mobile-first. Served under the
  `/mnemo/` base path; `web/src/api/client.js` talks to `/mnemo/api`. node:22 Dockerfile runs the
  Vite dev server.
- `docker-compose.yml` — wires `db` (postgres:16) + `api` + `web`. `nginx/mnemo.conf` is the reverse
  proxy vhost for subpath deployment behind the home server's nginx.

Ports are offset from calliope to coexist on the same host: api `127.0.0.1:8001`, web
`127.0.0.1:5174`.

## Commands

```bash
# Bring up the whole stack
cp .env.example .env          # then edit DB_PASSWORD / SECRET_KEY
docker compose up --build -d

# Database migrations (run inside the api container)
docker compose exec api alembic upgrade head
docker compose exec api alembic revision -m "describe change"   # then edit the generated file

# Seed data (inside the api container)
docker compose exec api python scripts/seed_users.py <username> <password>
docker compose exec api python scripts/seed_storage.py          # additive: creates missing wall bins + chests + slots
docker compose exec api python scripts/reseed_wall.py           # REPLACE the wall with seed_storage.WALL_LAYOUT

# Frontend (from web/)
npm install
npm run dev        # local dev (proxies /mnemo/api to API_URL, default http://localhost:8001)
npm run lint
npm run build
```

There is no automated test suite yet. After backend changes, verify the app compiles
(`python -m py_compile app/*.py app/routers/*.py`) and migrations apply cleanly.

The `web` container bind-mounts `web/src` into `/app/src`, so frontend edits hot-reload live.
Git operations that rewrite the working tree while the stack is up (rebase, branch rename,
`git clean`) can leave the running container pointing at a stale inode — Vite then fails with
`Failed to load url /src/main.jsx`. Fix: `docker compose restart web`.

**The `api` container does NOT bind-mount** — Python code is baked into the image at build.
`docker compose restart api` keeps running the *old* code. To pick up backend edits (including
changes to `scripts/`), you must rebuild: `docker compose up -d --build api`. This bites when
editing a seed script and then running it inside the container — the container imports the
pre-edit version until rebuilt.

## Architecture — the domain rules that aren't obvious

Three core entities — **Bin**, **Container**, **Part** — plus **Chest** and **Slot**. The
non-trivial logic is all about how a Container is *positioned*, and it lives in
`api/app/positions.py` (location resolution, slot assignment, benching, the nesting cap). Routers
should call those helpers rather than re-implementing position logic.

**Container is the stable unit of tracking — not its position.** Move a container, update one
record, and everything inside follows. A Container's position is **at most one of**:
`slot_id` / `parent_container_id` / `freeform_location`; **none set = "benched."** This invariant is
enforced both in `positions.apply_position()` and by a DB `CHECK` constraint.

Behaviors that are easy to get wrong (all in `positions.py`):

- **Slots are unique** (`containers.slot_id` is a UNIQUE column). Assigning a container to an
  occupied slot **atomically bumps** the current occupant to benched — `assign_slot()` clears the
  occupant and `flush()`es before re-assigning so the unique constraint never trips.
- **Benching is otherwise manual.** Position is *"last known,"* not real-time truth. Two containers
  sharing a last-known slot from an un-logged move is an **expected, acceptable** state — a hint to
  the user, not an error to prevent. There's an explicit `/containers/{id}/bench` endpoint.
- **Nesting is capped at 2 levels.** A container with a parent cannot itself be a parent;
  `assign_parent()` enforces this. `resolve_location()` walks the chain part → container → parent →
  position.

**Bins vs. wall drawers:** A `Bin` defines a grid of *available* drawer-`Slot`s at one wall position
(3×4 wall). Each wall drawer is itself a `Container` occupying a slot. `Chest` drawers similarly
expose front/back `Slot`s for tackle boxes. Slots must be **seeded** (`seed_storage.py`) before
containers can be assigned. Bin types and their drawer grids are documented in that script; the exact
wall layout is the user's to edit there.

**Part search** (`routers/parts.py` `/parts/search`) is forgiving ILIKE across name + category +
tags — the primary use case. Category is a **free string** (suggestions offered via a datalist in
`web/src/constants.js`, not enforced).

**Location strings vs. `location_ref`.** `resolve_location()` produces the human string
(`slot_label()` shows the bin **label** like `Cabinet 1:A3` when set, else the code).
`location_ref()` (also in `positions.py`) is its structured twin: `{kind: wall|chest|nested|
freeform|benched, ...}` carried on search results and container serializers so the frontend can
navigate without parsing the display string. A wall ref also carries `placed` (`bin.wall_row is not
None`) so a "take me there" routes to the Wall vs Storage tab. The **Locations page**
(`web/src/pages/LocationsPage.jsx`, route `/locations`) is the visual finder built on it — a Wall tab
(wall-placed cabinet overview → detail + minimap, rendered straight from `GET /bins`), a Tackle tab
(drawer chests from `GET /chests`), and a **Storage tab** (standalone, off-wall grid fixtures). Both
search results **and the container detail page** (`ContainerPage.jsx`) get a "take me there" action —
the shared `web/src/lib/takeMeThere.js` maps a `location_ref` to a route — that teleports via
`?tab=&bin=&address=` and flashes the drawer.

**A `Bin` is the one generic 2D-grid fixture.** A wall cabinet (x/y) and a "storage system" (e.g. a
printer chest, a shelf) are the same model — a band-grid of slots — differing only in whether the bin
has a `wall_row`/`wall_col`. Placed bins → Wall tab; off-wall bins → Storage tab. `LocationsPage`
partitions `GET /bins` client-side on `wall_row`. (A `Chest` is *also* just a 2D grid — front/back ×
drawer — but it stays its own table/UI for the Tackle tab; folding it into `Bin` is a possible later
migration, not done.)

**Storage layout editor** (`prd/layout-editor.prd`) — the finder defaults to read-only, but Wall,
Tackle, and Storage each have an **"Edit layout"** toggle for *fixture* CRUD (Bins/Chests/Slots —
containers stay read-only here, that's drag-reorg). Cabinets *and* standalone storage systems share
`CabinetEditModal.jsx` (preset or custom band grid; a `standalone` prop hides the wall-cell placement
and lets a fixture save with no wall position — that's the "+ Add storage system" path); Chests:
`ChestEditModal.jsx` (label + drawer count). Backend is `routers/bins.py`
CRUD calling `positions.py` helpers; a cabinet's geometry is a **band list** (`bins.grid_spec` JSON,
`[{cols,rows},…]`) — `addresses_for_grid()` walks bands top→bottom (continuous row #s, per-row column
letters). Reshaping/shrinking **benches displaced occupants, never deletes** (`reconcile_bin/chest_slots`
returns `{added,removed,bumped}` for the UI's blast-radius confirm); the frontend recomputes that
client-side from the same band→address scheme for a confirm-*before*-apply. Row heights render from the
band model (`LocationsPage.rowWeights`: each band an equal vertical slice, split evenly among its rows —
reproduces the three Akro-Mils presets and any custom grid). Presets come from `GET /presets`.

**The real wall** is one wall, 3 cols × 4 rows of 12 Akro-Mils units numbered **Cabinet 1–12** in
reading order, encoded in `seed_storage.py`'s `WALL_LAYOUT`. The photo-derived layout/geometry lives
in the **git-ignored** `docs/WALL.md` (alongside `wall_photos/` and `bulkimport.py`, all ignored as
personal data). Per-drawer positions are only parsed for Cabinet 1 so far; everything else is still
`freeform_location = "Cabinet N"` pending parsing.

## Conventions

- Routers accept/return plain dicts with hand-written `serialize()` helpers (matching calliope);
  there are no Pydantic response models. Auth is enforced with
  `dependencies=[Depends(get_current_user)]` on each protected router.
- Alembic's `env.py` reads `DATABASE_URL` from the environment — credentials are never stored in
  `alembic.ini`.
- New tables/columns require a hand-written migration in `api/alembic/versions/` (autogenerate is
  available but review the output).
- **Auth tokens:** access token lasts `access_token_expire_minutes` (12h), refresh token 30 days.
  `web/src/api/client.js` does a **single-flight** refresh on 401 and only wipes the session when
  `/auth/refresh` itself returns 401 — a transient network/5xx failure leaves tokens intact so a
  flaky connection doesn't surprise-log-out a still-valid session.
