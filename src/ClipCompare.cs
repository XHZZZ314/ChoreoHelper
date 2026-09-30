// 这个文件是干嘛的：GAMECLOCK 包的两个纯函数件（TASK-20260831-GAMECLOCK-PREVIEW-VERIFY）。
// ① PlaybackStatusV2：enriched /playback/status 载荷的纯构造 + /capabilities 能力表注入。
//    网页时钟跟随（game 模式播放头对齐插件权威时钟）吃这份载荷；旧字段 playing/time 的
//    名称与格式保持字节兼容（F1 精度、小写布尔），新增字段只往后追加——旧网页照常解析。
// ② ClipCompare：录制 clip（库里已存的 AnimClipData）vs 现采 clip（RecorderService 重放
//    同命令现录的 AnimClipData）的确定性偏差比较：两侧都按各自时长归一化进度对齐（动作
//    起点即 0，均匀步进插值采样），逐骨算最大旋转差（q/-q 等价，同 MotionDetect 口径）
//    与平移差，出总判定与热点骨。审核只报告、不落盘、不修数据。
// 无 Dalamud 依赖，进 datalayertest（同 SeekPlan/MotionDetect 惯例）。
using System.Globalization;
using System.Numerics;
using ChoreoHelper.Exporter;

namespace ChoreoHelper;

public static class PlaybackStatusV2
{
    /// <summary>enriched status 载荷。stampMs 用调用方的单调毫秒（Environment.TickCount64），
    /// 本函数不做时钟读取（纯函数：同输入同输出，datalayertest 直测）。字段顺序固定：
    /// playing/time 两个旧字段在前（字节兼容旧载荷），新增字段只追加在后面。</summary>
    public static string BuildJson(bool playing, float time, long revision, float speed, float maxEnd, long stampMs)
    {
        var ic = CultureInfo.InvariantCulture;
        return "{\"playing\":" + (playing ? "true" : "false")
            + ",\"time\":" + time.ToString("F1", ic)
            + ",\"revision\":" + revision.ToString(ic)
            + ",\"speed\":" + speed.ToString("R", ic)
            + ",\"maxEnd\":" + maxEnd.ToString("F1", ic)
            + ",\"stampMs\":" + stampMs.ToString(ic)
            + "}";
    }

    /// <summary>能力表注入：往 /capabilities JSON 的 capabilities 数组补一个能力名。
    /// 已存在或 JSON 解析失败时原样返回（永不破坏旧载荷——老插件升级场景靠它兜底）。</summary>
    public static string WithCapabilities(string capabilitiesJson, string capability)
    {
        try
        {
            var node = System.Text.Json.Nodes.JsonNode.Parse(capabilitiesJson) as System.Text.Json.Nodes.JsonObject;
            if (node == null || !node.TryGetPropertyValue("capabilities", out var caps) || caps is not System.Text.Json.Nodes.JsonArray arr)
                return capabilitiesJson;
            foreach (var item in arr)
                if (item is System.Text.Json.Nodes.JsonValue v && v.TryGetValue<string>(out var s) && s == capability)
                    return capabilitiesJson;
            arr.Add(capability);
            return node.ToJsonString();
        }
        catch
        {
            return capabilitiesJson;
        }
    }

    /// <summary>整场执行就绪（ShowRunner/输入状态/全局停止齐备）时的舞台能力串：
    /// 走位、游戏内映射确认、整场混排、独立朝向 stageFacingV1 与按节点自动切换走/跑 stageLocomotionAutoV1。
    /// 纯函数供 datalayertest 直测；HttpServer 能力路由处调用。</summary>
    public static string WithStageShowCapabilities(string capabilitiesJson)
        => WithCapabilities(WithCapabilities(WithCapabilities(WithCapabilities(WithCapabilities(capabilitiesJson,
            "stagePathShowV1"), "stagePathNativeConfirmV1"), "stageShowV2"), StageShowContract.FacingCapability),
            StageShowContract.LocomotionCapability);
}

/// <summary>单骨偏差热点：该骨骼在整段对齐比较里的最大旋转差/平移差。</summary>
public sealed class ClipHotspot
{
    public string Bone { get; set; } = "";
    public float RotDeltaRad { get; set; }
    public float TransDeltaM { get; set; }
}

