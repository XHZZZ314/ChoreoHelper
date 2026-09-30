// 这个文件是干嘛的：EXEC-CORE 的游戏适配器（Dalamud 绑定层，不进 datalayertest）。
// 把 IShowDispatcher 抽象落到现有实战验证过的执行通道：动作事件 = 解堵表情通道 + 命令队列
// （GameCommandExecutor：安全策略闸/200ms 节流/5s 过期/64 条上限都由它负责，这里不重复）；
// 歌词事件 = 空命令本地跳过（网页显示用）、带命令走同一命令闸；提示事件 = 本地日志。
// 停演清扫与 PlaybackManager 收尾同口径（清命令队列 + 退定格）。AnimationPoseFreezer 只是
// 被调用的适配件，绝不是演出编排者（backlog §10 边界）。
// 守卫快照只在框架线程上采集（ShowRunner.Tick 只在框架线程跑）：IClientState.LocalPlayer
// 判角色在场、TerritoryType 基线判换图、ICondition 判战斗/过场/加载。手动接管与移动误差的
// 采集通道（输入钩子/移动执行器）尚未实装，快照如实置 false——不在适配器里编造检测。
// 执行证据链 P1（TASK-20260916-EXEC-EVIDENCE-P1-MOTION）：本文件兼证据观察适配器（表情
// id/槽0时间轴 id 读数 + Emote 表预期映射，Dalamud 绑定不进 datalayertest）；纯逻辑在
// MotionEvidenceBoard。证据只记录，不改任何执行判定。
using System;
using Dalamud.Plugin.Services;
using Dalamud.Game.ClientState.Conditions;

namespace ChoreoHelper;

public sealed class GameShowDispatcher : IShowDispatcher
{
    private readonly GameCommandExecutor _executor;
    private readonly AnimationPoseFreezer _freezer;
    private readonly IClientState _clientState;
    private readonly IObjectTable _objectTable;
    private readonly ICondition? _condition;
    private readonly IPluginLog _log;
    private uint? _territoryBaseline; // 本场倒计时首帧采集；null = 待采集。停演清扫时作废

    public GameShowDispatcher(GameCommandExecutor executor, AnimationPoseFreezer freezer,
        IClientState clientState, IObjectTable objectTable, ICondition? condition, IPluginLog log)
    {
        _executor = executor;
        _freezer = freezer;
        _clientState = clientState;
        _objectTable = objectTable;
        _condition = condition;
        _log = log;
    }

    public ShowDispatchResult Dispatch(ShowEvent e)
    {
        switch (e.Kind)
        {
            case "motion":
                // 与 PlaybackManager.ExecuteClip 同序：先解堵（僵尸绑定时命令会被去重拒收）
                _freezer.PrepareForPlaybackCommand();
                _executor.ExecuteCommand(e.Command);
                _log.Information("Show: dispatch motion {id} at {t}ms: {cmd}", e.Id, e.StartMs, e.Command);
                return ShowDispatchResult.Success();

            case "lyrics":
                if (string.IsNullOrEmpty(e.Command))
                    return ShowDispatchResult.Success(); // 无命令歌词：网页本地显示用，游戏内无事可做
                _executor.ExecuteCommand(e.Command);
                return ShowDispatchResult.Success();

            case "cue":
                // 提示/倒计时事件：本地可见性提示，后续增量接 UI；当前只记日志
                _log.Information("Show: cue {id} at {t}ms", e.Id, e.StartMs);
                return ShowDispatchResult.Success();

            default:
                // ShowValidator 已拒绝不支持的类型；这里是防御性兜底
                return ShowDispatchResult.Fail("事件类型「" + e.Kind + "」没有执行器");
        }
    }

    // era-reconciliation micro-add (UI IShowDispatcher.OnShowStart; mirrors the
    // OnStop territory-baseline reset so a new show re-baselines on its first frame).
    public void OnShowStart() => _territoryBaseline = null;

    public void OnStop()
    {
        // 幂等：清空残留命令防止停止后角色乱动 + 退出定格（与 PlaybackManager 停止收尾一致）
        _executor.Clear();
        // 领地基线一并作废：所有演出终态（完成/故障/急停/卸载）都必经 OnStop，下一场
        // 倒计时首帧重采——否则两场之间玩家换过图，过期基线会让之后每一场都在倒计时
        // 第一帧被 TerritoryChanged 打成 Faulted（2026-08-31 审计 P0：基线只在为 null 时采集、
        // 全仓无复位，一次换图永久毒化）。
        _territoryBaseline = null;
        try { _freezer.StopPreview(); } catch { }
        _log.Information("Show: stopped (commands cleared, preview released)");
    }

    /// <summary>守卫快照提供器。调用方（ShowRunner.Tick）保证在框架线程上执行；
    /// TerritoryType 基线在本场倒计时首帧采集（玩家已站定开演位），停演清扫（OnStop）
    /// 时作废，下一场重采——基线永不跨场复用。</summary>
    public Func<GuardSnapshot> CreateGuardProvider()
    {
        return () =>
        {
            var snap = new GuardSnapshot();
            // 本地角色在场：同 ActionPreviewer.GetLocalPlayerInfo 的 ObjectTable 口径
            var player = _objectTable.LocalPlayer;
            snap.CharacterPresent = player != null && player.IsValid();
            if (!snap.CharacterPresent)
            {
                snap.Detail = "LocalPlayer 为空";
                return snap;
            }
            var territory = _clientState.TerritoryType;
            if (_territoryBaseline == null) _territoryBaseline = territory;
            snap.TerritoryChanged = territory != _territoryBaseline.Value;
            if (_condition != null)
            {
                // 过场：本版本 Dalamud 的过场位是 WatchingCutscene（+ 过场事件占位）
                snap.InCutscene = _condition[ConditionFlag.WatchingCutscene]
                                  || _condition[ConditionFlag.OccupiedInCutSceneEvent];
                snap.InCombat = _condition[ConditionFlag.InCombat];
                snap.Uncontrollable = _condition[ConditionFlag.BetweenAreas]
                                      || _condition[ConditionFlag.BetweenAreas51];
            }
            return snap;
        };
    }
}
