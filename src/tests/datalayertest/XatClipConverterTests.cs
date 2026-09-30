// 插件内 XAT 调用编排离线回归（TASK-20260917-PLUGIN-XAT-INVOCATION）：合成夹具 + 内存假件。
// [xat-unwrap] PAP/SKLB 容器剥离（等价 resource_container.py：单 entry/双版本/坏头坏偏移）；
// [xat-fbx] FBX 窄解析（合成 FBX 字节：KeyTime 走 zlib 数组、双骨父子、欧拉→四元数、时长/
// 时基、拒绝枢轴/非默认欧拉序/缺轴/时间回退）；[xat-converter] 编排全路径（两步缝 argv/
// 45s 超时/取消与四路径清理/逐作业隔离/Busy/转换器缺失/哈希不符/运行库缺失两码/非零退出/
// 多 entry/输入缺失/路径校验）。真 exe 与真样本不进单元套件（证据脚本离线端到端覆盖）。
using System;
using System.Collections.Generic;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json.Nodes;
using System.Threading;
using System.Threading.Tasks;
using ChoreoHelper;

internal static class XatClipConverterCases
{
    public delegate void CheckFn(string name, bool cond, string? detail = null);

    public static int RunNamed(string namedCase, bool red)
    {
        var fails = 0;
        void Check(string name, bool cond, string? detail = null)
        {
            if (cond) { if (!red) Console.WriteLine($"  OK  {name}"); }
            else { fails++; Console.WriteLine($"  FAIL  {name} {detail}"); }
        }
        switch (namedCase)
        {
            case "xat-unwrap": UnwrapCases(Check); break;
            case "xat-fbx": FbxCases(Check); break;
            case "xat-converter": ConverterCases(Check); break;
        }
        Console.WriteLine($"结果：{namedCase} {fails} 项失败");
        return fails == 0 ? 0 : 1;
    }

    public static void Run(CheckFn check)
    {
        UnwrapCases(check);
        FbxCases(check);
        ConverterCases(check);
    }

    // ---- 合成容器夹具 ----

    private static byte[] Pap(byte[] payload)
    {
        var nameTable = new byte[40];
        var info = 26;
        var start = info + nameTable.Length;
        var end = start + payload.Length;
        var data = new byte[end];
        Encoding.ASCII.GetBytes("pap ").CopyTo(data, 0);
        WriteI16(data, 8, 1);
        WriteI32(data, 10, 101);
        WriteI32(data, 14, info);
        WriteI32(data, 18, start);
        WriteI32(data, 22, end);
        nameTable.CopyTo(data, info);
        payload.CopyTo(data, start);
        return data;
    }

    private static byte[] PapMultiEntry(int count)
    {
        var data = new byte[80];
        Encoding.ASCII.GetBytes("pap ").CopyTo(data, 0);
        WriteI16(data, 8, (short)count);
        WriteI32(data, 10, 101);
        WriteI32(data, 14, 26);
        WriteI32(data, 18, 40);
        WriteI32(data, 22, 80);
        return data;
    }

    private static byte[] Sklb(ushort version, int payloadStart)
    {
        var data = new byte[payloadStart + 32];
        Encoding.ASCII.GetBytes("blks").CopyTo(data, 0);
        WriteU16(data, 6, version);
        if (version == 0x3132) WriteU16(data, 10, (ushort)payloadStart);
        else WriteI32(data, 12, payloadStart);
        for (var i = payloadStart; i < data.Length; i++) data[i] = (byte)(i - payloadStart + 1);
        return data;
    }

    private static void WriteI16(byte[] d, int o, short v) { d[o] = (byte)v; d[o + 1] = (byte)(v >> 8); }
    private static void WriteU16(byte[] d, int o, ushort v) { d[o] = (byte)v; d[o + 1] = (byte)(v >> 8); }
    private static void WriteI32(byte[] d, int o, int v) { for (var i = 0; i < 4; i++) d[o + i] = (byte)(v >> (8 * i)); }

