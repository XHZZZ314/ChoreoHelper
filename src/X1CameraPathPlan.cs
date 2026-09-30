// 这个文件是干嘛的：冻结已登记的正式采样路径，供单事件有界真坐标试验；不启动整场、不延长事件时钟。
using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;

namespace ChoreoHelper;

public sealed record X1CameraPathPoint(long TMs, double X, double Z);

public sealed class X1CameraPathPlan
{
    private readonly Action _checkRegistration;
    private readonly bool[] _holds;
    public string PackageId { get; }
    public string ClientLoadId { get; }
    public string EventId { get; }
    public string PerformerId { get; }
    public string ActorId { get; }
    public uint TerritoryId { get; }
    public string StageId { get; }
    public long SourceStartMs { get; }
    public long DurationMs => Points[^1].TMs;
    public double ArrivalToleranceM { get; }
    public double MaxCorrectionM { get; }
    public X1Locomotion Locomotion { get; }
    public IReadOnlyList<X1CameraPathPoint> Points { get; }

    public X1CameraPathPlan(ShowPackage package, string eventId, Action checkRegistration, string packageId, string clientLoadId)
    {
        if (!X1ShowProtocol.IsIdentity(packageId) || !X1ShowProtocol.IsIdentity(clientLoadId))
            throw new InvalidOperationException("路径试验需要当前明确的整包和装载身份");
        PackageId = packageId; ClientLoadId = clientLoadId;
        _checkRegistration = checkRegistration ?? throw new ArgumentNullException(nameof(checkRegistration));
        _checkRegistration();
        var snapshot = X1PreparedPackage.ClonePackage(package);
        var validation = ShowValidator.ValidateForPreparation(snapshot, true);
        if (!validation.Ok || snapshot.X1 == null) throw new InvalidOperationException(validation.FirstError ?? "需要当前完整 X1 登记");
        var selected = snapshot.Events.SingleOrDefault(e => e.Id == eventId && e.Kind == "movement")
            ?? throw new InvalidOperationException("当前登记没有这个明确的路径事件");
        var input = selected.X1!.CreateMovementInput(selected.Id, selected.PerformerId);
        _holds = input.Points.Skip(1).Select((point, i) => point.X == input.Points[i].X && point.Z == input.Points[i].Z).ToArray();
        var binding = snapshot.X1.Bindings.Single(b => b.PerformerId == selected.PerformerId);
        var points = input.Points.Select(p => { var w = binding.Stage.ToWorld(p.X, p.Z); return new X1CameraPathPoint(p.TMs, w.X, w.Z); }).ToArray();
        if (points.Length < 2 || points.Length > 256 || points[0].TMs != 0 || points[^1].TMs <= 0
            || points[^1].TMs > X1CameraFeedbackPolicy.MaxTotalMs || selected.DurationMs != points[^1].TMs)
            throw new InvalidOperationException("路径试验需2至256个采样点，从0开始，事件时长一致且不超过4秒；不能重定时");
        if (input.ArrivalToleranceM > .12 || input.ArrivalToleranceM < .025)
            throw new InvalidOperationException("本次路径试验保留输入容差且不得放宽到0.12米以上");
        double length = 0;
        for (var i = 1; i < points.Length; i++)
            length += X1MovementExecutor.Distance(points[i - 1].X, points[i - 1].Z, points[i].X, points[i].Z);
        if (!double.IsFinite(length) || length > X1CameraFeedbackPolicy.MaxTotalDistanceM)
            throw new InvalidOperationException("本次路径试验完整计划路程不得超过1.5米");
        EventId = eventId; PerformerId = input.PerformerId; ActorId = binding.ActorId;
        TerritoryId = binding.TerritoryId; StageId = binding.Stage.Id; SourceStartMs = selected.StartMs;
        ArrivalToleranceM = input.ArrivalToleranceM; MaxCorrectionM = input.MaxCorrectionM; Locomotion = input.Locomotion;
        Points = Array.AsReadOnly(points);
        _checkRegistration();
    }

