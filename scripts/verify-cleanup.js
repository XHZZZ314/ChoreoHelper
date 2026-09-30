/* verify-cleanup.js —— 无头 Chrome 验收脚本的临时 profile 清理公共件
这个文件是干嘛的：
  offline-verify / library-verify / clipcheck-run 三个验收脚本共用。
  2026-08-29 清理 Temp 时发现历史残留 400+ 个 choreo-* 临时目录（上百 GB）——根因是脚本
  只在 finally 里清理，Ctrl+C、未捕获异常、进程被强杀时不会走 finally。本模块保证四条
  路径都杀 Chrome 并删掉本次的临时 profile：
    ① 正常结束 ② Ctrl+C（SIGINT/SIGTERM） ③ 未捕获异常 ④ process exit 事件
  另外提供启动清扫 sweepAll()：每次启动先扫一遍 os.tmpdir() 里三个脚本前缀的陈旧残留
  （超过 1 小时没动过的才删，避免误伤并行正在跑的另一个实例）——就算上次被强杀没清干净，
  下次启动也会顺手清掉。
用法（三个脚本同款两行）：
  const vclean = require('./verify-cleanup');
  launchChrome 里 spawn 之后： vclean.register(proc, profile);
  main 开头： vclean.sweepAll();
*/
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

// 三个验收脚本的临时目录前缀（启动清扫只认这些，别加通用前缀以免误删别人的东西）
const ALL_PREFIXES = ['choreo-verify-', 'choreo-libverify-', 'clipcheck-run-'];
const STALE_MS = 60 * 60 * 1000; // 1 小时内的新目录不扫——可能是并行实例的活跃 profile

const registered = []; // { proc, profile }
let installed = false;

function cleanup() {
  for (const r of registered) {
    try { if (r.proc) r.proc.kill(); } catch (e) {}
    try { if (r.profile) fs.rmSync(r.profile, { recursive: true, force: true }); } catch (e) {}
  }
}

function install() {
  if (installed) return;
  installed = true;
  process.on('exit', () => cleanup()); // 退出事件回调必须同步：kill + rmSync 都是同步的，没问题
  process.on('SIGINT', () => { cleanup(); process.exit(130); });
  process.on('SIGTERM', () => { cleanup(); process.exit(143); });
  process.on('uncaughtException', (e) => {
    try { console.error('[verify-cleanup] 未捕获异常，先清理临时目录再退出：', (e && (e.stack || e.message)) || e); } catch (_) {}
    process.exit(1);
  });
}

// spawn 完 Chrome、mkdtemp 完 profile 后登记；此后四条退出路径都会清它们
function register(proc, profile) {
  install();
  registered.push({ proc: proc, profile: profile });
}

// 启动清扫：只删三个脚本前缀、且超过 1 小时未动的目录；返回删掉的数量
function sweepAll() {
  let names = [];
  try { names = fs.readdirSync(os.tmpdir()); } catch (e) { return 0; }
  const now = Date.now();
  let n = 0;
  for (const name of names) {
    if (!ALL_PREFIXES.some((p) => name.indexOf(p) === 0)) continue;
    const full = path.join(os.tmpdir(), name);
    try {
      const st = fs.statSync(full);
      if (!st.isDirectory()) continue;
      if (now - st.mtimeMs < STALE_MS) continue;
      fs.rmSync(full, { recursive: true, force: true });
      n++;
    } catch (e) { /* 被占用的跳过，不强制 */ }
  }
  return n;
}

module.exports = { register: register, sweepAll: sweepAll, cleanup: cleanup };
