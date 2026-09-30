// 这个文件是干嘛的：游戏 seek 的事件语义纯逻辑（FIX-B / AUD2-004）。
// 旧行为：SeekLocked 在扁平数组里取「覆盖当前时刻的最后一条事件」，不分类不分演员——
// 歌词会挤掉动作、switch 被当动画命令交给定格器、拖动可能重复执行一次性副作用。
// 本文件把「某时刻 seek 应该发生什么」收敛成纯函数：每位演员选出当前动作和前置职业
// 状态；歌词等一次性副作用永不参与 seek。正常播放路径不经过这里。
// 无 Dalamud 依赖，进 datalayertest（同 ChatCommandBuffer/MotionDetect 惯例）。
namespace ChoreoHelper;

using System;
using System.Collections.Generic;

/// <summary>时间轴事件（网页 buildGameClips 产出的条目）。actorId：舞者下标，
/// 全局歌词为 -1。保留演员维度，不给「全时间轴只有一个演员」留隐含假设。</summary>
public sealed class SeekEvent
{
    public int Id { get; set; }
    public int ActorId { get; set; }
    public float Start { get; set; }
    public float Duration { get; set; }
    public string Command { get; set; } = "";
    public string Type { get; set; } = "";
}

/// <summary>一位演员在 seek 时刻的计划：要定格的动作 + 需要确保的前置职业命令（可为空）。</summary>
public sealed class ActorSeekPlan
{
    public int ActorId { get; set; }
    public SeekEvent? Action { get; set; }
    public SeekEvent? PreSwitch { get; set; }
}

public sealed class SeekPlanResult
{
    public List<ActorSeekPlan> Actors { get; } = new();
    /// <summary>本地玩家要显示的那位演员：覆盖时刻的动作里 Start 最晚者（平手取 ActorId 大者）。
    /// 无任何动作时为 null（seek 空白区：应停止定格，不回放旧动作）。</summary>
    public ActorSeekPlan? Selected { get; set; }
}

public static class SeekPlanner
{
    // switch 条与动作条的前置关系窗口：planActionPlacement 的口径是 switch 占
    // [动作开始-0.5, 动作开始)。这里按「switch 结束落在动作开始前 0.5s 内（或稍后重叠）」识别前置。
    private const float PreSwitchWindow = 0.5f;

    /// <summary>给定时间轴事件与 seek 时刻，输出各演员计划与本地选择结果。
    /// 规则：action 是唯一可定格类型；switch 只解析成前置状态（同演员、结束于动作开始
    /// 前 0.5s 窗口内、取 Start 最晚的一条）；lyric/其他类型永不参与。</summary>
    public static SeekPlanResult Plan(IReadOnlyList<SeekEvent> events, float time)
    {
        var result = new SeekPlanResult();
        if (events == null) return result;

        // 每位演员独立挑选自己「覆盖当前时刻」的动作（同类间互不覆盖）
        var perActor = new Dictionary<int, SeekEvent>();
        foreach (var e in events)
        {
            if (e.Type != "action") continue;
            if (e.Start > time + 0.05f) continue;
            if (time >= e.Start + Math.Max(e.Duration, 0.5f)) continue;
            if (!perActor.TryGetValue(e.ActorId, out var cur) || e.Start >= cur.Start)
                perActor[e.ActorId] = e;
        }

        foreach (var kv in perActor)
        {
            var plan = new ActorSeekPlan { ActorId = kv.Key, Action = kv.Value };
            plan.PreSwitch = FindPreSwitch(events, kv.Key, kv.Value);
            result.Actors.Add(plan);
            if (result.Selected == null
                || plan.Action!.Start > result.Selected.Action!.Start
                || (plan.Action.Start == result.Selected.Action.Start && plan.ActorId > result.Selected.ActorId))
            {
                result.Selected = plan;
            }
        }
        result.Actors.Sort((a, b) => a.ActorId.CompareTo(b.ActorId));
        return result;
    }

    /// <summary>找某演员某动作的前置 switch：同演员、type=switch、结束时刻 ≥ 动作开始-0.5
    /// 且开始时刻 ≤ 动作开始+0.05，多条取 Start 最晚。找不到返回 null（不切职业）。</summary>
    private static SeekEvent? FindPreSwitch(IReadOnlyList<SeekEvent> events, int actorId, SeekEvent action)
    {
        SeekEvent? best = null;
        foreach (var e in events)
        {
            if (e.Type != "switch" || e.ActorId != actorId) continue;
            if (e.Start > action.Start + 0.05f) continue;
            var end = e.Start + e.Duration;
            if (end < action.Start - PreSwitchWindow) continue;
            if (best == null || e.Start > best.Start) best = e;
        }
        return best;
    }
}
