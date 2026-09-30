# HANDOFF 2026-08-31: Audit round-4 repair (owner verdict → P0/P1/P2 fixes)

## Objective and acceptance

Owner delivered the round-4 audit verdict in-session (item-by-item 属实/不属实
confirmation) and directed: fix the confirmed items, skip the two 未核实 ones,
do not "fix" the two non-defects. Acceptance = every confirmed P0/P1/P2 item
repaired at root cause with regression coverage, all routed suites green,
owner's uncommitted tree preserved.

## Mechanism / red baseline

Baseline came from the owner's verdict (source-verified during this repair):

- P0 territory baseline: `_territoryBaseline` captured only when null
  (GameShowDispatcher), no reset anywhere. A territory change between shows
  poisons the baseline forever → every later show Faulted on countdown frame 1.
- P0 SetTimeline mid-play: `SetTimeline` cleared `_executedClipIds` without
  touching `_isPlaying` → next frame re-dispatched all history clips.
- P0 batch write non-atomic: `AnimWriter.WriteFile` = direct
  `File.WriteAllText`; batch skips existing files at enqueue → a crash-half-written
  JSON is kept forever (poison chain).
- P0 BoneAnimator dead arm: zero `new BoneAnimator`; `freezer.BoneAnim` never
  assigned; `/bonerec/*` always `{}`/no-animator; Dispose never released its
  hook. `/bonerec/list` POST branch sat outside both endpoint sets → 405 gate
  bypass (whitelisted to `{}`).
- P0 Plugin ctor: catch only logged — partially started servers/framework
  subscription leaked on any late-construction throw.
- P1: unreachable `Stopping` arm in `ShowRunner.TickInner`; PackWriter `_meta`
  placeholder pointing at a never-written file (also missing `clips/` prefix);
  freezer `Clear()` nuking the shared command queue at 3 sites; `CheckToken`
  fail-open on empty code (dead branch — PairingStore never returns empty);
  `.committing` commit orphans never cleaned; freezer dispose restore raced a
  stopping framework.
- P2: normalize rebuilt `timing`/`stage`/`metadata`/`performer.view` and dropped
  nested unknown keys (document-level `view` was fine — verdict half-rejected the
  finding); chunked over-limit answered 200+error on 48795 while declared-length
  answered 413; quarantine had no cleanup; `_batchDone/_batchTotal` not volatile;
  ~4 Info logs per command with lyric text inside 60-char cap; `Plugin.Dispose`
  comment claimed "保存学习表" while `LearnedTimelines` is memory-only.
