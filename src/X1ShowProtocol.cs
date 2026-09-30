// 这个文件是干嘛的：严格解析 X1 版本化输入和显式角色/舞台绑定；网页只声明条件，不提供游戏观测。
using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text.Json;

namespace ChoreoHelper;

/// <summary>显式舞台到游戏 x/z 的刚体变换；0 度为 +Z，正角转向 +X。只计算，不写游戏。</summary>
public sealed class X1StageTransform
{
    public string Id { get; }
    public double OriginX { get; }
    public double OriginZ { get; }
    public double YawDeg { get; }
    private readonly double _sin;
    private readonly double _cos;

    public X1StageTransform(string id, double originX, double originZ, double yawDeg)
    {
        if (!X1ShowProtocol.IsIdentity(id) || !double.IsFinite(originX) || !double.IsFinite(originZ) || !double.IsFinite(yawDeg))
            throw new ArgumentException("舞台必须有明确标识与有限的原点、正面角度");
        Id = id; OriginX = originX; OriginZ = originZ; YawDeg = yawDeg;
        var radians = (yawDeg % 360) * Math.PI / 180;
        _sin = Math.Sin(radians); _cos = Math.Cos(radians);
    }

    public (double X, double Z) ToWorldVector(double x, double z)
        => Finite(x * _cos + z * _sin, -x * _sin + z * _cos);
    public (double X, double Z) ToWorld(double x, double z)
    {
        var v = ToWorldVector(x, z);
        return Finite(v.X + OriginX, v.Z + OriginZ);
    }
    public (double X, double Z) ToStage(double x, double z)
    {
        var v = Finite(x - OriginX, z - OriginZ);
        return Finite(v.X * _cos - v.Z * _sin, v.X * _sin + v.Z * _cos);
    }
    public double ToWorldAngle(double angleDeg) => Angle(angleDeg, YawDeg);
    public double ToStageAngle(double angleDeg) => Angle(angleDeg, -YawDeg);
    public bool SameFrame(X1StageTransform other) => other != null && Id == other.Id
        && OriginX == other.OriginX && OriginZ == other.OriginZ && YawDeg == other.YawDeg;
    private static double Angle(double value, double offset)
    {
        if (!double.IsFinite(value)) throw new ArgumentException("朝向角须为有限数值");
        var result = ((value % 360) + (offset % 360)) % 360;
        if (result < 0) result += 360;
        return result >= 360 || result == 0 ? 0 : result;
    }
    private static (double X, double Z) Finite(double x, double z)
    {
        if (!double.IsFinite(x) || !double.IsFinite(z)) throw new ArgumentException("舞台坐标变换超出有限范围");
        return (x, z);
    }
}

public sealed class X1ActorBinding
{
    public string PerformerId { get; }
    public string ActorId { get; }
    public uint TerritoryId { get; }
    public X1StageTransform Stage { get; }
    internal X1ActorBinding(string performerId, string actorId, uint territoryId, X1StageTransform stage)
    { PerformerId = performerId; ActorId = actorId; TerritoryId = territoryId; Stage = stage; }
}

public sealed class X1PackageInput
{
    public int Version => X1ShowProtocol.Version;
    public IReadOnlyList<X1ActorBinding> Bindings { get; }
    internal X1PackageInput(IEnumerable<X1ActorBinding> bindings)
        => Bindings = Array.AsReadOnly(bindings.ToArray());
}

/// <summary>JSON 所有权在解析时复制；外部只能读不可变字段，执行器得到独立输入副本。</summary>
public sealed class X1EventInput
{
    private readonly JsonElement _value;
    public int Version => X1ShowProtocol.Version;
    public string Kind { get; }
    public X1FailurePolicy FailurePolicy { get; }
    public string TargetId => Kind == "ability" ? _value.GetProperty("targetId").GetString()! : "";
    public string RequiredJobId => Kind == "ability" ? _value.GetProperty("requiredJobId").GetString()! : "";
    public string OtherActorTargetId => Kind == "facing" && _value.TryGetProperty("otherActorTargetId", out var p) ? p.GetString()! : "";
    internal X1EventInput(JsonElement value, string kind, X1FailurePolicy policy)
    { _value = value.Clone(); Kind = kind; FailurePolicy = policy; }

