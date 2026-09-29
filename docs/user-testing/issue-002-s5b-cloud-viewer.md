---
Type: User-test record
Status: current
Owner: KDB
Last updated: 2026-09-29
Scope: ISSUE-002 S5b — cloud browser presentation viewer and owner device approval (emulator-backed).
---

# ISSUE-002 S5b user test — cloud browser viewer

## Method

Tool-driven, reproducible: `npm run user-test:presentation-viewer --workspace ontime-firebase-rules`
(`firebase/tests/presentation-viewer-walkthrough.mjs`). Inside `firebase emulators:exec`
(Auth, Firestore, Functions), a scripted owner and PPT Timer publisher (the sidecar's callable
sequence) drive the real frontend (Vite dev server, emulator config) while headless Google Chrome
154 is controlled over the DevTools protocol at 520×300 (420 for the open disclosure, 900×520 for
the operator app). Each step is screenshotted; console errors, failed requests, request URLs
(token leakage), and room-data reads are captured for the whole run. Log:
`assets/issue-002-s5b/walkthrough-log.json`; console errors with step attribution:
`assets/issue-002-s5b/console-errors.json`.

Final run: **25/25 checks passed** (2026-09-29).

## Workflows exercised

| # | Workflow (scenario) | Result | Screenshot |
|---|---|---|---|
| W1 | Open the shared link → connecting face; token removed from the address bar (RPV-003) | PASS | `01-connecting.png` |
| W2 | Host publishes playing → compact face: `PLAYING` above the time, no video title; disclosure caret visible; countdown advances 01:29 → 01:26 (RPV-002/003) | PASS | `02-live-playing.png`, `03-counting-down.png` |
| W3 | Open disclosure → both titles with status chips and times (RPV-006) | PASS | `04-disclosure-open.png` |
| W4 | Host pauses → `PAUSED`, time frozen 01:30 → 01:30 | PASS | `05-paused.png` |
| W5 | Host helper unavailable → `RETRYING`, `--:--` (RPV-008) | PASS | `06-source-unavailable.png` |
| W6 | Publisher silent → `RECONNECTING` at 25 s, value frozen and dimmed; `DISCONNECTED` with `--:--` at 60 s (RPV-008) | PASS | `07-stale.png`, `08-disconnected.png` |
| W7 | Host restart → resume (epoch 2) → viewer resumes from the fresh snapshot (RPV-007) | PASS | `09-resumed-new-epoch.png` |
| W8 | Reload the tab mid-show → still live, no token in the URL | PASS | `10-reloaded.png` |
| W9 | Owner revokes the link → `ACCESS ENDED` (RPV-010) | PASS | `11-access-ended.png` |
| W10 | Newly issued link opened in the same tab → live; owner ends the session → `SESSION ENDED` | PASS | `12-new-link-live.png`, `13-session-ended.png` |
| W11 | Wrong token → `ACCESS ENDED` | PASS | `14-bad-link.png` |
| W12 | Owner approves a new PPT Timer on `/publisher/device/approve` → hand-off to `downstage-ppt-timer://…`; the app completes approval with the callback code | PASS | `15-approval-prompt.png`, `16-approval-done.png` |
| — | Runtime: no unexpected console errors (9 logged, all expected — see below); no failed requests; token never in any of 331 request URLs; viewer never reads room data | PASS | — |

Expected console errors (Chrome logs refused requests as errors): `resolvePresentationViewerLink`
403 after revoke/end/bad link (how the viewer learns "session ended" vs "access ended"); a Firestore
`Listen/channel` 400 when a denied or unloaded stream is reset (W8 reload, W9–W11); in W12 the
operator app's Companion probe (no Companion running) and the headless browser's inability to launch
the custom `downstage-ppt-timer://` scheme.

## Issues found (and their disposition)

| Severity | Issue | Disposition |
|---|---|---|
| P1 | Disclosure caret below the fold: `.session-viewer` used `height: 100vh` plus padding without `box-sizing: border-box` | Fixed (`session-viewer.css`); W2/W3 assert the caret is inside the viewport |
| P1 | Opening a re-issued link in the same tab changes only the fragment (no reload), so the viewer stayed at "Access ended" | Fixed (`hashchange` adopts the new token; page test + W10) |
| P1 | Ending a session showed "Access ended": the denied snapshot target stalls the Firestore client's other listeners (probed: the viewer-state `ended` never arrives and even `getDocFromServer` returns the stale `active`), and the reconnect's resolve was refused | Fixed: every reconnect uses a fresh transport; `resolvePresentationViewerLink` returns `details.reason: 'session-ended'` to the current link's holder; the viewer maps it to "Session ended" (controller test + links emulator test + W10) |
| P3 | StrictMode's discarded first mount created and deleted a Firebase app (`app/app-deleted` warnings) | Fixed (transport created inside the deferred start; page test) |
| P3 | Terminal states show a large `--:--` with only the small label (`SESSION ENDED` / `ACCESS ENDED`); the explanatory message is announced but not shown | Open — UX follow-up |
| P3 | After approving, the heading still asks "Link PPT Timer to your account?" | Open — copy follow-up |

## Not tested

- **Safari and Firefox** (plan manual gate: Chrome/Safari/Firefox): no automation driver for them in
  this environment → **blocked**; handed to the user for the staging browser matrix.
- **Production Firebase** (real Auth/Google sign-in, custom-token sign-in against production,
  TTL, rate limits, 50 viewers): staging gate (`docs/qa/presentation-remote-viewer-load-plan.md`).
- **The owner's real Google sign-in** in W12: the harness signs the same owner in with the Auth
  emulator's email/password provider through the app's own `firebase/auth` module instance.
- **The native PPT Timer callback** (`downstage-ppt-timer://`): not registered in the headless
  browser; the harness completes approval with the code the page handed off (S6b/S7 own the app side).
