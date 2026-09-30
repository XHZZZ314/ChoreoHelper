// 这个文件是干嘛的：保存镜头和步行的不可变原始观测；可读不代表已经证明移动参考方向。
using System;

namespace ChoreoHelper;

public readonly record struct X1ReferenceVector(double X, double Y, double Z)
{
    public bool IsFinite => double.IsFinite(X) && double.IsFinite(Y) && double.IsFinite(Z);
}

/// <summary>DirH、镜头位置和 LookAtVector 保留 API 原值，不假定其相位或正负号。
/// Readable 仅表示字段可读，绝不表示移动/朝向已可执行。</summary>
public sealed record X1MovementReferenceSnapshot
{
    public long AtMs { get; init; }
    public double? CameraDirH { get; init; }
    public double? CameraDirV { get; init; }
    public int? CameraControlMode { get; init; }
    public int? CameraZoomMode { get; init; }
    public int? ActiveCameraIndex { get; init; }
    public bool? EventCameraAutoControl { get; init; }
    public bool? IsWalking { get; init; }
    public bool? IsWalkingDuringAutorun { get; init; }
    public X1ReferenceVector? CameraPosition { get; init; }
    public X1ReferenceVector? CameraLookAt { get; init; }
    public string Reason { get; init; } = "移动参考观测尚未取得";
    public bool Readable => Reason.Length == 0 && CameraDirH.HasValue && CameraDirV.HasValue
        && double.IsFinite(CameraDirH.Value) && double.IsFinite(CameraDirV.Value)
        && CameraControlMode.HasValue && CameraZoomMode.HasValue && ActiveCameraIndex == 0
        && EventCameraAutoControl.HasValue && IsWalking.HasValue && IsWalkingDuringAutorun.HasValue
        && CameraPosition is { IsFinite: true } && CameraLookAt is { IsFinite: true };
}
