using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text.Json;

namespace OnTime.PptProbe;

internal static class Program
{
  private const int ProtocolVersion = 1;
  // PowerPoint.PpPlayerState values. Keep these explicit: COM returns the
  // numeric enum and treating stopped as playing makes the UI count through
  // a stopped video until elapsed-delta inference catches up.
  private const int PpPlayerPlaying = 0;
  private const int PpPlayerPaused = 1;
  private const int PpPlayerStopped = 2;
  private const int PpPlayerNotReady = 3;
  // `build-windows.ps1` sets this from apps/ppt-timer/package.json, making the
  // native payload identify the exact beta product build that launched it.
  private static readonly string ProductVersion =
    typeof(Program).Assembly.GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion ??
    typeof(Program).Assembly.GetName().Version?.ToString() ??
    "unknown";
  private const string SlideshowStateUnavailable = "slideshow_state_unavailable";
  // Value-only media cache for the current attached presentation/slide. Never
  // retain a COM object: a wrapper can become invalid as PowerPoint changes
  // view or presentation. The descriptor cache is built by a cold full scan;
  // warm polls only sweep the cached Shape.Id values through SlideShowView.Player.
  private static string? MediaCacheScope;
  private static readonly List<CachedMediaDescriptor> MediaDescriptors = new();
  private static bool HasCompleteMediaDescriptorCache;
  private static readonly Dictionary<int, CachedMediaValue> MediaValuesByShapeId = new();
  private static int StableStoppedRefreshCursor;
  private static int ActiveTimingRefreshCursor;

  private sealed class MediaCandidate
  {
    public required Dictionary<string, object?> Entry { get; init; }
    public int? ShapeId { get; init; }
    public int? DurationMs { get; init; }
    public object? Player { get; init; }
    public int? StateRaw { get; init; }
  }

  private sealed class CachedMediaValue
  {
    public string? Name { get; init; }
    public int? DurationMs { get; init; }
    public int? ElapsedMs { get; init; }
    public int? RemainingMs { get; init; }
    public string? Status { get; init; }
    public int? StateRaw { get; init; }
    // Stopwatch ticks of the last COM timing sample. Warm state sweeps advance
    // unchanged playing values from this anchor; the renderer then continues
    // its own bounded local clock without receiving a stale position reset.
    public long? TimingAnchorTicks { get; init; }
  }

  private sealed class CachedMediaDescriptor
  {
    public required int ShapeId { get; init; }
    public string? Name { get; init; }
    public int? DurationMs { get; init; }
  }

  // Windows-only STA helper to access PowerPoint COM reliably from a persistent process.
  // Companion spawns this binary and communicates over stdin/stdout using "poll"/"exit".
  [DllImport("user32.dll")]
  private static extern IntPtr GetForegroundWindow();

  [DllImport("user32.dll")]
  private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

  [STAThread]
  private static void Main()
  {
    while (true)
    {
      var line = Console.ReadLine();
      if (line == null) break;
      if (string.Equals(line, "poll", StringComparison.OrdinalIgnoreCase))
      {
        var payload = Poll();
        var json = JsonSerializer.Serialize(payload);
        Console.WriteLine(json);
        Console.Out.Flush();
      }
      else if (string.Equals(line, "exit", StringComparison.OrdinalIgnoreCase))
      {
        break;
      }
    }
  }

