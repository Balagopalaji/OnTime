---
Type: Reference
Status: current
Owner: KDB
Last updated: 2026-01-10
Scope: Cross-device agent handoff log for troubleshooting and status notes.
---

# Agent Handoff Log

Purpose: quick, shared troubleshooting notes between macOS and Windows agents during testing.

Rules:
- Add a UTC timestamp for every entry.
- Keep entries short (commands, results, blockers, next steps).
- Remove or prune resolved entries to keep this file lightweight.
- Do not paste secrets, tokens, or personal data.
- Prefer links to relevant docs/issues over long explanations.
- Separate entries with a blank line and a `---` divider.
- Include agent origin (e.g., Windows WSL, macOS, Linux) on the Owner line.

Template:

Timestamp (UTC):
Owner (macOS/Windows, origin):
Context:
Commands:
Results:
Blockers:
Next steps:
---

Timestamp (UTC): 2025-01-11T06:55:00Z
Owner (Windows)
Context: Manual checks for file ops + ffprobe on Windows companion.
Commands: /api/file/metadata + /api/open with non-ASCII path `C:\Users\krish\Videos\テスト動画.mp4.mp4`; rebuild/install companion; ffprobe validation.
Results: ffprobe bundled; metadata returns size/duration/resolution. /api/open succeeds with UTF-8 body file or UTF-8 bytes. Inline `curl.exe --data-raw` may fail due to legacy code page.
Blockers: None after workaround. curl.exe inline encoding remains client-side quirk.
Next steps: If desired, document Windows curl encoding caveat or use UTF-8 body method for non-ASCII tests.
---

Timestamp (UTC): 2026-01-11T07:47:43Z
Owner (macOS)
Context: Phase 2 checklist progress; macOS-side manual verification.
Commands: curl /api/file/exists against /etc/hosts (auth ok; server logged path rejection).
Results: File ops path rejection works (server logs). Token expiry banner verified via Companion stop. Capability gating banner verified (Minimal mode). Live cue latency noted as ~250-330ms (approx).
Blockers: PERMISSION_DENIED not testable until multi-operator access exists. Equal-timestamp tie-break impractical to force.
Next steps: Continue checklist; Windows-only tests done per prior entry; finish remaining Electron update/signing checks + release notes + rules rollout when emulator/staging available.
---

Timestamp (UTC): 2026-01-11T07:55:00Z
Owner (macOS)
Context: Handoff note maintenance.
Commands: n/a
Results: Windows entry is still relevant for Phase 2; safe to prune once Phase 2 closes.
Blockers: None.
Next steps: Prune handoff entries after Phase 2 completion.
---

Timestamp (UTC): 2026-01-14T04:06:41Z
Owner (macOS)
Context: macOS PPT detection testing requires packaged build.
Commands: n/a
Results: AppleScript automation only works reliably when running the packaged Companion app (dist build); dev runner lacks macOS Automation permission.
Blockers: None.
Next steps: Use packaged Companion for macOS PPT tests; log issues only after testing with dist build.
---

Timestamp (UTC): 2026-01-11T08:20:00Z
Owner (Windows, WSL)
Context: Windows PPT slide updates + tray icon visibility.
Commands: Rebuilt Companion after PPT/UTF decoding fixes; retested slide navigation and tray icon.
Results: Slide number now updates during slideshow; tray icon visible as black square (placeholder ok for now).
Blockers: None.
Next steps: Replace tray icon with branded asset later.
---

Timestamp (UTC): 2026-01-13T07:50:55Z
Owner (Windows)
Context: Windows PPT video timing (STA helper), multi-video labels, build/packaging, doc updates, plus macOS research guidance.
Commands: `powershell -ExecutionPolicy Bypass -File companion/scripts/build-ppt-probe.ps1`; `npm run dev` (companion + frontend); `npm run dist` (companion); `npm run dist:dev` (controller); `npm run lint && npm run test` (frontend).
Results: PPT timing works via `companion/bin/ppt-probe.exe`; multi-video statuses (Ready/Playing/Paused/Ended) stable; frontend merge preserves non-empty `videos[]` to stop flicker; Windows manual checks done (`/api/open` invalid path rejection, ffprobe missing warning); controller & companion Windows installers built and verified; controller `dist:dev` auto-increments dev version with `controller/.dev-version.json` gitignored; docs updated (`docs/ppt-video-debug.md`, `docs/local-server-prd.md`, `docs/tasks.md`, `docs/phase-2-tasklist.md`).
Blockers: macOS notarization still pending; PPT COM variance matrix needs more entries; macOS PPT timing capability unknown.
Next steps: Resume on macOS; add more COM variance seeds; keep docs aligned; optional tray icon polish later; run AppleScript/ScriptingBridge probes to confirm slideshow window/current slide/media length/player APIs. If no live timing, plan fallback: parse pptx for embedded media + ffprobe duration only, and label UI as duration-only/no live time.
---