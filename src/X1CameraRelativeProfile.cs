// 这个文件是干嘛的：从完整单键诊断取得镜头相对方向；只接受实测一致且覆盖正交三方向的临时配置。
using System;
using System.Collections.Generic;
using System.Linq;

namespace ChoreoHelper;

public sealed record X1CameraControlResponse(X1Control Control, double PhaseDeg, double MeasuredStopDistanceM,
    long MeasuredResponseDelayMs, long MeasuredStopDelayMs, double PeakSpeedMps, int MovingFrames);

public sealed class X1CameraRelativeProfile
{
    public const long MaxReportAgeMs = 600000, LeaseMs = 180000;
    public const double MaxPhaseDeviationDeg = 3;
    private readonly X1ReferenceDiagnosticObservation _identity;
    private readonly double _rawViewPhaseDeg;
    public long CreatedAtMs { get; }
    public IReadOnlyList<X1CameraControlResponse> Responses { get; }
    public double PeakSpeedMps => Responses.Max(r => r.PeakSpeedMps);
    public double StopDistanceM => Responses.Max(r => r.MeasuredStopDistanceM);
    public long MaximumResponseLagMs => Responses.Max(r => r.MeasuredResponseDelayMs);
    public long MaximumStopLagMs => Responses.Max(r => r.MeasuredStopDelayMs);
    private X1CameraRelativeProfile(X1ReferenceDiagnosticObservation identity, IEnumerable<X1CameraControlResponse> responses,
        double rawViewPhaseDeg)
    { _identity = identity; CreatedAtMs = identity.Pose.TimeMs; Responses = Array.AsReadOnly(responses.ToArray()); _rawViewPhaseDeg = rawViewPhaseDeg; }

