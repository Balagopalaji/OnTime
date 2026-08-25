---
Type: Spec
Status: draft
Owner: KDB
Last updated: 2026-08-25
Scope: Read-only remote observation of live PowerPoint video timing from a Windows show computer.
---

# Downstage Remote PowerPoint Viewer

## Problem

The Windows show computer must read the live PowerPoint video clock, while an
operator or producer may need to see that countdown on another computer. The
show computer's Presenter View and confidence-monitor output must remain clean;
the remote display must not require PowerPoint or the native helper on the
viewing computer.

## Goals

- Let a Windows show computer publish live PowerPoint video state without
  covering or taking over Presenter View.
- Let a remote viewer run on macOS or Windows as a small read-only desktop app.
- Let a remote viewer open from an authenticated or explicitly shared cloud URL.
- Reuse the existing LAN Companion and cloud viewer/pairing structures.
- Keep one canonical PowerPoint observation and countdown behavior across the
  Windows host, desktop viewers, browser viewers, and future controller views.
- Make connection loss, stale state, and PowerPoint failure visible rather than
  silently continuing an untrustworthy countdown.

## Non-goals

- Running PowerPoint, COM, or the native Windows helper on macOS or on a remote
  viewer computer.
- Sending screen pixels or capturing Presenter View as the transport.
- Remote slide/media control in the first release.
- Replacing the existing standalone Windows host acceptance gates in ISSUE-001.
- Reimplementing PowerPoint timing, video selection, or failure handling in a
  viewer shell.

## Product surfaces

### Windows show host

The host runs PowerPoint and the native helper. In **Remote host** mode it may
be hidden, minimized, or otherwise placed below the show output. It continues
to observe PowerPoint and publish remote state. The host remains authoritative.

### Desktop remote viewer

Downstage View is a read-only desktop viewer for macOS and Windows. It uses the
same PowerPoint panel/view model as the local host, but receives state instead
of running the helper. It may be always-on-top on the viewer computer when the
operator chooses that behavior.

### Cloud browser viewer

A viewer-only URL provides the same read-only presentation view in a browser.
It can be opened on a Mac, Windows PC, tablet, or other supported browser
without installing the helper. The URL must identify or authorize a specific
show session and must not grant control.

## Ratified first-release decisions

- A remote presentation session is standalone first. It has an optional
  `roomId` attachment point for later embedding in Downstage Control, but the
  browser and desktop viewers consume the presentation-session contract rather
  than requiring a room.
- Exactly one Windows show-laptop publisher is authoritative for a session.
  Multiple read-only viewers are allowed. LAN retains its existing 20-device
  limit; the Deep Plan must define an explicit cloud service limit. A second
  publisher must be rejected unless an explicit future transfer flow is
  designed.
- Publisher authorization and viewer authorization are separate. Possession of
  a viewer URL must never authorize publication, control, token issuance, file
  access, or room mutation.
- The first cloud viewer uses an opaque, unguessable, session-scoped read-only
  link. Its active window is 24 hours. When the publisher returns, it may offer
  to resume and extend the prior session; the operator may instead end it or
  create a new link. Inactive session data is deleted after seven days.
- Publication is transition-driven. A changed PowerPoint observation publishes
  immediately, while a 10-second heartbeat proves liveness even when no video
  is playing. A viewer becomes stale after 25 seconds without contact and
  disconnected after 60 seconds; neither state may keep advancing time.
- Cloud is the first transport. LAN later implements the same snapshot,
  freshness, permission, and reconnect semantics through existing Companion
  HTTPS/WSS pairing foundations.
- Ordinary remote payloads use an explicit allowlist. Sanitized display titles
  and media labels may be present, but full paths, deck paths, process IDs,
  window handles, affinity data, raw helper diagnostics, and credentials are
  forbidden.
- Website, privacy/support pages, Store identity/signing, and macOS
  notarization are public-release gates, not blockers for contract work,
  emulator development, or named-tester builds.

## Scenarios

### RPV-001 — Windows host publishes without covering the show output

**Given** PowerPoint is running on the Windows show computer and Remote host
mode is enabled

**When** the helper observes a playing, paused, ended, or unavailable
PowerPoint state

**Then** the host publishes the corresponding remote observation while its
local timer surface does not force itself above Presenter View or the
confidence-monitor workflow.

### RPV-002 — Desktop viewer shows the live countdown

**Given** a macOS or Windows desktop viewer is paired to an active show

**When** the host publishes a valid playing observation

**Then** the viewer shows the selected video identity, status, and remaining
time using the canonical PowerPoint presentation view.

### RPV-003 — Cloud URL viewer shows the same state

**Given** a valid cloud viewer URL is opened while the show host is connected

**When** the host publishes a new observation

**Then** the browser viewer shows the same selected video, status, and
remaining-time meaning as the desktop viewer.

### RPV-004 — LAN pairing grants viewer-only access