    public X1AbilityInput CreateAbilityInput(string eventId, string performerId)
    {
        RequireKind("ability");
        return new X1AbilityInput { EventId = eventId, PerformerId = performerId,
            ActionId = _value.GetProperty("actionId").GetString()!, RequiredJobId = RequiredJobId,
            RequiredLevel = _value.GetProperty("requiredLevel").GetInt32(), FailurePolicy = FailurePolicy };
    }
    public X1MovementInput CreateMovementInput(string eventId, string performerId)
    {
        RequireKind("movement");
        var result = new X1MovementInput { EventId = eventId, PerformerId = performerId,
            Locomotion = _value.GetProperty("locomotion").GetString() == "walk" ? X1Locomotion.Walk : X1Locomotion.Run,
            ArrivalToleranceM = _value.GetProperty("arrivalToleranceM").GetDouble(),
            MaxCorrectionM = _value.GetProperty("maxCorrectionM").GetDouble(), FailurePolicy = FailurePolicy };
        foreach (var point in _value.GetProperty("points").EnumerateArray())
            result.Points.Add(new X1Waypoint { TMs = point.GetProperty("tMs").GetInt64(),
                X = point.GetProperty("x").GetDouble(), Z = point.GetProperty("z").GetDouble() });
        return result;
    }
    public X1FacingInput CreateFacingInput(string eventId, string performerId)
    {
        RequireKind("facing");
        var result = new X1FacingInput { EventId = eventId, PerformerId = performerId, FailurePolicy = FailurePolicy };
        switch (_value.GetProperty("mode").GetString())
        {
            case "fixedAngle": result.FacingMode = X1FacingMode.FixedAngle; result.FixedAngleDeg = Number("fixedAngleDeg"); break;
            case "alongPath": result.FacingMode = X1FacingMode.AlongPath; break;
            case "transition": result.FacingMode = X1FacingMode.Transition;
                result.TransitionFromDeg = Number("transitionFromDeg"); result.TransitionToDeg = Number("transitionToDeg"); break;
            case "stageCenter": result.FacingMode = X1FacingMode.StageCenter;
                result.StageCenterX = Number("stageCenterX"); result.StageCenterZ = Number("stageCenterZ"); break;
            case "otherActor": result.FacingMode = X1FacingMode.OtherActor; result.OtherActorTargetId = OtherActorTargetId; break;
            default: throw new InvalidOperationException("未知朝向模式");
        }
        return result;
    }
    private double Number(string name) => _value.GetProperty(name).GetDouble();
    private void RequireKind(string kind)
    { if (Kind != kind) throw new InvalidOperationException("X1 输入类型与执行器不匹配"); }
}

public static class X1ShowProtocol
{
    public const int Version = 1;
    public const string Capability = "x1-input-v1";
    public const long MaxSafeInteger = 9_007_199_254_740_991;
    public static readonly IReadOnlyList<string> RequiredConditions = Array.AsReadOnly(new[]
        { "jobMatches", "levelMeets", "targetValid", "notCasting", "cooldownReady", "movementAllowed", "controllable" });
    public static bool IsX1Kind(string kind) => kind == "ability" || kind == "movement" || kind == "facing";

    internal static X1PackageInput ParsePackage(JsonElement value)
    {
        CheckProperties(value, "X1 整包输入", "version", "bindings");
        CheckVersion(value);
        var rows = Required(value, "bindings");
        if (rows.ValueKind != JsonValueKind.Array || rows.GetArrayLength() == 0 || rows.GetArrayLength() > ShowProtocol.MaxPerformers)
            throw Bad("X1 bindings 必须是非空、有界数组");
        var bindings = new List<X1ActorBinding>();
        var performers = new HashSet<string>(StringComparer.Ordinal);
        var actors = new HashSet<string>(StringComparer.Ordinal);
        foreach (var row in rows.EnumerateArray())
        {
            CheckProperties(row, "X1 演员绑定", "performerId", "actorId", "territoryId", "stage");
            var performer = Text(row, "performerId");
            var actor = CanonicalId(row, "actorId", ulong.MaxValue);
            var territory = Integer(row, "territoryId", 1, uint.MaxValue);
            if (!performers.Add(performer) || !actors.Add(actor)) throw Bad("X1 演员或角色绑定重复");
            var stage = Required(row, "stage");
            CheckProperties(stage, "X1 舞台", "id", "originX", "originZ", "yawDeg");
            bindings.Add(new X1ActorBinding(performer, actor, (uint)territory,
                new X1StageTransform(Text(stage, "id"), Number(stage, "originX"), Number(stage, "originZ"), Number(stage, "yawDeg"))));
        }
        return new X1PackageInput(bindings);
    }

