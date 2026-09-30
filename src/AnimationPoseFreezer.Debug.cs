// AnimationPoseFreezer 的诊断/调试端点分部（OVERHAUL 批 C 第二步按层拆出）：
// /debug 系列只读探针（GetDebugEmoteFamily/GetDebugDiag/GetDebugAnimState）与
// 受租约保护的 poking 入口（DebugPoke/DebugPokeCore）。自 AnimationPoseFreezer.cs
// 文件级搬入，同类型 partial 合并，行为逐字不变。
using System;
using FFXIVClientStructs.FFXIV.Client.Game.Character;
using Lumina.Excel.Sheets;

namespace ChoreoHelper;

public unsafe sealed partial class AnimationPoseFreezer
{
    /// <summary>调试：命令的表情族行（分类+时间轴）与任意时间轴 id 的表内归属（诊断链式舞蹈）。</summary>
    public string GetDebugEmoteFamily(string? command, ushort[] probeIds)
    {
        try
        {
            EnsureEmoteMap();
            var sheet = _dataManager.GetExcelSheet<Emote>();
            object? family = null;
            if (!string.IsNullOrEmpty(command) && PoseSignatureAccess.EmoteMap != null && PoseSignatureAccess.EmoteMap.TryGetValue(command, out var ids))
            {
                var rows = new List<object>();
                foreach (var r in ids.EmoteFamily)
                {
                    var e = sheet.GetRow(r);
                    var cat = ""; try { cat = e.EmoteCategory.IsValid ? e.EmoteCategory.Value.Name.ToString() : ""; } catch { }
                    var tls = new List<ushort>();
                    try { for (var i = 0; i < 6; i++) { var t = e.ActionTimeline[i]; if (t.IsValid) tls.Add((ushort)t.RowId); } } catch { }
                    rows.Add(new { row = r, name = e.Name.ToString(), cat, timelines = tls });
                }
                family = new { emote = ids.Emote, anyLoop = ids.AnyLoop, facial = ids.IsFacial, rows };
            }
            var owners = PoseSignatureAccess.DescribeOwners(probeIds);
            var st = System.Text.Json.JsonSerializer.Serialize(new { command, family, owners });
            return st;
        }
        catch (Exception ex)
        {
            return PoseSignatureAccess.DebugErrorJson(ex.Message);
        }
    }

    /// <summary>调试：直接 poking 原生动画状态（诊断表情系统卡死）。</summary>
    public string DebugPoke(string? action)
    {
        if (action == "state") return DebugPokeCore(action);
        lock (OutputLock)
        {
            if (_disposed || _pendingOutputCallbacks != 0 || _failedOutputCleanup.Count != 0
                || !_executor.OutputOwnership.TryAcquireLegacy("debug-pose-write", out var lease))
                return "{\"error\":\"当前独占试验持有游戏输出\"}";
            using (lease)
            {
                var result = "{\"error\":\"输出租约已失效\"}";
                lease!.TryRun(() => { result = DebugPokeCore(action); return true; });
                return result;
            }
        }
    }

