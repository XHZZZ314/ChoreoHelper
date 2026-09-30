# HANDOFF: FIX-B Game Seek and Command Boundaries (AUD2-003/004/005)

> Completed 2026-08-30. Version stays **0.7.1** (pure fixes, no new features, no schema/protocol breaking changes).
> Work package: `docs/AUDIT-20260830-code-repair/02-FIX-B-GAME-SEEK-AND-COMMANDS.md`
> Previous package: `docs/HANDOFF-20260830-fix-a-local-api-security.md` (FIX-A, closed)

## 1. What was fixed (plain language)

**Problem 1 (AUD2-003)**: when dragging the playhead in game mode, the web only told the plugin "jump to second X", not "which revision of the timeline". If game mode was entered without pressing play yet, or the choreography was just edited, the plugin held an empty/stale timeline — the character froze on the wrong clip.

**Fix**: give the timeline a "revision number". Every web edit (add/delete/drag/undo/redo/project switch/import) bumps the revision; on entering game mode, or ~0.3s after an edit, the full current timeline snapshot is auto-pushed to the plugin's new endpoint `/playback/timeline`. Every drag then carries the revision; on mismatch the plugin returns 409, and the web auto-re-pushes the snapshot and retries once. Legacy revision-less seeks from old web pages stay compatible (transitional).

**Problem 2 (AUD2-004)**: on drag-seek, the plugin picked, from "one flat list", whatever last event covered the current moment — lyrics could crowd out the action that should freeze, a class-switch command was treated as an animation to freeze, and repeated dragging could re-execute lines.

**Fix**: new pure-function file `SeekPlan.cs` (no Dalamud dependency, into datalayertest) pins the seek event semantics: **only actions freeze** (each actor picked independently, no cross-overwrite; local display takes the action with the latest start); **switch parses only into a "pre-positioned class state"** (same actor, ending within a 0.5s window before the action's start counts; a command identical to the previously sent one is not re-executed — repeated drags don't re-switch class); **lyrics never participate in seek**; in gaps between actions, stay frozen, no replaying old actions. Events carry `actorId` (dancer index, global lyrics -1) — no longer assuming a single actor across the whole timeline.

