// 简洁编舞 P1-A 离线回归（TASK-20260916-SIMPLE-CHOREO-P1A）：SkillResourceMap 合成夹具测试。
// 全纯：路径脚本化 seam（只按路径响应，无调用序号/当前 key）冻结 store 快照契约——
// TMB 每唯一 key 恰 1 次、SKLB 每 store 每 Build 恰 1 次、PAP 每（key×store）恰 1 次无条件探测。
// 用例：[classification] 六分类+双阶段+重复键+空 key 行+null 参数；[family] 冻结四族+行/键双口径；
// [malformed] 截断/错误魔数/seam 抛错/null/>2MB + 同批隔离 + C002 不跟随；
// [probe-errors] S1/S2/S3 三次独立 Build（SKLB 全 ok/单 store 错/成功+失败并存，各带对照键、
// 同快照删键逐字节隔离、跨场景汇总显式标注非单批）；[no-store-universe] S4/S5（全缺/全错）。
// 尝试 2 回归（review-attempt1 R1/R2/R3）：R1 PAP info+count*40 int 溢出 → bad-pap-header；
// R2 CanonicalJson 数值与区域设置无关（Invariant vs ar-SA 字节相同、合法 JSON、负数经 JsonDocument 还原）；
// R3 隔离重跑读取断言补全（被删键 TMB+全 store PAP 零调用；剩余 TMB=K′/SKLB=N/PAP=K′×N 且无额外路径）。
// 游戏字节不进仓库：TMB/PAP/SKLB 全部为合成构造，只冻结本模块的解析与分类行为。
using System.Buffers.Binary;
using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using ChoreoHelper;

