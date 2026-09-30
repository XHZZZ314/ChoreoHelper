# ChoreoHelper AI runbook

> Read only the section relevant to the task. This holds operational facts removed from the auto-read project rules.

## Toolchain

- Windows / PowerShell; repository `D:\choreohelper`.
- Node: `D:\nodejs\node.exe` (v24 series, not on PATH).
- .NET: `C:\Users\xhz\AppData\Local\Microsoft\dotnet\dotnet.exe` (10.0.400, not on PATH).
- Main plugin: `net10.0-windows`, Dalamud API 15, FF14 CN/Orange Moon only.
- Data tests target net8 and need `DOTNET_ROLL_FORWARD=Major` on this machine. NuGet access may be blocked.

## Web runtime and deployment

- Owner daily entry: desktop shortcut opens `web\dist\ChoreoHelper\choreo-helper-app.html` through `file://`.
- `file://` supports relative classic scripts/styles but not ES-module imports or local-file fetch. Three.js uses generated `libs-classic` fallback.
- 48794 and 48795 allow browser access through the plugin's CORS/pairing policy. 48795 is exclusively the plugin ExportServer; never revive `serve-app.ps1` on that port.
- Web changes must be byte-synced to:
  1. `web\dist\ChoreoHelper`
  2. `%AppData%\XIVLauncherCN\devPlugins\ChoreoHelper\dist\ChoreoHelper`
  3. `D:\Program Files\上海数龙科技有限公司\最终幻想XIV\game\dist\ChoreoHelper`
- New Dalamud loads the registered plugin DLL from `dalamudConfig.json` `DevPluginLoadLocations`; editing that file while the game runs is overwritten on exit.
- Real personal model is `model.gltf` plus `model.bin`; public/development stand-in is `web\model-standin.gltf`. Never copy the owner's model into staging.

## Generated assets

- `web/dist/ChoreoHelper/libs-classic`: regenerate with `scripts/make-classic-libs.js` after Three.js changes.
- `catalog-snapshot.js`, `skeleton-snapshot.js`, `standin-model.js`: regenerate with `scripts/make-offline-assets.js`; do not hand-edit.
- `scripts/library-verify.js` uses temporary port 48797 and isolated Chrome profiles when the real plugin is unavailable.

## Recording facts

- Use `motion` emote variants; text variants can consume targets or create chat noise.
- Keep at least 2.5 seconds between clips. Interrupt sustained loops with `/beckon motion`.
- Posture actions require `POST /export/walkreset`; movement is the reliable posture reset.
- `nod motion` does not exist on CN. Dalamud `IKeyState` injection is ineffective in this build; the guarded OS input path is intentional.
- Emote-class actions are not face-only; an old quaternion-index NaN bug caused that false conclusion.
- Recording mainline is 48795 JSON (`/export/clip` two-phase commit). `/bonerec` binary prototypes are retired.

## Safety and publication

- The working tree contains the owner's uncommitted product evolution. Never reset or discard it.
- Builds may copy files to the dev-plugin root. A public staging rebuild is not publication, but still requires release-package rules and privacy verification.
- Remote creation, push and publication always require separate explicit owner authorization.