/// <summary>比较结果：verdict=match/deviation；aggregate=全骨最差的归一化偏差倍数
/// （≤1 即各项都在容差内）。报告整形时钳到有限值，JSON 永不出 NaN/Infinity。</summary>
public sealed class ClipCompareResult
{
    public string Verdict { get; set; } = "deviation";
    public float Aggregate { get; set; }
    public float MaxRotDeltaRad { get; set; }
    public float MaxTransDeltaM { get; set; }
    public List<ClipHotspot> Hotspots { get; } = new();
    public int ComparedBones { get; set; }
    public int Steps { get; set; }
}

public static class ClipCompare
{
    /// <summary>旋转容差（弧度）：与 MotionDetect.StillAngleRad 同口径（真实数据校准的余波上限）。</summary>
    public const float RotToleranceRad = MotionDetect.StillAngleRad;
    /// <summary>平移容差（米）：静止判据 StillTransM 的 5 倍，重触发动作的站位微差不误报。</summary>
    public const float TransToleranceM = 0.10f;
    /// <summary>归一化进度采样步数：两侧时长不同/采样率不同也按同一步进比，确定性来源。</summary>
    public const int StepCount = 64;
    /// <summary>报告整形时的偏差钳制上限（decompose 失败等保守 MaxValue 不能进 JSON）。</summary>
    public const float ReportMaxDelta = 999f;

    /// <summary>比较两份 clip：expected=库里已存的录制数据，actual=现采重录数据。
    /// 时间对齐：两侧各自按 duration 归一化到 [0,1]，同一步进位置插值取姿态再比——
    /// 整段录制起点偏移、采样率疏密都被吸收，只剩形状差。无可比骨骼判 deviation。</summary>
    public static ClipCompareResult Compare(AnimClipData expected, AnimClipData actual)
    {
        var result = new ClipCompareResult { Steps = StepCount };
        if (expected?.bones == null || actual?.bones == null || expected.bones.Count == 0 || actual.bones.Count == 0)
        {
            result.Aggregate = ReportMaxDelta;
            return result;
        }

        var expDur = expected.duration > 0 ? expected.duration : 0f;
        var actDur = actual.duration > 0 ? actual.duration : 0f;
        var aggregate = 0f;
        var maxRot = 0f;
        var maxTrans = 0f;
        var hotspots = new List<ClipHotspot>();
        var compared = 0;

        foreach (var kv in actual.bones)
        {
            if (!expected.bones.TryGetValue(kv.Key, out var expBone)) continue;
            var actBone = kv.Value;
            if (actBone?.q == null || actBone.q.Count < 2 || expBone?.q == null || expBone.q.Count < 2) continue;
            compared++;
            var boneRot = 0f;
            var boneTrans = 0f;
            for (var i = 0; i < StepCount; i++)
            {
                var p = (float)i / (StepCount - 1);
                var (qe, pe) = Eval(expBone, p * expDur);
                var (qa, pa) = Eval(actBone, p * actDur);
                boneRot = MathF.Max(boneRot, RotDeltaRad(qe, qa));
                boneTrans = MathF.Max(boneTrans, Vector3.Distance(pe, pa));
            }
            maxRot = MathF.Max(maxRot, boneRot);
            maxTrans = MathF.Max(maxTrans, boneTrans);
            aggregate = MathF.Max(aggregate, MathF.Max(boneRot / RotToleranceRad, boneTrans / TransToleranceM));
            if (boneRot > RotToleranceRad || boneTrans > TransToleranceM)
                hotspots.Add(new ClipHotspot { Bone = kv.Key, RotDeltaRad = boneRot, TransDeltaM = boneTrans });
        }

        result.ComparedBones = compared;
        result.MaxRotDeltaRad = MathF.Min(maxRot, ReportMaxDelta);
        result.MaxTransDeltaM = MathF.Min(maxTrans, ReportMaxDelta);
        result.Aggregate = compared == 0 ? ReportMaxDelta : MathF.Min(aggregate, ReportMaxDelta);
        result.Verdict = compared > 0 && result.Aggregate <= 1f ? "match" : "deviation";
        hotspots.Sort((a, b) => b.RotDeltaRad.CompareTo(a.RotDeltaRad));
        const int maxHotspots = 5;
        for (var i = 0; i < hotspots.Count && i < maxHotspots; i++) result.Hotspots.Add(hotspots[i]);
        return result;
    }

    /// <summary>两姿态旋转真实角差（弧度），q 与 -q 等价（dot 取绝对值）——
    /// 与 MotionDetect.RotationDeltaRad 同口径，但这里直接吃四元数（不再经 Matrix 分解）。</summary>
    public static float RotDeltaRad(Quaternion a, Quaternion b)
    {
        var la = a.LengthSquared();
        var lb = b.LengthSquared();
        if (la < 1e-12f || lb < 1e-12f) return ReportMaxDelta;
        var d = Math.Clamp(MathF.Abs(Quaternion.Dot(a, b)) / MathF.Sqrt(la * lb), 0f, 1f);
        return 2f * MathF.Acos(d);
    }

