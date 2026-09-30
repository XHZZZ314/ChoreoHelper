# Installation and startup: active owner scope

## Web entry and install self-check (2026-09-15)

> **Status correction (2026-09-27, TASK-20260927-RELEASE-P2 Phase A, offline):** the
> 2026-09-25 block below is stale on the plugin wiring. `src/Plugin.cs` has since been
> recovered (TASK-20260925-PLUGIN-CS-RECOVERY, closed 2026-09-25: isolated Release build
> exit 0 / zero errors) and it registers `/choreo pair` in source (`Plugin.cs:260`; the
> persisted code is printed at startup, `:182`, and named in the help text, `:173`).
> `/choreo web` stays removed (no such command in source; the web entry remains opening
> `dist/ChoreoHelper/choreo-helper-app.html` directly by double-click). What is still
> NOT proven: the in-game pairing handshake (typing `/choreo pair`, reading the code,
> web-to-plugin authenticated read) — that needs the game open with the plugin loaded
> and stays an owner step (Phase B of the P2 batch covers only the packaging-side HTTP
> probe when the game is open at dispatch; it never operates the game). The staging
> README template's "pairing unavailable" note is therefore stale relative to the
> source recovery and may only be reworded with pairing-handshake evidence. The
> 2026-09-25 record below is preserved as history. Evidence:
> `.agent/evidence/TASK-20260927-RELEASE-P2/phase-a-impl-20260927/`.

> **Status correction (2026-09-25, TASK-20260925-RELEASE-P1 G7, remove-path taken):** the
> 2026-09-20 recovery lost this wiring. The recovered `src/Plugin.cs` is truncated (constructor
> cut mid-body; command registration, startup pairing print, install self-check and panel wiring
> all absent), the C# tree carries broader recovery damage (8 files with truncation syntax errors
> plus a missing `X1GameInputSnapshot` type; isolated Release build = 9 errors), and the C# test
> projects do not compile for the same pre-existing reasons. `/choreo web` does NOT exist in the
> current plugin source; `src/WebEntry.cs` (zero non-test call sites) was removed as dead code in
> this batch and the staging README template no longer instructs it. The web entry today is
> opening `dist/ChoreoHelper/choreo-helper-app.html` directly (double-click). The 2026-09-15
> record below is preserved as history; restoring the wiring needs its own repair batch with
> in-game verification. Evidence: `.agent/evidence/TASK-20260925-RELEASE-P1/impl-20260925/`.

Owner direction: advance the installation/startup mainline item now; real performance/show
acceptance is deferred to a later concentrated round. Registered
INT-20260915-STARTUP-WEB-ENTRY. Confirmed gap from source: the pairing chat message told players
to "open the web page" but the plugin offered no in-game pointer or launcher to
`dist/ChoreoHelper/choreo-helper-app.html` (fresh installs required manual file-explorer digging),
and startup performed no install self-check — a DLL-only install (the README says copy the whole
folder) failed silently with zero guidance. Publish-side work (GitHub Pages/Releases, custom
plugin-repo manifest) stays closed behind `DESIGN-local-authorization` and owner publication
authorization; nothing here publishes.

Implemented (no new clock/player/console; reuses the existing command and panel surfaces):

- New pure `src/WebEntry.cs`: resolves the local web entry under the plugin directory
  (`dist/ChoreoHelper/choreo-helper-app.html`), verifies the entry plus first/last loaded script
  siblings (`choreo-app.js`, `choreo-bootstrap.js`) exist, and either returns a `file://` URL or a
  Chinese guidance string containing the expected path (invalid/relative/missing-directory
  variants covered). Read-only, no process launch, no game output.
- `/choreo web` chat command (help text and usage line updated): opens the resolved local page in
  the default browser via `Process.Start(UseShellExecute)`; on failure or missing files it prints
  the guidance with the expected path. The startup pairing message now points to `/choreo web`.
- One-time startup install self-check: when the entry is missing, plugin load prints an
  "安装不完整" warning with the expected location; successful installs keep the existing two chat
  lines (plus the reworded pairing hint).
- StageGamePanel gains an optional `openWeb` callback (wired in `Plugin.cs`) and a
  「打开网页（编排 / 配对 / 结果）」 button next to the version line; it never touches stage
  command routing or identity-bound queued commands.
- `scripts/make-release-staging.js` README template now leads first-use with `/choreo web` and
  adds a troubleshooting hint for DLL-only installs. No web product file changed, so no dist sync
  was needed; the three roots already carry the current web bytes.

Verification: red baseline = `WebEntryTests.cs` registered before the class existed (build failed,
11 errors, `red-build.log`); after implementation the full data-layer suite passed 3124/0
(baseline 3115, +9 web-entry checks: valid layout file:// URL, no guidance on success, trailing
separator, space-encoded URL, missing entry names devPlugins + expected path, missing sibling
names the file, null/empty/relative/nonexistent directory rejections, temp cleanup). Plugin
Release build 0 warnings/0 errors (`plugin-release-build.log`). `test-release-gates.js` 33/33;
staging script syntax checked. Real-layout check: the installed devPlugins root contains all three
required files beside the DLL.

Install: the game/plugin was not responding on 48794 at install time (cold install; no output
owner possible), so the built DLL was backed up and installed to the devPlugins root with
before/after SHA256 (`dll-install.json`): before `8730F3D5BCC452138D70C0477A36ECC7A5BD8AF9431C9A422AE2AC16B35D203D`
(matches the previously recorded live DLL), after `AE12B0DC40EB7FF9632A0E6F16C1E36099FC97B3A7FBA4DD602E1A853C07BB72`
verified equal to source. The plugin reloads it on the next game start; the in-game `/choreo web`
button/chat flow is then exercised in the owner's next session (no game output was issued this
round). Evidence root: `D:/choreo/startup-web-20260915-101534/`.

Remaining installation/startup work (owner-gated): public site + plugin ZIP publication and the
custom plugin-repo manifest (needs `DESIGN-local-authorization` ticket + publication
authorization), real plugin-zip install over a live root (explicit owner action), old-project
migration/compat-hint polish, and the 30-second built-in demo quality bar. The deferred
performance/show acceptance list is unchanged.
