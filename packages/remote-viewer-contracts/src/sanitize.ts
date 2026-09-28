import { MAX_DISPLAY_TEXT_LENGTH } from './snapshot-types'

/**
 * Control, format (including every bidi mark/override/isolate and BOM), lone
 * surrogate, and private-use code points. ZWNJ/ZWJ are kept because emoji
 * sequences and Indic/Persian text need them and they carry no direction.
 */
const UNSAFE_CHARACTERS = /(?![‌‍])[\p{Cc}\p{Cf}\p{Cs}\p{Co}]/gu

/** Presentation and media file extensions that disclose a filename rather than a title. */
const KNOWN_FILE_EXTENSION =
  /\.(?:pptx|pptm|ppt|ppsx|ppsm|pps|potx|potm|pot|odp|key|mp4|m4v|mov|wmv|avi|mkv|webm|mpg|mpeg|mp3|wav|m4a|wma|aac)$/i

/**
 * Sanitize a host-resolved title or label for remote display. Keeps only the
 * final path segment (privacy over fidelity: `AC/DC` becomes `DC`; Windows
 * file and shape names rarely contain separators), removes unsafe control/bidi characters, strips trailing
 * presentation/media extensions, collapses whitespace, and truncates to
 * MAX_DISPLAY_TEXT_LENGTH code points. Returns `undefined` when nothing
 * displayable remains. Idempotent, so server and viewer re-parsing agree.
 */
export function sanitizeDisplayText(value: string): string | undefined {
  const separator = Math.max(value.lastIndexOf('/'), value.lastIndexOf('\\'))
  let text = (separator === -1 ? value : value.slice(separator + 1))
    .replace(UNSAFE_CHARACTERS, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  while (KNOWN_FILE_EXTENSION.test(text)) {
    text = text.replace(KNOWN_FILE_EXTENSION, '').trim()
  }
  const codePoints = Array.from(text)
  if (codePoints.length > MAX_DISPLAY_TEXT_LENGTH) {
    text = `${codePoints.slice(0, MAX_DISPLAY_TEXT_LENGTH - 1).join('').trimEnd()}…`
  }
  return text === '' ? undefined : text
}