    public static (bool Ok, string Error, X1CameraRelativeProfile? Profile) TryCreate(
        IReadOnlyList<X1ReferenceDiagnosticReport> reports, X1ReferenceDiagnosticObservation current)
    {
        try
        {
            var error = ContextError(current, false);
            if (error.Length != 0) throw new InvalidOperationException(error);
            if (reports == null || reports.Count != 3 || reports.Select(r => r.Control).Distinct().Count() != 3
                || reports.Any(r => r.Control is not (X1Control.Forward or X1Control.TurnLeft or X1Control.TurnRight)))
                throw new InvalidOperationException("需要前进、左转和右转三份独立完整诊断");
            var viewPhase = Signed(BearingDeg(current.Reference) - current.Reference.CameraDirH!.Value * 180 / Math.PI);
            var responses = new List<X1CameraControlResponse>();
            foreach (var report in reports)
            {
                if (!report.Completed || report.Frames.Count < 6 || report.Frames.Count > X1ReferenceDiagnosticSession.MaxFrames
                    || current.Pose.TimeMs < report.AtMs || current.Pose.TimeMs - report.AtMs > MaxReportAgeMs)
                    throw new InvalidOperationException("诊断未完整结束、帧数无效或已经过期");
                var first = report.Frames[0].Observation ?? throw new InvalidOperationException("诊断起始观测缺失");
                if (first.Input.PhysicalChangeSequence != current.Input.PhysicalChangeSequence
                    || first.Input.ForeignInjectedChangeSequence != current.Input.ForeignInjectedChangeSequence
                    || first.Input.FocusLossSequence != current.Input.FocusLossSequence)
                    throw new InvalidOperationException("三项诊断之间或采用之前出现输入变化，整套不能采用");
                X1ReferenceDiagnosticObservation? previous = null;
                var phases = new List<(double Angle, double Distance)>();
                double distance = 0, actorAngle = 0, cameraAngle = 0, stopDistance = 0, peakSpeed = 0;
                long? pressStart = null, lastHeld = null, firstMove = null, lastMove = null;
                bool released = false;
                foreach (var frame in report.Frames)
                {
                    var o = frame.Observation ?? throw new InvalidOperationException("诊断包含缺测帧，不能形成方向配置");
                    error = ContextError(o, true);
                    if (error.Length != 0 || !SameIdentity(current, o)) throw new InvalidOperationException("诊断角色、键位、移动模式、镜头或步行身份与当前不一致");
                    if (o.Input.PhysicalChangeSequence != first.Input.PhysicalChangeSequence
                        || o.Input.ForeignInjectedChangeSequence != first.Input.ForeignInjectedChangeSequence
                        || o.Input.FocusLossSequence != first.Input.FocusLossSequence)
                        throw new InvalidOperationException("诊断受到本人输入、外来注入或失焦污染");
                    if (Math.Abs(Signed(BearingDeg(o.Reference) - o.Reference.CameraDirH!.Value * 180 / Math.PI - viewPhase)) > MaxPhaseDeviationDeg)
                        throw new InvalidOperationException("镜头原始角与实际视线的关系不一致");
                    if (frame.HeldControl.HasValue)
                    {
                        if (frame.HeldControl != report.Control || released) throw new InvalidOperationException("诊断并非一次独占单键短按");
                        pressStart ??= previous?.Pose.TimeMs ?? o.Pose.TimeMs;
                        lastHeld = o.Pose.TimeMs;
                    }
                    else if (pressStart.HasValue) released = true;
                    if (previous != null)
                    {
                        var dt = o.Pose.TimeMs - previous.Pose.TimeMs;
                        if (dt < 0 || dt > X1ReferenceDiagnosticSession.MaxFrameGapMs || dt == 0 && o.Pose != previous.Pose)
                            throw new InvalidOperationException("诊断帧时间存在倒退、缺口或同刻移动");
                        var dx = o.Pose.X - previous.Pose.X; var dz = o.Pose.Z - previous.Pose.Z;
                        var d = Math.Sqrt(dx * dx + dz * dz);
                        if (!double.IsFinite(d)) throw new InvalidOperationException("诊断位移计算不可用");
                        distance += d;
                        actorAngle += Math.Abs(Signed((o.Pose.RotationRad - previous.Pose.RotationRad) * 180 / Math.PI));
                        cameraAngle += Math.Abs(Signed((o.Reference.CameraDirH!.Value - previous.Reference.CameraDirH!.Value) * 180 / Math.PI));
                        if (d > .001)
                        {
                            if (!pressStart.HasValue || dt <= 0) throw new InvalidOperationException("按下之前已有不能归属的位移");
                            firstMove ??= o.Pose.TimeMs; lastMove = o.Pose.TimeMs;
                            peakSpeed = Math.Max(peakSpeed, d * 1000 / dt);
                            phases.Add((Signed(Math.Atan2(dx, dz) * 180 / Math.PI - BearingDeg(previous.Reference)), d));
                            if (released) stopDistance += d;
                        }
                    }
                    if (Math.Abs(o.Pose.Y - first.Pose.Y) > X1ReferenceDiagnosticSession.MaxHeightM)
                        throw new InvalidOperationException("诊断高度超限");
                    previous = o;
                }
                var last = previous!;
                if (!released || !pressStart.HasValue || !lastHeld.HasValue || !firstMove.HasValue || !lastMove.HasValue
                    || lastHeld.Value - pressStart.Value < X1ReferenceDiagnosticSession.PressMs
                    || lastHeld.Value - pressStart.Value > X1ReferenceDiagnosticSession.PressMs + X1ReferenceDiagnosticSession.MaxFrameGapMs
                    || last.Pose.TimeMs - lastHeld.Value < X1ReferenceDiagnosticSession.RestMs
                    || last.Pose.TimeMs - lastMove.Value < 100 || last.Pose.TimeMs != report.AtMs
                    || last.Pose.TimeMs - first.Pose.TimeMs > X1ReferenceDiagnosticSession.MaxTotalMs
                    || distance > X1ReferenceDiagnosticSession.MaxDistanceM || actorAngle > X1ReferenceDiagnosticSession.MaxActorAngleDeg
                    || cameraAngle > X1ReferenceDiagnosticSession.MaxCameraAngleDeg || phases.Count < 3)
                    throw new InvalidOperationException("诊断短按、停止稳定性、幅度或有效移动帧不足");
                var phaseX = phases.Sum(p => Math.Sin(p.Angle * Math.PI / 180) * p.Distance);
                var phaseZ = phases.Sum(p => Math.Cos(p.Angle * Math.PI / 180) * p.Distance);
                var phase = Math.Atan2(phaseX, phaseZ) * 180 / Math.PI;
                if (phases.Any(p => Math.Abs(Signed(p.Angle - phase)) > MaxPhaseDeviationDeg))
                    throw new InvalidOperationException("同一键相对上一帧镜头视线的方向不一致");
                responses.Add(new(report.Control, phase, stopDistance, firstMove.Value - pressStart.Value,
                    Math.Max(0, lastMove.Value - lastHeld.Value), peakSpeed, phases.Count));
            }
            double Dot(X1Control a, X1Control b) => Math.Cos((responses.Single(x => x.Control == a).PhaseDeg
                - responses.Single(x => x.Control == b).PhaseDeg) * Math.PI / 180);
            if (Math.Abs(Dot(X1Control.Forward, X1Control.TurnLeft)) > .15
                || Math.Abs(Dot(X1Control.Forward, X1Control.TurnRight)) > .15
                || Dot(X1Control.TurnLeft, X1Control.TurnRight) > -.97)
                throw new InvalidOperationException("三键实测方向未形成前向与两个相反侧向的正交覆盖");
            return (true, "", new(current, responses, viewPhase){CalibratedWhileWalking=current.Reference.IsWalking});
        }
        catch (Exception ex) { return (false, ex.Message, null); }
    }

