using Dalamud.Plugin.Services;
using Dalamud.Hooking;
using Dalamud.Game;
using System.Collections.Concurrent;
using System.IO;
using System.Text.Json;

namespace ChoreoHelper;

/// <summary>
/// S3 骨骼快照录制/重放器（Phase 2）。
/// 录制：GPose 里直绑动作 → 逐帧采样 partial-0 全部骨骼变换 → 内存 → 落盘。
/// 重放：拖到 (命令, 时刻) → 查帧 → 逐骨写回 → 瞬时精确，零状态机依赖。
/// 每帧 ~101 骨 × 8 浮点（平移4+旋转4）≈ 3.2KB；30fps 采样，5 秒动作 ≈ 480KB。
/// </summary>
public unsafe class BoneAnimator : IDisposable
{
    private readonly IPluginLog _log;
    private readonly AnimationPoseFreezer _freezer;

    // ---------- 录制状态 ----------
    private bool _recording;
    private string? _recCmd;
    private double _recStart;
    private List<float[]> _recFrames = new();      // 每帧的原始浮点数组
    private List<float> _recTimes = new();          // 每帧的时刻
    private int _boneCount;                          // 本角色的骨骼数（部分0）
    private double _recLastSample;                   // 上次采样时刻（30fps 节流）

    // ---------- 已有录制（内存缓存，key = 命令） ----------
    private static readonly ConcurrentDictionary<string, CachedRecording> Recordings = new();

    // ---------- 重放状态（每帧重写，对抗游戏求值覆盖） ----------
    private string? _replayCmd;
    private float[]? _replayFrames;                  // 展开的浮点数据
    private float[]? _replayTimes;
    private int _replayBoneCount;

    public sealed class CachedRecording
    {
        public float[] Frames = Array.Empty<float>();   // [frame][bone*8+component] 展平
        public float[] Times = Array.Empty<float>();     // 每帧时刻
        public int BoneCount;
        public float Duration;
    }

    private static string RecordingsDir =>
        Path.Combine(Plugin.PluginInterface?.GetPluginConfigDirectory() ?? "", "bonerec");

    public bool IsRecording => _recording;
    public string? RecordingCommand => _recCmd;
    public int RecordedFrames => _recFrames.Count;
    public int CachedCount => Recordings.Count;

    public BoneAnimator(IPluginLog log, AnimationPoseFreezer freezer, ISigScanner scanner, IGameInteropProvider hooking)
    {
        _log = log;
        _freezer = freezer;

        // S3 关键（Brio 同款）：钩住游戏骨骼物理更新——在它算完姿势后写我们的骨骼，
        // 确保写入发生在渲染前（Framework.Update 里写会被游戏的下一轮求值覆盖）
        var updateBonePhysicsSig = "48 89 5C 24 ?? 48 89 6C 24 ?? 48 89 74 24 ?? 57 41 54 41 56 48 83 EC ?? 48 8B 59 ?? 45 33 E4";
        _updateBonePhysicsHook = hooking.HookFromAddress<UpdateBonePhysicsDelegate>(
            scanner.ScanText(updateBonePhysicsSig), UpdateBonePhysicsDetour);
        _updateBonePhysicsHook.Enable();
        _log.Information("BoneAnimator: UpdateBonePhysics hook enabled");
    }

    private delegate nint UpdateBonePhysicsDelegate(nint a1);
    private readonly Hook<UpdateBonePhysicsDelegate>? _updateBonePhysicsHook;

    private nint UpdateBonePhysicsDetour(nint a1)
    {
        var result = _updateBonePhysicsHook!.Original(a1);
        try
        {
            // 游戏算完骨骼物理后、渲染前——这是写入骨骼的正确时机
            if (_replayCmd != null)
            {
                TickReplay();
                // 诊断：写完后读回第 48 号骨（右上臂）的旋转，验证写入是否落地
                if (_debugCounter++ % 60 == 0) // 每秒一次
                {
                    var pose = GetPose0();
                    if (pose != null && pose->Skeleton != null)
                    {
                        var ms = pose->AccessBoneModelSpace(48,
                            FFXIVClientStructs.Havok.Animation.Rig.hkaPose.PropagateOrNot.DontPropagate);
                        if (ms != null)
                            _log.Information("BONEHOOK: replaying={cmd} bone48.rot=({x:F3},{y:F3},{z:F3},{w:F3})",
                                _replayCmd, ms->Rotation.X, ms->Rotation.Y, ms->Rotation.Z, ms->Rotation.W);
                    }
                }
            }
        }
        catch (Exception ex) { _log.Error(ex, "BONEHOOK error"); }
        return result;
    }
    private int _debugCounter;

