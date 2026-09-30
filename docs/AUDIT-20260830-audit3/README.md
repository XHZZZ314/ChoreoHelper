# Third full-project code audit (2026-08-30)

> **给主人的中文摘要（详细内容为英文，供后续 AI 会话使用）**
>
> 这次把整个项目代码从头到尾重新审了一遍（C# 插件全部源文件、网页全部 JS/HTML、打包与验收脚本），
> 并先核对了 CONTINUITY/SPEC 的记载与代码是否一致——**全部对得上，没有冲突**：版本号 0.7.1、
> 五套网页测试（40/87/73/96/71）、C# 数据层测试 130、Release 构建 0 警告 0 错误、三个部署位
> 递归零差异、替身模型字节一致、之前 FIX-A~E/OPT-F/RELEASE-G 声称的修复在代码里都在。
>
> 审核结论：**没有致命（P0/P1）问题**；发现 **5 个较重要（P2）**、约 14 个中等（P3）、
> 一批小问题（P4）。最值得修的五个：
> 1. 窄屏模式下侧栏会被收起且遮罩卡住（主页一处代码缩进错位）；
> 2. 时间轴刻度/播放头与动作条整体错位 12 像素（正常模式约 0.2 秒偏差）；
> 3. 一种选择状态下按 Delete 键会静默无效；
> 4. 3D 面板在模型加载中途切换角色档案会卡在"初始化失败"；
> 5. 资料库初始化若遇到一次瞬时 IndexedDB 故障，整个会话的资料库功能都被污染（刷新页面才恢复）。
>
> 另有两个打包隐私扫描的结构性盲区（当前包实测干净，但建议下次打包前修）。
> 本轮**只审核不改代码**；要修哪些、按什么顺序，等主人拍板后再开修复包。

## 1. Scope and method

- Date: 2026-08-30. Auditor: AI code-lead session. Read-only; no code changed.
- Every C# source file under `src/` and `src/Exporter/` read in full (6646 lines).
- Web core files (`choreo-edit.js`, `choreo-check.js`, `choreo-projects.js`, `choreo-engine.js`, `choreo-library.js`, `preview3d.js`, `choreo-helper-app.html`) audited via four parallel read-only sub-audits; **every P2/P3 finding below was re-verified line-by-line in the actual source by the lead before inclusion** (sampling of P4s likewise spot-checked; all spot checks passed).
- `scripts/` audited with priority on `make-release-staging.js` privacy mechanics.
- Baselines re-run locally (see §2).

## 2. Documentation ↔ code consistency check (task prerequisite)

**Result: zero conflicts. Code and docs agree.** Verified:

