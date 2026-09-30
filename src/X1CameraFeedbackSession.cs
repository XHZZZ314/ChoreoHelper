// 这个文件是干嘛的：把真实坐标短目标策略接到有界输入占有；确认松键和新鲜到达后才完成本次试验。
using System;
using System.Collections.Generic;
using System.Linq;

namespace ChoreoHelper;

public sealed record X1CameraFeedbackReport(bool Completed, string Status, long AtMs,
    double TargetX, double TargetZ, double ArrivalToleranceM, double? FinalDistanceToTargetM,
    double? LastObservedDistanceToTargetM, long? LastObservedAtMs, double? TotalDistanceM,
    IReadOnlyList<X1ReferenceDiagnosticFrame> Frames)
{
    public X1CameraPathPlan? Path { get; init; }
    public string ManualMode { get; init; } = "Interrupt";
    public int ManualInterventions { get; init; }
    public int ManualResumptions { get; init; }
    public long? PathStartedAtMs { get; init; }
    public IReadOnlyList<X1CameraPathSample>? PathSamples { get; init; }
    public double? MaxPathTrackingErrorM { get; init; }
    public double? MaxCrossedWaypointWitnessErrorM { get; init; }
}

public sealed record X1CameraPathSample(long AtMs, long LocalMs, double TargetX, double TargetZ,
    double ActualX, double ActualZ, double ErrorM, double CorrectionX, double CorrectionZ, X1Control? HeldControl);

/// <summary>只执行明确的短目标；不启用正式路径准入。输出委托必须同步，不能在返回后排队写键。
/// 取消立即失效旧代，但在途按键仍保留占有直至返回并确认释放；释放失败等待明确 Stop 重试。</summary>
public sealed class X1CameraFeedbackSession
{
    public const int MaxFrames = 512;
    // 与策略的停止稳定口径一致；完成后的再次读取不能把仍在变化的位置报成已经停稳。
    public const double MaxCompletionShiftM = .002;
    private readonly Action<X1Control> _press;
    private readonly Action _release;
    private readonly Func<bool> _held;
    private readonly Func<X1ReferenceDiagnosticObservation> _readCurrent;
    private readonly List<X1ReferenceDiagnosticFrame> _frames = new();
    private X1CameraFeedbackPolicy? _policy;
    private X1CameraRelativeProfile? _profile;
    private X1ReferenceDiagnosticObservation? _origin, _last;
    private X1Control? _desired;
    private long _generation, _ownerGeneration, _inFlightPressRequest;
    private bool _pressInFlight, _initialReleaseConfirmed, _writeBoundaryConfirmed;
    private string? _deferredStopReason;
    private long _deferredStopAtMs, _deferredStopOwner;
    private double _targetX, _targetZ, _tolerance;
    private X1CameraPathPlan? _path;
    private StageManualControl? _cooperation;
    private bool _manualInterrupted;
    private int _manualInterventions, _manualResumptions;
    private long? _neutralSince;
    public void StopForManual(long nowMs)
    {
        if(!Active)return;
        _manualInterrupted=true;
        Stop(_cooperation==null ? "实际人工输入已打断本场；松键不恢复，须重新明确开始" : "不支持的协同输入已打断本场；同键、鼠标或未列出输入不能安全协同",nowMs);
    }
    public bool Yielding => _cooperation?.Yielding == true;
    private double? _totalDistance, _lastDistance, _finalDistance;
    private long? _lastObservedAtMs;
    public bool Active { get; private set; }
    public bool OwnsInput { get; private set; }
    public bool CleanupFailed { get; private set; }
    public string Message { get; private set; } = "尚未执行短目标坐标反馈试验";
    public X1CameraFeedbackReport? LastReport { get; private set; }
    public IReadOnlyList<X1ReferenceDiagnosticFrame> Frames => Array.AsReadOnly(_frames.ToArray());

    public X1CameraFeedbackSession(Action<X1Control> press, Action release, Func<bool> held,
        Func<X1ReferenceDiagnosticObservation> readCurrent)
    {
        _press = press ?? throw new ArgumentNullException(nameof(press));
        _release = release ?? throw new ArgumentNullException(nameof(release));
        _held = held ?? throw new ArgumentNullException(nameof(held));
        _readCurrent = readCurrent ?? throw new ArgumentNullException(nameof(readCurrent));
    }

    public void Begin(X1CameraRelativeProfile profile, X1ReferenceDiagnosticObservation observation,
        double targetX, double targetZ, double tolerance)
        => BeginCore(profile, observation, targetX, targetZ, tolerance, null);

