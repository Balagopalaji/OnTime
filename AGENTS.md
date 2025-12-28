## 📁 Archive Policy
All files under `docs/archive/` are historical only and must not be used as a source of truth for current implementation.
- Do **not** include archive files in prompts or planning.
- If an archive file conflicts with current docs, the current docs win.
- Current sources of truth:
  - `docs/local-mode-plan.md` (Parallel Sync / Phase 1D)
  - `docs/backend-prd.md`
  - `docs/frontend-prd.md`
  - `docs/parallel-sync-tasklist.md`
  - `docs/edge-cases.md` (when created)

# Repository Guidelines

## Project Structure & Module Organization
The repo currently tracks `docs/` (PRDs plus `tasks.md`); keep this folder authoritative for scope updates. Scaffold the Vite + React + TypeScript app inside `frontend/`, using `src/routes`, `src/components`, `src/hooks`, and `src/context` feature folders while isolating mock Firestore helpers under `src/mocks`. Centralize Tailwind tokens in `frontend/tailwind.config.ts`, place static assets in `frontend/public/`, and keep timer/provider specs in `src/__tests__/` for symmetry with the workstream map in `docs/tasks.md`.

## Build, Test, and Development Commands
Run `npm install` inside `frontend/` once per clone. Use `npm run dev` to boot the Vite server with the mock provider, `npm run build` to produce the Firebase-ready bundle, and `npm run preview` for a quick artifact check. Keep `npm run lint` (ESLint + TypeScript) and `npm run test` (Vitest) clean before sharing code so hooks such as `useTimerEngine` stay deterministic.

## Coding Style & Naming Conventions
Adopt TypeScript strict mode, 2-space indentation, and prefer function components with PascalCase filenames (`TimerPanel.tsx`). Hooks belong in `src/hooks/` with camelCase identifiers, while shared helpers stay in `src/lib`. Keep mock data helpers in `src/mocks/`, reserve default exports for components that mirror file names, and extend the dark-first Tailwind theme via `tailwind.config.ts` instead of scattering raw hex values.

## Testing Guidelines
Write Vitest specs for every hook, provider, and timer helper. Name files `*.test.ts(x)` and colocate them with the module unless fixtures need `src/__tests__/`. Stub `Date.now()` to keep timer math deterministic, and cover CRUD flows (room creation, rundown reorder, message toggles) before merging; run lightweight Playwright smoke tests only when UI regressions are suspected.

## Commit & Pull Request Guidelines
Follow the existing conventional git style (`docs: Add initial backend and frontend Product Requirements Documents (PRDs) for StageTime.`) using `<scope>: <sentence case detail>`. PRs must cite `docs/tasks.md`, describe the behavior change, add screenshots or GIFs for UI updates, and state that `npm run lint && npm run test` succeeded before review.

## Timer Logic Guardrails
- Treat `docs/timer-logic.md` as the authority for all timer math and transitions; never diverge without updating that doc.
- Reuse shared helpers in `frontend/src/utils/timer-utils.ts` for elapsed/nudge/progress; do not duplicate formulas or clamp elapsed (bonus time can be negative).
- Any timer action (start/pause/reset/nudge/set-active/duration change) must update the full tuple `{activeTimerId, isRunning, elapsedOffset/currentTime, startedAt, lastUpdate, progress}` across Firebase, Companion, and Unified paths.
- Duration edits reset progress to 0 per spec; rundown reorders must not mutate elapsed.
- Before shipping timer changes, run targeted tests (`useTimerEngine`, `snapshotStale`, other timer specs) plus `npm run lint && npm run test`.
