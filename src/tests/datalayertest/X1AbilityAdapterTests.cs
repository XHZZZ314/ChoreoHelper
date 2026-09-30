// 这个文件是干嘛的：X1 技能适配器命名回归（TASK-20260912-X1-ABILITY-ADAPTER r3）——
// x1-ability-adapter（live 观测/写入边界身份文法与运行代复核/生产接线源契约/取消重演）、
// x1-foreground-refresh（前台句柄刷新/持态）、x1-adapter-contract（受保护基线/AC-4 收紧/设计表在场）。
// 三个命名用例与全量套件共用同一批断言；--red 仅抑制 OK 输出。失败打印哨兵行恰一次并退出 1
//（record-red 绑定 REG-ABILITY / REG-FOREGROUND / REG-REPAIR；x1-adapter-contract 为特征套件，
// 失败退出 1 不发哨兵——无红基线声明）。
// 纯离线：技能槽/前台策略皆经注入假件驱动真实生产类型；Dalamud 绑定件不进本套件。
// 假时钟纪律：Start(0) 后首帧 Tick 只做倒计时→Playing 转换（不分发），到点分发在其后一帧。
using System;
using System.Collections.Generic;
using System.IO;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using ChoreoHelper;

internal static class X1AbilityAdapterCases
{
    public static int RunNamed(string caseName, bool red)
    {
        var fails = 0;
        void CheckNamed(string name, bool cond, string? detail = null)
        {
            if (cond) { if (!red) Console.WriteLine($"  OK  {name}"); }
            else { fails++; Console.WriteLine($"  FAIL {name} {detail}"); }
        }
        Console.WriteLine($"== X1 技能适配器（{caseName}{(red ? " --red" : "")}） ==");
        switch (caseName)
        {
            case "x1-ability-adapter":
                RunAbilityAdapterCase(CheckNamed);
                break;
            case "x1-foreground-refresh":
                RunForegroundCase(CheckNamed);
                break;
            case "x1-adapter-contract":
                RunAdapterContractCase(CheckNamed);
                break;
            default:
                Console.WriteLine($"未知命名用例：{caseName}");
                return 2;
        }
        Console.WriteLine($"结果：{caseName} {fails} 项失败");
        if (fails > 0)
        {
            if (caseName == "x1-ability-adapter") Console.WriteLine("X1_ABILITY_ADAPTER_ASSERTION");
            else if (caseName == "x1-foreground-refresh") Console.WriteLine("X1_FOREGROUND_REFRESH_ASSERTION");
            return 1;
        }
        return 0;
    }

    // ==================== x1-ability-adapter ====================
    public static void RunAbilityAdapterCase(CheckFn check)
    {
        RunLegacyMode(check);
        RunLiveMode(check);
        RunSevenConditionMatrix(check);
        RunLiveMalformedInputs(check);
        RunWriteBoundary(check);
        RunProductionTransport(check);
        RunLifecycle(check);
    }

    private static bool HasChinese(string s) => !string.IsNullOrEmpty(s) && s.Any(ch => ch >= 0x4E00 && ch <= 0x9FFF);

    private static X1AbilityConditions AllTrue() => new()
    {
        JobMatches = true, LevelMeets = true, TargetValid = true, NotCasting = true,
        CooldownReady = true, MovementAllowed = true, Controllable = true,
    };

    private static X1AbilityInput LiveInput(string id = "a-live", X1FailurePolicy policy = X1FailurePolicy.Skip, string actionId = "重斩") =>
        new() { EventId = id, PerformerId = "p1", ActionId = actionId, RequiredJob = "战士", RequiredLevel = 90, FailurePolicy = policy };

    /// <summary>可脚本化 live 供给：返回供给闭包与调用计数读取器（「恰读一次」的可观测口）。</summary>
    private static (Func<X1AbilityConditions?> Provide, Func<int> Calls) ScriptedSupply(Func<X1AbilityConditions?> value)
    {
        var calls = 0;
        return (() => { calls++; return value(); }, () => calls);
    }

    private sealed class RecAbilitySink : IX1AbilitySink
    {
        public readonly List<(string ActionId, string Target)> Calls = new();
        public bool Result = true;
        public Exception? ThrowOnSubmit;

        public bool Submit(string actionId, string target)
        {
            Calls.Add((actionId, target));
            if (ThrowOnSubmit != null) throw ThrowOnSubmit;
            return Result;
        }
    }

    /// <summary>生产形状槽假件：提交直通写入边界；并实现运行代见证（与生产 X1GameAbilityAdapters
    /// 同形），供 X1ShowDispatcher 生命周期钩子（OnStop/OnShowStart）失效旧代。</summary>
    private sealed class BoundarySink : IX1AbilitySink, IX1AbilityGenerationGuard
    {
        private readonly X1AbilityWriteBoundary _boundary;
        public BoundarySink(X1AbilityWriteBoundary boundary) { _boundary = boundary; }
        public bool Submit(string actionId, string target) => _boundary.TrySubmit(actionId, target);
        public void InvalidateGeneration() => _boundary.InvalidateGeneration();
    }

    private static ShowEvent AbEvent(string id, long startMs = 0) =>
        new() { Id = id, Kind = "ability", StartMs = startMs, DurationMs = 100, PerformerId = "p1" };

    /// <summary>生命周期夹具用空移动槽：无移动事件，仅为 X1ShowDispatcher.UpdateActive 满足
    /// 槽在场要求（缺槽本身会故障停）。</summary>
    private sealed class NullMoveSink : IX1MovementSink
    {
        public void EmitCorrection(string eventId, double dx, double dz, double targetX, double targetZ, long showTimeMs) { }
        public void ReleaseMovement(string eventId) { }
    }

    private sealed class NullFaceSink : IX1FacingSink
    {
        public void EmitFacing(string eventId, double angleDeg, long showTimeMs) { }
        public void ReleaseFacing(string eventId) { }
    }

