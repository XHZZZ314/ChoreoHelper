# ChoreoHelper Fix 1: Immediate Lightweight Cross-Clip Switch During Drag

> File: choreo/src/AnimationPoseFreezer.cs
> Version: v0.5.28 (based on v0.5.27 source)
> Date: 2026-08-24

## Changes (3 places)

### 1. New fields (near the `_lastCommand` declaration)

```csharp
    // 上次执行的定格命令；命令变化或动作被游戏结束时才重新执行
    private string? _lastCommand;

    // v0.5.28 修复1：最近一次实际执行（含拖动中立即切换）的命令与时刻 —— 同命令 1.5s 去重
    // （快速来回拖时每个 clip 只重挂一次，不形成重挂风暴）
    private string? _lastExecutedCommand;
    private double _lastExecutedAt;
```

### 2. Modify the rapid branch of FreezeRequestCore

**Original code:**

```csharp
        if (rapid && (_lastCommand != command || _needsReexec))
        {
            // 拖动流中的命令变化：记最新目标，等流停/驻留。同一命令（clip 内拖动）不延迟 —— 实时拨时间
            if (!_hasDeferred || _deferredCommand != command) _deferredSince = now;
            _deferredCommand = command;
            _deferredTime = Math.Max(0, targetTime);
            _hasDeferred = true;
            return;
        }
        _hasDeferred = false;
```

**New code:**

```csharp
        if (rapid && (_lastCommand != command || _needsReexec))
        {
            // v0.5.28 修复1：拖动中跨 clip 立即轻量切换 —— 已学习的命令不等流停结算，
            // 立刻执行（learned 通道 ~0.3s 绑定），拖动穿越动作块时角色马上响应。
            // 根因修复：前端 50ms 一发 seek，后端"150ms 无请求才结算"在拖动中永不满足，
            // 导致跨 clip 切换永远推迟到松手 —— 现在已学习命令走即时通道。
            var recentlyExecuted = _lastExecutedCommand == command && now - _lastExecutedAt < 1.5;
            if (!recentlyExecuted && HasLearnedFor(command))
            {
                _hasDeferred = false;
                _lastExecutedCommand = command;
                _lastExecutedAt = now;
                FreezeRequestCore(command, targetTime, force: true);
                return;
            }
            if (recentlyExecuted && _lastCommand == command)
            {
                // 1.5s 内刚执行过同一命令且仍挂着：直接拨时间（实时帧内拖动），不重挂
                _hasDeferred = false;
                _pendingTime = Math.Max(0, targetTime);
                return;
            }
            // 未学习 / 刚执行过但已解挂：保持原延迟逻辑，等流停/驻留结算。
            // 同一命令（clip 内拖动）不延迟 —— 实时拨时间
            if (!_hasDeferred || _deferredCommand != command) _deferredSince = now;
            _deferredCommand = command;
            _deferredTime = Math.Max(0, targetTime);
            _hasDeferred = true;
            return;
        }
        _hasDeferred = false;
```

### 3. New helper method (placed near the `Awaiting` method)

```csharp
    /// <summary>命令是否已有学习缓存（learned 通道可直接播放，拖动中可立即切换）。
    /// 学习缓存 = 游戏自己绑定过的真实变体 id，PlayActionTimeline 直接播，无 emote/motion 阶梯。</summary>
    private bool HasLearnedFor(string command)
        => LearnedTimelines.TryGetValue(command, out var lrn) && lrn.Count > 0;
```

## Logic Change Summary

| Scenario | Before | After |
|---|---|---|
| Drag crosses an action boundary (command changed, learned) | recorded as deferred, waits for 150ms of silence (never satisfied mid-drag) → executes only on release | **executes immediately** (force recursion runs the full switch: unpin → fast-forward old animation → ResetEmoteState → learned channel plays directly) |
| Drag crosses an action boundary (command changed, not learned) | deferred until release | unchanged (deferred until release — first encounter takes the emote/motion slow channel; not worth it mid-drag) |
| Dragging within the same clip | real-time time dial | unchanged |
| Rapid back-and-forth drag A→B→A→B | every command change deferred/re-mounted | same command not re-mounted within 1.5s (recentlyExecuted branch: if still mounted, dial time; if unmounted, defer) |

## Why the force: true Recursion Is Safe

1. `force=true` → `rapid=false` → the defer branch is never re-entered (no recursion loop)
2. The full execution path (`_lastCommand != command`) runs: Unpin → restore speed → fast-forward old animation → ResetEmoteState → execution channel ladder (PinMode uses pin-learned / TryPlayTimelinePreferred)
3. After execution `_lastCommand = command` is set; subsequent same-clip requests take the "mounted, dial time" path
4. Zero HTTP requests, zero command-queue usage (the learned channel is a pure native call) — no command storm

## Verification

1. Build: `dotnet build` (needs a Dalamud dev environment)
2. In-game testing:
   - Lay out 3–5 different actions on the timeline (first run each once via /preview so the plugin learns them)
   - Drag the playhead quickly across action boundaries → check the character switches to the new action within ~0.3s (before the fix: only moved on release)
   - Rapid back-and-forth dragging (same-track scrub) → check for abnormal re-mounts/jitter (the 1.5s dedupe should block it)
   - Back-and-forth dragging within one clip → in-frame real-time time dialing unaffected
3. Stress test: reuse the v0.5.21 stress-test approach (fast scan / random shuffle / same-track scrub), check /debug/diag for no cross-contamination