    // ========================= 录制 =========================

    /// <summary>开始录制一个命令：直绑动画并逐帧采样。须在 GPose 中调用。</summary>
    public bool StartRecording(string command)
    {
        if (_recording) return false;
        if (Recordings.ContainsKey(command)) return false; // 已有
        var id = _freezer.ResolveGposeIdForRecording(command);
        if (id == 0) { _log.Warning("BoneRec: no timeline id for {cmd}", command); return false; }

        // 采样骨骼数
        var (ok, count) = GetBoneCount();
        if (!ok || count == 0) { _log.Warning("BoneRec: no bones"); return false; }
        _boneCount = count;

        _recCmd = command;
        _recFrames.Clear();
        _recTimes.Clear();
        _recStart = _freezer.NowSeconds;
        _recLastSample = 0;
        _recording = true;

        // 直绑动画（GPose 内直绑已验证）
        _freezer.BindTimelineDirect(id);
        _log.Information("BoneRec start: {cmd} tl={id} bones={count}", command, id, count);
        return true;
    }

    /// <summary>停止录制并保存。返回 true = 有效录制已落盘。</summary>
    public bool StopRecording()
    {
        if (!_recording) return false;
        _recording = false;
        if (_recCmd == null || _recFrames.Count < 5)
        {
            _log.Warning("BoneRec stop: too few frames ({n})", _recFrames.Count);
            _recCmd = null;
            return false;
        }

        // 展平存储
        var totalFloats = _recFrames.Count * _boneCount * 8;
        var flat = new float[totalFloats];
        var i = 0;
        foreach (var f in _recFrames)
        {
            Array.Copy(f, 0, flat, i, f.Length);
            i += f.Length;
        }

        var rec = new CachedRecording
        {
            Frames = flat,
            Times = _recTimes.ToArray(),
            BoneCount = _boneCount,
            Duration = _recTimes[^1]
        };
        Recordings[_recCmd] = rec;
        SaveToDisk(_recCmd, rec);
        _log.Information("BoneRec saved: {cmd} frames={n} dur={d:F1}s", _recCmd, _recFrames.Count, rec.Duration);
        _recCmd = null;
        return true;
    }

    /// <summary>每帧调用（由 AnimationPoseFreezer.OnFrameworkUpdate 驱动）。重放由 hook 驱动，这里只处理录制和批量调度。</summary>
    public void Tick()
    {
        if (_recording) { TickRecord(); CheckAutoStop(); }
        TickBatch();
    }

    // ---------- 批量录制 ----------
    private readonly Queue<string> _batchQueue = new();
    private bool _batchRunning;
    private int _batchDone, _batchTotal;
    private double _batchWaitUntil; // 等待当前命令录制完成的截止时刻

    /// <summary>开始批量录制全部未录制的动作。须在 GPose 中调用。</summary>
    public string StartBatch(string[] allCommands)
    {
        if (_batchRunning) return GetStatusJson();
        var cmds = allCommands.Where(c => !Recordings.ContainsKey(c) && _freezer.ResolveGposeIdForRecording(c) != 0).ToArray();
        _batchQueue.Clear();
        foreach (var c in cmds) _batchQueue.Enqueue(c);
        var cmdCount = cmds.Length;
        _batchTotal = cmdCount;
        _batchDone = 0;
        _batchRunning = cmdCount > 0;
        _batchWaitUntil = 0;
        _log.Information("BoneBatch start: {n} commands to record", cmdCount);
        return GetStatusJson();
    }

    public void CancelBatch(string reason)
    {
        if (!_batchRunning) return;
        _batchRunning = false;
        _batchQueue.Clear();
        if (_recording) StopRecording();
        _log.Information("BoneBatch cancelled: {reason} (done {d}/{t})", reason, _batchDone, _batchTotal);
    }

