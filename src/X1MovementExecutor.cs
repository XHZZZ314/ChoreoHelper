// 这个文件是干嘛的：X1 移动纯执行器——分段线性插值、有界修正、终点容差故障停，意图只进记录槽。
using System;
using System.Collections.Generic;

namespace ChoreoHelper;

public sealed class X1MovementExecutor
{
    public X1MovementInput Input { get; }
    public long StartShowMs { get; }
    public bool Released { get; private set; }

    private X1MovementExecutor(X1MovementInput input, long startShowMs)
    {
        Input = input;
        StartShowMs = startShowMs;
    }

    public static (bool Ok, string Error, X1MovementExecutor? Exec) TryCreate(X1MovementInput input, long startShowMs)
    {
        var (ok, err) = X1InputValidation.ValidateMovement(input);
        if (!ok) return (false, err, null);
        return (true, "", new X1MovementExecutor(input, startShowMs));
    }

    public long EndShowMs => StartShowMs + (Input.Points.Count == 0 ? 0 : Input.Points[^1].TMs);

    /// <summary>按演出时钟计算目标点并发出有界修正意图。终点外零追赶：终点后不再输出。</summary>
    public (bool Ok, string Error, X1MovementFailure Failure) Update(long showTimeMs, double obsX, double obsZ, IX1MovementSink sink)
    {
        if (Released) return (true, "", X1MovementFailure.None);
        if (sink == null) return (false, "移动事件「" + Input.EventId + "」缺少记录槽：无槽时拒绝执行", X1MovementFailure.MissingSink);
        if (!X1InputValidation.IsFiniteDouble(obsX) || !X1InputValidation.IsFiniteDouble(obsZ))
            return (false, "移动事件「" + Input.EventId + "」观测位置须为有限数值", X1MovementFailure.NonFiniteObservation);
        var local = showTimeMs - StartShowMs;
        if (local < 0) return (true, "", X1MovementFailure.None);
        var pts = Input.Points;
        var endLocal = pts[^1].TMs;
        if (local >= endLocal)
        {
            var ex = pts[^1].X;
            var ez = pts[^1].Z;
            var errDist = Distance(obsX, obsZ, ex, ez);
            if (errDist > Input.ArrivalToleranceM)
            {
                MarkReleased();
                try { sink.ReleaseMovement(Input.EventId); } catch { }
                return (false, "移动事件「" + Input.EventId + "」终点到达误差超限：观测误差" + errDist.ToString("F3") + "米大于容差" + Input.ArrivalToleranceM.ToString("F3") + "米", X1MovementFailure.ToleranceExceeded);
            }
            MarkReleased();
            try { sink.ReleaseMovement(Input.EventId); } catch { }
            return (true, "", X1MovementFailure.None);
        }
        var (tx, tz) = Interpolate(pts, local);
        var dx = tx - obsX;
        var dz = tz - obsZ;
        var dist = Math.Sqrt(dx * dx + dz * dz);
        double ox = 0, oz = 0;
        if (dist > 1e-12)
        {
            var bound = Math.Min(dist, Input.MaxCorrectionM);
            ox = dx / dist * bound;
            oz = dz / dist * bound;
        }
        try
        {
            sink.EmitCorrection(Input.EventId, ox, oz, tx, tz, showTimeMs);
        }
        catch (Exception ex)
        {
            return (false, "移动事件「" + Input.EventId + "」记录槽异常：" + ex.Message, X1MovementFailure.SinkException);
        }
        return (true, "", X1MovementFailure.None);
    }

    public void Release(IX1MovementSink sink)
    {
        if (Released) return;
        MarkReleased();
        sink?.ReleaseMovement(Input.EventId);
    }

    private void MarkReleased() => Released = true;

    public static (double X, double Z) Interpolate(List<X1Waypoint> pts, long local)
    {
        if (pts.Count == 1) return (pts[0].X, pts[0].Z);
        if (local <= pts[0].TMs) return (pts[0].X, pts[0].Z);
        for (var i = 1; i < pts.Count; i++)
        {
            if (local <= pts[i].TMs)
            {
                var a = pts[i - 1];
                var b = pts[i];
                var span = b.TMs - a.TMs;
                if (span <= 0) return (b.X, b.Z);
                var k = (double)(local - a.TMs) / span;
                return (a.X + (b.X - a.X) * k, a.Z + (b.Z - a.Z) * k);
            }
        }
        return (pts[^1].X, pts[^1].Z);
    }

    /// <summary>当前段切向（度，atan2(dx,dz)）；静止段（同 x/z）返回 false 由调用方保持上次输出。</summary>
    public bool TryGetTangentDeg(long showTimeMs, out double angleDeg)
    {
        angleDeg = 0;
        if (Released) return false;
        var local = showTimeMs - StartShowMs;
        var pts = Input.Points;
        if (pts.Count < 2 || local < 0 || local >= pts[^1].TMs) return false;
        for (var i = 1; i < pts.Count; i++)
        {
            if (local < pts[i].TMs || (local == pts[i].TMs && i == pts.Count - 1))
            {
                var dx = pts[i].X - pts[i - 1].X;
                var dz = pts[i].Z - pts[i - 1].Z;
                if (Math.Abs(dx) < 1e-12 && Math.Abs(dz) < 1e-12) return false;
                angleDeg = NormalizeDeg(Math.Atan2(dx, dz) * 180.0 / Math.PI);
                return true;
            }
            if (local == pts[i].TMs && i + 1 < pts.Count)
            {
                var dx = pts[i + 1].X - pts[i].X;
                var dz = pts[i + 1].Z - pts[i].Z;
                if (Math.Abs(dx) < 1e-12 && Math.Abs(dz) < 1e-12) return false;
                angleDeg = NormalizeDeg(Math.Atan2(dx, dz) * 180.0 / Math.PI);
                return true;
            }
        }
        return false;
    }

    public static double NormalizeDeg(double deg)
    {
        var r = deg % 360.0;
        if (r < 0) r += 360.0;
        return r;
    }

    public static double Distance(double x1, double z1, double x2, double z2)
    {
        var dx = x2 - x1;
        var dz = z2 - z1;
        return Math.Sqrt(dx * dx + dz * dz);
    }
}
