# ChoreoHelper Second Code Audit Repair Packages (2026-08-30)

This folder is the entry point for the 2026-08-30 re-audit of `SPEC.md`, `.agent/CONTINUITY.md`, and current source. It does not replace the product roadmap; it splits security, correctness, data-integrity, and performance issues newly found before WP-5 into packages that can be claimed and verified one at a time.

## 1. Conclusions First

- v0.7.1's offline editing, 3D preview, recording center, multi-project editing, and choreography check foundations are usable.
- 2 release-blocking P0 issues remain, plus P1s: game seek, command boundaries, recording disk writes, per-character clip isolation, thread lifecycle.
- Old audit items `AUD-001~AUD-021` were handled in their original work packages; that does not mean no new issues appear afterwards. New numbering in this folder uniformly uses `AUD2-xxx`.
- Fix order must be: `FIX-A → FIX-B → FIX-C → FIX-D → FIX-E → OPT-F → RELEASE-G`. While P0/P1 are uncleared, do not enter WP-5 and do not build a releasable package.
- This round only wrote construction docs: no business source changes, no commit, no push, no release.

## 2. File Navigation

| Order | File | Purpose |
|---|---|---|
| 0 | [00-BASELINE-AND-RULES.md](00-BASELINE-AND-RULES.md) | Authority order, current baseline, work discipline, unified definition of done |
| 1 | [01-FIX-A-LOCAL-API-SECURITY.md](01-FIX-A-LOCAL-API-SECURITY.md) | P0: path escape, pairing-code leak chain, dangerous debug endpoint |
| 2 | [02-FIX-B-GAME-SEEK-AND-COMMANDS.md](02-FIX-B-GAME-SEEK-AND-COMMANDS.md) | P1: game seek timeline sync, event semantics, command length |
| 3 | [03-FIX-C-RECORDING-INTEGRITY.md](03-FIX-C-RECORDING-INTEGRITY.md) | P1: disk-write-before-quality-check recording, long-uptime timing precision |
| 4 | [04-FIX-D-PROFILES-AND-BACKUP.md](04-FIX-D-PROFILES-AND-BACKUP.md) | P1: per-character clip isolation, CHLB v2, model compatibility |
| 5 | [05-FIX-E-THREADING-AND-LIFECYCLE.md](05-FIX-E-THREADING-AND-LIFECYCLE.md) | P1: Dalamud thread ownership, request draining, hot reload |
| 6 | [06-OPT-F-PROJECTS-AND-PREVIEW.md](06-OPT-F-PROJECTS-AND-PREVIEW.md) | P2: IndexedDB transactions, profile-switch and 3D resource optimization |
| 7 | [07-RELEASE-G-DOCS-DEPLOY.md](07-RELEASE-G-DOCS-DEPLOY.md) | P3: status docs, three deploy locations, warnings, release gates |
| 8 | [08-REGRESSION-MATRIX.md](08-REGRESSION-MATRIX.md) | Automatic/live regression matrix each package must actually run |
| 9 | [09-NEXT-DEVELOPMENT.md](09-NEXT-DEVELOPMENT.md) | How to enter WP-5~WP-10 once fixes are cleared |
| 10 | [10-LOW-PRIORITY-BACKLOG.md](10-LOW-PRIORITY-BACKLOG.md) | Potential defects and maintenance candidates not promoted to blockers; re-check each later |

## 3. Issue Summary

| ID | Priority | Issue | Package |
|---|---|---|---|
| AUD2-001 | P0 | 48795 clip file names allow Windows absolute path / backslash escape | FIX-A |
| AUD2-002 | P0 | `/debug/boneprobe` is a pairing-free GET that writes game bones directly | FIX-A |
| AUD2-003 | P1 | seek sends only a time; plugin may use an empty or stale timeline | FIX-B |
| AUD2-004 | P1 | seek mixes actions, job switches, lyrics; dragging can trigger side effects | FIX-B |
| AUD2-005 | P1 | single game command has no byte/format cap; oversized input can freeze the game | FIX-B |
| AUD2-006 | P1 | recording overwrites disk first; web quality check runs afterwards | FIX-C |
| AUD2-007 | P1 | recording absolute time uses `float`; longer uptime means slower sampling | FIX-C |
| AUD2-008 | P1 | character profiles isolate only model/skeleton; clips still override globally by name | FIX-D |
| AUD2-009 | P1 | CHLB v1 loses per-clip profile ownership; profile models lack a load gate | FIX-D |
| AUD2-010 | P1 | game objects accessed cross-thread; service shutdown never waits for in-flight work to drain | FIX-E |
| AUD2-011 | P2 | project storage treats request success as transaction commit | OPT-F |
| AUD2-012 | P2 | profile switching repeats fetch/hash/parse; partial resource disposal is incomplete | OPT-F |
| AUD2-013 | P3 | README/CONTINUITY/deploy locations/staging/warning status are inconsistent | RELEASE-G |

## 4. Claim and Handoff Rules

1. Claim one package at a time; `FIX-B~FIX-E` all touch core playback or the data protocol — do not modify the same files in parallel.
2. Before starting, read `AGENTS.md`, `docs/README-AI.md`, `SPEC.md`, `.agent/CONTINUITY.md`, this file, and the relevant package file.
3. First record `git status --short`. The working tree holds substantial pre-existing uncommitted owner content; cleaning, reverting, or overwriting it is forbidden.
4. Write a targeted test that exposes the problem before fixing the root cause; never go green by loosening assertions, deleting tests, or swallowing exceptions.
5. After modifying web product files, sync all three deploy locations and verify hashes per `08-REGRESSION-MATRIX.md`.
6. Acceptance involving game memory, keys, or action execution must wait for the game to be online and the owner to explicitly start it; automated scripts must not touch the real game by default.
7. At each package's end, update `.agent/CONTINUITY.md`, create the corresponding handoff, and record actual commands run and numbers; no commit/push/release without authorization.

## 5. Global Exit Gates

Only when all are met can this repair package set be marked complete:

- [ ] AUD2-001~AUD2-010 all fixed with regression tests.
- [ ] All P0/P1 automatic regressions pass.
- [ ] Real-plugin online, transition, sync, and real-game seek live verification pass.
- [ ] Two characters with different skeletons can save same-named clips; after switching, no cross-overwrite and no cross-playback.
- [ ] Old CHLB v1, old IndexedDB, and old project drafts all have clear, tested migration behavior.
- [ ] Product file hashes identical across source web files, `web/dist`, devPlugins, and the actual game directory.
- [ ] Release rebuild 0 error; existing warnings each handled or kept with a documented justification.
- [ ] `SPEC.md`, `docs/README-AI.md`, `.agent/CONTINUITY.md` consistent with code and deployment state.
- [ ] No new secrets, real personal models, or owner local data enter release staging.
