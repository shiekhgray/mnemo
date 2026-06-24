# mnemo

A (fully vibecoded) single-user electronics parts inventory for a home Linux server. Answers one question well:
**"Do I already have this part, and where is it?"** — optimized for fast, forgiving search from a
phone. See [`prd/mnemo.prd`](prd/mnemo.prd) for the full product definition, and
[`prd/locations.prd`](prd/locations.prd) for the visual location-finder feature.

## Stack

- **api/** — FastAPI + SQLAlchemy + Alembic, Postgres, JWT auth
- **web/** — React + Vite (mobile-first), served under `/mnemo/`
- **docker-compose.yml** — `db` (postgres:16) + `api` + `web`; `nginx/mnemo.conf` for subpath deploy

## Quick start

```bash
cp .env.example .env          # set DB_PASSWORD and SECRET_KEY
docker compose up --build -d

# initialize the database
docker compose exec api alembic upgrade head
docker compose exec api python scripts/seed_users.py graham <password>
docker compose exec api python scripts/seed_storage.py   # edit the wall layout in this script first
```

The web app is then served at `/mnemo/` (proxied by nginx) — API at `/mnemo/api`. For local
development without nginx, the API is on `127.0.0.1:8001` and the Vite dev server on `127.0.0.1:5174`.

See [`CLAUDE.md`](CLAUDE.md) for architecture and the domain rules.
