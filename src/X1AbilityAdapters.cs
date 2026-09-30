// 这个文件是干嘛的：X1 技能游戏侧适配器（Dalamud 绑定层，不进 datalayertest）——显式动作行 id+
// 显式目标 GameObjectId 的技能提交护栏接线（X1AbilityWriteBoundary 共享控制路径 + GameCommandExecutor
// 同步边界入口）与七条件实时观测供给工厂。r3：提交=调用线程上同步原生写入（不入队/不重试，
// 200ms 节流基准与遗留队列共享）；stop/fault/unload/replay 经运行代见证失效旧代，写入前最后复核。
// 休眠接线：准入关闭期间零 X1 事件，本层零调用；能力使能、校准与部署另行主人授权。
// 目标标识绝不进入命令文本（无注入面）；绝不搜索/替换目标；绝不写坐标。
// 提交成功≠游戏已接受/已生效，CN 实机未验证（DESIGN-game-executor.md §6 七条件源表与阻塞清单）。
using System;
using Dalamud.Plugin.Services;
using Dalamud.Game.ClientState.Conditions;
using Lumina.Excel.Sheets;
using Action = Lumina.Excel.Sheets.Action;

namespace ChoreoHelper;

/// <summary>技能槽适配器：X1 显式提交 → 共享写入边界（X1AbilityWriteBoundary：规范十进制身份
/// + 运行代见证 + 同步恰一次写）→ GameCommandExecutor.SubmitX1Synchronous。框架线程 stamp 门 +
/// PvP fail-closed + 目标 GameObjectId 一致复核；CN 客户端实际生效未验证。
/// 运行代见证：停止/故障/卸载/重演经 X1ShowDispatcher 生命周期钩子失效旧代。</summary>
public sealed class X1GameAbilityAdapters : IX1AbilitySink, IX1AbilityGenerationGuard
{
    private readonly GameCommandExecutor _commands;
    private readonly IDataManager _data;
    private readonly X1AbilityWriteBoundary _boundary;
    private int _frameworkThreadId; // 框架线程 stamp（OnFrameworkUpdate 每帧刷新，先于 ShowRunner.Tick）

    public X1GameAbilityAdapters(GameCommandExecutor commands, IClientState clientState, ITargetManager targets, IDataManager data)
    {
        _commands = commands ?? throw new ArgumentNullException(nameof(commands));
        _data = data ?? throw new ArgumentNullException(nameof(data));
        _boundary = new X1AbilityWriteBoundary(
            pvpReader: () => clientState.IsPvP,
            currentTargetIdReader: () => ReadCurrentTargetId(targets),
            frameworkThreadGate: () => Environment.CurrentManagedThreadId == Volatile.Read(ref _frameworkThreadId),
            actionNameResolver: ResolveActionName,
            nativeWriter: cmd => _commands.SubmitX1Synchronous(cmd));
    }

    /// <summary>框架线程每帧 stamp（Plugin.OnFrameworkUpdate 调用；先于 ShowRunner.Tick）。
    /// 能力使能前的休眠期同样每帧 stamp（零成本，护栏基准始终新鲜）。</summary>
    public void MarkFrameworkThread() => Volatile.Write(ref _frameworkThreadId, Environment.CurrentManagedThreadId);
    // era-reconciliation ports (donor: recheck-02 X1AbilityAdapters.cs; CreateGameConditionProvider
    // routes via this file's own live-conditions provider — game-observed ability conditions path lost).
    public (bool Ok, string Error) RegisterLiveAbility(X1ShowDispatcher dispatcher,
        IObjectTable objects, ICondition? condition, X1AbilityInput input, string explicitTarget)
    {
        if (Environment.CurrentManagedThreadId != Volatile.Read(ref _frameworkThreadId))
            return (false, "ability registration must run on the game framework thread");
        var validation = X1InputValidation.ValidateAbility(input);
        if (!validation.Ok) return validation;
        if (!X1AbilityWriteBoundary.TryParseActionRowId(input.ActionId, out var actionRowId)
            || actionRowId <= 0 || ResolveActionName(actionRowId) == null)
            return (false, "ability registration lacks a usable action row identity");
        if (!X1AbilityWriteBoundary.TryParseTargetId(explicitTarget, out var targetId) || targetId == 0)
            return (false, "ability registration lacks an explicit valid target identity");
        if (string.IsNullOrWhiteSpace(input.RequiredJob) && string.IsNullOrWhiteSpace(input.RequiredJobId))
            return (false, "ability registration lacks an explicit job requirement");
        return dispatcher.AddAbilityLive(input,
            CreateGameConditionProvider(objects, condition, input, explicitTarget), explicitTarget);
    }
    public Func<X1AbilityConditions?> CreateGameConditionProvider(
        IObjectTable objects, ICondition? condition, X1AbilityInput input, string explicitTarget)
        => CreateLiveConditionProvider(objects, condition, input, explicitTarget);


    /// <summary>IX1AbilitySink：共享护栏全过才恰一次同步写入；护栏拒绝=false（SinkRejected），
    /// 写入异常原样上抛（SinkException）——冻结映射由 X1AbilityExecutor 承担。</summary>
    public bool Submit(string actionId, string target)
        => _boundary.TrySubmit(actionId, target);

