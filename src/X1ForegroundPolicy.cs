// 这个文件是干嘛的：X1 前台策略——纯可测的前台护栏判决与按键持态簿记（注入句柄读取与
// 按键记录器，无 OS/Dalamud 依赖，进 datalayertest）。判决与持态语义集中在此件共享
// （生产接线 X1OsKeyWriter，OS 注入 keybd_event 留在 X1GameAdapters.cs）。
using System;
using System.Collections.Generic;

namespace ChoreoHelper;

/// <summary>前台护栏 + 持态簿记（纯策略）。句柄读取注入（生产为进程主窗口/前台窗口读取，
/// 测试为脚本假件）；按下/抬起经注入记录器（生产为 keybd_event，测试为记录假件）。</summary>
public sealed class X1ForegroundPolicy
{
    private readonly Func<nint> _gameHandle;
    private readonly Func<nint> _foreground;
    private readonly HashSet<byte> _held = new();

    public X1ForegroundPolicy(Func<nint> gameHandleReader, Func<nint> foregroundHandleReader)
    {
        _gameHandle = gameHandleReader ?? throw new ArgumentNullException(nameof(gameHandleReader));
        _foreground = foregroundHandleReader ?? throw new ArgumentNullException(nameof(foregroundHandleReader));
    }

    /// <summary>当前持有键数（诊断用；>0 时停演清扫必须走 ReleaseAll）。</summary>
    public bool AnyHeld => _held.Count > 0;

    /// <summary>前台判决（P3-b 修复口径）：每次请求即时双读「当前游戏主窗口句柄」与「前台窗口
    /// 句柄」，两者非零且相等才放行；任一读取异常或零句柄拒绝（fail-closed）。不缓存判决用
    /// 句柄——游戏窗口重建（旧句柄失效）后下一次请求即恢复；旧句柄仍在前台而游戏已是新句柄
    /// 时拒绝（绝不授权陈旧句柄）。</summary>
    public bool MayInject()
    {
        nint game;
        try { game = _gameHandle(); }
        catch { return false; }
        if (game == nint.Zero) return false;
        nint foreground;
        try { foreground = _foreground(); }
        catch { return false; }
        return game == foreground;
    }

    /// <summary>请求按下：已持有零写返回 true；前台不放行零写且不持态；记录器异常不持态、
    /// 不上抛（与旧 X1OsKeyWriter 口径一致：注入失败不伪造成功）。</summary>
    public bool TryKeyDown(byte vk, Action<byte> down)
    {
        if (down == null) throw new ArgumentNullException(nameof(down));
        if (_held.Contains(vk)) return true;
        if (!MayInject()) return false;
        try { down(vk); }
        catch { return false; }
        _held.Add(vk);
        return true;
    }

    /// <summary>请求抬起：持有键恰一次抬起尝试，无论成败移除持态（重复释放零再试）；
    /// 未持有零写。</summary>
    public void TryKeyUp(byte vk, Action<byte> up)
    {
        if (up == null) throw new ArgumentNullException(nameof(up));
        if (!_held.Remove(vk)) return;
        try { up(vk); }
        catch { }
    }

    /// <summary>全松（幂等）：每持有键恰一次抬起尝试；重复调用零写（停演清扫/卸载唯一出口）。</summary>
    public void ReleaseAll(Action<byte> up)
    {
        if (up == null) throw new ArgumentNullException(nameof(up));
        foreach (var vk in _held.ToArray())
            TryKeyUp(vk, up);
    }
}