- Not defects (no change, per verdict): WebRoot full-path prefix check is the
  standard traversal guard; freeze per-frame re-zero is intentional drift
  accounting; `/debug/poke` stays. Two unverified findings ("clip name vs
  filename", "samples fully buffered") left untouched.

## What changed and behavior preserved

C# (plugin):

1. `GameShowDispatcher.OnStop` resets `_territoryBaseline = null`. Every show
   terminal path (Completed/Faulted/RequestStop/unload) goes through `OnStop`
   (`ShowRunner.CleanupLocked`), so this is equivalent to the endorsed
   "reset at Arm" without touching `IShowDispatcher`; next countdown frame
   re-captures. Comments updated to match reality.
2. `PlaybackManager.SetTimeline` now returns `bool` — `false` while playing.
   `/playback/start` and `/playback/timeline` answer **409** (`error:"playing"`).
   Side benefit: the SetTimeline→Play frame window on start is closed because
   replacement only happens in non-playing state.
3. `AnimWriter.WriteFile` is atomic (write `<path>.committing` then
   `File.Replace`/`Move`). Batch's "skip existing" is now safe: a final file
   only ever appears complete. Same `.committing` suffix convention as commit.
4. BoneAnimator arm deleted: `src/BoneAnimator.cs` removed; freezer lost
   `BoneAnim`, `NowSeconds`, `ResolveGposeIdForRecording`,
   `BindTimelineDirect`, `GetAllEmoteCommands` (last one orphaned with the arm)
   and the two GposeFreeze bone branches (plain pipeline unchanged);
   HttpServer lost all `/bonerec/*` registrations/branches/handler — every
   remaining inline POST branch is covered by `PostEndpoints` (whitelist leak
   closed by deletion); `ReadAuthPolicy` lost `/bonerec/status`.
5. `Plugin` ctor catch now runs `Dispose()` (all steps null-conditional);
   `_disposed` guard makes Dispose idempotent for the Dalamud unload call.
6. `ShowRunner.TickInner`: unreachable Stopping "补清扫" arm removed (Stopping
   is transient inside one `RequestStop` lock hold); state machine untouched.
7. `PackWriter.CreatePackRoot` no longer writes the `_meta` placeholder
   (dangling path, zero consumers, not in ENGINE.md).
8. `GameCommandExecutor.RemoveWhere(match)` added; freezer's three `Clear()`
   sites (command switch / self-heal re-exec / chat retry) now drop only
   their own command copies — other chains' queued commands survive.
9. `LocalApiSecurity.CheckToken` → fail-closed via pure `TokenMatches`
   (empty pairing code rejects; PairingStore's ephemeral fallback remains the
   lockout protection).
10. `ExportServer.CleanStalePending` now sweeps three artifact kinds:
    pending (24h), clips `*.json.committing` (24h), quarantine (14 days).
    `ReadPostBodyOr413` unifies 48795 body-size semantics on 413 (declared and
    chunked) across clip/commit/cancel/batch. `_batchDone/_batchTotal` volatile.
11. freezer `Dispose` bounded-wait: when not on the framework thread and a
    preview was active, waits ≤2s on a marker queued behind the restore action
    so Unpin lands before unload; framework-dead case logs and gives up.
12. `GameCommandExecutor` Info log density 4→1 per command (Pre/Post-call and
    call-OK → Debug); new pure `ChatCommandPolicy.DescribeForLog` masks text
    channels (`/e`, `/p`, `/echo`, `/emote`, `/em`) to "通道 …(文本 N 字符，不落明文)"
    in Info/Warning/Error, full text stays visible at Debug.
13. `Plugin.Dispose` comment corrected (learning table is process-memory only).

Web:

14. `choreo-document.js`: new `keepUnknown` helper; `normalize` now preserves
    unknown nested keys of `timing`/`stage`/`metadata`/`performer.view`
    (module invariant "顶层与各段一视同仁"); two-pass idempotent.
15. `choreo-app.js`: dead `startRecPoll` (no callers; `/bonerec/status` gone)
    removed. The `recPos` display element is KEPT — it is the live recording
    status target of `choreo-recording-ui.js` (`recPosText`), removing it broke
    two library-verify checks during verification and it was restored.
16. Both files byte-synced to `web/dist/ChoreoHelper` (canonical in-repo root).

Tests:

- `datalayertest`: TokenMatches fail-closed ×4; DescribeForLog ×6;
  index-has-no-`_meta`; AnimWriter atomic-write ×2 (fresh + overwrite); removed
  the obsolete `/bonerec/status` pairing assertion (endpoint deleted).
- `test-document.js`: section-7 block — nested unknown keys survive in
  timing/stage/metadata/performer.view and are idempotent.

## Verification actually observed

- `datalayertest -c Release`: **369 通过 / 0 失败** (baseline round had my own
  off-by-one assertion failing, fixed; final run green).
- `ChoreoHelper.csproj` Release build: 成功, **0 警告 / 0 错误**.
- Web fast suites: engine 47/0, edit 93/0, check 73/0, projects 96/0,
  document 88/0, docwire 45/0, showcompiler 37/0, library 91/0, shell 41/0.
- Browser integration: `clipcheck-run` 148/0; `offline-verify all` 45/0;
  `library-verify all` **117/0**.
- `library-verify` flake note: the "好动作自动进资料库" check returned
  `[false,false,false,false]` / `[false,true,true,false]` in two runs; after
  fixing the genuine recPos regression it passed twice consecutively
  (28/0 standalone, 117/0 in `all`). The mock reads the live
  `ChoreoExports\clips` while the real game runs — treat isolated failures of
  that check as environment flake and re-run once before investigating.
- `process-audit --fix` then `--check`: 21/21. `check-ai-docs.js`: 45/45.
- Deploy twins: `web/choreo-app.js`, `web/choreo-document.js` byte-identical to
  `web/dist/ChoreoHelper` copies (cmp).

## Remaining owner tails and why

- **Live-install sync + DLL update (owner-gated).** The C# repairs reach the
  game only via an owner-authorized DLL update; the live `devPlugins` tree,
  game-dir `dist/ChoreoHelper` and `release/staging` were intentionally NOT
  touched (AGENTS.md boundary). The in-repo canonical dist is synced; after the
  next authorized deploy, sync roots 2/3 from it (the two changed web files ride
  along; they are backward-compatible with the currently live DLL).
- **Real-game acceptance** of the fixes (show after territory change,
  mid-play 409, batch crash-orphan sweep, unload unpin under load) needs the
  live plugin — folds into the existing EXEC-LIVE tail.
- **Pre-existing flake**: the library-verify "入库" check is
  environment-sensitive while the game is running (see above); not fixed here.

## Files changed

- Deleted: `src/BoneAnimator.cs`.
- C#: `src/GameShowDispatcher.cs`, `src/ShowRunner.cs`, `src/PlaybackManager.cs`,
  `src/HttpServer.cs`, `src/Plugin.cs`, `src/LocalApiSecurity.cs`,
  `src/ReadAuthPolicy.cs`, `src/ChatCommandPolicy.cs`,
  `src/GameCommandExecutor.cs`, `src/AnimationPoseFreezer.cs`,
  `src/Exporter/AnimWriter.cs`, `src/Exporter/ExportServer.cs`,
  `src/Exporter/PackWriter.cs`, `src/tests/datalayertest/program.cs`.
- Web: `web/choreo-document.js`, `web/choreo-app.js`, `web/test-document.js`
  + byte-synced `web/dist/ChoreoHelper/{choreo-document.js,choreo-app.js}`.
- Process: `.agent/PROCESS-STATE.json` (latestProductHandoff),
  `.agent/CONTINUITY.md` (this package's state rewrite).
