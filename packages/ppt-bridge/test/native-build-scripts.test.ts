import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function readScript(relativePath: string): string {
  return readFileSync(path.join(packageRoot, relativePath), 'utf8');
}

describe('Windows native build scripts', () => {
  it('cleans canonical output and fails before stale-output checks on publish failure', () => {
    const script = readScript('scripts/build-windows.ps1');
    const publish = script.indexOf(
      'dotnet publish $projectPath -c Release -r win-x64 --self-contained false -p:PublishSingleFile=true -o $outputDir',
    );
    const exitCodeCapture = script.indexOf('$publishExitCode = $LASTEXITCODE');
    const exitCodeGuard = script.indexOf('if ($publishExitCode -ne 0)');
    const outputCheck = script.indexOf(
      'Test-Path -LiteralPath $exePath -PathType Leaf',
    );

    expect(script).toContain(
      'Remove-Item -LiteralPath $outputDir -Recurse -Force',
    );
    const cleanup = script.indexOf(
      'Remove-Item -LiteralPath $outputDir -Recurse -Force',
    );
    const recreate = script.indexOf(
      'New-Item -ItemType Directory -Force -Path $outputDir',
    );

    expect(cleanup).toBeGreaterThanOrEqual(0);
    expect(recreate).toBeGreaterThan(cleanup);
    expect(publish).toBeGreaterThan(recreate);
    expect(script).toMatch(
      /dotnet publish[^\r\n]*\r?\n\$publishExitCode = \$LASTEXITCODE/,
    );
    expect(exitCodeGuard).toBeGreaterThan(exitCodeCapture);
    expect(outputCheck).toBeGreaterThan(exitCodeGuard);
    expect(script.slice(exitCodeGuard, outputCheck)).toContain('throw');
  });

  it('lets canonical publish failure terminate the compatibility shim', () => {
    const shim = readScript('../../companion/scripts/build-ppt-probe.ps1');
    const canonicalInvocation = shim.indexOf('& $canonicalScript');
    const canonicalOutputCheck = shim.indexOf(
      'Test-Path -LiteralPath $canonicalOutput -PathType Leaf',
    );
    const copy = shim.indexOf(
      'Copy-Item -LiteralPath $canonicalOutput -Destination $compatibilityOutput -Force',
    );
    const hashValidation = shim.indexOf(
      '$canonicalHash = (Get-FileHash -LiteralPath $canonicalOutput -Algorithm SHA256).Hash',
    );

    expect(shim).toContain("$ErrorActionPreference = 'Stop'");
    expect(shim).not.toContain('dotnet publish');
    expect(shim).not.toMatch(/\bcatch\b/);
    expect(canonicalInvocation).toBeGreaterThanOrEqual(0);
    expect(canonicalOutputCheck).toBeGreaterThan(canonicalInvocation);
    expect(copy).toBeGreaterThan(canonicalOutputCheck);
    expect(hashValidation).toBeGreaterThan(copy);
  });
});
