# HANDOFF 2026-08-30 — SEC-1 private local reads

> Status: implementation closed, live curl acceptance pending owner. Read-only work package; no commit/push/publish performed. `release/staging` untouched.

## Objective

`docs/AI-BACKLOG.md` package 1 (SEC-1, P1 release blocker): a literal `Origin: null` was trusted at the CORS layer, and **every GET on 48794/48795 was anonymous** — `/export/list`, `/export/getclip`, `/export/skeleton`, static `model.gltf`/`model.bin`, `/dancers`, status and debug endpoints. Live read-only probe (2026-08-30, plugin online) confirmed an unpaired `Origin: null` request enumerated all **264** personal clips, the personal skeleton (12,655 bytes) and `/dancers`; pairing protected POSTs only.

## Design

Authorization and transport are separated:

- CORS keeps `null` + local ports in the allowlist (the `file://` daily entry needs the preflight), but `null` now only ever reaches **anonymous** endpoints. All personal data requires the existing `X-Choreo-Token` pairing header — "never trust `null` alone" is enforced by authorization, not by origin parsing.
- No new read-session mechanism: the token the app already stores in `localStorage['choreo_pairToken']` is attached to private reads. Old-plugin compat is preserved because the header attach is gated on `capsOk` (capabilities handshake), exactly like POSTs were.

### Endpoint classification (pure policy, `src/ReadAuthPolicy.cs`)

| Server | Paired reads (GET/HEAD) | Still anonymous |
|---|---|---|
| 48794 | `/dancers`, `/playback/status`, `/gpose/state`, `/bonerec/status`, `/debug/animstate`, `/debug/diag`, `/debug/tlinfo`, `/debug/emotefamily`, `/debug/poke` (previously write-gated, now in the same table) | `/`, `/health`, `/version`, `/capabilities`, `/actions*`, `/classjobs`, `/lyrics*` |
| 48795 | all `/export/*` GETs; static `model.gltf`/`model.glb`/`model.bin` (matched on the **resolved file name**, `OrdinalIgnoreCase`, so `/./` and case tricks cannot bypass) | `/capabilities`, pages/JS/CSS/snapshots/`model-standin.gltf` (public content) |

Assumption (stated in the approved plan): 48794 status/debug reads are paired beyond the backlog-named `/dancers`, per the required result "keep only capabilities/health and deliberately public catalog metadata anonymous".

Side benefit: an unpaired GET/HEAD to a paired read is rejected on the listener thread before game-thread dispatch (partially covers PLUG-1 for `/dancers`).

## Changes

C# (Release build 0 errors / 0 warnings):

- `src/ReadAuthPolicy.cs` — **new** pure policy (no Dalamud/HttpListener deps), mirrors the `ClipPathPolicy` convention.
- `src/HttpServer.cs` — the `/debug/poke` special case in the shared GET/HEAD branch is replaced by a policy-driven pairing check (poke behavior unchanged).
- `src/Exporter/ExportServer.cs` — token check moved above the `/export/*` method dispatch so GET and POST share one gate; `ServeStatic` gates paired model files by resolved file name after `Path.GetFullPath` and the existence check (nonexistent → 404 as before).
- `src/LocalApiSecurity.cs` — `PublicSiteOrigin` const → static field (default `""`, behavior unchanged) so tests and the future site can set it.
- `src/tests/datalayertest/datalayertest.csproj` — whitelist adds `ReadAuthPolicy.cs` and `LocalApiSecurity.cs`.

Web (source and `web/dist/ChoreoHelper` twins byte-identical, then synced to both external deploy roots):

- `choreo-app.js` — `apiFetch` attaches token headers on GET/HEAD too (still `capsOk && pairToken` gated); `probeExport`, `autoSyncLibrary` attach headers; `savePairToken` re-probes the export connection immediately after the code changes (SEC-1 semantic: the indicator honestly shows "not connected" until paired, then updates within ~1 s instead of waiting for the 15 s watcher).
- `preview3d.js` — local `secHeaders()` helper (prefers the global `choreoTokenHeaders`, falls back to the same localStorage key for standalone diagnostic pages); applied to skeleton/list/getclip fetches, the model.glb/gltf fetch, `cacheModelToProfile`'s model.bin fetch, and `GLTFLoader.setRequestHeader` so a `.gltf`'s external `model.bin` sub-resource carries the token (module + libs-classic loaders both honor it).
- `choreo-library.js` — `syncFromPlugin` reads attach headers (`secHeaders` fallback same pattern).
- `choreo-check-ui.js` — the online-skeleton comparison fetch attaches headers; stale "GET 只读，无需配对头" comment fixed.
- `choreo-recording-ui.js` — `recStart`'s `/export/list` reachability probe attaches headers.
- `pose-viewer.html` — the FIX-A-deferred pairing entry: on 403 a small Chinese overlay asks for the `/choreo pair` code, normalizes it like the main app, stores it under the same `choreo_pairToken` key (own origin storage) and reloads; its four private fetches and the GLTFLoader carry the token.

Harness:

- `scripts/library-verify.js` — mock mirrors the paired-read rules (`/export/*` GET, `/gpose/state` GET+HEAD, static model files); plugin-online detection switched from `/export/list` to anonymous `/capabilities` (it would have misread 403 as "offline"); `pageTarget` seeds the pairing code into pages before scripts run via `Page.addScriptToEvaluateOnNewDocument` (seed only when the key is absent, so rec's `savePairToken('TESTCODE')` survives reloads; seed value is the real `pairing.json` code when the plugin is online — same local-only pattern as `realrec` — else `TESTCODE`); `scenarioSec` grew 20 → 31 assertions (private reads without/wrong/right token, HEAD not a bypass, static model case-insensitivity, stranger-origin rejection) and the old "只读 /export/list 无需配对码" assertion is inverted by this package's semantics. No other existing assertion was weakened.

## Verification (commands and observed counts)

- `dotnet run --project src\tests\datalayertest\datalayertest.csproj -c Release` (DOTNET_ROLL_FORWARD=Major): **180/180** (was 130; +50 SEC-1 policy/origin checks).
- `dotnet build src\ChoreoHelper.csproj -c Release --no-incremental`: **0 errors / 0 warnings**.
- Node suites: engine **40/40**, edit **87/87**, check **73/73**, projects **96/96**, library **71/71**, shell **33/33**.
- `node scripts\library-verify.js sec`: **31/31**; `... all`: **117/117** (was 106; one intermediate run had 2 rec failures caused by unsynced dist twins — resolved by syncing, see "Lessons" below).
- `node scripts\offline-verify.js all`: **38/38** (the previously documented load-sensitive transition flake did not reproduce this run).
- `node scripts\clipcheck-run.js` (game root) and `... web\dist\ChoreoHelper\clip-check.html`: **119/119 each**.
- Deploy roots: `web\dist\ChoreoHelper`, `%AppData%\XIVLauncherCN\devPlugins\ChoreoHelper\dist\ChoreoHelper`, `D:\Program Files\上海数龙科技有限公司\最终幻想XIV\game\dist\ChoreoHelper` — **32 files each, recursive byte-diff zero** (only the six product files above were copied; the plugin DLL was **not** deployed anywhere).
- `git diff --check` clean; no debug leftovers.

## Compatibility notes

- New web + old plugin: reads unchanged (headers ignored / anonymous allowed); capsOk gate means compat mode sends no header at all. Verified implicitly — this whole suite ran against the **old live DLL** with the new web files.
- New plugin + old web files: private reads would 403 (e.g. old pages can't list clips). This is why all three deploy roots were synced; do not mix versions.
- One-off audit scripts that read private endpoints anonymously (`realtest-fixb`, `realrec-fixc`, `qc-crosstest`, `batch-record` write path) were checked: none performs anonymous private GETs; no change needed. If future scripts do, they must send the token like `realrec` does.

## Owner acceptance tail (do with the game running, after loading the rebuilt DLL)

Load the DLL from `src/bin/x64/Release/net10.0-windows/` via your normal dev-plugin flow (this overwrites the live install — explicit owner action). Then run this read-only checklist (replace `<CODE>` with the code from `/choreo pair` or `pairing.json`; Git Bash syntax):

```bash
# --- must be rejected without a token (403) ---
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:48795/export/list
curl -s -o /dev/null -w "%{http_code}\n" -H "Origin: null" http://localhost:48795/export/list
curl -s -o /dev/null -w "%{http_code}\n" -H "Origin: null" http://localhost:48795/export/skeleton
curl -s -o /dev/null -w "%{http_code}\n" -H "Origin: null" "http://localhost:48795/export/getclip?name=anything"
curl -s -o /dev/null -w "%{http_code}\n" -H "Origin: null" http://localhost:48795/model.gltf
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:48794/dancers
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:48794/playback/status
curl -s -o /dev/null -w "%{http_code}\n" -H "Origin: null" http://localhost:48794/gpose/state
# --- wrong token must be rejected (403) ---
curl -s -o /dev/null -w "%{http_code}\n" -H "X-Choreo-Token: WRONG" -H "Origin: null" http://localhost:48795/export/list
# --- right token must work (200) ---
curl -s -o /dev/null -w "%{http_code}\n" -H "X-Choreo-Token: <CODE>" -H "Origin: null" http://localhost:48795/export/list
curl -s -o /dev/null -w "%{http_code}\n" -H "X-Choreo-Token: <CODE>" http://localhost:48794/dancers
curl -s -o /dev/null -w "%{http_code}\n" -I -H "X-Choreo-Token: <CODE>" http://localhost:48794/gpose/state   # HEAD paired
# --- consistent rejection: HEAD on 48795 private surface (405), no readable response either way ---
curl -s -o /dev/null -w "%{http_code}\n" -I http://localhost:48795/export/list
# --- anonymous discovery must keep working ---
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:48795/capabilities   # 200
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:48794/health         # 200
curl -s -o /dev/null -w "%{http_code}\n" -H "Origin: null" -X OPTIONS http://localhost:48795/export/list   # 204, zero side effects
curl -s -o /dev/null -w "%{http_code}\n" -H "Origin: https://evil.example" -X OPTIONS http://localhost:48795/export/list   # 403
```

Also smoke: main app opens `file://`, pairs once, 3D preview shows the real model; pose-viewer (served from 48795) shows the pairing overlay on first visit and works after pasting; the export indicator turns connected right after pasting the code.

## Lessons

- `library-verify` browser scenarios run the **`web/dist` twins**, not `web/` sources — edit source, sync the twin, then run. An intermediate 2-failure run here was exactly that ordering mistake.
- The harness seeding must be conditional (`if(!localStorage…`) or it stomps per-scenario codes across reloads (rec's TESTCODE).