    private void TickBatch()
    {
        if (!_batchRunning) return;
        var now = _freezer.NowSeconds;

        // 等待当前录制完成（自动停止或超时）
        if (_recording)
        {
            if (now > _batchWaitUntil && now - _recStart > 25.0)
            {
                _log.Warning("BoneBatch: force stop {cmd} (timeout)", _recCmd ?? "-");
                StopRecording();
            }
            return;
        }

        // 上一个录完，短暂间隔（让角色回待机）
        if (_batchWaitUntil == 0) _batchWaitUntil = now + 0.3;
        if (now < _batchWaitUntil) return;

        if (_batchQueue.Count == 0)
        {
            _batchRunning = false;
            _log.Information("BoneBatch done: {d}/{t} recorded", _batchDone, _batchTotal);
            return;
        }

        var cmd = _batchQueue.Dequeue();
        _batchDone++;
        _batchWaitUntil = 0; // 会在 StartRecording 后重新设置
        if (StartRecording(cmd))
        {
            _batchWaitUntil = now + 25.0; // 最长等 25 秒
        }
        else
        {
            _batchWaitUntil = now + 0.1; // 失败快速跳过
        }
    }

    private void TickRecord()
    {
        var now = _freezer.NowSeconds - _recStart;
        // 30fps 节流
        if (now - _recLastSample < 1.0 / 30.0) return;
        _recLastSample = now;

        var sample = SampleBones();
        if (sample == null) return;
        _recFrames.Add(sample);
        _recTimes.Add((float)now);

        // 最长 20 秒保险
        if (now > 20.0) { _log.Information("BoneRec: 20s cap hit"); StopRecording(); }
    }

    /// <summary>自动停止：动画播完（最近 5 帧骨骼旋转几乎不变 = 静止）→ 停录。</summary>
    private void CheckAutoStop()
    {
        if (!_recording || _recFrames.Count < 15) return;
        var n = _recFrames.Count;
        var refFrame = _recFrames[n - 6];
        var allSame = true;
        for (var i = n - 5; i < n; i++)
        {
            var f = _recFrames[i];
            for (var j = 4; j < f.Length; j += 8) // 只比旋转分量
            {
                if (MathF.Abs(f[j] - refFrame[j]) > 0.001f ||
                    MathF.Abs(f[j + 1] - refFrame[j + 1]) > 0.001f)
                { allSame = false; break; }
            }
            if (!allSame) break;
        }
        if (allSame)
        {
            _log.Information("BoneRec auto-stop: {cmd} settled at {d:F1}s", _recCmd ?? "-", _recTimes[^1]);
            StopRecording();
        }
    }

    // ========================= 重放 =========================

    /// <summary>开始重放：拖动到 (命令, 时刻) 时调用。无录制返回 false。</summary>
    public bool StartReplay(string command, float time)
    {
        if (!Recordings.TryGetValue(command, out var rec)) return false;
        _replayCmd = command;
        _replayFrames = rec.Frames;
        _replayTimes = rec.Times;
        _replayBoneCount = rec.BoneCount;
        _replayTime = time;
        return true;
    }

    public void StopReplay() { _replayCmd = null; _replayFrames = null; }
    public bool IsReplaying => _replayCmd != null;

    private float _replayTime;

    public void SetReplayTime(float t) { _replayTime = t; }

    /// <summary>每帧重写骨骼（对抗游戏求值覆盖——Brio 同策略）。</summary>
    private void TickReplay()
    {
        if (_replayFrames == null || _replayTimes == null || _replayTimes.Length < 2) { StopReplay(); return; }
        var rec = Recordings[_replayCmd!];

        // 找最近帧（或两帧插值）
        var t = _replayTime;
        if (t > rec.Duration) t = rec.Duration; // 不取模——定格就定在最后帧

        int lo = 0, hi = _replayTimes.Length - 1;
        while (hi - lo > 1)
        {
            var mid = (lo + hi) / 2;
            if (_replayTimes[mid] <= t) lo = mid; else hi = mid;
        }

        var frameOffset = lo * _replayBoneCount * 8;
        var alpha = _replayTimes[hi] > _replayTimes[lo]
            ? (t - _replayTimes[lo]) / (_replayTimes[hi] - _replayTimes[lo])
            : 0f;

        WriteBones(_replayFrames, frameOffset, _replayBoneCount,
            alpha > 0.001f && hi < _replayTimes.Length ? hi : -1,
            alpha);
    }

