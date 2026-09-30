using System;
using System.Collections.Generic;
using System.Diagnostics;

namespace ChoreoHelper.Exporter;

/// <summary>
/// v0.7.1 FIX-C（AUD2-007）：录制计时纯函数件（无依赖、datalayertest 直测）。
///
/// 老 RecorderService.Now() = Environment.TickCount64 / 1000f —— float 只有约 24 位有效精度，
/// 时间是"从开机起累计的绝对秒"：开机约 3.9 天后最小步长 31.25ms（30fps 采样判断隔帧掉队，
/// 实际降到约 16fps），约 12.1 天后 125ms（约 8fps）；"最近 0.4 秒 = 倒数第 12 帧"的换算
/// 也随实际帧率漂移。改法：
/// ① 单调时钟 Stopwatch.GetTimestamp 的绝对秒用 double（52 位精度，开机几年都无损）；
/// ② 内部判断一律用"相对录制起点的经过秒"（帧时间戳从 0 起算）；
/// ③ 只在序列化 clip 时才转 float；
/// ④ 静止判定的参考帧按时间找（0.4 秒前），不再按固定倒数第 12 帧。
/// </summary>
public static class RecordTiming
{
    /// <summary>单调时钟绝对秒（double）。本进程内单调，系统时钟回拨不影响；精度到纳秒级。</summary>
    public static double NowSeconds() => Stopwatch.GetTimestamp() / (double)Stopwatch.Frequency;

    /// <summary>从起点 Stopwatch 时间戳到现在的相对秒（先减后除，杜绝大绝对值参与低精度运算）。</summary>
    public static double ElapsedSeconds(long startTimestamp) =>
        (Stopwatch.GetTimestamp() - startTimestamp) / (double)Stopwatch.Frequency;

    /// <summary>静止判定的参考帧下标：times 是帧相对秒（升序），找 T &lt;= curT - windowSec 的
    /// 最新一帧；动作还没播满一个窗口（没有这样的帧）返回 -1。
    /// 取代老的固定 _frames[^12]（按 30fps 目标折算 0.4 秒，实际 11~17fps 时是 0.7~1.1 秒，
    /// 判静窗口随帧率漂移）。窗口固定 0.4 秒与设计口径一致，与实际采样率无关。</summary>
    public static int StillRefIndex(IReadOnlyList<double> times, double curT, double windowSec = 0.4)
    {
        var target = curT - windowSec;
        var idx = -1;
        for (var i = 0; i < times.Count; i++)
        {
            if (times[i] <= target) idx = i;
            else break;
        }
        return idx;
    }
}
