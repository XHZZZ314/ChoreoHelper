// probe-clipcheck.js — 一次性诊断探针：无头 Chrome 打开 clip-check.html，实时打印标题、
// 日志区尾部和控制台错误/异常（定位哪条断言挂了）。用完可删。
'use strict';
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CHROME = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'].find(p => fs.existsSync(p));
const FILE = process.argv[2] || 'clip-check.html';
const ORIGIN = process.argv[3] || 'file:///' + path.join(__dirname, '..', 'web', FILE).replace(/\\/g, '/');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'probe-'));
const proc = spawn(CHROME, [
  '--headless=new', '--remote-debugging-port=9777', '--no-first-run', '--user-data-dir=' + tmp,
  '--autoplay-policy=no-user-gesture-required', ORIGIN,
], { stdio: 'ignore' });

setTimeout(async () => {
  try {
    const targets = await getJSON('http://127.0.0.1:9777/json');
    console.log('targets:', targets.map(t => t.type + ' ' + t.title + ' ' + t.url.slice(0, 80)).join(' ;; '));
    const page = targets.find(t => t.type === 'page');
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    let id = 0; const pending = {};
    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && pending[m.id]) { pending[m.id](m.result); delete pending[m.id]; return; }
      if (m.method === 'Runtime.exceptionThrown') {
        const d = m.params.exceptionDetails;
        console.log('[异常]', d.exception && (d.exception.description || d.exception.value) || d.text, '@', d.url || '', d.lineNumber);
      }
      if (m.method === 'Runtime.consoleAPICalled' && (m.params.type === 'error' || m.params.type === 'warning')) {
        console.log('[console.' + m.params.type + ']', m.params.args.map(a => a.value || a.description || '').join(' '));
      }
    };
    ws.onopen = () => {
      ws.send(JSON.stringify({ id: 1, method: 'Runtime.enable' }));
      let n = 0;
      const timer = setInterval(() => {
        n++;
        ws.send(JSON.stringify({ id: 10 + n, method: 'Runtime.evaluate', params: { expression: 'document.title + " || " + (document.getElementById("log") ? document.getElementById("log").textContent.slice(-600) : "")' } }));
        pending[10 + n] = (r) => { if (n % 4 === 0) console.log('[' + n * 2 + 's]', String(r.result.value).replace(/\n/g, ' | ').slice(-500)); };
        if (n >= 45) { clearInterval(timer); console.log('== 结束 =='); proc.kill(); process.exit(0); }
      }, 2000);
    };
  } catch (e) { console.error('探针失败', e); proc.kill(); process.exit(1); }
}, 2500);

function getJSON(url) {
  return new Promise((res, rej) => {
    http.get(url, (r) => { let b = ''; r.on('data', c => b += c); r.on('end', () => res(JSON.parse(b))); }).on('error', rej);
  });
}
