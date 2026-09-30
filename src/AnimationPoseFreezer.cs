using System;
using System.Collections.Concurrent;
using Dalamud.Plugin.Services;
using FFXIVClientStructs.FFXIV.Client.Game.Character;
using FFXIVClientStructs.FFXIV.Client.Graphics.Scene;
using Lumina.Excel.Sheets;

namespace ChoreoHelper;

/// <summary>
/// 动画定格器：把角色当前动画的播放时间(LocalTime)拨到指定秒数并持续保持。
/// 用于"拖动时间轴 → 角色定格在某个动作的某个时刻"的实时预览。
/// 槽位访问参考 SimpleHeels DoEmoteSync：character->DrawObject(Human)->Skeleton->PartialSkeletons[0]->GetHavokAnimatedSkeleton(0)->AnimationControls[0]
/// v0.5.5（修"部分动作抽搐+停不住"）：
///  - 三层停表防御：只冻结主控制槽不可靠 —— 游戏每帧会重算/覆盖各槽速度（Brio 为此专门
///    hook 了 CalculateAndApplyOverallSpeed），被覆盖后动画偷偷推进到结尾 → 游戏判动作结束
///    换绑 → 自愈重播 → 循环（表现为"停不住"+"抽搐"）。现在：
///    1) Timeline.OverallSpeed=0（Brio 同款字段：游戏自己把整体速度应用到所有槽+粒子）
///    2) 全部控制槽 PlaybackSpeed=0（伴随槽不冻结会继续动/触发结束判定）
///    3) 主槽 LocalTime 漂移校正：速度被覆盖时按需拉回（>30ms 才写，不每帧对抗）
///  - 挂载验证接受表情的全部时间轴变体（部分动作实际绑定的不是 ActionTimeline[0]，
///    单 id 验证永不通过 → 永不钉时间 = "停不住"）
/// v0.5.4：
///  - 表情命令走 EmoteManager.ExecuteEmote 直接通道（即时、无聊天节流、状态机注册、不刷聊天）
///  - GetSlotTimeline(0) 确定性挂载验证；根治回拖盲挂旧动画（错误动作）
/// v0.5.3 保留：H1 移动锚点解除；H2 切图清理；自愈换绑；LocalTime 钳制；按变化写入
/// ARCH2 姿态生命周期拆分（TASK-20260901-ARCH2-POSE-LIFECYCLE，2026-09）：签名缓存/学习
/// 策略拆至 PoseSignatureAccess（纯托管），采样探针拆至 PoseSampler，钉住/停表/表情通道
/// 写入拆至 PoseApplicator，请求/停止生命周期决策拆至 PreviewSessionLifecycle（纯托管）。
/// 本类保留公共门面（HttpServer/PlaybackManager/GameShowDispatcher/Plugin 调用面不变）与
/// 挂载/保持状态机编排；除委托点外行为逐字节保持。
/// OVERHAUL 批 C 第二步（2026-09-29）：GPose 精确编辑模式与调试/诊断端点按层拆至本类
/// 分部 AnimationPoseFreezer.Gpose.cs / AnimationPoseFreezer.Debug.cs（partial，行为逐字不变）。
/// OVERHAUL 批 C 第三步（2026-09-29）：Emote 表解析层与时长测量层按层拆至本类分部
/// AnimationPoseFreezer.EmoteMap.cs / AnimationPoseFreezer.Measure.cs（partial，行为逐字不变）。
/// OVERHAUL 批 C 第四步（2026-09-29）：挂载/学习状态机主体与执行辅助群按层拆至本类分部
/// AnimationPoseFreezer.StateMachine.cs（partial，行为逐字不变）。
/// </summary>
public unsafe sealed partial class AnimationPoseFreezer : IDisposable
{
    private readonly IPluginLog _log;
    private readonly IObjectTable _objectTable;
    private readonly IFramework _framework;
    private readonly GameCommandExecutor _executor;
    private GameOutputLease? _previewLease;
    private object OutputLock => _executor.OutputOwnership.SyncRoot;
    private bool _disposed;
    private int _pendingOutputCallbacks;
    private long _outputGeneration;
    private readonly List<(GameOutputLease Lease, System.Action Action, IReadOnlyList<GameOutputLease>? Additional)> _failedOutputCleanup = new();
    private readonly IDataManager _dataManager;

    // ARCH2 拆分组件：采样（游戏对象只读探针）/ 应用（钉住+停表+表情通道写入）/
    // 会话生命周期（请求去抖、世代号、结算、Dispose 决策；纯托管可直测）
    private readonly PoseSampler _sampler;
    private readonly PoseApplicator _applicator;
    private readonly PreviewSessionLifecycle _lifecycle;

