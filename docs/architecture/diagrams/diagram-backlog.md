# Diagram Backlog

Use this backlog to defer Mermaid updates until runtime behavior is stable.

## Status rules
- `pending`: identified, not yet fixed/stable
- `ready`: fix is merged and validated; diagram update can start
- `done`: diagram updated and verified

## Backlog

| id | area | change trigger | status | source files | target diagrams | notes |
|---|---|---|---|---|---|---|
| DB-001 | Controller timer selection/state | Refresh + control bar action can unset selected timer and show `00:00` | pending | `frontend/src/context/UnifiedDataContext.tsx`, `frontend/src/routes/ControllerPage.tsx`, `frontend/src/hooks/useTimerEngine.ts` | `docs/architecture/diagrams/timer-lifecycle.md`, `docs/architecture/diagrams/agent-context.md` | Add after fix + re-sweep + smoke pass |
| DB-002 | Offline room bootstrap from Companion | Fresh browser with cloud offline does not load companion-synced rooms; rooms appear when cloud reconnects | pending | `frontend/src/context/UnifiedDataContext.tsx`, `frontend/src/context/CompanionConnectionContext.tsx`, `companion/src/main.ts` | `docs/architecture/diagrams/system-context.md`, `docs/architecture/diagrams/agent-context.md` | Requires local/offline bootstrap path clarity |

## Promotion checklist (pending -> ready)
- Bug fix merged
- Re-sweep verdict is `GO` (or `GO WITH NOTES` without blocking notes)
- Smoke checks pass for impacted profile
- PRD check pass (or pass with non-material notes)

## Diagram run checklist (ready -> done)
1. Run `diagram-author` for all `ready` items.
2. Run `diagram-verifier` on updated diagrams.
3. Update each item status to `done` with commit SHA.

## Maintenance routine (after each fix pass)
1. Add new architecture-impacting bugs/fixes as new `DB-xxx` rows with `status=pending`.
2. When a fix is validated (re-sweep + smoke + PRD), change row to `status=ready`.
3. Batch all `ready` rows into one diagram update cycle.
4. After `diagram-author` + `diagram-verifier` pass, set rows to `status=done` and append commit SHA in `notes`.
5. If a regression reopens behavior, set the row back to `pending` and add `regressed in <commit/branch>` note.
