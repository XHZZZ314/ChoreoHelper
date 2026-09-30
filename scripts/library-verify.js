// library-verify.js — 阶段 3「本地 3D 资料库」的可重复验收脚本（无头 Chrome + CDP）
//
// 干嘛的：实测阶段 3 的验收标准——
//   sync      file:// 打开主页 → 骨架/模型/动作自动进本地资料库 →
//             CDP 屏蔽双端口模拟游戏关闭 → 重载页面 → 真模型真骨架从资料库回来、
//             三个动作（once/once/loop）离线可播放（验收核心：关游戏刷新仍能播放）
//   uicheck   主页「📦 资料库」窗口：状态渲染、按钮齐全、按名字导入（真实 UI 钩子）、导出产出
//   full      全量 264 条导入实测：耗时/压缩后占用/失败清单（验收要求有明确报告）
//   lib-check library-check.html 诊断页回归（备份往返 + 四种坏包拒绝）
//   mode-check / clip-check  两个既有诊断页回归（origin 自动选：插件在线走 48795，
//                            游戏没开走本机 mock 端口——静态页+clips 只读服务）
//   rec       阶段4「录制 3D 动作库」中心：入口替换/四模式清单口径/编排会话（姿态复位、
//            持续打断、静止重试后判失败、自动入库）/单条重录/取消/刷新断点续录/导入质检。
//            录制会真的控制角色——本场景无论插件在不在线都强制走 mock，不碰真游戏
//   sec       v0.6.7 安全回归：OPTIONS 预检零副作用 / 方法白名单 405 / 写接口配对码 403 与
//            放行 / /capabilities 能力握手 / CORS 来源允许列表（纯 HTTP 直打 mock 镜像）。
//            真插件的同款断言等游戏重启加载 0.6.7 后按 HANDOFF 清单 curl 补做
//   proj      WP-3 项目中心：首次默认项目 / 旧草稿自动迁移+备份+不重复 / 多项目 CRUD 与
//            最近打开排序 / 崩溃恢复（镜像取新）/ 版本快照与恢复 / 每项目 20 个封顶
// 怎么跑：D:\nodejs\node.exe scripts/library-verify.js            （默认 all：sec+auto+sync+uicheck+rec+三诊断页）
//        D:\nodejs\node.exe scripts/library-verify.js full        （全量导入，约几分钟）
//        D:\nodejs\node.exe scripts/library-verify.js sync        （单个场景）
// 插件离线时（游戏没开）：自动起 48797 mock（照抄 ExportServer 的路由/MIME/CORS，
//   数据就是真实 ChoreoExports\clips），页面仍请求 48795，由 CDP Fetch 域透明改写——
//   不占用 48795（游戏随时能开），也如实打印"MOCK"标记。
// 注意：所有场景用一次性浏览器 profile（临时目录），IndexedDB 写在临时 profile 里，
//      跑完即删——不会碰主人日常浏览器里的真实资料库。

'use strict';
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vclean = require('./verify-cleanup'); // 四条退出路径清理 + 启动清扫上次残留（见文件头注释）

const CHROME_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
];
const REPO = path.join(__dirname, '..');
const PAGE_URL = 'file:///' + path.join(REPO, 'web', 'dist', 'ChoreoHelper', 'choreo-helper-app.html').replace(/\\/g, '/');
// 真插件场景（realrec）用的真配对码：读插件 pairing.json，读不到就跳过场景
const REAL_PAIR_TOKEN = (() => {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(process.env.APPDATA, 'XIVLauncherCN', 'pluginConfigs', 'ChoreoHelper', 'pairing.json'), 'utf8'));
    return j.code || j.pairingCode || '';
  } catch (e) { return ''; }
})();
const MOCK_PORT = 48797;
// SEC-1：页面种子配对码——插件在线打真插件时用真码（同 realrec 读本机 pairing.json，不出本机），
// 离线走 mock 时用 TESTCODE。main() 里定，launchChrome 的 pageTarget 在页面脚本跑起来前种进 localStorage
let SEED_TOKEN = 'TESTCODE';

// 三动作样例草稿：once + once + loop（阶段 3 验收要求的 bow/wave/循环三类）
const SAMPLE_DRAFT = {
  dancers: [{
    id: 0, name: '舞者 1', color: '#7eb3ff', switchClips: [], collapsed: false, laneScale: 1, currentJob: null,
    actionClips: [
      { id: 1, start: 2, duration: 3, autoDur: false, data: { id: 0, name: '鞠躬', command: '/bow', category: 'usual', jobName: '', jobId: 0, jobAbbr: '' } },
      { id: 2, start: 6, duration: 3, autoDur: false, data: { id: 0, name: '挥手', command: '/wave', category: 'usual', jobName: '', jobId: 0, jobAbbr: '' } },
      { id: 3, start: 12, duration: 8, autoDur: false, data: { id: 0, name: '金币舞', command: '/golddance', category: 'special', jobName: '', jobId: 0, jobAbbr: '' } },
    ],
    lyricClips: [],
  }],
  dancerCount: 1, showLyricMacro: false, totalDuration: 300,
};

// ---------- 极简 CDP 客户端（offline-verify.js 同款 + 事件订阅） ----------
class Cdp {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.id = 0;
    this.pending = new Map();
    this.handlers = new Map();
    this.exceptions = [];
    this.ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && this.pending.has(m.id)) {
        const { ok, err } = this.pending.get(m.id);
        this.pending.delete(m.id);
        m.error ? err(new Error(m.error.message)) : ok(m.result);
      } else if (m.method === 'Runtime.exceptionThrown') {
        this.exceptions.push(m.params.exceptionDetails);
      } else if (m.method && this.handlers.has(m.method)) {
        this.handlers.get(m.method)(m.params);
      }
    };
    this.ready = new Promise((ok, err) => { this.ws.onopen = ok; this.ws.onerror = err; });
  }
  on(method, handler) { this.handlers.set(method, handler); }
  send(method, params) {
    // HYGIENE(AC-10)：每条 CDP 命令 15s 硬超时——Chrome 不回包（崩溃/卡死）时明确报错退出，
    // 不再无限悬挂；正常命令远低于该上限，零影响
    return this.ready.then(() => new Promise((ok, err) => {
      const id = ++this.id;
      const timer = setTimeout(() => {
        if (this.pending.delete(id)) err(new Error('CDP 命令超时(15s): ' + method));
      }, 15000);
      this.pending.set(id, {
        ok: (v) => { clearTimeout(timer); ok(v); },
        err: (e) => { clearTimeout(timer); err(e); },
      });
      this.ws.send(JSON.stringify({ id, method, params: params || {} }));
    }));
  }
  async evaluate(expr) {
    const r = await this.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error('页面内执行出错: ' + JSON.stringify(r.exceptionDetails.exception || r.exceptionDetails.text));
    return r.result ? r.result.value : undefined;
  }
}

const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
async function waitFor(cdp, what, expr, timeoutMs, intervalMs) {
  const t0 = Date.now();
  for (;;) {
    const v = await cdp.evaluate(expr).catch(() => null);
    if (v) return v;
    if (Date.now() - t0 > timeoutMs) throw new Error('等待超时(' + (timeoutMs / 1000) + 's): ' + what);
    await sleep(intervalMs || 400);
  }
}