    // 待机时间轴 id 集合（学习排除）：过渡窗口里"EmoteId 已是新表情但动画还没绑上"时
    // 槽0 是待机 —— 学习路径会把待机 id 学进缓存（曾实际发生：learned timeline 3）。
    // 污染后该表情永远验证"通过"并钉在待机上 = 吞动作；且越拖污染越多。
    private readonly HashSet<ushort> _idleTimelines = new();
    private bool _wasEmoting;                  // 表情状态机下降沿检测（回归一致性待机采集）
    private double _postEmoteCheckAt = -1;     // 表情结束后 1s 的回归采样时刻（-1=无任务）
    private ushort _postEmoteBaseCandidate;    // 上次表情结束后的槽0 基线候选
    private int _postEmoteBaseSources;         // 已见过回到候选基线的（不同）表情次数
    private ushort _learnCandidate;      // 学习路径 C 的候选 id（连续稳定帧计数）
    private int _learnCandidateFrames;
    private ushort _residualCandidate;   // 残留确认学习的候选 id（连续稳定帧计数）
    private int _residualCandidateFrames;
    private ushort _chainCandidate;      // 链式学习（A3）的候选 id（连续稳定帧计数）
    private int _chainCandidateFrames;
    private ushort _stCandidate;         // 状态转移学习（A'）的候选 id（连续稳定帧计数）
    private int _stCandidateFrames;
    private bool _sawFamSinceExec;       // 本轮执行后表情状态机确认过族内 EmoteId（执行被接受）
    private bool _chainFromFam;          // 族内 EmoteId → 族外 EmoteId 的转移已发生（链式舞蹈签名）
    private ushort _motionSentSlot0 = ushort.MaxValue; // 每条 motion 命令发出时刻的槽0快照：
    // motion 生效的证据是槽0变成"≠发出时的值"。等待期槽0=待机(3)且与快照相同 → 不是 motion 的产物，
    // 绝不能学（曾把待机 3 学进缓存 → 之后永远挂待机 = 吞动作）
    private ushort _playedTimelineId;   // 本轮通过 PlayActionTimeline 直接强制的时间轴 id（0=未用该通道）
    private ushort _bowEmoteId;         // /bow 的表情行号（motion 循环打断器用 —— 表情通道可逐出循环调度器）
    private double _motionResendAt;     // bow 打断后的 motion 补发时刻（0=无任务）—— bow 忙窗口会吞同帧命令
    private int _motionResendCount;     // 本轮 motion 补发次数（≤2，防风暴）
    private int _playIdx;               // PlayTimeline 重试的候选轮换索引（失败换族内下一个 id）
    private string _execChannel = "";   // 本轮执行通道（learned/emote/motion，日志用）
    private bool _facialOnly;           // 面部表情类：动画在面部骨架不绑主槽0 —— 执行确认即完成，不进主槽定格
    private double _execStartedAt;      // 本轮执行发起时刻（不随 retry 重置 —— 面部类判定需要跨越 retry 的稳定计时）
    private bool _gaveUp;               // 有界放弃：命令已发完仍未挂载，静默等待（防无限兜底命令风暴）
    private bool _lastWasLoop;          // 上个执行的是循环姿态型动作（坐地/躺椅等）—— 切换时需强制解除

    // （钉住会话状态 _applicator.HasPin/_applicator.PinnedTimelineId 等已随 Brio 钉住原语迁入 PoseApplicator；
    //  学习/解析缓存与通道偏好已迁入 PoseSignatureAccess。）


    // 当前"定格预览"状态
    private bool _previewMode;
    private string? _pendingCommand;
    private float _pendingTime;

    // 上次执行的定格命令；命令变化或动作被游戏结束时才重新执行
    private string? _lastCommand;

    // 直接表情通道（表情命令）：命令 → 表情行ID + 全部时间轴行ID（缓存迁至 PoseSignatureAccess.EmoteMap）
    private ushort[] _awaitTimelineIds = Array.Empty<ushort>(); // 等待挂载的时间轴集合（空=聊天通道）
    private ushort _canonicalTimeline;  // 表行 [0] 主时间轴（0=无规范）：引入段占槽时等它换绑，学习只认它
    private ushort _awaitEmoteId;      // 对应的表情行ID（重试用）
    private ushort _diagLastWaitSlot;  // 诊断去重：canonWait 上次记录的槽0 值
    private double _diagLastWaitAt;    // 诊断去重：canonWait 上次记录时刻
    private bool _observedRowMerged;   // 已把游戏解析出的变体行合并进等待集合（本命令）
    private double _observedRowAt;     // 变体行合并时刻（canonWait 窗口顺延）
    private double _introBoundAt = -1; // 引入段绑定时刻（-1=未绑定）
    private float _introDur;           // 引入段时长快照（读数最大值自修正）
    private double _introEndedAt = -1; // 引入段播完时刻（-1=引入段还在播/未开始等）
    private uint _lastMergeRejectKey;  // 诊断去重：上次拒绝合并的行号
    private ushort[] _awaitEmoteFamily = Array.Empty<ushort>(); // 同命令全部表情行号（状态机确认用族匹配）
    private bool _awaitIsLoop;         // 该表情含循环时间轴（定格目标时间需按单轮时长取模）
    private ushort _preExecSlot0;      // 执行前的槽0时间轴 id（学习实际绑定用：重试后变成且稳定的值=该表情实际绑定）
    private ushort _preExecEmoteId;    // 执行前的表情行 id（变体行合并排除残留表情）
    private int _directAttempts;       // 直接通道重试次数
    private int _chatRetries;          // 聊天通道超时重发次数

    // 挂载状态：_attached=false 时轮询等待新动画绑定到控制槽
    private bool _attached;
    private float _preExecDuration = -1f; // 执行命令前槽上绑定的动画时长（旧动作/待机）
    private long _preExecBinding;         // 执行命令前的绑定指针
    private float _attachDuration = -1f;  // 挂载的动画真实时长（用于检测游戏换绑回待机）
    private long _attachBinding;          // 挂载时的绑定指针（指针变化=换绑，比时长更精确）
    private bool _needsReexec;            // 检测到换绑（动作被游戏结束），下次请求/本帧自愈时重发命令
    private double _lastExecTime;         // 上次执行命令时刻（秒），自愈重发最小间隔用
    private float _lastWrittenTime = -1f; // 上次成功写入的 LocalTime
    private double _lastProbe;            // 上次低频绑定安全检查时刻

