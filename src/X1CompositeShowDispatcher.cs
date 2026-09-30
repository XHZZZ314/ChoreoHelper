// 这个文件是干嘛的：X1 纯复合分发器——生产半（motion/cue/lyrics）与 X1 核心
// （ability/movement/facing）的种类路由与幂等扇出（无 Dalamud 依赖，进 datalayertest）。
// 准入关闭期间 X1 束休眠：零 X1 事件时可观测行为与纯生产半字节一致；OnShowStart/OnStop
// 向两半扇出（任一半抛异常仍调另一半，首异常透出，ShowRunner 侧兜底）。
using System;
using System.Collections.Generic;

namespace ChoreoHelper;

/// <summary>纯复合分发器：种类路由 + 双半扇出。生产半处理 motion/cue/lyrics（含未知种防御），
/// X1 核心处理 ability/movement/facing；UpdateActive 委托 X1 核心（休眠零输出）。</summary>
public sealed class X1CompositeShowDispatcher : IShowDispatcher, IX1ActiveUpdater
{
    public IShowDispatcher Production { get; }
    public X1ShowDispatcher X1 { get; }

    public X1CompositeShowDispatcher(IShowDispatcher production, X1ShowDispatcher x1)
    {
        Production = production ?? throw new ArgumentNullException(nameof(production));
        X1 = x1 ?? throw new ArgumentNullException(nameof(x1));
    }

    public static bool IsX1Kind(string kind) =>
        kind == "ability" || kind == "movement" || kind == "facing";

    public static bool IsProductionKind(string kind) =>
        kind == "motion" || kind == "cue" || kind == "lyrics";

    public ShowDispatchResult Dispatch(ShowEvent e)
    {
        if (e == null) return ShowDispatchResult.Fail("事件为空");
        if (IsX1Kind(e.Kind)) return X1.Dispatch(e);
        return Production.Dispatch(e);
    }

    public (bool Ok, string Error, List<X1SkipRecord>? Skips, string FailedEventId) UpdateActive(long showTimeMs)
    {
        return X1.UpdateActive(showTimeMs);
    }

    /// <summary>开演扇出：先生产半（清残留命令/定格）后 X1 核心（复位停止旗）；两半都调，首异常透出。</summary>
    public void OnShowStart()
    {
        Exception? first = null;
        try { Production.OnShowStart(); }
        catch (Exception ex) { first = ex; }
        try { X1.OnShowStart(); }
        catch (Exception ex) { first ??= ex; }
        if (first != null) throw new InvalidOperationException(first.Message);
    }


    public void OnStop()
    {
        Exception? first = null;
        try { Production.OnStop(); }
        catch (Exception ex) { first = ex; }
        try { X1.OnStop(); }
        catch (Exception ex) { first ??= ex; }
        if (first != null) throw new InvalidOperationException(first.Message);
    }
}
