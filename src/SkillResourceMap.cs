// 技能资源覆盖清单：ActionTimeline key → TMB/骨架库/PAP 只读解析与九级优先分类（简洁编舞 P1-A）。
// 纯同步、无共享可变状态：全部游戏字节经调用方 seam（路径→字节/null/抛错）读取，模块自身不碰文件、网络与游戏线程。
// 一次 Build = 一份一致 store 快照：SKLB 每 store 恰读一次（store 级状态），TMB 每唯一 key 恰一次，
// PAP 每（唯一 key × store）无条件恰一次，不因 SKLB/TMB 状态门控。seam 数据层异常逐项隔离记录，永不抛出 Build。
// TMB 由本模块自行解析：条目布局、校验口径与 C002/C010/C012/C063 的 Kind 语义逐条沿用
// TmbResourceReferences 现行实现（不修改该类）；C010 flags 为其未输出的头内字段（条目偏移 +16 的
// int32，duration 之后的首个保留字段），由本模块补读。
using System.Buffers.Binary;
using System.Globalization;
using System.Security.Cryptography;
using System.Text;

namespace ChoreoHelper;

// ---- PAP 头（pap_selection.py 布局：count:int16 / code:int32 / info:int32 / start:int32 / end:int32，自偏移 8 起） ----
public sealed record SkillResourcePapHeader(short Count, int Code, int Info, int Start, int End);

// 单个（key × store）PAP 探测结果：hit（附解析头）/ missing / bad-pap-header（reason=失败的头校验项）/ read-error（reason=异常）
public sealed record SkillResourcePapProbe(string Store, string Status, string? Reason, SkillResourcePapHeader? Header);

// C010 动画阶段（按容器序）；flags 为本模块补读的 C010 头内字段
public sealed record SkillResourceMapPhase(string AnimationName, int Flags, short StartFrame, int DurationFrames);

// TMB 内引用（C002=timeline 等，按 TmbResourceReferences 现行 Kind 语义只记录、不跟随）
public sealed record SkillResourceMapReference(string EntryType, string Kind, string Path);

// per-store 明细行：SKLB 状态 + 该 store 逐 key 的 PAP 状态（无论 SKLB 是否命中都记录）
public sealed record SkillResourceStoreKeyPap(string Key, string Status, string? Reason);
public sealed record SkillResourceMapStore(string Code, string SklbStatus, string? SklbSha256, string? Reason,
    IReadOnlyList<SkillResourceStoreKeyPap> Keys);

// per-key 汇总条目：恰好一个分类（九级优先级先命中先停）
public sealed record SkillResourceMapKeyEntry(string Key, IReadOnlyList<uint> RowIds, string Classification,
    string? Reason, IReadOnlyList<SkillResourceMapPhase> Phases, bool MultiPhase,
    IReadOnlyList<SkillResourceMapReference> References, IReadOnlyList<SkillResourcePapProbe> PerStorePap);

public sealed record SkillResourceMapInputCounts(int Rows, int UniqueKeys, int EmptyKeyRows);
public sealed record SkillResourceMapErrorCounts(int SklbReadErrors, int PapReadErrors, int BadPapHeaders);

// 覆盖清单 manifest：schemaVersion=1；gameDataContext 标记资源来源（调用方 seam）；probeMode 为本轮探测模式版本串
public sealed record SkillResourceMapManifest(int SchemaVersion, string GameDataContext, string ProbeMode,
    SkillResourceMapInputCounts InputCounts, SkillResourceMapErrorCounts ErrorCounts,
    IReadOnlyList<SkillResourceMapStore> Stores, IReadOnlyList<SkillResourceMapKeyEntry> Keys);

public static class SkillResourceMap
{
    public const string GameDataContextMarker = "caller-provided-readonly-seam";
    public const string ProbeModeVersion = "tmb-chara-action+sklb-base-b0001+pap-bt-common/v1";

    public static string TmbPath(string key) => "chara/action/" + key + ".tmb";
    public static string SklbPath(string code) => "chara/human/" + code + "/skeleton/base/b0001/skl_" + code + "b0001.sklb";
    public static string PapPath(string code, string key) => "chara/human/" + code + "/animation/a0001/bt_common/" + key + ".pap";

