# 02: FIX-B Game Seek and Command Boundaries (P1)

This package fixes "the web timeline looks correct, but the game preview may take the wrong content or be frozen by dangerous input". It must finish before the performance-script schema (WP-5), because the event semantics decided here become the foundation of the later runner.

## AUD2-003: seek Uses an Empty or Stale Timeline

### Symptoms and Evidence

- The web `sendSeek` only POSTs `{time}`.
- The full clips set is only sent to `/playback/start` at `gameStartPlay`.
- The backend `/playback/seek` only changes time; it never calls `SetTimeline`.
- So "switch to game mode and drag without pressing play" seeks an empty timeline; editing without replaying may seek the stale timeline from the last start.

Evidence locations:

- `web/choreo-helper-app.html:611-620, 1383-1397`
- `src/HttpServer.cs:567-605, 680-699`
- `src/PlaybackManager.cs:98-107, 185-240`

### Recommended Protocol

Do not resend the whole timeline on every mouse move. Use a "timeline snapshot + revision" model:

1. The web produces a canonical snapshot through the same `buildGameClips` and computes/increments `timelineRevision`.
2. On entering game preview, project switch, undo/redo, import, and end of edit debounce, send the snapshot to a new `/playback/timeline` or an equivalent explicit sync endpoint.
3. The plugin receives and atomically replaces the timeline, returning the revision it accepted.
4. `/playback/seek` sends `{time, revision}`. Without that revision the plugin returns 409 with a Chinese message — silently using stale data is not allowed.
5. `/playback/start` must also carry the revision; it may reuse an already-synced snapshot but must not rely on the implicit state of "it happens to have just synced".
6. Timeline replace, play, seek, and stop keep going through the same serial gate to avoid interleaved state.

If, temporarily for compatibility, "seek attaches clips on first use or revision mismatch" is chosen, later drags must still send only time, and tests must cover that large-project drag request bodies do not repeatedly bloat.

## AUD2-004: seek Mixes Continuous State with Discrete Side Effects

### Symptoms and Evidence

- `buildGameClips` puts switch, action, and lyric/global lyric into one flat array.
- `SeekLocked` picks the last event covering the current position, with no grouping by type or actor.
- action/switch go into the freezer; lyric calls `ExecuteClip`. Dragging the playhead can resend lines repeatedly, and a later lyric can mask an action that should be frozen.
- `_lastSeekClipId` is reset on every seek, then only assigned and never read — it provides no actual dedup.

Evidence locations:

- `web/choreo-edit.js:292-309`
- `src/PlaybackManager.cs:185-240`

### Event Semantics Must Be Settled First

| Event | Normal playback | Drag/seek |
|---|---|---|
| action | Execute on time; track during its duration | Find each actor's current action; freeze to the in-action time |
| switch | Execute once on time | Resolve only as a prerequisite state needed by the action; if the job genuinely must change, execute at most once |
| lyric | Execute once on time | Never execute |
| future skill | Execute once on time, rule-constrained | Never execute by default; show a non-seekable state |
| future movement | Continuously evaluated | Compute position/facing; trigger no one-shot commands |

### Modification Steps

1. Extract a Dalamud-free `SeekPlan` pure logic: input snapshot, time, actors, and current game state; output "required action poses, job prerequisites, and forbidden side effects".
2. Even if the current version controls only the local player, keep `actorId` on timeline events; do not keep building the implicit assumption "the whole timeline forever has exactly one actor".
3. Action selection groups by actor; lyrics must not compete for the active action.
4. Resolve switch into state first, then decide whether a switch is needed. Never hand a switch command to the freezer as an animation command.
5. Fix or delete `_lastSeekClipId`: if kept, key it by actor + command/revision and never clear it at the start of each seek.
6. In blank regions, seek should stop freezing — never replay the previous finished action.
7. Playback and seek share one event-type definition, so web and plugin do not each guess strings.

## AUD2-005: Single Game Command Has No Safety Cap

### Symptoms and Evidence

- 48794 only caps the whole POST at 4MB; clip.command itself has no byte or format limits.
- `GameCommandExecutor` hands arbitrary-length UTF-8 content to the game chat function and logs the full command.
- The old fix solved a buffer overrun and a leak, but project records confirm 3MB of text still freezes the game process.

Evidence locations:

- `src/HttpServer.cs:31-32, 567-605`
- `src/GameCommandExecutor.cs:150-218`
- The FIX-1 incident record in `.agent/CONTINUITY.md`

### Modification Steps

1. Create the pure policy `ChatCommandPolicy`; all of `/preview`, playback clips, recording triggers, and the future executor call it uniformly.
2. Judge by UTF-8 byte count, not C# char count; pick the cap from live game measurements and existing normal commands, and it must be far below 4MB.
3. Reject NUL, CR/LF, multi-command concatenation, and anything outside the product's allowed range.
4. Explicitly require action commands to start with `/`; internal non-chat instructions use a separate type — no string backdoor reuse.
5. The server returns 400 with a Chinese reason; the web shows the same message before import/edit/play, but must never rely on web-side validation alone.
6. Logs record only a controlled-length summary, hash, or prefix — never print arbitrary large input.

## Required New Tests

- seek before ever pressing play: after snapshot sync, the correct action freezes.
- Editing an action changes the revision: stale-revision seek returns 409, new revision uses the new action.
- action overlapping a later lyric: seek picks only the action; the command executor receives 0 lyrics.
- Repeatedly dragging the same action: no repeated job switch or one-shot command resend, but pose time updates.
- Two actors with simultaneous events: pure `SeekPlan` does not cross-overwrite; when the current executor selects only the local actor, it returns the selection explicitly.
- Blank region: freezing stops; no old-action replay.
- Command boundary: the legitimate maximum UTF-8 byte count passes; one byte over fails; cover multi-byte Chinese, NUL, CRLF, missing `/`, and overlong log truncation.
- `mode-check.html` must upgrade from "request was sent" to "a mock plugin holds the current revision and receives the expected freeze plan".

## Live Acceptance

1. Game online; switch to game preview without pressing play and drag into the middle of an action — the character shows that action's mid-pose.
2. After editing that action, without pressing play, drag again — the character uses the new timeline.
3. Drag back and forth where a lyric overlaps an action — lyrics must not reappear repeatedly in the chat log.
4. Drag in the gap between two actions — the character exits the freeze.
5. Normal play, pause, resume, stop, and emergency-stop behavior does not regress.

## Package Definition of Done

- [x] The plugin can always tell which timeline revision a seek uses. (revision model landed: /playback/timeline + revision on seek/start, stale returns 409 — see HANDOFF-20260830-fix-b-game-seek-commands.md)
- [x] seek never executes lyrics/skills or other discrete side effects. (SeekPlanner pure functions: only actions freeze, switches resolve prerequisites with dedup, lyrics never participate, blank regions stop freezing)
- [x] Command length and format have one authoritative server-side validation. (ChatCommandPolicy wired at six sites: preview/start/timeline/freeze/recording/executor backstop gate)
- [x] New pure-logic tests, mode-check, clip-check, offline, C# tests, and Release build all green. (datalayertest 100/100, test-edit 87/87, clip-check 108/108, offline 27/27, library 103/103, Debug/Release 0 error; live curl six checks all pass)
- [ ] All 5 real-game acceptance items pass. (waiting for the owner's availability; checklist in handoff section 4; automation already covers the revision/snapshot/409 chain)
