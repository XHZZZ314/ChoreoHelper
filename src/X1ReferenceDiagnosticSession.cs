// 这个文件是干嘛的：一次有界按键诊断记录真实坐标、人物与镜头响应；只留证据，绝不采用移动校准。
using System;
using System.Collections.Generic;

namespace ChoreoHelper;

public sealed record X1ReferenceDiagnosticObservation(X1KeyBindings Bindings, X1CalibrationPose Pose,
    X1MovementReferenceSnapshot Reference, uint? MovementMode, X1PhysicalInputSnapshot Input, bool Safe, string Reason);
public sealed record X1ReferenceDiagnosticFrame(X1Control? HeldControl, X1ReferenceDiagnosticObservation? Observation,
    string? ObservationError = null);
public sealed record X1ReferenceDiagnosticReport(bool Completed, X1Control Control, string Status, long AtMs,
    double TotalDistanceM, double TotalActorAngleDeg, double TotalCameraAngleDeg,
    IReadOnlyList<X1ReferenceDiagnosticFrame> Frames);

/// <summary>单次明确 Forward/TurnLeft/TurnRight，150ms 按下后 250ms 全松观察。
/// 转身或镜头转动是原始待解释证据，不能调用此会话冒充旧三方向响应校准。
/// 输出委托必须同步完成写入，禁止在返回后留下未跟踪的后台按键；在途取消保留占有直至确认释放。</summary>
public sealed class X1ReferenceDiagnosticSession
{
    public const long PressMs = 150, RestMs = 250, MaxFrameGapMs = 100, MaxTotalMs = 2000;
    public const double MaxDistanceM = 1.25, MaxActorAngleDeg = 180, MaxCameraAngleDeg = 180, MaxHeightM = .15;
    public const int MaxFrames = 512;
    private readonly Action<X1Control> _press;
    private readonly Action _release;
    private readonly Func<bool> _held;
    private readonly Func<X1ReferenceDiagnosticObservation> _readCurrent;
    private readonly List<X1ReferenceDiagnosticFrame> _frames = new();
    private X1ReferenceDiagnosticObservation? _origin, _last;
    private X1Control _control;
    private X1Control? _desired;
    private long _generation, _ownerGeneration, _phaseStartMs;
    private bool _pressInFlight;
    private string? _deferredStopReason;
    private long _deferredStopAtMs, _deferredStopOwner;
    private double _distance, _actorAngle, _cameraAngle;
    private Phase _phase;
    private enum Phase { Starting, Pressing, Resting }
    public bool Active { get; private set; }
    public bool OwnsInput { get; private set; }
    public bool CleanupFailed { get; private set; }
    public string Message { get; private set; } = "尚未执行移动参考诊断";
    public X1ReferenceDiagnosticReport? LastReport { get; private set; }
    public IReadOnlyList<X1ReferenceDiagnosticFrame> Frames => Array.AsReadOnly(_frames.ToArray());

    public X1ReferenceDiagnosticSession(Action<X1Control> press, Action release, Func<bool> held,
        Func<X1ReferenceDiagnosticObservation> readCurrent)
    { _press = press; _release = release; _held = held; _readCurrent = readCurrent; }

    public void Begin(X1Control control, X1ReferenceDiagnosticObservation observation)
    {
        var generation = _generation;
        if (Active || OwnsInput || CleanupFailed || _pressInFlight || _held())
            throw new InvalidOperationException("诊断输入仍被持有，请先明确关闭并确认释放");
        if (control is not (X1Control.Forward or X1Control.TurnLeft or X1Control.TurnRight))
            throw new InvalidOperationException("一次诊断只允许前进、左转或右转中的一个");
        var error = InitialError(observation);
        if (error.Length != 0) throw new InvalidOperationException(error);
        if (_generation != generation) throw new InvalidOperationException("诊断准备期间所有权已变化");
        _ownerGeneration = ++_generation; _control = control; _desired = null; _origin = _last = observation;
        _deferredStopReason = null;
        _distance = _actorAngle = _cameraAngle = 0; _phase = Phase.Starting;
        _frames.Clear(); _frames.Add(new(null, observation));
        Active = OwnsInput = true;
        Message = "准备单次 " + control + " 参考诊断；只记录响应，不采用方向配置";
    }