    // 拖动流分离：前端拖动每 50-70ms 一发 seek，若每个中间命令都全量执行（快进释放+执行），
    // 一秒十几个动作互相打断 → 排队风暴+动画错乱（回拖"动作丢失/错误"主因）。
    // 拖动流中只记最新目标，流停 150ms 后统一执行一次 —— 簿记与判定在 _lifecycle（PreviewSessionLifecycle）。

    /// <summary>已实测的动画时长（命令 → 秒）。预览/定格/播放时自动累积，前端用于显示与校正 clip 时长。</summary>
    public static ConcurrentDictionary<string, float> MeasuredDurations { get; } = new();

    // H1：持续移动检测锚点（1 秒窗口内位移超阈值 = 玩家在走路）
    private System.Numerics.Vector3 _anchorPos;
    private double _anchorTime;
    private bool _hasAnchor;

    // H2：本地玩家地址跟踪（切图/传送/重登时对象销毁重建）
    private nint _lastLocalAddress;

    // P1 修复：float 存 epoch 秒在 ~1.75e9 量级下 ULP≈128ms，短时比较完全失真；
    // 改用 TickCount64 单调时钟换算 double 秒，精度足够
    private double Now() => Environment.TickCount64 / 1000.0;

    public bool IsPreviewMode => _previewMode;

    public AnimationPoseFreezer(IPluginLog log, IObjectTable objectTable, IFramework framework,
        GameCommandExecutor executor, IDataManager dataManager)
    {
        _log = log;
        _objectTable = objectTable;
        _framework = framework;
        _executor = executor;
        _dataManager = dataManager;
        _sampler = new PoseSampler(log, objectTable);
        _applicator = new PoseApplicator(log, objectTable, _sampler);
        _lifecycle = new PreviewSessionLifecycle(Now);
        _framework.Update += OnFrameworkUpdate;
    }

    private bool DirectPending => _awaitTimelineIds.Length > 0;

    /// <summary>游戏当前表情是否属于我们请求的命令（族匹配 ∪ 游戏解析的变体行：
    /// /tremble 实际执行行 91 —— 不在 TextCommand 族内，由 ResolveTargetedEmoteId 链接）。</summary>
    private bool AwaitingEmote()
    {
        if (_awaitEmoteFamily.Length == 0) return false;
        var cur = (ushort)_sampler.CurrentEmoteId();
        if (Array.IndexOf(_awaitEmoteFamily, cur) >= 0) return true;
        return _pendingCommand != null
            && PoseSignatureAccess.ResolvedEmoteRow.TryGetValue(_pendingCommand, out var rr)
            && rr == cur;
    }

    /// <summary>id 是否属于该命令的期望时间轴（Emote 表集合 ∪ 运行时学习集合）。</summary>
    private bool Awaiting(string? command, ushort timelineId)
    {
        if (timelineId == 0 || string.IsNullOrEmpty(command)) return false;
        if (Array.IndexOf(_awaitTimelineIds, timelineId) >= 0) return true;
        return PoseSignatureAccess.LearnedTimelines.TryGetValue(command, out var learned) && learned.Contains(timelineId);
    }

    // ---- 采样/写入原语（TryGetLocalCharacter/CurrentSlot0Timeline/CurrentEmoteId/IsEmoting/
    //      SetAllControlSpeeds/ExecuteEmoteDirect/AccessMainControl 等）已迁至
    //      PoseSampler（只读探针）与 PoseApplicator（钉住/停表/表情通道写入）----

    /// <summary>
    /// 请求定格预览：执行动作命令（命令变化或动作已被游戏结束时），并把动画时间拨到 targetTime 保持。
    /// 表情命令走直接表情通道；/ac 技能等无法映射的命令走聊天通道。
    /// 拖动流（请求间隔 &lt;150ms）中的命令变化不立即执行 —— 只记最新目标，
    /// 流停后由 OnFrameworkUpdate 统一执行（防止一秒十几个动作互相打断）。
    /// M4：状态变更委托到游戏线程执行，避免 HTTP 线程与游戏线程并发读写。
    /// </summary>

    public void RequestFreezePreview(string command, float targetTime)
    {
        lock (OutputLock)
        {
            if (_disposed || _pendingOutputCallbacks != 0 || _failedOutputCleanup.Count != 0 || (_previewLease?.IsCurrent != true
                && !_executor.OutputOwnership.TryAcquireLegacy("freeze-preview", out _previewLease))) return;
            var lease = _previewLease!; var gen = _lifecycle.Generation;
            _ = _framework.RunOnFrameworkThread(() => lease.TryRun(() =>
            {
                if (_disposed || gen != _lifecycle.Generation) return false;
                FreezeRequestCore(command, targetTime);
                return true;
            }));
        }
    }

    /// <summary>
    /// 拖动流中的"停止预览"（落在空隙）：立即恢复速度会让旧动画在拖动中乱播，
    /// 与命令一样延迟到结算时再停。非拖动状态立即停。
    /// </summary>
    public void RequestStopPreview()
    {
        lock (OutputLock) RequestStopPreviewCore();
    }

    private void RequestStopPreviewCore()
    {
        var lease = _previewLease;
        if (lease == null) return;
        var gen = _lifecycle.Generation;
        _framework.RunOnFrameworkThread(() => lease.TryRun(() =>
        {
            if (gen != _lifecycle.Generation) return false;
            _lifecycle.MarkActivity();
            if (!_previewMode && !_lifecycle.HasDeferred) { StopPreview(); return true; }
            if (_lifecycle.ShouldDeferStop())
            {
                _lifecycle.DeferStop();
                return true;
            }
            StopPreview();
            return true;
        }));
    }

