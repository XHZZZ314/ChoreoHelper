using System;

namespace ChoreoHelper;

/// <summary>
/// 命令节流纯策略（FIX-J PLUG-7）：游戏命令最小间隔的单调时钟判定。
/// 旧实现在 GameCommandExecutor 里用 DateTime.Now 做节流——系统时间回拨会让后续命令
/// 停摆到墙钟追回来、前跳则瞬间放行连发。改为调用方传入 Environment.TickCount64
/// 单调毫秒，边界行为可测（datalayertest 直测）。同 ChatCommandPolicy/RecordTiming 惯例。
/// </summary>
public sealed class CommandThrottlePolicy
{
    private readonly long _minIntervalMs;
    private long _lastMs;

    public CommandThrottlePolicy(long minIntervalMs)
    {
        _minIntervalMs = Math.Max(0, minIntervalMs);
        // 首个命令不受限；初值取 long 之半防 nowMs-_lastMs 溢出
        _lastMs = long.MinValue / 2;
    }

    /// <summary>距上次执行 ≥ 间隔才允许。恰好等于间隔时放行，与旧实现
    /// (DateTime.Now - _last) &lt; 间隔 → 拦截 的边界口径一致。</summary>
    public bool AllowNow(long nowMs) => nowMs - _lastMs >= _minIntervalMs;

    /// <summary>命令已执行，记录节流基准点。</summary>
    public void OnExecuted(long nowMs) => _lastMs = nowMs;
}
