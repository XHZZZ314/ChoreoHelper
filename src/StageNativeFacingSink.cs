// 这个文件是干嘛的：路径外身体朝向原生输出边界；复用演出时钟，不持键、不写位置。
using System;
using System.Collections.Generic;

namespace ChoreoHelper;

public sealed class StageNativeFacingSink : IX1FacingSink
{
    private readonly HashSet<string> _events;
    private readonly HashSet<string> _released = new(StringComparer.Ordinal);
    private readonly Action _check;
    private readonly Action<float> _writeRadians;
    private bool _active;
    public StageNativeFacingSink(IEnumerable<string> events, Action check, Action<float> writeRadians)
    { _events = new(events, StringComparer.Ordinal); _check = check; _writeRadians = writeRadians; }
    public void Begin() { _check(); _released.Clear(); _active = true; }
    public void Stop() { _active = false; }
    public void EmitFacing(string eventId, double angleDeg, long showTimeMs)
    {
        if (!_active || !_events.Contains(eventId) || _released.Contains(eventId)
            || !double.IsFinite(angleDeg) || showTimeMs < 0)
            throw new InvalidOperationException("原生朝向事件无效、已释放或场次已停止");
        _check();
        var radians = (float)(X1MovementExecutor.NormalizeDeg(angleDeg) * Math.PI / 180);
        _writeRadians(radians); // 返回仅代表调用结束，不宣称服务端或可见身体效果。
    }
    public void ReleaseFacing(string eventId) => _released.Add(eventId);
}
