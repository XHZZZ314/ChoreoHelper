# HANDOFF 2026-08-30: Character Profiles (model+skeleton managed as a set; prevents wrong-body mismatch on character switch)

> **Closure (same day, 2026-08-30)**: owner imported the desktop restore bundle, created the 「巧克力歌剧院」 profile and passed live acceptance — **「功能OK了」** ("it works"). Owner feedback: **switching/loading feels a bit slow** (each switch runs hardReset → re-pull skeleton/model/clips full chain, a known design tradeoff), recorded as an optimization candidate (e.g. in-memory profile-model cache / switch without full rebuild), not scheduled. Rest below.

## Background and root cause (confirmed same day)

- After owner switched character/race, the "model looks different". Investigation pinned it: **not a model-file or code change** — the game's `/export/skeleton` went from 101 bones to **106 bones** (5 extra tail bones n_sippo_a~e), and shared-bone displacement ratios 0.44~2.76 fully scrambled (completely different body shape).
- Old code silently treated the online skeleton as the reference ruler: scaled the old model by the new skeleton and backfilled old clips → model proportions completely broken (panel showed 101/106, unit ratio 1:0.626, head height 1.56m; normal is 101/101, 1.66m).
- This was the first real bite of the SPEC section 3 gap: "race/gender change must not silently apply the wrong skeleton".
- Owner decided to build full **character profiles** (multiple model+skeleton sets, switchable + explicit mismatch notice + health-check linkage).

## What was implemented (version still 0.7.1, zero C# changes)

