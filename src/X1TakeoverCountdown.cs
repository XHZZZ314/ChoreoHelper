// 这个文件是干嘛的：为本人在途接管提供三秒倒数；只记录原始等待帧，不输出按键，不把倒数当释放验收。
using System;
using System.Collections.Generic;

namespace ChoreoHelper;

public sealed record X1TakeoverCountdownReport(bool Ready, string Status,
    IReadOnlyList<X1ReferenceDiagnosticFrame> Frames);

public sealed class X1TakeoverCountdown
{
    public const long DurationMs = 3000;
    private readonly List<X1ReferenceDiagnosticFrame> _frames = new();
    private X1ReferenceDiagnosticObservation? _first, _last;
    private X1CameraRelativeProfile? _profile;
    private long _startMs, _lastMs;
    private int _lastCue;
    public bool Active { get; private set; }
    public bool Ready { get; private set; }
    public string Status { get; private set; } = "尚未倒数";
    public X1TakeoverCountdownReport Report => new(Ready, Status, Array.AsReadOnly(_frames.ToArray()));

    public void Begin(X1CameraRelativeProfile profile, X1ReferenceDiagnosticObservation frame)
    {
        if (Active) throw new InvalidOperationException("现有接管倒数未结束");
        var error = profile.CheckCurrent(frame);
        if (error.Length != 0) throw new InvalidOperationException(error);
        _profile = profile; _frames.Clear(); _frames.Add(new(null, frame)); _first = _last = frame;
        _startMs = _lastMs = frame.Pose.TimeMs; _lastCue = 3;
        Active = true; Ready = false; Status = "接管倒数 3；按倒数节奏在“现在”轻点左 Shift，然后全部松开";
    }

    // 返回本帧的新提示，宿主随后才可启动原有150ms诊断；错过窗口不延长持键求通过。
    public string? Advance(X1ReferenceDiagnosticObservation frame)
    {
        if (!Active) return null;
        var first = _first!; var previous = _last!;
        _frames.Add(X1PhysicalTakeoverEvidence.Serializable(frame) ? new(null, frame)
            : new(null, null, "不可序列化的原始观测；坐标缺测，未补值"));
        var dt = frame.Pose.TimeMs - _lastMs;
        var elapsed = frame.Pose.TimeMs - _startMs;
        var error = _profile!.CheckCurrent(frame);
        if (error.Length == 0 && (dt <= 0 || dt > X1ReferenceDiagnosticSession.MaxFrameGapMs
            || elapsed > DurationMs + X1ReferenceDiagnosticSession.MaxFrameGapMs || _frames.Count > 1024))
            error = "接管倒数帧间隔、时间或帧数超限";
        if (error.Length == 0 && (frame.Input.PhysicalChangeSequence != first.Input.PhysicalChangeSequence
            || frame.Input.InjectedChangeSequence != first.Input.InjectedChangeSequence
            || frame.Input.ForeignInjectedChangeSequence != first.Input.ForeignInjectedChangeSequence
            || frame.Input.FocusLossSequence != first.Input.FocusLossSequence))
            error = "接管倒数期间出现本人或自动输入；没有在途释放验收，请明确重试";
        if (error.Length == 0 && (X1MovementExecutor.Distance(first.Pose.X, first.Pose.Z, frame.Pose.X, frame.Pose.Z) > .01
            || Math.Abs(frame.Pose.Y - first.Pose.Y) > .01
            || X1MovementExecutor.Distance(previous.Pose.X, previous.Pose.Z, frame.Pose.X, frame.Pose.Z) > .01))
            error = "接管倒数期间角色已移动，本次取消";
        if (error.Length != 0) { Cancel(error); throw new InvalidOperationException(error); }
        _lastMs = frame.Pose.TimeMs; _last = frame;
        var cue = elapsed >= DurationMs ? 0 : (int)Math.Ceiling((DurationMs - elapsed) / 1000d);
        if (cue == _lastCue) return null;
        _lastCue = cue;
        if (cue == 0) { Active = false; Ready = true; Status = "现在：轻点左 Shift 并松开；仅本次真实持键期间的物理输入有效"; }
        else Status = "接管倒数 " + cue;
        return Status;
    }

    public void Cancel(string reason)
    { Active = false; Ready = false; Status = reason; }
}
