// 这个文件是干嘛的：按节点自动切换走/跑（TASK-20260919-PATH-LOCOMOTION）的数据层回归：
// 切换器纯逻辑（读写注入：无操作/切换/回读验证/失败即停/停止恢复）、路径计划与镜头档案的步态豁免口径、
// 含跑步段须按最快档校准的就绪规则形状、能力表宣告。受限宿主不执行。
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using System.Text.Json.Nodes;
using ChoreoHelper;

internal static class X1LocomotionCases
{
    private static readonly X1KeyBindings Keys = new(new byte[] { 87, 83, 0, 0, 65, 68 });
    private static readonly X1PhysicalInputSnapshot Ready = new(true, true, true, true, false, false, true, "", 0, 0, 0);

    public static void Run(CheckFn check)
    {
        SwitcherCases(check);
        IdentityRelaxationCases(check);
        check("[x1-locomotion] 能力常量与就绪串一致",
            StageShowContract.LocomotionCapability == "stageLocomotionAutoV1"
            && PlaybackStatusV2.WithStageShowCapabilities("{\"capabilities\":[]}").Contains(StageShowContract.LocomotionCapability));
    }

    private static X1MovementReferenceSnapshot Snap(bool? walking)
        => new() { AtMs = Environment.TickCount64, IsWalking = walking, IsWalkingDuringAutorun = false };

    private static void SwitcherCases(CheckFn check)
    {
        // 已一致：不写、期望更新。
        var writes = new List<bool>();
        var switcher = new X1LocomotionSwitcher(() => Snap(false), w => writes.Add(w));
        switcher.Ensure(false);
        check("[x1-locomotion] 已一致时不写只更新期望", writes.Count == 0 && switcher.ExpectedIsWalking == false && !switcher.Switched);

        // 需要切换：写一次、回读一致、记录原始档。
        bool? current = false;
        switcher = new X1LocomotionSwitcher(() => Snap(current), w => { writes.Add(w); current = w; });
        switcher.Ensure(true);
        check("[x1-locomotion] 切换写一次且回读一致后生效", writes.Count == 1 && writes[0] && switcher.ExpectedIsWalking == true && switcher.Switched);

        // 读取失败/未知步态：明确抛错，不写。
        writes.Clear();
        switcher = new X1LocomotionSwitcher(() => null, w => writes.Add(w));
        check("[x1-locomotion] 读取失败抛错不写", Throws(() => switcher.Ensure(true)) && writes.Count == 0);
        switcher = new X1LocomotionSwitcher(() => Snap(null), w => writes.Add(w));
        check("[x1-locomotion] 步态未知抛错不写", Throws(() => switcher.Ensure(true)) && writes.Count == 0);

        // 回读不一致：抛错且不更新期望。
        writes.Clear();
        var stuck = new X1LocomotionSwitcher(() => Snap(false), w => writes.Add(w));
        check("[x1-locomotion] 回读不一致抛错", Throws(() => stuck.Ensure(true)) && writes.Count == 1 && stuck.ExpectedIsWalking == null);

        // 写入异常：包装后抛出。
        switcher = new X1LocomotionSwitcher(() => Snap(false), _ => throw new InvalidOperationException("控制模块不可读"));
        check("[x1-locomotion] 写入失败包装抛错", Throws(() => switcher.Ensure(true)));

        // 恢复：未切换过=无写无异常。
        writes.Clear();
        switcher = new X1LocomotionSwitcher(() => Snap(true), w => writes.Add(w));
        switcher.Restore();
        check("[x1-locomotion] 未切换恢复为无操作", writes.Count == 0);

        // 恢复：切过=写回原始档；再次恢复为无操作。
        current = true;
        switcher = new X1LocomotionSwitcher(() => Snap(current), w => { writes.Add(w); current = w; });
        switcher.Ensure(false);
        writes.Clear();
        switcher.Restore();
        check("[x1-locomotion] 停止恢复开演前步态", writes.Count == 1 && writes[0] == true && current == true && !switcher.Switched && switcher.ExpectedIsWalking == null);
        writes.Clear();
        switcher.Restore();
        check("[x1-locomotion] 恢复一次后不重复写", writes.Count == 0);

        // 恢复读取失败：如实抛错且保留待恢复状态（重试仍会尝试恢复）。
        bool? readValue = true;
        var restoreWrites = new List<bool>();
        var sw = new X1LocomotionSwitcher(() => readValue.HasValue ? Snap(readValue.Value) : null, w => { restoreWrites.Add(w); readValue = w; });
        sw.Ensure(false);
        readValue = null;
        check("[x1-locomotion] 恢复读取失败如实抛错且保留待恢复", Throws(sw.Restore) && sw.Switched && restoreWrites.Count == 1);
        readValue = false;
        sw.Restore();
        check("[x1-locomotion] 读取恢复后重试成功恢复", restoreWrites.Count == 2 && restoreWrites[1] == true && !sw.Switched);
    }

