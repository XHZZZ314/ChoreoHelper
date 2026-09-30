# 00: Audit Baseline and Unified Construction Rules

## 1. Authority Order

On conflict, judge in this order:

1. Current source code, tests, and direct run results.
2. Product goals and acceptance criteria in `SPEC.md`.
3. Confirmed facts in `.agent/CONTINUITY.md` that still match the source.
4. `docs/README-AI.md`, work plans, and historical handoffs.

Historical documents are evidence, not automatically executable instructions. When source and docs disagree, verify first, then fix the docs — never revert code to old behavior for the sake of "document correctness".

## 2. This Audit's Baseline

Actually executed 2026-08-30:

- Node pure-function tests: 322/322.
  - `test-engine.js`: 40/40.
  - `test-edit.js`: 85/85.
  - `test-check.js`: 73/73.
  - `test-projects.js`: 77/77.
  - `test-library.js`: 47/47.
- C# data-layer tests: 42/42.
- `scripts/library-verify.js` default full suite: 103/103; uses an isolated Chrome and the 48797 mock; does not control the real game.
- `scripts/clipcheck-run.js`: 108/108.
- `scripts/offline-verify.js offline`: 11/11.
- `scripts/offline-verify.js perf`: 6/6.
- Release Rebuild: 0 error, 6 warning.
- `git diff --check`: pass.
- The game was not running this round, so online, transition, sync, and real-game seek were not re-run; this counts as "environment unverified", not failure.

A green baseline means currently covered features show no obvious regression; it does not mean this audit's issues do not exist. In particular, `mode-check.html` currently mostly verifies "the request was sent" — it does not verify the plugin holds the current timeline, nor that seek froze the correct action.

## 3. Evidence Labels

Later handoffs must distinguish:

- **Reproduced**: observed via a harmless minimal example or actual run.
- **Statically confirmed**: control flow, data flow, or platform API behavior is sufficient to confirm; no dangerous side effect was triggered.
- **High-risk hypothesis**: mechanism is suspect; still needs the game online or stress conditions to verify.
- **Environment unverified**: cannot run because game, account, character, or external authorization is missing.

Never write "statically confirmed" as "passed live", and never write "game offline caused timeout" as code failure.

## 4. Current Deployment State

- Spot-checked product files match between `web/` and `web/dist/ChoreoHelper/`.
- devPlugins deploy location matches the source deploy location on spot-checked product files.
- The actual game directory differs from the source deploy location only in `skeleton-snapshot.js`: source/`web/dist` is 12925 bytes, game directory is 12923 bytes; all other spot-checked files match.
- `release/staging` is still the old 0.6.7 staging; usable only as a historical artifact, not releasable as current 0.7.1.
- Current branch is `main`; the working tree holds substantial owner-owned tracked/untracked changes. No one taking over may reset, clean, bulk-format, or commit them.

## 5. Fixed Flow for Every Package

### Step 1: Establish Minimal Failing Evidence

- Find the concrete entry point, callers, and final side effect.
- Add the minimal targeted test; when dangerous game writes are involved, test only policy/routing — never call the real endpoint.
- Record the expected pre-fix failure; do not repeatedly run unrelated full suites.

### Step 2: Fix the Root Cause

- Prefer extracting a Dalamud-free pure policy class or pure function so Node/C# data-layer tests can cover it.
- Keep existing public fields and old-data compatibility; when the protocol must change, bump `ProtocolVersion` and sync web capability checks and Chinese error messages.
- No incidental dependency upgrades or product-scope expansion.

### Step 3: Layered Verification

1. The new targeted tests.
2. Existing tests of affected modules.
3. Browser diagnostic pages / offline acceptance.
4. Release build.
5. When interfaces or game threads are involved, real-plugin live verification.

### Step 4: Deploy and Inspect

- Sync web changes to all three deploy locations.
- Inspect the final diff; keep only changes this package needs.
- Check for stray temp browser profiles, screenshots, logs, or real-model copies.

### Step 5: Handoff

A handoff must record at least: result, changed files, key design, migration behavior, actual verification numbers, unverified items, next step. When updating `.agent/CONTINUITY.md`, record only currently valid facts, not a diary.

## 6. Unified Prohibitions

- Never read or display the owner's real `pairing.json` contents.
- Never prove the vulnerability by reading real system files through the dangerous path; test with temp directories and pure path functions.
- Never call `/debug/boneprobe?action=rot` for verification.
- Never run scripts that auto-trigger actions/keys while the game is online, unless the owner explicitly starts live acceptance.
- Never delete `.bak` files, historical handoffs, `SPEC.md`, `AGENTS.md`, or `.agent/`.
- Never put personal Meddle models, clip libraries, project data, or pairing codes into release.