    private void FreezeRequestCore(string command, float targetTime, bool force = false)
    {
        // GPose 精确模式旁路（0.5.29）：确定性管线直达，跳过等待/学习/重试全套机制。
        // 空命令（停止）走正常停止路径。
        if (_gposeActive && !string.IsNullOrEmpty(command))
        {
            GposeFreeze(command, targetTime);
            return;
        }
        var rapid = _lifecycle.BeginRequest(force); // 拖动流中（不依赖 preview 状态：空隙位置会 StopPreview 打断链）

        if (PreviewSessionLifecycle.ShouldDeferCommandChange(rapid, _lastCommand, command, _needsReexec))
        {
            // 拖动流中的命令变化：记最新目标，等流停/驻留。同一命令（clip 内拖动）不延迟 —— 实时拨时间
            _lifecycle.DeferCommand(command, Math.Max(0, targetTime));
            return;
        }
        _lifecycle.ClearDeferred();

        // 命令变化、或动作已被游戏结束（换绑回待机）才重新执行；
        // 同一动作连续拖动只拨时间、不重播也不重置挂载等待
        var prevRoundWasLoop = _lastWasLoop; // 上一轮是否循环动作（本行必须在下面覆盖前读取）
        if (_lastCommand != command || _needsReexec)
        {
            // 钉住会话先解除（恢复原 Mode/BaseOverride）—— 后续命令要走正常状态机执行
            _applicator.Unpin(blendToIdle: false, _idleTimelines);
            // v0.5.22：切换时不再预防性 bow 打断 —— 实测真实使用里槽上常是普通动画
            // （走路/姿态变体等表外 id），预防性打断 = 几乎每次切换都放 bow（用户实测
            // "错误特别多"的根源）。改为卡住才打断：重试时刻仍绑不上且槽上是循环
            // 时间轴才 bow（见 AttachPhase 重试块），正常切换零打断
            _applicator.SetAllControlSpeeds(1f); // 恢复全部槽速度，让新动作能正常绑定起播
            // 释放旧 emote 状态机：三层停表把旧动画钉得太彻底时，游戏的表情状态机
            // 在等旧动画"播完"才接受新表情（ExecuteEmote 和聊天命令都会被拒 ——
            // slot0 卡在旧绑定、重试 8 次也不换）。把旧动画 LocalTime 快进到末尾，
            // 游戏下一帧即判定播完、结束旧 emote，新表情畅通
            var preFast = _sampler.AccessMainControl(0, false);
            if (preFast.Ok && preFast.Duration > 0.05f)
                _sampler.AccessMainControl(preFast.Duration, true);
            // 表情状态机完整解锁（v0.5.19）：EmoteId=0 + 退出 EmoteLoop/InPositionLoop 模式。
            // 只清 EmoteId 不够 —— 舞蹈类把 Mode 留在循环姿态，ExecuteEmote 从此被游戏拒绝
            // （要求先起立，而清了 EmoteId 后游戏的起立流程永远不会发生）= "跳过一次舞后
            // 再拖任何动作都不生效"的死锁。Mode=Normal 即刻解锁。
            _applicator.ResetEmoteState(_idleTimelines);
            _lastWasLoop = false;
            // 只清自己这条链路的旧/新命令副本（旧实现 Clear() 会连带丢掉播放/演出/录制
            // 链路已入队的命令——共享队列不能整条清，2026-08-31 审计 P1）
            _executor.RemoveWhere(c => c == command || c == _lastCommand); // 防旧动作插队
            _directAttempts = 0;
            _chatRetries = 0;
            _learnCandidate = 0;
            _learnCandidateFrames = 0;
            _residualCandidate = 0;
            _residualCandidateFrames = 0;
            _chainCandidate = 0;
            _chainCandidateFrames = 0;
            _stCandidate = 0;
            _stCandidateFrames = 0;
            _sawFamSinceExec = false;
            _chainFromFam = false;
            _motionResendAt = 0;
            _motionResendCount = 0;
            _playIdx = 0;
            _facialOnly = false;
            _gaveUp = false;
            _observedRowMerged = false;
            _introBoundAt = -1;
            _introDur = 0;
            _introEndedAt = -1;
            var direct = TryResolveEmote(command, out var ids);
            if (direct)
            {
                _awaitTimelineIds = ids.Timelines;
                // 游戏自己的变体解析并集（v0.5.19）：解析行的表内时间轴才是本角色的真实 id。
                // 每命令只解析一次（缓存）—— 同角色稳定。
                if (!PoseSignatureAccess.ResolvedTimelines.TryGetValue(command, out var resolvedTls))
                {
                    resolvedTls = Array.Empty<ushort>();
                    try
                    {
                        var r = _sampler.ResolveTargetedEmote(ids.Emote);
                        if (r != 0 && Array.IndexOf(ids.EmoteFamily, (ushort)r) < 0)
                        {
                            PoseSignatureAccess.ResolvedEmoteRow[command] = (ushort)r;
                            var sheet = _dataManager.GetExcelSheet<Emote>();
                            var row = sheet.GetRow((uint)r);
                            var list = new List<ushort>();
                            for (var i = 0; i < 6; i++)
                            {
                                try
                                {
                                    var t = row.ActionTimeline[i];
                                    if (t.IsValid) list.Add((ushort)t.RowId);
                                }
                                catch { }
                            }
                            resolvedTls = list.ToArray();
                            if (resolvedTls.Length > 0)
                                _log.Information("Freeze: resolved variant row {r} for {cmd}, timelines [{t}]", r, command, string.Join(",", resolvedTls));
                        }
                    }
                    catch { }
                    PoseSignatureAccess.ResolvedTimelines[command] = resolvedTls;
                }
                if (resolvedTls.Length > 0)
                {
                    // 并集去重
                    var union = new List<ushort>(_awaitTimelineIds);
                    foreach (var t in resolvedTls) if (!union.Contains(t)) union.Add(t);
                    _awaitTimelineIds = union.ToArray();
                }
                // v0.5.24 规范化：主时间轴 = 游戏解析行的 [0]（无解析行则用表行 [0]）。
                // 引入段（[1] 号）先上槽是游戏自己的起播顺序，挂载/学习都必须等主轴。
                _canonicalTimeline = resolvedTls.Length > 0 ? resolvedTls[0]
                    : (ids.Timelines.Length > 0 ? ids.Timelines[0] : (ushort)0);
                PoseSignatureAccess.CommandTimelineSets[command] = _awaitTimelineIds;
                if (_canonicalTimeline != 0)
                {
                    PoseSignatureAccess.CanonicalTimelines[command] = _canonicalTimeline;
                    // 自愈：洗掉历史上学到过的同表辅助变体（引入段污染条目）
                    if (PoseSignatureAccess.LearnedTimelines.TryGetValue(command, out var polluted))
                        lock (polluted)
                            polluted.RemoveAll(id => id != _canonicalTimeline && Array.IndexOf(_awaitTimelineIds, id) >= 0);
                }
                else
                    PoseSignatureAccess.CanonicalTimelines.TryRemove(command, out _);
                _awaitEmoteId = ids.Emote;
                _awaitEmoteFamily = ids.EmoteFamily;
                _awaitIsLoop = ids.AnyLoop;
                // 执行通道阶梯（全部保证正确变体）：
                // 1) 学习过的 id → 直接强制（游戏自己绑定过的变体，瞬时且正确）
                // 2) ExecuteEmote → 游戏按种族/性别/职业解析正确变体（绝大多数 1-3 帧）
                // 3) motion 变体命令 → 同样由游戏解析（~2s，顽固表情首次）
                // 绝不直接播表内原始 id —— 特殊类表情族里有其他种族/性别的变体行，
                // 播错变体会通过家族集合验证（id 在集合内）但视觉上是错误动作
                _playedTimelineId = 0;
                _facialOnly = ids.IsFacial; // 表情分类：免定格流程（执行后即完成）
                _lastWasLoop = ids.AnyLoop && !_facialOnly; // 循环姿态型：切换时需强制解除（记录给下次切换用）
                var hasLearned = PoseSignatureAccess.LearnedTimelines.TryGetValue(command, out var lrn) && lrn.Count > 0;
                if (_facialOnly)
                {
                    _execChannel = "facial";
                    _applicator.ExecuteEmoteDirect(ids.Emote);
                }
                else if (hasLearned)
                {
                    if (PinModeEnabled)
                    {
                        // 学习过的 id → 直接钉住（Brio 架构）：BaseOverride+AnimLock 立即接管基础槽，
                        // 不再走表情状态机（无忙窗口、无结束计时器、无姿态锁）—— 回拖命中已学命令瞬时且确定
                        var pinOk = false;
                        if (PoseSignatureAccess.LearnedTimelines.TryGetValue(command, out var lrn2))
                        {
                            lock (lrn2)
                            {
                                foreach (var id in lrn2)
                                {
                                    if (!PoseSignatureAccess.OwnerAllows(command, id) || id == 3 || _idleTimelines.Contains(id)) continue;
                                    if (_applicator.TryPinTimeline(id, triggerBind: true)) { pinOk = true; break; }
                                }
                            }
                        }
                        if (pinOk) _execChannel = "pin-learned";
                        else
                        {
                            TryPlayTimelinePreferred(command);
                            _execChannel = "learned";
                        }
                    }
                    else if (prevRoundWasLoop)
                    {
                        // v0.5.26：上一轮是循环动作（残留调度未清）—— 裸 PlayActionTimeline
                        // 会被调度器丢弃（实测循环舞后 learned 直播 0.8s 不绑定，白等一轮
                        // 重试）。直接走表情通道，由游戏正规换绑。
                        _applicator.ExecuteEmoteDirect(_awaitEmoteId);
                        _execChannel = "emote";
                        PoseSignatureAccess.Diag($"exec {command}: skip learned direct play (prev round was loop)");
                    }
                    else
                    {
                        // 经典引擎（v0.5.11 行为族）：直接强制学习过的 id，走集合验证挂载
                        TryPlayTimelinePreferred(command);
                        _execChannel = "learned";
                    }
                }
                else if (PoseSignatureAccess.MotionPreferred.TryGetValue(command, out var mp) && mp)
                {
                    ExecuteMotionFallback();
                    _execChannel = "motion";
                }
                    else
                    {
                        _applicator.ExecuteEmoteDirect(ids.Emote);
                        _execChannel = "emote";
                    }
                    PoseSignatureAccess.Diag($"exec {command}: ch={_execChannel} canon={_canonicalTimeline} set=[{string.Join(",", _awaitTimelineIds)}] learnedN={(PoseSignatureAccess.LearnedTimelines.TryGetValue(command, out var lrn3) ? lrn3.Count : 0)}");
            }
            else
            {
                _awaitTimelineIds = Array.Empty<ushort>();
                _canonicalTimeline = 0;
                _awaitEmoteId = 0;
                _awaitIsLoop = false;
                _executor.ExecuteCommand(command, _previewLease);
            }
            _lastCommand = command;
            _lastExecTime = Now();
            _execStartedAt = Now();
            _needsReexec = false;
            _attached = false; // 等新动画挂载
            var pre = _sampler.AccessMainControl(0, false);
            _preExecDuration = pre.Duration;
            _preExecBinding = pre.Binding;
            _preExecSlot0 = _sampler.CurrentSlot0Timeline();
            _preExecEmoteId = (ushort)_sampler.CurrentEmoteId();
            _attachDuration = -1f;
            _lastWrittenTime = -1f;
            // 时长缓存不取挂载瞬间读数（过渡期不准，如 /bow 起播瞬间读到 3.00 而非 3.57），
            // 统一延迟 0.8s 绑定稳定后由 ProcessPendingMeasures 测量
            if (direct && PoseMeasureQueue.CanEnqueue(_pendingMeasures.Count))
                _pendingMeasures.Add((command, Now() + 0.8));
            _log.Information("Freeze preview({0}/{1}): {2} at t={3:F2}s", direct ? "direct" : "chat", _execChannel, command, Math.Max(0, targetTime));
        }
        _previewMode = true;
        _pendingCommand = command;
        _pendingTime = Math.Max(0, targetTime);
    }