  private static Dictionary<string, object?> Poll()
  {
    var payload = new Dictionary<string, object?>(StringComparer.OrdinalIgnoreCase)
    {
      ["protocolVersion"] = ProtocolVersion,
      ["productVersion"] = ProductVersion,
    };

    var hwnd = GetForegroundWindow();
    var targetPid = 0u;
    if (hwnd != IntPtr.Zero)
    {
      GetWindowThreadProcessId(hwnd, out targetPid);
    }

    var pptProcesses = Process.GetProcessesByName("POWERPNT");
    if (pptProcesses.Length == 0)
    {
      ResetMediaValueCache();
      payload["state"] = "none";
      return payload;
    }

    var isForeground = false;
    if (targetPid != 0)
    {
      try
      {
        var proc = Process.GetProcessById((int)targetPid);
        isForeground = string.Equals(proc.ProcessName, "POWERPNT", StringComparison.OrdinalIgnoreCase);
      }
      catch
      {
        isForeground = false;
      }
    }

    var pptPid = isForeground ? (int)targetPid : pptProcesses[0].Id;
    payload["state"] = isForeground ? "foreground" : "background";
    payload["instanceId"] = pptPid;
    // Canonical process/COM affinity (ISSUE-001 S-012/S-026). processCount and
    // selectedPid come straight from the process snapshot already taken above;
    // they are emitted on every running-PowerPoint outcome. The app consumes
    // these verbatim and never recomputes them.
    payload["processCount"] = pptProcesses.Length;
    payload["selectedPid"] = pptPid;
    // Multiple running PowerPoint processes are already enough to warn. COM
    // HWND/PID resolution can strengthen the mismatch signal, but is optional.
    payload["affinityMismatch"] = pptProcesses.Length > 1;

    object? pptObj = null;
    string? pptError = null;
    try
    {
      pptObj = GetActiveObject("PowerPoint.Application");
    }
    catch (Exception ex)
    {
      pptError = ex.Message;
    }

    if (pptObj == null)
    {
      ResetMediaValueCache();
      payload["pptActive"] = false;
      if (!string.IsNullOrWhiteSpace(pptError))
      {
        payload["pptError"] = pptError;
      }
      return payload;
    }
    payload["pptActive"] = true;

    // Resolve the COM-attached PID when HWND is available. The baseline
    // processCount warning above remains valid when HWND/PID lookup fails.
    int? comPid = null;
    var appHwndObj = TryGetProp(pptObj, "HWND");
    if (appHwndObj != null)
    {
      try
      {
        var hwndValue = Convert.ToInt64(appHwndObj);
        if (hwndValue != 0)
        {
          GetWindowThreadProcessId((IntPtr)hwndValue, out var attachedComPid);
          if (attachedComPid != 0)
          {
            comPid = (int)attachedComPid;
            payload["comPid"] = comPid.Value;
            payload["affinityMismatch"] =
              (payload.TryGetValue("affinityMismatch", out var mismatchRaw) && mismatchRaw is bool mismatch && mismatch) ||
              comPid.Value != pptPid;
          }
        }
      }
      catch
      {
        // HWND is optional; preserve the process-count-derived warning.
      }
    }

    var slideShowWindows = TryGetProp(pptObj, "SlideShowWindows");
    var ssCount = TryGetInt(TryGetProp(slideShowWindows, "Count")) ?? 0;
    var inSlideshow = ssCount > 0;
    payload["inSlideshow"] = inSlideshow;

    object? presentation = TryGetProp(pptObj, "ActivePresentation");
    object? ssWin = null;
    object? ssView = null;
    if (ssCount > 0)
    {
      ssWin = TryInvoke(slideShowWindows, "Item", 1);
      if (ssWin == null)
      {
        ResetMediaValueCache();
        payload["pptError"] = SlideshowStateUnavailable;
        return payload;
      }
      presentation = TryGetProp(ssWin, "Presentation") ?? presentation;
      ssView = TryGetProp(ssWin, "View");
      if (presentation == null || ssView == null)
      {
        ResetMediaValueCache();
        payload["pptError"] = SlideshowStateUnavailable;
        return payload;
      }
    }

    var title = TryGetProp(presentation, "Name") as string;
    var filename = TryGetProp(presentation, "FullName") as string;
    var totalSlides = TryGetInt(TryGetProp(TryGetProp(presentation, "Slides"), "Count"));
    if (!string.IsNullOrWhiteSpace(title)) payload["title"] = title;
    if (!string.IsNullOrWhiteSpace(filename)) payload["filename"] = filename;
    if (totalSlides.HasValue) payload["totalSlides"] = totalSlides.Value;

    if (!inSlideshow)
    {
      ResetMediaValueCache();
      return payload;
    }

    var slideIndex = TryGetInt(TryGetProp(ssView, "CurrentShowPosition"));
    if (!slideIndex.HasValue || slideIndex.Value <= 0)
    {
      ResetMediaValueCache();
      payload["pptError"] = SlideshowStateUnavailable;
      return payload;
    }
    payload["slideNumber"] = slideIndex.Value;

    // Shape.Id is meaningful only inside the attached process, presentation,
    // and slideshow-slide scope. A scope change drops every remembered value.
    BeginMediaValueScope($"{comPid ?? pptPid}:{filename ?? title ?? string.Empty}:{slideIndex.Value}");

    // A warm poll deliberately does no Shapes/MediaFormat traversal. It still
    // reads Player.State for every cached id, so every v1 video row has a fresh
    // playback state. Any cache miss, bad state, or Player failure falls back
    // to the authoritative cold scan below; no partial descriptor list is sent.
    var isWarmPoll = TryBuildWarmCandidates(ssView, out var candidates);
    if (isWarmPoll)
    {
      payload["videoDetected"] = MediaDescriptors.Count > 0;
    }
    else
    {
      var slides = TryGetProp(presentation, "Slides");
      if (slides == null)
      {
        ResetMediaValueCache();
        payload["pptError"] = SlideshowStateUnavailable;
        return payload;
      }
      var slide = TryInvoke(slides, "Item", slideIndex.Value);
      if (slide == null)
      {
        ResetMediaValueCache();
        payload["pptError"] = SlideshowStateUnavailable;
        return payload;
      }

      var slideCandidates = new List<object?>();
      // `slide` is the slideshow window's presentation/position and is the
      // authoritative source while in slideshow. Never scan ActiveWindow here.
      var mediaCollectionComplete = CollectMediaShapes(TryGetProp(slide, "Shapes"), slideCandidates);
      payload["videoDetected"] = slideCandidates.Count > 0;
      candidates = BuildColdCandidates(
        slideCandidates,
        ssView,
        out var hasInvalidPlayerState,
        out var canWarmCache,
        out var presentShapeIds
      );
      if (hasInvalidPlayerState) ResetMediaValueCache();
      if (canWarmCache && !hasInvalidPlayerState)
      {
        PruneMediaValues(presentShapeIds);
        CacheMediaDescriptors(candidates, mediaCollectionComplete);
      }
      else DisableWarmDescriptorCache();
    }

    // A warm state sweep reconciles one stable stopped/not-ready player as
    // well as one stable active player. That lets a same-state reset to zero
    // clear a cached paused/ended row without reintroducing all idle timings.
    var stableStoppedRefreshId = SelectStableStoppedRefresh(candidates);
    var activeTimingRefreshId = isWarmPoll ? SelectActiveTimingRefresh(candidates) : null;
    var videos = new List<Dictionary<string, object?>>();
    Dictionary<string, object?>? primaryVideo = null;
    int? primaryVideoIndex = null;
    var primaryLocked = false;

    foreach (var candidate in candidates)
    {
      var entry = candidate.Entry;
      CachedMediaValue? cached = null;
      if (candidate.ShapeId.HasValue)
      {
        MediaValuesByShapeId.TryGetValue(candidate.ShapeId.Value, out cached);
      }
      if (cached != null && MetadataChanged(cached, entry, candidate.DurationMs))
      {
        MediaValuesByShapeId.Remove(candidate.ShapeId!.Value);
        cached = null;
      }

      var stateChanged = cached != null && cached.StateRaw != candidate.StateRaw;
      var shouldReadPosition = candidate.ShapeId.HasValue &&
        (cached == null ||
          stateChanged ||
          (!isWarmPoll && (candidate.StateRaw is PpPlayerPlaying or PpPlayerPaused ||
            candidate.ShapeId == stableStoppedRefreshId)) ||
          (isWarmPoll && (candidate.ShapeId == activeTimingRefreshId ||
            candidate.ShapeId == stableStoppedRefreshId)));
      var rawElapsed = shouldReadPosition
        ? TryGetNumber(TryGetProp(candidate.Player, "CurrentPosition"))
        : null;
      var effectiveDurationMs = candidate.DurationMs ?? cached?.DurationMs;
      if (!candidate.DurationMs.HasValue && effectiveDurationMs.HasValue)
      {
        entry["duration"] = effectiveDurationMs.Value;
      }
      var freshElapsedMs = NormalizeElapsed(effectiveDurationMs, rawElapsed);
      if (ShouldReplaceStaleTerminalPositionWithPlayAnchor(
        cached,
        candidate.StateRaw,
        effectiveDurationMs,
        freshElapsedMs))
      {
        // PowerPoint can change Player.State from stopped to playing before
        // CurrentPosition leaves the previous run's terminal value. The state
        // transition is authoritative start evidence; emitting the stale end
        // would flash 00:00 and prevent focus from recognizing the new play.
        freshElapsedMs = 0;
      }
      var hasFreshPosition = freshElapsedMs.HasValue;
      var elapsedMs = freshElapsedMs;
      var usedAdvancedWarmElapsed = false;
      if (!elapsedMs.HasValue && !(stateChanged && candidate.StateRaw == PpPlayerPlaying))
      {
        elapsedMs = isWarmPoll
          ? AdvanceCachedElapsed(cached, effectiveDurationMs, candidate.StateRaw)
          : cached?.ElapsedMs;
        usedAdvancedWarmElapsed = isWarmPoll &&
          candidate.StateRaw == PpPlayerPlaying &&
          elapsedMs.HasValue &&
          cached?.ElapsedMs != elapsedMs;
      }
      if (elapsedMs.HasValue)
      {
        entry["elapsed"] = elapsedMs.Value;
      }

      string? status = null;
      int? remaining = null;
      if (effectiveDurationMs.HasValue && elapsedMs.HasValue && elapsedMs.Value <= effectiveDurationMs.Value * 2)
      {
        remaining = Math.Max(0, effectiveDurationMs.Value - elapsedMs.Value);
        entry["remaining"] = remaining;
      }
      else if (!shouldReadPosition && cached?.RemainingMs is int cachedRemaining)
      {
        remaining = cachedRemaining;
        entry["remaining"] = cachedRemaining;
      }

      var hasElapsed = elapsedMs.HasValue;
      var elapsedValue = elapsedMs.GetValueOrDefault();
      if (hasElapsed && effectiveDurationMs.HasValue && remaining.HasValue &&
          (remaining.Value == 0 || (!isWarmPoll && elapsedValue >= effectiveDurationMs.Value - 250)))
      {
        status = "ended";
      }

      var isPastEnd = status == "ended" ||
        (!isWarmPoll && effectiveDurationMs.HasValue && elapsedValue >= effectiveDurationMs.Value - 250);
      if (status == null && candidate.StateRaw.HasValue && !isPastEnd)
      {
        switch (candidate.StateRaw.Value)
        {
          case PpPlayerPlaying:
            status = "playing";
            break;
          case PpPlayerPaused:
            status = "paused";
            break;
          case PpPlayerStopped:
          case PpPlayerNotReady:
            // A fresh or transition sample has a position read, while stable
            // stopped/not-ready media reuse their per-shape value cache and
            // receive one round-robin refresh each poll. That retains paused/
            // ended display state without repeatedly timing every idle video.
            status = hasElapsed && elapsedValue > 0 ? "paused" : null;
            break;
        }
      }
      // A usable fresh zero position on a stable stopped player is an
      // authoritative reset/ready observation. Only retain cached status when
      // this poll supplied no usable position at all.
      if (status == null && !stateChanged && !hasFreshPosition && cached?.Status != null)
      {
        status = cached.Status;
      }

      // A freshly clicked video can report Player.State=playing while COM
      // still returns no CurrentPosition (or exactly zero). Emit an immediate
      // zero anchor so the renderer can start its local clock on this poll.
      var usedZeroPlayAnchor = false;
      if (status == "playing" && !hasElapsed)
      {
        elapsedMs = 0;
        hasElapsed = true;
        usedZeroPlayAnchor = true;
        entry["elapsed"] = 0;
        if (effectiveDurationMs.HasValue)
        {
          remaining = effectiveDurationMs.Value;
          entry["remaining"] = remaining;
        }
      }
      if (candidate.StateRaw is PpPlayerPaused or PpPlayerStopped or PpPlayerNotReady)
      {
        entry["playing"] = false;
      }
      if (!string.IsNullOrEmpty(status))
      {
        entry["status"] = status;
        entry["playing"] = status == "playing";
      }

      if (candidate.ShapeId.HasValue)
      {
        // Rebase any synthetic advance. Retaining the old tick with the
        // already-advanced value would compound elapsed on every warm poll.
        var timingAnchorTicks = hasFreshPosition || usedAdvancedWarmElapsed || usedZeroPlayAnchor
          ? Stopwatch.GetTimestamp()
          : cached?.TimingAnchorTicks;
        MediaValuesByShapeId[candidate.ShapeId.Value] = new CachedMediaValue
        {
          Name = entry.TryGetValue("name", out var nameRaw) ? nameRaw as string : cached?.Name,
          DurationMs = effectiveDurationMs,
          ElapsedMs = elapsedMs,
          RemainingMs = remaining,
          Status = status,
          StateRaw = candidate.StateRaw,
          TimingAnchorTicks = timingAnchorTicks,
        };
      }

      videos.Add(entry);
      var isPlaying = entry.TryGetValue("playing", out var playingRaw) && playingRaw is bool playing && playing;
      if (!primaryLocked && (primaryVideo == null || isPlaying))
      {
        primaryVideo = entry;
        primaryVideoIndex = videos.Count - 1;
        if (isPlaying)
        {
          // Prefer currently playing media as the primary timing source.
          primaryLocked = true;
        }
      }
    }

    if (videos.Count > 0)
    {
      payload["videos"] = videos;
    }
    if (primaryVideo != null && primaryVideoIndex.HasValue)
    {
      payload["primaryVideoIndex"] = primaryVideoIndex.Value;
      if (primaryVideo.TryGetValue("id", out var idRaw) && idRaw is int idValue)
      {
        payload["primaryVideoId"] = idValue;
      }
      if (primaryVideo.TryGetValue("duration", out var durationRaw) && durationRaw is int durationValue)
      {
        payload["videoDuration"] = durationValue;
      }
      if (primaryVideo.TryGetValue("elapsed", out var elapsedRaw) && elapsedRaw is int elapsedValue)
      {
        payload["videoElapsed"] = elapsedValue;
      }
      if (primaryVideo.TryGetValue("playing", out var playingRaw) && playingRaw is bool playingValue)
      {
        payload["videoPlaying"] = playingValue;
      }
      if (primaryVideo.TryGetValue("remaining", out var remainingRaw) && remainingRaw is int remainingValue)
      {
        payload["videoRemaining"] = remainingValue;
      }
    }

    return payload;
  }

