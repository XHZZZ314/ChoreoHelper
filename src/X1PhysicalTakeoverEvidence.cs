// 这个文件是干嘛的：分别记录被动物理输入和在途持键接管的证据；本层从不注入或释放输入。
using System;
using System.Collections.Generic;

namespace ChoreoHelper;

public enum X1TakeoverEvidenceKind { PassiveDetection, ActiveOwnedKeyRelease }
public enum X1TakeoverEvidenceStage { Idle, AwaitPhysical, AwaitRelease, AwaitNeutralReset, AwaitFreshNeutral, Completed, Failed }

public sealed record X1TakeoverEvidenceFrame(X1ReferenceDiagnosticObservation Observation,
    string OwnerId, bool OwnerActive, bool OwnerOwnsInput, bool AnyOwnedKeyHeld, bool CleanupFailed);

public sealed record X1TakeoverEvidenceSample(X1TakeoverEvidenceFrame? Frame, string? ObservationError = null);

public sealed record X1PhysicalTakeoverReport(X1TakeoverEvidenceKind Kind, X1TakeoverEvidenceStage Stage,
    bool Completed, bool PhysicalDetected, bool ActiveReleaseConfirmed, bool AutomaticallyVerified,
    string Status, long AtMs, X1TakeoverEvidenceFrame Start, X1TakeoverEvidenceFrame? Trigger,
    X1TakeoverEvidenceFrame? Release, X1TakeoverEvidenceFrame? NeutralReset,
    X1TakeoverEvidenceFrame? Final, IReadOnlyList<X1TakeoverEvidenceSample> Frames);

/// <summary>调用者串行传入原始观测，不调用任何输出委托。主动证明必须从实际持键开始，
/// 活跃持有者的正常脉冲间隙可继续等待，但只有真实持键当帧的物理输入能证明主动接管。
/// 见本人输入后先停止持有者，再调用 ConfirmRelease；Disarm/RequireNeutral 后记录
/// neutral=false，再等严格更新的全松帧。所有失败锁在当前报告内，重试须明确 Begin。
/// 证明只覆盖本次钩子所见输入；没有输入不能证明 Windows 不会漏报。</summary>
public sealed class X1PhysicalTakeoverEvidence
{
    public const long MaxFrameGapMs = 100, MaxWaitMs = 15000, MaxReleaseMs = 100, MaxNeutralMs = 3000;
    private X1TakeoverEvidenceFrame? _start, _last, _trigger, _release, _neutralReset, _final;
    private X1TakeoverEvidenceKind _kind;
    private readonly List<X1TakeoverEvidenceSample> _frames = new();
    private IReadOnlyList<X1TakeoverEvidenceSample>? _frozenFrames;
    private double _distance;
    private string _status = "尚未开始物理接管验证";
    private long _atMs;
    public X1TakeoverEvidenceStage Stage { get; private set; }
    public bool Active => Stage is X1TakeoverEvidenceStage.AwaitPhysical or X1TakeoverEvidenceStage.AwaitRelease
        or X1TakeoverEvidenceStage.AwaitNeutralReset or X1TakeoverEvidenceStage.AwaitFreshNeutral;
    public X1PhysicalTakeoverReport? Report => _start == null ? null : new(_kind, Stage,
        Stage == X1TakeoverEvidenceStage.Completed, _trigger != null,
        Stage == X1TakeoverEvidenceStage.Completed && _kind == X1TakeoverEvidenceKind.ActiveOwnedKeyRelease,
        false, _status, _atMs, _start, _trigger, _release, _neutralReset, _final, _frozenFrames ??= Array.AsReadOnly(_frames.ToArray()));

