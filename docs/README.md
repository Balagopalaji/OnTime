# OnTime Documentation Index

Last Updated: 2025-12-22

## Current Documentation (Source of Truth)

### Architecture and Design
- `local-mode-plan.md` - Parallel Sync and Flawless Fallback architecture (Phase 1D target)
- `edge-cases.md` - Edge case handling (Phase 1D target)
- `websocket-protocol.md` - WebSocket event schema
- `parallel-sync-tasklist.md` - High-priority tasks for parallel sync alignment

### Product Requirements
- `frontend-prd.md` - Frontend MVP specification (partial; see banner)
- `backend-prd.md` - Backend MVP specification (partial; see banner)

### Feature Specs
- `show-control-architecture.md` - Phase 2 Show Control
- `modularity-architecture.md` - Tier-based features
- `undo-redo-future-plan.md` - Undo/Redo system
- `show-control-decisions.md` - Show control decisions and constraints
- `architecture-update-2025-12.md` - Architecture update notes

## Archive Policy
- Files under `docs/archive/` are deprecated and historical only
- Do not use archive files for implementation decisions
- If an archive file conflicts with current docs, current docs win

## Quick Reference
- Parallel sync architecture: `local-mode-plan.md`
- Edge case handling: `edge-cases.md`
- WebSocket events: `websocket-protocol.md`
- Task alignment: `parallel-sync-tasklist.md`

## Operational Note
- On app load, always attempt Companion auto-connect; Firebase listeners remain active. If either source is unavailable, the app continues on the remaining source.