  private static List<MediaCandidate> BuildColdCandidates(
    IReadOnlyList<object?> slideCandidates,
    object? ssView,
    out bool hasInvalidPlayerState,
    out bool canWarmCache,
    out HashSet<int> presentShapeIds
  )
  {
    var candidates = new List<MediaCandidate>();
    presentShapeIds = new HashSet<int>();
    hasInvalidPlayerState = false;
    canWarmCache = true;
    foreach (var shape in slideCandidates)
    {
      if (shape == null) continue;
      var entry = new Dictionary<string, object?>(StringComparer.OrdinalIgnoreCase);
      var shapeId = TryGetInt(TryGetProp(shape, "Id"));
      var shapeName = TryGetProp(shape, "Name") as string;
      if (shapeId.HasValue) entry["id"] = shapeId.Value;
      if (shapeId.HasValue) presentShapeIds.Add(shapeId.Value);
      else canWarmCache = false;
      if (!string.IsNullOrWhiteSpace(shapeName)) entry["name"] = shapeName;

      var mediaFormat = TryGetProp(shape, "MediaFormat");
      var durationMs = ConvertToMs(TryGetProp(mediaFormat, "Length"));
      if (durationMs.HasValue) entry["duration"] = durationMs.Value;

      object? player = null;
      int? stateRaw = null;
      if (shapeId.HasValue && ssView != null)
      {
        player = TryInvoke(ssView, "Player", shapeId.Value);
        stateRaw = TryGetInt(TryGetProp(player, "State"));
        if (stateRaw.HasValue && !IsKnownPlayerState(stateRaw.Value)) hasInvalidPlayerState = true;
      }
      if (shapeId.HasValue && (player == null || !stateRaw.HasValue || !IsKnownPlayerState(stateRaw.Value)))
      {
        // Do not cache descriptors that immediately require a cold fallback:
        // otherwise persistent Player failures do two passes every poll.
        canWarmCache = false;
      }
      candidates.Add(new MediaCandidate
      {
        Entry = entry,
        ShapeId = shapeId,
        DurationMs = durationMs,
        Player = player,
        StateRaw = stateRaw,
      });
    }
    return candidates;
  }