    public bool? CalibratedWhileWalking { get; set; }

    // 协同让出和自动步态仅豁免各自条件，身份、租约及前台检查仍保留。
    public string CheckCurrent(X1ReferenceDiagnosticObservation current, bool requireArmed = true,
        bool allowCooperativeMovement = false, bool ignoreWalkingIdentity = false)
    {
        var error = ContextError(current, requireArmed, allowCooperativeMovement);
        if (error.Length != 0) return error;
        if (!SameIdentity(_identity, current, ignoreWalkingIdentity)) return "本次镜头方向配置的角色、模式、步行或键位身份已经变化";
        if (current.Pose.TimeMs < CreatedAtMs || current.Pose.TimeMs - CreatedAtMs > LeaseMs) return "本次镜头方向配置已过期";
        return Math.Abs(Signed(BearingDeg(current.Reference) - current.Reference.CameraDirH!.Value * 180 / Math.PI - _rawViewPhaseDeg)) > MaxPhaseDeviationDeg
            ? "当前实际镜头视线与诊断参考不一致" : "";
    }
    public string IdentityError(X1ReferenceDiagnosticObservation current) => CheckCurrent(current, false);
    public string IdentityError(X1ReferenceDiagnosticObservation current, bool useLocomotion)
        => CheckCurrent(current, false, ignoreWalkingIdentity:useLocomotion);

    public static double BearingDeg(X1MovementReferenceSnapshot reference)
    {
        if (!reference.Readable || reference.CameraPosition is not { } p || reference.CameraLookAt is not { } t)
            throw new InvalidOperationException("实际镜头视线不可读");
        var x = t.X - p.X; var z = t.Z - p.Z; var length = Math.Sqrt(x * x + z * z);
        if (!double.IsFinite(length) || length < .01) throw new InvalidOperationException("镜头水平视线过短，不能选方向");
        return Math.Atan2(x, z) * 180 / Math.PI;
    }
    internal static double Signed(double angle) => ((angle + 180) % 360 + 360) % 360 - 180;
    private static bool SameIdentity(X1ReferenceDiagnosticObservation a, X1ReferenceDiagnosticObservation b, bool ignoreWalking=false)
        => a.Bindings.Identity == b.Bindings.Identity && a.Pose.ActorId == b.Pose.ActorId && a.Pose.Territory == b.Pose.Territory
            && a.MovementMode == b.MovementMode && a.Reference.CameraControlMode == b.Reference.CameraControlMode
            && a.Reference.CameraZoomMode == b.Reference.CameraZoomMode && a.Reference.ActiveCameraIndex == b.Reference.ActiveCameraIndex
            && a.Reference.EventCameraAutoControl == b.Reference.EventCameraAutoControl && (ignoreWalking || a.Reference.IsWalking == b.Reference.IsWalking)
            && a.Reference.IsWalkingDuringAutorun == b.Reference.IsWalkingDuringAutorun;
    private static string ContextError(X1ReferenceDiagnosticObservation o, bool requireArmed, bool cooperative=false)
    {
        if (o == null || !o.Safe || o.Bindings == null || !o.Pose.IsFinite || o.Pose.TimeMs < 0
            || !o.MovementMode.HasValue || o.Reference == null || !o.Reference.Readable)
            return "游戏、角色、模式或镜头参考条件不完整";
        var r = o.Reference; var input = o.Input;
        if (r.CameraControlMode is not (1 or 2) || r.CameraZoomMode != 1 || r.EventCameraAutoControl != false
            || Math.Abs((double)r.AtMs - o.Pose.TimeMs) > X1ReferenceDiagnosticSession.MaxFrameGapMs)
            return "当前镜头上下文不可用或观测不同步";
        if (!input.Enabled || !input.Healthy || !input.Foreground || requireArmed && !input.Armed
            || input.ManualTakeover || input.AnyPhysicalHeld && !(cooperative && input.CooperativeHeld) || !input.NeutralEstablished)
            return "物理输入观察、全松或前台条件不完整";
        try { _ = BearingDeg(r); } catch (Exception ex) { return ex.Message; }
        return "";
    }
}
