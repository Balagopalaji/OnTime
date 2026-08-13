---
Type: Research
Status: current
Scope: Competition for the standalone PowerPoint video remaining-time timer.
Last researched: 2026-08-07
---

# Competition Overview: PowerPoint Video Remaining-Time Timer

## Executive summary

OnTime is not entering an empty timer market. There are many PowerPoint countdown timers, presentation timers, stage timers, and professional AV systems.

The important distinction is that most competitors do one of two things:

1. Run a manually configured countdown for a speaker, lesson, or presentation segment.
2. Read PowerPoint video timing, but expose it to an AV operator through Companion/Stream Deck rather than showing a simple always-on-top overlay.

The closest technical competitor is **APS (Auto Presentation Switcher) from PresentationTools**. Its PowerPoint media-control feature reads embedded PowerPoint video state and exposes play/pause, stop, seek, elapsed time, total duration, and remaining time through Bitfocus Companion and Stream Deck. It is Windows-only for this embedded-video feature.

OnTime's opportunity is the focused workflow: a small Windows utility that reads the actual active PowerPoint video and displays its remaining time directly as an always-on-top presenter-side overlay, without requiring Companion, Stream Deck, a PowerPoint add-in, deck edits, or a larger AV control system.

This document is a competitive reference for future agents. It is not a legal novelty or patent opinion.

## OnTime's target product

The current standalone-timer plan defines the product as:

- Windows-only MVP.
- Lightweight standalone app with fast startup.
- Reads PowerPoint slideshow state through the existing native helper.
- Shows slide number, total slides, video remaining/elapsed time, and play/pause state.
- Always-on-top window with presenter-screen placement and multi-monitor movement.
- Remaining versus elapsed display toggle.
- Multiple-video-on-one-slide handling.
- No rooms, cloud sync, Companion, controller state, or full show-control workflow.

See the current [Standalone PowerPoint Video Timer specification](spec/standalone-powerpoint-video-timer.spec.md) and [PowerPoint capability and timer display roadmap](plans/powerpoint-capability-and-display-roadmap-2026-08-07.md). The earlier Phase 3 draft is superseded.

## Competitive map

