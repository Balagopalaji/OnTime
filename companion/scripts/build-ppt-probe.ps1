$ErrorActionPreference = 'Stop'

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$canonicalScript = Join-Path $scriptDir '..\..\packages\ppt-bridge\scripts\build-windows.ps1'
$canonicalOutput = Join-Path $scriptDir '..\..\packages\ppt-bridge\bin\win-x64\ppt-probe.exe'
$compatibilityDir = Join-Path $scriptDir '..\bin'
$compatibilityOutput = Join-Path $compatibilityDir 'ppt-probe.exe'

if (-not (Test-Path -LiteralPath $canonicalScript -PathType Leaf)) {
  throw "Canonical PowerPoint probe build script not found: $canonicalScript"
}

& $canonicalScript

if (-not (Test-Path -LiteralPath $canonicalOutput -PathType Leaf)) {
  throw "Canonical PowerPoint probe executable not found: $canonicalOutput"
}

New-Item -ItemType Directory -Force -Path $compatibilityDir | Out-Null
Copy-Item -LiteralPath $canonicalOutput -Destination $compatibilityOutput -Force

$canonicalHash = (Get-FileHash -LiteralPath $canonicalOutput -Algorithm SHA256).Hash
$compatibilityHash = (Get-FileHash -LiteralPath $compatibilityOutput -Algorithm SHA256).Hash
if ($canonicalHash -ne $compatibilityHash) {
  throw "Compatibility executable hash does not match canonical executable"
}

Write-Host "Copied PowerPoint probe to Companion: $compatibilityOutput"
