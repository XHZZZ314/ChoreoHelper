// 插件内 XAT 调用编排（TASK-20260917-PLUGIN-XAT-INVOCATION）：定位随包转换器 → 哈希钉死前置
// 校验 → 读游戏 PAP/SKLB → 容器剥离 → addSkeleton+toFbxAnimation 两步子进程缝（每次调用 45s
// 超时、可取消）→ FBX→网页剪辑 JSON。失败全显式分类（转换器缺失/运行库缺失/输入缺失/输入
// 不支持/超时/非零退出/取消），不回退搜索、不静默失败；作业相互隔离，临时目录四路径清理。
// 文件与进程经 IXatIO 注入：datalayertest 用内存假件，产品用真实实现。
using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Threading.Tasks;

namespace ChoreoHelper;

internal sealed class XatClipConverter : IDisposable
{
    public const string PinnedExeSha256 = "f9a4ae0dd7f30058d8b0092aca3c95a21185b446a9bbf347f9123e43dd1917b2";

    /// <summary>测试缝：datalayertest 用合成 exe 的哈希替换钉死值；产品路径不设（用上方常量）。</summary>
    public string? TestPinnedExeSha256 { get; init; }
    public const int PerCallTimeoutMs = 45_000;
    public const int MinInputBytes = 16;
    public const int MaxInputBytes = 8 * 1024 * 1024;
    private const int MaxRetainedJobs = 20;
    private const string ExeFileName = "XATHavokInterop.exe";

    public enum FailureKind { None, Busy, ConverterMissing, RuntimeMissing, InputMissing, UnsupportedInput, Timeout, NonZeroExit, Cancelled, Internal }

    public sealed class StartResult
    {
        public bool Ok;
        public string? JobId;
        public FailureKind Error;
        public string Message = "";
    }

    public sealed class JobStatus
    {
        public string id = "";
        public string state = "";     // running / succeeded / failed / cancelled
        public string stage = "";     // 人类可读阶段名（进度显示）
        public string papPath = "";
        public string skeletonPath = "";
        public string clipName = "";
        public FailureKind errorKind = FailureKind.None;
        public string message = "";
        public long elapsedMs;
        public string? clipJson;      // includeResult=true 时携带
        public string? skeletonJson;
        public int bones;
        public int frames;
        public double duration;
    }

    /// <summary>进程调用一次的请求与结果（45s 超时与杀进程由实现负责）。</summary>
    public sealed record ToolInvocation(string ExePath, string[] Args, string WorkDir, int TimeoutMs);

    public sealed record ToolInvocationResult(bool Started, int ExitCode, string StdOut, string StdErr, bool TimedOut, bool Cancelled, int? StartNativeError)
    {
        public static ToolInvocationResult NotStarted(int nativeError) => new(false, -1, "", "", false, false, nativeError);
    }

    /// <summary>文件系统与子进程缝（测试注入点）。路径一律绝对。</summary>
    public interface IXatIO
    {
        bool FileExists(string path);
        byte[] ReadAllBytes(string path);
        void WriteAllBytes(string path, byte[] data);
        void CreateDirectory(string path);
        void DeleteDirectory(string path);
        Task<ToolInvocationResult> RunToolAsync(ToolInvocation invocation, CancellationToken ct);
    }

    private sealed class RealIO : IXatIO
    {
        public bool FileExists(string path) => File.Exists(path);
        public byte[] ReadAllBytes(string path) => File.ReadAllBytes(path);
        public void WriteAllBytes(string path, byte[] data) => File.WriteAllBytes(path, data);
        public void CreateDirectory(string path) => Directory.CreateDirectory(path);
        public void DeleteDirectory(string path) => Directory.Delete(path, true);

        public async Task<ToolInvocationResult> RunToolAsync(ToolInvocation invocation, CancellationToken ct)
        {
            var psi = new ProcessStartInfo
            {
                FileName = invocation.ExePath,
                WorkingDirectory = invocation.WorkDir,
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
            };
            foreach (var a in invocation.Args) psi.ArgumentList.Add(a);
            Process process;
            try { process = Process.Start(psi) ?? throw new InvalidOperationException("converter process not created"); }
            catch (System.ComponentModel.Win32Exception e)
            {
                // 2/3 = 文件不存在（存在性检查后的竞速）；126/1154 = 依赖 DLL 缺失
                return ToolInvocationResult.NotStarted(e.NativeErrorCode);
            }
            using (process)
            {
                var stdoutTask = process.StandardOutput.ReadToEndAsync();
                var stderrTask = process.StandardError.ReadToEndAsync();
                using var timeoutCts = CancellationTokenSource.CreateLinkedTokenSource(ct);
                timeoutCts.CancelAfter(invocation.TimeoutMs);
                try { await process.WaitForExitAsync(timeoutCts.Token); }
                catch (OperationCanceledException)
                {
                    if (ct.IsCancellationRequested)
                    {
                        TryKill(process);
                        return new ToolInvocationResult(true, -1, "", "", false, true, null);
                    }
                    TryKill(process);
                    return new ToolInvocationResult(true, -1, SafeAwait(stdoutTask), SafeAwait(stderrTask), true, false, null);
                }
                return new ToolInvocationResult(true, process.ExitCode, SafeAwait(stdoutTask), SafeAwait(stderrTask), false, false, null);
            }
        }

