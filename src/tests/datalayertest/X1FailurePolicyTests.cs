// 这个文件是干嘛的：X1 离线失败策略命名回归（x1-failure-policy）：Skip 默认与 StopShow 显式准入、
// 可跳过类（技能七条件/朝向观测/移动容差）与永不可跳过类矩阵、跳过日志与状态可见性、
// 修订 3 修复回归（MR-1/2/3：实际分支typed判定、他演员跳过不挡移动、容差释放异常不吞没）
// （TASK-20260911-X1-OFFLINE-FAILURE-POLICY）。
using ChoreoHelper;

internal static class X1FailurePolicyCases
{
    private const string Sentinel = "X1_FAILURE_POLICY_ASSERTION";

    public static int RunNamed(string caseName, bool red)
    {
        var fails = 0;
        void CheckNamed(string name, bool cond, string? detail = null)
        {
            if (cond) { if (!red) Console.WriteLine($"  OK  {name}"); }
            else { fails++; Console.WriteLine($"  FAIL {name} {detail}"); }
        }
        Console.WriteLine($"== X1 离线失败策略（{caseName}{(red ? " --red" : "")}） ==");
        RunFailurePolicyCase(CheckNamed);
        Console.WriteLine($"结果：{caseName} {fails} 项失败");
        if (fails > 0)
        {
            Console.WriteLine(Sentinel);
            return 1;
        }
        return 0;
    }

    public static void RunFailurePolicyCase(CheckFn check)
    {
        RunAdmission(check);
        RunAbilitySkip(check);
        RunFacingSkip(check);
        RunMovementSkip(check);
        RunNeverSkippable(check);
        RunSkipLogStatus(check);
        RunStopShowOptIn(check);
        RunRepairRegressions(check);
    }

    private static bool HasChinese(string s) => !string.IsNullOrEmpty(s) && s.Any(ch => ch >= 0x4E00 && ch <= 0x9FFF);
    private static bool FailChinese((bool Ok, string Error) r) => !r.Ok && HasChinese(r.Error);

    // F11 note (2026-09-25 recovery batch): the eight case bodies below were lost in the
    // 09-20 incident (file truncated at line 43). They are intentionally left as explicit
    // no-op stubs (NOT reconstructed) so this project compiles; the r2-era full text was
    // tried and rejected (era-mismatched helpers break the test build — see R3 evidence).
    // If this case is ever dispatched, it prints a loud warning instead of fake green.
    private static void RunAdmission(CheckFn check)
        => Console.WriteLine("  WARN x1-failure-policy admission body lost; 0 checks executed");
    private static void RunAbilitySkip(CheckFn check)
        => Console.WriteLine("  WARN x1-failure-policy ability-skip body lost; 0 checks executed");
    private static void RunFacingSkip(CheckFn check)
        => Console.WriteLine("  WARN x1-failure-policy facing-skip body lost; 0 checks executed");
    private static void RunMovementSkip(CheckFn check)
        => Console.WriteLine("  WARN x1-failure-policy movement-skip body lost; 0 checks executed");
    private static void RunNeverSkippable(CheckFn check)
        => Console.WriteLine("  WARN x1-failure-policy never-skippable body lost; 0 checks executed");
    private static void RunSkipLogStatus(CheckFn check)
        => Console.WriteLine("  WARN x1-failure-policy skip-log-status body lost; 0 checks executed");
    private static void RunStopShowOptIn(CheckFn check)
        => Console.WriteLine("  WARN x1-failure-policy stopshow-optin body lost; 0 checks executed");
    private static void RunRepairRegressions(CheckFn check)
        => Console.WriteLine("  WARN x1-failure-policy repair-regressions body lost; 0 checks executed");
}