    // ---- legacy 登记模式：既有行为一条不变（引用语义 / 缺槽 / 提交形状） ----
    private static void RunLegacyMode(CheckFn check)
    {
        var sink = new RecAbilitySink();
        var x1 = new X1ShowDispatcher("p1") { AbilitySink = sink };
        var conds = AllTrue();
        check("[ab-legacy] 登记条件分发恰一次提交（显式动作/目标）",
            x1.AddAbility(LiveInput("a-1"), conds, "舞伴甲").Ok
            && x1.Dispatch(AbEvent("a-1")).Ok
            && sink.Calls.Count == 1 && sink.Calls[0].ActionId == "重斩" && sink.Calls[0].Target == "舞伴甲",
            sink.Calls.Count.ToString());

        // 引用语义（QA 修正事实：AddAbility 存条件对象引用，不做深快照）
        conds.JobMatches = false;
        var r2 = x1.Dispatch(AbEvent("a-1"));
        check("[ab-legacy] 登记后条件改 false → Skip 跳过零提交（标记不满足）",
            r2.Ok && r2.Skipped && r2.SkipMarking == "不满足" && r2.SkipClass == "ability-condition" && sink.Calls.Count == 1,
            $"{r2.Ok}/{r2.SkipMarking}/{sink.Calls.Count}");

        var sinkB = new RecAbilitySink();
        var x1b = new X1ShowDispatcher("p1") { AbilitySink = sinkB };
        var condsB = AllTrue();
        condsB.JobMatches = false;
        x1b.AddAbility(LiveInput("a-2"), condsB, "舞伴甲");
        condsB.JobMatches = true;
        check("[ab-legacy] 登记 false 后改为 true → 恰一次提交",
            x1b.Dispatch(AbEvent("a-2")).Ok && sinkB.Calls.Count == 1, sinkB.Calls.Count.ToString());

        var sinkC = new RecAbilitySink();
        var x1c = new X1ShowDispatcher("p1") { AbilitySink = sinkC };
        x1c.AddAbility(LiveInput("a-3"), AllTrue(), "舞伴甲");
        x1c.AbilitySink = null;
        var r3 = x1c.Dispatch(AbEvent("a-3"));
        check("[ab-legacy] 缺槽 Fail 不可跳过（Skip 策略同样故障）零写",
            !r3.Ok && !r3.Skipped && HasChinese(r3.Reason) && sinkC.Calls.Count == 0, r3.Reason);
    }

    // ---- 显式 live 观测模式：分发到期恰读一次；缺失/异常/null 不可跳过；绝不回退 ----
    private static void RunLiveMode(CheckFn check)
    {
        var sink = new RecAbilitySink();
        var x1 = new X1ShowDispatcher("p1") { AbilitySink = sink };
        var (supply, calls) = ScriptedSupply(() => AllTrue());
        check("[ab-live] live 登记成功",
            x1.AddAbilityLive(LiveInput(), supply, "舞伴甲").Ok);
        var r = x1.Dispatch(AbEvent("a-live"));
        check("[ab-live] all-true 供给 → 恰一次提交（显式动作/目标原样）",
            r.Ok && !r.Skipped && sink.Calls.Count == 1 && sink.Calls[0].ActionId == "重斩" && sink.Calls[0].Target == "舞伴甲",
            $"{r.Ok}/{sink.Calls.Count}");
        check("[ab-live] 供给每次分发恰读一次", calls() == 1, calls().ToString());

        // 同 id 先 legacy 后 live：live 生效，绝不回退登记条件（legacy 对象再改也无效）
        var sink2 = new RecAbilitySink();
        var x12 = new X1ShowDispatcher("p1") { AbilitySink = sink2 };
        var stale = AllTrue();
        stale.JobMatches = false;
        x12.AddAbility(LiveInput("a-mix"), stale, "舞伴甲");
        var (supply2, calls2) = ScriptedSupply(() => AllTrue());
        x12.AddAbilityLive(LiveInput("a-mix"), supply2, "舞伴甲");
        var rMix = x12.Dispatch(AbEvent("a-mix"));
        check("[ab-live] live 登记覆盖同 id legacy（不回退登记条件）",
            rMix.Ok && sink2.Calls.Count == 1 && calls2() == 1, $"{rMix.Ok}/{sink2.Calls.Count}/{calls2()}");

        // live 失败绝不回退：供给抛异常 / 返回 null 在 Skip 与 StopShow 双策略下皆不可跳过
        foreach (var policy in new[] { X1FailurePolicy.Skip, X1FailurePolicy.StopShow })
        {
            var tag = policy == X1FailurePolicy.Skip ? "Skip" : "StopShow";
            var s1 = new RecAbilitySink();
            var d1 = new X1ShowDispatcher("p1") { AbilitySink = s1 };
            d1.AddAbilityLive(LiveInput("a-th", policy), () => throw new InvalidOperationException("观测炸了"), "舞伴甲");
            var r1 = d1.Dispatch(AbEvent("a-th"));
            check($"[ab-live] 供给抛异常 {tag} → Fail 不可跳过零提交",
                !r1.Ok && !r1.Skipped && r1.Reason.Contains("实时条件观测异常") && s1.Calls.Count == 0, r1.Reason);

            var s2 = new RecAbilitySink();
            var d2 = new X1ShowDispatcher("p1") { AbilitySink = s2 };
            d2.AddAbilityLive(LiveInput("a-nl", policy), () => null, "舞伴甲");
            var r2 = d2.Dispatch(AbEvent("a-nl"));
            check($"[ab-live] 供给返回 null {tag} → Fail 不可跳过零提交",
                !r2.Ok && !r2.Skipped && r2.Reason.Contains("条件对象为空") && s2.Calls.Count == 0, r2.Reason);
        }
        check("[ab-live] 缺失供给登记被拒（live 模式必须显式供给）",
            !new X1ShowDispatcher("p1").AddAbilityLive(LiveInput("a-ns"), null!, "舞伴甲").Ok);
    }