    internal static X1EventInput ParseEvent(JsonElement value, string kind, long durationMs)
    {
        if (!IsX1Kind(kind)) throw Bad("只有技能、路径和朝向事件允许 X1 输入");
        if (durationMs < 0 || durationMs > MaxSafeInteger) throw Bad("X1 事件持续时间超出网页安全整数范围");
        if (value.ValueKind != JsonValueKind.Object) throw Bad("X1 事件输入必须是对象");
        CheckVersion(value);
        var policy = Text(value, "failurePolicy") switch
        {
            "skip" => X1FailurePolicy.Skip, "stopShow" => X1FailurePolicy.StopShow,
            _ => throw Bad("X1 failurePolicy 必须显式为 skip 或 stopShow（等待尚不支持）"),
        };
        if (kind == "ability")
        {
            CheckProperties(value, "X1 技能", "version", "failurePolicy", "actionId", "requiredJobId", "requiredLevel", "targetId", "requiredConditions");
            CanonicalId(value, "actionId", int.MaxValue);
            CanonicalId(value, "requiredJobId", uint.MaxValue);
            CanonicalId(value, "targetId", ulong.MaxValue);
            Integer(value, "requiredLevel", 1, 100);
            var conditions = Required(value, "requiredConditions");
            if (conditions.ValueKind != JsonValueKind.Array || conditions.GetArrayLength() != RequiredConditions.Count)
                throw Bad("技能必须完整声明七项 requiredConditions，不能提供满足值");
            var seen = new HashSet<string>(StringComparer.Ordinal);
            foreach (var condition in conditions.EnumerateArray())
                if (condition.ValueKind != JsonValueKind.String || !RequiredConditions.Contains(condition.GetString()!) || !seen.Add(condition.GetString()!))
                    throw Bad("技能条件名称未知或重复；网页不能声明游戏条件已满足");
        }
        else if (kind == "movement")
        {
            CheckProperties(value, "X1 路径", "version", "failurePolicy", "points", "locomotion", "arrivalToleranceM", "maxCorrectionM");
            if (durationMs <= 0) throw Bad("路径必须有正持续时间");
            var locomotion = Text(value, "locomotion");
            if (locomotion != "walk" && locomotion != "run") throw Bad("路径必须显式选择 walk 或 run");
            if (Number(value, "arrivalToleranceM") <= 0 || Number(value, "maxCorrectionM") <= 0)
                throw Bad("路径到达容差与修正界必须是有限正数");
            var points = Required(value, "points");
            if (points.ValueKind != JsonValueKind.Array || points.GetArrayLength() < 2 || points.GetArrayLength() > ShowProtocol.MaxEvents)
                throw Bad("路径必须有 2 至 5000 个已采样路点");
            long previous = -1;
            foreach (var point in points.EnumerateArray())
            {
                CheckProperties(point, "X1 路点", "tMs", "x", "z");
                var t = Integer(point, "tMs", 0, durationMs);
                if (t <= previous || previous == -1 && t != 0) throw Bad("路点时刻须从 0 开始严格递增");
                Number(point, "x"); Number(point, "z"); previous = t;
            }
            if (previous != durationMs) throw Bad("路径末路点时刻必须等于事件持续时间，不能猜测终点时间");
        }
        else
        {
            if (durationMs <= 0) throw Bad("独立朝向必须有正持续时间");
            switch (Text(value, "mode"))
            {
                case "fixedAngle":
                    CheckProperties(value, "X1 固定朝向", "version", "failurePolicy", "mode", "fixedAngleDeg"); Number(value, "fixedAngleDeg"); break;
                case "alongPath": CheckProperties(value, "X1 沿路径朝向", "version", "failurePolicy", "mode"); break;
                case "transition":
                    CheckProperties(value, "X1 过渡朝向", "version", "failurePolicy", "mode", "transitionFromDeg", "transitionToDeg");
                    if (!double.IsFinite(Number(value, "transitionToDeg") - Number(value, "transitionFromDeg")))
                        throw Bad("过渡朝向起止角差须为有限数值");
                    break;
                case "stageCenter":
                    CheckProperties(value, "X1 舞台中心朝向", "version", "failurePolicy", "mode", "stageCenterX", "stageCenterZ");
                    Number(value, "stageCenterX"); Number(value, "stageCenterZ"); break;
                case "otherActor":
                    CheckProperties(value, "X1 他演员朝向", "version", "failurePolicy", "mode", "otherActorTargetId"); Text(value, "otherActorTargetId"); break;
                default: throw Bad("未知 X1 朝向模式");
            }
        }
        return new X1EventInput(value, kind, policy);
    }

