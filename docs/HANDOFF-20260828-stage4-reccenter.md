# Stage 4 Handoff: The Formal「录制 3D 动作库」Center (2026-08-28, late night)

> Continues `HANDOFF-20260828-stage3-locallibrary.md`. Stage 4 code is complete and passed all automated acceptance (rec scenario 25/25, full `all` 50/50, engine 35/35, offline-verify 21/21); **SPEC section 4's 7 items are unchecked, awaiting the owner's on-machine acceptance** (steps at the end). Zero C# changes throughout — plugin, ports and protocol untouched, no game restart needed.

## 1. What This Stage Did (Plain Language)

Moved the battle-proven orchestration for "batch-record 264 clips" (node script batch-record.js, 251/251 all successful) into the web as a formal product feature:

1. **Toolbar button「⏺ 录制 3D 动作库」(Record 3D Action Library)** replaces the long-dead「⚡ 录制全部」(it called `/bonerec/batch`, which — because `BoneAnimator` was never assigned — always returned empty at runtime).
2. The old「📷 拍照精确」button and the bottom-bar「引擎: 经典/增强」(engine: classic/enhanced) toggle moved into a new「⋯ 高级」(Advanced) popover (the plan doc's section 8 required moving them out of the normal UI; features unchanged — they just no longer occupy the normal toolbar).
3. **Recording window, four modes**:
   - ⚡ Quick common: 25 built-in performance-common clips (greet/cheer/dance/conductor) + clips referenced by the current draft
   - 🌐 Full: all 264 catalog clips except the expression class (honestly labeled "约 1 小时 50 分" ~1h50m; no longer "15 minutes")
   - 🩹 Backfill missing: whatever the local library lacks
   - ☑ Custom: full-catalog checkboxes (293 items; the 29 expression items are greyed out and disabled)
4. **Progress & resume**: current clip / completed / failed / ETA (rolling average of measured per-clip time) + progress bar; bottom bar `#recPos` mirrors it; the stop button = finish the current clip then stop; refresh/close never loses completed clips — reopening the page shows a toast + a window-top banner "上次录制未完成 → 继续录制/放弃剩余" (last recording unfinished → continue/abandon rest); session details persist in localStorage (`choreo_recSession`).
5. **Failure handling**: still data auto-retries once; still still → failed with its reason (amplitude value) and **not stored into the library**; the summary gives each failed item a「重录」(re-record) button (single in-place retry, keeps the whole list).
6. **Recorded clips auto-enter the browser library**: each QC-passed clip is `putClip`ed directly (the response is itself the clip JSON — no second fetch), and the 3D panel can use it immediately via `__p3dLibChanged()` — %AppData% never touched.

## 2. Orchestration Rules (Copied From batch-record.js Battle Values; Each Asserted in Mock Acceptance)

- Trigger uniformly uses the `"xxx motion"` variant; commands containing `/` are sent as-is (matching the script)
- Each clip: `POST 48795 /export/clip {command, save:true}` — synchronous blocking; return = recorded (plugin-side 30s cap)
- **save:true**: the plugin's clips directory keeps a raw backup (continues the 264-clip data model so the "刷新动作库" force path stays valid; re-recording the same name auto-overwrites bad files)
- Stillness QC: amplitude (max all-bone offset vs. first frame) < 0.3 = bad data → wait 3.5s, retry once → still still = failed; **expression class exempt** (`category==='expression'` — face-only movement is normal)
- Posture class, 11 items (sit/groundsit/doze/kneel/playdead/pose/lounge/grovel/winded/situps/savortea): after recording → `POST /export/walkreset` + wait 4.5s
- Persistent/loop class (duration ≥19s): after recording → `/beckon motion` via 48794 `/preview` to interrupt + wait 4s
- Normal items: 2.5s interval; **the last item doesn't idle-wait** (clips with after-effects still run reset/interrupt; only the idle wait is skipped)
- 3 consecutive network failures = game/plugin dropped → auto-pause (keeps the unfinished state), toast prompts returning to resume

## 3. Contamination Double Gate (the Full Loop for SPEC's "Still Data Must Not Count As Success")

- **At recording time**: web QC fail → no putClip.
- **At collection time**: `choreo-library.js`'s `syncFromPlugin` gains an optional `qcFn(name, clip)` callback; the homepage passes in amplitude QC + the expression exemption, so **autoSync and the manual「⬇ 从插件导入全部动作」import share the same gate** — still bad files sitting in the plugin's catalog (e.g. from a bad manual curl someday) can never enter the library; the report honestly lists "静止数据（幅度 x.xx），可在录制中心重录" (still data (amplitude x.xx), re-recordable in the recording center).
- Without qcFn, behavior is identical to Stage 3 (lib-check's 13 items regression passed).

## 4. Key Implementation Locations

- `web/choreo-helper-app.html`:
  - Toolbar (~line 1334): ⏺ button + ⋯ advanced button; `toggleAdvPop()` + global outside-click collapse listener
  - `renderBottomBar()`: engine toggle removed (comment archived)
  - Stage 4 code section (~line 2123, after `__libImportFromPlugin`): REC_POSTURE/REC_QUICK constants, recBaseName/recAmp (copied from the bug-fixed version)/recExprSet/recCatalogList (264 count: minus expressions + minus empty commands + dedupe by base name — reconciled item-by-item against the actually-shot full library)/recLibQc; the session engine (recRunLoop/recStart/manifest storage); `showRecModal`/`renderRecModalBody` (four states: in-progress / resume banner / summary+re-record / four-mode picker); `renderPickArea`; the `window.__recDebug()` hook
  - `autoSyncLibrary()`/`__libImportFromPlugin` pass qcFn; `init()` reads the manifest at start and pops the "上次没录完" (last recording unfinished) reminder
- `web/choreo-library.js`: `syncFromPlugin`'s `opts.qcFn` (comment updated)
- `scripts/library-verify.js`:
  - Mock additions: `OPTIONS→204` (preflight pass), `POST /export/clip` (canned clip; stillness/posture/persistent shapes chosen by name), `POST /export/walkreset`, `POST /preview` — all with call counters (`server.stats`)
  - Extracted `ensureMock()`/`attachRewrite(ch, game)` from main's inline wrappers for reuse (repeated wrapping guarded by `_rewritten`)
  - New scenario `scenarioRec` (25 assertions); dispatch table gains `rec`; `all` includes rec; stale usage comments at the file head fixed
  - Diagnostic-page origin choice now keyed on "plugin online or not" (`global.__pluginOnline`) — not misled by rec's earlier-started mock (Stage 3 convention preserved)
- `scripts/offline-verify.js`: the transition scenario's "catalog auto-upgrade" assertion changed from an immediate check to waitFor (the original had a 500ms race: gameConnected setting before catalogFromSnapshot is the product's inherent order, not a bug)

**Why no rec-check.html**: if the owner manually opened a recording diagnostic page while the game was online, it would actually control the character and record 5 clips — a pitfall not worth keeping. rec acceptance lives in the node scenario and is forced through the mock (`ensureMock` guarantees the mock even when the plugin is online; CDP transparently rewrites the page's 48795/48794 requests to 48797).

## 5. Acceptance Record (2026-08-28 late night, game online)

- `library-verify.js rec`: **25/25** (entry replacement / advanced popover / four mode counts 264·25·293·29 / all four orchestration categories / stillness retry / reset+interrupt invoked / library-entry correctness / bottom-bar progress / manifest / summary re-record / cancel preserves / reload banner / resume completes without re-recording finished clips / import QC interception / zero exceptions)
- `library-verify.js all`: **50/50** (auto 264 clips 108.1MB fully automatic + sync offline playback + uicheck + rec + the three diagnostic pages) — plugin online this time, so auto/sync/uicheck ran against the real plugin
- `web/test-engine.js`: 35/35
- `offline-verify.js all`: 21/21 (transition 3/3 after the race fix)
- **Online preflight (the single planned risk point)**: real plugin `OPTIONS /export/clip`→200 + full CORS headers, `OPTIONS /export/walkreset`→200, 48794 `OPTIONS /preview`→204 — the file:// page POST-to-48795 preflight chain tested working; **no C# change needed**
- Four deployment locations (web\ source, dist, devPlugins, game dir) md5 identical; zero C# changes, no game restart

## 6. Pitfalls (High Reuse Value)

1. **UI references must be null-checked (biggest pitfall this session)**: clicking「重录/继续录制」while the window shows the summary/banner (no progress-bar element), `recRunLoop`'s opening `recUpdateUI()` wrote to `_recUi.line.textContent` → TypeError → the async function died as an unhandled rejection → `_recRunning` stuck true forever (unhandled promise rejections never hit Runtime.exceptionThrown, so it looked like "zero exceptions"). Two-layer fix: `if(_recUi.line)` null-check in recUpdateUI + renderRecModalBody clears stale references when rebuilding the body + the whole record loop wrapped in try/catch (no exception may leave the session stuck in "running"). **Lesson: DOM references held by a long-lived engine must be invalidated and re-attached whenever the body is rebuilt.**
2. **The mock must allow OPTIONS preflight**: cross-origin JSON POST sends OPTIONS first; the mock returned 404 for unmatched paths → preflight failed → the real POST was never sent, and fetch's failure was swallowed by the orchestrator's catch — symptom: "the interrupt command mysteriously missing". Fix: mock-wide `OPTIONS→204` at the top (the real plugin's 48794 is explicitly 204 anyway, 48795 falls back to 200 — both pass).
3. **Diagnostic scripts: don't fetch all state in one complex expression** — piecemeal polling (running/finished/items, one evaluate each) is more stable than a nested JSON.stringify and easier to debug.
4. **Test assertions must follow the product's real ordering**: gameConnected (set on first /health success) naturally precedes catalogFromSnapshot (which waits for the emotes pull); "assert the upgrade finished immediately" was a race invented by the test itself — closed with waitFor.

## 7. Owner On-Machine Acceptance Steps (Passing Checks SPEC Section 4's 7 Items)

1. **One round of each of the three types**: open the game → desktop shortcut opens the page →「⏺ 录制 3D 动作库」→ ☑ Custom → check three: one normal (e.g. 挥手/wave), one posture (e.g. 打盹/doze), one persistent loop (e.g. 黄金之舞/golden dance) → record selected. Watch: progress/ETA moving; after the doze clip the character stands up on its own (reset); the golden dance records its full 20s and is interrupted by beckon.
2. **Cancel + resume**: start any 6~8-clip custom recording → record a few, click「停止」→ refresh the page → the "上次录制未完成" reminder/banner should appear → continue → all complete; finished clips were not re-recorded (no repeat performance on the timeline).
3. **Record-and-use**: record a clip not yet in the draft (e.g. 拍手/clap) → drag it straight onto the timeline → the 3D panel plays it — %AppData% never touched.
4. Also confirm:「📷 拍照精确」and the engine toggle live in「⋯ 高级」, and the bottom bar no longer has an engine button.

## 8. Next Tasks

1. Owner on-machine acceptance of Stage 4 (section 7 above) → check SPEC section 4
2. Stage 1 tail (optional): one game-mode real play/stop/drag → check SPEC sections 1 and 2
3. Stage 5: CORS/authorization tightening, legacy cleanup (delete BoneAnimator//bonerec, startRecPoll and other dead code), release staging, publishing
4. Release exclusion list unchanged (diagnostic pages/snapshots/libs-classic/real model stay out of the package; choreo-library.js must ship)

## 9. Explicitly Not Done (Boundaries)

- `BoneAnimator`/`/bonerec/*`/`startRecPoll` underlying code not deleted (only their call sites were removed; Stage 5 cleans up)
- CORS untouched (Stage 5), clip data format unchanged, no git commit, no publishing
- No loop-trimming automation (trim-loop-clips.js remains a standalone post-record tool; the owner's eyeball-verified loop judgments are not automated)
- In-web model file-picker import left for later (noted in SPEC)
