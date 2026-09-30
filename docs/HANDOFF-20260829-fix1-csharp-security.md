# ChoreoHelper FIX-1 Handoff: C# Security & Process Stability (2026-08-29)

> What this file is: complete build & verification record of audit workpackage **FIX-1** (section 9 of `docs\HANDOFF-20260829-code-audit-fix-optimization.md`). Scope = AUD-001 / AUD-003 / AUD-011 / AUD-012, version bumped to **0.7.1**.

## 1. Summary First

All four audit issues fixed and verified: 10 new boundary unit tests added, full regression matrix green (Node 202 + library 103 + offline 21 + data layer 26 = **352 passing**), Debug/Release builds **0 errors** (6 pre-existing warnings unchanged), curl smoke all pass after hot-reloading 0.7.1 in game.

⚠️ **One smoke-test incident (recorded honestly)**: while verifying AUD-001 I sent a "long text command" of 3,000,000 bytes (audit only required >70 bytes); the game's own chat processing froze (Dalamud log `[HITCH] Long FrameworkUpdate 52842ms`, process 100% CPU unresponsive). **The plugin side worked correctly per the new code** (heap path, no leaks, no exceptions), but the game process itself locked up and was force-killed at 16:07; owner's next normal game start auto-loads 0.7.1. The incident incidentally proved the audit concern that a super-long command can hang the game process.

## 2. Fix Details Per Item

### AUD-001 Long-command out-of-bounds read + unmanaged memory leak (src\GameCommandExecutor.cs)

- Verification logging no longer reads from the unmanaged inlineBuffer (when long commands take the heap path that memory was never written): unified decode from managed `bytes` via new helper `ChatCommandBuffer.FromUtf8WithNull`.
- The `mem`/`strBuf` unmanaged blocks moved into `try/finally` — released on normal/exception/call-failure paths alike; call ABI (inline 0x40 threshold, heap struct field layout) preserved byte-for-byte.
- New file `src\ChatCommandBuffer.cs` (zero Dalamud/game dependencies): byte-length decision `UsesHeap`, encode/decode `ToUtf8WithNull`/`FromUtf8WithNull`; compiled by both the main project and datalayertest (via csproj `Compile Include` whitelist), boundary decisions pinned in unit tests.

### AUD-003 WalkReset frame timing + Dispose not releasing keys (src\Exporter\RecorderService.cs)

