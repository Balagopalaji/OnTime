# ⚠️ Archive Deprecation Notice

All files under `docs/archive/` are **historical only** and must **not** be used as a source of truth for current implementation.

## Rules
- Do **not** include archive files in prompts or planning.
- If an archive file conflicts with current docs, the current docs win.
- Current sources of truth:
  - `docs/local-mode.md` (Parallel Sync / local runtime behavior)
  - `docs/app-prd.md` (overall product requirements)
  - `docs/client-prd.md` (frontend requirements)
  - `docs/cloud-server-prd.md` (Firebase cloud requirements)
  - `docs/local-server-prd.md` (Companion requirements)
  - `docs/interface.md` (canonical protocol contract)
  - `docs/timer-logic.md` (authoritative timer math)
  - `docs/edge-cases.md`

## Purpose of Archive
- Preserve past implementation guides and prompts for historical reference only.
- Keep context of phased work without influencing new development.

Last updated: 2026-07