    // ---- 七条件矩阵：每字段独立 false/null × Skip/StopShow；首失败冻结序与中文标记 ----
    private static void RunSevenConditionMatrix(CheckFn check)
    {
        string[] names = { "JobMatches", "LevelMeets", "TargetValid", "NotCasting", "CooldownReady", "MovementAllowed", "Controllable" };
        foreach (var policy in new[] { X1FailurePolicy.Skip, X1FailurePolicy.StopShow })
        {
            var tag = policy == X1FailurePolicy.Skip ? "Skip" : "StopShow";
            for (var i = 0; i < names.Length; i++)
            {
                var idx = i;
                // false 行：唯一不满足项
                var sF = new RecAbilitySink();
                var dF = new X1ShowDispatcher("p1") { AbilitySink = sF };
                dF.AddAbilityLive(LiveInput("a-f" + i, policy), () =>
                {
                    var c = AllTrue();
                    SetCond(c, idx, false);
                    return c;
                }, "舞伴甲");
                var rF = dF.Dispatch(AbEvent("a-f" + i));
                if (policy == X1FailurePolicy.Skip)
                    check($"[ab-cond] {names[idx]}=false {tag} → 跳过零提交（标记不满足）",
                        rF.Ok && rF.Skipped && rF.SkipClass == "ability-condition" && rF.SkipMarking == "不满足" && sF.Calls.Count == 0,
                        $"{rF.Ok}/{rF.SkipMarking}/{sF.Calls.Count}");
                else
                    check($"[ab-cond] {names[idx]}=false {tag} → 故障停零提交",
                        !rF.Ok && !rF.Skipped && sF.Calls.Count == 0, $"{rF.Ok}/{sF.Calls.Count}");
                // null（未知）行：唯一未知项
                var sN = new RecAbilitySink();
                var dN = new X1ShowDispatcher("p1") { AbilitySink = sN };
                dN.AddAbilityLive(LiveInput("a-n" + i, policy), () =>
                {
                    var c = AllTrue();
                    SetCond(c, idx, null);
                    return c;
                }, "舞伴甲");
                var rN = dN.Dispatch(AbEvent("a-n" + i));
                if (policy == X1FailurePolicy.Skip)
                    check($"[ab-cond] {names[idx]}=null {tag} → 跳过零提交（标记未知）",
                        rN.Ok && rN.Skipped && rN.SkipClass == "ability-condition" && rN.SkipMarking == "未知" && sN.Calls.Count == 0,
                        $"{rN.Ok}/{rN.SkipMarking}/{sN.Calls.Count}");
                else
                    check($"[ab-cond] {names[idx]}=null {tag} → 故障停零提交",
                        !rN.Ok && !rN.Skipped && sN.Calls.Count == 0, $"{rN.Ok}/{sN.Calls.Count}");
            }
        }

        // 首失败冻结序（错误/标记取同一次扫描首个未满足项，不二次复扫）
        void Row(string name, Action<X1AbilityConditions> set, string expectReasonPart, string expectMarking)
        {
            var s = new RecAbilitySink();
            var d = new X1ShowDispatcher("p1") { AbilitySink = s };
            d.AddAbilityLive(LiveInput("a-ord"), () => { var c = AllTrue(); set(c); return c; }, "舞伴甲");
            var r = d.Dispatch(AbEvent("a-ord"));
            check("[ab-order] " + name, r.Ok && r.Skipped && r.Reason.Contains(expectReasonPart) && r.SkipMarking == expectMarking && s.Calls.Count == 0,
                $"{r.Reason}/{r.SkipMarking}");
        }
        Row("全 false → 职业不匹配首失败", SetAllFalse, "职业不匹配", "不满足");
        Row("全 null → 职业未知首失败", SetAllNull, "职业未知", "未知");
        Row("职业真其余 false → 等级不足次序", c => { SetAllFalse(c); c.JobMatches = true; }, "等级不足", "不满足");
        Row("冷却未知压过其后移动 false（null 先于后项 false）", c => { SetAllFalse(c); c.JobMatches = true; c.LevelMeets = true; c.TargetValid = true; c.NotCasting = true; c.CooldownReady = null; }, "冷却未知", "未知");
        Row("移动 false 压过其后可控 false", c => { SetAllFalse(c); c.JobMatches = true; c.LevelMeets = true; c.TargetValid = true; c.NotCasting = true; c.CooldownReady = true; }, "移动中不可执行", "不满足");
        Row("末位可控性未知", c => { SetAllFalse(c); c.JobMatches = true; c.LevelMeets = true; c.TargetValid = true; c.NotCasting = true; c.CooldownReady = true; c.MovementAllowed = true; c.Controllable = null; }, "可控性未知", "未知");
    }

    private static void SetCond(X1AbilityConditions c, int idx, bool? v)
    {
        switch (idx)
        {
            case 0: c.JobMatches = v; break;
            case 1: c.LevelMeets = v; break;
            case 2: c.TargetValid = v; break;
            case 3: c.NotCasting = v; break;
            case 4: c.CooldownReady = v; break;
            case 5: c.MovementAllowed = v; break;
            case 6: c.Controllable = v; break;
        }
    }

    private static void SetAllFalse(X1AbilityConditions c)
    {
        c.JobMatches = false; c.LevelMeets = false; c.TargetValid = false; c.NotCasting = false;
        c.CooldownReady = false; c.MovementAllowed = false; c.Controllable = false;
    }

    private static void SetAllNull(X1AbilityConditions c)
    {
        c.JobMatches = null; c.LevelMeets = null; c.TargetValid = null; c.NotCasting = null;
        c.CooldownReady = null; c.MovementAllowed = null; c.Controllable = null;
    }

    // ---- 畸形输入：登记期冻结校验 + 分发期冻结失败语义，零写 ----
    private static void RunLiveMalformedInputs(CheckFn check)
    {
        var d = new X1ShowDispatcher("p1");
        check("[ab-input] 空事件标识登记拒绝", !d.AddAbilityLive(new X1AbilityInput { EventId = "", PerformerId = "p1", ActionId = "重斩" }, () => AllTrue(), "t").Ok);
        check("[ab-input] 空白动作标识登记拒绝", !d.AddAbilityLive(new X1AbilityInput { EventId = "a", PerformerId = "p1", ActionId = " " }, () => AllTrue(), "t").Ok);
        check("[ab-input] 演员不匹配登记拒绝", !d.AddAbilityLive(new X1AbilityInput { EventId = "a", PerformerId = "p2", ActionId = "重斩" }, () => AllTrue(), "t").Ok);
        check("[ab-input] Wait 策略登记拒绝", !d.AddAbilityLive(new X1AbilityInput { EventId = "a", PerformerId = "p1", ActionId = "重斩", FailurePolicy = X1FailurePolicy.Wait }, () => AllTrue(), "t").Ok);
        check("[ab-input] 未知失败策略登记拒绝", !d.AddAbilityLive(new X1AbilityInput { EventId = "a", PerformerId = "p1", ActionId = "重斩", FailurePolicy = (X1FailurePolicy)99 }, () => AllTrue(), "t").Ok);
        check("[ab-input] 负等级登记拒绝", !d.AddAbilityLive(new X1AbilityInput { EventId = "a", PerformerId = "p1", ActionId = "重斩", RequiredLevel = -1 }, () => AllTrue(), "t").Ok);

        // 缺显式目标：冻结失败语义（不可跳过 Fail），零写；Skip/StopShow 双策略
        foreach (var policy in new[] { X1FailurePolicy.Skip, X1FailurePolicy.StopShow })
        {
            var tag = policy == X1FailurePolicy.Skip ? "Skip" : "StopShow";
            var s = new RecAbilitySink();
            var dd = new X1ShowDispatcher("p1") { AbilitySink = s };
            dd.AddAbilityLive(LiveInput("a-nt", policy), () => AllTrue(), "");
            var r = dd.Dispatch(AbEvent("a-nt"));
            check($"[ab-input] 缺显式目标 {tag} → Fail 不可跳过零提交",
                !r.Ok && !r.Skipped && r.Reason.Contains("缺少显式目标") && s.Calls.Count == 0, r.Reason);
        }

        // 槽拒绝/槽异常：冻结映射语义，恰一次调用
        var sR = new RecAbilitySink { Result = false };
        var dR = new X1ShowDispatcher("p1") { AbilitySink = sR };
        dR.AddAbilityLive(LiveInput("a-rj"), () => AllTrue(), "舞伴甲");
        var rR = dR.Dispatch(AbEvent("a-rj"));
        check("[ab-input] 槽拒绝 → Fail（SinkRejected 语义）恰一次调用",
            !rR.Ok && sR.Calls.Count == 1, rR.Reason);
        var sX = new RecAbilitySink { ThrowOnSubmit = new InvalidOperationException("槽炸了") };
        var dX = new X1ShowDispatcher("p1") { AbilitySink = sX };
        dX.AddAbilityLive(LiveInput("a-ex"), () => AllTrue(), "舞伴甲");
        var rX = dX.Dispatch(AbEvent("a-ex"));
        check("[ab-input] 槽异常 → Fail（SinkException 语义）不逃逸",
            !rX.Ok && rX.Reason.Contains("记录槽异常"), rX.Reason);
    }

