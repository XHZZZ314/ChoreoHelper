// 这个文件是干嘛的：逐框架帧记录原地身体朝向候选的真实响应；不输出输入、不采纳控制配置或开放执行。
using System;
using System.Collections.Generic;

namespace ChoreoHelper;

public sealed record X1StationaryFacingObservation(X1ReferenceDiagnosticObservation Snapshot,
    bool OutputOwnerActive, bool AnyOwnedInputHeld, bool CleanupFailed);
public sealed record X1StationaryFacingFrame(X1StationaryFacingObservation? Observation, string? Error = null);
public sealed record X1StationaryFacingReport(long Generation, string Candidate, bool Completed,
    bool StationaryBodyResponseObserved, bool ExecutionEnabled, bool ArbitraryAngleControlVerified,
    bool PhysicalTakeoverVerified, string Status, long AtMs, long RequestedDurationMs,
    long MaxRecordedFrameGapMs, long FinalStableMs, double TotalHorizontalTravelM,
    double MaxHorizontalExcursionM, double MaxVerticalExcursionM, double TotalBodyAngleDeg,
    double FinalBodyDeltaDeg, double TotalCameraAngleDeg, long PhysicalChanges,
    long InjectedChanges, long ForeignInjectedChanges, IReadOnlyList<X1StationaryFacingFrame> Frames);

/// <summary>宿主在框架线程串行调用。这里只观察外部明确的短输入候选，不接收输出委托。
/// 允许被标明的工具注入，因而永远不证明本人接管；候选响应也不证明任意角度控制。
/// 完成只说明采样窗口结束；原地候选还需完整窗口累计/最大位移不超 1cm、净身体
/// 转角至少 3 度、最后 250ms 位置/身体稳定。误差仅覆盖记录帧，不证明帧间连续轨迹。
/// 失败报告保留已有原始帧；重新开始必须显式 Begin，旧代次回调不能污染新观察。
/// 宿主必须在窗口结束后另外确认外部工具释放鼠标/按键；本层不拥有或认证其输入。</summary>
public sealed class X1StationaryFacingEvidence
{
    public const long MinDurationMs = 1000, MaxDurationMs = 15000, MaxFrameGapMs = 100, StableMs = 250;
    public const double StationaryToleranceM = .01, StablePositionM = .005, StableAngleDeg = .5,
        MinBodyChangeDeg = 3, MaxTotalAngleDeg = 180;
    public const int MaxFrames = 4096;
    private readonly List<X1StationaryFacingFrame> _frames = new();
    private X1StationaryFacingObservation? _start, _last, _stableOrigin;
    private long _generation, _durationMs, _maxGap, _stableSince;
    private string _candidate = "";
    private double _travel, _excursion, _vertical, _bodyAngle, _cameraAngle;
    public bool Active { get; private set; }
    public long Generation => _generation;
    public X1StationaryFacingReport? LastReport { get; private set; }

    public long Begin(string candidate, X1StationaryFacingObservation observation, long durationMs = MaxDurationMs)
    {
        if (Active) throw new InvalidOperationException("现有朝向观察尚未结束，不能覆盖");
        if (string.IsNullOrWhiteSpace(candidate) || candidate.Length > 80)
            throw new InvalidOperationException("请明确填写本次朝向候选名称（1至80字）");
        if (durationMs < MinDurationMs || durationMs > MaxDurationMs)
            throw new InvalidOperationException("朝向观察只允许1至15秒");
        var error = FrameError(observation);
        if (error.Length == 0 && observation.Snapshot.Input.AnyPhysicalHeld) error = "开始朝向观察前请先全松";
        if (error.Length != 0) throw new InvalidOperationException(error);
        _generation++; _candidate = candidate; _durationMs = durationMs;
        _start = _last = _stableOrigin = observation; _stableSince = observation.Snapshot.Pose.TimeMs;
        _maxGap = 0; _travel = _excursion = _vertical = _bodyAngle = _cameraAngle = 0;
        _frames.Clear(); _frames.Add(new(observation)); Active = true;
        LastReport = Report(false, false, "正在逐帧记录；不输出动作，也未接受朝向控制", _stableSince);
        return _generation;
    }