// ---------- 48797 mock：照抄 ExportServer/游戏 API 的行为（只读，不碰游戏状态） ----------
// 48795 侧：静态文件 + /export/*（skeleton 用快照数据——本来就是插件录的参考骨架）
// 48794 侧（opts.game 才重写过去）：目录四端点用目录快照数据，/health OK——让页面走
//   完整的在线初始化（骨架/目录自动进资料库的代码路径才能被真正测到）
async function startMock() {
  const CLIPS = path.join(process.env.APPDATA || '', 'XIVLauncherCN', 'ChoreoExports', 'clips');
  const DIST = path.join(REPO, 'web', 'dist', 'ChoreoHelper');
  const MIME = {
    '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
    '.mjs': 'application/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
    '.gltf': 'model/gltf', '.glb': 'model/gltf-binary', '.bin': 'application/octet-stream',
  };
  // 从快照生成物里抠出 JSON（格式：注释 + 一行 window.__XXX__ = {...};）
  function snapshotJson(file, name) {
    const txt = fs.readFileSync(path.join(DIST, file), 'utf8');
    const m = txt.match(new RegExp(name + '\\s*=\\s*(\\{[\\s\\S]*\\});'));
    if (!m) throw new Error('快照解析失败: ' + file);
    return JSON.parse(m[1]);
  }
  const catalog = snapshotJson('catalog-snapshot.js', '__CHOREO_CATALOG__');
  const skeleton = snapshotJson('skeleton-snapshot.js', '__CHOREO_SKELETON_SNAPSHOT__');
  // 阶段4（录制中心）用的调用统计：rec 场景断言编排行为（打断/复位/静止重试）全靠它
  const mockStats = {
    clips: [],            // 每次 POST /export/clip 的 command
    walkresets: 0,        // POST /export/walkreset 次数（姿态类复位）
    previews: [],         // POST /preview 的 command（持续类 beckon 打断）
    staticNames: new Set(['recstat']),  // 这些动作返回"静止"数据（质检应判失败并重试一次）
    qcTest: false,        // true 时 /export/list 附带 recqcbad 且 getclip 返回静止（质检拦截测试）
    // v0.7.1 FIX-C 两阶段提交：暂存表（recordingId→name）、commit/cancel 计数
    pending: {},          // recordingId → 动作名（仿真插件 pending 目录）
    commits: 0,           // POST /export/clip/commit 次数
    cancels: 0,           // POST /export/clip/cancel 次数
    // v0.6.7 安全回归计数
    denied: 0,            // 写接口 403（缺/错配对码）次数
    badMethod: 0,         // 405（方法不在白名单）次数
    optionsSeen: 0,       // OPTIONS 预检次数（必须零副作用：不增加上面的业务计数）
    // GAMECLOCK（TASK-20260831）：时钟跟随 + 动作审核的可编排开关（场景直改这些字段）
    statusCap: false,     // /capabilities 是否带 statusV2 能力位（AC-4 新旧插件两态）
    statusHits: 0,        // GET /playback/status 命中数（AC-4 断「零轮询」用）
    status: { playing: false, time: 0, speed: 1, maxEnd: 0, advance: 0, fail: false, stamp: 0 },
    verify: { running: false, cmd: '', mode: 'match', failNames: new Set(), count: 0, denied409: 0, cancels: 0 },
  };
  // v0.6.7：mock 配对码（真插件是游戏里 /choreo pair 看的 8 位码；网页存 localStorage 后带 X-Choreo-Token）
  const MOCK_TOKEN = 'TESTCODE';
  const ALLOWED_ORIGINS = new Set(['null', 'http://localhost:48795', 'http://127.0.0.1:48795', 'http://localhost:48796', 'http://localhost:48797']);
  function send(res, obj, status) {
    const b = Buffer.from(typeof obj === 'string' ? obj : JSON.stringify(obj));
    res.statusCode = status || 200;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(b);
  }
  // v0.6.7：镜像真插件的来源允许列表——允许才回 CORS 头（回显 origin），不允许裸回
  function applyCors(req, res) {
    const origin = req.headers['origin'];
    if (!origin || !ALLOWED_ORIGINS.has(origin)) return;
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Choreo-Token');
    res.setHeader('Access-Control-Allow-Private-Network', 'true');
  }
  // v0.6.7 起：配对校验（镜像真插件：缺/错配对码 → 403 pairing required）。
  // SEC-1：不只写接口——私有读（/export/* GET、/gpose/state、静态模型文件）同标准
  function pairingDenied(req, res) {
    if (req.headers['x-choreo-token'] === MOCK_TOKEN) return false;
    mockStats.denied++;
    send(res, { error: 'pairing required', message: '需要配对（mock：' + MOCK_TOKEN + '）' }, 403);
    return true;
  }
  function methodNotAllowed(res, allow) {
    mockStats.badMethod++;
    res.setHeader('Allow', allow);
    send(res, { error: 'method not allowed', allow }, 405);
  }
  function readBody(req, cb) {
    let body = '';
    req.on('data', (c) => body += c);
    req.on('end', () => cb(body));
  }
  // 罐头 clip：normal 版第 2 帧偏移 0.45（幅度质检 ≥0.3 判好）；static 版帧帧相同（幅度 0 判静止）
  function makeClip(name, dur, isStatic) {
    const q = isStatic
      ? [[0, 0.1, 0.2, 0.3, 0.9], [1, 0.1, 0.2, 0.3, 0.9], [2, 0.1, 0.2, 0.3, 0.9]]
      : [[0, 0.1, 0.2, 0.3, 0.9], [1, 0.4, 0.25, 0.35, 0.85], [2, 0.1, 0.2, 0.3, 0.9]];
    return { name: name, duration: dur, type: dur >= 19 ? 'loop' : 'once',
      bones: { bone_46: { q: q, t: [[0, 0, 1.4, 0]] }, bone_2: { q: [[0, 0, 0, 0, 1]], t: [[0, 0.02, 0.4, 0]] } } };
  }
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://localhost');
    res.setHeader('Cache-Control', 'no-cache');
    applyCors(req, res);
    // v0.6.7 镜像：OPTIONS 预检一律零副作用（真插件两端口现在都是显式 204；来源不允许 403）
    if (req.method === 'OPTIONS') {
      mockStats.optionsSeen++;
      const origin = req.headers['origin'];
      if (origin && !ALLOWED_ORIGINS.has(origin)) { res.statusCode = 403; res.end(); return; }
      res.statusCode = 204; res.end(); return;
    }
    // v0.6.7 镜像：能力握手（两端口同路径 /capabilities，只读无门槛）
    if (u.pathname === '/capabilities') {
      if (req.method !== 'GET') { methodNotAllowed(res, 'GET'); return; }
      send(res, { app: 'ChoreoHelper', version: '0.6.7.0-mock', protocolVersion: 1, pairing: true,
        capabilities: ['playback', 'seek', 'freeze', 'recording', 'clip-commit', 'walkreset', 'gpose', 'library-sync', 'capabilities']
          .concat(mockStats.statusCap ? ['statusV2'] : []) });
    } else if (u.pathname === '/playback/status') {
      // GAMECLOCK：可编排的 enriched status（场景用 mockStats.status 控制钟面/推进/故障）
      if (req.method !== 'GET' && req.method !== 'HEAD') { methodNotAllowed(res, 'GET, HEAD'); return; }
      const st = mockStats.status;
      if (st.fail) { res.statusCode = 500; res.end(); return; }
      mockStats.statusHits++;
      if (st.playing) st.time += (st.advance || 0);
      st.stamp = (st.stamp + 1) >>> 0;   // 每命中一次 +1：单调戳（乱序样本判别用）
      send(res, { playing: !!st.playing, time: Number(st.time.toFixed(1)), revision: 1,
        speed: st.speed, maxEnd: st.maxEnd, stampMs: st.stamp });
    } else if (u.pathname === '/export/list') {
      if (req.method !== 'GET') { methodNotAllowed(res, 'GET'); return; }
      if (pairingDenied(req, res)) return;   // SEC-1 镜像：个人动作清单是私有读
      const clips = fs.readdirSync(CLIPS).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5));
      if (mockStats.qcTest) clips.push('recqcbad');   // 阶段4质检测试：磁盘上有个"静止坏文件"
      send(res, { clips });
    } else if (u.pathname === '/export/getclip') {
      if (req.method !== 'GET') { methodNotAllowed(res, 'GET'); return; }
      if (pairingDenied(req, res)) return;   // SEC-1 镜像：单条动作是私有读
      const name = (u.searchParams.get('name') || '').replace(/\//g, '_').replace(/\.\./g, '_');
      if (mockStats.qcTest && name === 'recqcbad') { send(res, makeClip('recqcbad', 3.0, true)); return; }
      const p = path.join(CLIPS, name + '.json');
      if (fs.existsSync(p)) send(res, fs.readFileSync(p, 'utf8'));
      else send(res, { error: 'not found' });
    } else if (u.pathname === '/export/skeleton') {
      if (req.method !== 'GET') { methodNotAllowed(res, 'GET'); return; }
      if (pairingDenied(req, res)) return;   // SEC-1 镜像：角色骨架是私有读
      send(res, skeleton);   // 真插件的 /export/skeleton 数据形态（本来就是它录的）
    } else if (u.pathname === '/export/clip') {
      if (req.method !== 'POST') { methodNotAllowed(res, 'POST'); return; }
      if (pairingDenied(req, res)) return;
      // 阶段4录制端点（仿真，不落盘）：按动作名出不同形状的数据驱动网页编排器。
      // v0.7.1 FIX-C：镜像两阶段提交——响应带 recordingId，commit 前算"暂存中"
      readBody(req, (body) => {
        let cmd = ''; try { cmd = String(JSON.parse(body).command || ''); } catch (e) {}
        mockStats.clips.push(cmd);
        const name = cmd.trim().replace(/^\//, '').replace(/ motion$/, '');
        let dur = 3.0;
        if (name === 'doze') dur = 2.0;            // 姿态类
        if (name === 'golddance') dur = 19.2;      // 持续/循环类（网页应发 beckon 打断）
        const recId = 'mock' + Date.now().toString(16) + Math.random().toString(16).slice(2, 10);
        mockStats.pending[recId] = name;
        send(res, Object.assign(makeClip(name, dur, mockStats.staticNames.has(name)), { recordingId: recId }));
      });
    } else if (u.pathname === '/export/clip/commit') {
      if (req.method !== 'POST') { methodNotAllowed(res, 'POST'); return; }
      if (pairingDenied(req, res)) return;
      // v0.7.1 FIX-C：镜像插件 commit——暂存存在才 ok，提交后从暂存表移除
      readBody(req, (body) => {
        let recId = '', name = '';
        try { const b = JSON.parse(body); recId = String(b.recordingId || ''); name = String(b.name || ''); } catch (e) {}
        if (!mockStats.pending[recId]) { send(res, { error: 'unknown recordingId', message: '暂存不存在或已过期，请重录这条动作' }, 404); return; }
        delete mockStats.pending[recId];
        mockStats.commits++;
        send(res, { ok: true, name });
      });
    } else if (u.pathname === '/export/clip/cancel') {
      if (req.method !== 'POST') { methodNotAllowed(res, 'POST'); return; }
      if (pairingDenied(req, res)) return;
      // v0.7.1 FIX-C：镜像插件 cancel——丢掉暂存（幂等）
      readBody(req, (body) => {
        let recId = '';
        try { recId = String(JSON.parse(body).recordingId || ''); } catch (e) {}
        delete mockStats.pending[recId];
        mockStats.cancels++;
        send(res, { ok: true });
      });
    } else if (u.pathname === '/export/walkreset') {
      if (req.method !== 'POST') { methodNotAllowed(res, 'POST'); return; }
      if (pairingDenied(req, res)) return;
      mockStats.walkresets++;
      readBody(req, () => send(res, { ok: true }));
    } else if (u.pathname === '/preview') {
      if (req.method !== 'POST') { methodNotAllowed(res, 'POST'); return; }
      if (pairingDenied(req, res)) return;
      readBody(req, (body) => {
        try { mockStats.previews.push(String(JSON.parse(body).command || '')); } catch (e) { mockStats.previews.push(body); }
        send(res, { ok: true });
      });
    } else if (['/playback/start', '/playback/seek', '/playback/freeze', '/playback/stop', '/gpose/toggle', '/settings/engine'].includes(u.pathname)) {
      // v0.6.7 镜像：48794 写接口一律要配对码（网页带 token 才放行）
      if (req.method !== 'POST') { methodNotAllowed(res, 'POST'); return; }
      if (pairingDenied(req, res)) return;
      readBody(req, (body) => {
        if (u.pathname === '/playback/start') {
          // GAMECLOCK：镜像真插件响应形状（网页 gameStartPlay 认 status:'playing' 才进播放态）
          let fromTime = 0; try { fromTime = Number(JSON.parse(body).fromTime) || 0; } catch (e) { }
          mockStats.status.playing = false;
          mockStats.status.time = fromTime; // 起播后的钟面推进由 clock 场景脚本接管
          send(res, { status: 'playing', clipCount: 1, revision: 1 });
        } else send(res, { ok: true });
      });
    } else if (u.pathname === '/export/verify') {
      // GAMECLOCK：动作审核镜像——在途互斥 409、报告契约形状、可编排 match/deviation/慢响应
      if (req.method !== 'POST') { methodNotAllowed(res, 'POST'); return; }
      if (pairingDenied(req, res)) return;
      readBody(req, (body) => {
        const v = mockStats.verify;
        if (v.running) { v.denied409++; send(res, { error: 'busy', message: '一个审核已在进行，等它完成或先取消' }, 409); return; }
        let cmd = ''; try { cmd = String(JSON.parse(body).command || ''); } catch (e) { }
        if (!cmd) { send(res, { error: 'command required' }, 400); return; }
        v.running = true; v.cmd = cmd; v.count++;
        const name = cmd.trim().replace(/^\//, '').replace(/ motion$/, '');
        const persistent = name === 'golddance';   // 持续/循环类：真插件 reason=timeout → persistent
        const fail = v.mode === 'deviation' || (v.failNames && v.failNames.has(name));
        setTimeout(() => {
          v.running = false;
          if (v.mode === 'error') { send(res, { ok: false, error: 'too few frames (0): settled' }); return; }
          send(res, fail
            ? { ok: true, command: cmd, verdict: 'deviation', aggregate: 1.5465, maxRotDelta: 0.7732, maxTransDelta: 0,
                hotspots: [{ bone: 'bone_46', rotDelta: 0.7732, transDelta: 0 }], comparedBones: 2,
                frames: 3, sampleHz: 14.3, persistent: persistent, reason: persistent ? 'timeout' : 'settled' }
            : { ok: true, command: cmd, verdict: 'match', aggregate: 0.0119, maxRotDelta: 0.0119, maxTransDelta: 0,
                hotspots: [], comparedBones: 2, frames: 3, sampleHz: 14.3, persistent: persistent,
                reason: persistent ? 'timeout' : 'settled' });
        }, v.mode === 'slow' ? 1500 : 80);
      });
    } else if (u.pathname === '/export/verifystatus') {
      // GAMECLOCK：审核在途状态（配对读）
      if (req.method !== 'GET') { methodNotAllowed(res, 'GET'); return; }
      if (pairingDenied(req, res)) return;
      send(res, { running: mockStats.verify.running, command: mockStats.verify.running ? mockStats.verify.cmd : '',
        startedAgo: 0, lastError: null });
    } else if (u.pathname === '/export/batchcancel') {
      // GAMECLOCK：镜像真插件口径——batchcancel 同时终结在途审核
      if (req.method !== 'POST') { methodNotAllowed(res, 'POST'); return; }
      if (pairingDenied(req, res)) return;
      mockStats.verify.cancels++;
      mockStats.verify.running = false;
      send(res, { ok: true });
    } else if (u.pathname === '/health') {
      send(res, { status: 'ok' });
    } else if (u.pathname === '/actions/emotes') {
      send(res, { emotes: catalog.emotes });
    } else if (u.pathname === '/actions/races') {
      send(res, { races: catalog.races });
    } else if (u.pathname === '/actions') {
      send(res, { actions: catalog.actions });
    } else if (u.pathname === '/classjobs') {
      send(res, { classJobs: catalog.classJobs });
    } else if (u.pathname === '/actions/measured-durations') {
      send(res, { durations: {} });
    } else if (u.pathname === '/gpose/state') {
      // SEC-1 镜像：48794 的会话状态是配对读，GET/HEAD 都要配对码（HEAD 不是旁路）
      if (req.method !== 'GET' && req.method !== 'HEAD') { methodNotAllowed(res, 'GET, HEAD'); return; }
      if (pairingDenied(req, res)) return;
      send(res, { gpose: false });
    } else if (u.pathname.startsWith('/export/')) {
      send(res, { error: 'unknown endpoint' }, 404);   // v0.6.7 镜像：未知 /export/* 路径 404（旧版 200+error）
    } else {
      if (req.method !== 'GET') { methodNotAllowed(res, 'GET'); return; }
      const rel = u.pathname.replace(/^\/+/, '');
      const p = path.normalize(path.join(DIST, rel));
      if (p.startsWith(DIST) && fs.existsSync(p) && fs.statSync(p).isFile()) {
        // SEC-1 镜像：个人模型文件按解析后文件名判（大小写不敏感，防 /./ 与大小写绕过），
        // standin 等公共内容不受影响；不存在的文件照旧 404（与真 ServeStatic 的 404 先判一致）
        const base = path.basename(p).toLowerCase();
        if ((base === 'model.gltf' || base === 'model.glb' || base === 'model.bin') && pairingDenied(req, res)) return;
        const b = fs.readFileSync(p);
        res.setHeader('Content-Type', MIME[path.extname(p).toLowerCase()] || 'application/octet-stream');
        res.setHeader('Content-Length', b.length);
        res.end(b);
      } else { res.statusCode = 404; res.end(); }
    }
  });
  // HYGIENE(AC-12)：listen 失败（端口被占等）必须立刻 reject——旧版只挂成功回调，
  // 失败时 promise 永远 pending，验收脚本对着一个没起来的 mock 无限悬挂
  return new Promise((ok, rej) => {
    server.on('error', (e) => rej(new Error('mock 48797 监听失败: ' + ((e && e.code) || (e && e.message) || e))));
    server.listen(MOCK_PORT, '127.0.0.1', () => { server.stats = mockStats; ok(server); });
  });
}

// mock 惰性启动/复用（rec 场景在插件在线时也强制走 mock——录制会真的控制角色，绝不打真插件）
async function ensureMock() {
  if (!global.__mockServer) global.__mockServer = await startMock();
  return global.__mockServer;
}
// 给无头实例装 CDP Fetch 改写：页面仍请求 48795(/48794)，透明转发到 48797 mock
async function attachRewrite(ch, game) {
  // FIX-4 修既有坑：插件离线时 main 先包了一层 attachRewrite(ch, false)（只改写 48795），
  // rec 场景随后 attachRewrite(ch, true) 想补 48794——旧版被 _rewritten 守卫短路，
  // 48794 永远没进改写清单，rec 在离线机器状态下必挂 capsOk 等待。
  // 现在：重复调用只升级 _rewriteGame 标志，patterns 在 pageTarget 连接时按最新标志生成。
  if (ch._rewritten) { if (game) ch._rewriteGame = true; return ch; }
  ch._rewritten = true;
  ch._rewriteGame = !!game;
  const pageTarget = ch.pageTarget;
  ch.pageTarget = async function () {
    const cdp = await pageTarget.call(ch);
    const patterns = [{ urlPattern: '*://localhost:48795/*', requestStage: 'Request' }];
    if (ch._rewriteGame) patterns.push({ urlPattern: '*://localhost:48794/*', requestStage: 'Request' });
    await cdp.send('Fetch.enable', { patterns });
    cdp.on('Fetch.requestPaused', (p) => {
      const url = p.request.url.replace(':48795/', ':' + MOCK_PORT + '/').replace(':48794/', ':' + MOCK_PORT + '/');
      cdp.send('Fetch.continueRequest', { requestId: p.requestId, url }).catch(() => { });
    });
    return cdp;
  };
  return ch;
}

