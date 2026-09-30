// 这个文件是干嘛的：在框架线程读取明确技能、当前明确目标及原生可用条件；不输出、不自动选目标或改动作。
using System;
using Dalamud.Game.ClientState.Conditions;
using Dalamud.Plugin.Services;
using FFXIVClientStructs.FFXIV.Client.Game;
using Lumina.Excel.Sheets;
using ActionRow = Lumina.Excel.Sheets.Action;
using NativeGameObject = FFXIVClientStructs.FFXIV.Client.Game.Object.GameObject;

namespace ChoreoHelper;

internal static unsafe class X1NativeAbilityReader
{
    // 仅由 X1GameAbilityAdapters 的框架线程门后调用。读取失败保留已经观察到的拒绝，其余为未知。
    public static X1NativeAbilityObservation Read(IDataManager data, IObjectTable objects,
        IClientState client, ITargetManager targets, ICondition? conditions, int actionId, string explicitTarget)
    {
        var result = new X1NativeAbilityObservation
            { ActionRowId = actionId, TargetId = explicitTarget, ObservedAtMs = Environment.TickCount64 };
        try
        {
            var player = objects.LocalPlayer;
            if (player == null || !player.IsValid()) return result;
            var sourceId = player.GameObjectId;
            var sourceAddress = player.Address;
            var territory = client.TerritoryType;
            var acceptsSelf = false;
            var acceptsOthers = false;
            result = result with { PlayerLevel = player.Level, SourceActorId = sourceId, TerritoryId = territory };
            try
            {
                var sheet = data.GetExcelSheet<ActionRow>();
                if (sheet == null || actionId <= 0) return result;
                var action = sheet.GetRow((uint)actionId);
                acceptsSelf = action.CanTargetSelf;
                acceptsOthers = action.CanTargetParty || action.CanTargetAlliance || action.CanTargetHostile
                    || action.CanTargetAlly || action.CanTargetOwnPet || action.CanTargetPartyPet;
                var jobEnglishName = player.ClassJob.Value.NameEnglish.ToString();
                result = result with { PlayerAction = action.IsPlayerAction, PvpAction = action.IsPvP,
                    AreaTargeted = action.TargetArea, ChangesPosition = action.AffectsPosition,
                    ActionRequiredLevel = action.ClassJobLevel,
                    PlayerJobId = player.ClassJob.RowId, PlayerJobName = player.ClassJob.Value.Name.ToString(),
                    PlayerJobEnglishName = jobEnglishName,
                    JobAllowed = JobAllowed(action.ClassJobCategory.Value, jobEnglishName) };
            }
            catch { return result; }

            try
            {
                result = result with { SceneSafe = conditions == null ? null : !client.IsPvP
                    && !player.IsDead && player.CurrentHp > 0 && !player.IsCasting
                    && !(conditions[ConditionFlag.InCombat] || conditions[ConditionFlag.BoundByDuty]
                        || conditions[ConditionFlag.WatchingCutscene] || conditions[ConditionFlag.OccupiedInCutSceneEvent]
                        || conditions[ConditionFlag.BetweenAreas] || conditions[ConditionFlag.BetweenAreas51]
                        || conditions[ConditionFlag.Mounted] || conditions[ConditionFlag.RidingPillion]
                        || conditions[ConditionFlag.InFlight] || conditions[ConditionFlag.Swimming]
                        || conditions[ConditionFlag.Jumping] || conditions[ConditionFlag.OccupiedInEvent]) };
            }
            catch { /* 未知不是场景安全。 */ }

            // 当前目标必须仍为用户输入的同一 id；不用对象表中的其它可用对象替换它。
            var target = targets.Target;
            var matches = X1AbilityWriteBoundary.TryParseTargetId(explicitTarget, out var targetId)
                && targetId != 0 && target != null && target.IsValid() && target.GameObjectId == targetId;
            result = result with { ExplicitTargetMatches = matches };
            if (!matches || target == null || player.Address == 0 || target.Address == 0) return result;

            var manager = ActionManager.Instance();
            if (manager == null) return result;
            var id = (uint)actionId;
            // 原生可能把自用技能内部归到本人；显式目标不是本人时，禁止借这种归一替换目标。
            var declaredTargetCategory = targetId == sourceId ? acceptsSelf : acceptsOthers;
            // 原生只读状态使用请求中的原行 id；recast/casting 检查明确开启，不调用 adjusted-id、UseAction 或 ResolveTarget。
            result = result with { ActionStatus = manager->GetActionStatus(ActionType.Action, id, targetId,
                    checkRecastActive: true, checkCastingActive: true),
                ResourceStatus = manager->CheckActionResources(ActionType.Action, id),
                CanUseOnTarget = declaredTargetCategory && ActionManager.CanUseActionOnTarget(id, (NativeGameObject*)target.Address),
                RangeOrLineOfSightStatus = ActionManager.GetActionInRangeOrLoS(id,
                    (NativeGameObject*)player.Address, (NativeGameObject*)target.Address),
                AdjustedCastTimeMs = ActionManager.GetAdjustedCastTime(ActionType.Action, id, applyProcs: true),
                AnimationLockSeconds = manager->AnimationLock, ActionQueued = manager->ActionQueued };

            // 可重入服务/原生读取之后再次核对同一实体，不接受角色、区域或目标切换产生的混合快照。
            var currentPlayer = objects.LocalPlayer;
            var currentTarget = targets.Target;
            if (currentPlayer == null || !currentPlayer.IsValid() || currentPlayer.GameObjectId != sourceId
                || currentPlayer.Address != sourceAddress || client.TerritoryType != territory
                || currentPlayer.ClassJob.RowId != result.PlayerJobId || currentPlayer.Level != result.PlayerLevel)
                result = result with { SceneSafe = false };
            if (currentTarget == null || !currentTarget.IsValid() || currentTarget.GameObjectId != targetId
                || currentTarget.Address != target.Address)
                result = result with { ExplicitTargetMatches = false };
        }
        catch { result = result with { SceneSafe = result.SceneSafe == false ? false : null }; }
        return result;
    }

