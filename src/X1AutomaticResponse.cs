// 这个文件是干嘛的：演出/输入链丢失的配套类型声明（捐赠原文提取）。
// 捐赠源：automatic-probe-session-review-165406\src__X1AutomaticResponseProbe.cs。
using System;

namespace ChoreoHelper;

/// <summary>仅整套自动响应通过且最终全松休息结束后产生；不包含物理校准或接管通过声明。</summary>
public sealed class X1AutomaticResponseResult
{
    public string Source => "Automatic";
    public string BindingIdentity { get; }
    public X1CalibrationPose FinishedPose { get; }
    public IReadOnlyList<X1CalibrationSample> Samples { get; }
    internal X1AutomaticResponseResult(X1KeyBindings bindings, X1CalibrationPose finishedPose, IEnumerable<X1CalibrationSample> samples)
    { BindingIdentity = bindings.Identity; FinishedPose = finishedPose; Samples = Array.AsReadOnly(samples.ToArray()); }
}

/// <summary>默认三次短按只识别前进方向与左右转向符号；跟踪路程仍应使用每帧真实坐标误差。
/// Tick 的安全许可和中断原因必须来自宿主真实观测，不能将此结果当作物理接管证据。</summary>
public sealed class X1AutomaticResponseProbe
{
    public const long PressMs = 150, RestMs = 250, MaxFrameGapMs = 100, MaxTotalMs = 5000;
    public const double MaxPulseDistanceM = 1.25, MaxPulseAngleDeg = 45, MaxTotalAngleDeg = 90;
    public const double MaxRestDistanceM = 0.10, MaxRestAngleDeg = 3, MaxHeightM = 0.15;
    private readonly X1KeyBindings _bindings;
    private readonly X1CalibrationPose _origin;
    private readonly X1Control[] _controls;
    private readonly List<X1CalibrationSample> _samples = new();
    private X1CalibrationPose _last, _phaseStart;
    private int _index, _turnSign;
    private bool _hasTick;
    private double _phaseDistance, _phaseAngle, _phaseAbsoluteAngle, _totalDistance, _totalAngle;
    public X1AutomaticProbeState State { get; private set; } = X1AutomaticProbeState.Resting;
    public string Message { get; private set; } = "自动响应探测：先确认短时全松，不要求本人按键";
    public X1Control? DesiredControl => State == X1AutomaticProbeState.Pressing ? _controls[_index] : null;
    public bool Running => State is X1AutomaticProbeState.Resting or X1AutomaticProbeState.Pressing;
    public int CompletedSamples => _samples.Count;
    public int RequiredSamples => _controls.Length;
    public double MaximumTotalDistanceM => _bindings.HasAllDirections ? 5 : MaxPulseDistanceM;
    public X1AutomaticResponseResult? Result { get; private set; }

    public X1AutomaticResponseProbe(X1KeyBindings bindings, X1CalibrationPose startPose)
    {
        _bindings = bindings ?? throw new ArgumentNullException(nameof(bindings));
        if (!startPose.IsFinite || startPose.TimeMs < 0) throw new ArgumentException("自动探测需要明确角色、区域、有限位置与单调时刻");
        _origin = _last = _phaseStart = startPose;
        _controls = bindings.HasAllDirections ? Enum.GetValues<X1Control>()
            : new[] { X1Control.Forward, X1Control.TurnLeft, X1Control.TurnRight };
    }