    // ---- 合成 FBX 夹具（树构建 + 一次序列化，保证 end 为文件内绝对偏移） ----

    private sealed class NodeBuilder(string name)
    {
        public string Name => name;
        public readonly List<object> Props = new();
        public readonly List<NodeBuilder> Children = new();
        public NodeBuilder P(object prop) { Props.Add(prop); return this; }
        public NodeBuilder C(NodeBuilder child) { Children.Add(child); return this; }
    }

    private static byte[] SerializeFbx(params NodeBuilder[] tops)
    {
        var ms = new MemoryStream();
        ms.Write("Kaydara FBX Binary  \u0000\u001a\u0000"u8);
        ms.Write(BitConverter.GetBytes(7400u));
        foreach (var top in tops) WriteNode(ms, top);
        ms.Write(new byte[13]);
        return ms.ToArray();
    }

    /// <summary>写节点；baseOffset = 本流 0 偏移在最终文档中的绝对位置（子缓冲拼接用）。</summary>
    private static void WriteNode(Stream s, NodeBuilder node, long baseOffset = 0)
    {
        var propBytes = node.Props.Select(PropBytes).SelectMany(x => x).ToArray();
        var nameBytes = Encoding.UTF8.GetBytes(node.Name);
        var children = new MemoryStream();
        var childBase = baseOffset + s.Position + 13 + nameBytes.Length + propBytes.Length;
        foreach (var child in node.Children) WriteNode(children, child, childBase);
        var start = baseOffset + s.Position;
        var total = 13 + nameBytes.Length + propBytes.Length + children.Length;
        s.Write(BitConverter.GetBytes((uint)(start + total)));
        s.Write(BitConverter.GetBytes((uint)node.Props.Count));
        s.Write(BitConverter.GetBytes((uint)propBytes.Length));
        s.WriteByte((byte)nameBytes.Length);
        s.Write(nameBytes);
        s.Write(propBytes);
        children.CopyTo(s);
    }

    private static byte[] PropBytes(object p) => p switch
    {
        long l => new byte[] { (byte)'L' }.Concat(BitConverter.GetBytes(l)).ToArray(),
        int i => new byte[] { (byte)'I' }.Concat(BitConverter.GetBytes(i)).ToArray(),
        double d => new byte[] { (byte)'D' }.Concat(BitConverter.GetBytes(d)).ToArray(),
        float f => new byte[] { (byte)'F' }.Concat(BitConverter.GetBytes(f)).ToArray(),
        string str => new byte[] { (byte)'S' }
            .Concat(BitConverter.GetBytes((uint)Encoding.UTF8.GetByteCount(str)))
            .Concat(Encoding.UTF8.GetBytes(str)).ToArray(),
        long[] la => ArrayProp('l', BitConverter.GetBytes((uint)la.Length)
            .Concat(BitConverter.GetBytes(1u))
            .Concat(BitConverter.GetBytes((uint)(ZlibPack(la.SelectMany(BitConverter.GetBytes).ToArray()).Length)))
            .Concat(ZlibPack(la.SelectMany(BitConverter.GetBytes).ToArray())).ToArray()),
        float[] fa => ArrayProp('f', BitConverter.GetBytes((uint)fa.Length)
            .Concat(BitConverter.GetBytes(0u))
            .Concat(BitConverter.GetBytes((uint)(fa.Length * 4)))
            .Concat(fa.SelectMany(BitConverter.GetBytes)).ToArray()),
        _ => throw new InvalidOperationException("unsupported test prop " + p.GetType().Name),
    };

    private static byte[] ArrayProp(char kind, byte[] body) => new byte[] { (byte)kind }.Concat(body).ToArray();

    private static byte[] ZlibPack(byte[] raw)
    {
        var ms = new MemoryStream();
        using (var zs = new ZLibStream(ms, CompressionLevel.Optimal, leaveOpen: true)) zs.Write(raw);
        return ms.ToArray();
    }

