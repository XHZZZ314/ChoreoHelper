// AnimationPoseFreezer 的挂载/学习状态机分部（OVERHAUL 批 C 第四步按层拆出）：
// 框架泵 OnFrameworkUpdate/OnFrameworkUpdateCore（空闲学习/H1 移动锚/H2 切图/拖动流结算/
// Hold 停表保持/低频探针自愈）、延迟观察学习 ObserveDeferredTarget、挂载/学习状态机主体
// AttachPhase（直接通道 canonWait＋A/A'/A3/A2/B/C 学习路径＋重试阶梯＋有界放弃＋聊天通道）
// 与执行辅助群（TryBreakLingeringLoop/ExecuteMotionFallback/CanLearnTimeline/
// ObserveIdleTimeline/SamplePostEmoteReturn/TryPlayTimelinePreferred）。
// 自 AnimationPoseFreezer.cs 文件级搬入，同类型 partial 合并，行为逐字不变。
using System;
using System.Collections.Generic;
using System.Linq;
using Dalamud.Plugin.Services;
using FFXIVClientStructs.FFXIV.Client.Game.Character;

namespace ChoreoHelper;

public unsafe sealed partial class AnimationPoseFreezer
{
    private void OnFrameworkUpdate(IFramework framework)
    {
        lock (OutputLock)
        {
            if (_disposed || _pendingOutputCallbacks != 0 || _failedOutputCleanup.Count != 0
                || !_executor.OutputOwnership.TryAcquireLegacy("freezer-frame", out var lease)) return;
            using (lease) lease!.TryRun(() => { OnFrameworkUpdateCore(); return true; });
        }
    }

