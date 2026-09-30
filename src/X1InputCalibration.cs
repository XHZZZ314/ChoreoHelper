// 这个文件是干嘛的：登记实际键位和实测响应；区分物理采样与整套自动响应，本层不按键、不推定接管通过。
using System;
using System.Collections.Generic;
using System.Linq;

namespace ChoreoHelper;

public enum X1Control { Forward, Back, StrafeLeft, StrafeRight, TurnLeft, TurnRight }

public interface IX1MovementFacingOwner { bool OwnsMovementFacing { get; } }

public sealed class X1KeyBindings
{
    private readonly byte[] _keys;
    public X1KeyBindings(IEnumerable<byte> keys)
    {
        _keys = keys.ToArray();
        if (_keys.Length != 6 || _keys.Where((k, i) => !(i is 2 or 3 && k == 0)).Any(k => !IsSupportedKey(k))
            || _keys.Where(k => k != 0).Distinct().Count() != _keys.Count(k => k != 0))
            throw new ArgumentException("前进、后退、左右转向需不同的无修饰单键；平移缺失可观测但不能完整走位");
    }
    public static bool IsSupportedKey(byte key) => key is >= 0x30 and <= 0x39 or >= 0x41 and <= 0x5A or >= 0x25 and <= 0x28;
    public byte this[X1Control control] => _keys[(int)control];
    public byte[] CopyKeys() => (byte[])_keys.Clone();
    public bool HasAllDirections => _keys.All(k => k != 0);
    public string Identity => string.Join("-", _keys);
}

public readonly record struct X1CalibrationPose(long TimeMs, ulong ActorId, uint Territory,
    double X, double Y, double Z, double RotationRad)
{
    public bool IsFinite => ActorId != 0 && Territory != 0 && double.IsFinite(X) && double.IsFinite(Y)
        && double.IsFinite(Z) && double.IsFinite(RotationRad);
}

public sealed record X1CalibrationSample(X1Control Control, double LocalXPerSecond,
    double LocalZPerSecond, double DegreesPerSecond, long DurationMs, double DistanceM, string Source = "Physical");

public sealed class X1InputCalibration
{
    public const long MinSampleMs = 100, MaxSampleMs = 1000, MaxFrameGapMs = 100;
    public const double MaxDistanceM = 2, MaxAngleDeg = 90;
    private Dictionary<X1Control, X1CalibrationSample> _samples = new();
    private X1CalibrationPose? _start, _last;
    private X1Control? _pending;
    private ulong _actor;
    private uint _territory;
    private string _bindingIdentity = "";
    private X1KeyBindings? _bindings;
    public X1Control? Pending => _pending;
    public bool Sampling => _start.HasValue;
    public string Message { get; private set; } = "尚未登记实际键位和校准";
    public X1CalibrationSample[] Samples => _samples.Values.OrderBy(x => x.Control).ToArray();
    public bool RequiresTurnThenMove => _bindings != null && !_bindings.HasAllDirections;
    public string Source => _samples.Count == 0 ? "None" : _samples.Values.Select(s => s.Source).Distinct().Count() == 1
        ? _samples.Values.First().Source : "Mixed";
    public int RequiredSamples => RequiresTurnThenMove ? 3 : 6;
    private X1Control[] RequiredControls => RequiresTurnThenMove
        ? new[] { X1Control.Forward, X1Control.TurnLeft, X1Control.TurnRight }
        : Enum.GetValues<X1Control>();
    public bool Complete => _bindings != null && RequiredControls.All(_samples.ContainsKey) && _samples[X1Control.TurnLeft].DegreesPerSecond
        * _samples[X1Control.TurnRight].DegreesPerSecond < 0 && HasDirectionCoverage();
    private bool HasDirectionCoverage()
    {
        double Dot(X1Control a, X1Control b)
        {
            var x = _samples[a]; var y = _samples[b];
            var dot = x.LocalXPerSecond * y.LocalXPerSecond + x.LocalZPerSecond * y.LocalZPerSecond;
            return dot / Math.Sqrt((x.LocalXPerSecond * x.LocalXPerSecond + x.LocalZPerSecond * x.LocalZPerSecond)
                * (y.LocalXPerSecond * y.LocalXPerSecond + y.LocalZPerSecond * y.LocalZPerSecond));
        }
        return RequiresTurnThenMove || Dot(X1Control.Forward, X1Control.Back) < -0.9
            && Dot(X1Control.StrafeLeft, X1Control.StrafeRight) < -0.9 && Math.Abs(Dot(X1Control.Forward, X1Control.StrafeLeft)) < 0.25;
    }