    private static NodeBuilder Prop70(string name, params object[] payload)
    {
        var p = new NodeBuilder("P");
        p.P(name).P(name).P("").P("A");
        foreach (var v in payload) p.P(v);
        return p;
    }

    /// <summary>合成一份两关键帧、三通道全的双骨 FBX；开关用于负例。</summary>
    private static byte[] BuildFbx(int bones = 1, bool preRotation = false, int rotationOrder = 0, bool dropAxis = false, bool rewindTimes = false)
    {
        var objects = new NodeBuilder("Objects");
        var connections = new NodeBuilder("Connections");
        long nextId = 100;
        var modelIds = new List<long>();
        for (var b = 0; b < bones; b++)
        {
            var mid = nextId++;
            modelIds.Add(mid);
            var p70 = new NodeBuilder("Properties70");
            p70.C(preRotation ? Prop70("PreRotation", 1.0, 0.0, 0.0) : Prop70("Lcl Translation", 1.0, 2.0, 3.0));
            p70.C(Prop70("Lcl Rotation", 0.0, 0.0, 0.0));
            p70.C(Prop70("Lcl Scaling", 1.0, 1.0, 1.0));
            if (rotationOrder != 0) p70.C(Prop70("RotationOrder", (long)rotationOrder));
            var model = new NodeBuilder("Model").P((long)mid).P("bone" + b + "\u0000\u0001Model");
            model.C(p70);
            objects.C(model);
            if (b > 0) connections.C(new NodeBuilder("C").P("OO").P((long)mid).P(modelIds[b - 1]));
            foreach (var prop in new[] { "Lcl Rotation", "Lcl Translation", "Lcl Scaling" })
            {
                var curveNode = new NodeBuilder("AnimationCurveNode").P(nextId).P(prop + "\u0000\u0001AnimCurveNode");
                objects.C(curveNode);
                var curveNodeId = nextId++;
                connections.C(new NodeBuilder("C").P("OP").P((long)mid).P(curveNodeId).P(prop));
                foreach (var axis in new[] { "X", "Y", "Z" })
                {
                    if (dropAxis && axis == "Z" && prop == "Lcl Translation") continue;
                    var curveId = nextId++;
                    var times = rewindTimes ? new long[] { 46186158000L, 0 } : new long[] { 0, 46186158000L * 2 };
                    var values = prop switch
                    {
                        "Lcl Rotation" => (axis == "X" ? new float[] { 0, 90 } : new float[] { 0, 0 }),
                        "Lcl Translation" => (axis == "X" ? new float[] { 1, 5 } : axis == "Y" ? new float[] { 2, 6 } : new float[] { 3, 7 }),
                        _ => new float[] { 1, 1 },
                    };
                    var curve = new NodeBuilder("AnimationCurve").P(curveId).P("curve\u0000\u0001AnimCurve");
                    curve.C(new NodeBuilder("KeyTime").P(times));
                    curve.C(new NodeBuilder("KeyValueFloat").P(values));
                    objects.C(curve);
                    connections.C(new NodeBuilder("C").P("OP").P(curveNodeId).P(curveId).P("d|" + axis));
                }
            }
        }
        return SerializeFbx(objects, connections);
    }

    // ---- [xat-unwrap] ----