    // ========================= 骨骼读写 =========================

    private (bool, int) GetBoneCount()
    {
        try
        {
            var pose = GetPose0();
            if (pose == null || pose->Skeleton == null) return (false, 0);
            return (true, pose->Skeleton->Bones.Length);
        }
        catch { return (false, 0); }
    }

    private static FFXIVClientStructs.Havok.Animation.Rig.hkaPose* GetPose0()
    {
        var chara = Plugin.ObjectTable?[0];
        if (chara == null) return null;
        var charaPtr = (FFXIVClientStructs.FFXIV.Client.Game.Character.Character*)chara.Address;
        var drawObj = charaPtr->GameObject.DrawObject;
        if (drawObj == null) return null;
        var cb = (FFXIVClientStructs.FFXIV.Client.Graphics.Scene.CharacterBase*)drawObj;
        if (cb->Skeleton == null || cb->Skeleton->PartialSkeletonCount == 0) return null;
        return cb->Skeleton->PartialSkeletons[0].GetHavokPose(0);
    }

    /// <summary>采样 partial-0 全部骨骼（平移+旋转，跳过缩放）。返回浮点数组或 null。</summary>
    /// <summary>采样 partial-0 全部骨骼 LOCAL-SPACE 变换（不依赖世界位置，跨 GPose/普通模式通用）。</summary>
    private float[]? SampleBones()
    {
        try
        {
            var pose = GetPose0();
            if (pose == null || pose->Skeleton == null) return null;
            var local = pose->GetSyncedPoseLocalSpace();
            if (local == null || local->Data == null) return null;
            var count = Math.Min(local->Length, pose->Skeleton->Bones.Length);
            if (count == 0) return null;
            var data = new float[count * 8];
            for (var b = 0; b < count; b++)
            {
                var ls = &local->Data[b];
                var o = b * 8;
                data[o] = ls->Translation.X; data[o + 1] = ls->Translation.Y;
                data[o + 2] = ls->Translation.Z; data[o + 3] = ls->Translation.W;
                data[o + 4] = ls->Rotation.X; data[o + 5] = ls->Rotation.Y;
                data[o + 6] = ls->Rotation.Z; data[o + 7] = ls->Rotation.W;
            }
            return data;
        }
        catch { return null; }
    }

    /// <summary>把录制帧写回骨骼 LOCAL-SPACE（父骨相对变换，跨模式通用）。</summary>
    private static void WriteBones(float[] frames, int loOffset, int boneCount, int hiFrame, float alpha)
    {
        var pose = GetPose0();
        if (pose == null || pose->Skeleton == null) return;
        var local = pose->GetSyncedPoseLocalSpace();
        if (local == null || local->Data == null) return;
        var count = Math.Min(boneCount, local->Length);
        var hiOffset = hiFrame >= 0 ? hiFrame * boneCount * 8 : -1;

        for (var b = 0; b < count; b++)
        {
            var ls = &local->Data[b];
            var o = loOffset + b * 8;

            if (hiOffset >= 0 && alpha > 0.001f)
            {
                var o2 = hiOffset + b * 8;
                ls->Translation.X = Lerp(frames[o], frames[o2], alpha);
                ls->Translation.Y = Lerp(frames[o + 1], frames[o2 + 1], alpha);
                ls->Translation.Z = Lerp(frames[o + 2], frames[o2 + 2], alpha);
                ls->Translation.W = frames[o + 3];
                // 旋转用 nlerp（够用，正式版可换 slerp）
                var dot = frames[o + 4] * frames[o2 + 4] + frames[o + 5] * frames[o2 + 5]
                          + frames[o + 6] * frames[o2 + 6] + frames[o + 7] * frames[o2 + 7];
                var sign = dot < 0 ? -1f : 1f;
                ls->Rotation.X = Lerp(frames[o + 4], frames[o2 + 4] * sign, alpha);
                ls->Rotation.Y = Lerp(frames[o + 5], frames[o2 + 5] * sign, alpha);
                ls->Rotation.Z = Lerp(frames[o + 6], frames[o2 + 6] * sign, alpha);
                ls->Rotation.W = Lerp(frames[o + 7], frames[o2 + 7] * sign, alpha);
                // 归一化
                var len = MathF.Sqrt(ls->Rotation.X * ls->Rotation.X + ls->Rotation.Y * ls->Rotation.Y
                    + ls->Rotation.Z * ls->Rotation.Z + ls->Rotation.W * ls->Rotation.W);
                if (len > 0.0001f)
                {
                    ls->Rotation.X /= len; ls->Rotation.Y /= len;
                    ls->Rotation.Z /= len; ls->Rotation.W /= len;
                }
            }
            else
            {
                ls->Translation.X = frames[o];
                ls->Translation.Y = frames[o + 1];
                ls->Translation.Z = frames[o + 2];
                ls->Translation.W = frames[o + 3];
                ls->Rotation.X = frames[o + 4];
                ls->Rotation.Y = frames[o + 5];
                ls->Rotation.Z = frames[o + 6];
                ls->Rotation.W = frames[o + 7];
            }
        }
    }