  private static bool TryBuildWarmCandidates(object? ssView, out List<MediaCandidate> candidates)
  {
    candidates = new List<MediaCandidate>();
    if (!HasCompleteMediaDescriptorCache || ssView == null) return false;
    foreach (var descriptor in MediaDescriptors)
    {
      if (!MediaValuesByShapeId.ContainsKey(descriptor.ShapeId))
      {
        candidates.Clear();
        return false;
      }
      var player = TryInvoke(ssView, "Player", descriptor.ShapeId);
      var stateRaw = TryGetInt(TryGetProp(player, "State"));
      // A warm cache is only safe while every cached row can be freshly swept.
      // Fall through to the cold builder rather than emit cached/partial state.
      if (player == null || !stateRaw.HasValue || !IsKnownPlayerState(stateRaw.Value))
      {
        candidates.Clear();
        return false;
      }
      var entry = new Dictionary<string, object?>(StringComparer.OrdinalIgnoreCase)
      {
        ["id"] = descriptor.ShapeId,
      };
      if (!string.IsNullOrWhiteSpace(descriptor.Name)) entry["name"] = descriptor.Name;
      if (descriptor.DurationMs.HasValue) entry["duration"] = descriptor.DurationMs.Value;
      candidates.Add(new MediaCandidate
      {
        Entry = entry,
        ShapeId = descriptor.ShapeId,
        DurationMs = descriptor.DurationMs,
        Player = player,
        StateRaw = stateRaw,
      });
    }
    return true;
  }

