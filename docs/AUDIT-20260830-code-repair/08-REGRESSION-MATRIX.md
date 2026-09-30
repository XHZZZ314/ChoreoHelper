# 08: Unified Regression Matrix

The commands below are written for the current Windows environment. Record only actually executed results; a command timing out because the game is offline must be recorded "environment unverified" — never as pass or code failure.

## 1. Common Tool Paths

```powershell
$NodeExe = 'D:\nodejs\node.exe'
$DotnetExe = 'C:\Users\xhz\AppData\Local\Microsoft\dotnet\dotnet.exe'
$GitExe = 'C:\Program Files\Git\cmd\git.exe'
```

Do not override `$HOME`, `$home`, or `$CODEX_HOME`. If tool locations change, re-confirm from project docs and actual files first.

## 2. Pre-Work Baseline

```powershell
& $GitExe status --short
& $GitExe diff --check
```

Save the output to distinguish the owner's pre-existing changes from this package's changes. `git reset --hard`, `git clean`, and bulk checkout are forbidden.

## 3. Node Pure-Function Tests

```powershell
& $NodeExe web\test-engine.js
& $NodeExe web\test-edit.js
& $NodeExe web\test-check.js
& $NodeExe web\test-projects.js
& $NodeExe web\test-library.js
```

Current baseline: 40 + 85 + 73 + 77 + 47 = 322. Totals must rise when tests are added; old assertions must never decrease.

### Per-Package Minimums

- FIX-A: new C# path/routing tests; the Node five-suite must not regress.
- FIX-B: extend `test-edit` or add seek pure-logic tests, plus extend `mode-check`.
- FIX-C: C# clock/commit state-machine tests; recording-center mock scenario.
- FIX-D: focus on extending `test-library` covering two profiles with same-named clips and CHLB v2.
- FIX-E: C# fake dispatcher, cancel, Dispose, and reload-state tests.
- OPT-F: extend `test-projects` and perf browser scenarios.

## 4. C# Data Layer and Build

```powershell
$env:DOTNET_ROLL_FORWARD = 'Major'
& $DotnetExe run --project src\tests\datalayertest\datalayertest.csproj -c Release
& $DotnetExe build src\ChoreoHelper.csproj -c Release --no-restore -t:Rebuild
```

Current baseline: data layer 42/42; Release 0 error, 6 warning. New pure policies should go into datalayertest first, avoiding security boundaries that require launching the game to verify.

## 5. Browser/Offline Acceptance

```powershell
& $NodeExe scripts\library-verify.js
& $NodeExe scripts\clipcheck-run.js
& $NodeExe scripts\offline-verify.js offline
& $NodeExe scripts\offline-verify.js perf
```

Current baselines:

- library: 103/103.
- clip-check: 108/108.
- offline: 11/11.
- perf: 6/6.

These scripts use an isolated Chrome; `library-verify`'s recording scenario is forced through the mock and never controls the real game. After running, confirm the temp profile was cleaned by `verify-cleanup.js`.

## 6. Diagnostic Page Targeted Runs

```powershell
& $NodeExe scripts\clipcheck-run.js web\dist\ChoreoHelper\mode-check.html
& $NodeExe scripts\clipcheck-run.js web\dist\ChoreoHelper\library-check.html
```

When modifying diagnostic pages, confirm the runner actually opens the new file, not an old deployed copy in the game directory. Never trust a title PASS alone; new assertions need unique log IDs and must fail when the code is deliberately regressed.

## 7. Package-Specific Regressions

### FIX-A

- Temp-directory path policy unit tests.
- GET getclip auth, OPTIONS, 405, 403, normal read.
- Release build proves the dangerous debug write endpoint is absent or disabled by default.
- Never read the real `pairing.json`; never invoke a real boneprobe write.

### FIX-B

- Mock service stores the timeline revision; assert seek uses the current revision.
- Pure tests for action/lyric/switch overlapping seek plans.
- UTF-8 command byte boundaries and log truncation tests.
- Real game: seek before play, seek after edit, lyric overlap, blank region, normal play/stop.

### FIX-C

- Pre-place a healthy file, simulate a failed recording, compare SHA-256 before/after.
- pending commit/cancel/timeout/Dispose state-machine tests.
- Identical sampling results under fake uptimes of 0/4/13 days.
- Real game: at least one each of normal, expression, sustained, and pose types.

### FIX-D

- IndexedDB round trip for two profiles with same-named clips.
- CHLB v2 two-profile export/wipe/import.
- v1 migration, per-segment bad-bundle tampering, incompatible-model rejection.
- Real game: after switching between two cross-body characters, each keeps its own clips — no overwrite, no cross-play.

### FIX-E

- Fake framework dispatcher thread assertions.
- Dispose concurrent with requests/batch recording.
- Real game: zone change, teleport, hot reload, GPose exit, and port rebind.

### OPT-F

- Transaction request success + abort injection.
- Atomic project+version deletion.
- A→B→A repeated profile switch counts.
- GPU resources stable across 20 hardResets and 20 rounds of 12→1→12 dancer cycling.

## 8. Online Scenarios

After logging a character in:

```powershell
& $NodeExe scripts\offline-verify.js online
& $NodeExe scripts\offline-verify.js transition
& $NodeExe scripts\library-verify.js sync
```

If `/export/skeleton` returns `no player`, first confirm a character is logged in; never cache the error result permanently. For online, transition, and sync, explicitly record whether the real plugin or the mock was used.

## 9. Deploy Hash Check

Check at least every product file this package modified:

```powershell
Get-FileHash 'D:\choreohelper\web\dist\ChoreoHelper\choreo-helper-app.html' -Algorithm SHA256
Get-FileHash "$env:APPDATA\XIVLauncherCN\devPlugins\ChoreoHelper\dist\ChoreoHelper\choreo-helper-app.html" -Algorithm SHA256
Get-FileHash 'D:\Program Files\上海数龙科技有限公司\最终幻想XIV\game\dist\ChoreoHelper\choreo-helper-app.html' -Algorithm SHA256
```

Check other modified files the same way. Generated artifacts must be rebuilt from scripts first, then synced — never reverse-copied from the game directory over the source.

## 10. Final Checks

```powershell
& $GitExe diff --check
& $GitExe status --short
```

Manual checks:

- [ ] The diff contains only this package's files.
- [ ] No real models, clips, projects, pairing codes, absolute personal data, or temp screenshots.
- [ ] No accidental whole-file generation/reformatting.
- [ ] Test numbers and unverified items recorded in the handoff.
- [ ] `.agent/CONTINUITY.md` updated to current facts.
- [ ] No commit, push, or release unless the owner explicitly authorizes it.
