// 这个文件是干嘛的：为定时开演绑定装载、就绪、一次性请求和单调时钟，拒绝旧请求与变动的演出。
using System;
using System.Collections.Generic;
using System.Security.Cryptography;
using System.Text.Json;

namespace ChoreoHelper;

public sealed record ScheduledShowStartClock(long ServerMonoMs, string PackageId, string ArmId,
    ShowState State, string StartId, long? DeadlineMonoMs, string ClientLoadId = "");

internal sealed class ScheduledShowStartPolicy
{
    internal const int MinLeadMs = 100;
    private const int MaxRememberedStarts = 4096;
    private readonly HashSet<string> _usedStarts = new(StringComparer.Ordinal);
    private string _packageHash = "";
    internal string PackageId { get; private set; } = "";
    internal string ArmId { get; private set; } = "";
    internal string StartId { get; private set; } = "";
    internal long? DeadlineMonoMs { get; private set; }
    internal long Generation { get; private set; }
    internal bool Active => StartId.Length != 0;

    internal void Load(ShowPackage package)
    {
        var hash = Fingerprint(package);
        InvalidateRun();
        PackageId = Guid.NewGuid().ToString("N");
        _packageHash = hash;
    }

    // era-reconciliation overload (09-16 caller passes precomputed ids; no 09-16 policy donor).
    internal void Load(ShowPackage package, string packageId, string fingerprint)
    {
        InvalidateRun();
        PackageId = packageId;
        _packageHash = fingerprint;
    }

    internal void Unload()
    {
        InvalidateRun();
        PackageId = "";
        _packageHash = "";
    }

    internal void Arm()
    {
        InvalidateRun();
        ArmId = Guid.NewGuid().ToString("N");
    }

    internal void InvalidateRun()
    {
        Generation++;
        ArmId = "";
        StartId = "";
        DeadlineMonoMs = null;
    }

    internal bool PackageMatches(ShowPackage? package)
    {
        try { return package != null && _packageHash == Fingerprint(package); }
        catch { return false; }
    }

    internal bool Matches(string packageId, string armId, string startId) => Active &&
        PackageId == packageId && ArmId == armId && StartId == startId;

    internal (bool Ok, string Message, int CountdownMs) Accept(ShowPackage? package,
        string packageId, string armId, string startId, long now, long deadline)
    {
        if (string.IsNullOrEmpty(PackageId) || packageId != PackageId)
            return (false, "装载的演出已变化，请重新读取时钟与演出身份", 0);
        if (string.IsNullOrEmpty(ArmId) || armId != ArmId)
            return (false, "就绪状态已变化，请重新就绪并读取时钟", 0);
        if (string.IsNullOrWhiteSpace(startId) || startId.Length > 128)
            return (false, "startId 必须是 1–128 字符的一次性请求标识", 0);
        if (_usedStarts.Contains(startId)) return (false, "该开演请求已使用，不能重放", 0);
        if (_usedStarts.Count >= MaxRememberedStarts)
            return (false, "本次插件会话的定时开演次数已达上限，请重载插件", 0);
        // 用无溢出的差值判断窗口；不把过期请求截断成马上开演。
        var lead = (decimal)deadline - now;
        if (lead < MinLeadMs) return (false, "开演时间已过或过近，请至少提前 100ms", 0);
        if (lead > ShowRunner.MaxCountdownMs) return (false, "开演时间不能超过 30 秒", 0);
        if (!PackageMatches(package)) return (false, "演出内容已变化，请重新装载并就绪", 0);
        _usedStarts.Add(startId);
        Generation++;
        StartId = startId;
        DeadlineMonoMs = deadline;
        return (true, "定时开演已接受", (int)lead);
    }

    internal static string Fingerprint(ShowPackage package) =>
        Convert.ToHexString(SHA256.HashData(JsonSerializer.SerializeToUtf8Bytes(package)));
}