  private static void CacheMediaDescriptors(IReadOnlyList<MediaCandidate> candidates, bool collectionComplete)
  {
    // A descriptor cache is all-or-nothing. A media shape with no stable id
    // remains observable via the cold path but must never yield a partial warm
    // response whose identity/order silently changes.
    if (!collectionComplete || candidates.Count == 0)
    {
      // A traversal failure is not an authoritative descriptor list. Empty
      // slides also stay cold so same-scope media can later appear.
      DisableWarmDescriptorCache();
      return;
    }
    foreach (var candidate in candidates)
    {
      if (!candidate.ShapeId.HasValue)
      {
        DisableWarmDescriptorCache();
        return;
      }
    }
    MediaDescriptors.Clear();
    foreach (var candidate in candidates)
    {
      var name = candidate.Entry.TryGetValue("name", out var nameRaw) ? nameRaw as string : null;
      MediaDescriptors.Add(new CachedMediaDescriptor
      {
        ShapeId = candidate.ShapeId!.Value,
        Name = name,
        DurationMs = candidate.DurationMs,
      });
    }
    HasCompleteMediaDescriptorCache = true;
  }

  private static void DisableWarmDescriptorCache()
  {
    MediaDescriptors.Clear();
    HasCompleteMediaDescriptorCache = false;
    ActiveTimingRefreshCursor = 0;
  }

