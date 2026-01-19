---
Type: Plan
Status: draft
Owner: KDB
Last updated: 2026-01-19
Scope: Phase 4 discovery and high-level roadmap (draft; subject to change).
---

# Phase 4 Overview (Draft)

Phase 4 focuses on scale, polish, and optional modules. This draft captures candidate themes and is intentionally high-level until brainstorming is complete.

## Goals
- Expand the platform with opt-in modules for enterprise workflows.
- Reduce operational friction with automation and file coordination.
- Improve viewer personalization for corporate and venue branding.

## Non-goals
- Committing to final scope or delivery dates.
- Reworking Phase 3 LAN infrastructure unless required for a Phase 4 feature.

## Candidate Themes (Draft)
- AI-assisted program ingestion (image/PDF/Excel → auto-fill).
- Native viewer apps (iOS/Android) with public viewer support.
- Viewer theming: logo banners, colors, and font customization for enterprise branding.
- Undo/redo command system for planner and cue edits.
- Windows cert install hardening (if not completed in Phase 3D).
- Remote file open on show laptop: controller triggers PPT open on a dedicated show machine.
- File distribution/sync: authorized device uploads files; show and backup laptops sync for reliable open cues.
- Modular packaging: optional standalone modules or feature bundles for specific roles.
- Planner sync workflows (e.g., PCO planner → TD show import and ongoing sync).
- Native video playback exploration (desktop; evaluate VLC/mpv/WMF options).

## Open Questions
- Which candidate themes are core vs. optional add-ons.
- Packaging model for standalone modules (Electron app, web module, or service).
- File sync architecture: cloud storage vs. LAN replication.
- Security model for remote file open and device trust.