    public static SkillResourceMapManifest Build(IEnumerable<(uint RowId, string Key)> rows,
        IReadOnlyList<string> candidateCodes, Func<string, byte[]?> tryRead)
    {
        ArgumentNullException.ThrowIfNull(rows);
        ArgumentNullException.ThrowIfNull(candidateCodes);
        ArgumentNullException.ThrowIfNull(tryRead);

        // 输入身份：空 key 行只计数不产条目；同一 key 多行合并为一个条目，rowIds 按输入出现序保留全部行号。
        var rowIdsByKey = new Dictionary<string, List<uint>>(StringComparer.Ordinal);
        var orderedKeys = new List<string>();
        var totalRows = 0;
        var emptyRows = 0;
        foreach (var (rowId, key) in rows)
        {
            totalRows++;
            if (string.IsNullOrEmpty(key)) { emptyRows++; continue; }
            if (!rowIdsByKey.TryGetValue(key, out var ids))
            {
                ids = new List<uint>();
                rowIdsByKey.Add(key, ids);
                orderedKeys.Add(key);
            }
            ids.Add(rowId);
        }

        // store 快照：每个候选 store 的 SKLB 每 Build 恰读一次；sklbStatus 为 store 级状态，本 Build 内对所有 key 一致。
        var stores = new (string Code, string Path, string Status, string? Sha256, string? Reason)[candidateCodes.Count];
        var sklbReadErrors = 0;
        for (var i = 0; i < candidateCodes.Count; i++)
        {
            var code = candidateCodes[i];
            var path = SklbPath(code);
            string status;
            string? sha256 = null;
            string? reason = null;
            try
            {
                var raw = tryRead(path);
                if (raw == null) status = "missing";
                else
                {
                    status = "ok";
                    sha256 = Convert.ToHexString(SHA256.HashData(raw)).ToLowerInvariant();
                }
            }
            catch (Exception ex)
            {
                status = "error";
                reason = ex.GetType().Name + ": " + ex.Message;
                sklbReadErrors++;
            }
            stores[i] = (code, path, status, sha256, reason);
        }
        var okStoreCount = 0;
        for (var i = 0; i < stores.Length; i++)
            if (stores[i].Status == "ok") okStoreCount++;

        var papReadErrors = 0;
        var badPapHeaders = 0;
        var entries = new List<SkillResourceMapKeyEntry>(orderedKeys.Count);
        var storeKeys = new List<SkillResourceStoreKeyPap>[candidateCodes.Count];
        for (var i = 0; i < candidateCodes.Count; i++) storeKeys[i] = new List<SkillResourceStoreKeyPap>();

        foreach (var key in orderedKeys)
        {
            // TMB 恰读一次（无条件：占位键、缺 TMB 键同样读）；抛错与未命中是两种不同状态。
            var tmbPath = TmbPath(key);
            byte[]? tmb = null;
            Exception? tmbError = null;
            try { tmb = tryRead(tmbPath); }
            catch (Exception ex) { tmbError = ex; }

            // PAP 每（key × store）恰一次，无条件探测：不因该 store 的 SKLB 状态或该 key 的 TMB 状态跳过。
            var paps = new SkillResourcePapProbe[candidateCodes.Count];
            for (var i = 0; i < candidateCodes.Count; i++)
            {
                var papPath = PapPath(candidateCodes[i], key);
                try
                {
                    var raw = tryRead(papPath);
                    if (raw == null) paps[i] = new(candidateCodes[i], "missing", null, null);
                    else
                    {
                        var error = PapHeaderError(raw, out var header);
                        if (error == null) paps[i] = new(candidateCodes[i], "hit", null, header);
                        else
                        {
                            paps[i] = new(candidateCodes[i], "bad-pap-header", error, null);
                            badPapHeaders++;
                        }
                    }
                }
                catch (Exception ex)
                {
                    paps[i] = new(candidateCodes[i], "read-error", ex.GetType().Name + ": " + ex.Message, null);
                    papReadErrors++;
                }
                storeKeys[i].Add(new SkillResourceStoreKeyPap(key, paps[i].Status, paps[i].Reason));
            }

            // TMB 解析：本模块自行解析，沿用 TmbResourceReferences 的条目布局与校验口径（不修改该类）。
            var phases = new List<SkillResourceMapPhase>();
            var references = new List<SkillResourceMapReference>();
            string? containerError = null;
            if (tmbError == null && tmb != null)
            {
                try { containerError = TryParseTmb(tmb, phases, references); }
                catch (Exception ex) { containerError = "TMB 容器无效：" + ex.GetType().Name + ": " + ex.Message; }
            }

            var classification = Classify(key, candidateCodes.Count, okStoreCount, tmbPath, tmb, tmbError,
                containerError, phases.Count, stores, paps, out var entryReason);
            entries.Add(new SkillResourceMapKeyEntry(key, rowIdsByKey[key], classification, entryReason,
                phases, phases.Count > 1, references, paps));
        }

        var storeRows = new SkillResourceMapStore[candidateCodes.Count];
        for (var i = 0; i < candidateCodes.Count; i++)
            storeRows[i] = new SkillResourceMapStore(stores[i].Code, stores[i].Status, stores[i].Sha256,
                stores[i].Reason, storeKeys[i]);
        return new SkillResourceMapManifest(1, GameDataContextMarker, ProbeModeVersion,
            new SkillResourceMapInputCounts(totalRows, orderedKeys.Count, emptyRows),
            new SkillResourceMapErrorCounts(sklbReadErrors, papReadErrors, badPapHeaders),
            storeRows, entries);
    }

