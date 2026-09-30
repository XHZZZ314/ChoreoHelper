# HANDOFF: v0.6.7 WP-1 Local API Security & Capability Handshake (2026-08-29)

> Previous handoff: `docs\HANDOFF-20260828-stage4-reccenter.md` (Stage 4 recording center, still pending owner in-game acceptance).
> This package = WP-1 of `docs\WORKPLAN-20260829.md`. **Game hot-reloaded 0.6.7; all in-game curl regressions passed**; owner smoke test remains (see section 8).

## 1. What This Package Did (one-liner)

The plugin's API used to run "naked": any web page could secretly hit localhost and make the character move — an `OPTIONS` preflight would even actually trigger character movement. v0.6.7 adds to both local ports (48794/48795): **method whitelist (405), zero-side-effect preflight (204), pairing code on write APIs (403), request body cap (413), CORS origin allowlist, capability handshake (/capabilities)**.

## 2. Pairing Mechanism (the only section the owner touches day-to-day)

- **Pairing code**: generated automatically on first plugin startup, 8 chars (confusable characters excluded), stored at `%AppData%\XIVLauncherCN\pluginConfigs\ChoreoHelper\pairing.json`, **never changes**.
- **See the code in game**: type `/choreo pair` in chat (also announced in chat once at plugin startup).
- **Paste the code in the web**: toolbar 「⋯ 高级」 (Advanced) → 「🔗 网页配对」 (Web Pairing) → paste → confirm. **Once per browser** (stored in localStorage); re-paste if browser data is cleared.
- **When needed**: only "control the game" operations need pairing — game-character-mode playback/seek, 3D action-library recording, precise photo capture, engine switch. Web-3D-mode editing, dragging, playback **never need it**.
- Clicking those without pairing: the web shows a plain-language pointer toast; it never fails silently.

## 3. Plugin-Side Changes (C#)