    public void Begin(X1TakeoverEvidenceKind kind, X1TakeoverEvidenceFrame frame)
    {
        if (Active) throw new InvalidOperationException("现有接管证据尚未结束，不能覆盖");
        if (!Enum.IsDefined(kind)) throw new ArgumentOutOfRangeException(nameof(kind));
        var error = InitialError(frame);
        if (error.Length == 0 && kind == X1TakeoverEvidenceKind.PassiveDetection && !Stopped(frame))
            error = "被动检测必须没有输出持有者或遗留按键";
        if (error.Length == 0 && kind == X1TakeoverEvidenceKind.ActiveOwnedKeyRelease
            && (!frame.OwnerActive || !frame.OwnerOwnsInput || !frame.AnyOwnedKeyHeld || string.IsNullOrWhiteSpace(frame.OwnerId)))
            error = "主动接管证据必须从本场次实际持键开始";
        if (error.Length != 0) throw new InvalidOperationException(error);
        _kind = kind; _start = _last = frame; _trigger = _release = _neutralReset = _final = null;
        _frames.Clear(); _frames.Add(new(frame)); _frozenFrames = null; _distance = 0;
        _atMs = frame.Observation.Pose.TimeMs; Stage = X1TakeoverEvidenceStage.AwaitPhysical;
        _status = kind == X1TakeoverEvidenceKind.PassiveDetection ? "等待本人真实按键或鼠标按钮；没有输出动作" : "已记录本场次实际持键，等待本人真实接管";
    }

    public void Observe(X1TakeoverEvidenceFrame frame)
    {
        if (!Active) return;
        if (!Validate(frame, false)) return;
        var input = frame.Observation.Input;
        if (Stage == X1TakeoverEvidenceStage.AwaitPhysical)
        {
            if (!input.Armed) { Fail("物理事件出现前接管观察已解除", frame); return; }
            if (_kind == X1TakeoverEvidenceKind.PassiveDetection && !Stopped(frame))
            { Fail("被动检测期间出现输出持有者", frame); return; }
            var changed = input.PhysicalChangeSequence > _start!.Observation.Input.PhysicalChangeSequence;
            if (!changed)
            {
                if (input.ManualTakeover || input.AnyPhysicalHeld) Fail("接管锁或持态没有新鲜物理事件证明", frame);
                else if (_kind == X1TakeoverEvidenceKind.ActiveOwnedKeyRelease
                    && (!frame.OwnerActive || !frame.OwnerOwnsInput))
                    Fail("本人输入前输出持有者已结束，本次不能证明在途持键接管", frame);
                return;
            }
            if (!input.ManualTakeover) { Fail("物理事件未锁定接管", frame); return; }
            if (_kind == X1TakeoverEvidenceKind.ActiveOwnedKeyRelease
                && (!frame.OwnerActive || !frame.OwnerOwnsInput || !frame.AnyOwnedKeyHeld))
            { Fail("本人输入发生在无在途持键时，本次不能证明主动释放", frame); return; }
            _trigger = frame; Stage = X1TakeoverEvidenceStage.AwaitRelease;
            _status = "已记录本人输入；等待停止持有者和确认释放";
            if (_kind == X1TakeoverEvidenceKind.PassiveDetection) ConfirmRelease(frame);
            return;
        }
        if (Stage == X1TakeoverEvidenceStage.AwaitRelease) return; // 宿主明确调用 ConfirmRelease，不能推断释放成功。
        if (!Stopped(frame)) { Fail("接管后输出重新出现", frame); return; }
        if (input.Armed) { Fail("接管后未经新请求重新武装", frame); return; }
        if (Stage == X1TakeoverEvidenceStage.AwaitFreshNeutral && input.NeutralEstablished && !input.AnyPhysicalHeld)
        {
            if (frame.Observation.Pose.TimeMs <= _neutralReset!.Observation.Pose.TimeMs)
            { Fail("全松确认不是请求后的新鲜帧", frame); return; }
            _final = frame; Stage = X1TakeoverEvidenceStage.Completed;
            _status = _kind == X1TakeoverEvidenceKind.PassiveDetection
                ? "本人真实输入和随后新鲜全松已记录；仅被动检测，没有输出释放验收"
                : "本人真实输入、在途持键停止释放和随后新鲜全松已记录";
        }
    }

