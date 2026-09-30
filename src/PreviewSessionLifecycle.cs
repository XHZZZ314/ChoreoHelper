// 预览会话生命周期（ARCH2 姿态生命周期拆分，TASK-20260901-ARCH2-POSE-LIFECYCLE）：
// 纯托管组件，无 Dalamud/FFXIVClientStructs 依赖，datalayertest 直测。
// 承接 AnimationPoseFreezer 的请求/停止互动决策：拖动流 150ms 去抖（命令变化延迟、
// 同命令实时拨时间）、延迟停止、世代号（_previewGen 停止竞态防护）、结算窗口、
// Dispose 有界等待与游戏线程路由/吞异常决策。时钟注入保持决策可测；所有阈值与
// 判定顺序自 v0.5.x~v0.7.1 原样迁移，行为不变。
using System;
using System.Collections.Generic;

namespace ChoreoHelper;

/// <summary>
/// 定格预览会话的请求/停止生命周期状态机（由 AnimationPoseFreezer 驱动）。
/// 只持有请求侧簿记；预览执行状态（_previewMode/_pendingCommand 等）仍归定格器状态机。
/// </summary>
internal sealed class PreviewSessionLifecycle
{
    private readonly Func<double> _clock;

    private int _previewGen;              // 预览世代计数：Stop 后丢弃仍在队列里的旧 FreezeRequestCore（停止竞态）
    private double _lastRequestTime;      // 上次预览请求时刻
    private string? _deferredCommand;     // 拖动流中未执行的最新命令（null=延迟的"停止"——空隙位置）
    private float _deferredTime;
    private bool _hasDeferred;
    private double _deferredSince;        // 当前延迟目标首次记下时刻（同目标停留过久=用户驻留刮擦，提前结算）
    private double _lastPreviewActivity;  // 最近一次预览活动（seek/stop）—— 待机观察的静默窗口

    public PreviewSessionLifecycle(Func<double> clock) => _clock = clock;

    public int Generation => _previewGen;
    public bool HasDeferred => _hasDeferred;

    /// <summary>
    /// FreezeRequestCore 入口三件事（与拆分前顺序一致）：记活动时刻、判定快速拖动流
    /// （&lt;150ms，force 绕过）、刷新请求时刻。返回是否处于拖动流中。
    /// </summary>
    public bool BeginRequest(bool force)
    {
        var now = _clock();
        _lastPreviewActivity = now;
        var rapid = !force && now - _lastRequestTime < 0.15;
        _lastRequestTime = now;
        return rapid;
    }

    public void MarkActivity() => _lastPreviewActivity = _clock();

    /// <summary>拖动流中的命令变化才延迟执行；同一命令（clip 内拖动）实时拨时间，不延迟。</summary>
    public static bool ShouldDeferCommandChange(bool rapid, string? lastCommand, string command, bool needsReexec)
        => rapid && (lastCommand != command || needsReexec);

    /// <summary>记下拖动流中的最新命令目标（重复延迟同一命令不重置首次记下时刻）。</summary>
    public void DeferCommand(string command, float time)
    {
        var now = _clock();
        if (!_hasDeferred || _deferredCommand != command) _deferredSince = now;
        _deferredCommand = command;
        _deferredTime = time;
        _hasDeferred = true;
    }

    /// <summary>停止请求是否落在拖动流中（立即恢复速度会让旧动画在拖动中乱播 → 延迟到结算）。</summary>
    public bool ShouldDeferStop() => _clock() - _lastRequestTime < 0.15;

    /// <summary>延迟一个"停止"（空隙位置）：命令记 null，刷新请求时刻参与结算窗口。</summary>
    public void DeferStop()
    {
        var now = _clock();
        _deferredCommand = null; // null = 延迟的停止
        _hasDeferred = true;
        _deferredSince = now;
        _lastRequestTime = now;
    }

    public void ClearDeferred() => _hasDeferred = false;

    /// <summary>
    /// 流停结算：150ms 无新请求（=松手/停下）才统一执行最新目标。一次性取出 ——
    /// 取出即清 _hasDeferred，重复调用不会二次执行（停止/命令恰好一次）。
    /// </summary>
    public bool TryTakeSettled(out string? command, out float time)
    {
        command = null;
        time = 0;
        if (!_hasDeferred || _clock() - _lastRequestTime <= 0.15) return false;
        command = _deferredCommand;
        time = _deferredTime;
        _hasDeferred = false;
        return true;
    }

    /// <summary>世代号推进（StopPreview 用）：使仍在框架队列里的旧请求世代失效。</summary>
    public void AdvanceGeneration() => _previewGen++;

    /// <summary>
    /// Dispose 有界等待条件：曾在预览（有恢复动作要等落地）且当前不在框架线程
    /// （框架线程上恢复动作就地执行，无需等待）。
    /// </summary>
    public static bool DisposeShouldBoundedWait(bool wasPreviewing, bool onFrameworkThread)
        => wasPreviewing && !onFrameworkThread;
}

/// <summary>
/// 姿态会话公共入口的纯决策/纯形状锚点（datalayertest 特征化直测）。
/// AnimationPoseFreezer 的对应入口逐条委托到这里，保证字节形状与判定表可回归。
/// </summary>
internal static class PoseSessionPolicy
{
    /// <summary>FIX-E 线程路由决策：已在框架线程 → 就地执行；否则调度。</summary>
    public static bool RunInline(bool isInFrameworkUpdateThread) => isInFrameworkUpdateThread;

    /// <summary>
    /// 游戏线程动作的统一错误语义：异常吞掉并上报（inline 与 dispatched 两条路同款），
    /// 成功返回 true —— 拆分前 RunOnGameThread 的 try/catch+log 形状。
    /// </summary>
    public static bool TryRun(Action action, Action<Exception>? onError)
    {
        try { action(); return true; }
        catch (Exception ex) { onError?.Invoke(ex); return false; }
    }

    /// <summary>/gpose/toggle 的返回字节形状（拆分前手工拼接逐字节一致）。</summary>
    public static string GposeStateJson(bool active) => "{\"gpose\":" + (active ? "true" : "false") + "}";

    /// <summary>
    /// 播放命令前是否需要解堵表情通道（v0.6.5 僵尸绑定签名）：槽0 非空、非待机、
    /// 是循环时间轴、表情状态机确认在播 —— 四者同时成立才解堵，正常状态零动作。
    /// </summary>
    public static bool ShouldUnblockForCommand(ushort slot0, bool isIdleTimeline, bool isLoopTimeline, bool isEmoting)
        => slot0 != 0 && !isIdleTimeline && isLoopTimeline && isEmoting;

    /// <summary>
    /// 待机重绑 id：学习集为空时兜底标准待机 3（Brio 同款常量；_idleTimelines 是
    /// 运行时学习集，重启后为空）。仅 PrepareForExternalEmote/PrepareForPlaybackCommand
    /// 用此兜底；Unpin/ResetEmoteState 的 blend 路径无兜底（学习集空即不播）。
    /// </summary>
    public static ushort PickIdleId(IReadOnlyCollection<ushort> idleTimelines)
    {
        foreach (var learned in idleTimelines) return learned;
        return 3;
    }
}

/// <summary>延迟测时长队列策略（纯）：16 条防积压上限（拆分前冻结值）。</summary>
internal static class PoseMeasureQueue
{
    public const int MaxQueued = 16;

    public static bool CanEnqueue(int queued) => queued < MaxQueued;
}
