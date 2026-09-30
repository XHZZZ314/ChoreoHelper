using System;
using System.Collections.Generic;
using System.Linq;
using Dalamud.Plugin.Services;

namespace ChoreoHelper;

public sealed class PlaybackManager : IDisposable
{
    private readonly IPluginLog _log;
    private readonly IFramework _framework;
    private readonly GameCommandExecutor _executor;
    private readonly AnimationPoseFreezer _freezer;

    private List<PlaybackClip> _clips = new();
    private float _currentTime = 0;
    private bool _isPlaying = false;
    private float _speed = 1.0f;
    private HashSet<int> _executedClipIds = new();
    private readonly object _stateLock = new();   // 保护播放状态：HTTP 线程(Play/Stop/Seek)与游戏线程(Update)并发访问
    private long _lastUpdateTick;                  // 单调时钟(Environment.TickCount64)，避免 DateTime.Now 受改时影响
    private float _maxEnd;                         // 时间轴总长，SetTimeline 时缓存，避免每帧 LINQ
    private long _timelineRevision;        // 网页时间轴修订号（AUD2-003）：SetTimeline 时写入，seek 带来的版本号不一致即拒绝（409）
    private string _lastSeekSwitchCmd = ""; // 上次 seek 已执行过的切职业命令（AUD2-004）：重复拖动同一动作不重复切职业
    private const float PlaybackLead = 0.5f; // 播放提前量：补偿命令队列(200ms 节流)+游戏动画启动延迟，否则动作比时间轴偏晚
    private float _lastOwnActionEnd = -1f; // v0.6.6 归因窗口：最近一条自己执行过的动作条结束时刻(+5s)。窗口内 slot0 上的循环动作是自己放的，不是僵尸绑定
    private int _lastSeekClipId = -1; // restoration (used at Stop(); no donor)

    public bool IsPlaying => _isPlaying;
    public float CurrentTime => _currentTime;

    /// <summary>enriched /playback/status 用状态快照（GAMECLOCK）：一把锁里取齐 playing/time/
    /// revision/speed/maxEnd，避免 HTTP 线程读到撕裂组合（time 是新值而 speed 是旧值之类）。
    /// 采样戳（单调毫秒）由 HTTP 层取，纯载荷构造在 PlaybackStatusV2.BuildJson（datalayertest 直测）。</summary>
    public (bool Playing, float Time, long Revision, float Speed, float MaxEnd) StatusSnapshot()
    {
        lock (_stateLock)
        {
            return (_isPlaying, _currentTime, _timelineRevision, _speed, _maxEnd);
        }
    }

    public PlaybackManager(IPluginLog log, IFramework framework, GameCommandExecutor executor, AnimationPoseFreezer freezer)
    {
        _log = log;
        _framework = framework;
        _executor = executor;
        _freezer = freezer;
        _framework.Update += OnFrameworkUpdate;
    }

    private void OnFrameworkUpdate(IFramework framework)
    {
        lock (_stateLock)
        {
            if (!_isPlaying) return;

            var now = Environment.TickCount64;
            var delta = (float)(now - _lastUpdateTick) / 1000f * _speed;
            _lastUpdateTick = now;
            _currentTime += delta;

            foreach (var clip in _clips)
            {
                if (_executedClipIds.Contains(clip.Id)) continue;
                // 提前量发送：命令要过执行队列+游戏动画启动，到点才发必然偏晚；
                // 提前 PlaybackLead 发出，让动画实际起播时刻对上时间轴位置
                if (clip.Start <= _currentTime + PlaybackLead)
                {
                    ExecuteClip(clip);
                    _executedClipIds.Add(clip.Id);
                }
            }

            if (_currentTime >= _maxEnd)
            {
                _isPlaying = false;
                _currentTime = _maxEnd;
                _executor.Clear();   // 结束清空残留命令，防止停止后角色乱动
                _freezer.StopPreview();
                _log.Information("Playback finished at {time}s", _currentTime);
            }
        }
    }

