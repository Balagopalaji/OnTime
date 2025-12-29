---
Type: Tasklist
Status: draft
Owner: KDB
Last updated: 2025-12-29
Scope: Manual verification checklist for Phase 0 (Status: current items in docs/doc-matrix.md).
---

# Phase 0 Manual Verification Checklist

Use this checklist to verify each feature marked **Status: current** in `docs/doc-matrix.md`.
You only need to confirm whether the feature works as expected; agents will handle code references.
Return the completed checklist so the doc-matrix can be updated with verification status.

Quick use:
1) Copy all "Status: current" features from `docs/doc-matrix.md`.
2) Try the simplest happy-path for each feature.
3) Mark Result and add a short note if needed.

If you only have time for one field, fill Result and Notes.

| Feature | Result (Pass/Fail/Blocked) | Notes / Steps (optional) | Date (YYYY-MM-DD) |
| --- | --- | --- | --- |
| Room management (create/delete/list, metadata) | Pass | Create/delete/list works. Metadata fields (title/timezone/config/order/tier) assumed normal. | 2025-12-29 |
| Timer CRUD + reorder | Pass | Create/read/update/delete works; drag-and-drop reorder works. | 2025-12-29 |
| Timer math & transitions | Pass | Works well; timer math stabilized and backed by `docs/timer-logic.md`. | 2025-12-29 |
| Viewer display + status | Pass | Functional; offline fallback not verified (no LAN/offline). Styling issues in overtime + some phones. | 2025-12-29 |
| Message overlay + presets | Pass | Functional. | 2025-12-29 |
| App modes (auto/local/cloud) - loopback Companion | Pass | Works on localhost; LAN/offline planned in `docs/local-offline-lan-plan.md`. | 2025-12-29 |
| Companion connection + token flow | Pass | Works on localhost; hosted `web.app` needs manual trust for local HTTPS/ports. | 2025-12-29 |
| Firestore schema + rules | Pass | Behavior normal; rules not explicitly audited. | 2025-12-29 |