    // ---- 写入边界（X1AbilityWriteBoundary，注入读取/解析/原生写入）：M3 规范身份文法、
    //      M2 运行代/取消见证（每次可重入读取后与原生写入前复核）、恰一次同步写入 ----
    private static void RunWriteBoundary(CheckFn check)
    {
        var calls = 0;
        var commands = new List<string>();
        bool Writer(string cmd) { calls++; commands.Add(cmd); return true; }
        string? Resolver(int rowId) => rowId == 3387 ? "重斩" : rowId == 3386 ? "" : null;
        Func<int, string?> resolver = Resolver;
        bool? pvp = false;
        ulong? currentTargetId = 2001;
        bool invalidateOnResolver = false, invalidateOnPvp = false, invalidateOnTarget = false;
        var onThread = true;
        var boundary = default(X1AbilityWriteBoundary)!;
        boundary = new X1AbilityWriteBoundary(
            () => { if (invalidateOnPvp) boundary.InvalidateGeneration(); return pvp; },
            () => { if (invalidateOnTarget) boundary.InvalidateGeneration(); return currentTargetId; },
            () => onThread,
            id => { if (invalidateOnResolver) boundary.InvalidateGeneration(); return resolver(id); },
            Writer);
        // 拒绝判定基线：护栏拒绝必须零写——相对当前计数不变（与此前放行次数无关）。
        bool Deny(string a, string t) { var before = calls; return !boundary.TrySubmit(a, t) && calls == before; }
        bool Allow(string a, string t) { var before = calls; return boundary.TrySubmit(a, t) && calls == before + 1; }
        bool DenyOn(X1AbilityWriteBoundary b, string a, string t) { var before = calls; return !b.TrySubmit(a, t) && calls == before; }

        // M3 正路：规范行 id + 规范目标 id → 恰一次同步写入；命令携带行解析出的本地名，id 不入命令文本
        check("[ab-boundary] 正路：行 3387+目标 2001 → 恰一次写，命令 /ac \"重斩\" <t>（id 不入命令文本）",
            Allow("3387", "2001") && commands[^1] == "/ac \"重斩\" <t>",
            commands.Count > 0 ? commands[^1] : "零写入");

        // M3 身份文法：规范十进制（仅 ASCII 数字；无符号/前导零/空白/其他字符；越界=畸形）
        string[] badAction = { "", " ", " 3387", "3387 ", "+3387", "-1", "03387", "33八7", "3387a", "3\n387", "3\t387", "3\03387", "3;387", "3\"387", "2147483648", "99999999999999999999" };
        var badOk = true;
        foreach (var id in badAction) badOk &= !X1AbilityWriteBoundary.TryParseActionRowId(id, out _);
        check("[ab-boundary] 动作行 id 文法负行（空白/符号/前导零/非数字/控制/引号/分号/int 越界）", badOk);
        string[] badTarget = { "", " ", " 2001", "2001 ", "+2001", "-2001", "02001", "20 01", "20\t01", "20\n01", "2001;", "2001\"", "18446744073709551616" };
        badOk = true;
        foreach (var t in badTarget) badOk &= !X1AbilityWriteBoundary.TryParseTargetId(t, out _);
        check("[ab-boundary] 目标 id 文法负行（空白/符号/前导零/内嵌空白/控制/引号/分号/ulong 越界）", badOk);
        check("[ab-boundary] 文法正界：\"0\"/int 上界为合法动作行 id；ulong 上界为合法目标 id",
            X1AbilityWriteBoundary.TryParseActionRowId("0", out var r0) && r0 == 0
            && X1AbilityWriteBoundary.TryParseActionRowId("2147483647", out var rMax) && rMax == int.MaxValue
            && X1AbilityWriteBoundary.TryParseTargetId("18446744073709551615", out var tMax) && tMax == ulong.MaxValue);

        // 行解析（可重入读取）：未知行/空名行/解析异常 → 零写；绝不搜索、绝不替换请求动作
        check("[ab-boundary] 未知动作行 → 零写", Deny("3388", "2001"));
        check("[ab-boundary] 空名动作行 → 零写（非支持行）", Deny("3386", "2001"));
        resolver = _ => throw new InvalidOperationException("动作行解析炸了");
        check("[ab-boundary] 行解析异常 → 零写（异常不逃逸出护栏）", Deny("3387", "2001"));
        resolver = Resolver;

        // 目标一致（仅按 GameObjectId 相等；同显示名不同 id 必败）：读不到/不同 id/读取异常 → 零写
        currentTargetId = null;
        check("[ab-boundary] 当前目标读不到 → 零写", Deny("3387", "2001"));
        currentTargetId = 2999;
        check("[ab-boundary] 目标改变（同显示名不同 id）→ 零写（绝不替换、绝不搜索）", Deny("3387", "2001"));
        currentTargetId = 2001;
        var boundaryTargetThrow = new X1AbilityWriteBoundary(
            () => pvp, () => throw new InvalidOperationException("目标读取炸了"), () => onThread, Resolver, Writer);
        check("[ab-boundary] 目标读取异常 → 零写", DenyOn(boundaryTargetThrow, "3387", "2001"));

        // PvP/safety fail-closed：真/未知（null）/观测异常 → 零写
        pvp = true;
        check("[ab-boundary] PvP 真 → 零写", Deny("3387", "2001"));
        pvp = null;
        check("[ab-boundary] PvP 未知 → 零写", Deny("3387", "2001"));
        pvp = false;
        var boundaryPvpThrow = new X1AbilityWriteBoundary(
            () => throw new InvalidOperationException("PvP 观测炸了"), () => currentTargetId, () => onThread, Resolver, Writer);
        check("[ab-boundary] PvP 观测异常 → 零写", DenyOn(boundaryPvpThrow, "3387", "2001"));

        // 线程门：非框架线程/门异常 → 零写
        onThread = false;
        check("[ab-boundary] 非框架线程 → 零写", Deny("3387", "2001"));
        onThread = true;
        var boundaryThreadThrow = new X1AbilityWriteBoundary(
            () => pvp, () => currentTargetId, () => throw new InvalidOperationException("线程门炸了"), Resolver, Writer);
        check("[ab-boundary] 线程门异常 → 零写", DenyOn(boundaryThreadThrow, "3387", "2001"));

        // M2 运行代/取消见证：任一可重入读取内失效旧代 → 该次提交零写；新提交（新代快照）放行
        invalidateOnResolver = true;
        check("[ab-boundary] 动作行解析读取内失效旧代 → 零写（读取后代复核）", Deny("3387", "2001"));
        invalidateOnResolver = false;
        invalidateOnPvp = true;
        check("[ab-boundary] PvP 读取内失效旧代 → 零写（读取后代复核）", Deny("3387", "2001"));
        invalidateOnPvp = false;
        invalidateOnTarget = true;
        check("[ab-boundary] 最终目标读取器内失效旧代 → 零写（原生写入前最后复核）", Deny("3387", "2001"));
        invalidateOnTarget = false;
        check("[ab-boundary] 失效后新提交放行（重演/恢复=新代重新观测，旧代待写不可复活）", Allow("3387", "2001"));

        // 写入器 false/异常：原样透传（执行器冻结映射 SinkRejected/SinkException），恰一次调用
        var refused = 0;
        bool Refusing(string cmd) { refused++; return false; }
        var boundaryRefuse = new X1AbilityWriteBoundary(
            () => pvp, () => currentTargetId, () => onThread, Resolver, Refusing);
        check("[ab-boundary] 原生写入器拒绝 → false 透传且恰一次调用", !boundaryRefuse.TrySubmit("3387", "2001") && refused == 1);
        var thrown = 0;
        bool Exploding(string cmd) { thrown++; throw new InvalidOperationException("原生写入炸了"); }
        var boundaryExplode = new X1AbilityWriteBoundary(
            () => pvp, () => currentTargetId, () => onThread, Resolver, Exploding);
        var escaped = false;
        try { boundaryExplode.TrySubmit("3387", "2001"); }
        catch (InvalidOperationException) { escaped = true; }
        check("[ab-boundary] 原生写入异常 → 原样上抛（执行器映射 SinkException）恰一次调用", escaped && thrown == 1);

        // 命令构造：仅解析出的本地名入文 + 固定 <t> 占位；目标标识永不进命令文本（无注入面）
        check("[ab-boundary] 命令构造含显式动作名与固定 <t>（目标不入命令）",
            X1AbilityAdapterPolicy.BuildChatCommand("重斩") == "/ac \"重斩\" <t>"
            && X1AbilityAdapterPolicy.BuildChatCommand("Fire III") == "/ac \"Fire III\" <t>"
            && !X1AbilityAdapterPolicy.BuildChatCommand("重斩").Contains("2001"));
    }

