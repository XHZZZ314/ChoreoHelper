# 当前：大改批 C 第七步交付——web 巨石 choreo-app.js 拆分第四刀（2026-09-29）

属主拍板「大改特改」总路线图 docs/OVERHAUL-PLAN-20260928.md。本批把 choreo-app.js 剩余两个中等职责块按同全局名经典脚本原样搬出：①choreo-app-catalog.js（182 行）＝连接探测/目录快照/资料库自动同步/实测时长（probeExport/applyCatalogObject/applyCatalogSnapshot/startConnWatch/probeCaps/probeGame/autoSyncLibrary/refreshMeasured，含 _connTimer/_measuredTimer/_catalog 装时机族，自足性逐组核实）；②choreo-app-dancers.js（341 行）＝舞者管理/目录过滤/冲突/补隙/增删复制条（makeDancer/__choreoModelImportTarget/setDancerCount/conflictEnd/autoFillGaps/addClip/deleteClip/duplicateClip 等）。主件 1345→838 行，行为逐字不变（＋4 行指针注释/−511 行原样搬走；拆分脚本守恒＋回插重组＋逐字三对账全过），两件都加载在主件之前。拆分清单先写进任务文件 §21 再动刀（清单即合同的一部分）。§5a 断言迁移逐条登记：b3/b9 的 deleteClip 切片、obs-fix 的 addClipToAllDancers、b7b WIRE-2 的 showCopyTracksMenu、first-macro J3-9/J3-10/R1-red 改读拆分件（双源助手保留旧目录对拍红测语义）、design-tokens AC-4 与 shell/appAll 扩六件、api 静态扫描 consumer+1。属主验证方法：桌面快捷照常打开编舞助手即可（三部署根已同步逐字节一致，游戏开着与否都可）。安全网＝浏览器探针拆分前后同签名全绿（ux-simplify 52/0×2、obs-fix 16/16×2、standin-pin 18/18×2、first-macro-journey 92→94〔恰＋2 twin〕、object-edit 77×2、workbench 46×2）＋守恒/回插等价重组证明；test-tools-center 探针 P4C-4＝批 A 之前既有红登记不修、前后同点中断＝行为不变。验证：五件 node＝shell 155/0（恰 149＋4＋2）、engine 50/0、check 95/0、edit 399/1、design-tokens 101/1（两条既有红同名零新增未修）；涉面 20+ 套件全绿；四方（源/dist/devPlugins/游戏目录）逐字节一致。唯一下一步：批 C 第八步（web 第五刀：传输区约 37 行/宏与导入导出族约 160 行/宏起步·套装族约 153 行）提示词已就绪未派发；scripts/check-workflow.js --next 输出完整提示词；批 D 实机联调需属主在场预约。以下为历史记录。

---
# 历史：大改批 C 第六步交付——web 巨石 choreo-app.js 拆分第三刀 RENDER 外壳（2026-09-29）

属主拍板「大改特改」总路线图 docs/OVERHAUL-PLAN-20260928.md。本批把 choreo-app.js 的 RENDER 外壳（760 行：_clipNodes/ChoreoDock 停靠/工具中心/命令面板注册表/空态/工作台壳/属性面板/render/renderToolbar/侧栏/动作列表）按同全局名经典脚本原样搬出到 choreo-app-render.js（766 行），主件 2103→1345 行，行为逐字不变（＋2 行指针注释/−760 行原样搬走；拆分脚本守恒＋回插重组＋逐字三对账全过），加载在主件之前（装时机语句六组自足性逐组核实）。拆分清单先写进任务文件 §18 再动刀（清单即合同的一部分）。§5a 断言迁移逐条登记：design-tokens 约 17 检查（appAll 扩四件＋注册表切片改读拆分件）、shell stageBtn/openStage、b8/ui-workspace 的 render..renderToolbar 与 ChoreoDock 切片、ability-plan-entry 的 renderActionList、project-empty-state 的 projectIsEmpty、b7a/b7b/bspatial 命令面板切片双源化、first-macro J1-2（盘点漏项、实证红后补迁）；A/B 对拍红测语义全保留。属主验证方法：桌面快捷照常打开编舞助手即可（三部署根已同步逐字节一致，游戏开着与否都可）。安全网＝浏览器探针拆分前后同签名全绿（ux-simplify 52/0×2、obs-fix 16/16×2、standin-pin 18/18×2、first-macro-journey 91→92〔恰＋1 twin〕、object-edit 77×2、workbench 46×2）＋守恒/回插等价重组证明；test-tools-center 探针 P4C-4＝批 A 之前既有红（断言「全选单 entry」vs 产品文案「全选单条目」，两文件自大改基线零改动）登记不修、前后同点中断＝行为不变。验证：五件 node＝shell 149/0（恰 145＋2＋2）、engine 50/0、check 95/0、edit 399/1、design-tokens 101/1（两条既有红同名零新增未修）；涉面 18 套件全绿；四方（源/dist/devPlugins/游戏目录）逐字节一致。唯一下一步：批 C 第七步（web 第四刀：传输区~115 行/目录同步~176 行/舞者管理~334 行，舞者管理块＝§5a 最大迁移面）提示词已就绪未派发；scripts/check-workflow.js --next 输出完整提示词；批 D 实机联调需属主在场预约。以下为历史记录。

---
# 历史：大改批 C 第五步交付——web 巨石 choreo-app.js 拆分第二刀（2026-09-29）

属主拍板「大改特改」总路线图 docs/OVERHAUL-PLAN-20260928.md。本批把 choreo-app.js 剩余两大职责块按同全局名经典脚本原样搬出：①choreo-app-timeline.js（918 行）＝时间轴窗口化渲染/拖拽/右键菜单/标尺层，加载在主件之前；②choreo-app-playback.js（329 行）＝播放控制/GAMECLOCK 跟随/模式切换层，加载在主件之后——盘点发现 updatePlayhead 在主件有双顶层声明（渲染时钟区死代码版＋播放块生效版，同文件后者生效），跨文件必须保持「后加载者生效」语义，这是播放件排在主件之后的唯一原因。主件 3334→2103 行（−37%），行为逐字不变（＋4 行指针注释/−1235 行原样搬走；拆分脚本守恒＋回插重组＋逐字三对账全过）。拆分清单先写进任务文件 §15 再动刀（清单即合同的一部分）。§5a 断言迁移共 16 处逐条登记（design-tokens 9 检查跨件读/切片改读拆分件、shell start-entry、stop/show-entry 播放切片、b7a/b7b/bspatial 右键菜单 WIRE 切片双源化、first-macro 引导切片；A/B 对拍红测语义全保留）。属主验证方法：桌面快捷照常打开编舞助手即可（三部署根已同步逐字节一致，游戏开着与否都可）；安全网＝浏览器探针拆分前后全绿（ux-simplify/obs-fix 16/16/standin-pin 18/18/first-macro-journey 89→91〔恰＋2 twin〕/object-edit 77，含「全程零未捕获异常」装时机门）＋守恒/回插等价重组证明。验证：五件 node＝shell 145/0（恰 139＋4＋2）、engine 50/0、check 95/0、edit 399/1、design-tokens 101/1（两条既有红同名零新增未修）；涉面 18 套件全绿；四方（源/dist/devPlugins/游戏目录）逐字节一致。唯一下一步：批 C 第六步（web 第三刀：RENDER 外壳约 760 行，design-tokens 多锚＝最大迁移面）提示词已就绪未派发；scripts/check-workflow.js --next 输出完整提示词；批 D 实机联调需属主在场预约。以下为历史记录。

---
# 历史：大改批 C 第四步交付——C# 巨石 AnimationPoseFreezer.cs 拆分第三刀收官（2026-09-29）