    public void BeginPath(X1CameraRelativeProfile profile, X1ReferenceDiagnosticObservation observation, X1CameraPathPlan path)
    {
        var target = path.TargetAt(0);
        BeginCore(profile, observation, target.X, target.Z, path.ArrivalToleranceM, path);
    }

    // 路径沿用整场推导出的原段起点；协同让出输入但不重置时钟。
    private long _pathStartMonoMs;
    private bool _pathCooperative;
    public void BeginPath(X1CameraRelativeProfile profile, X1ReferenceDiagnosticObservation observation,
        X1CameraPathPlan path, long startMonoMs, bool cooperative, bool useLocomotion)
    {
        var target=path.TargetAt(observation.Pose.TimeMs-startMonoMs);
        BeginCore(profile,observation,target.X,target.Z,path.ArrivalToleranceM,path,startMonoMs,cooperative,useLocomotion);
    }

    private void BeginCore(X1CameraRelativeProfile profile, X1ReferenceDiagnosticObservation observation,
        double targetX, double targetZ, double tolerance, X1CameraPathPlan? path, long? startMonoMs=null, bool cooperative=false, bool useLocomotion=false)
    {
        var generation = _generation;
        if (Active || OwnsInput || CleanupFailed || _pressInFlight || _held())
            throw new InvalidOperationException("短目标输入仍被持有，请先明确停止并确认释放");
        var candidate = new X1CameraFeedbackPolicy(profile, observation, targetX, targetZ, tolerance, path,startMonoMs,cooperative,useLocomotion);
        _pathStartMonoMs=startMonoMs ?? observation.Pose.TimeMs; _pathCooperative=cooperative;
        _cooperation=cooperative ? new StageManualControl() : null; _manualInterrupted=false;
        _manualInterventions=_manualResumptions=0; _neutralSince=null;
        if (_generation != generation) throw new InvalidOperationException("短目标准备期间占有已变化");
        _ownerGeneration = ++_generation; _policy = candidate; _profile = profile;
        _path = path;
        _origin = _last = observation; _targetX = targetX; _targetZ = targetZ; _tolerance = tolerance;
        _desired = null; _deferredStopReason = null; _initialReleaseConfirmed = false;
        _totalDistance = 0; _lastDistance = Distance(observation.Pose.X, observation.Pose.Z, targetX, targetZ);
        _finalDistance = null; _lastObservedAtMs = observation.Pose.TimeMs;
        _frames.Clear(); _frames.Add(new(null, observation));
        Active = OwnsInput = true;
        Message = path == null ? "准备按真实坐标误差接近明确短目标；先全松并确认稳定，不启用正式路径"
            : "只试当前登记的路径事件「" + path.EventId + "」；沿原采样时间与舞台坐标反馈，到时不追赶，不启动整场";
    }