    // ---- 生产接线源级契约（Dalamud 绑定件不进套件 → 源级断言）：M1 同步边界、不入队、共享节流 ----
    private static void RunProductionTransport(CheckFn check)
    {
        var root = FindRepoRoot();
        check("[ab-src] 仓库根可定位", root != null, root ?? "null");
        if (root == null) return;
        var adapters = File.ReadAllText(Path.Combine(root, "src", "X1AbilityAdapters.cs"));
        var executor = File.ReadAllText(Path.Combine(root, "src", "GameCommandExecutor.cs"));
        check("[ab-src] 技能槽写入走 GameCommandExecutor 同步边界入口（SubmitX1Synchronous）",
            adapters.Contains("SubmitX1Synchronous("));
        check("[ab-src] 技能槽不再走遗留入队路径（零 ExecuteCommand 调用）",
            !adapters.Contains("ExecuteCommand("));
        var sync = SliceMethod(executor, "public bool SubmitX1Synchronous");
        check("[ab-src] GameCommandExecutor 具备 X1 专用同步提交入口", sync != null);
        if (sync == null) return;
        check("[ab-src] 同步入口先过聊天道安全闸（ChatCommandPolicy.TryValidate）", sync.Contains("ChatCommandPolicy.TryValidate"));
        check("[ab-src] 同步入口原生前置缺失即刻拒绝（IsAvailable）", sync.Contains("IsAvailable"));
        check("[ab-src] 同步入口共享 200ms 节流基准（AllowNow/OnExecuted），busy 即刻拒绝不入队不重排",
            sync.Contains("_throttle.AllowNow") && sync.Contains("_throttle.OnExecuted") && !sync.Contains("_commandQueue"));
        check("[ab-src] 同步入口在本调用内完成原生写入（ExecuteNative 同步调用）", sync.Contains("ExecuteNative("));
    }

    /// <summary>按方法签名切片源文本（自签名起至下一个同缩进成员声明前），供源级契约断言。</summary>
    private static string? SliceMethod(string text, string signature)
    {
        var start = text.IndexOf(signature, StringComparison.Ordinal);
        if (start < 0) return null;
        var end = text.Length;
        foreach (var kw in new[] { "\n    public", "\n    private", "\n    internal" })
        {
            var i = text.IndexOf(kw, start + signature.Length, StringComparison.Ordinal);
            if (i >= 0 && i < end) end = i;
        }
        return text[start..end];
    }