    /// <summary>每帧一致性核对：实际步行状态须等于本段申报档（自动切换后自然通过；玩家中途手动切换仍失败停止）。
    /// ignoreWalkingState=true 仅供就绪/武装检查（自动切换可用时开演前步态无关紧要，段开始前会由切换器设定）。</summary>
    public void CheckCurrent(X1ReferenceDiagnosticObservation observation, bool ignoreWalkingState = false)
    {
        _checkRegistration();
        if (observation.Pose.ActorId.ToString(CultureInfo.InvariantCulture) != ActorId || observation.Pose.Territory != TerritoryId)
            throw new InvalidOperationException("路径演员或区域已改变，本次登记失效");
        if ((!ignoreWalkingState && observation.Reference.IsWalking != (Locomotion == X1Locomotion.Walk))
            || observation.Reference.IsWalkingDuringAutorun != false)
            throw new InvalidOperationException("路径步态与实际步行状态不一致或未知；本场支持按段自动切换步态，中途手动改步态会停止本场");
    }

    public void CheckStart(X1ReferenceDiagnosticObservation observation, bool ignoreWalkingState = false)
    {
        CheckCurrent(observation, ignoreWalkingState);
        if (X1MovementExecutor.Distance(observation.Pose.X, observation.Pose.Z, Points[0].X, Points[0].Z) > ArrivalToleranceM)
            throw new InvalidOperationException("实际位置不在正式路径起点容差内；不能自动平移整条路径或先追赶起点");
    }

    public (double X, double Z) TargetAt(long elapsedMs)
    {
        if (elapsedMs <= 0) return (Points[0].X, Points[0].Z);
        for (var i = 1; i < Points.Count; i++)
        {
            if (elapsedMs > Points[i].TMs) continue;
            var a = Points[i - 1]; var b = Points[i]; var k = (double)(elapsedMs - a.TMs) / (b.TMs - a.TMs);
            return (a.X + (b.X - a.X) * k, a.Z + (b.Z - a.Z) * k);
        }
        return (Points[^1].X, Points[^1].Z);
    }

    // 只认原始相邻点完全相同的停留段；边界属于下一段，微小移动也不能伪装成停留。
    public bool IsHoldAt(long elapsedMs)
    {
        for (var i = 1; i < Points.Count; i++)
        {
            if (elapsedMs >= Points[i].TMs) continue;
            return _holds[i - 1];
        }
        return true;
    }

    // 只限制离散按键不能把当前路段变成横移/回头；45度保留三键选向内正常的小幅纠偏空间。
    // 这是输出方向门，不是实际轨迹或转角验收；世界坐标无法表示的微小原始移动不授权输出。
    public bool AllowsDirectionAt(long elapsedMs, double bearingDeg)
    {
        if (elapsedMs < 0 || !double.IsFinite(bearingDeg)) return false;
        for (var i = 1; i < Points.Count; i++)
        {
            if (elapsedMs >= Points[i].TMs) continue;
            if (_holds[i - 1]) return false;
            var dx = Points[i].X - Points[i - 1].X; var dz = Points[i].Z - Points[i - 1].Z;
            var length = Math.Sqrt(dx * dx + dz * dz);
            if (!double.IsFinite(length) || length <= 0) return false;
            var radians = bearingDeg * Math.PI / 180;
            return (dx * Math.Sin(radians) + dz * Math.Cos(radians)) / length >= Math.Cos(Math.PI / 4);
        }
        return false;
    }

    // 与正式执行器保持同一修正意图语义；它不是物理按键位移的硬上限。
    public (double X, double Z) CorrectionAt(long elapsedMs, double observedX, double observedZ)
    {
        var target = TargetAt(elapsedMs); var x = target.X - observedX; var z = target.Z - observedZ;
        var distance = Math.Sqrt(x * x + z * z);
        if (!double.IsFinite(distance)) throw new InvalidOperationException("路径修正计算不可用");
        if (distance <= 1e-12) return (0, 0);
        var scale = Math.Min(distance, MaxCorrectionM) / distance;
        return (x * scale, z * scale);
    }

    // 跨帧路点没有同刻实测，采用更保守的双端观测见证；不把线性插值当作真实坐标。
    public double CrossedWaypointWitnessError(long fromMs, double fromX, double fromZ, long toMs, double toX, double toZ)
    {
        double worst = 0;
        foreach (var point in Points)
            if (point.TMs > fromMs && point.TMs <= toMs)
                worst = Math.Max(worst, Math.Max(X1MovementExecutor.Distance(fromX, fromZ, point.X, point.Z),
                    X1MovementExecutor.Distance(toX, toZ, point.X, point.Z)));
        return worst;
    }
}