    public void Observe(long generation, X1StationaryFacingObservation observation)
    {
        if (!Active || generation != _generation) return;
        var error = FrameError(observation);
        if (error.Length != 0) { Fail(error, observation); return; }
        var current = observation.Snapshot; var previous = _last!.Snapshot; var start = _start!.Snapshot;
        var gap = current.Pose.TimeMs - previous.Pose.TimeMs;
        if (gap > 0) _maxGap = Math.Max(_maxGap, gap);
        if (gap <= 0 || gap > MaxFrameGapMs) { Fail("朝向观察时刻重复、倒退或断帧超过100毫秒", observation); return; }
        if (!SameIdentity(current, start)) { Fail("朝向观察的角色、区域、键位、镜头模式或步行状态发生变化", observation); return; }
        if (current.Input.FocusLossSequence != start.Input.FocusLossSequence)
        { Fail("朝向观察期间发生失焦", observation); return; }
        if (current.Input.PhysicalChangeSequence < previous.Input.PhysicalChangeSequence
            || current.Input.InjectedChangeSequence < previous.Input.InjectedChangeSequence
            || current.Input.ForeignInjectedChangeSequence < previous.Input.ForeignInjectedChangeSequence)
        { Fail("朝向观察的输入来源计数重置或倒退", observation); return; }
        if (_frames.Count >= MaxFrames) { Fail("朝向观察帧数超过上限", observation); return; }
        var travel = _travel + Distance(current.Pose, previous.Pose);
        var excursion = Math.Max(_excursion, Distance(current.Pose, start.Pose));
        var vertical = Math.Max(_vertical, Math.Abs(current.Pose.Y - start.Pose.Y));
        var bodyAngle = _bodyAngle + Math.Abs(DeltaDeg(current.Pose.RotationRad, previous.Pose.RotationRad));
        var cameraAngle = _cameraAngle + Math.Abs(DeltaDeg(current.Reference.CameraDirH!.Value, previous.Reference.CameraDirH!.Value));
        if (!double.IsFinite(travel) || !double.IsFinite(excursion) || !double.IsFinite(vertical)
            || !double.IsFinite(bodyAngle) || !double.IsFinite(cameraAngle))
        { Fail("朝向观察累计数值无效", observation); return; }
        _travel = travel; _excursion = excursion; _vertical = vertical; _bodyAngle = bodyAngle; _cameraAngle = cameraAngle;
        _last = observation; _frames.Add(new(observation));
        if (_bodyAngle > MaxTotalAngleDeg || _cameraAngle > MaxTotalAngleDeg)
        { Fail("朝向候选累计身体或镜头转角超过180度", null); return; }
        var stable = _stableOrigin!.Snapshot.Pose;
        if (Distance(current.Pose, stable) > StablePositionM || Math.Abs(current.Pose.Y - stable.Y) > StablePositionM
            || Math.Abs(DeltaDeg(current.Pose.RotationRad, stable.RotationRad)) > StableAngleDeg)
        { _stableOrigin = observation; _stableSince = current.Pose.TimeMs; }
        var elapsed = current.Pose.TimeMs - start.Pose.TimeMs;
        if (elapsed < _durationMs)
        { LastReport = Report(false, false, "正在逐帧记录候选；身体角度和位移均取实际值", current.Pose.TimeMs); return; }
        Active = false;
        var response = _travel <= StationaryToleranceM && _excursion <= StationaryToleranceM
            && _vertical <= StationaryToleranceM && Math.Abs(DeltaDeg(current.Pose.RotationRad, start.Pose.RotationRad)) >= MinBodyChangeDeg
            && current.Pose.TimeMs - _stableSince >= StableMs && !current.Input.AnyPhysicalHeld;
        LastReport = Report(true, response, response
            ? "本次记录帧观察到低位移身体转角；外部输入释放仍须另核，不代表任意角度控制或本人接管"
            : "观察窗口结束；本次没有满足原地身体转角候选条件", current.Pose.TimeMs);
    }

    public void Cancel(long generation, string reason, long atMs)
    {
        if (!Active || generation != _generation) return;
        Active = false;
        LastReport = Report(false, false, string.IsNullOrWhiteSpace(reason) ? "本次朝向观察已取消" : reason,
            Math.Max(_last!.Snapshot.Pose.TimeMs, atMs));
    }

