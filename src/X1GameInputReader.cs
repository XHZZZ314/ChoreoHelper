// 这个文件是干嘛的：框架线程只读当前游戏键位、角色状态和输入焦点；未知就拒绝，不修改游戏配置。
using System;
using Dalamud.Game.ClientState.Conditions;
using Dalamud.Game.Config;
using Dalamud.Plugin.Services;
using FFXIVClientStructs.FFXIV.Client.System.Input;
using FFXIVClientStructs.FFXIV.Client.UI;

namespace ChoreoHelper;


public static unsafe class X1GameInputReader
{
    private static readonly InputId[] BindingIds = { InputId.MOVE_FORE, InputId.MOVE_BACK,
        InputId.MOVE_STRIFE_L, InputId.MOVE_STRIFE_R, InputId.MOVE_LEFT, InputId.MOVE_RIGHT };

    public static X1GameInputSnapshot Read(IObjectTable objects, IClientState client, ICondition conditions, IGameConfig config)
    {
        var player = objects.LocalPlayer;
        if (player == null || !player.IsValid()) throw new InvalidOperationException("本地角色不可用");
        var input = UIInputData.Instance(); var ui = UIModule.Instance();
        if (input == null || ui == null || ui->GetRaptureAtkModule() == null)
            throw new InvalidOperationException("游戏输入模块不可读");
        var keys = new byte[6];
        var descriptions = new string[6];
        for (var i = 0; i < BindingIds.Length; i++)
        {
            var binding = input->GetKeybind(BindingIds[i]);
            if (binding == null) throw new InvalidOperationException("游戏移动／转向键位缺失");
            descriptions[i] = X1InputPreparation.Label((X1Control)i) + "="
                + binding->KeySettings[0].KeyModifier + "+" + binding->KeySettings[0].Key
                + "/" + binding->KeySettings[1].KeyModifier + "+" + binding->KeySettings[1].Key;
            for (var j = 0; j < 2; j++)
            {
                var key = binding->KeySettings[j];
                if (key.KeyModifier == KeyModifierFlag.None && X1KeyBindings.IsSupportedKey((byte)key.Key))
                { keys[i] = (byte)key.Key; break; }
            }
        }
        X1KeyBindings bindings;
        try { bindings = new X1KeyBindings(keys); }
        catch (ArgumentException) { throw new InvalidOperationException("实际键位尚不支持（前后移动及左右转向需要不同的无修饰单键）：" + string.Join("，", descriptions)); }
        var p = player.Position;
        var pose = new X1CalibrationPose(Environment.TickCount64, player.GameObjectId, client.TerritoryType,
            p.X, p.Y, p.Z, player.Rotation);
        if (!pose.IsFinite) throw new InvalidOperationException("角色位置不可用");
        var text = ui->GetRaptureAtkModule()->IsTextInputActive();
        var pad = HasGamepad(input->GamepadInputs) || HasGamepad(input->GamepadInputs2);
        // 当前控制模式只读诊断；不可读保留未知，移动准入由准备链单独判断，不影响纯技能或观察。
        uint? movementMode = null;
        try { if (config.TryGet(UiControlOption.MoveMode, out uint rawMode)) movementMode = rawMode; }
        catch { /* 配置服务暂不可读时保留 null，不猜默认模式。 */ }
        var unsafeCondition = client.IsPvP || player.IsDead || player.IsCasting
            || conditions[ConditionFlag.InCombat] || conditions[ConditionFlag.BoundByDuty]
            || conditions[ConditionFlag.WatchingCutscene] || conditions[ConditionFlag.OccupiedInCutSceneEvent]
            || conditions[ConditionFlag.BetweenAreas] || conditions[ConditionFlag.BetweenAreas51]
            || conditions[ConditionFlag.Mounted] || conditions[ConditionFlag.RidingPillion]
            || conditions[ConditionFlag.InFlight] || conditions[ConditionFlag.Swimming]
            || conditions[ConditionFlag.Jumping] || conditions[ConditionFlag.OccupiedInEvent];
        return new X1GameInputSnapshot(bindings, pose, text, !text && !pad && !unsafeCondition,
            text ? "请先退出聊天或文字输入" : pad ? "检测到手柄输入，当前输入校准只支持键鼠" : unsafeCondition ? "当前角色条件不允许输入校准" : "", movementMode,
            X1MovementReferenceReader.Read(), pad);
    }
    private static bool HasGamepad(GamepadInputData pad) => pad.Buttons != 0 || pad.LeftStickX != 0
        || pad.LeftStickY != 0 || pad.RightStickX != 0 || pad.RightStickY != 0;
}
