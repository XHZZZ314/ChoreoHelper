# 01: FIX-A Local API Security (P0)

This package must complete first. Until then, do not enter WP-5 and do not produce a release candidate.

## AUD2-001: Clip File Path Escape

### Symptoms and Evidence

- `ClipName` in `src/Exporter/ExportServer.cs` only strips a leading `/` and replaces forward slashes; it does not reject Windows drive letters, backslashes, UNC paths, device names, or illegal characters.
- `HandleGetClip` only replaces `/` and `..`, then directly calls `Path.Combine(ClipsDir, safe + ".json")`.
- On Windows, `Path.Combine(base, rootedPath)` discards `base`. So a GET can escape the clip directory and read any accessible `.json`.
- `/export/getclip` is a pairing-free GET; `Origin: null` is also allowed for the normal file:// entry. The plugin's predictably located `pairing.json` therefore becomes a readable target, after which pairing protection on write endpoints fails.
- Single and batch recording save paths are also command-derived, sharing the same directory-escape entry.

Evidence locations:

- `src/Exporter/ExportServer.cs:35-43, 122-175, 237-245, 285-310, 345-388`
- `src/LocalApiSecurity.cs:23-34, 51-83`
- `src/PairingStore.cs:17-27`

### Modification Steps

1. Create a Dalamud-free path policy class, e.g. `ClipPathPolicy.cs`, shared by single save, batch save, and read.
2. Separate "game command" from "disk file name". Never use an unconstrained command directly as a path segment.
3. The file-name policy must at least:
   - reject empty values, control characters, NUL, `/`, `\`, `:`, drive letters, UNC, `.`/`..`, and Windows reserved device names;
   - use `Path.GetInvalidFileNameChars()`;
   - keep existing compatibility mappings such as `/bow motion → bow`;
   - return an explicit 400 when no safe name can be derived — never silently write to a weird file.
4. The final path must enforce a double constraint:
   - `candidate = Path.GetFullPath(Path.Combine(root, fileName + ".json"))`;
   - `candidate` must start with "normalized root + directory separator" — not a bare `StartsWith(root)`, which would misjudge a `clips2` prefix.
5. `/export/getclip` should accept only controlled clip names or an unforgeable internal ID. A pairing code should also be required; that is an interface semantic change and should bump `ProtocolVersion` and sync the web side.
6. Read, existence check, single save, and batch save all call the same policy function — no bypasses may remain.
7. Check old archive/compat call sites such as `BoneAnimator.SaveToDisk`; compiled paths must be closed the same way. `.bak` files are recorded only, never modified.

### Targeted Tests

Add the path policy to `src/tests/datalayertest`, covering at least:

- Accept: `/bow`, `/bow motion`, leading/trailing spaces, existing Chinese or English clip names.
- Reject: `C:\temp\x`, `\\server\share\x`, `..\x`, `a/b`, `a\b`, `CON`, empty string, NUL, overlong file names.
- Full-path boundary: `clips2` must not impersonate the `clips` subdirectory.
- URL-decoded `%5c`, `%3a` must still be rejected.
- Read endpoint without token returns 403; valid token + valid clip name returns the original data.
- Tests use only temp directories and fake JSON — never read the real pairing file.

## AUD2-002: Dangerous boneprobe Debug Endpoint

### Symptoms and Evidence

- `/debug/boneprobe` is on the GET whitelist.
- Its route, unlike `/debug/poke`, never checks the pairing code.
- `BoneProbe(action=rot)` writes local character bone quaternions directly through unsafe pointers.
- The HTTP request-handling thread is not the Dalamud framework thread.

Evidence locations:

- `src/HttpServer.cs:41-54, 242-280`
- `src/AnimationPoseFreezer.cs:486-544`

### Modification Steps

Preferred solution: remove `boneprobe` from the production endpoint whitelist, capability list, and routing. If later debugging genuinely needs it, all of the following must hold:

1. Exists only in dev builds or behind an explicit dev switch.
2. Changed to POST and requires the pairing code.
3. All game object access goes through `IFramework.RunOnFrameworkThread`.
4. Read-only probe by default; any write action gets an additional local-dev-only confirmation gate.
5. Release build tests must prove the endpoint is absent or returns 404/405.

### Targeted Tests

- GET `/debug/boneprobe` must produce no business side effect.
- If POST is kept: missing/wrong token returns 403; Release builds disable it by default.
- Use a fake framework scheduler to prove probe logic runs only inside framework-thread callbacks.
- Never use a real `rot` request as an automated test.

## Package Definition of Done

- [x] All clip file reads/writes can only land inside `ClipsDir`. (2026-08-30 construction: new pure-function file `src/ClipPathPolicy.cs` closes five sites — getclip read, single save, batch enqueue+save, and old `BoneAnimator.SaveToDisk` .bin writes — all through the `TryGetPathForCommand/TryResolvePath` double constraint: file-name sanitization + GetFullPath with directory-separator prefix check; old `ExportServer.ClipName` deleted, no bypass left)
- [x] Pairing-free origins cannot read `pairing.json` or any other arbitrary JSON. (escape entry is containerized: getclip can only land on `<safe-name>.json` inside ClipsDir; `%5c`/`%3a` forms decoded by `ParseQueryString` are rejected too)
- [x] Production has no pairing-free bone-write GET. (`/debug/boneprobe` removed from whitelist and routing; the `AnimationPoseFreezer.BoneProbe` unsafe bone-write method deleted entirely; zero web/script references confirmed via grep)
- [x] Protocol version and web error messages synced. (Evaluated: **no ProtocolVersion bump needed** — behavior for legitimate clip names is byte-identical; only unsafe names change from "read a weird file / not found" to an explicit 400 JSON. The web's three getclip call sites read only response-body `error/bones` fields, not status codes, so they are naturally compatible; the boneprobe removal has no web impact. Bump the protocol later if a pairing code is added to getclip per the suggestion.)
- [x] Targeted security tests, C# data layer, and Release build pass. (datalayertest 42→**71/71**, 29 new ClipPathPolicy assertions: normal mapping / drive letter / UNC / relative segments / internal slashes / colon / reserved device names / NUL / overlong / `clips2` impersonation boundary / end-to-end landing spot; Debug+Release 0 error, 6 existing warnings unchanged; `git diff --check` clean. **48794/48795 secure-route live regression still pending game online**)
- [x] Online follow-up verifies only normal clip read/recording, never the dangerous probe. (2026-08-30 same-day with game online, six checks all pass: ① `getclip?name=bow` 200 normal data ② `getclip?name=..%5c..%5c…pairing` 400 "clip name not allowed" ③ `GET /debug/boneprobe` 404 ④ `/export/list` 200 full list ⑤ POST `/export/clip` save:true with reserved device name `CON` → 400 "clip command cannot be turned into a safe file name" and character untouched (an earlier "command required" reply was bash eating the backslash into bad JSON — test scaffolding issue, not product) ⑥ save:false recording `/bow motion` 200 returns a real clip — recording chain unaffected)

## Construction Record (2026-08-30)

- New file: `src/ClipPathPolicy.cs` (Dalamud-free, added to datalayertest, same convention as ChatCommandBuffer/MotionDetect).
- Changed: `src/Exporter/ExportServer.cs` (getclip 400/closure; single save validates the name first — unsafe names get 400 without recording; batch enqueue filter + save closure; ClipName deleted), `src/HttpServer.cs` (boneprobe whitelist + route deleted), `src/AnimationPoseFreezer.cs` (BoneProbe method deleted), `src/BoneAnimator.cs` (.bin writes go through the policy), `src/tests/datalayertest/` (csproj gains the new file + program.cs section 5 with 29 assertions).
- **Intentional deviation (recorded faithfully)**: modification step 5's "suggest requiring a pairing code on /export/getclip" was **not done this round** — pose-viewer.html is served from the 48795 origin, has no pairing UI, and its localStorage is not shared with the file:// entry, so requiring the code would break it directly; and after containerization getclip can no longer read any sensitive file (ClipsDir holds only clip JSON). The substantive completion items do not depend on that suggestion, so this does not block. If done later, design it together with a pose-viewer pairing entry and a ProtocolVersion bump (can fold into a later package).
- Version still 0.7.1; web product files zero changes, not deployed (C#-only package); no commit, no push, no release.
