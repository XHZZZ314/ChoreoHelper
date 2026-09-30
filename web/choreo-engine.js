/**
 * choreoEngine.js — ChoreoHelper 网页预览引擎 v0.1
 * 作者 AI 直接开工的第一批代码。
 *
 * 职责：
 *  - 自定义动画格式（AnimationClip）的采样（四元数 slerp + 位移插值）
 *  - 动画状态机：once（播完回待机）/ loop（循环）/ chain（链式序列）
 *  - 多角色实例：多个角色共享一个播放头（多人同屏编舞验证）
 *  - 播放控制：seek / play / pause / setSpeed / 播放头时钟
 *
 * 设计原则（作者 AI 从 20 版游戏内对抗中提炼）：
 *  - 渲染器时钟完全在网页端 → 任意 seek 天生免费
 *  - 状态机只做三件事：播放、循环、回待机 —— 不再对抗任何外部系统
 *  - 数据格式与 S3 快照同构，导出器产出什么引擎就吃什么
 */

(function (global) {
  'use strict';

  // ============ 1. 动画数据格式 ============
  // AnimationClip = {
  //   name: string,
  //   duration: number,          // 秒
  //   type: 'once' | 'loop' | 'chain',
  //   chainNext: string|null,    // type=chain 时的下一段 clip 名
  //   chainAt: number,           // 当前段播到该秒数时接下一段
  //   bones: {                   // 骨骼名 → 通道
  //     [boneName]: {
  //       q: [ [t, x, y, z, w], ... ],   // 四元数关键帧（绝对旋转，相对父骨骼）
  //       t: [ [t, x, y, z], ... ],      // 可选位移关键帧
  //       s: [ [t, x, y, z], ... ]       // 可选正缩放关键帧（旧素材省略时保持模型原值）
  //     }
  //   }
  // }
  //
  // 作者备注：q 关键帧用绝对旋转（相对父骨骼的局部旋转），导出器直接写 pap 的
  // 原始轨迹数据；网页端不做任何层级矩阵求逆 —— 与游戏内做法一致（局部变换驱动）。

  // ============ 2. Clip 采样器 ============
  const _q0 = { x:0, y:0, z:0, w:1 };
  const _qTmp = { x:0, y:0, z:0, w:1 };
  const _qRes = { x:0, y:0, z:0, w:1 };
  function _slerp(a, b, t, out) {
    let cos = a.x*b.x + a.y*b.y + a.z*b.z + a.w*b.w;
    let flip = 1;
    if (cos < 0) { cos = -cos; flip = -1; }
    let s0, s1;
    if (cos > 0.9995) { s0 = 1 - t; s1 = t * flip; }
    else {
      const omega = Math.acos(cos);
      const sin = Math.sin(omega);
      s0 = Math.sin((1 - t) * omega) / sin;
      s1 = Math.sin(t * omega) / sin * flip;
    }
    out.x = a.x*s0 + b.x*s1; out.y = a.y*s0 + b.y*s1;
    out.z = a.z*s0 + b.z*s1; out.w = a.w*s0 + b.w*s1;
    // 近角度线性近似必须归一化，否则分数帧会把非单位四元数写到骨骼。
    if (cos > 0.9995) {
      const length = Math.hypot(out.x, out.y, out.z, out.w);
      out.x /= length; out.y /= length; out.z /= length; out.w /= length;
    }
    return out;
  }
  // 二分段查找：keys 按时间升序，返回首条 keys[i][0] >= t 的下标。调用方已用边界分支
  // 处理 t<=首帧 / t>=末帧，此处 t 严格介于首末帧之间，返回值恒在 [1, len-1]，
  // 选出的 (a,b) 段与旧线性扫描"第一条 t<=b[0]"逐字等价（含 t 恰落关键帧时 f=1 取段）。
  // 101 骨 × N 舞者 × 60fps 的采样热路径从 O(N) 降为 O(logN)。
  function _findSeg(keys, t) {
    let lo = 0, hi = keys.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (keys[mid][0] < t) lo = mid + 1; else hi = mid;
    }
    return lo;
  }
  // 免录制素材可带缩放。入库/播放边界先验证全通道，禁止把错误值写入渲染骨骼。
  function validateScaleChannels(clip) {
    // 起始段是可选的 v1 本地预览扩展；未知版本/嵌套/错误时长不准静默退回循环。
    if (clip && clip.intro !== undefined) {
      const intro = clip.intro;
      if (clip.type !== 'loop' || !Number.isFinite(clip.duration) || clip.duration <= 0 ||
          !intro || intro.version !== 1 || intro.type !== 'once' || intro.intro !== undefined ||
          !Number.isFinite(intro.duration) || intro.duration <= 0 ||
          !intro.bones || typeof intro.bones !== 'object' || !Object.keys(intro.bones).length) {
        throw new Error('动作起始段无效或版本不受支持');
      }
      for (const name of Object.keys(intro.bones)) {
        const channels = intro.bones[name];
        if (!channels || !Array.isArray(channels.q) || !channels.q.length) throw new Error('动作起始段旋转通道无效：' + name);
        for (const key of ['q', 't']) {
          if (key === 't' && channels[key] === undefined) continue;
          const rows = channels[key];
          let previous = -1;
          if (!Array.isArray(rows) || !rows.length) throw new Error('动作起始段通道无效：' + name);
          for (const row of rows) {
            if (!Array.isArray(row) || row.length !== (key === 'q' ? 5 : 4) || !row.every(Number.isFinite) ||
                row[0] < 0 || row[0] <= previous || row[0] > intro.duration + 1e-6 ||
                (key === 'q' && Math.hypot(...row.slice(1)) < 1e-12)) throw new Error('动作起始段关键帧无效：' + name);
            previous = row[0];
          }
        }
      }
      validateScaleChannels(intro);
    }
    for (const name in (clip.bones || {})) {
      const ch = clip.bones[name];
      if (!ch || ch.s === undefined) continue;
      const keys = ch.s;
      if (!Array.isArray(keys) || !keys.length) throw new Error('动作缩放通道无效：' + name);
      let previous = -1;
      for (const key of keys) {
        if (!Array.isArray(key) || key.length !== 4 || !key.every(Number.isFinite) ||
            key[0] < 0 || key[0] <= previous || key.slice(1).some(v => v <= 0)) {
          throw new Error('动作缩放关键帧无效：' + name);
        }
        previous = key[0];
      }
    }
    return clip;
  }
  function sampleScale(keys, t, out) {
    if (!Array.isArray(keys) || !keys.length) throw new Error('动作缩放通道无效');
    let a = keys[0], b = a, f = 0;
    if (t >= keys[keys.length - 1][0]) a = b = keys[keys.length - 1];
    else if (t > a[0]) {
      const i = _findSeg(keys, t);
      a = keys[i - 1]; b = keys[i]; f = (t - a[0]) / (b[0] - a[0]);
    }
    for (const key of [a, b]) if (!Array.isArray(key) || key.length !== 4 ||
        !key.every(Number.isFinite) || key.slice(1).some(v => v <= 0)) throw new Error('动作缩放关键帧无效');
    out.sx = a[1] + (b[1] - a[1]) * f;
    out.sy = a[2] + (b[2] - a[2]) * f;
    out.sz = a[3] + (b[3] - a[3]) * f;
    if (![out.sx, out.sy, out.sz].every(Number.isFinite)) throw new Error('动作缩放插值无效');
  }
  // 旧素材仍只返回原有七个分量；只有显式 s 通道才增加 sx/sy/sz。
  function sampleClip(clip, t) {
    const pose = {};
    for (const boneName in clip.bones) {
      const ch = clip.bones[boneName];
      if (!ch) continue;
      const out = { qx:0, qy:0, qz:0, qw:1, tx:0, ty:0, tz:0 };
      const qk = ch.q, tk = ch.t;
      if (qk && qk.length) {
        if (t <= qk[0][0]) { out.qx=qk[0][1]; out.qy=qk[0][2]; out.qz=qk[0][3]; out.qw=qk[0][4]; }
        else if (t >= qk[qk.length-1][0]) { const l=qk[qk.length-1]; out.qx=l[1]; out.qy=l[2]; out.qz=l[3]; out.qw=l[4]; }
        else {
          const i=_findSeg(qk, t), a=qk[i-1], b=qk[i];
          const f = (t-a[0]) / (b[0]-a[0] || 1e-6);
          _q0.x=a[1]; _q0.y=a[2]; _q0.z=a[3]; _q0.w=a[4];
          _qTmp.x=b[1]; _qTmp.y=b[2]; _qTmp.z=b[3]; _qTmp.w=b[4];
          _slerp(_q0, _qTmp, f, _qRes);
          out.qx=_qRes.x; out.qy=_qRes.y; out.qz=_qRes.z; out.qw=_qRes.w;
        }
      }
      if (tk && tk.length) {
        if (t <= tk[0][0]) { out.tx=tk[0][1]; out.ty=tk[0][2]; out.tz=tk[0][3]; }
        else if (t >= tk[tk.length-1][0]) { const l=tk[tk.length-1]; out.tx=l[1]; out.ty=l[2]; out.tz=l[3]; }
        else {
          const i=_findSeg(tk, t), a=tk[i-1], b=tk[i];
          const f = (t-a[0]) / (b[0]-a[0] || 1e-6);
          out.tx = a[1]+(b[1]-a[1])*f; out.ty = a[2]+(b[2]-a[2])*f; out.tz = a[3]+(b[3]-a[3])*f;
        }
      }
      if (ch.s !== undefined) sampleScale(ch.s, t, out);
      pose[boneName] = out;
    }
    return pose;
  }

  // clipTime 包含起始段时间；只有循环阶段回卷，原始两个片段的关键帧都不改写。
  function samplePlaybackClip(clip, time) {
    const intro = clip.intro;
    const part = intro && time < intro.duration ? intro : clip;
    const local = intro && part === clip ? time - intro.duration : time;
    return sampleClip(part, Math.max(0, Math.min(local, part.duration - 1e-3)));
  }

  // ============ 3. 角色状态机（每个角色一个） ============
  // 状态：idle（待机循环）| playing（动作中）| blending（回待机混合）
  class Character {
    constructor({ name, bones, applyFn, idleClip, baseScales }) {
      this.name = name;
      this.bones = bones;                 // { boneName: { name } } 由集成方提供骨骼注册表
      this.baseScales = baseScales || {};  // 渲染器捕获的原始模型缩放，旧素材切回时使用
      this.applyFn = applyFn;             // (boneName, pose) => 写入实际模型骨骼
      this.idleClip = idleClip || null;
      this.state = 'idle';
      this.currentClip = null;
      this.clipTime = 0;
      this.blendFrom = null;              // 正在混合的上一段 pose
      this.blendT = 0;
      this.BLEND = 0.3;                   // 混合时长秒
      this.loop = false;                  // 当前 clip 是否循环（由 playClip 决定）
      this.globalT = 0;                   // 内部时钟（跟随引擎播放头）
      this.pose = {};
    }
    // clip: AnimationClip; opts: { loop?, blend? }
    playClip(clip, opts) {
      validateScaleChannels(clip);
      if (!clip) return;
      const o = opts || {};
      if (this.currentClip && this.currentClip !== clip && o.capture) {
        // 记录离开时的姿态用于混合（死亡切换也平滑）
        const p = samplePlaybackClip(this.currentClip, this.clipTime);
        this.blendFrom = p;
        this.blendT = 0;
      }
      this.currentClip = clip;
      this.clipTime = 0;
      this.loop = !!o.loop;
      this.state = 'playing';
      if (clip.type === 'chain') this.state = 'playing';
    }
    stopToIdle() {
      if (this.currentClip && this.currentClip !== this.idleClip) {
        this.blendFrom = samplePlaybackClip(this.currentClip, this.clipTime);
        this.blendT = 0;
      }
      this.currentClip = this.idleClip;
      this.clipTime = 0;
      this.loop = true;
      this.state = 'idle';
    }
    // 混合时钟按真实 dt 推进（v0.6.6：原来藏在 sample() 里按 1/60 走，
    // 显示器 30/60/144Hz 下混合时长会漂；scrubTo 的接缝混合不经这里，由 phase 直接定）
    advanceBlend(dt) {
      if (this.blendFrom == null) return;
      this.blendT += dt;
      if (this.blendT >= this.BLEND) this.blendFrom = null;
    }
    // dt 秒推进；返回事件（供引擎回调，如 chain 切换）
    update(dt, speed, outEvents) {
      const clip = this.currentClip;
      if (!clip) return;
      this.advanceBlend(dt * speed);
      const dur = clip.duration;
      const before = this.clipTime;
      this.clipTime += dt * speed;
      if (clip.intro) {
        const start = clip.intro.duration;
        if (this.clipTime >= start + dur) {
          this.clipTime = start + (this.clipTime - start) % dur;
          this.blendFrom = sampleClip(clip, Math.max(0, dur - 1e-3));
          this.blendT = this.clipTime - start;
        } else if (before < start && this.clipTime >= start) {
          this.blendFrom = sampleClip(clip.intro, Math.max(0, start - 1e-3));
          this.blendT = this.clipTime - start;
        }
        return;
      }
      // 链式：到达衔接点切下一段
      if (clip.type === 'chain' && clip.chainNext && clip.chainAt != null) {
        if (this.clipTime >= clip.chainAt) {
          outEvents.push({ kind:'chain', char: this.name, from: clip.name, to: clip.chainNext });
          this.clipTime -= clip.chainAt;
          // 注意：真正切 clip 由引擎事件处理统一做（保持本类无副作用）
          return;
        }
      }
      // 结束判定
      if (this.clipTime >= dur) {
        if (this.loop) {
          this.clipTime %= dur;
          // 循环回卷也走混合（2026-08-28）：剪裁后的 loop clip 接缝两端姿态仍有差
          // （实测最大 4~6cm 关节位移，集中在手指/手臂末端骨），硬跳会闪一下；
          // 捕获回卷前姿态，让 sample() 前 0.3s 平滑插值到新一周起点
          this.blendFrom = sampleClip(clip, dur - 1e-3);
          this.blendT = 0;
        } else if (this.state === 'playing') {
          this.state = 'blending';   // 走混合回待机
          this.blendFrom = sampleClip(clip, dur - 1e-3);
          this.blendT = 0;
          this.currentClip = this.idleClip;
          this.clipTime = 0;
          this.loop = true;
        }
      }
    }
    // 每帧采样并写入模型；返回应用到骨骼的 pose。
    // v0.6.6：纯采样——不再改任何状态（blendT 由 update()/引擎按真实 dt 推进），
    // 同一状态重复调用结果必须一致（回归测试盯这条）
    sample() {
      const clip = this.currentClip;
      if (!clip) return {};
      let pose = samplePlaybackClip(clip, this.clipTime);
      // 加载/回卷混合：新姿势与 blendFrom 姿态插值
      // （四元数必须 slerp——逐分量线性插值非单位长度，长链骨骼会隐性缩放/扭曲；位移线性即可）
      if (this.blendFrom && this.blendT < this.BLEND) {
        const f = Math.min(1, this.blendT / this.BLEND);
        for (const bn in pose) {
          if (this.blendFrom[bn] && this.bones[bn]) {
            const a = this.blendFrom[bn], b = pose[bn];
            _q0.x = a.qx; _q0.y = a.qy; _q0.z = a.qz; _q0.w = a.qw;
            _qTmp.x = b.qx; _qTmp.y = b.qy; _qTmp.z = b.qz; _qTmp.w = b.qw;
            _slerp(_q0, _qTmp, f, _qRes);
            // slerp 数学上保模长，归一化兜底录制数据偶发的轻微非单位四元数
            const inv = 1 / (Math.hypot(_qRes.x, _qRes.y, _qRes.z, _qRes.w) || 1);
            pose[bn] = {
              qx: _qRes.x * inv, qy: _qRes.y * inv, qz: _qRes.z * inv, qw: _qRes.w * inv,
              tx: a.tx + (b.tx - a.tx) * f,
              ty: a.ty + (b.ty - a.ty) * f,
              tz: a.tz + (b.tz - a.tz) * f,
            };
            if (a.sx !== undefined || b.sx !== undefined) {
              const base = this.baseScales[bn] || [1, 1, 1];
              ['sx', 'sy', 'sz'].forEach((key, i) => {
                const from = a[key] === undefined ? base[i] : a[key];
                const to = b[key] === undefined ? base[i] : b[key];
                pose[bn][key] = from + (to - from) * f;
              });
            }
          }
        }
      }
      return pose;
    }
  }

  // ============ 4. 引擎 ============
  // 游标不变量（ENGINE-CURSOR）：timelineIdx 恒为"当前引擎时刻第一条尚未触发的条目"下标——
  // start < t 的已随播放头过去，start == t 的仍待触发（与 update() 的 time >= start 触发条件一致）。
  // 任何改播放头的路径（scrubTo / seek / setTimeline / timeline 替换）都必须立即重新对齐，
  // 否则随后 play()+update() 会重放已过条目（前向 scrub）或漏触发（回拖）。
  // 稳定排序下，start 相同的同角色条目保持原有相对顺序（与旧线性扫描"取最后一个"逐字等价）
  function sortEntries(entries) {
    return entries.slice().sort((a, b) => a.start - b.start);
  }
  // 二分：list（按 start 升序）里最后一个 start <= t 的下标 +1；没有返回 0
  function upperBound(list, t) {
    let lo = 0, hi = list.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (list[mid].start <= t) lo = mid + 1; else hi = mid;
    }
    return lo;
  }
  // 二分：list 里第一条 start >= t 的下标（timelineIdx 对齐用：start < t 的已随播放头过去，
  // start == t 的仍属"待触发"——与 setTimeline 后 time=0、start=0 首帧触发的既有语义一致）
  function firstAtOrAfter(list, t) {
    let lo = 0, hi = list.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (list[mid].start < t) lo = mid + 1; else hi = mid;
    }
    return lo;
  }
  class PreviewEngine {
    constructor() {
      this.characters = [];       // Character[]
      this.clipLibrary = {};      // name → AnimationClip（全局库）
      this.playing = false;
      this.time = 0;              // 共享播放头（秒）
      this.speed = 1;
      this.lastTick = 0;
      this.events = [];           // 帧内事件队列
      this.onEvent = null;        // 回调：chain 切换等
      this._timeline = null;      // 全局条目（start 升序），经 timeline 访问器赋值
      this._byChar = null;        // AUD-018：按角色再分桶（升序），scrubTo 二分用
      this._scrubProbes = 0;      // AUD-018 诊断：最近一次 scrubTo 的二分比较次数（复杂度断言用）
    }
    // timeline 赋值入口：排序 + 建按角色索引，不动播放状态（preview3d 每次重排都走这里，
    // 不能像 setTimeline 那样清零播放头）。播放头对齐 timelineIdx：替换后 update() 既不重放
    // 旧条目也不漏触发（旧实现保留旧 idx，数组变短会错位）
    set timeline(entries) {
      this._timeline = entries ? sortEntries(entries) : null;
      this._byChar = null;
      if (this._timeline) {
        this._byChar = {};
        for (const e of this._timeline) {
          (this._byChar[e.char] || (this._byChar[e.char] = [])).push(e);
        }
        this.timelineIdx = firstAtOrAfter(this._timeline, this.time);
      } else {
        this.timelineIdx = 0;
      }
    }
    get timeline() { return this._timeline; }
    // 游标对齐：timelineIdx = 第一条 start >= 当前时间的条目（不变量见本节首注释）
    _alignCursor() {
      this.timelineIdx = this._timeline ? firstAtOrAfter(this._timeline, this.time) : 0;
    }
    registerClip(clip) { validateScaleChannels(clip); this.clipLibrary[clip.name] = clip; }
    addCharacter(cfg) {
      const c = new Character(cfg);
      this.characters.push(c);
      if (c.idleClip) c.stopToIdle();   // v0.2.1：创建即待机（否则 sample 空转）
      return c;
    }
    // 播放头操作（编舞拖动直接调这些）
    seek(t) {
      this.time = Math.max(0, t);
      this._alignCursor();
      // 每个角色的 clipTime 跟随共享播放头 + 各自 clip 起点对齐（由 setTimeline 定义）
      for (const c of this.characters) {
        const clip = c.currentClip, start = clip && clip.intro ? clip.intro.duration : 0;
        c.clipTime = this.time < start ? this.time : start + (this.time - start) % Math.max(clip ? clip.duration : 1, 1e-3);
      }
    }
    play() { this.playing = true; this.lastTick = performance.now(); }
    pause() { this.playing = false; }
    setSpeed(s) { this.speed = Math.max(0.1, Math.min(4, s)); }
    // 时间轴驱动：clips = [{ char, clipName, start, opts }]，按 start 排好
    setTimeline(entries) {
      this.time = 0;              // 先清播放头，再赋 timeline——访问器按当前 time 对齐游标
      this.timeline = entries;    // （顺序反了会用旧时间对齐出脏游标：time=0 而 idx>0）
      // 初始让每个角色回待机
      for (const c of this.characters) c.stopToIdle();
    }
    update(now) {
      let dt = (now - this.lastTick) / 1000;
      this.lastTick = now;
      if (dt > 0.1) dt = 0.1; // 丢帧保护

      // v0.2.1：播放推进与采样应用解耦 —— 暂停（拖动 scrub）时
      // 也必须每帧采样当前 clipTime 并写骨骼，否则拖动无反馈。
      if (this.playing) {
        this.time += dt * this.speed;
        // 时间轴触发：到点的 entry 播放
        if (this._timeline) {
          while (this.timelineIdx < this._timeline.length && this.time >= this._timeline[this.timelineIdx].start) {
            const e = this._timeline[this.timelineIdx++];
            const ch = this.characters.find(c => c.name === e.char);
            const clip = this.clipLibrary[e.clipName];
            if (ch && clip) ch.playClip(clip, e.opts || {});
            if (this.onEvent) this.onEvent({ kind:'clip', char:e.char, clip:e.clipName, start:e.start });
          }
        }
        // 角色推进
        this.events.length = 0;
        for (const c of this.characters) c.update(dt, this.speed, this.events);
        for (const ev of this.events) {
          if (ev.kind === 'chain' && this.onEvent) {
            const clip = this.clipLibrary[ev.to];
            const ch = this.characters.find(c => c.name === ev.char);
            if (clip && ch) ch.playClip(clip, { loop: false, capture: true });
          }
        }
      } else {
        // 暂停/拖动时 clipTime 不动（播放头真相在调用方，如主页 store.currentTime），
        // 但混合时钟仍按真实墙钟推进——否则 stopToIdle 捕获的回待机混合会永远冻在中途
        for (const c of this.characters) c.advanceBlend(dt);
      }
      // 采样并应用：无论 playing 与否都执行（scrub/暂停时显示当前对位姿势）
      for (const c of this.characters) {
        const pose = c.sample();
        for (const bn in pose) c.applyFn(bn, pose[bn]);
      }
    }
    // 便捷：拖动手势（mousedown/move）里直接调用，暂停自动播放避免冲突
    // v0.2：时间轴倒推 —— 拖到 t，每个角色播“t 时刻该角色活跃的最后一个 clip”，
    // 并将 clipTime 定到 (t - clip.start)。once 超时定格末帧（视频播放器语义）；
    // 无活跃 entry 的角色回待机。
    // v0.6.6 新增 opts.blendLoopSeams：默认 false 保持精确拖动语义；
    // 为 true（主页连续播放时）且 loop clip 已进第二周时，回卷点后 BLEND 秒内
    // 用上一周末帧姿态混合到新一周。blendT 直接取 phase——姿态只由 t 决定
    // （确定性采样），不依赖帧率或调用历史，这与 Character.update() 的内部回卷
    // 混合殊途同归，但不需要引擎自己拥有播放头。
    // B10 新增 opts.onceToIdle：默认 false 保持「once 超时定格末帧」既有语义；
    // 为 true（主页 3D 预览）时 once 片段超过动画自身时长即回待机——
    // LOOSE-ENDS L3：时长统一 animDur＝起始段(若有)+clip.duration（与 loop 分支同口径；
    // registerClip 仍拒 once+intro，此为注入/未来途径的防御性统一，无 intro 时＝clip.duration
    // 行为逐字节不变）——
    // over < BLEND 用动作末帧姿态混合回待机（跨结束点不闪跳），姿态同样只由 t 决定。
    scrubTo(t, opts) {
      const blendLoopSeams = !!(opts && opts.blendLoopSeams);
      const onceToIdle = !!(opts && opts.onceToIdle);
      this.time = Math.max(0, t);
      if (!this._timeline) return;
      this._alignCursor();        // ENGINE-1：拖动不改游标会让 play()+update() 重放已过条目
      this._scrubProbes = 0;
      for (const c of this.characters) {
        let active = null;
        // AUD-018：按角色二分找"start <= t 的最后一条"（与旧的全表线性扫描逐字等价，
        // O(D·N) → O(D·logN)；_byChar 缺失（直接改过 _timeline）时退回线性扫描兜底）
        const list = this._byChar ? this._byChar[c.name] : null;
        if (list) {
          const i = upperBound(list, t);
          this._scrubProbes += Math.max(1, Math.ceil(Math.log2(list.length + 1)));
          if (i > 0) active = list[i - 1];
        } else {
          for (let i = 0; i < this._timeline.length; i++) {
            const e = this._timeline[i];
            if (e.char !== c.name || e.start > t) continue;
            active = e;
          }
        }
        if (active) {
          const clip = this.clipLibrary[active.clipName];
          if (!clip) { continue; }
          if (c.currentClip !== clip) c.playClip(clip, active.opts || {});
          const inClip = t - active.start;
          // LOOSE-ENDS L3：once 的「动画自身时长」＝起始段(若有)+clip.duration（防御口径，见方法头注）
          const animDur = (clip.intro ? clip.intro.duration : 0) + clip.duration;
          if (clip.type === 'loop' || (active.opts && active.opts.loop)) {
            const dur = Math.max(clip.duration, 1e-3);
            const intro = clip.intro, start = intro ? intro.duration : 0;
            const phase = inClip < start ? inClip : (inClip - start) % dur;
            c.clipTime = inClip < start ? inClip : start + phase;
            c.loop = true;
            if (blendLoopSeams && inClip >= (intro ? start : dur) && phase < c.BLEND) {
              // 首次从起始段末帧混合，之后只从循环末帧混合；拖动仍精确显示原始片段。
              const from = intro && inClip < start + dur ? intro : clip;
              c.blendFrom = sampleClip(from, Math.max(from.duration - 1e-3, 0));
              c.blendT = phase;
            } else {
              c.blendFrom = null;   // 拖动/首周不混合，直接对位（精确预览）
            }
          } else if (onceToIdle && inClip >= animDur) {
            // B10：once 播完回待机（确定性——末帧姿态与回待机进度只由 t 决定）
            const over = inClip - animDur;
            if (over < c.BLEND) {
              c.blendFrom = samplePlaybackClip(clip, animDur);   // 动作末帧姿态（含起始段口径）
              c.blendT = over;
              c.state = 'blending';
            } else {
              c.blendFrom = null;
              c.state = 'idle';
            }
            c.currentClip = c.idleClip;
            c.clipTime = t % Math.max(c.idleClip ? c.idleClip.duration : 1, 1e-3);
            c.loop = true;
            continue;            // 已回待机，不再走下方 playing 置位
          } else {
            // once：定格末帧（拖动语义 = 看动作结束姿势），不自动回待机；播放时才回
            c.clipTime = Math.min(inClip, Math.max(animDur - 1e-3, 0));
            c.loop = false;
            c.blendFrom = null;
          }
          c.state = 'playing';
        } else {
          if (c.currentClip !== c.idleClip) c.stopToIdle();
          c.clipTime = t % Math.max(c.idleClip ? c.idleClip.duration : 1, 1e-3);
        }
      }
    }
  }

  global.ChoreoEngine = { PreviewEngine, Character, sampleClip, validateScaleChannels };
})(typeof window !== 'undefined' ? window : globalThis);
