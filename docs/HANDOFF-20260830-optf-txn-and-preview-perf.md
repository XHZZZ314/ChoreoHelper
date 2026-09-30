# HANDOFF: OPT-F Project Transactions and 3D/Profile-Switch Performance (2026-08-30)

> Work package: `docs/AUDIT-20260830-code-repair/06-OPT-F-PROJECTS-AND-PREVIEW.md` (AUD2-011 + AUD2-012, P2).
> Version stays **0.7.1** (plugin.json / csproj untouched). Not committed, not pushed, not released.

## 1. Results at a glance

| Item | Status |
|---|---|
| AUD2-011 project storage transaction semantics | **Done** (code + unit tests 96/96, incl. 19 new transaction assertions) |
| AUD2-012 profile switch / 3D performance | **Done** (code + automated acceptance + online regression all closed; during testing the owner was briefly out of character, which blocked 5 online scenarios for a while; after the owner returned to character, library-verify all **106/106** was re-run all green) |
| Regression | Node five suites 40/87/73/**96**/71 all green; offline-verify full set **38/38** (incl. online/transition real-plugin paths); **library-verify all 106/106** (real plugin online; sync/auto/uicheck/full/check all pass); mode/clip/lib-check PASS |
| Deployment | preview3d.js / choreo-projects.js md5 consistent across the four deployment locations (`7e8a1ea7…` / `bb29d194…`); app html and all other files untouched (still FIX-D's `06a57ae2…`) |

## 2. AUD2-011: IndexedDB "request success ≠ transaction commit" (web\choreo-projects.js)

**Confirmed problem**: `putProject/deleteProject/putVersion/deleteVersion` all awaited only a single IDBRequest's
`onsuccess` — if the transaction aborted afterwards, upper layers had already reported success; `deleteProject`
used two transactions (delete the project, then the versions), so a second-step failure left
"project gone but versions remain", and tombstone/mirror cleanup was skipped.

**Fix** (four points, mapping one-to-one to the work-package steps):
1. New `txDone(t)`: resolves only on `transaction.oncomplete`; rejects on `onabort/onerror` (taking `t.error`).
   All write APIs (put/delete/rename/create/duplicate/addVersion internals) are unified through `txWrite` to await transaction commit.
2. Backend gains `deleteProjectWithVersions(id)`: projects + versions deleted in the **same readwrite transaction**,
   all-or-nothing rollback on mid-way failure; legacy injected backends (without this method) automatically fall back to the two-step path, compatible with existing tests.
3. Delete tombstones now persisted: new localStorage key `choreo_deleted_projects` (FIFO cap 200).
   Registered only after the IDB commit succeeds; even if subsequent mirror/pointer cleanup fails, the next `init()`
   replays the persistent tombstones into memory and re-cleans mirrors pointing at deleted projects —
   `saveActive` keeps blocking, so "a deleted project resurrects" is impossible under any cleanup-failure combination.
   **Delete failure (transaction reject) registers no tombstone**; the project remains editable/savable as usual.
4. `init()` order: reset session tombstones → replay persistent tombstones → re-clean stale mirrors of deleted projects.

**Unit tests** (web\test-projects.js 77→**96**): new fake IndexedDB (staged changes + commit-to-store + abort discards +
`request.result` property + `t.error` carrying the error + cursors holding the commit open via in-flight counting —
all modeled on real IDB semantics), covering: transaction abort → createProject/renameProject/putVersion explicitly reject without false success;
abort rolls back with no half records; delete abort leaves project+versions intact and registers no tombstone; normal delete removes both;
tombstone persistence + init re-clean of mirrors + 200 cap; crash recovery / 20 cap / migration existing assertions all preserved.

**Intentional deviation**: `addVersion`/`saveActive` still follow the existing design on transaction failure
("swallow the error, return false / mirror fallback" — version-snapshot failure not blocking editing is WP-3 semantics),
but the success criterion tightened from request success outside the transaction to transaction commit.

## 3. AUD2-012: profile-switch repeated work and local resource release (web\preview3d.js)

**Performance baseline (before optimization)** — new repeatable scenario `offline-verify modelswitch` (CDP Fetch interception feeding
skeletons A/B + deploy-slot model + profile-owned model, really running hardReset→init→loadModel; in-page wrapping of
`GLTFLoader.parse`/`SubtleCrypto.digest`/`putProfileFile` for counting; headless Chrome, file://, local SSD,
models are 27~37KB stand-in variants):

| Round | parse | digest | library write | elapsed |
|---|---|---|---|---|
| B1 (first switch) | 2 | 2 | 0 | 422ms |
| A2 (switch back) | **1** | **2** | **1** | 416ms |
| B2 (switch again) | **2** | **2** | **0** | 418ms |

**After optimization**: B1 unchanged (no cache available on the first round); **A2 = 0/1/0, B2 = 0/1/0** — from the second round model parse=0,
hashing reduced to the single skeleton-match digest, zero repeated library writes. Under headless + small models the absolute time saved is small
(~10ms); with real models (736KB gltf parse + hash + rewrite every time) the gains scale proportionally. **The other half of "switching feels slow"
is the hardReset full-chain rebuild (skeleton fetch / clip re-pull); per the work-package boundary this package only did the model chain + resource
release — full-chain partial rebuild not done**.

**Change list**:
1. **Session-level model cache `_modelCache`** (FIFO cap 8): profile models cached by "profile id + content hash + size"
   (switching back to a seen profile: no file read, no hash, no parse; known-incompatible profile models also remember the verdict and don't re-parse;
   `modelNote` is restored from cache); deploy-slot models cache the compatibility verdict + parsed result by "filename + byte count + skeleton signature"
   (explicitly incompatible ones don't re-parse). The skeleton signature prefers the profile `skeletonHash`, falling back to
   count+translation checksum without a profile. Cached parse results are only ever SkeletonUtils.clone'd (cached items never enter the scene, bones never modified);
   geometry/materials shared by clones are disposed by three on reset with automatic GPU re-upload (the AUD-020-verified path).
2. **Stand-in also parses only once** (standin cache key).
3. **Library-write dedup**: `cacheModelToProfile` is now async — skips the rewrite when the content hash matches the library's
   (knownHash reuses the digest already computed for the deploy-slot cache, saving one digest); **a missing bin must still be written**
   (must not hang off "gltf unchanged → return": if last round's gltf write completed but the bin write was interrupted by a refresh, this round must backfill);
   the bin is hash-compared to decide a rewrite only when the gltf is new.
4. **DPR capped at 2**: `Math.min(window.devicePixelRatio || 1, 2)` (at 3x scaling the renderer pixel ratio measured =2).
5. **Dancer-shrink local dispose**: the `syncChars` reduce path now uses the same `disposeObject` dedup release as hardReset
   (ring geometry/materials no longer just remove()d without dispose).
6. **Visibility pause**: `visibilitychange` hidden disconnects the render loop (`_rafOn=false`, tick no longer re-arms);
   on becoming visible with the panel open, one frame is rendered immediately, then `startTick`; panel reopen (toggle) also restarts the loop (idempotent).
7. `__p3dDebug()` gains `tickOn`/`dpr` acceptance fields.

**Test infrastructure**: offline-verify.js's Cdp class gains `onEvent` dispatch (previously nobody handled the
`Fetch.requestPaused` event, so interception hung requests forever — the modelswitch scenario depends on it); modelswitch scenario 6 assertions;
perf scenario 6→11 (+dancers 12→1→12 ×20 GPU recovery, +hidden-stop-render/visible-restart, +3x-scaling DPR cap).
**modelswitch adds `--host-resolver-rules=MAP localhost ~NOTFOUND` to keep the scenario sealed** (the game was online today;
without it the page would take the real-plugin + ES-module path, `window.THREE` wouldn't exist and the wrapped counters couldn't install).

## 4. Two self-inflicted regressions caught and fixed during the work (both have regression coverage)

1. **loadedBuf lost**: the loadModel refactor dropped `loadedBuf` on the cache-hit branch; after a deploy-slot real model was compat-adopted,
   the library write-back got a null buffer and returned early → **real models stopped auto-entering the library**
   (caught by library-verify auto "model 0 files"). Fix: the fetched buf is carried unconditionally (the cache-hit rewrite needs it too).
2. **bin backfill short-circuited**: the library-write dedup's "gltf unchanged → return" also blocked the missing-bin backfill (after a page refresh
   interrupted the first round's bin write, every later round returned early because the gltf was unchanged) →
   caught by the sync scenario "real model cached into library" 60s timeout. Fix see item 3 above.

## 5. Regression checklist (actually executed results)

- **Node five suites**: test-engine 40 / test-edit 87 / test-check 73 / **test-projects 96** (77+19)
  / test-library 71 — all green.
- **offline-verify all 38/38** (run during the owner-in-character window): offline 11 + perf 11 (6 old + 5 new) +
  modelswitch 6 + online 4 (real model 101/101) + transition 3 + mode/clip-check — incl. real-plugin online paths.
- **library-verify**: sec 20/20, proj 23/23 (mock, independent of character state) all green; lib/mode/clip-check PASS.
- `git diff --check` clean; temporary debug scripts deleted.
- **Deployment md5 consistent across the four locations**: preview3d.js=`7e8a1ea7…`, choreo-projects.js=`bb29d194…`;
  app html untouched=`06a57ae2…` (matches the FIX-D records).

## 6. TODO (non-blocking, but SPEC/audit records must stay honest)

1. ~~**Online regression re-run**~~ **Completed same day**: after the owner returned to character, `library-verify.js all` **106/106** all green —
   sync/auto/uicheck/full/check five scenarios pass; online proof of the bin-backfill fix (section 4 item 2) done.
2. **Owner live observation points** (glance next time the page opens, no dedicated acceptance):
   - Profile switch/reset should "feel faster" (especially with real models);
   - No visible sharpness regression on high-DPI screens (DPR cap 2);
   - Switching away and back to the tab restores the 3D panel image immediately, no black screen.
3. Next package: **RELEASE-G** (`docs\AUDIT-20260830-code-repair\07-RELEASE-G-DOCS-DEPLOY.md`,
   P3, done only when publishing) — P0/P1/P2 are now fully cleared.

## 7. Test-conditions record (comparability of the performance numbers)

- Machine/environment: local machine (win32), headless Chrome `--headless=new`, file:// on the deployed pages,
  CDP Fetch interception feeding payloads (skeleton A=101-bone snapshot, B=106-bone+tail; deploy slot = stand-in with renamed material;
  profile B ships a compatible glb). Models 27~37KB (stand-in variants), not the owner's real models (736KB gltf + 3.6MB bin).
- Counting conventions: parse = `GLTFLoader.prototype.parse` call count; digest = `SubtleCrypto.prototype.digest`
  call count; library writes = `ChoreoLibrary.putProfileFile` call count; elapsed = wall-clock from switch issued to panel ready.
- Conclusions are valid only for same-harness before/after comparison; absolute values do not represent the owner's real-machine experience.