    // TMB 自行解析：条目布局、长度/数量/字符串引用校验与 C002/C010/C012/C063 的 Kind 语义
    // 逐条沿用 TmbResourceReferences 现行口径；返回 null=解析成功，否则为容器无效原因。
    // C010 flags 为该类未输出的头内字段（条目偏移 +16 的 int32，duration 之后的首个保留字段），在此补读。
    private static string? TryParseTmb(byte[] data, List<SkillResourceMapPhase> phases,
        List<SkillResourceMapReference> references)
    {
        int I32(int at) => BinaryPrimitives.ReadInt32LittleEndian(data.AsSpan(at, 4));
        short I16(int at) => BinaryPrimitives.ReadInt16LittleEndian(data.AsSpan(at, 2));
        if (data.Length < 12 || data.Length > 2 * 1024 * 1024 || Encoding.ASCII.GetString(data, 0, 4) != "TMLB")
            return "TMB 容器标识或长度无效";
        if (I32(4) != data.Length || I32(8) is < 0 or > 4096) return "TMB 总长度或条目数量无效";
        var chunks = new List<(string Type, int At, int Size)>();
        var at = 12;
        for (var i = 0; i < I32(8); i++)
        {
            if (at > data.Length - 8) return "TMB 条目头被截断";
            var size = I32(at + 4);
            if (size < 8 || size > data.Length - at) return "TMB 条目长度越界";
            chunks.Add((Encoding.ASCII.GetString(data, at, 4), at, size));
            at += size;
        }
        foreach (var chunk in chunks)
        {
            var layout = chunk.Type switch
            {
                "C002" => (Size: 28, Field: 24, Kind: "timeline"),
                "C010" => (Size: 40, Field: 32, Kind: "animation-name"),
                "C012" => (Size: 72, Field: 20, Kind: "vfx"),
                "C063" => (Size: 32, Field: 20, Kind: "sound"),
                _ => (Size: 0, Field: 0, Kind: ""),
            };
            if (layout.Size == 0) continue;
            if (chunk.Size != layout.Size) return "TMB 已知引用条目版本不受支持：" + chunk.Type;
            long start = (long)chunk.At + 8 + I32(chunk.At + layout.Field);
            if (start < at || start >= data.Length) return "TMB 字符串引用未指向数据区";
            var end = Array.IndexOf(data, (byte)0, (int)start);
            if (end < 0 || end - start is < 1 or > 512) return "TMB 资源字符串缺失终止符或超限";
            var path = new UTF8Encoding(false, true).GetString(data, (int)start, end - (int)start);
            references.Add(new SkillResourceMapReference(chunk.Type, layout.Kind, path));
            if (chunk.Type != "C010") continue;
            phases.Add(new SkillResourceMapPhase(path, I32(chunk.At + 16), I16(chunk.At + 10), I32(chunk.At + 12)));
        }
        return null;
    }

