---
Type: Plan
Status: current
Owner: KDB
Last updated: 2026-08-13
Scope: Windows Store packaging and acceptance for the existing standalone PowerPoint timer.
---

# PowerPoint Timer Windows Store Readiness

## Outcome and scope

This phase adds a Microsoft Store package and the evidence needed to decide
whether the accepted standalone timer can ship through the Store. It does not
change PowerPoint timing behavior, add remote viewing or control, extract the
shared viewer, or rename repository/package identities to Downstage before the
Store name is reserved.

The existing unsigned NSIS installer remains the trusted-beta artifact until a
Store-installed package passes the runtime and lifecycle gates below. Producing
an AppX/MSIX-family file is necessary but is not Store-readiness evidence by
itself.

## Packaging decision

Use electron-builder `26.11.1`'s opt-in `appx` target for the feasibility
artifact. That is the pinned toolchain's supported Microsoft Store/MSIX-family
target; it produces an `.appx` package with an `AppxManifest.xml`. Microsoft
Partner Center accepts `.appx` and `.msix` packages. Do not rename an `.appx`
file to `.msix`.

Keep the current `electron-builder.yml` default target and `npm run dist`
contract NSIS-only. The Store feasibility build is a separately named command,
artifact, manifest and, after local proof, CI lane. Both targets share the
existing production-file allowlist and the one canonical helper at runtime path
`resources/bin/ppt-probe.exe`.

The first package uses an explicitly provisional identity. Final
`Identity.Name`, `Publisher`, publisher display name, product/display name and
listing assets are supplied only after **Downstage PPT Video Timer** is reserved
and Partner Center exposes the assigned product identity. The provisional
package is never described as signed, Store-certified or publicly releasable.

## Store package version contract

The Store package version is a separately recorded four-part numeric value:
`Major.Minor.Build.0`.

- `Major` is nonzero.
- Each component is in `0..65535`.
- `Revision` is always `0`, because the Store reserves the fourth component.
- Every submitted or upgrade-test package is strictly greater than the previous
  package version while retaining the same package name and publisher.
- The application SemVer remains the source for app/helper product versions,
  but prerelease suffixes such as `beta.1` are not silently converted into the
  Store revision component.

The initial feasibility package version is `1.0.0.0`. A later upgrade proof
must use at least `1.0.1.0`. Final release numbering is reviewed again when the
Store identity is reserved.

## Identity, trust and runtime contract

The Electron application is a full-trust desktop application. Its package
declares only the required `runFullTrust` restricted capability unless a later
tested requirement justifies another capability. Partner Center approval and
the certification explanation for `runFullTrust` remain release gates.

The package must contain exactly one self-contained native helper at
`app/resources/bin/ppt-probe.exe`. At runtime Electron resolves it through
`process.resourcesPath/bin/ppt-probe.exe`, starts it as a child process, and
communicates over its existing standard streams. A package-content check proves
presence and identity; installed-package tests must separately prove process
execution and PowerPoint COM automation.

Settings intentionally survive uninstall, matching standalone scenario S-032
and the NSIS beta's existing `deleteAppDataOnUninstall: false` behavior.
MSIX-to-MSIX update must preserve them, uninstall must remove the package,
install tree and processes without modifying settings, and reinstall must
restore preserved settings. Live feasibility testing proved this behavior for
ordinary roaming AppData.

The final Downstage build starts clean at a new Downstage settings path. It must
not probe, read, copy, move or delete `%APPDATA%/@ontime/ppt-timer`, and it must
not ship an OnTime-specific migration. Existing beta settings remain untouched.
If a generic user-selected settings import is ever added, it is a separately
specified feature and not part of Store readiness.

An NSIS beta installation is not an in-place predecessor of the Store package.
Before public Store installation, beta testers uninstall NSIS manually. No
automatic NSIS-to-MSIX settings migration or side-by-side support is claimed in
this phase.

Store signing and updates are Microsoft-managed after certification. Local
sideload tests require a package signature whose certificate subject exactly
matches the manifest publisher and whose certificate is trusted on that test
machine. The package signature and the inner helper PE signature are recorded
separately.