    private static float Lerp(float a, float b, float t) => a + (b - a) * t;

    // ========================= 磁盘持久化 =========================

    private static void SaveToDisk(string command, CachedRecording rec)
    {
        try
        {
            Directory.CreateDirectory(RecordingsDir);
            // v0.7.1 FIX-A（AUD2-001）：旧 .bin 落盘同走路径策略，不许命令直接当路径片段
            if (!ClipPathPolicy.TryGetPathForCommand(RecordingsDir, command, ".bin", out var path, out _))
            {
                Plugin.Log?.Warning("BoneRec save skipped, unsafe command {cmd}", command);
                return;
            }
            using var fs = File.Create(path);
            using var w = new BinaryWriter(fs);
            w.Write(rec.BoneCount);
            w.Write(rec.Times.Length);
            foreach (var t in rec.Times) w.Write(t);
            foreach (var f in rec.Frames) w.Write(f);
        }
        catch (Exception ex) { Plugin.Log?.Warning(ex, "BoneRec save failed for {cmd}", command); }
    }

    public static void LoadFromDisk()
    {
        try
        {
            if (!Directory.Exists(RecordingsDir)) return;
            foreach (var file in Directory.GetFiles(RecordingsDir, "*.bin"))
            {
                var cmd = "/" + Path.GetFileNameWithoutExtension(file);
                try
                {
                    using var r = new BinaryReader(File.OpenRead(file));
                    var boneCount = r.ReadInt32();
                    var frameCount = r.ReadInt32();
                    var times = new float[frameCount];
                    for (var i = 0; i < frameCount; i++) times[i] = r.ReadSingle();
                    var frames = new float[frameCount * boneCount * 8];
                    for (var i = 0; i < frames.Length; i++) frames[i] = r.ReadSingle();
                    Recordings[cmd] = new CachedRecording
                    {
                        BoneCount = boneCount,
                        Times = times,
                        Frames = frames,
                        Duration = times.Length > 0 ? times[^1] : 0
                    };
                }
                catch { }
            }
            Plugin.Log?.Information("BoneRec loaded {n} recordings from disk", Recordings.Count);
        }
        catch { }
    }

    public bool HasRecording(string command) => Recordings.ContainsKey(command);
    public static IReadOnlyDictionary<string, CachedRecording> GetAllRecordings() => Recordings;

    public string GetStatusJson()
    {
        try
        {
            return JsonSerializer.Serialize(new
            {
                recording = _recording,
                recCmd = _recCmd,
                recFrames = _recFrames.Count,
                replaying = _replayCmd != null,
                replayCmd = _replayCmd,
                cached = Recordings.Count,
                batchRunning = _batchRunning,
                batchDone = _batchDone,
                batchTotal = _batchTotal
            });
        }
        catch { return "{}"; }
    }

    public static void ClearAllRecordings()
    {
        Recordings.Clear();
        try { if (Directory.Exists(RecordingsDir)) Directory.Delete(RecordingsDir, true); } catch { }
    }

    public void Dispose()
    {
        if (_recording) StopRecording();
        StopReplay();
    }
}