  private static int? SelectActiveTimingRefresh(IReadOnlyList<MediaCandidate> candidates)
  {
    var stableActiveIds = new List<int>();
    foreach (var candidate in candidates)
    {
      if (!candidate.ShapeId.HasValue || candidate.StateRaw is not (PpPlayerPlaying or PpPlayerPaused)) continue;
      if (!MediaValuesByShapeId.TryGetValue(candidate.ShapeId.Value, out var cached)) continue;
      if (cached.StateRaw != candidate.StateRaw) continue;
      stableActiveIds.Add(candidate.ShapeId.Value);
    }
    if (stableActiveIds.Count == 0) return null;
    var index = ActiveTimingRefreshCursor % stableActiveIds.Count;
    ActiveTimingRefreshCursor = ActiveTimingRefreshCursor == int.MaxValue - 1
      ? 0
      : ActiveTimingRefreshCursor + 1;
    return stableActiveIds[index];
  }

  private static int? AdvanceCachedElapsed(CachedMediaValue? cached, int? durationMs, int? stateRaw)
  {
    if (cached?.ElapsedMs is not int elapsedMs || stateRaw != PpPlayerPlaying) return cached?.ElapsedMs;
    if (!cached.TimingAnchorTicks.HasValue) return elapsedMs;
    var elapsedTicks = Stopwatch.GetTimestamp() - cached.TimingAnchorTicks.Value;
    if (elapsedTicks <= 0) return elapsedMs;
    var advanceMs = (long)Math.Round(elapsedTicks * 1000d / Stopwatch.Frequency);
    var advanced = Math.Min((long)int.MaxValue, (long)elapsedMs + advanceMs);
    if (durationMs.HasValue) advanced = Math.Min(advanced, durationMs.Value);
    return (int)advanced;
  }

