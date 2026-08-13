$ErrorActionPreference = 'Stop'

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Resolve-Path (Join-Path $scriptDir '..\..\..')
$projectPath = Join-Path $scriptDir '..\native\windows-ppt-probe\ppt-probe.csproj'
$appPackagePath = Join-Path $repoRoot 'apps\ppt-timer\package.json'
if (-not (Test-Path -LiteralPath $appPackagePath -PathType Leaf)) {
  throw "Standalone package version source not found: $appPackagePath"
}
$productVersion = (Get-Content -LiteralPath $appPackagePath -Raw | ConvertFrom-Json).version
if ([string]::IsNullOrWhiteSpace($productVersion)) {
  throw "Standalone package.json has no product version: $appPackagePath"
}
$fileVersionScript = Join-Path $repoRoot 'packages/ppt-bridge/scripts/windows-file-version.mjs'
$fileVersion = (& node $fileVersionScript $productVersion).Trim()
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($fileVersion)) {
  throw "Could not derive numeric Windows PE FileVersion from app SemVer $productVersion"
}
$outputDir = Join-Path $scriptDir '..\bin\win-x64'
$exePath = Join-Path $outputDir 'ppt-probe.exe'

if (Test-Path -LiteralPath $outputDir -PathType Container) {
  Remove-Item -LiteralPath $outputDir -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $outputDir | Out-Null

# Stage 6: win-x64 self-contained single-file, UNTRIMMED. Self-contained so a
# clean machine needs no .NET runtime (S-030); untrimmed so COM/interop/reflection
# behavior is byte-identical to the working helper (no trim-induced surprises).
# IncludeNativeLibrariesForSelfExtract=true bundles native runtime libraries
# INTO ppt-probe.exe (extracted to a temp cache at process start) instead of
# leaving them as loose files beside the exe; electron-builder's extraResources
# filter packages ppt-probe.exe only (P1-01), so without this flag the
# installer would omit files the helper needs on a clean machine. The app package
# version is also embedded in the helper assembly metadata for P2-01. Keep
# prerelease SemVer in Version/InformationalVersion; PE FileVersion is numeric.
dotnet publish $projectPath -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -p:PublishTrimmed=false -p:IncludeNativeLibrariesForSelfExtract=true -p:Version=$productVersion -p:FileVersion=$fileVersion -p:InformationalVersion=$productVersion -p:IncludeSourceRevisionInInformationalVersion=false -o $outputDir
$publishExitCode = $LASTEXITCODE
if ($publishExitCode -ne 0) {
  throw "dotnet publish failed with exit code $publishExitCode"
}

if (-not (Test-Path -LiteralPath $exePath -PathType Leaf)) {
  throw "dotnet publish completed without producing $exePath"
}

Write-Host "Built PowerPoint probe: $exePath"