    private void OnFrameworkUpdateCore()
    {
        // 待机时间轴观察（学习排除集合）—— 预览未激活时低频采样
        ObserveIdleTimeline();

        // H2：切图/重登检测 —— 本地玩家对象地址变化即退出定格
        var localAddr = nint.Zero;
        try { localAddr = _objectTable[0]?.Address ?? nint.Zero; } catch { }
        if (localAddr != _lastLocalAddress)
        {
            _lastLocalAddress = localAddr;
            if (_previewMode && localAddr != nint.Zero)
            {
                _log.Warning("Local player changed (territory/relog), stopping freeze preview");
                StopPreview();
            }
        }

        // 预览测时长任务：独立于定格状态，每帧检查到期任务
        ProcessPendingMeasures();

        // 拖动流结算：150ms 无新请求（=松手/停下）统一执行最新目标。
        // 注意：不做"驻留提前结算"—— 大幅拖拽穿过长 clip（12-16s 舞蹈）耗时 >0.4s 会触发
        // 中途执行（释放旧+执行新的完整周期），来回大幅拖拽反复触发 = 连锁执行 = 叠加/吞动作。
        // clip 内刮擦反馈由同命令实时拨时间路径提供（首次执行后即实时）。
        // force 绕过流判定（结算时距上次请求必然 >150ms，保险起见仍强制）。
        if (_lifecycle.TryTakeSettled(out var settledCmd, out var settledT))
        {
            if (settledCmd == null)
            {
                _log.Information("Freeze settled after drag: stop (gap)");
                StopPreview();
            }
            else
            {
                _log.Information("Freeze settled after drag: {cmd} at t={t:F2}s", settledCmd, settledT);
                FreezeRequestCore(settledCmd, settledT, force: true);
            }
        }

        if (!_previewMode || _pendingCommand == null) return;

        // H1：定格持续保持，玩家持续移动时解除。
        // 锚点式判断：1 秒内位移超过 1.5m 才算玩家在走路（走路 ~2m/s 必触发）；
        // 动作自带的根运动位移是一次性的、服务器位置修正是毫米级 —— 都不会误触发
        try
        {
            var local = _objectTable[0];
            var pos = local?.Position ?? System.Numerics.Vector3.Zero;
            var now = Now();
            if (!_hasAnchor || now - _anchorTime > 1.0)
            {
                _anchorPos = pos;
                _anchorTime = now;
                _hasAnchor = true;
            }
            else if ((pos - _anchorPos).LengthSquared() > 2.25f) // 1.5m²
            {
                _log.Information("Player moving sustained, releasing freeze preview");
                StopPreview();
                return;
            }
        }
        catch { }

        if (!_attached)
        {
            AttachPhase();
            return;
        }

        // 面部/免钉定类：动画不在主槽（面部骨架/装备动作等）—— 不停表不写时间（写了会钉错
        // 别的动画 = 错误动作），让动作自然播完。若之后主槽迟到了该命令的绑定（慢绑定的身体
        // 动作），升级回正常定格
        if (_facialOnly)
        {
            var fs = _sampler.CurrentSlot0Timeline();
            if (fs != 0 && !_idleTimelines.Contains(fs) && Awaiting(_pendingCommand, fs))
            {
                _facialOnly = false;
                _lastWrittenTime = -1f;
                _log.Information("Freeze no-pin upgraded to pinned (tl={id})", fs);
            }
            return;
        }

        // 停表保持（三层防御）：游戏每帧可能重算各槽速度，单一控制槽的 0 会被覆盖，
        // 被覆盖后动画偷偷推进 → "停不住"；伴随槽继续播 → "抽搐"。每帧全量压 0 + 漂移校正兜底。
        // 拖动流中目标已过时且游戏已换绑（_needsReexec）时不写时间（会写进待机控制），等结算
        if (!(_lifecycle.HasDeferred && _needsReexec))
        {
            // 钉住保持：BaseOverride 被游戏重算清掉就写回（等价 Brio hook 拦截，晚一帧落地）
            if (_applicator.HasPin)
                _applicator.EnsureBaseOverride(_applicator.PinnedTimelineId);
            _applicator.SetAllControlSpeeds(0f);
            // 时间写入统一（v0.5.20）：目标对活体绑定取模/钳制 —— 挂载瞬间的 _attachDuration
            // 可能读自过渡期绑定（如待机 2.33s），用它取模会写出 2.8%2.33=0.47 这类错位时间；
            // 且每帧都对账（写入+漂移校正合一，>30ms 即回写），游戏推着走也压得回来
            var live = _sampler.AccessMainControl(0, false);
            if (live.Ok && live.Duration > 0.05f)
            {
                var target = _pendingTime;
                if (_awaitIsLoop && _pendingTime > live.Duration)
                    target = _pendingTime % live.Duration;
                if (Math.Abs(target - _lastWrittenTime) > 0.001f
                    || (live.LocalTime >= 0 && Math.Abs(live.LocalTime - target) > 0.03f))
                {
                    if (_sampler.AccessMainControl(target, true).Ok)
                    {
                        _lastWrittenTime = target;
                        _log.Information("Freeze hold: LocalTime={time}s (live dur {d:F2}s)", target, live.Duration);
                    }
                }
            }
        }

        // 低频安全检查：确认绑定没被游戏换掉（意外解冻/动作被结束）
        if (Now() - _lastProbe < 0.25) return;
        _lastProbe = Now();
        var probe = _sampler.AccessMainControl(0, false);
        if (!probe.Ok)
        {
            // M1：拿不到控制槽 —— 重走挂载流程，不静默放弃
            _attached = false;
            _preExecDuration = -1f;
            _lastWrittenTime = -1f;
            return;
        }
        // 直接通道：槽0时间轴 id 是动画身份（集合语义，容忍游戏把强制 id 规范化成它解析的变体）。
        // id 仍在集合内时，时长/指针波动只是过渡期读数失真 → 刷新基准，不触发重播；id 变了（回待机）→ 自愈
        var curSlot0 = _sampler.CurrentSlot0Timeline();
        if (DirectPending && !_idleTimelines.Contains(curSlot0) && Awaiting(_pendingCommand, curSlot0))
        {
            _attachDuration = probe.Duration;
            _attachBinding = probe.Binding;
            // v0.5.21：钉住还在但 attach 标志丢了（过渡期绑定闪烁触发过重挂载）→ 槽0 仍是
            // 我们的动画且钉着 —— 直接恢复挂载继续写时间，否则出现"钉着对的动作但不冻结"
            if (!_attached) { _attached = true; _lastWrittenTime = -1f; }
            return;
        }
        // 钉住态下槽0竟然换出了集合（理论上 BaseOverride 已挡住 —— 防御性兜底）：原地重钉。
        // 纯原生调用零命令，不可能形成命令风暴；不走重执行阶梯（阶梯会清钉住、发聊天命令）。
        // v0.5.21：重钉前校验钉住的 id 仍属于当前命令 —— 换命令后残留的旧 pin 绝不能重钉
        // （压测实测换轮后重钉上个命令的动画 = 播出错误动作）
        if (_applicator.HasPin && _applicator.PinnedTimelineId != 0 && Awaiting(_pendingCommand, _applicator.PinnedTimelineId) && Now() - _lastExecTime > 0.5)
        {
            if (_sampler.TryGetLocalCharacter(out var rpChara))
            {
                try
                {
                    rpChara->Timeline.BaseOverride = _applicator.PinnedTimelineId;
                    rpChara->Timeline.PlayActionTimeline(_applicator.PinnedTimelineId);
                    _attachBinding = probe.Binding;
                    _lastExecTime = Now();
                    _log.Warning("Freeze: pin lost (slot0={cur}), re-pinned {id}", curSlot0, _applicator.PinnedTimelineId);
                }
                catch { }
            }
            return;
        }
        if ((_attachBinding != 0 && probe.Binding != _attachBinding)
            || (_attachDuration >= 0 && Math.Abs(probe.Duration - _attachDuration) > 0.05f))
        {
            // 游戏把槽换绑了（动作结束→待机/意外解冻）。
            // 自愈：恢复速度后重新播放动作重新定格；后续请求也会因此强制重发（修复"回拉无变化"）。
            // 拖动流中不自愈重播（旧目标已过时，结算会统一处理；此刻重播会和延迟目标交错=动作叠加）
            _needsReexec = true;
            if (!_lifecycle.HasDeferred && Now() - _lastExecTime > 0.5 && _pendingCommand != null)
            {
                _applicator.SetAllControlSpeeds(1f); // 恢复全部槽速度，让重发的动作能正常起播
                // 只清队列里自己的重复命令再重发（旧实现 Clear() 会丢掉其他链路的命令）
                _executor.RemoveWhere(c => c == _pendingCommand);
                if (_awaitEmoteId != 0)
                {
                    _directAttempts = 0;
                    // 自愈优先直接时间轴重放（零成本即时；idle 重置场景主力）
                    if (!TryPlayTimelinePreferred(_pendingCommand))
                        _applicator.ExecuteEmoteDirect(_awaitEmoteId);
                }
                else
                {
                    _executor.ExecuteCommand(_pendingCommand, _previewLease);
                }
                _lastExecTime = Now();
                _needsReexec = false;
                _attached = false;
                _preExecDuration = probe.Duration;
                _preExecBinding = probe.Binding;
                _attachDuration = -1f;
                _lastWrittenTime = -1f;
                _log.Information("Freeze: animation ended by game, re-playing {cmd}", _pendingCommand);
            }
            return;
        }
    }

