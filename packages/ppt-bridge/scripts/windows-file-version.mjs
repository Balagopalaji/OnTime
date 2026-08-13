const MAX_PE_VERSION_PART = 65535n

const SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/

function validatePeVersionPart(value, label) {
  const numericValue = BigInt(value)
  if (numericValue < 0n || numericValue > MAX_PE_VERSION_PART) {
    throw new Error(`${label} must be between 0 and 65535 for a Windows PE version`)
  }
  return numericValue.toString()
}

/**
 * Map app SemVer to the numeric four-part Windows PE FileVersion.
 *
 * The SemVer core becomes Major.Minor.Build. A trailing numeric prerelease
 * identifier becomes Revision (beta.1 -> 1); versions without one use 0.
 * Product/informational versions retain the original SemVer elsewhere.
 */
export function deriveWindowsFileVersion(appVersion) {
  const match = SEMVER_PATTERN.exec(appVersion)
  if (!match) {
    throw new Error(`Invalid app SemVer: ${appVersion}`)
  }

  const prerelease = match[4]
  const lastPrereleaseIdentifier = prerelease?.split('.').at(-1)
  const revision = lastPrereleaseIdentifier && /^\d+$/.test(lastPrereleaseIdentifier)
    ? lastPrereleaseIdentifier
    : '0'

  return [
    validatePeVersionPart(match[1], 'Major'),
    validatePeVersionPart(match[2], 'Minor'),
    validatePeVersionPart(match[3], 'Build'),
    validatePeVersionPart(revision, 'Revision'),
  ].join('.')
}

if (process.argv[1] && process.argv.length !== 3) {
  console.error('Usage: node windows-file-version.mjs <app-semver>')
  process.exit(1)
}

if (process.argv.length === 3) {
  try {
    console.log(deriveWindowsFileVersion(process.argv[2]))
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
}
