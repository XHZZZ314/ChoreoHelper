// 姿态签名访问（ARCH2 姿态生命周期拆分，TASK-20260901-ARCH2-POSE-LIFECYCLE）：
// 纯托管组件，无 Dalamud/FFXIVClientStructs 依赖，datalayertest 直测。
// 持有命令→表情行/时间轴的全部进程级缓存与学习/归属判定策略（学习独占、表内归属、
// 规范主轴防引入段污染、诊断环形缓冲）。Emote 表扫描（EnsureEmoteMap）仍由
// AnimationPoseFreezer 用 IDataManager 完成后回填 EmoteMap/TimelineOwners——本组件只管
// 缓存与决策，不做任何游戏/表 IO。所有语义自 AnimationPoseFreezer v0.5.x~v0.7.1 原样迁移，
// 行为逐字节保持（包括日志/Diag 文案与拒绝路径）。
using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Linq;

namespace ChoreoHelper;

/// <summary>命令的表情签名：表情行号、全部时间轴行、是否含循环、同命令行族、是否纯表情分类。</summary>
internal readonly struct EmoteIds
{
    public readonly ushort Emote;
    public readonly ushort[] Timelines;
    public readonly bool AnyLoop;
    public readonly ushort[] EmoteFamily; // 同 TextCommand 的全部表情行号（游戏实际执行的可能是任何变体行）
    public readonly bool IsFacial;        // 表情分类（category=="表情"）：动画在面部骨架不绑主槽0，免定格流程
    public EmoteIds(ushort emote, ushort[] timelines, bool anyLoop, ushort[] family, bool facial)
    { Emote = emote; Timelines = timelines; AnyLoop = anyLoop; EmoteFamily = family; IsFacial = facial; }
}

/// <summary>
/// 姿态签名访问：命令 → 表情行/时间轴的解析缓存、运行时学习缓存与归属判定。
/// 静态进程级状态（与拆分前 AnimationPoseFreezer 的 static 字段一一对应，单实例语义不变）。
/// </summary>
internal static class PoseSignatureAccess
{
    // 运行时学习的实际时间轴：舞蹈等动作走变体机制，实际绑定的槽0时间轴 id 不在
    // Emote 表 ActionTimeline[0..5] 里（如 /breakdance 实际绑 7407）——首次观察到即学习，
    // 之后验证直接通过（不然重试 8 次也挂不上 = "停不住"）
    public static readonly ConcurrentDictionary<string, List<ushort>> LearnedTimelines = new();
    // v0.5.24：表行 [0] = 主时间轴（规范 id）。[1]+ 是引入/上身等辅助变体（绅士之舞
    // [576,575]：576=7.3s 主舞，575=2.5s 引入段）—— 游戏先绑引入段再换绑主轴，
    // 在引入段上挂载学习 = 永远定格在引入段（"动作错的很离谱"的根源）。
    public static readonly ConcurrentDictionary<string, ushort> CanonicalTimelines = new();
    public static readonly ConcurrentDictionary<string, ushort[]> CommandTimelineSets = new();
    // v0.5.26：命令 → 引入段即本体（游戏从不换绑主轴，如游侠姿势 4784 播完不切 4785）。
    // 记忆后该命令直接挂引入段，不再等换绑（首次等待 ~引入段时长，之后瞬时）。
    public static readonly ConcurrentDictionary<string, bool> IntroIsFinalTimelines = new();
    // 游戏解析的变体行时间轴（v0.5.19 关键）：ResolveTargetedEmoteId 给出本角色实际执行的
    // 变体行，其 ActionTimeline[0..5] 才是真实绑定 id —— /tremble 基础行 169 表内只有
    // 6233/6232，解析行 91 的表内是 3123/3124。没有这个并集，集合验证永远失败。
    public static readonly ConcurrentDictionary<string, ushort[]> ResolvedTimelines = new();
    public static readonly ConcurrentDictionary<string, ushort> ResolvedEmoteRow = new(); // 解析出的变体行号（EmoteId 匹配用）
    // 命令的执行通道偏好：ExecuteEmote 被游戏拒绝的表情（如 breakdance）由 motion 兜底
    // 挂载后记住 —— 之后直接走 motion 通道，省去每次 0.5-1s 的无效 ExecuteEmote 尝试
    public static readonly ConcurrentDictionary<string, bool> MotionPreferred = new();
    // GPose 确定性解析缓存（0.5.29）
    public static readonly ConcurrentDictionary<string, ushort> GposeIdCache = new();
    // 命令已确认的挂载动画时长：变体 id 不止一个，时长是变体族的不变量（±0.15s 认定同动画）
    public static readonly ConcurrentDictionary<string, float> KnownAttachDurations = new();

    // 直接表情通道（表情命令）：命令 → 表情行ID + 全部时间轴行ID。
    // 由 AnimationPoseFreezer.EnsureEmoteMap 的 Emote 表扫描回填（本组件不做表 IO）。
    public static ConcurrentDictionary<string, EmoteIds>? EmoteMap;

    // 时间轴 → 拥有它的命令集合（表内权威归属）：跨命令学习污染防护 —— 压测实测
    // /mandervilledance 被学进 /tremble 的 3771（5 个命令共学同一 id），播放污染 id =
    // 直接播出别人的动画 = "不生效"。同样由表扫描回填。
    public static ConcurrentDictionary<ushort, HashSet<string>>? TimelineOwners;