    public void Tick(X1ReferenceDiagnosticObservation observation)
    {
        if (!Active || CleanupFailed || _pressInFlight) return;
        var generation = _generation;
        try
        {
            Observe(observation, !_initialReleaseConfirmed);
            if (_generation != generation || !Active) return;
            var current = observation;
            if (!_initialReleaseConfirmed)
            {
                if (!ReleaseConfirmed(generation) || !Active) return;
                _initialReleaseConfirmed = true;
                current = _readCurrent();
                if (_generation != generation || !Active) return;
                Observe(current, true);
                if (_generation != generation || !Active) return;
            }
            if(_cooperation!=null)
            {
                if(current.Input.CooperativeHeld)
                {
                    if(!_cooperation.Yielding)_manualInterventions++;
                    _cooperation.Yielding=true;_neutralSince=null;
                    if(!ReleaseConfirmed(generation)||!Active)return;
                }
                else if(_cooperation.Yielding)
                {
                    _neutralSince ??= current.Pose.TimeMs;
                    if(current.Pose.TimeMs-_neutralSince>=250)
                    {
                        if(_lastDistance>_policy!.ControlDeadbandM)throw new InvalidOperationException("协同结束后偏离原时钟位置，停止且不追赶");
                        _cooperation.Yielding=false;_manualResumptions++;
                    }
                }
            }
            var step = _policy!.Tick(current,Yielding);
            if (_generation != generation || !Active) return;
            Message = step.Message;
            if (step.State == X1CameraFeedbackState.Failed)
            { Stop("短目标已停止：" + step.Message, current.Pose.TimeMs); return; }
            if (step.State == X1CameraFeedbackState.Completed)
            {
                if (!ReleaseConfirmed(generation) || !Active) return;
                var final = _readCurrent();
                if (_generation != generation || !Active) return;
                Observe(final, true);
                if (_generation != generation || !Active) return;
                _finalDistance = _lastDistance; // 只有确认释放之后的实际新鲜读取才填 final；失败前的旧距离另列。
                var shift = Distance(current.Pose.X, current.Pose.Z, final.Pose.X, final.Pose.Z);
                if (!_finalDistance.HasValue || _finalDistance > _tolerance || !shift.HasValue
                    || shift > MaxCompletionShiftM || Math.Abs(final.Pose.Y - current.Pose.Y) > MaxCompletionShiftM)
                    throw new InvalidOperationException("全松后复核仍有位置变化或已离开目标容差，不能报告到达");
                Active = OwnsInput = false;
                Message = _path == null ? "已确认全松，真实坐标在容差内且保持稳定；仅完成本次短目标，正式路径仍未验收"
                    : "本次原计划采样容差与全松复核通过；实际轨迹是否完成预期转角需独立复核，整场路径与独立朝向仍未验收";
                LastReport = Report(true, Message, final.Pose.TimeMs);
                return;
            }
            if (_desired == step.DesiredControl) return;
            if (!ReleaseConfirmed(generation) || !Active) return;
            var fresh = _readCurrent();
            if (_generation != generation || !Active) return;
            Observe(fresh, true); // 每次改变输出都重新核对，不复用 Tick 入口的许可。
            if (_generation != generation || !Active) return;
            if (step.DesiredControl is not { } control) return;
            if (_path != null && fresh.Pose.TimeMs - _pathStartMonoMs >= _path.DurationMs)
                throw new InvalidOperationException("路径在按下前已到时，旧回调不能追加追赶");
            // 若复核时已进入容差，则继续等待策略确认停止稳定，绝不再补一个旧方向的短按。
            if (_lastDistance <= _policy!.ControlDeadbandM
                || _path?.IsHoldAt(fresh.Pose.TimeMs - _pathStartMonoMs) == true && _lastDistance <= _tolerance)
            { _policy.DiscardPendingPress(_policy.PressRequestId); Message = "新鲜坐标已进入容差，保持全松等待停止稳定确认"; return; }
            if (!StillApproachesTarget(control, fresh))
                throw new InvalidOperationException("按下前镜头或目标方向已改变，旧选键不再缩短误差");
            var pressError = _policy.CheckPendingPress(_policy.PressRequestId, control, fresh);
            if (pressError.Length != 0) throw new InvalidOperationException(pressError);
            _desired = control;
            PressWithOwnership(control);
            if (_generation != generation || !Active) return;
            Message = step.Message;
        }
        catch (Exception error)
        {
            if (_generation != generation) return;
            var now = observation?.Pose.TimeMs ?? _last?.Pose.TimeMs ?? 0;
            if (CleanupFailed)
            {
                Active = false; Message = "短目标释放未确认，请明确停止后重试：" + error.Message;
                LastReport = Report(false, Message, now);
            }
            else Stop("短目标已取消：" + error.Message, now);
        }
    }

    /// <summary>普通观测只读核对；路径的最终同步写前调用记录真实读数，并一次性启动当前候选的持键时钟。</summary>
    public string CheckCurrentObservation(X1ReferenceDiagnosticObservation observation, bool beforePress = false)
    {
        if (!beforePress || _path == null) return CheckObservationCore(observation, beforePress);
        var generation = _generation;
        if (!_pressInFlight || _writeBoundaryConfirmed || _policy == null || _inFlightPressRequest != _policy.PressRequestId)
            return "路径写前回调不属于当前在途请求，或已经消费；禁止重复或迟到输出";
        try
        {
            Observe(observation, true, beforePress: true); // 拒绝的最终读取也留下真实帧/明确缺测，不能藏掉耗时或越界。
            if (_generation != generation || !Active || !OwnsInput) return "路径写前读取期间旧会话已取消";
            var error = CheckObservationCore(observation, true);
            if (error.Length != 0) return error;
            error = _policy.StartPathPulse(_inFlightPressRequest, _desired!.Value, observation);
            if (error.Length == 0) _writeBoundaryConfirmed = true;
            return error;
        }
        catch (Exception error) { return error.Message; }
    }