## Accepted window contract used for Store acceptance

The roadmap's accepted M1 surface supersedes the original beta surface wording
in S-018/S-020/S-021:

- closed size is `190 x 80` CSS pixels;
- the operator moves the frameless window by dragging it; there is no dedicated
  Move-to-display control in the exact four-control action strip;
- narrow expansion widens to at least 260 pixels and a wider custom window does
  not narrow;
- expansion shows every video row, grows down when possible and otherwise grows
  up while retaining the compact bottom edge;
- collapse restores the exact captured compact bounds; expanded tray bounds are
  never persisted as compact bounds;
- persisted operator settings are compact/custom bounds, always-on-top,
  Remaining/Elapsed, and Auto open. Display topology changes still revalidate
  the saved bounds onto an available work area.

The standalone spec and conformance matrix must be reconciled to this accepted
surface before final Store acceptance is claimed. This packaging phase does not
reintroduce the removed display selector.

## Artifact contract

### NSIS trusted beta (preserved)

- Default command: `npm run dist --workspace apps/ppt-timer`.
- Artifact: `OnTime-PowerPoint-Video-Timer-<app-version>-win-x64-setup.exe`.
- Installer: assisted, per-user NSIS; unsigned; settings preserved on normal
  uninstall; no auto-update.
- Existing checksum, deterministic manifest, helper/ASAR allowlist and forbidden
  asset checks remain required.

Baseline artifact already present at the starting commit:

| Field | Value |
| --- | --- |
| Source commit | `61ffab5cb03510cd27b8b1a7f6611c448d38c581` |
| Artifact | `apps/ppt-timer/dist_out/OnTime-PowerPoint-Video-Timer-0.1.0-beta.1-win-x64-setup.exe` |
| Bytes | `126452235` |
| SHA-256 | `a316e9102c748e1bfee44704952ddf3489e119082ee41ec1c58fde49d637c9fa` |
| Status | PASS as the accepted unsigned NSIS beta baseline; not a Store artifact |

### AppX/MSIX-family feasibility artifact

- Explicit command only; it is not added to the default `win.target`.
- Artifact: separately named `.appx`, x64, provisional identity, Store package
  version `1.0.0.0`.
- Archive must contain `AppxManifest.xml`, the Electron executable under `app/`,
  `app/resources/app.asar`, and exactly one
  `app/resources/bin/ppt-probe.exe`.
- Manifest inspection records name, publisher, display name, application ID,
  x64 architecture, Desktop target family, four-part version, executable and
  exact capabilities.
- ASAR inspection retains the required `@ontime/ppt-bridge` and
  `@ontime/presentation-core` runtime entries and all existing forbidden-asset
  checks.
- Helper inspection records SHA-256, PE ProductVersion/FileVersion, absence of
  loose runtime DLL dependencies and its separate Authenticode state.
- The artifact receives a target-specific SHA-256 and deterministic manifest;
  it never overwrites or ambiguously reuses the NSIS manifest.

## Gates and evidence

| Gate | Exit condition | Current status |
| --- | --- | --- |
| G0 Scope/baseline | Clean requested branch at `61ffab5`; exclusions and NSIS baseline recorded | PASS |
| G1 Feasibility decision | Additive AppX target selected; identity, version, settings, signing, update and fallback contracts explicit | PASS (decision only) |
| G2 Static/build contract | Opt-in config and scripts; deterministic tests prove NSIS remains default and both artifact contracts are unambiguous | PASS (`05ba0f4`, `014f428`) |
| G3 Package build | Windows creates AppX; actual archive/manifest/helper/ASAR inspection passes; exact bytes and hashes recorded | PASS (unsigned feasibility artifact only) |
| G4 Installed runtime | Signed/trusted local package installs; exact package identity recorded; one app/helper; helper discovery, close cleanup and single-instance pass | PASS (provisional identity) |
| G5 PowerPoint COM | Installed package reports not-running/no-slideshow/live media and passes the agreed media/recovery/coexistence subset | PENDING |
| G6 Lifecycle | Same-identity higher-version AppX updates in place with settings preserved; uninstall removes package/install tree/processes while preserving settings; clean-profile reinstall starts with defaults | PASS (provisional identity; repeat for final Downstage path) |
| G7 Display acceptance | Edge/corner expansion plus 100/125/150% mixed-DPI, display removal, taskbar and Presenter View/AOT matrix passes | PENDING |
| G8 Store validation | Name reserved; final identity/assets applied; WACK, Partner Center validation, restricted-capability approval, private Store install/update and certification pass | PENDING |