    public void Reset(X1KeyBindings bindings, X1CalibrationPose pose)
    {
        if (!pose.IsFinite) throw new ArgumentException("角色位置不可用");
        _actor = pose.ActorId; _territory = pose.Territory; _bindingIdentity = bindings.Identity; _bindings = bindings;
        _samples.Clear(); Cancel("已登记本次会话键位；需要取得 " + RequiredSamples + " 个方向响应");
    }
    public bool Matches(X1KeyBindings bindings, X1CalibrationPose pose) => pose.IsFinite
        && pose.ActorId == _actor && pose.Territory == _territory && bindings.Identity == _bindingIdentity;
    public void Begin(X1Control control)
    {
        if (!Enum.IsDefined(control)) throw new ArgumentOutOfRangeException(nameof(control));
        if (_bindings != null && _bindings[control] == 0) throw new InvalidOperationException("此方向未绑定，不能测量");
        if (_bindingIdentity.Length == 0) throw new InvalidOperationException("请先登记键位");
        _samples.Remove(control); _pending = control; _start = _last = null;
        Message = "等待本人单独按住指定键约 0.1–0.3 秒再松开；仅测量，不代按";
    }
    public void Cancel(string reason) { _pending = null; _start = _last = null; Message = reason; }
    public void Invalidate(string reason) { _samples.Clear(); _bindingIdentity = ""; _bindings = null; Cancel(reason); }

    /// <summary>宿主先确认全松成功，再调用本方法；失败保留原整套响应，不伪造本人校准或接管通过。</summary>

    // 传入真实观测和物理按住状态；一帧断档、换人换图或键位变化都作废，绝不外推缺失数据。
    // era-reconciliation restore (donor-exact; deps X1AutomaticResponseResult/Probe/SignedDegrees present).
    public (bool Ok, string Error) TryAdoptAutomatic(X1AutomaticResponseResult? result, X1KeyBindings bindings, X1CalibrationPose pose)
    {
        if (result == null || result.Source != "Automatic" || bindings == null || !pose.IsFinite
            || bindings.Identity != result.BindingIdentity || pose.ActorId != result.FinishedPose.ActorId || pose.Territory != result.FinishedPose.Territory)
            return (false, "自动响应结果缺失或角色、区域、键位已改变，原响应未替换");
        var age = pose.TimeMs - result.FinishedPose.TimeMs;
        var dx = pose.X - result.FinishedPose.X; var dz = pose.Z - result.FinishedPose.Z;
        if (pose.TimeMs < result.FinishedPose.TimeMs || age > 1000 || !double.IsFinite(dx * dx + dz * dz)
            || dx * dx + dz * dz > .01 || Math.Abs(pose.Y - result.FinishedPose.Y) > .1
            || Math.Abs(X1AutomaticResponseProbe.DeltaAngle(pose.RotationRad, result.FinishedPose.RotationRad)) > 3)
            return (false, "自动响应结束后时刻或位置已经变化，原响应未替换");
        var candidate = new X1InputCalibration(); candidate.Reset(bindings, pose);
        var expected = candidate.RequiredControls;
        var replacement = new Dictionary<X1Control, X1CalibrationSample>();
        foreach (var sample in result.Samples)
        {
            if (sample.Source != "Automatic" || !expected.Contains(sample.Control) || !replacement.TryAdd(sample.Control, sample)
                || !double.IsFinite(sample.LocalXPerSecond) || !double.IsFinite(sample.LocalZPerSecond) || !double.IsFinite(sample.DegreesPerSecond)
                || !double.IsFinite(sample.DistanceM) || sample.DurationMs < MinSampleMs || sample.DurationMs > MaxSampleMs
                || sample.DistanceM < 0 || sample.DistanceM > MaxDistanceM)
                return (false, "自动响应样本无效，原响应未替换");
            var turn = sample.Control is X1Control.TurnLeft or X1Control.TurnRight;
            if (turn ? sample.DistanceM > .05 || Math.Abs(sample.DegreesPerSecond) * sample.DurationMs / 1000 < 2
                : sample.DistanceM < .05 || Math.Abs(sample.DegreesPerSecond) * sample.DurationMs / 1000 > 3)
                return (false, "自动响应没有可靠的单方向效果，原响应未替换");
        }
        candidate._samples = replacement;
        if (replacement.Count != expected.Length || !candidate.Complete)
            return (false, "自动响应未完整通过所有必需方向，原响应未替换");
        // 从此处开始只有无回调的内存赋值；验证失败从未触碰原集合。
        _actor = pose.ActorId; _territory = pose.Territory; _bindings = bindings; _bindingIdentity = bindings.Identity;
        _samples = replacement;
        Cancel("自动短响应已整体采用（Automatic）；用于坐标闭环方向选择，物理接管仍须单独验证");
        return (true, "");
    }