    /// <summary>
    /// 挂载等待阶段：确认"要定格的那个动画"已经绑到控制槽之后才允许写时间。
    /// 直接通道：GetSlotTimeline(0) ∈ 期望时间轴集合（表情可能有多个变体，实际绑定的
    /// 未必是 [0] 号 —— 单 id 验证会导致部分动作永不挂载="停不住"）+ 绑定指针已切换 → 挂载；
    ///           未挂上时零成本重试，绝不把时间写进未确认的动画。
    /// 聊天通道：绑定指针/时长变化 → 挂载；超时重发（≤2次），仍不行则放弃本次（不写时间）。
    /// </summary>
    /// <summary>
    /// 延迟挂起期间的观察学习：上一目标（已执行、未挂载就被拖走）的动画可能在拖动中才生效
    /// （motion 固有 ~2s 延迟）—— 状态机确认（EmoteId 族匹配）+ 非待机 + 未知 id 即学习，
    /// 不挂载（目标已过时）。学到后下次拖到该命令直接命中验证。
    /// </summary>
    private void ObserveDeferredTarget()
    {
        if (_pendingCommand == null || !DirectPending || _facialOnly) return;
        if (Now() - _lastExecTime < 0.3) return; // 命令刚发出，等生效
        var slot0 = _sampler.CurrentSlot0Timeline();
        if (slot0 == 0 || _idleTimelines.Contains(slot0)) return;
        if (Awaiting(_pendingCommand, slot0)) return; // 已知
        if (!AwaitingEmote()) return; // 状态机没确认在播我们的表情
        PoseSignatureAccess.LearnTimeline(_pendingCommand, slot0);
        var (ok, dur, _, _) = _sampler.AccessMainControl(0, false);
        if (ok && dur > 0.05f && !PoseSignatureAccess.KnownAttachDurations.TryGetValue(_pendingCommand, out _))
            PoseSignatureAccess.KnownAttachDurations[_pendingCommand] = dur; // 变体时长基准（供时长匹配路径）
        _log.Information("Freeze learned timeline {id} for {cmd} (deferred-observed)", slot0, _pendingCommand);
    }