- Timing changed from "frame countdown (default 75 frames)" to an `Environment.TickCount64` monotonic deadline: `WalkReset(int holdMs = 1200)` — identical hold duration at any frame rate (audit's 30/60/144fps scenario).
- Every new WalkReset first idempotently calls `ReleaseWalkKeys()` (repeated calls don't stack); injection wrapped in try/catch with fallback key release; `OnFrameworkUpdate` releases on "time up OR lost foreground"; **`Dispose()` now also calls `ReleaseWalkKeys()`** (hot reload/unload no longer leaves the W key stuck).
- Foreground protection kept (inject only when game window is foreground); sole caller ExportServer.cs:406 updated to `WalkReset(1200)`.

### AUD-011 chunked bypasses body limit (src\LocalApiSecurity.cs + src\HttpServer.cs)

- `ReadBodyLimited` rewritten: loop-read to EOF (never trust a single Read — network streams return early with few chars, causing truncation); counted in UTF-8 bytes (char counting underestimates multibyte Chinese); declared-length and chunked bodies now take one unified path.
- All POSTs on HttpServer (48794) go through the new `ReadPostBody` helper: over-limit 413, body-read failure 400; removed the old "check ContentLength64 only" check (chunked = -1 passed straight through) and 6 bare `ReadToEnd()` calls (/bonerec/start, /settings/engine, /preview, /playback/start, /playback/seek, /playback/freeze).
- JSON parsing unified into `ParseBodyJson` (failure 400); `/playback/start` adds a clips array cap of 2000, clips must be an array, each entry must contain id/start/duration (missing fields → 400 with Chinese message).
- The two existing `ReadBodyLimited` calls on 48795 ExportServer get the hardening automatically, no changes needed.

### AUD-012 Business failures still returned HTTP 200 (three C# spots + one web spot)

- `/playback/start`: `_playback==null` → **503**; bad JSON/missing fields/over 2000 clips → **400**; empty clips → **400** `{"error":"empty timeline","message":"时间轴为空：没有可播放的动作条"}`; start failure → **409**; unexpected exception → **500**.
- `PlaybackManager.Play()` now returns `bool` (false on empty timeline); no longer silently returns yet still reports `status=playing`.
- `/playback/seek`, `/playback/freeze`, `/playback/stop`: missing dependency 503, bad JSON 400; `/preview`: missing dependency 503, bad JSON/missing command 400; `/bonerec/start`, `/settings/engine`: bad JSON 400.
- Web `choreo-helper-app.html` `gameStartPlay`: `then(d)` checks `d.error` and `d.status==='playing'` — enters playing state only on confirmed playing; on failure toasts 「游戏没动：<插件中文原因>」, playhead stays put, connection state is not falsely marked disconnected (403 pairing-guidance logic stays unchanged in the frontend catch).

### Version & Deployment

- plugin.json + csproj bumped together to **0.7.1 / 0.7.1.0** (packaging script's version-consistency assertion stays valid).
- Web change (choreo-helper-app.html, final md5 `0a79dbbd…`) synced to all three deploy locations (web\dist / devPlugins / game dir), md5 verified identical; DLL landed in devPlugins automatically via Debug build (0.7.1.0).

## 3. Verification Record (all actually executed)

| Check | Result |
|---|---|
| datalayertest (DOTNET_ROLL_FORWARD=Major) | **26/26** (16 old + 10 new: 63/64/70/71 bytes, Chinese counted by bytes, mixed commands, empty string, lossless encode roundtrip, terminator) |
| test-check / test-edit / test-projects / test-engine | 47/47 · 50/50 · 70/70 · 35/35 |
| library-verify all (game offline, mock mode) | **103/103** (first run: 1 handshake timeout in rec scenario — known sporadic; re-run all pass) |
| offline-verify | **21/21** |
| Debug / Release builds | both 0 errors, 6 pre-existing warnings |
| git diff --check | pass |

### In-game curl smoke (game online, after hot-reloading 0.7.1)

- OPTIONS /export/walkreset → **204** (preflight zero-side-effect regression); GET /export/walkreset → **405** (method whitelist regression)
- POST without pairing code → 403 (pairing regression; existing semantics not truncated)
- /playback/start empty body / bad JSON / seek bad JSON → **400** + Chinese message
- /playback/start `{"clips":[]}` → **400** 「时间轴为空：没有可播放的动作条」
- chunked 5MB → **413** (pre-fix it bypassed the limit into unbounded reads); Content-Length 5MB → **413**; small chunked request → 200 normal (chunked function not broken)
- 3M-byte long command executed via the new heap path: log `len=3000003 heap=true`, Post-call normal, **0 ExecuteNow failed, no crash** (AUD-001 fix itself works; but that super-long command froze the game's chat processing — see the Section 1 incident)
- WalkReset: foreground protection normal (game not in foreground → position nudge only, no key injection), logs normal

### On-machine re-verification (2026-08-29 16:28, all done after owner restarted the game)

1. **Short-command playback**: web-built single-timeline /bow motion → `Executed at 0s: /bow motion`, `Pre-call: cmd='/bow motion' len=11 heap=false verify='/bow motion'`, Direct delegate call OK — short-command inline path + playback execution chain fully working.
2. **/export/skeleton restored**: after game restart returns normal JSON with 101 bones (the "no player" side effect during the freeze resolved).
3. **Web empty-timeline failure toast** (`scripts\fix1-web-verify.js`, headless Chrome on the real homepage, game online): empty project, switch to game mode, click play → `isPlaying=false`, stays out of playing state + toast 「**游戏没动：时间轴为空：没有可播放的动作条**」 (server Chinese reason shown verbatim).
4. **WalkReset keyboard timing**: during smoke the game wasn't foreground, foreground protection behaved correctly (position nudge only, honest logs); the real 1.2s keyboard injection + auto-release is left for the owner's pose-category recording to verify naturally (merged with the phase-4 acceptance tail).

### Supplementary fix (web-side gap caught during on-machine verification; closes AUD-012)

First headless round found: `apiFetch` throws directly on non-2xx, so 400 fell into gameStartPlay's old catch → misleading 「插件未连接或启动异常」 **and falsely marked the connection disconnected** — exactly the behavior the audit named; the web's old catch masked it once the C# side was fixed. Fixed:

- `apiFetch`: on non-2xx, reads the response body and attaches `e.status` (status code) and `e.detail` (plugin's Chinese message) to the error object before rethrowing.
- `gameStartPlay` catch: 403 → pairing guidance (unchanged); `e.status` present → toast 「游戏没动：+插件给的中文原因」， **connection state untouched**; genuine network failures still take the original "plugin not connected" branch.
- After the fix `scripts\fix1-web-verify.js` → **FIX1-WEB-PASS**; full regression re-run all green (library 103/103, offline 21/21, Node 202, diagnostics page PASS).
- Web synced to all three deploy locations, final md5 `0a79dbbd…`.

## 4. Current State & Next Steps

- Owner restarted the game with 0.7.1 loaded; the Section 3 on-machine re-verification is complete (remaining: WalkReset real keyboard timing, merged with pose-category recording acceptance).
- staging still holds 0.6.7 artifacts, untouched; before release, as before: Release rebuild + re-run make-release-staging.js.
- `scripts\fix1-web-verify.js` kept as a repeatable web failure-toast regression (needs game online to run).
- Next workpackage: **FIX-2 (web input & local data integrity: AUD-002/004/005/006/015)**, in audit-handoff order, still not entering WP-5.
- Not committed, pushed, or published without authorization.
