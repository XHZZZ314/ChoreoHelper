// 这个文件是干嘛的：演出装载归属策略（clientLoadId 认领＋取消标记）。
// 取消先到也保留墓碑；旧请求不得覆盖新场，达到容量后拒绝新增登记。
using System;
using System.Collections.Generic;

namespace ChoreoHelper;

internal sealed class OwnedShowLoadPolicy
{
    private readonly HashSet<string> _retired = new(StringComparer.Ordinal);
    public string ClientLoadId { get; private set; } = "";
    public string? ArmId { get; set; }
    public bool Cancelled { get; private set; }

    public static bool ValidId(string? id) => Guid.TryParseExact(id, "D", out _);

    public bool CanLoad(string? id) => id == null ? ClientLoadId.Length == 0
        : ValidId(id) && !_retired.Contains(id) && id != ClientLoadId && _retired.Count < 4096;

    public void Loaded(string? id)
    {
        if (ClientLoadId.Length != 0) _retired.Add(ClientLoadId);
        ClientLoadId = id ?? "";
        ArmId = null;
        Cancelled = false;
    }

    public bool Cancel(string? id)
    {
        if (!ValidId(id) || (id != ClientLoadId && !_retired.Contains(id!) && _retired.Count >= 4096)) return false;
        _retired.Add(id!);
        if (id == ClientLoadId) Cancelled = true;
        return true;
    }
}
