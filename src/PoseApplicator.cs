// 姿态应用器（ARCH2 姿态生命周期拆分，TASK-20260901-ARCH2-POSE-LIFECYCLE）：
// 钉住/解钉（Brio BaseOverride+AnimLock 架构）、三层停表（OverallSpeed+槽速度+控制槽
// PlaybackSpeed）、表情状态机解锁与直接表情通道，方法体自 AnimationPoseFreezer 原样迁移
// （含 try/catch 与日志文案）。FIX-E 契约：本类写游戏内存，只允许在框架线程上被调用；
// 钉住会话状态（原 _hasPin/_pinnedTimelineId 等）由本类持有，只经 bool/ushort 暴露。
using System;
using System.Collections.Generic;
using Dalamud.Plugin.Services;
using FFXIVClientStructs.FFXIV.Client.Game.Character;

namespace ChoreoHelper;

/// <summary>姿态应用：钉住会话与全部游戏内存写入原语。</summary>
internal sealed unsafe class PoseApplicator
{
    private readonly IPluginLog _log;
    private readonly IObjectTable _objectTable;
    private readonly PoseSampler _sampler;

    // ---- Brio 架构钉住（v0.5.18）：BaseOverride + AnimLock ----
    // 挂载确认后不再"陪跑"表情状态机，而是接管基础槽：游戏每帧把 BaseOverride 应用到
    // 基础槽（它自己的机制），表情结束计时器/待机/姿态切换都换不掉我们的时间轴 ——
    // 根治"黄金之舞播到一半失效"。AnimLock 模式 = 游戏施法/动作锁同款。
    private bool _hasPin;               // 钉住会话激活
    private CharacterModes _pinOrigMode; // 钉住前的 Mode/ModeParam/BaseOverride（Brio OriginalBaseAnimation 同款）
    private byte _pinOrigModeParam;
    private ushort _pinOrigBaseOverride;
    private ushort _pinnedTimelineId;   // 当前钉住的（已验证归属的）时间轴 id

    // era-reconciliation ports (donor: candidate-03 PoseApplicator.cs).
    private nint _pinActorAddress; // 原钉住角色的身份见证；失败时不得改成当前别的角色。
    private nint _speedActorAddress; // 原停表写入的角色；清理成功才清空。
    public bool HasPin => _hasPin;
    public ushort PinnedTimelineId => _pinnedTimelineId;

    public PoseApplicator(IPluginLog log, IObjectTable objectTable, PoseSampler sampler)
    {
        _log = log;
        _objectTable = objectTable;
        _sampler = sampler;
    }

    private void CommitUnpin()
    {
        _hasPin = false;
        _pinnedTimelineId = 0;
        _pinActorAddress = nint.Zero;
    }