G3 records package construction and content integrity only. The 182,111,008-byte
unsigned feasibility artifact has SHA-256
`eede465fb780bedf630f7c6ba9993778c124abcfaf8854d9f9bdfc498d50a824`.
Its manifest contains provisional identity
`OnTime.PptVideoTimer.Feasibility`, provisional publisher
`CN=OnTime Store Feasibility`, version `1.0.0.0`, x64 architecture,
`Windows.FullTrustApplication`, and only `runFullTrust`. The packaged helper at
`app/resources/bin/ppt-probe.exe` exactly matches the canonical helper SHA-256
`16110898dc0ad17ec8442ccc93a7b9908f125dbb5f792e7de73ae1b743de8135`.

G4 passed after the operator placed only the development certificate in Local
Machine Trusted People and installed the signed sideload copy. Root trust was
explicitly declined. The installed provisional identity is
`OnTime.PptVideoTimer.Feasibility_1.0.0.0_x64__ehycgczdr27n0`, and Windows
reports `SignatureKind: Developer` and `Status: Ok`. Package activation starts
one main process and one packaged helper, repeat activation retains both PIDs
and foregrounds the existing window, normal close removes the entire process
tree, and relaunch restores settings. This PASS applies only to the provisional
identity; it must be repeated after the Partner Center identity and Downstage
settings-path decision are applied.

The provisional package currently reads and writes the pre-existing NSIS path
`%APPDATA%/@ontime/ppt-timer/settings.json`. A packaged write and reload passed,
but this is also proof that NSIS and the feasibility AppX share legacy settings.
The final Downstage identity slice must use a clean Downstage settings path and
must not import from or otherwise touch the legacy path.

If G4 or G5 demonstrates a platform incompatibility that cannot be corrected
without expanding product scope, stop the AppX path and document the exact
failure. The fallback is a separately reviewed Microsoft Store MSI/EXE listing;
that route requires a trusted publisher signature on the installer and all
shipped PE files and does not make the current unsigned NSIS artifact public.

## Manual acceptance evidence fields

For every display case record:

```text
displayId, scaleFactor
workArea = {x,y,width,height}
compactBefore = {x,y,width,height}
videosExpanded = {x,y,width,height}
optionsExpanded = {x,y,width,height}
compactAfter = {x,y,width,height}
collapseDelta = compactAfter - compactBefore
```

Near-edge acceptance covers the four edges and four corners with two and five
video rows, followed by ten expand/collapse cycles with zero geometry drift.
Mixed-DPI acceptance covers 100-to-125, 100-to-150 and 125-to-150 percent
display pairs, negative display coordinates, vertical offsets, dragging across
displays, restart on each display, scaling changes while open/closed, display
disconnect/reconnect, taskbar edges/auto-hide, and PowerPoint Presenter View.

## Current primary references

- [App package requirements](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msix/app-package-requirements)
- [Upload MSIX/AppX packages](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msix/upload-app-packages)
- [Package identity](https://learn.microsoft.com/en-us/windows/apps/desktop/modernize/package-identity-overview)
- [Packaged desktop app behavior](https://learn.microsoft.com/en-us/windows/msix/desktop/desktop-to-uwp-behind-the-scenes)
- [App capability declarations](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/app-capability-declarations)
- [Test an MSIX package](https://learn.microsoft.com/en-us/windows/msix/desktop/desktop-to-uwp-debug)
- [Microsoft Store onboarding](https://learn.microsoft.com/en-us/windows/apps/publish/get-started)
- [electron-builder AppX target](https://www.electron.build/docs/appx/)
