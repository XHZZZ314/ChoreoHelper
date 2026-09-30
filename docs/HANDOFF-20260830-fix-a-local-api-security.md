# HANDOFF 2026-08-30: FIX-A Local API Security (AUD2-001/002, P0) — code + automated acceptance complete; live regression pending game online

> Work-package entry: `docs/AUDIT-20260830-code-repair/01-FIX-A-LOCAL-API-SECURITY.md` (definition of done checked in place + build log).
> This is the first package of the second-audit repair chain; FIX-B may start only after P0 is cleared.

## 1. What was fixed (plain language)

- **Clip file path escape (AUD2-001)**: previously, when the web page asked the plugin for clip data (`/export/getclip`, pairing-free GET), the clip name got only very light sanitization — on Windows, a name carrying a drive letter (e.g. `C:\...\pairing`) made the plugin **drop the clips directory and read the file at that path**. The pairing-code file path is fixed; whoever reads it effectively nullifies pairing protection on all write endpoints. Now there is a single "path policy" gatekeeper: the clip name is sanitized first (rejects drive letters / backslashes / colons / inner slashes / control characters / Windows reserved device names / overlong names; only the `/bow motion → bow` variant-strip mapping is kept), and the final path must truly land inside the clips directory `ChoreoExports\clips` — it cannot escape. **All five sites — clip read, single-recording save, batch recording, legacy .bin write — go through this one function**; no bypass remains; unsafe names now get an explicit 400 instead of failing at write time after recording.
- **Dangerous bone probe endpoint (AUD2-002)**: `/debug/boneprobe` was a pairing-free GET that could use pointers to **directly rewrite a character's bones in game**. The entire endpoint (whitelist entry, route, method body) is deleted from the production build. Web and scripts grep-confirmed zero references — nothing used it.

## 2. Change list (C#-only, web untouched, not deployed)

| File | Change |
|---|---|
| `src/ClipPathPolicy.cs` | **New file**: path-policy pure functions (TryMakeFileName / TryResolvePath / TryGetPathForCommand), no Dalamud dependency |
| `src/Exporter/ExportServer.cs` | getclip goes through the policy (unsafe name → 400); single-save command validates the name first; batch enqueue filters unsafe commands; old ClipName deleted |
| `src/HttpServer.cs` | `/debug/boneprobe` removed from whitelist and routing (now 404) |
| `src/AnimationPoseFreezer.cs` | `BoneProbe` unsafe bone-writing method deleted (~60 lines) |
| `src/BoneAnimator.cs` | Legacy .bin recording write also goes through the path policy |
| `src/tests/datalayertest/` | csproj hooks the new file; program.cs section 5 gains 29 targeted tests |

## 3. Verification (actually run)

- datalayertest **71/71** (was 42 + new 29: normal mappings 6, rejection list 16, clips2 impersonation boundary / double-guard 4, end-to-end landing 3; the `%5c`/`%3a` forms as decoded at the HTTP layer are directly tested in the rejection list). Run method: user-level dotnet `--roll-forward Major` on the net8.0 test binary.
- Debug + Release builds **0 errors** (6 pre-existing warnings unchanged); `git diff --check` clean; grep confirms no residual ClipName/BoneProbe references (comments only).
- devPlugins DLL auto-updated with the Debug build (this package does not touch the web; web hashes at the three deployment locations unaffected).

## 4. Intentional deviations (owner can ignore; AI record)

- The audit doc "suggests" adding a pairing code to getclip too — **not done this round**: pose-viewer.html opens from the 48795 origin, has no pairing UI, and does not share localStorage with the file:// main page; adding it would break it outright. Also, after the path lockdown getclip can only read clip JSON inside the clips directory — no sensitive files left to steal. Doing it would require designing a pose-viewer pairing entry + ProtocolVersion bump together; does not block this package.
- ProtocolVersion stays 1: behavior for legal clip names is byte-identical; only unsafe names changed from "read a weird file" to an explicit 400, and the web only reads the response body, never the status code — no bump needed.

## 5. Live supplementary verification (2026-08-30, game online same day — all completed)

1. ✅ `curl "http://localhost:48795/export/getclip?name=bow"` → 200, normal data
2. ✅ `curl "http://localhost:48795/export/getclip?name=..%5c..%5c..%5cXIVLauncherCN%5CpluginConfigs%5CChoreoHelper%5Cpairing"` → 400 「动作名不合法，已拒绝」 ("clip name illegal, rejected") — before the fix this returned the pairing-code JSON
3. ✅ `curl "http://localhost:48794/debug/boneprobe?action=rot"` → 404
4. ✅ `/export/list` → 200, full list as usual
5. ✅ POST `/export/clip` save:true + unsafe command (CON) → 400 「动作命令无法转成安全文件名」 ("clip command cannot be turned into a safe file name"), character untouched; side check: bad JSON body → "command required", also correct
6. ✅ POST `/export/clip` save:false recording `/bow motion` → 200 with a real clip; recording chain unaffected
7. ✅ Side-run to close the character-profiles package's pending online regression: offline-verify **27/27** (online real model 101/101 + transition auto-recovery + perf + the two diagnostic pages), library-verify all **103/103** (sync real-plugin online path, rec 25/25, sec 20/20, proj/check full set)

**FIX-A is fully closed here**, no outstanding verification items.

## 6. Next package

FIX-B (AUD2-003/004/005: game-seek timeline sync, event semantics, command length) — `docs/AUDIT-20260830-code-repair/02-FIX-B-GAME-SEEK-AND-COMMANDS.md`.
Version still 0.7.1; not committed, not pushed, not released.