    /// <summary>
    /// 退出定格预览模式，恢复角色自由播放。
    /// 表情由状态机管理：恢复全部槽速度后自然播放完毕回归待机，无需手动清除。
    /// </summary>
    public void StopPreview()
    {
        lock (OutputLock) StopPreviewCore();
    }

    private void StopPreviewCore()
    {
        // FIX-E 线程契约：本方法任何线程可调（HTTP 停止定格/播放闸、框架线程 Update/Dispose）。
        // 纯状态字就地更新；Unpin/SetAllControlSpeeds 碰游戏内存，统一调度进框架线程
        //（已在框架线程则就地执行，语义与旧版一致）。不等待调度完成——调用方（如持有
        // _stateLock 的 PlaybackManager.Play）不会被框架线程反向阻塞。
        _lifecycle.AdvanceGeneration(); // 丢弃仍在 framework 队列里的旧 FreezeRequestCore（停止后被复活 = cleanup 竞态）
        _lifecycle.MarkActivity();
        var lease = _previewLease; _previewLease = null;
        if (!_previewMode)
        {
            _lifecycle.ClearDeferred();
            lease?.Dispose();
            return;
        }
        ClearPreviewSessionState();
        RunOnGameThread(() =>
        {
            _applicator.RestorePreviewOrThrow(_idleTimelines);
            _log.Information("Freeze preview native cleanup confirmed");
        }, lease, cleanup: true);
        _log.Information("Freeze preview stop requested; native cleanup must complete before output ownership is returned");
    }

