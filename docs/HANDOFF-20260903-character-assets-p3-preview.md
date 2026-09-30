# HANDOFF — Multi-skeleton multi-model preview with per-dancer fallback (character assets P3)

Package: TASK-20260903-CHARACTER-ASSETS-P3-PREVIEW (revision 2, R3, standard lane, tags
cross-module/character-assets) · Run RUN-20260903-CHARACTER-ASSETS-P3-PREVIEW (completed,
1 worker repair attempt) · 2026-09-05 · Modules: web-product · Reviews: module + global,
both APPROVE against gate GATE-RUN-20260903-CHARACTER-ASSETS-P3-PREVIEW-R3.

## Objective and acceptance

Design-doc sections 6 and 4 slice on the closed P1/P2 state: the 3D preview replaces its
single modelRoot flow with a master table keyed by skeleton fingerprint — exactly one parsed
model master per distinct resolvable bound skeleton, every dancer's rig cloned from its
matching master, per-dancer fallback to the built-in stand-in with Chinese per-dancer notices
across the full section-4 matrix, clip resolution profile-scoped per dancer (one action name
never shared across skeletons; game-served recordings cached only into the
fingerprint-matching profile), and online skeleton refresh isolated to the matching master.
It also lands the minimal per-dancer binding entry that P1/P2 deferred to the P3 surfaces:
exactly one dancer-row select writing `dancer.profileId` through the existing edit path.
Sessions with no bindings anywhere stay byte-equivalent to today's single-master behavior.
AC-1..AC-11 all passed via gate R3 plus the two review lanes; counts and probes below are the
accepted evidence.

## Mechanism / red baseline

`ChoreoEdit.pure.planRender` / `setDancerBinding` did not exist at the claim baseline (export
undefined — 2 red failures in the new `web/test-edit.js` suites) and the dancer row had no
binding control. Repair-1's red mechanisms, verified against the claim baseline blobs: (a)
`importBundle.ensureProfileFor(skel,name)` never reused a freed backup id, so a
deleted-then-restored profile came back under a fresh id and the binding stayed missing
(AC-9); (b) `__p3dProfilesChanged` had no oldIds snapshot, so a known-profile-set change
while bindings existed never triggered a rebuild (notification dead-end for both delete and
backup-restore routes).

## What changed and behavior preserved

- `web/choreo-edit.js` (+83): new pure members — `planRender(dancers, knownProfileIds,
  activeProfileId, profileRecords, onlineFingerprint)` returning the ordered per-dancer plan
  plus the master table (one master per distinct resolvable fingerprint; same-profile and
  same-fingerprint dancers collapse; missing/no-active/skeleton-unresolvable cases resolve to
  the stand-in master with an explicit reason; a skeletoned model-less profile keeps its own
  fingerprint master with reason `no-model` so deploy-root serving survives); 
  `setDancerBinding` (known id sets the same-name string, empty clears the key back to the
  P1 binding-free shape, anything else rejected with zero change); repair-1's
  `profilesChangedNeedsRebuild` (order-insensitive known-set compare).
- `web/choreo-app.js` (+63): exactly one per-dancer `.dh-prof` select on the dancer row —
  follow-active default plus current known profiles only, a never-writing `⚠ 绑定已失效`
  sentinel for stale values, riding the same saveHistory+render path as solo/mute; notifies
  `__p3dBindingsChanged`.
- `web/preview3d.js` (+549/-119): master table keyed by fingerprint; the primary master is
  the existing single-master variable set and no-binding sessions take a fast path that never
  invokes the planner (AC-7); extra masters build from their own profile skeleton+models
  through the unchanged three gates; rigs clone their own master; per-dancer Chinese notices
  cover the section-4 matrix (foreign-fingerprint notices show bone count + fingerprint and
  keep the profMismatch posture: profile kept, adopt control unchanged); clip cache keys by
  resolved profile; game-served write-back only into the hash-matching profile;
  `__p3dProfilesChanged` rebuilds on known-set change while bindings exist; P2 import
  refresh and the binding patrol cover the remaining rebind paths; PREVIEW-1 generation
  checks guard every per-master async path; `__p3dDebug().masters` is a read-only view.
- `web/choreo-library.js` (+28/-2): read-only `getProfile(pid)` (full record incl. inlined
  skeleton or null — required to build a non-active master against its own skeleton) and
  repair-1's `ensureProfileFor(skel,name,wantId)` backup-id reuse. This deviates from the
  ticket's expected-zero-diff note; the module review confirmed both additions are the
  minimal implementable surface and accepted them (finding, non-blocking).
- `web/choreo-helper-app.css` (+2) and the two test files (`web/test-edit.js` +151,
  `web/test-library.js` +33, purely additive — zero deleted lines, no pre-existing assertion
  modified). All five product sources byte-identical to their `web/dist/ChoreoHelper` twins
  (SHA-256 in gate `scope:dist-twin-identity`); no live install root touched.