    private string CheckObservationCore(X1ReferenceDiagnosticObservation observation, bool beforePress)
    {
        var generation = _generation;
        if (!Active || !OwnsInput || CleanupFailed || _policy == null || _origin == null || _last == null)
            return "短目标已取消或没有输入占有";
        var error = _policy.CheckCurrent(observation);
        if (_generation != generation || !Active || !OwnsInput) return "坐标反馈许可检查期间旧会话已失效";
        if (error.Length != 0) return error;
        if (beforePress && _path != null && observation.Pose.TimeMs - _pathStartMonoMs >= _path.DurationMs)
            return "路径在最后一次按键检查前已经到时，禁止旧回调输出";
        if (beforePress && _path?.IsHoldAt(observation.Pose.TimeMs - _pathStartMonoMs) == true)
            return "路径在最后一次按键检查前已进入原容差内停留，禁止旧纠偏输出";
        if (beforePress && _path != null)
        {
            if(observation.Input.AnyPhysicalHeld || Yielding)return "人工协同期间禁止自动按键";
            if (_desired is not { } control) return "路径最后写前门没有当前选键";
            error = _policy.CheckPendingPress(_inFlightPressRequest, control, observation);
            if (error.Length != 0) return error;
        }
        var gap = observation.Pose.TimeMs - _last.Pose.TimeMs;
        if (gap < 0 || gap > X1CameraFeedbackPolicy.MaxFrameGapMs)
            return "短目标最新观测倒退或断档";
        if (gap == 0 && observation.Pose != _last.Pose)
            return "短目标同一时刻角色位置或朝向发生跳变";
        if (_path != null && _path.CrossedWaypointWitnessError(_last.Pose.TimeMs - _pathStartMonoMs,
            _last.Pose.X, _last.Pose.Z, observation.Pose.TimeMs - _pathStartMonoMs, observation.Pose.X, observation.Pose.Z) > _tolerance)
            return "路径跨帧路点缺少原容差内的实际观测见证";
        var moved = Distance(_last.Pose.X, _last.Pose.Z, observation.Pose.X, observation.Pose.Z);
        if (!moved.HasValue || !_totalDistance.HasValue || _totalDistance.Value + moved.Value > X1CameraFeedbackPolicy.MaxTotalDistanceM
            || Math.Abs(observation.Pose.Y - _origin.Pose.Y) > X1CameraFeedbackPolicy.MaxHeightM)
            return "短目标累计距离、高度或坐标计算超限";
        return "";
    }

    public void Stop(string reason, long nowMs)
    {
        // 空闲 Stop 也作废正在进行的 Begin 预检查；仍然零释放、零报告变动。
        var generation = ++_generation;
        if (!OwnsInput && !CleanupFailed) return;
        Active = false; _policy?.Abort(reason);
        if (_pressInFlight)
        {
            _deferredStopReason = reason; _deferredStopAtMs = nowMs; _deferredStopOwner = _ownerGeneration;
            Message = reason + "；等待当前按键写入返回再确认释放，仍持有清理权";
            return;
        }
        CompleteStop(reason, nowMs, generation);
    }