    /// <summary>IX1AbilityGenerationGuard：停止/故障/卸载/重演使旧代在途提交全部失效
    ///（X1ShowDispatcher.OnStop/OnShowStart 调用）。</summary>
    public void InvalidateGeneration() => _boundary.InvalidateGeneration();

    /// <summary>七条件实时观测供给工厂（每事件一闭包；分发到期恰读一次）。逐条件源与转换规则
    /// 见 DESIGN-game-executor.md §6 七条件源表。本地角色缺失/无效返回 null（不可跳过失败，
    /// 绝不编造条件对象）；冷却与移动限制本包无充分观测源，恒为未知（fail-closed——
    /// 即使未来准入打开，生产 live 技能也先被未知条件挡在零提交）。</summary>
    public static Func<X1AbilityConditions?> CreateLiveConditionProvider(
        IObjectTable objects, ICondition? condition, X1AbilityInput input, string explicitTarget)
    {
        return () =>
        {
            var player = objects.LocalPlayer;
            if (player == null || !player.IsValid()) return null;
            bool? job;
            try
            {
                // 职业：ClassJob 名称精确比（CN 客户端为中文名；空白归一后 Ordinal）。
                // 行无效时这里会抛，由 catch 归为未知（fail-closed，绝不编造）。
                var jobName = player.ClassJob.Value.Name.ToString();
                job = string.IsNullOrWhiteSpace(jobName) || string.IsNullOrWhiteSpace(input.RequiredJob)
                    ? null
                    : string.Equals(jobName.Trim(), input.RequiredJob.Trim(), StringComparison.Ordinal);
            }
            catch { job = null; }
            bool? level;
            try
            {
                // 等级：Level 整数比（玩家在场即有值，不产未知）。
                level = player.Level >= input.RequiredLevel;
            }
            catch { level = null; }
            bool? targetValid;
            try
            {
                // 目标有效：显式目标标识（GameObjectId 规范十进制）的对象表精确 id 命中
                //（验证性查找，绝不候选选择；畸形 id 直接无效，绝不解析替身）。
                if (string.IsNullOrWhiteSpace(explicitTarget)
                    || !X1AbilityWriteBoundary.TryParseTargetId(explicitTarget, out var wantedId))
                {
                    targetValid = false;
                }
                else
                {
                    targetValid = false;
                    foreach (var obj in objects)
                    {
                        try
                        {
                            if (obj != null && obj.IsValid() && obj.GameObjectId == wantedId)
                            {
                                targetValid = true;
                                break;
                            }
                        }
                        catch { }
                    }
                }
            }
            catch { targetValid = null; }
            bool? notCasting;
            try
            {
                // 咏唱：Condition Casting 位（服务缺失=未知）。
                notCasting = condition == null ? null : !condition[ConditionFlag.Casting];
            }
            catch { notCasting = null; }
            // 冷却：本包无观测源（ActionManager/冷却表未接入）——恒未知。
            bool? cooldownReady = null;
            // 移动限制：本包无充分观测源（个别 Condition 位不能证明全部移动锁不存在）——恒未知。
            bool? movementAllowed = null;
            bool? controllable;
            try
            {
                // 可控性：非过场/非区域切换且存活（服务缺失=未知）。
                controllable = condition == null
                    ? null
                    : !(condition[ConditionFlag.OccupiedInCutSceneEvent]
                        || condition[ConditionFlag.BetweenAreas]
                        || condition[ConditionFlag.BetweenAreas51])
                      && player.CurrentHp > 0;
            }
            catch { controllable = null; }
            return new X1AbilityConditions
            {
                JobMatches = job,
                LevelMeets = level,
                TargetValid = targetValid,
                NotCasting = notCasting,
                CooldownReady = cooldownReady,
                MovementAllowed = movementAllowed,
                Controllable = controllable,
            };
        };
    }

    /// <summary>当前游戏目标稳定标识读取（护栏目标一致复核用）：无目标/无效/读取失败返回 null
    ///（护栏零写拒绝，绝不编造）。身份 = IGameObject.GameObjectId（ulong，installed Dalamud 实测），
    /// 绝不用显示名充当身份。</summary>
    private static ulong? ReadCurrentTargetId(ITargetManager targets)
    {
        try
        {
            var t = targets.Target;
            if (t == null || !t.IsValid()) return null;
            return t.GameObjectId;
        }
        catch
        {
            return null;
        }
    }

    /// <summary>显式请求的动作行解析（护栏可重入读取）：Action.RowId → 本地命令名。仅当行存在、
    /// 受支持且名字非空白才返回名字；缺失/异常/空名返回 null（零写拒绝，绝不搜索、绝不替换
    /// 请求动作）。表按行 id 键控，恰一行命中；读取口径与生产 GetActionsJson 一致。</summary>
    private string? ResolveActionName(int rowId)
    {
        try
        {
            var sheet = _data.GetExcelSheet<Action>();
            if (sheet == null) return null;
            var row = sheet.GetRow((uint)rowId);
            var name = row.Name.ToString();
            return string.IsNullOrWhiteSpace(name) ? null : name;
        }
        catch
        {
            return null;
        }
    }
}