    private static void IdentityRelaxationCases(CheckFn check)
    {
        var plan = new X1CameraPathPlan(Package(), "walk", () => { }, "package", "load");
        // 默认口径不变：实际步态与申报不一致仍拒绝。
        check("[x1-locomotion] 计划一致性默认仍严格", Throws(() => plan.CheckStart(WalkObservation(2000))));
        // 豁免口径（就绪/武装检查用）：自动切换可用时开演前步态无关紧要。
        plan.CheckStart(WalkObservation(2000), ignoreWalkingState: true);
        check("[x1-locomotion] 就绪检查豁免步态比对", true);
        // 但自动跑（Autorun）仍必须是关闭态，不随豁免放松。
        check("[x1-locomotion] 豁免不放松自动跑口径", Throws(() => plan.CheckStart(AutorunObservation(2000), ignoreWalkingState: true)));

        // 镜头档案身份：豁免时步态变化不再判档案失效（速度安全由最快档校准规则保证）。
        // 档案按跑步档校准（IsWalking=false），用步行观测挑战身份比对——即混合步态场切到走路段后的真实形态。
        var profile = Profile();
        var error = profile.CheckCurrent(WalkObservation(2100));
        check("[x1-locomotion] 档案身份默认仍含步态", error.Length != 0);
        error = profile.CheckCurrent(WalkObservation(2100), ignoreWalkingIdentity: true);
        check("[x1-locomotion] 档案身份豁免步态后仍有效", error.Length == 0 && profile.CalibratedWhileWalking == false);
    }

    private static ShowPackage Package(Action<JsonObject>? mutate = null)
    {
        var json = X1FormalProtocolCases.Fixture();
        var selected = json["events"]![1]!.DeepClone();
        json["events"] = new JsonArray(selected);
        json["x1"]!["bindings"]![0]!["actorId"] = "77";
        json["x1"]!["bindings"]![0]!["territoryId"] = 1376;
        json["x1"]!["bindings"]![0]!["stage"]!["originX"] = 0;
        json["x1"]!["bindings"]![0]!["stage"]!["originZ"] = 0;
        json["x1"]!["bindings"]![0]!["stage"]!["yawDeg"] = 0;
        json["x1"]!["bindings"]!.AsArray().RemoveAt(1);
        selected!["x1"]!["locomotion"] = "run";
        selected["x1"]!["arrivalToleranceM"] = .12;
        selected["x1"]!["maxCorrectionM"] = .05;
        selected["x1"]!["points"] = JsonNode.Parse("[{\"tMs\":0,\"x\":0,\"z\":0},{\"tMs\":500,\"x\":0,\"z\":0.2},{\"tMs\":1000,\"x\":0,\"z\":0.2}]");
        mutate?.Invoke(json);
        using var doc = JsonDocument.Parse(json.ToJsonString());
        return ShowProtocolParser.Parse(doc.RootElement).Package ?? throw new InvalidOperationException("不合法的路径输入");
    }

    private static X1ReferenceDiagnosticObservation Observation(long t, bool? walking, double x = 0, double z = 0, bool autorun = false)
        => new(Keys, new(t, 77, 1376, x, 0, z, 2.1), new() { AtMs = t, CameraDirH = Math.PI, CameraDirV = 0,
            CameraControlMode = 1, CameraZoomMode = 1, ActiveCameraIndex = 0, EventCameraAutoControl = false,
            IsWalking = walking, IsWalkingDuringAutorun = autorun, CameraPosition = new(0, 1, -3), CameraLookAt = new(0, 1, 0), Reason = "" },
            1, Ready, true, "");
    private static X1ReferenceDiagnosticObservation WalkObservation(long t) => Observation(t, true);
    private static X1ReferenceDiagnosticObservation RunObservation(long t) => Observation(t, false);
    private static X1ReferenceDiagnosticObservation AutorunObservation(long t) => Observation(t, false, 0, 0, true);

    private static X1CameraRelativeProfile Profile()
    {
        X1ReferenceDiagnosticReport Report(X1Control control, double angle)
        {
            var frames = new List<X1ReferenceDiagnosticFrame>(); double x = 0, z = 0;
            for (var t = 1000; t <= 1450; t += 50)
            {
                if (t is 1150 or 1200 or 1250) { x += .05 * Math.Sin(angle); z += .05 * Math.Cos(angle); }
                frames.Add(new(t is >= 1100 and <= 1200 ? control : null, Observation(t, false, x, z)));
            }
            return new(true, control, "合成诊断", 1450, .05 * 3, 0, 0, frames.AsReadOnly());
        }
        var created = X1CameraRelativeProfile.TryCreate(new[] { Report(X1Control.Forward, 0),
            Report(X1Control.TurnLeft, Math.PI / 2), Report(X1Control.TurnRight, -Math.PI / 2) }, Observation(2000, false));
        if (created.Profile == null) throw new InvalidOperationException("档案构造失败：" + created.Error);
        return created.Profile;
    }
    private static bool Throws(Action action) { try { action(); return false; } catch (InvalidOperationException) { return true; } }
}
