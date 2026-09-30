// 姿态采样器（ARCH2 姿态生命周期拆分，TASK-20260901-ARCH2-POSE-LIFECYCLE）：
// 本地角色/槽位/表情状态的只读探针 + 主控制槽读写原语，方法体自 AnimationPoseFreezer
// 原样迁移（含 try/catch 与日志文案）。FIX-E 契约：本类碰游戏对象，只允许在框架线程
// 上被调用（由 AnimationPoseFreezer 的 RunOnGameThread/RunOnFrameworkThread 调度保证）。
// 返回值只带出 string/基本类型，Character* 指针绝不越出 unsafe 组件边界。
using System;
using Dalamud.Plugin.Services;
using FFXIVClientStructs.FFXIV.Client.Game.Character;
using FFXIVClientStructs.FFXIV.Client.Graphics.Scene;

namespace ChoreoHelper;

/// <summary>姿态采样：游戏对象只读探针与主控制槽访问（SimpleHeels 同款路径）。</summary>
internal sealed unsafe class PoseSampler
{
    private readonly IPluginLog _log;
    private readonly IObjectTable _objectTable;

    public PoseSampler(IPluginLog log, IObjectTable objectTable)
    {
        _log = log;
        _objectTable = objectTable;
    }

    public bool TryGetLocalCharacter(out Character* chara)
    {
        chara = null;
        try
        {
            var local = _objectTable[0];
            if (local == null) return false;
            chara = (Character*)local.Address;
            return true;
        }
        catch { return false; }
    }

    /// <summary>读取槽0当前播放的时间轴 id（确定性挂载验证）。</summary>
    public ushort CurrentSlot0Timeline()
    {
        if (!TryGetLocalCharacter(out var chara)) return 0;
        try { return chara->Timeline.TimelineSequencer.GetSlotTimeline(0); }
        catch { return 0; }
    }

    /// <summary>表情状态机当前播放的表情行ID（0=无）—— 残留场景确认"槽上就是目标动画"。</summary>
    public uint CurrentEmoteId()
    {
        if (!TryGetLocalCharacter(out var chara)) return 0;
        try { return chara->EmoteController.EmoteId; }
        catch { return 0; }
    }

    /// <summary>表情状态机是否确认正在播表情（EmoteId != 0）—— 学习变体 id 时排除中间态。</summary>
    public bool IsEmoting()
    {
        if (!TryGetLocalCharacter(out var chara)) return false;
        try { return chara->EmoteController.IsEmoting(); }
        catch { return false; }
    }

    /// <summary>
    /// 游戏自己的变体行解析（ResolveTargetedEmoteId）：聊天命令在游戏内部也这么做。
    /// 0 = 无角色/未解析（调用方各自的 try/catch 语义不变，异常不在本层吞）。
    /// </summary>
    public ushort ResolveTargetedEmote(ushort emoteId)
    {
        if (!TryGetLocalCharacter(out var chara)) return 0;
        var r = chara->ResolveTargetedEmoteId(emoteId, null);
        return r;
    }

    /// <summary>调试读数：基础槽覆盖 id（无角色回 0；异常由调用方统一兜）。</summary>
    public ushort ReadBaseOverride()
        => TryGetLocalCharacter(out var chara) ? chara->Timeline.BaseOverride : (ushort)0;

    /// <summary>调试读数：角色模式（无角色回 0；异常由调用方统一兜）。</summary>
    public int ReadCharMode()
        => TryGetLocalCharacter(out var chara) ? (int)chara->Mode : 0;

    /// <summary>
    /// 访问主控制槽（SimpleHeels 同款路径：PartialSkeletons[0]->GetHavokAnimatedSkeleton(0)->AnimationControls[0]）。
    /// write=false 只读绑定动画真实时长与当前 LocalTime；write=true 写入 LocalTime（钳制在真实时长内）。
    /// 只读写主槽：把动作的目标时间写进其他槽会让它们跳帧（抽搐）；速度冻结走 PoseApplicator。
    /// </summary>
    public (bool Ok, float Duration, long Binding, float LocalTime) AccessMainControl(float time, bool write)
    {
        try
        {
            var local = _objectTable[0];
            if (local == null) return (false, -1, 0, -1);
            var character = (Character*)local.Address;
            if (character->DrawObject == null) return (false, -1, 0, -1);
            if (character->DrawObject->GetObjectType() != ObjectType.CharacterBase) return (false, -1, 0, -1);
            var cb = (CharacterBase*)character->DrawObject;
            if (cb->GetModelType() != CharacterBase.ModelType.Human) return (false, -1, 0, -1);
            var human = (Human*)character->DrawObject;

            var skeleton = human->Skeleton;
            if (skeleton == null) return (false, -1, 0, -1);
            for (var i = 0; i < skeleton->PartialSkeletonCount && i < 1; ++i)
            {
                var partialSkeleton = &skeleton->PartialSkeletons[i];
                var animatedSkeleton = partialSkeleton->GetHavokAnimatedSkeleton(0);
                if (animatedSkeleton == null) continue;

                var controls = animatedSkeleton->AnimationControls;
                if (controls.Length == 0) continue;
                var control = controls[0].Value;
                if (control == null)
                {
                    // 槽 0 为空时兜底找第一个非空槽（动画可能还没完全挂载）
                    for (var c = 1; c < controls.Length; ++c)
                    {
                        if (controls[c].Value != null) { control = controls[c].Value; break; }
                    }
                }
                if (control == null) continue;

                var duration = -1f;
                long binding = 0;
                if (control->Binding.ptr != null)
                {
                    binding = (long)control->Binding.ptr;
                    if (control->Binding.ptr->Animation.ptr != null)
                        duration = control->Binding.ptr->Animation.ptr->Duration;
                }

                if (write)
                {
                    // 钳制：写入超过动画真实时长会被游戏判定"播完"→ 结束动作回待机
                    var t = time;
                    if (duration > 0.05f) t = Math.Min(t, duration);
                    control->hkaAnimationControl.LocalTime = t;
                }
                return (true, duration, binding, control->hkaAnimationControl.LocalTime);
            }
        }
        catch (Exception ex)
        {
            _log.Error(ex, "AccessMainControl failed");
        }
        return (false, -1, 0, -1);
    }
}
