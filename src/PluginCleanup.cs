using System;
using System.Collections.Generic;
using System.Threading;

namespace ChoreoHelper;

// TASK-20260908：Plugin 清理步骤的固定依赖序（FIX-E 排序原则：先停外部入口——命令与
// 两个 HTTP 服务；再停消费者——录制→演出→播放→定格→预览；最后解除框架订阅并释放底层
// 执行器）。序值即清理执行序；获取序（ctor 登记序）与之不同，Run 时按序值排序执行。
internal enum PluginCleanupStep
{
    RemoveCommand = 0,
    StopV3Server = 1,
    StopHttpServer = 2,
    StopRecorder = 3,
    StopShow = 4,
    UnsubscribeFramework = 5,
    DisposePlayback = 6,
    DisposeFreezer = 7,
    DisposePreviewer = 8,
    DisposeExecutor = 9,
}

/// <summary>
/// TASK-20260908：Plugin 构造半成品回收与卸载清理共用的序列器（纯托管、无 Dalamud 依赖，
/// pluginlifecycletest 直测生产源，不做逻辑复制）。
/// 契约：每个步骤只在对应资源/订阅获取成功后登记；<see cref="RunConstructionCleanup"/>
/// （ctor 失败路径）与 <see cref="Run"/>（Dalamud 卸载路径）都直接进入恰一次闸门——首清理
/// 不被任何预置幂等位压制，之后谁再调都是无操作；已登记步骤按依赖序逐项执行，单步异常被
/// 隔离并记入错误接收器，绝不让异常逃出。
/// </summary>
internal sealed class PluginCleanup
{
    /// <summary>单步清理失败记录（错误接收器条目）。</summary>
    public sealed record CleanupFailure(PluginCleanupStep Step, Exception Error);

    private readonly object _gate = new();
    private readonly Dictionary<PluginCleanupStep, Action> _steps = new();
    private readonly List<CleanupFailure> _errors = new();
    // 0 = 开放登记；1 = 清理已开始（恰一次闸门，CompareExchange 抢到者执行全部清理）
    private int _state;

    public bool HasRun => Volatile.Read(ref _state) != 0;

    public IReadOnlyList<CleanupFailure> Errors
    {
        get { lock (_gate) return _errors.ToArray(); }
    }

    /// <summary>登记一个清理步骤（须在对应资源/订阅获取成功后调用）。同一步骤重复登记视为
    /// 接线错误，立即抛出由 ctor 兜底。清理已开始后才登记的资源立即隔离回收，不泄漏。</summary>
    public void Register(PluginCleanupStep step, Action action)
    {
        var late = false;
        lock (_gate)
        {
            if (Volatile.Read(ref _state) != 0) late = true;
            else if (!_steps.TryAdd(step, action))
                throw new InvalidOperationException($"Duplicate cleanup step: {step}");
        }
        if (late) InvokeIsolated(step, action);
    }

    /// <summary>ctor 失败路径入口：与卸载路径同达恰一次闸门，首清理不被压制（AC-1）。</summary>
    public void RunConstructionCleanup() => RunOnce();

    /// <summary>Dalamud 卸载路径入口（与构造失败路径共用恰一次语义，AC-2）。</summary>
    public void Run() => RunOnce();

    private void RunOnce()
    {
        if (Interlocked.CompareExchange(ref _state, 1, 0) != 0) return;
        KeyValuePair<PluginCleanupStep, Action>[] snapshot;
        lock (_gate) snapshot = _steps.ToArray();
        // 依赖序执行：与登记（获取）序解耦
        Array.Sort(snapshot, (a, b) => a.Key.CompareTo(b.Key));
        foreach (var kv in snapshot)
            InvokeIsolated(kv.Key, kv.Value);
    }

    private void InvokeIsolated(PluginCleanupStep step, Action action)
    {
        try { action(); }
        catch (Exception ex) { lock (_gate) _errors.Add(new CleanupFailure(step, ex)); }
    }
}