    public bool HasPreviewWriteWitness => _hasPin || _speedActorAddress != nint.Zero;
    public void RestorePreviewOrThrow(IReadOnlyCollection<ushort> idleTimelines)
    {
        if (!HasPreviewWriteWitness) return;
        var failures = new List<Exception>();
        if (_hasPin)
            try { UnpinOrThrow(blendToIdle: true, idleTimelines); } catch (Exception ex) { failures.Add(ex); }
        if (_speedActorAddress != nint.Zero)
            try { RestoreControlSpeedsOrThrow(); } catch (Exception ex) { failures.Add(ex); }
        if (failures.Count != 0) throw new AggregateException("姿态解钉或恢复速度未确认", failures);
        CommitUnpin();
        _speedActorAddress = nint.Zero;
        _log.Information("Freeze cleanup native fields reread successfully");
    }
    private void RestoreControlSpeedsOrThrow()
    {
        var chara = RequireCleanupCharacter();
        var draw = chara->DrawObject;
        if (draw == null || draw->GetObjectType() != FFXIVClientStructs.FFXIV.Client.Graphics.Scene.ObjectType.CharacterBase)
            throw new InvalidOperationException("姿态清理时角色 DrawObject 不可用");
        var cb = (FFXIVClientStructs.FFXIV.Client.Graphics.Scene.CharacterBase*)draw;
        if (cb->GetModelType() != FFXIVClientStructs.FFXIV.Client.Graphics.Scene.CharacterBase.ModelType.Human)
            throw new InvalidOperationException("姿态清理时 Human 骨架不可用");
        var skeleton = ((FFXIVClientStructs.FFXIV.Client.Graphics.Scene.Human*)draw)->Skeleton;
        if (skeleton == null || skeleton->PartialSkeletonCount < 1)
            throw new InvalidOperationException("姿态清理时主骨架不可用");
        var animated = skeleton->PartialSkeletons[0].GetHavokAnimatedSkeleton(0);
        if (animated == null) throw new InvalidOperationException("姿态清理时动画骨架不可用");
        var controls = animated->AnimationControls;
        var count = 0;
        for (var i = 0; i < controls.Length; i++) if (controls[i].Value != null) count++;
        if (count == 0) throw new InvalidOperationException("姿态清理时没有可复核的动画控制器");

        chara->Timeline.OverallSpeed = 1f;
        for (uint slot = 0; slot < 14; slot++) chara->Timeline.TimelineSequencer.SetSlotSpeed(slot, 1f);
        for (var i = 0; i < controls.Length; i++)
            if (controls[i].Value != null) controls[i].Value->PlaybackSpeed = 1f;
        if (RequireCleanupCharacter() != chara || chara->DrawObject != draw)
            throw new InvalidOperationException("姿态清理期间角色或模型已改变");
        if (((FFXIVClientStructs.FFXIV.Client.Graphics.Scene.Human*)draw)->Skeleton != skeleton
            || skeleton->PartialSkeletonCount < 1 || skeleton->PartialSkeletons[0].GetHavokAnimatedSkeleton(0) != animated)
            throw new InvalidOperationException("姿态清理期间骨架已改变");
        var observedControls = animated->AnimationControls;
        if (observedControls.Length != controls.Length)
            throw new InvalidOperationException("姿态清理期间动画控制器数量已改变");
        if (chara->Timeline.OverallSpeed != 1f) throw new InvalidOperationException("整体动画速度恢复复读失败");
        for (uint slot = 0; slot < 14; slot++)
            if (chara->Timeline.TimelineSequencer.GetSlotSpeed(slot) != 1f)
                throw new InvalidOperationException("动画槽速度恢复复读失败");
        for (var i = 0; i < controls.Length; i++)
            if (observedControls[i].Value != controls[i].Value
                || (observedControls[i].Value != null && observedControls[i].Value->PlaybackSpeed != 1f))
                throw new InvalidOperationException("骨架控制器速度恢复复读失败");
    }
    private void UnpinOrThrow(bool blendToIdle, IReadOnlyCollection<ushort> idleTimelines)
    {
        if (!_hasPin) return;
        var chara = RequireCleanupCharacter();
        // 钉住常发生在舞蹈中段（Mode=EmoteLoop/InPositionLoop 时刻）—— 原样恢复会把
        // 循环姿态模式带回来，重新进入"ExecuteEmote 全被拒"的死锁。恢复目标消毒为 Normal。
        var restore = _pinOrigMode;
        if (restore == CharacterModes.EmoteLoop || restore == CharacterModes.InPositionLoop)
            restore = CharacterModes.Normal;
        // 必须走 SetMode 函数（v0.5.19 关键修复）：裸写 Mode 字段会绕过游戏的模式切换
        // 记账 —— 之后 ExecuteEmote/聊天表情全部被静默拒绝（实测：钉住→裸写恢复→
        // /bow 拒收 3 分钟，SetMode(Normal,0) 一调用立即恢复）
        chara->SetMode(restore, (restore == _pinOrigMode) ? _pinOrigModeParam : (byte)0);
        chara->Timeline.BaseOverride = _pinOrigBaseOverride;
        if (blendToIdle)
        {
            foreach (var idleId in idleTimelines)
            {
                chara->Timeline.PlayActionTimeline(idleId);
                break;
            }
        }
        if (RequireCleanupCharacter() != chara || chara->Mode != restore || chara->ModeParam != ((restore == _pinOrigMode) ? _pinOrigModeParam : (byte)0)
            || chara->Timeline.BaseOverride != _pinOrigBaseOverride)
            throw new InvalidOperationException("解钉后的模式或 BaseOverride 复读不一致");
    }
    private Character* RequireCleanupCharacter()
    {
        if (!_sampler.TryGetLocalCharacter(out var chara) || chara == null)
            throw new InvalidOperationException("姿态清理时本地角色不可读");
        if ((_hasPin && _pinActorAddress != (nint)chara)
            || (_speedActorAddress != nint.Zero && _speedActorAddress != (nint)chara))
            throw new InvalidOperationException("姿态清理角色已改变；不向新角色恢复旧见证");
        return chara;
    }

