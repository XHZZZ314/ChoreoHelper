using System;
using System.Threading;

namespace ChoreoHelper;

/// <summary>
/// 在途任务计数器（v0.7.1 FIX-E / AUD2-010）。
/// HTTP 服务 Dispose 的正确顺序是：停接新请求 → 等在途请求到达安全点（有限超时）→
/// 才释放信号量/令牌等下游依赖。本件只管"在途计数 + 可等待归零"，纯托管、无 Dalamud
/// 依赖，datalayertest 直测（同 ChatCommandBuffer/RecordTiming 惯例）。
/// 线程契约：Begin/Dispose（句柄）/WaitDrained 任意线程可调，内部全 Interlocked/Volatile。
/// </summary>
public sealed class InFlightTracker
{
    private int _count;
    // 初始置位 = 0 在途已排空；Begin 后清零，归零再置位
    private ManualResetEventSlim _zero = new(true);

    /// <summary>当前在途数（诊断/断言用）。</summary>
    public int Count => Volatile.Read(ref _count);

    /// <summary>登记一个在途任务。返回的句柄 Dispose 即完成登记（幂等，双释放只减一次）——
    /// 异常路径也必须释放，调用方用 try/finally 或 using。</summary>
    public IDisposable Begin()
    {
        Interlocked.Increment(ref _count);
        _zero.Reset();
        return new Handle(this);
    }

    /// <summary>等在途数归零。已在 0 立即返回 true；超时返回 false（调用方按纪律
    /// 记日志后继续 Dispose，不得无限等）。</summary>
    public bool WaitDrained(TimeSpan timeout)
    {
        if (Volatile.Read(ref _count) == 0) return true;
        return _zero.Wait(timeout);
    }

    private void Complete()
    {
        if (Interlocked.Decrement(ref _count) == 0) _zero.Set();
    }

    private sealed class Handle : IDisposable
    {
        private InFlightTracker? _t;
        public Handle(InFlightTracker t) => _t = t;
        public void Dispose()
        {
            var t = _t;
            _t = null; // 幂等：第二次 Dispose 拿不到引用，不会把计数减成负数
            t?.Complete();
        }
    }
}