// ---------- 无头 Chrome 实例 ----------
async function launchChrome(extraArgs, openUrl) {
  const exe = CHROME_CANDIDATES.find((p) => fs.existsSync(p));
  if (!exe) throw new Error('没找到 Chrome（找过 Program Files 两个位置）');
  const port = 20000 + Math.floor(Math.random() * 20000);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'choreo-libverify-'));
  const args = [
    '--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--window-size=1400,900', '--remote-debugging-port=' + port,
    '--user-data-dir=' + profile,
  ].concat(extraArgs || []);
  if (openUrl) args.push(openUrl);
  const proc = spawn(exe, args, { stdio: 'ignore', windowsHide: true });
  vclean.register(proc, profile); // 登记：正常/Ctrl+C/异常/exit 四条路径都会清（finally 只覆盖常规路径）
  for (let i = 0; i < 60; i++) {
    await sleep(300);
    try {
      const r = await fetch('http://127.0.0.1:' + port + '/json/version');
      if (r.ok) break;
    } catch (e) { /* 还没起来 */ }
    if (i === 59) { kill(); throw new Error('Chrome 调试口起不来'); }
  }
  async function pageTarget() {
    for (let i = 0; i < 30; i++) {
      const list = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json();
      const t = list.find((x) => x.type === 'page' &&
        (x.url.startsWith('file:') || x.url.startsWith('http://localhost:48795/') || x.url.startsWith('http://localhost:' + MOCK_PORT + '/')));
      if (t) {
        const cdp = new Cdp(t.webSocketDebuggerUrl);
        // SEC-1：私有读（骨架/清单/单条/模型）要配对码，网页从 localStorage 取——
        // 页面脚本跑起来之前种好（等价主人粘过一次码的日常环境）。只在无值时种：
        // 不冲掉场景自己 savePairToken 的码（rec 场景强制 mock 用 TESTCODE，刷新后必须保留）
        try {
          await cdp.send('Page.enable');
          await cdp.send('Page.addScriptToEvaluateOnNewDocument',
            { source: "try{if(!localStorage.getItem('choreo_pairToken'))localStorage.setItem('choreo_pairToken'," + JSON.stringify(SEED_TOKEN) + ')}catch(e){}' });
          await cdp.send('Runtime.evaluate',
            { expression: "try{if(!localStorage.getItem('choreo_pairToken'))localStorage.setItem('choreo_pairToken'," + JSON.stringify(SEED_TOKEN) + ')}catch(e){}' });
        } catch (e) { /* 种子失败不致命 */ }
        return cdp;
      }
      await sleep(300);
    }
    throw new Error('找不到页面 target');
  }
  function kill() {
    try { proc.kill(); } catch (e) { }
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) { }
  }
  return { pageTarget, kill, port };
}

// ---------- 断言工具 ----------
const results = [];
function check(name, okFlag, detail) {
  results.push(okFlag);
  console.log((okFlag ? '  ✔ ' : '  ✘ ') + name + (detail ? '（' + detail + '）' : ''));
  if (!okFlag) process.exitCode = 1;
}
const MB = (n) => (n / 1048576).toFixed(1) + 'MB';

async function seedDraftAndReload(cdp) {
  // WP-3 起草稿已迁移成项目：不再灌 choreo_draft（会被迁移标志挡住），改经页面钩子
  // 把样例草稿造成项目（内容与迁移产物一致）再刷新。需要页面先就绪（钩子在主页脚本里）
  await waitFor(cdp, '编辑器就绪(灌种子前)', 'window.store && store.appReady && window.__projTest', 20000);
  await cdp.evaluate('window.__projTest.seedFromDraft(' + JSON.stringify(SAMPLE_DRAFT) + ')');
  await cdp.evaluate('location.reload()');
}

// 在线阶段共用的准备：等主页就绪 → 等 3D 面板在线就绪 → 等骨架/模型经真实代码路径
// 自动缓存进资料库（骨架走 preview3d 的 /export/skeleton 缓存，模型走 loadModel 缓存）
async function prepOnlineLibrary(cdp) {
  await waitFor(cdp, '编辑器就绪', 'window.store && store.appReady', 20000);
  await waitFor(cdp, '资料库模块就绪', 'window.ChoreoLibrary && ChoreoLibrary.available()', 10000);
  await waitFor(cdp, '3D 面板就绪（在线）', 'window.__p3dDebug && __p3dDebug().ready', 60000, 500);
  await waitFor(cdp, '真模型缓存进资料库',
    '(function(){try{return ChoreoLibrary.getModelFiles().then(function(f){return f.some(function(x){return x.name===\'model.gltf\'})&&f.some(function(x){return x.name===\'model.bin\'})})}catch(e){return false}})()',
    60000, 1000);
  await waitFor(cdp, '参考骨架缓存进资料库',
    '(function(){try{return ChoreoLibrary.stats().then(function(s){return !!s.skeleton})}catch(e){return false}})()',
    30000, 800);
}

// ---------- 场景 1：sync（验收核心——导入后关游戏刷新仍能播放） ----------
async function scenarioSync() {
  console.log('[sync] file:// 在线打开 → 资料库自动收骨架/模型/目录/动作 → 屏蔽端口重载 → 离线播放');
  const ch = await launchChrome([], PAGE_URL, { game: true });
  try {
    const cdp = await ch.pageTarget();
    await seedDraftAndReload(cdp);
    await prepOnlineLibrary(cdp);

    // 动作经 syncLibrary 读穿透自动进库（时间轴用到 bow/wave/golddance）
    await waitFor(cdp, '三个动作注册进引擎',
      '(window.__p3dDebug() && __p3dDebug().clips.indexOf(\'bow\')>=0 && __p3dDebug().clips.indexOf(\'wave\')>=0 && __p3dDebug().clips.indexOf(\'golddance\')>=0)',
      60000, 800);
    const st1 = await cdp.evaluate('ChoreoLibrary.stats()');
    check('在线阶段：动作/骨架/目录/模型全自动进资料库', st1.clips >= 3 && st1.skeleton && st1.catalog && st1.modelFiles.length >= 2,
      st1.clips + ' 条动作 · 骨架' + (st1.skeleton ? '✓' : '✗') + ' 目录' + (st1.catalog ? '✓' : '✗') + ' · ' + MB(st1.sizeEnc) + '（压缩）/ ' + MB(st1.sizeRaw) + '（原始）');

    // ===== 模拟游戏关闭：屏蔽双端口 + 重载 =====
    await cdp.send('Network.enable');
    await cdp.send('Network.setBlockedURLs', { urls: ['*localhost:48794*', '*localhost:48795*', '*localhost:' + MOCK_PORT + '*'] });
    await cdp.evaluate('location.reload()');

    await waitFor(cdp, '重载后编辑器就绪', 'window.store && store.appReady', 20000);
    check('目录兜底（快照/资料库）', await cdp.evaluate('store.emotes.length') > 0, await cdp.evaluate('store.emotes.length') + ' 动作');
    await waitFor(cdp, '离线 3D 面板就绪', 'window.__p3dDebug && __p3dDebug().ready', 90000, 500);
    check('离线真模型真骨架（不用替身/快照）', await cdp.evaluate('__p3dDebug().offline') === false);
    const stTxt = await cdp.evaluate('document.querySelector(\'.p3d-status\').textContent');
    check('骨骼匹配 101/101（资料库骨架+真模型）', /101\/101/.test(stTxt), stTxt);
    await waitFor(cdp, '离线动作从资料库回来',
      '(window.__p3dDebug() && __p3dDebug().clips.indexOf(\'bow\')>=0 && __p3dDebug().clips.indexOf(\'golddance\')>=0)',
      60000, 800);
    check('三类动作离线可用（once/loop）', true, await cdp.evaluate('__p3dDebug().clips.join(",")'));

    // 拨到三个时刻验证引擎驱动的是正确动作
    await cdp.evaluate('window.store.currentTime=3.5'); await sleep(500);
    const c1 = await cdp.evaluate('__p3dDebug().engine.characters[0].currentClip && __p3dDebug().engine.characters[0].currentClip.name');
    check('t=3.5s 播 bow（once）', c1 === 'bow', String(c1));
    await cdp.evaluate('window.store.currentTime=7.5'); await sleep(500);
    const c2 = await cdp.evaluate('__p3dDebug().engine.characters[0].currentClip && __p3dDebug().engine.characters[0].currentClip.name');
    check('t=7.5s 播 wave（once）', c2 === 'wave', String(c2));
    await cdp.evaluate('window.store.currentTime=14'); await sleep(500);
    const c3 = await cdp.evaluate('__p3dDebug().engine.characters[0].currentClip && __p3dDebug().engine.characters[0].currentClip.name');
    check('t=14s 播 golddance（loop）', c3 === 'golddance', String(c3));

    // 离线网页播放
    check('离线网页播放起播', await cdp.evaluate('togglePlay(); store.previewTarget + \'/\' + store.isPlaying') === 'web/true');
    await sleep(1300);
    const t1 = await cdp.evaluate('store.currentTime');
    check('播放头在走', t1 > 0.5, 't=' + t1.toFixed(2) + 's');
    await cdp.evaluate('stopPlay()');
    check('停止归零', await cdp.evaluate('store.currentTime') === 0);
    check('全程无 JS 异常', cdp.exceptions.length === 0, cdp.exceptions.length + ' 个');
  } finally { ch.kill(); }
}

// ---------- 场景 2：uicheck（资料库窗口 + 按名字导入 + 导出产出） ----------
async function scenarioUicheck() {
  console.log('[uicheck] 主页「📦 资料库」窗口：状态/按钮/按名字导入/导出');
  const ch = await launchChrome([], PAGE_URL);
  try {
    const cdp = await ch.pageTarget();
    await seedDraftAndReload(cdp);
    await prepOnlineLibrary(cdp);

    // 点工具栏按钮开窗
    check('工具栏有「资料库」按钮', await cdp.evaluate(
      '!!Array.prototype.slice.call(document.querySelectorAll(\'.toolbar .btn\')).find(function(b){return b.textContent.indexOf(\'资料库\')>=0})'));
    await cdp.evaluate('Array.prototype.slice.call(document.querySelectorAll(\'.toolbar .btn\')).find(function(b){return b.textContent.indexOf(\'资料库\')>=0}).click()');
    await sleep(400);
    check('资料库窗口打开并显示状态', await cdp.evaluate(
      '!!document.querySelector(\'.modal-bg\') && document.querySelector(\'.modal\').textContent.indexOf(\'动作\')>=0'));
    await cdp.evaluate('document.querySelector(\'.modal-bg\').remove()');

    // 按名字导入（真实 UI 钩子，等价于按钮走 full 清单的路）。
    // 注意自动同步可能在后台同时收动作，所以断言用"覆盖"口径：imported+skipped===1
    const rep = await cdp.evaluate(
      'window.__libImportFromPlugin([\'beckon\'], null).then(function(r){return JSON.stringify(r)})').then(JSON.parse);
    check('按名字导入 beckon 覆盖成功', rep.imported + rep.skipped === 1 && rep.failed.length === 0, JSON.stringify(rep).slice(0, 120));
    const st = await cdp.evaluate('ChoreoLibrary.stats()');
    check('资料库统计更新', st.clips >= 1, st.clips + ' 条 · ' + MB(st.sizeEnc));

    // 导出产出（不点下载，只验证打包）
    const sz = await cdp.evaluate('ChoreoLibrary.exportBundle().then(function(b){return b.size})');
    check('导出备份产出有效文件', sz > 10000, MB(sz));
    check('全程无 JS 异常', cdp.exceptions.length === 0, cdp.exceptions.length + ' 个');
  } finally { ch.kill(); }
}

// ---------- 场景 3a：auto（零点击自动同步——网页连上插件后资料库自己收满 264 条） ----------
async function scenarioAuto() {
  console.log('[auto] 零点击：file:// 在线打开主页，等资料库自动收满 264 条（不点任何按钮）');
  const ch = await launchChrome([], PAGE_URL, { game: true });
  try {
    const cdp = await ch.pageTarget();
    await seedDraftAndReload(cdp);
    await waitFor(cdp, '编辑器就绪', 'window.store && store.appReady', 20000);
    await waitFor(cdp, '资料库自动收满 264 条',
      '(function(){try{return ChoreoLibrary.stats().then(function(s){return s.clips>=264 ? s.clips : false})}catch(e){return false}})()',
      240000, 2000);
    const st = await cdp.evaluate('ChoreoLibrary.stats()');
    check('全自动收满动作（无需点按钮）', st.clips >= 264, st.clips + ' 条 · ' + MB(st.sizeEnc));
    check('骨架/目录/模型也自动进库', st.skeleton && st.catalog && st.modelFiles.length >= 2,
      '骨架' + (st.skeleton ? '✓' : '✗') + ' 目录' + (st.catalog ? '✓' : '✗') + ' 模型' + st.modelFiles.length + ' 个文件');
    const bow = await cdp.evaluate('ChoreoLibrary.getClip(\'bow\').then(function(c){return c&&c.bones?1:0})');
    check('抽查 bow 可解压', bow === 1);
    check('全程无 JS 异常', cdp.exceptions.length === 0, cdp.exceptions.length + ' 个');
  } finally { ch.kill(); }
}

