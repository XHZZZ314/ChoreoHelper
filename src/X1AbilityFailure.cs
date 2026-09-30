// 这个文件是干嘛的：演出/输入链丢失的配套类型声明（捐赠原文提取）。
// 捐赠源：C:\choreohelper-recovery\_merge\src\X1ExecutionInputs.cs.lf（当前 X1ExecutionInputs.cs 精简后丢失这两个枚举）。
using System;

namespace ChoreoHelper;

/// <summary>技能执行失败类：由执行器实际校验/条件/槽分支判定（非错误文本推断）。
/// 仅 ConditionUnsatisfied（七条件 false/未知）在 Skip 策略下可跳过；其余一律故障停。</summary>
public enum X1AbilityFailure
{
    None = 0,
    InputInvalid = 1,
    MissingCondition = 2,
    MissingSink = 3,
    MissingTarget = 4,
    ConditionUnsatisfied = 5,
    SinkRejected = 6,
    SinkException = 7,
}

/// <summary>移动更新失败类：由执行器实际观测/槽/容差分支判定（非几何复推）。
/// 仅 ToleranceExceeded（终点容差超限）在 Skip 策略下可跳过；其余（含释放槽异常）一律故障停。</summary>
public enum X1MovementFailure
{
    None = 0,
    MissingSink = 1,
    NonFiniteObservation = 2,
    SinkException = 3,
    ToleranceExceeded = 4,
}