    private void ExecuteClip(PlaybackClip clip)
    {
        try
        {
            if (string.IsNullOrEmpty(clip.Command)) return;
            // v0.6.6：归因窗口（上一条自己放过的动作条 +5s）内，slot0 上的循环动作是我们
            // 自己放的、还在正常播放——不是僵尸绑定。此时跳过解堵，让新命令自然接管角色，
            // 避免每个"循环舞→下一动作"的衔接都被 idle 重绑硬切一下站姿（主人实测报的闪回）。
            // 窗口外（播头一条、动作间隔很久、播放前就存在的旧绑定）才解堵，僵尸防堵语义不变。
            bool ownRecent = _lastOwnActionEnd >= _currentTime;
            if (!ownRecent)
            {
                // v0.6.5：发命令前解堵表情通道（僵尸绑定时命令会被去重拒收；正常状态内部直接跳过）
                _freezer.PrepareForPlaybackCommand();
            }
            _executor.ExecuteCommand(clip.Command);
            _lastOwnActionEnd = Math.Max(_lastOwnActionEnd, clip.Start + clip.Duration + 5f);
            _log.Information("Executed at {time}s: {cmd} (ownRecent={Own})", clip.Start, clip.Command, ownRecent);
        }
        catch (Exception ex)
        {
            _log.Error(ex, "ExecuteClip failed at {time}s", clip.Start);
        }
    }

    /// <summary>替换时间轴。播放中拒绝（返回 false，HTTP 层回 409）：SetTimeline 会清空
    /// _executedClipIds，播放中放行的话下一帧 OnFrameworkUpdate 会对所有
    /// Start <= currentTime+提前量的 clip 逐条补发历史命令（2026-08-31 审计 P0）。
    /// 网页侧 /playback/timeline 播放中默认不推；/playback/start 是唯一的替换+播放入口，
    /// 它紧跟着 Play()——在非播放态下替换，中间没有会补发命令的帧。</summary>
    public bool SetTimeline(List<PlaybackClip> clips, long revision)
    {
        lock (_stateLock)
        {
            if (_isPlaying)
            {
                _log.Warning("Timeline replace rejected: playback in progress (rev={rev})", revision);
                return false;
            }
            _clips = clips.OrderBy(c => c.Start).ToList();
            _maxEnd = _clips.Count > 0 ? _clips.Max(c => c.Start + c.Duration) : 0;
            _executedClipIds.Clear();
            _lastSeekSwitchCmd = "";
            _lastOwnActionEnd = -1f;   // 新时间轴：归因窗口清零
            _timelineRevision = revision;
            _log.Information("Timeline set with {count} clips, maxEnd={maxEnd}s, rev={rev}", _clips.Count, _maxEnd, revision);
            return true;
        }
    }

    /// <summary>插件当前接受的时间轴修订号（诊断用）。</summary>
    public long TimelineRevision => _timelineRevision;

    public void SetSpeed(float speed) => _speed = Math.Clamp(speed, 0.25f, 2.0f);

    /// <summary>开始播放。v0.7.1（AUD-012）返回是否进入播放态：时间轴为空返回 false，
    /// 不再静默 return 让 HTTP 层误报 status=playing。</summary>
    public bool Play(float fromTime = -1)
    {
        lock (_stateLock)
        {
            if (_clips.Count == 0) return false;
            // 播放中重复无参 Play：忽略（防止前端双击/连点导致重置重播）
            if (_isPlaying && fromTime < 0) return true;
            _freezer.StopPreview(); // 播放与定格互斥：退出定格，让角色自由表演
            _executor.Clear();       // 清空上一轮残留命令
            _executedClipIds.Clear();
            _lastSeekSwitchCmd = "";
            if (fromTime >= 0)
            {
                _currentTime = fromTime;
            }
            else if (_currentTime >= _maxEnd)
            {
                _currentTime = 0; // 播完后再点播放：从头开始
            }
            // 无论从头/指定点/暂停恢复：已完全结束的动作都标记为已执行，
            // 否则恢复播放的瞬间会把整串历史命令补发出去（200ms 节流下卡成一片）；
            // 正在播放中的动作（start <= t < start+duration）不标记，恢复时它会重新执行
            foreach (var clip in _clips)
            {
                if (clip.Start + clip.Duration <= _currentTime) _executedClipIds.Add(clip.Id);
            }
            _lastUpdateTick = Environment.TickCount64;
            _isPlaying = true;
            _log.Information("Playback started from {time}s", _currentTime);
            return true;
        }
    }

    public void Pause()
    {
        lock (_stateLock)
        {
            _isPlaying = false;
            _executor.Clear();
            _freezer.StopPreview();
            _log.Information("Playback paused at {time}s", _currentTime);
        }
    }

    public void Stop()
    {
        lock (_stateLock)
        {
            _isPlaying = false;
            _currentTime = 0;
            _executedClipIds.Clear();
            _lastSeekClipId = -1;
            _lastOwnActionEnd = -1f;   // 停止后归因窗口失效（角色可能已回到待机/被手动操作）
            _executor.Clear(); // 停止立即清空队列：防止残留命令继续执行/混入下次播放
            _freezer.StopPreview();
            _log.Information("Playback stopped");
        }
    }

