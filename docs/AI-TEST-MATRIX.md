# ChoreoHelper test matrix

> Select checks by changed surface, then expand with risk. Counts are observations, not assertions to hard-code.

## Self-test mandate

After finishing a package — and before reporting — test everything that is testable in this
environment yourself. Do not leave a check to the owner that the working AI could have run:

1. Run the routed checks above, then go one level deeper as risk warrants: red/green
   reproduction, fuzz/idempotency/determinism sweeps, real-browser `file://` smoke for newly
   shipped web files, release-whitelist/inventory cross-checks, and freezing real
   source-derived shapes as permanent regression fixtures.
2. Only genuinely owner-bound checks may remain as owner tails: real-game/live-install actions
   (anything that would overwrite the running install), mutating live actions that need explicit
   authorization (e.g. real recording), and commit/push/publish. List each remaining owner tail
   in the handoff with the reason it cannot be self-tested.
3. Temporary self-test scripts and artifacts are deleted after the run; conclusions that must
   stick become permanent assertions in the routed suites. Record deepened self-test evidence in
   the handoff like any other check.

## Fast pure suites

```powershell
& 'D:\nodejs\node.exe' web\test-engine.js
& 'D:\nodejs\node.exe' web\test-edit.js
& 'D:\nodejs\node.exe' web\test-check.js
& 'D:\nodejs\node.exe' web\test-projects.js
& 'D:\nodejs\node.exe' web\test-document.js
& 'D:\nodejs\node.exe' web\test-docwire.js
& 'D:\nodejs\node.exe' web\test-showcompiler.js
& 'D:\nodejs\node.exe' web\test-library.js
& 'D:\nodejs\node.exe' web\test-shell.js
```

Run the touched module plus dependants during development; run the first eight for shared controller/schema changes (including `test-document`/`test-docwire` for any project/document schema, migration or persistence-wiring work, and `test-showcompiler` for show-package/executor-protocol work) and `test-shell` for loading, deploy or packaging structure.

## Browser integration

```powershell
& 'D:\nodejs\node.exe' scripts\clipcheck-run.js
& 'D:\nodejs\node.exe' scripts\offline-verify.js all
& 'D:\nodejs\node.exe' scripts\library-verify.js all
```

- `clipcheck-run`: editor/controller and deployed game-root smoke.
- `offline-verify`: file-mode startup, online transition, preview performance and diagnostic pages.
- `library-verify`: CORS/pairing mocks, profiles, backup, recording UI, project and library integration. It can use the real plugin when online.
- Real recording, real movement and live-game playback scenarios are mutating; run only when the package requires them and the owner has authorized that live action.

## C#

```powershell
$env:DOTNET_ROLL_FORWARD = 'Major'
& 'C:\Users\xhz\AppData\Local\Microsoft\dotnet\dotnet.exe' run --project src\tests\datalayertest\datalayertest.csproj -c Release
& 'C:\Users\xhz\AppData\Local\Microsoft\dotnet\dotnet.exe' build src\ChoreoHelper.csproj -c Release --no-incremental
Remove-Item Env:DOTNET_ROLL_FORWARD
```

Pure policy changes belong in datalayertest. HTTP/game-thread changes additionally need targeted live curl or game validation when safe.

## Structural web change gate

For loading order, file extraction, deploy or packaging changes:

1. All Node fast suites (including `test-document`/`test-docwire`).
2. Local `web/dist` clip-check plus default game-root clip-check.
3. `offline-verify all` and `library-verify all`.
4. Confirm source twins and all three deploy roots are byte-identical for product files.
5. Confirm every new product resource is in the release whitelist and diagnostic/test resources are not.

## Final hygiene

```powershell
git diff --check
git status --short --branch
```

Inspect the diff for unrelated edits, generated/private assets, local paths and encoding-only changes. Do not claim a test was run unless its output was observed in the current package.