  private static bool ShouldReplaceStaleTerminalPositionWithPlayAnchor(
    CachedMediaValue? cached,
    int? stateRaw,
    int? durationMs,
    int? freshElapsedMs)
  {
    // Keep this deliberately narrower than generic end inference. It requires
    // a known terminal cache, a stopped/not-ready -> playing transition, and a
    // fresh position that is itself still at the end. A stable playing video
    // reaching its end, and a first observation without transition history,
    // continue through the normal immediate-ended path.
    return cached?.Status == "ended" &&
      cached.StateRaw is PpPlayerStopped or PpPlayerNotReady &&
      stateRaw == PpPlayerPlaying &&
      cached.StateRaw != stateRaw &&
      durationMs.HasValue &&
      freshElapsedMs.HasValue &&
      freshElapsedMs.Value >= durationMs.Value - 250;
  }

  // A cold response can use media discovered before a COM failure, but a warm
  // descriptor cache is safe only after a complete traversal. `TryGetProp`
  // deliberately hides COM exceptions, so every missing collection/property
  // required to classify media is treated as incomplete rather than empty.
  private static bool CollectMediaShapes(object? shapesObj, List<object?> candidates)
  {
    if (shapesObj == null) return false;
    var count = TryGetInt(TryGetProp(shapesObj, "Count"));
    if (!count.HasValue || count.Value < 0) return false;
    var complete = true;
    for (var i = 1; i <= count.Value; i++)
    {
      var shape = TryInvoke(shapesObj, "Item", i);
      if (shape == null)
      {
        complete = false;
        continue;
      }
      var mediaFormat = TryGetProp(shape, "MediaFormat");
      var isMedia = mediaFormat != null;
      var shapeType = TryGetInt(TryGetProp(shape, "Type"));
      if (!shapeType.HasValue)
      {
        // Type distinguishes groups and fallback media/placeholder forms. A
        // usable MediaFormat may still produce a cold row, but not a cache.
        complete = false;
      }
      if (!isMedia && shapeType == 16) isMedia = true;
      if (shapeType == 14)
      {
        var placeholder = TryGetProp(shape, "PlaceholderFormat");
        var containedType = TryGetInt(TryGetProp(placeholder, "ContainedType"));
        if (placeholder == null || !containedType.HasValue)
        {
          // Placeholders require ContainedType to distinguish an empty slot
          // from embedded media. Do not cache an uncertain shape tree.
          complete = false;
        }
        if (containedType == 16) isMedia = true;
      }
      if (isMedia)
      {
        candidates.Add(shape);
      }
      if (shapeType == 6)
      {
        var groupItems = TryGetProp(shape, "GroupItems");
        if (!CollectMediaShapes(groupItems, candidates)) complete = false;
      }
    }
    return complete;
  }

  private static void BeginMediaValueScope(string scope)
  {
    if (string.Equals(MediaCacheScope, scope, StringComparison.Ordinal)) return;
    ResetMediaValueCache();
    MediaCacheScope = scope;
  }

  private static void ResetMediaValueCache()
  {
    MediaCacheScope = null;
    MediaDescriptors.Clear();
    HasCompleteMediaDescriptorCache = false;
    MediaValuesByShapeId.Clear();
    StableStoppedRefreshCursor = 0;
    ActiveTimingRefreshCursor = 0;
  }

  private static void PruneMediaValues(ISet<int> presentShapeIds)
  {
    var missing = new List<int>();
    foreach (var shapeId in MediaValuesByShapeId.Keys)
    {
      if (!presentShapeIds.Contains(shapeId)) missing.Add(shapeId);
    }
    foreach (var shapeId in missing) MediaValuesByShapeId.Remove(shapeId);
  }

  private static bool MetadataChanged(
    CachedMediaValue cached,
    IReadOnlyDictionary<string, object?> entry,
    int? durationMs
  )
  {
    var name = entry.TryGetValue("name", out var nameRaw) ? nameRaw as string : null;
    return (cached.Name != null && name != null && !string.Equals(cached.Name, name, StringComparison.Ordinal)) ||
      (cached.DurationMs.HasValue && durationMs.HasValue && cached.DurationMs.Value != durationMs.Value);
  }

