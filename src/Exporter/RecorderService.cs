// 这个文件是干嘛的：用旧输出租约约束录制触发和复位，取消后旧框架回调与命令失效。
using System;
using System.Collections.Generic;
using System.Numerics;
using System.Runtime.InteropServices;
using Dalamud.Plugin.Services;
using FFXIVClientStructs.FFXIV.Client.Game.Character;
using FFXIVClientStructs.FFXIV.Client.Graphics.Scene;
using FFXIVClientStructs.FFXIV.Client.System.Framework;

namespace ChoreoHelper.Exporter;

/// <summary>
/// RecorderService：S3.1 录制兜底 —— 触发动作真实播放，逐帧读骨骼局部变换，
/// 构建与 pap 解析路线<b>同格式</b>的 AnimClipData。（pap 解析校准前/失败时自动降级）
///
/// 读取路径：本地玩家 → DrawObject(Human) → Skeleton → PartialSkeletons[0].Bones
///   → PartialBone.Transform（局部变换，相对父骨骼 = 引擎契约要求的局部旋转）
/// 写入侧（重放）由网页引擎完成；本服务只产出数据。
///
/// 附带 WalkReset（姿态复位）：坐/躺/跪等姿态只有"角色移动"能清掉（发指令停不掉），
/// 批量录制姿态类动作后自动复位用。双保险：① GameObject 位置轻推 0.4 米（导航插件同款
/// 原理，不需要前台）；② 游戏在前台时 OS 层注入 W+空格 跳走 1.2 秒（最接近玩家手动站）。
/// Dalamud IKeyState 注入在橙月版实测无效，故走 OS 层，且带前台保护防按键漏进别的窗口。
/// </summary>
public unsafe sealed class RecorderService : IDisposable
{
    private readonly IPluginLog _log;
    private readonly IFramework _framework;
    private readonly IObjectTable _objectTable;
    private readonly Action<string> _trigger;   // 动作触发委托（复用 v0.5 执行通道）
    private readonly GameOutputOwnership _outputOwnership;
    private readonly Action<string, GameOutputLease?>? _ownedTrigger;
    private readonly Action<string, Func<bool>>? _cancellableTrigger;
    private GameOutputLease? _recordLease;
    private GameOutputLease? _walkLease;
    private long _recordGeneration;
    private long _walkGeneration;
    private object StateLock => _outputOwnership.SyncRoot;
    private readonly Action? _beforeRecord;     // 触发前卫生序列（v0.6.3：解掉舞蹈循环绑死 slot0 的旧绑定）

    public RecorderService(IPluginLog log, IFramework framework, IObjectTable objectTable, Action<string> trigger, Action? beforeRecord = null,
        GameOutputOwnership? outputOwnership = null, Action<string, GameOutputLease?>? ownedTrigger = null,
        Action<string, Func<bool>>? cancellableTrigger = null)
    {
        _log = log;
        _framework = framework;
        _objectTable = objectTable;
        _trigger = trigger;
        _beforeRecord = beforeRecord;
        _outputOwnership = outputOwnership ?? new GameOutputOwnership();
        _ownedTrigger = ownedTrigger;
        _cancellableTrigger = cancellableTrigger;
        _framework.Update += OnFrameworkUpdate;
    }

    public sealed class RecordResult
    {
        public bool Ok;
        public string Error = "";
        public AnimClipData? Clip;
        public string Reason = "";   // settled=播完静止 / timeout=到时长上限被掐断（持续/循环类动作）
        // v0.7.1 FIX-C（AUD2-007）：实际采样率随结果上报——以前随开机时长悄悄劣化没人知道
        public double AvgSampleHz;      // 平均采样率 = 帧数 / 实际时长
        public bool LowSampleRate;      // 平均采样率低于 LowRateHz（明显劣于产品口径 11~17fps）
    }

