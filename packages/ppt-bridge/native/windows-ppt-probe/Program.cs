using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text.Json;

namespace OnTime.PptProbe;

internal static class Program
{
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
    var payload = new Dictionary<string, object?>(StringComparer.OrdinalIgnoreCase);

    var hwnd = GetForegroundWindow();
    var targetPid = 0u;
    if (hwnd != IntPtr.Zero)
    {
      GetWindowThreadProcessId(hwnd, out targetPid);
    }

    var pptProcesses = Process.GetProcessesByName("POWERPNT");
    if (pptProcesses.Length == 0)
    {
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
      payload["pptActive"] = false;
      if (!string.IsNullOrWhiteSpace(pptError))
      {
        payload["pptError"] = pptError;
      }
      return payload;
    }
    payload["pptActive"] = true;

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
      if (ssWin != null)
      {
        presentation = TryGetProp(ssWin, "Presentation") ?? presentation;
        ssView = TryGetProp(ssWin, "View");
      }
    }

    var title = TryGetProp(presentation, "Name") as string;
    var filename = TryGetProp(presentation, "FullName") as string;
    var totalSlides = TryGetInt(TryGetProp(TryGetProp(presentation, "Slides"), "Count"));
    if (!string.IsNullOrWhiteSpace(title)) payload["title"] = title;
    if (!string.IsNullOrWhiteSpace(filename)) payload["filename"] = filename;
    if (totalSlides.HasValue) payload["totalSlides"] = totalSlides.Value;

    if (!inSlideshow || ssView == null)
    {
      return payload;
    }

    var slideIndex = TryGetInt(TryGetProp(ssView, "CurrentShowPosition"));
    if (slideIndex.HasValue)
    {
      payload["slideNumber"] = slideIndex.Value;
    }

    var slides = TryGetProp(presentation, "Slides");
    object? slide = null;
    if (slides != null && slideIndex.HasValue)
    {
      slide = TryInvoke(slides, "Item", slideIndex.Value);
    }

    if (slide == null)
    {
      return payload;
    }

    var slideCandidates = new List<object?>();
    CollectMediaShapes(TryGetProp(slide, "Shapes"), slideCandidates);

    var editSlideVideos = new List<Dictionary<string, object?>>();
    var editCandidates = new List<object?>();
    var activeWindow = TryGetProp(pptObj, "ActiveWindow");
    var activeView = TryGetProp(activeWindow, "View");
    var activeSlide = TryGetProp(activeView, "Slide");
    if (activeSlide != null)
    {
      CollectMediaShapes(TryGetProp(activeSlide, "Shapes"), editCandidates);
      foreach (var shape in editCandidates)
      {
        if (shape == null) continue;
        var entry = new Dictionary<string, object?>(StringComparer.OrdinalIgnoreCase);
        var shapeId = TryGetInt(TryGetProp(shape, "Id"));
        var shapeName = TryGetProp(shape, "Name") as string;
        if (shapeId.HasValue) entry["id"] = shapeId.Value;
        if (!string.IsNullOrWhiteSpace(shapeName)) entry["name"] = shapeName;
        var mediaFormat = TryGetProp(shape, "MediaFormat");
        var durationMs = ConvertToMs(TryGetProp(mediaFormat, "Length"));
        if (durationMs.HasValue)
        {
          entry["duration"] = durationMs.Value;
        }
        editSlideVideos.Add(entry);
      }
    }
    payload["videoDetected"] = slideCandidates.Count > 0 || editCandidates.Count > 0;

    var videos = new List<Dictionary<string, object?>>();
    Dictionary<string, object?>? primaryVideo = null;
    var primaryLocked = false;
    foreach (var shape in slideCandidates)
    {
      if (shape == null) continue;
      var entry = new Dictionary<string, object?>(StringComparer.OrdinalIgnoreCase);
      var shapeId = TryGetInt(TryGetProp(shape, "Id"));
      var shapeName = TryGetProp(shape, "Name") as string;
      if (shapeId.HasValue) entry["id"] = shapeId.Value;
      if (!string.IsNullOrWhiteSpace(shapeName)) entry["name"] = shapeName;

      var mediaFormat = TryGetProp(shape, "MediaFormat");
      var durationMs = ConvertToMs(TryGetProp(mediaFormat, "Length"));
      if (durationMs.HasValue)
      {
        entry["duration"] = durationMs.Value;
      }

      if (shapeId.HasValue && ssView != null)
      {
        var player = TryInvoke(ssView, "Player", shapeId.Value);
        var rawElapsed = TryGetNumber(TryGetProp(player, "CurrentPosition"));
        var elapsedMs = NormalizeElapsed(durationMs, rawElapsed);
        if (elapsedMs.HasValue)
        {
          entry["elapsed"] = elapsedMs.Value;
        }

        var stateRaw = TryGetInt(TryGetProp(player, "State"));
        string? status = null;
        int? remaining = null;
        if (durationMs.HasValue && elapsedMs.HasValue && elapsedMs.Value <= durationMs.Value * 2)
        {
          remaining = Math.Max(0, durationMs.Value - elapsedMs.Value);
          entry["remaining"] = remaining;
        }

        var hasElapsed = elapsedMs.HasValue;
        var elapsedValue = elapsedMs.GetValueOrDefault();
        if (hasElapsed && durationMs.HasValue && remaining.HasValue)
        {
          if (remaining.Value == 0 || elapsedValue >= durationMs.Value - 250)
          {
            status = "ended";
          }
        }

        if (status == null && stateRaw.HasValue && hasElapsed)
        {
          var isPastEnd = durationMs.HasValue && elapsedValue >= durationMs.Value - 250;
          if (!isPastEnd)
          {
            if (stateRaw.Value == 2) status = "playing";
            if (stateRaw.Value == 1) status = "paused";
          }
        }

        if (!string.IsNullOrEmpty(status))
        {
          entry["status"] = status;
          entry["playing"] = status == "playing";
        }
      }

      videos.Add(entry);

      var isPlaying = entry.TryGetValue("playing", out var playingRaw) && playingRaw is bool playing && playing;
      if (!primaryLocked && (primaryVideo == null || isPlaying))
      {
        primaryVideo = entry;
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
    if (editSlideVideos.Count > 0)
    {
      payload["editSlideVideos"] = editSlideVideos;
    }

    if (primaryVideo != null)
    {
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

  private static void CollectMediaShapes(object? shapesObj, List<object?> candidates)
  {
    if (shapesObj == null) return;
    var count = TryGetInt(TryGetProp(shapesObj, "Count")) ?? 0;
    for (var i = 1; i <= count; i++)
    {
      var shape = TryInvoke(shapesObj, "Item", i);
      if (shape == null) continue;
      var mediaFormat = TryGetProp(shape, "MediaFormat");
      var isMedia = mediaFormat != null;
      var shapeType = TryGetInt(TryGetProp(shape, "Type"));
      if (!isMedia && shapeType == 16) isMedia = true;
      if (!isMedia)
      {
        var placeholder = TryGetProp(shape, "PlaceholderFormat");
        var containedType = TryGetInt(TryGetProp(placeholder, "ContainedType"));
        if (containedType == 16) isMedia = true;
      }
      if (isMedia)
      {
        candidates.Add(shape);
      }
      if (shapeType == 6)
      {
        var groupItems = TryGetProp(shape, "GroupItems");
        CollectMediaShapes(groupItems, candidates);
      }
    }
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

  private static int? ConvertToMs(object? value)
  {
    if (value == null) return null;
    if (!double.TryParse(value.ToString(), out var num)) return null;
    if (double.IsNaN(num) || double.IsInfinity(num) || num <= 0) return null;
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
    var elapsedMs = ConvertToMs(rawElapsed.Value);
    if (!durationMs.HasValue || !elapsedMs.HasValue) return elapsedMs;
    if (elapsedMs.Value <= durationMs.Value * 2) return elapsedMs;

    var scaleCandidates = new[] { 0.1, 0.01, 0.001, 0.0001 };
    foreach (var scale in scaleCandidates)
    {
      var scaled = ConvertToMs(rawElapsed.Value * scale);
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
