---
Type: Conformance
Status: current
Owner: KDB
Last updated: 2026-08-26
Scope: Spec-to-implementation evidence for RPV-001 through RPV-010.
---

# Downstage Remote PowerPoint Viewer — Conformance Matrix

## Status rules

This matrix starts with every scenario `Not-built`. A row may become
`Conformed` only after the named automated and manual evidence is run and read.
`Diverged` must name both the implemented behavior and the accepted reason.
Planning text, an agent report, or a passing unrelated suite is not conformance
evidence.

## Scenario matrix

| Scenario | Status | Closing slices | Automated evidence required | Manual/user evidence required |
|---|---|---|---|---|
| RPV-001 — Windows host publishes without covering show output | **Not-built** | S6a–S6d, S7 | sidecar lifecycle/no-helper-spawn tests; publisher snapshot integration; packaged app process cleanup | real Windows PowerPoint slideshow, Presenter View, confidence monitor, minimize/hide, stop/share, crash, update, quit screenshots/logs |
| RPV-002 — desktop viewer shows live countdown | **Not-built** | S4a–S4b, S8a–S8c | shared-face DOM fixtures, PowerPoint adapter fixtures, desktop cloud-fixture integration, bundle audit | macOS and Windows compact face/disclosure live workflow screenshots |
| RPV-003 — cloud URL viewer shows the same state | **Not-built** | S3a–S3d, S5a–S5b | callable/rules emulator suite; link resolve, listener order, reducer and teardown integration | current Chrome, Safari, and Firefox link/compact/disclosure/stale/reconnect/end workflow; console/network audit |
| RPV-004 — LAN pairing grants viewer-only access | **Not-built** | S9a–S9b | role/token/revocation, loopback-only publisher, invalid publish, bootstrap and enforced device-21 denial tests | private-LAN HTTPS/WSS trust/pairing workflow on Mac and Windows viewer |
| RPV-005 — viewers require no PowerPoint dependencies | **Not-built** | S4a–S4b, S5a–S5b, S8a–S8c | dependency-cruiser/import tests and packaged-content audit exclude helper, COM, publisher, and PowerPoint host code | install/open viewer on Mac and non-PowerPoint Windows machine |
| RPV-006 — multiple-video headline behavior is consistent | **Not-built** | S1a–S1b, S4b, S6c | host-resolved focus/headline golden fixtures; sanitized disclosure rows; no viewer reselection | compare local and remote disclosure against a real multi-video deck |
| RPV-007 — reconnect begins from a fresh snapshot | **Not-built** | S1a–S1b, S3c, S5a, S6c, S9b | higher-epoch reset, same-epoch reconnect, duplicate/regression rejection, full-first-bootstrap over cloud and LAN | host sleep/wake, network drop, sidecar crash/restart on Windows |
| RPV-008 — stale or unavailable state is explicit | **Not-built** | S1a–S1b, S4b, S5a–S5b, S6c | unavailable discriminants, 25s stale/60s disconnected fake-clock tests, no interpolation after stale | stop publisher/helper/PowerPoint and confirm visible non-running states |
| RPV-009 — LAN and cloud are transport choices | **Not-built** | S5a–S5b, S9a–S9b | identical snapshots over both adapters reduce to identical display models | switch an active session between available cloud and LAN paths |
| RPV-010 — viewer access does not change show authority | **Not-built** | S3a–S3c, S5a, S6a, S9a–S9b | Firestore and Socket.IO denial of all viewer writes/control/file/token actions; sidecar protocol has no remote-command message | connect multiple viewers and confirm PowerPoint/local timer/confidence output are unchanged |

## Proposed-surface audit

| Surface | Status | Closing slices | Required proof |
|---|---|---|---|
| Strict `RemoteSnapshotV1` envelope and PowerPoint v1 payload | **Not-built** | S1a–S1b | type/parser/allowlist/adversarial/timing fixtures |
| Cloud presentation session, device auth, link, publish, read, end, cleanup | **Not-built** | S3a–S3d | endpoint/rules matrix implemented and emulator/staging gates read |
| Hidden publisher sidecar inside `apps/ppt-timer` | **Not-built** | S6a–S6d | utility-process protocol, safe-storage broker, lifecycle/retry/package tests |
| Cloud browser session viewer | **Not-built** | S5a–S5b | route/hook/reducer/render/teardown tests and user testing |
| Cross-platform Downstage View | **Not-built** | S8a–S8c | shared renderer plus platform packaging and user testing |
| Later LAN `REMOTE_SNAPSHOT` transport | **Not-built** | S9a–S9b | independent contract, loopback publisher, pairing/read-only/20-device proof |

## Coverage proof

- Audited scenarios: RPV-001 through RPV-010 (10/10).
- Unreconciled scenarios: none.
- Conformed: 0.
- Diverged: 0.
- Not-built: 10.
- Runtime tests and user testing: **NOT RUN (documentation-only)**.