**Problem 3 (AUD2-005)**: single game commands had no byte/format cap — the HTTP layer only capped the whole request at 4MB; 3MB of text into game chat would hang the game process (FIX-1 fixed only C#-side bounds and leaks; the game itself cannot survive overlong input).

**Fix**: new pure-function file `ChatCommandPolicy.cs` (no Dalamud dependency): non-empty, must start with `/`, UTF-8 bytes ≤1000, no control characters (NUL/CR/LF/TAB etc.), no semicolon chaining. All six entry points wired: `/preview`, `/playback/start` (per-item validation, 400 says which item and why), `/playback/timeline`, `/playback/freeze`, recording `/export/clip`, and the final gate `GameCommandExecutor.ExecuteCommand` (freezer/recording triggers/seek pre-positioned switches all pass through it). Logs record only the first 60 characters of a command — no more printing arbitrary large input.

## 2. Code change list

### C# (2 new pure-function files + 5 changed files)

| File | Change |
|---|---|
| `src/ChatCommandPolicy.cs` | **New.** Command safety-boundary pure policy (1000 UTF-8 byte cap etc.) |
| `src/SeekPlan.cs` | **New.** SeekEvent/ActorSeekPlan/SeekPlanResult + SeekPlanner.Plan pure functions |
| `src/PlaybackManager.cs` | PlaybackClip gains ActorId; SetTimeline takes revision; Seek(time, revision) returns bool (mismatch false → 409); SeekLocked rewritten on SeekPlanner (lyrics excluded / switch pre-positioned and deduped / gaps stay frozen); removed write-only `_lastSeekClipId`, replaced with `_lastSeekSwitchCmd` dedup |
| `src/HttpServer.cs` | New endpoint `POST /playback/timeline` (added to whitelist/routing/capabilities list, **empty array allowed = clears the plugin timeline**); clip parsing extracted into `ParsePlaybackClips` (actorId + per-item ChatCommandPolicy validation); seek parses revision, mismatch → 409; freeze/preview command validation |
| `src/GameCommandExecutor.cs` | ExecuteCommand gains the policy gate (dangerous input dropped + truncated log); all logs to 60-char summaries |
| `src/Exporter/ExportServer.cs` | /export/clip recording commands pass the policy; failing ones → 400 |

### Web (3 files changed, four deployment locations synced)

| File | Change |
|---|---|
| `web/choreo-edit.js` | buildGameClips output gains `actorId` (dancer index / global lyrics -1) |
| `web/choreo-helper-app.html` | `store._tlRevision` revision + `bumpTimelineRev()` (hooked at saveHistory/undo/redo/applyProjectContent) + `pushGameTimeline()` (immediate push on entering game mode, debounced 300ms push on edit); sendSeek carries revision, 409 auto re-push + one retry; gameStartPlay carries revision |
| `web/mode-check.html` | Group ④ upgraded: in-page mock plugin (wrapping iframe fetch) records timeline/seek request bodies, asserts snapshot carries clips+revision, seek carries time+revision, simulates 409 then auto re-push retry; new `installReqLog/waitFor` helpers |

## 3. Verification (all actually run)

- **datalayertest 71→100/100**: 29 new (ChatCommandPolicy 14: normal / Chinese lyrics / empty / no slash / LF / CRLF / NUL / TAB / U+0001 / semicolon / exactly 1000 bytes / over by 1 byte / overlong; SeekPlanner 15: single action / lyrics alone / lyrics don't crowd out action / switch alone / pre-position recognized / distant switch not pre-positioned / no cross-actor mixing / two actors no overwrite + tie takes larger actorId / staggered takes latest / blank gap / short-action 0.5s window / ±0.05s boundary / idempotent). csproj hooks the two new files (Link compile, same as existing convention).
- **Node five suites all green**: test-edit **85→87** (two actorId assertions), test-check 73, test-projects 77, test-engine 40, test-library 47.
- **clip-check 108/108**, **offline-verify 27/27** (incl. the upgraded mode-check PASS), **library-verify all 103/103** (real-plugin online path).
- **Debug + Release builds 0 errors** (6 pre-existing warnings unchanged); devPlugins DLL auto-updated with the build and **hot reload effective**.
- **Live curl smoke, six items all passed (2026-08-30, game online, new DLL hot-reloaded)**:
  1. GET `/playback/timeline` → 404 (consistent with existing POST-only endpoint convention)
  2. Legacy revision-less seek → 200 (transitional compatibility)
  3. Push empty snapshot `{"clips":[],"revision":42}` → `{"status":"ok","clipCount":0,"revision":42}`
  4. Seek with revision=99 (≠42) → **409**
  5. Seek with revision=42 (=42) → 200
  6. start with `command:"bow motion"` (no slash) → 400 「第 1 条（bad）命令不合格：命令必须以 / 开头」 ("item 1 (bad) command rejected: command must start with /")

## 4. Intentional deviations and boundaries

- **Protocol version stays 1**: pure additions (new endpoint / new optional field); old web pages tolerate the 404 silently, old plugins ignore new fields — bidirectionally compatible, no bump needed.
- **/playback/timeline allows an empty array**: the work package didn't state it, but the web must be able to clear the plugin timeline after deleting all clips, otherwise seek would 409 forever; `/playback/start` still requires non-empty (an empty timeline can't play).
- **No auto snapshot push while playing** (isPlaying skips; force pushes): during playback the plugin timeline is owned by start's payload; pushing a snapshot would interrupt already-executed progress markers.
- **switch pre-position dedup convention**: only compares "commands already sent in the previous seek" — dragging to another action and back re-executes the correct class switch (the class genuinely changed in between).
- **Live acceptance 5 items (per work package) — completed (2026-08-30 same day, owner explicitly authorized AI direct testing, `scripts\realtest-fixb.js` 24 items)**: ① drag without playing = freeze 2.0s, LocalTime exact and held; ② edit then drag = new-revision snapshot pushed, old-revision seek 409, new-revision 200; ③ lyric semantics = dragging back and forth 5 times across the lyric coverage point → zero lyrics in chat (SeekPlan proven on real machine); during playback /y lyric lines appearing in chat = original v0.5 semantics, plain-text lyric lines still 400; ④ gap seek reverts to freeze, previewMode=false; ⑤ playback regression = status/log Executed confirmed. Timeline cleared after game restart → seek 409 is also correct behavior.
- **Regression caught and fixed on the real machine, introduced by this package (HttpServer.ParsePlaybackClips)**: the web's "lyric search import" (importLyrics) generates global lyric lines with an empty command, which the AUD2-005 per-item validation rejected 400 as "empty command" — **projects with imported lyrics were entirely 400-blocked from game-mode playback** (the mock doesn't implement the command policy, so automation missed it). Fix: type=lyric with an empty command is allowed through (ExecuteClip already skips empty commands); non-empty commands still all pass the policy gate. Debug/Release rebuilt 0 errors; regression assertions added to `scripts\realtest-fixb.js` (imported lyrics playable + plain text still 400).
- The in-page mock's 409 simulation sends no real network requests and never touches game characters.

## 5. Next steps

- Next work package **FIX-C (AUD2-006/007, record-to-staging-then-QC + float long-run timing precision)**: `docs/AUDIT-20260830-code-repair/03-FIX-C-RECORDING-INTEGRITY.md`.
- Owner live acceptance checklist in section 4; the stance-class round and cancel-resume leftovers can fold into FIX-C/FIX-E live acceptance.
