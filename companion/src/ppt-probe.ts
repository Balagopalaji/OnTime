// rebuild-target: app-internal (local-companion)
//
// PowerPoint probe/helper process I/O (macOS osascript path, Windows native
// ppt-probe.exe STA helper, PowerShell fallback), carved verbatim out of
// companion/src/main.ts (Stage 1b Lane B slice B-5a). The embedded AppleScript
// and PowerShell scripts are load-bearing strings and move character-identical.
// `resolvePptProbePath` keeps `process.resourcesPath` / `__dirname` as-is:
// after compilation this module sits in the same dist/ directory main.js
// compiled to, so `path.join(__dirname, '..', 'bin', 'ppt-probe.exe')`
// resolves identically. DI edits: logging imports from ./ppt-debug-log, and
// the two debug-flag reads use isPptDebugEnabled() / isPptDebugVerboseEnabled().

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import fsSync from 'node:fs';
import path from 'node:path';
import * as readline from 'node:readline';
import {
  appendPptLog,
  isPptDebugEnabled,
  isPptDebugVerboseEnabled,
  logPptInfo,
  logPptVerbose,
  writePptScript,
} from './ppt-debug-log';
import type { PowerPointPollResult } from './presentation-snapshot';

let pptHelperProcess: ChildProcessWithoutNullStreams | null = null;
let pptHelperReadline: readline.Interface | null = null;
let pptHelperPending: Array<{ resolve: (line: string | null) => void }> = [];
let pptNativeHelperProcess: ChildProcessWithoutNullStreams | null = null;
let pptNativeReadline: readline.Interface | null = null;
let pptNativePending: Array<{ resolve: (line: string | null) => void }> = [];
let pptNativeHelperLogged = false;