    private static void UnwrapCases(CheckFn check)
    {
        var payload = Enumerable.Range(1, 16).Select(i => (byte)i).ToArray();
        var pap = Pap(payload);
        check("PAP 单 entry 剥离载荷", XatHavokUnwrap.UnwrapPap(pap, 101).SequenceEqual(payload));
        check("PAP 头字段", XatHavokUnwrap.ReadPapHeader(pap) is { Count: 1, Skeleton: 101, Info: 26 } h && h.End == pap.Length);
        Throws(check, "PAP 多 entry 拒绝", () => XatHavokUnwrap.UnwrapPap(PapMultiEntry(2), 101), "Unsupported PAP container");
        check("PAP 多 entry 头可读（编排层显式报缺用）", XatHavokUnwrap.ReadPapHeader(PapMultiEntry(3)).Count == 3);
        Throws(check, "PAP 坏魔数拒绝", () => XatHavokUnwrap.UnwrapPap(Encoding.ASCII.GetBytes("xxx!").Concat(new byte[40]).ToArray(), 101), "Invalid PAP header");
        Throws(check, "PAP 过短拒绝", () => XatHavokUnwrap.UnwrapPap(new byte[10], 101), "Invalid PAP header");
        var bad = Pap(payload); WriteI32(bad, 18, 20);
        Throws(check, "PAP 坏偏移拒绝", () => XatHavokUnwrap.UnwrapPap(bad, 101), "Unsupported PAP container");

        var sklb32 = Sklb(0x3132, 16);
        check("SKLB v0x3132 剥离", XatHavokUnwrap.UnwrapSklb(sklb32).SequenceEqual(sklb32[16..]));
        var sklb33 = Sklb(0x3133, 20);
        check("SKLB v0x3133 剥离（u32 偏移）", XatHavokUnwrap.UnwrapSklb(sklb33).SequenceEqual(sklb33[20..]));
        Throws(check, "SKLB 未知版本拒绝", () => XatHavokUnwrap.UnwrapSklb(Sklb(0x3134, 16)), "Unsupported SKLB version");
        Throws(check, "SKLB 载荷偏移拒绝", () => XatHavokUnwrap.UnwrapSklb(Sklb(0x3132, 8)), "Unsupported SKLB payload offsets");
    }

    // ---- [xat-fbx] ----

    private static void FbxCases(CheckFn check)
    {
        var result = XatFbxClipReader.Convert(BuildFbx(), "测试动作", "c0101");
        var clip = JsonNode.Parse(result.ClipJson)!.AsObject();
        check("clip 基本字段", (string)clip["type"]! == "loop" && (string)clip["name"]! == "测试动作"
            && (string)clip["offlinePrototype"]!["sourceSkeleton"]! == "c0101" && (bool)clip["offlinePrototype"]!["productionImportApproved"]! == false);
        check("时长=最后关键帧秒（2s）", Math.Abs((double)clip["duration"]! - 2.0) < 1e-9, ((double)clip["duration"]!).ToString());
        var q1 = clip["bones"]!["bone_0"]!["q"]![1]!;
        check("欧拉(90,0,0)→四元数", Math.Abs((double)q1[0]! - 2.0) < 1e-9 && Math.Abs((double)q1[1]! - Math.Sqrt(0.5)) < 1e-6
            && (double)q1[2]! == 0 && (double)q1[3]! == 0 && Math.Abs((double)q1[4]! - Math.Sqrt(0.5)) < 1e-6);
        check("q/t/s 各 2 行（zlib KeyTime 解码）", ((JsonArray)clip["bones"]!["bone_0"]!["q"]!).Count == 2
            && ((JsonArray)clip["bones"]!["bone_0"]!["t"]!).Count == 2 && ((JsonArray)clip["bones"]!["bone_0"]!["s"]!).Count == 2);
        var t1 = clip["bones"]!["bone_0"]!["t"]![1]!;
        check("位移通道", (double)t1[1]! == 5 && (double)t1[2]! == 6 && (double)t1[3]! == 7);
        check("缩放通道", (double)clip["bones"]!["bone_0"]!["s"]![1]![1]! == 1);
        check("统计", result.Bones == 1 && result.Frames == 2 && Math.Abs(result.Duration - 2.0) < 1e-9);

        var skeleton = JsonNode.Parse(result.SkeletonJson)!.AsObject();
        check("骨架 JSON 形状", (int)skeleton["count"]! == 1 && (string)skeleton["bones"]![0]!["n"]! == "bone0" && (int)skeleton["bones"]![0]!["p"]! == -1);

        var two = XatFbxClipReader.Convert(BuildFbx(bones: 2), "双骨", "c0101");
        var skel2 = JsonNode.Parse(two.SkeletonJson)!.AsObject();
        check("双骨父子索引", (int)skel2["bones"]![1]!["p"]! == 0 && (int)skel2["bones"]![0]!["p"]! == -1 && two.Bones == 2);

        Throws(check, "枢轴拒绝", () => XatFbxClipReader.Convert(BuildFbx(preRotation: true), "x", "c0101"), "unsupported PreRotation");
        Throws(check, "非默认欧拉序拒绝", () => XatFbxClipReader.Convert(BuildFbx(rotationOrder: 1), "x", "c0101"), "unsupported RotationOrder");
        Throws(check, "缺轴通道拒绝", () => XatFbxClipReader.Convert(BuildFbx(dropAxis: true), "x", "c0101"), "incomplete channel");
        Throws(check, "时间回退拒绝", () => XatFbxClipReader.Convert(BuildFbx(rewindTimes: true), "x", "c0101"), "not increasing");
        Throws(check, "FBX 坏头拒绝", () => XatFbxClipReader.ReadFbx(new byte[40]), "Invalid FBX header");
        var badVersion = "Kaydara FBX Binary  \u0000\u001a\u0000"u8.ToArray().Concat(BitConverter.GetBytes(7600u)).Concat(new byte[16]).ToArray();
        Throws(check, "FBX 版本拒绝", () => XatFbxClipReader.ReadFbx(badVersion), "unsupported FBX version");
        var euler = XatFbxClipReader.EulerXyzStatic(new[] { 0.0, 0.0, 0.0 });
        check("零角恒等四元数", euler[0] == 0 && euler[1] == 0 && euler[2] == 0 && Math.Abs(euler[3] - 1) < 1e-12);
    }

