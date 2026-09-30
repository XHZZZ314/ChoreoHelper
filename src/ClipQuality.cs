using System;
using System.Collections.Generic;

namespace ChoreoHelper.Exporter;

/// <summary>
/// v0.7.1 FIX-C（AUD2-006）：录制质检纯函数件（无依赖、datalayertest 直测）。
///
/// 幅度口径与网页 recAmp（web\choreo-helper-app.html）和 scripts\batch-record.js 的 amplitude()
/// 完全同源：每根骨骼的 q 关键帧 [t,x,y,z,w]，相对首帧 [x,y,z,w] 的 L1 距离取全体最大值。
/// 实测校准（2026-08-28 全库）：静止 ≈0，正常动作 ≥0.31；阈值 0.3 与网页一致。
/// 交叉测试：scripts\qc-crosstest.js 用同一批向量断言 C# 与 JS 算出相同数值，
/// 防止两套实现漂移（施工包 03 明确要求）。
/// 用途：插件内批量录制（/export/batch 没有网页质检兜底）在覆盖 clips 目录前先自检，
/// 静止坏片落到隔离目录，不吃掉好数据。
/// </summary>
public static class ClipQuality
{
    /// <summary>静止阈值，与网页 recRunLoop/recLibQc 的 0.3 同一口径。</summary>
    public const double StillThreshold = 0.3;

    /// <summary>clip 旋转幅度 = 每骨骼 q 帧相对首帧 [x,y,z,w] 的 L1 距离最大值（与网页 recAmp 同源）。</summary>
    public static double MaxRotationOffset(AnimClipData? clip)
    {
        if (clip?.bones == null) return 0;
        var best = 0.0;
        foreach (var ch in clip.bones.Values)
        {
            var q = ch.q;
            if (q == null || q.Count < 2) continue;
            double ax = q[0][1], ay = q[0][2], az = q[0][3], aw = q[0][4];
            foreach (var fr in q)
            {
                var m = Math.Abs(fr[1] - ax) + Math.Abs(fr[2] - ay)
                      + Math.Abs(fr[3] - az) + Math.Abs(fr[4] - aw);
                if (m > best) best = m;
            }
        }
        return best;
    }

    /// <summary>是否静止坏片（低于阈值即判静止）。表情类豁免由调用方决定（插件侧无表情清单）。</summary>
    public static bool IsStill(AnimClipData? clip) => MaxRotationOffset(clip) < StillThreshold;
}
