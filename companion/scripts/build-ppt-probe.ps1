$ErrorActionPreference = 'Stop'

# Windows-only build for the STA helper used to query PowerPoint COM.

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectPath = Join-Path $scriptDir '..\ppt-probe\ppt-probe.csproj'
$outputDir = Join-Path $scriptDir '..\bin'

dotnet publish $projectPath -c Release -r win-x64 --self-contained false -p:PublishSingleFile=true -o $outputDir