    // ---- [xat-converter] ----

    private sealed class FakeIO : XatClipConverter.IXatIO
    {
        public readonly Dictionary<string, byte[]> Files = new();
        public readonly List<string> DeletedDirectories = new();
        public readonly List<string> CreatedDirectories = new();
        public readonly List<(string[] Args, int Timeout)> Invocations = new();
        public Func<XatClipConverter.ToolInvocation, XatClipConverter.ToolInvocationResult>? Script;
        public Action<string, string>? OnBeforeInvoke;
        public bool FailDelete;   // 模拟锁文件边缘：DeleteDirectory 抛 IOException

        public bool FileExists(string path) => Files.ContainsKey(path);
        public byte[] ReadAllBytes(string path) => Files.TryGetValue(path, out var b) ? b : throw new FileNotFoundException(path);
        public void WriteAllBytes(string path, byte[] data) => Files[path] = data;
        public void CreateDirectory(string path) => CreatedDirectories.Add(path);
        public void DeleteDirectory(string path)
        {
            DeletedDirectories.Add(path);
            if (FailDelete) throw new IOException("locked by another process");
            foreach (var k in Files.Keys.Where(k => k.StartsWith(path, StringComparison.Ordinal)).ToList()) Files.Remove(k);
        }

        public Task<XatClipConverter.ToolInvocationResult> RunToolAsync(XatClipConverter.ToolInvocation invocation, CancellationToken ct)
        {
            Invocations.Add((invocation.Args, invocation.TimeoutMs));
            OnBeforeInvoke?.Invoke(invocation.Args[0], invocation.Args[^1]);
            return Task.FromResult(Script!(invocation));
        }
    }

    private static string TempRoot => Path.Combine(Path.GetTempPath(), "choreo-xat-test-" + Guid.NewGuid().ToString("N")[..8]);

    private static string ToolsDir => Path.Combine(TempRoot, "tools", "xat");