属主拍板「大改特改」总路线图 docs/OVERHAUL-PLAN-20260928.md。本批完成 C# 侧最后一刀：把挂载/学习状态机主体与执行辅助群按同类型 partial 分部原样搬出——src\AnimationPoseFreezer.StateMachine.cs（724 行：框架泵 OnFrameworkUpdate/Core＋延迟观察学习 ObserveDeferredTarget＋AttachPhase 直接通道/聊天通道状态机＋执行辅助群 TryBreakLingeringLoop/ExecuteMotionFallback/CanLearnTimeline/ObserveIdleTimeline/SamplePostEmoteReturn/TryPlayTimelinePreferred），主件 1466→762 行（90,475→45,545 B），行为逐字不变（−706 行原样搬走＋2 行头部说明；搬走成员全部 private，public 接口零变化；拆分脚本守恒＋回插重组＋逐字三对账过）。带初始化器静态字段三件（MeasuredDurations/_loopTimelineCache/PinModeEnabled）按约束留主件。拆分清单先写进任务文件 §12 再动刀（清单即合同的一部分）；csproj 零改动、datalayertest 零影响、§5a 迁移面＝零。**C# 巨石拆分至此收官：2028→762 行（−62%），主件剩请求/停止/线程路由门面＋字段群＋Prepare 卫生序列＋Dispose。**属主验证方法：本批无属主操作面（纯开发件结构重构）——安全网＝仓库外隔离 Release 构建零错误（开工前/拆分后双跑、警告集恰＝既有 2 条零新增零消失）＋字节级等价重组证明，实机行为验证归批 D 实机联调。验证：隔离构建 exit 0 零错误双跑；datalayertest 构建 0 错（3 条既有警告同集）＋全套件 761/0；五件 node＝shell 139/0、engine 50/0、check 95/0、edit 399/1、design-tokens 101/1（两条既有红同名零新增未修）；src 逐字节对比恰＝主件改＋一件新件增（其余 141 件相同），仓库内无 bin/obj。实施中误替换任务 §11 章节已当场按原指纹逐字节恢复（复算 3ddb5bbe… MATCH）。唯一下一步：批 C 第五步（web 侧 choreo-app.js 拆分第二步）提示词已就绪未派发；scripts/check-workflow.js --next 输出完整提示词；批 D 实机联调需属主在场预约。以下为历史记录。

---
# 历史：大改批 C 第三步交付——C# 巨石 AnimationPoseFreezer.cs 拆分第二刀（2026-09-29）

属主拍板「大改特改」总路线图 docs/OVERHAUL-PLAN-20260928.md。本批继续拆 C# 侧巨石 src\AnimationPoseFreezer.cs（拆分第一步后 1735 行）：把两个最独立层按同类型 partial 分部原样搬出——①Emote 表解析层→AnimationPoseFreezer.EmoteMap.cs（231 行：命令→表情行/时间轴聚合 AggEmote/EnsureEmoteMap/TryResolveEmote＋运行时变体行合并 TryMergeVariantRow＋循环时间轴判定 IsLoopTimeline）；②时长测量层→AnimationPoseFreezer.Measure.cs（64 行：_pendingMeasures 队列＋公开入口 MeasureDurationDelayed＋到期测量/身份校验 ProcessPendingMeasures/VerifyMeasureTarget）。主件瘦身到 1466 行，行为逐字不变（只搬代码：−272 行原样搬走＋3 行注记；partial 合并下 public 接口零变化；拆分脚本守恒校验＋回插重组还原双对账过）。带初始化器的静态字段三件（MeasuredDurations/_loopTimelineCache/PinModeEnabled）按约束全部留主件。拆分清单先写进任务文件 §9 再动刀（清单即合同的一部分）；csproj 零改动（SDK 通配自动编入）、datalayertest 零影响、§5a 迁移面＝零（本批复核全仓无锚点）。属主验证方法：本批无属主操作面（纯开发件结构重构）——安全网＝仓库外隔离 Release 构建零错误（开工前/拆分后双跑、警告集恰＝既有 2 条零新增零消失）＋字节级等价重组证明，实机行为验证归批 D 实机联调。验证：隔离构建 exit 0 零错误；datalayertest 全量重建 0 错（3 条既有警告同集）＋全套件 761/0；五件 node＝shell 139/0、engine 50/0、check 95/0、edit 399/1、design-tokens 101/1（两条既有红同名零新增未修）；src 全部 .cs/.csproj 对开工快照逐字节对比＝恰主件改＋两新件增（其余 138 件相同），仓库内无 bin/obj。唯一下一步：批 C 第四步（C# 第三刀：挂载/学习状态机主体拆分，主件剩 1466 行中约 596 行状态机主体＋执行辅助群）提示词已就绪未派发；scripts/check-workflow.js --next 输出完整提示词；批 D 实机联调需属主在场预约。以下为历史记录。

---
# 历史：大改批 C 第二步交付——C# 巨石 AnimationPoseFreezer.cs 拆分第一刀（2026-09-29）

属主拍板「大改特改」总路线图 docs/OVERHAUL-PLAN-20260928.md。本批把 C# 侧巨石 src\AnimationPoseFreezer.cs（2028 行；实为 src\ 根下，路线图所写 src\Exporter\ 有误——ARCH2 已先期拆走采样/写入/签名/生命周期四层，本文件＝公共门面＋挂载/学习状态机编排）按层拆出两件同类型 partial 分部：①GPose 精确编辑模式层→AnimationPoseFreezer.Gpose.cs（153 行，/gpose 开关＋确定性动画 id 解析＋直绑定格）；②调试/诊断端点层→AnimationPoseFreezer.Debug.cs（167 行，GetDebugEmoteFamily/DebugPoke/GetDebugDiag/GetDebugAnimState）。主件瘦身到 1734 行，行为逐字不变（partial 文件级搬家＝只搬代码＋类声明加 partial，public 接口零变化；拆分脚本守恒校验＋回插重组还原双对账过，295 行原样搬走）。拆分清单先写进任务文件 §6 再动刀（清单即合同的一部分）；csproj 零改动（SDK 默认通配自动编入）、datalayertest 零影响（不编译本文件）、§5a 迁移面＝零（全仓无落在该文件上的哈希冻结/源文本断言）。属主验证方法：本批无属主操作面（纯开发件结构重构）——安全网＝仓库外隔离 Release 构建零错误（警告集与拆分前完全一致）＋字节级等价重组证明，实机行为验证归批 D 实机联调。验证：隔离构建 exit 0 零错误；datalayertest 全量重建 0 错＋全套件 761/0；五件 node＝shell 139/0、engine 50/0、check 95/0、edit 399/1、design-tokens 101/1（两条既有红同名零新增未修）；src 全部 .cs/.csproj 对开工快照逐字节对比＝恰主件改＋两新件增，仓库内无 bin/obj。唯一下一步：批 C 第三步（C# 第二刀：状态机主体/Emote 解析/时长测量层）提示词已就绪未派发；scripts/check-workflow.js --next 输出完整提示词；批 D 实机联调需属主在场预约。以下为历史记录。

---

# 历史：大改批 C（web 侧）交付——choreo-app.js 巨石拆分第一步（2026-09-28）

属主拍板「大改特改」总路线图 docs/OVERHAUL-PLAN-20260928.md。本批把 322KB 巨石 choreo-app.js（4704 行）拆掉 31%：①配对码/会话令牌/API 薄壳拆成 web/choreo-app-auth.js（131 行）；②WP-3b 编辑事务层（多选删除/全局插删时间/整段平移/整组变换/舞段复制粘贴）拆成 web/choreo-app-edit-tx.js（1257 行）。两件都是经典脚本＋同全局名文件级搬家（window 全局零新增、file:// 兼容，先于控制器加载），choreo-app.js 瘦身到 3334 行，行为逐字不变（字节守恒＋重组还原双对账，git diff 恰 +6/−1376）。同步 html 脚本清单、test-shell 断言、发布白名单；七件切片测试套件按价值优先门迁移为「不变量随代码走」。实施中浏览器探针当场拦下一个装时机隐患（会话令牌种子先于 store 加载会抛 ReferenceError），已修正并前后两轮探针复验全绿——这正是「探针前后全绿才算行为不变」口径的价值。属主验证方法：桌面「编舞助手」照常打开——右键菜单的「整段推迟/提前」「整组变换」「复制此时段舞段」、Ctrl+C/Ctrl+V、Delete 键、工具里的插入/删除时间、配对码粘贴，一切应与拆分前无差别（本轮已用 object-edit 等五个真实浏览器探针前后两轮背书）。验证：五件 node＝shell 139/0（+6 恰新增断言）、engine 50/0、check 95/0、edit 399/1、design-tokens 101/1（两条既有红前后同名、零新增、未修）；探针 ux 53/53、obs 17/17、替身 18/18、宏旅程 87→89（+2 恰新增孪生检查）、object-edit 77/77；三部署根＋源码四方逐字节一致。唯一下一步：批 C 第二步（C# AnimationPoseFreezer.cs 2029 行拆分第一步）提示词已就绪未派发；scripts/check-workflow.js --next 输出完整提示词；批 D 实机联调需属主在场预约。以下为历史记录。

