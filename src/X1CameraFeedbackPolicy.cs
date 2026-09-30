// 这个文件是干嘛的：仅为1.5米/4秒短目标试验按真实位置和镜头误差选单键，松键后稳定才确认到达。
using System;
using System.Linq;

namespace ChoreoHelper;

public enum X1CameraFeedbackState { Settling, Pressing, Completed, Failed }
public readonly record struct X1CameraFeedbackStep(X1Control? DesiredControl, X1CameraFeedbackState State,
    string Message, double DistanceToTargetM, double TotalDistanceM);

public sealed class X1CameraFeedbackPolicy
{
    public const long MaxTotalMs = 4000, MaxFrameGapMs = 100, PulseMs = 50, MinSettleMs = 250, StableMs = 100, MaxSettleMs = 700;
    public const double MaxTotalDistanceM = 1.5, MaxHeightM = .15, MinimumProgressM = .005;
    private readonly X1CameraRelativeProfile _profile;
    private readonly X1ReferenceDiagnosticObservation _origin;
    private X1ReferenceDiagnosticObservation _last;
    private double _targetX, _targetZ;
    private readonly double _tolerance;
    private readonly X1CameraPathPlan? _path;
    private readonly long _pathStart;
    private readonly bool _cooperative, _useLocomotion;
    private double _distance, _errorDistance, _pulseStartError, _pulseStartDistance;
    private long _phaseStart, _lastMovingAt, _pulseLimitMs = PulseMs, _selectedAtMs, _settleBeforeSelection;
    private int _selectedSegment;
    private bool _hasTick, _hadPulse, _pathPulseStarted;
    private int _noProgress;
    private X1Control? _desired;
    public X1CameraFeedbackState State { get; private set; } = X1CameraFeedbackState.Settling;
    public string Message { get; private set; } = "先全松并确认稳定；仅为短目标坐标反馈试验";
    public bool Running => State is X1CameraFeedbackState.Settling or X1CameraFeedbackState.Pressing;
    public double ControlDeadbandM => _path == null ? _tolerance : Math.Min(.025, _tolerance / 4);
    public long CurrentPulseLimitMs => _pulseLimitMs;
    public long PressRequestId { get; private set; }
    public (double X, double Z) TargetAt(long timeMs) => _path?.TargetAt(timeMs - _pathStart) ?? (_targetX, _targetZ);

    public X1CameraFeedbackPolicy(X1CameraRelativeProfile profile, X1ReferenceDiagnosticObservation start,
        double targetX, double targetZ, double arrivalToleranceM, X1CameraPathPlan? path = null, long? pathStart = null, bool cooperative = false, bool useLocomotion = false)
    {
        _profile = profile ?? throw new ArgumentNullException(nameof(profile));
        _pathStart=pathStart ?? start.Pose.TimeMs; _cooperative=cooperative; _useLocomotion=useLocomotion;
        if(_pathStart<0 || start.Pose.TimeMs<_pathStart || path!=null && start.Pose.TimeMs-_pathStart>=path.DurationMs) throw new InvalidOperationException("原路径时刻已失效，不能重置或追赶");
        var error = profile.CheckCurrent(start, ignoreWalkingIdentity:useLocomotion);
        if (error.Length != 0) throw new InvalidOperationException(error);
        if (!double.IsFinite(targetX) || !double.IsFinite(targetZ) || !double.IsFinite(arrivalToleranceM)
            || arrivalToleranceM < .025 || arrivalToleranceM > .3)
            throw new InvalidOperationException("短目标及到达容差须明确且在允许范围");
        path?.CheckStart(start,useLocomotion);
        _path = path;
        _origin = _last = start; _targetX = targetX; _targetZ = targetZ; _tolerance = arrivalToleranceM;
        _errorDistance = Distance(start.Pose.X, start.Pose.Z, targetX, targetZ);
        if (!double.IsFinite(_errorDistance) || _errorDistance > MaxTotalDistanceM)
            throw new InvalidOperationException("短目标不得超过1.5米；此策略不是正式完整路径执行");
        _phaseStart = _lastMovingAt = start.Pose.TimeMs;
    }

