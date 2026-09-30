// 链式路径演出分发：一次武装、按段在原演出时钟开启反馈会话；段间交接有限额，超时不追赶、诚实失败。不支持混排或独立朝向。
using System;
using System.Collections.Generic;
using System.Linq;

namespace ChoreoHelper;

public sealed class StagePathShowDispatcher : IShowDispatcher, IX1ActiveUpdater, IShowClockBinding
{
    /// <summary>段间交接预算：上一段未在此预算内释放输入即整场失败；不追赶、不改写原时序。</summary>
    public const long HandoffBudgetMs = 1000;
    private readonly X1CameraPathPlan[] _plans;
    private readonly Action _arm, _check, _stop;
    private readonly Action<int,long> _begin;
    private readonly Func<(bool Active, bool Completed, string Message)> _tick;
    private readonly Func<bool> _cleanupFailed;
    private readonly bool[] _dispatched;
    private bool _owned;
    private int _stopVersion;
    private int _nextIndex, _activeIndex = -1;
    private long? _start;
    public StagePathShowDispatcher(X1CameraPathPlan plan, Action arm, Action check, Action stop,
        Action<long> begin, Func<(bool Active, bool Completed, string Message)> tick, Func<bool>? cleanupFailed = null)
        : this(new[]{plan ?? throw new ArgumentNullException(nameof(plan))}, arm, check, stop, (_,start)=>begin(start), tick, cleanupFailed) { }
    public StagePathShowDispatcher(X1CameraPathPlan[] plans, Action arm, Action check, Action stop,
        Action<int,long> begin, Func<(bool Active, bool Completed, string Message)> tick, Func<bool>? cleanupFailed = null)
    {
        if (plans==null || plans.Length==0 || plans.Any(p=>p==null)) throw new ArgumentException("缺少明确的路径段", nameof(plans));
        _plans=plans;_arm=arm;_check=check;_stop=stop;_begin=begin;_tick=tick;_cleanupFailed=cleanupFailed ?? (()=>false);
        _dispatched=new bool[_plans.Length];
    }
    public void OnShowStart()
    {
        if (_owned) throw new InvalidOperationException("路径仍占用输入，先明确停止");
        _arm(); _owned=true; _start=null;
        for(var i=0;i<_dispatched.Length;i++)_dispatched[i]=false;
        _nextIndex=0;_activeIndex=-1;
    }
    public void BindShowClock(long startMonoMs)
    {
        if (!_owned || _start.HasValue || startMonoMs<0) throw new InvalidOperationException("路径演出时钟身份无效");
        _check(); _start=startMonoMs;
    }
    public ShowDispatchResult Dispatch(ShowEvent e)
    {
        _check();
        if (!_owned || !_start.HasValue || e.Kind!="movement") return ShowDispatchResult.Fail("本次仅接收已审阅的路径段");
        var index=Array.FindIndex(_plans,p=>p.EventId==e.Id && p.SourceStartMs==e.StartMs && p.DurationMs==e.DurationMs);
        if (index<0 || _dispatched[index]) return ShowDispatchResult.Fail("本次仅接收已审阅的原始路径段，重复即拒绝");
        _dispatched[index]=true;return ShowDispatchResult.Success();
    }
    public (bool Ok, string Error, List<X1SkipRecord>? Skips, string FailedEventId) UpdateActive(long showTimeMs)
    {
        var stopVersion = _stopVersion;
        // 在回调之前捕获明确归属；空闲期的全局检查失败不得猜给邻近事件。
        var owner = _activeIndex >= 0 ? _plans[_activeIndex].EventId
            : _nextIndex < _plans.Length && _dispatched[_nextIndex] && showTimeMs >= _plans[_nextIndex].SourceStartMs
                ? _plans[_nextIndex].EventId : "";
        try
        {
            _check();
            if (stopVersion != _stopVersion) return (true,"",null,"");
            if (!_owned || !_start.HasValue) return (false,"路径未收到本场调度",null,"");
            if (_activeIndex>=0)
            {
                var active=_plans[_activeIndex];
                if (showTimeMs>active.SourceStartMs+active.DurationMs+HandoffBudgetMs)
                    return (false,"路径段「"+active.EventId+"」未在交接预算内释放输入；不追赶，本场失败",null,active.EventId);
                var running=_tick();
                if (stopVersion != _stopVersion || !_owned) return (true,"",null,"");
                if (running.Active) return (true,"",null,"");
                if (!running.Completed) return (false,running.Message,null,active.EventId);
                _activeIndex=-1;
            }
            if (_nextIndex>=_plans.Length) return (true,"",null,"");
            var next=_plans[_nextIndex];
            if (!_dispatched[_nextIndex])
                return _nextIndex==0 ? (false,"路径未收到本场调度",null,"") : (true,"",null,"");
            if (showTimeMs<next.SourceStartMs) return (true,"",null,"");
            owner=next.EventId;
            _begin(_nextIndex,checked(_start.Value+next.SourceStartMs));
            if (stopVersion != _stopVersion || !_owned) return (true,"",null,"");
            _activeIndex=_nextIndex;_nextIndex++;
            var result=_tick();
            if (stopVersion != _stopVersion || !_owned) return (true,"",null,"");
            return result.Active || result.Completed ? (true,"",null,"") : (false,result.Message,null,next.EventId);
        }
        catch (Exception ex) { return (false,ex.Message,null,owner); }
    }

    public void OnStop()
    {
        if (!_owned)return;
        // 先使在途更新失效；即使清理抛错仍禁止追加路径输出。
        _stopVersion++;
        if (_cleanupFailed()) throw new InvalidOperationException("路径清理已失败，自动收尾不得再试；请明确点击立即停止重试清理");
        _stop();_owned=false;_start=null;_nextIndex=0;_activeIndex=-1;
        for(var i=0;i<_dispatched.Length;i++)_dispatched[i]=false;
    }
}
