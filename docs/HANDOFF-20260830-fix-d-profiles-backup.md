# HANDOFF — FIX-D: Per-Character Clip Isolation and Backup Format v2 (AUD2-008/009, P1)

Date: 2026-08-30. Version still **0.7.1** (web-only changes, zero C# changes, DLL not built not deployed).
Previous package: `docs/HANDOFF-20260830-fix-c-recording-integrity.md`. Work package: `docs/AUDIT-20260830-code-repair/04-FIX-D-PROFILES-AND-BACKUP.md` (build log appended at end of file).

## 1. What was fixed (plain language)

**Problem 1 (AUD2-008): clips are not per-character; same names overwrite each other.** After character profiles shipped, model and skeleton are per-character, but clips remain "one flat list for the whole library" — two characters both recording `/bow`: the later recording overwrites the earlier one, and switching characters can play the wrong body's data.
**Fix**: clip identity becomes "which character + clip name". The browser library upgrades to v2 (two new per-profile stores), and all clip APIs accept "specify profile", defaulting to the current one. Old clip data auto-migrates on first use: clips uniquely matched via their "recording-time skeleton fingerprint" are auto-assigned to that character; unmatched ones (no fingerprint, multiple profiles sharing a skeleton) go into a 「待归档」 (pending-assignment) list — **they are never silently assigned to the current character** — owner claims them via checkboxes in the library window. Health-check missing-recording detection, 3D panel cache, and plugin re-pull into the library all automatically switch to "current profile" semantics.

**Problem 2 (AUD2-009): backups lose clip attribution and under-validate models.** In the old backup (CHLB v1), all clips share one skeleton stamp; a multi-character backup exported and re-imported attributes every clip to a single body; import also doesn't validate the model files themselves.
**Fix**: backup format upgraded to **CHLB v2** — each clip carries "which character + recording-time skeleton fingerprint", and each model file carries a content checksum. v2 import first preflights the **entire package** (clips decompress, structure valid, hashes match, skeleton fingerprints match, gltf-referenced model.bin present as a set); **only if everything passes does it touch the library** — one bad item rejects the whole package and the original library is untouched. Old v1 backups still import (read-only compatibility): a single profile in the backup → clips go to it; multiple profiles → clips go to pending. Additionally, loading a model from a profile now passes three gates: checksum matches, file parses, model bones compatible with that profile's skeleton — fail any → don't mount; show the stand-in with a Chinese-language reason.

## 2. Changed files

| File | Change |
|---|---|
| `web/choreo-library.js` | IndexedDB v2 (profileClips/profileClipData composite-key stores) + old-data auto migration + all clip APIs gain optional profileId + new APIs (pendingClipIndex/assignPendingClips/getProfileFileInfo) + CHLB v2 export/import (whole-package preflight, v1 compatible) + stats/clear/repairOrphans cover the new stores |
| `web/preview3d.js` | Clip cache keys include profile id; profile model loading gains hash validation + checkModelCompat compatibility gate; incompatible shows the reason and falls back to the stand-in |
| `web/choreo-helper-app.html` | Library window gains a 「待归档动作」 (pending clips) area (checkbox + pick profile + assign/delete); import toast reports the pending count |
| `web/library-check.html` | Skeleton created before recording clips (so attribution holds); section ⑨ profile-isolation assertions; foreign-body import assertions switched to profile semantics |
| `web/test-library.js` | Fake IDB supports composite-key stores (getAllKeys returns array pairs matching real IDB); 47→**71** items |

## 3. Verification (all actually executed)

- Node: test-library **47→71/71** (four new sections: same-name clips isolated per profile / migration three states + claiming + same-fingerprint no-guessing / CHLB v2 dual-profile same-name round-trip / bad package wholesale rejection + forged fingerprint rejection + v1 single/multi-profile attribution); five suites **40/87/73/77/71** all green; app html inline script syntax OK.
- Browser (game online): **library-verify all 106/106** (real plugin online, full path); **offline-verify 27/27** (incl. online real model / transition auto-recovery / perf — the preview3d changes did not break the real pipeline); **lib-check LIB-PASS**; mode-check / clip-check PASS.
- Deployment: md5 consistent across the four locations (source web\dist / devPlugins / game dir) — choreo-library=fffc72fd…, preview3d=5b2e76c8…, app html=06a57ae2…, library-check=b64eaff5….
- `git diff --check` clean; zero C# changes, so no rebuild needed.

## 4. What owner needs to know / TODO

1. **Old clips auto-migrate on next page open**: matchable ones file into profiles automatically; the few without fingerprints land in the library window's "pending" list — check + pick character + 「归档所选」 (assign selected), done in one click. Until assigned, the health check honestly reports these clips "missing recordings" — expected, not broken.
2. **Two-character live acceptance (final step of this package, left to owner)**: record the same-name clip once in each of two character profiles (e.g. /bow), switch back and forth, confirm the 3D view plays each one's own data with no cross-overwrite; also glance at the pending area in the library window. After verifying, check SPEC line 67 (CHLB backup item).
3. Backup files (.choreolib) are now format v2; old v1 backups still import. A v2 backup **cannot** be imported by old programs (it shows a version-unsupported notice).
4. Next work package **FIX-E** (AUD2-010: thread ownership and service-shutdown draining, last P1 package); after that OPT-F (P2) → RELEASE-G. No WP-5 until P0/P1 are cleared.

## 5. Intentional deviations and boundaries

- v2 import changed from "skip bad entries and continue" to "reject the whole package" (the literal requirement of work-package item 4; stricter, not looser); v1 keeps the old per-entry semantics.
- Pending clips also export with v2 backups (profileId=`__pending__`); after import they are still pending — no data loss.
- Clip sharing: two profiles with identical skeleton fingerprints (same body) still store their clips separately (per-profile isolation, no implicit sharing); an explicit "shared layer" would be future work.
- Migration moves only old clips with "metadata + data both complete"; half entries are covered by repairOrphans; a per-entry migration failure keeps the old data in place for retry next time (idempotent).

Not committed, not pushed, not released (awaiting owner authorization).