function resolvePptProbePath(): string | null {
  // Windows-only native helper binary; packaged under resources/bin or local dev bin.
  const candidates = [
    path.join(process.resourcesPath ?? '', 'bin', 'ppt-probe.exe'),
    path.join(__dirname, '..', 'bin', 'ppt-probe.exe')
  ];
  for (const candidate of candidates) {
    if (candidate && fsSync.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

export function stopPptProbeHelper(reason: string) {
  // Windows-only helper shutdown to avoid orphaned processes.
  if (!pptNativeHelperProcess) return;
  logPptInfo('[ppt] native helper stopped', { reason });
  try {
    pptNativeHelperProcess.stdin.write('exit\n');
  } catch {
    // ignore write failures during shutdown
  }
  pptNativeHelperProcess.kill();
  pptNativeHelperProcess = null;
  pptNativeReadline?.close();
  pptNativeReadline = null;
  pptNativePending = [];
}

function ensurePptProbeHelper(): boolean {
  // Prefer the native STA helper to avoid COM collection issues from short-lived shells.
  if (pptNativeHelperProcess && pptNativeHelperProcess.exitCode === null) return true;
  stopPptProbeHelper('restart');
  const probePath = resolvePptProbePath();
  if (!probePath) {
    logPptInfo('[ppt] native helper missing; falling back to PowerShell');
    return false;
  }
  pptNativeHelperProcess = spawn(probePath, [], { windowsHide: true });
  pptNativeReadline = readline.createInterface({ input: pptNativeHelperProcess.stdout });
  pptNativeReadline.on('line', (line) => {
    const pending = pptNativePending.shift();
    if (pending) {
      pending.resolve(line);
    }
  });
  pptNativeHelperProcess.stderr.on('data', (buf) => {
    logPptVerbose('[ppt] native helper stderr', buf.toString('utf8').trim());
  });
  pptNativeHelperProcess.on('exit', (code) => {
    logPptInfo('[ppt] native helper exited', { code });
    pptNativeHelperProcess = null;
    pptNativeReadline?.close();
    pptNativeReadline = null;
    pptNativePending = [];
    pptNativeHelperLogged = false;
  });
  if (!pptNativeHelperLogged) {
    logPptInfo('[ppt] native helper started', { path: probePath });
    pptNativeHelperLogged = true;
  }
  return true;
}

async function pollPowerPointViaNativeHelper(): Promise<PowerPointPollResult | null> {
  if (process.platform !== 'win32') return null;
  if (!ensurePptProbeHelper()) return null;
  const helper = pptNativeHelperProcess;
  if (!helper || helper.exitCode !== null) return null;

  return await new Promise((resolve) => {
    const pending = {
      resolve: (line: string | null) => {
        clearTimeout(timeout);
        if (!line) {
          resolve(null);
          return;
        }
        try {
          resolve(JSON.parse(line) as PowerPointPollResult);
        } catch (error) {
          console.warn(`[ppt] Failed to parse native helper output: ${String(error)}`);
          resolve(null);
        }
      }
    };
    const timeout = setTimeout(() => {
      const index = pptNativePending.indexOf(pending);
      if (index >= 0) {
        pptNativePending.splice(index, 1);
      }
      resolve(null);
    }, 8000);
    pptNativePending.push(pending);
    try {
      helper.stdin.write('poll\n');
    } catch {
      clearTimeout(timeout);
      const index = pptNativePending.indexOf(pending);
      if (index >= 0) {
        pptNativePending.splice(index, 1);
      }
      resolve(null);
    }
  });
}

function buildPowerPointHelperScript(pollScript: string): string {
  return `
function Invoke-PptPoll {
${pollScript}
}
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($line -eq $null) { break }
  if ($line -eq 'poll') { Invoke-PptPoll }
  elseif ($line -eq 'exit') { break }
}
`.trim();
}

export function stopPowerPointHelper(reason: string) {
  if (!pptHelperProcess) return;
  logPptInfo('[ppt] helper stopped', { reason });
  try {
    pptHelperProcess.stdin.write('exit\n');
  } catch {
    // ignore write failures during shutdown
  }
  pptHelperProcess.kill();
  pptHelperProcess = null;
  pptHelperReadline?.close();
  pptHelperReadline = null;
  pptHelperPending = [];
}

function ensurePowerPointHelper(pollScript: string) {
  if (pptHelperProcess && pptHelperProcess.exitCode === null) return;
  stopPowerPointHelper('restart');
  const powershellPath = path.join(
    process.env.SystemRoot ?? 'C:\\Windows',
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe'
  );
  const helperScript = buildPowerPointHelperScript(pollScript);
  pptHelperProcess = spawn(
    powershellPath,
    ['-STA', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', helperScript],
    { windowsHide: true }
  );
  pptHelperReadline = readline.createInterface({ input: pptHelperProcess.stdout });
  pptHelperReadline.on('line', (line) => {
    const pending = pptHelperPending.shift();
    if (pending) {
      pending.resolve(line);
    }
  });
  pptHelperProcess.stderr.on('data', (buf) => {
    logPptVerbose('[ppt] helper stderr', buf.toString('utf8').trim());
  });
  pptHelperProcess.on('exit', (code) => {
    logPptInfo('[ppt] helper exited', { code });
    pptHelperProcess = null;
    pptHelperReadline?.close();
    pptHelperReadline = null;
    pptHelperPending = [];
  });
}

async function pollPowerPointViaHelper(
  pollScript: string
): Promise<PowerPointPollResult | null> {
  if (process.platform !== 'win32') return null;
  ensurePowerPointHelper(pollScript);
  const helper = pptHelperProcess;
  if (!helper || helper.exitCode !== null) return null;

  return await new Promise((resolve) => {
    const pending = {
      resolve: (line: string | null) => {
        clearTimeout(timeout);
        if (!line) {
          resolve(null);
          return;
        }
        try {
          resolve(JSON.parse(line) as PowerPointPollResult);
        } catch (error) {
          console.warn(`[ppt] Failed to parse PowerShell output: ${String(error)}`);
          resolve(null);
        }
      }
    };
    const timeout = setTimeout(() => {
      const index = pptHelperPending.indexOf(pending);
      if (index >= 0) {
        pptHelperPending.splice(index, 1);
      }
      resolve(null);
    }, 8000);
    pptHelperPending.push(pending);
    try {
      helper.stdin.write('poll\n');
    } catch {
      clearTimeout(timeout);
      const index = pptHelperPending.indexOf(pending);
      if (index >= 0) {
        pptHelperPending.splice(index, 1);
      }
      resolve(null);
    }
  });
}

export async function fetchPowerPointStatus(): Promise<PowerPointPollResult | null> {
  if (process.platform === 'darwin') {
    const script = `
set output to ""
set pptRunning to false
set pptFrontmost to false
set pptPid to 0
try
  tell application "System Events"
    set pptRunning to (count of (application processes whose name is "Microsoft PowerPoint")) > 0
    if pptRunning then
      set pptProcess to first application process whose name is "Microsoft PowerPoint"
      set pptPid to unix id of pptProcess
      set frontApp to name of first application process whose frontmost is true
      if frontApp contains "PowerPoint" then set pptFrontmost to true
    end if
  end tell
end try
if pptRunning is false then
  return "{\\"state\\":\\"none\\"}"
end if
if pptFrontmost is false then
  return "{\\"state\\":\\"background\\"}"
end if

set slideNumberValue to ""
set totalSlidesValue to ""

try
  tell application "Microsoft PowerPoint"
    if (count of presentations) is 0 then
      set output to "{\\"state\\":\\"foreground\\",\\"instanceId\\":" & pptPid & "}"
      return output
    end if
    set currentPresentation to active presentation
    try
      set totalSlidesValue to count of slides of currentPresentation
    end try
    set inSlideshowValue to false
    try
      if (count of slide show windows) > 0 then
        set inSlideshowValue to true
        set slideNumberValue to current show position of slide show view of slide show window 1
      end if
    end try
  end tell
end try

set output to "{\\"state\\":\\"foreground\\",\\"instanceId\\":" & pptPid
if inSlideshowValue is true then set output to output & ",\\"inSlideshow\\":true"
if inSlideshowValue is false then set output to output & ",\\"inSlideshow\\":false"
if slideNumberValue is not "" then set output to output & ",\\"slideNumber\\":" & slideNumberValue
if totalSlidesValue is not "" then set output to output & ",\\"totalSlides\\":" & totalSlidesValue
set output to output & "}"
return output
`.trim();

    void writePptScript(script);
    return await new Promise((resolve) => {
      const child = spawn('osascript', ['-e', script]);
      let stdout = '';
      let stderr = '';
      const timeout = setTimeout(() => {
        child.kill();
        resolve(null);
      }, 4000);

      child.stdout.on('data', (buf) => {
        stdout += buf.toString('utf8');
      });
      child.stderr.on('data', (buf) => {
        stderr += buf.toString('utf8');
      });
      child.on('error', () => {
        clearTimeout(timeout);
        void appendPptLog('[ppt] osascript error: spawn_failed');
        resolve(null);
      });
      child.on('exit', (code) => {
        clearTimeout(timeout);
        if (code !== 0) {
          console.warn(`[ppt] osascript failed (code=${code}): ${stderr.trim()}`);
          void appendPptLog(
            `[ppt] osascript exit code=${code} stderr=${stderr.trim() || 'none'}`
          );
          void appendPptLog('[ppt] osascript script saved to ppt.script.applescript');
          resolve(null);
          return;
        }
        const raw = stdout.trim();
        if (!raw) {
          void appendPptLog('[ppt] osascript exit ok but stdout empty');
          resolve(null);
          return;
        }
        try {
          logPptVerbose('[ppt] osascript raw', raw);
          void appendPptLog(`[ppt] osascript raw ${raw}`);
          resolve(JSON.parse(raw) as PowerPointPollResult);
        } catch (error) {
          console.warn(`[ppt] Failed to parse osascript output: ${String(error)}`);
          void appendPptLog(`[ppt] parse error: ${String(error)}`);
          resolve(null);
        }
      });
    });
  }

  if (process.platform !== 'win32') {
    return { state: 'none' };
  }

  const nativeResult = await pollPowerPointViaNativeHelper();
  if (nativeResult) {
    return nativeResult;
  }

  const script = `
$debugEnabled = ${isPptDebugVerboseEnabled() ? '$true' : '$false'}
$ErrorActionPreference = 'Stop'
if (-not ("Win32" -as [type])) {
  Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class Win32 {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
}
'@
}
$hwnd = [Win32]::GetForegroundWindow()
$targetPid = 0
[Win32]::GetWindowThreadProcessId($hwnd, [ref]$targetPid) | Out-Null
$hasPowerpoint = @(Get-Process -Name POWERPNT -ErrorAction SilentlyContinue).Count -gt 0
$proc = $null
if ($targetPid -ne 0) { $proc = Get-Process -Id $targetPid -ErrorAction SilentlyContinue }
if (-not $proc -or $proc.ProcessName -ne 'POWERPNT') {
  if ($hasPowerpoint) {
    @{ state = 'background' } | ConvertTo-Json -Compress
  } else {
    @{ state = 'none' } | ConvertTo-Json -Compress
  }
  return
}
$ppt = $null
try { $ppt = [Runtime.InteropServices.Marshal]::GetActiveObject('PowerPoint.Application') } catch { $ppt = $null }
if (-not $ppt) {
  @{ state = 'foreground'; instanceId = $targetPid } | ConvertTo-Json -Compress
  return
}
$protectedViewCount = 0
try { $protectedViewCount = $ppt.ProtectedViewWindows.Count } catch { $protectedViewCount = 0 }
$slideIndex = $null
function Try-GetProp($obj, $name) {
  try { return $obj.$name } catch { return $null }
}

function Convert-ToMs($value) {
  if ($value -eq $null) { return $null }
  $num = [double]$value
  if (-not [double]::IsFinite($num) -or $num -le 0) { return $null }
  if ($num -lt 1000) { return [int][math]::Round($num * 1000) }
  return [int][math]::Round($num)
}
$ssWinError = $null
$ssViewError = $null
$ssPresentationError = $null
$slideIndexError = $null
$targetSlideError = $null
$slideShapesError = $null
$viewSlideError = $null
$viewShapesError = $null
$editSlideError = $null
$editShapesError = $null
$inSlideshow = $false
$ssWinCount = 0
$ssWinFound = $false
$ssViewFound = $false
$ssShowPositionRaw = $null
try { $ssWinCount = $ppt.SlideShowWindows.Count } catch { $ssWinCount = 0 }
$inSlideshow = $ssWinCount -gt 0
$ssWin = $null
if ($ssWinCount -gt 0) {
  try { $ssWin = $ppt.SlideShowWindows.Item(1) } catch { $ssWin = $null; $ssWinError = $_.Exception.Message }
}
if ($ssWin) {
  $ssWinFound = $true
  try {
    $ssView = $ssWin.View
    if ($ssView) {
      $ssViewFound = $true
      $ssShowPositionRaw = Try-GetProp $ssView 'CurrentShowPosition'
    }
  } catch {
    $ssViewError = $_.Exception.Message
  }
}
$presentation = $ppt.ActivePresentation
$activePresentationName = $null
$activePresentationFullName = $null
try { $activePresentationName = $presentation.Name } catch { $activePresentationName = $null }
try { $activePresentationFullName = $presentation.FullName } catch { $activePresentationFullName = $null }
if ($ssWin) {
  try { $presentation = $ssWin.Presentation } catch { $presentation = $presentation; $ssPresentationError = $_.Exception.Message }
}
if (-not $presentation) {
  @{ state = 'foreground'; instanceId = $targetPid } | ConvertTo-Json -Compress
  return
}
$presentationPath = $null
$presentationSaved = $null
$presentationReadOnly = $null
$presentationSlidesCount = $null
try { $presentationPath = $presentation.Path } catch { $presentationPath = $null }
try { $presentationSaved = $presentation.Saved } catch { $presentationSaved = $null }
try { $presentationReadOnly = $presentation.ReadOnly } catch { $presentationReadOnly = $null }
try { $presentationSlidesCount = $presentation.Slides.Count } catch { $presentationSlidesCount = $null }
$ssPresentationName = $null
$ssPresentationFullName = $null
if ($ssWin) {
  try { $ssPresentationName = $presentation.Name } catch { $ssPresentationName = $null }
  try { $ssPresentationFullName = $presentation.FullName } catch { $ssPresentationFullName = $null }
}

$mediaCandidates = @()
function Add-MediaCandidate($shape) {
  try {
    $mediaCandidates += $shape
  } catch {
    $mediaCandidates = $mediaCandidates
  }
}

function Collect-MediaShapes($shapes) {
  if (-not $shapes) { return }
  for ($i = 1; $i -le $shapes.Count; $i++) {
    $shape = $shapes.Item($i)
    $shapeType = Try-GetProp $shape 'Type'
    $mediaFormat = $null
    try { $mediaFormat = $shape.MediaFormat } catch { $mediaFormat = $null }
    $isMedia = $mediaFormat -ne $null
    if (-not $isMedia -and $shapeType -eq 16) { $isMedia = $true } # msoMedia
    if (-not $isMedia) {
      try {
        $placeholder = $shape.PlaceholderFormat
        $containedType = Try-GetProp $placeholder 'ContainedType'
        if ($containedType -eq 16) { $isMedia = $true }
      } catch {
        $isMedia = $isMedia
      }
    }
    if ($isMedia) {
      Add-MediaCandidate $shape
    }
    if ($shapeType -eq 6) { # msoGroup
      try { Collect-MediaShapes $shape.GroupItems } catch { }
    }
  }
}

$videoPlaying = $null
$videoDurationMs = $null
$videoElapsedMs = $null
$videoRemainingMs = $null
$videoTimingUnavailable = $false
$playerSource = $null
$mediaShapeCount = 0
$mediaLengthRaw = $null
$slideMediaCount = 0
$slideMediaLengthRaw = $null
$slideShapeCount = 0
$slideShapeDebug = @()
$viewSlideShapeCount = 0
$viewSlideMediaCount = 0
$viewSlideMediaLengthRaw = $null
$viewSlideShapeDebug = @()
$candidateCount = 0
$editSlideShapeCount = 0
$editSlideMediaCount = 0
$editSlideMediaLengthRaw = $null
$editSlideShapeDebug = @()
$layoutShapeCount = 0
$layoutMediaCount = 0
$layoutMediaLengthRaw = $null
$layoutShapeDebug = @()
$masterShapeCount = 0
$masterMediaCount = 0
$masterMediaLengthRaw = $null
$masterShapeDebug = @()
$timelineEffectCount = 0
$timelineMediaCount = 0
$timelineMediaLengthRaw = $null
$timelineShapeDebug = @()
$activeSlideShapeCount = $null
$ssPresentationSlideShapeCount = $null
$ssViewSlideShapeCount = $null
$activeSlideShapeError = $null
$ssPresentationSlideShapeError = $null
$ssViewSlideShapeError = $null
$ssPresentationSlideShapeDebug = @()
$apartmentState = $null
$apartmentStateName = $null
$runspaceApartment = $null
$psVersion = $null
$psHostName = $null
$pptVersion = $null
$pptBuild = $null
if ($inSlideshow) {
  if ($ssShowPositionRaw -ne $null) {
    $slideIndex = $ssShowPositionRaw
  } elseif ($ssWin) {
    try { $slideIndex = $ssWin.View.CurrentShowPosition } catch { $slideIndex = $null; $slideIndexError = $_.Exception.Message }
    if ($slideIndex -eq $null) {
      try { $slideIndex = $ssWin.View.Slide.SlideIndex } catch { $slideIndex = $slideIndex; $slideIndexError = $_.Exception.Message }
    }
  }
  try { $apartmentState = [System.Threading.Thread]::CurrentThread.ApartmentState } catch { $apartmentState = $null }
  try { $apartmentStateName = [System.Threading.Thread]::CurrentThread.ApartmentState.ToString() } catch { $apartmentStateName = $null }
  try { $runspaceApartment = $Host.Runspace.ApartmentState.ToString() } catch { $runspaceApartment = $null }
  try { $psVersion = $PSVersionTable.PSVersion.ToString() } catch { $psVersion = $null }
  try { $psHostName = $Host.Name } catch { $psHostName = $null }
  try { $pptVersion = $ppt.Version } catch { $pptVersion = $null }
  try { $pptBuild = $ppt.Build } catch { $pptBuild = $null }
  try {
    $player = $null
    try { $player = $ppt.SlideShowWindows.Item(1).View.Player; if ($player) { $playerSource = 'SlideShowView.Player' } } catch { $player = $null }
    if (-not $player) { try { $player = $ppt.SlideShowWindows.Item(1).View.MediaPlayer; if ($player) { $playerSource = 'SlideShowView.MediaPlayer' } } catch { $player = $null } }
    if (-not $player) { try { $player = $ppt.ActiveWindow.View.Player; if ($player) { $playerSource = 'ActiveWindow.View.Player' } } catch { $player = $null } }
    if ($player) {
      $duration = $null
      $elapsed = $null
      $state = $null
      $duration = Try-GetProp $player 'Duration'
      if ($duration -eq $null) { $duration = Try-GetProp $player 'Length' }
      if ($duration -eq $null) { $duration = Try-GetProp $player 'TotalTime' }
      if ($duration -eq $null) { $duration = Try-GetProp $player 'TotalDuration' }
      $elapsed = Try-GetProp $player 'CurrentPosition'
      if ($elapsed -eq $null) { $elapsed = Try-GetProp $player 'Position' }
      if ($elapsed -eq $null) { $elapsed = Try-GetProp $player 'CurrentTime' }
      if ($elapsed -eq $null) { $elapsed = Try-GetProp $player 'Time' }
      $state = Try-GetProp $player 'State'
      if ($state -eq $null) { $state = Try-GetProp $player 'PlayerState' }
      if ($duration -ne $null) { $duration = [double]$duration }
      if ($elapsed -ne $null) { $elapsed = [double]$elapsed }
      $videoDurationMs = Convert-ToMs $duration
      $videoElapsedMs = Convert-ToMs $elapsed
      if ($videoDurationMs -ne $null -and $videoElapsedMs -ne $null) {
        $videoRemainingMs = [int][math]::Max(0, $videoDurationMs - $videoElapsedMs)
      }
      if ($state -ne $null) { $videoPlaying = ($state -eq 1) }
    }
    try {
      if ($ssWin) {
        $shapes = $ssWin.View.Slide.Shapes
        if ($shapes) {
          $mediaShapeCount = $shapes.Count
          Collect-MediaShapes $shapes
        }
      }
    } catch {
      $mediaShapeCount = $mediaShapeCount
    }
    try {
      if ($slideIndex -ne $null) {
        $targetSlide = $null
        if ($ssWin) {
          try { $targetSlide = $ssWin.Presentation.Slides.Item($ssWin.View.CurrentShowPosition) } catch { $targetSlide = $null; $targetSlideError = $_.Exception.Message }
        }
        if (-not $targetSlide) {
          try { $targetSlide = $presentation.Slides.Item([int]$slideIndex) } catch { $targetSlide = $null; $targetSlideError = $_.Exception.Message }
        }
        if ($presentation -and $slideIndex -ne $null) {
          try { $activeSlideShapeCount = $presentation.Slides.Item([int]$slideIndex).Shapes.Count } catch { $activeSlideShapeCount = $null; $activeSlideShapeError = $_.Exception.Message }
        }
        if ($ssWin -and $slideIndex -ne $null) {
          try {
            $ssSlide = $ssWin.Presentation.Slides.Item([int]$slideIndex)
            $ssPresentationSlideShapeCount = $ssSlide.Shapes.Count
            if ($debugEnabled -and $ssPresentationSlideShapeDebug.Count -lt 6) {
              for ($i = 1; $i -le $ssSlide.Shapes.Count; $i++) {
                $shape = $ssSlide.Shapes.Item($i)
                $shapeType = Try-GetProp $shape 'Type'
                $mediaType = Try-GetProp $shape 'MediaType'
                $shapeName = Try-GetProp $shape 'Name'
                $ssPresentationSlideShapeDebug += @{ name = $shapeName; type = $shapeType; mediaType = $mediaType }
              }
            }
          } catch { $ssPresentationSlideShapeCount = $null; $ssPresentationSlideShapeError = $_.Exception.Message }
        }
        $slideShapes = $null
        try { $slideShapes = $targetSlide.Shapes } catch { $slideShapes = $null; $slideShapesError = $_.Exception.Message }
        if ($slideShapes) {
          try { $slideShapeCount = $slideShapes.Count } catch { $slideShapeCount = 0; $slideShapesError = $_.Exception.Message }
          for ($i = 1; $i -le $slideShapes.Count; $i++) {
            $shape = $slideShapes.Item($i)
            $mediaFormat = $null
            try { $mediaFormat = $shape.MediaFormat } catch { $mediaFormat = $null }
            if ($debugEnabled -and $slideShapeDebug.Count -lt 6) {
              $shapeType = Try-GetProp $shape 'Type'
              $mediaType = Try-GetProp $shape 'MediaType'
              $hasMedia = $mediaFormat -ne $null
              $shapeName = Try-GetProp $shape 'Name'
              $slideShapeDebug += @{ name = $shapeName; type = $shapeType; mediaType = $mediaType; hasMedia = $hasMedia }
            }
            if ($mediaFormat) {
              $slideMediaCount += 1
              if ($slideMediaLengthRaw -eq $null) {
                $slideMediaLengthRaw = Try-GetProp $mediaFormat 'Length'
              }
            }
          }
          Collect-MediaShapes $slideShapes
        }
        try {
          $timeline = $targetSlide.TimeLine
          if ($timeline) {
            $sequence = $timeline.MainSequence
            if ($sequence) {
              $timelineEffectCount = $sequence.Count
              for ($i = 1; $i -le $sequence.Count; $i++) {
                $effect = $sequence.Item($i)
                $effectShape = $null
                try { $effectShape = $effect.Shape } catch { $effectShape = $null }
                if ($effectShape) {
                  $mediaFormat = $null
                  try { $mediaFormat = $effectShape.MediaFormat } catch { $mediaFormat = $null }
                  if ($debugEnabled -and $timelineShapeDebug.Count -lt 6) {
                    $shapeType = Try-GetProp $effectShape 'Type'
                    $mediaType = Try-GetProp $effectShape 'MediaType'
                    $hasMedia = $mediaFormat -ne $null
                    $shapeName = Try-GetProp $effectShape 'Name'
                    $timelineShapeDebug += @{ name = $shapeName; type = $shapeType; mediaType = $mediaType; hasMedia = $hasMedia }
                  }
                  if ($mediaFormat) {
                    $timelineMediaCount += 1
                    if ($timelineMediaLengthRaw -eq $null) {
                      $timelineMediaLengthRaw = Try-GetProp $mediaFormat 'Length'
                    }
                    Add-MediaCandidate $effectShape
                  }
                }
              }
            }
          }
        } catch { }
        try {
          $layoutShapes = $targetSlide.CustomLayout.Shapes
          if ($layoutShapes) {
            $layoutShapeCount = $layoutShapes.Count
            for ($i = 1; $i -le $layoutShapes.Count; $i++) {
              $shape = $layoutShapes.Item($i)
              $mediaFormat = $null
              try { $mediaFormat = $shape.MediaFormat } catch { $mediaFormat = $null }
              if ($debugEnabled -and $layoutShapeDebug.Count -lt 6) {
                $shapeType = Try-GetProp $shape 'Type'
                $mediaType = Try-GetProp $shape 'MediaType'
                $hasMedia = $mediaFormat -ne $null
                $shapeName = Try-GetProp $shape 'Name'
                $layoutShapeDebug += @{ name = $shapeName; type = $shapeType; mediaType = $mediaType; hasMedia = $hasMedia }
              }
              if ($mediaFormat) {
                $layoutMediaCount += 1
                if ($layoutMediaLengthRaw -eq $null) {
                  $layoutMediaLengthRaw = Try-GetProp $mediaFormat 'Length'
                }
              }
            }
            Collect-MediaShapes $layoutShapes
          }
        } catch { }
        try {
          $masterShapes = $targetSlide.Master.Shapes
          if ($masterShapes) {
            $masterShapeCount = $masterShapes.Count
            for ($i = 1; $i -le $masterShapes.Count; $i++) {
              $shape = $masterShapes.Item($i)
              $mediaFormat = $null
              try { $mediaFormat = $shape.MediaFormat } catch { $mediaFormat = $null }
              if ($debugEnabled -and $masterShapeDebug.Count -lt 6) {
                $shapeType = Try-GetProp $shape 'Type'
                $mediaType = Try-GetProp $shape 'MediaType'
                $hasMedia = $mediaFormat -ne $null
                $shapeName = Try-GetProp $shape 'Name'
                $masterShapeDebug += @{ name = $shapeName; type = $shapeType; mediaType = $mediaType; hasMedia = $hasMedia }
              }
              if ($mediaFormat) {
                $masterMediaCount += 1
                if ($masterMediaLengthRaw -eq $null) {
                  $masterMediaLengthRaw = Try-GetProp $mediaFormat 'Length'
                }
              }
            }
            Collect-MediaShapes $masterShapes
          }
        } catch { }
      }
    } catch {
      $slideMediaCount = $slideMediaCount
    }
    try {
      $viewSlide = $null
      try { $viewSlide = $ssWin.View.Slide } catch { $viewSlide = $null; $viewSlideError = $_.Exception.Message }
      if ($viewSlide) {
        try { $ssViewSlideShapeCount = $viewSlide.Shapes.Count } catch { $ssViewSlideShapeCount = $null; $ssViewSlideShapeError = $_.Exception.Message }
        $viewShapes = $null
        try { $viewShapes = $viewSlide.Shapes } catch { $viewShapes = $null; $viewShapesError = $_.Exception.Message }
        if ($viewShapes) {
          try { $viewSlideShapeCount = $viewShapes.Count } catch { $viewSlideShapeCount = 0; $viewShapesError = $_.Exception.Message }
          for ($i = 1; $i -le $viewShapes.Count; $i++) {
            $shape = $viewShapes.Item($i)
            $mediaFormat = $null
            try { $mediaFormat = $shape.MediaFormat } catch { $mediaFormat = $null }
            if ($debugEnabled -and $viewSlideShapeDebug.Count -lt 6) {
              $shapeType = Try-GetProp $shape 'Type'
              $mediaType = Try-GetProp $shape 'MediaType'
              $hasMedia = $mediaFormat -ne $null
              $shapeName = Try-GetProp $shape 'Name'
              $viewSlideShapeDebug += @{ name = $shapeName; type = $shapeType; mediaType = $mediaType; hasMedia = $hasMedia }
            }
            if ($mediaFormat) {
              $viewSlideMediaCount += 1
              if ($viewSlideMediaLengthRaw -eq $null) {
                $viewSlideMediaLengthRaw = Try-GetProp $mediaFormat 'Length'
              }
            }
          }
          Collect-MediaShapes $viewShapes
        }
      }
    } catch {
      $viewSlideMediaCount = $viewSlideMediaCount
    }
    try {
      $editSlide = $null
      try { $editSlide = $ppt.ActiveWindow.View.Slide } catch { $editSlide = $null; $editSlideError = $_.Exception.Message }
      if ($editSlide) {
        $editShapes = $null
        try { $editShapes = $editSlide.Shapes } catch { $editShapes = $null; $editShapesError = $_.Exception.Message }
        if ($editShapes) {
          try { $editSlideShapeCount = $editShapes.Count } catch { $editSlideShapeCount = 0; $editShapesError = $_.Exception.Message }
          for ($i = 1; $i -le $editShapes.Count; $i++) {
            $shape = $editShapes.Item($i)
            $mediaFormat = $null
            try { $mediaFormat = $shape.MediaFormat } catch { $mediaFormat = $null }
            if ($debugEnabled -and $editSlideShapeDebug.Count -lt 6) {
              $shapeType = Try-GetProp $shape 'Type'
              $mediaType = Try-GetProp $shape 'MediaType'
              $hasMedia = $mediaFormat -ne $null
              $shapeName = Try-GetProp $shape 'Name'
              $editSlideShapeDebug += @{ name = $shapeName; type = $shapeType; mediaType = $mediaType; hasMedia = $hasMedia }
            }
            if ($mediaFormat) {
              $editSlideMediaCount += 1
              if ($editSlideMediaLengthRaw -eq $null) {
                $editSlideMediaLengthRaw = Try-GetProp $mediaFormat 'Length'
              }
            }
          }
          Collect-MediaShapes $editShapes
        }
      }
    } catch {
      $editSlideMediaCount = $editSlideMediaCount
    }
    $candidateCount = $mediaCandidates.Count
    foreach ($shape in $mediaCandidates) {
      if ($videoDurationMs -eq $null) {
        try {
          $mediaFormat = $shape.MediaFormat
          $length = Try-GetProp $mediaFormat 'Length'
          $videoDurationMs = Convert-ToMs $length
        } catch { }
      }
      try {
        $shapeId = Try-GetProp $shape 'Id'
        if ($shapeId -ne $null) {
          $viewPlayer = $ppt.SlideShowWindows.Item(1).View.Player($shapeId)
          if ($viewPlayer) {
            $playerSource = 'SlideShowView.Player(shapeId)'
            $state = Try-GetProp $viewPlayer 'State'
            $pos = Try-GetProp $viewPlayer 'CurrentPosition'
            if ($pos -ne $null) {
              $videoElapsedMs = Convert-ToMs $pos
            }
            if ($state -ne $null) {
              if ($state -eq 2) { $videoPlaying = $true }
              elseif ($state -eq 1) { $videoPlaying = $false }
            }
          }
        }
      } catch { }
      if ($videoDurationMs -ne $null -or $videoElapsedMs -ne $null) { break }
    }
    if ($videoDurationMs -eq $null -and $slideMediaLengthRaw -ne $null) {
      $videoDurationMs = Convert-ToMs $slideMediaLengthRaw
    }
  } catch {
    $videoPlaying = $null
  }
  if (
    $player -ne $null -and
    $videoDurationMs -eq $null -and
    $videoElapsedMs -eq $null -and
    $candidateCount -eq 0 -and
    $slideShapeCount -eq 0 -and
    $viewSlideShapeCount -eq 0 -and
    $editSlideShapeCount -eq 0
  ) {
    $videoTimingUnavailable = $true
  }
} else {
  try { $slideIndex = $ppt.ActiveWindow.View.Slide.SlideIndex } catch { $slideIndex = $null }
}
$totalSlides = $null
try { $totalSlides = $presentation.Slides.Count } catch { $totalSlides = $null }
$title = $presentation.Name
$filename = $presentation.FullName
$payload = @{
  state = 'foreground'
  inSlideshow = $inSlideshow
  instanceId = $targetPid
  slideNumber = $slideIndex
  totalSlides = $totalSlides
  title = $title
  filename = $filename
}
if ($debugEnabled) {
  $payload.debug = @{
    playerFound = [bool]$player
    playerSource = $playerSource
    durationRaw = $duration
    elapsedRaw = $elapsed
    stateRaw = $state
    mediaShapeCount = $mediaShapeCount
    mediaLengthRaw = $mediaLengthRaw
    slideMediaCount = $slideMediaCount
    slideMediaLengthRaw = $slideMediaLengthRaw
    slideShapeCount = $slideShapeCount
    slideShapeDebug = $slideShapeDebug
    viewSlideShapeCount = $viewSlideShapeCount
    viewSlideMediaCount = $viewSlideMediaCount
    viewSlideMediaLengthRaw = $viewSlideMediaLengthRaw
    viewSlideShapeDebug = $viewSlideShapeDebug
    candidateCount = $candidateCount
    protectedViewCount = $protectedViewCount
    ssWinCount = $ssWinCount
    ssWinFound = $ssWinFound
    ssViewFound = $ssViewFound
    ssShowPositionRaw = $ssShowPositionRaw
    ssWinError = $ssWinError
    ssViewError = $ssViewError
    ssPresentationError = $ssPresentationError
    slideIndexError = $slideIndexError
    targetSlideError = $targetSlideError
    slideShapesError = $slideShapesError
    viewSlideError = $viewSlideError
    viewShapesError = $viewShapesError
    editSlideError = $editSlideError
    editShapesError = $editShapesError
    activePresentationName = $activePresentationName
    activePresentationFullName = $activePresentationFullName
    ssPresentationName = $ssPresentationName
    ssPresentationFullName = $ssPresentationFullName
    presentationPath = $presentationPath
    presentationSaved = $presentationSaved
    presentationReadOnly = $presentationReadOnly
    presentationSlidesCount = $presentationSlidesCount
    editSlideShapeCount = $editSlideShapeCount
    editSlideMediaCount = $editSlideMediaCount
    editSlideMediaLengthRaw = $editSlideMediaLengthRaw
    editSlideShapeDebug = $editSlideShapeDebug
    layoutShapeCount = $layoutShapeCount
    layoutMediaCount = $layoutMediaCount
    layoutMediaLengthRaw = $layoutMediaLengthRaw
    layoutShapeDebug = $layoutShapeDebug
    masterShapeCount = $masterShapeCount
    masterMediaCount = $masterMediaCount
    masterMediaLengthRaw = $masterMediaLengthRaw
    masterShapeDebug = $masterShapeDebug
    timelineEffectCount = $timelineEffectCount
    timelineMediaCount = $timelineMediaCount
    timelineMediaLengthRaw = $timelineMediaLengthRaw
    timelineShapeDebug = $timelineShapeDebug
    activeSlideShapeCount = $activeSlideShapeCount
    ssPresentationSlideShapeCount = $ssPresentationSlideShapeCount
    ssViewSlideShapeCount = $ssViewSlideShapeCount
    activeSlideShapeError = $activeSlideShapeError
    ssPresentationSlideShapeError = $ssPresentationSlideShapeError
    ssViewSlideShapeError = $ssViewSlideShapeError
    ssPresentationSlideShapeDebug = $ssPresentationSlideShapeDebug
    apartmentState = $apartmentState
    apartmentStateName = $apartmentStateName
    runspaceApartment = $runspaceApartment
    psVersion = $psVersion
    psHostName = $psHostName
    pptVersion = $pptVersion
    pptBuild = $pptBuild
  }
}
if ($videoPlaying -ne $null) { $payload.videoPlaying = $videoPlaying }
if ($videoDurationMs -ne $null) { $payload.videoDuration = $videoDurationMs }
if ($videoElapsedMs -ne $null) { $payload.videoElapsed = $videoElapsedMs }
if ($videoRemainingMs -ne $null) { $payload.videoRemaining = $videoRemainingMs }
if ($videoTimingUnavailable) { $payload.videoTimingUnavailable = $true }
$payload | ConvertTo-Json -Compress
`.trim();

  const helperResult = await pollPowerPointViaHelper(script);
  if (helperResult) {
    return helperResult;
  }

  return await new Promise((resolve) => {
    const powershellPath = path.join(
      process.env.SystemRoot ?? 'C:\\Windows',
      'System32',
      'WindowsPowerShell',
      'v1.0',
      'powershell.exe'
    );
    const child = spawn(
      powershellPath,
      ['-STA', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { windowsHide: true }
    );
    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(() => {
      child.kill();
      if (isPptDebugEnabled()) {
        console.warn('[ppt] PowerShell timeout');
      }
      resolve(null);
    }, 8000);

    child.stdout.on('data', (buf) => {
      stdout += buf.toString('utf8');
    });
    child.stderr.on('data', (buf) => {
      stderr += buf.toString('utf8');
    });
    child.on('error', () => {
      clearTimeout(timeout);
      resolve(null);
    });
    child.on('exit', (code) => {
      clearTimeout(timeout);
      if (code !== 0) {
        console.warn(`[ppt] PowerShell failed (code=${code}): ${stderr.trim()}`);
        resolve(null);
        return;
      }
      const raw = stdout.trim();
      if (!raw) {
        resolve(null);
        return;
      }
      try {
        resolve(JSON.parse(raw) as PowerPointPollResult);
      } catch (error) {
        console.warn(`[ppt] Failed to parse PowerShell output: ${String(error)}`);
        resolve(null);
      }
    });
  });
}