    // FIX-E 线程契约：Record/CancelPending 在 HTTP 线程调用，OnFrameworkUpdate 在框架线程
    // 跑——_recording/_onDone 跨线程读写，volatile 保证可见性与写入顺序
    private volatile bool _recording;
    public bool IsRecording => _recording;
    public (bool Recording, bool Held, bool CleanupFailed) StopSnapshot()
    {
        lock (StateLock) return (_recording, _osKeysHeld, _walkCleanupFailed);
    }
    private volatile Action<RecordResult>? _onDone;
    private volatile bool _disposed;
    private string _command = "";
    private double _startedAt;
    private int _frameCount;
    private double _lastSampleAt;
    private const double SampleInterval = 1.0 / 30.0;   // 30fps 采样（引擎插值平滑，60 太贵）
    private const double MaxRecordSec = 20.0;             // once 类普遍 <4s 提前静止收尾；循环/持续类（跳舞等）录满 20s 掐断（主人定的上限，后期再剪成整数循环周期）
    private const double LowRateHz = 8.0;                 // 平均采样率低于此值 = 明显劣化（产品口径 11~17fps）
    // 非 readonly（PLUG-4）：Finish 交接时整表换新实例，旧列表移交线程池构建
    private List<(double T, Matrix4x4[] Transforms)> _frames = new();
    private readonly List<double> _frameTimes = new();    // 帧相对秒（静止参考帧按时间查找用，与 _frames 同步）

    /// <summary>异步录制：触发动作 → Framework.Update 逐帧采样 → 回调结果。
    /// FIX-E 线程契约：本方法在 HTTP 线程调用；游戏相关动作（卫生序列/命令触发）内部
    /// 自行调度进框架线程，这里只做托管状态准备。</summary>
    public void Record(string command, Action<RecordResult> onDone)
    {
        lock (StateLock) RecordCore(command, onDone);
    }

    private void RecordCore(string command, Action<RecordResult> onDone)
    {
        if (_recording) { onDone(new RecordResult { Error = "already recording" }); return; }
        if (_disposed) { onDone(new RecordResult { Error = "recorder disposed" }); return; }
        if (!_outputOwnership.TryAcquireLegacy("recording", out _recordLease))
        { onDone(new RecordResult { Error = "独占试验持有游戏输出，录制未开始" }); return; }
        var lease = _recordLease!;
        var generation = ++_recordGeneration;
        _log.Information("Recorder: Record() called for {cmd}", command);
        // PLUG-5（FIX-J）：先把全部状态就绪，最后才发布 volatile 活动旗标——旧顺序先置
        // _recording=true 再重置计时，框架 tick 插进来会拿上一条的 _startedAt 判定
        // now-_startedAt > 20s，新录制开局即被 timeout 掐死。volatile 写自带释放语义，
        // 旗标后置保证框架线程看到 true 时所有状态已就绪。
        _command = command;
        _onDone = onDone;
        _frames.Clear();
        _frameTimes.Clear();
        _frameCount = 0;
        _startedAt = Now();
        _stillSince = -1;
        _lastSampleAt = -1;
        _recording = true;
        // v0.6.3：先跑冻结器的卫生序列（快进旧动画到末尾解绑 + 表情状态机解锁），
        // 再发命令。卫生序列排队进框架线程，本命令经执行器至少 200ms 后才执行，顺序有保证
        _ = _framework.RunOnFrameworkThread(() => lease.TryRun(() =>
        {
            if (_disposed || !_recording || generation != _recordGeneration) return false;
            try
            {
                _beforeRecord?.Invoke();
                if (!lease.IsCurrent || generation != _recordGeneration) return false;
                if (_ownedTrigger != null) _ownedTrigger(command, lease); else _trigger(command);
                return true;
            }
            catch (Exception ex) { _log.Error(ex, "Recorder: trigger failed"); CancelPending(); return false; }
        }));
        _log.Information("Recorder: started {cmd}", command);
    }

    /// <summary>直接触发一条游戏指令（不打采样框架）。批量录制里用它发"打断动作"：循环类录完后角色还会一直跳，发个短动作把它停掉。</summary>
    public void Trigger(string command)
    {
        lock (StateLock)
        {
            if (_disposed || !_outputOwnership.TryAcquireLegacy("record-trigger", out var lease)) return;
            using (lease)
            {
                try
                {
                    var generation = _recordGeneration;
                    lease!.TryRun(() =>
                    {
                        if (_cancellableTrigger != null)
                            _cancellableTrigger(command, () => !_disposed && generation == _recordGeneration);
                        else _trigger(command);
                        return true;
                    });
                }
                catch (Exception ex) { _log.Error(ex, "Recorder: Trigger({cmd}) failed", command); }
            }
        }
    }

