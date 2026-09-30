// AnimationPoseFreezer 的 GPose 精确编辑模式分部（OVERHAUL 批 C 第二步按层拆出）：
// /gpose 开关、确定性动画 id 解析（ResolveGposeId）与直绑定格（GposeFreeze）。
// 自 AnimationPoseFreezer.cs 文件级搬入，同类型 partial 合并，行为逐字不变。
using System;
using Lumina.Excel.Sheets;

namespace ChoreoHelper;

public unsafe sealed partial class AnimationPoseFreezer
{
    private GameOutputLease? _gposeLease;

    // ---------- GPose 精确编辑模式（0.5.29）：拖动=确定性地"解析→直绑→拨时刻→停表" ----------
    // 与普通管线完全隔离：无表情通道、无等待、无学习 —— GPose 里游戏自己屏蔽了所有干扰，
    // 四个原语（解析/绑定/写时刻/停表）全部实测过。开关由 📷 按钮驱动（发送 /gpose）。
    private bool _gposeActive;

    // ---------- GPose 精确编辑模式（0.5.29）----------
    /// <summary>切换 GPose：发 /gpose 命令并翻转内部标志。返回状态 JSON。
    /// FIX-E 线程契约：_gposeActive 是托管标志就地翻转（供返回值/GET /gpose/state 读取），
    /// 碰游戏对象的部分（批量取消/骨骼重放停止/BaseOverride 清零/槽速度恢复）统一调度
    /// 进框架线程——旧版在 HTTP 线程直接写这些内存。</summary>
    public string GposeToggle()
    {
        lock (OutputLock)
        {
            if (_disposed || _pendingOutputCallbacks != 0 || _failedOutputCleanup.Count != 0 || (_gposeLease?.IsCurrent != true
                && !_executor.OutputOwnership.TryAcquireLegacy("gpose", out _gposeLease)))
                return "{\"error\":\"当前独占试验持有游戏输出\"}";
            var result = GposeToggleCore();
            if (!_gposeActive) { _gposeLease?.Dispose(); _gposeLease = null; }
            return result;
        }
    }

    private string GposeToggleCore()
    {
        var turningOn = !_gposeActive;
        _gposeActive = turningOn;
        if (turningOn)
        {
            // 进 GPose 只切标志 + 发 /gpose 命令（骨骼重放臂已随 BoneAnimator 死臂删除，
            // 2026-08-31 审计 P0：BoneAnim 从未被赋值，相关分支不可达）
        }
        else
        {
            RunOnGameThread(() =>
            {
                StopPreview();
                _applicator.ClearBaseOverride();
                _applicator.SetAllControlSpeeds(1f);
            });
        }
        _executor.ExecuteCommand("/gpose");
        _log.Information("GPose mode {s}", _gposeActive ? "ON" : "OFF");
        return PoseSessionPolicy.GposeStateJson(_gposeActive);
    }


    // v0.7.1 FIX-A（AUD2-002）：骨骼直写探针 BoneProbe 已整体删除——它经 unsafe 指针写本地角色
    // 骨骼四元数，且曾挂在免配对 GET /debug/boneprobe 上（HTTP 线程不在 Dalamud 框架线程）。
    // S3 验证期的调试使命已结束，生产版不再保留这条写入原语（需要时按审计文档在开发构建加闸门）。
    public bool IsGposeActive => _gposeActive;

    /// <summary>
    /// 确定性动画 id：游戏自己的角色解析（ResolveTargetedEmoteId）→ 变体行 → ActionTimeline[0]。
    /// 不学习、不观察 —— 同角色结果恒定（缓存）。失败回 0（走普通管线兜底）。
    /// </summary>
    private ushort ResolveGposeId(string command)
    {
        if (PoseSignatureAccess.GposeIdCache.TryGetValue(command, out var cached) && cached != 0) return cached;
        try
        {
            if (!TryResolveEmote(command, out var ids)) return 0;
            var rowId = (uint)ids.Emote;
            var resolved = _sampler.ResolveTargetedEmote(ids.Emote);
            if (resolved != 0) rowId = (uint)resolved;
            var sheet = _dataManager.GetExcelSheet<Emote>();
            var row = sheet.GetRow(rowId);
            for (var i = 0; i < 6; i++)
            {
                try
                {
                    var tl = row.ActionTimeline[i];
                    if (tl.IsValid)
                    {
                        PoseSignatureAccess.GposeIdCache[command] = (ushort)tl.RowId;
                        return (ushort)tl.RowId;
                    }
                }
                catch { }
            }
            if (ids.Timelines.Length > 0 && ids.Timelines[0] != 0)
            {
                PoseSignatureAccess.GposeIdCache[command] = ids.Timelines[0];
                return ids.Timelines[0];
            }
        }
        catch { }
        return 0;
    }

    /// <summary>
    /// GPose 精确冻结：解析 id → 直绑（复用已验证的 TryPinTimeline）→ 立即标记挂载
    /// （跳过整个等待/学习阶段）→ 停表 + 写时刻。之后的保持由既有 Hold 阶段接管
    /// （成员集合 = [id]，直绑后槽0 恒等于 id，探针必过）。
    /// </summary>
    // ---------- S3 骨骼录制/重放（Phase 2，已随 BoneAnimator 死臂移除）----------
    // 2026-08-31 审计 P0：全仓零处 new BoneAnimator，BoneAnim 从未被赋值，/bonerec/* 恒回
    // {}/no animator——"接线即雷"。录制/重放产品化时按审计文档重新设计，不再留半接线的
    // unsafe 写入原语。

    private void GposeFreeze(string command, float targetTime)
    {
        // 骨骼重放/自动录制臂已随 BoneAnimator 死臂删除（从未接线，不可达）——直接走普通管线
        var id = ResolveGposeId(command);
        if (id == 0)
        {
            // 解析失败（非表情命令等）→ 走普通管线
            return;
        }
        if (!_applicator.HasPin || _applicator.PinnedTimelineId != id)
        {
            // GPose 内换绑：绝不 Unpin（恢复 Normal 模式会与照片系统冲突 → 重绑失败）。
            // 已钉住时直接换 BaseOverride + 重播；未钉住才走完整钉住。
            if (_applicator.HasPin)
                _applicator.RebindPin(id);
            else
                _applicator.TryPinTimeline(id, triggerBind: true);
        }
        _pendingCommand = command;
        _lastCommand = command;
        _pendingTime = Math.Max(0, targetTime);
        _awaitTimelineIds = new[] { id };
        _awaitEmoteId = 0;
        _awaitEmoteFamily = Array.Empty<ushort>();
        _awaitIsLoop = false; // GPose 不取模：假时长读数会把大目标值错误折叠（实测 5.0%2.33=0.33）；超界时刻由 hka 自然回绕
        _facialOnly = false;
        _previewMode = true;
        _attached = true;
        _attachDuration = -1f;
        _lastWrittenTime = -1f;
        _gaveUp = false;
        _applicator.SetAllControlSpeeds(0f);
        var (ok, dur, _, _) = _sampler.AccessMainControl(0, false);
        if (ok && dur > 0.05f)
        {
            var target = _pendingTime;
            if (_pendingTime > dur) target = _pendingTime % dur;
            if (_sampler.AccessMainControl(target, true).Ok) _lastWrittenTime = target;
        }
        _log.Information("GPose freeze: {cmd} tl={id} at {t:F2}s", command, id, targetTime);
    }
}