## Verification actually observed

Gate R3 passed all 15 testPlan commands + scope/budget checks: engine 47/0, edit 212/0
(incl. §16 binding-setter, §17 planner matrix a–i + clip-namespace + purity, §18 repair
guard +6), check 83/0, projects 105/0, document 110/0, docwire 54/0, showcompiler 42/0,
library 152/0 (incl. §九 getProfile, §二十五 id-restore +5), shell 45/0; `offline-verify
all` 50/0; `library-verify all` 150/0 on the real 48795 plugin; `clipcheck-run` 148/0;
`pipeline-cli check` PASS (context bytes 15992 ≤ 16000); `process-audit --check` 25/25;
`git diff --check` clean. Browser evidence on the real `file://` dist page: the R1/R2
70-assertion matrix over AC-2/3/4/5/6/8/10 scored 67/70 — the 3 failures were the AC-9
notification-route gaps that repair-1 fixed; the post-repair focused AC-9 probe
(`browser-probe-r3-ac9.json`) scored 8/8 using notification-only routes (delete →
stand-in+missing-profile with document byte-unchanged, backup re-import restores the original
profile id, notification-only rebind, document byte-stable end to end). The full matrix was
not re-run verbatim on post-repair bytes; both reviews independently localized the repair to
three confined spots and verified the routed boundaries on the final normalized diff
(AC-8 generation guards on every per-master async path; AC-10 no new endpoint/upload).

Gate history: R1 failed (plan-10 game-closed environment + AC-9 product gap), R2 failed
(plan-13 context budget 16021 > 16000, closed by the owner-authorized continuity trim
`owner-direct-maintenance-continuity-trim.md` → 15992; AC-9 still failing pre-repair),
repair-1 fixed both AC-9 root causes, R3 green. Budgets: 12 CHG files (≤ 20), single-copy
product footprint +909/−121 (≤ 1200), 1 repair (≤ 2), ~87.8 active minutes (≤ 90). The
measured lock-scope figure (+2769/−236) exceeds the 1200-line budget and is recorded as a
`RUN_LINE_BUDGET_EXCEEDED` warning: the measure counts the AC-11-mandated byte-identical
dist twins (every source line twice) plus `.agent/evidence/**` artifacts. Both reviews
confirmed the overrun is accounting, not scope creep, and routed twin-aware budget
accounting to the pending budget-semantics decision (see tails). Temporary CDP/gate harness
lived outside the repo and was deleted; durable evidence is under
`.agent/evidence/TASK-20260903-CHARACTER-ASSETS-P3-PREVIEW/`.

## Remaining owner tails and why

- [TAIL:CHARASSETS-P2-LIVE] broadened to the combined character-assets deploy unit: both live
  roots still carry pre-P2 web bytes and all probes used synthetic fixtures. Next authorized
  deploy: copy the five twin pairs into each live root as one unit, import one real Meddle
  export, and exercise one two-profile multi-master session; REQ-SPEC-054 needs that real
  acceptance, REQ-SPEC-056 additionally waits for the P6 1–8 dancer sweep (P4 namespace,
  P5 share, P6 acceptance stay DEFERRED — owner enable decisions).
- INT-20260905-CONTEXT-BUDGET-RAISE stays open: the owner decided to raise the frozen context
  budgets structurally instead of further doc trimming; PIPELINE-POLICY.json is protected, so
  the raise plus the twin-aware budget-accounting question route to a queued process package
  (Planner/QA intake), not a direct edit here.
- Non-actions: no live-install copy, no release-staging rebuild, no generated-asset
  regeneration (none changed), no commit/push/publish in this run.
- Rollback: revert the twelve files below as one unit. P3 writes no store schema and no
  document shape; bindings are P1 keys a pre-P3 build already round-trips (it renders
  single-master and ignores bindings for rendering), so rollback needs no data conversion and
  leaves every document and library record byte-unchanged.

## Files changed

Run-attributed single-copy footprint +909/−121 across 7 source files (12 counting the 5
byte-identical dist twins): `web/preview3d.js` (+549/−119), `web/choreo-edit.js` (+83),
`web/choreo-app.js` (+63), `web/choreo-library.js` (+28/−2), `web/choreo-helper-app.css`
(+2), `web/test-edit.js` (+151), `web/test-library.js` (+33) plus their
`web/dist/ChoreoHelper/` twins. Full detail:
`.agent/modules/web-product/changes/CHG-TASK-20260903-CHARACTER-ASSETS-P3-PREVIEW.json`;
gate rounds R1–R3, both reviews, browser probes and the worker baseline/repair notes under
`.agent/evidence/TASK-20260903-CHARACTER-ASSETS-P3-PREVIEW/`.
