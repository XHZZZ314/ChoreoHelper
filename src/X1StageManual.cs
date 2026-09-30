// 这个文件是干嘛的：人工协同输入模式（打断 vs 协同）与协同键位集合。
// 协同仅允许与自动三键不重叠的后退和平移；其他物理输入仍停场。
using System;
using System.Linq;

namespace ChoreoHelper;

public enum StageManualMode { Interrupt, Cooperate }

public sealed class StageManualControl
{
    public bool Yielding { get; set; }
    public static byte[] SupportedKeys(X1KeyBindings bindings)
        => new[]{bindings[X1Control.Back],bindings[X1Control.StrafeLeft],bindings[X1Control.StrafeRight]}
            .Where(k=>k!=0 && k!=bindings[X1Control.Forward] && k!=bindings[X1Control.TurnLeft] && k!=bindings[X1Control.TurnRight]).Distinct().ToArray();
}