    public X1CameraFeedbackStep Tick(X1ReferenceDiagnosticObservation current, bool yielding=false)
    {
        if (!Running) return Step();
        try
        {
            var error = CheckCurrent(current);
            if (error.Length != 0) return Abort(error);
            var gap = current.Pose.TimeMs - _last.Pose.TimeMs;
            if (_hasTick && gap == 0 || gap < 0 || gap > MaxFrameGapMs) return Abort("坐标反馈帧重复、倒退或断档");
            if (_path != null && _path.CrossedWaypointWitnessError(_last.Pose.TimeMs - _pathStart,
                _last.Pose.X, _last.Pose.Z, current.Pose.TimeMs - _pathStart, current.Pose.X, current.Pose.Z) > _tolerance)
                return Abort("跨帧路径点缺少原容差内的前后实际观测，不能跳过中间路段报成功");
            _hasTick = true;
            var moved = Distance(current.Pose.X, current.Pose.Z, _last.Pose.X, _last.Pose.Z);
            if (!double.IsFinite(moved)) return Abort("坐标反馈位移计算不可用");
            _distance += moved;
            (_targetX, _targetZ) = TargetAt(current.Pose.TimeMs);
            _errorDistance = Distance(current.Pose.X, current.Pose.Z, _targetX, _targetZ);
            _last = current;
            if (_distance > MaxTotalDistanceM || Math.Abs(current.Pose.Y - _origin.Pose.Y) > MaxHeightM)
                return Abort("短目标累计路程或高度超限，要求立即全松");
            if (moved > .002) _lastMovingAt = current.Pose.TimeMs;
            var elapsed = current.Pose.TimeMs - _phaseStart;
            var holdingPath = _path?.IsHoldAt(current.Pose.TimeMs - _pathStart) == true;
            if (_path != null && current.Pose.TimeMs - _pathStart >= _path.DurationMs)
            {
                // 事件到时绝不追赶；必须此前已松键且停稳，再由会话 fresh 读取确认。
                if (_desired.HasValue || elapsed < MinSettleMs || current.Pose.TimeMs - _lastMovingAt < StableMs
                    || _errorDistance > _tolerance)
                    return Abort("路径事件已到时，但实际终点或停止稳定性尚未满足；不追加追赶");
                State = X1CameraFeedbackState.Completed;
                Message = "正式采样路径单事件到时，实际终点在容差内且已停稳；等待全松后复核";
                return Step();
            }
            if(yielding)
            {
                _desired=null; State=X1CameraFeedbackState.Settling;
                if(current.Input.CooperativeHeld)_phaseStart=current.Pose.TimeMs;
                _hadPulse=false; Message="人工协同中，自动键已释放；原路径时钟继续"; return Step();
            }
            if (State == X1CameraFeedbackState.Pressing)
            {
                if (_path != null && !_pathPulseStarted)
                    return Abort("路径候选未经过实际写前确认，不能把未写入当成已持键");
                var response = _profile.Responses.Single(x => x.Control == _desired);
                var margin = response.MeasuredStopDistanceM + response.PeakSpeedMps * MaxFrameGapMs / 1000;
                // 长探测的余动预算不能在本次尚未响应时把每次短按截成一帧。
                // 到达立即松键；有实际位移才提前刹车，短按到期仍在下一可用帧松键。
                if (elapsed >= _pulseLimitMs || _errorDistance <= ControlDeadbandM || holdingPath && _errorDistance <= _tolerance
                    || _path != null && !_path.AllowsDirectionAt(current.Pose.TimeMs - _pathStart,
                        X1CameraRelativeProfile.BearingDeg(current.Reference) + response.PhaseDeg)
                    || _distance - _pulseStartDistance > .002 && _errorDistance <= _tolerance + margin)
                { _desired = null; State = X1CameraFeedbackState.Settling; _phaseStart = current.Pose.TimeMs; Message = "已要求松键，等待实际余动结束"; }
                return Step();
            }
            if (elapsed > MaxSettleMs && (_path == null || current.Pose.TimeMs - _lastMovingAt < StableMs))
                return Abort("全松后仍未稳定，不能继续输入");
            if (elapsed < MinSettleMs || current.Pose.TimeMs - _lastMovingAt < StableMs) return Step();
            // 停留时已满足原容差就不发起新的纠偏脉冲，避免最小实际步幅导致左右往返。
            // 每帧原容差、跨路点双端见证和到时终点检查仍在此分支之前执行。
            if (holdingPath && _errorDistance <= _tolerance)
            { Message = "原路径当前为停留段，实际位置在原容差内；保持全松，不追赶细小误差"; return Step(); }
            if (_errorDistance <= ControlDeadbandM)
            {
                if (_path != null) { Message = "当前采样点在容差内，保持全松等待原路径时钟"; return Step(); }
                State = X1CameraFeedbackState.Completed; Message = "实际坐标已在容差内且停止稳定；仅完成本次短目标"; return Step();
            }
            if (_hadPulse)
            {
                var progress = _path == null ? _pulseStartError - _errorDistance : _distance - _pulseStartDistance;
                if (progress < MinimumProgressM) _noProgress++; else _noProgress = 0;
                if (_noProgress >= 2) return Abort("连续短按没有缩短实际坐标误差，不能继续碰运气");
                if (_path == null && _errorDistance > _pulseStartError + .05) return Abort("短按后目标误差增大，停止并保留实际坐标");
                _hadPulse = false;
            }
            var camera = X1CameraRelativeProfile.BearingDeg(current.Reference);
            var correction = _path?.CorrectionAt(current.Pose.TimeMs - _pathStart, current.Pose.X, current.Pose.Z)
                ?? (_targetX - current.Pose.X, _targetZ - current.Pose.Z);
            var target = Math.Atan2(correction.Item1, correction.Item2) * 180 / Math.PI;
            X1CameraControlResponse? best = null; double bestDot = .1;
            foreach (var candidate in _profile.Responses)
            {
                if (_path != null && !_path.AllowsDirectionAt(current.Pose.TimeMs - _pathStart, camera + candidate.PhaseDeg))
                    continue;
                var dot = Math.Cos((camera + candidate.PhaseDeg - target) * Math.PI / 180);
                if (dot > bestDot) { bestDot = dot; best = candidate; }
            }
            if (best == null)
            {
                if (_path == null) return Abort("当前三键没有安全缩短误差的方向；不能假装原地转向");
                Message = "当前误差需要横移或回头；保持全松等待原路径时钟，超原容差仍停止";
                return Step();
            }
            // 长探测只有峰值/延迟证据，不能推定短按的固定步幅；这里只缩短请求上限。
            // 即使尚未观察到运动，到上限后的第一可用帧也必须松键。帧量化和松键后余动仍逐帧审查。
            _pulseLimitMs = _path == null ? PulseMs : Math.Max(1, Math.Min(PulseMs,
                (long)Math.Floor(Math.Min(_errorDistance * bestDot, _path.MaxCorrectionM) / best.PeakSpeedMps * 1000)));
            _desired = best.Control; _pulseStartError = _errorDistance; _pulseStartDistance = _distance; _hadPulse = _path == null;
            _selectedAtMs = current.Pose.TimeMs; _selectedSegment = SegmentAt(current.Pose.TimeMs);
            _pathPulseStarted = false; PressRequestId++;
            _settleBeforeSelection = _phaseStart;
            _phaseStart = current.Pose.TimeMs; State = X1CameraFeedbackState.Pressing;
            Message = "按实际镜头视线与坐标误差短按 " + best.Control + "；不按预估距离持续持键";
            return Step();
        }
        catch (Exception ex) { return Abort(ex.Message); }
    }