    // ---- 生命周期：重复 tick / 重演 / 调度序 / 零重试 / 停止三时点 / 故障恢复（假时钟） ----
    private static void RunLifecycle(CheckFn check)
    {
        // 同一到期事件重复不变 tick 恰一次提交；供给恰读一次；Arm+Start 重演重新观测
        {
            var sink = new RecAbilitySink();
            var x1 = new X1ShowDispatcher("p1") { AbilitySink = sink };
            var (supply, calls) = ScriptedSupply(() => AllTrue());
            x1.AddAbilityLive(LiveInput("a-t"), supply, "舞伴甲");
            var pkg = new ShowPackage { ProtocolVersion = 1, Name = "t", DurationMs = 5000 };
            pkg.Events.Add(AbEvent("a-t", 500));
            long t = 0;
            var runner = new ShowRunner(x1, () => t);
            runner.SetGuardProvider(() => new GuardSnapshot());
            runner.Load(pkg); runner.Arm(); runner.Start(0);
            runner.Tick(); // 倒计时 0 → Playing 转换帧（不分发）
            check("[ab-tick] 未到不分发", runner.State == ShowState.Playing && sink.Calls.Count == 0);
            t += 500; runner.Tick();
            check("[ab-tick] 到期恰一次提交", sink.Calls.Count == 1 && calls() == 1, $"{sink.Calls.Count}/{calls()}");
            t += 100; runner.Tick();
            t += 100; runner.Tick();
            check("[ab-tick] 重复不变 tick 零再提交零再观测", sink.Calls.Count == 1 && calls() == 1,
                $"{sink.Calls.Count}/{calls()}");
            for (var i = 0; i < 10; i++) { t += 1000; runner.Tick(); } // 分帧推进（单帧跨度大会触守卫）
            check("[ab-tick] 演出完成", runner.State == ShowState.Completed, runner.State.ToString());
            check("[ab-tick] 完成后直接 Start 被拒", !runner.Start().Ok);
            runner.Arm(); runner.Start(0);
            runner.Tick(); // 转换帧
            t += 500; runner.Tick();
            check("[ab-tick] 重演重新观测（供给再读）恰一次新提交", sink.Calls.Count == 2 && calls() == 2,
                $"{sink.Calls.Count}/{calls()}");
        }
        // 两条同刻事件按调度序（ability 先于 motion）
        {
            var x1 = new X1ShowDispatcher("p1") { AbilitySink = new RecAbilitySink() };
            x1.AddAbilityLive(LiveInput("a-p"), () => AllTrue(), "舞伴甲");
            var pkg = new ShowPackage { ProtocolVersion = 1, Name = "t", DurationMs = 5000 };
            pkg.Events.Add(new ShowEvent { Id = "m-p", Kind = "motion", StartMs = 500, DurationMs = 100, Command = "/bow motion", PerformerId = "p1" });
            pkg.Events.Add(AbEvent("a-p", 500));
            long t = 0;
            var runner = new ShowRunner(x1, () => t);
            runner.SetGuardProvider(() => new GuardSnapshot());
            runner.Load(pkg); runner.Arm(); runner.Start(0);
            runner.Tick(); // 转换帧
            t += 500; runner.Tick();
            var ids = x1.Dispatched.ConvertAll(e => e.Id);
            check("[ab-tick] 同刻按调度序（ability 先于 motion）", ids.IndexOf("a-p") >= 0 && ids.IndexOf("a-p") < ids.IndexOf("m-p"),
                string.Join(",", ids));
        }
        // Skip 跳过后零重试零再观测
        {
            var x1 = new X1ShowDispatcher("p1") { AbilitySink = new RecAbilitySink() };
            var (supply, calls) = ScriptedSupply(() => new X1AbilityConditions { JobMatches = true, LevelMeets = true, TargetValid = true, NotCasting = true, CooldownReady = false, MovementAllowed = true, Controllable = true });
            x1.AddAbilityLive(LiveInput("a-sk", X1FailurePolicy.Skip), supply, "舞伴甲");
            var pkg = new ShowPackage { ProtocolVersion = 1, Name = "t", DurationMs = 5000 };
            pkg.Events.Add(AbEvent("a-sk", 500));
            long t = 0;
            var runner = new ShowRunner(x1, () => t);
            runner.SetGuardProvider(() => new GuardSnapshot());
            runner.Load(pkg); runner.Arm(); runner.Start(0);
            runner.Tick(); // 转换帧
            t += 500; runner.Tick();
            check("[ab-tick] 条件 false 跳过登记", runner.SkippedCount == 1, runner.SkippedCount.ToString());
            t += 500; runner.Tick();
            check("[ab-tick] 跳过后零重试零再观测", calls() == 1 && runner.SkippedCount == 1, $"{calls()}/{runner.SkippedCount}");
        }
        // 停止三时点：到期前 / 观测回调中（写前）/ 提交后
        {
            // 到期前停止：零分发零提交
            var s0 = new RecAbilitySink();
            var x0 = new X1ShowDispatcher("p1") { AbilitySink = s0 };
            x0.AddAbilityLive(LiveInput("a-b"), () => AllTrue(), "舞伴甲");
            var p0 = new ShowPackage { ProtocolVersion = 1, Name = "t", DurationMs = 5000 };
            p0.Events.Add(AbEvent("a-b", 500));
            long t0 = 0;
            var r0 = new ShowRunner(x0, () => t0);
            r0.SetGuardProvider(() => new GuardSnapshot());
            r0.Load(p0); r0.Arm(); r0.Start(0);
            r0.RequestStop("网页紧急停止");
            t0 += 600; r0.Tick();
            check("[ab-tick] 到期前停止：零分发零提交", s0.Calls.Count == 0 && r0.State == ShowState.Loaded, r0.State.ToString());

            // 观测回调中停止（写前）：供给回调内重入 RequestStop → 零提交、终态 Loaded（不故障）
            var s1 = new RecAbilitySink();
            ShowRunner? reentrant = null;
            var x1 = new X1ShowDispatcher("p1") { AbilitySink = s1 };
            x1.AddAbilityLive(LiveInput("a-d"), () => { reentrant!.RequestStop("网页紧急停止"); return AllTrue(); }, "舞伴甲");
            var p1 = new ShowPackage { ProtocolVersion = 1, Name = "t", DurationMs = 5000 };
            p1.Events.Add(AbEvent("a-d", 500));
            long t1 = 0;
            reentrant = new ShowRunner(x1, () => t1);
            reentrant.SetGuardProvider(() => new GuardSnapshot());
            reentrant.Load(p1); reentrant.Arm(); reentrant.Start(0);
            reentrant.Tick(); // 转换帧
            t1 += 500; reentrant.Tick();
            check("[ab-tick] 观测回调中停止（写前）：零提交且回 Loaded 不故障",
                s1.Calls.Count == 0 && reentrant.State == ShowState.Loaded, $"{s1.Calls.Count}/{reentrant.State}");
            t1 += 500; reentrant.Tick();
            check("[ab-tick] 停止后零后续输出", s1.Calls.Count == 0);

            // 提交后停止：至多已发出的一次写，无后续输出
            var s2 = new RecAbilitySink();
            var x2 = new X1ShowDispatcher("p1") { AbilitySink = s2 };
            x2.AddAbilityLive(LiveInput("a-a"), () => AllTrue(), "舞伴甲");
            var p2 = new ShowPackage { ProtocolVersion = 1, Name = "t", DurationMs = 5000 };
            p2.Events.Add(AbEvent("a-a", 500));
            long t2 = 0;
            var r2 = new ShowRunner(x2, () => t2);
            r2.SetGuardProvider(() => new GuardSnapshot());
            r2.Load(p2); r2.Arm(); r2.Start(0);
            r2.Tick(); // 转换帧
            t2 += 500; r2.Tick();
            check("[ab-tick] 提交后停止：已发出至多一次写", s2.Calls.Count == 1, s2.Calls.Count.ToString());
            r2.RequestStop("网页紧急停止");
            t2 += 500; r2.Tick();
            check("[ab-tick] 停止后无后续输出且回 Loaded", s2.Calls.Count == 1 && r2.State == ShowState.Loaded);
        }
        // 故障后恢复需显式 Arm（零陈旧输入、零重试）
        {
            var sink = new RecAbilitySink();
            var x1 = new X1ShowDispatcher("p1") { AbilitySink = sink };
            var (supply, calls) = ScriptedSupply(() => AllTrue());
            x1.AddAbilityLive(LiveInput("a-g", X1FailurePolicy.StopShow), supply, "舞伴甲");
            var pkg = new ShowPackage { ProtocolVersion = 1, Name = "t", DurationMs = 5000 };
            pkg.Events.Add(AbEvent("a-g", 500));
            long t = 0;
            var runner = new ShowRunner(x1, () => t);
            runner.SetGuardProvider(() => new GuardSnapshot());
            runner.Load(pkg); runner.Arm(); runner.Start(0);
            runner.Tick(); // 转换帧
            t += 500; runner.Tick();
            check("[ab-tick] StopShow 条件失败故障停", runner.State == ShowState.Faulted, runner.State.ToString());
            check("[ab-tick] Faulted 后直接 Start 被拒", !runner.Start().Ok);
            check("[ab-tick] Faulted 后零重试", calls() == 1 && sink.Calls.Count == 0);
            runner.Arm(); runner.Start(0);
            runner.Tick(); // 转换帧
            t += 500; runner.Tick();
            check("[ab-tick] 显式 Arm+Start 恢复重演（重新观测）", sink.Calls.Count == 1 && calls() == 2,
                $"{sink.Calls.Count}/{calls()}");
        }
    }

