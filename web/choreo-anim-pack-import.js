// choreo-anim-pack-import.js — TASK-20260918-ANIM-PACK-UNIVERSAL r2：v2 通用动作包导入编排。
//
// 干嘛的：一个 v2 包 → 冻结目标（当前档案，或显式勾选的「全部档案」）→ 逐档案各自换算
//        各自入库。冻结口径（合同 §6）：导入开始前固定目标档案 id、档案快照（profileText）、
//        参考姿态、覆盖选择与操作代；绝不改 activeProfile 来驱动写入；每笔写入在事务内
//        复核档案快照与操作有效性（含覆盖）；切换/关闭/取消使其后写入失效，已提交的保留。
// 计数口径（合同 §7，诚实完成）：每档案 imported/skipped/failed/notStarted 分开计，
//        合计=计划条目×目标数；同名默认跳过，显式覆盖只替换冻结目标里的同名剪辑；存储失败
//        停该档案记部分进度，其余有效档案继续；不宣称整包原子回滚；只有显式重试才重来。
// v1 包不进本模块（UI 层按 formatVersion 分流，v1 保持原有单档案不换算路径）。
(function (root) {
  'use strict';
  var R = function () { return root.ChoreoAnimPackRetarget; };

  // 建冻结计划：profiles=listProfiles() 行（含 id/name/sourceSkeletonCode/hasSkeleton），
  // lib 需提供 getProfile(pid)（整行含 skeleton）。allProfiles=false 只取 activePid。
  // 每目标解析参考姿态（ChoreoAnimPackRetarget.resolveTargetRefs 口径），不兼容的单独列出
  // （AP-R2-02：被拒档案也占 planned 计数——其条目计 failed，合计才能对上「全部选中档案×条目」）。
  // 返回 {ok, plan} 或 {ok:false, reason}：一个可用目标都没有 → 整体拒绝（零写入）。
  async function buildPlan(opts) {
    var lib = opts.lib, pack = opts.pack;
    var v = R().validatePackV2(pack);
    if (!v.ok) return { ok: false, reason: '动作包校验失败：' + v.reason };
    var profiles = opts.allProfiles ? await lib.listProfiles() : (await lib.listProfiles()).filter(function (p) { return p.id === opts.activePid; });
    if (opts.allProfiles) {
      var hit = profiles.filter(function (p) { return p.id === opts.activePid; })[0];
      if (!hit) return { ok: false, reason: '当前活动档案已不存在，未开始导入' };
    }
    var targets = [], rejected = [];
    for (var i = 0; i < profiles.length; i++) {
      var row = profiles[i];
      var full = await lib.getProfile(row.id);
      if (!full) { rejected.push({ id: row.id, name: row.name, reason: '档案记录读取失败', counts: { imported: 0, skipped: 0, failed: pack.entries.length, notStarted: 0 } }); continue; }
      var refs = R().resolveTargetRefs(full, opts.skeletonPack);
      if (!refs.ok) { rejected.push({ id: row.id, name: row.name, reason: refs.reason, counts: { imported: 0, skipped: 0, failed: pack.entries.length, notStarted: 0 } }); continue; }
      targets.push({
        pid: full.id, name: full.name, code: refs.code || '', refSkeleton: refs.refSkeleton, refSource: refs.refSource,
        profileText: JSON.stringify(full), // 冻结档案快照（含骨架/指纹）——写入事务内复核
        counts: { imported: 0, skipped: 0, failed: 0, notStarted: 0 },
        failures: [], preservedBones: {}, droppedBones: {},
      });
    }
    if (!targets.length) return { ok: false, reason: '没有可导入的目标档案：' + rejected.map(function (r) { return r.name + '（' + r.reason + '）'; }).join('；'), rejected: rejected };
    return {
      ok: true,
      plan: {
        generation: Date.now() + '/' + Math.random().toString(36).slice(2), // 操作代（仅标识，不参与字节）
        activePid: opts.activePid, overwrite: !!opts.overwrite,
        targets: targets, rejected: rejected, entries: pack.entries.length, selected: profiles.length,
        cancelled: false, // cancel() 置位：其后所有写入作废（未开始的记 notStarted）
      },
    };
  }

  function isGuardCancel(err) { // 守卫取消（切换/关闭/快照变化）与存储失败分类（见文件头）
    return err && /已变化|已取消/.test(String(err.message || err));
  }

  // 执行冻结计划（顺序逐档案逐条；不并发、不自动重试）。opts.current() 持续有效才继续；
  // opts.putClip(name, clip, pid, guard) 与 opts.clipIndex(pid) 注入（真库/假库同形）。
  // onProgress(stage, detail) 供 UI 汇报。返回 {status:'completed'|'partial'|'cancelled',
  // targets（含最终计数）, rejected（含各自计数）, aggregate, anomalyEntries}
  // AP-R2-02 口径：planned=全部选中档案×条目（被拒档案的条目计 failed）；被拒档案或
  // 异常比例骨（平移保持原样）存在时，结果不得再呈现为「全部完成」——异常骨以
  // anomalyEntries>0 单列（status 保持 completed 时 UI 必须换成含异常的完成文案）。
  async function runPlan(plan, pack, opts) {
    var lib = opts.lib;
    var rejectedN = plan.rejected ? plan.rejected.length : 0;
    var totals = { imported: 0, skipped: 0, failed: 0, notStarted: 0, planned: plan.entries * (plan.targets.length + rejectedN) };
    if (plan.rejected) plan.rejected.forEach(function (r) { totals.failed += (r.counts && r.counts.failed) || plan.entries; });
    for (var t = 0; t < plan.targets.length; t++) {
      var tg = plan.targets[t];
      if (plan.cancelled || (opts.current && !opts.current())) { tg.counts.notStarted = plan.entries; totals.notStarted += plan.entries; continue; }
      var existing = {};
      try { (await lib.clipIndex(tg.pid)).forEach(function (c) { existing[c.name] = 1; }); }
      catch (e) { tg.counts.notStarted = plan.entries; totals.notStarted += plan.entries; tg.failures.push('读取动作库失败：' + ((e && e.message) || e)); continue; }
      for (var i = 0; i < pack.entries.length; i++) {
        var en = pack.entries[i];
        if (plan.cancelled || (opts.current && !opts.current())) { tg.counts.notStarted += plan.entries - i; totals.notStarted += plan.entries - i; break; }
        if (!plan.overwrite && existing[en.name]) { tg.counts.skipped++; totals.skipped++; continue; }
        var pc = pack.clips[en.clipIndex];
        var conv = R().convertClip(pc.clip, pack, tg.refSkeleton);
        if (!conv.ok) { tg.counts.failed++; totals.failed++; tg.failures.push(en.name + '：' + conv.reason); continue; }
        var chk = R().validateConvertedClip(conv.clip);
        if (!chk.ok) { tg.counts.failed++; totals.failed++; tg.failures.push(en.name + '：换算后契约校验失败 ' + chk.reason); continue; }
        conv.clip.name = en.name; // 入库名=条目名（v1 同口径）
        try {
          await opts.putClip(en.name, conv.clip, tg.pid, {
            profileText: tg.profileText, current: function () { return !plan.cancelled && (!opts.current || opts.current()); },
            activeProfileId: plan.activePid, allowOverwrite: plan.overwrite,
          });
        } catch (err) {
          if (isGuardCancel(err)) { // 切换/关闭/快照变化：其后写入作废（合同 §6）；当前条目未提交计入未开始
            plan.cancelled = true;
            tg.counts.notStarted += plan.entries - i; totals.notStarted += plan.entries - i;
            tg.failures.push(en.name + '：' + ((err && err.message) || err) + '——后续条目未开始');
            break;
          }
          tg.counts.failed++; totals.failed++;
          tg.failures.push(en.name + '：' + ((err && err.message) || err));
          // ALG-03：写入前已过数据校验；任何存储失败都停该档案，不仅是配额不足（合同 §7）。
          tg.counts.notStarted += plan.entries - i - 1; totals.notStarted += plan.entries - i - 1;
          break;
        }
        tg.counts.imported++; totals.imported++;
        if (conv.preserved.length) tg.preservedBones[en.name] = conv.preserved.slice();
        if (conv.dropped.length) tg.droppedBones[en.name] = conv.dropped.slice();
        // ALG-04：显示回调失败不能把已提交动作再记成存储失败；诊断明确保留，后续导入继续。
        if (opts.onProgress) {
          try { opts.onProgress('entry', { target: tg, entry: en, totals: totals }); }
          catch (noticeErr) { tg.failures.push(en.name + '：动作已保存，进度通知失败：' + ((noticeErr && noticeErr.message) || noticeErr)); }
        }
      }
    }
    var anomalyEntries = 0; // 异常比例骨（平移保持原样）的条目数——诚实完成口径的一部分
    plan.targets.forEach(function (tg2) { anomalyEntries += Object.keys(tg2.preservedBones).length; });
    var status = plan.cancelled ? 'cancelled'
      : (totals.failed + totals.notStarted > 0 ? 'partial' : 'completed');
    return { status: status, targets: plan.targets, rejected: plan.rejected, aggregate: totals, anomalyEntries: anomalyEntries };
  }

  root.ChoreoAnimPackImport = { buildPlan: buildPlan, runPlan: runPlan, isGuardCancel: isGuardCancel };
})(typeof window !== 'undefined' ? window : globalThis);