    private void ClearPreviewSessionState()
    {
        _previewMode = false;
        _pendingCommand = null;
        _lastCommand = null;
        _attached = false;
        _lifecycle.ClearDeferred();
        _awaitTimelineIds = Array.Empty<ushort>();
        _awaitEmoteId = 0;
        _awaitIsLoop = false;
    }

    /// <summary>结束插件自己的 GPose/预览写入会话；不发送 /gpose，不改变用户引擎设置。</summary>
    public void StopAllOutputSessions(bool retryFailedCleanup)
    {
        lock (OutputLock)
        {
            _outputGeneration++; // 尚未进入的非清理原生回调不能在停止后复活。
            _lifecycle.AdvanceGeneration(); _lifecycle.MarkActivity();
            var leases = new List<GameOutputLease>();
            void Keep(GameOutputLease? lease) { if (lease != null && !leases.Contains(lease)) leases.Add(lease); }
            Keep(_previewLease); Keep(_gposeLease);
            var needsRestore = _applicator.HasPreviewWriteWitness;
            _previewLease = _gposeLease = null; _gposeActive = false;
            ClearPreviewSessionState();
            if (!needsRestore)
            {
                // 租约不等于已写游戏内存。尚未进入的预览或只打开 GPose 不应写速度 1。
                // 既有未知失败仍保留；不能靠无见证把失败租约当作清理成功归还。
                foreach (var lease in leases)
                {
                    var failed = _failedOutputCleanup.Exists(item => ReferenceEquals(item.Lease, lease)
                        || (item.Additional != null && item.Additional.Contains(lease)));
                    if (!failed) lease.Dispose();
                }
                return;
            }
            if (retryFailedCleanup)
            {
                // 只取进入时已有失败；本次新失败绝不再次尝试，也不重放失败的旧业务动作。
                var previous = _failedOutputCleanup.ToArray();
                _failedOutputCleanup.Clear();
                foreach (var item in previous)
                {
                    Keep(item.Lease);
                    if (item.Additional != null) foreach (var additional in item.Additional) Keep(additional);
                }
            }
            var primary = leases.Count == 0 ? null : leases[0];
            var additionalLeases = leases.Count <= 1 ? Array.Empty<GameOutputLease>() : leases.GetRange(1, leases.Count - 1).ToArray();
            RunOnGameThread(() => _applicator.RestorePreviewOrThrow(_idleTimelines), primary, cleanup: true, additionalLeases);
        }
    }

    /// <summary>
    /// 外部触发表情前的"卫生序列"（v0.6.3，录制管线 48795 /export/clip 用）：
    /// 解除钉住 → 恢复槽速度 → 把槽0旧动画 LocalTime 快进到末尾（游戏下一帧判定播完
    /// 并解绑——舞蹈循环绑死 slot0 的根治解法，见 FreezeRequestCore 同款逻辑）→
    /// 表情状态机解锁 → 无条件重绑主待机占住 slot0（v0.6.4：快进解绑后的 ~200ms 命令
    /// 空窗里旧循环会回绑，待机占位后新命令才能正常绑定）。在框架线程执行，调用方随后
    /// 发出的命令会在下一拍正常落地。
    /// 2026-08-28 实测背景：主人游戏内放过带舞的时间轴后，拉拉菲尔舞变体（行108/
    /// 时间轴3184）循环绑死 slot0，此后 /export/clip 录到的全是污染数据（全骨架噪声、
    /// 20s 不静止收尾）；每次录制前跑一遍此序列即可得到干净窗口。
    /// 注意：这里故意不调 _executor.Clear()——调用方（录制服务）刚把录制命令入队，
    /// 清队列会误删它。
    /// </summary>
    public void PrepareForExternalEmote()
    {
        lock (OutputLock) PrepareForExternalEmoteCore();
    }