    // 九级分类优先级（先命中先停）；命中优先于一切读取错误；读取错误不得当作 missing。
    private static string Classify(string key, int storeCount, int okStoreCount,
        string tmbPath, byte[]? tmb, Exception? tmbError, string? containerError, int phaseCount,
        (string Code, string Path, string Status, string? Sha256, string? Reason)[] stores,
        SkillResourcePapProbe[] paps, out string? reason)
    {
        if (HasPlaceholderToken(key, out var token))
        {
            reason = "key 含占位 token：" + token;
            return "placeholder-key";
        }
        if (tmbError == null && tmb == null)
        {
            reason = "TMB 未命中（seam null）：" + tmbPath;
            return "missing-tmb";
        }
        if (tmbError != null || containerError != null)
        {
            reason = tmbError != null
                ? "TMB 读取错误 " + tmbPath + "：" + tmbError.GetType().Name + ": " + tmbError.Message
                : "TMB 容器无效：" + containerError;
            return "unsupported-container";
        }
        if (phaseCount == 0)
        {
            reason = "TMB 解析成功但无 C010 动画阶段条目";
            return "no-animation-phase";
        }
        if (HasUsableHit(stores, paps))
        {
            reason = null;
            return "resolvable";
        }
        if (okStoreCount == 0)
        {
            reason = "0/" + storeCount + " candidate stores have readable SKLB："
                + string.Join("、", stores.Select(s => s.Code + "=" + s.Status + (s.Reason == null ? "" : "(" + s.Reason + ")")));
            return "no-store-universe";
        }
        var errorItems = new List<string>();
        foreach (var store in stores)
            if (store.Status == "error")
                errorItems.Add("store=" + store.Code + " 资源=" + store.Path + " 异常=" + store.Reason);
        foreach (var pap in paps)
            if (pap.Status == "read-error")
                errorItems.Add("store=" + pap.Store + " 资源=" + PapPath(pap.Store, key) + " 异常=" + pap.Reason);
        if (errorItems.Count > 0)
        {
            reason = "判定路径存在读取错误：" + string.Join("；", errorItems);
            return "read-error";
        }
        var badItems = new List<string>();
        for (var i = 0; i < stores.Length; i++)
            if (stores[i].Status == "ok" && paps[i].Status == "bad-pap-header")
                badItems.Add("store=" + stores[i].Code + " 路径=" + PapPath(stores[i].Code, key) + " 失败项=" + paps[i].Reason);
        if (badItems.Count > 0)
        {
            reason = "可用 store 的 PAP 头校验失败：" + string.Join("；", badItems);
            return "bad-pap-header";
        }
        reason = okStoreCount + " 个可用 store 的 PAP 探测均为 seam null（bt_common 模式缺口）";
        return "pattern-gap";
    }

    // 可用命中 = sklbStatus=ok 的 store 且其 PAP 状态=hit（SKLB 不可用的 store 即使 PAP 命中也不算）。
    private static bool HasUsableHit((string Code, string Path, string Status, string? Sha256, string? Reason)[] stores,
        SkillResourcePapProbe[] paps)
    {
        for (var i = 0; i < stores.Length; i++)
            if (stores[i].Status == "ok" && paps[i].Status == "hit") return true;
        return false;
    }

    // PAP 头校验（沿用 scripts/local-skill-assets/pap_selection.py:11-13 布局）；
    // 返回 null=有效（header 带解析值），否则为失败的头校验项名。
    public static string? PapHeaderError(byte[] raw, out SkillResourcePapHeader? header)
    {
        header = null;
        if (raw.Length < 26) return "length<26";
        if (raw[0] != (byte)'p' || raw[1] != (byte)'a' || raw[2] != (byte)'p' || raw[3] != (byte)' ') return "magic";
        var count = BinaryPrimitives.ReadInt16LittleEndian(raw.AsSpan(8, 2));
        var code = BinaryPrimitives.ReadInt32LittleEndian(raw.AsSpan(10, 4));
        var info = BinaryPrimitives.ReadInt32LittleEndian(raw.AsSpan(14, 4));
        var start = BinaryPrimitives.ReadInt32LittleEndian(raw.AsSpan(18, 4));
        var end = BinaryPrimitives.ReadInt32LittleEndian(raw.AsSpan(22, 4));
        if (count <= 0 || count > 2048) return "count";
        if (info < 26) return "info<26";
        // 防溢出：info+count*40 用 long 计算——int 算术在 info 接近 int.MaxValue 时回绕为负，
        // 会跳过本比较而把坏头误判为命中（尝试 1 验收反例 R1）。
        if ((long)info + count * 40L > start) return "info+count*40>start";
        if (start >= end) return "start>=end";
        if (end > raw.Length) return "end>length";
        header = new SkillResourcePapHeader(count, code, info, start, end);
        return null;
    }