    private void AttachPhase()
    {
        // bow 打断器的 motion 补发：bow 忙窗口吞掉了打断时的 motion 命令，此处重发。
        // 等 bow 结束（EmoteId 归零）才发 —— 不满足就等下一帧；一次被吞（post-bow 忙窗）
        // 还有一次机会（共 ≤2 次补发，防风暴）
        if (_motionResendAt > 0 && Now() >= _motionResendAt)
        {
            if (Now() - _motionResendAt > 6.0)
                _motionResendAt = 0;
            else if (!_attached && !_lifecycle.HasDeferred && _pendingCommand != null && _sampler.CurrentEmoteId() == 0)
            {
                _motionResendAt = 0;
                _motionResendCount++;
                if (_motionResendCount < 2)
                    _motionResendAt = Now() + 3.0; // 第一次补发若落进 post-bow 忙窗被吞，3s 后再试一次
                var cur3 = _sampler.CurrentSlot0Timeline();
                if (cur3 != 0) _motionSentSlot0 = cur3;
                _lastExecTime = Now();
                _executor.ExecuteCommand(_pendingCommand.Trim() + " motion", _previewLease);
                _log.Information("Freeze: motion re-send #{n} after bow breaker ({cmd})", _motionResendCount, _pendingCommand);
            }
        }
        // v0.5.21：挂载等待期也要守住钉住 —— BaseOverride 的每帧回写原来只在 Hold（已挂载）
        // 阶段做，等待期被游戏重算清掉后，上一轮残留动画（如 /aback 的 6220）会顶掉钉住
        // 请求的绑定 → 挂载永远等不到（压测实测 att=False pin=True slot0=外来动画 的根源）
        if (_applicator.HasPin && _sampler.TryGetLocalCharacter(out var apChara))
        {
            try
            {
                if (apChara->Timeline.BaseOverride != _applicator.PinnedTimelineId)
                    apChara->Timeline.BaseOverride = _applicator.PinnedTimelineId;
            }
            catch { }
        }
        // 拖动流中：挂载目标已过时（延迟中了新命令），停止旧目标的重试/motion 兜底 ——
        // 否则兜底命令会和结算后的新动作交错执行，表现为"两个动作叠加"。
        // 但继续观察学习：上一目标的动画可能此时才生效（motion 固有 ~2s 延迟常落在拖动中），
        // 学到变体 id 后下次直接命中（否则每轮都卡在首次学习的边缘）
        if (_lifecycle.HasDeferred) { ObserveDeferredTarget(); return; }
        var probe0 = _sampler.AccessMainControl(0, false);
        if (!probe0.Ok) return;
        var d = probe0.Duration;
        if (_preExecDuration < 0) _preExecDuration = d;

        if (DirectPending)
        {
            var slot0 = _sampler.CurrentSlot0Timeline();

            // v0.5.24：游戏可能把命令解析到其他变体行（种族/性别变体 —— 实测表行 104
            // 是拉拉菲尔舞，非拉拉菲尔角色上游戏绑成行 108，表集合 [576,575] 永远等不到，
            // 等待/学习全部落空）。观察到族外 EmoteId 且命令是我们刚发的 → 合并该行时间轴，
            // 规范 id 改为该行 [0]，族匹配（AwaitingEmote）也把该行算进来。
            var obsEmote = (ushort)_sampler.CurrentEmoteId();
            if (!_observedRowMerged && !_attached && obsEmote != 0 && _awaitEmoteId != 0 && obsEmote != _awaitEmoteId
                && obsEmote != _preExecEmoteId // 执行前就在播的表情行是残留，不是我们命令的解析结果
                && Array.IndexOf(_awaitEmoteFamily, obsEmote) < 0 && _pendingCommand != null
                && Now() - _lastExecTime < 12.0)
                TryMergeVariantRow(obsEmote);

            // 链式签名跟踪（A3 用）：族内 EmoteId → 族外 EmoteId 的转移 = 游戏把我们的表情
            // 链到后续段落（黄金之舞 104→117）。被游戏拒绝的命令从未见过族内确认，不会误置。
            if (AwaitingEmote()) _sawFamSinceExec = true;
            else if (_sawFamSinceExec && _sampler.CurrentEmoteId() != 0) _chainFromFam = true;

            // v0.5.24 引入段等待：槽上是表内辅助变体（≠ [0] 主轴）时，游戏的起播顺序是
            // 先绑引入段再换绑主轴（0.3-2.5s）。此刻不挂载（定格在引入段 = 错误动作）、
            // 不学习、不重试（重发命令会重起引入段 = 永远等不到主轴）。仅表内 id 等待
            // （学习到的表外变体不受影响）；3s 超时回退旧挂载（防御表数据不按惯例的行）。
            // v0.5.26：等待窗口跟随引入段实际播放进度（v0.5.24 的固定 3s 对练拳 ~3s /
            // 游侠姿势 5.9s 的引入段会在换绑前超时 → 挂到引入段 = 错姿势，或拖快了干脆
            // 挂不上 = "被吞"）。过渡期探针的时长读数不可靠（实测先读 2.33 稳定后才 5.9），
            // 用时间锚定：绑定时记时刻 + 时长快照（取后续读数最大值自修正），播完给 0.45s
            // 换绑机会；仍没换到主轴 = 引入段即本体（姿势类），挂载并记忆 IntroIsFinal。
            if (_introBoundAt < 0 && slot0 != 0 && slot0 != _canonicalTimeline
                && _canonicalTimeline != 0 && !_idleTimelines.Contains(slot0)
                && Array.IndexOf(_awaitTimelineIds, slot0) >= 0)
            {
                _introBoundAt = Now();
                _introDur = Math.Max(0.5f, d);
            }
            if (_introBoundAt > 0 && d > _introDur) _introDur = d; // 绑定稳定后时长读数修正
            // 0.5.26.2 唯一安全改动：12s 硬上限 —— 过渡期垃圾时长读数（实测黄金之舞被读到 12s）
            // 会把等待锁死到垃圾长度；上限兜底后最坏多等 12s 也必然放行挂载/重试
            var introPlayingT = _introBoundAt > 0 && Now() - _introBoundAt < Math.Min(_introDur + 0.6, 12.0);
            var introFinalKnown = _pendingCommand != null
                && PoseSignatureAccess.IntroIsFinalTimelines.TryGetValue(_pendingCommand, out var ifk) && ifk;
            var canonWait = !introFinalKnown && _canonicalTimeline != 0 && slot0 != 0 && slot0 != _canonicalTimeline
                && !_idleTimelines.Contains(slot0)
                && Array.IndexOf(_awaitTimelineIds, slot0) >= 0
                && (introPlayingT || (_introEndedAt > 0 && Now() - _introEndedAt < 0.45));
            var introDoneThisFrame = false;
            if (canonWait)
            {
                if (!introPlayingT && _introEndedAt < 0) _introEndedAt = Now();
            }
            else
            {
                introDoneThisFrame = _introEndedAt >= 0;
                _introEndedAt = -1;
            }
            if (canonWait && (slot0 != _diagLastWaitSlot || Now() - _diagLastWaitAt > 0.5f))
            {
                _diagLastWaitSlot = slot0; _diagLastWaitAt = Now();
                PoseSignatureAccess.Diag($"canonWait: slot0={slot0} canon={_canonicalTimeline} ch={_execChannel} emote={_sampler.CurrentEmoteId()} elapsed={Now() - _introBoundAt:F2}/{_introDur:F2}");
            }

            // 面部表情类（表预测）：执行后 0.3s 即完成 —— 不等主槽绑定（等不到）、不重试
            // （角色已在做正确表情）、不学习（面部 timeline 学进去会被当主槽 id 播放 = 错误动作）
            if (_facialOnly)
            {
                if (Now() - _execStartedAt > 0.3)
                {
                    _attached = true;
                    _attachDuration = -1f;
                    _log.Information("Freeze facial emote done (no pin): {cmd}", _pendingCommand ?? "-");
                }
                return;
            }

            // 集合验证（v0.5.11 已验证语义）：槽0 属于该命令（表内族 ∪ 学习过）且非待机 → 挂载。
            // 不能用"精确等于播放 id"—— 游戏有时会把强制的 id 规范化成它自己解析的变体
            // （v0.5.13 教训：精确匹配误判失败 → 不停重放 = 抽搐；重放 ladder 又闪过错误变体 = 动作错）。
            // 待机排除防止把待机绑定当自己的动画钉住；但表情状态机确认在播（族匹配）时放行 ——
            // 命令自己的变体（/wave 的 663）播完会被游戏当基线留在槽上，不能因待机标记拒挂。
            if (!canonWait && slot0 != 0 && (!_idleTimelines.Contains(slot0) || AwaitingEmote()) && Awaiting(_pendingCommand, slot0))
            {
                // hka 控制槽换绑通常滞后 1-2 帧，等绑定指针切换（或 1s 短超时，游戏复用控制时）再钉时间
                if (probe0.Binding != _preExecBinding || Now() - _lastExecTime > 1.0)
                {
                    _attached = true;
                    _attachDuration = d;
                    _attachBinding = probe0.Binding;
                    PoseSignatureAccess.LearnTimeline(_pendingCommand, slot0); // 挂载成功即记忆（集合确认过的实际变体）
                    PoseSignatureAccess.KnownAttachDurations[_pendingCommand!] = d;
                    if (_pendingCommand != null && _directAttempts >= 2)
                        PoseSignatureAccess.MotionPreferred[_pendingCommand] = true;
                    // 挂载即钉住（仅增强引擎，v0.5.18）：动画已绑好，只接管防换绑 —— 表情结束
                    // 计时器从此无效（黄金之舞播到一半被状态机收走 = 半程失效的根因）
                    if (PinModeEnabled)
                        _applicator.TryPinTimeline(slot0, triggerBind: false);
                    _log.Information("Freeze attached direct (tl={id}, dur {d:F2}s, pinned={p})", slot0, d, _applicator.HasPin);
                    PoseSignatureAccess.Diag($"attached tl={slot0} dur={d:F2} ch={_execChannel} emote={_sampler.CurrentEmoteId()} canon={_canonicalTimeline} att={_directAttempts}");
                    // v0.5.26：等过了引入段播完仍挂在非主轴上 = 游戏从不换绑（姿势类）——
                    // 记忆"引入段即本体"，该命令以后不再等待换绑。
                    if (_pendingCommand != null && _canonicalTimeline != 0 && slot0 != _canonicalTimeline && introDoneThisFrame)
                    {
                        PoseSignatureAccess.IntroIsFinalTimelines[_pendingCommand] = true;
                        PoseSignatureAccess.Diag($"intro-final learned: {_pendingCommand} tl={slot0} (no main transition after intro end)");
                    }
                }
                return;
            }
            // 面部表情类确认：ExecuteEmote 已被状态机接受（EmoteId 族匹配）但主槽0 保持不变
            // （表情动画在面部骨架）→ 无主槽可定格，执行即完成。计时用 _execStartedAt（不随
            // retry 重置 —— 否则 0.3s 的 retry 不断重置计时，0.5s 判定永远达不到）。
            // 不 LearnTimeline（面部 timeline 学进去会被当主槽 id 播放 = 错误动作），不重试
            if (slot0 != 0 && slot0 == _preExecSlot0 && AwaitingEmote() && Now() - _execStartedAt > 0.45)
            {
                _attached = true;
                _facialOnly = true;
                _attachDuration = -1f;
                _log.Information("Freeze facial-only emote confirmed (no slot-0 pin): {cmd}", _pendingCommand ?? "-");
                return;
            }
            // 学习路径 A（表情状态机确认）：EmoteId == 期望表情 且绑定确实换成新值且非待机 ——
            // 用于变体时间轴（/breakdance 实际绑 7407，不在 Emote 表 [0..5]）与残留场景。
            // CanLearnTimeline 排除过渡窗口的待机/残留（曾把待机 3 学进缓存 → 之后永远钉待机 = 吞动作）
            if (CanLearnTimeline(slot0) && _directAttempts >= 1 && AwaitingEmote())
            {
                PoseSignatureAccess.LearnTimeline(_pendingCommand, slot0);
                _log.Information("Freeze learned timeline {id} for {cmd} (state-confirmed)", slot0, _pendingCommand ?? "-");
                return;
            }
            // 学习路径 A'（状态转移确认，仅增强引擎）：执行前 ResetEmoteState 清零 EmoteId，
            // 之后 EmoteId 变为非 0 = 游戏接受了<b>某条</b>表情并绑定 —— 但解析出的变体行
            // 可能不在 TextCommand 族内（/gcsalute 基础行解析到行 56，族匹配 A 永远失败）。
            // 证据：EmoteId 0→非 0 转移（我们自己的执行被接受）+ 槽0 换成表外新值 + 稳定。
            // 独占所有权兜底防跨命令污染。（经典引擎不用 —— 保持 v0.5.11 严格学习语义）
            if (PinModeEnabled && _sampler.CurrentEmoteId() != 0 && CanLearnTimeline(slot0) && PoseSignatureAccess.OwnerUnknown(slot0))
            {
                if (slot0 == _stCandidate) _stCandidateFrames++;
                else { _stCandidate = slot0; _stCandidateFrames = 1; }
                if (_stCandidateFrames >= 3)
                {
                    _stCandidateFrames = 0;
                    PoseSignatureAccess.LearnTimeline(_pendingCommand, slot0);
                    var (okS, durS, _, _) = _sampler.AccessMainControl(0, false);
                    if (okS && durS > 0.05f) PoseSignatureAccess.KnownAttachDurations[_pendingCommand!] = durS;
                    _log.Information("Freeze learned timeline {id} for {cmd} (emote-transition, row {e})", slot0, _pendingCommand ?? "-", _sampler.CurrentEmoteId());
                    return;
                }
            }
            else { _stCandidate = 0; _stCandidateFrames = 0; }
            // 学习路径 A3（链式确认，仅增强引擎）：黄金之舞等链式舞蹈 —— 游戏把我们的表情（族内）
            // 链到族外 EmoteId 与表外时间轴（如 3770/3771，不在 Emote 表 [0..5]），A/B/C 的
            // 族匹配与变化检测全部够不着。签名：执行被接受过（见过族内）→ EmoteId 已链出族 +
            // 槽0 换成表外新值且稳定 ≥5 帧。被拒命令（从未见过族内）绝无可能触发 = 无污染。
            // give-up 后仍每帧观察（链可能在数秒后才发生），零新增命令 = 无风暴。
            if (PinModeEnabled && CanLearnTimeline(slot0) && PoseSignatureAccess.OwnerUnknown(slot0) && _chainFromFam)
            {
                if (slot0 == _chainCandidate) _chainCandidateFrames++;
                else { _chainCandidate = slot0; _chainCandidateFrames = 1; }
                if (_chainCandidateFrames >= 5)
                {
                    _chainCandidateFrames = 0;
                    PoseSignatureAccess.LearnTimeline(_pendingCommand, slot0);
                    var (okC, durC, _, _) = _sampler.AccessMainControl(0, false);
                    if (okC && durC > 0.05f) PoseSignatureAccess.KnownAttachDurations[_pendingCommand!] = durC;
                    _log.Information("Freeze learned timeline {id} for {cmd} (chain-confirmed, emote now {e})", slot0, _pendingCommand ?? "-", _sampler.CurrentEmoteId());
                    return;
                }
            }
            else { _chainCandidate = 0; _chainCandidateFrames = 0; }
            // 学习路径 A2（残留确认）：EmoteId == 期望表情 且 slot0 == 执行前值（残留的就是目标 ——
            // 前一轮 motion 的产物还在播，"变化检测"全部失效的死锁场景）且稳定 ≥5 帧非待机 ——
            // 状态机明确说目标表情在播，槽上必是它的变体（过渡窗口的旧动画撑不过 5 帧稳定 +
            // 0.8s 时限，不会误学）
            if (slot0 != 0 && slot0 == _preExecSlot0 && !_idleTimelines.Contains(slot0)
                && AwaitingEmote() && Now() - _lastExecTime > 0.8)
            {
                if (slot0 == _residualCandidate) _residualCandidateFrames++;
                else { _residualCandidate = slot0; _residualCandidateFrames = 1; }
                if (_residualCandidateFrames >= 5)
                {
                    _residualCandidateFrames = 0;
                    PoseSignatureAccess.LearnTimeline(_pendingCommand, slot0);
                    _log.Information("Freeze learned timeline {id} for {cmd} (residual-confirmed)", slot0, _pendingCommand ?? "-");
                    return;
                }
            }
            else { _residualCandidate = 0; _residualCandidateFrames = 0; }
            // 学习路径 B（变化检测）：重试后槽0换成新值且非待机且表情在播
            if (CanLearnTimeline(slot0) && _directAttempts >= 3 && _sampler.IsEmoting())
            {
                PoseSignatureAccess.LearnTimeline(_pendingCommand, slot0);
                _log.Information("Freeze learned timeline {id} for {cmd} (by change)", slot0, _pendingCommand ?? "-");
                return;
            }
            // 学习路径 C（motion 确认）：motion 变体命令播放的动画不设置 EmoteId（A/B 的
            // 状态机确认对它失效），其生效的直接证据是槽0 变成 ≠ motion 发出时刻快照的值 ——
            // 等待期槽0=待机且与快照相同，绝不学习（曾把待机 3 学进缓存 → 吞动作）。
            // v0.5.19 加固：表外 id + motion 生效延迟窗（>2.2s，命令在途的过渡换绑不学；
            // give-up 后仍生效 —— 迟到的 motion 落地也能被静默学走，零命令）
            // + 排除"上个动作自然结束后的待机回绑"（实测：残留舞蹈 700 在 motion 在途时
            // 播完 → 待机 3 回绑 ≠ 快照 → 被误当 motion 产物）。用表情回归基线候选当软待机
            // v0.5.24 加固：仅 motion 通道可用 —— 表情通道的命令被游戏拒绝时（双人坐骑/
            // 特殊区域等），槽上的表外残留不是本命令的动画（实测双开客户端拒绝表情时把
            // 无关 id 13 学给 /mandervilledance → 下一轮定格在无关姿势）
            if (_execChannel == "motion" && CanLearnTimeline(slot0) && PoseSignatureAccess.OwnerUnknown(slot0) && slot0 != 3 && _directAttempts >= 2
                && slot0 != _motionSentSlot0 && slot0 != _postEmoteBaseCandidate
                && Now() - _lastExecTime > 2.2)
            {
                if (slot0 == _learnCandidate) _learnCandidateFrames++;
                else { _learnCandidate = slot0; _learnCandidateFrames = 1; }
                if (_learnCandidateFrames >= 3)
                {
                    _learnCandidateFrames = 0;
                    // v0.5.24：motion 落地的表外时间轴先反查属主行 —— 命令被游戏解析到
                    // 种族/性别变体行时（表行 104 拉拉菲尔舞 → 实际行 108），合并该行的
                    // 全部时间轴并把规范 id 定为该行 [0]，回到正常挂载/等待流程。
                    if (!_observedRowMerged && _pendingCommand != null && TryMergeVariantRow(slot0))
                        return;
                    PoseSignatureAccess.LearnTimeline(_pendingCommand, slot0);
                    _log.Information("Freeze learned timeline {id} for {cmd} (motion-confirmed)", slot0, _pendingCommand ?? "-");
                    return;
                }
            }
            else { _learnCandidate = 0; _learnCandidateFrames = 0; }
            // （C2 motion-残留已移除 v0.5.19：在途 motion 与 dedup 无法区分 —— 实测把待机 3
            // 学给 /breakdance 并钉住。变化证据（C）对两种场景都健全：motion 落地 → 槽0 变 → C 学；
            // motion 被去重（动画已在播）→ 用户看到的就是对的动画，放弃挂载即可，无副作用）
            // 有界重试（防命令风暴）：最多 2 次重试 —— 第 1 次重发 ExecuteEmote、第 2 次一条
            // motion。绝不播表内原始 id，没有无限兜底（曾无限发 motion → "没写过的动作"）。
            // v0.5.21：pin-learned 通道的绑定固有延迟 ~0.3-1s（PlayActionTimeline 排队），
            // 0.6s 就发重试会在绑定在途时又叠命令 —— 高压下积压的在途命令数秒后落地，
            // 踩坏后续轮次的钉住（压测实测 mandervilledance 连续误判）。pin-learned 轮：
            // 首次重试延到 1.6s，且重试用零命令的重放（re-pin），不发游戏命令。
            var isPinLearned = _execChannel == "pin-learned";
            var firstDelay = isPinLearned ? 2.2 : 0.8;
            if (!canonWait && Now() - _lastExecTime > firstDelay && _directAttempts < 2 && !_gaveUp)
            {
                // v0.5.22：卡住才打断（仅增强引擎；经典引擎无钉住，循环残留由重试阶梯处理
                // —— v0.5.11 行为族没有打断器）—— 到了重试时刻还绑不上，且槽上卡的是表外
                // 循环时间轴（doze/舞蹈类残留，非待机），才用 bow 逐出循环调度器
                if (PinModeEnabled && slot0 != 0 && slot0 != 3 && PoseSignatureAccess.OwnerUnknown(slot0) && IsLoopTimeline(slot0)
                    && !_idleTimelines.Contains(slot0) && slot0 != _postEmoteBaseCandidate)
                    TryBreakLingeringLoop(_pendingCommand);
                _directAttempts++;
                PoseSignatureAccess.Diag($"retry #{_directAttempts} ch={_execChannel} slot0={slot0} emote={_sampler.CurrentEmoteId()}");
                if (PinModeEnabled && isPinLearned && _directAttempts == 1)
                {
                    // v0.5.21 终版：pin-learned 卡住（循环残留占槽，重钉也绑不上）→ 解钉后
                    // 直接走表情通道 —— ExecuteEmote 由游戏换绑，必定能逐出循环调度器
                    // （压测实测 doze 残留下 carrybook 重钉永远失败，表情通道一次成功）
                    _execChannel = "emote";
                    _applicator.Unpin(blendToIdle: false, _idleTimelines);
                    _applicator.ExecuteEmoteDirect(_awaitEmoteId);
                }
                else if (_directAttempts == 1)
                {
                    _execChannel = "emote";
                    _applicator.ExecuteEmoteDirect(_awaitEmoteId);
                }
                else
                {
                    _execChannel = "motion";
                    ExecuteMotionFallback();
                }
                _lastExecTime = Now();
                _log.Information("Freeze direct retry {n} via {ch} (slot0={cur})", _directAttempts, _execChannel, slot0);
            }
            else if (_directAttempts >= 2 && Now() - _execStartedAt > 3.0 && !_gaveUp)
            {
                // 有界放弃：命令已发完（初始 + 2 次重试）仍未挂载 —— 静默等待（不写时间不钉错），
                // 下次请求会因 _needsReexec 重发。游戏侧命令可能仍在途并最终播放（可接受）。
                _gaveUp = true;
                _needsReexec = true;
                _log.Information("Freeze: bounded give-up after retries, waiting quietly ({cmd})", _pendingCommand ?? "-");
            }
            // 未挂载期间不写时间（绝不钉错姿势），每帧继续轻量轮询
            return;
        }

        // 聊天通道（/ac 技能等）：等命令真正执行完再判断，避免轮询到上一条命令的动作
        if (_executor.PendingCount > 0) return;
        if (probe0.Binding != _preExecBinding || Math.Abs(d - _preExecDuration) > 0.05f)
        {
            // 时长校验：绑定变化但时长与该命令历史实测差 >0.5s → 是前序动作的残留绑定
            // （在途 motion/表情命令干扰），不是我们的动画 —— 拒绝挂载继续等（防"动作错误"）
            if (_pendingCommand != null
                && MeasuredDurations.TryGetValue(_pendingCommand, out var knownDur)
                && knownDur > 0.05f && d > 0.05f && Math.Abs(d - knownDur) > 0.5f)
            {
                _log.Information("Freeze chat: binding changed but dur {d:F2}s != known {k:F2}s, waiting for real animation ({cmd})", d, knownDur, _pendingCommand);
                return;
            }
            _attached = true;
            _attachDuration = d;
            _attachBinding = probe0.Binding;
            _log.Information("Freeze attached (dur {d:F2}s)", d);
        }
        else if (Now() - _lastExecTime > 0.5)
        {
            // 超时仍未换绑：盲挂旧动画会显示错误动作。持续重发（≤6 次覆盖前序动作的忙窗口
            // —— 命令在窗口内会被游戏吞掉，2 次就放弃会偶发"技能动作没反应"），仍不行才放弃。
            if (_pendingCommand != null && _chatRetries < 6)
            {
                _chatRetries++;
                // 只清队列里自己的重复命令再重发（旧实现 Clear() 会丢掉其他链路的命令，
                // 播放/演出/录制已入队的动作被连带丢弃——2026-08-31 审计 P1）
                _executor.RemoveWhere(c => c == _pendingCommand);
                _executor.ExecuteCommand(_pendingCommand, _previewLease);
                _lastExecTime = Now();
                _log.Information("Freeze chat re-exec #{n} ({cmd})", _chatRetries, _pendingCommand);
            }
            else if (_chatRetries == 6)
            {
                _chatRetries = 7; // 只记一次
                _needsReexec = true; // 后续请求强制重发；本次保持未挂载，不写时间
                _log.Warning("Freeze: chat command did not rebind animation, giving up this request ({cmd})", _pendingCommand ?? "-");
            }
        }
    }

