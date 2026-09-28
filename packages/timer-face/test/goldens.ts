/** Characterization goldens captured from the pre-extraction ppt-timer renderer (ISSUE-001 face). */
export const GOLDEN = {
  connecting: {
    status: "<section class=\"status\" data-state=\"connecting\"><div class=\"timer-stack\"><span class=\"status-label message\" id=\"message\">Connecting to PowerPoint</span><div class=\"time\" id=\"time\" style=\"--time-fit-width: 41.78cqw;\">--:--</div></div></section>",
    list: null,
    announcement: "Connecting to PowerPoint\u2026",
  },
  unavailable: {
    status: "<section class=\"status\" data-state=\"unavailable\"><div class=\"timer-stack\"><span class=\"status-label badge\" id=\"badge\" data-badge=\"retry\">Retrying</span><div class=\"time\" id=\"time\" style=\"--time-fit-width: 41.78cqw;\">--:--</div></div></section>",
    list: null,
    announcement: "PowerPoint timing unavailable",
  },
  notRunning: {
    status: "<section class=\"status\" data-state=\"powerpoint_not_running\"><div class=\"timer-stack\"><span class=\"status-label message\" id=\"message\">PowerPoint is not running</span><div class=\"time\" id=\"time\" style=\"--time-fit-width: 41.78cqw;\">--:--</div></div></section>",
    list: null,
    announcement: "PowerPoint is not running",
  },
  noVideo: {
    status: "<section class=\"status\" data-state=\"no_video\"><div class=\"timer-stack\"><span class=\"status-label message\" id=\"message\">No video on this slide</span><div class=\"time\" id=\"time\" style=\"--time-fit-width: 41.78cqw;\">--:--</div></div></section>",
    list: null,
    announcement: "No video on this slide",
  },
  playingTwo: {
    status: "<section class=\"status\" data-state=\"playing\"><div class=\"timer-stack\"><span class=\"status-label badge\" id=\"badge\" data-badge=\"playing\">Playing</span><div class=\"time\" id=\"time\" style=\"--time-fit-width: 37.75cqw;\">00:48</div></div></section>",
    list: "<ul class=\"videos\" id=\"videos\"><li class=\"video-row\" data-key=\"0\" data-ordinal=\"0\"><span class=\"video-row-name\">Intro.mp4</span><span class=\"video-row-status\" data-status=\"playing\">Playing</span><span class=\"video-row-time\">00:48</span></li><li class=\"video-row\" data-key=\"1\" data-ordinal=\"1\"><span class=\"video-row-name\">Outro.mp4</span><span class=\"video-row-status\" data-status=\"paused\">Paused</span><span class=\"video-row-time\">00:21</span></li></ul>",
    announcement: "Multiple PowerPoint instances detected; verify the deck \u2014 Playing \u2014 1. Intro.mp4: Playing, 2. Outro.mp4: Paused",
  },
  pausedOne: {
    status: "<section class=\"status\" data-state=\"paused\"><div class=\"timer-stack\"><span class=\"status-label badge\" id=\"badge\" data-badge=\"paused\">Paused</span><div class=\"time\" id=\"time\" style=\"--time-fit-width: 28.48cqw;\">1:03:20</div></div></section>",
    list: "<ul class=\"videos\" id=\"videos\"><li class=\"video-row\" data-key=\"0\" data-ordinal=\"0\"><span class=\"video-row-name\">Video 1</span><span class=\"video-row-status\" data-status=\"paused\">Paused</span><span class=\"video-row-time\">1:03:20</span></li></ul>",
    announcement: "Paused \u2014 1. Video 1",
  },
  readyOne: {
    status: "<section class=\"status\" data-state=\"ready\"><div class=\"timer-stack\"><span class=\"status-label message\" id=\"message\">Ready</span><div class=\"time\" id=\"time\" style=\"--time-fit-width: 37.75cqw;\">00:45</div></div></section>",
    list: "<ul class=\"videos\" id=\"videos\"><li class=\"video-row\" data-key=\"0\" data-ordinal=\"0\"><span class=\"video-row-name\">Bumper</span><span class=\"video-row-status\" data-status=\"ready\">Ready</span><span class=\"video-row-time\">00:45</span></li></ul>",
    announcement: "Ready \u2014 1. Bumper",
  },
  timingUnavailable: {
    status: "<section class=\"status\" data-state=\"timing_unavailable\"><div class=\"timer-stack\"><span class=\"status-label message\" id=\"message\">Timing unavailable</span><div class=\"time\" id=\"time\" style=\"--time-fit-width: 41.78cqw;\">--:--</div></div></section>",
    list: "<ul class=\"videos\" id=\"videos\"><li class=\"video-row\" data-key=\"0\" data-ordinal=\"0\"><span class=\"video-row-name\">Clip</span><span class=\"video-row-status\" data-status=\"playing\">Playing</span><span class=\"video-row-time\">--:--</span></li></ul>",
    announcement: "1. Clip",
  },
  playingZeroRows: {
    status: "<section class=\"status\" data-state=\"playing\"><div class=\"timer-stack\"><span class=\"status-label badge\" id=\"badge\" data-badge=\"playing\">Playing</span><div class=\"time\" id=\"time\" style=\"--time-fit-width: 37.75cqw;\">00:48</div></div></section>",
    list: null,
    announcement: "Playing \u2014 Intro.mp4",
  },
} as const
