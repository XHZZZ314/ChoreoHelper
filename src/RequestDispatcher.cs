using System;
using System.Threading;
using System.Threading.Tasks;

namespace ChoreoHelper;

/// <summary>
/// CORE-HTTP：请求并发调度器（纯托管、无 Dalamud 依赖，datalayertest/pluginlifecycletest 直测，同 InFlightTracker 惯例）。
/// 契约：
/// - 每条车道独立有界并发，满员立即拒绝（调用方回 503），任何车道都不排队——停止/seek
///   的接受路径要么立即拿槽、要么明确 503，绝不会等在慢请求后面。
/// - TryAccept 同步完成登记（接受即在途）：Dispose 排空一个不漏（FIX-E 契约延续）。
/// - 绝不把取消令牌传给 Task.Run：已接受的请求不会被中途取消调度（ExportServer PLUG-6
///   那类「Begin 后取消跳过 finally → 在途计数泄漏」在这里从源头杜绝；取消只用于
///   工作体内部的 I/O，见 HttpServer 歌词 SendAsync(ct)）。
/// - 槽位与在途计数在同一个 finally 成对回收，工作体抛异常也必回收。
/// - TASK-20260908（AC-3/AC-4）：关闭准入与「检查+拿槽+登记在途」在同一把锁下原子完成，
///   关停后 TryAccept 立即 false、绝不碰已释放的信号量；信号量等资源延迟终结化——
///   在途未归零前不释放，迟到完成仍能安全还槽/销句柄并归零，终结化至多一次。
/// </summary>
public sealed class RequestDispatcher : IDisposable
{
    private readonly InFlightTracker _inFlight = new();
    private readonly SemaphoreSlim _fast;
    private readonly SemaphoreSlim _outbound;
    // 准入/关停互斥锁：TryAccept 的「关停检查+Wait(0)+Begin+调度」与 Dispose 的
    // 「置关停+条件终结化」都在锁内，check-then-act 窗口关闭（旧 volatile 检查与
    // Wait(0) 之间仍可撞上已释放的信号量）。
    private readonly object _sync = new();
    private bool _shutdown;
    private int _finalized; // 延迟终结化恰一次标记

    public RequestDispatcher(int fastMax, int outboundMax)
    {
        _fast = new SemaphoreSlim(fastMax, fastMax);
        _outbound = new SemaphoreSlim(outboundMax, outboundMax);
    }

    /// <summary>当前在途数（含已接受尚未执行的工作体；诊断/断言用）。</summary>
    public int InFlight => _inFlight.Count;

    /// <summary>接受并调度一个请求。work 内部自行 try/catch 业务异常（本件只兜回收）。
    /// 返回 false = 该车道满员拒绝或已关停（未登记在途、未占槽，调用方直接回 503）。</summary>
    public bool TryAccept(RequestLane lane, Func<Task> work)
    {
        lock (_sync)
        {
            if (_shutdown) return false;
            var slot = lane == RequestLane.Outbound ? _outbound : _fast;
            if (!slot.Wait(0)) return false;
            var h = _inFlight.Begin();
            try
            {
                _ = Task.Run(async () =>
                {
                    try { await work(); }
                    // 顺序有约束：先还槽、再销在途句柄。自己的句柄未销时计数必 &gt;0，
                    // 信号量必未终结化（终结化只发生在计数归零后），Release 绝不撞
                    // 已释放对象；反过来双还槽会抛 SemaphoreFullException 并跳过 h.Dispose()
                    // → 在途永不归零（夹具按此外显断言恰一次回收）。
                    finally { slot.Release(); h.Dispose(); MaybeFinalize(); }
                });
                return true;
            }
            catch
            {
                // 调度本身失败（理论上只有极端 OOM）：槽位与计数必须成对还原
                h.Dispose();
                slot.Release();
                throw;
            }
        }
    }

    /// <summary>等在途归零（含排队语义上不存在的「已接受未执行」）。已在 0 立即 true；
    /// 超时 false（调用方按纪律记日志后继续，不得无限等）。Dispose 后仍可等（计数归零即真）。</summary>
    public bool WaitDrained(TimeSpan timeout) => _inFlight.WaitDrained(timeout);

    /// <summary>关闭准入（幂等）。只负责状态翻转与「空闲时」的资源终结化；在途未归零时
    /// 资源延迟到最迟一个工作体完成时终结化——排空观察（WaitDrained）仍由调用方有界执行。</summary>
    public void Dispose()
    {
        lock (_sync)
        {
            if (_shutdown) return;
            _shutdown = true;
            if (_inFlight.Count == 0) FinalizeResources();
        }
    }

    /// <summary>工作体完成后的延迟终结化检查：关停已开始且在途已归零 → 释放信号量（至多一次）。
    /// 在锁内判/read，FinalizeResources 的信号量释放与 TryAccept 的 Wait(0) 互斥。</summary>
    private void MaybeFinalize()
    {
        lock (_sync)
        {
            if (_shutdown && _inFlight.Count == 0) FinalizeResources();
        }
    }

    private void FinalizeResources()
    {
        if (Interlocked.CompareExchange(ref _finalized, 1, 0) != 0) return;
        _fast.Dispose();
        _outbound.Dispose();
    }
}
