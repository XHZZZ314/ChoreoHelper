# 06: OPT-F Project Transactions and 3D/Profile-Switch Performance (P2)

This package starts only after P0/P1 fixes and their regressions. Measure first, then optimize; never expand scope by rewriting the renderer or upgrading Three.js.

## AUD2-011: IndexedDB Request Success Is Not Transaction Commit

### Symptoms and Evidence

- `putProject/deleteProject/putVersion/deleteVersion` return on a single IDBRequest's `onsuccess`.
- After an IndexedDB request succeeds, the transaction can still abort; the upper layer has already reported success by then.
- `deleteProject` deletes the project first, then deletes versions in a second transaction. If the second step fails, the project is already deleted while tombstone, mirror, and active-pointer cleanup never ran.

Evidence locations: `web/choreo-projects.js:107-149, 291-300`.

### Modification Steps

1. Add `txDone(transaction)` that resolves only on `oncomplete` and rejects on `onabort/onerror`.
2. All write APIs return a transaction-completion Promise, not a request-success Promise.
3. A project and its versions live in the same database and should be deleted in one readwrite transaction.
4. Order the tombstone, active-pointer, and localStorage mirror updates so they are recoverable:
   - If the IDB commit fails, the UI must not be told the project was deleted;
   - If the IDB commit succeeds but localStorage cleanup fails, the next init must not resurrect the deleted project;
   - If needed, persist tombstones or add a deletion version number to the mirror instead of relying on session memory alone.
5. create, rename, duplicate, and addVersion likewise check transaction-commit semantics.

### Targeted Tests

- Request success followed by transaction abort: all write APIs must reject.
- Deleting versions fails midway: neither project nor versions appear in a half-deleted state.
- Deleting the current project immediately triggers the old project's autosave; it must not resurrect.
- Browser crash recovery, 20-version cap, and old-draft migration behavior stay unchanged.

## AUD2-012: Profile-Switch Repeated Work and Partial Resource Release

### Symptoms and Evidence

- `loadModel` tries the deploy-location model on every hard reset, reading and parsing before knowing whether it fits the current skeleton; on mismatch it then loads the profile model.
- `putProfileFile/cacheModelToProfile` read the whole Blob into an ArrayBuffer to compute the hash, possibly repeating on switch.
- `renderer.setPixelRatio(window.devicePixelRatio)` has no cap; high-DPI screens significantly amplify GPU fill-rate.
- hardReset's full resource release already has regression coverage, but the partial path removing rig/ring when dancer count shrinks dynamically has no equivalent dispose coverage.
- requestAnimationFrame keeps running while the page is invisible.

Evidence locations:

- `web/preview3d.js:481-519, 563-610, 636-640, 727-780, 960-970`
- `web/choreo-library.js:351-373`
- The owner's live feedback "switching/loading feels slow" in `.agent/CONTINUITY.md`

### Establish a Performance Baseline First

Use `performance.mark/measure` or dev-only counters to record:

- First load time of the same profile.
- Second load time of A in an A→B→A sequence.
- fetch count, GLTF parse count, SHA-256 count, hardReset count.
- renderer.info geometries/textures/programs.
- GPU resource counts after a 12→1→12 dancer change.

Never go by "feels faster"; the handoff must record before/after numbers and test machine conditions.

### Modification Steps

1. Build an in-session model cache keyed by at least profileId + model file hash; when caching parse results use a safe clone — multiple rigs must never share bone instances that get mutated.
2. Maintain a "deploy model hash ↔ skeletonHash compatibility result" cache. When the current profile is already known incompatible, do not re-parse the same deploy model.
3. Avoid rewriting unchanged file content into IndexedDB; but never judge by file name alone — trusted content hash remains the identity.
4. Keep the existing product behavior for profile-model vs deploy-model vs stand-in priority; the cache must not reintroduce mismatches.
5. DPR uses `Math.min(window.devicePixelRatio || 1, 2)`; if a setting is added later, it still defaults to a safe cap.
6. Route dynamic rig/ring deletion through the same dedup dispose utility as hardReset, and cover `Skeleton.dispose()`.
7. Pause high-frequency rendering on `visibilitychange`; on becoming visible again, resume and render once immediately.
8. Do not upgrade Three.js, change visual design, or introduce Workers in this package unless measurement proves the local optimizations above still miss the target.

### Performance Acceptance

- In A→B→A, the second A no longer re-fetches/hashes/parses unchanged models.
- 20 repeated switches: GPU texture/geometry does not grow linearly.
- 20 rounds of 12→1→12 dancer cycling: resource counts return to a stable plateau.
- After hiding the tab, high-frequency ticks stop noticeably; after restoring, timeline and poses are correct.
- The DPR cap takes effect; appearance on 1x/1.5x/2x screens shows no obvious regression.
- `offline-verify perf` extends with the assertions above while keeping all existing 6 passing.

## Package Definition of Done

- [x] Project write operations use transaction commit as the success criterion. (2026-08-30 OPT-F: txDone + txWrite wired everywhere, 19 new fake-IDB assertions, test-projects 96/96)
- [x] Project deletion has no half-deleted or resurrection path. (project+versions deleted in one transaction; tombstone persisted as choreo_deleted_projects, init replay completes mirror cleanup; failed deletion registers nothing and causes no side damage)
- [x] fetch/hash/parse counts across repeated profile switches measurably drop. (modelswitch scenario: A2/B2 from parse 1-2/digest 2/library write 1 → **parse 0/digest 1/library write 0**; before/after numbers in HANDOFF-20260830-optf-txn-and-preview-perf.md)
- [x] Neither hard reset nor partial dancer add/remove leaks GPU resources. (hardReset's existing regression kept; new 12→1→12×20 assertion passes)
- [x] Function, appearance, offline entry, and game-online switching do not regress. (offline-verify all 38/38 incl. online/transition; five-suite all green; two self-inflicted regressions — lost loadedBuf, short-circuited bin backfill — fixed with scenario coverage)

**Construction Record (2026-08-30)**: handoff `docs/HANDOFF-20260830-optf-txn-and-preview-perf.md`; CONTINUITY entry 38.
**Online regression re-run same day**: after the owner returned to the character, library-verify all **106/106** all green (sync/auto/uicheck/full/check five scenarios pass; the bin-backfill fix verified live). This package is fully closed.