    private static (XatClipConverter Converter, FakeIO IO) MakeConverter(Dictionary<string, byte[]> game, Action<string>? cleanupFailed = null)
    {
        var io = new FakeIO();
        var exe = Encoding.UTF8.GetBytes("fake exe for hash");
        io.Files[Path.Combine(ToolsDir, "XATHavokInterop.exe")] = exe;
        var converter = new XatClipConverter(ToolsDir, p => game.TryGetValue(p, out var b) ? b : null, TempRoot, io, cleanupFailed)
        {
            TestPinnedExeSha256 = Convert.ToHexString(SHA256.HashData(exe)).ToLowerInvariant(),
        };
        return (converter, io);
    }

    private static XatClipConverter.JobStatus? WaitDone(XatClipConverter converter, string jobId, int timeoutMs = 5000)
    {
        var deadline = Environment.TickCount64 + timeoutMs;
        while (Environment.TickCount64 < deadline)
        {
            var s = converter.GetStatus(jobId, includeResult: false);
            if (s != null && s.state != "running") return s;
            Thread.Sleep(10);
        }
        return converter.GetStatus(jobId, includeResult: false);
    }

    private static void ConverterCases(CheckFn check)
    {
        var pap = Pap(Enumerable.Range(1, 16).Select(i => (byte)i).ToArray());
        var sklb = Sklb(0x3132, 16);
        var papPath = "chara/human/c0101/animation/a0001/bt_common/limitbreak_test.pap";
        var sklbPath = "chara/human/c0101/skeleton/base/b0001/skl_c0101b0001.sklb";
        var fbx = BuildFbx();
        var game = new Dictionary<string, byte[]> { [papPath] = pap, [sklbPath] = sklb };
        var ok = new XatClipConverter.ToolInvocationResult(true, 0, "", "", false, false, null);

        // 成功路径：两步缝 argv、45s 超时、临时目录创建/清理、结果
        var (converter, io) = MakeConverter(game);
        using (converter)
        {
            io.Script = _ => ok;
            io.OnBeforeInvoke = (command, lastArg) => { if (command == "toFbxAnimation") io.Files[lastArg] = fbx; };
            var start = converter.StartJob(papPath, sklbPath, "limitbreak_test");
            check("成功路径启动", start.Ok, start.Message);
            var done = WaitDone(converter, start.JobId!);
            check("成功路径完成", done?.state == "succeeded" && done!.bones == 1 && Math.Abs(done.duration - 2.0) < 1e-9, done?.state + " " + done?.message);
            check("两步缝调用次序与 argv",
                io.Invocations.Count == 2
                && io.Invocations[0].Args is ["addSkeleton", var a1, var a2, "0", var a3] && a1.EndsWith("animation.hkt") && a2.EndsWith("skeleton.hkt") && a3.EndsWith("combined.hkt")
                && io.Invocations[1].Args is ["toFbxAnimation", var c1, "0", "0", var c2] && c1.EndsWith("combined.hkt") && c2.EndsWith("animation.fbx"),
                string.Join(" | ", io.Invocations.Select(i => string.Join(' ', i.Args.Select(Path.GetFileName)))));
            check("每次调用 45s 超时", io.Invocations.All(i => i.Timeout == 45000));
            check("临时目录在作业目录下创建并清理", io.CreatedDirectories.Count == 1 && io.DeletedDirectories.SequenceEqual(io.CreatedDirectories));
            var full = converter.GetStatus(start.JobId!, includeResult: true);
            check("结果携带 clip/skeleton JSON", full!.clipJson != null && full.skeletonJson != null && full.clipJson!.Contains("\"bone_0\""));
        }

        // 转换器缺失（exe 不存在）：无回退搜索（零调用）
        var (converterMissing, ioMissing) = MakeConverter(game);
        using (converterMissing)
        {
            ioMissing.Files.Clear();
            ioMissing.Script = _ => ok;
            var done = WaitDone(converterMissing, converterMissing.StartJob(papPath, sklbPath, "x").JobId!);
            check("转换器缺失显式报缺", done?.state == "failed" && done!.errorKind == XatClipConverter.FailureKind.ConverterMissing && done.message.Contains("转换器缺失"), done?.message);
            check("转换器缺失零调用", ioMissing.Invocations.Count == 0);
        }

        // 哈希不符（损坏/替换）：拒绝执行
        var (converterHash, ioHash) = MakeConverter(game);
        using (converterHash)
        {
            ioHash.Files[Path.Combine(ToolsDir, "XATHavokInterop.exe")] = Encoding.UTF8.GetBytes("tampered");
            ioHash.Script = _ => ok;
            var done = WaitDone(converterHash, converterHash.StartJob(papPath, sklbPath, "x").JobId!);
            check("哈希不符显式报缺且不执行", done?.state == "failed" && done!.errorKind == XatClipConverter.FailureKind.ConverterMissing && ioHash.Invocations.Count == 0, done?.message);
        }

        // 运行库缺失两码：启动失败 126 / 退出码 0xC0000135
        foreach (var (label, result) in new[] {
            ("启动失败 126", new XatClipConverter.ToolInvocationResult(false, -1, "", "", false, false, 126)),
            ("退出码 0xC0000135", new XatClipConverter.ToolInvocationResult(true, unchecked((int)0xC0000135), "", "", false, false, null)),
        })
        {
            var (c, ioRt) = MakeConverter(game);
            using (c)
            {
                ioRt.Script = _ => result;
                var done = WaitDone(c, c.StartJob(papPath, sklbPath, "x").JobId!);
                check($"运行库缺失（{label}）显式报缺", done?.state == "failed" && done!.errorKind == XatClipConverter.FailureKind.RuntimeMissing && done.message.Contains("VC++ 2012 x86"), done?.message);
            }
        }

        // 超时
        var (cTimeout, ioTimeout) = MakeConverter(game);
        using (cTimeout)
        {
            ioTimeout.Script = _ => new XatClipConverter.ToolInvocationResult(true, -1, "", "", true, false, null);
            var done = WaitDone(cTimeout, cTimeout.StartJob(papPath, sklbPath, "x").JobId!);
            check("超时显式失败", done?.state == "failed" && done!.errorKind == XatClipConverter.FailureKind.Timeout && done.message.Contains("45s"), done?.message);
        }

        // 非零退出 + 失败隔离（失败后可再成功）
        var (cExit, ioExit) = MakeConverter(game);
        using (cExit)
        {
            var failedOnce = false;
            ioExit.Script = _ => { if (failedOnce) return ok; failedOnce = true; return new XatClipConverter.ToolInvocationResult(true, 5, "out", "boom", false, false, null); };
            var done = WaitDone(cExit, cExit.StartJob(papPath, sklbPath, "x").JobId!);
            check("非零退出显式失败并带摘录", done?.state == "failed" && done!.errorKind == XatClipConverter.FailureKind.NonZeroExit && done.message.Contains("boom") && done.message.Contains("5"), done?.message);
            ioExit.OnBeforeInvoke = (command, lastArg) => { if (command == "toFbxAnimation") ioExit.Files[lastArg] = fbx; };
            var done2 = WaitDone(cExit, cExit.StartJob(papPath, sklbPath, "y").JobId!);
            check("逐作业失败隔离（失败后可再成功）", done2?.state == "succeeded" && ioExit.DeletedDirectories.Count == 2, done2?.state);
        }

        // 取消
        var (cCancel, ioCancel) = MakeConverter(game);
        using (cCancel)
        {
            ioCancel.Script = _ => new XatClipConverter.ToolInvocationResult(true, -1, "", "", false, true, null);
            var done = WaitDone(cCancel, cCancel.StartJob(papPath, sklbPath, "x").JobId!);
            check("取消显式状态并清理", done?.state == "cancelled" && ioCancel.DeletedDirectories.Count == 1, done?.state);
        }

        // 清理失败可观测（锁文件边缘）：作业终态不受影响，观察者收到含路径的上报
        var cleanupReports = new List<string>();
        var (cCleanup, ioCleanup) = MakeConverter(game, cleanupReports.Add);
        using (cCleanup)
        {
            ioCleanup.FailDelete = true;
            ioCleanup.Script = _ => ok;
            ioCleanup.OnBeforeInvoke = (command, lastArg) => { if (command == "toFbxAnimation") ioCleanup.Files[lastArg] = fbx; };
            var done = WaitDone(cCleanup, cCleanup.StartJob(papPath, sklbPath, "x").JobId!);
            check("清理失败不影响作业终态且可观测", done?.state == "succeeded" && cleanupReports.Count == 1
                && cleanupReports[0].Contains("临时目录清理失败") && cleanupReports[0].Contains("locked by another process"),
                done?.state + " | " + string.Join(";", cleanupReports));
        }

        // 多 entry / 输入缺失 / Busy
        var (cMulti, ioMulti) = MakeConverter(new Dictionary<string, byte[]> { [papPath] = PapMultiEntry(2), [sklbPath] = sklb });
        using (cMulti)
        {
            ioMulti.Script = _ => ok;
            var done = WaitDone(cMulti, cMulti.StartJob(papPath, sklbPath, "x").JobId!);
            check("多 entry PAP 显式不支持", done?.state == "failed" && done!.errorKind == XatClipConverter.FailureKind.UnsupportedInput && done.message.Contains("多 entry"), done?.message);
        }
        var (cNone, ioNone) = MakeConverter(new Dictionary<string, byte[]>());
        using (cNone)
        {
            ioNone.Script = _ => ok;
            var done = WaitDone(cNone, cNone.StartJob(papPath, sklbPath, "x").JobId!);
            check("游戏文件缺失显式报缺", done?.state == "failed" && done!.errorKind == XatClipConverter.FailureKind.InputMissing, done?.message);
        }
        var (cBusy, ioBusy) = MakeConverter(game);
        using (cBusy)
        {
            var gate = new TaskCompletionSource<bool>();
            ioBusy.Script = _ => { gate.Task.Wait(5000); return new XatClipConverter.ToolInvocationResult(true, -1, "", "", false, true, null); };
            var first = cBusy.StartJob(papPath, sklbPath, "a");
            var second = cBusy.StartJob(papPath, sklbPath, "b");
            check("运行中再启动=Busy", first.Ok && !second.Ok && second.Error == XatClipConverter.FailureKind.Busy, second.Message);
            gate.SetResult(true);
            var done = WaitDone(cBusy, first.JobId!);
            check("Busy 解除后原作业正常收尾", done != null && done.state != "running", done?.state);
        }

        // 路径校验
        check("合法路径通过", XatClipConverter.ValidatePaths(papPath, sklbPath) == null);
        check("骨架代码不匹配拒绝", XatClipConverter.ValidatePaths(papPath, "chara/human/c1101/skeleton/base/b0001/skl_c1101b0001.sklb") != null);
        check("非 bt_common 前缀拒绝", XatClipConverter.ValidatePaths("chara/human/c0101/animation/a0001/bt_unique/x.pap", sklbPath) != null);
        check("路径逃逸拒绝", XatClipConverter.ValidatePaths("chara/human/c0101/animation/a0001/bt_common/../evil.pap", sklbPath) != null);
        check("空路径拒绝", XatClipConverter.ValidatePaths("", sklbPath) != null && XatClipConverter.ValidatePaths(papPath, null) != null);
        check("斜杠键（ability/…）合法", XatClipConverter.ValidatePaths("chara/human/c0101/animation/a0001/bt_common/ability/swd_knight/abl007_hit.pap", sklbPath) == null);
        check("骨架代码提取", XatClipConverter.SkeletonCodeOf(papPath) == "c0101");
    }

    private static void Throws(CheckFn check, string name, Action act, string contains)
    {
        try { act(); check(name, false, "未抛异常"); }
        catch (FormatException e) { check(name, e.Message.Contains(contains), e.Message); }
        catch (Exception e) { check(name, false, "异常类型不符：" + e.GetType().Name + " " + e.Message); }
    }
}
