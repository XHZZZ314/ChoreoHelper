// 这个文件是干嘛的：演出登记结果（包快照＋分发器＋就绪检查＋登记证据）。
// R2 原则最小实现：全部捐赠池无定义；按 UI ShowRunner（_registration.Cancel/Adopt/
// CheckReady/IsCurrent/Status/Package）与 X1GameRegistrationFactory 两处构造实现。
// CheckReady 转调构造传入的 check 委托；Cancel 置 IsCurrent=false；Status 即证据对象。
using System;

namespace ChoreoHelper;

public sealed class PreparedShowRegistration
{
    public PreparedShowRegistration(ShowPackage package, IShowDispatcher dispatcher, Action check, object? evidence)
    {
        Package = package;
        Dispatcher = dispatcher;
        Check = check;
        Evidence = evidence;
    }

    public ShowPackage Package { get; }
    public IShowDispatcher Dispatcher { get; }
    public Action Check { get; }
    public object? Evidence { get; }
    public bool IsCurrent { get; private set; } = true;
    public object? Status => Evidence;
    public void Adopt() => IsCurrent = true;
    public void Cancel() => IsCurrent = false;
    public void CheckReady() => Check();
}