**Given** the operator displays a LAN pairing code or QR link

**When** a Mac or Windows viewer completes pairing on an allowed private
network

**Then** it receives a viewer-only session and cannot issue timer, slide,
media, file, or control actions.

### RPV-005 — Viewer computers do not need PowerPoint dependencies

**Given** a remote viewer is installed or opened on macOS or Windows

**When** it connects to a show host

**Then** it renders the published presentation state without requiring
PowerPoint, COM, the Windows native helper, or a local PowerPoint process.

### RPV-006 — Multiple-video headline behavior is consistent

**Given** the host observes multiple videos with the canonical selected-video
and play-order information

**When** the viewer renders the presentation

**Then** its headline and secondary rows follow the same selected/headline
policy as the local Downstage host, without independently guessing which video
the helper selected.

### RPV-007 — Reconnect begins from a fresh snapshot

**Given** a viewer disconnects, reconnects, or resumes after host sleep

**When** the host becomes reachable again

**Then** the viewer receives a complete current snapshot before applying later
updates and does not resume from an older session or sequence.

### RPV-008 — Stale or unavailable state is explicit

**Given** the host loses PowerPoint, the helper fails, the connection exceeds
the freshness window, or the host stops publishing

**When** the viewer receives the failure or freshness outcome

**Then** it shows an unavailable/disconnected/stale state and does not present
a falsely advancing countdown as if PowerPoint were still authoritative.

### RPV-009 — LAN and cloud are transport choices

**Given** the same viewer session is available through LAN and cloud

**When** the operator chooses the available connection path

**Then** the viewer uses the same presentation semantics and permissions while
the transport-specific connection, trust, pairing, and reconnect behavior
remains visible.

### RPV-010 — Viewer access does not change show authority

**Given** one Windows host is authoritative for a show

**When** one or more desktop or browser viewers connect

**Then** viewers receive read-only state and do not alter host authority,
room locks, PowerPoint state, or the confidence-monitor output.

## Remote observation contract

The remote observation must be a complete, versioned state snapshot rather than
animation frames. It must carry enough information for a viewer to identify the
source/session, reject stale or duplicate updates, display availability, show
slide identity, list videos, identify the selected video, display status and
duration, and count down from timing anchors. Machine-sensitive fields such as
local paths, process identifiers, and raw helper diagnostics are excluded from
ordinary viewer payloads.

The viewer may interpolate between observations only within an explicit
freshness and correction policy. A missing, stale, contradictory, or unavailable
observation must be represented as a visible non-running state.

The helper is not a network endpoint. It retains the existing local `poll` and
`exit` stdin commands and newline-delimited JSON response. A new outer publisher
maps the canonical local observation into the remote allowlist and adds the
remote-only envelope: schema version, session identity, publisher/session
epoch, monotonic sequence, observation/publish timestamps, expected heartbeat,
freshness deadline, and sanitized availability/presentation state.

The endpoint contract must cover, without prescribing implementation names in
this feature spec: create session, authorize or resume the single publisher,
issue/resolve a viewer-only link, publish a complete current snapshot, subscribe
or read the current snapshot, rotate/revoke viewer access, end a session, and
delete expired session data. It must provide exact cloud callable/HTTP,
Firestore/rules, browser route, and later LAN HTTP/WSS mappings.

Existing room viewer documents/routes and `LIVE_CUE_*` / `PRESENTATION_*`
payloads must not temporarily carry the new presentation-session snapshot. They
are broader, differently authorized contracts. Reuse transport mechanics only
after an independently typed, privacy-filtered snapshot and replay path exists.

## Security and permissions

- Cloud links and LAN pairing must identify a session and grant viewer-only
  access by default.
- LAN exposure remains opt-in and limited to the existing private-subnet,
  HTTPS/WSS, certificate-trust, pairing-code, token-TTL, and revocation rules.
- Viewer credentials must not authorize control, file APIs, or token issuance
  for other roles.
- Remote snapshots must not expose local filesystem paths, process IDs, or
  internal helper diagnostics unless a separately authorized diagnostics flow
  is designed.

## Open questions

1. **Desktop packaging:** ship one cross-platform Downstage View installer or
   separate Mac/Windows viewer packages? **Recommendation:** one shared viewer
   product with platform-specific builds; keep the Windows helper dependency out
   of viewer packages.
2. **LAN delivery:** use the existing Companion-served browser bundle first or
   ship the viewer-only Electron app first? **Recommendation:** browser viewer
   proves the protocol and pairing path; desktop viewer reduces certificate
   friction for production use.
3. **Remote controls:** when should slide navigation or media control begin?
   **Recommendation:** keep the first release read-only; add commands only
   after observation, authorization, and failure semantics are proven.
4. **Media labels:** should sanitized video labels be shared by default or only
   after an operator enables them? **Recommendation:** make the field optional
   in v1 and settle the default during the viewer UX planning gate.