    /// <summary>骨骼通道在时刻 t 的姿态：关键帧线性插值（旋转 nlerp 归一化）。
    /// 通道稀疏/疏密不均都确定收敛到同一段插值——t 越界钳到首末关键帧。</summary>
    public static (Quaternion Q, Vector3 P) Eval(BoneChannel bone, float t)
    {
        var q = bone.q!;
        var tr = bone.t;
        if (q.Count == 0) return (Quaternion.Identity, Vector3.Zero);

        (float T, Quaternion Q) QAt(int i) => (q[i][0], new Quaternion(q[i][1], q[i][2], q[i][3], q[i][4]));
        Quaternion rot;
        if (t <= q[0][0]) rot = QAt(0).Q;
        else if (t >= q[^1][0]) rot = QAt(q.Count - 1).Q;
        else
        {
            var seg = 1;
            while (seg < q.Count - 1 && q[seg][0] < t) seg++;
            var a = QAt(seg - 1);
            var b = QAt(seg);
            var span = b.T - a.T;
            var f = span > 1e-9f ? (t - a.T) / span : 0f;
            rot = Quaternion.Lerp(a.Q, b.Q, f);
            if (rot.LengthSquared() > 1e-12f) rot = Quaternion.Normalize(rot);
        }

        var pos = Vector3.Zero;
        if (tr is { Count: > 0 })
        {
            (float T, Vector3 P) PAt(int i) => (tr[i][0], new Vector3(tr[i][1], tr[i][2], tr[i][3]));
            if (t <= tr[0][0]) pos = PAt(0).P;
            else if (t >= tr[^1][0]) pos = PAt(tr.Count - 1).P;
            else
            {
                var seg = 1;
                while (seg < tr.Count - 1 && tr[seg][0] < t) seg++;
                var a = PAt(seg - 1);
                var b = PAt(seg);
                var span = b.T - a.T;
                var f = span > 1e-9f ? (t - a.T) / span : 0f;
                pos = Vector3.Lerp(a.P, b.P, f);
            }
        }
        return (rot, pos);
    }

    /// <summary>审核报告 JSON（AC-6 契约形状）：{ok,command,verdict,aggregate,maxRotDelta,
    /// maxTransDelta,hotspots,frames,sampleHz,persistent,reason}。数值全部钳为有限值并
    /// 四舍五入，invariant culture——同一比较结果永远序列化出同一份报告。</summary>
    public static string VerifyReportJson(string command, ClipCompareResult r, int frames, double sampleHz, bool persistent, string reason)
    {
        var ic = CultureInfo.InvariantCulture;
        string F(float v) => MathF.Min(MathF.Max(v, 0f), ReportMaxDelta).ToString("0.####", ic);
        var hs = new List<string>();
        foreach (var h in r.Hotspots)
            hs.Add("{\"bone\":\"" + Escape(h.Bone) + "\",\"rotDelta\":" + F(h.RotDeltaRad) + ",\"transDelta\":" + F(h.TransDeltaM) + "}");
        return "{\"ok\":true"
            + ",\"command\":\"" + Escape(command) + "\""
            + ",\"verdict\":\"" + r.Verdict + "\""
            + ",\"aggregate\":" + F(r.Aggregate)
            + ",\"maxRotDelta\":" + F(r.MaxRotDeltaRad)
            + ",\"maxTransDelta\":" + F(r.MaxTransDeltaM)
            + ",\"hotspots\":[" + string.Join(",", hs) + "]"
            + ",\"comparedBones\":" + r.ComparedBones.ToString(ic)
            + ",\"frames\":" + Math.Max(0, frames).ToString(ic)
            + ",\"sampleHz\":" + (double.IsFinite(sampleHz) ? Math.Round(sampleHz, 1, MidpointRounding.AwayFromZero).ToString("0.#", ic) : "0")
            + ",\"persistent\":" + (persistent ? "true" : "false")
            + ",\"reason\":\"" + Escape(reason) + "\""
            + "}";
    }

    private static string Escape(string s)
        => (s ?? "").Replace("\\", "\\\\").Replace("\"", "\\\"")
            .Replace("\r", "\\r").Replace("\n", "\\n").Replace("\t", "\\t");
}