---

# 历史：大改批 B 交付——preview3d 拆分第一步＋pose 缓冲评估（2026-09-28）

属主拍板「大改特改」总路线图 docs/OVERHAUL-PLAN-20260928.md。本批完成两件事：①preview3d.js（2682 行）拆分第一步——M1 视图层（相机/取景/面板尺寸/手势）拆成 web/preview3d-cam.js、AUD2-012 模型缓存层拆成 web/preview3d-cache.js（两件都是经典脚本＋window 全局＋file:// 兼容，先于 preview3d.js 加载；preview3d.js 瘦身为消费者 2272 行，只搬代码＋接线、行为逐字不变），同步两处 choreo-helper-app.html 脚本清单、test-shell.js 断言与发布白名单（顺手堵住「html 引用了但白名单漏录会静默缺文件」这类打包缺口）；②sampleClip 每帧 pose 对象分配改平坦缓冲＝只评估不改码，docs/OVERHAUL-POSE-BUFFER-EVAL.md 交付（结论：收益中偏低、接口代价偏高，建议三阶段 C 方案，不建议立即实施）。属主验证方法：桌面「编舞助手」照常打开 3D 预览面板——拖播放头/播放/拖拽旋转/滚轮缩放/正视侧视顶视按钮/最大化，一切应与拆分前无差别（本轮已用真实浏览器前后两轮探针＋视图快照逐字节对拍背书）。验证：五件 node＝shell 133/0、engine 50/0、edit 399/1、check 95/0、design-tokens 101/1（两条既有红前后同一条、零新增；shell +5 恰为本批新断言）；浏览器探针 ux-simplify/替身钉桩 18/18/OBS 16/16/宏旅程 87 拆分前后全绿；三部署根＋源码四方逐字节一致。唯一下一步：批 C（choreo-app.js 巨石拆分第一步）提示词已就绪未派发；scripts/check-workflow.js --next 输出完整提示词；批 D 实机联调需属主在场预约。以下为历史记录。

---

# 历史：大改批 A 交付——性能快赢＋流程瘦身（2026-09-28）

属主拍板「大改特改」后，总路线图见 docs/OVERHAUL-PLAN-20260928.md，本批完成四件事：①大改前安全基线提交 045b952（此前 1001 行在制工作全部入库，可随时回退）；②预览引擎动画采样从逐帧线性扫描改为二分查找（拖播放头/多人预览时每秒上万次关键帧扫描降为对数级，输出逐字不变）；③3D 面板骨骼应用改为预建索引表（消除每帧上万次字符串解析），两处均已同步到三处部署根（网页源/dev 插件/游戏目录，浏览器刷新即生效）；④「价值优先门」写入 AI-WORKFLOW §5a（离线全绿≠完成、边缘反例返工上限一轮、哈希冻结不锁实现细节）。重要更正：音乐节拍系统并非缺失——波形/BPM/拍号/预备拍/吸附两批增量已交付且测试全绿，剩余＝属主实听验收（SPEC 复选框因此暂不勾）。验证：五件 node 测试 shell 128/0、engine 50/0、check 95/0，edit/design-tokens 各剩 1 条既有红（经基线提交对照证实与本批无关，已登记不修）。属主验证方法：打开桌面「编舞助手」→ 拖动播放头/多人播放，感受流畅度；实听音乐面板确认听感。唯一下一步：批 B（preview3d 拆分第一步＋pose 缓冲评估）提示词已就绪未派发；scripts/check-workflow.js --next 输出完整提示词；批 D 实机联调需属主在场预约。以下为历史记录。

---

# 历史：R4-ID 身份字段格式返工完成，待新独立验收（2026-09-29 UTC）

属主已明确授权（「授权开工」）。本轮只修一项：技能回执身份字段用 String() 比较导致数组形式 EventId/ActorId 绕过校验。现改为标量类型校验——EventId 必须是字符串并与计划事件身份严格相等，ActorId 允许数值与数字串两种既有合法形态；数组/对象/布尔/null 在任何保存回调前被拒绝，recentLog 与 outcome 两来源都覆盖；合法回执、正常中止保存与未知证据语义不变，去重与原生行为范围未动。修复前三个反例在旧字节上真实复现 accepted、writes=1；修复后七个非标量变体全部拒绝且保存回调零触达，数字串 ActorId 仍可保存。验证：隔离 Release 强制重建 0 错误；solo-show 94/94；Transition 与三个 guard 通过；全量首跑 761/0；status-json-freeze 仍失败且 UTF-8 日志哈希 6f94e9c9… 不变；15 套 Node 全绿；全新一次性 Chrome 真实 IndexedDB 33/33、HTTP 零请求。实机全部未验，未部署、未写属主数据、未提交推送。报告：.agent/evidence/TASK-20260928-SOLO-SHOW-REPAIR/rework-r4-id-20260929/RESULTS.md。唯一下一步：任务 §13 新独立验收，未派发；scripts/check-workflow.js --next 输出完整提示词。以下为历史记录。

---

# 历史：新独立验收完成，R4-ID 一项退回（2026-09-29 UTC）

R1/R2、R3-EX、R4-SEG、R4-COUNT通过离线复验；R4-ID仍有P2：技能身份字段为数组时被String转换接受，三个反例已在一次性Chrome真实IndexedDB保存并刷新重开。产品和原测试未改。隔离重建、94项专项、66项独立探针、5项跨层转换、15套Node、28项原浏览器检查通过；全量首跑760/1保留Stopwatch失败，复跑761/0；freeze旧失败哈希不变。实机全部未验。报告：.agent/evidence/TASK-20260928-SOLO-SHOW-REPAIR/review-r3-r4-final-20260929/REVIEW.md。下一步仅待属主授权R4-ID字段格式有界返工，任务§12，未派发；scripts/check-workflow.js --next输出完整提示词。本轮验收结束，以下为历史记录。

---

# 2026-09-29 UTC 单人整场 R3/R4 再返工：实施与自测完成，待独立验收

属主已明确授权。本轮修复活动异常归属、技能回执缺身份、声明路径段缺报告、部分分发计数矛盾四项；失败保留登记时刻，未知归属不猜测，未开始段不伪造观测。R1/R2防线及去重范围保留。隔离Release重建、solo-show94/94、Transition与三个guard、15套Node通过；全量首跑760/1保留Stopwatch抖动，复跑761/0；Chrome真实IndexedDB合成保存重开28/28，HTTP阻断。旧freeze仍失败且哈希不变。实机全部未验，未部署、未写属主数据。报告：.agent/evidence/TASK-20260928-SOLO-SHOW-REPAIR/rework-r3-r4-20260929/RESULTS.md。唯一下一步：任务§11新独立验收，未派发；scripts/check-workflow.js --next 输出提示词。以下为历史记录。

---

# 2026-09-29 UTC 单人整场返工后独立验收：R3/R4 再退回

R1/R2通过离线复验；R3活动抛异常仍未落入事件结果，R4仍漏校验技能身份缺失、路径段缺失和部分分发矛盾，四个P2子项待授权有界返工。产品和原测试未改；隔离构建、66项专项、761项全量、15套Node、20项真实浏览器合成保存通过；旧冻结失败字节不变。全部实机证据仍BLOCKED。报告：.agent/evidence/TASK-20260928-SOLO-SHOW-REPAIR/review-r1-r4-20260929/REVIEW.md。下一步索引指向任务§10，未派发；scripts/check-workflow.js --next 可输出完整提示词。以下为历史记录。

