---
IMPLEMENTATION COMPLETE - DEPRECATED
This document describes Phase 1 implementation steps which are now complete.
Current architecture: See `docs/local-mode-plan.md` (parallel sync)
Last accurate: December 2024 (Phase 1D Step 3.5 completion)
Use case: Historical reference only; do NOT use for new development.
---

> ⚠️ Deprecated
> Historical Phase 1 prompt. Do not use as source of truth. See `docs/local-mode-plan.md` for current parallel sync architecture.

# Phase 1D Step 3.5 Refactor - Repo Prompt Guide

## Overview

This folder contains Repo Prompt files for implementing the **Unified Data Provider Architecture** refactor. These prompts are designed to be executed sequentially using [repoprompt.com](https://repoprompt.com).

## Background

The original Phase 1D Step 3.5 implementation used **provider swapping** which caused timers to "disappear" during mode switches. This refactor implements a **dual-connection architecture** where Firebase and Companion run in parallel.

**See:** `docs/phase-1d-step3.5-refactor-plan.md` for the full technical design.

## Execution Order

Execute these prompts **in sequence**. Each step builds on the previous.

| Step | File | Description | Est. Complexity |
|------|------|-------------|-----------------|
| 1 | `step1-companion-connection-provider.md` | Extract socket connection into new provider | Medium |
| 2 | `step2-appmode-provider.md` | Remove HTTP polling, use socket state | Low |
| 3A | `step3a-unified-data-resolver-core.md` | Create authority state + data resolution | High |
| 3B | `step3b-unified-data-resolver-companion.md` | Add Companion subscription + SYNC | High |
| 4 | `step4-simplify-companion-data-context.md` | Remove redundant code | Low |
| 5 | `step5-dataprovider-restructure.md` | Implement nested provider structure | Medium |
| 6 | `step6-page-updates.md` | Update Controller/Viewer pages | Medium |
| 7 | `step7-testing-validation.md` | Test all scenarios | N/A |

## Using with Repo Prompt

1. Go to [repoprompt.com](https://repoprompt.com)
2. Connect your repository
3. Open the prompt file for the current step
4. Copy the "Files to Include" section into Repo Prompt's file selector
5. Use the task description and execution checklist as the prompt
6. Review and apply the generated changes
7. Test locally before moving to the next step

## File References

Each prompt file specifies which source files to include. Use **line ranges** to stay within token limits:

```
frontend/src/context/CompanionDataContext.tsx (lines 1-250, 397-528)
```

## Key Files Being Modified

| File | Changes |
|------|---------|
| `frontend/src/context/CompanionConnectionContext.tsx` | **NEW** - Socket connection only |
| `frontend/src/context/UnifiedDataContext.tsx` | **NEW** - Authority + data resolution |
| `frontend/src/context/AppModeContext.tsx` | Remove HTTP polling |
| `frontend/src/context/DataProvider.tsx` | Nested provider structure |
| `frontend/src/context/CompanionDataContext.tsx` | Simplify or delete |
| `frontend/src/routes/ControllerPage.tsx` | Remove manual subscription |
| `frontend/src/routes/ViewerPage.tsx` | Simplify data consumption |

## Testing Between Steps

After each step, verify:
- App compiles without errors
- No console errors on load
- Basic functionality works (Cloud mode at minimum)

Full testing happens in Step 7, but catching issues early saves time.

## Rollback

If issues arise:
1. Git history preserves all original code
2. `DataProvider.tsx` is the critical file - reverting it restores old behavior
3. New context files can be deleted if unused

## Support

- **Technical spec:** `docs/phase-1d-step3.5-refactor-plan.md`
- **Original design:** `docs/local-mode-plan.md`
- **Phase 1D guide:** `docs/phase-1d-implementation-guide.md`
