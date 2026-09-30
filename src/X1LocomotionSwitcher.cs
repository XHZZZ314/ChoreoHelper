// 这个文件是干嘛的：整场演出按登记段自动切换走/跑（TASK-20260919-PATH-LOCOMOTION）：
// 读写经依赖注入（框架线程接线见 X1LocomotionFrameworkAdapter），纯逻辑可测；
// 读取失败/回读不一致/未知步态一律抛错停止本场，不静默降级；停止时恢复开演前步态。
using System;

namespace ChoreoHelper;

public sealed class X1LocomotionSwitcher
{
    private readonly Func<X1MovementReferenceSnapshot?> _read;
    private readonly Action<bool> _write;
    private bool? _originalIsWalking;
    private bool? _expectedIsWalking;

    /// <summary>当前期望步态（null=尚未经本组件切换，沿用档案口径）。供镜头档案身份校验按期望值比对。</summary>
    public bool? ExpectedIsWalking => _expectedIsWalking;
    /// <summary>本组件是否切换过步态（决定停止时是否恢复）。</summary>
    public bool Switched => _originalIsWalking.HasValue;

    public X1LocomotionSwitcher(Func<X1MovementReferenceSnapshot?> read, Action<bool> write)
    {
        _read = read ?? throw new ArgumentNullException(nameof(read));
        _write = write ?? throw new ArgumentNullException(nameof(write));
    }

    /// <summary>把实际步行状态切到目标档（每段开始前调用）。首切记录原始档供停止恢复；任何失败抛错，不静默。</summary>
    public void Ensure(bool walking)
    {
        var before = _read();
        if (before?.IsWalking is not true and not false)
            throw new InvalidOperationException("步行状态读取失败或未知，不能自动切换走/跑；本场停止");
        if (before.IsWalking == walking) { _expectedIsWalking = walking; return; }
        _originalIsWalking ??= before.IsWalking;
        try { _write(walking); }
        catch (Exception ex) { throw new InvalidOperationException("步态切换写入失败：" + ex.Message, ex); }
        var after = _read();
        if (after?.IsWalking != walking)
            throw new InvalidOperationException("步态切换未生效（回读与目标不一致）；本场停止，请手动核对走路/跑步开关后重新开始");
        _expectedIsWalking = walking;
    }

    /// <summary>停止/结束时恢复开演前步态（仅恢复本组件切过的状态）；失败保留待恢复状态可重试，失败如实抛出不吞。</summary>
    public void Restore()
    {
        if (_originalIsWalking is not true and not false) { _expectedIsWalking = null; return; }
        var current = _read();
        if (current?.IsWalking is not true and not false)
            throw new InvalidOperationException("步态恢复读取失败；开演前步态未恢复，请手动核对走路/跑步开关");
        if (current.IsWalking != _originalIsWalking.Value)
        {
            try { _write(_originalIsWalking.Value); }
            catch (Exception ex) { throw new InvalidOperationException("步态恢复写入失败：" + ex.Message, ex); }
            if (_read()?.IsWalking != _originalIsWalking.Value)
                throw new InvalidOperationException("步态恢复未生效（回读不一致）；请手动核对走路/跑步开关");
        }
        _originalIsWalking = null;
        _expectedIsWalking = null;
    }
}