    /// <summary>
    /// 三层停表第 1、2 层：OverallSpeed（Brio 同款：游戏把整体速度应用到所有槽+粒子）
    /// + Sequencer.SetSlotSpeed（PlayActionTimeline 强制的动画走 Sequencer 速度管道，
    /// hka 控制器的 PlaybackSpeed 写入会被它覆盖 —— 必须用游戏自己的槽速度函数）
    /// + 主骨架全部控制槽 PlaybackSpeed。
    /// speed=1 恢复。
    /// </summary>
    public void SetAllControlSpeeds(float speed)
    {
        try
        {
            if (_sampler.TryGetLocalCharacter(out var chara))
            {
                chara->Timeline.OverallSpeed = speed;
                // 全部 14 个槽（SetSlotSpeed 内部有 slot<14 校验）：0=动作主槽，其余含待机/表情
                for (uint slot = 0; slot < 14; slot++)
                    chara->Timeline.TimelineSequencer.SetSlotSpeed(slot, speed);
            }
        }
        catch (Exception ex) { _log.Error(ex, "SetAllControlSpeeds: sequencer failed"); }

        try
        {
            var local = _objectTable[0];
            if (local == null) return;
            var character = (Character*)local.Address;
            if (character->DrawObject == null) return;
            if (character->DrawObject->GetObjectType() != FFXIVClientStructs.FFXIV.Client.Graphics.Scene.ObjectType.CharacterBase) return;
            var cb = (FFXIVClientStructs.FFXIV.Client.Graphics.Scene.CharacterBase*)character->DrawObject;
            if (cb->GetModelType() != FFXIVClientStructs.FFXIV.Client.Graphics.Scene.CharacterBase.ModelType.Human) return;
            var human = (FFXIVClientStructs.FFXIV.Client.Graphics.Scene.Human*)character->DrawObject;
            var skeleton = human->Skeleton;
            if (skeleton == null || skeleton->PartialSkeletonCount < 1) return;
            var animatedSkeleton = skeleton->PartialSkeletons[0].GetHavokAnimatedSkeleton(0);
            if (animatedSkeleton == null) return;
            var controls = animatedSkeleton->AnimationControls;
            for (var c = 0; c < controls.Length; ++c)
            {
                var ctl = controls[c].Value;
                if (ctl != null) ctl->PlaybackSpeed = speed;
            }
        }
        catch (Exception ex)
        {
            _log.Error(ex, "SetAllControlSpeeds failed");
        }
    }

    /// <summary>
    /// 直接执行表情（游戏表情面板/系统同款原生通道）：即时、无聊天节流、表情状态机注册。
    /// 先走 ResolveTargetedEmoteId 变体解析（聊天命令在游戏内部也这么做 —— 玩家不可直接
    /// 执行表情基础行，需解析成实际变体行，如 breakdance 需解析后才生效）。
    /// DisableLogMessage=true：不刷聊天记录（等效 motion）。
    /// </summary>
    public void ExecuteEmoteDirect(ushort emoteId)
    {
        try
        {
            FFXIVClientStructs.FFXIV.Client.Game.Control.EmoteController.PlayEmoteOption opt = default;
            opt.DisableLogMessage = true;
            var resolved = _sampler.ResolveTargetedEmote(emoteId);
            if (resolved == 0) resolved = emoteId;
            FFXIVClientStructs.FFXIV.Client.Game.Control.EmoteManager.Instance()->ExecuteEmote(resolved, &opt);
        }
        catch (Exception ex)
        {
            _log.Error(ex, "ExecuteEmote failed (id={id})", emoteId);
        }
    }