  private static bool IsKnownPlayerState(int stateRaw)
  {
    return stateRaw is PpPlayerPlaying or PpPlayerPaused or PpPlayerStopped or PpPlayerNotReady;
  }

  private static int? SelectStableStoppedRefresh(IReadOnlyList<MediaCandidate> candidates)
  {
    var stableIds = new List<int>();
    foreach (var candidate in candidates)
    {
      if (!candidate.ShapeId.HasValue || candidate.StateRaw is not (PpPlayerStopped or PpPlayerNotReady)) continue;
      if (!MediaValuesByShapeId.TryGetValue(candidate.ShapeId.Value, out var cached)) continue;
      if (cached.StateRaw != candidate.StateRaw || MetadataChanged(cached, candidate.Entry, candidate.DurationMs)) continue;
      stableIds.Add(candidate.ShapeId.Value);
    }
    if (stableIds.Count == 0) return null;
    var index = StableStoppedRefreshCursor % stableIds.Count;
    StableStoppedRefreshCursor = StableStoppedRefreshCursor == int.MaxValue - 1
      ? 0
      : StableStoppedRefreshCursor + 1;
    return stableIds[index];
  }

  private static int? TryGetInt(object? value)
  {
    if (value == null) return null;
    try
    {
      return Convert.ToInt32(value);
    }
    catch
    {
      return null;
    }
  }

  private static int? ConvertToMs(object? value, bool allowZero = false)
  {
    if (value == null) return null;
    if (!double.TryParse(value.ToString(), out var num)) return null;
    if (double.IsNaN(num) || double.IsInfinity(num) || num < 0 || (!allowZero && num == 0)) return null;
    if (num < 1000) return (int)Math.Round(num * 1000);
    return (int)Math.Round(num);
  }

  private static double? TryGetNumber(object? value)
  {
    if (value == null) return null;
    if (double.TryParse(value.ToString(), out var num)) return num;
    return null;
  }

  private static int? NormalizeElapsed(int? durationMs, double? rawElapsed)
  {
    if (rawElapsed == null) return null;
    var elapsedMs = ConvertToMs(rawElapsed.Value, allowZero: true);
    if (!durationMs.HasValue || !elapsedMs.HasValue) return elapsedMs;
    if (elapsedMs.Value <= durationMs.Value * 2) return elapsedMs;

    var scaleCandidates = new[] { 0.1, 0.01, 0.001, 0.0001 };
    foreach (var scale in scaleCandidates)
    {
      var scaled = ConvertToMs(rawElapsed.Value * scale, allowZero: true);
      if (scaled.HasValue && scaled.Value > 0 && scaled.Value <= durationMs.Value * 2)
      {
        return scaled;
      }
    }

    return null;
  }

  private static object? TryGetProp(object? obj, string prop)
  {
    if (obj == null) return null;
    try
    {
      return obj.GetType().InvokeMember(prop, BindingFlags.GetProperty, null, obj, Array.Empty<object>());
    }
    catch
    {
      return null;
    }
  }

  private static object? TryInvoke(object? obj, string method, params object[] args)
  {
    if (obj == null) return null;
    try
    {
      return obj.GetType().InvokeMember(method, BindingFlags.InvokeMethod, null, obj, args);
    }
    catch
    {
      return null;
    }
  }

  [DllImport("ole32.dll", CharSet = CharSet.Unicode)]
  private static extern int CLSIDFromProgID(string progId, out Guid clsid);

  [DllImport("oleaut32.dll", PreserveSig = true)]
  private static extern int GetActiveObject(
    ref Guid rclsid,
    IntPtr reserved,
    [MarshalAs(UnmanagedType.Interface)] out object? ppunk
  );

  private static object? GetActiveObject(string progId)
  {
    var hr = CLSIDFromProgID(progId, out var clsid);
    if (hr != 0)
    {
      Marshal.ThrowExceptionForHR(hr);
    }
    hr = GetActiveObject(ref clsid, IntPtr.Zero, out var obj);
    if (hr != 0)
    {
      Marshal.ThrowExceptionForHR(hr);
    }
    return obj;
  }
}
