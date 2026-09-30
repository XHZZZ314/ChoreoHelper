// 这个文件是干嘛的：X1 技能写入边界（纯可测，进 datalayertest）——生产与测试共享的提交控制路径。
// r3 修复（M1/M2/M3）：显式身份为规范十进制——动作=Lumina Action.RowId（int 值域，生产
// GetActionsJson 同口径），目标=IGameObject.GameObjectId（ulong 值域，installed Dalamud 实测），
// 仅按 id 相等（同名不同 id 必败）；每次可重入读取（行解析/线程/PvP/目标）之后与原生写入之前
// 各复核一次运行代见证——停止/故障/卸载/重演使旧代全部失效，旧代在途提交零写；终局恰一次
// 同步原生写入（busy/不可用即刻拒绝，由共享执行器承担）。绝不搜索/替换/重试/注入。
using System;
using System.Globalization;

namespace ChoreoHelper;

/// <summary>运行代见证：停止/故障/卸载/重演使旧代全部失效（X1ShowDispatcher 生命周期钩子经槽实现通知）。</summary>
internal interface IX1AbilityGenerationGuard
{
    void InvalidateGeneration();
}

/// <summary>技能写入边界：全部护栏通过才对原生写入器恰调用一次（显式动作+显式目标；
/// 写入器 false/异常原样透传——执行器冻结映射 SinkRejected/SinkException）。检查顺序固定：
/// 身份文法 → 行解析 → 线程 → PvP → 目标 id 一致 → 代复核；任一检查失败、读取异常或代失效零写拒绝。
/// 每次可重入读取后与原生写入前各复核运行代；无重试、无候选扫描、无目标替换。</summary>
public sealed class X1AbilityWriteBoundary
{
    private readonly Func<bool?> _pvp;
    private readonly Func<ulong?> _currentTargetId;
    private readonly Func<bool> _frameworkThread;
    private readonly Func<int, string?> _actionNameResolver;
    private readonly Func<string, bool> _nativeWriter;
    private long _generation;

    public X1AbilityWriteBoundary(
        Func<bool?> pvpReader,
        Func<ulong?> currentTargetIdReader,
        Func<bool> frameworkThreadGate,
        Func<int, string?> actionNameResolver,
        Func<string, bool> nativeWriter)
    {
        _pvp = pvpReader ?? throw new ArgumentNullException(nameof(pvpReader));
        _currentTargetId = currentTargetIdReader ?? throw new ArgumentNullException(nameof(currentTargetIdReader));
        _frameworkThread = frameworkThreadGate ?? throw new ArgumentNullException(nameof(frameworkThreadGate));
        _actionNameResolver = actionNameResolver ?? throw new ArgumentNullException(nameof(actionNameResolver));
        _nativeWriter = nativeWriter ?? throw new ArgumentNullException(nameof(nativeWriter));
    }

    /// <summary>失效当前运行代：旧代在途提交在其下一个复核点零写（恰一次提交语义不变，无重试）。</summary>
    public void InvalidateGeneration() => Interlocked.Increment(ref _generation);

    /// <summary>当前运行代（诊断/测试观测口）。</summary>
    public long CurrentGeneration => Interlocked.Read(ref _generation);

    /// <summary>动作行 id 文法：Action.RowId 规范十进制——仅 ASCII 数字、无符号/前导零/空白/其他字符、
    /// int 值域（越界=畸形）。Name 是显示元数据，永不是身份；存在性/支持性由行解析承担。</summary>
    public static bool TryParseActionRowId(string? actionId, out int rowId)
    {
        rowId = 0;
        if (string.IsNullOrEmpty(actionId) || !IsCanonicalDecimal(actionId)) return false;
        return int.TryParse(actionId, NumberStyles.None, CultureInfo.InvariantCulture, out rowId);
    }

    /// <summary>目标 id 文法：GameObjectId 规范十进制——仅 ASCII 数字、无符号/前导零/空白/其他字符、
    /// ulong 值域（越界=畸形）。</summary>
    public static bool TryParseTargetId(string? target, out ulong targetId)
    {
        targetId = 0;
        if (string.IsNullOrEmpty(target) || !IsCanonicalDecimal(target)) return false;
        return ulong.TryParse(target, NumberStyles.None, CultureInfo.InvariantCulture, out targetId);
    }

    /// <summary>规范十进制判定：非空、全 ASCII 数字、无前导零（"0" 自身合法）。</summary>
    private static bool IsCanonicalDecimal(string s)
    {
        if (s.Length > 1 && s[0] == '0') return false;
        foreach (var ch in s)
        {
            if (ch < '0' || ch > '9') return false;
        }
        return true;
    }

    /// <summary>提交护栏：全部检查通过才对写入器恰调用一次（显式动作+显式目标原样传递）。
    /// 写入器 false/异常原样透传（执行器冻结映射 SinkRejected/SinkException），护栏不吞不重试。</summary>
    public bool TrySubmit(string actionId, string target)
    {
        var gen0 = CurrentGeneration;
        // ① 显式身份文法：动作行 id / 目标 id 规范十进制；畸形零写（不做任何规范化替身）。
        if (!TryParseActionRowId(actionId, out var rowId)) return false;
        if (!TryParseTargetId(target, out var targetId)) return false;
        // ② 动作行解析（可重入读取）：不存在/不支持/空名行零写；解析出的本地名才入命令文本。
        string? actionName;
        try { actionName = _actionNameResolver(rowId); }
        catch { return false; }
        if (string.IsNullOrEmpty(actionName)) return false;
        if (CurrentGeneration != gen0) return false;
        // ③ 线程门：非框架线程或门不可用零写（游戏读写在框架线程红线内）。
        try { if (!_frameworkThread()) return false; }
        catch { return false; }
        if (CurrentGeneration != gen0) return false;
        // ④ PvP/safety fail-closed：true 或 null（未知）一律拒绝；观测不可用即拒绝。
        bool? pvp;
        try { pvp = _pvp(); }
        catch { return false; }
        if (pvp != false) return false;
        if (CurrentGeneration != gen0) return false;
        // ⑤ 目标一致复核（可重入读取）：当前选中对象 GameObjectId == 显式请求 id 才放行；
        // 仅按 id 相等（同名不同 id 必败）；目标消失/改变/读不到零写——绝不候选扫描、绝不替换。
        ulong? current;
        try { current = _currentTargetId(); }
        catch { return false; }
        if (current == null || current.Value != targetId) return false;
        if (CurrentGeneration != gen0) return false;
        // ⑥ 原生写入前最终代复核（M2 最后边界）+ 恰一次同步写入；false/异常原样上抛。
        if (CurrentGeneration != gen0) return false;
        return _nativeWriter(X1AbilityAdapterPolicy.BuildChatCommand(actionName));
    }
}
