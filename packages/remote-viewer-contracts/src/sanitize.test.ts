import { describe, expect, it } from 'vitest'
import { sanitizeDisplayText } from './sanitize'
import { MAX_DISPLAY_TEXT_LENGTH } from './snapshot-types'

describe('sanitizeDisplayText', () => {
  it.each([
    // Defect: forward-slash paths leak directory structure.
    ['/Users/ops/Shows/Sunday Service.pptx', 'Sunday Service'],
    // Defect: Windows drive paths leak.
    ['C:\\Shows\\Sunday\\Walk-in.mp4', 'Walk-in'],
    // Defect: UNC share prefix leaks the file server name.
    ['\\\\fileserver\\media\\Sermon Bumper.mov', 'Sermon Bumper'],
    // Defect: mixed separators only strip one kind.
    ['C:/Shows\\deep/nested\\Clip.wmv', 'Clip'],
    // Defect: repeated known extensions survive, making output non-idempotent.
    ['Announcements.mp4.mp4', 'Announcements'],
    // Defect: an unknown trailing extension is misread as a path segment or dropped.
    ['Finale.exe.mp4', 'Finale.exe'],
    ['Report.pdf.lnk', 'Report.pdf.lnk'],
    // Defect: ordinary punctuation and version dots are mangled.
    ['Act 1: Opening v2.1', 'Act 1: Opening v2.1'],
    // Defect: C0/DEL/C1 controls and bidi overrides reach the viewer DOM.
    ['Wel\u0000come\u0007 \u001b[31mHome\u007f\u0085', 'Wel come [31mHome'],
    ['\u202eevil\u202c.mp4 intro', 'evil .mp4 intro'],
    ['Tab\tand\nnewline\r\nrow', 'Tab and newline row'],
    // Defect: bidi/format characters outside the legacy ranges (ALM, word joiner, soft hyphen) survive.
    ['Budget؜2027⁠x­', 'Budget 2027 x'],
    // Defect: a lone surrogate reaches Firestore and fails or mutates the UTF-8 write.
    ['Deck\ud800 One', 'Deck One'],
    // Defect: private-use glyphs render as tofu or icon-font spoofing.
    ['Intro', 'Intro'],
    // Defect: joiners needed by emoji sequences and Indic/Persian text are stripped.
    ['\u{1F468}‍\u{1F469} می‌خواهم', '\u{1F468}‍\u{1F469} می‌خواهم'],
    // Defect: whitespace padding and runs are preserved.
    ['   Spaced    out   ', 'Spaced out'],
  ])('sanitizes %j to %j', (input, expected) => {
    expect(sanitizeDisplayText(input)).toBe(expected)
  })

  it.each([
    // Defect: empty, separator-only, or extension-only values become visible blanks.
    [''],
    ['   '],
    ['C:\\Shows\\'],
    ['.mp4'],
    ['\u0000\u0001\u202e'],
  ])('returns undefined for %j', (input) => {
    expect(sanitizeDisplayText(input)).toBeUndefined()
  })

  it('truncates to the code-point limit with an ellipsis without splitting surrogate pairs', () => {
    // Defect: truncation by UTF-16 units splits the emoji or exceeds the limit.
    const input = `${'a'.repeat(MAX_DISPLAY_TEXT_LENGTH - 2)}🎬🎬🎬 tail`
    const output = sanitizeDisplayText(input)
    expect(output).toBe(`${'a'.repeat(MAX_DISPLAY_TEXT_LENGTH - 2)}🎬…`)
    expect(Array.from(output ?? '')).toHaveLength(MAX_DISPLAY_TEXT_LENGTH)
  })

  it('keeps a value of exactly the limit unchanged', () => {
    const input = 'b'.repeat(MAX_DISPLAY_TEXT_LENGTH)
    expect(sanitizeDisplayText(input)).toBe(input)
  })

  it.each([
    ['C:\\Shows\\Sunday Service.pptx'],
    ['Announcements.mp4.mp4'],
    [`${'c'.repeat(200)}.mp4`],
    ['\u202e x.mov .mp4'],
  ])('is idempotent for %j so viewers re-parsing stored text do not drift', (input) => {
    // Defect: server and viewer re-sanitization disagree with the published text.
    const once = sanitizeDisplayText(input)
    expect(once).toBeDefined()
    expect(sanitizeDisplayText(once as string)).toBe(once)
  })
})