    // 诊断环形缓冲（v0.5.24）：双开客户端抢不到日志文件（另一客户端独占锁定），
    // 关键决策进内存环形缓冲，经 /debug/diag 读取 —— 无日志也能定位"动作错"路径。
    private static readonly ConcurrentQueue<string> _diag = new();
    public static void Diag(string msg)
    {
        _diag.Enqueue($"{DateTime.Now:HH:mm:ss.fff} {msg}");
        while (_diag.Count > 60) _diag.TryDequeue(out _);
    }
    public static string[] DiagLines() => _diag.ToArray();

    /// <summary>调试载荷的错误字节形状（与拆分前各 catch 分支手工拼接逐字节一致）。</summary>
    public static string DebugErrorJson(string message) => "{\"error\":\"" + message.Replace("\"", "'") + "\"}";

    private static readonly object LearnLock = new(); // 学习的独占所有权校验（跨命令污染防线）

    /// <summary>表内归属校验：id 在表内归属其他命令（且不归属本命令）→ 绝不学习/播放。</summary>
    public static bool OwnerAllows(string? command, ushort timelineId)
    {
        if (string.IsNullOrEmpty(command) || TimelineOwners == null) return true;
        if (!TimelineOwners.TryGetValue(timelineId, out var owners)) return true; // 表外 id（真正的变体）不受限
        return owners.Contains(command);
    }

    /// <summary>id 是否表外（调度器生成的链式变体，如黄金之舞的 3770/3771）。</summary>
    public static bool OwnerUnknown(ushort timelineId)
        => TimelineOwners == null || !TimelineOwners.ContainsKey(timelineId);

    public static bool OwnerKnown(ushort timelineId)
    {
        foreach (var kv in LearnedTimelines)
            lock (kv.Value)
                if (kv.Value.Contains(timelineId)) return true;
        return false;
    }

    public static void LearnTimeline(string? command, ushort timelineId)
    {
        if (string.IsNullOrEmpty(command) || timelineId == 0) return;
        if (timelineId == 3) return; // 3 = 标准待机（Brio 同款常量）—— 永远不是动作，杜绝把待机学进缓存
        // v0.5.24：同表辅助变体（引入段）不学 —— 表行 [0] 是主时间轴，[1]+ 是引入/上身
        // 变体（575/6247 实测：学到就永远定格在引入段）。所有学习路径（挂载/状态/残留/
        // motion 确认）统一在此拦截，等主轴上槽后再学 [0]。
        if (CanonicalTimelines.TryGetValue(command, out var canon) && canon != 0 && timelineId != canon
            && CommandTimelineSets.TryGetValue(command, out var set) && Array.IndexOf(set, timelineId) >= 0)
            return;
        if (!OwnerAllows(command, timelineId))
        {
            // 表内归属别的命令 —— 拒学（跨命令污染是"特殊动作不生效/错误"的根源之一）
            return;
        }
        // 独占所有权（v0.5.19）：一个时间轴 id 只属于一个命令。motion 命令有 2-5s 的游戏内
        // 队列延迟 —— 上一轮在途的 motion 会在下一轮的等待期落地，按时间学习必然张冠李戴
        // （实测 /breakdance 的变体 3123 被 /tremble 学走 = 拖到 tremble 播出霹雳舞）。
        // 先学先得；表内归属（OwnerAllows）仍是最终权威。
        lock (LearnLock)
        {
            foreach (var kv in LearnedTimelines)
            {
                lock (kv.Value)
                {
                    if (kv.Value.Contains(timelineId) && kv.Key != command)
                    {
                        return; // 已被别的命令学习 —— 拒绝
                    }
                }
            }
            var list = LearnedTimelines.GetOrAdd(command, _ => new List<ushort>());
            lock (list) { if (!list.Contains(timelineId)) list.Add(timelineId); } // 有序：最近学习的在重试轮换中优先
            Diag($"learn {command} -> {timelineId}");
        }
    }

    /// <summary>命令解析（纯查找，表扫描由调用方先行 EnsureEmoteMap）。失败回 false（走聊天通道兜底）。</summary>
    public static bool TryResolve(string command, out EmoteIds ids)
    {
        ids = default;
        if (string.IsNullOrEmpty(command)) return false;
        if (EmoteMap == null) return false;
        if (!EmoteMap.TryGetValue(command, out ids)) return false;
        return ids.Emote != 0 && ids.Timelines != null && ids.Timelines.Length > 0;
    }

    /// <summary>
    /// /debug/emotefamily 载荷的 owners 部分（纯缓存视图）：每个探针 id 的表内归属命令与
    /// 已学习命令。与拆分前 GetDebugEmoteFamily 内联循环逐字节一致（匿名对象形状不变）。
    /// </summary>
    public static List<object> DescribeOwners(ushort[] probeIds)
    {
        var owners = new List<object>();
        foreach (var id in probeIds)
        {
            string[] tbl = Array.Empty<string>();
            if (TimelineOwners != null && TimelineOwners.TryGetValue(id, out var set))
            { lock (set) tbl = set.ToArray(); }
            string[] lrn = Array.Empty<string>();
            foreach (var kv in LearnedTimelines)
            { lock (kv.Value) if (kv.Value.Contains(id)) { lrn = lrn.Append(kv.Key).ToArray(); } }
            owners.Add(new { id, table = tbl, learnedBy = lrn });
        }
        return owners;
    }
}
