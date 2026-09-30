// 这个文件是干嘛的：演出/输入链丢失的配套类型声明（捐赠原文提取）。
// 捐赠源：ability-read-observation-20260912-192648-984\source\src\X1AbilityEligibility.cs。
using System;

namespace ChoreoHelper;

/// <summary>一次明确动作/目标的只读快照；没有默认成功值，不持有游戏对象或原生指针。</summary>
public sealed record X1NativeAbilityObservation
{
    public int ActionRowId { get; init; }
    public string TargetId { get; init; } = "";
    public long ObservedAtMs { get; init; }
    public ulong? SourceActorId { get; init; }
    public uint? TerritoryId { get; init; }
    public uint? PlayerJobId { get; init; }
    public string PlayerJobName { get; init; } = "";
    public string PlayerJobEnglishName { get; init; } = "";
    public bool? PlayerAction { get; init; }
    public bool? PvpAction { get; init; }
    public bool? AreaTargeted { get; init; }
    public bool? ChangesPosition { get; init; }
    public bool? JobAllowed { get; init; }
    public int? ActionRequiredLevel { get; init; }
    public int? PlayerLevel { get; init; }
    public bool? ExplicitTargetMatches { get; init; }
    public bool? CanUseOnTarget { get; init; }
    public uint? RangeOrLineOfSightStatus { get; init; }
    public uint? ActionStatus { get; init; }
    public uint? ResourceStatus { get; init; }
    public int? AdjustedCastTimeMs { get; init; }
    public float? AnimationLockSeconds { get; init; }
    public bool? ActionQueued { get; init; }
    public bool? SceneSafe { get; init; }
}