    /// <summary>旧裸 X1 事件仍由旧 validator 拒绝；一旦出现版本化输入，不允许部分扩展或缺能力。</summary>
    public static (bool Ok, string Error) ValidateWireEnvelope(ShowPackage package)
    {
        var hasInput = package.X1 != null || package.Events.Any(e => e.X1 != null);
        var hasCapability = package.Capabilities.Any(c => c.Name == Capability);
        if (!hasInput && !hasCapability) return (true, "");
        if (package.X1 == null || !hasCapability) return (false, "X1 必须同时提供整包绑定和 x1-input-v1 能力要求");
        if (!package.Events.Any(e => IsX1Kind(e.Kind))) return (false, "X1 整包输入没有对应技能、路径或朝向事件");
        foreach (var e in package.Events)
            if (IsX1Kind(e.Kind) != (e.X1 != null) || e.X1 != null && e.X1.Kind != e.Kind)
                return (false, "事件「" + e.Id + "」X1 输入缺失或与类型不一致");
        return (true, "");
    }

    public static (bool Ok, string Error) ValidatePackage(ShowPackage package, bool ownsMovementFacing)
    {
        var envelope = ValidateWireEnvelope(package);
        if (!envelope.Ok || package.X1 == null) return envelope;
        if (package.DurationMs < 0 || package.DurationMs > MaxSafeInteger)
            return (false, "X1 演出时长须在网页安全整数范围内");
        var performerIds = new HashSet<string>(StringComparer.Ordinal);
        foreach (var p in package.Performers)
            if (!IsIdentity(p.Id) || !performerIds.Add(p.Id)) return (false, "X1 演员标识无效或重复：须为 1 至 256 字符且不含控制字符");
        var eventIds = new HashSet<string>(StringComparer.Ordinal);
        string? localPerformer = null;
        foreach (var e in package.Events)
        {
            if (!IsIdentity(e.Id) || !eventIds.Add(e.Id)) return (false, "X1 事件标识无效或重复：须为 1 至 256 字符且不含控制字符");
            if (!string.IsNullOrEmpty(e.PerformerId) && !IsIdentity(e.PerformerId))
                return (false, "X1 事件演员标识须为 1 至 256 字符且不含控制字符");
            if (e.StartMs < 0 || e.DurationMs < 0 || e.StartMs > MaxSafeInteger || e.DurationMs > MaxSafeInteger - e.StartMs)
                return (false, "X1 事件起点、时长与结束时刻须在网页安全整数范围内");
            if (e.StartMs > package.DurationMs || e.DurationMs > package.DurationMs - e.StartMs)
                return (false, "事件「" + e.Id + "」时刻超出演出范围");
            if (e.Kind != "motion" && !IsX1Kind(e.Kind)) continue;
            if (!performerIds.Contains(e.PerformerId)) return (false, "驱动事件「" + e.Id + "」没有有效演员");
            localPerformer ??= e.PerformerId;
            if (localPerformer != e.PerformerId) return (false, "本机 X1 演出包只能驱动一位明确演员，动作事件也须同属该演员");
        }
        var local = package.X1.Bindings.SingleOrDefault(b => b.PerformerId == localPerformer);
        if (local == null) return (false, "X1 本地演员缺少明确角色、区域与舞台绑定");
        foreach (var e in package.Events.Where(e => e.X1 != null))
        {
            try
            {
                if (e.Kind == "ability")
                {
                    var check = X1InputValidation.ValidateAbility(e.X1!.CreateAbilityInput(e.Id, e.PerformerId));
                    if (!check.Ok) return check;
                }
                else if (e.Kind == "movement")
                {
                    var input = e.X1!.CreateMovementInput(e.Id, e.PerformerId);
                    var check = X1InputValidation.ValidateMovement(input);
                    if (!check.Ok) return check;
                    if (e.DurationMs <= 0 || input.Points[0].TMs != 0 || input.Points[^1].TMs != e.DurationMs)
                        return (false, "路径时刻已改变，须重新编译完整路点");
                    foreach (var p in input.Points) local.Stage.ToWorld(p.X, p.Z);
                    for (var i = 1; i < input.Points.Count; i++)
                    {
                        var dx = input.Points[i].X - input.Points[i - 1].X;
                        var dz = input.Points[i].Z - input.Points[i - 1].Z;
                        if (!double.IsFinite(dx * dx + dz * dz)) return (false, "路径段坐标差超出有限计算范围");
                    }
                }
                else
                {
                    var input = e.X1!.CreateFacingInput(e.Id, e.PerformerId);
                    var check = X1InputValidation.ValidateFacing(input);
                    if (!check.Ok) return check;
                    if (e.DurationMs <= 0) return (false, "独立朝向必须有正持续时间");
                    if (input.FacingMode == X1FacingMode.StageCenter) local.Stage.ToWorld(input.StageCenterX!.Value, input.StageCenterZ!.Value);
                    if (input.FacingMode == X1FacingMode.OtherActor)
                    {
                        var target = package.X1.Bindings.SingleOrDefault(b => b.PerformerId == input.OtherActorTargetId);
                        if (target == null || target.PerformerId == local.PerformerId || target.TerritoryId != local.TerritoryId || !target.Stage.SameFrame(local.Stage))
                            return (false, "他演员朝向需要另一位明确角色，并且区域和完整舞台坐标绑定一致");
                    }
                    if (input.FacingMode == X1FacingMode.AlongPath && !package.Events.Any(m => m.Kind == "movement"
                        && m.StartMs <= e.StartMs && m.StartMs + m.DurationMs >= e.StartMs + e.DurationMs))
                        return (false, "沿路径朝向必须有完整覆盖其时段的明确路径");
                }
            }
            catch (Exception ex) { return (false, "X1 事件「" + e.Id + "」准备失败：" + ex.Message); }
        }
        var paths = package.Events.Where(e => e.Kind == "movement").OrderBy(e => e.StartMs).ToArray();
        for (var i = 1; i < paths.Length; i++)
            if (Overlaps(paths[i - 1], paths[i])) return (false, "本机不能同时执行重叠路径");
        if (ownsMovementFacing)
            foreach (var path in paths)
                if (package.Events.Any(e => e.Kind == "facing" && Overlaps(path, e)))
                    return (false, "当前四键模式先转向再走，路径不能与独立朝向重叠");
        return (true, "");
    }