    // 使用本机 ClassJob.NameEnglish 读取本机类别列；不依赖国服的本地化名称/缩写，也不猜数字行号。
    private static bool? JobAllowed(ClassJobCategory category, string job) => job.Trim().ToLowerInvariant() switch
    {
        "gladiator" => category.GLA, "pugilist" => category.PGL, "marauder" => category.MRD,
        "lancer" => category.LNC, "archer" => category.ARC, "conjurer" => category.CNJ, "thaumaturge" => category.THM,
        "carpenter" => category.CRP, "blacksmith" => category.BSM, "armorer" => category.ARM, "goldsmith" => category.GSM,
        "leatherworker" => category.LTW, "weaver" => category.WVR, "alchemist" => category.ALC, "culinarian" => category.CUL,
        "miner" => category.MIN, "botanist" => category.BTN, "fisher" => category.FSH,
        "paladin" => category.PLD, "monk" => category.MNK, "warrior" => category.WAR, "dragoon" => category.DRG,
        "bard" => category.BRD, "white mage" => category.WHM, "black mage" => category.BLM, "arcanist" => category.ACN,
        "summoner" => category.SMN, "scholar" => category.SCH, "rogue" => category.ROG, "ninja" => category.NIN,
        "machinist" => category.MCH, "dark knight" => category.DRK, "astrologian" => category.AST, "samurai" => category.SAM,
        "red mage" => category.RDM, "blue mage" => category.BLU, "gunbreaker" => category.GNB, "dancer" => category.DNC,
        "reaper" => category.RPR, "sage" => category.SGE, "viper" => category.VPR, "pictomancer" => category.PCT,
        _ => null,
    };
}
