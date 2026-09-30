# 05: FIX-E Game Thread Ownership and Service Lifecycle (P1)

This package handles low-frequency but highly destructive zone-change, shutdown, hot-reload, and concurrent-request risks. Static code has confirmed inconsistent thread conventions; the real crash probability still needs live stress verification with the game online.

## AUD2-010: Cross-Thread Access and Shutdown Races

### Symptoms and Evidence

- The HTTP service starts a background Task per request.
- `HandleSkeleton` reads game object/skeleton pointers from an HTTP worker thread.
- Parts of `RecorderService.WalkReset`'s initial access reads/writes the game character object directly.
- `GposeToggle`, `StopPreview`, `BoneProbe`, and similar paths contain direct game-memory operations, while other paths in the same file already use `RunOnFrameworkThread` — the current convention is inconsistent.
- `ExportServer.Dispose` cancels the listener but never waits for `_serverTask`, in-flight requests, or batch recording tasks to end.
- `HttpServer.Dispose` disposes the semaphore without draining requests.
- On hot reload, batch-recording callbacks may keep touching an already-Disposed recorder/freezer; the static `RecGate` may also carry old-instance state into the new instance.

Evidence locations:

- `src/Exporter/ExportServer.cs:53-88, 359-413, 463-469, 542-550`
- `src/Exporter/RecorderService.cs:104-145, 168-176, 343-350`
- `src/HttpServer.cs:70-112, 160-220, 885-895`
- `src/AnimationPoseFreezer.cs:465-544, 687-715, 956-970`
- `src/Plugin.cs` constructor and Dispose order

## 1. First Establish a Thread Ownership Table

Before changing anything, state these rules in code comments or the handoff:

| Operation | Allowed thread |
|---|---|
| JSON parsing, pure path validation, file compression/read | background thread |
| ObjectTable, local character, DrawObject, Skeleton pointer access | framework thread |
| Freezer/GPose state changes, game memory read/write | framework thread |
| OS keyboard injection start-condition checks | framework thread; actual key-up must have a Dispose backstop |
| HTTP response writing | request thread, but must not hold invalidated plugin objects |

## 2. Modification Steps

### 1. Unify framework Dispatching

1. Extract a testable `IGameThreadDispatcher` or thin wrapper; the production implementation calls `IFramework.RunOnFrameworkThread`.
2. HTTP handlers do only auth, rate limiting, and JSON validation; all game-object logic is dispatched to the framework thread.
3. Never wait on the framework thread while holding `_stateLock`, a semaphore, or the HttpListener lock — avoid reverse deadlock.
4. Framework callbacks return immutable DTOs; the HTTP thread serializes DTOs and never carries raw pointers or Dalamud objects out of the thread.
5. If `BoneProbe` was not deleted in FIX-A, it must also go through the same dispatcher.

### 2. Build a Waitable Request Lifecycle

1. Both services use their own instance-level `CancellationTokenSource`; never rely on static busy state that cannot be reclaimed with the instance.
2. Register a Task after accepting a request; remove it from the collection when done. Exceptions must be observed and logged as controlled summaries.
3. Dispose order: stop accepting new requests → cancel token → stop/cancel batch recording → wait for in-flight tasks to a safe point → release keys/stop preview → dispose dependencies and semaphore.
4. Waits have finite timeouts and explicit logs; after timeout, callbacks must not keep touching disposed objects.
5. Recording callbacks and wait objects such as `ManualResetEventSlim` must receive completion signals and be released on cancel/Dispose.
6. Check that every `RecGate` acquisition path has `finally Release`; delete leak branches that are only "theoretically unreachable" by invariant.

### 3. Plugin Dispose Ordering

`Plugin.Dispose` should stop external entries first, then clean up consumer dependencies. Suggested order:

1. Unregister command/UI entries.
2. Stop HttpServer/ExportServer from accepting requests and drain.
3. Stop Playback/Recorder/Freezer, ensuring OS keys are released.
4. Drain the GameCommandExecutor queue.
5. Unsubscribe framework update and release objects.

The final order follows the real dependency graph and must be verified with tests and hot-reload observation — never copied blindly from the list.

## 3. Targeted Tests

- A fake dispatcher records threads: skeleton, WalkReset, GPose, StopPreview all touch fake game objects only inside dispatcher callbacks.
- Dispose while a request waits on the framework: the request gets cancel/503, and the background has no unobserved exceptions.
- Dispose while batch recording runs: callbacks end, gate released, W key released, and a new instance can immediately start recording.
- Create/Dispose two service instances consecutively: the second inherits no busy state from the first.
- playback start/seek/stop rapid concurrency: final state is predictable, no ObjectDisposedException.
- After service shutdown the port can be rebound.

## 4. Live Acceptance

1. After a normal login, repeatedly run web preview, seek, and stop.
2. Zone change/teleport while a request is in flight: the interface should fail or be retried, but the plugin and game do not crash.
3. Hot-reload the plugin during a recording: confirm the character does not keep walking, the port rebinds, and the next recording reports no permanent busy.
4. After GPose enter/exit and plugin unload, character control returns.
5. Inspect the Dalamud log: no background ObjectDisposedException, AccessViolation, or unobserved Task exceptions.

## Package Definition of Done

- [x] All game object access has a unified thread contract. (RunOnGameThread single entry + ownership table in HANDOFF-20260830-fix-e-threading-lifecycle.md section 2; remaining HTTP-thread paths are only Lumina read-only/managed collections, checked item by item)
- [x] Both HTTP services can cancel and drain in-flight tasks. (instance CTS + InFlightTracker registration + finite-timeout drain; playback gate/semaphore released only after draining)
- [x] Hot reload leaves no lingering port, keys, recording lock, or freeze state. (RecGate made instance-level, RecorderService.CancelPending + key release + `_disposed` gate, PlaybackManager.Dispose stops first — live hot reload at 16:12:51 rebound the port immediately with zero error logs)
- [x] Automatic concurrency/Dispose tests, Release build, and the live stress regression above pass. (datalayertest 130/130 incl. 9 InFlightTracker assertions; Debug/Release 0 error; live curl nine checks all pass — **four stress items left to the owner's daily observation**, see handoff section 6)

### Construction Record (completed same day 2026-08-30)

- Change and verification details: `docs/HANDOFF-20260830-fix-e-threading-lifecycle.md`.
- Intentional deviation: fake-dispatcher targeted tests were infeasible (the freezer heavily depends on FFXIVClientStructs unsafe); landed instead as pure-function InFlightTracker direct tests + single-entry dispatch constraint; live items that move the character (freeze/seek etc.) are left to the owner per discipline.
- Next package: OPT-F (AUD2-011/012, including the owner's "profile switching feels slow" optimization).
