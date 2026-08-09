import { execFileSync, execSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(packageRoot, '../..');

function readScript(relativePath: string): string {
  return readFileSync(path.join(packageRoot, relativePath), 'utf8');
}

function readNativeProgram(): string {
  return readFileSync(path.join(packageRoot, 'native/windows-ppt-probe/Program.cs'), 'utf8');
}

function deriveWindowsFileVersion(appVersion: string): string {
  return execFileSync(
    process.execPath,
    [path.join(packageRoot, 'scripts/windows-file-version.mjs'), appVersion],
    { cwd: repoRoot, encoding: 'utf8' },
  ).trim();
}

describe('Windows native build scripts', () => {
  it('cleans canonical output and fails before stale-output checks on publish failure', () => {
    const script = readScript('scripts/build-windows.ps1');
    const publish = script.indexOf('dotnet publish $projectPath -c Release -r win-x64');
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

  it('uses the checked-in cross-platform Node CJS builder for both runtime packages', () => {
    const helper = readFileSync(path.join(repoRoot, 'scripts/build-cjs.mjs'), 'utf8');
    expect(helper).toContain("rmSync(outputDir, { recursive: true, force: true })");
    expect(helper).toContain("writeFileSync(path.join(outputDir, 'package.json')");
    expect(helper).toContain('spawnSync(process.execPath');
    expect(helper).not.toContain('rm -rf');
    expect(helper).not.toContain('printf');

    for (const packagePath of [
      'packages/ppt-bridge/package.json',
      'packages/presentation-core/package.json',
    ]) {
      const pkg = JSON.parse(readFileSync(path.join(repoRoot, packagePath), 'utf8')) as {
        scripts?: { 'build:cjs'?: string };
      };
      expect(pkg.scripts?.['build:cjs']).toBe('node ../../scripts/build-cjs.mjs');
    }
  });

  it('executes the CJS builder with a temporary package on the current platform', () => {
    const tempRoot = mkdtempSync(path.join(repoRoot, '.tmp-cjs-build-'));
    try {
      mkdirSync(path.join(tempRoot, 'src'));
      writeFileSync(
        path.join(tempRoot, 'tsconfig.cjs.json'),
        JSON.stringify({
          compilerOptions: {
            target: 'ES2022',
            module: 'CommonJS',
            declaration: true,
            outDir: 'dist-cjs',
            rootDir: 'src',
          },
          include: ['src/**/*.ts'],
        }),
      );
      writeFileSync(path.join(tempRoot, 'src/index.ts'), 'export const smokeValue = 1\n');

      execFileSync(process.execPath, [path.join(repoRoot, 'scripts/build-cjs.mjs')], {
        cwd: tempRoot,
        stdio: 'inherit',
      });

      expect(readFileSync(path.join(tempRoot, 'dist-cjs/package.json'), 'utf8')).toBe(
        '{"type":"commonjs"}\n',
      );
      expect(readFileSync(path.join(tempRoot, 'dist-cjs/index.js'), 'utf8')).toContain(
        'smokeValue',
      );
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  }, 15_000);

  it('embeds the standalone beta version in the helper assembly metadata', () => {
    const script = readScript('scripts/build-windows.ps1');
    expect(script).toContain("ConvertFrom-Json).version");
    expect(script).toContain('packages/ppt-bridge/scripts/windows-file-version.mjs');
    expect(script).toContain('-p:Version=$productVersion');
    expect(script).toContain('-p:FileVersion=$fileVersion');
    expect(script).toContain('-p:InformationalVersion=$productVersion');
    expect(script).not.toContain('-p:FileVersion=$productVersion');
    expect(script).toContain('-p:IncludeSourceRevisionInInformationalVersion=false');
    expect(script).toContain("apps\\ppt-timer\\package.json");
  });

  it('derives numeric PE FileVersion from SemVer and enforces four-part bounds', () => {
    expect(deriveWindowsFileVersion('0.1.0-beta.1')).toBe('0.1.0.1');
    expect(deriveWindowsFileVersion('0.1.0-beta.1+build.7')).toBe('0.1.0.1');
    expect(deriveWindowsFileVersion('1.2.3')).toBe('1.2.3.0');
    expect(() => deriveWindowsFileVersion('65536.0.0')).toThrow(/between 0 and 65535/);
    expect(() => deriveWindowsFileVersion('1.2.3-beta.65536')).toThrow(/between 0 and 65535/);
  });

  it('emits the published helper product version with the protocol version', () => {
    const program = readNativeProgram();
    expect(program).toContain('AssemblyInformationalVersionAttribute');
    expect(program).toContain('["productVersion"] = ProductVersion');
    expect(program).toContain('["protocolVersion"] = ProtocolVersion');
  });

  it('reads PowerPoint Player.State correctly and emits a zero play anchor', () => {
    const program = readNativeProgram();
    expect(program).toContain('private const int PpPlayerPlaying = 0;');
    expect(program).toContain('private const int PpPlayerPaused = 1;');
    expect(program).toContain('private const int PpPlayerStopped = 2;');
    expect(program).toContain('private const int PpPlayerNotReady = 3;');
    expect(program).toContain('ConvertToMs(rawElapsed.Value, allowZero: true)');
    expect(program).toContain('if (status == "playing" && !hasElapsed)');
    expect(program).not.toContain('if (stateRaw.Value == 2) status = "playing"');
    expect(program).not.toContain('stateRaw.HasValue && hasElapsed');
  });

  it('replaces a cached stopped end-position when Player.State newly becomes playing', () => {
    const program = readNativeProgram();
    const normalized = program.indexOf('var freshElapsedMs = NormalizeElapsed(effectiveDurationMs, rawElapsed);');
    const replacement = program.indexOf('if (ShouldReplaceStaleTerminalPositionWithPlayAnchor(');
    const classified = program.indexOf('var hasFreshPosition = freshElapsedMs.HasValue;');
    expect(normalized).toBeGreaterThanOrEqual(0);
    expect(replacement).toBeGreaterThan(normalized);
    expect(classified).toBeGreaterThan(replacement);
    expect(program.slice(replacement, classified)).toContain('freshElapsedMs = 0;');

    const helperStart = program.indexOf('private static bool ShouldReplaceStaleTerminalPositionWithPlayAnchor(');
    const helperEnd = program.indexOf('// A cold response can use media discovered before a COM failure', helperStart);
    const helper = program.slice(helperStart, helperEnd);
    expect(helperStart).toBeGreaterThanOrEqual(0);
    expect(helperEnd).toBeGreaterThan(helperStart);
    // These gates are the regression contract: cached transition history plus
    // a stopped/not-ready -> playing transition and a fresh at-end position.
    // The cached row may have no Status because idle timing refresh is
    // round-robin on multi-video slides. Stable playing end samples and first
    // observations (cached == null) remain on the immediate-ended path.
    expect(helper).toContain('cached != null');
    expect(helper).not.toContain('cached?.Status == "ended"');
    expect(helper).toContain('cached.StateRaw is PpPlayerStopped or PpPlayerNotReady');
    expect(helper).toContain('stateRaw == PpPlayerPlaying');
    expect(helper).toContain('cached.StateRaw != stateRaw');
    expect(helper).toContain('freshElapsedMs.Value >= durationMs.Value - 250');
  });

  it('uses state-first media polling and avoids redundant edit-window media scans', () => {
    const program = readNativeProgram();
    const stateRead = program.indexOf('TryGetProp(player, "State")');
    const positionRead = program.indexOf('TryGetProp(candidate.Player, "CurrentPosition")');

    expect(stateRead).toBeGreaterThanOrEqual(0);
    expect(positionRead).toBeGreaterThanOrEqual(0);
    // Candidate construction (cold or warm) completes its Player.State pass
    // before the shared timing loop conditionally reads CurrentPosition.
    expect(program).toContain('var rawElapsed = shouldReadPosition');
    expect(program).toContain('candidate.StateRaw is PpPlayerPlaying or PpPlayerPaused');
    expect(program).toContain('MediaValuesByShapeId');
    expect(program).toContain('BeginMediaValueScope');
    expect(program).toContain('PruneMediaValues(presentShapeIds)');
    expect(program).toContain('SelectStableStoppedRefresh(candidates)');
    expect(program).toContain('cached == null ||');
    expect(program).toContain('stateChanged ||');
    expect(program).toContain('cached?.Status != null');
    expect(program).toContain('var hasFreshPosition = freshElapsedMs.HasValue;');
    expect(program).toContain('!hasFreshPosition && cached?.Status != null');
    expect(program).toContain('IsKnownPlayerState');
    expect(program).toContain('if (hasInvalidPlayerState) ResetMediaValueCache();');
    expect(program).toContain('ResetMediaValueCache();');
    expect(program).not.toContain('TryGetProp(activeWindow, "View")');
    expect(program).not.toContain('payload["editSlideVideos"]');
  });

  it('warms a complete descriptor cache before using fast state sweeps', () => {
    const program = readNativeProgram();
    const warmBuild = program.indexOf('TryBuildWarmCandidates(ssView, out var candidates)');
    const coldShapes = program.indexOf('var mediaCollectionComplete = CollectMediaShapes(TryGetProp(slide, "Shapes"), slideCandidates)');

    expect(warmBuild).toBeGreaterThanOrEqual(0);
    expect(coldShapes).toBeGreaterThan(warmBuild);
    expect(program).toContain('private static readonly List<CachedMediaDescriptor> MediaDescriptors');
    expect(program).toContain('private static bool HasCompleteMediaDescriptorCache');
    expect(program).toContain('private static void CacheMediaDescriptors');
    expect(program).toContain('if (!HasCompleteMediaDescriptorCache || ssView == null) return false;');
    expect(program).toContain('if (!MediaValuesByShapeId.ContainsKey(descriptor.ShapeId))');
    expect(program).toContain('var player = TryInvoke(ssView, "Player", descriptor.ShapeId);');
    expect(program).toContain('if (player == null || !stateRaw.HasValue || !IsKnownPlayerState(stateRaw.Value))');
    expect(program).toContain('out var canWarmCache');
    expect(program).toContain('if (canWarmCache && !hasInvalidPlayerState)');
    expect(program).toContain('else DisableWarmDescriptorCache();');
    expect(program).toContain('private static bool CollectMediaShapes');
    expect(program).toContain('if (shapesObj == null) return false;');
    expect(program).toContain('if (!count.HasValue || count.Value < 0) return false;');
    expect(program).toContain('if (shape == null)');
    expect(program).toContain('if (!shapeType.HasValue)');
    expect(program).toContain('if (shapeType == 14)');
    expect(program).toContain('if (placeholder == null || !containedType.HasValue)');
    expect(program).toContain('if (!CollectMediaShapes(groupItems, candidates)) complete = false;');
    expect(program).toContain('CacheMediaDescriptors(candidates, mediaCollectionComplete);');
    expect(program).toContain('if (!collectionComplete || candidates.Count == 0)');
    expect(program).toContain('var activeTimingRefreshId = isWarmPoll ? SelectActiveTimingRefresh(candidates) : null;');
    expect(program).toContain('(isWarmPoll && (candidate.ShapeId == activeTimingRefreshId ||');
    expect(program).toContain('candidate.ShapeId == stableStoppedRefreshId');
    expect(program).toContain('AdvanceCachedElapsed(cached, effectiveDurationMs, candidate.StateRaw)');
    expect(program).toContain('var usedAdvancedWarmElapsed = false;');
    expect(program).toContain('var usedZeroPlayAnchor = false;');
    expect(program).toContain('hasFreshPosition || usedAdvancedWarmElapsed || usedZeroPlayAnchor');
    expect(program).toContain('remaining.Value == 0 || (!isWarmPoll && elapsedValue >= effectiveDurationMs.Value - 250)');
    expect(program).toContain('MediaDescriptors.Clear();');
    expect(program).toContain('HasCompleteMediaDescriptorCache = false;');
    expect(program).toContain('ActiveTimingRefreshCursor = 0;');
  });

  it('publishes win-x64 self-contained single-file UNTRIMMED (Stage 6 retarget)', () => {
    const script = readScript('scripts/build-windows.ps1');
    // Self-contained so a clean machine needs no .NET runtime (S-030).
    expect(script).toContain('--self-contained true');
    expect(script).not.toContain('--self-contained false');
    // Single-file.
    expect(script).toContain('-p:PublishSingleFile=true');
    // Untrimmed: COM/interop/reflection behavior stays byte-identical to the
    // working helper (no trimming of the runtime or unused reflection paths).
    expect(script).toContain('-p:PublishTrimmed=false');
    expect(script).not.toMatch(/PublishTrimmed=true/);
    // RID stays win-x64.
    expect(script).toMatch(/-r win-x64/);
  });

  it('bundles native runtime libraries into the single-file exe (P1-01: true one-file payload)', () => {
    const script = readScript('scripts/build-windows.ps1');
    // Without this flag, native runtime DLLs are extracted as loose files
    // beside ppt-probe.exe, but electron-builder only packages the exe itself.
    expect(script).toContain('-p:IncludeNativeLibrariesForSelfExtract=true');
    expect(script).not.toMatch(/IncludeNativeLibrariesForSelfExtract=false/);
    // The publish command line carries every required flag together, so the
    // full one-file contract is one atomic invocation, not separable pieces.
    const publishLine = script
      .split('\n')
      .find((line) => line.includes('dotnet publish'));
    expect(publishLine).toBeDefined();
    expect(publishLine).toContain('--self-contained true');
    expect(publishLine).toContain('-p:PublishSingleFile=true');
    expect(publishLine).toContain('-p:IncludeNativeLibrariesForSelfExtract=true');
  });

  it('targets the .NET 10 Windows framework in the canonical csproj', () => {
    const csproj = readScript('native/windows-ppt-probe/ppt-probe.csproj');
    expect(csproj).toMatch(/<TargetFramework>net10\.0-windows<\/TargetFramework>/);
    expect(csproj).not.toMatch(/<TargetFramework>net6\.0-windows<\/TargetFramework>/);
    // Output/namespace/assembly identity unchanged.
    expect(csproj).toContain('<AssemblyName>ppt-probe</AssemblyName>');
    expect(csproj).toContain('<RootNamespace>OnTime.PptProbe</RootNamespace>');
    expect(csproj).toContain('<IncludeSourceRevisionInInformationalVersion>false</IncludeSourceRevisionInInformationalVersion>');
  });

  it('keeps exactly one tracked Program.cs (no duplication or stray move)', () => {
    // Plan Stage 2/6 invariant: one canonical native source. Run from repo root so
    // git ls-files emits repo-relative paths; tracked-files only (ignores dist).
    const out = execSync('git ls-files', { cwd: repoRoot }).toString('utf8')
    const programCs = out
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && l.endsWith('Program.cs'))
    expect(programCs).toEqual(['packages/ppt-bridge/native/windows-ppt-probe/Program.cs'])
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