    public void ConfirmRelease(X1TakeoverEvidenceFrame frame)
    {
        if (Stage != X1TakeoverEvidenceStage.AwaitRelease) return;
        if (!Validate(frame, true)) return;
        if (!Stopped(frame)) { Fail("接管后持有者或按键释放尚未确认", frame); return; }
        _release = frame; Stage = X1TakeoverEvidenceStage.AwaitNeutralReset;
        _status = "持有者和按键已释放；等待明确解除武装并请求新的全松观测";
    }

    public void RecordNeutralReset(X1TakeoverEvidenceFrame frame)
    {
        if (Stage != X1TakeoverEvidenceStage.AwaitNeutralReset) return;
        if (!Validate(frame, true)) return;
        var input = frame.Observation.Input;
        if (!Stopped(frame) || input.Armed || input.NeutralEstablished)
        { Fail("缺少本次 Disarm/RequireNeutral 后的未全松快照", frame); return; }
        _neutralReset = frame; Stage = X1TakeoverEvidenceStage.AwaitFreshNeutral;
        _status = "已请求新的全松观测，等待本人松开全部按键和鼠标按钮";
    }

    public void Cancel(string reason, long atMs)
    {
        if (!Active) return;
        Stage = X1TakeoverEvidenceStage.Failed;
        _status = string.IsNullOrWhiteSpace(reason) ? "本次接管证据已取消" : reason;
        _atMs = Math.Max(_atMs, atMs);
    }

    private bool Validate(X1TakeoverEvidenceFrame frame, bool allowSameTime)
    {
        var error = ContinuityError(frame, allowSameTime);
        if (_frames.Count < 8192)
        {
            _frames.Add(Serializable(frame?.Observation) ? new(frame) : new(null, "不可序列化的原始观测；坐标缺测，未补值"));
            _frozenFrames = null;
        }
        else error = "接管原始证据帧数超过上限";
        if (error.Length != 0 || frame == null) { Fail(error.Length != 0 ? error : "接管观测缺失", frame); return false; }
        _distance += X1MovementExecutor.Distance(_last!.Observation.Pose.X, _last.Observation.Pose.Z,
            frame.Observation.Pose.X, frame.Observation.Pose.Z);
        _last = frame; _atMs = frame.Observation.Pose.TimeMs; return true;
    }

    private string ContinuityError(X1TakeoverEvidenceFrame frame, bool allowSameTime)
    {
        if (frame?.Observation == null || !frame.Observation.Pose.IsFinite || frame.Observation.Reference?.Readable != true)
            return "接管证据缺少可读的实际角色和移动参考";
        var o = frame.Observation; var b = _start!.Observation; var previous = _last!.Observation;
        if (!o.Safe) return "接管同帧或后续出现独立游戏安全故障：" + o.Reason;
        if (_kind == X1TakeoverEvidenceKind.ActiveOwnedKeyRelease
            && (_distance + X1MovementExecutor.Distance(previous.Pose.X, previous.Pose.Z, o.Pose.X, o.Pose.Z) > X1ReferenceDiagnosticSession.MaxDistanceM
                || Math.Abs(o.Pose.Y - b.Pose.Y) > X1ReferenceDiagnosticSession.MaxHeightM))
            return "接管期间实际移动或高度超过原诊断上限";
        var elapsed = o.Pose.TimeMs - previous.Pose.TimeMs;
        if (elapsed < 0 || !allowSameTime && elapsed == 0 || elapsed > MaxFrameGapMs) return "接管证据时刻倒退、重复或帧间隔过大";
        if (o.Pose.TimeMs - b.Pose.TimeMs > MaxWaitMs) return "等待本人接管超过时限";
        if (_trigger != null && Stage == X1TakeoverEvidenceStage.AwaitRelease
            && o.Pose.TimeMs - _trigger.Observation.Pose.TimeMs > MaxReleaseMs) return "本人接管后释放确认超时";
        if (_release != null && o.Pose.TimeMs - _release.Observation.Pose.TimeMs > MaxNeutralMs) return "接管后的新鲜全松确认超时";
        if (!SameIdentity(o, b) || frame.OwnerId != _start.OwnerId) return "接管证据的角色、场次、区域、绑定或模式已变化";
        var i = o.Input; var bi = b.Input;
        if (!i.Enabled || !i.Healthy || !i.Foreground) return "物理输入观测不健康或游戏不在前台";
        if (frame.CleanupFailed) return "释放失败已锁定，本次接管不能通过";
        if (i.FocusLossSequence != bi.FocusLossSequence) return "接管证据期间发生失焦";
        if (i.ForeignInjectedChangeSequence != bi.ForeignInjectedChangeSequence) return "外来自动注入污染，本次不能作为本人接管证据";
        if (i.PhysicalChangeSequence < previous.Input.PhysicalChangeSequence
            || i.InjectedChangeSequence < previous.Input.InjectedChangeSequence) return "输入来源计数已重置或倒退";
        if (_kind == X1TakeoverEvidenceKind.PassiveDetection && i.InjectedChangeSequence != bi.InjectedChangeSequence)
            return "被动接管检测中出现自动注入，不能通过";
        return "";
    }