// ---------- 场景 3b：full（全量 264 条导入实测报告） ----------
async function scenarioFull() {
  console.log('[full] 全量导入插件动作库（要几分钟，产出耗时/占用/失败报告）');
  const t0 = Date.now();
  const ch = await launchChrome([], PAGE_URL);
  try {
    const cdp = await ch.pageTarget();
    await seedDraftAndReload(cdp);
    await prepOnlineLibrary(cdp);
    await cdp.evaluate(
      'window.__fullReport=null; window.__libImportFromPlugin(null, null)' +
      '.then(function(r){window.__fullReport=r}, function(e){window.__fullReport={error:String(e && e.message || e)}})');
    await waitFor(cdp, '全量导入完成', 'window.__fullReport ? JSON.stringify(window.__fullReport).slice(0,60) : false', 15 * 60000, 3000);
    const rep = await cdp.evaluate('JSON.stringify(window.__fullReport)').then(JSON.parse);
    const st = await cdp.evaluate('ChoreoLibrary.stats()');
    check('全量导入后资料库覆盖 264 条且 0 失败', st.clips === 264 && rep.failed.length === 0,
      '新导入 ' + rep.imported + ' / 已有跳过 ' + rep.skipped + '（样例草稿的动作在准备阶段已先缓存）/ 失败 ' + rep.failed.length);
    check('压缩后体积合理（<400MB）', st.sizeEnc > 10 * 1048576 && st.sizeEnc < 400 * 1048576, MB(st.sizeEnc) + '（原始 ' + MB(st.sizeRaw) + '）');
    const spot = await cdp.evaluate(
      'Promise.all([ChoreoLibrary.getClip(\'bow\'), ChoreoLibrary.getClip(\'fume\'), ChoreoLibrary.getClip(\'wasshoi\')])' +
      '.then(function(a){return a.map(function(c){return c && c.bones ? 1 : 0}).join(\'\')})');
    check('抽查大中小动作可解压（bow/fume/wasshoi）', spot === '111', spot);
    console.log('  —— 全量导入报告：耗时 ' + (rep.elapsedMs / 1000).toFixed(1) + 's（含压缩），' +
      '压缩后 ' + MB(rep.sizeEnc) + ' / 原始 ' + MB(rep.sizeRaw) + '，含骨架+模型总占用 ' + MB(st.sizeEnc + st.modelSize));
    console.log('  —— 整个场景（含浏览器启动/模型加载）' + ((Date.now() - t0) / 1000).toFixed(1) + 's');
    check('全程无 JS 异常', cdp.exceptions.length === 0, cdp.exceptions.length + ' 个');
  } finally { ch.kill(); }
}