    public string CheckCurrent(X1ReferenceDiagnosticObservation current)
    {
        var error = _profile.CheckCurrent(current, allowCooperativeMovement:_cooperative, ignoreWalkingIdentity:_useLocomotion);
        if (error.Length != 0) return error;
        try { _path?.CheckCurrent(current); }
        catch (Exception ex) { return ex.Message; }
        if (_path != null)
        {
            var target = TargetAt(current.Pose.TimeMs);
            if (Distance(current.Pose.X, current.Pose.Z, target.X, target.Z) > _tolerance)
                return "实际坐标未在原路径容差内跟随当前采样时刻，停止本次试验";
        }
        if (!_cooperative && current.Input.PhysicalChangeSequence != _origin.Input.PhysicalChangeSequence
            || current.Input.ForeignInjectedChangeSequence != _origin.Input.ForeignInjectedChangeSequence
            || current.Input.FocusLossSequence != _origin.Input.FocusLossSequence)
            return "短目标期间本人输入、外来注入或失焦，要求立即全松";
        if (current.Pose.TimeMs < _pathStart || current.Pose.TimeMs - _pathStart > MaxTotalMs)
            return "短目标超过4秒时间边界，要求立即全松";
        if (current.Pose.TimeMs < _last.Pose.TimeMs || current.Pose.TimeMs - _last.Pose.TimeMs > MaxFrameGapMs)
            return "短目标即时坐标观测过期或断档";
        return "";
    }
    // 未写入候选有独立身份/原始路段/100ms新鲜度；短持键上限不能提前消耗在两次安全读取中。
    public string CheckPendingPress(long requestId, X1Control control, X1ReferenceDiagnosticObservation current)
    {
        if (_path == null) return "";
        if (State != X1CameraFeedbackState.Pressing || _desired != control || requestId != PressRequestId || _pathPulseStarted
            || current.Pose.TimeMs < _selectedAtMs || current.Pose.TimeMs - _selectedAtMs > MaxFrameGapMs)
            return "路径未写入候选已失效，禁止迟到或重复的旧输出";
        if (SegmentAt(current.Pose.TimeMs) != _selectedSegment)
            return "原路径已跨过候选所属路段，禁止迟到的旧输出";
        var response = _profile.Responses.Single(r => r.Control == control);
        var direction = X1CameraRelativeProfile.BearingDeg(current.Reference) + response.PhaseDeg;
        var target = TargetAt(current.Pose.TimeMs);
        var error = Distance(current.Pose.X, current.Pose.Z, target.X, target.Z);
        var toward = Math.Atan2(target.X - current.Pose.X, target.Z - current.Pose.Z) * 180 / Math.PI;
        return double.IsFinite(error) && error > ControlDeadbandM
            && Math.Cos((direction - toward) * Math.PI / 180) > .1
            && _path.AllowsDirectionAt(current.Pose.TimeMs - _pathStart, direction)
            ? "" : "原路径当前目标或路段已改变，旧选键不再安全缩短误差，禁止输出";
    }
    // 只能由会话已核对的当前同步写前边界消费一次；没有输出/回调，不重放登记许可。
    internal string StartPathPulse(long requestId, X1Control control, X1ReferenceDiagnosticObservation current)
    {
        var error = CheckPendingPress(requestId, control, current);
        if (error.Length != 0 || _path == null) return error;
        var response = _profile.Responses.Single(r => r.Control == control);
        var direction = (X1CameraRelativeProfile.BearingDeg(current.Reference) + response.PhaseDeg) * Math.PI / 180;
        var target = TargetAt(current.Pose.TimeMs);
        var projection = (target.X - current.Pose.X) * Math.Sin(direction) + (target.Z - current.Pose.Z) * Math.Cos(direction);
        var currentLimit = Math.Max(1, Math.Min(PulseMs,
            (long)Math.Floor(Math.Min(projection, _path.MaxCorrectionM) / response.PeakSpeedMps * 1000)));
        _pulseLimitMs = Math.Min(_pulseLimitMs, currentLimit); // 最后读取只允许缩短，绝不增加原定持键上限。
        var moved = Distance(_last.Pose.X, _last.Pose.Z, current.Pose.X, current.Pose.Z);
        _distance += moved; _last = current;
        if (moved > .002) _lastMovingAt = current.Pose.TimeMs;
        _phaseStart = current.Pose.TimeMs; _pulseStartDistance = _distance;
        _pulseStartError = Distance(current.Pose.X, current.Pose.Z, target.X, target.Z);
        _hadPulse = _pathPulseStarted = true;
        return "";
    }
    internal void DiscardPendingPress(long requestId)
    {
        if (_path == null || _pathPulseStarted || State != X1CameraFeedbackState.Pressing || requestId != PressRequestId) return;
        _desired = null; State = X1CameraFeedbackState.Settling; _phaseStart = _settleBeforeSelection;
    }
    private int SegmentAt(long timeMs)
    {
        if (_path == null) return -1;
        var elapsed = timeMs - _pathStart;
        for (var i = 1; i < _path.Points.Count; i++) if (elapsed < _path.Points[i].TMs) return i - 1;
        return _path.Points.Count - 1;
    }
    public X1CameraFeedbackStep Abort(string reason)
    { _desired = null; State = X1CameraFeedbackState.Failed; Message = reason; return Step(); }
    private X1CameraFeedbackStep Step() => new(_desired, State, Message, _errorDistance, _distance);
    private static double Distance(double x, double z, double tx, double tz)
    { var dx = tx - x; var dz = tz - z; return Math.Sqrt(dx * dx + dz * dz); }
}