    /// <summary>清表情状态标记（EmoteId=0 = 游戏 EndEmote 的状态终点）—— 消除切换后的"忙窗口"。</summary>
    public void ClearEmoteId()
    {
        if (!_sampler.TryGetLocalCharacter(out var chara)) return;
        try { chara->EmoteController.EmoteId = 0; }
        catch (Exception ex) { _log.Error(ex, "ClearEmoteId failed"); }
    }

    /// <summary>
    /// 表情状态机完整解锁（v0.5.19）：EmoteId=0 + 退出循环姿态模式。
    /// 死锁根源：黄金之舞等舞蹈把 Mode 留在 EmoteLoop(3)/InPositionLoop(11)，此后
    /// ExecuteEmote 被游戏拒绝（要求先起立/退出姿态 1-2s，且清了 EmoteId 后游戏永远等不到）
    /// —— 表现为"跳过一次舞后再拖任何动作全部不生效"。Mode=Normal(1) 即刻解锁
    /// （Ktisis 退出表情模式同款写法），必要时顺带强制主待机把序列器从旧循环绑定上拉下来。
    /// </summary>
    public void ResetEmoteState(IReadOnlyCollection<ushort> idleTimelines)
    {
        if (!_sampler.TryGetLocalCharacter(out var chara)) return;
        try
        {
            chara->EmoteController.EmoteId = 0;
            var m = chara->Mode;
            if (m == CharacterModes.EmoteLoop || m == CharacterModes.InPositionLoop)
            {
                // 必须走 SetMode 函数：裸写 Mode 字段会绕过游戏的模式切换记账，
                // 之后表情系统静默拒绝一切新表情（实测 SetMode 一调立即恢复）
                chara->SetMode(CharacterModes.Normal, 0);
                foreach (var idleId in idleTimelines)
                {
                    try { chara->Timeline.PlayActionTimeline(idleId); } catch { }
                    break;
                }
                _log.Information("Freeze: exited loop mode {m} -> Normal (emote state unlocked)", (int)m);
            }
        }
        catch (Exception ex) { _log.Error(ex, "ResetEmoteState failed"); }
    }

    /// <summary>
    /// Brio 架构钉住：Mode=AnimLock + Timeline.BaseOverride=id（游戏自己的基础槽覆盖机制，
    /// 每帧由游戏重新应用 —— 表情结束计时器/待机/姿态逻辑都无权换绑）。
    /// triggerBind=true 时同时 PlayActionTimeline 让 Sequencer 立即绑定（当前槽上是别的动画时）；
    /// false = 动画已绑好，只接管防换绑（避免无谓重绑清掉已拨好的时间）。
    /// </summary>
    public bool TryPinTimeline(ushort timelineId, bool triggerBind)
    {
        if (timelineId == 0) return false;
        if (!_sampler.TryGetLocalCharacter(out var chara)) return false;
        try
        {
            if (!_hasPin)
            {
                _pinOrigMode = chara->Mode;
                _pinOrigModeParam = chara->ModeParam;
                _pinOrigBaseOverride = chara->Timeline.BaseOverride;
            }
            chara->SetMode(CharacterModes.AnimLock, 0);
            chara->Timeline.BaseOverride = timelineId;
            // 钉住即结束表情状态机：它的结束计时器再也不能中途收回动作（黄金之舞半程失效根因）
            chara->EmoteController.EmoteId = 0;
            if (triggerBind)
                chara->Timeline.PlayActionTimeline(timelineId);
            _pinnedTimelineId = timelineId;
            _hasPin = true;
            _log.Information("Freeze PIN: BaseOverride={id} mode=AnimLock (bind={bind})", timelineId, triggerBind);
            return true;
        }
        catch (Exception ex)
        {
            _log.Error(ex, "TryPinTimeline failed (id={id})", timelineId);
            return false;
        }
    }