    private string DebugPokeCore(string? action)
    {
        try
        {
            if (!_sampler.TryGetLocalCharacter(out var chara))
                return "{\"error\":\"no char\"}";
            switch (action)
            {
                case "state":
                {
                    var speeds = new float[14];
                    for (uint i = 0; i < 14; i++) speeds[i] = chara->Timeline.TimelineSequencer.GetSlotSpeed(i);
                    var tls = new ushort[14];
                    for (uint i = 0; i < 14; i++) tls[i] = chara->Timeline.TimelineSequencer.GetSlotTimeline(i);
                    var (ok, dur, _, lt) = _sampler.AccessMainControl(0, false);
                    return System.Text.Json.JsonSerializer.Serialize(new
                    {
                        mode = (int)chara->Mode, modeParam = chara->ModeParam, baseOverride = chara->Timeline.BaseOverride,
                        overallSpeed = chara->Timeline.OverallSpeed, slotSpeeds = speeds, slotTimelines = tls,
                        controlOk = ok, dur, lt, emoteId = chara->EmoteController.EmoteId,
                        stance = chara->EmoteController.Stance, poseType = (int)chara->EmoteController.CurrentPoseType
                    });
                }
                case "blendidle":
                    chara->Timeline.TimelineSequencer.PlayTimeline(3);
                    return "{\"done\":\"blendidle(PlayTimeline 3)\"}";
                case "playaction3":
                    chara->Timeline.PlayActionTimeline(3);
                    return "{\"done\":\"PlayActionTimeline(3)\"}";
                case "modecycle":
                    chara->SetMode(CharacterModes.AnimLock, 0);
                    chara->Mode = CharacterModes.Normal;
                    chara->ModeParam = 0;
                    return "{\"done\":\"modecycle AnimLock->Normal\"}";
                case "setmode_normal":
                    chara->SetMode(CharacterModes.Normal, 0);
                    return "{\"done\":\"SetMode(Normal,0) via function\"}";
                case "mode_raw_normal":
                    chara->Mode = CharacterModes.Normal;
                    chara->ModeParam = 0;
                    return "{\"done\":\"raw Mode=Normal\"}";
                case "speeds1":
                    _applicator.SetAllControlSpeeds(1f);
                    return "{\"done\":\"all speeds = 1\"}";
                case "reset":
                    _applicator.ResetEmoteState(_idleTimelines);
                    return "{\"done\":\"ResetEmoteState\"}";
                case "emote_bow":
                    _applicator.ExecuteEmoteDirect(0);
                    return "{\"done\":\"ExecuteEmote(bow=0)\"}";
                default:
                    return "{\"error\":\"unknown action\",\"actions\":[\"state\",\"blendidle\",\"playaction3\",\"modecycle\",\"speeds1\",\"reset\",\"emote_bow\"]}";
            }
        }
        catch (Exception ex)
        {
            return PoseSignatureAccess.DebugErrorJson(ex.Message);
        }
    }

    /// <summary>诊断端点数据：槽0时间轴/表情状态/绑定时长（诊断动画通道行为）。</summary>
    public string GetDebugDiag()
    {
        try
        {
            var lines = PoseSignatureAccess.DiagLines();
            return System.Text.Json.JsonSerializer.Serialize(new { pid = Environment.ProcessId, lines });
        }
        catch (Exception ex) { return PoseSignatureAccess.DebugErrorJson(ex.Message); }
    }

    public string GetDebugAnimState()    {
        try
        {
            var (ok, dur, binding, lt) = _sampler.AccessMainControl(0, false);
            var state = new
            {
                pid = Environment.ProcessId, // 双开客户端抢端口时识别当前服务端是哪个游戏进程
                slot0 = _sampler.CurrentSlot0Timeline(),
                emoteId = _sampler.CurrentEmoteId(),
                isEmoting = _sampler.IsEmoting(),
                controlOk = ok,
                duration = Math.Round(dur, 2),
                localTime = Math.Round(lt, 2),
                binding = binding,
                previewMode = _previewMode,
                pendingCommand = _pendingCommand,
                attached = _attached,
                pinMode = PinModeEnabled,
                hasPin = _applicator.HasPin,
                pinnedTimelineId = _applicator.PinnedTimelineId,
                baseOverride = _sampler.ReadBaseOverride(),
                charMode = _sampler.ReadCharMode(),
                idleTimelines = _idleTimelines.ToArray(),
                learned = PoseSignatureAccess.LearnedTimelines.ToDictionary(kv => kv.Key, kv => kv.Value.ToArray()),
                motionPreferred = PoseSignatureAccess.MotionPreferred.ToArray(),
                knownDurations = PoseSignatureAccess.KnownAttachDurations.ToArray()
            };
            return System.Text.Json.JsonSerializer.Serialize(state);
        }
        catch (Exception ex)
        {
            return PoseSignatureAccess.DebugErrorJson(ex.Message);
        }
    }

}
