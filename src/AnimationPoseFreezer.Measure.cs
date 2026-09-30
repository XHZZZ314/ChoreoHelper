// AnimationPoseFreezer 的时长测量层分部（OVERHAUL 批 C 第三步按层拆出）：延迟测时长
// 任务队列 _pendingMeasures、公开入口 MeasureDurationDelayed 与到期测量/身份校验
// （ProcessPendingMeasures/VerifyMeasureTarget）。静态字典 MeasuredDurations（带初始化器）
// 按约束留主件。自 AnimationPoseFreezer.cs 文件级搬入，同类型 partial 合并，行为逐字不变。
using System;

namespace ChoreoHelper;

public unsafe sealed partial class AnimationPoseFreezer
{
    // 延迟测时长任务：预览/定格挂载后读取绑定动画真实时长，供前端展示正确 clip 时长
    private readonly List<(string Cmd, double Due)> _pendingMeasures = new();

    /// <summary>
    /// 延迟测量动画时长：命令执行 0.6s 后（动画已挂载）读取绑定动画真实时长存入 MeasuredDurations。
    /// 供 /preview 用 —— 预览一个动作即可得到它的真实时长，前端据此显示/校正 clip 时长。
    /// </summary>
    public void MeasureDurationDelayed(string command)
    {
        if (string.IsNullOrEmpty(command)) return;
        _framework.RunOnFrameworkThread(() =>
        {
            if (PoseMeasureQueue.CanEnqueue(_pendingMeasures.Count)) // 防积压上限
                _pendingMeasures.Add((command, Now() + 0.6));
        });
    }

    /// <summary>延迟测量前的身份校验：延迟期间用户可能已拖到别的动作，防止把别人的时长记串（v0.5.6 修复）。</summary>
    private bool VerifyMeasureTarget(string cmd)    {
        try
        {
            // 已拖到别的动作：丢弃过期测量
            if (_previewMode && _pendingCommand != null && _pendingCommand != cmd) return false;
            // 可校验的（表情命令）：槽0 仍须是该命令的时间轴（表内或学习集合），且不是待机
            if (PoseSignatureAccess.EmoteMap != null && PoseSignatureAccess.EmoteMap.TryGetValue(cmd, out var ids))
            {
                var slot0 = _sampler.CurrentSlot0Timeline();
                if (slot0 != 0
                    && !_idleTimelines.Contains(slot0)
                    && Array.IndexOf(ids.Timelines, slot0) < 0
                    && !(PoseSignatureAccess.LearnedTimelines.TryGetValue(cmd, out var learned) && learned.Contains(slot0)))
                    return false;
            }
            return true;
        }
        catch { return true; }
    }

    private void ProcessPendingMeasures()
    {
        for (var i = _pendingMeasures.Count - 1; i >= 0; i--)
        {
            if (Now() < _pendingMeasures[i].Due) continue;
            var cmd = _pendingMeasures[i].Cmd;
            _pendingMeasures.RemoveAt(i);
            var (ok, dur, _, _) = _sampler.AccessMainControl(0, false);
            if (ok && dur > 0.05f && VerifyMeasureTarget(cmd))
            {
                MeasuredDurations[cmd] = dur;
                _log.Information("Measured duration: {cmd} = {dur:F2}s", cmd, dur);
            }
        }
    }
}
