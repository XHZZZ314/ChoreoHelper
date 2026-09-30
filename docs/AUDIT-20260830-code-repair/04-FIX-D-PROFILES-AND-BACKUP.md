# 04: FIX-D Character Profiles, Clip Isolation, and Backup Format (P1)

## AUD2-008: Clips Are Still a Global Namespace

### Symptoms and Evidence

- Character profiles already save model, skeleton, and the active-profile pointer per profile.
- `clips` and `clipdata` primary keys are still just the clip name.
- New recordings only stamp `skeletonHash` into metadata without changing the key; another character recording a same-named clip overwrites the first character's data.
- `getClip(name)` returns the bare clip without returning/validating metadata fingerprints; `preview3d` also caches and plays by name directly after online re-fetch.

Evidence locations:

- `web/choreo-library.js:120-138, 461-515`
- `web/preview3d.js:837-867`
- `web/test-library.js` multi-profile tests cover only model/skeleton, not same-named clips

### Data Model Goal

Clip identity is at least `(profileId, clipName)`; if sharing clips across multiple same-skeleton characters is allowed later, build an explicit sharing layer — never implicit global-name sharing.

On the IndexedDB upgrade, create new stores rather than trying to modify the v1 store keyPath in place:

- `profileClips`: keyPath `['profileId', 'name']`, storing type, duration, data hash, skeletonHash, update time.
- `profileClipData`: same composite key, storing the gzip blob.
- All public APIs gain an optional `profileId`; when omitted, resolve the current active profile, keeping old callers compatible.
- Preview cache keys likewise include profileId or skeletonHash; switching profiles must never reuse the previous profile's same-named clip.

### v1 Data Migration

1. Use the old clip metadata's `skeletonHash` to find a uniquely matching profile.
2. On a unique match, migrate into that profile.
3. With no fingerprint, no match, or multiple matches, put the clip in an explicit "clips pending assignment" area and prompt the owner to choose in the library UI; silently binding to the current active profile is forbidden.
4. Keep the old store until migration succeeds; record migration version and count; repeated opens must be idempotent.
5. A migration failure must never make old clips disappear; re-attempt or export old data must remain possible.

### Targeted Tests

- Two profiles with different skeletonHashes both save `/bow`; after switching, each fetches its own data with different hashes.
- Deleting a clip from profile A does not affect B.
- Old clips with fingerprints auto-archive correctly; fingerprintless clips enter pending assignment, never silently claimed.
- Online re-fetch and single re-record write only the current profile.
- Health check, missing-recording detection, and timeline preview all use the current profile's index.

## AUD2-009: CHLB v1 Loses Per-Clip Ownership; Model Validation Insufficient

### Symptoms and Evidence

- CHLB v1 profile entries carry skeletonHash, but clip entries carry neither profileId nor skeletonHash.
- Import computes `clipStamp` once and stamps it onto all clips; a multi-character backup mis-attributes all clips to one skeleton.
- Profile model files save hash metadata, but the import/load chain never fully verifies the model file hash.
- Deploy-location models go through `checkModelCompat`, but the profile's own `loadModelFromProfile` returns without an equivalent compatibility gate.

Evidence locations:

- `web/choreo-library.js:579-659, 665-805`
- `web/preview3d.js:461-519, 579-610`

### CHLB v2 Requirements

1. Bump `BUNDLE_VERSION`; keep v1 read-only import.
2. Every clip header explicitly stores `profileId`, `skeletonHash`, content hash, compression method, and raw/compressed lengths.
3. Every model file stores its owning profile, file name, MIME, and content hash; a gltf's external bin references must resolve within the same profile.
4. Import runs a whole-bundle preflight first: boundaries, lengths, JSON structure, all hashes, profile/skeleton relations, and model/bin completeness must all validate before any modification of the existing library starts.
5. v1 import handles uncertain clips per the previous section's migration rules — never stamp them uniformly with the active skeleton again.
6. After loading a profile model, run the compatibility check against that profile's skeleton; on incompatibility refuse to mount, keep the existing model, and show a Chinese handling entry.
7. Importing a new profile is a non-destructive merge; a bad bundle failing must not change the active profile pointer or leave a half-built profile.

### Targeted Tests

- Two profiles, two same-named clips, different clip hashes: v2 export → wipe library → import round trip.
- v1 single-profile compatible import.
- v1 multi-profile with unattributable clips enters the pending-assignment area.
- Tampering any single byte of a clip, profile skeleton, model.gltf, or model.bin: import refuses and the original library is unchanged item by item.
- A forged header skeletonHash mismatching the actual skeleton is refused.
- A profile model incompatible with the skeleton's bone names/scale must not load silently in preview.

