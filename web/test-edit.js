
/* test-edit.js —— 时间轴编辑基础纯函数层（web\choreo-edit.js）node 单测（WP-3 第二增量）
这个文件是干嘛的：
  用 node 直接跑（D:\nodejs\node.exe web\test-edit.js），不依赖浏览器，覆盖：
  - 0.5s 量化 / 遍历与选中（多选、全选、清除）
  - 批量平移（钳制+量化）、对齐到播放头
  - 插入时间 / 删除时间（ripple：区内删、横跨缩短、起点在区内截断、后方左移、标记平移）
  - 复制序列化 / 粘贴（新 id、同舞者同轨、全局歌词回全局轨、data 深拷贝隔离）
  - 段落标记增删改排、id 唯一性
  - 独奏/静音口径、游戏播放 payload 组装（buildGameClips 过滤静音舞者）
  和 test-engine.js / test-projects.js 同一套路：✔/✘ 打点，结尾报数，失败置退出码 1。
*/
'use strict';
require('./choreo-edit.js');
const CE = globalThis.ChoreoEdit;
const pure = CE.pure;

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  ✔ ' + name + (detail !== undefined ? '（' + detail + '）' : '')); }
  else { fail++; console.log('  ✘ ' + name + (detail !== undefined ? '（' + detail + '）' : '')); }
}
function eqJson(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

// 造一个标准 content：2 个舞者 + 全局歌词，clip 结构和主页一致
function mkClip(id, start, duration, extra) {
  return Object.assign({ id: id, start: start, duration: duration, autoDur: false, data: { name: 'c' + id, command: '/emote' + id, category: 'usual' } }, extra || {});
}
function mkContent() {
  return {
    dancers: [
      { id: 0, name: '舞者1', switchClips: [mkClip(1, 0, 1)], actionClips: [mkClip(2, 5, 2), mkClip(3, 10, 3)], lyricClips: [] },
      { id: 1, name: '舞者2', switchClips: [], actionClips: [mkClip(4, 8, 2)], lyricClips: [mkClip(5, 12, 3, { data: { name: '台词', command: '/y hi', category: 'lyric', isLyric: true } })] },
    ],
    globalLyrics: [mkClip(6, 12, 2, { data: { name: '啦啦啦', command: '', category: 'lyric', isLyric: true } })],
    markers: [{ id: 'mA', t: 3, name: '开头' }, { id: 'mB', t: 15, name: '副歌' }],
  };
}

(async function main() {
  console.log('== 1. 量化与遍历/选中 ==');
  ok('q05 半秒量化：1.24→1.0、1.3→1.5、2.0→2.0', pure.q05(1.24) === 1 && pure.q05(1.3) === 1.5 && pure.q05(2) === 2);
  const c1 = mkContent();
  c1.dancers[0].actionClips[0].selected = true;
  c1.globalLyrics[0].selected = true;
  const sel = pure.collectSelected(c1);
  ok('collectSelected 找到 2 条（含全局歌词轨 global）', sel.length === 2 && sel.some(s => s.track === 'global') && sel.some(s => s.track === 'action'));
  ok('selectAll 全部选中（6 条里新选中 4 条）', pure.selectAll(c1) === 4 && pure.collectSelected(c1).length === 6);
  ok('clearSelection 清干净', pure.clearSelection(c1) === 6 && pure.collectSelected(c1).length === 0);
  let seen = 0;
  pure.eachClip(c1, function (c, di, tt) { seen++; if (di === -1) ok('全局歌词 di=-1/track=global', tt === 'global', 'id=' + c.id); });
  ok('eachClip 遍历总数 6', seen === 6);

  console.log('== 2. 批量平移 / 对齐 ==');
  const c2 = mkContent();
  const items = [{ clip: c2.dancers[0].actionClips[0] }, { clip: c2.dancers[1].actionClips[0] }]; // start 5 / 8，dur 2
  pure.batchMove(items, 2.5, 300);
  ok('批量平移 +2.5s：两条都移动且 0.5 量化', c2.dancers[0].actionClips[0].start === 7.5 && c2.dancers[1].actionClips[0].start === 10.5);
  pure.batchMove(items, -100, 300);
  ok('批量平移钳制（AUD-008）：整组一起停在最左，间距 3 不变', c2.dancers[0].actionClips[0].start === 0 && c2.dancers[1].actionClips[0].start === 3);
  pure.batchMove(items, 1000, 300);
  ok('批量平移钳制（AUD-008）：整组一起停在最右（最晚 end=300），间距 3 不变', c2.dancers[0].actionClips[0].start === 295 && c2.dancers[1].actionClips[0].start === 298);
  const c2b = mkContent();
  const n = pure.alignStarts([{ clip: c2b.dancers[0].actionClips[0] }, { clip: c2b.globalLyrics[0] }], 42);
  ok('对齐到播放头：跨舞者/全局轨起点都=42、时长不变、返回条数',
    n === 2 && c2b.dancers[0].actionClips[0].start === 42 && c2b.globalLyrics[0].start === 42 && c2b.dancers[0].actionClips[0].duration === 2);

  console.log('== 3. 插入时间 ==');
  const c3 = mkContent();
  // 造一条横跨插入点的：start 6 dur 5（6~11），在 8 插 2 → 不动
  c3.dancers[0].actionClips.push(mkClip(7, 6, 5));
  pure.insertTime(c3, 8, 2);
  ok('插入：start≥t 的右移（10→12）', c3.dancers[0].actionClips[1].start === 12);
  ok('插入：start<t 的不动（5 不变）', c3.dancers[0].actionClips[0].start === 5);
  ok('插入：横跨插入点的条目不动（6~11 不变）', c3.dancers[0].actionClips[2].start === 6 && c3.dancers[0].actionClips[2].duration === 5);
  ok('插入：其他舞者/台词/全局歌词一起右移（8→10、12→14、12→14）',
    c3.dancers[1].actionClips[0].start === 10 && c3.dancers[1].lyricClips[0].start === 14 && c3.globalLyrics[0].start === 14);
  ok('插入：标记平移（3 不动、15→17）', c3.markers[0].t === 3 && c3.markers[1].t === 17);

  console.log('== 4. 删除时间（ripple） ==');
  const c4 = mkContent();
  c4.dancers[0].actionClips = [
    mkClip(11, 2, 2),   // 区间前：不动
    mkClip(12, 4, 10),  // 4~14 横跨 [6,8)：缩短 2
    mkClip(13, 6.5, 1), // 6.5~7.5 完全在区间内：删
    mkClip(14, 7, 6),   // 7~13 起点在区间内：截到 6，时长 13-8=5
    mkClip(15, 9, 2),   // 区间后：左移 2 → 7
  ];
  c4.markers = [{ id: 'x1', t: 5, name: 'a' }, { id: 'x2', t: 7, name: 'b' }, { id: 'x3', t: 10, name: 'c' }];
  const r4 = pure.deleteTime(c4, 6, 8);
  const ids = c4.dancers[0].actionClips.map(c => c.id);
  ok('删除：完全在区间内的被移除（removed=1；7~13 的截后剩 5s 应保留）', r4.removed === 1 && !ids.includes(13));
  ok('删除：区间前不动（start=2）', c4.dancers[0].actionClips.find(c => c.id === 11).start === 2);
  const c12 = c4.dancers[0].actionClips.find(c => c.id === 12);
  ok('删除：横跨条目缩短且转显式时长（4~14 → dur 8、autoDur=false）', c12.start === 4 && c12.duration === 8 && c12.autoDur === false);
  const c14 = c4.dancers[0].actionClips.find(c => c.id === 14);
  ok('删除：起点在区间内的截到 t0（7→6，dur=5）', c14.start === 6 && c14.duration === 5);
  ok('删除：区间后左移（9→7）', c4.dancers[0].actionClips.find(c => c.id === 15).start === 7);
  ok('删除：标记区间内并到 t0（7→6）、区间后左移（10→8）',
    c4.markers.find(m => m.id === 'x2').t === 6 && c4.markers.find(m => m.id === 'x3').t === 8 && c4.markers.find(m => m.id === 'x1').t === 5);
  ok('删除：其他轨（全局歌词 12→10）也参与', c4.globalLyrics[0].start === 10);
  ok('删除：零长度区间直接返回', pure.deleteTime(c4, 5, 5).removed === 0);

  console.log('== 4b. 删除时间补漏（AUD-007） ==');
  const c4b = mkContent();
  c4b.dancers[0].actionClips = [mkClip(21, 4, 3)]; // [4,7)，删 [6,8)：起点在左、终点在区内
  const r4b = pure.deleteTime(c4b, 6, 8);
  const aL21 = c4b.dancers[0].actionClips[0];
  ok('左截：[4,7) 删 [6,8) → [4,6)（旧版原样不动）', r4b.removed === 0 && aL21.start === 4 && aL21.duration === 2 && aL21.autoDur === false,
    aL21.start + '..' + (aL21.start + aL21.duration));
  c4b.dancers[0].actionClips = [mkClip(22, 5.7, 1)]; // [5.7,6.7) 截到 6 剩 0.3s <0.5 → 删
  c4b.dancers[1].actionClips = []; c4b.globalLyrics = []; // 干掉会左移进删除区的其他条，只看本用例
  const r4c = pure.deleteTime(c4b, 6, 8);
  ok('左截后不足 0.5s → 删', r4c.removed === 1 && c4b.dancers[0].actionClips.length === 0);
  c4b.dancers[0].actionClips = [mkClip(23, 1, 5), mkClip(24, 8, 2)]; // [1,6) 相接不交；[8,10) 起点恰=t1
  pure.deleteTime(c4b, 6, 8);
  ok('相接边界：终点=t0 不动、起点=t1 左移',
    c4b.dancers[0].actionClips[0].start === 1 && c4b.dancers[0].actionClips[0].duration === 5 &&
    c4b.dancers[0].actionClips[1].start === 6);
  const c4d = mkContent();
  c4d.dancers[0].switchClips = [mkClip(31, 4, 3)];
  c4d.dancers[0].lyricClips = [mkClip(32, 4, 3)];
  c4d.globalLyrics = [mkClip(33, 4, 3)];
  pure.deleteTime(c4d, 6, 8);
  ok('四类轨同一口径：切职业/台词/全局歌词轨同样左截',
    c4d.dancers[0].switchClips[0].duration === 2 && c4d.dancers[0].lyricClips[0].duration === 2 && c4d.globalLyrics[0].duration === 2);

  console.log('== 2b. 整组平移 moveGroup（AUD-008） ==');
  const c2c = mkContent();
  const g1 = c2c.dancers[0].actionClips[0];                    // start 5，dur 2
  const g2c = c2c.dancers[1].lyricClips[0];                    // start 12，dur 3（跨舞者跨轨）
  const items2 = [{ clip: g1 }, { clip: g2c }];
  const ap1 = pure.moveGroup(items2, -20, 300);
  ok('左边界：整组停在最左（5→0），applied=-5', ap1 === -5 && g1.start === 0 && g2c.start === 7);
  const ap2 = pure.moveGroup(items2, 999, 300);
  ok('右边界：最晚 end 顶到 300，applied=290', ap2 === 290 && g1.start === 290 && g2c.start === 297);
  ok('间距保持：两两相对间距移动前后不变（7）', g2c.start - g1.start === 7);
  ok('delta=0 不动、返回 0', pure.moveGroup(items2, 0, 300) === 0 && g1.start === 290);
  ok('空数组/undefined 不炸', pure.moveGroup([], 5, 300) === 0 && pure.moveGroup(null, 5, 300) === 0);

  console.log('== 5. 复制 / 粘贴 ==');
  const c5 = mkContent();
  c5.dancers[0].actionClips[0].selected = true;  // id2 start5
  c5.globalLyrics[0].selected = true;            // id6 start12
  const cb5 = pure.serializeSelection(pure.collectSelected(c5));
  ok('序列化：rel 相对最早条（0 和 7）、data 深拷贝',
    cb5.minStart === 5 && cb5.items[0].rel === 0 && cb5.items[1].rel === 7 && cb5.items[0].data !== c5.dancers[0].actionClips[0].data);
  let nid = 100; const alloc = () => nid++;
  const created = pure.pasteItems(cb5, c5, 100, alloc);
  ok('粘贴：生成 2 条新 clip、id 全新、起点=100/107', created.length === 2 && created[0].id === 100 && created[0].start === 100 && created[1].start === 107);
  ok('粘贴：全局歌词条回到全局轨', c5.globalLyrics.some(c => c.id === 101 && c.data.isLyric));
  ok('粘贴：原数据不被共享（改副本不影响原件）', (created[0].data.name = '改动') && c5.dancers[0].actionClips[0].data.name === 'c2');
  ok('粘贴：autoDur=false（显式时长）', created.every(c => c.autoDur === false));
  const created2 = pure.pasteItems(cb5, { dancers: [c5.dancers[0]], globalLyrics: [] }, 200, alloc);
  ok('粘贴：舞者数不够时只粘存在的舞者（全局歌词仍粘）',
    created2.length === 2 && created2[0].id === 102 && created2.every(c => c.start === 200 + (c.id === 102 ? 0 : 7)));

  console.log('== 5b. 腾位（makeRoom + 粘贴/复制防重叠） ==');
  const c5b = mkContent();
  c5b.dancers = [c5b.dancers[0]];
  c5b.dancers[0].actionClips = [mkClip(21, 5, 5), mkClip(22, 12, 2)]; // 5..10、12..14
  c5b.globalLyrics = [];
  const cb5b = { minStart: 0, items: [{ di: 0, track: 'action', rel: 0, duration: 3, autoDur: false, data: { name: '丙', command: '/bing', category: 'usual' } }] };
  let nid5b = 300; const alloc5b = () => nid5b++;
  const made = pure.pasteItems(cb5b, c5b, 6, alloc5b);
  const a21 = c5b.dancers[0].actionClips.find(c => c.id === 21), a22 = c5b.dancers[0].actionClips.find(c => c.id === 22);
  ok('粘贴腾位：横跨播放头的条截断到播放头（5..10 → 5..6）', a21.start === 5 && a21.duration === 1 && a21.autoDur === false, a21.start + '..' + (a21.start + a21.duration));
  ok('粘贴腾位：播放头之后的条整体右移（12→15，保间距）', a22.start === 15, '实际=' + a22.start);
  ok('粘贴条落在腾出的空位（6..9）', made.length === 1 && made[0].start === 6 && made[0].duration === 3);
  ok('腾位后同轨零重叠', (() => {
    const a = c5b.dancers[0].actionClips.slice().sort((x, y) => x.start - y.start);
    return a.every((c, i) => i === 0 || a[i - 1].start + a[i - 1].duration <= c.start + 1e-9);
  })());
  ok('makeRoom：横跨条截完不足 0.5s 直接删', (() => {
    const arr = [mkClip(31, 5.8, 0.4)]; // 5.8..6.2 横跨 6，截后剩 0.2s → 删
    const r = pure.makeRoom(arr, 6, 2);
    return r.removed === 1 && arr.length === 0;
  })());
  ok('makeRoom：之前不动 / 横跨截断 / 之后右移且互保间距', (() => {
    const arr = [mkClip(32, 1, 2), mkClip(33, 4, 5), mkClip(34, 10, 1), mkClip(35, 20, 2)];
    pure.makeRoom(arr, 8, 3); // 32 在前不动；33 横跨8截到8（4..8）；34→13；35→23
    return arr.find(c => c.id === 32).start === 1 &&
      arr.find(c => c.id === 33).duration === 4 && arr.find(c => c.id === 33).autoDur === false &&
      arr.find(c => c.id === 34).start === 13 && arr.find(c => c.id === 35).start === 23;
  })());
  ok('makeRoom：span≤0 什么都不动', (() => {
    const arr = [mkClip(36, 10, 2)];
    pure.makeRoom(arr, 5, 0);
    return arr.length === 1 && arr[0].start === 10;
  })());

  console.log('== 6. 段落标记 ==');
  const ms = [];
  const m1 = pure.addMarker(ms, 10, '副歌', 'id1');
  const m2 = pure.addMarker(ms, 2, '开头', 'id2');
  ok('addMarker 插入后按时间排序', ms.length === 2 && ms[0].id === 'id2' && ms[1].id === 'id1');
  ok('updateMarker 改时间/名字并重排', pure.updateMarker(ms, 'id1', { t: 1, name: '新开头' }) && ms[0].id === 'id1' && ms[0].name === '新开头');
  ok('removeMarker 删除并报告', pure.removeMarker(ms, 'id2') === true && !pure.removeMarker(ms, 'id2') && ms.length === 1);
  let uniq = new Set();
  for (let i = 0; i < 200; i++) uniq.add(pure.newMarkerId());
  ok('newMarkerId 200 次全唯一', uniq.size === 200);

  console.log('== 7. 独奏 / 静音 ==');
  const ds7 = [{ name: 'a' }, { name: 'b', solo: true }, { name: 'c', mute: true }];
  ok('没人独奏/静音时全不静音（旧数据无字段也算 false）', !pure.isMuted([{ name: 'x' }], 0) && !pure.anySolo(ds7.slice(0, 1)));
  ok('有人独奏：独奏者播、其他人静音', !pure.isMuted(ds7, 1) && pure.isMuted(ds7, 0) && pure.isMuted(ds7, 2));
  ok('独奏者自己 mute 也静音', (() => { const d = [{ solo: true, mute: true }]; return pure.isMuted(d, 0); })());
  ok('mutedMap 一次算全', eqJson(pure.mutedMap(ds7), { 0: true, 2: true }));
  ok('越界 di 不炸（false）', pure.isMuted(ds7, 9) === false);

  console.log('== 8. 游戏播放 payload（buildGameClips） ==');
  const c8 = mkContent();
  c8.dancers[1].mute = true; // 舞者2 整个静音（含台词轨）
  const g = pure.buildGameClips(c8.dancers, c8.globalLyrics, (ds, di) => pure.isMuted(ds, di));
  ok('静音舞者的条目全部不进 payload（剩 1 switch+2 action+1 全局歌词=4）', g.length === 4 && !g.some(x => x.id === 4 || x.id === 5));
  ok('payload 字段与原 gameStartPlay 组装一致', (() => {
    const x = g.find(v => v.id === 2);
    return x.command === '/emote2' && x.type === 'action' && x.name === 'c2' && x.start === 5 && x.duration === 2;
  })());
  ok('actorId 带舞者下标（FIX-B/AUD2-004：事件带演员维度）', (() => {
    const x2 = g.find(v => v.id === 2);   // 舞者1 的 action → actorId 0
    const x1 = g.find(v => v.id === 1);   // 舞者1 的 switch → actorId 0
    const x6 = g.find(v => v.id === 6);   // 全局歌词 → actorId -1（不受静音影响）
    const dancerClips = g.filter(v => v.type !== 'lyric');
    return x2.actorId === 0 && x1.actorId === 0 && x6.actorId === -1 && dancerClips.every(v => v.actorId === 0); // 舞者2 全被过滤
  })());
  const g3 = pure.buildGameClips(mkContent().dancers, mkContent().globalLyrics, null);
  ok('多舞者 actorId 各归各 + 全局歌词 actorId=-1', (() => {
    const x4 = g3.find(v => v.id === 4);  // 舞者2 的 action → actorId 1
    const x5 = g3.find(v => v.id === 5);  // 舞者2 的台词 → actorId 1
    const x6 = g3.find(v => v.id === 6);  // 全局歌词 → actorId -1
    return x4.actorId === 1 && x5.actorId === 1 && x6.actorId === -1;
  })());
  ok('全局歌词不受静音影响（type=lyric）', g.some(v => v.id === 6 && v.type === 'lyric'));
  ok('按 start 排序', g.every((v, i) => i === 0 || g[i - 1].start <= v.start));
  const g2 = pure.buildGameClips(c8.dancers, c8.globalLyrics, null);
  ok('不给过滤函数时全量（6 条）', g2.length === 6);

  console.log('== 8b. 游戏预览舞者 payload（ACTOR：游戏内一次只演一位） ==');
  // 复现口径：双舞者动作时间重叠（舞者1 [5,7) vs 舞者2 [6,8)）——旧实现把两人事件全发进
  // 同一 payload，插件 PlaybackManager.ExecuteClip 不分 ActorId 全部执行在同一个本地角色上
  const ca = mkContent();
  ca.dancers[1].actionClips[0].start = 6; // 舞者2 动作 [6,8)，与舞者1 [5,7) 重叠
  const ga = pure.buildGameClips(ca.dancers, ca.globalLyrics, (ds, di) => pure.isMuted(ds, di), 1);
  ok('指定预览舞者=1：只发舞者2 的条目+全局歌词，舞者1 全部不进 payload',
     ga.length === 3 && ga.every(x => x.actorId === 1 || x.actorId === -1) && !ga.some(x => x.id === 1 || x.id === 2 || x.id === 3));
  ok('重叠事件不再互相盖：payload 里动作只剩预览舞者那一列',
     ga.filter(x => x.type === 'action').length === 1 && ga.find(x => x.type === 'action').actorId === 1);
  const gb = pure.buildGameClips(ca.dancers, ca.globalLyrics, null, 0);
  ok('指定预览舞者=0：只发舞者1（3 条）+全局歌词，舞者2 不进',
     gb.length === 4 && gb.every(x => x.actorId === 0 || x.actorId === -1) && !gb.some(x => x.id === 4 || x.id === 5));
  ok('显式预览舞者不受静音影响（静音是网页排练口径，选谁演谁）', (() => {
    const cm = mkContent(); cm.dancers[0].mute = true;
    const gm = pure.buildGameClips(cm.dancers, cm.globalLyrics, (ds, di) => pure.isMuted(ds, di), 0);
    return gm.filter(x => x.actorId === 0).length === 3 && gm.some(x => x.id === 6);
  })());
  ok('预览舞者下标越界：只剩全局歌词（不静默换成别人）', (() => {
    const go2 = pure.buildGameClips(ca.dancers, ca.globalLyrics, null, 9);
    return go2.length === 1 && go2[0].actorId === -1;
  })());
  ok('不传预览舞者保持全量口径（clip-check 等检查方仍要看全部舞者）',
     pure.buildGameClips(ca.dancers, ca.globalLyrics, null).length === 6);

  console.log('== 9. 实测时长自动校正（applyMeasuredDurations，AUD-015） ==');
  const md = { '/emote1': 5.2, '/emote5': 1.0 };
  const d9 = [{ actionClips: [
      mkClip(1, 0, 3, { autoDur: true }),                                        // 有实测 → 5.2
      mkClip(2, 5, 2, { autoDur: true, data: { name: 'x', command: '/nomd' } }), // 无实测 → 不动
      mkClip(3, 8, 5.2, { autoDur: true }),                                      // 已等于实测（差<0.01）→ 不算修正
      mkClip(4, 15, 3, { autoDur: false }),                                      // 手动锁定的不动
    ], switchClips: [mkClip(5, 0, 2, { autoDur: true })], lyricClips: [] }];
  const fixed9 = pure.applyMeasuredDurations(d9, md);
  ok('修正数=2（1 个动作 + 1 个切职业）', fixed9 === 2, '实际=' + fixed9);
  ok('有实测的 clip 改成实测值并锁定 autoDur', d9[0].actionClips[0].duration === 5.2 && d9[0].actionClips[0].autoDur === false);
  ok('无实测的 clip 不动', d9[0].actionClips[1].duration === 2 && d9[0].actionClips[1].autoDur === true);
  ok('差值 <0.01 的不算修正', d9[0].actionClips[2].duration === 5.2);
  ok('手动锁定（autoDur=false）的不动', d9[0].actionClips[3].duration === 3 && d9[0].actionClips[3].autoDur === false);
  ok('切职业轨同样被校正', d9[0].switchClips[0].duration === 1.0);
  ok('空入参不炸', pure.applyMeasuredDurations(null, md) === 0 && pure.applyMeasuredDurations(d9, null) === 0);

  console.log('== 10. 自动切职业落位（planActionPlacement，AUD-010） ==');
  function ovl(s, a) { return s.start < a.start + a.duration - 0.01 && s.start + s.duration > a.start + 0.01; }
  function noSelfRed(sw, ac) {
    for (const s of sw) for (const a of ac) if (ovl(s, a)) return false;
    for (let i = 1; i < sw.length; i++) {
      const p = [...sw].sort((x, y) => x.start - y.start);
      if (p[i].start < p[i - 1].start + p[i - 1].duration - 0.01) return false;
    }
    return true;
  }
  // ① 空轨：切职业 [9.5,10)，动作 10 起——互不相交
  {
    const p = pure.planActionPlacement([], [], 10, 3, true);
    ok('空轨：st 不动、切职业 [9.5,10) 0.5s', p.st === 10 && p.swStart === 9.5 && p.swDur === 0.5
      && noSelfRed([{ start: p.swStart, duration: p.swDur }], [{ start: p.st, duration: 3 }]));
  }
  // ② 0 秒起点：动作推到 0.5 让切职业放得下
  {
    const p = pure.planActionPlacement([], [], 0, 3, true);
    ok('0 秒起点：st 推到 0.5、切职业 [0,0.5)', p.st === 0.5 && p.swStart === 0 && p.swDur === 0.5
      && noSelfRed([{ start: p.swStart, duration: p.swDur }], [{ start: p.st, duration: 3 }]));
  }
  // ③ 已有切职业占窗：切职业顺延到已有条之后
  {
    const sw = [mkClip(41, 8, 1)]; // [8,9)
    const p = pure.planActionPlacement(sw, [], 9, 3, true);
    ok('已有切职业占窗：st=9→9.5、新切职业 [9,9.5)', p.st === 9.5 && p.swStart === 9 && p.swDur === 0.5
      && noSelfRed(sw.concat([{ start: p.swStart, duration: p.swDur }]), [{ start: p.st, duration: 3 }]));
  }
  // ④ 已有动作占窗（连续时间轴典型场景）：整体 +0.5 顺延
  {
    const ac = [mkClip(42, 0, 5)]; // [0,5)
    const p = pure.planActionPlacement([], ac, 5, 3, true);
    ok('已有动作顶到 st：st=5→5.5、切职业 [5,5.5)', p.st === 5.5 && p.swStart === 5 && p.swDur === 0.5
      && noSelfRed([{ start: p.swStart, duration: p.swDur }], ac.concat([{ start: p.st, duration: 3 }])));
  }
  // ⑤ 同职业连续动作：不需要切职业（needSwitch=false 原样返回）
  {
    const p = pure.planActionPlacement([], [], 7, 3, false);
    ok('不需要切职业：st 不动、swStart/swDur=0', p.st === 7 && p.swStart === 0 && p.swDur === 0);
  }
  // ⑥ 动作窗与已有切职业冲突：+0.05 顺延后再落切职业
  {
    const sw = [mkClip(43, 5, 1)]; // [5,6)
    const p = pure.planActionPlacement(sw, [], 4, 3, true);
    ok('动作窗撞切职业轨：st=4→6.5、切职业 [6,6.5)', p.st === 6.5 && p.swStart === 6 && p.swDur === 0.5
      && noSelfRed(sw.concat([{ start: p.swStart, duration: p.swDur }]), [{ start: p.st, duration: 3 }]));
  }
  // ⑦ 切职业窗撞长动作：一次性顺延到动作结束 +0.5
  {
    const ac = [mkClip(44, 0, 10)]; // [0,10)
    const p = pure.planActionPlacement([], ac, 2, 3, true);
    ok('切职业窗撞长动作：st=2→10.5、切职业 [10,10.5)', p.st === 10.5 && p.swStart === 10 && p.swDur === 0.5
      && noSelfRed([{ start: p.swStart, duration: p.swDur }], ac.concat([{ start: p.st, duration: 3 }])));
  }

  // ============ FIX-4/AUD-013：宏口径共享纯函数（generateMacro 与体检共用） ============
  function mkMClip(start, dur, cmd, extra) {
    return { id: 1, start: start, duration: dur, data: Object.assign({ name: cmd || '', command: cmd || '' }, extra || {}) };
  }
  function mkDancer() {
    return { id: 0, name: '舞者1', switchClips: [], actionClips: [], lyricClips: [] };
  }

  // macroEvents：三轨合成 + 同刻顺序 switch→action→歌词（稳定）
  {
    const d = mkDancer();
    d.actionClips.push(mkMClip(0, 3, '/bow'));
    d.switchClips.push(mkMClip(0, 1, '/gs change 1'));
    d.lyricClips.push(mkMClip(0, 1, '/say 一'));
    d.actionClips.push(mkMClip(5, 3, '/wave'));
    const ev = pure.macroEvents(d, [], false);
    ok('macroEvents 数量与排序', ev.length === 4 && ev[3].clip.start === 5);
    ok('同刻顺序 switch→action→歌词',
      ev[0].type === 'switch' && ev[1].type === 'action' && ev[2].type === 'lyric');
    ok('关歌词宏时全局歌词不进', pure.macroEvents(d, [mkMClip(9, 1, '/say 全')], false).length === 4);
    ok('开歌词宏时全局歌词进', pure.macroEvents(d, [mkMClip(9, 1, '/say 全')], true).length === 5);
    // 去重：全局歌词与舞者歌词同刻（<0.15s）同名 → 不重复输出
    const g = mkMClip(5.05, 1, '/say 全局'); g.data.name = 'w';
    const d2 = mkDancer();
    d2.actionClips.push(mkMClip(0, 3, '/bow'));
    d2.lyricClips.push(mkMClip(5, 1, '/say 舞者')); d2.lyricClips[0].data.name = 'w';
    ok('同刻同名全局歌词去重', pure.macroEvents(d2, [g], true).length === 2);
    ok('不同名不去重', pure.macroEvents(d2, [Object.assign({}, g, { data: { name: 'x', command: '/say 全局' } })], true).length === 3);
    ok('空舞者返回空数组', JSON.stringify(pure.macroEvents(null, [], true)) === '[]');
  }

  // macroLineEstimate：与 generateMacro 出行规则逐字同口径
  {
    const jm = { 7: { command: '/gs change 7' }, 8: { command: '/gs change 8' } };
    // switch 条一行并更新当前职业
    const e1 = [{ clip: mkMClip(0, 1, '/gs change 7', { jobName: '舞者', jobId: 7 }), type: 'switch' }];
    ok('switch 条一行', pure.macroLineEstimate(e1, jm).lines === 1);
    // 动作换职业 + jobMap 有 → 插一行；同职业不插
    const d = mkDancer();
    d.actionClips.push(mkMClip(0, 3, '/a', { jobName: '甲', jobId: 7 }));
    d.actionClips.push(mkMClip(5, 3, '/b', { jobName: '甲', jobId: 7 }));
    d.actionClips.push(mkMClip(10, 3, '/c', { jobName: '乙', jobId: 8 }));
    ok('手动套装：跨职业 3 条动作仍为 3 行，无隐含切换', pure.macroLineEstimate(pure.macroEvents(d, [], false), jm).lines === 3
      && pure.macroLineEstimate(pure.macroEvents(d, [], false), jm).switchLines === 0);
    // jobMap 缺该职业 → 不插
    ok('jobMap 缺职业不插行', pure.macroLineEstimate(pure.macroEvents(d, [], false), {}).lines === 3);
    // 歌词有文字一行、没文字不出行
    const d3 = mkDancer();
    d3.lyricClips.push(mkMClip(0, 1, '/say 有字'));
    d3.lyricClips.push(mkMClip(2, 1, '')); d3.lyricClips[1].data = { name: '' };
    ok('歌词无文字不出行', pure.macroLineEstimate(pure.macroEvents(d3, [], false), jm).lines === 1);
    // 开歌词宏的全局歌词也计行（去重后）
    const d4 = mkDancer();
    d4.lyricClips.push(mkMClip(0, 1, '/say 舞者')); d4.lyricClips[0].data.name = 'w';
    const gl = [mkMClip(0, 1, '/say 全局')]; gl[0].data.name = 'w';
    const gl2 = [mkMClip(3, 1, '/say 另一句')];
    ok('全局歌词去重后计行', pure.macroLineEstimate(pure.macroEvents(d4, gl, true), jm).lines === 1
      && pure.macroLineEstimate(pure.macroEvents(d4, gl2, true), jm).lines === 2);
  }

  // ============ TASK-20260831-MULTI-DANCER-EDIT：整轨复制 + 添加到全部舞者 ============
  console.log('== 11. 整轨复制（copyDancerTracks） ==');
  {
    const c11 = mkContent();
    c11.dancers[0].currentJob = '骑士';
    c11.dancers[0].solo = true;
    c11.dancers[1].mute = true; c11.dancers[1].collapsed = true; c11.dancers[1].laneScale = 2;
    c11.dancers[0].actionClips[0].data._extra = { note: '未知键' }; // clip.data 里的未知/_extra 键必须活着过去
    let nid11 = 500; const alloc11 = () => nid11++;
    const dst = pure.copyDancerTracks(c11.dancers, 0, 1, alloc11);
    ok('复制返回目标舞者；三轨条数与源一致（1/2/0）', dst === c11.dancers[1]
      && c11.dancers[1].switchClips.length === 1 && c11.dancers[1].actionClips.length === 2 && c11.dancers[1].lyricClips.length === 0);
    const ids11 = [...c11.dancers[1].switchClips, ...c11.dancers[1].actionClips].map(c => c.id);
    ok('每条克隆都是全新唯一 id（allocId 逐条发）', ids11.every(id => id >= 500) && new Set(ids11).size === ids11.length,
      ids11.join(','));
    const srcA = c11.dancers[0].actionClips[0], dstA = c11.dancers[1].actionClips[0];
    ok('start/duration/autoDur/data 逐字段一致（含 data._extra 未知键）',
      dstA.start === srcA.start && dstA.duration === srcA.duration && dstA.autoDur === srcA.autoDur
      && dstA.data._extra.note === '未知键' && dstA.data.command === srcA.data.command && dstA.data.name === srcA.data.name);
    ok('currentJob 跟着源舞者走', c11.dancers[1].currentJob === '骑士');
    ok('name/solo/mute/collapsed/laneScale 保持目标自己的（源也不被改）',
      c11.dancers[1].name === '舞者2' && !c11.dancers[1].solo && c11.dancers[1].mute === true
      && c11.dancers[1].collapsed === true && c11.dancers[1].laneScale === 2 && c11.dancers[0].solo === true);
    ok('克隆不带选中态', c11.dancers[1].switchClips.every(c => !c.selected) && c11.dancers[1].actionClips.every(c => !c.selected));
    // AC-2 别名回归：克隆后续被移动/缩时/改 data，源必须纹丝不动
    const snap11 = JSON.stringify(c11.dancers[0]);
    dstA.start += 3; dstA.duration = 1; dstA.data.name = '改过的';
    c11.dancers[1].switchClips[0].start = 99;
    ok('改克隆不影响源（源与克隆零对象共享）', JSON.stringify(c11.dancers[0]) === snap11);
  }
  {
    const c11b = mkContent();
    const snap11b = JSON.stringify(c11b);
    ok('源=目标：不提供入口（返回 null 且零改动）',
      pure.copyDancerTracks(c11b.dancers, 0, 0, () => 900) === null && JSON.stringify(c11b) === snap11b);
    ok('下标越界不炸且零改动',
      pure.copyDancerTracks(c11b.dancers, 0, 9, () => 900) === null && pure.copyDancerTracks(c11b.dancers, -1, 1, () => 900) === null);
    const c11c = mkContent();
    c11c.dancers[1].switchClips = []; c11c.dancers[1].actionClips = []; c11c.dancers[1].lyricClips = []; // 造一个真空源
    c11c.dancers[0].currentJob = '骑士';
    c11c.dancers.push({ id: 2, name: '舞者3', switchClips: [], actionClips: [], lyricClips: [], currentJob: '' });
    const snapSrc11c = JSON.stringify(c11c.dancers[1]);
    ok('空源：返回 null 且源/目标都零改动',
      pure.copyDancerTracks(c11c.dancers, 1, 2, () => 910) === null
      && JSON.stringify(c11c.dancers[1]) === snapSrc11c && c11c.dancers[2].actionClips.length === 0 && c11c.dancers[2].currentJob === '');
    ok('空目标拿满三轨 + currentJob（新增舞者的主场景）', (() => {
      const r = pure.copyDancerTracks(c11c.dancers, 0, 2, () => 920);
      return !!r && r === c11c.dancers[2] && c11c.dancers[2].currentJob === c11c.dancers[0].currentJob
        && c11c.dancers[2].switchClips.length === 1 && c11c.dancers[2].actionClips.length === 2;
    })());
  }

  console.log('== 12. 添加到全部舞者：落位规划（planMultiActionPlacement） ==');
  {
    const jm12 = { T1: { command: '/jobchange T1' }, T2: { command: '/jobchange T2' } };
    const item12 = { name: '挥剑', command: '/sword', category: 'usual', jobName: '骑士', jobId: 'T1' };
    const ds12 = [
      { currentJob: '骑士', switchClips: [], actionClips: [] }, // 已是骑士：无需切
      { currentJob: '武僧', switchClips: [], actionClips: [] }, // 要切
      { currentJob: '', switchClips: [], actionClips: [] },     // 要切
    ];
    const plan12 = pure.planMultiActionPlacement(ds12, 10, 3, item12, jm12);
    ok('三位在场舞者都拿到规划（di 对齐）', plan12.length === 3 && plan12.every((p, i) => p && p.di === i));
    ok('空闲舞者同一请求起点落位（齐奏，不漂移）', plan12.every(p => p.st === 10 && p.deferred === false));
    ok('needSwitch 按各自 currentJob 判定（骑士=false，其余=true）',
      plan12[0].needSwitch === false && plan12[1].needSwitch === true && plan12[2].needSwitch === true);
    ok('要切职业的切职业窗 [st-0.5, st) 0.5s', plan12.every(p => !p.needSwitch || (p.swStart === 9.5 && p.swDur === 0.5)));
    ok('jobMap 缺该职业：全部 needSwitch=false', pure.planMultiActionPlacement(ds12, 10, 3, item12, {}).every(p => !p.needSwitch));
    ok('普通动作（无职业）不切', pure.planMultiActionPlacement(ds12, 10, 3, { name: '挥手', command: '/wave', category: 'usual' }, jm12).every(p => !p.needSwitch));
  }
  {
    // AC-5 顺延隔离：只有自己轨道冲突的舞者被顺延；规划器只读（既有条 deep-equal）。
    // 口径对齐既有规则（AUD-010/clip-check ㉒④）：要切职业的舞者，切职业窗 [st-0.5,st) 撞上
    // 已有动作 → 动作连同切职业整体 +0.5 顺延；空闲舞者保持请求起点。
    const jm12b = { T1: { command: '/jobchange T1' } };
    const item12b = { name: '挥剑', command: '/sword', category: 'usual', jobName: '骑士', jobId: 'T1' };
    const ds12b = [
      { currentJob: '武僧', switchClips: [], actionClips: [mkClip(61, 0, 5)] }, // 要切职业且动作 [0,5) 压着请求窗 [2,5)：顺延
      { currentJob: '骑士', switchClips: [], actionClips: [mkClip(62, 8, 2)] }, // 已是骑士且轨道空闲：原样落 2
    ];
    const snap12b = JSON.stringify(ds12b);
    const plan12b = pure.planMultiActionPlacement(ds12b, 2, 3, item12b, jm12b);
    ok('只有冲突舞者顺延，空闲舞者保持请求起点',
      plan12b[0].deferred === true && plan12b[0].st > 2 && plan12b[0].needSwitch === true
      && plan12b[1].deferred === false && plan12b[1].st === 2 && plan12b[1].needSwitch === false,
      'd0.st=' + plan12b[0].st + ' d1.st=' + plan12b[1].st);
    ok('规划器只读：所有既有条 start/duration/data 纹丝不动', JSON.stringify(ds12b) === snap12b);
  }
  {
    // AC-6 单舞者等价：开关开 + 1 位舞者 = 现有 planActionPlacement 逐字段同果
    const sw12 = [mkClip(63, 8, 1)], ac12 = [mkClip(64, 0, 5)];
    const ds12c = [{ currentJob: '', switchClips: sw12, actionClips: ac12 }];
    const multi12 = pure.planMultiActionPlacement(ds12c, 9, 3, { jobName: '武僧', jobId: 'T2' }, { T2: { command: '/j2' } });
    const solo12 = pure.planActionPlacement(sw12, ac12, 9, 3, true);
    ok('单舞者 + 开关开 = 现有单轨落位（st/swStart/swDur 全等）',
      multi12.length === 1 && multi12[0].st === solo12.st && multi12[0].swStart === solo12.swStart && multi12[0].swDur === solo12.swDur && multi12[0].needSwitch === true);
    ok('空舞者槽位跳过（null 占位不炸）', (() => {
      const r = pure.planMultiActionPlacement([null, { currentJob: '', switchClips: [], actionClips: [] }], 0, 3, {}, null);
      return r.length === 2 && r[0] === null && r[1] && r[1].di === 1;
    })());
  }
  {
    // AC-8：复制出来的 clip 走 buildGameClips 与手摆条完全同口径（按 actorId 各归各）
    const c12d = mkContent();
    let nid12d = 700;
    pure.copyDancerTracks(c12d.dancers, 0, 1, () => nid12d++);
    const g12 = pure.buildGameClips(c12d.dancers, c12d.globalLyrics, null);
    ok('复制后 payload 每位舞者事件数一致（三轨全复制）',
      g12.filter(x => x.actorId === 1).length === g12.filter(x => x.actorId === 0).length,
      'p0=' + g12.filter(x => x.actorId === 0).length + ' p1=' + g12.filter(x => x.actorId === 1).length);
    ok('复制条与原件事件同 start/duration/command/type',
      g12.some(x => x.actorId === 1 && x.start === 5 && x.duration === 2 && x.command === '/emote2' && x.type === 'action')
      && g12.some(x => x.actorId === 1 && x.start === 0 && x.duration === 1 && x.type === 'switch'));
  }

  console.log('\n== GAMECLOCK：时钟跟随纯函数（followAccept/followProject/hasCap，TASK-20260831） ==');
  {
    // AC-2：收敛——accepted 后每帧外推逼近插件时间（速度 1，载荷龄 100ms + 本地流逝）
    const s1 = { time: 10, stampMs: 1000, stampAgeMs: 100, speed: 1, playing: true };
    const r1 = pure.followAccept(null, s1);
    ok('首次样本 accepted 且不 resync', r1.accepted === true && r1.resync === false && r1.local === false);
    const base1 = Object.assign({ recvSec: 0 }, r1.base);
    ok('外推收敛：t=0 → 样本时间+载荷龄', Math.abs(pure.followProject(base1, 0) - 10.1) < 1e-9, String(pure.followProject(base1, 0)));
    ok('外推推进：+2s → 前进 2 秒', Math.abs(pure.followProject(base1, 2) - 12.1) < 1e-9, String(pure.followProject(base1, 2)));
    ok('速度缩放：speed=0.5 时 2s 只走 1 秒',
      (() => { const r = pure.followAccept(null, { time: 10, stampMs: 1000, stampAgeMs: 0, speed: 0.5, playing: true });
        return Math.abs(pure.followProject(Object.assign({ recvSec: 0 }, r.base), 2) - 11) < 1e-9; })());

    // AC-2：漂移超阈值硬切（resync）
    const prev = { stamp: 900, display: 10.5 }; // 本地显示 10.5，插件已到 11.0（差 0.5 > 0.12）
    const r2 = pure.followAccept(prev, { time: 11, stampMs: 1100, stampAgeMs: 0, speed: 1, playing: true });
    ok('漂移 >0.12s → resync=true（硬切插件时间）', r2.accepted && r2.resync === true, JSON.stringify(r2));
    const prev2 = { stamp: 900, display: 11.05 }; // 差 0.05 在阈值内
    const r2b = pure.followAccept(prev2, { time: 11, stampMs: 1100, stampAgeMs: 0, speed: 1, playing: true });
    ok('漂移 ≤0.12s → 连续优先不硬切', r2b.accepted && r2b.resync === false);

    // AC-2：旧样本/重复/坏输入 → 沿用原值且不抛（不变量：绝不变更显示、绝不 throw）
    const keepPrev = (f) => { try { return f(); } catch (e) { return { threw: e }; } };
    const stale = keepPrev(() => pure.followAccept({ stamp: 2000, display: 9 }, { time: 99, stampMs: 1000, stampAgeMs: 0, speed: 1, playing: true }));
    ok('旧样本（stamp 更小）→ accepted:false 保持原显示', stale.accepted === false && !stale.threw);
    const dup = keepPrev(() => pure.followAccept({ stamp: 1000, display: 9 }, { time: 99, stampMs: 1000, stampAgeMs: 0, speed: 1, playing: true }));
    ok('重复样本（stamp 相等）→ accepted:false', dup.accepted === false);
    const bads = [null, undefined, 42, {}, { time: 'x', stampMs: 1, stampAgeMs: 0, speed: 1, playing: true },
      { time: Infinity, stampMs: 1, stampAgeMs: 0, speed: 1, playing: true },
      { time: 1, stampMs: NaN, stampAgeMs: 0, speed: 1, playing: true },
      { time: 1, stampMs: 2, stampAgeMs: -5, speed: 1, playing: true }];
    let badOk = true;
    for (const b of bads) { const r = keepPrev(() => pure.followAccept({ stamp: 1, display: 5 }, b)); if (!r || r.accepted !== false || r.threw) { badOk = false; break; } }
    ok('非有限/缺字段/负龄样本全部 accepted:false 且不抛', badOk);
    ok('坏输入沿用原显示值', pure.followAccept({ stamp: 1, display: 5 }, null).display === 5);
    ok('首样本就是坏输入 → display=null 不抛', pure.followAccept(null, null).display === undefined || pure.followAccept(null, null).display === null);

    // AC-2：暂停（playing=false）交还本地钟
    const rp = pure.followAccept({ stamp: 1, display: 7.7 }, { time: 3, stampMs: 2, stampAgeMs: 0, speed: 1, playing: false });
    ok('playing=false → local:true 且保持原显示', rp.accepted === false && rp.local === true && rp.display === 7.7);
    ok('playing=false 时不产基准（本地钟推进不受污染）', rp.base === null);

    // followProject 坏输入 → null（调用方退本地钟）
    ok('followProject 坏基准 → null（不抛）', pure.followProject(null, 1) === null && pure.followProject({ time: NaN, ageMs: 0, speed: 1, recvSec: 0 }, 1) === null);

    // AC-4：能力位判断（statusV2 缺席 = 旧插件 = 本地钟字节级行为）
    ok('hasCap：capability 数组含 statusV2 → true', pure.hasCap({ capabilities: ['playback', 'statusV2'] }, 'statusV2') === true);
    ok('hasCap：旧插件无 statusV2 → false', pure.hasCap({ capabilities: ['playback', 'seek'] }, 'statusV2') === false);
    ok('hasCap：畸形输入（null/缺数组）→ false 不抛',
      pure.hasCap(null, 'statusV2') === false && pure.hasCap({}, 'statusV2') === false && pure.hasCap({ capabilities: 'x' }, 'statusV2') === false);
  }

  console.log('== 八人归属（TASK-20260901-SIX-TRACK-ROUNDTRIP / AC-3） ==');
  // 八位舞者各持专属条，跑跨全员的时间轴操作（插入/删除/对齐/粘贴），归属（di→clip 集合）不能串
  {
    const c8 = { dancers: [], globalLyrics: [], markers: [] };
    for (let i = 0; i < 8; i++) {
      c8.dancers.push({ id: i, name: '舞者' + (i + 1), switchClips: [], lyricClips: [],
        actionClips: [mkClip(100 + i, 10 + i, 2), mkClip(200 + i, 20 + i, 1)] });
    }
    c8.globalLyrics = [mkClip(6, 12, 2, { data: { name: '全', command: '', category: 'lyric', isLyric: true } })];
    const snap = c8.dancers.map((d) => d.actionClips.map((c) => c.id).join(',')).join('|');
    // 插入时间（全员右移）：每人条数与 id 集合不变
    pure.insertTime(c8, 15, 2);
    ok('八人插入时间：每人仍是自己的 2 条（id 集合不串）', c8.dancers.map((d) => d.actionClips.map((c) => c.id).sort((a, b) => a - b).join(',')).join('|') === snap);
    ok('八人插入时间：条目随身右移（舞者8 的 107: 17→19）', c8.dancers[7].actionClips.find((c) => c.id === 107).start === 19);
    // 删除时间（ripple）：[22,23) 区间删除（插入后 200 在 22..23）——舞者1 的 200 被删、后方左移，归属不变
    pure.deleteTime(c8, 22, 23);
    ok('八人删除时间：归属不变、区间内条被删', c8.dancers.map((d) => d.actionClips.map((c) => c.id).sort((a, b) => a - b).join(',')).join('|') === snap.replace('100,200', '100')
      && !c8.dancers[0].actionClips.some((c) => c.id === 200));
    // 粘贴到舞者8（剪贴板条目带 di=7）：新条只落在舞者8
    const cb = pure.serializeSelection([{ di: 7, track: 'action', clip: c8.dancers[0].actionClips[0] }]);
    let nid = 900;
    const created = pure.pasteItems(cb, c8, 100, () => nid++);
    ok('粘贴到舞者8：新条只落在舞者8（其他七人零新增）',
      created.length === 1 && c8.dancers[7].actionClips.some((x) => x.id === created[0].id)
      && c8.dancers.slice(0, 7).every((d) => d.actionClips.every((x) => !created.some((c) => c.id === x.id))));
    // 全选批量平移：八人条目一起动、各自归属不动
    pure.selectAll(c8);
    const c8b = JSON.parse(JSON.stringify(c8));
    pure.batchMove(pure.collectSelected(c8b), 3, 300);
    ok('八人全选平移：每人条目同步 +3 且归属不变', (() => {
      for (let i = 0; i < 8; i++) {
        const a = c8.dancers[i].actionClips, b = c8b.dancers[i].actionClips;
        if (a.length !== b.length) return false;
        for (let j = 0; j < a.length; j++) if (a[j].id !== b[j].id || Math.abs(b[j].start - a[j].start - 3) > 1e-9) return false;
      }
      return true;
    })());
  }

  console.log('== 八人版本恢复（TASK-20260901-SIX-TRACK-ROUNDTRIP / AC-3） ==');
  // 版本快照存的是规范文档（projectRecord().content），恢复=applyProjectContent(loadProjection)。
  // 按同一条链路纯函数化：保存→取消恢复（零改动）→完成恢复（八人归属+冻结轨活着回来）→恢复后再编辑
  {
    require('./choreo-document.js');
    require('./choreo-docwire.js');
    const CDW = globalThis.ChoreoDocWire;
    const proj = { dancers: [], globalLyrics: [], markers: [], dancerCount: 8, showLyricMacro: false, totalDuration: 300 };
    for (let i = 0; i < 8; i++) {
      proj.dancers.push({ id: i, name: '舞者' + (i + 1), switchClips: [], lyricClips: [],
        actionClips: [mkClip(100 + i, 10 + i, 2), mkClip(200 + i, 30 + i, 1)] });
    }
    proj._doc = { extraTracks: [ // 冻结轨（movement 归舞者3、ability 悬空）随 _doc 载体
      { id: 'tr-mv8', type: 'movement', performerId: 'actor-2', enabled: true, notes: '', events: [{ id: 'mv8-1', kind: 'movement', startMs: 5000, durationMs: 3000, enabled: true }] },
      { id: 'tr-ab8', type: 'ability', performerId: null, enabled: true, notes: '', events: [{ id: 'ab8-1', kind: 'ability', startMs: 8000, durationMs: 1500, enabled: true }] },
    ] };
    // 保存（版本快照=规范文档）：projectRecord 的同款调用
    const savedDoc = CDW.persistDoc(proj, { id: 'p8', name: '八人' }, 1);
    const savedFrozen = JSON.stringify(savedDoc); // 版本快照冻结串——恢复后的编辑不得写穿它
    ok('保存：文档 8 位表演者', savedDoc.performers.length === 8);
    ok('保存：冻结轨进文档（movement/ability 各 1 条）',
      savedDoc.tracks.filter((t) => t.type === 'movement').length === 1 && savedDoc.tracks.filter((t) => t.type === 'ability').length === 1);
    // 取消恢复：算出恢复候选（loadProjection）后丢弃——活动投影逐字节不动、无别名共享
    const activeBefore = JSON.stringify(proj);
    const cand = CDW.loadProjection(savedDoc);
    ok('取消恢复：活动投影逐字节不变（候选是全新对象，无别名）',
      JSON.stringify(proj) === activeBefore && cand.proj !== proj && cand.proj.dancers !== proj.dancers);
    // 完成恢复（applyProjectContent 的同款链路：loadProjection → unknownTopKeys）
    const restored = cand.proj;
    const extra = CDW.unknownTopKeys(restored);
    ok('完成恢复：八人全员在场且各归各（每人 2 条、专属 id 不串）',
      restored.dancers.length === 8 && restored.dancerCount === 8
      && restored.dancers.every((d, i) => d.actionClips.length === 2
        && d.actionClips.some((c) => c.id === 100 + i) && d.actionClips.some((c) => c.id === 200 + i)));
    ok('完成恢复：冻结轨经 _doc 载体回来（id/类型/事件逐字段原样）',
      !!extra._doc && Array.isArray(extra._doc.extraTracks)
      && extra._doc.extraTracks.some((t) => t.id === 'tr-mv8' && t.performerId === 'actor-2' && t.events[0].id === 'mv8-1')
      && extra._doc.extraTracks.some((t) => t.id === 'tr-ab8' && t.events[0].id === 'ab8-1'));
    // 恢复后再编辑：插入时间归属保持；且编辑不写穿已存版本快照（loadProjection 是深拷贝）
    pure.insertTime(restored, 15, 2);
    // 插入口径与第 3 节一致：start≥15 的右移 +2，start<15 的不动（i≥5 的 105/106/107 → 12+i，i<5 的留 10+i）
    ok('恢复后再编辑：归属不变、条目随身右移（舞者8 的 207: 37→39；插入口之前的条不动）',
      restored.dancers[7].actionClips.some((c) => c.id === 207 && c.start === 39)
      && restored.dancers.every((d, i) => d.actionClips.every((c) => c.id !== 100 + i
        || c.start === (10 + i >= 15 ? 12 + i : 10 + i))));
    ok('恢复后的编辑不写穿已存版本快照', JSON.stringify(savedDoc) === savedFrozen);
  }

  console.log('== 13. 角色档案绑定解析（resolveBindings，TASK-20260903-CHARACTER-ASSETS-P1-BIND / AC-3） ==');
  // 纯解析器：dancers × 已知档案 id 清单 × 活动档案 id → 按舞者顺序对齐的绑定视图。
  // 口径：缺键/空串/非字符串不是绑定 → default（解析到 activeProfileId；无活动档案 → none）；
  // 已知 id → bound；未知 id → missing，绝不静默回落 activeProfileId（无绑定 UI，P1 只读观察）
  if (typeof pure.resolveBindings === 'function') {
    const R = pure.resolveBindings;
    const ds = [
      { name: '无键' },
      { name: '空串', profileId: '' },
      { name: '数字', profileId: 7 },
      { name: '对象', profileId: { id: 'x' } },
      { name: '数组', profileId: ['p1'] },
      { name: 'null', profileId: null },
      { name: '已绑', profileId: 'p1' },
      { name: '悬空', profileId: 'gone' },
      { name: '共享', profileId: 'p1' },
    ];
    const known = ['p1', 'p2', '__proto__'];
    const out = R(ds, known, 'act');
    ok('返回与舞者顺序对齐的数组（index 逐位对齐）', out.length === ds.length && out.every((e, i) => e.index === i));
    ok('(a)缺键 (b)空串 (c)非字符串 → default 且解析到 activeProfileId',
      out.slice(0, 6).every((e) => e.state === 'default' && e.profileId === 'act' && e.binding === null));
    ok('(d)已知 id → bound 且解析到该 id 本身',
      out[6].state === 'bound' && out[6].profileId === 'p1' && out[6].binding === 'p1');
    ok('(e)未知 id → missing：解析为空、绝不回落 activeProfileId',
      out[7].state === 'missing' && out[7].profileId === null && out[7].binding === 'gone');
    ok('两位舞者共享同一 id → 都 bound（互不影响）', out[8].state === 'bound' && out[8].profileId === 'p1');
    ok('没有活动档案时缺绑定 → none（解析为空）', (() => {
      const o = R([{ name: 'x' }], known, null);
      return o[0].state === 'none' && o[0].profileId === null;
    })());
    ok('活动档案 id 非字符串按无活动算', R([{ name: 'x' }], known, 42)[0].state === 'none');
    ok('0 位舞者 → 空数组；1 位舞者正常',
      R([], known, 'act').length === 0 && R([{ profileId: 'p2' }], known, 'act').length === 1);
    ok('12 位舞者全覆盖（文档校验上限：bound 6 / missing 4 / default 2）', (() => {
      const ds12 = [];
      for (let i = 0; i < 12; i++) ds12.push({ profileId: i % 2 ? 'p1' : (i % 3 ? 'nope' : undefined) });
      const o12 = R(ds12, known, 'act');
      const cnt = (s) => o12.filter((e) => e.state === s).length;
      return o12.length === 12 && cnt('bound') === 6 && cnt('missing') === 4 && cnt('default') === 2;
    })());
    ok('清单里的非字符串项不参与匹配（防御，不算已知 id）', R([{ profileId: '7' }], [7, 'p1'], 'act')[0].state === 'missing');
    ok('原型键不误判：未列入清单的原型键名 → missing；真列入清单的按数组元素命中', (() => {
      const o = R([{ profileId: 'toString' }, { profileId: 'constructor' }, { profileId: '__proto__' }], known, 'act');
      return o[0].state === 'missing' && o[1].state === 'missing' && o[2].state === 'bound';
    })());
    // 纯度：不改入参、等输入等输出、返回全新对象
    const snap = JSON.stringify(ds) + '|' + JSON.stringify(known);
    const o1 = R(ds, known, 'act'), o2 = R(ds, known, 'act');
    ok('解析器不改入参（dancers/known 深相等保持）', JSON.stringify(ds) + '|' + JSON.stringify(known) === snap);
    ok('等输入等输出（两次调用结果深相等）', JSON.stringify(o1) === JSON.stringify(o2));
    ok('返回全新对象（与入参零共享）', o1 !== ds && o1.every((e, i) => e !== ds[i]));
    ok('null/undefined 入参不炸（空视图）', R(null, known, 'act').length === 0 && R(undefined, null, null).length === 0);
  } else {
    ok('resolveBindings 已导出（红基线：实现前缺失）', false);
  }

  console.log('== 14. 整轨复制的绑定不变性（TASK-20260903-CHARACTER-ASSETS-P1-BIND / AC-4） ==');
  {
    // 复制只搬三轨与 currentJob：两位舞者的 profileId 一律字节不动（不复制/不清空/不覆盖）
    const c14 = mkContent();
    c14.dancers[0].profileId = 'prof-src'; // 一位已绑、一位未绑（AC-4 given）
    let nid14 = 800;
    const dst14 = pure.copyDancerTracks(c14.dancers, 0, 1, () => nid14++);

    ok('源已绑 + 目标未绑：复制后目标不长出绑定键', !!dst14 && !('profileId' in c14.dancers[1]));
    ok('源绑定原样（不因被复制而清除/改写）', c14.dancers[0].profileId === 'prof-src');
    ok('三轨与 currentJob 仍按既有口径复制', c14.dancers[1].actionClips.length === 2 && c14.dancers[1].currentJob === (c14.dancers[0].currentJob || ''));
    const c14b = mkContent();
    c14b.dancers[1].profileId = 'prof-dst';
    pure.copyDancerTracks(c14b.dancers, 0, 1, () => 810);
    ok('源未绑 + 目标已绑：目标绑定保得住（不被清空）', c14b.dancers[1].profileId === 'prof-dst' && !('profileId' in c14b.dancers[0]));
    const c14c = mkContent();
    c14c.dancers[0].profileId = 'prof-a'; c14c.dancers[1].profileId = 'prof-b';
    pure.copyDancerTracks(c14c.dancers, 0, 1, () => 820);
    ok('双方都绑：各自绑定字节不动（不互换不覆盖）', c14c.dancers[0].profileId === 'prof-a' && c14c.dancers[1].profileId === 'prof-b');
  }

  console.log('== 15. 绑定 missing→bound 恢复（TASK-20260903-CHARACTER-ASSETS-P1-BIND / AC-6） ==');
  if (typeof pure.resolveBindings === 'function') {
    // 档案 P 被删（或本机从未有过）→ missing；P 经既有备份导入重建 → bound：
    // 恢复不需要改文档、不需要手动重绑（解析只读，引用原地不动）
    const d15 = [{ name: '领舞', profileId: 'P' }];
    const before = JSON.stringify(d15);
    const miss = pure.resolveBindings(d15, ['A'], 'A')[0];
    ok('档案 P 不存在：state=missing（不静默回落 activeProfile）', miss.state === 'missing' && miss.profileId === null);
    const bound = pure.resolveBindings(d15, ['A', 'P'], 'A')[0];
    ok('P 重建后：state=bound 且解析到 P 本身', bound.state === 'bound' && bound.profileId === 'P');
    ok('两次解析全程文档引用字节不动', JSON.stringify(d15) === before);
  } else {
    ok('resolveBindings 已导出（红基线：实现前缺失）', false);
  }

  // ============ TASK-20260903-CHARACTER-ASSETS-P3-PREVIEW：多母版渲染规划器 + 绑定写入 ============
  // mkProf：造 listProfiles 同形状的档案记录（skeletonHash/boneCount/hasSkeleton/modelNames）。
  // skeletonStructHash 默认与整份指纹同值（TASK-20260917-SKELETON-KEY-REPAIR 起 online 匹配
  // 只认结构指纹；夹具里两口径同值即可表达同构/异构，extra 可覆盖单边）。
  function mkProf(id, hash, bones, names, extra) {
    return Object.assign({ id: id, name: '档案' + id, skeletonHash: hash, skeletonStructHash: hash,
      boneCount: bones, hasSkeleton: !!hash, modelNames: names || ['model.glb'], modelSize: 0, isActive: false }, extra || {});
  }
  // 母版期望键（TASK-20260907-APPEARANCE-DEFECT-REPAIR）：新实现下母版键=指纹+外观身份；
  // 旧实现没有 masterKeyFor 时退回裸指纹（红基线下迁移断言按旧形状求值，异外观断言仍能变红）。
  function keyFor(fp, rec) {
    if (pure && typeof pure.masterKeyFor === 'function') return pure.masterKeyFor(fp, rec);
    return fp;
  }
  function dancerOf(o) { return Object.assign({ id: 0, name: '舞者', switchClips: [], actionClips: [], lyricClips: [] }, o); }

  console.log('== 16. 绑定写入纯函数（setDancerBinding，P3 / AC-2） ==');
  if (typeof pure.setDancerBinding === 'function') {
    const S = pure.setDancerBinding;
    const known16 = ['p1', 'p2', '__proto__'];
    {
      // 设定：写入已知 id；清除：回到 P1 无键形状（键被删除，不是空串）
      const ds16 = [dancerOf({}), dancerOf({ profileId: 'p1' })];
      ok('设绑定：已知 id 写成同名字符串', S(ds16, 0, 'p2', known16) === ds16[0] && ds16[0].profileId === 'p2');
      ok('清绑定：选项=空串 → profileId 键整个删掉（不是留空串）',
        S(ds16, 1, '', known16) === ds16[1] && !('profileId' in ds16[1]));
      const ds16b = [dancerOf({ profileId: 'p1' })];
      S(ds16b, 0, null, known16);
      ok('清绑定：null 也按清除算', !('profileId' in ds16b[0]));
      // 未知 id 拒绝：不写不换不清
      const ds16c = [dancerOf({ profileId: 'p1' }), dancerOf({})];
      ok('未知 id 拒绝：返回 null 且原值不动', S(ds16c, 0, 'ghost', known16) === null && ds16c[0].profileId === 'p1');
      ok('未知 id 拒绝：未绑舞者不长出键', S(ds16c, 1, 'ghost', known16) === null && !('profileId' in ds16c[1]));
      ok('非字符串 id 拒绝（数字/对象）', S(ds16c, 1, 7, known16) === null && S(ds16c, 1, { id: 'p1' }, known16) === null);
      ok('原型键名按未知拒绝（不误当已知）', S(ds16c, 1, 'toString', known16) === null);
      ok('空 known 清单：任何 id 都拒绝，空串仍可清', S(ds16c, 1, 'p1', []) === null && S(ds16c, 1, '', []) === ds16c[1]);
      ok('下标越界/空舞者 → null 不炸', S(ds16c, 9, 'p1', known16) === null && S([], 0, 'p1', known16) === null && S(null, 0, 'p1', known16) === null);
      // 只动目标舞者、别的字段不碰
      const ds16d = [dancerOf({ profileId: 'p1', solo: true }), dancerOf({ mute: true })];
      S(ds16d, 0, 'p2', known16);
      ok('写入只改 profileId（solo 等字段原样）', ds16d[0].profileId === 'p2' && ds16d[0].solo === true && ds16d[1].mute === true && !('profileId' in ds16d[1]));
    }
  } else {
    ok('setDancerBinding 已导出（红基线：实现前缺失）', false);
  }

  console.log('== 17. 多母版渲染规划器（planRender，P3 / AC-1 边界矩阵） ==');
  if (typeof pure.planRender === 'function') {
    const P = pure.planRender;
    const F1 = 'f1', F2 = 'f2', F3 = 'f3';
    // (a) 零舞者：空计划、零母版
    {
      const a = P([], ['p1'], 'p1', [mkProf('p1', F1, 84)], null);
      ok('(a) 零舞者：entries 空 + 母版表空', a.entries.length === 0 && a.masterKeys.length === 0);
    }
    // (b) 全默认 + 有骨架活动档案 → 单母版键=活动档案指纹
    {
      const b = P([dancerOf({}), dancerOf({ profileId: '' })], ['p1'], 'p1', [mkProf('p1', F1, 84)], null);
      const kB = keyFor(F1, mkProf('p1', F1, 84));
      ok('(b) 全默认：全部解析到活动档案指纹的单母版',
        b.entries.length === 2 && b.entries.every(e => e.masterKey === kB && e.profileId === 'p1' && e.state === 'default' && e.reason === null));
      ok('(b) 母版表恰一条（键=指纹+外观，代表档案=活动档案）', b.masterKeys.length === 1 && b.masterKeys[0] === kB && b.masters[kB].profileId === 'p1');
    }
    // (c) 全默认 + 无活动档案 → 替身母版 + 明确原因
    {
      const c = P([dancerOf({})], ['p1'], null, [mkProf('p1', F1, 84)], null);
      ok('(c) 无活动档案：替身母版 + no-active-profile',
        c.entries[0].masterKey === c.standinKey && c.entries[0].reason === 'no-active-profile' && c.entries[0].profileId === null);
      ok('(c) 替身母版不挂档案', c.masters[c.standinKey].profileId === null && c.masterKeys.length === 1);
    }
    // (d) 两个不同指纹档案 + (e) 同档案两人 + (f) 悬空 id
    {
      const ds = [dancerOf({ profileId: 'p1' }), dancerOf({ profileId: 'p2' }), dancerOf({ profileId: 'p1' }), dancerOf({ profileId: 'gone' })];
      const d = P(ds, ['p1', 'p2'], 'p1', [mkProf('p1', F1, 84), mkProf('p2', F2, 101)], null);
      const kD1 = keyFor(F1, mkProf('p1', F1, 84)), kD2 = keyFor(F2, mkProf('p2', F2, 101));
      ok('(d) 两指纹 → 各自指纹键的母版都在表里', d.masters[kD1] && d.masters[kD2] && d.masterKeys.indexOf(kD1) >= 0 && d.masterKeys.indexOf(kD2) >= 0);
      ok('(e) 同档案两人共用一条母版（dancers 归并）',
        d.masters[kD1].dancers.length === 2 && d.masters[kD1].dancers.join(',') === '0,2');
      ok('(f) 悬空 id → 替身母版 + missing-profile（绝不回落活动档案）',
        d.entries[3].masterKey === d.standinKey && d.entries[3].reason === 'missing-profile' && d.entries[3].profileId === null && d.entries[3].state === 'missing');
      ok('(d/e/f) 母版表 = 2 指纹 + 1 替身', d.masterKeys.length === 3 && d.masterKeys.indexOf(d.standinKey) >= 0);
    }
    // (g) 空壳档案（无骨架）→ 替身；有骨架无模型 → 自己的指纹母版 + no-model 原因
    {
      const shell = { id: 'shell', name: '空壳', skeletonHash: '', boneCount: 0, hasSkeleton: false, modelNames: [], modelSize: 0, isActive: false };
      const nomodel = mkProf('nomodel', F3, 84, []);
      const g = P([dancerOf({ profileId: 'shell' }), dancerOf({ profileId: 'nomodel' })], ['shell', 'nomodel'], null, [shell, nomodel], null);
      ok('(g) 无骨架档案 → 替身母版 + no-skeleton',
        g.entries[0].masterKey === g.standinKey && g.entries[0].reason === 'no-skeleton');
      ok('(g) 有骨架无模型 → 仍是自己的指纹母版 + no-model 原因（部署位真模型仍可接手，AC-7）',
        g.entries[1].masterKey === keyFor(F3, mkProf('nomodel', F3, 84, [])) && g.entries[1].reason === 'no-model' && g.entries[1].skeletonHash === F3);
      ok('(g) 母版表 = 指纹母版 + 替身各一', g.masterKeys.length === 2);
    }
    // (h) 两个不同档案 id 共享一个指纹、同一套模型（同名同字节）→ 一条母版
    {
      const h = P([dancerOf({ profileId: 'p3' }), dancerOf({ profileId: 'p4' })], ['p3', 'p4'], null,
        [mkProf('p3', F1, 84), mkProf('p4', F1, 84)], null);
      const kH = keyFor(F1, mkProf('p3', F1, 84));
      ok('(h) 同指纹同模型两档案 → 合并成一条母版（profileIds 双列）',
        h.masterKeys.length === 1 && h.masterKeys[0] === kH && h.masters[kH].profileIds.join(',') === 'p3,p4');
      ok('(h) 两位舞者都指到这条母版', h.entries.every(e => e.masterKey === kH));
    }
    // (h2) 同指纹、不同模型外观（异 modelHashes）→ 分母版，各自渲染（TASK-20260907-APPEARANCE-DEFECT-REPAIR 红基线）
    {
      const r3 = mkProf('p3', F1, 84, ['red.glb'], { modelHashes: ['aaa'], modelSize: 11 });
      const r4 = mkProf('p4', F1, 84, ['blue.glb'], { modelHashes: ['bbb'], modelSize: 12 });
      const h2 = P([dancerOf({ profileId: 'p3' }), dancerOf({ profileId: 'p4' })], ['p3', 'p4'], null, [r3, r4], null);
      ok('(h2) 同指纹异外观 → 两条母版（红基线：旧实现归并成一条）',
        h2.masterKeys.length === 2, '实际=' + h2.masterKeys.length);
      ok('(h2) 两位舞者各指各的外观母版',
        h2.entries[0].masterKey !== h2.entries[1].masterKey);
    }
    // (h3) 同指纹、同字节异名（同 modelHash）→ 仍共享一条母版（P4 去重价值，外观一致）
    {
      const r3 = mkProf('p3', F1, 84, ['same.glb'], { modelHashes: ['ccc'], modelSize: 21 });
      const r4 = mkProf('p4', F1, 84, ['twin.glb'], { modelHashes: ['ccc'], modelSize: 21 });
      const h3 = P([dancerOf({ profileId: 'p3' }), dancerOf({ profileId: 'p4' })], ['p3', 'p4'], null, [r3, r4], null);
      const k3 = keyFor(F1, r3);
      ok('(h3) 同指纹同字节 → 共享一条母版（profileIds 双列）',
        h3.masterKeys.length === 1 && h3.masterKeys[0] === k3 && h3.entries.every(e => e.masterKey === k3));
    }
    // (i) 在线指纹只标记匹配母版
    {
      const i = P([dancerOf({ profileId: 'p1' }), dancerOf({ profileId: 'p2' })], ['p1', 'p2'], 'p1',
        [mkProf('p1', F1, 84), mkProf('p2', F2, 101)], F1);
      const kI1 = keyFor(F1, mkProf('p1', F1, 84)), kI2 = keyFor(F2, mkProf('p2', F2, 101));
      ok('(i) 在线指纹=指纹1：只有母版1 可在线升级', i.masters[kI1].onlineUpgradable === true && i.masters[kI2].onlineUpgradable === false);
      ok('(i) 舞者级 online 标记只落在匹配者', i.entries[0].online === true && i.entries[1].online === false);
      ok('(i) 在线指纹不新增母版也不改键', i.masterKeys.length === 2 && i.masterKeys[0] === kI1);
      const i2 = P([dancerOf({ profileId: 'p1' })], ['p1'], 'p1', [mkProf('p1', F1, 84)], 'zzz-no-match');
      ok('(i) 谁都对不上 → 无一可升级', i2.masters[kI1].onlineUpgradable === false && i2.entries[0].online === false);
    }
    // AC-5：per-dancer clip 命名空间 / 期望指纹
    {
      const cs = P([dancerOf({ profileId: 'p2' }), dancerOf({}), dancerOf({ profileId: 'gone' })], ['p1', 'p2'], 'p1',
        [mkProf('p1', F1, 84), mkProf('p2', F2, 101)], null);
      ok('clip 命名空间：绑 p2 的舞者按 p2 取动作（期望指纹 F2）',
        cs.entries[0].profileId === 'p2' && cs.entries[0].skeletonHash === F2);
      ok('clip 命名空间：默认舞者按活动档案取（期望指纹 F1）',
        cs.entries[1].profileId === 'p1' && cs.entries[1].skeletonHash === F1);
      ok('clip 命名空间：替身舞者无命名空间无指纹（不取不套）',
        cs.entries[2].profileId === null && cs.entries[2].skeletonHash === null);
      ok('同名动作跨骨架天然分键：两人 clip 命名空间不同（profileId/Fingerprint 各归各）',
        cs.entries[0].profileId !== cs.entries[1].profileId && cs.entries[0].skeletonHash !== cs.entries[1].skeletonHash);
    }
    // 纯度/确定性：不改入参、等输入等输出、畸形输入不炸
    {
      const ds = [dancerOf({ profileId: 'p1' }), dancerOf({}), dancerOf({ profileId: 'gone' })];
      const recs = [mkProf('p1', F1, 84), mkProf('p2', F2, 101)];
      const known = ['p1', 'p2'];
      const snap = JSON.stringify(ds) + '|' + JSON.stringify(recs) + '|' + JSON.stringify(known);
      const o1 = P(ds, known, 'p1', recs, null), o2 = P(ds, known, 'p1', recs, null);
      ok('规划器不改入参（dancers/recs/known 深相等保持）', JSON.stringify(ds) + '|' + JSON.stringify(recs) + '|' + JSON.stringify(known) === snap);
      ok('等输入等输出（两次调用深相等）', JSON.stringify(o1) === JSON.stringify(o2));
      ok('返回全新对象（entries 与入参零共享）', o1 !== ds && o1.entries.every((e, i) => e !== ds[i]));
      ok('畸形输入不炸：null 舞者槽位跳过、空 recs 全回落',
        (() => {
          const r = P([null, dancerOf({ profileId: 'p1' })], ['p1'], null, [mkProf('p1', F1, 84)], null);
          return r.entries.length === 2 && r.entries[0].masterKey === r.standinKey && r.entries[1].masterKey === keyFor(F1, mkProf('p1', F1, 84));
        })());
      ok('畸形输入不炸：null/undefined 全防线', P(null, null, null, null, null).entries.length === 0);
      ok('recs 里缺 id/非对象行被忽略（防御）',
        (() => { const r = P([dancerOf({ profileId: 'p1' })], ['p1'], null, [null, { name: 'x' }, mkProf('p1', F1, 84)], null);
          return r.entries[0].masterKey === keyFor(F1, mkProf('p1', F1, 84)); })());
    }
  } else {
    ok('planRender 已导出（红基线：实现前缺失）', false);
  }


  console.log('== 18. 档案集合变化判定（profilesChangedNeedsRebuild，P3 / AC-9 通知死角回归） ==');
  if (typeof pure.profilesChangedNeedsRebuild === 'function') {
    const N = pure.profilesChangedNeedsRebuild;
    ok('增删即需重建（删一个/加一个都 true）', N(['a', 'b'], ['a']) === true && N(['a'], ['a', 'b']) === true);
    ok('顺序无关（集合语义，换序不重建）', N(['a', 'b'], ['b', 'a']) === false);
    ok('相同集合不变 → false（含空对空）', N(['a'], ['a']) === false && N([], []) === false);
    ok('空↔非空 → true', N([], ['a']) === true && N(['a'], []) === true);
    ok('null/undefined 防线不炸', N(null, null) === false && N(null, ['a']) === true && N(undefined, []) === false);
    ok('不改入参（输入数组原样）', (() => { const a = ['a', 'b'], b = ['b', 'a']; N(a, b); return a.join(',') === 'a,b' && b.join(',') === 'b,a'; })());
  } else {
    ok('profilesChangedNeedsRebuild 已导出（红基线：实现前缺失）', false);
  }
  // ============ TASK-20260903-CHARACTER-ASSETS-P6-ACCEPT：1-8 舞者验收确定性扫掠 ============
  // 六类混合班级模板（按 i%8 循环取类，与 AC-1 given 一致）：
  //   0=绑 pA（指纹 F1） 1=绑 pB（指纹 F2，异骨架） 2=绑 pA2（共享 F1）
  //   3=绑 pNoModel（有骨架 F3 无模型） 4=绑 shell（无骨架空壳） 5=绑 gone（悬空 id）
  //   6=不绑（缺省→活动档案 pA/F1） 7=再绑 pA
  var P6_F1 = 'fp-one', P6_F2 = 'fp-two', P6_F3 = 'fp-three';
  var p6Recs = [
    mkProf('pA', P6_F1, 84), mkProf('pA2', P6_F1, 84), mkProf('pB', P6_F2, 101),
    mkProf('pNoModel', P6_F3, 90, []),
    { id: 'shell', name: '空壳', skeletonHash: '', boneCount: 0, hasSkeleton: false, modelNames: [], modelSize: 0, isActive: false },
  ];
  var p6Known = p6Recs.map(function (r) { return r.id; }); // 'gone' 不在清单 → 悬空
  function p6Dancer(i) {
    var cls = i % 8, d = dancerOf({ name: '舞者' + (i + 1) });
    if (cls === 0 || cls === 7) d.profileId = 'pA';
    else if (cls === 1) d.profileId = 'pB';
    else if (cls === 2) d.profileId = 'pA2';
    else if (cls === 3) d.profileId = 'pNoModel';
    else if (cls === 4) d.profileId = 'shell';
    else if (cls === 5) d.profileId = 'gone';
    return d; // cls 6：无键 → 缺省（活动档案 pA）
  }
  function p6Session(n) {
    var ds = [];
    for (var i = 0; i < n; i++) ds.push(p6Dancer(i));
    return ds;
  }
  // 逐 count 的手算期望（不经过被测实现）：每类首次出现的指纹进母版表；standin 只在
  // 有舞者落到替身时存在。n=1..9 与 n=12 的母版数：
  var P6_EXPECT_MASTERS = { 0: 0, 1: 1, 2: 2, 3: 2, 4: 3, 5: 4, 6: 4, 7: 4, 8: 4, 9: 4, 12: 4 };

  console.log('== 19. P6 AC-1：1-8 全数量扫掠 + 0/9/12 边界（planRender 确定性矩阵） ==');
  if (typeof pure.planRender === 'function') {
    var P6 = pure.planRender;
    var p6Counts = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 12];
    p6Counts.forEach(function (n) {
      var ds = p6Session(n);
      var snap = JSON.stringify(ds) + '|' + JSON.stringify(p6Recs) + '|' + JSON.stringify(p6Known);
      var a = P6(ds, p6Known, 'pA', p6Recs, null);
      var b = P6(ds, p6Known, 'pA', p6Recs, null);
      var label = 'n=' + n;
      ok(label + '：entries 与舞者一一对齐（无截断无例外）', a.entries.length === n && a.entries.every(function (e, i) { return e.index === i; }));
      ok(label + '：母版数=手算期望（' + P6_EXPECT_MASTERS[n] + '，指纹+外观去重+替身按需）',
        a.masterKeys.length === P6_EXPECT_MASTERS[n], '实际=' + a.masterKeys.length);
      ok(label + '：母版数永不超过舞者数', a.masterKeys.length <= n, '实际=' + a.masterKeys.length);
      ok(label + '：每位要么自己/共享外观的母版、要么替身+P3 原因类（绝不借别人的指纹/外观）',
        a.entries.every(function (e) {
          if (e.masterKey === a.standinKey) return ['missing-profile', 'no-skeleton', 'no-active-profile'].indexOf(e.reason) >= 0 && e.skeletonHash === null;
          var rec = null;
          p6Recs.forEach(function (r) { if (r.id === e.profileId) rec = r; });
          return e.skeletonHash !== null && e.masterKey === keyFor(e.skeletonHash, rec || { modelNames: [], modelSize: 0 }) && a.masters[e.masterKey];
        }));
      ok(label + '：指纹互不串门（指纹不同→母版键必不同）', (function () {
        for (var i = 0; i < a.entries.length; i++) for (var j = i + 1; j < a.entries.length; j++) {
          var x = a.entries[i], y = a.entries[j];
          if (x.skeletonHash && y.skeletonHash && x.skeletonHash !== y.skeletonHash && x.masterKey === y.masterKey) return false;
        }
        return true;
      })());
      ok(label + '：替身母版只在有人需要时出现（且不挂档案）',
        (a.masterKeys.indexOf(a.standinKey) >= 0) === a.entries.some(function (e) { return e.masterKey === a.standinKey; }) &&
        (!a.masters[a.standinKey] || a.masters[a.standinKey].profileId === null));
      ok(label + '：等输入等输出（两次规划深相等）', eqJson(a, b));
      ok(label + '：零输入突变（dancers/recs/known 深相等保持）',
        JSON.stringify(ds) + '|' + JSON.stringify(p6Recs) + '|' + JSON.stringify(p6Known) === snap);
    });
    // n=8 满员时的逐舞者班级矩阵（每类一列，断到 reason/state/profileId 级；母版键=指纹+外观）
    {
      var a8 = P6(p6Session(8), p6Known, 'pA', p6Recs, null);
      var kA = keyFor(P6_F1, p6Recs[0]), kB = keyFor(P6_F2, p6Recs[2]), kN = keyFor(P6_F3, p6Recs[3]);
      ok('n=8 班级矩阵：[0]绑 pA→F1 外观母版、无原因', a8.entries[0].state === 'bound' && a8.entries[0].masterKey === kA && a8.entries[0].reason === null);
      ok('n=8 班级矩阵：[1]绑 pB→F2（异骨架不并母版）', a8.entries[1].state === 'bound' && a8.entries[1].masterKey === kB && a8.entries[1].skeletonHash === P6_F2);
      ok('n=8 班级矩阵：[2]绑 pA2→共享 F1 外观母版（同键不同档）', a8.entries[2].masterKey === kA && a8.entries[2].masterKey === a8.entries[0].masterKey && a8.entries[2].profileId === 'pA2');
      ok('n=8 班级矩阵：[3]有骨架无模型→自己 F3 外观母版+no-model', a8.entries[3].masterKey === kN && a8.entries[3].reason === 'no-model' && a8.entries[3].skeletonHash === P6_F3);
      ok('n=8 班级矩阵：[4]无骨架空壳→替身+no-skeleton', a8.entries[4].masterKey === a8.standinKey && a8.entries[4].reason === 'no-skeleton');
      ok('n=8 班级矩阵：[5]悬空 id→替身+missing-profile（state=missing）',
        a8.entries[5].masterKey === a8.standinKey && a8.entries[5].reason === 'missing-profile' && a8.entries[5].state === 'missing' && a8.entries[5].profileId === null);
      ok('n=8 班级矩阵：[6]未绑→default 解析活动档案 pA/F1', a8.entries[6].state === 'default' && a8.entries[6].profileId === 'pA' && a8.entries[6].masterKey === kA);
      ok('n=8 班级矩阵：[7]再绑 pA→与 [0] 同母版（F1 外观归并绑 pA/pA2/缺省的 0,2,6,7）',
        a8.entries[7].masterKey === kA && a8.masters[kA].dancers.join(',') === '0,2,6,7');
      ok('n=8 母版表恰 4 条：F1/F2/F3 外观母版/替身，各挂各的指纹', a8.masterKeys.length === 4 &&
        a8.masters[kA].skeletonHash === P6_F1 && a8.masters[kB].skeletonHash === P6_F2 &&
        a8.masters[kN].skeletonHash === P6_F3 && a8.masters[a8.standinKey].skeletonHash === null);
    }
  } else {
    ok('planRender 已导出（红基线：实现前缺失）', false);
  }

  console.log('== 20. P6 AC-5：buildGameClips 不变性（previewActor 带/不带/越界 × 绑定无关） ==');
  {
    // 满员混合绑定会话：三轨各一条、跨舞者时间重叠、全局歌词两条、舞者2 静音
    var ds20 = p6Session(8);
    ds20.forEach(function (d, i) {
      d.switchClips = [{ id: 'sw' + i, start: 0, duration: 0.5, autoDur: false, data: { name: '切职' + i, command: '/job' } }];
      d.actionClips = [{ id: 'ac' + i, start: 5 + i * 0.1, duration: 2, autoDur: false, data: { name: '动作' + i, command: '/emote' + i } }];
      d.lyricClips = [{ id: 'ly' + i, start: 9, duration: 1, autoDur: false, data: { name: '台词' + i, command: '/say x' + i } }];
    });
    ds20[1].mute = true;
    var gl20 = [
      { id: 'g1', start: 1, duration: 1, autoDur: false, data: { name: '副歌', command: '/say g1' } },
      { id: 'g2', start: 20, duration: 2, autoDur: false, data: { name: '尾声', command: '/say g2' } },
    ];
    var free20 = JSON.parse(JSON.stringify(ds20));
    free20.forEach(function (d) { delete d.profileId; }); // 绑定无关基线：同一会话只去掉 profileId 键
    var mute20 = function (ds, di) { return pure.isMuted(ds, di); };
    // (a) 不带 previewActor：静音过滤口径与绑定无关（字节级不变）
    ok('(a) 不带 previewActor：绑定在否 payload 逐字节相等（静音口径不变）',
      eqJson(pure.buildGameClips(ds20, gl20, mute20), pure.buildGameClips(free20, gl20, mute20)));
    // (b) 逐 k：只发舞者 k 自己三轨 + 全局歌词；与绑定无关基线逐字节相等；k 被静音也照发
    var all20 = true, detail20 = '';
    for (var k20 = 0; k20 < 8; k20++) {
      var pk = pure.buildGameClips(ds20, gl20, mute20, k20);
      var expect = ['switchClips', 'actionClips', 'lyricClips'].reduce(function (n, tr) { return n + ds20[k20][tr].length; }, 0) + gl20.length;
      var onlyK = pk.every(function (e) { return e.actorId === k20 || e.actorId === -1; });
      var eqBase = eqJson(pk, pure.buildGameClips(free20, gl20, mute20, k20));
      var sorted = pk.every(function (e, i) { return i === 0 || pk[i - 1].start <= e.start; });
      if (!(pk.length === expect && onlyK && eqBase && sorted)) {
        all20 = false; detail20 = 'k=' + k20 + ' len=' + pk.length + '/' + expect + ' onlyK=' + onlyK + ' eqBase=' + eqBase;
      }
    }
    ok('(b) k=0..7：恰舞者 k 三轨+全局歌词（含被静音的 k=1），与绑定无关基线逐字节相等，按 start 排序', all20, detail20);
    ok('(b) 全局歌词永远带（actorId=-1，两条都在）', (function () {
      var p0 = pure.buildGameClips(ds20, gl20, mute20, 0);
      return p0.filter(function (e) { return e.actorId === -1; }).length === 2;
    })());
    // (c) 越界 k：只剩全局歌词（绝不静默换成别人）
    [8, 99].forEach(function (k) {
      var oor = pure.buildGameClips(ds20, gl20, mute20, k);
      ok('(c) 越界 k=' + k + '：只剩全局歌词（actorId 全为 -1）', oor.length === 2 && oor.every(function (e) { return e.actorId === -1; }));
    });
    // (d) 绝不带别人的事件：k 的 payload 里没有任何其他舞者的 clip id
    ok('(d) 指定 k 的 payload 绝不含其他舞者的条目', (function () {
      var p3 = pure.buildGameClips(ds20, gl20, mute20, 3);
      return !p3.some(function (e) { return e.actorId !== -1 && String(e.id).replace(/^(sw|ac|ly)/, '') !== '3'; });
    })());
  }

  console.log('== 21. M2 起始站位（TASK-20260906-M2-START-FORMATION / AC-1·AC-2） ==');
  {
    // AC-1：独立 sin-cos oracle（测试内联重算，不复用实现公式做期望）
    var yaws = [0, 90, 180, 270, -90, 450, 720];
    var fwOk = true, fwDetail = '';
    yaws.forEach(function (y) {
      var got = pure.startForward(y);
      var r = y * Math.PI / 180;
      var exp = [Math.sin(r), 0, Math.cos(r)];
      var d = Math.abs(got[0] - exp[0]) + Math.abs(got[1] - exp[1]) + Math.abs(got[2] - exp[2]);
      if (!(got && d < 1e-6)) { fwOk = false; fwDetail += 'yaw=' + y + ' d=' + d + ';'; }
    });
    ok('前向=(sin,0,cos) 0/90/180/270/-90/450/720 在 1e-6 内', fwOk, fwDetail || yaws.join(','));
    ok('包络等价：-90==270、450==90、720==0', (function () {
      function eq(a, b) {
        var fa = pure.startForward(a), fb = pure.startForward(b);
        return Math.abs(fa[0] - fb[0]) < 1e-6 && Math.abs(fa[2] - fb[2]) < 1e-6;
      }
      return eq(-90, 270) && eq(450, 90) && eq(720, 0);
    })());
    ok('非有限 yaw 不进前向（null）', pure.startForward(NaN) === null && pure.startForward(Infinity) === null);
    // 显式判定：原点合法，缺失/畸形按缺失
    ok('显式原点 {0,0,0} 是合法 start', pure.hasExplicitStart({ start: { x: 0, z: 0, yawDeg: 0 } }) === true);
    ok('缺失/非对象/非有限/多键按缺失', (function () {
      return pure.hasExplicitStart({}) === false
        && pure.hasExplicitStart({ start: null }) === false
        && pure.hasExplicitStart({ start: 'x' }) === false
        && pure.hasExplicitStart({ start: { x: 1, z: 2 } }) === false
        && pure.hasExplicitStart({ start: { x: NaN, z: 0, yawDeg: 0 } }) === false
        && pure.hasExplicitStart({ start: { x: 1, z: 0, yawDeg: 0, extra: 1 } }) === false;
    })());
    // 写入：仅改目标舞者，经纯操作 + 存储原样保留
    (function () {
      var ds = [{ name: 'A' }, { name: 'B' }];
      var r = pure.setDancerStart(ds, 0, '2', '-1', '90');
      ok('正常 Apply 只改目标舞者且原样保留', r.ok && r.changed && ds[0].start.x === 2 && ds[0].start.z === -1 && ds[0].start.yawDeg === 90 && !('start' in ds[1]));
    })();
    // 非法零写入
    [' ', '', 'abc', 'NaN', 'Infinity', '-Infinity'].forEach(function (bad) {
      var ds = [{ name: 'A' }];
      var snap = JSON.stringify(ds);
      var r = pure.setDancerStart(ds, 0, bad, '0', '0');
      ok('非法 x=' + JSON.stringify(bad) + ' 拒绝零写入', !r.ok && JSON.stringify(ds) === snap);
    });
    (function () {
      var ds = [{ name: 'A' }];
      var s0 = JSON.stringify(ds);
      ok('NaN/Infinity 数字拒绝零写入', (function () {
        var a = pure.setDancerStart(ds, 0, NaN, 0, 0);
        var b = pure.setDancerStart(ds, 0, Infinity, 0, 0);
        return !a.ok && !b.ok && JSON.stringify(ds) === s0;
      })());
    })();
    // 同值/取消/清除语义
    (function () {
      var ds = [{ name: 'A', start: { x: 1, z: 2, yawDeg: 30 } }];
      var r = pure.setDancerStart(ds, 0, '1', '2', '30');
      ok('同值 Apply 零写入（changed=false）', r.ok && r.changed === false && eqJson(ds[0].start, { x: 1, z: 2, yawDeg: 30 }));
      var c1 = pure.clearDancerStart(ds, 0);
      ok('Clear 删键恢复缺失', c1.ok && c1.changed && !('start' in ds[0]));
      var c2 = pure.clearDancerStart(ds, 0);
      ok('重复 Clear 零写入', c2.ok && c2.changed === false);
    })();
    // 缺失舞者零抛错零写入
    (function () {
      var ds = [{ name: 'A' }];
      var s0 = JSON.stringify(ds);
      var r1 = pure.setDancerStart(ds, 9, '1', '0', '0');
      var r2 = pure.clearDancerStart(ds, 9);
      ok('缺失 id 对话框零写入零抛错', !r1.ok && !r2.ok && JSON.stringify(ds) === s0);
    })();
    // 快速连续 Apply 最后一次获胜
    (function () {
      var ds = [{ name: 'A' }];
      pure.setDancerStart(ds, 0, '1', '0', '0');
      pure.setDancerStart(ds, 0, '2', '0', '0');
      var r = pure.setDancerStart(ds, 0, '3', '0', '0');
      ok('快速连续 Apply 最后一次获胜', r.ok && ds[0].start.x === 3);
    })();
    // 放置解算：显式 vs 缺失等距
    (function () {
      var ds = [{ name: 'A', start: { x: 2, z: -1, yawDeg: 90 } }, { name: 'B' }];
      var p0 = pure.placementFor(ds, 0), p1 = pure.placementFor(ds, 1);
      var expX1 = (1 - (2 - 1) / 2) * pure.START_SPACING;
      ok('显式放置 (x,z)+yaw 前向', p0.hasStart && p0.x === 2 && p0.z === -1 && Math.abs(p0.forward[0] - 1) < 1e-6 && Math.abs(p0.forward[2]) < 1e-6);
      ok('缺失保持索引等距 x=(i-(n-1)/2)*1.15', !p1.hasStart && Math.abs(p1.x - expX1) < 1e-9 && p1.z === 0 && p1.yawDeg === 0);
      ok('非有限 start 永不进放置（回等距）', (function () {
        var bad = [{ name: 'A', start: { x: NaN, z: 0, yawDeg: 0 } }];
        var pb = pure.placementFor(bad, 0);
        return !pb.hasStart;
      })());
    })();
  }

  console.log('== 22. 2D 舞台拖拽坐标变换（TASK-20260906-M2-STAGE-DRAG / AC-1·AC-2） ==');
  {
    ok('舞台纯函数已导出（红基线：实现前缺失）',
      typeof pure.computeStageTransform === 'function' && typeof pure.stageWorldToScreen === 'function'
      && typeof pure.stageScreenToWorld === 'function' && typeof pure.stageCommitDecision === 'function'
      && typeof pure.quantStage === 'function' && typeof pure.stageTransformEqual === 'function');
    // 轴向：+X 右，+Z 上，单 scale 双轴相等
    (function () {
      var t = pure.computeStageTransform(440, 300, [{ x: -2, z: -1 }, { x: 2, z: 1 }]);
      ok('适配变换有限且 scale>0', !!t && isFinite(t.scale) && t.scale > 0);
      var a = pure.stageWorldToScreen(0, 0, t), bx = pure.stageWorldToScreen(1, 0, t), bz = pure.stageWorldToScreen(0, 1, t);
      ok('+X 屏右（x+1 → sx 增大 scale）', bx.sx - a.sx > 0 && Math.abs((bx.sx - a.sx) - t.scale) < 1e-9);
      ok('+Z 屏上（z+1 → sy 减小 scale）', a.sy - bz.sy > 0 && Math.abs((a.sy - bz.sy) - t.scale) < 1e-9);
      ok('双轴同一 scale（|dx|==|dy|==scale，差值 1e-9 内）',
        Math.abs(Math.abs(bx.sx - a.sx) - Math.abs(a.sy - bz.sy)) < 1e-9);
    })();
    // 独立逆变换：world→screen→world 往返 1e-9
    (function () {
      var t = pure.computeStageTransform(440, 300, [{ x: 2, z: -1 }, { x: -1, z: 3 }]);
      var pts = [{ x: 2, z: -1 }, { x: 0, z: 0 }, { x: -1.25, z: 3 }, { x: 10, z: -10 }];
      var allOk = pts.every(function (p) {
        var s = pure.stageWorldToScreen(p.x, p.z, t);
        var w = pure.stageScreenToWorld(s.sx, s.sy, t);
        return Math.abs(w.x - p.x) < 1e-9 && Math.abs(w.z - p.z) < 1e-9;
      });
      ok('独立坐标逆变换往返 1e-9（4 点）', allOk);
    })();
    // 非钳制：表面外坐标仍解算有限值（存储永不按视口钳制）
    (function () {
      var t = pure.computeStageTransform(440, 300, [{ x: 0, z: 0 }]);
      var w = pure.stageScreenToWorld(-100, 9999, t);
      ok('表面外仍解算有限世界坐标（不钳制）', !!w && isFinite(w.x) && isFinite(w.z));
    })();
    // 非法几何：空/缺失/非有限/零尺寸 → null（面板走中文不可编辑态）
    (function () {
      ok('空点集/零尺寸/非有限 → null',
        pure.computeStageTransform(440, 300, []) === null
        && pure.computeStageTransform(0, 300, [{ x: 0, z: 0 }]) === null
        && pure.computeStageTransform(440, 0, [{ x: 0, z: 0 }]) === null
        && pure.computeStageTransform(NaN, 300, [{ x: 0, z: 0 }]) === null
        && pure.computeStageTransform(440, 300, [{ x: NaN, z: 0 }]) === null);
    })();
    // 提交判定：有限/未动/回原量化点/非有限
    (function () {
      var fb = { x: 0.575, z: 0 };
      ok('非有限指针解算 → 不提交', pure.stageCommitDecision(null, fb, NaN, 0).commit === false);
      ok('缺失起点的回退量化点 → 不提交（零历史）', (function () {
        var qx = pure.quantStage(fb.x), qz = pure.quantStage(fb.z);
        return pure.stageCommitDecision(null, fb, qx, qz).commit === false;
      })());
      var st = { x: 1, z: 2, yawDeg: 30 };
      ok('显式起点的同值量化 → 不提交', pure.stageCommitDecision(st, null, 1, 2).commit === false);
      var dec = pure.stageCommitDecision(st, null, 1.5, 2);
      ok('有效位移 → 提交厘米量化值', dec.commit === true && dec.x === 1.5 && dec.z === 2);
      ok('变换快照严格相等（同值深相等）', (function () {
        var t1 = pure.computeStageTransform(440, 300, [{ x: 0, z: 0 }, { x: 1, z: 1 }]);
        var t2 = { scale: t1.scale, originX: t1.originX, originY: t1.originY, viewW: t1.viewW, viewH: t1.viewH };
        return pure.stageTransformEqual(t1, t2) === true
          && pure.stageTransformEqual(t1, Object.assign({}, t2, { scale: t2.scale + 1 })) === false;
      })());
    })();
  }

  console.log('== 23. 同骨架异外观母版身份（TASK-20260907-APPEARANCE-DEFECT-REPAIR 回归） ==');
  {
    const PX = pure.planRender;
    const FX = 'fx-one';
    const hasApp = pure && typeof pure.appearanceId === 'function' && typeof pure.masterKeyFor === 'function';
    ok('外观身份函数已导出（红基线：旧实现缺失）', hasApp);
    if (hasApp) {
      // appearanceId 内容口径：哈希优先（顺序无关），缺哈希退清单+字节；纯函数不改入参
      ok('同字节异名同哈希 → 同一外观身份',
        pure.appearanceId({ modelHashes: ['ccc'], modelNames: ['same.glb'], modelSize: 21 }) ===
        pure.appearanceId({ modelHashes: ['ccc'], modelNames: ['twin.glb'], modelSize: 21 }));
      ok('哈希顺序无关（排序后拼接）',
        pure.appearanceId({ modelHashes: ['b', 'a'] }) === pure.appearanceId({ modelHashes: ['a', 'b'] }));
      ok('异哈希 → 身份不同',
        pure.appearanceId({ modelHashes: ['aaa'] }) !== pure.appearanceId({ modelHashes: ['bbb'] }));
      ok('缺哈希时清单+字节区分外观',
        pure.appearanceId({ modelNames: ['red.glb'], modelSize: 11 }) !== pure.appearanceId({ modelNames: ['blue.glb'], modelSize: 12 }));
      ok('缺哈希时同名同字节 → 同身份',
        pure.appearanceId({ modelNames: ['m.glb'], modelSize: 5 }) === pure.appearanceId({ modelNames: ['m.glb'], modelSize: 5 }));
      ok('畸形输入不炸（null/空对象给出确定性字符串身份）',
        pure.appearanceId(null) === pure.appearanceId({}) && typeof pure.appearanceId(null) === 'string');
      ok('母版键以指纹开头并携带外观段', (function () {
        const k = pure.masterKeyFor(FX, { modelHashes: ['aaa'] });
        return k.indexOf(FX) === 0 && k.length > FX.length;
      })());
      // planner：同指纹异外观分母版（render 层逐舞者取模型的规划前提）
      const rA = { id: 'ra', name: '档案ra', skeletonHash: FX, boneCount: 84, hasSkeleton: true, modelNames: ['red.glb'], modelSize: 11, isActive: false, modelHashes: ['aaa'] };
      const rB = { id: 'rb', name: '档案rb', skeletonHash: FX, boneCount: 84, hasSkeleton: true, modelNames: ['blue.glb'], modelSize: 12, isActive: false, modelHashes: ['bbb'] };
      const dd = PX([dancerOf({ profileId: 'ra' }), dancerOf({ profileId: 'rb' })], ['ra', 'rb'], null, [rA, rB], null);
      ok('同指纹异外观 → 两条母版', dd.masterKeys.length === 2, '实际=' + dd.masterKeys.length);
      ok('两位舞者母版键不同', dd.entries[0].masterKey !== dd.entries[1].masterKey);
      ok('母版数永不超过舞者数', dd.masterKeys.length <= dd.entries.length);
      ok('规划器不改入参（含新增 modelHashes 字段）',
        JSON.stringify(rA.modelHashes) === '["aaa"]' && JSON.stringify(rB.modelHashes) === '["bbb"]');
    } else {
      ok('同指纹异外观分母版（待实现）', false);
      ok('外观身份内容口径（待实现）', false);
      ok('母版键形状（待实现）', false);
    }
  }

  console.log('== 24. 预览蒙皮遍历保义与夹具绕序（TASK-20260909-RENDER-DEEPDIVE r5 回归） ==');
  {
    // (a) 侧面保留缝：makeRig 的蒙皮遍历保持原始一字语义（只关 frustumCulled，绝不改材质 side/needsUpdate）；
    // r3 的强制 DoubleSide 修复已按主人裁决撤销（保导入侧语义），缺身体改由 r5 修正夹具验收
    const p3d = require('fs').readFileSync(require('path').join(__dirname, 'preview3d.js'), 'utf8');
    const rigStart = p3d.indexOf('function makeRig');
    const t0 = p3d.indexOf('model.traverse', rigStart);
    const t1 = p3d.indexOf('var group = new THREE.Group();', rigStart);
    const trav = (rigStart >= 0 && t0 > rigStart && t1 > t0)
      ? p3d.slice(p3d.lastIndexOf('\n', t0) + 1, t1).replace(/\s+$/, '') + '\n' : '';
    ok('makeRig 蒙皮遍历保义（仅 frustumCulled；无 side/needsUpdate/DoubleSide 改写）',
      trav === '    model.traverse(function (o) { if (o.isSkinnedMesh) o.frustumCulled = false; });\n' &&
      trav.indexOf('DoubleSide') < 0 && trav.indexOf('side') < 0 && trav.indexOf('needsUpdate') < 0);
    ok('源-dist 双子 preview3d.js 逐字节一致',
      require('fs').readFileSync(require('path').join(__dirname, 'preview3d.js')).equals(
        require('fs').readFileSync(require('path').join(__dirname, 'dist', 'ChoreoHelper', 'preview3d.js'))));
    // (b) 夹具绕序特征：r5 修正夹具红/蓝各 12 三角全外向（内向 6 片已反转，SHA 与清单一致）；
    // 原始夹具保持 6/12 内向的不可变特征化（H4 物证）。夹具字节若变，断言会响——先复核矩阵再更新期望
    const evFix = (rel) => require('path').join(__dirname, '..', '.agent', 'evidence', 'TASK-20260909-RENDER-DEEPDIVE', rel);
    const windingOf = (fp) => {
      const g = JSON.parse(require('fs').readFileSync(fp, 'utf8'));
      const buf = Buffer.from(g.buffers[0].uri.split(',')[1], 'base64');
      const prim = g.meshes[0].primitives[0];
      const rd = (ai) => {
        const acc = g.accessors[ai], bv = g.bufferViews[acc.bufferView], off = (bv.byteOffset || 0) + (acc.byteOffset || 0);
        const nc = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[acc.type], sz = { 5121: 1, 5123: 2, 5125: 4, 5126: 4 }[acc.componentType];
        const out = [];
        for (let i = 0; i < acc.count; i++) { const r = []; for (let c = 0; c < nc; c++) { const o = off + (i * nc + c) * sz; r.push(acc.componentType === 5126 ? buf.readFloatLE(o) : buf.readUInt16LE(o)); } out.push(r); }
        return out;
      };
      const pos = rd(prim.attributes.POSITION), ia = g.accessors[prim.indices], ib = g.bufferViews[ia.bufferView];
      const io = (ib.byteOffset || 0) + (ia.byteOffset || 0), idx = [];
      for (let i = 0; i < ia.count; i++) idx.push(buf.readUInt16LE(io + i * 2));
      const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
      const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
      const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
      pos.forEach((p) => { for (let k = 0; k < 3; k++) { if (p[k] < mn[k]) mn[k] = p[k]; if (p[k] > mx[k]) mx[k] = p[k]; } });
      const c = [(mn[0] + mx[0]) / 2, (mn[1] + mx[1]) / 2, (mn[2] + mx[2]) / 2];
      let inverted = 0, total = 0;
      for (let t = 0; t < idx.length / 3; t++) {
        const a = pos[idx[t * 3]], b = pos[idx[t * 3 + 1]], cc = pos[idx[t * 3 + 2]];
        const n = cross(sub(b, a), sub(cc, a));
        const cen = [(a[0] + b[0] + cc[0]) / 3 - c[0], (a[1] + b[1] + cc[1]) / 3 - c[1], (a[2] + b[2] + cc[2]) / 3 - c[2]];
        total++;
        if (n[0] * cen[0] + n[1] * cen[1] + n[2] * cen[2] < 0) inverted++;
      }
      return { total: total, inward: inverted };
    };
    try {
      const m5 = JSON.parse(require('fs').readFileSync(evFix(require('path').join('r5', 'fixtures', 'manifest.json')), 'utf8'));
      for (const fx of m5.fixtures) {
        const fp = evFix(require('path').join('r5', 'fixtures', fx.file));
        const w = windingOf(fp);
        const shaOk = require('crypto').createHash('sha256').update(require('fs').readFileSync(fp)).digest('hex') === fx.sha256;
        ok('r5 修正夹具 ' + fx.key + '：SHA 与清单一致且 12 三角全外向',
          shaOk && w.total === 12 && w.inward === 0, '实际内向=' + w.inward + '/' + w.total + ' shaOk=' + shaOk);
      }
      const wo = windingOf(evFix(require('path').join('fixtures', 'appearance-red.gltf')));
      ok('原始特征化夹具仍 12 三角中恰 6 片反绕（H4 不可变物证）', wo.total === 12 && wo.inward === 6, '实际=' + wo.inward + '/' + wo.total);
    } catch (e) {
      ok('夹具可读且绕序可算（' + ((e && e.message) || e) + '）', false);
    }
  }

  console.log('== 25. 舞台朝向拖拽纯函数（TASK-20260909-M2-STAGE-YAW / AC-2） ==');
  {
    ok('朝向纯函数已导出（红基线：实现前缺失）',
      typeof pure.stageYawFromPointer === 'function' && typeof pure.stageYawCommitDecision === 'function'
      && typeof pure.quantStageYaw === 'function' && pure.STAGE_YAW_QUANT === 1);
    // 指针角：零 yaw 朝上（+Z 屏上），正 yaw 转向 +X（屏右），与 facing 箭头 rotate 同口径
    (function () {
      var cx = 100, cy = 100;
      ok('正上为 0 度', Math.abs(pure.stageYawFromPointer(cx, cy, cx, cy - 50) - 0) < 1e-9);
      ok('正右为 90 度', Math.abs(pure.stageYawFromPointer(cx, cy, cx + 50, cy) - 90) < 1e-9);
      ok('正下为 ±180 度', Math.abs(Math.abs(pure.stageYawFromPointer(cx, cy, cx, cy + 50)) - 180) < 1e-9);
      ok('正左为 -90 度', Math.abs(pure.stageYawFromPointer(cx, cy, cx - 50, cy) - (-90)) < 1e-9);
      ok('非有限输入→NaN（不提交）', !isFinite(pure.stageYawFromPointer(cx, cy, NaN, cy)));
      ok('零向量（恰落中心）→NaN（不提交）', !isFinite(pure.stageYawFromPointer(cx, cy, cx, cy)));
    })();
    // 量化：整度，-0 归 0，大角度不包络归一（450 仍 450），非有限→NaN
    (function () {
      ok('整度量化 30.4→30、30.6→31', pure.quantStageYaw(30.4) === 30 && pure.quantStageYaw(30.6) === 31);
      ok('-0 归 0（JSON 稳定）', pure.quantStageYaw(-0.1) === 0 && Object.is(pure.quantStageYaw(-0.1), 0));
      ok('大角度不包络归一（450 仍 450，-90 仍 -90）', pure.quantStageYaw(450) === 450 && pure.quantStageYaw(-90) === -90);
      ok('非有限→NaN', !isFinite(pure.quantStageYaw(NaN)) && !isFinite(pure.quantStageYaw(Infinity)));
    })();
    // 提交判定：有限/未动/回原量化点/非有限；缺失回退 yaw 0；只定 yaw（x/z 由调用方保留）
    (function () {
      ok('非有限指针 yaw→不提交', pure.stageYawCommitDecision({ x: 1, z: 2, yawDeg: 30 }, NaN).commit === false);
      ok('显式起点同值量化→不提交', pure.stageYawCommitDecision({ x: 1, z: 2, yawDeg: 30 }, 30.1).commit === false);
      ok('缺失起点回退 0 点→不提交（零历史）', pure.stageYawCommitDecision(null, 0.1).commit === false);
      var dec = pure.stageYawCommitDecision({ x: 1, z: 2, yawDeg: 30 }, 90.4);
      ok('有效旋转→提交整度 yaw', dec.commit === true && dec.yaw === 90, 'yaw=' + dec.yaw);
      var dec2 = pure.stageYawCommitDecision(null, 45.5);
      ok('缺失起点有效旋转→提交（x/z 由调用方取回退）', dec2.commit === true && dec2.yaw === 46, 'yaw=' + dec2.yaw);
      // 前向等价：存储原样（450 不归一为 90），前向在 1e-6 内等价
      var f450 = pure.startForward(450), f90 = pure.startForward(90);
      var feq = f450 && f90 && Math.abs(f450[0] - f90[0]) < 1e-6 && Math.abs(f450[2] - f90[2]) < 1e-6;
      ok('包络等价 450==90 前向 1e-6（存储不归一）', feq);
    })();
  }

  console.log('== 26. 2D 舞台参照跨度上限（TASK-20260909-M2-STAGE-SCALE / AC-1） ==');
  {
    ok('参照跨度常量已声明且为 10 米（红基线：预变更代码缺失）',
      pure.STAGE_REFERENCE_SPAN === 10);
    // 簇集内容：上限 scale <= drawableWidth/10（1e-9 内），横向可见至少 10 米
    (function () {
      var pts = [{ x: 0, z: 0 }, { x: 0.2, z: 0.1 }];
      var t = pure.computeStageTransform(440, 300, pts);
      var drawableW = 440 - 2 * pure.STAGE_PAD;
      var cap = drawableW / 10;
      ok('簇集上限：scale 有限且 <= drawableWidth/10（1e-9 内）',
        !!t && isFinite(t.scale) && t.scale <= cap + 1e-9, 'scale=' + (t && t.scale) + ' cap=' + cap);
      ok('簇集上限：横向可见跨度至少 10 米',
        !!t && (drawableW / t.scale) >= 10 - 1e-9, 'span=' + (t && (drawableW / t.scale)));
      if (t) {
        var a = pure.stageWorldToScreen(0, 0, t), bx = pure.stageWorldToScreen(1, 0, t), bz = pure.stageWorldToScreen(0, 1, t);
        ok('上限下仍 +X 屏右 +Z 屏上且单 scale（1e-9）',
          Math.abs((bx.sx - a.sx) - t.scale) < 1e-9 && Math.abs((a.sy - bz.sy) - t.scale) < 1e-9);
        ok('上限下相对位置保持（两点屏距 = 世界距 × scale，1e-9）', (function () {
          var s0 = pure.stageWorldToScreen(pts[0].x, pts[0].z, t), s1 = pure.stageWorldToScreen(pts[1].x, pts[1].z, t);
          return Math.abs(Math.abs(s1.sx - s0.sx) - Math.abs(pts[1].x - pts[0].x) * t.scale) < 1e-9
            && Math.abs(Math.abs(s0.sy - s1.sy) - Math.abs(pts[1].z - pts[0].z) * t.scale) < 1e-9;
        })());
      }
    })();
    // 宽分布（12 舞者索引线 12.65 米）：上限不生效，与预变更内容适配逐字节相等
    (function () {
      var pts = [{ x: -6.325, z: 0 }, { x: 6.325, z: 0 }];
      var t = pure.computeStageTransform(440, 300, pts);
      // 独立预言：内联重算预变更纯内容适配规则（含 4 米退化回退，不含上限）
      var p = pure.STAGE_PAD, spanX = 12.65, spanZ = pure.STAGE_FALLBACK_SPAN;
      var s0 = Math.min((440 - p * 2) / spanX, (300 - p * 2) / spanZ);
      var exX = (440 - p * 2) - spanX * s0, exZ = (300 - p * 2) - spanZ * s0;
      var e0 = { scale: s0, originX: p + exX / 2 - (-6.325) * s0, originY: 300 - p - exZ / 2 + 0 * s0, viewW: 440, viewH: 300 };
      ok('宽分布不受上限影响（IEEE-754 全等：scale/originX/originY）',
        !!t && t.scale === e0.scale && t.originX === e0.originX && t.originY === e0.originY,
        'scale=' + (t && t.scale) + ' exp=' + e0.scale);
    })();
    // 单点/重合：先走 4 米退化回退，再受同一上限约束
    (function () {
      var drawableW = 440 - 2 * pure.STAGE_PAD, cap = drawableW / 10;
      var t1 = pure.computeStageTransform(440, 300, [{ x: 1, z: 2 }]);
      ok('单点经退化回退后仍受上限（scale<=cap，1e-9）',
        !!t1 && t1.scale <= cap + 1e-9, 'scale=' + (t1 && t1.scale));
      var t2 = pure.computeStageTransform(440, 300, [{ x: 1, z: 1 }, { x: 1, z: 1 }]);
      ok('重合点集有限且受上限', !!t2 && isFinite(t2.scale) && t2.scale <= cap + 1e-9);
    })();
    // 非法几何保持 null（上限不改变不可编辑态）
    (function () {
      ok('空/零尺寸/非有限仍 null',
        pure.computeStageTransform(440, 300, []) === null
        && pure.computeStageTransform(0, 300, [{ x: 0, z: 0 }]) === null
        && pure.computeStageTransform(440, 300, [{ x: NaN, z: 0 }]) === null);
    })();
    // 整幅可拖距离：全幅 drawableWidth 至少覆盖 10 米
    (function () {
      var t = pure.computeStageTransform(440, 300, [{ x: 0, z: 0 }, { x: 0.2, z: 0.1 }]);
      var drawableW = 440 - 2 * pure.STAGE_PAD;
      ok('全幅拖拽覆盖至少 10 米（drawableWidth/scale>=10）',
        !!t && (drawableW / t.scale) >= 10 - 1e-9);
    })();
    // 朝向中心死区（上限包连带回归：布局吸附残差不再幽灵提交）
    (function () {
      ok('中心死区常量已声明且为 1px（红基线：预变更代码缺失）', pure.STAGE_YAW_DEAD_PX === 1);
      ok('恰落中心仍不可定角（NaN）', !isFinite(pure.stageYawFromPointer(100, 100, 100, 100)));
      ok('吸附残差级偏移（0.0094px，如 213.140625 vs 213.15）不可定角（NaN）',
        !isFinite(pure.stageYawFromPointer(213.15, 129.5, 213.140625, 129.5)));
      ok('死区内（0.5px）不可定角（NaN）', !isFinite(pure.stageYawFromPointer(100, 100, 100.5, 100)));
      ok('死区外（2px）仍可定角（右 90 度）',
        Math.abs(pure.stageYawFromPointer(100, 100, 102, 100) - 90) < 1e-9);
      ok('死区内提交判定仍 no-op（经 stageYawCommitDecision）',
        pure.stageYawCommitDecision({ x: 1, z: 2, yawDeg: 30 }, pure.stageYawFromPointer(100, 100, 100.2, 100)).commit === false);
    })();
  }

  console.log('\n结果: ' + pass + ' 过 / ' + fail + ' 败');
  if (fail > 0) { console.log('有失败项！'); process.exit(1); }
})().catch(function (e) { console.error('测试跑挂了：', e); process.exit(1); });
