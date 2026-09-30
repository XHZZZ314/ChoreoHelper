# UI overhaul Package 1 — visual foundation (TASK-20260915-UI-P1-VISUAL-FOUNDATION)

## Objective and acceptance

Owner approved the merged five-package UI overhaul plan (INT-20260915-UI-OVERHAUL-P1) and started
Package 1: fix the visual foundation only — one font ladder, unified colors, a proper emergency
stop bar, an 8-color dancer palette and no inline font sizing — with zero behavior change.
Accepted ticket revision 3 (fast lane, R1, web-product, budgets 10 files / 600 lines / 60 min /
1 repair); AC-1..AC-6 as frozen in the ticket.

## Mechanism / red baseline

`web/test-design-tokens.js` (new permanent suite) was written first and run against the unchanged
tree: 22 of 24 assertions failed (only the twin-hash checks passed), recording the red baseline.
It asserts the ladder {12,13,14,16,20}px over every `font-size`/`font:` literal plus the absent
「字体放大」 override block, the color invariants (no rgba 0.18/0.3, no #2d5a8a/#4a9eff, accent
active without !important or the '●' hack), the 36px stop bar with filled danger button, the
8-entry palette with `idx%dancerColors.length`, zero `style.fontSize`/cssText-font-size in
choreo-app.js, and sha256 equality of the two dist twins.

## What changed and behavior preserved

- `web/choreo-helper-app.css` (full rewrite, every selector preserved): tokens `--radius`/`--radius-lg`;
  override block merged into main rules and deleted; category alpha 0.18→0.07 / hover 0.3→0.14;
  `.btn.active` on accent; stop bar 44→36px with `#immediateStop` filled red and status
  right-clustered; ruler 22→26px for 12px labels; new `.toolbar .btn`, `.transport .btn`,
  `.add-all-row`, `.act-empty` rules; `.clip.selected` gains a soft accent fill; `.clip .c-job`
  becomes an inline 12px suffix.
- `web/choreo-app.js`: dancerColors 3→8 same-brightness entries; makeDancer dynamic modulo;
  13 toolbar inline style sites + snapBtn cssText removed (CSS now sizes them); readButton,
  bAdd/bLA/bLB/bLX/bMk, bCp, addLy, marquee counter, drag tooltip, marker-flag labels all lose
  inline font-size; one pre-existing trailing whitespace at line 2589 removed (it broke the routed
  `git diff --check`).
- `web/dist/ChoreoHelper/` twins synced byte-identically (sha256-asserted by the suite).
- `choreo-helper-app.html` and `preview3d.js` byte-identical (guards: test-stop.js ordering
  assertion; preview3d already consumes the palette dynamically).

## Verification actually observed

- Gate RUN-...-R3 **passed** (9 checks, evidence binding on the pipeline-harness inputs):
  ticket-validation, pipeline-check (PASS after the continuity trim below), diff-whitespace,
  shell-structure 117/117, design-tokens 24/24, stop-behavior 20/0, clipcheck-sixtrack 20/0,
  offline-verify 50/0. `clipcheck-multidancer` 16/6 is monitoring-only (required:false):
  **A/B against the claim-time baseline reproduced the identical 16/6** — pre-existing catalog
  skill-identity gating blocks add-to-all clicks; root cause out of scope, kept as a named fact.
- Pure suites unchanged-green: engine 50/0, edit 402/0, check 94/0, projects 105/0, document 120/0,
  docwire 56/0, showcompiler 43/0, library 348/0. `node --check` clean.
- Measure (exact attribution): 2 changed scope files, +163/−199 lines, 8.6 run minutes — within
  every budget.
- Headless-Chrome visual self-check of the real dist page: stop bar filled red left + right
  cluster, ≥12px toolbar text, lightened action cards with color bars, no layout breakage,
  dark theme kept (five-point checklist, observed on the rendered page).

Two mid-run corrections, both evidence-first: R1→R3 re-claims were needed because the gate runner
requires a ticket-declared `gateEvidenceBinding` (and the frozen contract forbids post-claim edits);
byte-exact pre-change files were restored from the live roots (hashes match the R1 baseline
2c16b8cd… / a4388576…) before re-claiming, so R3's baseline is the true original. The
`defaultContextBytes` policy breach (24858 > 20000) was repaired by the mandated continuity
rewrite (AGENTS.md+README-AI+CONTINUITY = 19966 ≤ 20000; process-audit 25/25) — no policy file
edited.

## Out-of-scope findings for the owner

1. `pipeline-cli.js ticket <file>` passes only three arguments to `validateTicket` and drops the
   routing config, so every fast/micro-lane ticket fails it spuriously (closed GEARSET ticket
   fails the same way). Preflight/check/claim are unaffected. Scripts are protected — left unfixed.
2. clipcheck multidancer scenario: 6 pre-existing failures (skill-identity toast), identical on
   baseline bytes; needs its own repair ticket.
3. Two live roots still run the pre-Package-1 web files; deploying them is an owner-authorized
   per-file action per repo rules (rollback copies of the originals exist in both roots).

## Remaining owner tails and why

Live-root deployment of the two changed web files (needs explicit owner authorization per
AGENTS.md); the six standing tails in `.agent/CONTINUITY.md` are untouched by this package.

## Files changed

web/choreo-helper-app.css; web/choreo-app.js; web/test-design-tokens.js (new);
web/dist/ChoreoHelper/choreo-helper-app.css; web/dist/ChoreoHelper/choreo-app.js;
.agent/tickets/TASK-20260915-UI-P1-VISUAL-FOUNDATION.json (rev 3); .agent/CONTINUITY.md (mandated
current-state rewrite); .agent/modules/web-product/changes/CHG-…-UI-P1-VISUAL-FOUNDATION.json;
this handoff. Not deployed to devPlugins/game roots; no commit/push.
