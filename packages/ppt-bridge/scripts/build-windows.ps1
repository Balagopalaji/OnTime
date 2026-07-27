$ErrorActionPreference = 'Stop'

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectPath = Join-Path $scriptDir '..\native\windows-ppt-probe\ppt-probe.csproj'
$outputDir = Join-Path $scriptDir '..\bin\win-x64'
$exePath = Join-Path $outputDir 'ppt-probe.exe'

dotnet publish $projectPath -c Release -r win-x64 --self-contained false -p:PublishSingleFile=true -o $outputDir

if (-not (Test-Path -LiteralPath $exePath -PathType Leaf)) {
  throw "dotnet publish completed without producing $exePath"
}

Write-Host "Built PowerPoint probe: $exePath"