    /// <summary>
    /// 打断残留的 motion 循环变体（表外 id 在槽上无限循环不去）。游戏的 motion 通道对
    /// "已有 motion 在播"去重/拒收，且部分表情命令也进不去 —— /breakdance 的循环占用
    /// 槽位后，后续命令全部落空（实测 /tremble 5s+ 无绑定）。PlayActionTimeline 压不住
    /// （调度器下轮又绑回），PlayTimeline(3) 实测直接崩游戏 —— 唯一实测有效的是走表情
    /// 通道放一个良性一次性动作（/bow），表情系统接管基础槽后循环调度器被逐出。
    /// v0.5.22：只在确认卡住时调用（重试时刻），且只对 IsLoop 的表外 id 开火。
    /// </summary>
    private void TryBreakLingeringLoop(string? forCommand)
    {
        try
        {
            var cur = _sampler.CurrentSlot0Timeline();
            if (cur == 0 || cur == 3 || cur == _postEmoteBaseCandidate || !PoseSignatureAccess.OwnerUnknown(cur)) return;
            if (_idleTimelines.Contains(cur)) return; // 待机集合（含循环型待机变体如 34）—— 新命令自己会绑上
            if (forCommand != null && Awaiting(forCommand, cur)) return; // 就是我们目标的动画
            if (!IsLoopTimeline(cur)) return; // 普通动画自己会结束 —— 不打断（曾对走路动画狂放 bow）
            if (_bowEmoteId == 0 && PoseSignatureAccess.EmoteMap != null && PoseSignatureAccess.EmoteMap.TryGetValue("/bow", out var bowIds))
                _bowEmoteId = bowIds.Emote;
            if (_bowEmoteId == 0) return;
            _applicator.ExecuteEmoteDirect(_bowEmoteId);
            _log.Information("Freeze: broke lingering motion loop (tl={cur}) via bow emote", cur);
        }
        catch (Exception ex) { _log.Error(ex, "TryBreakLingeringLoop failed"); }
    }

