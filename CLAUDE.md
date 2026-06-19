# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project status

This repo currently contains **only a product definition** (`mnemo.prd`) — no code, no chosen
tech stack, no build/test tooling. `mnemo` is an electronics parts inventory system for a single
user (Graham) on a home Linux server. There are no build/lint/test commands to document yet; add
them here once a stack is chosen and scaffolded.

**Before writing any implementation code, the stack and several behaviors are undecided** — see
"Decisions to confirm before building" below. Do not invent these; confirm with the user.

## Primary use case

It's a **lookup-first** tool answering one question: *"Do I already have this part, and where is
it?"* Part search (name + category + tags, full-text-ish, forgiving) from a **phone** is the single
most important piece of UX. Quantity/low-stock tracking is explicitly **out of scope for v1**.

## Domain model and the rules that aren't obvious

Three entities: **Bin**, **Container**, **Part**. The non-trivial logic lives in how a Container is
positioned.

**Container is the stable unit of tracking — not its position.** Move a container, update one
record, and everything inside follows. A Container's position is **exactly one of** four states,
and this is the central invariant to enforce:

1. `slot_id` — a unique slot (a wall-bin drawer-slot, or a chest front/back slot)
2. `parent_container_id` — nested inside another container
3. `freeform_location` — a text string ("Garage, box near mains")
4. none of the above — **"benched"** (no known position)

Enforce "at most one set" at the API level, not just by convention.

**Critical behaviors (easy to get wrong):**

- **Slots are unique.** Assigning a container to an already-occupied slot must **atomically bump**
  the current occupant to benched. No transient double-occupancy, no orphaned slot.
- **Benching is otherwise manual.** Position is *"last known,"* not real-time truth. Pulling a
  drawer to the workbench is NOT logged. There is an explicit "bench this container" action for
  deliberate reorganization. Two containers sharing a last-known slot (from an un-logged move) is an
  **expected, acceptable state** — a hint to the user, not a system error to prevent.
- **Nesting is capped at 2 levels.** A container with a parent cannot itself be a parent. Enforce
  at the API level.
- **Location resolution walks up the chain:** part → container → parent container → that parent's
  slot/freeform position. "Get container location" must resolve any of these to a human-readable
  string.

**Bins vs. wall drawers:** A Bin defines a grid of *available slots* on the 3×4 wall (12 wall
slots). Drawer types: all-narrow (8×8=64), all-wide (4×6=24), half/half (narrow top A1–H4, wide
bottom A5–D7). Slot addresses are spreadsheet-style `<bin-id>:<col><row>` (e.g. `W-B2:C3`). Each
wall drawer is itself a **Container** that tracks which slot it currently occupies — bins don't own
drawers, slots do. The 12 wall bins (types + grid positions) must be **seeded** before drawers/parts
can be assigned.

## Required API surface (conceptual)

Search parts · get container location (resolves the chain) · add/edit part · add/edit container ·
assign container to slot (auto-bumps occupant) · bench container (explicit) · list benched containers.

## Constraints

- **Mobile-first UI** — the user is standing in front of storage with a phone, or checking before
  ordering. Optimize for that, not desktop.
- **Self-hostable and simple to maintain** on an existing Linux home server. Prefer simple, readable
  implementations over maximally general/flexible ones. Don't over-engineer for scale that doesn't
  exist (single user, home network).
- **Manual entry only** for v1 (no barcode/photo recognition).

## Decisions to confirm before building (from the PRD's open questions)

- **Tech stack** — nothing chosen. Lean lightweight web framework + SQLite/Postgres.
- **Auth** — likely trusted-network-only / none; confirm.
- **Bulk add** — cataloguing ~30 parts into one tackle box must be fast ("stay in this container,
  keep adding" mode). Design this before building the add-part UI.
- **Category** — free string vs. fixed enum/dropdown (search consistency vs. friction).

See `mnemo.prd` for the full definition, including non-goals and the rationale behind each rule.