    private static bool Overlaps(ShowEvent a, ShowEvent b) => a.DurationMs > 0 && b.DurationMs > 0
        && a.StartMs < b.StartMs + b.DurationMs && b.StartMs < a.StartMs + a.DurationMs;
    internal static void RejectDuplicateProperties(JsonElement value, string label)
    {
        var seen = new HashSet<string>(StringComparer.Ordinal);
        foreach (var p in value.EnumerateObject()) if (!seen.Add(p.Name)) throw Bad(label + "存在重复字段「" + p.Name + "」");
    }
    internal static void CheckProperties(JsonElement value, string label, params string[] allowed)
    {
        if (value.ValueKind != JsonValueKind.Object) throw Bad(label + "必须是对象");
        RejectDuplicateProperties(value, label);
        foreach (var p in value.EnumerateObject()) if (!allowed.Contains(p.Name, StringComparer.Ordinal))
            throw Bad(label + "存在未知字段「" + p.Name + "」");
    }
    private static void CheckVersion(JsonElement value)
    { if (Integer(value, "version", 1, int.MaxValue) != Version) throw Bad("不支持该 X1 输入版本，请更新插件或重新编译"); }
    private static JsonElement Required(JsonElement value, string name)
    { if (!value.TryGetProperty(name, out var result)) throw Bad("X1 缺少显式字段「" + name + "」"); return result; }
    private static string Text(JsonElement value, string name)
    {
        var result = Required(value, name);
        if (result.ValueKind != JsonValueKind.String || !IsIdentity(result.GetString()))
            throw Bad("X1 字段「" + name + "」须为 1 至 256 字符的非空字符串且不含控制字符");
        return result.GetString()!;
    }
    internal static bool IsIdentity(string? value)
        => !string.IsNullOrWhiteSpace(value) && value.Length <= 256 && !value.Any(c => c < 0x20);
    private static string CanonicalId(JsonElement value, string name, ulong max)
    {
        var text = Text(value, name);
        if (text[0] == '0' || !ulong.TryParse(text, NumberStyles.None, CultureInfo.InvariantCulture, out var number)
            || number == 0 || number > max || number.ToString(CultureInfo.InvariantCulture) != text)
            throw Bad("X1 字段「" + name + "」必须是明确、规范十进制正整数标识");
        return text;
    }
    private static long Integer(JsonElement value, string name, long min, long max)
    {
        var result = Required(value, name);
        if (result.ValueKind != JsonValueKind.Number || !result.TryGetInt64(out var number) || number < min || number > max)
            throw Bad("X1 字段「" + name + "」必须是范围内整数");
        return number;
    }
    private static double Number(JsonElement value, string name)
    {
        var result = Required(value, name);
        if (result.ValueKind != JsonValueKind.Number || !result.TryGetDouble(out var number) || !double.IsFinite(number))
            throw Bad("X1 字段「" + name + "」必须是有限数值");
        return number;
    }
    private static ArgumentException Bad(string error) => new(error);
}