    /// <summary>motion 变体兜底：/xxx motion 不进表情状态机、无忙窗口（状态机被去重/阻塞时走它）。</summary>
    private void ExecuteMotionFallback()
    {
        if (string.IsNullOrEmpty(_pendingCommand)) return;
        // 先打断残留循环（bow，仅增强引擎）—— bow 的忙窗口会吞掉同帧发的 motion，1.6s 后由补发机制重发
        if (PinModeEnabled) TryBreakLingeringLoop(_pendingCommand);
        if (PinModeEnabled) _motionResendAt = Now() + 1.6;
        // 快照在打断之后取：循环打断→新绑定后，motion 落地的"槽0 变成 ≠ 快照"证据才成立
        var cur2 = _sampler.CurrentSlot0Timeline();
        if (cur2 != 0) _motionSentSlot0 = cur2;
        _executor.ExecuteCommand(_pendingCommand.Trim() + " motion", _previewLease);
    }

    /// <summary>学习前置校验：非空、确实换过绑定（≠执行前值）、不是待机 —— 防止学到过渡窗口的待机/残留。</summary>
    private bool CanLearnTimeline(ushort slot0)
        => slot0 != 0 && slot0 != _preExecSlot0 && !_idleTimelines.Contains(slot0);

    /// <summary>低频观察待机时间轴（学习排除）。v0.5.19 彻底重做 —— 唯一可靠的"真待机"信号
    /// 是回归一致性：两个<b>不同</b>的表情结束后 1s，槽0 回到同一个表外 id。
    /// 时间式采样（"不播表情时槽上是什么"）不可用：motion 通道的循环变体（/breakdance 的
    /// 3124）linger 在槽上同样满足"无 EmoteId + Mode=Normal + 稳定"，曾把真动作学成待机，
    /// 从此该动作的挂载/学习全被待机排除拒绝。回归边沿只在真表情结束时刻触发，
    /// motion 残留（从未进入表情状态机）永远不会被采集。</summary>
    private void ObserveIdleTimeline()
    {
        // 到期的回归采样先执行（下降沿守卫不能挡住已排定的采样）
        if (_postEmoteCheckAt > 0 && Now() >= _postEmoteCheckAt)
            SamplePostEmoteReturn();
        bool emotingNow;
        try { emotingNow = _sampler.IsEmoting(); }
        catch { return; }
        if (emotingNow) { _wasEmoting = true; return; }
        if (_wasEmoting)
        {
            _wasEmoting = false;
            if (!_previewMode && !_lifecycle.HasDeferred)
                _postEmoteCheckAt = Now() + 1.0; // 表情结束，1s 后采样回归基线
        }
    }