### choreo-library.js (core: profile layer)
- **Profile = model files + skeleton source stored as one set**. Storage reuses existing stores (**no IndexedDB version bump**): profile body in meta (`id='profile:<pid>'`, skeleton inline ~13KB), model files in files (key `pfile:<pid>:<filename>`), active pointer in meta `activeProfile`.
- **Old-data auto migration**: on first access the old single skeleton+model moves into a "default character" profile; model files are **moved, not copied** (112MB not doubled); old bare keys (meta.skeleton, model.* in files) removed; an empty library creates no profile (waits for first online session).
- New APIs: `listProfiles / createProfile / deleteProfile / renameProfile / getActiveProfile / setActiveProfile / getProfileFile / putProfileFile`.
- **All old APIs became thin wrappers over the "active profile"** (getSkeleton/getSkeletonInfo/putSkeleton/getModelFile/putModelFile/getModelFiles/deleteModelFiles); call sites such as the app html health-check ctx need zero changes and automatically follow the profile. `putSkeleton` semantics upgraded to auto-matching: same fingerprint merges into that profile; different fingerprint creates a new profile and switches.
- **Backup (CHLB) upgrade**: header gains `profiles` (each profile's skeleton source embedded; model files ride along in files); header.skeleton still written with the active profile's skeleton (old programs can read the main skeleton). Import no longer rejects wholesale on skeleton mismatch — **same fingerprint merges into that profile, different fingerprint creates a new profile** (mismatch protection now via fingerprint stamping + health-check reminders); bad entries still rejected per-entry. Imported clips get stamped with the "backup skeleton" fingerprint (follows the body, not the current profile). A brand-new library auto-activates the backup's main profile after import.
- **Fixed a real race**: concurrent write-back of gltf/bin into a profile — "read profile → edit manifest → write back" overwrote each other (e2e observed modelNames loss) → putProfileFile now does **read-modify-write inside a single transaction**.
- **Test fake backend fixed to match**: test-library's FakeIDB dispatched requests with forEach and **did not execute requests appended inside onsuccess callbacks** (real IndexedDB allows this) — putProfileFile's same-transaction read-modify-write silently lost writes on the fake DB. Switched to an index loop; semantics aligned with the real DB.

### preview3d.js (profile flow + UI)
- **Skeleton matching** (init, plugin online): game skeleton hash matches a profile → auto-switch to it (zero clicks on character change; status bar marks "auto-matched"); fresh install with no profiles → auto-create 「角色 1」 (Character 1, keeps the old zero-click experience); **profiles exist but none match → keep the current profile, never apply a wrong one**, panel shows an explicit notice + "Adopt game character" button.
- **Model compatibility gate `checkModelCompat`**: a deploy-slot model is adopted only if **all bone names match + unit-ratio median within 0.8~1.25** (same-source export ≈1:1); on mismatch it is never applied (this is the root-cause gate for this incident). A profile's own model takes precedence over the deploy slot; if neither exists, use the stand-in with an honest notice.
- After compatible adoption, auto write-back into the profile (re-export after gear change → page picks up the new model automatically; equivalent to the old "deploy-slot-first" workflow).
- **Panel UI**: bottom 「角色」 (Character) dropdown (profile name + bone count + has-model; switching = hardReset rebuild) + "Adopt game character (N bones)" button (appears only on mismatch; creates a profile from the game skeleton and switches; stand-in model until a matching model exists).
- `__p3dDebug()` gains `profile / mismatch / modelNote`; new hook `__p3dProfilesChanged()` (panel auto re-matches/rebuilds after the library window adds/removes/edits profiles).

### choreo-check.js / app html
- Rules 7/8 text now mentions character profiles/switching/adoption; logic and thresholds unchanged (health-check ctx skeleton fingerprint automatically comes from the active profile).
- 📦 Library window adds a profile list (name/bone count/model/usage + rename/delete); backup import toast reports profile count; panel notified to re-match after import/clear.

## Verification (actually run 2026-08-30)

- Node unit tests: test-library **26→47** (5 new sections: profile migration / create-and-switch / concurrency race / multi-profile backup round-trip / foreign-body backup creates profile), test-engine 40, test-edit 85, test-check 73, test-projects 77 all green; app html inline script syntax OK.
- Headless regression: offline-verify offline **11/11**, mode-check PASS, clip-check **108/108**, library-verify **lib-check PASS** (new "foreign-body backup creates new profile" assertion passed).
- **End-to-end (real game 48795 + CDP intercept of /export/skeleton simulating a character switch)**:
  - Simulated 106-bone foreign body → auto-created 「角色 1」 profile, deploy-slot old model rejected (「骨骼 101/106 · 单位比 1:1.00，未采用」 = "skeleton 101/106 · unit ratio 1:1.00, not adopted"), panel on stand-in + warning, **no more visual corruption**;
  - Simulated the original 101-bone character → deploy-slot real model adopted normally, 101/101, unit ratio 1:1.00, model file written back into the profile (offline=false).
- Deployment md5 consistent across the four locations: choreo-library=b48cb8f7, preview3d=cf13b3c8, choreo-check=e0e89de7, app html=1a90dd18, library-check=a30c56cb.
- Verification script kept on record: `scripts\profile-look-check.js` (no args = simulate foreign body; `compat` = simulate same body; CDP intercepts the skeleton, never touches the real game, one-shot browser profile).

## Known boundaries / TODO

- **Owner live acceptance**: after reopening the page the 「角色」 (Character) dropdown and profile names should appear; on character switch the panel auto-matches or explicitly shows the mismatch.
- **Owner's current library is in a polluted state** (the page was opened yesterday while the new character was active: library skeleton = new character's 106 bones, model files = old character) — migration inherits that pairing as-is, **visually still broken**, expected. Fix path unchanged: owner Meddle-exports the new model → deploy → refresh page → auto-pairs.
- **Old character archive covered (owner that day: 「不留档怎么随便切换」 "how can you switch freely without keeping an archive")**: `scripts\make-restore-bundle.js` packs the deploy-slot snapshot skeleton + old model into a restore bundle at `C:\Users\xhz\Desktop\老角色档案-巧克力歌剧院.choreolib` (101 bones + gltf/bin, fingerprint 8eb69d0c…); owner selects it via 「📥 导入备份」 (Import backup) to make it an official profile (new fingerprint → auto-creates a new profile; switch to it in the 3D panel Character dropdown after import). `scripts\restore-bundle-check.js` end-to-end **8/8** passed: empty-library import → reopen offline → real model 101/101 not stand-in, profile name correct. **Pitfall on record**: CDP evaluate with large base64 must be **chunked** (single multi-MB strings get corrupted), and `Uint8Array.from(atob(s))` without a charCodeAt mapping yields all zeros (chars taken as values, NaN→0). The restore bundle doubles as the archive of the old model files — after a new model overwrites the deploy slot, it can always be recovered from it.
- Old character profile via seeding (rebuild from skeleton-snapshot.js + old model) only if owner asks. (→ covered by the restore bundle)
- The game API provides no "real character config ID"; profile identity = skeleton SHA-256 fingerprint (same-family gear change keeps the fingerprint; model refresh handled by the compatibility gate). SPEC's parenthetical updated; item remains unchecked (no real ID).
- online/transition/sync real-plugin regressions pending owner logging in a character + new model deployment (that day the game had no character logged in, "no player").