    // ---------- 姿态复位（批量录制姿态类动作用） ----------
    // v0.7.1 AUD-003：按真实时间（单调时钟）计时，不再按帧数——75 帧在 30fps 约 2.5s、
    // 144fps 只有 0.5s，不同帧率下复位位移差很多；Dispose/异常也必须松键防 W 残留
    private long _walkDeadlineTick;   // Environment.TickCount64 毫秒截止时间（0=无进行中的键盘行走）
    private nint _gameHwnd;      // 游戏主窗口句柄（键盘注入的前台保护用）
    private bool _osKeysHeld;
    private bool _walkCleanupFailed;

    [DllImport("user32.dll")] private static extern nint GetForegroundWindow();
    [DllImport("user32.dll")] private static extern void keybd_event(byte vk, byte scan, uint flags, nint extra);
    private const uint KEYEVENTF_KEYUP = 0x2;
    private const byte VK_W = 0x57, VK_SPACE = 0x20;

    /// <summary>姿态复位双保险：① 位置轻推 0.4 米（不需要前台）；② 游戏在前台时
    /// 真实注入 W+空格 约 1.2 秒（跳+走，按真实时间计时与帧率无关）。
    /// 异步：调用方等 3~4 秒再录下一条。
    /// FIX-E 线程契约：本方法从 HTTP 线程调用，但 GameObject 位置读写只允许框架线程——
    /// 整体调度进框架线程执行（已在框架线程则就地执行）。按键释放仍由 Update/Dispose 兜底。</summary>
    public bool WalkReset(int holdMs = 1200) => false; // 未验收的旧坐标轻推/注入复位明确关闭，HTTP 必须返回拒绝。

    // 仅保存历史实现便于审查；无调用者，不得用于绕过上面的关闭入口。
    private void ScheduleUnacceptedWalkReset(int holdMs)
    {
        lock (StateLock)
        {
            if (_disposed || _walkLease?.IsCurrent == true
                || !_outputOwnership.TryAcquireLegacy("record-walk-reset", out _walkLease)) return;
            var lease = _walkLease!; var generation = ++_walkGeneration;
            _ = _framework.RunOnFrameworkThread(() => lease.TryRun(() =>
            {
                if (_disposed || generation != _walkGeneration) return false;
                WalkResetCore(holdMs);
                if (!_osKeysHeld) { lease.Dispose(); if (ReferenceEquals(_walkLease, lease)) _walkLease = null; }
                return true;
            }));
        }
    }

    private void WalkResetCore(int holdMs)
    {
        if (_disposed) return; // 服务已关闭：不再碰角色对象/键盘

        // 新复位前先释放上一次的按键状态（幂等），防连发叠加把 W 按住的时间越滚越长
        ReleaseWalkKeys(finishLease: false);

        // ① 位置轻推
        try
        {
            var local = _objectTable[0];
            if (local != null)
            {
                var go = (FFXIVClientStructs.FFXIV.Client.Game.Object.GameObject*)local.Address;
                var p = go->Position;
                go->SetPosition(p.X + 0.4f, p.Y, p.Z);
                _log.Information("WalkReset: 位置轻推 → ({x:F2},{y:F2},{z:F2})", p.X + 0.4f, p.Y, p.Z);
            }
        }
        catch (Exception ex) { _log.Error(ex, "WalkReset: 位置轻推失败"); }

        // ② 前台时注入键盘（跳一下 + 按住 W 走，holdMs 毫秒后由 Update 松开）
        try
        {
            if (_gameHwnd == nint.Zero)
                _gameHwnd = System.Diagnostics.Process.GetCurrentProcess().MainWindowHandle;
            if (_gameHwnd != nint.Zero && GetForegroundWindow() == _gameHwnd)
            {
                keybd_event(VK_SPACE, 0, 0, nint.Zero);            // 跳
                keybd_event(VK_SPACE, 0, KEYEVENTF_KEYUP, nint.Zero);
                keybd_event(VK_W, 0, 0, nint.Zero);                // 按住 W 走
                _osKeysHeld = true;
                _walkDeadlineTick = Environment.TickCount64 + Math.Max(100, holdMs);
                _log.Information("WalkReset: 键盘注入开始（{ms}ms）", holdMs);
            }
            else
            {
                _log.Information("WalkReset: 游戏不在前台，只用位置轻推");
            }
        }
        catch (Exception ex)
        {
            _log.Error(ex, "WalkReset: 键盘注入失败");
            ReleaseWalkKeys();   // 兜底：注入中途出异常也不能把 W 留在按下状态
        }
    }

