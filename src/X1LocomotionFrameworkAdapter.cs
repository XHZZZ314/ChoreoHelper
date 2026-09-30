// 这个文件是干嘛的：步态切换的框架线程真实读写（TASK-20260919-PATH-LOCOMOTION）：
// 读复用 X1MovementReferenceReader（每次重取指针）；写 Control.Instance()->IsWalking（与读同一控制结构，
// 社区惯例等效于游戏内走路/跑步切换键）。直写效果待属主授权实机点验；不符时只换本适配器，切换器逻辑不动。
using System;
using FFXIVClientStructs.FFXIV.Client.Game.Control;

namespace ChoreoHelper;

public static unsafe class X1LocomotionFrameworkAdapter
{
    public static X1MovementReferenceSnapshot? Read()
    {
        try { return X1MovementReferenceReader.Read(); }
        catch { return null; }
    }

    public static void Write(bool walking)
    {
        var control = Control.Instance();
        if (control == null) throw new InvalidOperationException("游戏移动控制模块不可读，不能自动切换走/跑");
        control->IsWalking = walking;
    }
}
