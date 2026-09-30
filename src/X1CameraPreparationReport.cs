// 这个文件是干嘛的：镜头准备尝试的一次性报告（完成位＋状态＋诊断帧）。
// 捐赠定义（09-12 各 X1InputPreparation.cs 顶部三字段 record）＋ current-only Stopped
// 工厂的最小实现：last/prior 暂未并入（无捐赠语义），调用点类型对拍见 R2 记录。
using System;

namespace ChoreoHelper;

public sealed record X1CameraPreparationReport(bool Complete, string Status,
    System.Collections.Generic.IReadOnlyList<X1ReferenceDiagnosticReport> Reports)
{
    public static X1CameraPreparationReport Stopped(string reason,
        System.Collections.Generic.IReadOnlyList<X1ReferenceDiagnosticReport> reports,
        X1ReferenceDiagnosticReport? last, X1ReferenceDiagnosticReport? prior)
        => new(false, reason, reports);
}