| Product | Category | Platform | What it does | Difference from OnTime | Threat to OnTime |
|---|---|---|---|---|---|
| [APS](https://aps.presentationtools.com/) | Presentation controller and AV switcher | Mac and Windows overall; embedded PowerPoint video control is Windows-only | Reads embedded PowerPoint media and exposes play/pause, stop, seek, elapsed, duration, and remaining time through Companion/Stream Deck | Requires a broader AV workflow; documented video timer is an operator-facing Companion/Stream Deck output, not a simple standalone overlay | **Highest technical threat** |
| [CueTimer](https://cuetimer.com/) | Speaker timer and run-of-show system | Mac, Windows, and web | Cue lists, speaker countdowns, messages, overtime, fullscreen/stage output, PowerPoint overlay, NDI, web/cloud, Companion | Countdown is generally driven by planned cue duration, not the actual embedded PowerPoint video playhead | High substitute for presentation/stage timing; low direct threat to media sync |
| [StageTimer.io](https://stagetimer.io/docs/) | Browser-based event/stage timer | Browser on any device | Shared timers, viewer displays, controller/operator pages, messages, scheduled/automatic timers | Manual/event-segment timing; does not read embedded PowerPoint media | Medium substitute for stage timing; low direct threat to media sync |
| [SlideTimerApp](https://slidetimerapp.com/) | Simple transparent presentation overlay | Windows | Free portable always-on-top countdown over PowerPoint, Google Slides, Canva, and other apps | Generic manually configured countdown; no PowerPoint video-state integration | Medium UX competitor |
| [UbiTimer Companion](https://ubitimer.com/presenter-companion/) | Presenter/classroom timer | Windows | Floating always-on-top private timer connected to UbiTimer PowerPoint workflows | Timer is driven by UbiTimer sessions/timer groups, not embedded video playback | Medium substitute |
| [LTC Timer S](https://www.ltcclock.com/downloads/ltc-timer-s/) | PowerPoint add-in | Windows | Inserts manually configured countdowns into individual slides | Modifies the deck and does not track the actual video playhead | Low direct threat; established timer alternative |
| PowerPoint native features | Built-in presentation timing | Windows and Mac | Animated countdowns/progress bars and presenter timing | Not a reusable, media-aware, always-on-top embedded-video timer | Low; the built-in workaround is cumbersome |
| [Stopwatch Overlay](https://clemensv.github.io/stopwatch/) and similar utilities | Generic desktop overlay | Windows | Always-on-top stopwatch, clock, countdown, and timecode | Does not know which PowerPoint video is playing or its true remaining time | Low; competes on visible overlay simplicity |
| ProPresenter, QLab, vMix, and similar systems | Full production/media systems | Varies | Replace or surround PowerPoint with media playback, cues, composition, and show control | Usually requires changing the production workflow; not a small PowerPoint companion utility | Indirect threat at the high end |

## Most important competitor: APS

### What APS actually does

APS is primarily a presentation controller for live-event operators. It can switch between PowerPoint, Keynote, PDF, Google Slides/Chrome content, images, and videos. It can also provide a freeze/screenshot layer so the audience does not see the desktop during changes.

Its embedded PowerPoint video feature is the closest match to OnTime:

- Windows only.
- Reads the media object directly from PowerPoint.
- Shows remaining time, elapsed time, and total duration.
- Sends the state to Companion buttons.
- Provides play/pause and stop commands.
- Provides skip-forward/skip-back commands, which are seek operations.
- Requires APS plus Companion; a physical Stream Deck is optional because Companion can also provide a browser-based control surface.

APS documents two important limitations in its own feature announcement:

- PowerPoint feedback can lag by approximately 0–500 ms.
- In some workflows, using play followed by seek can cause a PowerPoint video to repeat instead of advancing to the next slide.

APS's own conclusion is that PowerPoint media control is useful for knowing how much time remains and for operator control, but it should not replace a dedicated professional playback rig for every broadcast workflow.

### What APS includes beyond the video timer

The APS licence is for a broader AV tool, currently advertised from US$40/year. The wider product includes:

- Switching and opening decks from keyboard shortcuts, Companion, Stream Deck, network commands, or a presenter clicker.
- Folder-based deck ordering and up to 40 presentation slots.
- Watched presentation folders for operator workflows.
- Seamless switching using a freeze/screenshot layer.
- Up to 40 external media slots for videos, images, and audio.
- External-media play, pause, restart, stop, loop, hold-at-end, timeline scrubbing, and fade transitions.
- Still-image, logo, black, test-pattern, and freeze-screen outputs.
- TCP/IP/network API and Companion integration.
- Slide-number, active-presentation, and application feedback.

The separate [CueTimer Desktop](https://cuetimer.com/) product is advertised from US$50/year. The APS + CueTimer bundle is advertised from US$100/year.

### What APS does not appear to provide as its core video-timer workflow

Based on the official product documentation reviewed:

- No Mac support for reading embedded PowerPoint video remaining time.
- No simple standalone always-on-top countdown window tied directly to the active embedded video.
- No need-free workflow for users who only want the video timer; APS is a larger AV system.
- No guarantee of zero-latency media-state feedback; APS documents a 0–500 ms range and a seek-related PowerPoint bug.

## CueTimer and StageTimer comparison

CueTimer and StageTimer are important because they demonstrate that customers already pay for presentation and stage timing, but they solve a different timing problem.

### CueTimer

CueTimer is a speaker timer and run-of-show tool. A typical workflow is:

```text
Opening video     02:00
Speaker 1         12:00
Q&A                05:00
Changeover         03:00
```

The operator starts each cue and CueTimer counts down the configured segment duration. It supports warnings, colour changes, overtime, presenter messages, fullscreen displays, floating overlays, NDI/web outputs, Companion, Stream Deck, OSC, and TCP/IP control.

CueTimer can show PowerPoint slide progress when connected to APS, but the documented workflow does not establish that its main countdown automatically follows the true playhead of an embedded PowerPoint video. APS's specific embedded-video remaining-time feature is documented as a Companion/Stream Deck feature.

### StageTimer.io

StageTimer.io is more browser-first and collaboration-oriented. It provides shared controller and viewer pages, multiple displays, messages, scheduled starts, automatic timer sequences, and countdown/count-up/time-of-day modes.

The distinction is:

- StageTimer: shared browser-based event timing.
- CueTimer: local/cloud AV-oriented run-of-show timing with stronger production integrations.
- OnTime: actual remaining time of the active embedded PowerPoint video.

## Substitution versus direct competition

### Direct technical competition

**APS** is the primary direct technical competitor because it obtains actual embedded PowerPoint media timing.

### Direct user-experience competition

**SlideTimerApp**, **CueTimer**, and **UbiTimer Companion** compete for the user's desire to see a timer floating over or beside a presentation. Their timers are generally manually configured or driven by a run-of-show/session model, not the PowerPoint video's actual playback state.

### Workflow substitutes

- Insert a countdown video or animated timer into the PowerPoint deck.
- Use PowerPoint Presenter View or Rehearse Timings.
- Put a phone, tablet, or second monitor beside the presenter.
- Use a stage-timer website.
- Run the video in QLab, ProPresenter, vMix, or another dedicated playback system instead of embedding it in PowerPoint.

## Product implications for OnTime

### Positioning

Avoid positioning OnTime as another generic “PowerPoint countdown timer.” That market already has many products.

The clearer position is:

> **The simple PowerPoint video time-remaining overlay.**

Useful supporting claims, once verified in testing:

- Reads the real video position rather than counting down a guessed duration.
- No PowerPoint add-in.
- No deck modifications.
- No Companion or Stream Deck required.
- Always-on-top presenter overlay.
- Shows slide number and video state.
- Handles pause/resume and multiple videos on a slide.
- Works offline on Windows.

### Quality bar

The product's central promise is trustworthy remaining time. A visible 3–5 second update delay undermines that promise even if the underlying timing calculation is correct. The target should be a visually smooth, subsecond update path, with explicit handling for PowerPoint's own state-reporting limitations.

The most important tests are:

- Start, pause, resume, and end detection.
- Video started by clicker, keyboard, PowerPoint click sequence, and OnTime controls if supported.
- Slide changes during or immediately after video playback.
- Multiple videos on one slide.
- Video replay and loop settings.
- Presenter View versus Slide Show mode.
- PowerPoint 32-bit and 64-bit compatibility where supported.
- Multiple monitors and overlay placement.
- PowerPoint closing, crashing, or being absent.
- Time accuracy after a long playback session and after pause/resume.

### Commercial implication

APS establishes a price anchor for professional AV software, but its customer is often an operator buying a broader tool. OnTime should compete initially on simplicity and focused value, not feature count.

Likely positioning tiers:

- Free or low-cost beta while timing and overlay reliability are being proven.
- Approximately US$19–29 one-time for a reliable standalone utility.
- Approximately US$39–59 one-time for a polished Pro version with multi-monitor, multi-video, hotkeys, diagnostics, and strong packaging.
- A higher annual price only if OnTime adds genuinely professional support, remote control, logs, deployment tooling, or guaranteed update/support service.

## Sources

- [APS official product page](https://aps.presentationtools.com/)
- [APS PowerPoint media control and live video countdown](https://aps.presentationtools.com/updates/introducing-powerpoint-media-control-in-aps-with-live-video-countdown-on-stream-deck/)
- [APS PC user guide](https://aps.presentationtools.com/userguide-pc/)
- [APS Mac user guide](https://aps.presentationtools.com/user-guide-mac/)
- [PresentationTools pricing](https://www.presentationtools.com/store/)
- [CueTimer official product page](https://cuetimer.com/)
- [CueTimer presentation timer](https://cuetimer.com/presentation-timer/)
- [CueTimer run-of-show](https://cuetimer.com/run-of-show/)
- [StageTimer.io documentation](https://stagetimer.io/docs/)
- [SlideTimerApp](https://slidetimerapp.com/)
- [UbiTimer Presenter Companion](https://ubitimer.com/presenter-companion/)
- [LTC Timer S](https://www.ltcclock.com/downloads/ltc-timer-s/)
- [Stopwatch Overlay](https://clemensv.github.io/stopwatch/)