---

# 2026-09-28 单人整场 R1–R4 有界返工：已实施＋自测，待新一轮独立验收

独立验收退回的四项已做最小修复并自测：R1 旧无身份停止不再影响带装载归属的场次（定向停止与游戏内 /choreo stop 保留）；R2 一次确认被 Arm 消费后仍有开演前上下文见证，改站位/模式/键位/登记即失效（回旧站位不恢复），预约与执行接管前都复核；R3 朝向等活动更新失败绑定到该事件结果（保留登记时刻，不声称效果）；R4 保存前校验逐事件/分段/技能身份与完整性，缺失证据标为「证据缺失（效果未知）」而不是伪造未分发；同来源不同 startId 去重反例仅确认为覆盖缺口（生产不可达），未扩大范围。验证：隔离 Release 强制重建 exit 0；solo-show 66/66；Transition 与三个 guard 用例通过；全量 761/0（首跑 760/1 为保留的既有 Stopwatch 抖动）；15 套 Node 全绿；隔离 Chrome 真实 IndexedDB 合成两场保存重开＋浏览器内 R4 反例 20/20、HTTP 零响应；status-json-freeze 仍失败且与基线逐字节相同。HEAD e795d84 未动、porcelain 998→1001 恰三行、178 份原始脏字节零改动；未部署、未输入游戏、未提交推送。证据：.agent/evidence/TASK-20260928-SOLO-SHOW-REPAIR/rework-20260928/RESULTS.md。下一步：把任务 §9 提示词复制到 fresh 只读会话做返工后独立验收（未派发）；实机 HTTP/native、身体转身、技能效果、物理释放与实机两场仍 BLOCKED。以下为历史记录。

---

# 2026-09-28 单人整场独立验收：退回返工

发现 4 项：旧停止请求会影响新场、就绪后映射变化未失效、朝向运行失败未落到事件结果、保存未校验完整事件身份。产品和原测试未修改；隔离构建/回归/合成保存通过仅接受对应离线层，实机全部待验。报告：.agent/evidence/TASK-20260928-SOLO-SHOW-REPAIR/independent-review/REVIEW.md。下一步为 R1–R4 有界返工，未派发；当前提示词见 scripts/check-workflow.js --next。以下旧状态保留为历史。

---

# 2026-09-28 单人整场最小修复：已实施自测，待独立验收

六项修复及属主追加授权的路径外原生朝向适配已落地；隔离构建、35 项针对性检查、761 项数据测试、15 套网页回归及 14 项隔离浏览器合成保存检查通过。旧 JSON 冻结失败原样保留；未部署、未输入游戏，不宣称整场实机可用。下一步仅独立验收，实机正常/接管两场保存重开待另行授权。合同：.agent/tasks/TASK-20260928-SOLO-SHOW-REPAIR.md；证据：.agent/evidence/TASK-20260928-SOLO-SHOW-REPAIR/RESULTS.md。当前交接以 scripts/check-workflow.js --next 为准，以下旧项目中心记录保留为历史。

---

# ChoreoHelper 进度

> 从这里看当前工作。任务合同保存详细需求与证据，本页只显示摘要和入口。
> 当前流程以 [AI-WORKFLOW](docs/AI-WORKFLOW.md) 为准：明确本批结果 → 实施与实测 → 新会话独立复验 → 给出完整下一步提示词。
> 这是执行者维护的进度表，不是自动监控；更新时间不证明另一个模型仍在运行。

**WP-3 现状对齐验证批已实施＋自测（2026-09-28，待独立复验）**：属主 2026-09-28 点名的 WP-3 v0.7 项目中心与编辑基础经开工审计确认**范围已于 2026-08-29 交付并验收、在当前恢复后的树上全部在位**（SPEC 记载 WP-3a/b；[审计表](.agent/evidence/TASK-20260928-WP3-PROJECT-CENTER/audit-map.md) 11 项→file:line＋UI 入口）——本批为现状对齐验证批，**产品与既有测试字节零改动**（14 件对拍零漂移）。新探针 [test-wp3-browser.js](web/test-wp3-browser.js) 真实 Chrome file://＋一次性 profile＋HTTP 全阻断 **51/51 ×2 连续绿**：旧草稿无损迁移＋逐字节备份＋重开不复迁、项目中心新建/改名/复制/删除/最近/删当前自动切换/tombstone 拦复活、版本快照与恢复（恢复前自动存档）、崩溃余态按镜像恢复＋「异常关闭自动恢复」版本＋**真实 taskkill 硬杀后最新编辑仍在**、撤销重做/多选/框选/复制粘贴/整组平移/对齐/插删时间/A-B 循环/段落标记/独奏静音真实交互。Node 回归 52 套件绿（test-projects 96/0）；6 处既有红登记不修（test-edit 夹具 ENOENT、design-tokens P4-AC-1、stage 四件恢复批受损遗留）。HEAD e795d84 未动、porcelain 975→977 恰写域。**唯一下一步＝属主把 [合同 §7](.agent/tasks/TASK-20260928-WP3-PROJECT-CENTER.md) 独立复验提示词复制到 fresh 只读会话（technical 级，未派发）；PASS 后关账并决定后续（WP-4 体检或另点名）**。

**发布收口 P2 批已关账（2026-09-28 属主确认）**：Phase C 独立复验全 PASS 后属主关账——fresh 只读会话逐 AC 亲自取证 8/8 PASS、零返工单（[复验报告](.agent/evidence/TASK-20260927-RELEASE-P2/phase-c-reverify-20260928/REPORT.md)）：①csproj 恰一行差异复算＋门禁复跑 39/39＋四类演练 RESULT/PNG 点验＋三份文档哈希相符；②包验证自研复算 33/33＋System32 bsdtar 独立解包对拍 6/6；③B3 演练点验 10/10＋独立复跑 10/10 exit 0；④三快照四位置复算一致（catalog `b8b7c74e…`/skeleton `d1aa08f7…`/standin `f73dfba4…`）；⑤HEAD `e795d84` 未动、porcelain 与对拍源逐行一致、src/bin+obj 不在。登记保留：F-B1＝csproj 缺 make-release-staging.js:14 注释所述 Release PathMap（本批以构建命令行 -p:PathMap 等价物过隐私门、csproj 零改动；是否永久写进 csproj＝属主拍板，若做需另立微批）；O-C1/O-C2/O-C3＝复验报告登记不修单，无需动作。当前无已授权后续工作，唯一下一步＝属主在①暂缓／②点名新工作（③ F-B1 微批）之间决定后，把合同 §9 提示词复制到 fresh 记录会话登记（未派发）。

## 进度快照（2026-09-27 发布收口 P2 已立批，待派发）

- 合同§13已独立执行，R1有界PASS；属主已在§14明确决定：接受 T09 原始修前证据缺失与 AC-A2 历史证明不足为登记限制，作有界关账（[关账记录](.agent/evidence/TASK-20260926-WEB-REWORK-FIX/closeout-20260926/CLOSEOUT.md)）。属主 2026-09-27 在§15选择②点名新工作＝发布收口 P2 批（新合同已立，见上行）。

- 属主 2026-09-26 选②点名新工作＝**网页整改清单勾选开修**（[任务 §10](.agent/tasks/TASK-20260926-TEST-REDS-FIX.md) 登记）：按走查批 23 条清单（0 阻流/5 明显/18 细节）勾选开修；清单资产已被 09-26 磁盘清理删除且不在 git，恢复方案已只读实测可行（INVENTORY.md 终版 229 行可从会话库提取 sha256 `4a9369ad…`、REPORT.md 可重建、截图不可恢复；[决定证据](.agent/evidence/TASK-20260926-TEST-REDS-FIX/decision-20260926/DECISION.md)＋恢复配方）。~~唯一下一步＝属主把合同 §11 立批＋恢复提示词复制到 fresh 会话~~（已消耗：新合同已立、清单已恢复，见上行）。

