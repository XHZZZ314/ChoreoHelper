// 这个文件是干嘛的：自动响应短测的输入所有权；异常先松键，释放失败锁住，完整结果才原子采用。
using System;

namespace ChoreoHelper;

public sealed record X1AutomaticPreparationReport(bool Complete, string Status, long AtMs,
    X1AutomaticResponseResult? Result);

public sealed record X1AutomaticProbeObservation(X1KeyBindings Bindings, X1CalibrationPose Pose,
    X1PhysicalInputSnapshot Input, bool Safe, string Reason);

public sealed class X1AutomaticProbeSession
{
    private readonly X1InputCalibration _calibration;
    private readonly Action<X1Control> _press;
    private readonly Action _release;
    private readonly Func<bool> _held;
    private readonly Func<X1AutomaticProbeObservation>? _readCurrent;
    private X1AutomaticResponseProbe? _probe;
    private X1Control? _desired;
    private long _physicalSequence, _foreignSequence, _focusSequence, _generation;
    public bool Active { get; private set; }
    public bool OwnsInput { get; private set; }
    public bool CleanupFailed { get; private set; }
    public string Message { get; private set; } = "尚未自动探测移动响应";
    public X1AutomaticPreparationReport? LastReport { get; private set; }
    public X1AutomaticResponseResult? LastSuccessfulResult { get; private set; }

    public X1AutomaticProbeSession(X1InputCalibration calibration, Action<X1Control> press,
        Action release, Func<bool> held, Func<X1AutomaticProbeObservation>? readCurrent = null)
    { _calibration = calibration; _press = press; _release = release; _held = held; _readCurrent = readCurrent; }

    public string CheckCurrentInput(X1PhysicalInputSnapshot input)
        => !input.Enabled || !input.Healthy || !input.Foreground || !input.Armed ? "自动探测的物理观察或前台状态失效"
            : input.FocusLossSequence != _focusSequence ? "探测期间游戏失焦"
            : input.ManualTakeover || input.AnyPhysicalHeld || input.PhysicalChangeSequence != _physicalSequence ? "检测到本人输入，已取消自动探测"
            : input.ForeignInjectedChangeSequence != _foreignSequence ? "检测到其他自动输入，不能采用被污染的响应" : "";

    public void Begin(X1KeyBindings bindings, X1CalibrationPose pose, X1PhysicalInputSnapshot input)
    {
        var beforeCheck = _generation;
        if (OwnsInput || CleanupFailed || _held()) throw new InvalidOperationException("自动短测输入仍被持有，请先明确关闭并确认释放");
        if (!input.Enabled || !input.Healthy || !input.Foreground || !input.Armed || input.ManualTakeover
            || input.AnyPhysicalHeld || !input.NeutralEstablished)
            throw new InvalidOperationException("自动短测需要健康的物理观察和新鲜全松键确认");
        var candidate = new X1AutomaticResponseProbe(bindings, pose);
        if (_generation != beforeCheck) throw new InvalidOperationException("自动短测准备期间输入所有权已变化");
        _generation++;
        _physicalSequence = input.PhysicalChangeSequence; _foreignSequence = input.ForeignInjectedChangeSequence;
        _focusSequence = input.FocusLossSequence; _probe = candidate; _desired = null;
        Active = OwnsInput = true;
        Message = "正在自动短测移动响应，无需本人按方向键；本人输入立即取消";
    }

    public void Tick(X1KeyBindings bindings, X1CalibrationPose pose, X1PhysicalInputSnapshot input,
        bool safe, string reason)
    {
        if (!Active || CleanupFailed) return;
        var generation = _generation;
        try
        {
            var interrupted = !safe ? reason : CheckCurrentInput(input);
            if (!safe && string.IsNullOrWhiteSpace(interrupted)) interrupted = "游戏状态不允许自动短测";
            var step = _probe!.Tick(bindings, pose, interrupted.Length == 0, interrupted);
            Message = step.Message;
            if (step.State == X1AutomaticProbeState.Failed)
            { Stop(Message, pose.TimeMs); return; }
            if (step.State == X1AutomaticProbeState.Completed)
            {
                // 不能在松键失败时标记成功或提交新的响应配置。
                if (!ReleaseConfirmed(generation) || !Active) return;
                var current = _readCurrent?.Invoke() ?? new(bindings, pose, input, safe, reason);
                if (_generation != generation || !Active) return;
                var finalInputError = CheckCurrentInput(current.Input);
                if (!current.Safe || finalInputError.Length != 0)
                    throw new InvalidOperationException(!current.Safe ? "结果采用前游戏状态失效：" + current.Reason : finalInputError);
                var result = _probe.Result ?? throw new InvalidOperationException("完整自动探测结果缺失");
                var adopted = _calibration.TryAdoptAutomatic(result, current.Bindings, current.Pose);
                if (!adopted.Ok) throw new InvalidOperationException(adopted.Error);
                Active = OwnsInput = false; _probe = null;
                LastSuccessfulResult = result;
                Message = "自动移动响应已准备；按真实坐标追踪路径，物理接管尚需单独验证";
                LastReport = new(true, Message, pose.TimeMs, result);
                return;
            }
            if (_desired != step.DesiredControl)
            {
                if (!ReleaseConfirmed(generation) || !Active) return;
                if (step.DesiredControl is { } control)
                {
                    _press(control);
                    if (_generation != generation || !Active) return;
                }
                _desired = step.DesiredControl;
            }
        }
        catch (Exception error)
        {
            if (_generation != generation) return;
            // 若这次已经发生释放失败，不在同一帧暗中重试；等本人 off。
            if (CleanupFailed)
            {
                Active = false; Message = "自动探测释放未确认：" + error.Message;
                LastReport = new(false, Message, pose.TimeMs, null);
            }
            else Stop("自动探测失败：" + error.Message, pose.TimeMs);
        }
    }

    public void Stop(string reason, long nowMs)
    {
        if (!OwnsInput && !CleanupFailed) return;
        var generation = ++_generation;
        Active = false;
        try
        {
            if (!ReleaseConfirmed(generation)) return;
            OwnsInput = false; _probe = null; Message = reason;
            LastReport = new(false, reason, nowMs, null);
        }
        catch (Exception error)
        {
            if (_generation != generation) return;
            Message = reason + "；释放未确认，请 /choreo x1 off 重试：" + error.Message;
            LastReport = new(false, Message, nowMs, null);
        }
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
            _desired = null; CleanupFailed = false;
            return true;
        }
        catch { if (_generation == generation) { CleanupFailed = true; OwnsInput = true; } throw; }
    }
}