    /// <summary>
    /// 预览式 Seek（AUD2-003/004）：跳到 t 时刻，按事件语义定格。
    /// revision：网页时间轴修订号。带值且与插件当前不一致 → 返回 false（HTTP 层回 409，
    /// 网页会重新同步快照后重试），绝不静默使用旧时间轴；不带值（旧网页过渡）按当前时间轴执行。
    /// 返回是否真正执行了 seek。
    /// </summary>
    public bool Seek(float time, long? revision = null)
    {
        lock (_stateLock)
        {
            return SeekLocked(time, revision);
        }
    }

    private bool SeekLocked(float time, long? revision)
    {
        if (revision.HasValue && revision.Value != _timelineRevision)
        {
            _log.Information("Seek rejected: revision {req} != {cur} (stale timeline)",
                revision.Value, _timelineRevision);
            return false;
        }
        _currentTime = Math.Max(0, time);
        _isPlaying = false;
        _executedClipIds.Clear();
        // 注意：这里不能 _executor.Clear() —— 定格器刚入队的动作命令可能还没过 200ms 节流，
        // 后续同动作的 seek（拖动时每 50ms 一发）会把它清掉，导致动作永远不执行（漏动作）。
        // 清队列由定格器在"命令切换"时自行处理。
        foreach (var clip in _clips)
        {
            if (clip.Start < _currentTime) _executedClipIds.Add(clip.Id);
        }

        // P2 修复：去掉后端 150ms 节流 —— 前端已有 150ms 节流 + 在途合并，
        // 后端再节流并丢弃最新位置会导致"拖到哪停就停在旧姿态"（最坏 ~300ms 不更新）。
        // 重复执行由 Freezer 的同命令 1.5s 去重挡住，这里每次都处理最新位置。

        // AUD2-004：事件语义收敛到纯函数 SeekPlanner——
        // 每位演员独立选出覆盖当前时刻的 action（歌词永不参与、不挤掉动作）；
        // switch 只解析成前置职业状态，不再当动画命令交给定格器。
        var events = new List<SeekEvent>(_clips.Count);
        foreach (var clip in _clips)
        {
            events.Add(new SeekEvent
            {
                Id = clip.Id,
                ActorId = clip.ActorId,
                Start = clip.Start,
                Duration = clip.Duration,
                Command = clip.Command,
                Type = clip.Type
            });
        }
        var plan = SeekPlanner.Plan(events, _currentTime);
        var sel = plan.Selected;

        if (sel?.Action == null)
        {
            // t 落在动作空隙：停止定格，不回放上一个已结束的动作
            _freezer.RequestStopPreview(); // 拖动流中的空隙也要延迟停止（立即恢复速度会让旧动画在拖动中乱播）
            _log.Information("Seeked to {time}s (no active action, rev={rev})", _currentTime, _timelineRevision);
            return true;
        }

        var action = sel.Action;
        // 前置职业状态：命令与上次 seek 已发过的不同才执行一次（重复拖动同一动作不重复切职业；
        // 拖去别的动作再拖回来时职业已变，会重新执行正确的切换）
        var pre = sel.PreSwitch;
        if (pre != null && !string.IsNullOrEmpty(pre.Command) && pre.Command != _lastSeekSwitchCmd)
        {
            _executor.ExecuteCommand(pre.Command);
            _lastSeekSwitchCmd = pre.Command;
            _log.Information("Seek pre-switch at {time}s: {cmd}", _currentTime, pre.Command);
        }
        // 动作开始时刻 + 已播放时长 = 目标动画时间，定格到该姿态
        var inClipTime = Math.Max(0, _currentTime - action.Start);
        _freezer.RequestFreezePreview(action.Command, inClipTime);
        _log.Information("Seek freeze at {time}s -> {cmd} (anim t={t}s, actor={a}, rev={rev})",
            _currentTime, action.Command, inClipTime, action.ActorId, _timelineRevision);
        return true;
    }

    public void Dispose()
    {
        // FIX-E：卸载前先停播放（清命令队列+退定格），不让残留时间轴在关闭瞬间继续驱动角色；
        // Dispose 通常在框架线程上跑，StopPreview 就地执行。异常兜底保证订阅必然解除。
        try { Stop(); } catch { }
        _framework.Update -= OnFrameworkUpdate;
    }
}

public sealed class PlaybackClip
{
    public int Id { get; set; }
    public int ActorId { get; set; }   // 舞者下标（AUD2-004：事件带演员维度；全局歌词=-1）
    public float Start { get; set; }
    public float Duration { get; set; }
    public string Command { get; set; } = "";
    public string Type { get; set; } = "";
    public string Name { get; set; } = "";
}