        private static void TryKill(Process process)
        {
            try { process.Kill(entireProcessTree: true); } catch { }
            try { process.WaitForExit(5000); } catch { }
        }

        private static string SafeAwait(Task<string> task)
        {
            try { return task.WaitAsync(TimeSpan.FromSeconds(5)).GetAwaiter().GetResult(); } catch { return ""; }
        }
    }

    // ---- 状态 ----
    private readonly IXatIO _io;
    private readonly Func<string, byte[]?> _gameFileReader;
    private readonly string _toolsDir;
    private readonly string _tempRoot;
    private readonly Action<string>? _cleanupFailed;
    private readonly SemaphoreSlim _startLock = new(1, 1);
    private readonly ConcurrentDictionary<string, Job> _jobs = new();
    private volatile Job? _running;
    private int _seq;

    private sealed class Job
    {
        public string Id = "";
        public volatile string State = "running";
        public volatile string Stage = "";
        public string PapPath = "";
        public string SkeletonPath = "";
        public string ClipName = "";
        public FailureKind ErrorKind;
        public string Message = "";
        public long StartedAt;
        public string? ClipJson;
        public string? SkeletonJson;
        public int Bones;
        public int Frames;
        public double Duration;
        public CancellationTokenSource Cts = new();
        public Task Run = Task.CompletedTask;
    }

    /// <param name="toolsDir">tools/xat 绝对目录（生产=插件安装位解析；测试/证据=沙箱显式指定）。</param>
    /// <param name="gameFileReader">游戏相对路径 → 字节（null=未命中）；生产实现在框架线程读 DataManager。</param>
    /// <param name="tempRoot">临时工作目录根；null = %TEMP%/ChoreoHelper。</param>
    /// <param name="cleanupFailed">临时目录清理失败观察者（锁文件等边缘）：只上报不抛出，作业终态不受影响。</param>
    public XatClipConverter(string toolsDir, Func<string, byte[]?> gameFileReader, string? tempRoot = null, IXatIO? io = null, Action<string>? cleanupFailed = null)
    {
        _toolsDir = toolsDir;
        _gameFileReader = gameFileReader;
        _tempRoot = tempRoot ?? Path.Combine(Path.GetTempPath(), "ChoreoHelper");
        _io = io ?? new RealIO();
        _cleanupFailed = cleanupFailed;
    }