    // ==================== x1-foreground-refresh ====================
    public static void RunForegroundCase(CheckFn check)
    {
        // A/A 放行；A/B 拒绝；窗口重建 B/B 下一次请求恢复；旧 A 前台 + 游戏 B 拒绝（同一实例连续剧本）
        nint game = 0x1111;
        nint fg = 0x1111;
        var downs = new List<byte>();
        var ups = new List<byte>();
        var p = new X1ForegroundPolicy(() => game, () => fg);
        check("[fg] A/A 放行按下", p.TryKeyDown(0x57, b => downs.Add(b)) && downs.Count == 1 && downs[0] == 0x57);
        fg = 0x2222;
        check("[fg] A/B 拒绝（前台非游戏）零写", !p.TryKeyDown(0x41, b => downs.Add(b)) && downs.Count == 1);
        game = 0x2222;
        fg = 0x2222;
        check("[fg] 游戏窗口重建后 B/B 下一次请求恢复放行", p.TryKeyDown(0x41, b => downs.Add(b)) && downs.Count == 2 && downs[1] == 0x41);
        fg = 0x1111;
        check("[fg] 旧句柄 A 仍在前台而游戏已是 B → 拒绝（绝不授权陈旧句柄）",
            !p.TryKeyDown(0x53, b => downs.Add(b)) && downs.Count == 2);

        // 零句柄/读取异常拒绝，随后有效恢复
        var zeroP = new X1ForegroundPolicy(() => nint.Zero, () => nint.Zero);
        check("[fg] 零/零拒绝", !zeroP.TryKeyDown(0x57, _ => { }));
        var once = 0;
        var recovP = new X1ForegroundPolicy(() => { once++; return 0x2222; }, () => 0x2222);
        check("[fg] 读取异常拒绝", !new X1ForegroundPolicy(() => throw new InvalidOperationException("句柄读取炸了"), () => 0x2222).TryKeyDown(0x57, _ => { }));
        check("[fg] 零/零后有效 B/B 恢复放行", recovP.TryKeyDown(0x57, _ => { }) && once == 1);

        // 持态簿记：按下失败不持态；已持有零再写；恰一次抬起跨多次释放
        nint okGame = 0x3333;
        var heldP = new X1ForegroundPolicy(() => okGame, () => okGame);
        var downFail = 0;
        var downRefused = !heldP.TryKeyDown(0x57, _ => { downFail++; throw new InvalidOperationException("注入炸了"); });
        heldP.ReleaseAll(_ => { });
        check("[fg] 按下记录器异常不持态（不逃逸、零持态、全松零误报）", downRefused && downFail == 1 && !heldP.AnyHeld);
        var downs2 = new List<byte>();
        check("[fg] 已持有键零再写", heldP.TryKeyDown(0x57, b => downs2.Add(b))
            && heldP.TryKeyDown(0x57, b => downs2.Add(b)) && downs2.Count == 1 && heldP.AnyHeld);
        var ups2 = new List<byte>();
        heldP.ReleaseAll(b => ups2.Add(b));
        heldP.ReleaseAll(b => ups2.Add(b));
        check("[fg] 每持有键恰一次抬起（跨重复释放）", ups2.Count == 1 && ups2[0] == 0x57 && !heldP.AnyHeld);
        var ups3 = new List<byte>();
        heldP.ReleaseAll(b => ups3.Add(b));
        heldP.TryKeyUp(0x57, b => ups3.Add(b));
        check("[fg] 未持有键抬起零写", ups3.Count == 0);
        var upThrow = 0;
        var heldP2 = new X1ForegroundPolicy(() => okGame, () => okGame);
        heldP2.TryKeyDown(0x41, _ => { });
        heldP2.TryKeyUp(0x41, _ => { upThrow++; throw new InvalidOperationException("抬起炸了"); });
        heldP2.TryKeyUp(0x41, _ => { upThrow++; });
        check("[fg] 抬起异常仍移除持态（恰一次尝试零再试）", upThrow == 1 && !heldP2.AnyHeld);
        var multi = new X1ForegroundPolicy(() => okGame, () => okGame);
        var multiUps = new List<byte>();
        multi.TryKeyDown(0x57, _ => { });
        multi.TryKeyDown(0x41, _ => { });
        multi.ReleaseAll(b => multiUps.Add(b));
        multi.ReleaseAll(b => multiUps.Add(b));
        multi.ReleaseAll(b => multiUps.Add(b));
        check("[fg] 重复停止/释放幂等（两键各恰一次抬起）",
            multiUps.Count == 2 && !multi.AnyHeld && new HashSet<byte>(multiUps).Count == 2);
        // 释放不问前台：演中失前台后已持键仍恰一次抬起（停演清扫不漏放）
        nint relFg = 0x4444;
        var relP = new X1ForegroundPolicy(() => 0x4444, () => relFg);
        relP.TryKeyDown(0x57, _ => { });
        relFg = 0x5555;
        var relUps = new List<byte>();
        relP.TryKeyUp(0x57, b => relUps.Add(b));
        check("[fg] 释放不问前台（失前台仍恰一次抬起，停演清扫不漏放）", relUps.Count == 1 && !relP.AnyHeld);
    }

