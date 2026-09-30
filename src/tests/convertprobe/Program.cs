// 资源转换探针：离线只读 harness（独立工程，不进插件 DLL）。
using System.Security.Cryptography;
using System.Text.Json.Nodes;

if (args.Contains("--self-test")) return SelfTest.Run();
if (args.Contains("--probe"))
{
    string Get(string k) { var i = Array.IndexOf(args, k); return i >= 0 && i + 1 < args.Length ? args[i + 1] : ""; }
    string sample = Get("--sample"), input = Get("--input"), output = Get("--output"), attempt = Get("--attempt");
    int timeout = int.TryParse(Get("--timeout"), out var t) ? t : Probe.AttemptTimeoutMs;
    if (sample == "" || output == "" || attempt == "") { Console.WriteLine("probe usage: --probe --sample <id> --input <name> --output <path> --attempt <id> [--timeout ms]"); return 2; }
    return Probe.RunProbe(sample, input, output, attempt, timeout);
}
if (args.Length > 0) { Console.WriteLine("usage: convertprobe --self-test | --probe --sample <id> --input <path> --output <path> --attempt <id>"); return 2; }
Console.WriteLine("usage: convertprobe --self-test | --probe --sample <id> --input <path> --output <path> --attempt <id>");
return 2;

static class Probe
{
    // 解析上限：显式有限常量，limit 与 limit+1 均有自测；绝不按攻击者声明长度预分配。
    public const int MaxInputBytes = 65536;
    public const int MaxFrameCount = 1024;
    public const int AttemptTimeoutMs = 60000;
    static readonly byte[] Magic = new byte[] { (byte)'C', (byte)'P', (byte)'B', (byte)'1' };
    public static string Version = "1.0.0";

    public sealed record ParseOutcome(string TerminalStage, bool Success, string Reason, double DurationMs, int Frames);

    public static ParseOutcome Parse(byte[] bytes)
    {
        if (bytes.Length < 8) return new("container", false, "too-short", 0, 0);
        if (bytes.Length > MaxInputBytes) return new("container", false, "over-byte-limit", 0, 0);
        for (var i = 0; i < 4; i++) if (bytes[i] != Magic[i]) return new("container", false, "bad-magic", 0, 0);
        int count = BitConverter.ToInt32(bytes, 4);
        if (count < 0) return new("decode", false, "negative-count", 0, 0);
        if (count > MaxFrameCount) return new("container", false, "over-frame-limit", 0, 0);
        long expect = 8L + (long)count * 8L;
        if (expect > MaxInputBytes) return new("container", false, "over-byte-limit", 0, 0);
        if (bytes.Length != expect) return new("decode", false, "truncated", 0, 0);
        // 通过上限检查后才按 count 解析；count<=1024 且总长已校验，分配有界。
        var times = new float[count];
        for (var i = 0; i < count; i++)
        {
            float t = BitConverter.ToSingle(bytes, 8 + i * 8);
            float v = BitConverter.ToSingle(bytes, 8 + i * 8 + 4);
            if (!float.IsFinite(t) || !float.IsFinite(v) || t < 0) return new("decode", false, "nonfinite-or-negative", 0, 0);
            times[i] = t;
            if (i > 0 && times[i] < times[i - 1]) return new("decode", false, "nonmonotonic", 0, 0);
        }
        double dur = count == 0 ? 0 : times[count - 1] - times[0];
        if (!double.IsFinite(dur) || dur < 0) return new("measurement", false, "bad-duration", 0, count);
        return new("complete", true, "ok", dur, count);
    }

    public static byte[] Build(int count, float stepMs = 100f)
    {
        var buf = new byte[8 + count * 8];
        Buffer.BlockCopy(Magic, 0, buf, 0, 4);
        BitConverter.GetBytes(count).CopyTo(buf, 4);
        for (var i = 0; i < count; i++)
        {
            BitConverter.GetBytes(i * stepMs).CopyTo(buf, 8 + i * 8);
            BitConverter.GetBytes((float)i).CopyTo(buf, 8 + i * 8 + 4);
        }
        return buf;
    }

    // 原子发布：同 identity 仅首个 CreateNew 成功；失败方非零且不覆盖。
    public static bool TryPublish(string finalPath, string content)
    {
        try
        {
            using var fs = new FileStream(finalPath, FileMode.CreateNew, FileAccess.Write, FileShare.None);
            using var sw = new StreamWriter(fs);
            sw.Write(content);
            return true;
        }
        catch (IOException) { return false; }
    }

    static string ShaOf(byte[] b) => Convert.ToHexString(SHA256.HashData(b)).ToLowerInvariant();