    /// <summary>松开 W 键（幂等：没有按住时直接返回）。WalkReset 复位、到时、失去前台、
    /// Dispose、异常兜底全部走这里，保证一次且只有一次 keyup。</summary>
    private void ReleaseWalkKeys(bool finishLease = true)
    {
        _walkDeadlineTick = 0;
        if (!_osKeysHeld)
        {
            if (finishLease) { _walkLease?.Dispose(); _walkLease = null; }
            return;
        }
        try
        {
            keybd_event(VK_W, 0, KEYEVENTF_KEYUP, nint.Zero);
            _osKeysHeld = false;
            if (finishLease) { _walkLease?.Dispose(); _walkLease = null; }
            _log.Information("WalkReset: 完成，按键已松开");
        }
        catch (Exception ex)
        {
            _walkCleanupFailed = true;
            _log.Error(ex, "WalkReset release failed; ownership retained until explicit stop retry");
        }
    }

    // 诊断：Update 订阅是否在跑（每 5 秒打一条，录制时每秒打一条）
    private double _diagAt;
    private int _lastBonesNull;

    private void OnFrameworkUpdate(IFramework framework)
    {
        lock (StateLock) OnFrameworkUpdateCore();
    }

    private void OnFrameworkUpdateCore()
    {
        // 键盘行走的收尾：到时（真实时间，帧率无关）或失去前台就松开按键（防止把 W 漏进别的窗口）
        if (!_walkCleanupFailed && _osKeysHeld &&
            (Environment.TickCount64 >= _walkDeadlineTick || GetForegroundWindow() != _gameHwnd))
        {
            ReleaseWalkKeys();
        }

        // 诊断：确认 Update 在跑
        var diagNow = Now();
        if (diagNow - _diagAt > 5f && _recording)
        {
            _diagAt = diagNow;
            _log.Information("Recorder: update alive, frames={n} bonesNull={b}", _frameCount, _lastBonesNull);
        }
        _updateAliveAt = Now();
        if (!_recording) return;

        var now = Now();
        // 结束判定：动作播完 —— 动作开始后有实际运动（frames>15 = 动画确实播过），
        // 然后回到"近似静止"（关键骨骼旋转与 0.4 秒前差异 < 阈值，持续 0.5 秒）。
        // 不能用"无新帧"判定：待机呼吸/物理永远在动，采样永不停止。
        if (now - _startedAt > MaxRecordSec)
        {
            Finish("timeout");
            return;
        }
        // 检测近似静止：比较第 12 根以后的骨骼（躯干/四肢，排除根部和呼吸影响的胸骨）。
        // v0.7.1 FIX-C（AUD2-007）：参考帧按时间找"0.4 秒前"（老代码固定倒数第 12 帧，
        // 按 30fps 折算 0.4s，实际 11~17fps 时是 0.7~1.1s，判静窗口随帧率漂移）
        var elapsed = now - _startedAt;
        if (_frameCount > 15 && elapsed > 1.0 && _frames.Count > 12)
        {
            var cur = _frames[^1];
            var refIdx = RecordTiming.StillRefIndex(_frameTimes, cur.T);
            if (refIdx >= 0) // 没播满 0.4s 窗口就先不判静，继续正常采样
            {
            var ref_ = _frames[refIdx];
            var moving = false;
            var n = Math.Min(cur.Transforms.Length, ref_.Transforms.Length);
            for (var b = 3; b < n && b < 80; b++)
            {
                // AUD-016：改用 MotionDetect.IsMoving（老标量 OR 真实旋转角 OR 平移）
                if (MotionDetect.IsMoving(ref_.Transforms[b], cur.Transforms[b])) { moving = true; break; }
            }
            if (!moving) _stillSince = _stillSince < 0 ? now : _stillSince;
            else _stillSince = -1;
            if (_stillSince > 0 && now - _stillSince > 0.5f)
            {
                Finish("settled");
                return;
            }
            }
        }
        // 采样节流
        if (now - _lastSampleAt < SampleInterval) return;

        var bones = ReadBoneTransforms();
        if (bones == null || bones.Length == 0) { _lastBonesNull++; return; }
        var relT = now - _startedAt;
        _frames.Add((relT, bones));
        _frameTimes.Add(relT);
        _frameCount++;
        _lastSampleAt = now;
    }