    // ==================== x1-adapter-contract（保护性特征套件） ====================
    public static void RunAdapterContractCase(CheckFn check)
    {
        var root = FindRepoRoot();
        check("[contract] 仓库根可定位（.agent 目录向上回溯）", root != null, root ?? "null");
        if (root == null) return;
        // r3（AC-6）：受保护字节哈希改用 protected-baseline-r3.json（37 文件；SPEC/冻结 X1 核/
        // 传输与安全面）；ownerTails 结构比对仍以 r2 清单内的冻结尾记录为参照（r3 清单仅含文件表），
        // 对 PROCESS-STATE.ownerTails 结构一致（六尾不闭不让）；comp-parity 存档另走单行收紧比对。
        var manifestPath = Path.Combine(root, ".agent", "evidence", "TASK-20260912-X1-ABILITY-ADAPTER", "protected-baseline-r3.json");
        var tailsManifestPath = Path.Combine(root, ".agent", "evidence", "TASK-20260912-X1-ABILITY-ADAPTER", "protected-baseline-r2.json");
        var parityPath = Path.Combine(root, ".agent", "evidence", "TASK-20260912-X1-ABILITY-ADAPTER", "comp-parity-baseline-r2.cs.txt");

        JsonElement manifest;
        try { manifest = JsonDocument.Parse(File.ReadAllText(manifestPath)).RootElement; }
        catch (Exception ex) { check("[contract] 受保护基线清单可读", false, ex.Message); return; }
        check("[contract] 受保护基线清单可读（票据/修订一致）",
            manifest.GetProperty("ticketId").GetString() == "TASK-20260912-X1-ABILITY-ADAPTER"
            && manifest.GetProperty("ticketRevision").GetInt32() == 3);

        // 受保护文件字节未变（含 SPEC 冻结与 X1 冻结面；comp-parity 存档另走单行收紧比对）
        var files = manifest.GetProperty("files");
        string? firstDrift = null;
        var checkedCount = 0;
        foreach (var f in files.EnumerateArray())
        {
            var rel = f.GetProperty("path").GetString()!;
            var expect = f.GetProperty("sha256").GetString()!;
            checkedCount++;
            try
            {
                var actual = Sha256(File.ReadAllBytes(Path.Combine(root, rel.Replace('/', Path.DirectorySeparatorChar))));
                if (actual != expect) firstDrift ??= rel;
            }
            catch (Exception ex) { firstDrift ??= rel + "（" + ex.Message + "）"; }
        }
        check($"[contract] {checkedCount} 个受保护文件字节未变", firstDrift == null, firstDrift ?? "");

        // ownerTails 与 PROCESS-STATE.ownerTails 结构一致（六尾不闭不让；r3 清单无尾表，
        // 冻结参照取自 r2 清单内的 ownerTails——不可变历史证据，仅作尾状态参照）
        JsonElement manifestTails;
        Dictionary<string, string> live;
        try
        {
            var tailsDoc = JsonDocument.Parse(File.ReadAllText(tailsManifestPath)).RootElement;
            manifestTails = tailsDoc.GetProperty("ownerTails");
            var ps = JsonDocument.Parse(File.ReadAllText(Path.Combine(root, ".agent", "PROCESS-STATE.json"))).RootElement;
            live = new Dictionary<string, string>();
            foreach (var t in ps.GetProperty("ownerTails").EnumerateArray())
                live[t.GetProperty("id").GetString()!] = t.GetProperty("status").GetString()!;
        }
        catch (Exception ex) { check("[contract] PROCESS-STATE 可读", false, ex.Message); return; }
        var tailsOk = true;
        var tailDetail = "";
        foreach (var t in manifestTails.EnumerateArray())
        {
            var id = t.GetProperty("id").GetString()!;
            var status = t.GetProperty("status").GetString()!;
            if (!live.TryGetValue(id, out var liveStatus) || liveStatus != status)
            {
                tailsOk = false;
                tailDetail += id + ":" + status + "→" + (live.TryGetValue(id, out var ls) ? ls : "缺失") + " ";
            }
        }
        check("[contract] ownerTails 与 PROCESS-STATE 结构一致（六尾不闭不让）", tailsOk && manifestTails.GetArrayLength() == 6, tailDetail);

        // comp-parity 断言唯一收紧：>= 1 → == 1（与冻结存档逐行比对，恰一行之差）
        try
        {
            var archived = File.ReadAllLines(parityPath, Encoding.UTF8);
            var current = File.ReadAllLines(Path.Combine(root, "src", "tests", "datalayertest", "X1CompositeDispatcherTests.cs"), Encoding.UTF8);
            var diff = new List<(int Line, string Old, string New)>();
            for (var i = 0; i < Math.Max(archived.Length, current.Length); i++)
            {
                var a = i < archived.Length ? archived[i].TrimEnd('\r') : "<缺行>";
                var b = i < current.Length ? current[i].TrimEnd('\r') : "<缺行>";
                if (a != b) diff.Add((i + 1, a, b));
            }
            check("[contract] comp-parity 断言恰一行之差（>=1 → ==1）",
                diff.Count == 1
                && diff[0].Old.Contains("built.X1.StopCalls >= 1")
                && diff[0].New.Contains("built.X1.StopCalls == 1"),
                diff.Count + " 行差异；首行 " + (diff.Count > 0 ? diff[0].Line + ": " + diff[0].Old + " → " + diff[0].New : ""));
            var currentText = string.Join("\n", current);
            check("[contract] 现行文件不再含宽松断言（>= 1）", !currentText.Contains("built.X1.StopCalls >= 1"));
        }
        catch (Exception ex)
        {
            check("[contract] comp-parity 断言唯一收紧比对可执行", false, ex.Message);
        }

        // 设计阻塞/源表与未验证声明在场（语义准确性由 CH-MODULE/CH-GLOBAL 独立证伪）
        var design = File.ReadAllText(Path.Combine(root, "docs", "DESIGN-game-executor.md"));
        var seven = new[] { "JobMatches", "LevelMeets", "TargetValid", "NotCasting", "CooldownReady", "MovementAllowed", "Controllable" };
        var sevenOk = true;
        foreach (var n in seven) if (!design.Contains(n)) { sevenOk = false; break; }
        check("[contract] 设计七条件源表在场（七字段逐一具名）", sevenOk);
        check("[contract] 设计冷却/移动限制未知声明在场",
            design.Contains("CooldownReady：不可用") && design.Contains("MovementAllowed：不可用"));
        check("[contract] 设计休眠/不使能声明在场",
            design.Contains("X1 ability adapter (dormant, 2026-09-12)") && design.Contains("admission stays closed"));
        check("[contract] 设计 CN 未验证声明在场",
            design.Contains("CN 实机未验证") || design.Contains("unverified on the CN client"));
        check("[contract] SPEC REQ-SPEC-017 保持未勾选",
            File.ReadAllText(Path.Combine(root, "SPEC.md")).Contains("- [ ] Game execution"));
    }

    private static string? FindRepoRoot()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir != null)
        {
            if (Directory.Exists(Path.Combine(dir.FullName, ".agent"))) return dir.FullName;
            dir = dir.Parent;
        }
        return null;
    }

    private static string Sha256(byte[] bytes)
    {
        using var sha = SHA256.Create();
        var hash = sha.ComputeHash(bytes);
        var sb = new StringBuilder(hash.Length * 2);
        foreach (var b in hash) sb.Append(b.ToString("x2"));
        return sb.ToString();
    }
}