    /// <summary>
    /// 解除钉住：恢复钉住前的 Mode/ModeParam/BaseOverride（Brio ResetBaseOverride 同款）。
    /// blendToIdle=true 时额外强制主待机时间轴（自然混合回站姿），用于完全退出预览。
    /// </summary>
    public void Unpin(bool blendToIdle, IReadOnlyCollection<ushort> idleTimelines)
    {
        if (!_hasPin) return;
        _hasPin = false;
        _pinnedTimelineId = 0;
        if (!_sampler.TryGetLocalCharacter(out var chara)) return;
        try
        {
            // 钉住常发生在舞蹈中段（Mode=EmoteLoop/InPositionLoop 时刻）—— 原样恢复会把
            // 循环姿态模式带回来，重新进入"ExecuteEmote 全被拒"的死锁。恢复目标消毒为 Normal。
            var restore = _pinOrigMode;
            if (restore == CharacterModes.EmoteLoop || restore == CharacterModes.InPositionLoop)
                restore = CharacterModes.Normal;
            // 必须走 SetMode 函数（v0.5.19 关键修复）：裸写 Mode 字段会绕过游戏的模式切换
            // 记账 —— 之后 ExecuteEmote/聊天表情全部被静默拒绝（实测：钉住→裸写恢复→
            // /bow 拒收 3 分钟，SetMode(Normal,0) 一调用立即恢复）
            chara->SetMode(restore, (restore == _pinOrigMode) ? _pinOrigModeParam : (byte)0);
            chara->Timeline.BaseOverride = _pinOrigBaseOverride;
            if (blendToIdle)
            {
                foreach (var idleId in idleTimelines)
                {
                    chara->Timeline.PlayActionTimeline(idleId);
                    break;
                }
            }
            _log.Information("Freeze UNPIN (blend={blend})", blendToIdle);
        }
        catch (Exception ex) { _log.Error(ex, "Unpin failed"); }
    }

    /// <summary>钉住保持：BaseOverride 被游戏重算清掉就写回（等价 Brio hook 拦截，晚一帧落地）。</summary>
    public void EnsureBaseOverride(ushort timelineId)
    {
        if (!_sampler.TryGetLocalCharacter(out var chara)) return;
        try
        {
            if (chara->Timeline.BaseOverride != timelineId)
                chara->Timeline.BaseOverride = timelineId;
        }
        catch { }
    }

    /// <summary>GPose 内换绑：已钉住时不解钉（恢复 Normal 会与照片系统冲突），直接换 BaseOverride+重播。</summary>
    public void RebindPin(ushort timelineId)
    {
        if (_sampler.TryGetLocalCharacter(out var pc))
        {
            try
            {
                pc->Timeline.BaseOverride = timelineId;
                pc->Timeline.PlayActionTimeline(timelineId);
            }
            catch { }
        }
        _pinnedTimelineId = timelineId;
    }

    /// <summary>GPose 退出清扫：BaseOverride 清零。</summary>
    public void ClearBaseOverride()
    {
        try { if (_sampler.TryGetLocalCharacter(out var gc)) { gc->Timeline.BaseOverride = 0; } } catch { }
    }

    /// <summary>直接强制时间轴（候选选择仍归定格器；失败日志与拆分前一致）。</summary>
    public bool TryPlayTimeline(ushort timelineId)
    {
        if (!_sampler.TryGetLocalCharacter(out var chara)) return false;
        try
        {
            chara->Timeline.PlayActionTimeline(timelineId);
            return true;
        }
        catch (Exception ex)
        {
            _log.Error(ex, "PlayActionTimeline failed (id={id})", timelineId);
            return false;
        }
    }

    /// <summary>无条件把指定待机 id 钉回 slot0（PrepareFor* 卫生序列用；3 兜底由调用方经 PoseSessionPolicy.PickIdleId 决定）。</summary>
    public void RebindIdle(ushort idleId)
    {
        if (_sampler.TryGetLocalCharacter(out var chara))
        {
            try { chara->Timeline.PlayActionTimeline(idleId); } catch { }
        }
    }
}