    public void Tick(X1ReferenceDiagnosticObservation observation)
    {
        if (!Active || CleanupFailed || _pressInFlight) return;
        var generation = _generation;
        try
        {
            Observe(observation, _phase == Phase.Starting);
            if (_phase == Phase.Starting)
            {
                if (!ReleaseConfirmed(generation) || !Active) return;
                var fresh = _readCurrent();
                if (_generation != generation || !Active) return;
                Observe(fresh, true); // 真正按下之前再读游戏/物理状态，不能使用 Tick 入口的旧许可。
                _phaseStartMs = fresh.Pose.TimeMs; _phase = Phase.Pressing; _desired = _control;
                PressWithOwnership(_control);
                if (_generation != generation || !Active) return;
                Message = "单次 " + _control + " 诊断短按中；本人输入立即取消";
                return;
            }
            var elapsed = observation.Pose.TimeMs - _phaseStartMs;
            if (_phase == Phase.Pressing)
            {
                if (elapsed < PressMs) return;
                if (elapsed > PressMs + MaxFrameGapMs) throw new InvalidOperationException("诊断短按释放时刻超限");
                if (!ReleaseConfirmed(generation) || !Active) return;
                _phase = Phase.Resting; _phaseStartMs = observation.Pose.TimeMs;
                Message = "诊断已松键，正在记录停止后的坐标与镜头";
                return;
            }
            if (elapsed < RestMs) return;
            if (!ReleaseConfirmed(generation) || !Active) return;
            var final = _readCurrent();
            if (_generation != generation || !Active) return;
            Observe(final, true);
            Active = OwnsInput = false;
            Message = "单次参考诊断已完成并确认全松；只有原始证据，未采用校准或开放执行";
            LastReport = Report(true, Message, final.Pose.TimeMs);
        }
        catch (Exception error)
        {
            if (_generation != generation) return;
            if (CleanupFailed)
            {
                Active = false; Message = "诊断释放未确认，请明确停止后重试：" + error.Message;
                LastReport = Report(false, Message, observation.Pose.TimeMs);
            }
            else Stop("诊断已取消：" + error.Message, observation.Pose.TimeMs);
        }
    }

    public void Stop(string reason, long nowMs)
    {
        if (!OwnsInput && !CleanupFailed) return;
        var generation = ++_generation; Active = false;
        if (_pressInFlight)
        {
            // 委托仍可能在取消之后真正落下按键。先作废本代，保留占有直到它返回；不能提前报全松或允许新 Begin。
            _deferredStopReason = reason; _deferredStopAtMs = nowMs; _deferredStopOwner = _ownerGeneration;
            Message = reason + "；等待当前按键写入返回后确认释放，输入清理权仍被持有";
            return;
        }
        CompleteStop(reason, nowMs, generation);
    }

    private void PressWithOwnership(X1Control control)
    {
        var owner = _ownerGeneration;
        _pressInFlight = true;
        try { _press(control); }
        finally
        {
            _pressInFlight = false;
            // 正常返回和抛错都走此处；只完成仍属于这次占有的延后取消，不得释放后来场次的键。
            if (OwnsInput && !Active && _ownerGeneration == owner && _deferredStopOwner == owner
                && _deferredStopReason is { } reason)
            {
                var at = _deferredStopAtMs;
                _deferredStopReason = null;
                CompleteStop(reason, at, _generation);
            }
        }
    }

    private void CompleteStop(string reason, long nowMs, long generation)
    {
        try
        {
            if (!ReleaseConfirmed(generation)) return;
            OwnsInput = false; Message = reason; LastReport = Report(false, reason, nowMs);
        }
        catch (Exception error)
        {
            if (_generation != generation) return;
            Message = reason + "；释放未确认，请明确停止重试：" + error.Message;
            LastReport = Report(false, Message, nowMs);
        }
    }

    private void Observe(X1ReferenceDiagnosticObservation observation, bool allowSameTime)
    {
        // 失败帧也保留；固定上限避免异常调用无限增加诊断内存。
        if (_frames.Count >= MaxFrames) throw new InvalidOperationException("诊断帧数超限");
        // 非有限失败帧用明确缺测占位；绝不填零伪造采集，也不把 NaN 留给默认 JSON 序列化器。
        _frames.Add(SerializableNumbers(observation) ? new(_desired, observation)
            : new(_desired, null, "本帧包含非有限数值，原始观测不可采用；未伪造坐标或参考方向"));
        var error = CheckCurrentObservation(observation);
        if (error.Length != 0) throw new InvalidOperationException(error);
        var origin = _origin!; var last = _last!;
        var r = observation.Reference;
        var gap = observation.Pose.TimeMs - last.Pose.TimeMs;
        if (gap < 0 || gap == 0 && (!allowSameTime || observation.Pose != last.Pose) || gap > MaxFrameGapMs)
            throw new InvalidOperationException("诊断帧时刻重复、倒退或断档");
        if (observation.Pose.TimeMs - origin.Pose.TimeMs > MaxTotalMs)
            throw new InvalidOperationException("诊断总时间超限");
        var dx = observation.Pose.X - last.Pose.X; var dz = observation.Pose.Z - last.Pose.Z;
        var distance = Math.Sqrt(dx * dx + dz * dz);
        if (!double.IsFinite(distance)) throw new InvalidOperationException("诊断位移计算超出有限数值范围");
        _distance += distance;
        _actorAngle += Math.Abs(Delta(observation.Pose.RotationRad, last.Pose.RotationRad));
        _cameraAngle += Math.Abs(Delta(r.CameraDirH!.Value, last.Reference.CameraDirH!.Value));
        _last = observation;
        if (!double.IsFinite(_distance) || !double.IsFinite(_actorAngle) || !double.IsFinite(_cameraAngle)
            || _distance > MaxDistanceM || _actorAngle > MaxActorAngleDeg || _cameraAngle > MaxCameraAngleDeg
            || Math.Abs(observation.Pose.Y - origin.Pose.Y) > MaxHeightM)
            throw new InvalidOperationException("诊断累计位移、转角或高度超限");
    }