    internal static bool Serializable(X1ReferenceDiagnosticObservation? observation)
    {
        if (observation == null || !observation.Pose.IsFinite) return false;
        var r = observation.Reference;
        return r != null && (!r.CameraDirH.HasValue || double.IsFinite(r.CameraDirH.Value))
            && (!r.CameraDirV.HasValue || double.IsFinite(r.CameraDirV.Value))
            && (!r.CameraPosition.HasValue || r.CameraPosition.Value.IsFinite)
            && (!r.CameraLookAt.HasValue || r.CameraLookAt.Value.IsFinite);
    }
    private static string InitialError(X1TakeoverEvidenceFrame frame)
    {
        if (frame?.Observation == null || !frame.Observation.Pose.IsFinite || frame.Observation.Pose.TimeMs < 0
            || frame.Observation.Reference?.Readable != true || !frame.Observation.MovementMode.HasValue
            || frame.Observation.Bindings == null || !frame.Observation.Safe) return "初始角色、键位或移动参考不可用";
        var i = frame.Observation.Input;
        if (!i.Enabled || !i.Healthy || !i.Foreground || !i.Armed || !i.NeutralEstablished || i.AnyPhysicalHeld || i.ManualTakeover
            || frame.CleanupFailed || i.PhysicalChangeSequence < 0 || i.InjectedChangeSequence < 0 || i.ForeignInjectedChangeSequence < 0)
            return "初始物理观测、武装或全松条件未满足";
        return "";
    }

    private static bool SameIdentity(X1ReferenceDiagnosticObservation a, X1ReferenceDiagnosticObservation b)
        => a.Pose.ActorId == b.Pose.ActorId && a.Pose.Territory == b.Pose.Territory && a.Bindings?.Identity == b.Bindings.Identity
        && a.MovementMode == b.MovementMode && a.Reference.CameraControlMode == b.Reference.CameraControlMode
        && a.Reference.CameraZoomMode == b.Reference.CameraZoomMode && a.Reference.ActiveCameraIndex == b.Reference.ActiveCameraIndex
        && a.Reference.EventCameraAutoControl == b.Reference.EventCameraAutoControl && a.Reference.IsWalking == b.Reference.IsWalking
        && a.Reference.IsWalkingDuringAutorun == b.Reference.IsWalkingDuringAutorun;

    private static bool Stopped(X1TakeoverEvidenceFrame f) => !f.OwnerActive && !f.OwnerOwnsInput && !f.AnyOwnedKeyHeld && !f.CleanupFailed;
    private void Fail(string reason, X1TakeoverEvidenceFrame? frame)
    {
        Stage = X1TakeoverEvidenceStage.Failed; _status = reason;
        if (frame?.Observation != null) _atMs = Math.Max(_atMs, frame.Observation.Pose.TimeMs);
    }
}