    /// <summary>读取全部骨骼局部变换（已验证的 GetHavokPose→local-space 路径，CN 客户端兼容）。</summary>
    private Matrix4x4[]? ReadBoneTransforms()
    {
        try
        {
            var local = _objectTable[0];
            if (local == null) return null;
            var character = (Character*)local.Address;
            var drawObj = character->GameObject.DrawObject;
            if (drawObj == null) return null;
            var cb = (FFXIVClientStructs.FFXIV.Client.Graphics.Scene.CharacterBase*)drawObj;
            if (cb->Skeleton == null || cb->Skeleton->PartialSkeletonCount < 1) return null;

            var partial = &cb->Skeleton->PartialSkeletons[0];
            var pose = partial->GetHavokPose(0);
            if (pose == null || pose->Skeleton == null) return null;
            var ls = pose->GetSyncedPoseLocalSpace();
            if (ls == null || ls->Data == null || ls->Length <= 0 || ls->Length > 256) return null;

            var count = ls->Length;
            var result = new Matrix4x4[count];
            for (var i = 0; i < count; i++)
            {
                var t = &ls->Data[i];
                var q = new Quaternion(t->Rotation.X, t->Rotation.Y, t->Rotation.Z, t->Rotation.W);
                var p = new Vector3(t->Translation.X, t->Translation.Y, t->Translation.Z);
                result[i] = Matrix4x4.CreateFromQuaternion(q) * Matrix4x4.CreateTranslation(p);
            }
            return result;
        }
        catch (Exception ex)
        {
            _log.Debug("ReadBoneTransforms failed: {msg}", ex.Message);
            return null;
        }
    }

    private void Finish(string reason)
    {
        _recording = false;
        _recordLease?.Dispose(); _recordLease = null;
        var cb = _onDone;
        _onDone = null;
        // PLUG-4（FIX-J）：游戏线程只截取不可变结果——帧列表整体换新实例交接出去
        // （下一条 Record 的 Clear 碰不到交接数据），BuildClip/JSON 序列化/落盘全部移到
        // 线程池路径，不再让多兆字节的 CPU+磁盘 IO 卡框架线程。回调改为异步到达：
        // 两个等待方（HandleClipSync 的 30s 事件、BatchLoop 的 TCS）本就只等信号，
        // 不受影响；CancelPending 不会二次回调（_onDone 已清空）。
        var frames = _frames;
        _frames = new List<(double T, Matrix4x4[] Transforms)>();
        var command = _command;
        if (frames.Count < 3)
        {
            cb?.Invoke(new RecordResult { Error = $"too few frames ({frames.Count}): {reason}" });
            return;
        }
        _ = System.Threading.Tasks.Task.Run(() =>
        {
            try
            {
                var clip = BuildClip(command, frames);
                _log.Information("Recorder: done {cmd} frames={n} dur={d:F2}s ({reason})", command, frames.Count, clip.duration, reason);
                // v0.7.1 FIX-C（AUD2-007）：实际采样率入结果——低采样率明确报告而不是默默出低质量动作
                var res = new RecordResult { Ok = true, Clip = clip, Reason = reason };
                var dur = frames[^1].T;
                res.AvgSampleHz = dur > 0 ? frames.Count / dur : 0;
                res.LowSampleRate = res.AvgSampleHz < LowRateHz;
                if (res.LowSampleRate)
                    _log.Warning("Recorder: 采样率偏低 {hz:F1}Hz（帧 {n} / {d:F2}s）——游戏卡顿或开机过久都可能造成，建议重启游戏后重录", res.AvgSampleHz, frames.Count, dur);
                cb?.Invoke(res);
            }
            catch (Exception ex)
            {
                _log.Error(ex, "Recorder: clip build failed");
                cb?.Invoke(new RecordResult { Error = ex.Message });
            }
        });
    }