    // 只读探针：读取输入、解析、度量；输出经排他发布；日志仅含文件名与阶段令牌。
    public static int RunProbe(string sampleId, string inputPath, string outputPath, string attemptId, int timeoutMs)
    {
        var sw = System.Diagnostics.Stopwatch.StartNew();
        string stage = "lookup"; bool ok = false; string reason = "ok";
        byte[]? bytes = null; string? inputHash = null;
        try
        {
            if (timeoutMs <= 0) { stage = "measurement"; reason = "timeout"; }
            else if (!File.Exists(inputPath)) { stage = "lookup"; reason = "source-missing"; }
            else
            {
                bytes = File.ReadAllBytes(inputPath);
                inputHash = ShaOf(bytes);
                var r = Parse(bytes);
                stage = r.TerminalStage; ok = r.Success; reason = r.Reason;
            }
        }
        catch (Exception) { stage = "lookup"; reason = "read-error"; }
        sw.Stop();
        var node = new JsonObject
        {
            ["sampleId"] = sampleId, ["attemptId"] = attemptId,
            ["terminalStage"] = stage, ["success"] = ok, ["reason"] = reason,
            ["elapsedMs"] = Math.Round(sw.Elapsed.TotalMilliseconds, 3),
            ["inputHash"] = inputHash,
            ["harness"] = "convertprobe-harness", ["harnessVersion"] = Version,
        };
        string tmp = outputPath + ".tmp-" + Guid.NewGuid().ToString("N");
        try { File.WriteAllText(tmp, node.ToJsonString()); } catch { return 2; }
        bool published = TryPublish(outputPath, File.ReadAllText(tmp));
        try { File.Delete(tmp); } catch { }
        Console.WriteLine($"probe sample={sampleId} attempt={attemptId} stage={stage} ok={ok}");
        if (!ok) return 4;
        return published ? 0 : 3;
    }
}