internal static class SkillResourceMapCases
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
            case "skill-resource-map-classification":
                ClassificationCases(Check); FamilyCases(Check); break;
            case "skill-resource-map-malformed": MalformedCases(Check); break;
            case "skill-resource-map-probe-errors": ProbeErrorCases(Check); break;
            case "skill-resource-map-no-store-universe": NoStoreUniverseCases(Check); break;
        }
        Console.WriteLine($"结果：{namedCase} {fails} 项失败");
        return fails == 0 ? 0 : 1;
    }

    // 全量套件接线（AC-05）：与命名用例共用同一批断言；节标题由 program.cs 统一打印。
    public static void RunFullSuite(CheckFn check)
    {
        ClassificationCases((n, c, d) => check(n, c, d));
        FamilyCases((n, c, d) => check(n, c, d));
        MalformedCases((n, c, d) => check(n, c, d));
        ProbeErrorCases((n, c, d) => check(n, c, d));
        NoStoreUniverseCases((n, c, d) => check(n, c, d));
    }

    // ---- 合成夹具构造 ----

    // TMB 容器：TMLB + totalLen(i32@4) + entryCount(i32@8)，条目自 12 起，字符串池在条目区后。
    // C002=28B：id(i16@8)/start(i16@10)/dur(i32@12)，字符串偏移(i32@24)；Kind=timeline。
    // C010=40B：id(i16@8)/start(i16@10)/dur(i32@12)/flags(i32@16)/保留(i32@20..28)，字符串偏移(i32@32)。
    // flags 取 +16 的 int32：TmbResourceReferences 现行不输出该字段（合同要求本模块自行补读）。
    // 字符串偏移按其现行口径为相对量：自条目字段区起点（条目偏移+8）起算，非绝对偏移。
    private static byte[] BuildTmb(
        IReadOnlyList<(string Name, int Flags, short StartFrame, int DurationFrames)> animations,
        IReadOnlyList<string> timelineRefs)
    {
        var entriesEnd = 12 + 28 * timelineRefs.Count + 40 * animations.Count;
        var pool = new List<byte>();
        int AddString(string s)
        {
            var absolute = entriesEnd + pool.Count;
            pool.AddRange(Encoding.UTF8.GetBytes(s));
            pool.Add(0);
            return absolute;
        }
        var refAbsolute = timelineRefs.Select(AddString).ToArray();
        var nameAbsolute = animations.Select(a => AddString(a.Name)).ToArray();
        var data = new byte[entriesEnd + pool.Count];
        Encoding.ASCII.GetBytes("TMLB").CopyTo(data, 0);
        WriteI32(data, 4, data.Length);
        WriteI32(data, 8, timelineRefs.Count + animations.Count);
        var at = 12;
        for (var i = 0; i < timelineRefs.Count; i++)
        {
            Encoding.ASCII.GetBytes("C002").CopyTo(data, at);
            WriteI32(data, at + 4, 28);
            WriteI16(data, at + 8, (short)(100 + i));
            WriteI16(data, at + 10, 0);
            WriteI32(data, at + 12, 60);
            WriteI32(data, at + 24, refAbsolute[i] - (at + 8));
            at += 28;
        }
        for (var i = 0; i < animations.Count; i++)
        {
            Encoding.ASCII.GetBytes("C010").CopyTo(data, at);
            WriteI32(data, at + 4, 40);
            WriteI16(data, at + 8, (short)(200 + i));
            WriteI16(data, at + 10, animations[i].StartFrame);
            WriteI32(data, at + 12, animations[i].DurationFrames);
            WriteI32(data, at + 16, animations[i].Flags);
            WriteI32(data, at + 32, nameAbsolute[i] - (at + 8));
            at += 40;
        }
        pool.CopyTo(data, entriesEnd);
        return data;
    }

    // 合法 PAP 头：pap_selection.py 布局（count:i16@8 / code:i32@10 / info:i32@14 / start:i32@18 / end:i32@22），
    // info=26、start=info+count*40、end=start+32，长度=end，满足全部头校验约束；条目区填零（本模块只校验头）。
    private static byte[] BuildPap(short count = 1, int code = 101)
    {
        var info = 26;
        var start = info + count * 40;
        var end = start + 32;
        var raw = new byte[end];
        Encoding.ASCII.GetBytes("pap ").CopyTo(raw, 0);
        WriteI16(raw, 8, count);
        WriteI32(raw, 10, code);
        WriteI32(raw, 14, info);
        WriteI32(raw, 18, start);
        WriteI32(raw, 22, end);
        return raw;
    }

    // 坏头 PAP：魔数 'XXXX'，其余字段沿用合法布局（S1 K2 夹具）
    private static byte[] BuildBadMagicPap()
    {
        var raw = BuildPap(1, 101);
        Encoding.ASCII.GetBytes("XXXX").CopyTo(raw, 0);
        return raw;
    }

    // R1 回归夹具：info=int.MaxValue 的 PAP（count=1/start=66/end=98/len=98）。数学上 info+count*40=2147483687
    // > start=66，违反头校验 info+count*40<=start；旧实现 int 加法溢出为负导致该比较被跳过而假命中。
    private static byte[] BuildOverflowInfoPap()
    {
        var raw = new byte[98];
        Encoding.ASCII.GetBytes("pap ").CopyTo(raw, 0);
        WriteI16(raw, 8, 1);
        WriteI32(raw, 10, 101);
        WriteI32(raw, 14, int.MaxValue);
        WriteI32(raw, 18, 66);
        WriteI32(raw, 22, 98);
        return raw;
    }

    // SKLB 内容任意（模块只取 sha256 不解析）
    private static byte[] SklbBytes(string code) => Encoding.ASCII.GetBytes("SKLB-fixture-" + code);

    private static void WriteI16(byte[] data, int at, short value) =>
        BinaryPrimitives.WriteInt16LittleEndian(data.AsSpan(at, 2), value);
    private static void WriteI32(byte[] data, int at, int value) =>
        BinaryPrimitives.WriteInt32LittleEndian(data.AsSpan(at, 4), value);

    private static string Sha256Hex(byte[] raw) => Convert.ToHexString(SHA256.HashData(raw)).ToLowerInvariant();

    // 路径脚本化 seam：只按路径响应（byte[]/null/抛 IOException），记录逐路径调用次数。
    // 不感知调用序号与"当前 key"——同一 Build 内同路径响应恒一致（store 快照契约的夹具侧）。
    private sealed class ScriptedSeam
    {
        private readonly Dictionary<string, byte[]?> _bytes = new(StringComparer.Ordinal);
        private readonly HashSet<string> _throws = new(StringComparer.Ordinal);
        private readonly Dictionary<string, int> _calls = new(StringComparer.Ordinal);

        public void Add(string path, byte[]? bytes) => _bytes[path] = bytes;
        public void AddThrow(string path) => _throws.Add(path);

        public byte[]? Read(string path)
        {
            _calls[path] = _calls.TryGetValue(path, out var n) ? n + 1 : 1;
            if (_throws.Contains(path)) throw new IOException("seam 模拟读取失败：" + path);
            return _bytes.TryGetValue(path, out var bytes) ? bytes : null;
        }

        public int Calls(string path) => _calls.TryGetValue(path, out var n) ? n : 0;
        // R3 加强：总调用数与被调用路径数——每路径恰 1 时两者应相等，用于排除额外路径与重读
        public int TotalCalls => _calls.Values.Sum();
        public int CalledPathCount => _calls.Count;
        public ScriptedSeam Clone() // 同一快照重跑（隔离断言）：响应映射不变，调用计数清零
        {
            var seam = new ScriptedSeam();
            foreach (var (path, bytes) in _bytes) seam._bytes[path] = bytes;
            seam._throws.UnionWith(_throws);
            return seam;
        }
    }

    // ---- 断言辅助 ----

    private static Dictionary<string, int> ClassificationCounts(SkillResourceMapManifest manifest) =>
        manifest.Keys.GroupBy(k => k.Classification, StringComparer.Ordinal)
            .ToDictionary(g => g.Key, g => g.Count(), StringComparer.Ordinal);

    private static int CountOf(IReadOnlyDictionary<string, int> counts, string name) =>
        counts.TryGetValue(name, out var n) ? n : 0;

    private static bool OnlyTheseClasses(SkillResourceMapManifest manifest, params string[] expected) =>
        manifest.Keys.All(k => expected.Contains(k.Classification));

    private static SkillResourceMapKeyEntry Entry(SkillResourceMapManifest manifest, string key) =>
        manifest.Keys.Single(k => k.Key == key);

    private static byte[] EntryBytes(SkillResourceMapManifest manifest, string key) =>
        SkillResourceMap.CanonicalJson(Entry(manifest, key));

    private static string Tmb(string key) => SkillResourceMap.TmbPath(key);
    private static string Sklb(string code) => SkillResourceMap.SklbPath(code);
    private static string Pap(string code, string key) => SkillResourceMap.PapPath(code, key);

    // 固定读取次数断言（尝试 2 R3 加强）：TMB=每唯一 key 恰 1、SKLB=每 store 恰 1、PAP=每（key×store）恰 1；
    // 且被调用路径数与总调用数恰等于 K+N+K×N——不存在已知路径集合之外的额外路径或重读。
    private static bool ProbeCountsExact(ScriptedSeam seam, IReadOnlyList<string> keys, IReadOnlyList<string> codes)
    {
        foreach (var key in keys)
        {
            if (seam.Calls(Tmb(key)) != 1) return false;
            foreach (var code in codes)
                if (seam.Calls(Pap(code, key)) != 1) return false;
        }
        foreach (var code in codes)
            if (seam.Calls(Sklb(code)) != 1) return false;
        var expectedCalls = keys.Count + codes.Count + keys.Count * codes.Count;
        return seam.CalledPathCount == expectedCalls && seam.TotalCalls == expectedCalls;
    }

    // 隔离重跑零调用断言（R3）：被删键的 TMB 与每个候选 store 的 PAP 路径调用数均为 0
    private static bool DeletedKeyZeroCalls(ScriptedSeam seam, string deletedKey, IReadOnlyList<string> codes)
    {
        if (seam.Calls(Tmb(deletedKey)) != 0) return false;
        foreach (var code in codes)
            if (seam.Calls(Pap(code, deletedKey)) != 0) return false;
        return true;
    }

    private static bool ThrowsArgumentNull(Action action)
    {
        try { action(); return false; }
        catch (ArgumentNullException) { return true; }
    }

    // ---- AC-01/AC-02：六分类 + 双阶段 + 重复键 + 空 key 行 + null 参数 + 字段级解析 ----
    private static void ClassificationCases(CheckFn check)
    {
        Console.WriteLine("  -- AC-01/02 六分类夹具（F1–F8 + 空 key 行）--");
        var seam = new ScriptedSeam();
        var codes = new[] { "c0101" };
        seam.Add(Sklb("c0101"), SklbBytes("c0101"));
        seam.Add(Tmb("f3/bad/container"), WrongMagicTmb());
        seam.Add(Tmb("f4/zero/c010"), BuildTmb(Array.Empty<(string, int, short, int)>(), new[] { "f2/missing/tmb" }));
        seam.Add(Tmb("f5/pattern/gap"), BuildTmb(new[] { ("f5anim", 7, (short)0, 120) }, Array.Empty<string>()));
        seam.Add(Tmb("f6/single/phase"), BuildTmb(new[] { ("f6anim", 3, (short)5, 60) }, new[] { "f2/missing/tmb" }));
        seam.Add(Tmb("f7/double/phase"), BuildTmb(
            new[] { ("f7a", 1, (short)0, 30), ("f7b", 2, (short)30, 45) }, new[] { "f2/missing/tmb" }));
        seam.Add(Tmb("f8/dup/key"), BuildTmb(new[] { ("f8anim", 9, (short)2, 90) }, Array.Empty<string>()));
        seam.Add(Pap("c0101", "f6/single/phase"), BuildPap(1, 101));
        seam.Add(Pap("c0101", "f7/double/phase"), BuildPap(2, 101));
        seam.Add(Pap("c0101", "f8/dup/key"), BuildPap(1, 101));
        // F1/F2 的 TMB 与 PAP、F5 的 PAP 未映射 → seam null（夹具为全部 8 键给出默认 null 响应）
        (uint, string)[] Rows() => new[]
        {
            (101u, "f1/placeholder/[SKL_ID]"),
            (102u, "f2/missing/tmb"),
            (103u, "f3/bad/container"),
            (104u, "f4/zero/c010"),
            (105u, "f5/pattern/gap"),
            (106u, "f6/single/phase"),
            (107u, "f7/double/phase"),
            (108u, "f8/dup/key"),
            (1088u, "f8/dup/key"),
            (109u, ""),
        };
        var m = SkillResourceMap.Build(Rows(), codes, seam.Read);

        var counts = ClassificationCounts(m);
        check("AC-01 六类计数恰为声明值（1/1/1/1/1/3）",
            CountOf(counts, "placeholder-key") == 1 && CountOf(counts, "missing-tmb") == 1
            && CountOf(counts, "unsupported-container") == 1 && CountOf(counts, "no-animation-phase") == 1
            && CountOf(counts, "pattern-gap") == 1 && CountOf(counts, "resolvable") == 3,
            string.Join(",", counts.Select(kv => kv.Key + "=" + kv.Value)));
        check("AC-01 无意外分类（其余四级均为 0）", OnlyTheseClasses(m,
            "placeholder-key", "missing-tmb", "unsupported-container", "no-animation-phase", "pattern-gap", "resolvable"));
        var f8 = Entry(m, "f8/dup/key");
        check("AC-01 F8 重复键仅 1 条目且 rowIds=2（按输入序）",
            m.Keys.Count(k => k.Key == "f8/dup/key") == 1 && f8.RowIds.SequenceEqual(new[] { 108u, 1088u }));
        var f7 = Entry(m, "f7/double/phase");
        check("AC-01 F7 phases 长度 2 且 multiPhase=true", f7.Phases.Count == 2 && f7.MultiPhase);
        check("AC-01 F6 单阶段 multiPhase=false", !Entry(m, "f6/single/phase").MultiPhase);
        check("AC-01 schemaVersion=1 且 gameDataContext/探测模式版本串存在",
            m.SchemaVersion == 1 && !string.IsNullOrEmpty(m.GameDataContext) && !string.IsNullOrEmpty(m.ProbeMode));
        check("AC-01 inputCounts rows/uniqueKeys/emptyKeyRows=10/8/1",
            m.InputCounts.Rows == 10 && m.InputCounts.UniqueKeys == 8 && m.InputCounts.EmptyKeyRows == 1);
        check("AC-01 空 key 行不产生条目", m.Keys.Count == 8 && m.Keys.All(k => k.Key.Length > 0));
        check("AC-01 非 resolvable 条目 reason 全部非空",
            m.Keys.Where(k => k.Classification != "resolvable").All(k => !string.IsNullOrEmpty(k.Reason)));

        check("AC-01 固定读取次数：TMB=8、SKLB 每 store 1、PAP=8（逐路径恰 1）",
            ProbeCountsExact(seam, m.Keys.Select(k => k.Key).ToList(), codes));
        check("AC-01 探测无条件：F1 占位键 TMB/PAP 各 1 次",
            seam.Calls(Tmb("f1/placeholder/[SKL_ID]")) == 1 && seam.Calls(Pap("c0101", "f1/placeholder/[SKL_ID]")) == 1);
        check("AC-01 探测无条件：F2 缺 TMB 键 PAP 仍 1 次", seam.Calls(Pap("c0101", "f2/missing/tmb")) == 1);
        check("AC-01 重复键行不重复读（F8 TMB 恰 1 次）", seam.Calls(Tmb("f8/dup/key")) == 1);
        check("AC-01 errorCounts 全 0（夹具无 seam 错误/坏头）",
            m.ErrorCounts.SklbReadErrors == 0 && m.ErrorCounts.PapReadErrors == 0 && m.ErrorCounts.BadPapHeaders == 0);

        var f6 = Entry(m, "f6/single/phase");
        check("AC-02 C010 四字段逐项等于写入值（name/flags/startFrame/durationFrames）",
            f6.Phases.Count == 1 && f6.Phases[0].AnimationName == "f6anim" && f6.Phases[0].Flags == 3
            && f6.Phases[0].StartFrame == 5 && f6.Phases[0].DurationFrames == 60,
            f6.Phases.Count > 0 ? f6.Phases[0].ToString() : "无阶段");
        check("AC-02 C002 Kind=timeline 引用路径等于写入值（只记录不跟随）",
            f6.References.Any(r => r.EntryType == "C002" && r.Kind == "timeline" && r.Path == "f2/missing/tmb")
            && !m.Keys.Any(k => k.Key == "f2/missing/tmb" && k.Classification == "resolvable"));
        check("AC-02 C010 引用同样记入 references（Kind=animation-name）",
            f6.References.Any(r => r.EntryType == "C010" && r.Kind == "animation-name" && r.Path == "f6anim"));
        var f6pap = f6.PerStorePap.Single(p => p.Store == "c0101");
        check("AC-02 PAP 头解析值等于写入值（count=1/code=101/info=26/start=66/end=98）",
            f6pap.Status == "hit" && f6pap.Header != null && f6pap.Header.Count == 1 && f6pap.Header.Code == 101
            && f6pap.Header.Info == 26 && f6pap.Header.Start == 66 && f6pap.Header.End == 98);
        var f7pap = f7.PerStorePap.Single(p => p.Store == "c0101");
        check("AC-02 PAP 头解析值等于写入值（count=2 → start=106/end=138）",
            f7pap.Status == "hit" && f7pap.Header != null && f7pap.Header.Count == 2 && f7pap.Header.Start == 106
            && f7pap.Header.End == 138);
        check("AC-02 SKLB 仅取 sha256 不解析内容",
            m.Stores.Count == 1 && m.Stores[0].SklbStatus == "ok"
            && m.Stores[0].SklbSha256 == Sha256Hex(SklbBytes("c0101")));
        check("AC-02 per-store 明细行含逐 key PAP 状态",
            m.Stores[0].Keys.Count == 8 && m.Stores[0].Keys.Any(k => k.Key == "f6/single/phase" && k.Status == "hit")
            && m.Stores[0].Keys.Any(k => k.Key == "f5/pattern/gap" && k.Status == "missing"));

        check("AC-02 null 输入枚举抛 ArgumentNullException",
            ThrowsArgumentNull(() => SkillResourceMap.Build(null!, codes, seam.Read)));
        check("AC-02 null seam 抛 ArgumentNullException",
            ThrowsArgumentNull(() => SkillResourceMap.Build(Rows(), codes, null!)));
        check("AC-02 null candidateCodes 抛 ArgumentNullException",
            ThrowsArgumentNull(() => SkillResourceMap.Build(Rows(), null!, seam.Read)));

        check("AC-01 幂等：同一快照重跑条目逐字节相同",
            RerunAndCompare(seam, Rows(), codes, m));

        // ---- 尝试 2 回归（review-attempt1 R1/R2）：独立 seam，不触碰上方 F1–F8 冻结计数 ----
        Console.WriteLine("  -- 尝试 2 回归 R1/R2：PAP 偏移溢出坏头 + CanonicalJson 数值区域无关 --");
        var regSeam = new ScriptedSeam();
        regSeam.Add(Sklb("c0101"), SklbBytes("c0101"));
        regSeam.Add(Tmb("reg/r1/pap-overflow"), BuildTmb(new[] { ("reg1anim", 1, (short)0, 60) }, Array.Empty<string>()));
        regSeam.Add(Pap("c0101", "reg/r1/pap-overflow"), BuildOverflowInfoPap());
        regSeam.Add(Tmb("reg/r2/canon-negative"), BuildTmb(new[] { ("reg2anim", -1, (short)-5, 60) }, Array.Empty<string>()));
        regSeam.Add(Pap("c0101", "reg/r2/canon-negative"), BuildPap(1, -101));
        var mr = SkillResourceMap.Build(new[] { (901u, "reg/r1/pap-overflow"), (902u, "reg/r2/canon-negative") },
            codes, regSeam.Read);

        var overflow = Entry(mr, "reg/r1/pap-overflow");
        check("R1 回归：info=int.MaxValue 溢出 PAP → bad-pap-header（不得 resolvable 假命中）且 badPapHeaders=1",
            overflow.Classification == "bad-pap-header"
            && overflow.PerStorePap.Single(p => p.Store == "c0101").Status == "bad-pap-header"
            && mr.ErrorCounts.BadPapHeaders == 1,
            overflow.Classification + "/" + overflow.PerStorePap[0].Status + "/bad=" + mr.ErrorCounts.BadPapHeaders);
        check("R1 回归：失败项指向防溢出比较 info+count*40>start",
            overflow.Reason?.Contains("info+count*40>start") == true
            && overflow.PerStorePap.Single(p => p.Store == "c0101").Reason == "info+count*40>start");
        check("R1 回归：读取次数（TMB=2/SKLB=1/PAP=2，无额外路径）",
            ProbeCountsExact(regSeam, new[] { "reg/r1/pap-overflow", "reg/r2/canon-negative" }, codes));

        var negative = Entry(mr, "reg/r2/canon-negative");
        check("R2 前提：负数字段夹具就位（flags=-1/startFrame=-5/PAP code=-101，条目 resolvable）",
            negative.Classification == "resolvable" && negative.Phases[0].Flags == -1
            && negative.Phases[0].StartFrame == -5
            && negative.PerStorePap.Single(p => p.Store == "c0101").Header!.Code == -101);
        var savedCulture = CultureInfo.CurrentCulture;
        byte[] invariantBytes;
        byte[] arSaBytes;
        try
        {
            CultureInfo.CurrentCulture = CultureInfo.InvariantCulture;
            invariantBytes = SkillResourceMap.CanonicalJson(negative);
            CultureInfo.CurrentCulture = CultureInfo.GetCultureInfo("ar-SA");
            arSaBytes = SkillResourceMap.CanonicalJson(negative);
        }
        finally { CultureInfo.CurrentCulture = savedCulture; } // 恢复文化设置（全量套件同进程共享）
        var arSaParses = true;
        try { using (JsonDocument.Parse(arSaBytes)) { } }
        catch (JsonException) { arSaParses = false; }
        var parsedFlags = 0; var parsedStart = 0; var parsedCode = 0;
        using (var doc = JsonDocument.Parse(invariantBytes))
        {
            parsedFlags = doc.RootElement.GetProperty("phases")[0].GetProperty("flags").GetInt32();
            parsedStart = doc.RootElement.GetProperty("phases")[0].GetProperty("startFrame").GetInt32();
            parsedCode = doc.RootElement.GetProperty("perStorePap")[0].GetProperty("header").GetProperty("code").GetInt32();
        }
        check("R2 回归：CanonicalJson 字节与区域设置无关（Invariant vs ar-SA 逐字节相同）",
            invariantBytes.SequenceEqual(arSaBytes));
        check("R2 回归：ar-SA 产物为合法 JSON（负号不含区域标记 U+061C）", arSaParses);
        check("R2 回归：真实 JSON 解析还原负数值（flags=-1/startFrame=-5/code=-101）",
            parsedFlags == -1 && parsedStart == -5 && parsedCode == -101);
    }

    private static byte[] WrongMagicTmb()
    {
        var raw = new byte[64];
        Encoding.ASCII.GetBytes("XMLB").CopyTo(raw, 0);
        WriteI32(raw, 4, raw.Length);
        WriteI32(raw, 8, 0);
        return raw;
    }

    // 同一快照（同路径→响应映射）重跑，比较全部条目规范序列化字节
    private static bool RerunAndCompare(ScriptedSeam seam, IEnumerable<(uint, string)> rows,
        IReadOnlyList<string> codes, SkillResourceMapManifest baseline)
    {
        var rerun = SkillResourceMap.Build(rows, codes, seam.Clone().Read);
        if (rerun.Keys.Count != baseline.Keys.Count) return false;
        for (var i = 0; i < baseline.Keys.Count; i++)
            if (!SkillResourceMap.CanonicalJson(baseline.Keys[i]).SequenceEqual(SkillResourceMap.CanonicalJson(rerun.Keys[i])))
                return false;
        return true;
    }

    // ---- AC-04：冻结四族 + 行/键双口径 ----
    private static void FamilyCases(CheckFn check)
    {
        Console.WriteLine("  -- AC-04 冻结四族（共享库/种族库/模式缺口/占位符）+ 行/键双口径 --");
        var seam = new ScriptedSeam();
        var codes = new[] { "c0101", "c1101" };
        foreach (var code in codes) seam.Add(Sklb(code), SklbBytes(code));
        // 夹具声明值：共享库命中 1 键（3 行）/ 种族库命中 1 键（1 行）/ 模式缺口 1 键 / 占位符 1 键
        // per-store 命中键数：c0101=1（shared）、c1101=1（race）
        foreach (var key in new[] { "shared/emote/hit", "race/elezen/hit", "pattern/gap/only" })
            seam.Add(Tmb(key), BuildTmb(new[] { (key.Split('/')[0] + "anim", 5, (short)1, 80) }, Array.Empty<string>()));
        seam.Add(Tmb("placeholder/[SKL_ID]"), BuildTmb(new[] { ("placeholderanim", 0, (short)0, 10) }, Array.Empty<string>()));
        seam.Add(Pap("c0101", "shared/emote/hit"), BuildPap(1, 101));
        seam.Add(Pap("c1101", "race/elezen/hit"), BuildPap(1, 1101));
        (uint, string)[] Rows() => new[]
        {
            (1u, "shared/emote/hit"), (2u, "shared/emote/hit"), (3u, "shared/emote/hit"),
            (4u, "race/elezen/hit"), (5u, "pattern/gap/only"), (6u, "placeholder/[SKL_ID]"),
        };
        var m = SkillResourceMap.Build(Rows(), codes, seam.Read);

        var counts = ClassificationCounts(m);
        check("AC-04 四族汇总分类恰为声明值（resolvable=2/pattern-gap=1/placeholder-key=1）",
            CountOf(counts, "resolvable") == 2 && CountOf(counts, "pattern-gap") == 1
            && CountOf(counts, "placeholder-key") == 1 && counts.Count == 3,
            string.Join(",", counts.Select(kv => kv.Key + "=" + kv.Value)));
        check("AC-04 共享库族：仅 c0101 命中",
            Entry(m, "shared/emote/hit").Classification == "resolvable"
            && Entry(m, "shared/emote/hit").PerStorePap.Where(p => p.Status == "hit").Select(p => p.Store)
                .SequenceEqual(new[] { "c0101" }));
        check("AC-04 种族库族：仅非 c0101 store（c1101）命中",
            Entry(m, "race/elezen/hit").Classification == "resolvable"
            && Entry(m, "race/elezen/hit").PerStorePap.Where(p => p.Status == "hit").Select(p => p.Store)
                .SequenceEqual(new[] { "c1101" }));
        check("AC-04 模式缺口族：全部可用 store PAP 均未命中",
            Entry(m, "pattern/gap/only").Classification == "pattern-gap"
            && Entry(m, "pattern/gap/only").PerStorePap.All(p => p.Status == "missing"));
        check("AC-04 占位符族：含 [SKL_ID] token",
            Entry(m, "placeholder/[SKL_ID]").Classification == "placeholder-key"
            && Entry(m, "placeholder/[SKL_ID]").Reason!.Contains("[SKL_ID]"));
        check("AC-04 行口径与键口径分列且不同（rows=6 / uniqueKeys=4，重复键 3 行）",
            m.InputCounts.Rows == 6 && m.InputCounts.UniqueKeys == 4
            && Entry(m, "shared/emote/hit").RowIds.Count == 3 && m.Keys.Count == 4);
        check("AC-04 per-store 明细命中键数恰为声明值（c0101=1、c1101=1，各覆盖全部 4 键）",
            m.Stores.Single(s => s.Code == "c0101").Keys.Count(k => k.Status == "hit") == 1
            && m.Stores.Single(s => s.Code == "c1101").Keys.Count(k => k.Status == "hit") == 1
            && m.Stores.All(s => s.Keys.Count == 4));
        check("AC-04 固定读取次数（TMB=4、SKLB=2、PAP=8，逐路径恰 1）",
            ProbeCountsExact(seam, m.Keys.Select(k => k.Key).ToList(), codes));
    }

    // ---- AC-03：非法输入五件套 + 同批隔离 + C002 不跟随 ----
    private static void MalformedCases(CheckFn check)
    {
        Console.WriteLine("  -- AC-03 非法输入（截断/错误魔数/seam 抛错/seam null/>2MB）+ 隔离 + C002 不跟随 --");
        var seam = new ScriptedSeam();
        var codes = new[] { "c0101" };
        seam.Add(Sklb("c0101"), SklbBytes("c0101"));
        var truncated = BuildTmb(new[] { ("anim", 1, (short)0, 60) }, Array.Empty<string>());
        Array.Resize(ref truncated, truncated.Length / 2); // 截断：条目区/字符串池被切掉
        seam.Add(Tmb("mal/truncated"), truncated);
        seam.Add(Tmb("mal/wrong-magic"), WrongMagicTmb());
        seam.AddThrow(Tmb("mal/seam-throw"));
        // mal/seam-null：不映射 → seam null
        var oversize = new byte[2 * 1024 * 1024 + 1];
        Encoding.ASCII.GetBytes("TMLB").CopyTo(oversize, 0);
        seam.Add(Tmb("mal/oversize"), oversize);
        seam.Add(Tmb("mal/ok/control"), BuildTmb(new[] { ("controlanim", 4, (short)0, 50) }, new[] { "not/in/input" }));
        seam.Add(Pap("c0101", "mal/ok/control"), BuildPap(1, 101));
        (uint, string)[] Rows() => new[]
        {
            (1u, "mal/truncated"), (2u, "mal/wrong-magic"), (3u, "mal/seam-throw"),
            (4u, "mal/seam-null"), (5u, "mal/oversize"), (6u, "mal/ok/control"),
        };
        var m = SkillResourceMap.Build(Rows(), codes, seam.Read);

        check("AC-03 截断容器 → unsupported-container 且 reason 非空",
            Entry(m, "mal/truncated").Classification == "unsupported-container" && Entry(m, "mal/truncated").Reason!.Length > 0);
        check("AC-03 错误魔数 → unsupported-container 且 reason 非空",
            Entry(m, "mal/wrong-magic").Classification == "unsupported-container" && Entry(m, "mal/wrong-magic").Reason!.Length > 0);
        check("AC-03 TMB seam 抛错 → unsupported-container（TMB 层读取错误归此类，reason 含 IOException 与路径）",
            Entry(m, "mal/seam-throw").Classification == "unsupported-container"
            && Entry(m, "mal/seam-throw").Reason!.Contains("IOException") && Entry(m, "mal/seam-throw").Reason!.Contains(Tmb("mal/seam-throw")));
        check("AC-03 seam 返回 null → missing-tmb 且 reason 非空",
            Entry(m, "mal/seam-null").Classification == "missing-tmb" && Entry(m, "mal/seam-null").Reason!.Length > 0);
        check("AC-03 >2MB → unsupported-container 且 reason 非空",
            Entry(m, "mal/oversize").Classification == "unsupported-container" && Entry(m, "mal/oversize").Reason!.Length > 0);
        check("AC-03 TMB 层问题不进 errorCounts（三个计数均为 0）",
            m.ErrorCounts.SklbReadErrors == 0 && m.ErrorCounts.PapReadErrors == 0 && m.ErrorCounts.BadPapHeaders == 0);

        var control = Entry(m, "mal/ok/control");
        check("AC-03 同批其余键不受影响（对照键 resolvable）", control.Classification == "resolvable");
        var controlOnly = SkillResourceMap.Build(new[] { (6u, "mal/ok/control") }, codes, seam.Clone().Read);
        check("AC-03 对照键条目与无坏键单建逐字节相同（异常隔离）",
            SkillResourceMap.CanonicalJson(control)
                .SequenceEqual(SkillResourceMap.CanonicalJson(Entry(controlOnly, "mal/ok/control"))));
        check("AC-03 C002 指向另一 key：只记录不展开（无新条目、被引键 TMB 未读）",
            control.References.Any(r => r.EntryType == "C002" && r.Kind == "timeline" && r.Path == "not/in/input")
            && m.Keys.Count == 6 && seam.Calls(Tmb("not/in/input")) == 0);
        check("AC-03 固定读取次数（TMB=6、SKLB=1、PAP=6，逐路径恰 1）",
            ProbeCountsExact(seam, Rows().Select(r => r.Item2).Where(k => k.Length > 0).Distinct().ToList(), codes));
    }

    // ---- AC-06 用例 1：S1/S2/S3 三次独立 Build + 同快照删键逐字节隔离 + 跨场景汇总 ----
    private static void ProbeErrorCases(CheckFn check)
    {
        Console.WriteLine("  -- AC-06 用例 1 probe-errors：S1/S2/S3 三次独立 Build --");
        var codes = new[] { "c0101", "c0201", "c0301" };
        (uint, string)[] S1Rows() => new[]
        {
            (11u, "probe/err/pap-only"), (12u, "probe/err/pap-bad-header"),
            (15u, "probe/ok/two-stores-hit"), (16u, "probe/ok/clean-gap"), (17u, "probe/ok/clean-hit"),
        };
        (uint, string)[] S2Rows() => new[] { (13u, "probe/err/sklb-only"), (18u, "probe/ok/control-cross-store") };
        (uint, string)[] S3Rows() => new[] { (14u, "probe/err/hit-with-errors"), (19u, "probe/ok/control-clean-hit") };
        var allProbeKeys = S1Rows().Concat(S2Rows()).Concat(S3Rows()).Select(r => r.Item2).ToList();

        // S1：SKLB 快照 = 三 store 全 ok
        var s1 = new ScriptedSeam();
        foreach (var code in codes) s1.Add(Sklb(code), SklbBytes(code));
        foreach (var key in allProbeKeys) s1.Add(Tmb(key), BuildTmb(new[] { (key.Replace('/', '_') + "anim", 1, (short)0, 60) }, Array.Empty<string>()));
        s1.AddThrow(Pap("c0101", "probe/err/pap-only"));
        s1.Add(Pap("c0101", "probe/err/pap-bad-header"), BuildBadMagicPap());
        s1.Add(Pap("c0101", "probe/ok/two-stores-hit"), BuildPap(1, 101));
        s1.Add(Pap("c0201", "probe/ok/two-stores-hit"), BuildPap(1, 201));
        s1.Add(Pap("c0101", "probe/ok/clean-hit"), BuildPap(1, 101));
        var m1 = SkillResourceMap.Build(S1Rows(), codes, s1.Read);

        var c1 = ClassificationCounts(m1);
        check("S1 分类计数 read-error=1/bad-pap-header=1/resolvable=2/pattern-gap=1 其余=0",
            CountOf(c1, "read-error") == 1 && CountOf(c1, "bad-pap-header") == 1 && CountOf(c1, "resolvable") == 2
            && CountOf(c1, "pattern-gap") == 1 && c1.Count == 4,
            string.Join(",", c1.Select(kv => kv.Key + "=" + kv.Value)));
        check("S1 K1 PAP 抛 IOException → read-error（reason 含 c0101 PAP 路径与 IOException，不当 missing）",
            Entry(m1, "probe/err/pap-only").Classification == "read-error"
            && Entry(m1, "probe/err/pap-only").Reason!.Contains(Pap("c0101", "probe/err/pap-only"))
            && Entry(m1, "probe/err/pap-only").Reason!.Contains("IOException"));
        check("S1 K1 其余 store PAP=missing 照记明细",
            Entry(m1, "probe/err/pap-only").PerStorePap.Single(p => p.Store == "c0201").Status == "missing"
            && Entry(m1, "probe/err/pap-only").PerStorePap.Single(p => p.Store == "c0301").Status == "missing");
        check("S1 K2 非空坏头（magic=XXXX）→ bad-pap-header，不得 resolvable",
            Entry(m1, "probe/err/pap-bad-header").Classification == "bad-pap-header"
            && Entry(m1, "probe/err/pap-bad-header").Reason!.Contains("magic"));
        check("S1 K5 两 store 命中 → resolvable（命中集={c0101,c0201}）",
            Entry(m1, "probe/ok/two-stores-hit").Classification == "resolvable"
            && Entry(m1, "probe/ok/two-stores-hit").PerStorePap.Where(p => p.Status == "hit")
                .Select(p => p.Store).SequenceEqual(new[] { "c0101", "c0201" }));
        check("S1 K6 全 null → pattern-gap（3 个可用 store 全 missing）",
            Entry(m1, "probe/ok/clean-gap").Classification == "pattern-gap"
            && Entry(m1, "probe/ok/clean-gap").PerStorePap.All(p => p.Status == "missing"));
        check("S1 K7 对照键 c0101 命中 → resolvable",
            Entry(m1, "probe/ok/clean-hit").Classification == "resolvable");
        check("S1 errorCounts（事件口径）sklb=0/pap=1(K1.c0101)/bad=1(K2.c0101)",
            m1.ErrorCounts.SklbReadErrors == 0 && m1.ErrorCounts.PapReadErrors == 1 && m1.ErrorCounts.BadPapHeaders == 1);
        check("S1 读取次数 TMB=5/SKLB 每路径 1/PAP=15",
            ProbeCountsExact(s1, S1Rows().Select(r => r.Item2).ToList(), codes));
        // 隔离：同快照去 K1 重跑 → K2/K5/K6/K7 条目逐字节相同；papReadErrors 变 0 属 manifest 级合法变化
        var s1b = s1.Clone();
        var m1b = SkillResourceMap.Build(S1Rows().Where(r => r.Item2 != "probe/err/pap-only"), codes, s1b.Read);
        check("S1 隔离：去 K1 重跑剩余 4 键条目逐字节相同",
            m1b.Keys.Count == 4 && m1b.Keys.All(k =>
                SkillResourceMap.CanonicalJson(k).SequenceEqual(EntryBytes(m1, k.Key))));
        check("S1 隔离：被删键 TMB 与每个 store PAP 调用数为 0，读取次数按剩余键数重算（TMB=4/SKLB=3/PAP=12，无额外路径）",
            DeletedKeyZeroCalls(s1b, "probe/err/pap-only", codes)
            && ProbeCountsExact(s1b, m1b.Keys.Select(k => k.Key).ToList(), codes));
        check("S1 隔离：papReadErrors 相应变 0（manifest 级合法变化，条目不受影响）",
            m1b.ErrorCounts.PapReadErrors == 0 && m1b.ErrorCounts.BadPapHeaders == 1);

        // S2：SKLB 快照 = c0101=error(IOException)，c0201/c0301=ok
        var s2 = new ScriptedSeam();
        s2.AddThrow(Sklb("c0101"));
        s2.Add(Sklb("c0201"), SklbBytes("c0201"));
        s2.Add(Sklb("c0301"), SklbBytes("c0301"));
        foreach (var key in S2Rows().Select(r => r.Item2))
            s2.Add(Tmb(key), BuildTmb(new[] { (key.Replace('/', '_') + "anim", 1, (short)0, 60) }, Array.Empty<string>()));
        s2.Add(Pap("c0201", "probe/ok/control-cross-store"), BuildPap(1, 201));
        var m2 = SkillResourceMap.Build(S2Rows(), codes, s2.Read);

        var c2 = ClassificationCounts(m2);
        check("S2 分类计数 read-error=1/resolvable=1 其余=0",
            CountOf(c2, "read-error") == 1 && CountOf(c2, "resolvable") == 1 && c2.Count == 2,
            string.Join(",", c2.Select(kv => kv.Key + "=" + kv.Value)));
        check("S2 K3 SKLB 抛错 → read-error（reason 含 c0101 SKLB 路径与 IOException）",
            Entry(m2, "probe/err/sklb-only").Classification == "read-error"
            && Entry(m2, "probe/err/sklb-only").Reason!.Contains(Sklb("c0101"))
            && Entry(m2, "probe/err/sklb-only").Reason!.Contains("IOException"));
        check("S2 c0101 sklbStatus=error、无 sha256（store 级单行，两键共享同一快照）",
            m2.Stores.Single(s => s.Code == "c0101").SklbStatus == "error"
            && m2.Stores.Single(s => s.Code == "c0101").SklbSha256 == null && m2.Stores.Count == 3);
        check("S2 KC1 对照键：c0201 命中 → resolvable（命中优先于 c0101 的 SKLB 读取错误）",
            Entry(m2, "probe/ok/control-cross-store").Classification == "resolvable");
        check("S2 errorCounts sklb=1（store 级、不乘键数）/pap=0/bad=0",
            m2.ErrorCounts.SklbReadErrors == 1 && m2.ErrorCounts.PapReadErrors == 0 && m2.ErrorCounts.BadPapHeaders == 0);
        check("S2 读取次数 TMB=2/SKLB=3/PAP=6",
            ProbeCountsExact(s2, S2Rows().Select(r => r.Item2).ToList(), codes));
        var s2b = s2.Clone();
        var m2b = SkillResourceMap.Build(S2Rows().Where(r => r.Item2 != "probe/err/sklb-only"), codes, s2b.Read);
        check("S2 隔离：去 K3 重跑 KC1 条目逐字节相同且 sklbReadErrors 仍=1（store 级事件口径）",
            m2b.Keys.Count == 1 && SkillResourceMap.CanonicalJson(m2b.Keys[0]).SequenceEqual(EntryBytes(m2, "probe/ok/control-cross-store"))
            && m2b.ErrorCounts.SklbReadErrors == 1);
        check("S2 隔离：被删键 TMB 与每个 store PAP 调用数为 0，读取次数重算（TMB=1/SKLB=3/PAP=3，无额外路径）",
            DeletedKeyZeroCalls(s2b, "probe/err/sklb-only", codes)
            && ProbeCountsExact(s2b, new[] { "probe/ok/control-cross-store" }, codes));

        // S3：SKLB 快照 = c0101=ok，c0201=error(IOException)，c0301=ok
        var s3 = new ScriptedSeam();
        s3.Add(Sklb("c0101"), SklbBytes("c0101"));
        s3.AddThrow(Sklb("c0201"));
        s3.Add(Sklb("c0301"), SklbBytes("c0301"));
        foreach (var key in S3Rows().Select(r => r.Item2))
            s3.Add(Tmb(key), BuildTmb(new[] { (key.Replace('/', '_') + "anim", 1, (short)0, 60) }, Array.Empty<string>()));
        s3.Add(Pap("c0101", "probe/err/hit-with-errors"), BuildPap(1, 101));
        s3.AddThrow(Pap("c0301", "probe/err/hit-with-errors"));
        s3.Add(Pap("c0101", "probe/ok/control-clean-hit"), BuildPap(1, 101));
        var m3 = SkillResourceMap.Build(S3Rows(), codes, s3.Read);

        var c3 = ClassificationCounts(m3);
        check("S3 分类计数 resolvable=2 其余=0",
            CountOf(c3, "resolvable") == 2 && c3.Count == 1,
            string.Join(",", c3.Select(kv => kv.Key + "=" + kv.Value)));
        check("S3 K4 命中优先：c0101 命中 → resolvable（c0301 PAP 抛错不改分类）",
            Entry(m3, "probe/err/hit-with-errors").Classification == "resolvable"
            && Entry(m3, "probe/err/hit-with-errors").PerStorePap.Single(p => p.Store == "c0101").Status == "hit");
        check("S3 K4 per-store 明细照记：c0201 sklbStatus=error、c0301 pap=read-error",
            m3.Stores.Single(s => s.Code == "c0201").SklbStatus == "error"
            && Entry(m3, "probe/err/hit-with-errors").PerStorePap.Single(p => p.Store == "c0301").Status == "read-error");
        check("S3 两项错误照入 errorCounts（sklb=1(c0201)/pap=1(K4.c0301)/bad=0）",
            m3.ErrorCounts.SklbReadErrors == 1 && m3.ErrorCounts.PapReadErrors == 1 && m3.ErrorCounts.BadPapHeaders == 0);
        check("S3 KC2 对照键 → resolvable", Entry(m3, "probe/ok/control-clean-hit").Classification == "resolvable");
        check("S3 读取次数 TMB=2/SKLB=3/PAP=6",
            ProbeCountsExact(s3, S3Rows().Select(r => r.Item2).ToList(), codes));
        var s3b = s3.Clone();
        var m3b = SkillResourceMap.Build(S3Rows().Where(r => r.Item2 != "probe/err/hit-with-errors"), codes, s3b.Read);
        check("S3 隔离：去 K4 重跑 KC2 条目逐字节相同，sklbReadErrors 仍=1",
            m3b.Keys.Count == 1 && SkillResourceMap.CanonicalJson(m3b.Keys[0]).SequenceEqual(EntryBytes(m3, "probe/ok/control-clean-hit"))
            && m3b.ErrorCounts.SklbReadErrors == 1);
        check("S3 隔离：被删键 TMB 与每个 store PAP 调用数为 0",
            DeletedKeyZeroCalls(s3b, "probe/err/hit-with-errors", codes));
        check("S3 隔离：读取次数按剩余键数重算（TMB=1/SKLB=3/PAP=3，无额外路径）",
            ProbeCountsExact(s3b, new[] { "probe/ok/control-clean-hit" }, codes));

        Console.WriteLine("  -- 跨场景汇总（S1+S2+S3 三次 Build 的合计，不是单批） --");
        var cross = ClassificationCounts(m1); // 复制后累加
        foreach (var kv in ClassificationCounts(m2)) cross[kv.Key] = CountOf(cross, kv.Key) + kv.Value;
        foreach (var kv in ClassificationCounts(m3)) cross[kv.Key] = CountOf(cross, kv.Key) + kv.Value;
        var totalKeys = m1.Keys.Count + m2.Keys.Count + m3.Keys.Count;
        check("跨场景汇总（非单批）：9 键 read-error=2/bad-pap-header=1/resolvable=5/pattern-gap=1 其余=0",
            totalKeys == 9 && CountOf(cross, "read-error") == 2 && CountOf(cross, "bad-pap-header") == 1
            && CountOf(cross, "resolvable") == 5 && CountOf(cross, "pattern-gap") == 1 && cross.Count == 4,
            string.Join(",", cross.Select(kv => kv.Key + "=" + kv.Value)));
        check("跨场景汇总（非单批）：errorCounts 合计 sklb=2/pap=2/bad=1",
            m1.ErrorCounts.SklbReadErrors + m2.ErrorCounts.SklbReadErrors + m3.ErrorCounts.SklbReadErrors == 2
            && m1.ErrorCounts.PapReadErrors + m2.ErrorCounts.PapReadErrors + m3.ErrorCounts.PapReadErrors == 2
            && m1.ErrorCounts.BadPapHeaders + m2.ErrorCounts.BadPapHeaders + m3.ErrorCounts.BadPapHeaders == 1);
    }

    // ---- AC-06 用例 2：S4/S5 两次独立 Build（无可用 store：全缺/全错） ----
    private static void NoStoreUniverseCases(CheckFn check)
    {
        Console.WriteLine("  -- AC-06 用例 2 no-store-universe：S4/S5 两次独立 Build --");
        var codes = new[] { "c0101", "c0201" };
        (uint, string)[] S4Rows() => new[] { (21u, "universe/empty/all-null"), (22u, "universe/empty/pap-hit-no-sklb") };
        (uint, string)[] S5Rows() => new[] { (23u, "universe/err/all-error-clean"), (24u, "universe/err/all-error-pap-hit") };

        // S4：SKLB 快照 = 两 store 均 seam null（missing）
        var s4 = new ScriptedSeam();
        foreach (var key in S4Rows().Select(r => r.Item2))
            s4.Add(Tmb(key), BuildTmb(new[] { (key.Replace('/', '_') + "anim", 1, (short)0, 60) }, Array.Empty<string>()));
        s4.Add(Pap("c0101", "universe/empty/pap-hit-no-sklb"), BuildPap(1, 101));
        var m4 = SkillResourceMap.Build(S4Rows(), codes, s4.Read);

        var c4 = ClassificationCounts(m4);
        check("S4 分类计数 no-store-universe=2 其余=0",
            CountOf(c4, "no-store-universe") == 2 && c4.Count == 1,
            string.Join(",", c4.Select(kv => kv.Key + "=" + kv.Value)));
        check("S4 K8 reason 含 0/2 candidate stores have readable SKLB 且枚举两 store 状态",
            Entry(m4, "universe/empty/all-null").Reason!.Contains("0/2 candidate stores have readable SKLB")
            && Entry(m4, "universe/empty/all-null").Reason!.Contains("c0101=missing")
            && Entry(m4, "universe/empty/all-null").Reason!.Contains("c0201=missing"));
        check("S4 K9 PAP 命中但 SKLB 缺失 → no-store-universe（不得 resolvable）",
            Entry(m4, "universe/empty/pap-hit-no-sklb").Classification == "no-store-universe");
        check("S4 K9 per-store 明细保留 c0101 pap=hit 且 sklbStatus=missing（PAP 探测不因 SKLB 状态跳过）",
            Entry(m4, "universe/empty/pap-hit-no-sklb").PerStorePap.Single(p => p.Store == "c0101").Status == "hit"
            && m4.Stores.Single(s => s.Code == "c0101").SklbStatus == "missing"
            && m4.Stores.All(s => s.SklbStatus == "missing" && s.SklbSha256 == null));
        check("S4 errorCounts 全 0", m4.ErrorCounts.SklbReadErrors == 0 && m4.ErrorCounts.PapReadErrors == 0 && m4.ErrorCounts.BadPapHeaders == 0);
        check("S4 per-store 明细 2 行、每 store 覆盖 2 键且保留 K9 的 c0101 命中明细",
            m4.Stores.Count == 2 && m4.Stores.All(s => s.Keys.Count == 2)
            && m4.Stores.Single(s => s.Code == "c0101").Keys
                .Single(k => k.Key == "universe/empty/pap-hit-no-sklb").Status == "hit"
            && m4.Stores.Single(s => s.Code == "c0201").Keys
                .Single(k => k.Key == "universe/empty/pap-hit-no-sklb").Status == "missing");
        check("S4 读取次数 TMB=2/SKLB=2/PAP=4（K9 的 PAP 命中仍被无条件探测）",
            ProbeCountsExact(s4, S4Rows().Select(r => r.Item2).ToList(), codes));
        var s4b = s4.Clone();
        var m4b = SkillResourceMap.Build(S4Rows().Where(r => r.Item2 != "universe/empty/pap-hit-no-sklb"), codes, s4b.Read);
        check("S4 隔离：去 K9 重跑 K8 条目逐字节相同",
            m4b.Keys.Count == 1 && SkillResourceMap.CanonicalJson(m4b.Keys[0]).SequenceEqual(EntryBytes(m4, "universe/empty/all-null")));
        check("S4 隔离：被删键 TMB 与每个 store PAP 调用数为 0，读取次数重算（TMB=1/SKLB=2/PAP=2，无额外路径）",
            DeletedKeyZeroCalls(s4b, "universe/empty/pap-hit-no-sklb", codes)
            && ProbeCountsExact(s4b, new[] { "universe/empty/all-null" }, codes));

        // S5：SKLB 快照 = 两 store 均抛 IOException（error）
        var s5 = new ScriptedSeam();
        foreach (var code in codes) s5.AddThrow(Sklb(code));
        foreach (var key in S5Rows().Select(r => r.Item2))
            s5.Add(Tmb(key), BuildTmb(new[] { (key.Replace('/', '_') + "anim", 1, (short)0, 60) }, Array.Empty<string>()));
        s5.Add(Pap("c0101", "universe/err/all-error-pap-hit"), BuildPap(1, 101));
        var m5 = SkillResourceMap.Build(S5Rows(), codes, s5.Read);

        var c5 = ClassificationCounts(m5);
        check("S5 分类计数 no-store-universe=2 其余=0（优先级 6 先于 7：0 可用 store 即归此类）",
            CountOf(c5, "no-store-universe") == 2 && c5.Count == 1,
            string.Join(",", c5.Select(kv => kv.Key + "=" + kv.Value)));
        check("S5 K10 reason 含 0/2 短语且两 store error 状态带异常类型",
            Entry(m5, "universe/err/all-error-clean").Reason!.Contains("0/2 candidate stores have readable SKLB")
            && Entry(m5, "universe/err/all-error-clean").Reason!.Contains("c0101=error")
            && Entry(m5, "universe/err/all-error-clean").Reason!.Contains("IOException")
            && Entry(m5, "universe/err/all-error-clean").Reason!.Contains("c0201=error"));
        check("S5 K11 PAP 命中但 SKLB=error → no-store-universe（不得 resolvable），明细保留 hit",
            Entry(m5, "universe/err/all-error-pap-hit").Classification == "no-store-universe"
            && Entry(m5, "universe/err/all-error-pap-hit").PerStorePap.Single(p => p.Store == "c0101").Status == "hit"
            && m5.Stores.Single(s => s.Code == "c0101").SklbStatus == "error");
        check("S5 errorCounts sklb=2（每 store 一次）/pap=0/bad=0",
            m5.ErrorCounts.SklbReadErrors == 2 && m5.ErrorCounts.PapReadErrors == 0 && m5.ErrorCounts.BadPapHeaders == 0);
        check("S5 读取次数 TMB=2/SKLB=2/PAP=4（Build 正常返回、批处理未因 seam 异常中断）",
            ProbeCountsExact(s5, S5Rows().Select(r => r.Item2).ToList(), codes));
        var s5b = s5.Clone();
        var m5b = SkillResourceMap.Build(S5Rows().Where(r => r.Item2 != "universe/err/all-error-pap-hit"), codes, s5b.Read);
        check("S5 隔离：去 K11 重跑 K10 条目逐字节相同",
            m5b.Keys.Count == 1 && SkillResourceMap.CanonicalJson(m5b.Keys[0]).SequenceEqual(EntryBytes(m5, "universe/err/all-error-clean")));
        check("S5 隔离：被删键 TMB 与每个 store PAP 调用数为 0",
            DeletedKeyZeroCalls(s5b, "universe/err/all-error-pap-hit", codes));
        check("S5 隔离：读取次数按剩余键数重算（TMB=1/SKLB=2/PAP=2，无额外路径）",
            ProbeCountsExact(s5b, new[] { "universe/err/all-error-clean" }, codes));

        Console.WriteLine("  -- 跨场景汇总（S4+S5 两次 Build 的合计，不是单批） --");
        var total = m4.Keys.Count + m5.Keys.Count;
        var noStore = m4.Keys.Count(k => k.Classification == "no-store-universe") + m5.Keys.Count(k => k.Classification == "no-store-universe");
        check("跨场景汇总（非单批）：4 键 no-store-universe=4 其余=0",
            total == 4 && noStore == 4
            && m4.Keys.Concat(m5.Keys).All(k => k.Classification == "no-store-universe"));
        check("跨场景汇总（非单批）：errorCounts 合计 sklb=2/pap=0/bad=0",
            m4.ErrorCounts.SklbReadErrors + m5.ErrorCounts.SklbReadErrors == 2
            && m4.ErrorCounts.PapReadErrors + m5.ErrorCounts.PapReadErrors == 0
            && m4.ErrorCounts.BadPapHeaders + m5.ErrorCounts.BadPapHeaders == 0);
    }
}