    /// <summary>宿主实际写键前可对其最后一次读取重复核对；不改变帧、状态或所有权。</summary>
    public string CheckCurrentObservation(X1ReferenceDiagnosticObservation observation)
    {
        if (!Active || CleanupFailed || _origin == null || _last == null) return "参考诊断已取消或失去输入所有权";
        var error = InitialError(observation);
        if (error.Length != 0) return error;
        var origin = _origin;
        if (observation.Bindings.Identity != origin.Bindings.Identity || observation.Pose.ActorId != origin.Pose.ActorId
            || observation.Pose.Territory != origin.Pose.Territory || observation.MovementMode != origin.MovementMode)
            return "诊断期间角色、区域、键位或移动模式改变";
        var r = observation.Reference; var start = origin.Reference;
        if (r.CameraControlMode != start.CameraControlMode || r.CameraZoomMode != start.CameraZoomMode
            || r.ActiveCameraIndex != start.ActiveCameraIndex || r.EventCameraAutoControl != start.EventCameraAutoControl
            || r.IsWalking != start.IsWalking || r.IsWalkingDuringAutorun != start.IsWalkingDuringAutorun)
            return "诊断期间镜头模式或步行状态改变";
        var input = observation.Input; var initial = origin.Input;
        if (input.PhysicalChangeSequence != initial.PhysicalChangeSequence
            || input.ForeignInjectedChangeSequence != initial.ForeignInjectedChangeSequence
            || input.FocusLossSequence != initial.FocusLossSequence)
            return "诊断期间出现本人输入、其他自动输入或失焦";
        var gap = observation.Pose.TimeMs - _last.Pose.TimeMs;
        if (gap < 0 || gap > MaxFrameGapMs || observation.Pose.TimeMs - origin.Pose.TimeMs > MaxTotalMs)
            return "诊断即时观测过期或断档";
        return "";
    }

    private static string InitialError(X1ReferenceDiagnosticObservation observation)
    {
        if (!observation.Safe) return string.IsNullOrWhiteSpace(observation.Reason) ? "实际游戏条件不允许诊断" : observation.Reason;
        if (observation.Bindings == null || !observation.Pose.IsFinite || observation.Pose.TimeMs < 0
            || !observation.MovementMode.HasValue || observation.Reference == null || !observation.Reference.Readable)
            return "角色、移动模式、镜头或步行状态不可读，不能诊断";
        var r = observation.Reference;
        if (Math.Abs((double)r.AtMs - observation.Pose.TimeMs) > MaxFrameGapMs)
            return "镜头与角色不是同一新鲜观测";
        if (r.CameraControlMode is not (1 or 2) || r.CameraZoomMode != 1 || r.EventCameraAutoControl != false)
            return "只诊断普通第三人称镜头；第一人称、锁定或剧情镜头不采用";
        var input = observation.Input;
        if (!input.Enabled || !input.Healthy || !input.Foreground || !input.Armed || !input.NeutralEstablished
            || input.ManualTakeover || input.AnyPhysicalHeld)
            return "诊断需要健康物理观察、新鲜全松和游戏前台；本人输入会取消";
        return "";
    }

    private bool ReleaseConfirmed(long generation)
    {
        try
        {
            _release();
            if (_generation != generation) return false;
            var held = _held();
            if (_generation != generation) return false;
            if (held) throw new InvalidOperationException("仍有未确认释放的按键");
            _desired = null; CleanupFailed = false; return true;
        }
        catch { if (_generation == generation) { CleanupFailed = OwnsInput = true; } throw; }
    }

    private X1ReferenceDiagnosticReport Report(bool completed, string reason, long nowMs)
        => new(completed, _control, reason, nowMs, _distance, _actorAngle, _cameraAngle, Frames);
    private static bool SerializableNumbers(X1ReferenceDiagnosticObservation observation)
    {
        var pose = observation.Pose; var r = observation.Reference;
        return double.IsFinite(pose.X) && double.IsFinite(pose.Y) && double.IsFinite(pose.Z) && double.IsFinite(pose.RotationRad)
            && r != null && (!r.CameraDirH.HasValue || double.IsFinite(r.CameraDirH.Value))
            && (!r.CameraDirV.HasValue || double.IsFinite(r.CameraDirV.Value))
            && (!r.CameraPosition.HasValue || r.CameraPosition.Value.IsFinite)
            && (!r.CameraLookAt.HasValue || r.CameraLookAt.Value.IsFinite);
    }
    private static double Delta(double current, double previous)
        => X1InputCalibration.SignedDegrees(((current % (2 * Math.PI)) - (previous % (2 * Math.PI))) * 180 / Math.PI);
}
