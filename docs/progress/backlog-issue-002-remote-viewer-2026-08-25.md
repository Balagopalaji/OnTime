---
Type: Progress
Status: current
Owner: KDB
Last updated: 2026-08-25
Scope: ISSUE-002 RepoPrompt CE planning handoff and readiness evidence.
---

# ISSUE-002 remote PowerPoint viewer planning handoff

## Git and worktree

- Merged source: PR #145, squash commit
  `d1ff0770ec5449fb3fce4a28665b5d84f41f4f50`.
- Branch: `codex/issue-002-remote-viewer`.
- Windows worktree:
  `C:\Dev\OnTime-worktrees\issue-002-remote-viewer`.
- Worktree was created directly from `origin/main`; the completed ISSUE-001
  checkout was not switched or modified.

## Readiness results

| Gate | Result | Evidence / next action |
| --- | --- | --- |
| ISSUE-002 spec and planning brief on `main` | PASS | PR #145 is merged at the recorded base. |
| Native helper local protocol | PASS | Persistent helper accepts only `poll` and `exit`; responses already contain availability, slide identity, complete video rows, status, and observed timing. |
| Target-source equivalence | PASS | `git diff --quiet db38ed4 d1ff077 -- apps/ppt-timer packages/ppt-bridge packages/presentation-core`; PR #145 changed no target source. |
| `ppt-bridge` deterministic suite | PASS | Re-run in source-equivalent `C:\Dev\OnTime`: `npm run test --workspace @ontime/ppt-bridge` -> 5 files, 72 tests. |
| `presentation-core` deterministic suite | PASS | Re-run in source-equivalent `C:\Dev\OnTime`: `npm run test --workspace @ontime/presentation-core` -> 6 files, 134 tests. |
| Standalone Windows timer suite | PASS | Re-run in source-equivalent `C:\Dev\OnTime`: `npm run test --workspace @ontime/ppt-timer` -> 30 files, 430 tests. |
| Targeted typechecks | PASS | `ppt-bridge`, `presentation-core`, and `ppt-timer` all completed `tsc --noEmit`. |
| Remote field source coverage | PASS WITH BOUNDARY WORK | Required local observations exist. Host-resolved headline/focus must be published; host-generated session, epoch, sequence, timestamps, heartbeat, and freshness fields do not belong in the helper. |
| Remote payload privacy | PENDING CONTRACT | Define and test a strict allowlist. Never send full filenames/paths, process IDs, affinity/process counts, raw diagnostics, helper paths, or credentials. |
| Cloud publisher/viewer endpoints | NOT BUILT | Existing Functions expose lock/operator callables only; no presentation-session publisher or viewer-token endpoints exist. |
| Cloud read model and rules | NOT BUILT | Existing room/state reads are public by room ID; create a protected presentation-session read model rather than exposing `liveCues`. |
| LAN reuse | PARTIAL | HTTPS/WSS connection and pairing/token/revocation foundations exist. Existing room/LiveCue payload replay is not reusable. Role binding, ownership, a new filtered snapshot/replay event, ordering, and the existing 20-device limit require a code map and tests. |
| Single authoritative publisher | NOT BUILT | Add a per-session publisher lease/epoch and reject foreign/stale writes. |
| Remote host mode | NOT BUILT | Current local window may minimize but close exits the app/helper; define explicit background/stop behavior and validate Presenter View cleanliness on Windows. |
| Browser/Windows/macOS viewer surfaces | NOT BUILT | Browser first; desktop builds share the same viewer model and contain no helper/COM dependency. |
| Reusable compact timer surface | PLANNING CONTRACT ADDED | The Deep Plan must extract a source-neutral timer face/content-slot shell, Electron-only window wrapper, and PowerPoint adapter/panel. PowerPoint remains the only ISSUE-002 source; later rundown and standalone timer publishers reuse the seam through their own contracts. |
| Firebase emulator parity | BLOCKED FOR AUTHORITATIVE CLOUD TESTS | `firebase.json` uses 8081/5002; frontend uses 8080/5001. Resolve in the first cloud-environment slice. |
| Deep Plan and conformance matrix | PENDING | RepoPrompt CE planning prompt is the exact resume point below. |

Tests used the installed dependencies in `C:\Dev\OnTime`; the recorded
path-limited Git comparison proves that PR #145 changed none of the three target
source trees. This is deterministic source evidence only. Live ISSUE-002 Remote
host, Presenter View, packaged publisher, and cross-machine acceptance remain
PENDING because those surfaces are not built.

## Exact resume point

Run the RepoPrompt CE Community Edition planning workflow using:

`docs/prompts/issue-002-repoprompt-ce-planning-2026-08-25.md`

On the Mac, fetch and create a separate worktree from
`origin/codex/issue-002-remote-viewer`, then bind RepoPrompt CE to the Mac
worktree's real path. The Windows path above is evidence for this machine, not a
portable path to copy literally.

The run must produce a Deep Plan, endpoint/data/rules contract, scenario-to-code
matrix, RPV conformance matrix, bounded slice sequence, and Mac/Windows ownership
handoff. It must also return a reusable-surface extraction map and future
stage-timer adapter seam without implementing the later sender or controls. It
must not implement source code. After independent review, run
`spec-plan-readiness`; implementation may begin only if that gate passes.