    private static bool HasPlaceholderToken(string key, out string token)
    {
        token = "";
        var open = key.IndexOf('[');
        while (open >= 0)
        {
            var close = key.IndexOf(']', open + 1);
            if (close > open)
            {
                token = key.Substring(open, close - open + 1);
                return true;
            }
            open = key.IndexOf('[', open + 1);
        }
        return false;
    }

    // per-key 条目的规范序列化（固定字段序、无空白、JSON 字符串转义、UTF-8）：
    // 隔离断言用——同快照删键重跑后剩余条目必须与全量运行逐字节相同。
    // 数值一律 InvariantCulture 格式（尝试 1 验收反例 R2：CurrentCulture 下 ar-SA 负号含 U+061C，
    // 导致字节随区域漂移且产物不是合法 JSON）。
    public static byte[] CanonicalJson(SkillResourceMapKeyEntry entry)
    {
        var sb = new StringBuilder(256);
        sb.Append("{\"key\":");
        AppendJsonString(sb, entry.Key);
        sb.Append(",\"rowIds\":[");
        for (var i = 0; i < entry.RowIds.Count; i++)
        {
            if (i > 0) sb.Append(',');
            sb.Append(entry.RowIds[i].ToString(CultureInfo.InvariantCulture));
        }
        sb.Append("],\"classification\":");
        AppendJsonString(sb, entry.Classification);
        sb.Append(",\"reason\":");
        if (entry.Reason == null) sb.Append("null");
        else AppendJsonString(sb, entry.Reason);
        sb.Append(",\"multiPhase\":").Append(entry.MultiPhase ? "true" : "false");
        sb.Append(",\"phases\":[");
        for (var i = 0; i < entry.Phases.Count; i++)
        {
            var phase = entry.Phases[i];
            if (i > 0) sb.Append(',');
            sb.Append("{\"animationName\":");
            AppendJsonString(sb, phase.AnimationName);
            sb.Append(",\"flags\":").Append(phase.Flags.ToString(CultureInfo.InvariantCulture))
                .Append(",\"startFrame\":").Append(phase.StartFrame.ToString(CultureInfo.InvariantCulture))
                .Append(",\"durationFrames\":").Append(phase.DurationFrames.ToString(CultureInfo.InvariantCulture)).Append('}');
        }
        sb.Append("],\"references\":[");
        for (var i = 0; i < entry.References.Count; i++)
        {
            var reference = entry.References[i];
            if (i > 0) sb.Append(',');
            sb.Append("{\"entryType\":");
            AppendJsonString(sb, reference.EntryType);
            sb.Append(",\"kind\":");
            AppendJsonString(sb, reference.Kind);
            sb.Append(",\"path\":");
            AppendJsonString(sb, reference.Path);
            sb.Append('}');
        }
        sb.Append("],\"perStorePap\":[");
        for (var i = 0; i < entry.PerStorePap.Count; i++)
        {
            var pap = entry.PerStorePap[i];
            if (i > 0) sb.Append(',');
            sb.Append("{\"store\":");
            AppendJsonString(sb, pap.Store);
            sb.Append(",\"status\":");
            AppendJsonString(sb, pap.Status);
            sb.Append(",\"reason\":");
            if (pap.Reason == null) sb.Append("null");
            else AppendJsonString(sb, pap.Reason);
            sb.Append(",\"header\":");
            if (pap.Header == null) sb.Append("null");
            else sb.Append("{\"count\":").Append(pap.Header.Count.ToString(CultureInfo.InvariantCulture))
                .Append(",\"code\":").Append(pap.Header.Code.ToString(CultureInfo.InvariantCulture))
                .Append(",\"info\":").Append(pap.Header.Info.ToString(CultureInfo.InvariantCulture))
                .Append(",\"start\":").Append(pap.Header.Start.ToString(CultureInfo.InvariantCulture))
                .Append(",\"end\":").Append(pap.Header.End.ToString(CultureInfo.InvariantCulture)).Append('}');
            sb.Append('}');
        }
        sb.Append("]}");
        return Encoding.UTF8.GetBytes(sb.ToString());
    }

    private static void AppendJsonString(StringBuilder sb, string value)
    {
        sb.Append('"');
        foreach (var c in value)
        {
            if (c == '"' || c == '\\') { sb.Append('\\').Append(c); }
            else if (c < 0x20) sb.Append("\\u").Append(((int)c).ToString("x4", CultureInfo.InvariantCulture));
            else sb.Append(c);
        }
        sb.Append('"');
    }
}