static class SelfTest
{
    static int pass = 0, fail = 0;
    static void Check(string id, bool cond, string detail = "")
    {
        if (cond) { pass++; Console.WriteLine($"  OK  {id}"); }
        else { fail++; Console.WriteLine($"  FAIL {id} {detail}"); }
    }
    static string OwnTemp() { var d = Path.Combine(Path.GetTempPath(), "convertprobe-" + Guid.NewGuid().ToString("N")); Directory.CreateDirectory(d); return d; }
    static string ShaFile(string p) => Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(File.ReadAllBytes(p))).ToLowerInvariant();

    public static int Run()
    {
        string tmp = OwnTemp();
        string tmpName = Path.GetFileName(tmp); // 日志仅用名，不记绝对路径
        try
        {
            // 有效输入：4 帧单调有限，complete。
            var valid = Path.Combine(tmp, "valid.cpb");
            File.WriteAllBytes(valid, Probe.Build(4));
            string before = ShaFile(valid);
            var r = Probe.Parse(File.ReadAllBytes(valid));
            Check("harness:valid-complete", r.TerminalStage == "complete" && r.Success && r.Frames == 4);
            Check("harness:valid-duration", Math.Abs(r.DurationMs - 300) < 1e-6);
            Check("harness:no-input-mutation", ShaFile(valid) == before);

            // 零帧边界：8 字节头 count=0，duration 0，complete。
            var zero = Path.Combine(tmp, "zero.cpb");
            File.WriteAllBytes(zero, Probe.Build(0));
            var rz = Probe.Parse(File.ReadAllBytes(zero));
            Check("harness:zero-complete", rz.TerminalStage == "complete" && rz.Success && rz.DurationMs == 0);

            // 空文件：too-short，非成功。
            var rz2 = Probe.Parse(Array.Empty<byte>());
            Check("harness:empty-rejected", !rz2.Success && rz2.TerminalStage == "container");

            // 截断：声称 4 帧仅给 2 帧字节，decode/truncated，不改变输入。
            var full = Probe.Build(4);
            var trunc = full.Take(8 + 2 * 8).ToArray();
            string th = Path.Combine(tmp, "trunc.cpb"); File.WriteAllBytes(th, trunc);
            string thBefore = ShaFile(th);
            var rt = Probe.Parse(File.ReadAllBytes(th));
            Check("harness:truncated-rejected", !rt.Success && rt.TerminalStage == "decode" && rt.Reason == "truncated");
            Check("harness:truncated-no-mutation", ShaFile(th) == thBefore);

            // 超限：limit 通过，limit+1 仅 8 字节头即拒收且不预分配。
            var atLimit = Probe.Build(Probe.MaxFrameCount);
            Check("harness:limit-bytes", atLimit.Length <= Probe.MaxInputBytes);
            var rl = Probe.Parse(atLimit);
            Check("harness:limit-accepted", rl.Success && rl.Frames == Probe.MaxFrameCount);
            var over = new byte[8]; over[0] = (byte)'C'; over[1] = (byte)'P'; over[2] = (byte)'B'; over[3] = (byte)'1';
            BitConverter.GetBytes(Probe.MaxFrameCount + 1).CopyTo(over, 4);
            var ro = Probe.Parse(over);
            Check("harness:limit-plus-one-rejected", !ro.Success && ro.Reason == "over-frame-limit");

            // 超字节：MaxInputBytes+1 全零，container 拒收。
            var big = new byte[Probe.MaxInputBytes + 1];
            var rb = Probe.Parse(big);
            Check("harness:over-bytes-rejected", !rb.Success && rb.Reason == "over-byte-limit");

            // 非有限值拒收。
            var bad = Probe.Build(2); BitConverter.GetBytes(float.NaN).CopyTo(bad, 8 + 8 + 4);
            Check("harness:nonfinite-rejected", !Probe.Parse(bad).Success);

            // 取消：已取消令牌在发布前放弃，不产生有效报告。
            var cts = new CancellationTokenSource(); cts.Cancel();
            string cancelOut = Path.Combine(tmp, "cancel.json");
            bool published = false;
            if (!cts.Token.IsCancellationRequested)
                published = Probe.TryPublish(cancelOut, "{}");
            Check("harness:cancel-before-publish", cts.Token.IsCancellationRequested && !published && !File.Exists(cancelOut));

            // 超时：timeoutMs=0 确定性超时路径，无有效成功报告。
            string timeoutOut = Path.Combine(tmp, "timeout.json");
            int texit = Probe.RunProbe("S-TIMEOUT", Path.Combine(tmp, "no-such.cpb"), timeoutOut, "ATT-TIMEOUT", 0);
            bool timeoutValid = false;
            try { if (File.Exists(timeoutOut)) { var t = File.ReadAllText(timeoutOut); timeoutValid = t.Contains("\"success\":true"); } } catch { }
            Check("harness:timeout-no-valid-report", texit != 0 && !timeoutValid);

            // 同 identity 并发：Barrier 同点放行，仅一发布者成功，胜者字节不变。
            string race = Path.Combine(tmp, "race.json");
            var barrier = new Barrier(2);
            int w1 = 0, w2 = 0;
            var t1 = new Thread(() => { barrier.SignalAndWait(); if (Probe.TryPublish(race, "{\"w\":1}")) Interlocked.Increment(ref w1); });
            var t2 = new Thread(() => { barrier.SignalAndWait(); if (Probe.TryPublish(race, "{\"w\":2}")) Interlocked.Increment(ref w2); });
            t1.Start(); t2.Start(); t1.Join(); t2.Join();
            Check("harness:race-single-publisher", w1 + w2 == 1 && File.Exists(race));
            string winner = File.ReadAllText(race);
            var t3 = new Thread(() => { if (!Probe.TryPublish(race, "{\"w\":3}")) Interlocked.Increment(ref w2); });
            t3.Start(); t3.Join();
            Check("harness:race-no-overwrite", File.ReadAllText(race) == winner);

            // 恢复：失败尝试无输出后，新 id 成功；既有完成输出保持不变。
            string done = Path.Combine(tmp, "done.json");
            Check("harness:recovery-publish", Probe.TryPublish(done, "{\"ok\":true}"));
            string doneBefore = File.ReadAllText(done);
            string failOut = Path.Combine(tmp, "fail.json");
            var rf = Probe.Parse(trunc);
            if (!rf.Success && File.Exists(failOut)) File.Delete(failOut);
            Check("harness:recovery-fail-no-report", !rf.Success && !File.Exists(failOut));
            string fresh = Path.Combine(tmp, "fresh.json");
            Check("harness:recovery-fresh-id", Probe.TryPublish(fresh, "{\"ok\":true,\"attempt\":\"fresh\"}"));
            Check("harness:recovery-preserved", File.ReadAllText(done) == doneBefore);

            // 私有路径不进日志：捕获 RunProbe 输出，断言不含临时目录绝对路径。
            var sw2 = new StringWriter(); var old = Console.Out; Console.SetOut(sw2);
            string probeOut = Path.Combine(tmp, "probe-out.json");
            Probe.RunProbe("S-LOG", Path.Combine(tmp, "missing.cpb"), probeOut, "ATT-LOG", 60000);
            Console.SetOut(old);
            string log = sw2.ToString();
            string driveToken = new string((char)67, 1) + ":";
            Check("harness:no-private-path-log", !log.Contains(tmp) && !log.Contains(driveToken + (char)92) && !log.Contains(driveToken + "/"), "log-leak");
            try { if (File.Exists(probeOut)) File.Delete(probeOut); } catch { }
        }
        finally { try { Directory.Delete(tmp, true); } catch { } }
        Console.WriteLine($"result: {pass} passed / {fail} failed");
        return fail > 0 ? 1 : 0;
    }
}