    private void PrepareForExternalEmoteCore()
    {
        if (_disposed || _pendingOutputCallbacks != 0 || _failedOutputCleanup.Count != 0) return;
        RunOnGameThread(() =>
        {
            try
            {
                _applicator.Unpin(blendToIdle: false, _idleTimelines);
                _applicator.SetAllControlSpeeds(1f);
                var preFast = _sampler.AccessMainControl(0, false);
                if (preFast.Ok && preFast.Duration > 0.05f)
                    _sampler.AccessMainControl(preFast.Duration, true);
                _applicator.ResetEmoteState(_idleTimelines);
                // v0.6.4：无条件把主待机钉回 slot0。快进"解绑"到录制命令落地之间有 ~200ms
                // 空窗，旧循环（拉拉菲尔舞 3184）会立刻回绑占位，且 motion 通道对"槽上已有
                // motion"去重拒收——v0.6.3 只快进不解绑后患如此。ResetEmoteState 的 idle 重绑
                // 只在 EmoteLoop/InPositionLoop 分支里，本死锁 charMode=Normal 落在外面，故这里
                // 无条件重绑。_idleTimelines 是运行时学习集（重启后为空），兜底标准待机 id 3
                // （Brio 同款常量，见 LearnTimeline 排除注释）。
                var idleId = PoseSessionPolicy.PickIdleId(_idleTimelines);
                _applicator.RebindIdle(idleId);
                _log.Information("Freezer: prepared actor for external emote (preFast {ok} {d:F2}s, idle rebind {idle})",
                    preFast.Ok, preFast.Ok ? preFast.Duration : 0f, idleId);
            }
            catch (Exception ex) { _log.Error(ex, "PrepareForExternalEmote failed"); }
        });
    }

    /// <summary>
    /// 播放通道防堵（v0.6.5，v0.5 时间轴 ExecuteClip 发命令前调用）：表情通道被
    /// "非待机的循环"占住时（僵尸绑定签名：isEmoting + slot0 是 IsLoop 且不在待机集），
    /// 新命令会被游戏去重拒收——2026-08-28 实测僵尸态下 v0.5 播放/主人手动 /bow 全部
    /// 落空。此时跑与录制卫生序列同款的解堵（快进旧循环→清表情状态→待机占位）。
    /// 正常状态（槽上是一次性动作或待机）什么都不做，v0.5 原语义零改动。
    /// 排队进框架线程执行；调用方命令经执行器 ≥200ms 节流后落地，顺序有保证
    /// （与录制管线 PrepareForExternalEmote 同一时序模型）。
    /// </summary>
    public void PrepareForPlaybackCommand()
    {
        lock (OutputLock) PrepareForPlaybackCommandCore();
    }

    private void PrepareForPlaybackCommandCore()
    {
        if (_disposed || _pendingOutputCallbacks != 0 || _failedOutputCleanup.Count != 0) return;
        RunOnGameThread(() =>
        {
            try
            {
                var slot0 = _sampler.CurrentSlot0Timeline();
                if (!PoseSessionPolicy.ShouldUnblockForCommand(slot0, _idleTimelines.Contains(slot0), IsLoopTimeline(slot0), _sampler.IsEmoting())) return;
                _applicator.Unpin(blendToIdle: false, _idleTimelines);
                _applicator.SetAllControlSpeeds(1f);
                var pre = _sampler.AccessMainControl(0, false);
                if (pre.Ok && pre.Duration > 0.05f)
                    _sampler.AccessMainControl(pre.Duration, true);
                _applicator.ResetEmoteState(_idleTimelines);
                var idleId = PoseSessionPolicy.PickIdleId(_idleTimelines); // 标准待机兜底（学习集可能为空）
                _applicator.RebindIdle(idleId);
                _log.Information("Freezer: unblocked emote channel for playback (slot0={s}, idle rebind {i})", slot0, idleId);
            }
            catch (Exception ex) { _log.Error(ex, "PrepareForPlaybackCommand failed"); }
        });
    }

    // IsLoopTimeline 已迁 AnimationPoseFreezer.EmoteMap.cs 分部；缓存字段（带初始化器的静态字段不跨件搬）留主件。
    private static readonly ConcurrentDictionary<ushort, bool> _loopTimelineCache = new();

    // （时间轴归属索引 TimelineOwners、归属校验 OwnerAllows/OwnerUnknown/OwnerKnown 与
    //  学习写入 LearnTimeline 已迁至 PoseSignatureAccess。）

    /// <summary>
    /// 访问主控制槽的原语（SimpleHeels 同款路径）已迁至 PoseSampler.AccessMainControl：
    /// write=false 只读绑定动画真实时长与当前 LocalTime；write=true 写入 LocalTime（钳制在真实时长内）。
    /// </summary>


    // v0.5.23 双引擎：经典（v0.5.11 行为族：表情阶梯执行+集合验证+三层停表，无任何
    // Mode/BaseOverride 操作，失败模式是"播错但继续"）/ 增强（Brio 钉住架构，失败模式
    // 是"僵死"）。默认经典 —— 用户实测确认过的行为族。网页可切换。
    public static bool PinModeEnabled { get; set; } = false;