// ---------- 场景 5：rec（阶段4「录制 3D 动作库」中心——队列/质检/断点/入库） ----------
// 重要：录制会真的控制游戏角色——本场景无论插件在不在线都强制走 48797 mock（罐头 clip、
// 不落盘、不碰游戏），只验证网页侧编排逻辑。姿态/once/loop 的真机表现由主人实机验收。
async function scenarioRec() {
  console.log('[rec] 录制 3D 动作库中心（强制 mock，不碰真实游戏）');
  const mock = await ensureMock();
  const stats = mock.stats;
  stats.clips.length = 0; stats.walkresets = 0; stats.previews.length = 0;
  stats.staticNames = new Set(['recstat']); stats.qcTest = false;
  stats.pending = {}; stats.commits = 0; stats.cancels = 0; // v0.7.1 FIX-C 两阶段提交计数
  const ch = await attachRewrite(await launchChrome([], PAGE_URL), true);
  try {
    const cdp = await ch.pageTarget();
    await waitFor(cdp, '编辑器就绪', 'window.store && store.appReady', 20000);
    await waitFor(cdp, '录制函数就绪', 'typeof recStart === "function"', 5000);
    // v0.6.7：mock 启用了配对——给页面种上配对码（等价于主人在「高级 → 网页配对」粘了一次）
    await cdp.evaluate('savePairToken(\'TESTCODE\')');
    await waitFor(cdp, '能力握手完成（capsOk=true）', 'window.store && store.capsOk === true', 30000);
    // SEC-1 后：probeExport 是带码私有读，而 choreoTokenHeaders 有 capsOk 门槛——种码时握手
    // 尚未完成，savePairToken 里那次立即重探实际没带码（mock 403）。caps 完成后再探一次并等
    // 「已连接」：等价主人日常环境（码在、握手早就完成），弹窗里四模式按钮才不是禁用态
    await cdp.evaluate('probeExport()');
    await waitFor(cdp, '导出连接已认出（exportConnected=true）', 'window.store && store.exportConnected === true', 15000);

    // ① 入口与「⋯ 高级」弹层（工具栏按钮已按属主简化方向改短文案「⏺ 录制动作」）
    check('工具栏有「⏺ 录制动作」按钮', await cdp.evaluate(
      `!!Array.prototype.slice.call(document.querySelectorAll('.toolbar .btn')).find(function(b){return b.textContent.indexOf('录制动作')>=0})`));
    check('旧「⚡ 录制全部」入口已删除', await cdp.evaluate(
      `!Array.prototype.slice.call(document.querySelectorAll('button')).find(function(b){return b.textContent.indexOf('录制全部')>=0})`));
    check('底栏「引擎」开关已移出普通 UI', await cdp.evaluate(
      `(function(){var bb=document.querySelector('.bottombar');return !(bb&&Array.prototype.slice.call(bb.querySelectorAll('button')).some(function(x){return x.textContent.indexOf('引擎')>=0}))})()`));
    await cdp.evaluate(`document.getElementById('advBtn').click()`); await sleep(250);
    check('「⋯ 高级」弹层收纳拍照精确和引擎开关', await cdp.evaluate(
      `(function(){var p=document.getElementById('advPop');return !!p&&p.textContent.indexOf('拍照精确')>=0&&p.textContent.indexOf('引擎')>=0})()`));
    await cdp.evaluate(`document.getElementById('advBtn').click()`); await sleep(150);
    check('再点收起弹层', await cdp.evaluate(`!document.getElementById('advPop')`));

    // ② 录制窗口与四种模式的清单口径
    await cdp.evaluate(`showRecModal()`);
    // 窗口正文是异步填的（renderRecModalBody 的「游戏插件：…」行要等 clipIndex 的 IDB 往返），
    // 固定 500ms 后单发断言在重负载下会撞在渲染中途（GATE-R2 实测 149/1）→
    // 有界等同一确定性状态（15s/200ms 轮询，超时点名抛出 fail-closed），断言本身不变
    await waitFor(cdp, '录制窗口打开（连接状态 + 四种模式）',
      `(function(){var m=document.querySelector('.modal');if(!m)return false;var t=m.textContent;return t.indexOf('游戏插件')>=0&&t.indexOf('快速常用')>=0&&t.indexOf('完整全量')>=0&&t.indexOf('补录缺失')>=0&&t.indexOf('自选')>=0?1:false})()`,
      15000, 200);
    check('录制窗口打开（连接状态 + 四种模式）', await cdp.evaluate(
      `(function(){var t=document.querySelector('.modal').textContent;return t.indexOf('游戏插件')>=0&&t.indexOf('快速常用')>=0&&t.indexOf('完整全量')>=0&&t.indexOf('补录缺失')>=0&&t.indexOf('自选')>=0})()`));
    const fullN = await cdp.evaluate(`recCatalogList().length`);
    check('完整全量口径 = 264（去表情/去重/去空命令，与实拍全库一致）', fullN === 264, String(fullN));
    const quickN = await cdp.evaluate(`recQuickItems().length`);
    check('快速常用 ≥25（内置常用清单 + 草稿引用）', quickN >= 25, String(quickN));
    await cdp.evaluate(`(function(){var b=Array.prototype.slice.call(document.querySelectorAll('.modal .btn')).find(function(x){return x.textContent.indexOf('自选')>=0});if(b)b.click()})()`);
    await sleep(400);
    const pickCnt = await cdp.evaluate(`document.querySelectorAll('.modal input[type=checkbox]').length`);
    const pickDis = await cdp.evaluate(`Array.prototype.slice.call(document.querySelectorAll('.modal input[type=checkbox]')).filter(function(c){return c.disabled}).length`);
    check('自选清单渲染且表情类禁选', pickCnt >= 280 && pickDis >= 29, pickCnt + ' 项，禁选 ' + pickDis + ' 项');
    await cdp.evaluate(`document.querySelector('.modal-bg').remove()`);

    // ③ 核心编排会话：普通/姿态(复位)/持续(打断)/静止(重试后失败) 四类各一条
    await cdp.evaluate(`recStart('pick',[{cmd:'/bow motion',cname:'a',b:'bow'},{cmd:'/doze motion',cname:'a',b:'doze'},{cmd:'/golddance motion',cname:'a',b:'golddance'},{cmd:'/recstat motion',cname:'a',b:'recstat'}])`);
    await waitFor(cdp, '会话跑完', `(function(){var d=__recDebug();return d&&!d.running&&d.session&&d.session.finished===true?1:false})()`, 90000, 500);
    const dbg1 = JSON.parse(await cdp.evaluate(`JSON.stringify(__recDebug())`));
    const it1 = {}; dbg1.session.items.forEach((it) => it1[it.name] = it);
    check('编排结果：普通/姿态/持续成功，静止判失败', it1.bow.status === 'done' && it1.doze.status === 'done' && it1.golddance.status === 'done'
      && it1.recstat.status === 'failed' && it1.recstat.reason.indexOf('静止') >= 0, 'bow:' + it1.bow.status + ' doze:' + it1.doze.status + ' golddance:' + it1.golddance.status + ' recstat:' + it1.recstat.status);
    check('静止数据自动重试过一次（tries=2）', it1.recstat.tries === 2, String(it1.recstat.tries));
    check('姿态类录完触发行走复位', stats.walkresets >= 1, '/export/walkreset × ' + stats.walkresets);
    check('持续类（≥19s）触发 beckon 打断', stats.previews.some((c) => c.indexOf('beckon') >= 0), stats.previews.join('|'));
    const have1 = JSON.parse(await cdp.evaluate(`ChoreoLibrary.hasClips(['bow','doze','golddance','recstat']).then(JSON.stringify)`));
    check('好动作自动进资料库、静止的没进', have1[0] === true && have1[1] === true && have1[2] === true && have1[3] === false, JSON.stringify(have1));
    check('底栏显示录制结果', ((await cdp.evaluate(`(document.getElementById('recPos')||{}).textContent`)) || '').indexOf('成功 3') >= 0);
    check('会话 manifest 已持久化（断点续录用）', dbg1.session.finished === true);
    // v0.7.1 FIX-C：两阶段提交——好动作先写库再 commit；静止坏片 cancel 不覆盖旧文件
    check('FIX-C：三条好动作质检过+进库后 commit', stats.commits === 3, 'commits=' + stats.commits);
    check('FIX-C：静止坏片重试前后各 cancel 一次（共 2 次）', stats.cancels === 2, 'cancels=' + stats.cancels);
    check('FIX-C：所有暂存都已提交或取消（孤儿=0）', Object.keys(stats.pending).length === 0, JSON.stringify(stats.pending));

    // ④ 摘要 + 单条失败重录
    await cdp.evaluate(`showRecModal()`); await sleep(400);
    check('摘要列出失败项和重录按钮', await cdp.evaluate(
      `(function(){var t=document.querySelector('.modal').textContent;return t.indexOf('recstat')>=0&&t.indexOf('重录')>=0})()`));
    stats.staticNames.delete('recstat');   // 这次 mock 返回正常数据 → 重录应成功
    await cdp.evaluate(`(function(){var b=Array.prototype.slice.call(document.querySelectorAll('.modal .btn')).find(function(x){return x.textContent==='重录'});if(b)b.click()})()`);
    await waitFor(cdp, '单条重录完成', `(function(){var d=__recDebug();return d&&!d.running&&d.session&&d.session.finished===true?1:false})()`, 60000, 500);
    const have2 = JSON.parse(await cdp.evaluate(`ChoreoLibrary.hasClips(['recstat']).then(JSON.stringify)`));
    check('重录成功后进资料库', have2[0] === true);

    // ⑤ 取消 + 刷新页面 + 断点续录（已完成的不重录）
    const six = ['clap', 'salute', 'greet', 'wave', 'yes', 'dance'];
    const sixArr = '[' + six.map((n) => `{cmd:'/${n} motion',cname:'x',b:'${n}'}`).join(',') + ']';
    await cdp.evaluate(`recStart('pick',${sixArr})`);
    await waitFor(cdp, '至少录完 1 条', `(function(){var d=__recDebug();return d.counts.done>=1})()`, 30000, 300);
    await cdp.evaluate(`(function(){var b=Array.prototype.slice.call(document.querySelectorAll('.modal .btn')).find(function(x){return x.textContent.indexOf('停止')>=0});if(b)b.click()})()`);
    await waitFor(cdp, '停止后退出循环', `!__recDebug().running`, 60000, 400);
    const c5 = JSON.parse(await cdp.evaluate(`JSON.stringify(__recDebug().session)`));
    check('取消保留已完成、剩余待续录', c5.finished === false && c5.items.some((i) => i.status === 'done') && c5.items.some((i) => i.status === 'pending'),
      'done=' + c5.items.filter((i) => i.status === 'done').length + ' pend=' + c5.items.filter((i) => i.status === 'pending').length);
    await cdp.evaluate(`location.reload()`);
    await waitFor(cdp, '重载后编辑器就绪', 'window.store && store.appReady', 20000);
    await cdp.evaluate(`showRecModal()`); await sleep(400);
    check('重载后出现续录横幅', await cdp.evaluate(
      `(function(){var t=document.querySelector('.modal').textContent;return t.indexOf('上次录制未完成')>=0&&t.indexOf('继续录制')>=0})()`));
    await cdp.evaluate(`(function(){var b=Array.prototype.slice.call(document.querySelectorAll('.modal .btn')).find(function(x){return x.textContent==='继续录制'});if(b)b.click()})()`);
    await waitFor(cdp, '续录完成', `(function(){var d=__recDebug();return d&&!d.running&&d.session&&d.session.finished===true?1:false})()`, 120000, 500);
    const c6 = JSON.parse(await cdp.evaluate(`JSON.stringify(__recDebug().session)`));
    check('续录后六条全部完成', c6.items.every((i) => i.status === 'done'), c6.items.map((i) => i.name + ':' + i.status).join(' '));
    const postCnt = {}; stats.clips.forEach((c) => { const n = c.trim().replace(/^\//, '').replace(/ motion$/, ''); postCnt[n] = (postCnt[n] || 0) + 1; });
    check('已完成条目不重录（六个名字各恰好 POST 一次）', six.every((n) => postCnt[n] === 1), JSON.stringify(postCnt));

    // ⑥ 从插件导入的静止坏文件被质检拦下（autoSync/手动导入共用同一关口）
    stats.qcTest = true;
    const rep = JSON.parse(await cdp.evaluate(`window.__libImportFromPlugin(['recqcbad'],null).then(function(r){return JSON.stringify(r)})`));
    check('导入静止文件被质检拒绝', rep.failed.length === 1 && rep.failed[0].reason.indexOf('静止') >= 0, rep.failed[0] && rep.failed[0].reason);
    const haveQc = JSON.parse(await cdp.evaluate(`ChoreoLibrary.hasClips(['recqcbad']).then(JSON.stringify)`));
    check('被拒文件没进资料库', haveQc[0] === false);
    stats.qcTest = false;

    check('全程无 JS 异常', cdp.exceptions.length === 0, cdp.exceptions.length + ' 个');
  } finally { ch.kill(); }
}

// ---------- 场景 6：sec（安全回归——纯 HTTP 直打 mock，验证插件安全行为的 mock 镜像） ----------
// 真 48794/48795 的同款断言在插件加载新 DLL 后用只读 curl 补做（见 HANDOFF SEC-1 回归清单）；
// 这里把 mock 的镜像行为钉死：预检零副作用、方法白名单 405、写接口 403/放行、来源允许列表、
// SEC-1 私有读配对（个人动作/骨架/模型/会话状态只认配对头，"null" 不再单独授信）。
async function scenarioSec() {
  console.log('[sec] 安全行为（mock 镜像断言，纯 HTTP 无浏览器）');
  const mock = await ensureMock();
  const stats = mock.stats;
  stats.clips.length = 0; stats.walkresets = 0; stats.denied = 0; stats.badMethod = 0; stats.optionsSeen = 0;
  const base = 'http://127.0.0.1:' + MOCK_PORT;
  async function req(method, p, headers, body) {
    const r = await fetch(base + p, { method, headers: headers || {}, body: body || undefined });
    let j = null; try { j = await r.json(); } catch (e) { /* 204/403 无体 */ }
    return { status: r.status, json: j, headers: r.headers };
  }
  // ① OPTIONS 预检零副作用（修复前的真插件：OPTIONS /export/walkreset 会真的触发角色移动）
  const o1 = await req('OPTIONS', '/export/walkreset', { Origin: 'null' });
  check('OPTIONS /export/walkreset → 204（预检不放行业务）', o1.status === 204, String(o1.status));
  check('预检零副作用（walkresets 仍为 0）', stats.walkresets === 0, String(stats.walkresets));
  // ② 方法白名单：写端点被 GET 打 → 405 且不执行
  const g1 = await req('GET', '/export/walkreset');
  check('GET /export/walkreset → 405（不当 GET 端点执行）', g1.status === 405 && !!g1.json && g1.json.error === 'method not allowed', String(g1.status));
  check('405 也没执行复位（walkresets 仍为 0）', stats.walkresets === 0, String(stats.walkresets));
  const g2 = await req('GET', '/export/clip');
  check('GET /export/clip → 405', g2.status === 405, String(g2.status));
  const p1 = await req('POST', '/export/list');
  check('POST /export/list（只读端点）→ 405', p1.status === 405, String(p1.status));
  const u1 = await req('PUT', '/export/skeleton');
  check('PUT /export/skeleton → 405', u1.status === 405, String(u1.status));
  // ③ 写接口配对码
  const w1 = await req('POST', '/export/clip', { 'Content-Type': 'application/json' }, JSON.stringify({ command: '/bow motion', save: false }));
  check('POST /export/clip 无配对码 → 403', w1.status === 403 && w1.json && w1.json.error === 'pairing required', String(w1.status));
  const w2 = await req('POST', '/export/clip', { 'Content-Type': 'application/json', 'X-Choreo-Token': 'WRONG' }, JSON.stringify({ command: '/bow motion', save: false }));
  check('POST /export/clip 错配对码 → 403', w2.status === 403, String(w2.status));
  check('被拒的两次都没进录制（clips 仍 0）', stats.clips.length === 0, String(stats.clips.length));
  const w3 = await req('POST', '/export/clip', { 'Content-Type': 'application/json', 'X-Choreo-Token': 'TESTCODE' }, JSON.stringify({ command: '/bow motion', save: false }));
  check('POST /export/clip 正确配对码 → 200 且返回 clip', w3.status === 200 && w3.json && !!w3.json.bones, String(w3.status));
  check('放行的这次进了录制', stats.clips.length === 1, String(stats.clips.length));
  const w4 = await req('POST', '/preview', { 'Content-Type': 'application/json' }, JSON.stringify({ command: '/beckon motion' }));
  check('POST /preview 无配对码 → 403（48794 写接口同样要配对）', w4.status === 403, String(w4.status));
  // ④ 能力握手
  const c1 = await req('GET', '/capabilities');
  check('GET /capabilities → 协议版本+配对能力', c1.status === 200 && c1.json && c1.json.protocolVersion === 1 && c1.json.pairing === true, String(c1.status));
  // ⑤ CORS 来源允许列表：允许的来源回显，陌生来源预检 403、普通请求无 CORS 头
  const o2 = await req('OPTIONS', '/export/list', { Origin: 'null' });
  check('file:// 来源（Origin: null）预检放行并回显', o2.status === 204 && o2.headers.get('access-control-allow-origin') === 'null',
    o2.headers.get('access-control-allow-origin') || '(无)');
  check('预检头包含 X-Choreo-Token（配对头要能过预检）', (o2.headers.get('access-control-allow-headers') || '').indexOf('X-Choreo-Token') >= 0);
  const o3 = await req('OPTIONS', '/export/list', { Origin: 'https://evil.example' });
  check('陌生来源预检 → 403（浏览器连真请求都发不出）', o3.status === 403, String(o3.status));
  const g3 = await req('GET', '/export/list', { Origin: 'https://evil.example' });
  check('陌生来源无配对码读私有数据 → 403（SEC-1：授权只认配对头，来源再"合法"也不放行匿名私有读）',
    g3.status === 403 && g3.json && g3.json.error === 'pairing required', String(g3.status));
  // ⑥ SEC-1 私有读配对：个人数据一律要配对码，只认配对头不认来源（"null" 是任意不透明来源都能发的）
  const r1 = await req('GET', '/export/list');
  check('GET /export/list 无配对码 → 403（SEC-1 反转旧「只读无需配对」：不能再匿名枚举个人动作）',
    r1.status === 403 && r1.json && r1.json.error === 'pairing required', String(r1.status));
  const r2 = await req('GET', '/export/list', { 'X-Choreo-Token': 'WRONG' });
  check('GET /export/list 错配对码 → 403', r2.status === 403, String(r2.status));
  const r3 = await req('GET', '/export/list', { 'X-Choreo-Token': 'TESTCODE', Origin: 'null' });
  check('GET /export/list 正确配对码 → 200（Origin:null+配对码 = file:// 日常入口照常工作）',
    r3.status === 200 && r3.json && Array.isArray(r3.json.clips), String(r3.status));
  const r4 = await req('GET', '/export/getclip?name=whatever', { Origin: 'null' });
  check('GET /export/getclip 无配对码 → 403', r4.status === 403, String(r4.status));
  const r5 = await req('GET', '/export/skeleton', { Origin: 'null' });
  check('GET /export/skeleton 无配对码 → 403', r5.status === 403, String(r5.status));
  const r6 = await req('HEAD', '/export/list');
  check('HEAD /export/list → 405（一致拒绝：HEAD 既不是旁路也不进业务）', r6.status === 405, String(r6.status));
  // 48794 侧配对读镜像（mock 的 /gpose/state）：会话状态也要配对，GET/HEAD 一致
  const r7 = await req('GET', '/gpose/state');
  check('GET /gpose/state 无配对码 → 403（48794 会话状态也是配对读）', r7.status === 403, String(r7.status));
  const r8 = await req('HEAD', '/gpose/state');
  check('HEAD /gpose/state 无配对码 → 403（HEAD 不是旁路）', r8.status === 403, String(r8.status));
  const r9 = await req('HEAD', '/gpose/state', { 'X-Choreo-Token': 'TESTCODE' });
  check('HEAD /gpose/state 正确配对码 → 200', r9.status === 200, String(r9.status));
  // 静态个人模型：按解析后文件名判（大小写不敏感）；stand-in 等公共内容不受影响
  const r10 = await req('GET', '/model.gltf', { Origin: 'null' });
  check('GET /model.gltf 无配对码 → 403（个人模型不能匿名下载）', r10.status === 403, String(r10.status));
  const r11 = await req('GET', '/MODEL.GLTf', { 'X-Choreo-Token': 'TESTCODE' });
  check('模型判定大小写不敏感 + 正确配对码 → 200', r11.status === 200 && (r11.headers.get('content-type') || '').indexOf('model/gltf') >= 0,
    String(r11.status) + ' ct=' + (r11.headers.get('content-type') || '(无)'));
  const c2 = await req('GET', '/capabilities');
  check('GET /capabilities 仍匿名（发现层可用，SEC-1 口径）', c2.status === 200, String(c2.status));
  const u2 = await req('GET', '/export/unknown-thing');
  check('未知 /export/* 路径 → 404（旧版是 200+error）', u2.status === 404, String(u2.status));
  stats.clips.length = 0; // 还原，别影响后续场景
}

// ---------- 场景：clock（GAMECLOCK AC-3/AC-4——游戏模式时钟跟随，mock 可编排插件钟） ----------
// AC-4：旧插件（capabilities 无 statusV2）→ 游戏播放零 status 轮询（本地钟字节级行为）；
// AC-3：能力位就位 → 播放头收敛插件钟、插件钟跳变后 resync 硬切、轮询失败退本地钟不熔断、
//       恢复后重新跟上、暂停/停止后不再轮询。全程 mock，不碰真游戏。
async function scenarioClock() {
  console.log('[clock] 游戏模式时钟跟随（mock 编排 /playback/status 与 statusV2 能力位）');
  const mock = await ensureMock();
  const stats = mock.stats;
  const st = stats.status;
  stats.statusCap = false; stats.statusHits = 0;
  st.playing = false; st.time = 0; st.speed = 1; st.maxEnd = 0; st.advance = 0; st.fail = false; st.stamp = 0;
  const ch = await attachRewrite(await launchChrome([], PAGE_URL), true);
  try {
    const cdp = await ch.pageTarget();
    await seedDraftAndReload(cdp);
    await waitFor(cdp, '编辑器就绪', 'window.store && store.appReady', 20000);
    await cdp.evaluate('savePairToken(\'TESTCODE\')');
    await waitFor(cdp, '能力握手完成（capsOk=true）', 'window.store && store.capsOk === true', 30000);
    await cdp.evaluate(`(function(){store.previewTarget='game';try{localStorage.setItem('choreo_previewTarget','game')}catch(e){}})()`);
    // AC-4 前半：无 statusV2 能力位（旧插件）→ 游戏播放期间零轮询
    stats.statusHits = 0;
    await cdp.evaluate(`gameStartPlay()`);
    await waitFor(cdp, '进入播放态（游戏模式）', 'window.store && store.isPlaying === true', 15000);
    await sleep(1500);
    check('AC-4：旧插件（无 statusV2）游戏播放 1.5s 内零 /playback/status 请求', stats.statusHits === 0, 'hits=' + stats.statusHits);

    // AC-3：模拟插件升级（statusV2 出现）→ 重探握手后重新起播（跟随在起播时按能力位挂上）
    stats.statusCap = true;
    await cdp.evaluate('probeCaps()');
    await waitFor(cdp, 'statusV2 能力位就绪', 'window.ChoreoEdit && ChoreoEdit.pure.hasCap(store.pluginCaps,"statusV2")', 10000);
    await cdp.evaluate('gameStartPlay()');
    await waitFor(cdp, '重新起播', 'window.store && store.isPlaying === true', 15000);
    let followStarted = false;
    for (let i = 0; i < 25 && !followStarted; i++) { if (stats.statusHits > 0) followStarted = true; else await sleep(200); }
    check('AC-3：statusV2 就绪后跟随轮询开始（5Hz）', followStarted, 'hits=' + stats.statusHits);
    // 插件钟脚本：从网页当前播放头起步，每命中一次推 0.2s（5Hz 轮询 ≈ 实时步进）
    const webT0 = parseFloat(await cdp.evaluate(`String(store.currentTime)`));
    st.playing = true; st.time = webT0; st.advance = 0.2; st.speed = 1; st.maxEnd = 300;
    await sleep(4000);
    const webT1 = parseFloat(await cdp.evaluate(`String(store.currentTime)`));
    check('AC-3：跟随启用后播放头收敛到插件钟（0.35s 容差 = 阈值 0.12 + 一个轮询周期）',
      Math.abs(webT1 - st.time) <= 0.35, 'web=' + webT1.toFixed(2) + ' plugin=' + st.time.toFixed(2) + ' hits=' + stats.statusHits);
    // AC-3 resync：插件钟瞬间 +3s → 2s 内硬切贴上
    st.time += 3;
    await sleep(2000);
    const webT2 = parseFloat(await cdp.evaluate(`String(store.currentTime)`));
    check('AC-3：插件钟跳变 +3s 后播放头 resync 硬切收敛',
      Math.abs(webT2 - st.time) <= 0.35, 'web=' + webT2.toFixed(2) + ' plugin=' + st.time.toFixed(2));
    // AC-3 退化：status 故障（500）→ 播放头继续走（本地钟接管），播放不停止
    st.fail = true;
    const webT3 = parseFloat(await cdp.evaluate(`String(store.currentTime)`));
    await sleep(1200);
    const webT4 = parseFloat(await cdp.evaluate(`String(store.currentTime)`));
    check('AC-3：轮询失败期播放头继续前进（本地钟接管，不停止不熔断）', webT4 > webT3 + 0.5,
      '+' + (webT4 - webT3).toFixed(2) + 's');
    check('AC-3：失败期无 JS 异常', cdp.exceptions.length === 0, String(cdp.exceptions.length));
    // AC-3 恢复：故障解除 → 重新收敛
    st.fail = false;
    await sleep(1500);
    check('AC-3：轮询恢复后重新跟上插件钟', Math.abs(parseFloat(await cdp.evaluate(`String(store.currentTime)`)) - st.time) <= 0.35,
      'plugin=' + st.time.toFixed(2));
    // 停止：pausePlay 后轮询停（1s 内 hits 不再增长）
    await cdp.evaluate(`pausePlay()`);
    await waitFor(cdp, '暂停生效', 'window.store && store.isPlaying === false', 5000);
    const hits0 = stats.statusHits;
    await sleep(1000);
    check('暂停后不再轮询（hits 冻结）', stats.statusHits === hits0, (stats.statusHits - hits0) + ' 次');
    check('全程无 JS 异常', cdp.exceptions.length === 0, String(cdp.exceptions.length));
  } finally { ch.kill(); }
  // 还原 mock 状态
  stats.statusCap = false; st.playing = false; st.advance = 0; st.fail = false;
}

// ---------- 场景：verify（GAMECLOCK AC-6/AC-7/AC-8——动作审核 HTTP 语义 + 录制中心 UI） ----------
async function scenarioVerify() {
  console.log('[verify] 动作审核：HTTP 契约（mock 直打）+ 录制中心审核 UI');
  const mock = await ensureMock();
  const stats = mock.stats;
  const v = stats.verify;
  v.mode = 'match'; v.failNames = new Set(); v.count = 0; v.denied409 = 0; v.cancels = 0; v.running = false;
  const base = 'http://127.0.0.1:' + MOCK_PORT;
  const TOK = { 'Content-Type': 'application/json', 'X-Choreo-Token': 'TESTCODE' };
  async function req(method, p, headers, body) {
    const r = await fetch(base + p, { method, headers: headers || {}, body: body || undefined });
    let j = null; try { j = await r.json(); } catch (e) { }
    return { status: r.status, json: j };
  }

  // ① HTTP 契约（AC-6/AC-8）
  const a1 = await req('OPTIONS', '/export/verify', { Origin: 'null' });
  check('OPTIONS /export/verify → 204 零副作用（不进审核会话）', a1.status === 204 && v.count === 0, String(a1.status));
  const a2 = await req('GET', '/export/verify');
  check('GET /export/verify → 405（写端点不接 GET）', a2.status === 405, String(a2.status));
  const a3 = await req('POST', '/export/verify', { 'Content-Type': 'application/json' }, JSON.stringify({ command: '/bow motion' }));
  check('AC-8：匿名 POST /export/verify → 403（配对门槛）', a3.status === 403 && v.count === 0, String(a3.status));
  const a4 = await req('GET', '/export/verifystatus');
  check('GET /export/verifystatus 无配对码 → 403（审核状态也是私有读）', a4.status === 403, String(a4.status));
  const a5 = await req('POST', '/export/verify', TOK, JSON.stringify({ command: '/bow motion' }));
  check('AC-6：配对后 POST /export/verify → 200 结构化报告', a5.status === 200 && a5.json && a5.json.ok === true, String(a5.status));
  check('AC-6：报告含 verdict/aggregate/maxRotDelta/hotspots/frames/sampleHz 契约键',
    a5.json && 'verdict' in a5.json && 'aggregate' in a5.json && 'maxRotDelta' in a5.json
    && Array.isArray(a5.json.hotspots) && 'frames' in a5.json && 'sampleHz' in a5.json, JSON.stringify(a5.json && a5.json.verdict));
  check('AC-6：单次会话恰好触发一次（count=1）', v.count === 1, String(v.count));
  const a6 = await req('GET', '/export/verifystatus', TOK);
  check('AC-6：verifystatus 配对后可读（running=false）', a6.status === 200 && a6.json && a6.json.running === false, String(a6.status));
  // 在途互斥：慢响应占位 → 第二条 409
  v.mode = 'slow';
  const slowP = req('POST', '/export/verify', TOK, JSON.stringify({ command: '/bow motion' }));
  await sleep(250);
  check('AC-6：审核进行中 verifystatus 报 running=true', (await req('GET', '/export/verifystatus', TOK)).json.running === true);
  const a7 = await req('POST', '/export/verify', TOK, JSON.stringify({ command: '/wave motion' }));
  check('AC-6：并发第二条审核 → 409', a7.status === 409, String(a7.status));
  const a7r = await slowP;
  check('AC-6：占位的慢审核最终 200（不被并发请求挤掉）', a7r.status === 200, String(a7r.status));
  // batchcancel 终结在途审核（AC-6：cancel 通道 exactly-once 收敛）
  const slow2 = req('POST', '/export/verify', TOK, JSON.stringify({ command: '/bow motion' }));
  await sleep(250);
  const a8 = await req('POST', '/export/batchcancel', TOK, '{}');
  check('AC-6：batchcancel → ok 且终结在途审核', a8.status === 200 && (await req('GET', '/export/verifystatus', TOK)).json.running === false,
    String(a8.status));
  await slow2;
  v.mode = 'match';

  // ② 录制中心审核 UI（AC-7）
  const ch = await attachRewrite(await launchChrome([], PAGE_URL), true);
  try {
    const cdp = await ch.pageTarget();
    await seedDraftAndReload(cdp);
    await waitFor(cdp, '编辑器就绪', 'window.store && store.appReady', 20000);
    await cdp.evaluate('savePairToken(\'TESTCODE\')');
    await waitFor(cdp, '能力握手完成（capsOk=true）', 'window.store && store.capsOk === true', 30000);
    await cdp.evaluate('probeExport()');
    await waitFor(cdp, '导出连接已认出', 'window.store && store.exportConnected === true', 15000);
    await cdp.evaluate(`showRecModal()`); await sleep(400);
    await cdp.evaluate(`(function(){var b=Array.prototype.slice.call(document.querySelectorAll('.modal .btn')).find(function(x){return x.textContent.indexOf('自选')>=0});if(b)b.click()})()`);
    await sleep(400);
    check('AC-7：自选清单有「🔍 审核所选」按钮', await cdp.evaluate(
      `(function(){return !!Array.prototype.slice.call(document.querySelectorAll('.modal .btn')).find(function(x){return x.textContent.indexOf('审核所选')>=0})})()`));
    check('AC-7：每行有单条审核按钮 🔍', await cdp.evaluate(
      `(function(){return Array.prototype.slice.call(document.querySelectorAll('.modal button')).filter(function(x){return x.textContent==='🔍'}).length>=10})()`));
    // 单条 bow（match）+ doze（failNames 编排为偏差）：verdict 渲染 + 最差骨名
    v.failNames = new Set(['doze']);
    const clipsBefore = stats.clips.length, commitsBefore = stats.commits;
    await cdp.evaluate(`verStart([{cmd:'/bow motion',b:'bow'},{cmd:'/doze motion',b:'doze'}])`);
    await waitFor(cdp, '审核会话跑完', `(function(){var d=window.__verDebug&&__verDebug();return d&&!d.running&&d.state&&d.state.items.every(function(i){return i.status==='pass'||i.status==='fail'})})()`, 30000, 300);
    const vd = JSON.parse(await cdp.evaluate(`JSON.stringify(__verDebug().state)`));
    const byName = {}; vd.items.forEach((it) => byName[it.name] = it);
    check('AC-7：match 判「通过」', byName.bow.status === 'pass', byName.bow.status);
    check('AC-7：偏差判「超标」且带最差骨名', byName.doze.status === 'fail' && byName.doze.bone === 'bone_46',
      byName.doze.status + '/' + byName.doze.bone);
    check('AC-7：结果列表渲染 通过 与 偏差超标 文案', await cdp.evaluate(
      `(function(){var l=document.querySelector('.modal');if(!l)return false;var t=l.textContent;return t.indexOf('通过')>=0&&t.indexOf('偏差超标')>=0})()`));
    // 审核不碰数据：没有触发任何录制/commit（AC-7：no clip data is modified）
    check('AC-7：审核全程零录制请求/零 commit（clip 数据只读）',
      stats.clips.length === clipsBefore && stats.commits === commitsBefore,
      'clips=' + stats.clips.length + ' commits=' + stats.commits);
    // 批量取消：3 条慢审核 → 跑完第一条前点停止
    v.mode = 'slow';
    await cdp.evaluate(`verStart([{cmd:'/bow motion',b:'bow'},{cmd:'/wave motion',b:'wave'},{cmd:'/clap motion',b:'clap'}])`);
    await sleep(300);
    await cdp.evaluate(`(function(){var b=Array.prototype.slice.call(document.querySelectorAll('.modal button')).find(function(x){return x.textContent.indexOf('停止审核')>=0});if(b)b.click()})()`);
    await waitFor(cdp, '取消后退出审核循环', `!__verDebug().running`, 15000, 300);
    const vc = JSON.parse(await cdp.evaluate(`JSON.stringify(__verDebug())`));
    check('AC-7：取消即停（剩余条目保持待审）', vc.cancel === true && vc.state.items.some((i) => i.status === 'pending'),
      vc.state.items.map((i) => i.status).join(','));
    v.mode = 'match';
    check('全程无 JS 异常', cdp.exceptions.length === 0, String(cdp.exceptions.length));
  } finally { ch.kill(); }
  v.failNames = new Set(); v.count = 0; v.denied409 = 0; v.cancels = 0; v.running = false;
}

// 项目内容对比口径：显示名（data.name）允许被线上目录的「中文名修复」覆盖（既有行为，不是迁移丢数据）；
// selected 是 UI 瞬态标志（选中后写进内容，旧版草稿同样如此），也不参与对比。
// 其余字段（时间/时长/command/歌词/开关/轨道长度/clip 数量）必须逐项一致
function canonContent(s) {
  // WP-5-WIRE 起仓储存规范文档、UI 编辑投影：投影会重建对象，键序与旧直存不再一致——
  // 这里断言的是数据一致（键序归一 + 抹显示名），不是字节一致
  const sortKeys = (x) => (Array.isArray(x) ? x.map(sortKeys)
    : (x && typeof x === 'object') ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, sortKeys(x[k])]))
    : x);
  const c = JSON.parse(s);
  const clean = (arr) => (arr || []).map((cl) => {
    const { selected, ...rest } = cl;
    return { ...rest, data: { ...cl.data, name: '' } };
  });
  c.dancers = (c.dancers || []).map((d) => ({ ...d, switchClips: clean(d.switchClips), actionClips: clean(d.actionClips), lyricClips: clean(d.lyricClips) }));
  c.globalLyrics = clean(c.globalLyrics);
  return JSON.stringify(sortKeys(c));
}