    private void PressWithOwnership(X1Control control)
    {
        var owner = _ownerGeneration;
        _pressInFlight = true; _writeBoundaryConfirmed = false; _inFlightPressRequest = _policy!.PressRequestId;
        try
        {
            _press(control);
            if (_path != null && Active && !_writeBoundaryConfirmed)
                throw new InvalidOperationException("路径宿主未确认本次实际写前边界，要求立即释放");
        }
        finally
        {
            _pressInFlight = false; _inFlightPressRequest = 0;
            if (OwnsInput && !Active && _ownerGeneration == owner && _deferredStopOwner == owner
                && _deferredStopReason is { } reason)
            {
                var at = _deferredStopAtMs; _deferredStopReason = null;
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

    private bool ReleaseConfirmed(long generation)
    {
        if (_generation != generation || !OwnsInput) return false;
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

    private void Observe(X1ReferenceDiagnosticObservation observation, bool allowSameTime, bool beforePress = false)
    {
        var generation = _generation;
        if (_frames.Count >= MaxFrames) throw new InvalidOperationException("短目标记录帧数超限");
        var serializable = SerializableNumbers(observation);
        var held = beforePress ? null : _desired;
        _frames.Add(serializable ? new(held, observation)
            : new(held, null, "本帧缺失或含非有限数值，未伪造坐标或镜头方向"));
        _lastObservedAtMs = observation?.Pose.TimeMs;
        if (observation != null && _path != null) (_targetX, _targetZ) = _policy!.TargetAt(observation.Pose.TimeMs);
        _lastDistance = observation != null && observation.Pose.ActorId == _origin!.Pose.ActorId
            && observation.Pose.Territory == _origin.Pose.Territory
            ? Distance(observation.Pose.X, observation.Pose.Z, _targetX, _targetZ) : null;
        var error = CheckCurrentObservation(observation!);
        if (_generation != generation || !Active) return;
        if (error.Length != 0 || !serializable)
        { _totalDistance = null; throw new InvalidOperationException(error.Length != 0 ? error : "短目标观测不可序列化"); }
        if (!allowSameTime && observation!.Pose.TimeMs == _last!.Pose.TimeMs)
            throw new InvalidOperationException("短目标活跃帧时刻重复");
        var moved = Distance(_last!.Pose.X, _last.Pose.Z, observation!.Pose.X, observation.Pose.Z);
        if (!moved.HasValue || !_totalDistance.HasValue || !double.IsFinite(_totalDistance.Value + moved.Value))
        { _totalDistance = null; throw new InvalidOperationException("短目标累计位移不可用"); }
        _totalDistance += moved.Value; _last = observation;
    }

    private bool StillApproachesTarget(X1Control control, X1ReferenceDiagnosticObservation observation)
    {
        var response = _profile!.Responses.Single(r => r.Control == control);
        var target = Math.Atan2(_targetX - observation.Pose.X, _targetZ - observation.Pose.Z) * 180 / Math.PI;
        var direction = X1CameraRelativeProfile.BearingDeg(observation.Reference) + response.PhaseDeg;
        return Math.Cos((direction - target) * Math.PI / 180) > .1;
    }

    private X1CameraFeedbackReport Report(bool completed, string status, long nowMs)
    {
        var samples = new List<X1CameraPathSample>(); bool allReadable = true; double witnessError = 0;
        X1ReferenceDiagnosticObservation? previous = null;
        if (_path != null)
            foreach (var frame in _frames)
            {
                var o = frame.Observation;
                if (o == null || o.Pose.ActorId != _origin!.Pose.ActorId || o.Pose.Territory != _origin.Pose.Territory)
                { allReadable = false; continue; }
                var local = o.Pose.TimeMs - _pathStartMonoMs;
                var target = _path.TargetAt(local);
                var error = Distance(o.Pose.X, o.Pose.Z, target.X, target.Z);
                if (!error.HasValue) { allReadable = false; continue; }
                var correction = _path.CorrectionAt(local, o.Pose.X, o.Pose.Z);
                if (previous != null)
                    witnessError = Math.Max(witnessError, _path.CrossedWaypointWitnessError(previous.Pose.TimeMs - _pathStartMonoMs,
                        previous.Pose.X, previous.Pose.Z, local, o.Pose.X, o.Pose.Z));
                previous = o;
                samples.Add(new(o.Pose.TimeMs, local, target.X, target.Z, o.Pose.X, o.Pose.Z,
                    error.Value, correction.X, correction.Z, frame.HeldControl));
            }
        return new(completed, status, nowMs, _targetX, _targetZ, _tolerance, _finalDistance,
            _lastDistance, _lastObservedAtMs, _totalDistance, Frames)
        {
            Path = _path, PathStartedAtMs = _path == null ? null : _pathStartMonoMs,
            ManualMode=_pathCooperative?"Cooperate":"Interrupt",ManualInterventions=_manualInterventions+(_manualInterrupted?1:0),ManualResumptions=_manualResumptions,
            PathSamples = _path == null ? null : samples.AsReadOnly(),
            MaxPathTrackingErrorM = _path != null && allReadable && samples.Count != 0 ? samples.Max(s => s.ErrorM) : null,
            MaxCrossedWaypointWitnessErrorM = _path != null && allReadable && samples.Count != 0 ? witnessError : null
        };
    }
    private static double? Distance(double x, double z, double tx, double tz)
    {
        var dx = tx - x; var dz = tz - z; var value = Math.Sqrt(dx * dx + dz * dz);
        return double.IsFinite(value) ? value : null;
    }
    private static bool SerializableNumbers(X1ReferenceDiagnosticObservation? observation)
    {
        if (observation == null) return false;
        var pose = observation.Pose; var reference = observation.Reference;
        return double.IsFinite(pose.X) && double.IsFinite(pose.Y) && double.IsFinite(pose.Z) && double.IsFinite(pose.RotationRad)
            && reference != null && (!reference.CameraDirH.HasValue || double.IsFinite(reference.CameraDirH.Value))
            && (!reference.CameraDirV.HasValue || double.IsFinite(reference.CameraDirV.Value))
            && (!reference.CameraPosition.HasValue || reference.CameraPosition.Value.IsFinite)
            && (!reference.CameraLookAt.HasValue || reference.CameraLookAt.Value.IsFinite);
    }
}