    public void Observe(X1KeyBindings bindings, X1CalibrationPose pose, bool keyHeld, bool onlyRequestedKeyHeld, bool anyPhysicalHeld)
    {
        if (!Matches(bindings, pose)) { Invalidate("角色、地图、键位或位置观测变化，请重新登记"); return; }
        if (!_pending.HasValue) return;
        if (!_start.HasValue)
        {
            if (!keyHeld) { if (anyPhysicalHeld) Cancel("出现其他输入，请松开全部按键后重试"); return; }
            if (!onlyRequestedKeyHeld) { Cancel("必须单独按指定键，不能同时按其他键或鼠标"); return; }
            _start = _last = pose; Message = "正在测量，松开指定键结束"; return;
        }
        if (pose.TimeMs <= _last!.Value.TimeMs || pose.TimeMs - _last.Value.TimeMs > MaxFrameGapMs)
        { Cancel("帧间隔不可靠，本次测量作废"); return; }
        var start = _start.Value;
        var elapsed = pose.TimeMs - start.TimeMs;
        var dx = pose.X - start.X; var dz = pose.Z - start.Z;
        var distance = Math.Sqrt(dx * dx + dz * dz);
        var angle = SignedDegrees((pose.RotationRad - start.RotationRad) * 180 / Math.PI);
        if (elapsed > MaxSampleMs || distance > MaxDistanceM || Math.Abs(angle) > MaxAngleDeg || Math.Abs(pose.Y - start.Y) > 0.15)
        { Cancel("超出短距离／时间／高度测量范围，本次作废；请自行松键"); return; }
        var turning = _pending.Value is X1Control.TurnLeft or X1Control.TurnRight;
        if (turning ? distance > 0.05 : Math.Abs(angle) > 3)
        { Cancel("采样中出现移动／转向混合，不能用于按键校准"); return; }
        if (keyHeld && !onlyRequestedKeyHeld || !keyHeld && anyPhysicalHeld)
        { Cancel("同时出现其他输入，本次测量作废"); return; }
        _last = pose;
        if (keyHeld) return;
        var control = _pending.Value;
        if (elapsed < MinSampleMs) { Cancel("按键时间太短，未获得可靠测量"); return; }
        var seconds = elapsed / 1000.0;
        if (control is X1Control.TurnLeft or X1Control.TurnRight)
        {
            if (distance > 0.05 || Math.Abs(angle) < 2) { Cancel("转向采样发生位移或转角不足，不能当作转向校准"); return; }
            var opposite = control == X1Control.TurnLeft ? X1Control.TurnRight : X1Control.TurnLeft;
            if (_samples.TryGetValue(opposite, out var other) && angle * other.DegreesPerSecond >= 0)
            { Cancel("左右转向实测同向，不能使用这组键位"); return; }
        }
        else if (distance < 0.05 || Math.Abs(angle) > 3)
        { Cancel("移动采样距离不足或角色随键转向；当前控制方式尚未支持"); return; }
        var cos = Math.Cos(start.RotationRad); var sin = Math.Sin(start.RotationRad);
        _samples[control] = new(control, (dx * cos - dz * sin) / seconds,
            (dx * sin + dz * cos) / seconds, angle / seconds, elapsed, distance);
        Cancel(Complete ? "所需方向短采样齐全；仍需闭环走位、停止和接管验证，演出准入未开启" : "此方向测量已保存；继续其余方向");
    }

    public static double SignedDegrees(double angle) => ((angle + 180) % 360 + 360) % 360 - 180;


    // 世界误差先转入角色坐标，再选择实测效果最接近的单个移动键；没有对角速度证据就不合按。
    public X1Control? SelectMovement(double dx, double dz, double rotationRad)
    {
        if (!Complete || !double.IsFinite(dx) || !double.IsFinite(dz) || !double.IsFinite(rotationRad))
            throw new InvalidOperationException("实际键位效果尚未校准，不能输出移动");
        var length = Math.Sqrt(dx * dx + dz * dz);
        if (!double.IsFinite(length)) throw new InvalidOperationException("移动误差无效");
        if (length < 0.025) return null;
        var cos = Math.Cos(rotationRad); var sin = Math.Sin(rotationRad);
        var localX = dx * cos - dz * sin; var localZ = dx * sin + dz * cos;
        X1Control? best = null; double bestDot = 0.5;
        foreach (var sample in _samples.Values.Where(s => s.Control <= X1Control.StrafeRight))
        {
            var speed = Math.Sqrt(sample.LocalXPerSecond * sample.LocalXPerSecond + sample.LocalZPerSecond * sample.LocalZPerSecond);
            var dot = (localX * sample.LocalXPerSecond + localZ * sample.LocalZPerSecond) / (length * speed);
            if (dot > bestDot) { bestDot = dot; best = sample.Control; }
        }
        if (!best.HasValue) throw new InvalidOperationException("实测键位不能覆盖目标方向");
        return best;
    }
    public X1Control? SelectTurn(double targetDeg, double rotationRad)
    {
        if (!Complete || !double.IsFinite(targetDeg) || !double.IsFinite(rotationRad))
            throw new InvalidOperationException("实际转向效果尚未校准，不能输出转向");
        var delta = SignedDegrees(targetDeg - rotationRad * 180 / Math.PI);
        if (Math.Abs(delta) < 5) return null;
        return delta * _samples[X1Control.TurnLeft].DegreesPerSecond > 0 ? X1Control.TurnLeft : X1Control.TurnRight;
    }
}
