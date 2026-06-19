Load context at the start of a new session before beginning work.

1. Read `CLAUDE.md` in full — this is the canonical architecture reference. Read `api/CLAUDE.md` /
   `web/CLAUDE.md` too if they exist.

2. Read the most recent session record in `project_history/` (the newest `YYYY-MM-DD.md`) to see
   where the last session left off — what shipped, open decisions, and the "what's up next" notes.

3. Based on what's next, proactively read the directly relevant source files. For example:
   - API work: `api/app/models.py`, `api/app/positions.py`, the relevant `api/app/routers/*.py`
   - Frontend work: the relevant `web/src/pages/*.jsx` and `web/src/api/client.js`
   - Infra work: `docker-compose.yml`, the Dockerfiles, `nginx/mnemo.conf`

4. Write a brief session briefing to the user:
   - Where we left off (from the latest history entry)
   - The next task(s) to tackle
   - Anything flagged from the previous session to keep in mind
   - A suggested first action to get moving