// ---------- 场景 7：proj（WP-3 项目中心：迁移/备份/多项目/崩溃恢复/版本快照） ----------
async function scenarioProj() {
  console.log('[proj] 项目中心与存储层（迁移/备份/多项目/崩溃恢复/版本快照）');
  const ch = await launchChrome([], PAGE_URL);
  try {
    const cdp = await ch.pageTarget();

    // ① 全新 profile 首次打开：自动建默认项目（无旧草稿，不算迁移）
    await waitFor(cdp, '编辑器就绪', 'window.store && store.appReady', 20000);
    await waitFor(cdp, '项目模块就绪', 'window.__projTest', 10000);
    const info0 = JSON.parse(await cdp.evaluate('JSON.stringify(__projTest.info())'));
    check('首次打开自动建默认项目「我的编舞」', info0.projectId && info0.name === '我的编舞' && !info0.degraded, JSON.stringify(info0));
    check('工具栏有「📁 项目」按钮', await cdp.evaluate(
      '!!Array.prototype.slice.call(document.querySelectorAll(\'.toolbar .btn\')).find(function(b){return b.textContent.indexOf(\'项目\')>=0})'));

    // ② 灌旧格式 choreo_draft → 重开 → 自动迁移 + 逐字节备份 + 原键不动
    const LEGACY = {
      dancers: [{ id: 0, name: '舞者 1', color: '#7eb3ff', currentJob: null, collapsed: false, laneScale: 1,
        switchClips: [], lyricClips: [{ id: 8, start: 1, duration: 2, data: { name: '你好', command: '/y 你好', category: 'lyric', isLyric: true } }],
        actionClips: [
          { id: 5, start: 0, duration: 3, autoDur: false, data: { id: 0, name: '鞠躬', command: '/bow', category: 'usual', jobName: '', jobId: 0, jobAbbr: '' } },
          { id: 6, start: 4, duration: 4, autoDur: false, data: { id: 0, name: '挥手', command: '/wave', category: 'usual', jobName: '', jobId: 0, jobAbbr: '' } },
        ] }],
      dancerCount: 1, showLyricMacro: true, totalDuration: 360,
    };
    const legacyRaw = JSON.stringify(LEGACY);
    // WP-3b 起 schema 2：迁移/装载会给舞者补 solo/mute=false、content 补 markers=[]（normalizeContent 的既定产物），
    // 期望内容按 schema 2 口径构造——迁移后=旧内容+默认值，缺了才算丢数据
    const expectedContent = JSON.stringify({
      dancers: LEGACY.dancers.map((d) => ({ ...d, solo: false, mute: false })),
      globalLyrics: [], dancerCount: 1, showLyricMacro: true, totalDuration: 360, markers: [],
    });
    // 清空项目仓（clear 不需要关连接，比 deleteDatabase 稳）+ 撤迁移标志 + 灌旧草稿，全部在活页面上做。
    // evaluate 支持多语句——写成多行可读形式，不跟单行括号较劲
    await cdp.evaluate(
      `window.__clearProj = function () {
        return new Promise(function (res) {
          var q = indexedDB.open("choreo3dproj");
          q.onerror = function () { res(0); };
          q.onsuccess = function () {
            var db = q.result;
            var t = db.transaction(["projects", "versions"], "readwrite");
            t.objectStore("projects").clear();
            t.objectStore("versions").clear();
            t.oncomplete = function () { db.close(); res(1); };
            t.onerror = function () { res(0); };
          };
        });
      }; window.__clearProj()`);
    await cdp.evaluate('localStorage.setItem("choreo_draft",' + JSON.stringify(legacyRaw) + ');' +
      'localStorage.removeItem("choreo_migrated_v1");localStorage.removeItem("choreo_activeProject");' +
      'localStorage.removeItem("choreo_autosave");localStorage.removeItem("choreo_draft_backup_20260829");');
    await cdp.evaluate('location.reload()');
    await waitFor(cdp, '迁移后编辑器就绪', 'window.store && store.appReady', 20000);
    await waitFor(cdp, '项目模块就绪(迁移)', 'window.__projTest', 10000);
    const migList = JSON.parse(await cdp.evaluate('__projTest.list().then(JSON.stringify)'));
    const mig = JSON.parse(await cdp.evaluate('JSON.stringify({info:__projTest.info(),content:__projTest.content(),' +
      'bak:localStorage.getItem("choreo_draft_backup_20260829"),draft:localStorage.getItem("choreo_draft"),flag:localStorage.getItem("choreo_migrated_v1")})'));
    check('旧草稿自动迁移成项目「我的编舞」', mig.info.projectId && mig.info.name === '我的编舞' && migList.length === 1, JSON.stringify(migList));
    check('迁移后内容与旧草稿一致（结构字段；显示名允许目录修复）', canonContent(mig.content) === canonContent(expectedContent),
      (canonContent(mig.content) === canonContent(expectedContent) ? '' : '期望=' + expectedContent + ' 实际=' + mig.content));
    check('旧草稿原文备份逐字节保留', mig.bak === legacyRaw);
    check('原 choreo_draft 键没被动过', mig.draft === legacyRaw);
    check('迁移标志已写（防重复迁移）', mig.flag === '1');
    check('迁移时有「迁移自旧草稿」版本', JSON.stringify(await cdp.evaluate('__projTest.versions().then(JSON.stringify)')).indexOf('迁移自旧草稿') >= 0);

    // ③ 再刷一次：不重复迁移，内容照常从项目库回来
    const pidBefore = mig.info.projectId;
    await cdp.evaluate('location.reload()');
    await waitFor(cdp, '重载后编辑器就绪', 'window.store && store.appReady', 20000);
    await waitFor(cdp, '项目模块就绪(重载)', 'window.__projTest', 10000);
    const againList = JSON.parse(await cdp.evaluate('__projTest.list().then(JSON.stringify)'));
    const again = JSON.parse(await cdp.evaluate('JSON.stringify(__projTest.info())'));
    check('重开不重复迁移（项目数/id 不变）', againList.length === 1 && again.projectId === pidBefore, JSON.stringify(againList.map((p) => p.name)));
    check('重开后内容从项目库加载', canonContent(await cdp.evaluate('__projTest.content()')) === canonContent(expectedContent));

    // ④ 多项目：新建/打开/改名/复制/删除 + 最近打开排序
    const created = await cdp.evaluate('__projTest.create("验收乙号").then(function(r){return r.id})');
    const afterCreateList = JSON.parse(await cdp.evaluate('__projTest.list().then(JSON.stringify)'));
    const afterCreateInfo = JSON.parse(await cdp.evaluate('JSON.stringify(__projTest.info())'));
    check('新建后切到新项目（1 舞者空项目）', afterCreateInfo.projectId === created && afterCreateInfo.dancers === 1 && afterCreateInfo.clips === 0, JSON.stringify(afterCreateInfo));
    check('清单按最近编辑排序（新建的排最前）', afterCreateList[0].id === created, JSON.stringify(afterCreateList.map((p) => p.name)));
    {
      const reopened = await cdp.evaluate('__projTest.open(' + JSON.stringify(pidBefore) + ').then(function(){return __projTest.content()})');
      const okRe = canonContent(reopened) === canonContent(expectedContent);
      check('打开旧项目 → 内容原样回来', okRe, okRe ? '' : '期望=' + canonContent(expectedContent) + '\n    实际=' + canonContent(reopened));
    }
    await cdp.evaluate('__projTest.rename(' + JSON.stringify(pidBefore) + ',"验收甲号")');
    check('改名后清单与当前项目名同步', JSON.parse(await cdp.evaluate('__projTest.list().then(JSON.stringify)')).find((p) => p.id === pidBefore).name === '验收甲号'
      && (await cdp.evaluate('__projTest.info().name')) === '验收甲号');
    const copyId = await cdp.evaluate('__projTest.duplicate(' + JSON.stringify(pidBefore) + ').then(function(r){return r.id})');
    const dup = JSON.parse(await cdp.evaluate('__projTest.list().then(JSON.stringify)')).find((p) => p.id === copyId);
    check('复制出「验收甲号 副本」', !!dup && dup.name === '验收甲号 副本', dup && dup.name);
    await cdp.evaluate('__projTest.remove(' + JSON.stringify(copyId) + ')');
    check('删除副本后清单回到 2 个', (await cdp.evaluate('__projTest.list().then(function(l){return l.length})')) === 2);

    // ⑤ 崩溃恢复：镜像比库新 → 按镜像恢复并自动存「异常关闭自动恢复」版本
    await cdp.evaluate('(function(){store.dancers[0].name="崩溃恢复标记";__projTest.save()})()');
    // 把镜像换成“崩溃前最后一刻”并拨新 savedAt（模拟 IDB 没写完就关了）。
    // WP-5-WIRE 起镜像 content 存规范文档（舞者在 performers），旧格式（dancers）也一并兼容
    await cdp.evaluate('(function(){var m=JSON.parse(localStorage.getItem("choreo_autosave"));m.savedAt=Date.now()+9999;' +
      'var c=m.content;if(c.performers){c.performers[0].name="崩溃恢复标记"}else{c.dancers=[{id:0,name:"崩溃恢复标记",color:"#7eb3ff",currentJob:null,collapsed:false,laneScale:1,switchClips:[],actionClips:[{id:1,start:0,duration:3,autoDur:false,data:{id:0,name:"鞠躬",command:"/bow",category:"usual",jobName:"",jobId:0,jobAbbr:""}}],lyricClips:[]}]}' +
      'localStorage.setItem("choreo_autosave",JSON.stringify(m))})()');
    await cdp.evaluate('location.reload()');
    await waitFor(cdp, '崩溃恢复后编辑器就绪', 'window.store && store.appReady', 20000);
    await waitFor(cdp, '项目模块就绪(恢复)', 'window.__projTest', 10000);
    check('异常关闭后按镜像恢复内容', (await cdp.evaluate('store.dancers[0].name')) === '崩溃恢复标记', await cdp.evaluate('store.dancers[0].name'));
    check('恢复时自动存「异常关闭自动恢复」版本', JSON.stringify(await cdp.evaluate('__projTest.versions().then(JSON.stringify)')).indexOf('异常关闭自动恢复') >= 0);
    // 反向：镜像陈旧（savedAt 更小）→ 不许它覆盖库里的新内容（镜像名字改掉，恢复后必须看不到它）
    await cdp.evaluate('(function(){var m=JSON.parse(localStorage.getItem("choreo_autosave"));m.savedAt=1;' +
      'var c=m.content;if(c.performers){c.performers[0].name="陈旧镜像"}else{c.dancers[0].name="陈旧镜像"};' +
      'localStorage.setItem("choreo_autosave",JSON.stringify(m))})()');
    await cdp.evaluate('location.reload()');
    await waitFor(cdp, '陈旧镜像重载就绪', 'window.store && store.appReady', 20000);
    check('陈旧镜像不覆盖库里的新内容', (await cdp.evaluate('store.dancers[0].name')) === '崩溃恢复标记');

    // ⑥ 版本快照：存版本 → 改动 → 恢复回滚（恢复前当前内容先被自动存档）
    const vAt = await cdp.evaluate('__projTest.addVersion("验收版本A").then(function(vs){return vs[0].savedAt})');
    await cdp.evaluate('(function(){store.dancers[0].name="改过了";__projTest.save()})()');
    const changed = await cdp.evaluate('store.dancers[0].name');
    await cdp.evaluate('__projTest.restore(' + vAt + ')');
    await waitFor(cdp, '版本恢复完成', 'window.store && store.dancers[0] && store.dancers[0].name==="崩溃恢复标记"', 10000, 300);
    check('恢复版本后内容回滚', (await cdp.evaluate('store.dancers[0].name')) === '崩溃恢复标记', changed + ' → ' + (await cdp.evaluate('store.dancers[0].name')));
    check('恢复前当前内容被自动存档', JSON.stringify(await cdp.evaluate('__projTest.versions().then(JSON.stringify)')).indexOf('恢复版本前自动保存') >= 0);

    // ⑦ 版本封顶：连存 25 个 → 只留最新的 20 个
    await cdp.evaluate('(function(){var p=Promise.resolve();for(var i=0;i<25;i++){(function(i){p=p.then(function(){return __projTest.addVersion("封顶"+i)})})(i)}return p})()');
    const vcnt = await cdp.evaluate('__projTest.versions().then(function(v){return v.length})');
    check('每项目最多保留 20 个版本', vcnt === 20, String(vcnt));

    check('全程无 JS 异常', cdp.exceptions.length === 0, cdp.exceptions.length + ' 个');
  } finally { ch.kill(); }
}

