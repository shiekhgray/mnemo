# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`mnemo` is a single-user electronics parts inventory system for Graham's home Linux server.
It's a **lookup-first** tool answering one question: *"Do I already have this part, and where is
it?"* Fast, forgiving part search **from a phone** is the most important UX. Quantity/low-stock
tracking is explicitly **out of scope for v1**. The full product definition is in `mnemo.prd` — read
it for the rationale behind the rules below.

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
docker compose exec api python scripts/seed_storage.py          # wall bins + chests + their slots

# Frontend (from web/)
npm install
npm run dev        # local dev (proxies /mnemo/api to API_URL, default http://localhost:8001)
npm run lint
npm run build
```

There is no automated test suite yet. After backend changes, verify the app compiles
(`python -m py_compile app/*.py app/routers/*.py`) and migrations apply cleanly.

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

## Conventions

- Routers accept/return plain dicts with hand-written `serialize()` helpers (matching calliope);
  there are no Pydantic response models. Auth is enforced with
  `dependencies=[Depends(get_current_user)]` on each protected router.
- Alembic's `env.py` reads `DATABASE_URL` from the environment — credentials are never stored in
  `alembic.ini`.
- New tables/columns require a hand-written migration in `api/alembic/versions/` (autogenerate is
  available but review the output).
