// 这个文件是干嘛的：X1 技能纯执行器——显式条件逐项 fail-closed，成功仅提交供给动作一次，无寻敌/替换/重试。
using System;

namespace ChoreoHelper;

public static class X1AbilityExecutor
{
    public const string SkipFailureClass = "ability-condition";

    /// <summary>执行一次到期技能，返回实际分支的typed失败类与未知/不满足标记。
    /// 任一条件为 false 或未知（null）即零提交失败（ConditionUnsatisfied，唯一可跳过类，
    /// marking 在同一扫描内取首个未满足项的值，不二次复扫）；校验/缺条件/缺槽/缺目标/
    /// 槽拒绝/槽异常为对应不可跳过类。跳过决策由调用方（X1ShowDispatcher）按声明策略判定。</summary>
    public static (bool Ok, string Error, X1AbilityFailure Failure, string Marking) TryExecute(
        X1AbilityInput input,
        X1AbilityConditions cond,
        string currentTarget,
        IX1AbilitySink sink)
    {
        var (vok, verr) = X1InputValidation.ValidateAbility(input);
        if (!vok) return (false, verr, X1AbilityFailure.InputInvalid, "");
        if (cond == null) return (false, "技能事件「" + input.EventId + "」缺少条件观测：条件未知时拒绝执行", X1AbilityFailure.MissingCondition, "");
        if (sink == null) return (false, "技能事件「" + input.EventId + "」缺少记录槽：无槽时拒绝执行", X1AbilityFailure.MissingSink, "");
        string Fail(string cause) => "技能事件「" + input.EventId + "」前置条件不满足：" + cause;
        if (cond.JobMatches != true)
            return (false, Fail(cond.JobMatches == null ? "职业未知" : "职业不匹配"), X1AbilityFailure.ConditionUnsatisfied, cond.JobMatches == null ? "未知" : "不满足");
        if (cond.LevelMeets != true)
            return (false, Fail(cond.LevelMeets == null ? "等级未知" : "等级不足"), X1AbilityFailure.ConditionUnsatisfied, cond.LevelMeets == null ? "未知" : "不满足");
        if (cond.TargetValid != true)
            return (false, Fail(cond.TargetValid == null ? "目标未知" : "目标无效"), X1AbilityFailure.ConditionUnsatisfied, cond.TargetValid == null ? "未知" : "不满足");
        if (cond.NotCasting != true)
            return (false, Fail(cond.NotCasting == null ? "咏唱状态未知" : "正在咏唱"), X1AbilityFailure.ConditionUnsatisfied, cond.NotCasting == null ? "未知" : "不满足");
        if (cond.CooldownReady != true)
            return (false, Fail(cond.CooldownReady == null ? "冷却未知" : "冷却未就绪"), X1AbilityFailure.ConditionUnsatisfied, cond.CooldownReady == null ? "未知" : "不满足");
        if (cond.MovementAllowed != true)
            return (false, Fail(cond.MovementAllowed == null ? "移动状态未知" : "移动中不可执行"), X1AbilityFailure.ConditionUnsatisfied, cond.MovementAllowed == null ? "未知" : "不满足");
        if (cond.Controllable != true)
            return (false, Fail(cond.Controllable == null ? "可控性未知" : "角色不可控"), X1AbilityFailure.ConditionUnsatisfied, cond.Controllable == null ? "未知" : "不满足");
        if (string.IsNullOrWhiteSpace(currentTarget))
            return (false, "技能事件「" + input.EventId + "」缺少显式目标：不做目标搜索", X1AbilityFailure.MissingTarget, "");
        try
        {
            var ok = sink.Submit(input.ActionId, currentTarget);
            if (!ok) return (false, "技能事件「" + input.EventId + "」记录槽拒绝提交", X1AbilityFailure.SinkRejected, "");
            return (true, "", X1AbilityFailure.None, "");
        }
        catch (Exception ex)
        {
            return (false, "技能事件「" + input.EventId + "」记录槽异常：" + ex.Message, X1AbilityFailure.SinkException, "");
        }
    }
}