// ---------- 场景：check（WP-4 编舞体检——按钮/弹窗/规则引擎真实出结果/点击跳转） ----------
async function scenarioCheck() {
  console.log('[check] 主页「🩺 体检」：模块加载/无头钩子/弹窗/点击跳转');
  const ch = await launchChrome([], PAGE_URL, { game: true });
  try {
    const cdp = await ch.pageTarget();
    await seedDraftAndReload(cdp);
    await prepOnlineLibrary(cdp);

    check('体检模块已加载（window.ChoreoCheck + __checkRun 钩子）', await cdp.evaluate(
      '!!window.ChoreoCheck && typeof window.__checkRun==="function"'));
    // 动作自动同步是后台异步（全量约 30s），这里不等它——显式导入 bow 保证索引可断言（uicheck 同款路子）
    await cdp.evaluate('window.__libImportFromPlugin(["bow"], null).then(function(r){return JSON.stringify(r)})');
    await waitFor(cdp, 'bow 进资料库', 'ChoreoLibrary.hasClips(["bow"]).then(function(a){return a[0]})', 30000, 500);
    const issues = JSON.parse(await cdp.evaluate('window.__checkRun().then(function(r){return JSON.stringify(r)})'));
    check('__checkRun 对真实项目出结果（数组）', Array.isArray(issues), issues.length + ' 条');
    check('已录的 bow 不误报缺录', !issues.some(function (i) { return i.rule === 'missing-clip' && /行礼|\/bow/.test(i.message); }), JSON.stringify(issues.map(function (i) { return i.rule; })));

    // 种一条肯定没录过的动作 → 缺录规则必须抓到（黄，报对舞者和时间）
    await cdp.evaluate('(function(){store.dancers[0].actionClips.push({id:store.nextClipId++,start:50,duration:3,autoDur:false,selected:false,data:{name:"体检测试缺录",command:"/definitely_not_recorded_xyz"}});return true})()');
    const issues2 = JSON.parse(await cdp.evaluate('window.__checkRun().then(function(r){return JSON.stringify(r)})'));
    const miss = issues2.filter(function (i) { return i.rule === 'missing-clip'; })
      .find(function (i) { return /definitely_not_recorded_xyz/.test(i.message); });
    check('缺录动作被查出（黄/di0/t50）', !!miss && miss.level === 'yellow' && miss.di === 0 && Math.abs(miss.t - 50) < 0.01, JSON.stringify(miss).slice(0, 140));

    // 弹窗 UI：开窗 → 出结果 → 点缺录条目跳转
    check('工具栏有「体检」按钮', await cdp.evaluate(
      '!!Array.prototype.slice.call(document.querySelectorAll(\'.toolbar .btn\')).find(function(b){return b.textContent.indexOf(\'体检\')>=0})'));
    await cdp.evaluate('Array.prototype.slice.call(document.querySelectorAll(\'.toolbar .btn\')).find(function(b){return b.textContent.indexOf(\'体检\')>=0}).click()');
    await sleep(700);
    check('体检窗口打开且显示「检查完成」', await cdp.evaluate(
      '!!document.querySelector(\'.modal-bg\') && document.querySelector(\'.modal\').textContent.indexOf(\'检查完成\')>=0'));
    const rows = await cdp.evaluate(
      '(function(){var rs=Array.prototype.slice.call(document.querySelectorAll(\'.modal-bg div[title="点击跳到这个位置"]\'));var hit=rs.filter(function(r){return r.textContent.indexOf(\'definitely_not_recorded_xyz\')>=0})[0];if(hit)hit.click();return rs.length})()');
    check('结果条目可点击且找到缺录行', rows >= 1, rows + ' 行');
    await sleep(500);
    check('点击后跳到对应时间（50s）', Math.abs((await cdp.evaluate('store.currentTime')) - 50) < 0.51, 'currentTime=' + (await cdp.evaluate('store.currentTime')));
    check('弹窗已关闭', await cdp.evaluate('!document.querySelector(\'.modal-bg\')'));
    check('全程无 JS 异常', cdp.exceptions.length === 0, cdp.exceptions.length + ' 个');
  } finally { ch.kill(); }
}