    // ---------- FIX-E 线程契约（AUD2-010）----------
    // 游戏对象（ObjectTable/本地角色/DrawObject/Skeleton 指针、Timeline/EmoteController、
    // GPose 状态、OS 键盘注入）只允许框架线程读写；HTTP 请求线程与后台任务一律经
    // RunOnGameThread 调度。JSON 解析、路径校验、文件 IO、Lumina 表读取（线程安全）可留在
    // 调用线程。framework 回调只返回不可变数据（string/基本类型），不把 Dalamud 对象带出线程。
    // 详细归属表见 docs/HANDOFF-20260830-fix-e-threading-lifecycle.md。
    // 线程路由/吞异常决策经 PoseSessionPolicy（RunInline/TryRun），datalayertest 直测。
    private void RunOnGameThread(System.Action action, GameOutputLease? retainedLease = null, bool cleanup = false, IReadOnlyList<GameOutputLease>? additionalLeases = null)
    {
        lock (OutputLock)
        {
            if (_disposed && retainedLease == null) return;
            var lease = retainedLease;
            if (lease == null && !_executor.OutputOwnership.TryAcquireLegacy("pose-callback", out lease)) return;
            var capturedLease = lease!; var generation = _outputGeneration;
            _pendingOutputCallbacks++;
            void Apply()
            {
                try
                {
                    capturedLease.TryRun(() =>
                    {
                        if (!cleanup && generation != _outputGeneration)
                        { capturedLease.Dispose(); return false; }
                        // 同一停止中的另一清理已经失败时，保留租约并等待明确重试，不能再写一次。
                        if (cleanup && _failedOutputCleanup.Count != 0)
                        { _failedOutputCleanup.Add((capturedLease, action, additionalLeases)); return false; }
                        // 失败保留主租约和附加租约，严格恢复成功后才能一起归还。
                        if (!PoseSessionPolicy.TryRun(action, ex => _log.Error(ex, "Freezer game-thread action failed")))
                        { _failedOutputCleanup.Add((capturedLease, action, additionalLeases)); return false; }
                        if (additionalLeases != null) foreach (var additional in additionalLeases) additional.Dispose();
                        capturedLease.Dispose();
                        return true;
                    });
                }
                finally { lock (OutputLock) _pendingOutputCallbacks--; }
            }
            if (PoseSessionPolicy.RunInline(_framework.IsInFrameworkUpdateThread)) Apply();
            else
            {
                try { _ = _framework.RunOnFrameworkThread(Apply); }
                catch (Exception ex)
                {
                    _pendingOutputCallbacks--;
                    _failedOutputCleanup.Add((capturedLease, action, additionalLeases));
                    _log.Error(ex, "Freezer cleanup could not be scheduled; output ownership retained");
                }
            }
        }
    }

    // era-reconciliation micro-adds (no donor; BoneAnimator dev-recorder path, fail-closed:
    // ResolveGposeIdForRecording always 0 = designed "no timeline" refusal; clock routes via RecordTiming).
    public ushort ResolveGposeIdForRecording(string command) => 0;
    public double NowSeconds => Exporter.RecordTiming.NowSeconds();
    public void BindTimelineDirect(ushort id) { }

    public bool OutputCleanupFailed { get { lock (OutputLock) return _failedOutputCleanup.Count != 0; } }
    public bool OutputCleanupPending { get { lock (OutputLock) return _pendingOutputCallbacks != 0; } }

    // 只由本人的明确重试入口调用；失败租约不因下一帧、下一条播放请求而自动退还。
    public void RetryOutputCleanup()
    {
        lock (OutputLock)
        {
            if (_disposed || !_applicator.HasPreviewWriteWitness) return;
            var retry = _failedOutputCleanup.ToArray();
            _failedOutputCleanup.Clear();
            foreach (var item in retry) RunOnGameThread(() => _applicator.RestorePreviewOrThrow(_idleTimelines), item.Lease, cleanup: true, item.Additional);
        }
    }

    public void Dispose()
    {
        // 卸载竞态兜底（2026-08-31 审计 P1）：StopPreview 的 Unpin/恢复速度经 RunOnGameThread
        // 调度；若 Dispose 发生在非框架线程且框架随后停止，排队的恢复动作可能永不执行，
        // 角色留在钉住态。这里给调度一个 2 秒有界等待窗口：框架还活着就等恢复真正落地；
        // 已停则超时放弃——没有安全的游戏内存恢复通道，记录后交由重新登录/换图自然解钉。
        var wasPreviewing = _previewMode || _gposeActive || OutputCleanupPending;
        lock (OutputLock)
        {
            StopAllOutputSessions(retryFailedCleanup: false);
            _disposed = true;
        }
        if (PreviewSessionLifecycle.DisposeShouldBoundedWait(wasPreviewing, _framework.IsInFrameworkUpdateThread))
        {
            try
            {
                // RunOnFrameworkThread 按序排队：这个空标记排在恢复动作之后，等到它 =
                // 恢复动作已执行（或队列本身已不再消费）
                _framework.RunOnFrameworkThread(() => { }).Wait(TimeSpan.FromSeconds(2));
            }
            catch (Exception ex) { _log.Warning(ex, "Freezer dispose: restore wait failed"); }
        }
        _framework.Update -= OnFrameworkUpdate;
        lock (OutputLock)
        {
            if (_failedOutputCleanup.Count != 0 || _pendingOutputCallbacks != 0 || _applicator.HasPreviewWriteWitness)
                throw new InvalidOperationException("卸载时姿态清理仍失败或未完成，不能报告成功释放");
        }
    }
}