- P1 已关账（独立复验 PASS：AC1–AC3 全 PASS）；G6 拍板＝③维持现状禁 push，无 .gitignore/索引改动。
- **插件 C# 恢复批已关账（2026-09-25 属主确认）**：独立技术复验（[报告](.agent/evidence/TASK-20260925-PLUGIN-CS-RECOVERY/reverify-20260925/REPORT.md)）AC1–AC3 亲自复现 PASS——隔离 Release 构建 exit 0 零错误、datalayertest 构建 exit 0（NETSDK1022 消失）、测试套 756 pass/5 fail（5 红登记不修）、porcelain 290 与交付 after 逐行一致、web/ 与 live 根零改动、HEAD 未动；复验缺陷 D1/D3 经属主「先修复」在记录层更正（[更正记录](.agent/evidence/TASK-20260925-PLUGIN-CS-RECOVERY/reverify-20260925/CORRECTIONS.md)，产品/测试零字节改动），D2/D4/D5 为登记限制；R4 未做。关账证据 [closeout-20260925](.agent/evidence/TASK-20260925-PLUGIN-CS-RECOVERY/closeout-20260925/CLOSEOUT.md)。
- 已消耗（历史，2026-09-26）：属主已选①＝授权修复批（任务 §7 登记；仅测试侧、须另立合同）：把任务 §8 修复批提示词复制到 fresh 会话先立修复合同再逐红修测试期望（推荐 GLM-5.3-Flash，未派发）；交付后另派 fresh 会话独立复验。
- 测试五红修复批已实施＋自测（2026-09-26，合同 [TASK-20260926-TEST-REDS-FIX](.agent/tasks/TASK-20260926-TEST-REDS-FIX.md) v1）：仅测试侧两文件（R1/R2 整灭点 1048576.0、R3/R4 二进制精确边界 {0.5}/1.0/0.5、R5 StopCalls==2 且仍 Faulted 零分发；断言名逐字节未动，Check( 542 不变）；仓库外构建 exit 0 零错误、完整套件 761/0 exit 0（首跑 760/1 系无关既有抖动 Program.cs:372 Stopwatch 断言，未动，详见证据）；产品字节零改动、仓库无 bin/obj、HEAD 未动。证据 [fix-20260926](.agent/evidence/TASK-20260926-TEST-REDS-FIX/fix-20260926/RESULTS.md)。**独立复验 PASS（2026-09-26，[报告](.agent/evidence/TASK-20260926-TEST-REDS-FIX/reverify-20260926/REPORT.md)）**：开工态↔交付态 diff 恰为五红 hunk、仓库外重建套件 761/0 exit 0 ×3、五红断言名逐条 OK、零产品漂移、HEAD 未动；登记不修＝修复批记录「porcelain 956→957」实为 958（增量恰为写域两行）。**已关账（2026-09-26 属主确认，任务 §8 登记，[关账证据](.agent/evidence/TASK-20260926-TEST-REDS-FIX/closeout-20260926/CLOSEOUT.md)）**；§9 已消耗：属主选②点名新工作（见上行）。新登记（关账会话，记录层）：复验交付 NEXT-ACTION 指纹滞后——复验日志验证的 §7 与交付 §7 差一字符（`scripts\check-workflow.js`→`scripts/check-workflow.js`）未重算，交付最终字节上 `check-workflow --next` 本会报「提示词已变化」；关账已以 §9 新索引取代，无产品影响。
- 测试五红诊断批已交付（合同 [TASK-20260925-TEST-REDS-DIAGNOSIS](.agent/tasks/TASK-20260925-TEST-REDS-DIAGNOSIS.md) v1 §7；[REPORT](.agent/evidence/TASK-20260925-TEST-REDS-DIAGNOSIS/diag-20260926/REPORT.md)）；属主 2026-09-26 选定①授权修复批并同意重落盘报告（报告已从会话库恢复重落盘，其余被清理删除的证据保持删除；磁盘清理 porcelain 292→955，零 src/ 删除）。诊断批 §8 提示词已消耗，修复批见上条。
- 其余：旧音乐 integrity 维持 FAIL；P2、游戏数据/XAT 再分发均未启动。

## 现在先看这里（2026-09-25 P1 批已实施待复验）

- 当前交付：TASK-20260925-RELEASE-P1 已实施＋自测（[RESULTS](.agent/evidence/TASK-20260925-RELEASE-P1/impl-20260925/RESULTS.md)）：G5 完成——根目录新增 [LICENSE](LICENSE)（sha256 4764640a…）与 [THIRD-PARTY-NOTICE.md](THIRD-PARTY-NOTICE.md)（976664c3…）：three.js r160 MIT 归属＋GLTFLoader 等三件相对导入改写副本说明＋gzip 浏览器原生＋C# 零 NuGet；游戏衍生数据与 XAT 只描述来源不作法务断言，姿态不变。
- G7 按合同走删除路径：恢复接线不可行——隔离 Release 构建（仓库外拷贝树）实证 src/ **8 文件语法截断**（Plugin.cs 70 行截断自 09-20 恢复快照即存在）＋X1GameInputSnapshot 类型缺失＋datalayertest.csproj 重复 Compile 项。已删零非测试调用死码 src/WebEntry.cs，把 docs/WORK-INSTALL-STARTUP.md（时效更正块）与 staging README 模板三处（/choreo web、/choreo pair 用户指引）改为「手动双击 dist\ChoreoHelper\choreo-helper-app.html＋配对暂不可用」的如实说明；分歧与恢复线索（D:\choreo\ui-workspace-20260916 完整 415 行 Plugin.cs 可作捐赠源）已登记（RESULTS §2 F1–F6）。
- G6 只交方案未执行：[G6-POSTURE-PLAN.md](.agent/evidence/TASK-20260925-RELEASE-P1/impl-20260925/G6-POSTURE-PLAN.md)＝.agent/（1080 追踪件）＋.recovery-notes/＋19 件根调试件的忽略清单＋git rm --cached 方案＋历史 blob 后果（未来提交安全 vs 本地历史仍在）三个拍板项；.gitignore/git 索引零改动。
- 自测：test-release-gates.js **39/39** exit 0；src 非测试代码 WebEntry 引用 0；porcelain 224＝基线 219＋恰 5 行写域增量（D src/WebEntry.cs、M 两处指引、?? LICENSE、?? THIRD-PARTY-NOTICE.md、?? 本批 evidence 目录）；未打包、未安装、未动游戏、未提交推送。
- 下一步：属主把 [TASK-20260925-RELEASE-P1](.agent/tasks/TASK-20260925-RELEASE-P1.md) §6 独立复验提示词复制到 fresh 会话复验（GLM-5.3-Flash 足够）；PASS 后关账，并拍板 G6 方案与是否立「插件 C# 恢复批」。
- 遗留单列：旧音乐 integrity 仍因 pipeline-cli.js:809/812 重复 `const result` 失败，不复活旧管线。P2（升级路径、全新机器演练、属主备份文档、过期清单）待后续；游戏数据/XAT 再分发＝属主法务决定。

## 现在先看这里（2026-09-25 P0 修复批已关账＋P1 已另立批）

- 当前交付：TASK-20260925-PROJECT-REMEDIATION §7 只读审计（[审计报告](.agent/evidence/TASK-20260925-PROJECT-REMEDIATION/release-audit-20260925/REPORT.md)）→ 属主拍板「按你推荐的拍板」→ §8 P0 修复批已实施并自测（[交付报告](.agent/evidence/TASK-20260925-PROJECT-REMEDIATION/p0-fix-20260925/RESULTS.md)）；独立复验五项全 PASS（39/39＋15/15 与交付日志逐行一致，porcelain 218 行一致，独立抽查 4/4），返工单 R-1（FORBIDDEN 计数 11→17 笔误→12→18，零功能影响）已更正，**属主已确认关账**。
- P0 四项已修：①私人模型字节 web/live-era/model.bin 已移出 git 索引（.gitignore 增补＋git rm --cached；文件仍在硬盘 sha256 3e3744e7…，历史未动、未提交——将来推送前这步已就位）；②打包白名单补齐 workbench/retarget/import 三件（html 75 个本地 script 引用现全部覆盖）；③web/model-standin.gltf 替身源已恢复（9f416267… 逐字节）；④隐私扫描补 D:\choreo 路径＋FORBIDDEN 补 6 名。
- 自测与复验：test-release-gates.js **39/39**、只读对拍探针 **15/15** 全 exit 0（复验重跑与交付日志逐行一致）；porcelain 218 行与 after-porcelain 逐行一致；未打包、未安装、未动游戏、未提交推送。
- 下一步：P1 批新合同 [TASK-20260925-RELEASE-P1](.agent/tasks/TASK-20260925-RELEASE-P1.md) §4 实施提示词复制到 fresh 会话实施（未派发；G5 声明文件＋G7 /choreo web 接线，G6 只给方案不执行，游戏数据/XAT 法务姿态除外）。
- 遗留单列：旧音乐 integrity 仍因 pipeline-cli.js:809/812 重复 `const result` 失败，不复活旧管线。P2（升级路径、全新机器演练、属主备份文档、过期清单）待后续；游戏数据/XAT 再分发＝属主法务决定。

## 现在先看这里（2026-09-25 本轮本地修复完成）

- 当前交付：[PROJECT-REMEDIATION / v1](.agent/tasks/TASK-20260925-PROJECT-REMEDIATION.md)，[总报告](.agent/evidence/TASK-20260925-PROJECT-REMEDIATION/REPORT.md)。7路子 agent 已完成分工、返工与交叉复验，AC1–AC7 有界技术通过；不等于整体产品、属主或实播验收。
- 做成了：23项旧清单逐条处置，项目关闭与迟到结果、无效间隔、检查误停、资源入口和窄屏修复；4项动作包算法缺陷修复；2243条真实离线技能可添加保存重开；技能空引导和底栏漏计已补修。
- 已验证：普通网页旅程87/87，项目/音乐浏览器22/22，动作包完整71/71与最终布局14/14，技能浏览器12/12及空状态/计数独立补验；最终音乐项目竞态23/23。各次受测字节与层级分别记录，不能简单相加。
- 规则：锁定只保护已有技能内容，允许另建未锁轨；兼容性门禁、毫秒精度和真实执行许可保留。
- 遗留边界：历史 pipeline-cli.js 重复声明使旧音乐 integrity 仍失败，未把当前检查冒充等价替代。真实游戏、双人物效果、音乐听感及 live 部署按属主决定以后再验。
- 下一步建议：本地发布准备审计（不发布、不安装，未派发）。完整建议由 scripts/check-workflow.js --next 输出；本轮无待属主重复批准的必要返工。
- 每日 file:// 仓库 dist 已同步，刷新即可加载。未操作游戏、写外部 live 根或提交推送。

## 当前任务

| 任务 | 阶段 | 已实现 / 自测通过 / 独立验收通过 | 更新时间 | 下一步 |
|---|---|---|---|---|
| [项目方案核查与并行修复](.agent/tasks/TASK-20260925-PROJECT-REMEDIATION.md) | 本地闭环完成，真实验收延期；§7 审计交付→属主拍板→§8 P0 修复批独立复验 PASS、R-1 更正，**已关账（2026-09-25 属主确认）** | AC1–AC7 有界技术通过；旧管线排除见总报告 | 2026-09-25 | P0 修复批复验通过（[报告](.agent/evidence/TASK-20260925-PROJECT-REMEDIATION/p0-fix-20260925/RESULTS.md)：39/39＋15/15 与交付日志逐行一致，porcelain 218 行一致；R-1 FORBIDDEN 12→18 已更正）。已关账；唯一下一步＝P1 批（[新合同](.agent/tasks/TASK-20260925-RELEASE-P1.md) §4 实施提示词，未派发）。 |
| [插件 C# 源码恢复批（F1–F6 收口）](.agent/tasks/TASK-20260925-PLUGIN-CS-RECOVERY.md) | **已关账（2026-09-25 属主确认：独立复验 AC1–AC3 亲自复现 PASS；D1/D3 复验后记录层更正；D2/D4/D5 登记限制）** | 3/3 · 3/3 · 3/3 | 2026-09-25 | 8 文件恢复＋ShowRunner 等捐赠件＋R2/R3 收口；隔离 Release 构建 exit 0 零错误、datalayertest 构建 exit 0（NETSDK1022 消失）、测试套 756 通过/5 失败（5 红登记不修）、porcelain 290 零漂移、HEAD e795d84 未动；证据 [复验报告](.agent/evidence/TASK-20260925-PLUGIN-CS-RECOVERY/reverify-20260925/REPORT.md)、[关账记录](.agent/evidence/TASK-20260925-PLUGIN-CS-RECOVERY/closeout-20260925/CLOSEOUT.md)。已关账；属主 2026-09-25 已选②＝测试五红诊断批（任务 §8 登记；只诊断不修，修复未授权）；唯一下一步＝任务 §8 诊断批提示词（已消耗，诊断批见下行）。 |
| [网页整改清单修复](.agent/tasks/TASK-20260926-WEB-REWORK-FIX.md) | **已关账（有界，2026-09-26 属主明确决定；T09/AC-A2 登记限制保留）** | AC-A1 PASS；AC-B1/B2/B3 与 AC-C 为 R1 有界 PASS；AC-A2 BLOCKED（历史证明不足）经属主接受为登记限制 | 2026-09-26 | 属主选择在保留 T09 原始修前证据缺失与 AC-A2 历史证明不足的前提下有界关账；R1 四位置单 JS 同哈希 09665b56…、两份外部备份在案、2136 份旧证据零漂移；17 条未复现项未改；旧 PC-2 同红不修。属主 2026-09-27 选择②点名新工作＝发布收口 P2 批（新合同 TASK-20260927-RELEASE-P2 已立）。 |
| [发布收口 P2：本地出包与升级/恢复演练](.agent/tasks/TASK-20260927-RELEASE-P2.md) | **已关账（2026-09-28 属主确认；Phase C 独立复验全 PASS 后关账）** | A1–A5＋B0–B4 复验全 PASS（零返工单；含 B3 复跑 10/10 与包验证自研复算 33/33）；F-B1 登记保留 | 2026-09-28 | 已关账；登记保留：F-B1＝csproj 缺 make-release-staging.js:14 所述 Release PathMap（命令行等价物已过隐私门、csproj 零改动；永久化＝属主拍板，若做另立微批）＋O-C1/O-C2/O-C3（复验报告登记不修）。属主 2026-09-28 选②点名新工作＝WP-3 v0.7 项目中心与编辑基础；唯一下一步＝把 [合同 §10](.agent/tasks/TASK-20260927-RELEASE-P2.md) 立批提示词复制到 fresh 会话先立新合同再实施（未派发）。 |
| [测试五红修复批（仅测试侧对齐期望）](.agent/tasks/TASK-20260926-TEST-REDS-FIX.md) | **已关账（2026-09-26 属主确认；独立复验 AC1–AC3 PASS 后登记）** | 3/3 · 3/3 · 3/3（独立复验 AC1–AC3 PASS） | 2026-09-26 | R1/R2（Program.cs:369/434）12.1 天点→整灭点 1048576.0（探针实证 ==0f）＋档位注释更正，仍锁老 bug 成因；R3/R4（:388/452）改二进制精确边界 {0.5}/1.0/window 0.5（探针对照实证通过），仍验边界入选语义；R5（ShowGuardAvailabilityTests.cs:137-138）改显式重试复调 StopCalls==2＋StopCleanupRuns==2，保留 State==Faulted 与零分发；断言名逐字节未动、Check( 542 不变、无删项。独立复验（[报告](.agent/evidence/TASK-20260926-TEST-REDS-FIX/reverify-20260926/REPORT.md)）：开工态↔交付态 diff 恰五红 hunk、仓库外重建套件 761/0 exit 0 ×3、五红断言逐条 OK、零漂移、HEAD e795d84 未动；登记＝修复批 porcelain 记录 956→957 实为 958 笔误不修。**已关账（2026-09-26 属主确认，[关账证据](.agent/evidence/TASK-20260926-TEST-REDS-FIX/closeout-20260926/CLOSEOUT.md)）**；属主已选②点名新工作＝网页整改清单勾选开修（§10 登记）；§11 提示词已消耗——新合同已立、清单已恢复（见上行）。 |
| [测试五红诊断批（只读诊断出报告）](.agent/tasks/TASK-20260925-TEST-REDS-DIAGNOSIS.md) | **已交付；属主 2026-09-26 选定①授权修复批（修复批已另立合同实施，见上行）** | 3/3 · 3/3 · 0/3 | 2026-09-26 | 五红逐条诊断：R1/R2 float（Program.cs:369/434，1043280 差一档 ULP 得 0.0625）、R3/R4 参考帧边界（Program.cs:388/452，0.5-0.4<0.1 二进制）、R5 cancel-OnStop（ShowGuardAvailabilityTests.cs:137-138，显式重试复调 OnStop 致 StopCalls 1→2，C# 探针子句级证实）；结论均为测试期望错误、各自独立；证据 [诊断报告](.agent/evidence/TASK-20260925-TEST-REDS-DIAGNOSIS/diag-20260926/REPORT.md)（逐节＋总表＋三探针＋复现日志）。零产品/测试改动（Check( 542＝542，756/5 不变，无 bin/obj，HEAD 未动）。属主 2026-09-26 已选①授权修复批＋同意重落盘报告（§7 登记；报告已从会话库恢复重落盘，其余被清理删除的证据保持删除）；修复批已另立合同实施（见下行），本行 §8 提示词已消耗。 |
| [发布准备 P1（声明文件＋/choreo web 接线）](.agent/tasks/TASK-20260925-RELEASE-P1.md) | **已关账（2026-09-25 属主授权关账会话：独立复验 PASS 成立＋G6 拍板③维持现状禁 push）** | 3/3 · 3/3 · 3/3（独立复验 AC1–AC3＋写域全 PASS、零返工单；关账会话独立复核成立） | 2026-09-25 | G5 两件声明文件落盘（LICENSE 4764640a…/NOTICE 976664c3…）；G7 走删除路径（删 src/WebEntry.cs＋两处指引如实修正，F1–F6 登记转恢复批）；G6 拍板③（方案文件留作将来发布批强制前置输入）。已关账；唯一下一步＝插件 C# 恢复批（[新合同](.agent/tasks/TASK-20260925-PLUGIN-CS-RECOVERY.md) §4 实施提示词，未派发）。 |
| [当前流程修复 r1](.agent/tasks/TASK-20260922-WORKFLOW-REPAIR.md) | **已关账（2026-09-24）**：AC5 有界记录依属主 2026-09-23 决定修订范围，解除 BLOCKED 为 PASS（scoped）（接受历史残余不确定性；6 份工作流文档受保护；历史证据不改写）；全链闭环 | AC1–AC4 独立通过；R1-E03-COUNT 更正独立核对通过；AC5 scoped 记录经本会话全树差集核验 | 2026-09-24 +08:00 | 已关账；唯一下一步＝属主从「WORKFLOW-REPAIR 关账后属主决定提示词」选择（整体试用／下一批／暂缓）。 |
| [通用动作包：当前代码复核后的 r2 合同](.agent/tasks/TASK-20260918-ANIM-PACK-UNIVERSAL-r2.md) | **AC8 实播两次尝试（2026-09-24）均停于属主可用性并如实记录；AC1–AC7 独立通过；AC8 维持 BLOCKED** | r2：7/8 · 7/8 · 7/8（AC1–AC7 PASS；AC8 BLOCKED） | 2026-09-24 +08:00 | 两次尝试均零导入/零播放/零截图（非产品缺陷）；开工/收尾共三次复核包哈希 `7cbf12af…bad77a`（run1/run2）与清单 `5921ebc1…a96b9` 一致；记录 [ac8-run-20260924](D:/choreo/anim-pack-r2-ac8-run-20260924/README.md)（第 1 次旧件＋第 2 次重试 retry-* 件，互不覆盖）。下一步＝属主有空时照任务内「AC8 实播引导提示词」＋AC8-PREP.md §4 补做实播，全部符合后 fresh 会话独立复验判 AC8；AC8 两次停止后属主 2026-09-24 改选下一开发＝R-1 探针修复批（另立 TASK-20260924-R1-FJ06-PROBE，见顶部块）。历史：返工 2 轮独立复验 7/8、AC3/4/5 升 PASS、写域差异 PASS，历史 live/ignored 全量认证因缺旧基线 BLOCKED（SCOPE-02）；P5 暂停。 |
| [协作规则简化](.agent/tasks/TASK-20260916-COLLABORATION.md) | 自测中 | 5/5 · 0/5 · 0/5 | 2026-09-16 14:50 +08:00 | 检查入口一致性、模板和旧文件保护 |
| [简洁编舞 P0 工程核实](.agent/tasks/TASK-20260916-SIMPLE-CHOREO-P0.md) | 待验收 | 7/7 · 7/7 · 0/7 | 2026-09-16 15:40 +08:00 | Codex 独立验收；[P0 报告](docs/P0-SURVEY-20260916-SIMPLE-CHOREOGRAPHY.md) |
| [简洁编舞 P1-A 资源关系解析器](.agent/tasks/TASK-20260916-SIMPLE-CHOREO-P1A.md) | 待实施（合同待核对） | 0/5 · 0/5 · 0/5 | 2026-09-16 15:40 +08:00 | Codex 核对合同后派发 GLM |
| [界面与操作逻辑全面回炉重做（首看可懂）](.agent/tasks/TASK-20260919-UI-OVERHAUL.md) | **已收口（2026-09-23 属主「先关账吧」确认：B1–B10 十批＋总验收 PASS 一并关账）** | 总验收 46/46 全 PASS、零 FAIL/BLOCKED、run11≡run12、四类计数 nav57/select70/numeric33/safety29、正确性四项 PASS、四根全哈希＋28 锚点保持、产品零改动（[总验收报告](.agent/evidence/TASK-20260919-UI-OVERHAUL/overall-acceptance-20260923/REPORT.md)）；关账会话 12 项只读复核零不一致（[关账证据](.agent/evidence/TASK-20260919-UI-OVERHAUL/overall-acceptance-closeout-20260923/CLOSEOUT.md)）；O-1–O-7 非缺陷观察留档 | 2026-09-23 +08:00 | 已收口；收口后属主「B」＝安排下一批 → B-SPATIAL-1 评估已另立任务；整体试用维持「暂不开始」。 |
| [整组空间变换＋旧浮窗 +Z 立项评估](.agent/tasks/TASK-20260923-B-SPATIAL-1.md) | **已收口（2026-09-23 属主拍板「1 修」「2 按推荐」＝验收）** | 3/3 · 3/3 · 3/3（属主直接审阅拍板）；实施批 B-SPATIAL-2 已另立 | 2026-09-23 +08:00 | 已收口；唯一下一步＝派发 B-SPATIAL-2 实施提示词。 |
| [旧浮窗 +Z 翻转对齐＋整组空间变换实施](.agent/tasks/TASK-20260923-B-SPATIAL-2.md) | **已关账（2026-09-24 属主确认：短复验五点全 PASS、REV-BS2-01/02 关闭）** | 3/3 · 3/3 · 3/3 | 2026-09-24 +08:00 | 已关账；属主 2026-09-24 决定：先不试用，修 O-1–O-7（新批 OBS-FIX），修完接 AC5 有界记录。 |
| [总验收观察 O-1–O-7 小问题修复](.agent/tasks/TASK-20260924-OBS-FIX.md) | **已关账（2026-09-24 属主确认：独立复验 8/8 全 PASS，零返工）** | 8/8 · 8/8 · 8/8 | 2026-09-24 +08:00 | 已关账；唯一下一步＝接续执行 TASK-20260922-WORKFLOW-REPAIR AC5 有界记录。 |
| [已登记小尾巴修复批（LOOSE-ENDS）](.agent/tasks/TASK-20260924-LOOSE-ENDS.md) | **已关账（2026-09-24 属主确认：独立复验逐项验证 6/6 PASS、零返工单）** | 5/5 · 5/5 · 5/5 | 2026-09-24 +08:00 | 三项小尾巴已清：①旧数字标记 id 归一位置无关化（mk-<原数字>，界面无可见变化）；②替身时间线维持现状（行为零改动，新浏览器探针 18/18 ×3 逐字相同钉住＋面板说明补导入模型指引）；③once intro 夹取加固（scrubTo animDur 统一，防御性）。四位置 4b429e8c/d24c2381/0caccb72 一致＋6 live 备份；25＋4 node 回归 count-for-count 全绿、9 探针全绿（FJ-06 journey 一处既有红已登记 R-1，与本批无关有 before 同红实证）。报告＝[复验报告](.agent/evidence/TASK-20260924-LOOSE-ENDS/reverify-20260924/REPORT.md)（四位置终值 12/12、登记不修 O-RV-1..3＋R-1/R-2）。已关账；属主 2026-09-24 已选 ① AC8 实播（登记见任务文件 §10＋[决定证据](.agent/evidence/TASK-20260924-LOOSE-ENDS/decision-20260924/DECISION.md)）；AC8 两次尝试均停于属主可用性（2026-09-24），属主同日改选其未选候选 ② 授权修 R-1＝已另立 [TASK-20260924-R1-FJ06-PROBE](.agent/tasks/TASK-20260924-R1-FJ06-PROBE.md)（见顶部块）。 |
| [R-1 探针既有红修复（FJ-06 journey）](.agent/tasks/TASK-20260924-R1-FJ06-PROBE.md) | **已关账（2026-09-24 属主确认：独立复验 6/6 PASS、零返工）** | 4/4 · 4/4 · 4/4 | 2026-09-25 +08:00 | 独立复验（fresh 会话 ZCode/GLM-5.3-Flash 实跑复现）六项 6/6 PASS、零返工单，属主 2026-09-24 确认关账。实施模型 opencode/deepseek-v4.1-flash（合同推荐 GLM-5.3-Flash 或 GLM-5.3，实际不同，如实登记）：FJ-05 单行对齐（旧子串「重新选点后已恢复默认用时，请核对」→现行文案「米；已保留用时与到达时刻。」，标签同步；`choreo-stage-motion-ui.js:291` 源=dist 同文案）；红回放 exit 1（累计 50 检查 49/1，恰 FJ-05）→修复后完整套件 **87/87 exit 0 ×3 逐字节相同**（50 为红点累计断点数的事实更正已登记）；FJ-06 预览段首次运行全绿 6/6；node 旅程 39/0；产品六件零漂移；git 状态逐行零差；test-workflow 14/14＋check-workflow --next exit 0。证据 [复验报告](.agent/evidence/TASK-20260924-R1-FJ06-PROBE/reverify-20260924/REPORT.md)、[关账记录](.agent/evidence/TASK-20260924-R1-FJ06-PROBE/closeout-20260925/CLOSEOUT.md)、[impl-20260925](.agent/evidence/TASK-20260924-R1-FJ06-PROBE/impl-20260925/RESULTS.md)。已关账；唯一下一步＝属主有空时按 [r2 任务内「AC8 实播引导提示词」](.agent/tasks/TASK-20260918-ANIM-PACK-UNIVERSAL-r2.md)＋AC8-PREP.md §4 补做实播（AC8 两次尝试均停于属主可用性）；若想先选新开发，可另行指派。 |
| [网页整改走查批（文字／UI／逻辑链）](.agent/tasks/TASK-20260925-WEB-REWORK-AUDIT.md) | **走查已交付；属主 2026-09-26 跳过独立复验、直接点名开修（清单资产已被磁盘清理删除，待恢复）** | 5/5 · 5/5 · 0/5（§6 独立复验未执行，属主直接开修） | 2026-09-26 | 真实走查 13 轮（88 截图/162 JSON，零异常零请求）：23 条（0 阻流/5 明显/18 细节）；主链走通、断点在离线技能链＋开箱红。清单原路径 `.agent/evidence/TASK-20260925-WEB-REWORK-AUDIT/audit-20260925/INVENTORY.md` 已被 09-26 磁盘清理删除且不在 git；恢复方案已只读实测可行（[配方](.agent/evidence/TASK-20260926-TEST-REDS-FIX/decision-20260926/DECISION.md)）。下一步＝按 [TEST-REDS-FIX §11](.agent/tasks/TASK-20260926-TEST-REDS-FIX.md) 立批＋恢复清单交属主勾选（未派发）。 |
每个执行者只更新自己的任务行。数量按合同 AC 统计，不是工时百分比。“已实现”不等于“已验收”。
阶段：待实施、实施中、自测中、待验收、返工中、阻塞、已验收、延期、已取消。

## 旧工作待接续核验

以下是 2026-09-16 从现有记录整理的接续入口，**未在本次复验产品行为，也不是全部历史任务清单**。
已保留的其他风险和尾项见 [.agent/CONTINUITY.md](.agent/CONTINUITY.md)。选中一项后核对实际文件和原合同，再建新任务；不要求把整个旧管线修绿。

| 工作 | 记录描述 / 本次未核验的边界 | 接续入口 |
|---|---|---|
| P1 动作执行证据 | 记录为已实现、待独立验收；旧 run 仍为 active，当前会话是否在运行未知 | [交付记录](docs/HANDOFF-20260916-exec-evidence-p1.md) |
| UI 改造 P4/P5 | 记录为实现与自测已做、验收和上线有缺口；P5 旧 run 仍为 active，当前执行状态未知 | [P5 交付记录](docs/HANDOFF-20260915-ui-p5-render-performance.md) |
| UI 安装后的实际效果 | 记录为文件已安装；游戏重载、视觉与帧率等实际结果仍待核验 | [安装记录](docs/HANDOFF-20260916-ui-install.md) |
| 单人/多人统一简洁编舞 | 已有方案，未在本次启动实现 | [产品方案](docs/PLAN-20260916-SIMPLE-CHOREOGRAPHY.md) |

## 怎么交接

- 讨论结束：Codex 按[任务模板](docs/templates/TASK-CONTRACT.md)生成合同和完整 GLM 提示词，用户直接复制。
- 实施期间：执行者在开工、发现问题、验证、阻塞与交接时用中文报告。
- 写完以后：GLM 提供完整独立验收提示词；用户在新的 Codex 会话粘贴。
- 验收未通过：Codex 给出可直接交回 GLM 的返工单，不让用户重新解释。

已有 GLM 会话需要收到下面这段切换通知；修改本地规则不会自动向其他工具发送消息：

```text
工程从 2026-09-16 起切换到“任务合同交接、逐项证据验收、里程碑进度公开”。请先在最近安全检查点保存当前进度，然后重新读取 D:\choreohelper\AGENTS.md、D:\choreohelper\docs\AI-WORKFLOW.md 和 D:\choreohelper\PROGRESS.md。
不要删除、改写或伪造关闭旧任务票、run、证据和已有代码。先报告当前任务、原合同/AC、实际已实现和已测试项、未完成项、占用文件和下一步；发现重叠实施者时停止重叠写入。
若当前任务尚无 .agent/tasks/TASK-*.md 合同，先依照 docs/templates/TASK-CONTRACT.md 整理一份接续草案并引用旧合同和证据，返回 Codex 核对需求后再继续依赖实现，不用重新修复旧管线或重复索要已有授权。已确认的新合同则直接按它执行。
实施期间维护任务文件和 PROGRESS.md 的本任务行，在领取、范围变化、首次失败证据、实现完成、检查完成、阻塞、交接等关键事件用中文报告进度（事件驱动，不按时间驱动）。完成只标记待验收，不自我批准；返回级别对应独立验收者（按 docs/AI-WORKFLOW.md 的风险级别选择）在新会话可直接使用的验收提示词。
```