// ---------- 场景 4：lib-check / mode-check / clip-check 诊断页 ----------
async function scenarioDiag(name, file, passMark) {
  console.log('[' + name + '] 诊断页回归 ' + file + '（origin：' + ((global.__pluginOnline ? true : !global.__mockServer) ? '48795 真插件' : 'MOCK ' + MOCK_PORT) + '）');
  // origin 按阶段3约定：插件在线走真 48795（不因 rec 场景先起过 mock 而被带偏）；离线才用 mock
  const origin = (global.__pluginOnline ? true : !global.__mockServer) ? 'http://localhost:48795/' : ('http://localhost:' + MOCK_PORT + '/');
  const ch = await launchChrome([], origin + file);
  try {
    const cdp = await ch.pageTarget();
    const title = await waitFor(cdp, '诊断结果（标题）', 'document.title && document.title.indexOf(\'' + passMark + '\')>=0 && document.title', 120000, 800)
      .catch(async (e) => {
        console.log('  [debug] 标题=' + await cdp.evaluate('document.title').catch(() => '?'));
        console.log('  [debug] 正文=' + String(await cdp.evaluate('document.body.innerText').catch(() => '?')).slice(0, 1200));
        console.log('  [debug] 异常=' + JSON.stringify(cdp.exceptions.map(x => x.exception ? (x.exception.description || x.exception.value) : x.text)).slice(0, 600));
        console.log('  [debug] 48794请求=' + await cdp.evaluate('(function(){try{var w=document.getElementById("f").contentWindow;return w.performance.getEntriesByType("resource").filter(function(e){return e.name.indexOf(":48794")>=0}).map(function(e){return e.name+" @"+e.startTime.toFixed(1)+"ms"}).join("\\n")}catch(e){return String(e)}})()').catch(() => '?'));
        throw e;
      });
    check(name + ' 回归通过', true, title);
  } finally { ch.kill(); }
}

// ---------- 场景 realrec：真插件真录制（阶段4尾巴 + FIX-C 全链路，主人授权 2026-08-30） ----------
// 与 rec 场景的区别：不启 mock、不改写任何请求——页面直连真 48794/48795，录制真控角色。
// 验证：网页录制中心的取消/刷新续录尾巴 + 真网页路径的两阶段提交（质检→进库→commit→文件落盘）。
async function scenarioRealRec() {
  console.log('[realrec] 真插件真录制（取消/续录/真提交落盘）——需要游戏在线且角色已登录');
  let online = false;
  try { const r = await fetch('http://localhost:48795/capabilities', { signal: AbortSignal.timeout(3000) }); online = r.ok; } catch (e) { }
  if (!online) { console.log('  -- 跳过：插件不在线，本场景只对真插件跑'); return; }
  if (!REAL_PAIR_TOKEN) { console.log('  -- 跳过：读不到真配对码'); return; }
  const names = ['wave', 'greet', 'clap', 'bow', 'joy'];
  const clipPath = (n) => path.join(process.env.APPDATA, 'XIVLauncherCN', 'ChoreoExports', 'clips', n + '.json');
  const pendingDir = path.join(process.env.APPDATA, 'XIVLauncherCN', 'ChoreoExports', 'pending');
  const mtimeOf = (p) => { try { return fs.statSync(p).mtimeMs; } catch (e) { return 0; } };
  const baseMtimes = {}; names.forEach((n) => { baseMtimes[n] = mtimeOf(clipPath(n)); });
  const ch = await launchChrome([], PAGE_URL); // 在线且本场景不做任何改写：页面直连真插件
  try {
    const cdp = await ch.pageTarget();
    await waitFor(cdp, '编辑器就绪', 'window.store && store.appReady', 20000);
    await waitFor(cdp, '录制函数就绪', 'typeof recStart === "function"', 5000);
    await cdp.evaluate(`savePairToken('${REAL_PAIR_TOKEN}')`);
    await waitFor(cdp, '能力握手完成（capsOk=true）', 'window.store && store.capsOk === true', 30000);

    // ① 真录制 5 条，开录后立刻点停止（取消语义=当前条录完后停，留待录项测续录）。
    // 照真实用户路径：先开录制窗口（工具栏按钮）→ recStart——不开窗就没有停止按钮
    const items = '[' + names.map((n) => `{cmd:'/${n} motion',cname:'a',b:'${n}'}`).join(',') + ']';
    await cdp.evaluate(`showRecModal()`);
    await sleep(300);
    await cdp.evaluate(`recStart('pick',${items})`);
    await waitFor(cdp, '录制循环已启动', `__recDebug() && __recDebug().running`, 20000, 200);
    await sleep(1200); // 让当前条进入录制中
    await cdp.evaluate(`(function(){var b=Array.prototype.slice.call(document.querySelectorAll('.modal .btn')).find(function(x){return x.textContent.indexOf('停止')>=0});if(b)b.click()})()`);
    await waitFor(cdp, '取消后退出录制循环', `__recDebug() && !__recDebug().running`, 120000, 500);
    const c1 = JSON.parse(await cdp.evaluate(`JSON.stringify(__recDebug().session)`));
    check('真录制：取消生效（会话未标完成）', c1.finished === false, 'finished=' + c1.finished + ' ' + c1.items.map((i) => i.name + ':' + i.status).join(' '));

    // ② 刷新页面 → 续录横幅 → 继续录制 → 跑完（静止重试判失败的项保留 failed，属质检正确行为）
    await cdp.evaluate(`location.reload()`);
    await waitFor(cdp, '重载后编辑器就绪', 'window.store && store.appReady', 20000);
    await cdp.evaluate(`showRecModal()`);
    await sleep(400);
    check('真录制：重载后出现续录横幅', await cdp.evaluate(
      `(function(){var t=document.querySelector('.modal')?document.querySelector('.modal').textContent:'';return t.indexOf('上次录制未完成')>=0&&t.indexOf('继续录制')>=0})()`));
    await cdp.evaluate(`(function(){var b=Array.prototype.slice.call(document.querySelectorAll('.modal .btn')).find(function(x){return x.textContent==='继续录制'});if(b)b.click()})()`);
    await waitFor(cdp, '续录跑完（无剩余待录）', `(function(){var d=__recDebug();return d&&!d.running&&d.session&&(d.session.finished===true||d.session.items.every(function(i){return i.status!=='pending'}))})()`, 240000, 1000);
    const c2 = JSON.parse(await cdp.evaluate(`JSON.stringify(__recDebug().session)`));
    const doneNames = c2.items.filter((i) => i.status === 'done').map((i) => i.name);
    check('真录制：续录后无剩余待录', c2.items.every((i) => i.status !== 'pending'), c2.items.map((i) => i.name + ':' + i.status).join(' '));

    // ③ 真两阶段提交落盘：done 的文件都被真 commit 覆盖、暂存目录清空、资料库可用
    check('真提交：完成项的 clip 文件都被真 commit 更新（FIX-C 落盘）',
      doneNames.every((n) => mtimeOf(clipPath(n)) > baseMtimes[n]),
      doneNames.map((n) => n + ':' + (mtimeOf(clipPath(n)) > baseMtimes[n])).join(' '));
    const pend = fs.existsSync(pendingDir) ? fs.readdirSync(pendingDir).filter((f) => f.endsWith('.json')) : [];
    check('真提交：暂存目录无孤儿（全部 commit/cancel）', pend.length === 0, pend.join(','));
    const have = JSON.parse(await cdp.evaluate(`ChoreoLibrary.hasClips(${JSON.stringify(doneNames)}).then(JSON.stringify)`));
    check('录完即用：完成动作都在本地资料库', have.every((v) => v === true), JSON.stringify(have));
    check('全程无 JS 异常', cdp.exceptions.length === 0, cdp.exceptions.length + ' 个');
  } finally { ch.kill(); }
}

// ---------- 入口 ----------
(async function main() {
  { const swept = vclean.sweepAll(); if (swept) console.log('[verify-cleanup] 启动清扫：清掉上次残留 ' + swept + ' 个临时目录'); }
  const which = process.argv[2] || 'all';

  // 插件在线检测：SEC-1 起 /export/list 是私有读（未配对 403），探测改走匿名的 /capabilities
  let pluginOnline = false;
  try { const r = await fetch('http://localhost:48795/capabilities', { signal: AbortSignal.timeout(3000) }); pluginOnline = r.ok; } catch (e) { }
  // SEC-1：页面种子配对码——在线打真插件用真码（同 realrec 读本机 pairing.json，不出本机），
  // 离线走 mock 用 TESTCODE。真码读不到且插件在线时仍种 TESTCODE：私有读会 403 被断言如实抓住
  SEED_TOKEN = (pluginOnline && REAL_PAIR_TOKEN) ? REAL_PAIR_TOKEN : 'TESTCODE';
  global.__pluginOnline = pluginOnline;   // 诊断页 origin 依据（阶段3 约定：在线走真插件）
  if (!pluginOnline) {
    global.__mockServer = await startMock();
    console.log('插件（48795）不在线——已启用本机 mock ' + MOCK_PORT + '（真实 clips 数据，只读；CDP 把页面的 48795 请求透明改写过来）');
    const origLaunch = launchChrome;
    // eslint-disable-next-line no-func-assign
    launchChrome = async function (extraArgs, openUrl, opts) {
      // game=true 连 48794 一起仿真（诊断页不仿真，保持原回归形态）
      return attachRewrite(await origLaunch(extraArgs, openUrl), !!(opts && opts.game));
    };
  } else {
    console.log('插件（48795）在线——直接用真插件跑（rec 场景除外：它强制走 mock，不碰真游戏）');
  }

  const run = {
    'sync': [scenarioSync], 'uicheck': [scenarioUicheck], 'full': [scenarioFull], 'auto': [scenarioAuto],
    'rec': [scenarioRec], 'sec': [scenarioSec], 'proj': [scenarioProj], 'check': [scenarioCheck],
    'realrec': [scenarioRealRec], 'clock': [scenarioClock], 'verify': [scenarioVerify],
    'lib-check': [() => scenarioDiag('lib-check', 'library-check.html', 'LIB-PASS')],
    'mode-check': [() => scenarioDiag('mode-check', 'mode-check.html', 'MODE-PASS')],
    'clip-check': [() => scenarioDiag('clip-check', 'clip-check.html', 'CLIP-PASS')],
    'all': [scenarioSec, scenarioAuto, scenarioSync, scenarioUicheck, scenarioProj, scenarioCheck, scenarioRec,
      scenarioClock, scenarioVerify,
      () => scenarioDiag('lib-check', 'library-check.html', 'LIB-PASS'),
      () => scenarioDiag('mode-check', 'mode-check.html', 'MODE-PASS'),
      () => scenarioDiag('clip-check', 'clip-check.html', 'CLIP-PASS')],
  }[which];
  if (!run) { console.error('用法: node library-verify.js [sync|uicheck|full|auto|rec|sec|proj|realrec|clock|verify|lib-check|mode-check|clip-check|all]（all 不含 full，full 单独跑）'); process.exit(2); }
  for (const s of run) {
    try { await s(); }
    catch (e) { check('场景执行失败：' + e.message, false); }
  }
  if (global.__mockServer) { try { global.__mockServer.close(); } catch (e) { } }
  const pass = results.filter(Boolean).length;
  console.log('\n结果：' + pass + ' 通过 / ' + (results.length - pass) + ' 失败');
  process.exit(process.exitCode ? 1 : 0);
})();