    /// <summary>帧采样 → AnimClipData（PLUG-4 起为纯静态：只吃交接来的不可变帧列表，
    /// 在线程池路径执行，不再读实例状态）。</summary>
    private static AnimClipData BuildClip(string command, List<(double T, Matrix4x4[] Transforms)> frames)
    {
        // v0.7.1 FIX-C（AUD2-007）：内部全是相对 double，只在序列化边界转 float（clip JSON 契约是 float）
        var duration = (float)frames[frames.Count - 1].T;
        var boneCount = frames[0].Transforms.Length;

        // 每骨骼 → 关键帧列表（拆解 Matrix4x4 → 位置/旋转）
        var rotSamples = new Dictionary<string, List<(float T, Quaternion Q)>>();
        var posSamples = new Dictionary<string, List<(float T, Vector3 P)>>();
        for (var b = 0; b < boneCount; b++)
        {
            var name = $"bone_{b}";
            var rotList = new List<(float, Quaternion)>();
            var posList = new List<(float, Vector3)>();
            foreach (var (t, transforms) in frames)
            {
                var m = transforms[b];
                if (Matrix4x4.Decompose(m, out _, out var q, out var p))
                {
                    rotList.Add(((float)t, q));
                    posList.Add(((float)t, p));
                }
            }
            if (rotList.Count >= 2)
            {
                rotSamples[name] = rotList;
                posSamples[name] = posList;
            }
        }
        return AnimWriter.FromSamples(command.Trim().TrimStart('/'), duration, "once", rotSamples, posSamples);
    }


    /// <summary>诊断状态（双开客户端日志不可用，经 HTTP 查询）。</summary>
    public string GetDiagJson()
    {
        try
        {
            return System.Text.Json.JsonSerializer.Serialize(new
            {
                recording = _recording,
                command = _command,
                frames = _frameCount,
                startedAgo = _recording ? Now() - _startedAt : 0,
                lastSampleAgo = _lastSampleAt > 0 ? Now() - _lastSampleAt : -1,
                bonesNull = _lastBonesNull,
                updateAliveAgo = _updateAliveAt > 0 ? Now() - _updateAliveAt : -1
            });
        }
        catch { return "{}"; }
    }
    private double _updateAliveAt;

    // 静止判据抽到 src\MotionDetect.cs（v0.7.1 AUD-016，无依赖纯函数件、datalayertest 直测），
    // 这里只引用；阈值与校准依据见那个文件的注释。

    // v0.7.1 FIX-C（AUD2-007）：老 Now() = Environment.TickCount64 / 1000f——float 绝对秒在
    // 开机 3.9 天后步长 31ms（30fps 隔帧掉队）、12 天后 125ms（约 8fps）。改 Stopwatch 单调
    // double + 相对计时，精度与开机时长无关（纯函数件 RecordTiming.cs，datalayertest 直测）
    private double _stillSince = -1;
    private static double Now() => RecordTiming.NowSeconds();

    /// <summary>立即结束进行中的录制（不产生数据），同步触发等待中的回调让 HTTP 等待方/
    /// 批量循环立刻解除阻塞——服务关闭排空时不再陪葬 30s 超时。无在途录制时是空操作。</summary>
    public void CancelPending()
    {
        lock (StateLock) CancelPendingCore();
    }

    private void CancelPendingCore(bool retryWalk = true)
    {
        _recordGeneration++; _walkGeneration++;
        _recordLease?.Dispose(); _recordLease = null;
        // 取消先失效尚未执行的复位回调；持键的租约只有实际释放成功才退还。
        if (_osKeysHeld && retryWalk) _ = _framework.RunOnFrameworkThread(() =>
        {
            lock (StateLock) { _walkCleanupFailed = false; ReleaseWalkKeys(); }
        });
        else if (!_osKeysHeld) { _walkLease?.Dispose(); _walkLease = null; }
        var cb = _onDone;
        _recording = false;
        _onDone = null;
        if (cb != null)
        {
            try { cb(new RecordResult { Error = "recorder shutting down" }); }
            catch { }
        }
    }

    public void Dispose()
    {
        lock (StateLock) DisposeCore();
    }

    private void DisposeCore()
    {
        _disposed = true;          // 之后 WalkReset/Record 一律拒绝，防关闭后还碰游戏
        CancelPendingCore(retryWalk: false); // 卸载排空录制，但不把旧释放失败当作本人明确重试。
        _recording = false;
        if (!_walkCleanupFailed) ReleaseWalkKeys(); // 失败不能在同一卸载序列再自动注入重试。
        if (_framework != null) _framework.Update -= OnFrameworkUpdate;
        if (_osKeysHeld || _walkCleanupFailed)
            throw new InvalidOperationException("旧姿态复位的释放仍未确认；不得报告卸载清理成功");
    }
}