    /// <summary>生产用：按 ExportServer.FindWebRoot 同源模式从程序集位置解析 dist/ChoreoHelper/tools/xat。</summary>
    public static string ResolveDefaultToolsDir()
    {
        string[] candidates =
        {
            Path.Combine(AppContext.BaseDirectory, "dist", "ChoreoHelper"),
            Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "..", "..", "dist", "ChoreoHelper"),
        };
        var asmDir = Path.GetDirectoryName(typeof(XatClipConverter).Assembly.Location) ?? AppContext.BaseDirectory;
        candidates = candidates.Prepend(Path.Combine(asmDir, "dist", "ChoreoHelper")).ToArray();
        foreach (var webRoot in candidates)
        {
            var tools = Path.Combine(webRoot, "tools", "xat");
            if (_ioExists(tools)) return tools;
        }
        // 解析不到也要给一个确定路径用于显式报缺（不做任何文件系统搜索）
        return Path.Combine(candidates[0], "tools", "xat");
    }

    private static bool _ioExists(string dir)
    {
        try { return Directory.Exists(dir) && File.Exists(Path.Combine(dir, ExeFileName)); }
        catch { return false; }
    }

    // ---- 路径校验（bt_common PAP + 对应基础 SKLB；字母表沿用 SkillResourcePath 口径） ----

    public static string? ValidatePaths(string? papPath, string? skeletonPath)
    {
        if (string.IsNullOrWhiteSpace(papPath) || string.IsNullOrWhiteSpace(skeletonPath))
            return "请提供 PAP 与骨架 SKLB 的游戏相对路径";
        if (papPath.Length > 240 || skeletonPath.Length > 240) return "路径过长";
        var prefix = "chara/human/";
        if (!papPath.StartsWith(prefix, StringComparison.Ordinal)) return "PAP 路径必须位于 chara/human/ 下";
        var rest = papPath[prefix.Length..];
        var slash = rest.IndexOf('/');
        if (slash != 5 || rest[..5].Length != 5 || rest[0] != 'c' || !char.IsAsciiDigit(rest[1]) || !char.IsAsciiDigit(rest[2]) || !char.IsAsciiDigit(rest[3]) || !char.IsAsciiDigit(rest[4]))
            return "PAP 路径骨架代码格式应为 c####";
        var code = rest[..5];
        var expected = $"chara/human/{code}/skeleton/base/b0001/skl_{code}b0001.sklb";
        if (skeletonPath != expected) return $"骨架路径应为 {expected}";
        var papPrefix = $"chara/human/{code}/animation/a0001/bt_common/";
        if (!papPath.StartsWith(papPrefix, StringComparison.Ordinal)) return $"PAP 路径应为 {papPrefix}<时间轴键>.pap";
        var key = papPath[papPrefix.Length..];
        if (!key.EndsWith(".pap", StringComparison.Ordinal) || key.Length <= 4) return "PAP 路径应以时间轴键+.pap 结尾";
        key = key[..^4];
        foreach (var part in key.Split('/'))
        {
            if (part.Length == 0 || part.Length > 96) return "时间轴键分段为空或过长";
            foreach (var c in part)
                if (!(c is >= 'a' and <= 'z' or >= 'A' and <= 'Z' or >= '0' and <= '9' or '_' or '-')) return $"时间轴键含不支持字符：{c}";
        }
        return null;
    }

    /// <summary>从 PAP 路径提取源骨架代码（c0101 形态），供剪辑 sourceSkeleton 标注。</summary>
    public static string SkeletonCodeOf(string papPath) => papPath.Split('/')[2];

    // ---- 作业管理 ----

    public StartResult StartJob(string papPath, string skeletonPath, string clipName)
    {
        var invalid = ValidatePaths(papPath, skeletonPath);
        if (invalid != null) return new StartResult { Ok = false, Error = FailureKind.UnsupportedInput, Message = invalid };
        if (string.IsNullOrWhiteSpace(clipName) || clipName.Length > 64) return new StartResult { Ok = false, Error = FailureKind.UnsupportedInput, Message = "动作名不能为空且不超过 64 字符" };
        if (!_startLock.Wait(0)) return new StartResult { Ok = false, Error = FailureKind.Busy, Message = "已有转换在进行中，请等它结束或先取消" };
        try
        {
            // 单槽互斥看 _running（RunJobAsync 完成时清空）：上一作业未收尾前拒绝新作业
            if (_running is { State: "running" })
                return new StartResult { Ok = false, Error = FailureKind.Busy, Message = "已有转换在进行中，请等它结束或先取消" };
            var job = new Job
            {
                Id = "xat-" + Interlocked.Increment(ref _seq) + "-" + DateTime.Now.ToString("HHmmss"),
                PapPath = papPath,
                SkeletonPath = skeletonPath,
                ClipName = clipName,
                StartedAt = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
            };
            job.Run = Task.Run(() => RunJobAsync(job));
            _jobs[job.Id] = job;
            TrimRetained();
            _running = job;
            return new StartResult { Ok = true, JobId = job.Id };
        }
        finally { _startLock.Release(); }
    }

    private void TrimRetained()
    {
        if (_jobs.Count <= MaxRetainedJobs) return;
        foreach (var stale in _jobs.OrderBy(k => k.Value.StartedAt).Take(_jobs.Count - MaxRetainedJobs).ToList())
            if (stale.Value.State != "running") _jobs.TryRemove(stale.Key, out _);
    }

    public bool Cancel(string jobId)
    {
        if (!_jobs.TryGetValue(jobId, out var job)) return false;
        job.Cts.Cancel();
        return true;
    }

    public JobStatus? GetStatus(string jobId, bool includeResult)
    {
        if (!_jobs.TryGetValue(jobId, out var job)) return null;
        return Snapshot(job, includeResult);
    }

    public List<JobStatus> ListJobs() => _jobs.Values.OrderByDescending(j => j.StartedAt).Select(j => Snapshot(j, false)).ToList();

    public void Dispose()
    {
        foreach (var job in _jobs.Values) job.Cts.Cancel();
        var deadline = Environment.TickCount64 + 5000;
        while (_running?.State == "running" && Environment.TickCount64 < deadline) Thread.Sleep(50);
        _startLock.Dispose();
    }

    private static JobStatus Snapshot(Job job, bool includeResult) => new()
    {
        id = job.Id,
        state = job.State,
        stage = job.Stage,
        papPath = job.PapPath,
        skeletonPath = job.SkeletonPath,
        clipName = job.ClipName,
        errorKind = job.ErrorKind,
        message = job.Message,
        elapsedMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() - job.StartedAt,
        clipJson = includeResult ? job.ClipJson : null,
        skeletonJson = includeResult ? job.SkeletonJson : null,
        bones = job.Bones,
        frames = job.Frames,
        duration = job.Duration,
    };

    private async Task RunJobAsync(Job job)
    {
        var ct = job.Cts.Token;
        var tempDir = Path.Combine(_tempRoot, job.Id);
        try
        {
            job.Stage = "定位随包转换器";
            var exePath = Path.Combine(_toolsDir, ExeFileName);
            if (!_io.FileExists(exePath))
            {
                Fail(job, FailureKind.ConverterMissing, $"转换器缺失：{exePath} 不存在。不做文件系统回退搜索；请修复或重装插件包（含 tools/xat/XATHavokInterop.exe）。");
                return;
            }
            var exeBytes = _io.ReadAllBytes(exePath);
            var exeHash = Convert.ToHexString(SHA256.HashData(exeBytes)).ToLowerInvariant();
            if (exeHash != (TestPinnedExeSha256 ?? PinnedExeSha256))
            {
                Fail(job, FailureKind.ConverterMissing, $"转换器已损坏或被替换（SHA-256 {exeHash[..12]}… ≠ 钉死值）。为防运行未知二进制，已拒绝执行；请修复或重装插件包。");
                return;
            }

            job.Stage = "读取游戏资源";
            var pap = ReadGameFile(job, job.PapPath);
            var sklb = ReadGameFile(job, job.SkeletonPath);
            if (job.State != "running") return;
            ct.ThrowIfCancellationRequested();

            job.Stage = "剥离 Havok 容器";
            var header = XatHavokUnwrap.ReadPapHeader(pap);
            if (header.Count != 1)
            {
                Fail(job, FailureKind.UnsupportedInput, $"多 entry PAP（count={header.Count}）暂不支持：按已证缝只接受单动画条目，不猜测切分。");
                return;
            }
            byte[] animationHkt, skeletonHkt;
            try
            {
                animationHkt = XatHavokUnwrap.UnwrapPap(pap, header.Skeleton);
                skeletonHkt = XatHavokUnwrap.UnwrapSklb(sklb);
            }
            catch (FormatException e)
            {
                Fail(job, FailureKind.UnsupportedInput, "容器不支持：" + e.Message);
                return;
            }

            job.Stage = "调用转换器（addSkeleton）";
            _io.CreateDirectory(tempDir);
            var animationPath = Path.Combine(tempDir, "animation.hkt");
            var skeletonPath = Path.Combine(tempDir, "skeleton.hkt");
            var combinedPath = Path.Combine(tempDir, "combined.hkt");
            var fbxPath = Path.Combine(tempDir, "animation.fbx");
            _io.WriteAllBytes(animationPath, animationHkt);
            _io.WriteAllBytes(skeletonPath, skeletonHkt);
            var first = await Invoke(job, ct, exePath, tempDir,
                new[] { "addSkeleton", animationPath, skeletonPath, "0", combinedPath });
            if (first == null || job.State != "running") return;

            job.Stage = "调用转换器（toFbxAnimation）";
            var second = await Invoke(job, ct, exePath, tempDir,
                new[] { "toFbxAnimation", combinedPath, "0", "0", fbxPath });
            if (second == null || job.State != "running") return;

            job.Stage = "生成网页剪辑";
            XatFbxClipReader.FbxClipResult clip;
            try
            {
                clip = XatFbxClipReader.Convert(_io.ReadAllBytes(fbxPath), job.ClipName, SkeletonCodeOf(job.PapPath));
            }
            catch (FormatException e)
            {
                Fail(job, FailureKind.UnsupportedInput, "转换输出不支持：" + e.Message);
                return;
            }
            catch (OverflowException e)
            {
                Fail(job, FailureKind.UnsupportedInput, "转换输出数值超界：" + e.Message);
                return;
            }

            job.ClipJson = clip.ClipJson;
            job.SkeletonJson = clip.SkeletonJson;
            job.Bones = clip.Bones;
            job.Frames = clip.Frames;
            job.Duration = clip.Duration;
            job.Stage = "完成";
            job.State = "succeeded";
            job.Message = $"转换成功：{clip.Bones} 骨 / {clip.Frames} 帧 / {clip.Duration:F3}s";
        }
        catch (OperationCanceledException)
        {
            // ReadGameFile 等内部哨兵取消发生在 Fail 之后：失败态已写入，不得被本分支覆盖
            if (job.State == "running")
            {
                job.State = "cancelled";
                job.Stage = "已取消";
                job.ErrorKind = FailureKind.Cancelled;
                job.Message = "已取消：用户或插件卸载中止了本次转换，未产出动作。";
            }
        }
        catch (Exception e)
        {
            Fail(job, FailureKind.Internal, "内部错误：" + e.Message);
        }
        finally
        {
            // 四路径（成功/失败/取消/卸载）清理；失败只上报不抛出，不覆盖作业终态
            try { _io.DeleteDirectory(tempDir); }
            catch (Exception e) when (e is IOException or UnauthorizedAccessException)
            {
                _cleanupFailed?.Invoke($"临时目录清理失败（可忽略，下次转换会重建）：{tempDir}：{e.Message}");
            }
            _running = null;
        }
    }

    private byte[] ReadGameFile(Job job, string path)
    {
        byte[]? bytes = null;
        try { bytes = _gameFileReader(path); }
        catch (Exception e)
        {
            Fail(job, FailureKind.Internal, "读取游戏文件失败（" + path + "）：" + e.Message);
            throw new OperationCanceledException();
        }
        if (bytes == null || bytes.Length is < MinInputBytes or > MaxInputBytes)
        {
            Fail(job, FailureKind.InputMissing, $"游戏文件不存在或大小超限（{path}，{(bytes?.Length ?? 0)} 字节）。请确认动作键与骨架代码正确。");
            throw new OperationCanceledException();
        }
        return bytes;
    }

    /// <summary>单次转换器调用。返回 null = 已失败/已取消（状态已写回 job）。</summary>
    private async Task<ToolInvocationResult?> Invoke(Job job, CancellationToken ct, string exePath, string workDir, string[] args)
    {
        ToolInvocationResult r;
        try
        {
            r = await _io.RunToolAsync(new ToolInvocation(exePath, args, workDir, PerCallTimeoutMs), ct);
        }
        catch (Exception e)
        {
            Fail(job, FailureKind.Internal, "转换器调用异常：" + e.Message);
            return null;
        }
        if (r.Cancelled)
        {
            job.State = "cancelled";
            job.Stage = "已取消";
            job.ErrorKind = FailureKind.Cancelled;
            job.Message = "已取消：用户或插件卸载中止了本次转换，未产出动作。";
            return null;
        }
        if (!r.Started)
        {
            if (r.StartNativeError is 126 or 1154)
            {
                Fail(job, FailureKind.RuntimeMissing,
                    "VC++ 2012 x86 运行库缺失或损坏（MSVCP110/MSVCR110 随包 DLL 不可用，系统错误 " + r.StartNativeError + "）。不扫描系统目录、不改 PATH；请修复或重装插件包。");
            }
            else
            {
                Fail(job, FailureKind.ConverterMissing,
                    "转换器启动失败（系统错误 " + r.StartNativeError + "）。不做文件系统回退搜索；请修复或重装插件包。");
            }
            return null;
        }
        if (r.TimedOut)
        {
            Fail(job, FailureKind.Timeout, $"转换器单次调用超过 {PerCallTimeoutMs / 1000}s，已终止进程。可重试；若持续超时请重启游戏后重试。");
            return null;
        }
        if (r.ExitCode == unchecked((int)0xC0000135) || r.ExitCode == unchecked((int)0xC0000139))
        {
            Fail(job, FailureKind.RuntimeMissing,
                $"VC++ 2012 x86 运行库缺失或损坏（MSVCP110/MSVCR110 随包 DLL 不可用，退出码 0x{r.ExitCode & 0xFFFFFFFF:X8}）。不扫描系统目录、不改 PATH；请修复或重装插件包。");
            return null;
        }
        if (r.ExitCode != 0)
        {
            Fail(job, FailureKind.NonZeroExit,
                $"转换器失败（退出码 {r.ExitCode}）：{Excerpt(r.StdOut)} {Excerpt(r.StdErr)}".Trim());
            return null;
        }
        return r;
    }

    private static void Fail(Job job, FailureKind kind, string message)
    {
        job.State = "failed";
        job.Stage = "失败";
        job.ErrorKind = kind;
        job.Message = message;
    }

    private static string Excerpt(string text)
    {
        var trimmed = (text ?? "").Trim();
        if (trimmed.Length <= 200) return trimmed;
        return trimmed[..200] + "…";
    }
}
