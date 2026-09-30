# HANDOFF — FIX-2 Web Input & Data Integrity (2026-08-29)

> What this file is: build & acceptance handoff for workpackage FIX-2 (audit items AUD-002 / AUD-004 / AUD-005 / AUD-006 / AUD-015).
> Audit entry point: `docs\HANDOFF-20260829-code-audit-fix-optimization.md`; previous package: `docs\HANDOFF-20260829-fix1-csharp-security.md`.
> **Next package is FIX-3 (timeline correctness AUD-007/008/010/014); do not jump to FIX-4 or WP-5.**

## Summary First

- All five audit items fixed with regression coverage; **C# untouched, version stays 0.7.1** (web-only; DLL not rebuilt, not redeployed).
- Full regression green: node tests **239** (test-check 47 / test-edit 57 / test-projects 77 / test-engine 35 / **new test-library 23**) + offline-verify **21/21** + library-verify all **103/103** (real plugin chain, game online) + clip-check **CLIP-PASS (92 assertions)** + mode-check / lib-check PASS.
- All four deploy locations md5 identical (web\ source → web\dist\ChoreoHelper → devPlugins\ChoreoHelper\dist\ChoreoHelper → game dir dist\ChoreoHelper).
- Not committed, pushed, or published (awaiting owner authorization).
- Owner on-machine acceptance items at the end (does not block starting FIX-3).

## Fix & Evidence Per Item

### AUD-002 DOM injection (P0)

- `el(tag,cls,text)` in `web\choreo-helper-app.html` changed to **textContent rendering** (third param used to go straight to innerHTML). Whole file audited: no el() call site passes HTML containing tags, so changing the default behavior directly is safe — fixes in one stroke every injection surface routed through el(): action names / lyrics / dancer names / marker flags / selection info bar / recording-failure names / song search names.
- 4 spots that directly built user content via `innerHTML` switched to DOM APIs: sidebar tabs (emotes/classes/other; class names come from the game catalog, semi-trusted), checkup result rows (message contains action names/commands), LRC lyrics import preview (l.text comes from user files). The other two innerHTML spots (playback overlay, bottom bar) verified to only concatenate constants/numbers or already manually escaped content — untouched.
- Import layer second line of defense: new `sanitizeImportProject()` — validates dancer count 1~12, per-dancer three-track clip structure, name ≤120 chars / command ≤200 chars / lyrics ≤500 chars / marker ≤60 chars, times and durations must be finite numbers in 0~86400, showLyricMacro must be boolean; errors all in Chinese, import-failure toast shows the specific reason. **Render-layer safety is fundamental; import validation is only supplementary** (short injection strings still get stored, but render as plain text).
- Regression: clip-check new **⑳ DOM injection protection** group (8+ assertions): action/lyrics/marker/dancer/class names injected with `<img onerror>`, `<svg onload>`, quotes, HTML entities — asserts no img/svg/iframe nodes generated, text shown as-is, sentinel variables not triggered, zero extra network requests; import layer asserts overlong input / empty dancers / non-numeric times rejected in Chinese, normal projects import as usual.

### AUD-004 Clip library atomic writes & backup verification (P0)

- `web\choreo-library.js` new `putManyAtomic(ops)`: multiple records commit inside **a single IndexedDB readwrite transaction**; success only when the transaction completes; any failure rolls back the whole group (`deleteClip` was already single-transaction, semantics consistent).
- `putClip` changed to write clips (metadata) + clipdata (data) in one transaction — fixes the old "two parallel transactions, failure leaves a ghost clip" problem; `putSkeleton` consolidated the same way (skeleton record + profile fingerprint both in the meta store, one transaction). The old `touchProfile` was absorbed into putSkeleton and deleted.
- Backup import runs every entry through `verifyClipBlob`'s three gates: decompress → JSON structure (must contain bones) → recompute SHA-256 and compare against the header hash; header without a hash (old backups) writes with the freshly computed value, hash mismatch rejects that entry. Data blobs still stored as original bytes (no recompression); `.choreolib` format stays compatible.
- Orphan repair `repairOrphans(db)`: after each successful open, scans the primary-key set difference between clips/clipdata and clears half-records ("metadata without data / data without metadata"); by primary key only, never reads large blobs; if the cleanup fails it silently passes and never blocks usage.
- Test injection point `ChoreoLibrary.useBackend(fn)` (pass null to restore): lets node tests feed a fake IndexedDB transaction backend.
- Regression: **new `web\test-library.js` (23/23, node direct)** — normal write roundtrip; clipdata-side failure leaves no ghost metadata; clips-side failure leaves no orphan data; putSkeleton writes both records together; export→import roundtrip hash/content identical; backup with tampered payload rejected without overwriting healthy clips; hand-crafted bad CHLB (non-JSON / missing bones) rejected with zero writes; orphan cleanup. Pitfall while writing the tests: the fake backend's `objectStore(name)` parameter shadowed the outer variable holding store keys (all Map keys became undefined) — first run was a 9-item false green; fixed and all green.

### AUD-005 Undo not persisted (P1)