    public X1AutomaticProbeStep Tick(X1KeyBindings bindings, X1CalibrationPose pose, bool safe, string interruptionReason = "")
    {
        if (!Running) return Step();
        if (!safe || !string.IsNullOrEmpty(interruptionReason))
            return Abort(string.IsNullOrWhiteSpace(interruptionReason) ? "自动探测的实际安全条件不成立" : interruptionReason);
        if (bindings == null || bindings.Identity != _bindings.Identity || !pose.IsFinite
            || pose.ActorId != _origin.ActorId || pose.Territory != _origin.Territory)
            return Abort("角色、区域、键位或位置观测变化，自动响应整套作废");
        // 构造后同帧读取一次相同起点允许返回全松；其余重复/倒退时刻都不能掩盖断档。
        if (!_hasTick && pose == _last) { _hasTick = true; return Step(); }
        _hasTick = true;
        if (pose.TimeMs <= _last.TimeMs || pose.TimeMs - _last.TimeMs > MaxFrameGapMs)
            return Abort("自动探测帧间隔不可靠，已要求全松并作废整套响应");
        if (pose.TimeMs - _origin.TimeMs > MaxTotalMs)
            return Abort("自动探测超过总时间上限，已要求全松");
        var dx = pose.X - _last.X; var dz = pose.Z - _last.Z;
        var distance = Math.Sqrt(dx * dx + dz * dz);
        var angle = DeltaAngle(pose.RotationRad, _last.RotationRad);
        if (!double.IsFinite(distance) || !double.IsFinite(angle) || Math.Abs(pose.Y - _origin.Y) > MaxHeightM)
            return Abort("自动探测位置、角度或高度超出可靠范围");
        _totalDistance += distance; _totalAngle += Math.Abs(angle);
        _phaseDistance += distance; _phaseAngle += angle; _phaseAbsoluteAngle += Math.Abs(angle);
        _last = pose;
        if (_totalDistance > MaximumTotalDistanceM || _totalAngle > MaxTotalAngleDeg)
            return Abort("自动探测超过累计位移或转角上限，已要求全松");
        var elapsed = pose.TimeMs - _phaseStart.TimeMs;
        if (State == X1AutomaticProbeState.Resting)
        {
            if (_phaseDistance > MaxRestDistanceM || _phaseAbsoluteAngle > MaxRestAngleDeg)
                return Abort("全松休息期间仍有明显移动或转向，不能采用自动响应");
            if (elapsed < RestMs) return Step();
            if (_index == _controls.Length)
            {
                if (!CoverageValid()) return Abort("自动响应方向不一致，不能用于闭环控制");
                State = X1AutomaticProbeState.Completed;
                Message = "自动短响应已完成；来源 Automatic，物理接管仍需单独验证";
                Result = new(_bindings, pose, _samples);
                return Step();
            }
            State = X1AutomaticProbeState.Pressing;
            BeginPhase(pose);
            Message = "自动短响应：" + _controls[_index] + "，结束后立即全松";
            return Step();
        }

        var control = _controls[_index];
        var turning = control is X1Control.TurnLeft or X1Control.TurnRight;
        if (_phaseDistance > MaxPulseDistanceM || _phaseAbsoluteAngle > MaxPulseAngleDeg)
            return Abort("单次响应超过短距离或转角上限，已要求全松");
        if (turning ? _phaseDistance > 0.05 : _phaseAbsoluteAngle > 3)
            return Abort("自动响应中混入移动与转向，不能采用这组控制效果");
        if (turning && Math.Abs(angle) > .25)
        {
            var sign = Math.Sign(angle);
            if (_turnSign != 0 && sign != _turnSign) return Abort("同一转向键的响应方向反复，不能采用");
            _turnSign = sign;
        }
        if (elapsed < PressMs) return Step();
        if (elapsed > PressMs + MaxFrameGapMs) return Abort("短按释放时刻超限，自动响应作废");
        var netX = pose.X - _phaseStart.X; var netZ = pose.Z - _phaseStart.Z;
        var netDistance = Math.Sqrt(netX * netX + netZ * netZ);
        if (turning ? Math.Abs(_phaseAngle) < 2 : netDistance < .05)
            return Abort("短按没有足够明确的实际响应，未采用任何新样本");
        var seconds = elapsed / 1000.0;
        var cos = Math.Cos(_phaseStart.RotationRad); var sin = Math.Sin(_phaseStart.RotationRad);
        var sample = new X1CalibrationSample(control, (netX * cos - netZ * sin) / seconds,
            (netX * sin + netZ * cos) / seconds, _phaseAngle / seconds, elapsed, netDistance, "Automatic");
        if (turning)
        {
            var opposite = control == X1Control.TurnLeft ? X1Control.TurnRight : X1Control.TurnLeft;
            var previous = _samples.Find(s => s.Control == opposite);
            if (previous != null && sample.DegreesPerSecond * previous.DegreesPerSecond >= 0)
                return Abort("左右转向自动响应同号，不能采用这组键位");
        }
        _samples.Add(sample); _index++;
        State = X1AutomaticProbeState.Resting;
        BeginPhase(pose);
        Message = "自动短响应全松休息（" + _samples.Count + "/" + _controls.Length + "）；尚未采用";
        return Step();
    }

    public X1AutomaticProbeStep Abort(string reason)
    {
        State = X1AutomaticProbeState.Failed; Result = null; _samples.Clear();
        Message = string.IsNullOrWhiteSpace(reason) ? "自动响应已取消，要求全松" : reason;
        return Step();
    }
    private X1AutomaticProbeStep Step() => new(DesiredControl, State, Message);
    private void BeginPhase(X1CalibrationPose pose)
    { _phaseStart = pose; _phaseDistance = _phaseAngle = _phaseAbsoluteAngle = 0; _turnSign = 0; }
    private bool CoverageValid()
    {
        if (_samples.Count != _controls.Length || _controls.Any(c => !_samples.Any(s => s.Control == c))) return false;
        var left = _samples.Find(s => s.Control == X1Control.TurnLeft)!;
        var right = _samples.Find(s => s.Control == X1Control.TurnRight)!;
        if (left.DegreesPerSecond * right.DegreesPerSecond >= 0) return false;
        if (!_bindings.HasAllDirections) return true;
        double Dot(X1Control a, X1Control b)
        {
            var x = _samples.Find(s => s.Control == a)!; var y = _samples.Find(s => s.Control == b)!;
            return (x.LocalXPerSecond * y.LocalXPerSecond + x.LocalZPerSecond * y.LocalZPerSecond)
                / Math.Sqrt((x.LocalXPerSecond * x.LocalXPerSecond + x.LocalZPerSecond * x.LocalZPerSecond)
                    * (y.LocalXPerSecond * y.LocalXPerSecond + y.LocalZPerSecond * y.LocalZPerSecond));
        }
        return Dot(X1Control.Forward, X1Control.Back) < -.9 && Dot(X1Control.StrafeLeft, X1Control.StrafeRight) < -.9
            && Math.Abs(Dot(X1Control.Forward, X1Control.StrafeLeft)) < .25;
    }
    internal static double DeltaAngle(double currentRad, double previousRad)
        => X1InputCalibration.SignedDegrees(((currentRad % (2 * Math.PI)) - (previousRad % (2 * Math.PI))) * 180 / Math.PI);
}

public enum X1AutomaticProbeState { Resting, Pressing, Completed, Failed }

public readonly record struct X1AutomaticProbeStep(X1Control? DesiredControl, X1AutomaticProbeState State, string Message);

