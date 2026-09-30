// 这个文件是干嘛的：ACTOR 包（2026-08-31）的纯策略——当前产品游戏内只有一位本地角色可演，
// 时间轴 payload 若混入多位舞者（ActorId>=0 且不同值）的事件，PlaybackManager 会把所有事件
// 都执行在这同一个角色上（ExecuteClip 不拆分、不映射演员），编舞被搅乱且不可复现。
// 本策略把「/playback/start 与 /playback/timeline 的 payload 只允许一位舞者」收敛成可测纯
// 函数：HttpServer 解析完 clips 后调用，违规回 400 并指路网页选择游戏预览舞者。
// 网页侧的对应过滤在 choreo-edit.js buildGameClips(previewActor)（test-edit.js 覆盖）；
// seek 侧 SeekPlanner 本就按演员分组，单演员 payload 下本地定格必是预览舞者。
// 将来多演员执行器（EXEC-CORE）落实 包演员→运行时角色 的显式映射后才放开本限制。
// 只依赖演员编号序列，不依赖 PlaybackClip 类型（PlaybackManager.cs 不进 datalayertest）。
namespace ChoreoHelper;

using System;
using System.Collections.Generic;

public static class PreviewActorPolicy
{
    /// <summary>校验时间轴 payload 的演员维度。返回 null=合法；否则返回给用户的中文错误。
    /// 规则：所有 ActorId&gt;=0 的条目必须同属一位舞者；-1（全局歌词）全体共享、不参与判定；
    /// 空/纯全局歌词序列合法（timeline 端点允许清空插件时间轴）。</summary>
    public static string? Validate(IEnumerable<int>? actorIds)
    {
        if (actorIds == null) return null;
        int actor = int.MinValue;
        foreach (var a in actorIds)
        {
            if (a < 0) continue; // 全局歌词 -1：全体共享
            if (actor == int.MinValue) { actor = a; continue; }
            if (a != actor)
            {
                return "时间轴里混入了多位舞者的事件。当前版本游戏内一次只能演一位游戏预览舞者：" +
                       "请在网页各舞者行头点「🎮 预览」只选一人后再播放/同步（网页与插件需同为本次更新的版本）";
            }
        }
        return null;
    }
}