| File | Change |
|---|---|
| `src/LocalApiSecurity.cs` (new) | Shared security piece: CORS allowlist, preflight 204/403, pairing check, 405/413/403 responses, ReadBodyLimited, CapabilitiesJson (protocolVersion=1) |
| `src/PairingStore.cs` (new) | Pairing code generation (8 chars, confusables excluded) + pairing.json persistence; on disk failure hands out a temporary code instead of crashing the plugin |
| `src/Plugin.cs` | Assembles the pairing code into both servers; registers `/choreo pair`; announces the pairing code in chat at startup |
| `src/HttpServer.cs` (48794) | Keeps the existing OPTIONS interception; **method whitelist +405** (GET/HEAD read-only, POST write, other methods 405/404); **all POSTs require the pairing code** (/preview, /playback/*, /bonerec/*, /gpose/toggle, /settings/engine); within GET, /debug/poke moves the character so it also needs a code; POST body cap 4MB (413); GET /capabilities; CORS * → allowlist |
| `src/Exporter/ExportServer.cs` (48795) | **P0 fix: Handle() intercepts OPTIONS at the top → 204 zero side effects** (previously a preflight fell into business logic; `OPTIONS /export/walkreset` really did trigger character movement); /capabilities special case (same path as 48794); static files GET-only; method whitelist (list/getclip/skeleton/recstate/progress/batchstatus=GET, clip/batch/batchcancel/walkreset=POST); pairing code on write APIs; /export/clip body cap 64KB; **recording mutex** (a concurrent second clip gets an immediate busy instead of waiting 30s; no single clip accepted while a batch runs); CORS * → allowlist |
| `src/ChoreoHelper.csproj` | 0.6.6.0 → **0.6.7.0** |

**CORS allowlist**: `null` (file:// double-click entry), `http://localhost:48795`, `http://127.0.0.1:48795`, `http://localhost:48796` (dev server), `http://localhost:48797` (acceptance mock). Requests without an Origin header (curl/same-origin) pass through. **Once the production GitHub Pages origin is fixed, fill `LocalApiSecurity.PublicSiteOrigin`** (currently an empty-string placeholder) — must be configured before the WP-2 release.

## 4. Web-Side Changes (web/choreo-helper-app.html)

- `store.capsOk`: after probeGame succeeds, probes `/capabilities`; getting a protocolVersion means a new plugin; 404 = old plugin (≤0.6.6) runs compatibility mode.
- `store.pairToken`: localStorage `choreo_pairToken`; `choreoTokenHeaders()` uniformly adds `X-Choreo-Token` to write requests — **only when capsOk** (the old plugin's "preflight" only passes because business responses happen to carry CORS headers; an extra custom header would break the preflight, so it must not be sent during the transition).
- `apiFetch`/`apiPreview`/`recRecordOne`/`recWalkreset`: all POSTs carry the token header; 403 → throttled toast pointing to pairing.
- Recording center: preflight before the run (with a new plugin, blocked immediately if unpaired, so all 264 don't just fail) + pause immediately on 403 mid-loop.
- probeGame's `/settings/engine` sync: skipped while unpaired (otherwise every 15s probe would 403-toast).
- Protocol mismatch hint: plugin protocolVersion > web CHOREO_PROTOCOL → prompt to refresh the page.
- The 「⋯ 高级」 (Advanced) modal gains a 「🔗 网页配对」 button (state shown per connection/plugin version).

## 5. Script Changes

- `scripts/library-verify.js`: the 48797 mock is fully aligned to v0.6.7 (OPTIONS 204/403, 405, pairing 403, /capabilities, CORS allowlist, unknown path 404); **new `sec` scenario (20 security assertions, pure HTTP)**; the rec scenario seeds pairing code `TESTCODE` into the page (equivalent to the owner pasting once) before the full run.
- `scripts/batch-record.js`: write APIs carry the pairing code — `--token=码` (码 = the code) parameter or `CHOREO_TOKEN` env var; on 403, prompts where to get the code.
- `scripts/offline-verify.js`: **unchanged** (its assertions don't touch write-API responses; mode-check counts requests by path without reading status codes, so 403 doesn't affect it).

## 6. In-Game Regression Record (2026-08-29, curl straight at the game after the 0.6.7 hot-reload)

**Before-fix evidence** (0.6.6 live): `OPTIONS /export/list` → 200 (fell into business logic); `/capabilities` → 404; unknown /export/* → 200+error.

| Check | Result |
|---|---|
| OPTIONS /export/walkreset (Origin: null) | **204**, zero side effects (P0 fix proven) |
| GET /export/walkreset | **405**, no longer moves the character |
| GET /export/clip / PUT /health / POST /export/list | **405** (POST without Content-Length is stopped by HTTP.sys as 411 first, likewise never reaching the app) |
| POST /export/clip, /playback/start without pairing code | **403** pairing required |
| POST /export/clip with wrong pairing code | **403** |
| POST /playback/stop with correct pairing code | **200** {"status":"stopped"} (no side effects; proves the token passes through) |
| OPTIONS from unknown origin (https://evil.example) | **403** (preflight fails; the browser never even sends the real request) |
| GET /capabilities both ports | 200: app/version 0.6.7/protocolVersion 1/pairing true |
| Fake oversized Content-Length | **413** |
| Unknown /export/* | **404** (old version: 200+error) |
| pairing.json | Generated (pluginConfigs\ChoreoHelper\, 8 chars) |

**Automated acceptance** (mock + real plugin mix): sec 20/20, rec 25/25 (pairing code through the real page chain), auto 4/4, sync 12/12, uicheck 6/6, lib/mode/clip-check PASS, offline-verify 21/21, engine unit tests 35/35 (untouched), Debug build 0 errors (6 pre-existing warnings). Note: the auto/sync/diagnostics-page batch ran after the game had already hot-reloaded 0.6.7 — i.e. the **new plugin + new web** combination was tested live; rec/sec ran against the mock mirror.

## 7. Compatibility Matrix (transition period)

| Web \ Plugin | Old 0.6.6 | New 0.6.7 |
|---|---|---|
| Old web (0.6.6 cache) | Everything as before | Write APIs 403 (no new hints visible in the old page — refreshing the page fixes it) |
| New web (0.6.7) | Compatibility mode: capsOk=false, no pairing header, everything as before | Full mode: write operations allowed after pairing |

If the owner's browser still has an old page open, one refresh shows the new version (pairing entry under 「⋯ 高级」).

## 8. Owner Smoke Test (completed early morning 2026-08-29)

The first smoke round hit a full-width-character pairing input failure (see section 9); after the fix and redeployment **the owner confirmed: game-mode playback works**. WP-1 closed.

## 9. Owner's First Smoke Failure and Fix (early 2026-08-29; owner reported “配对后播放失败” — playback fails after pairing)

**Symptom**: after pairing, clicking game-mode playback toasts “游戏播放失败：插件未连接或启动异常” (game playback failed: plugin not connected or startup error).
**Diagnosis** (headless browser with the real pairing code + dalamud.log): with the correct pairing code the whole chain works (freeze/start all 200, the character really starts playing). The true root cause was **the pairing code typed through a Chinese IME becoming full-width characters (ＡＢ２…)** — full-width ≠ half-width so validation always failed, and non-ASCII values in an HTTP header make fetch throw a TypeError outright (the request never gets sent). The old toast showed "plugin not connected" for any failure and also wrongly cleared the connection flag, misleading troubleshooting.

**Fixed (all four deployments md5-identical 60223fae…, headless verification 8/8)**:
1. **Full-width auto-correction**: `normToken()` normalizes full-width → half-width, strips whitespace, and uppercases when saving the pairing code — a correct code typed full-width just works; the send side adds a "visible ASCII only" double guard (better to omit the header than let fetch throw on an illegal value)
2. **403 hint no longer misleading**: when a playback failure contains 403, the toast points to "wrong or missing pairing code → /choreo pair to look it up and re-paste", and **no longer wrongly marks disconnected** (the connection dot does not turn red for this)
3. **capsOk expiry self-heal**: while the page stays open, if the plugin hot-reloads/upgrades (old → new), the connection monitor lightly probes /capabilities every 15s, recognizes the new version, and automatically enables the pairing entry (previously capsOk stuck false kept compatibility mode → all write APIs 403)
4. **Plugin-side pairing failure log**: `Pairing check failed for POST /playback/start (token mismatch/missing)` — one log lookup now tells a wrong code from a missing header

**Verification**: wrong code → pairing pointer toast + connection kept + no playing state ✔; correct full-width code → auto-normalized + playback works ✔; normalization function ✔; correct-code playback ✔; capsOk set false self-heals within 15s ✔; mode-check regression PASS; Debug build 0 errors.

**Owner to do**: refresh the page (the old page still runs the unfixed version), re-paste the pairing code once (full-width now saves correctly too), then press play.

## 10. Remaining Items / Known Boundaries

- `LocalApiSecurity.PublicSiteOrigin` empty-string placeholder — fill it in WP-2 once the production origin is fixed.
- The pairing code is "local machine trust" level (stops other web pages from secretly controlling the game), not cryptographic authentication — sufficient for a local personal tool; the file lives in the owner's own AppData.
- POSTs without Content-Length are stopped by HTTP.sys as 411 first (not our 405) — browsers never send like that, no impact; remember `-H "Content-Length: 0"` for curl tests.
- 413 size caps: 48794 all POST 4MB / 48795 write 64KB; sufficient and abuse-proof.
- Recording mutex semantics: while a single clip runs, a second gets an immediate busy; while a batch runs, no single clip is accepted; no batch starts while a single clip runs.
- The release staging exclusion list is unchanged (diagnostics page, real model, owner's snapshots); `choreo-library.js` and `libs-classic` are product files and must ship in the package (executed in WP-2).