    private void Fail(string error, X1StationaryFacingObservation? observation)
    {
        // 无效浮点帧不放进JSON；明确保留缺失原因，不把它伪造成零坐标。
        if (_frames.Count < MaxFrames) _frames.Add(new(IsSerializable(observation) ? observation : null, error));
        Active = false;
        LastReport = Report(false, false, error, IsSerializable(observation)
            ? Math.Max(_last!.Snapshot.Pose.TimeMs, observation!.Snapshot.Pose.TimeMs) : _last!.Snapshot.Pose.TimeMs);
    }

    private X1StationaryFacingReport Report(bool completed, bool response, string status, long atMs)
    {
        var current = _last!.Snapshot; var start = _start!.Snapshot;
        return new(_generation, _candidate, completed, response, false, false, false, status, atMs, _durationMs,
            _maxGap, Math.Max(0, current.Pose.TimeMs - _stableSince), _travel, _excursion, _vertical, _bodyAngle,
            DeltaDeg(current.Pose.RotationRad, start.Pose.RotationRad), _cameraAngle,
            current.Input.PhysicalChangeSequence - start.Input.PhysicalChangeSequence,
            current.Input.InjectedChangeSequence - start.Input.InjectedChangeSequence,
            current.Input.ForeignInjectedChangeSequence - start.Input.ForeignInjectedChangeSequence,
            Array.AsReadOnly(_frames.ToArray()));
    }

    private static string FrameError(X1StationaryFacingObservation? observation)
    {
        if (!IsSerializable(observation)) return "朝向观察缺少有效的角色、时间或镜头读数";
        var o = observation!.Snapshot; var i = o.Input;
        if (o.Bindings == null || !o.MovementMode.HasValue || !o.Safe)
            return "朝向观察的键位、移动模式或安全条件不可用：" + o.Reason;
        if (o.Reference.EventCameraAutoControl != false || o.Reference.CameraControlMode is not (1 or 2)
            || o.Reference.CameraZoomMode != 1 || o.Reference.IsWalkingDuringAutorun != false)
            return "朝向观察需要普通第三人称镜头且没有自动行走";
        if (Math.Abs(o.Reference.AtMs - o.Pose.TimeMs) > MaxFrameGapMs)
            return "朝向与镜头读数不在同一新鲜观测范围";
        if (!i.Enabled || !i.Healthy || !i.Foreground || !i.NeutralEstablished || i.Armed || i.ManualTakeover)
            return "朝向观察需要健康前台全松基线，且不能武装演出或接管检查";
        if (i.PhysicalChangeSequence < 0 || i.InjectedChangeSequence < 0 || i.ForeignInjectedChangeSequence < 0
            || i.ForeignInjectedChangeSequence > i.InjectedChangeSequence)
            return "朝向观察的输入来源计数无效";
        if (observation.OutputOwnerActive || observation.AnyOwnedInputHeld || observation.CleanupFailed)
            return "朝向只读观察期间出现输出持有者、遗留输入或清理失败";
        return "";
    }

    private static bool IsSerializable(X1StationaryFacingObservation? o) => o?.Snapshot != null
        && o.Snapshot.Pose.IsFinite && o.Snapshot.Pose.TimeMs >= 0 && o.Snapshot.Reference is { Readable: true, AtMs: >= 0 };
    private static bool SameIdentity(X1ReferenceDiagnosticObservation a, X1ReferenceDiagnosticObservation b)
        => a.Pose.ActorId == b.Pose.ActorId && a.Pose.Territory == b.Pose.Territory && a.Bindings.Identity == b.Bindings.Identity
        && a.MovementMode == b.MovementMode && a.Reference.CameraControlMode == b.Reference.CameraControlMode
        && a.Reference.CameraZoomMode == b.Reference.CameraZoomMode && a.Reference.ActiveCameraIndex == b.Reference.ActiveCameraIndex
        && a.Reference.EventCameraAutoControl == b.Reference.EventCameraAutoControl
        && a.Reference.IsWalking == b.Reference.IsWalking && a.Reference.IsWalkingDuringAutorun == b.Reference.IsWalkingDuringAutorun;
    private static double Distance(X1CalibrationPose a, X1CalibrationPose b)
        => Math.Sqrt((a.X - b.X) * (a.X - b.X) + (a.Z - b.Z) * (a.Z - b.Z));
    private static double DeltaDeg(double a, double b)
    {
        var delta = ((a % (2 * Math.PI) - b % (2 * Math.PI)) * 180 / Math.PI) % 360;
        if (delta > 180) delta -= 360;
        if (delta < -180) delta += 360;
        return delta;
    }
}
