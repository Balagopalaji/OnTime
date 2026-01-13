# PowerPoint Video Timing Debug Notes (Windows, Dev-Only)

Purpose
- Avoid re-running the same dead-end tests.
- Capture the current state of the investigation, key logs, and the next recommended approach.
- Debug flags are dev-only and should not be required for production behavior.

Summary (current status)
- Live PPT video timing works on Windows via a native STA helper (`ppt-probe.exe`).
- PowerShell fallback remains, but it cannot enumerate Shapes (COM boundary issue).
- Manual PowerShell (interactive) can enumerate Shapes and shows the embedded video shape.
- The helper is now the canonical path; PowerShell is fallback only.

Environment and repro
- PowerPoint: Office 16.0 (64-bit), build 19426.
- File tested in OneDrive URL and local path (C:\Temp\videotest.pptx).
- Slideshow on slide 8 with embedded MP4.
- Manual PowerShell reports Shapes.Count = 2 on slide 8 (one placeholder, one msoMedia).

Manual PowerShell checks (these worked)
1) Edit mode check:
   - FullName: https://d.docs.live.net/... or C:\Temp\videotest.pptx
   - Saved: -1 (unsaved in memory), Path shows OneDrive or C:\Temp
   - Slide 8 Shapes.Count = 2
2) Slideshow check:
   - SlideShowWindows.Item(1).View.CurrentShowPosition = 8
   - SlideShowWindows.Item(1).Presentation.Slides.Item(8).Shapes.Count = 2

Current Companion status
- Native STA helper returns slide + video timing with embedded MP4s.
- PowerShell script runs in STA (confirmed: apartmentStateName and runspaceApartment both "STA") but cannot enumerate Shapes.
- Shape counts from the spawned script are null/0 across:
  - slide/view/layout/master/timeline
  - active presentation slide, slideshow presentation slide, view slide
- No COM errors are thrown, just empty/null collections.
- Fallback now sets videoTimingUnavailable when Player exists but shapes are unavailable.

What was already tried (do not repeat)
- Using ActivePresentation vs SlideShowWindows.Presentation (both tried).
- Enumerating shapes on slide, view, edit slide, layout, master.
- Checking timelines (MainSequence).
- Collecting media candidates via:
  - Shape.MediaFormat
  - Shape.Type == msoMedia
  - PlaceholderFormat.ContainedType
- Running with -STA, confirming apartment state.
- Spawning PowerShell via full path (System32\WindowsPowerShell\v1.0\powershell.exe).
- Running PowerPoint and Companion as admin vs non-admin.
- Testing OneDrive path vs local path.
- Expanding diagnostics (slide index, view slide, active slide, slideshow slide, COM errors).

Key log fields to inspect
- ssShowPositionRaw (slide index)
- ssPresentationFullName / activePresentationFullName
- slideShapeCount / viewSlideShapeCount / editSlideShapeCount
- activeSlideShapeCount / ssPresentationSlideShapeCount / ssViewSlideShapeCount
- apartmentStateName / runspaceApartment
- videoTimingUnavailable
- activeSlideShapeError / ssPresentationSlideShapeError / ssViewSlideShapeError (currently null)

Notable debug values from Companion
- apartmentStateName: STA
- runspaceApartment: STA
- pptVersion: 16.0, pptBuild: 19426
- ssShowPositionRaw: 8 (correct)
- slideShapeCount: 0
- activeSlideShapeCount / ssPresentationSlideShapeCount / ssViewSlideShapeCount: null

Likely root cause
- The spawned PowerShell process cannot enumerate PowerPoint Shapes via COM.
- Manual PowerShell can enumerate Shapes, so this is a hosting/COM boundary issue.
- This is not resolved by admin vs non-admin or OneDrive vs local paths.

Native helper (live timing)
- Dedicated STA helper process:
  - stays resident in a single STA apartment,
  - owns the PowerPoint COM object,
  - responds to polling requests over stdin/stdout.
- Avoids short-lived COM access.
- Implementation details:
  - Native STA helper source lives in `companion/ppt-probe`.
  - Build with `powershell -ExecutionPolicy Bypass -File companion/scripts/build-ppt-probe.ps1`.
  - Output executable is `companion/bin/ppt-probe.exe` (bundled via electron-builder extraResources).
- Companion prefers `ppt-probe.exe` when present, then falls back to PowerShell helper.

Windows COM variance matrix (seed)
| Date | Windows build | Office build | PowerPoint bitness | Path | Helper | Result |
| --- | --- | --- | --- | --- | --- | --- |
| 2026-01-13 | 10.0.26200 | 16.0 (19426) | 64-bit | OneDrive URL + C:\Temp | STA helper | Works (live timing); PowerShell fallback cannot enumerate Shapes |

Debug toggles
- Basic: set `COMPANION_DEBUG_PPT=true` or create `ppt.debug` in the Companion user data directory.
- Verbose: set `COMPANION_DEBUG_PPT_VERBOSE=true` or create `ppt.debug.verbose` in the Companion user data directory.
- Verbose only is required to emit the large `debug` payload in PowerShell output.

Fallback behavior (current)
- If Player exists but no shapes are readable, set videoTimingUnavailable.
- UI shows "Video timing unavailable" instead of 00:00.