| Claim (CONTINUITY/SPEC) | Verified how |
|---|---|
| Version 0.7.1 in plugin.json + csproj | grep both files |
| `NoWarn` fully removed from csproj | grep (absent) |
| Node suites 40/87/73/96/71 pass | re-ran all five (`test-engine/edit/check/projects/library`) |
| datalayertest 130/130 | rebuilt + ran (`DOTNET_ROLL_FORWARD=Major`) |
| Release build 0 err / 0 warn | re-ran `dotnet build -c Release` |
| Three deploy roots recursive-diff zero | `diff -r` web\dist vs devPlugins vs game dir |
| preview3d=`afbf37e5`, choreo-projects=`bb29d194`, app html=`9c441d9a` | md5 across roots (RELEASE-G's corrected values are the live truth) |
| FIX-A..E, OPT-F, RELEASE-G feature markers | ClipPathPolicy call sites (5), ChatCommandPolicy wiring (6), `clip-commit` capability, GameThreadJson 503, two-phase commit + pending purge, IDB v2 profileClips/CHLB v2, InFlightTracker both servers, txDone/tombstones, `_modelCache`/DPR cap 2/visibilitychange — all present |
| Staging 0.7.1: stand-in only | staging `model.gltf` md5 == `web/model-standin.gltf`; no `model.bin`; no diagnostic pages in package |

Severity scale: P1 critical → P4 nit. **No P0/P1 found.**

## 3. Findings — C# plugin

### P3

- **AUD3-C1 — HEAD requests bypass the FIX-E game-thread dispatch** (`src/HttpServer.cs:278-292` vs `295-324`). The framework-thread branches for `/debug/animstate`, `/debug/poke`, `/dancers` are gated on `method == "GET"`; a **HEAD** request falls into the `switch` arms (`:305`, `:308`, `:318`) which execute the same game-object reads **on the HTTP listener thread**, violating the documented FIX-E ownership contract. `/debug/poke`'s pairing gate (`:255`) does cover HEAD, so no unauthorized action; the risk is off-thread memory access (crash potential) triggerable by any allowed-origin page (incl. `Origin: null` = any local file). *Fix: treat HEAD like GET in those three branch conditions (or remove the arms from the switch).*
- **AUD3-C2 — `/export/skeleton` dispatch has no timeout** (`src/Exporter/ExportServer.cs:675-683`). 48794's `GameThreadJson` caps framework dispatch at 5 s (503 on timeout); the skeleton endpoint awaits `RunOnFrameworkThread` forever — a stalled game thread (zone load, cutscene) parks handler threads indefinitely; Dispose drain then logs a timeout and continues. *Fix: `.WaitAsync(TimeSpan.FromSeconds(5))` + 503 like HttpServer.*
- **AUD3-C3 — 48795 never recovers from port loss** (`src/Exporter/ExportServer.cs:58-74`). HttpServer has a bounded retry loop for the dual-client http.sys steal; ExportServer logs one error and gives up permanently — after the second client closes, 48794 comes back via retry but 48795 stays dead until plugin reload (web sees half-alive plugin). *Fix: same BindLoop pattern.*
- **AUD3-C4 — recording completion callback does heavy CPU+IO on the game thread** (`src/Exporter/ExportServer.cs:281-314` callback, `554-637` BatchLoop callback; invoked from `RecorderService.Finish` on the framework thread). The callback runs `AnimWriter.ToJson` (~4–5 MB JSON for a real clip) plus `File.WriteAllText` of the pending stage (and in batch: `ClipQuality` scan + file write) — all on the game framework thread → a one-off frame hitch at every clip end. Contradicts the FIX-E doctrine ("only immutable strings cross the thread boundary"). Accepted during 264-clip batch history, but worth fixing next time recording code is touched. *Fix: callback captures the result object; the awaiting HTTP/batch thread does serialize+write.*

### P4 / observations

- **AUD3-C5** — dead handler `/bonerec/list` (`HttpServer.cs:223`): not in `PostEndpoints`, so POST 404s before reaching it.
- **AUD3-C6** — `GameCommandExecutor.ExecuteNow` computes `verifyStr` (`:214`) and never uses it (dead verification left from the FIX-1 rewrite).
- **AUD3-C7** — NetEase lyrics: `songId` interpolated unencoded into the request URL (`HttpServer.cs:542`; only same-host param injection — harden with `Uri.EscapeDataString`); `GetGameVersion()` returns `DataManager.Language` under the name `gameVersion` (`:1008`, cosmetic mislabel).
- **AUD3-C8** — `AnimationPoseFreezer.BreakStanceLock()` (`:2105`) has no callers (RELEASE-G removed dead fields, this dead method survived).
- **AUD3-C9** — `RecorderService.Record` init race (`:77-83`): `_recording = true` is set before `_startedAt`/`_lastSampleAt` are refreshed; a framework tick landing in that window can see a stale `_startedAt` (>20 s old from the previous clip) and call `Finish("timeout")` immediately → the new recording aborts and the HTTP side waits out the 30 s timeout. Microsecond window; fix by writing all state before flipping `_recording`.
- **AUD3-C10** — `SkeletonHelper.BuildSkeletonJson` appends bone names into JSON without escaping (`:42`); FF14 bone names are ASCII identifiers, so cosmetic only.
- **Dead-by-design, cleanup condition now met**: `BoneAnimator` is never constructed in the current product (`Plugin.cs` doesn't create it; `Freezer.BoneAnim` is always null; `/bonerec/*` endpoints all fall through to fallback JSON), and `PackWriter` has zero call sites. Both are retained per the documented "remove after new-mode regression" decision — that regression completed 2026-08-30, so removal is now unblocked (owner decision, would also drop the unused hook surface).
- Fragility note: `HandleClipSync`'s `if (_batchRunning) return …` (`ExportServer.cs:227-228`) sits between `RecGate.Wait(0)` and the try/finally — currently unreachable (the gate is held whenever the flag is true) but any future change that sets `_batchRunning` without holding the gate turns it into a permanent busy deadlock. Worth a comment or restructure when next touched.

## 4. Findings — web app (`choreo-helper-app.html`)

### P2 (all verified in source)

- **AUD3-W1 — `_applySideOpen()` trapped inside the wrong block** (`:1686-1688`). The call sits inside `if(macroCaretRestore){…}`; every non-macro `render()` (add clip, play, snap toggle…) rebuilds `#root` without re-applying the sidebar `open` class. In `body.narrow` with the sidebar open: palette slides away, `_sideOpen` stays true, `#sbBackdrop` stays stuck until clicked, next ☰ toggle closes instead of opens. *Fix: move `_applySideOpen()` to the end of `render()`.*
- **AUD3-W2 — `LABEL_W=100` disagrees with actual lane-label width** (`:351` vs CSS `:287` width:112px normal / `:318` 64px narrow; `*{box-sizing:border-box}` `:21`). Ruler, playhead, A–B band, marker flags, snap guide, click→time mapping, zoom anchor and scroll-to all use `LABEL_W`; clip bodies sit after the real label width. Constant 12 px offset in normal mode (≈0.2 s at 60 px/s — clicking exactly on a clip's visual start seeks 0.2 s past it), 36 px the other way in narrow mode. *Fix: single source of truth (measure the label or sync the constant).*
- **AUD3-W3 — Delete key silently no-ops in a reachable selection state** (`:696-703` + `:2229-2232`). Ctrl+click A, Ctrl+click B, Ctrl+click B again → A still has `selected=true` but `store.selectedClip=null`; Delete passes `edHasSel()` yet `deleteSelectedClips` early-returns. *Fix: in the `<=1` branch fall back to `sel[0].clip`.*

### P3

- **AUD3-W4 — check modal fetches `/export/skeleton` on the wrong port** (`:2923` via `apiFetch` → `API='http://localhost:48794'` `:349`; endpoint exists only on 48795). The 404 is swallowed (`:2925`), `onlineHash` stays null and the "动作是在别的角色外形下录的" mismatch rule can never fire. *Fix: raw-fetch `http://localhost:48795/export/skeleton`.*
- **AUD3-W5 — macro 600 ms sync timer can cross-write dancers** (`:2517-2526`): timer reads the *current* tab at fire time; typing in dancer 1 then switching to dancer 2 within 600 ms overwrites dancer 2's tracks with dancer 1's parsed macro. *Fix: capture `di` at input time, abort on tab change.*
- **AUD3-W6 — `sendSeek` 409-retry can end at a stale position** (`:626-630`): a newer seek issued during the re-push is overtaken by the retried older `t` via `_seekPending` ordering. Narrow window, game mode only.
- **AUD3-W7 — realtime check can full-`render()` mid-drag** (`:1689-1691` → `:2784-2788` → `:2832-2835`): visible flicker/re-created clip under cursor on long drags. *Fix: defer while dragging.*
- **AUD3-W8 — `refreshMeasured` duration corrections don't `bumpTimelineRev()`** (`:1016-1019`): plugin snapshot keeps stale durations in game mode until the next edit. 
- **AUD3-W9 — main-timeline empty-area click never seeks the game** (`:1924-1934`), inconsistent with ruler/marker/check-modal jump (all do `sendSeek`). Confirm intent; if intentional, document.

### P4 batch

Dead code (`startRecPoll` `:521-537`, `addGlobalLyric` `:1165-1170`, unused `prefix` `:2128`, stray `st` rounding `:1159`); `choreo_gpose` written never read (`:3145`); duplicate Delete keydown (`:3656` vs `:1072-1081`); resize-left snap after the 0.5 s clamp can yield <0.5 s durations (`:2324-2326`); `snapTime` grid stops at 300 s while timelines can be longer (`:398`); `console.log` of game payload (`:1428/1434/1442`); manual-version toast shows success when `addVersion` resolved `false`; `updatePlayOverlay` lists muted dancers + per-frame innerHTML; seek throttle is 50 ms (`:2042`) while a comment claims 150 ms (`:611`) — doc/claim mismatch only (in-flight coalescing still bounds it).

## 5. Findings — library + 3D preview

### P2 (verified in source)

- **AUD3-W11 — profile switch during in-flight init wedges the panel** (`web/preview3d.js:99-104` → `hardReset` `:423-441` nulls engine/skeleton/profile but not `initing`; `init` `:212` no-ops while `initing`). The in-flight init resumes against nulled state → "初始化失败"; recovery only via manual refresh or the 10 s probe — and the probe needs 48795, so a pure offline file:// session stays broken until manual click. Trigger: switch profile while a large model is loading. *Fix: generation token — `hardReset()` bumps it; `init()` bails after each `await` if stale (or disable the profile UI while initing).*
- **AUD3-W12 — cached migration promise never resets on failure** (`web/choreo-library.js:207-208`, `:225`, `:265`). One transient IndexedDB failure (e.g. QuotaExceeded during the profile migration's brief 2× disk window) rejects `_profEnsured`/`_clipsMigrated` permanently for the session: every later library call re-awaits the same rejection (getClip silently null; putClip/sync/stats reject) until page reload. *Fix: `.catch` resets the caches so the next call retries (migrations are idempotent).*

### P3

- **AUD3-W13 — self-produced CHLB v2 backups can be unimportable** (`choreo-library.js:875` vs `:239`). Profiles migrated from legacy data with no stored skeleton hash get `skeletonHash:''`; `preflightV2` then fails `!h || h !== bp.skeletonHash` with the misleading "备份可能被篡改" — the program's own export round-trip is broken for those profiles. *Fix: back-fill `hashObject(skeleton)` during migration and/or treat empty hash as skip-compare.*
- **AUD3-W14 — v2 preflight doesn't validate the catalog segment** (`:867-920` vs write chain `:1020-1029`): a corrupt catalog JSON passes preflight, writes proceed, then the parse throws inside the first clip segment's catch — recorded as that clip's failure with a raw SyntaxError. Weakens "bad bundle = zero writes" (no corruption; partial import + misleading report). *Fix: parse+shape-check the catalog in preflight; give the catalog segment its own catch label.*

### P4 batch

Panel close leaves rAF armed (`preview3d.js:147-158` + `:1104-1107`; only visibilitychange-hidden clears `_rafOn`); stale negative `modelNote` after a later candidate succeeds; `syncLibrary` try/finally without catch (hardReset mid-sync → unhandled rejection); dead `_profListCache` (`choreo-library.js:209`); raw English SyntaxError surfaces for corrupt header/catalog; failed legacy-key cleanup permanently doubles model storage; `putOne` resolves on request success not transaction commit; sync progress uses loop index not completed count; hardcoded head-bone index 46 in diagnostics.

## 6. Findings — engine / edit / check / projects

### P3

- **AUD3-W16 — `scrubTo` doesn't realign `timelineIdx`** (`web/choreo-engine.js:272` setter realigns; `:350-353` scrubTo doesn't; `:312` replay loop). Mixing `scrubTo(t)` with `play()`+`update()` replays every entry between the stale index and t (clips restart from 0, spurious onEvent). **Production-safe today** — preview3d never uses the playing path — but it is a trap for any future consumer. *Fix: set `timelineIdx = firstAtOrAfter(_timeline, time)` at the end of scrubTo.*

### P4 batch

`serializeSelection` quantizes relative offsets to 0.1 s while `planActionPlacement` legitimately produces 0.05-grid starts (up to 0.05 s drift per copy, can newly trip the macro-drift info rule); `pasteItems` doesn't re-sort and collapses on `t<0`; `planActionPlacement` 60-iteration guard gives up silently; legacy two-step delete fallback non-atomic (test-injection only); `openProject` doesn't repair a stale active pointer; `savedAt` monotonicity is per-page-load; mid-keyframe slerp output not renormalized (harmless magnitude); `normalizeContent` `!!` coercion; `check(null)` throws (all call sites pass objects).

Verified clean: tombstone design (re-create/evict/revive scenarios all safe), 20-version cap never drops live content, `txDone`/`putManyAtomic` handler attachment races, macro semantics shared with no drift between check/edit/generateMacro, engine sample() purity and seam-blend math, `__idle__`/padding (they live in preview3d, not the engine — docs' phrasing was loose, not wrong).

## 7. Findings — scripts

### P3

- **AUD3-S1 — privacy-scan structural gaps in `make-release-staging.js`** (current 0.7.1 package verified clean — these are future-proofing): ① content scan only covers text extensions (`:121-127`) — the **DLL is never content-scanned** (today's Release DLL embeds at most the `D:\choreohelper` PDB path; a build from a `C:\Users\…` checkout would silently ship the username); ② **README.txt is written after the scan** (`:116-132` vs `:166-167`) and itself contains `AppData`/`XIVLauncherCN` install instructions, proving final zip contents aren't covered; ③ FORBIDDEN/pattern matching is case-sensitive and misses forward-slash `C:/Users` forms; ④ `WEB_DIRS` copies whole `libs`/`libs-classic` dirs — a stray file dropped there ships unscanned. *Fix: scan after all writes, every file as binary (latin1), case-insensitive, explicit libs inventory, README string exemptions.*
- **AUD3-S2 — CDP `send()` has no timeout** in `offline-verify.js` / `library-verify.js` / `clipcheck-run.js`: a wedged DevTools socket hangs the harness forever (Ctrl+C cleanup still works). *Fix: 30 s race or scenario watchdog.*
- **AUD3-S3 — three scripts create temp Chrome profiles outside verify-cleanup** (`fix1-web-verify.js`, `profile-look-check.js`, `restore-bundle-check.js`; prefixes not in `verify-cleanup.js` `ALL_PREFIXES`, no register/sweep calls) — exactly the 424-dir residue class cleaned up on 2026-08-30. *Fix: add prefixes + integrate.*

### P4 batch

`make-offline-assets.js` fetch without timeout (packer stalls on a hung-but-listening 48795; the probe itself does use 3 s); `trim-loop-clips.js` `--min` parsed but unused + `--apply` not idempotent + in-place overwrite (dry-run default mitigates); `realrec-fixc.js` restores `bow.json` from a possibly-stale `%TEMP%` backup; hardcoded owner-private paths in dev scripts (`D:\Program Files\…最终幻想XIV…`, `C:\Users\xhz\Desktop`) — harmless locally, **scrub before any GitHub publication**; mock `listen` without error handler; mock static guard prefix check without separator; random CDP port collision window.

## 8. Recommended repair order (proposal, needs owner approval)

1. **FIX-H (web UX correctness, P2)**: AUD3-W1 + W2 + W3 + W4 (one afternoon; all app-html, deploy-sync 3 roots, extend clip-check assertions). **Closed 2026-08-30 — `docs/HANDOFF-20260830-fix-h-web-p2.md` (clip-check 119/119, offline-verify 38/38, ×4 roots synced at app html `91a61e7b`).**
2. **FIX-I (library/3D robustness, P2/P3)**: AUD3-W11 + W12 + W13 + W14 (preview3d generation token; library cache reset + hash back-fill + catalog preflight; extend test-library/test-projects).
3. **FIX-J (C# hardening, P3)**: AUD3-C1 + C2 + C3 (+C4 opportunistically when recording code is next touched).
4. **FIX-K (packaging privacy, P3)**: AUD3-S1 — must land before the *next* staging rebuild / any publication.
5. P4s and dead-code cleanup (incl. `/bonerec`+BoneAnimator removal decision, C# `NoWarn`-style sweep leftovers) batched into the above or a separate hygiene package.

Each package: minimal diff, tests before/after, deploy-root sync for web changes, CONTINUITY/handoff update at close.