- `undo()` / `redo()` now append `updateTotalDuration()` (recompute derived value) and `persistProject()` (mirror + IDB persisted immediately) after restoring; they do **not** call saveHistory (that would truncate/rewrite the undo stack). Undo then close the page → reopening shows the undone state.
- History snapshot now includes `showLyricMacro` (the UI onchange already calls saveHistory, so it should be undoable); totalDuration is derived and not snapshotted.
- Regression: clip-check new ㉑ group, first half — edit→undo→mirror assertion = post-undo state; showLyricMacro follows undo; redo→mirror = post-redo state.

### AUD-006 Deleted project resurrection (P1)

- Resurrection chain (audit repro, verified): after deleting the current project, `store.projectId` still points at it → next edit `saveHistory→persistProject→saveActive` puts it back into IndexedDB with the same id via `putProject`. The mirror itself has a `newerSource` guard and does not resurrect stale content.
- Fix (two layers):
  - **UI (homepage project center)**: deleting the current project first `switchProject`s to the most recently edited other project, then deletes; deleting the sole project is still refused ("at least one project must remain" — original logic). Deleting a non-current project behaves as before.
  - **Storage layer (choreo-projects.js)**: `deleteProject` registers an in-memory tombstone on success + clears the mirror pointing at it and the active pointer; `saveActive` refuses tombstoned ids outright (no mirror write, no DB write); `init()` resets tombstones (new session, no id reuse, no risk).
- Regression: test-projects.js new "== 11 ==" group (7 assertions): delete current → gone from list → mirror/active cleared → old record's saveActive doesn't resurrect → refused write touches no mirror → non-current project deletes as usual → after init reset, new project saves as usual. clip-check ㉑ group second half walks the full sequence in the real page environment via `__projTest` (create test project → switch back → delete → autosave → assert no resurrection; uses only test-created projects, never touches real ones).

### AUD-015 Measured durations not persisted (P1)

- Correction loop extracted into pure function `ChoreoEdit.pure.applyMeasuredDurations(dancers, measured)`: for autoDur clips whose command has a measured value and diff >0.01, sets the measured duration and locks autoDur; returns the correction count (job-track switches covered too).
- Homepage `refreshMeasured()` calls the pure function; on corrections it runs `updateTotalDuration(); render(); persistProject()` — **persisted but not pushed onto the undo stack** (programmatic auto-correction; keeps async results from interrupting user undo, per the audit's default interpretation).
- Regression: test-edit.js new "== 9 ==" group (7 assertions): correction count, measured backfill + autoDur lock, no measured value → untouched, diff<0.01 doesn't count, manually locked untouched, job-track switch, empty args don't crash.

## Pre-work Doc Check Conclusion (one correction, code is authoritative)

- CONTINUITY/audit mostly match the code. CONTINUITY line 278 "undo stack only snapshots dancers/globalLyrics" is **outdated** (markers included since WP-3b) — rewritten this round to the accurate description with FIX-2's extension noted.
- Two audit details are more precise when checked against code (does not affect fix direction): AUD-004 is "two parallel independent transactions", not "delete-then-write"; AUD-006's mirror does not directly resurrect stale content (newerSource guard) — resurrection goes only through saveActive's putProject.

## Regression Checklist (actual results this round)

| Check | Result |
|---|---|
| `node web\test-check.js` | 47/47 |
| `node web\test-edit.js` | 57/57 (+7) |
| `node web\test-projects.js` | 77/77 (+7) |
| `node web\test-engine.js` | 35/35 |
| `node web\test-library.js` (new) | 23/23 |
| `node scripts\offline-verify.js all` | 21/21 |
| `node scripts\library-verify.js all` (real plugin, game online) | 103/103 |
| clip-check.html (48795 origin, headless) | CLIP-PASS, 92 assertions (new ⑳㉑ groups) |
| mode-check.html / lib-check.html | PASS |
| `git diff --check` | pass |
| Four deploy locations md5 | identical (app html fab56e21… / choreo-library 2a8df658… / choreo-projects 78730633… / choreo-edit 1430ae47… / clip-check 2ebe45d0…) |

Changed files: `web\choreo-helper-app.html`, `web\choreo-library.js`, `web\choreo-projects.js`, `web\choreo-edit.js`, `web\clip-check.html` (diagnostics page, not in the release package), `web\test-library.js` (new), `web\test-edit.js`, `web\test-projects.js`, `.agent\CONTINUITY.md`, this doc, AGENTS.md pointer.

## Awaiting Owner On-machine Acceptance (when free; does not block FIX-3)

**✅ Accepted (2026-08-29, owner confirmed 「验证OK」); FIX-2 officially closed.** Original checklist archived:

1. **Undo + close page**: make a few edits → Ctrl+Z undo → close the browser directly → reopen "ChoreoHelper" — what you see should be the undone state (previously it reverted to pre-undo).
2. **Delete current project**: delete the open project in the project center — it should auto-jump to another project and the deleted one must not come back (sole project prompts "at least one must remain").
3. **Checkup modal / lyrics import** still work (render layer changed its assembly method; appearance should be unchanged); lines/marker names containing `<` display as raw text.

## Known Boundaries & Reminders

- `scripts\fix1-web-verify.js` (FIX-1 one-off script) is still kept, not deleted; this round's debug scripts were deleted after use.
- The orphan repair on library open only applies to choreo3dlib (the clip library); the project library choreo3dproj already writes single-store single-transaction, so it has no such issue.
- staging artifacts still 0.6.7; before release, as usual: Release rebuild + re-run make-release-staging.js (whitelist already includes every product file from this round; no new product files).
