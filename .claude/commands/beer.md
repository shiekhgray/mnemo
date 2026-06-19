Save current session state before context clear.

1. Update the CLAUDE.md file(s) with anything learned this session. Edit whichever are relevant:
   - `CLAUDE.md` — architecture, domain rules (especially container/position logic), cross-cutting
     gotchas, commands
   - `api/CLAUDE.md` / `web/CLAUDE.md` — only if they exist; backend/frontend specifics, new routers,
     migration notes, React Query keys, conventions
   Only update sections that actually changed. Do not rewrite sections that are still accurate.

2. Write a session record to `project_history/YYYY-MM-DD.md` (use today's actual date). If a file for
   today already exists, append a new `## Session N` section. Include:
   - Features shipped or meaningfully progressed (what changed, not just that it changed)
   - Key decisions made and why (especially non-obvious tradeoffs)
   - Gotchas discovered
   - DB/infra changes (migrations run, seed-data changes, nginx/compose changes)
   - What's up next

3. Write a brief summary to the user of what was saved — what changed, and anything important to
   remember at the start of the next session.