## Package Definition of Done

- [x] Clips, preview cache, health check, and backup are all isolated per profile. (completed 2026-08-30, see construction record at end)
- [x] Same-named clips never cross-overwrite or cross-play between two characters. (node assertions + lib-check assertions; two-character real-machine regression left to the owner)
- [x] CHLB v2 preserves per-clip ownership and validates model/skeleton/clip integrity.
- [x] v1 data has a lossless, idempotent, explainable migration path.
- [x] `test-library`, library-check, library-verify, and offline/transition automatic regressions all pass (71/47→71, LIB-PASS, 106/106, 27/27); **two-character live regression left to the owner**.

---

## Construction Record (2026-08-30; FIX-D code + automatic acceptance complete)

- **Implementation carrier**: entirely web-layer (C# zero changes, version still 0.7.1).
  - `web/choreo-library.js`: IndexedDB v1→**v2**, new `profileClips`/`profileClipData` stores (composite key `[profileId,name]`); `ensureClips()` one-time migration of the old global `clips`/`clipdata` by skeleton fingerprint (unique match→into profile; no fingerprint / no match / multiple same-fingerprint profiles→`__pending__` pending-assignment area; each "move in + delete old" in one transaction = failure is retryable without data loss; migration bookkeeping into meta `clipMigration`). All clip APIs gain optional `profileId` (default = active profile; old call sites zero changes); new APIs `pendingClipIndex`/`assignPendingClips` (claiming stamps the target profile's skeleton fingerprint)/`getProfileFileInfo` (with hash metadata); `stats()` gains `pendingClips`; `clear()`/`repairOrphans` cover the new stores. CHLB `BUNDLE_VERSION` 1→**2**: clip entries carry `profileId`+per-entry `skeletonHash`, file entries carry content `hash`; **v2 import whole-bundle preflight** (every clip decompress+structure+hash, every model file hash, profile skeleton text ↔ header fingerprint, external bins referenced by gltf must be paired within the same profile) must fully pass before any library write; bad bundles cause zero writes; v1 read-only compatible (single profile→clips assigned into it; multi-profile→all clips into pending assignment, no longer uniformly stamped with some skeleton).
  - `web/preview3d.js`: clip cache key includes profile id (`cacheKey`, second safety layer so switching profiles never reuses the previous profile's same-named clip); profile model load triple gate — file hash check (missing metadata = old data, skipped) + parse success + `checkModelCompat` skeleton compatibility; any failure means no mount, stand-in used, and the reason shown in the panel.
  - `web/choreo-helper-app.html` (library window): pending-assignment clip area (list checkboxes + target profile dropdown + archive/delete), import toast reports the pending count.
  - Health check / missing-recording detection / 3D panel go through `clipIndex()` defaulting to the active profile, naturally becoming "current-profile scope"; choreo-check.js zero changes.
- **Intentional deviations**: ① v2 import of bad bundles changed from "per-item failure, continue" to "reject whole bundle, zero writes" (literal requirement of construction-package item 4; v1 keeps per-item semantics); ② clips with the same skeleton fingerprint across multiple profiles go to pending assignment rather than guessing the first; ③ pending-assignment clips also export with v2 backups (profileId=`__pending__`) and remain pending after import.
- **Owner real-library migration expectation**: clips auto-archive into matching profiles by the skeleton fingerprints stamped after FIX-4 (clips imported from the 巧克力歌剧院 recovery bundle carry its fingerprint → should auto-archive); a few fingerprintless old clips will enter pending assignment — one checkbox pass in the library window archives them; health check honestly reports "missing recordings" before archiving, which is expected.
- **Verification**: `test-library.js` 47→**71/71** (four new sections: same-name isolation / old-data migration three states + claiming / CHLB v2 two-profile round trip / bad-bundle triple + v1 single & multi profile); five-suite 40/87/73/77/71 all green; app html inline script syntax passes; **library-verify all 106/106 (real plugin online)**, offline-verify **27/27** (incl. online/transition/perf), lib-check LIB-PASS (new section ⑨ isolation assertions), mode-check/clip-check PASS; four deploy locations md5-identical (choreo-library=fffc72fd, preview3d=5b2e76c8, app html=06a57ae2, library-check=b64eaff5); git diff --check clean; Debug/Release rebuild not needed (C# zero changes).
- **Left to owner**: two-character live regression (each profile records a same-named clip → switch, no cross-overwrite no cross-play; check the pending list in the library window); SPEC line 67 CHLB item gets checked only after the two-character live test. Handoff: `docs/HANDOFF-20260830-fix-d-profiles-backup.md`. No commit, no push, no release. Next package **FIX-E**.