    private void SamplePostEmoteReturn()
    {
        _postEmoteCheckAt = -1;
        if (_lifecycle.HasDeferred || _sampler.IsEmoting()) return;
        if (_attached || _applicator.HasPin) return; // 我们钉住/挂载的动画不是回归基线；等待期（含预览中）可采样
        // —— 等待期采样是关键：打断器放的 bow 结束回绑的待机，正好成为 C 路径的"软待机"排除项
        EnsureEmoteMap();
        if (!_sampler.TryGetLocalCharacter(out var chara)) return;
        try { if (chara->Mode != CharacterModes.Normal) return; }
        catch { return; }
        var slot0 = _sampler.CurrentSlot0Timeline();
        if (slot0 == 0 || _idleTimelines.Contains(slot0)) return;
        if (PoseSignatureAccess.TimelineOwners != null && PoseSignatureAccess.TimelineOwners.ContainsKey(slot0)) return; // 表内 id 不是待机
        if (slot0 == _postEmoteBaseCandidate && _postEmoteBaseSources >= 1)
        {
            // 两次（及以上）表情结束都回到同一表外 id —— 真待机
            _idleTimelines.Add(slot0);
            _log.Information("Idle timeline confirmed by post-emote return consistency: {id}", slot0);
        }
        else if (slot0 != _postEmoteBaseCandidate)
        {
            _postEmoteBaseCandidate = slot0;
            _postEmoteBaseSources = 1;
        }
        else _postEmoteBaseSources++;
    }

    /// <summary>直接强制时间轴：候选只取学习缓存 —— 游戏自己绑定过的 id（种族/性别/职业正确变体）。
    /// 绝不播表内原始 id（特殊类表情族含其他种族/性别的变体行，播错会通过集合验证但视觉错误）。
    /// </summary>
    private bool TryPlayTimelinePreferred(string command)
    {
        if (!PoseSignatureAccess.LearnedTimelines.TryGetValue(command, out var learned) || learned.Count == 0) return false;
        // 只播归属校验通过的 learned id（污染条目直接跳过 —— 它们是别的命令的动画）
        List<ushort> cands;
        lock (learned) cands = learned.Where(id => PoseSignatureAccess.OwnerAllows(command, id)).ToList();
        if (cands.Count == 0) return false;
        var playId = cands[_playIdx % cands.Count];
        if (!_applicator.TryPlayTimeline(playId)) return false;
        _playedTimelineId = playId;
        return true;
    }

}
