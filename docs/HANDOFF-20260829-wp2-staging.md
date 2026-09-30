# HANDOFF: v0.6.7 WP-2 Public Build & Release Staging (2026-08-29)

> Previous handoff: `docs\HANDOFF-20260829-v067-security.md` (WP-1 security, closed).
> This package = WP-2 of `docs\WORKPLAN-20260829.md`. **Local staging only — no remote created, nothing released** (requires the owner's explicit authorization).

## 1. What This Package Did (one-liner)

Built `scripts\make-release-staging.js`: one command produces a clean install package ready to hand to other players (site zip + plugin zip + checksums + install instructions). The public package forces the stand-in model, only takes files from a whitelist, generates snapshots on the spot, and has a privacy scan as the final guard.

## 2. How to Use (repackaging flow)

```
Prereqs: ① game running (snapshots must be generated live) ② Release already built:
     "C:\Users\xhz\AppData\Local\Microsoft\dotnet\dotnet.exe" build D:\choreohelper\src\ChoreoHelper.csproj -c Release
Run:  D:\nodejs\node.exe scripts\make-release-staging.js
Output: release\staging\
  ChoreoHelper-web-0.6.7\          网站文件（GitHub Pages 或玩家本地 file:// 双击）
  ChoreoHelper-web-0.6.7.zip       （0.7MB）
  ChoreoHelper\                    插件安装目录（整个文件夹丢进 devPlugins 即可用）
  ChoreoHelper-plugin-0.6.7.zip    （0.8MB）
  MANIFEST.json                    版本/协议/提交号/全部文件 SHA256/zip 校验
  SHA256SUMS.txt + README.txt      （README 中文安装说明，zip 里也各有一份）
```

Version consistency is a precondition assertion of packaging: plugin.json `Version` must equal the csproj `<Version>` minus the trailing `.0`, or the script refuses to run (this round unified at 0.6.7 / 0.6.7.0; DLL FileVersion verified 0.6.7.0).

## 3. Privacy & Whitelist Mechanism (this package's lifeline; change with care)

1. **Whitelist into package**: site files are listed one by one (main page/library/3D preview/engine/pose preview page + three snapshots + libs, libs-classic); anything not listed never ships. A new web file needs an entry in `WEB_FILES`/`WEB_DIRS` to enter the release package.
2. **Stand-in swap**: the package's `model.gltf` is written by the script from `web\model-standin.gltf` and byte-compared; **the owner's real model is never included** (the deployed model.gltf 737KB + model.bin 3.6MB never enter the package; the stand-in embeds base64 with no external files, so the package has no model.bin).
3. **Snapshots generated live**: catalog/skeleton snapshots must be generated on the spot by running `make-offline-assets.js` with the game open (it fails directly if the plugin's 48795 is not online) — the public package trusts only the generation process, never copies prebuilt files from the deployment location. The stand-in model's snapshot already comes from public source files.
4. **Privacy scan as backstop**: all text files entering the package are scanned for `C:\Users`, `AppData`, `XIVLauncherCN`, `ChoreoExports`, `Administrator` (note: localhost:48794/48795 are product API contracts, not leaks — do not add them to the scan); a forbidden-file list (diagnostics page / real model bin) is a second guard.
5. staging lives under `release\` — **already excluded by .gitignore**, so it cannot accidentally enter version control.

## 4. Model Priority Fix (companion product change, deployed to all four locations)

`web\preview3d.js` loadModel: if the deployed `model.gltf` is **byte-identical** to the built-in stand-in (the public-package case), skip loading and never write it into the library — the user's library model takes priority, and the embedded stand-in is the fallback; if the deployed file is a **real model** (≠ stand-in, e.g. the owner re-exported after changing gear), it keeps top priority and is auto-cached as before. Regression: offline-verify 21/21 + library-verify sync 12/12 all pass.

Known boundary (disclosed honestly): public users online with the stand-in see “离线·替身模型” (offline · stand-in model) in the 3D status bar — "offline" is literal, but the user is actually online; the intended meaning is "using the stand-in". Wording to polish later; not blocking.

## 5. Verification Record (2026-08-29)

- Full staging flow ran through (game online, snapshots generated live: emotes 305 / skills 2121 / jobs 44 / 101 bones)
- Privacy scan passed for 17 site files + 19 plugin files; model.gltf byte-identical to the stand-in source; no model.bin
- **Site zip unpack smoke test (simulating a brand-new user, offline, first run) 9/9**: editor ready / snapshot catalog 305 actions / 3D ready / stand-in offline mode / 101 bones matched / web playback / playhead moves / no JS exceptions / only the stand-in model
- Plugin zip structure correct: ChoreoHelper.dll + ChoreoHelper.json + dist\ChoreoHelper\ (matches the devPlugins layout); DLL FileVersion 0.6.7.0
- The plugin zip's **real install** was not tested on this machine (it would overwrite the owner's current install) — the layout matches the owner's current install exactly, low risk; the first real install is left to the first public user or the owner on another machine

## 6. GitHub Pages / CI Build Plan (plan only, no remote created)

1. **Site**: pure static; unpacking `ChoreoHelper-web-*.zip` yields the site. GitHub Actions workflow: push a tag (e.g. v0.6.7) → on a clean runner run `make-release-staging.js`'s "verify mode" (CI has no game and cannot generate snapshots — snapshots ship with the committed dist; CI only **verifies**: whitelist completeness, model.gltf==standin, privacy scan, SHA256 vs MANIFEST) → on pass, publish the staging contents to Pages / Release. **Local generates, CI verifies and publishes** — no faked reproducible build.
2. **Plugin**: CI cannot obtain the CN Orange Launcher's Dalamud/Hooks DLLs (net10.0-windows + local HintPath), so the plugin DLL cannot be built in CI — adopt "locally auditable build + CI verify/publish separation": a local Release build produces the DLL and package; CI only verifies signature/hashes/manifest and uploads Release assets. Re-evaluate direct CI builds if the official hooks become publicly downloadable.
3. **Release gate** (the remaining 2 items of SPEC section 5): fill `LocalApiSecurity.PublicSiteOrigin` + CORS allow once the production origin is fixed; with the origin fixed, also write the `.choreolib` migration note (file:// IndexedDB does not automatically follow to the HTTPS site; users must do one export/import backup).
4. **Owner decisions needed (not blocking WP-3)**: GitHub repo name / production site URL / release cadence.

## 7. Remaining Items

- [ ] Owner reviews the README.txt install-instruction wording (player-facing, editable)
- [ ] Production site origin (not blocking WP-3)
- [ ] First real-install verification of the plugin zip (another machine or the first public user)
- [ ] Polish the 3D status bar “离线·替身模型” wording (low priority)
- [ ] Policy on whether snapshots are committed to git (CI verify mode depends on dist snapshots being in the repo; does .gitignore currently exclude dist? — **note: the current .gitignore excludes build output/release/real model; the dist snapshot files are currently untracked new files; handle them together after the owner authorizes a commit**)
