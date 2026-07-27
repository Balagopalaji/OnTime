$ErrorActionPreference = 'Stop'

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectPath = Join-Path $scriptDir '..\native\windows-ppt-probe\ppt-probe.csproj'
$outputDir = Join-Path $scriptDir '..\bin\win-x64'
$exePath = Join-Path $outputDir 'ppt-probe.exe'

if (Test-Path -LiteralPath $outputDir -PathType Container) {
  Remove-Item -LiteralPath $outputDir -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $outputDir | Out-Null

dotnet publish $projectPath -c Release -r win-x64 --self-contained false -p:PublishSingleFile=true -o $outputDir
$publishExitCode = $LASTEXITCODE
if ($publishExitCode -ne 0) {
  throw "dotnet publish failed with exit code $publishExitCode"
}

if (-not (Test-Path -LiteralPath $exePath -PathType Leaf)) {
  throw "dotnet publish completed without producing $exePath"
}

Write-Host "Built PowerPoint probe: $exePath"
