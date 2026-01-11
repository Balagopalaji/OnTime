# Agent Handoff Log

Purpose: quick, shared troubleshooting notes between macOS and Windows agents.

Rules:
- Add a UTC timestamp for every entry.
- Keep entries short (commands, results, blockers, next steps).
- Remove or prune resolved entries to keep this file lightweight.
- Do not paste secrets, tokens, or personal data.
- Prefer links to relevant docs/issues over long explanations.
- Separate entries with a blank line and a `---` divider.
- Include agent origin (e.g., Windows WSL, macOS, Linux) on the Owner line.

Template:

Timestamp (UTC):
Owner (macOS/Windows, origin):
Context:
Commands:
Results:
Blockers:
Next steps:
---

Timestamp (UTC): 2025-01-11T06:55:00Z
Owner (Windows)
Context: Manual checks for file ops + ffprobe on Windows companion.
Commands: /api/file/metadata + /api/open with non-ASCII path `C:\Users\krish\Videos\テスト動画.mp4.mp4`; rebuild/install companion; ffprobe validation.
Results: ffprobe bundled; metadata returns size/duration/resolution. /api/open succeeds with UTF-8 body file or UTF-8 bytes. Inline `curl.exe --data-raw` may fail due to legacy code page.
Blockers: None after workaround. curl.exe inline encoding remains client-side quirk.
Next steps: If desired, document Windows curl encoding caveat or use UTF-8 body method for non-ASCII tests.
