using System.Numerics;
using System.Diagnostics;
using System.Net;
using ChoreoHelper;
using ChoreoHelper.Exporter;

var pass = 0; var fail = 0;
void Check(string name, bool cond, string? detail = null)
{
    if (cond) { pass++; Console.WriteLine($"  OK  {name}"); }
    else { fail++; Console.WriteLine($"  FAIL {name} {detail}"); }
}

// 命名用例过滤（TASK-20260910-X1-OFFLINE-GUARD harness contract）：无参数=全量套件（原有
// 断言一条不删）；传用例名=只跑该节；--red=同一批断言、抑制 OK 逐条输出。--red 供
// record-red 在修复前记录红基线：失败打印哨兵行恰一次并退出 1。
var redMode = args.Contains("--red");
var namedCase = args.FirstOrDefault(a => !a.StartsWith("--"));
if(namedCase=="solo-show")return SoloShowRepairTests.Run();
if(namedCase=="x1-transition")return X1TransitionCases.RunNamed(namedCase,redMode);
if (namedCase != null)
    return ShowGuardAvailabilityCases.RunNamed(namedCase, redMode);

// ---- 1. AnimWriter.FromSamples → JSON 契约 ----
var rot = new Dictionary<string, List<(float T, Quaternion Q)>>
{
    ["n_spine"] = new() { (0f, Quaternion.Identity), (1f, Quaternion.CreateFromYawPitchRoll(0.1f, 0, 0)) }
};
var clip = AnimWriter.FromSamples("bow", 1.0f, "once", rot);
var json = AnimWriter.ToJson(clip);
Check("JSON 含 name", json.Contains("\"name\": \"bow\""));
Check("JSON 含 duration", json.Contains("\"duration\": 1"));
Check("JSON 含 type", json.Contains("\"type\": \"once\""));
Check("JSON 骨骼名 n_spine", json.Contains("n_spine"));

// 反序列化回对象验证字段可读（引擎消费端同路径）
var back = System.Text.Json.JsonSerializer.Deserialize<AnimClipData>(json, new System.Text.Json.JsonSerializerOptions { PropertyNameCaseInsensitive = true });
Check("反序列化成功", back != null && back!.name == "bow" && back!.duration == 1.0f && back!.bones.ContainsKey("n_spine"));
Check("q 通道关键帧数", back!.bones["n_spine"].q!.Count == 2);
Check("首帧值 (t=0 单位四元数)",
    back!.bones["n_spine"].q![0] is var f0 && f0.Length == 5 && Math.Abs(f0[0]) < 1e-6 && Math.Abs(f0[4] - 1) < 1e-6);
Check("次帧值 (t=1 含旋转)",
    back!.bones["n_spine"].q![1] is var f1 && Math.Abs(f1[0] - 1) < 1e-6 && Math.Abs(f1[4] - Math.Cos(0.05)) < 1e-4);


// ---- 2. PackWriter 目录 + index ----
var root = Path.Combine(Path.GetTempPath(), "choreo_pack_test_" + Guid.NewGuid().ToString("N"));
PackageIndexTest(root);
Directory.Delete(root, true);
Check("清理测试目录", !Directory.Exists(root));

// ---- 3. ChatCommandBuffer：聊天命令 UTF-8 字节边界（AUD-001 配套）----
// 铁律：内联/堆路径按 UTF-8 字节判定，不按 C# 字符数（中文每字 3 字节）
Check("63 字节 = 内联", ChatCommandBuffer.Utf8ByteLength(new string('a', 63)) == 63 && !ChatCommandBuffer.UsesHeap(new string('a', 63)));
Check("64 字节 = 堆", ChatCommandBuffer.UsesHeap(new string('a', 64)));
Check("70 字节 = 堆", ChatCommandBuffer.UsesHeap(new string('a', 70)));
Check("71 字节 = 堆", ChatCommandBuffer.UsesHeap(new string('a', 71)));
var c23 = new string('中', 21); // 21×3=63 字节：字符数 21 远小于 64，字节才是判据
Check("21 个中文(63 字节) = 内联，字符数不顶用", ChatCommandBuffer.Utf8ByteLength(c23) == 63 && !ChatCommandBuffer.UsesHeap(c23));
var c24 = new string('中', 22); // 66 字节 → 堆
Check("22 个中文(66 字节) = 堆", ChatCommandBuffer.UsesHeap(c24));
var mix = "/ac \"" + new string('斩', 30) + "\""; // 混合命令，30×3+6=96 字节
Check("混合中文命令(96 字节) = 堆", ChatCommandBuffer.Utf8ByteLength(mix) == 96 && ChatCommandBuffer.UsesHeap(mix));
var empty = "";
Check("空命令 0 字节 = 内联", ChatCommandBuffer.Utf8ByteLength(empty) == 0 && !ChatCommandBuffer.UsesHeap(empty));
// 往返：编码→解码逐字节无损（日志校验路径与真实写入路径同源）
var longCn = "/e " + new string('歌', 40); // 123 字节长命令
var round = ChatCommandBuffer.FromUtf8WithNull(ChatCommandBuffer.ToUtf8WithNull(longCn));
Check("长中文命令编码往返无损", round == longCn && ChatCommandBuffer.Utf8ByteLength(longCn) == 123);
var bufBow = ChatCommandBuffer.ToUtf8WithNull("/bow");
Check("编码含结束符", bufBow.Length == 5 && bufBow[4] == 0 && ChatCommandBuffer.FromUtf8WithNull(bufBow) == "/bow");

// ---- 4. RecorderService 静止判据（AUD-016 配套：老标量 OR 旋转角 OR 平移）----
// 数学口径直测：IsMoving/RotationDeltaRad 是纯函数，不依赖游戏进程
Matrix4x4 M(Quaternion q, Vector3 p) => Matrix4x4.CreateFromQuaternion(q) * Matrix4x4.CreateTranslation(p);
Quaternion AxisQ(Vector3 axis, float rad) => Quaternion.CreateFromAxisAngle(Vector3.Normalize(axis), rad);

// ① 审计核心场景：同角度（30°）不同轴的两个旋转——老标量指标完全相等（漏检），新判据必须抓到
var qAxisX = AxisQ(Vector3.UnitX, 30f * MathF.PI / 180f);
var qAxisY = AxisQ(Vector3.UnitY, 30f * MathF.PI / 180f);
var oldBlind = MathF.Abs(
    (qAxisX.X * qAxisX.X + qAxisX.Y * qAxisX.Y + qAxisX.Z * qAxisX.Z) -
    (qAxisY.X * qAxisY.X + qAxisY.Y * qAxisY.Y + qAxisY.Z * qAxisY.Z));
Check("老标量指标确实漏检（同角度不同轴差值≈0，复现审计场景）", oldBlind < 0.001f);
Check("同角度不同轴 → 新判据判在动", MotionDetect.IsMoving(M(qAxisX, Vector3.Zero), M(qAxisY, Vector3.Zero)));
Check("同角度不同轴旋转角 ≈ 0.736 rad（30° 绕 X 与绕 Y）",
    MathF.Abs(MotionDetect.RotationDeltaRad(M(qAxisX, Vector3.Zero), M(qAxisY, Vector3.Zero)) - 0.7362f) < 0.01f,
    MotionDetect.RotationDeltaRad(M(qAxisX, Vector3.Zero), M(qAxisY, Vector3.Zero)).ToString());

// ② q 与 -q 等价（havok 输出的符号翻转特性）：同一旋转必须判静止
var qPos = AxisQ(Vector3.UnitY, 1.2f);
Check("q 与 -q 等价 → 判静止", !MotionDetect.IsMoving(M(qPos, Vector3.Zero), M(-qPos, Vector3.Zero)));
Check("q 与 -q 旋转角 = 0", MotionDetect.RotationDeltaRad(M(qPos, Vector3.Zero), M(-qPos, Vector3.Zero)) < 1e-5f);

// ③ 微小噪声（收尾余波量级）：不判在动（否则 20s 超时回归）
var qTinyA = AxisQ(Vector3.UnitZ, 0.10f);
var qTinyB = AxisQ(Vector3.UnitZ, 0.14f);
Check("微小噪声 0.04 rad → 判静止", !MotionDetect.IsMoving(M(qTinyA, Vector3.Zero), M(qTinyB, Vector3.Zero)));
// 校准锚点（恒等姿势盲区场景：老标量恒为 0，只有角度判据在工作）：
// 真实数据余波峰值 0.4735 rad（joy）必须仍判静止；0.55 rad 必须判在动
var qResA = AxisQ(Vector3.UnitX, 0.3333f);
var qResB = AxisQ(Vector3.UnitY, 0.3333f); // 两轴各转 0.3333 rad → 夹角恰 0.47 rad，|v|² 相等老标量看不见
Check("余波峰值 0.47 rad（校准实测上限，老标量盲区）→ 判静止",
    !MotionDetect.IsMoving(M(qResA, Vector3.Zero), M(qResB, Vector3.Zero)));
var qBigB = AxisQ(Vector3.UnitY, 0.39f); // 夹角 0.55 rad，老标量仍为 0 → 只有新判据抓得到
Check("0.55 rad（超阈值，老标量盲区）→ 判在动", MotionDetect.IsMoving(M(qResA, Vector3.Zero), M(qBigB, Vector3.Zero)));

// ④ 明显旋转：必判在动
var qSwingA = Quaternion.Identity;
var qSwingB = AxisQ(Vector3.UnitX, 1.047f); // 60°
Check("明显旋转 60° → 判在动", MotionDetect.IsMoving(M(qSwingA, Vector3.Zero), M(qSwingB, Vector3.Zero)));
Check("90° 旋转角 = π/2",
    MathF.Abs(MotionDetect.RotationDeltaRad(M(Quaternion.Identity, Vector3.Zero), M(AxisQ(Vector3.UnitX, MathF.PI / 2), Vector3.Zero)) - MathF.PI / 2) < 1e-4f);

// ⑤ 纯平移：0.05m 判在动（老判据完全无视平移），0.01m 判静止
var qSame = AxisQ(Vector3.UnitY, 0.8f);
Check("纯平移 5cm → 判在动", MotionDetect.IsMoving(M(qSame, new Vector3(1, 2, 3)), M(qSame, new Vector3(1, 2, 3.05f))));
Check("纯平移 1cm → 判静止", !MotionDetect.IsMoving(M(qSame, new Vector3(1, 2, 3)), M(qSame, new Vector3(1.01f, 2, 3))));

// ⑥ Decompose 失败（负行列式/零矩阵）：保守判在动，宁可多录不可提前掐
var mirrored = M(Quaternion.Identity, Vector3.Zero);
mirrored.M22 = -1f; // 行列式取负，Decompose 返回 false
Check("Decompose 失败（负行列式）→ 保守判在动", MotionDetect.IsMoving(mirrored, M(Quaternion.Identity, Vector3.Zero)));
Check("Decompose 失败（零矩阵）→ 保守判在动", MotionDetect.IsMoving(default, M(Quaternion.Identity, Vector3.Zero)));

// ⑦ 老判据 0.05 阈值行为保持：大姿势骨上的老标量超限照样抓到（回归线）
var qPoseA = AxisQ(new Vector3(1, 2, 3), 2.4f); // 大姿势旋转
var qPoseB = AxisQ(new Vector3(1, 2, 3), 2.4f + 0.5f); // 同轴再转 ~28.6°：老标量差 > 0.05
var oldCatch = MathF.Abs(
    (qPoseA.X * qPoseA.X + qPoseA.Y * qPoseA.Y + qPoseA.Z * qPoseA.Z) -
    (qPoseB.X * qPoseB.X + qPoseB.Y * qPoseB.Y + qPoseB.Z * qPoseB.Z));
Check("大姿势骨老标量超限场景成立（差值>0.05）", oldCatch > 0.05f, oldCatch.ToString());
Check("同轴大姿势旋转 → 判在动（老路径回归）", MotionDetect.IsMoving(M(qPoseA, Vector3.Zero), M(qPoseB, Vector3.Zero)));

// ---- 5. ClipPathPolicy：动作文件路径策略（AUD2-001 配套：路径逃逸收口）----
var clipRoot = Path.Combine(Path.GetTempPath(), "choreo_clip_policy_" + Guid.NewGuid().ToString("N"));
Directory.CreateDirectory(clipRoot);

bool NameOk(string raw, string expect)
{
    if (!ClipPathPolicy.TryMakeFileName(raw, out var fn)) return false;
    return fn == expect;
}
Check("/bow → bow", NameOk("/bow", "bow"));
Check("/bow motion → bow（变体剥离兼容映射保留）", NameOk("/bow motion", "bow"));
Check("/golddance loop → golddance", NameOk("/golddance loop", "golddance"));
Check("/beckon special → beckon", NameOk("/beckon special", "beckon"));
Check("首尾空格剥掉", NameOk("  wave  ", "wave"));
Check("中文动作名保留", NameOk("行礼", "行礼"));

// 拒绝清单。HTTP 层 ParseQueryString 会先把 %5c→\ 、%3a→: 解码再交给策略，
// 这里直测的就是解码后的形态（编码形态在 HTTP 层根本到不了文件名）
Check("拒绝空串", !ClipPathPolicy.TryMakeFileName("", out _));
Check("拒绝纯空白", !ClipPathPolicy.TryMakeFileName("   ", out _));
Check("拒绝盘符路径 C:\\temp\\x", !ClipPathPolicy.TryMakeFileName("C:\\temp\\x", out _));
Check("拒绝裸盘符 C:temp", !ClipPathPolicy.TryMakeFileName("C:temp", out _));
Check("拒绝 UNC \\\\server\\share\\x", !ClipPathPolicy.TryMakeFileName("\\\\server\\share\\x", out _));
Check("拒绝 ..\\x", !ClipPathPolicy.TryMakeFileName("..\\x", out _));
Check("拒绝 ../x（正斜杠形态）", !ClipPathPolicy.TryMakeFileName("../x", out _));
Check("拒绝裸 ..", !ClipPathPolicy.TryMakeFileName("..", out _));
Check("拒绝内部斜杠 a/b", !ClipPathPolicy.TryMakeFileName("a/b", out _));
Check("拒绝反斜杠 a\\b", !ClipPathPolicy.TryMakeFileName("a\\b", out _));
Check("拒绝冒号 a:b（NTFS 数据流）", !ClipPathPolicy.TryMakeFileName("a:b", out _));
Check("拒绝保留设备名 CON", !ClipPathPolicy.TryMakeFileName("CON", out _));
Check("拒绝保留设备名 nul（小写）", !ClipPathPolicy.TryMakeFileName("nul", out _));
Check("拒绝 NUL 控制字符", !ClipPathPolicy.TryMakeFileName("bo\u0000w", out _));
Check("拒绝超长文件名（101 字符）", !ClipPathPolicy.TryMakeFileName(new string('a', 101), out _));
Check("100 字符仍合法（上限回归）", ClipPathPolicy.TryMakeFileName(new string('a', 100), out _));

// 最终路径双重约束：合法名落根目录内（前缀带目录分隔符，clips2 冒充不了 clips）
Check("合法名解析成功且在根目录内",
    ClipPathPolicy.TryResolvePath(clipRoot, "bow", ".json", out var okPath)
    && okPath.StartsWith(Path.GetFullPath(clipRoot) + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase));
Check("clips2 冒充 clips：带相对段直接拒绝",
    !ClipPathPolicy.TryResolvePath(clipRoot, "..\\clips2\\evil", ".json", out _));
Check("clips2 冒充 clips：组合入口同样拒绝",
    !ClipPathPolicy.TryGetPathForCommand(clipRoot, "..\\clips2\\evil", ".json", out _, out _));
Check("内部斜杠文件名解析拒绝（双保险）",
    !ClipPathPolicy.TryResolvePath(clipRoot, "sub\\bow", ".json", out _));

// 端到端落点：允许的命令写出的文件必须在根目录里（临时目录造假 clip，绝不碰真实 ChoreoExports）
Check("/bow motion 端到端落点 = root\\bow.json",
    ClipPathPolicy.TryGetPathForCommand(clipRoot, "/bow motion", ".json", out var bowPath, out _)
    && bowPath == Path.Combine(Path.GetFullPath(clipRoot), "bow.json"));
File.WriteAllText(bowPath, "{\"ok\":true}");
Check("解析路径可读写（fake json 往返）", File.ReadAllText(bowPath) == "{\"ok\":true}");
Directory.Delete(clipRoot, true);
Check("清理路径策略测试目录", !Directory.Exists(clipRoot));

// ==================== FIX-B（AUD2-005）：ChatCommandPolicy 命令安全边界 ====================
Console.WriteLine("== FIX-B ChatCommandPolicy（AUD2-005） ==");
Check("正常命令放行", ChatCommandPolicy.TryValidate("/bow motion", out _));
Check("中文歌词命令放行", ChatCommandPolicy.TryValidate("/e 第一句歌词", out _));
Check("空命令拒绝", !ChatCommandPolicy.TryValidate("", out var rEmpty) && rEmpty.Length > 0);
Check("纯空白拒绝", !ChatCommandPolicy.TryValidate("   ", out _));
Check("不以 / 开头拒绝", !ChatCommandPolicy.TryValidate("bow motion", out _));
Check("换行拒绝（LF）", !ChatCommandPolicy.TryValidate("/e 第一行\n第二行", out _));
Check("换行拒绝（CRLF 多命令拼接）", !ChatCommandPolicy.TryValidate("/bow\r\n/wave", out _));
Check("NUL 拒绝", !ChatCommandPolicy.TryValidate("/e a\0b", out _));
Check("TAB 等控制字符拒绝", !ChatCommandPolicy.TryValidate("/e a\tb", out _));
Check("U+0001 控制字符拒绝", !ChatCommandPolicy.TryValidate("/e a\u0001b", out _));
Check("分号拼接拒绝", !ChatCommandPolicy.TryValidate("/bow; /wave", out _));
var cmdMax = "/e " + new string('词', 333); // 4 + 333*3 = 1003 > 1000 → 拒
Check("恰好上限（1000 字节）放行", ChatCommandPolicy.TryValidate("/e " + new string('词', 332), out _));
Check("超上限 1 字节拒绝（按 UTF-8 字节不算字符）", !ChatCommandPolicy.TryValidate(cmdMax, out _));
Check("长中文命令（500 字符=1500 字节）拒绝", !ChatCommandPolicy.TryValidate("/e " + new string('词', 499), out _));

// ==================== FIX-B（AUD2-003/004）：SeekPlanner 事件语义 ====================
Console.WriteLine("== FIX-B SeekPlanner（AUD2-004 seek 事件语义） ==");
static SeekEvent Ev(int id, int actor, float start, float dur, string cmd, string type) =>
    new() { Id = id, ActorId = actor, Start = start, Duration = dur, Command = cmd, Type = type };

// 轮询等待异步调度到位（工作体在 Task.Run 上启动的时序），超时返回末次判定
static bool SpinWaitUntil(Func<bool> cond, int timeoutMs = 5000)
{
    var sw = System.Diagnostics.Stopwatch.StartNew();
    while (sw.ElapsedMilliseconds < timeoutMs)
    {
        if (cond()) return true;
        System.Threading.Thread.Sleep(5);
    }
    return cond();
}

// 单动作定格选择
var sp1 = SeekPlanner.Plan(new[] { Ev(1, 0, 10, 10, "/bow motion", "action") }, 12f);
Check("覆盖时刻的动作被选中", sp1.Selected?.Action?.Id == 1 && sp1.Actors.Count == 1);

// 歌词永不参与：独存的歌词轨 seek = 空白区
var sp2 = SeekPlanner.Plan(new[] { Ev(1, 0, 10, 5, "/e 歌词", "lyric") }, 12f);
Check("歌词独存 → 无动作（空白区不回放）", sp2.Selected == null);

// 歌词不挤掉动作（旧 bug：较晚歌词会遮掉应定格的动作）
var sp3 = SeekPlanner.Plan(new[]
{
    Ev(1, 0, 10, 10, "/bow motion", "action"),
    Ev(2, 0, 10, 5, "/e 歌词", "lyric"),
}, 12f);
Check("歌词与动作重叠 → 只选动作", sp3.Selected?.Action?.Id == 1);

// switch 也只做前置，不当动作
var sp4 = SeekPlanner.Plan(new[] { Ev(1, 0, 10, 0.5f, "/classjob 吟游诗人", "switch") }, 12f);
Check("switch 独存 → 无动作", sp4.Selected == null);

// 前置 switch 识别（switch 占 [动作开始-0.5, 动作开始)）
var sp5 = SeekPlanner.Plan(new[]
{
    Ev(1, 0, 9.5f, 0.5f, "/classjob 吟游诗人", "switch"),
    Ev(2, 0, 10, 10, "/bow motion", "action"),
}, 12f);
Check("前置 switch 被识别", sp5.Selected?.PreSwitch?.Command == "/classjob 吟游诗人");

// 远处的 switch 不是前置
var sp6 = SeekPlanner.Plan(new[]
{
    Ev(1, 0, 0, 0.5f, "/classjob 吟游诗人", "switch"),
    Ev(2, 0, 10, 10, "/bow motion", "action"),
}, 12f);
Check("远离动作的 switch 不是前置", sp6.Selected?.PreSwitch == null);

// 别的演员的 switch 不串档
var sp7 = SeekPlanner.Plan(new[]
{
    Ev(1, 1, 9.5f, 0.5f, "/classjob 吟游诗人", "switch"),
    Ev(2, 0, 10, 10, "/bow motion", "action"),
}, 12f);
Check("其他演员的 switch 不串档", sp7.Selected?.PreSwitch == null && sp7.Selected?.Action?.Id == 2);

// 两演员各有动作互不覆盖；本地选择 = Start 最晚（平手取 ActorId 大者）
var sp8 = SeekPlanner.Plan(new[]
{
    Ev(1, 0, 10, 10, "/bow motion", "action"),
    Ev(2, 1, 10, 10, "/wave motion", "action"),
}, 12f);
Check("两演员各有计划（互不覆盖）", sp8.Actors.Count == 2 && sp8.Actors[0].ActorId == 0 && sp8.Actors[1].ActorId == 1);
Check("平手时本地选择取 ActorId 大者", sp8.Selected?.ActorId == 1);

// 错开的动作：Start 最晚者胜（与旧"取最新一个"行为一致）
var sp9 = SeekPlanner.Plan(new[]
{
    Ev(1, 0, 5, 10, "/bow motion", "action"),
    Ev(2, 1, 12, 8, "/wave motion", "action"),
}, 14f);
Check("错开动作选 Start 最晚", sp9.Selected?.Action?.Id == 2);

// 空白区（动作间隙）→ 无动作
var sp10 = SeekPlanner.Plan(new[] { Ev(1, 0, 0, 5, "/bow motion", "action") }, 10f);
Check("动作间隙 → 空白（停止定格）", sp10.Selected == null);

// 短动作按 0.5s 最小覆盖窗（与旧 SeekLocked 语义一致）
var sp11 = SeekPlanner.Plan(new[] { Ev(1, 0, 10, 0.1f, "/bow motion", "action") }, 10.3f);
Check("短动作按 0.5s 覆盖窗选中", sp11.Selected?.Action?.Id == 1);

// 开始边界容差 +0.05（与旧语义一致）
var sp12 = SeekPlanner.Plan(new[] { Ev(1, 0, 10, 5, "/bow motion", "action") }, 9.96f);
Check("动作开始前 0.05s 内已算覆盖", sp12.Selected?.Action?.Id == 1);
var sp13 = SeekPlanner.Plan(new[] { Ev(1, 0, 10, 5, "/bow motion", "action") }, 9.9f);
Check("动作开始前 0.1s 未覆盖", sp13.Selected == null);

// 纯函数幂等：同一事件集重复 plan 结果一致（执行端靠 _lastSeekSwitchCmd 去重切职业）
var sp14 = SeekPlanner.Plan(new[]
{
    Ev(1, 0, 9.5f, 0.5f, "/classjob 吟游诗人", "switch"),
    Ev(2, 0, 10, 10, "/bow motion", "action"),
}, 12f);
var sp15 = SeekPlanner.Plan(new[]
{
    Ev(1, 0, 9.5f, 0.5f, "/classjob 吟游诗人", "switch"),
    Ev(2, 0, 10, 10, "/bow motion", "action"),
}, 12f);
Check("重复 seek 计划一致（幂等）",
    sp14.Selected?.Action?.Id == sp15.Selected?.Action?.Id
    && sp14.Selected?.PreSwitch?.Command == sp15.Selected?.PreSwitch?.Command);

// ==================== ACTOR（2026-08-31）：单预览舞者契约 ====================
// 复现口径：网页旧实现把两位舞者（动作时间重叠）的事件全发进同一 payload，插件
// PlaybackManager.ExecuteClip 不分 ActorId 全部执行在同一个本地角色上；seek 显示侧还按
// 「Start 最晚/ActorId 大」在多演员里挑人，会跟用户想看的舞者不一致。
// 修复契约：网页只发预览舞者（buildGameClips(previewActor)，test-edit.js 覆盖）；
// 插件对混演员 payload 一律 400 拒绝（HttpServer.ParsePlaybackClips 统一口）。
Console.WriteLine("== ACTOR 单预览舞者（游戏内一次只演一位） ==");

// 双舞者动作重叠（舞者1 [0,4) vs 舞者2 [2,6)）+ 一条全局歌词(-1)——旧网页发出来的就是这种包
int[] actorMixed = { 0, -1, 1 };
Check("混入两位舞者（动作重叠）→ 400 拒绝", PreviewActorPolicy.Validate(actorMixed) != null);
Check("拒绝文案点名预览舞者指路", (PreviewActorPolicy.Validate(actorMixed) ?? "").Contains("预览舞者"));

// 网页过滤后的 payload：预览舞者1 的动作+其台词，加全局歌词 → 合法
int[] actorSingle = { 1, 1, -1 };
Check("单舞者 + 全局歌词(-1) → 合法", PreviewActorPolicy.Validate(actorSingle) == null);
Check("纯全局歌词(-1) → 合法（timeline 端点允许清空）", PreviewActorPolicy.Validate(new[] { -1, -1 }) == null);
Check("空时间轴 → 合法", PreviewActorPolicy.Validate(Array.Empty<int>()) == null);
Check("null 序列 → 合法（防御）", PreviewActorPolicy.Validate(null) == null);
Check("三位舞者混杂 → 拒绝", PreviewActorPolicy.Validate(new[] { 0, 1, 2 }) != null);

// seek 侧契约：payload 过滤成预览舞者后，seek 的本地定格必是这位舞者——
// 别家更晚/同刻的动作已不在 payload 里，不再按 tie-break 抢走显示
var seekMixed = new List<SeekEvent>
{
    new() { Id = 1, ActorId = 0, Start = 0f, Duration = 4f, Command = "/bow motion", Type = "action" },
    new() { Id = 2, ActorId = 1, Start = 2f, Duration = 4f, Command = "/wave motion", Type = "action" },
    new() { Id = 3, ActorId = -1, Start = 0f, Duration = 2f, Command = "", Type = "lyric" },
};
var mixedPlan = SeekPlanner.Plan(seekMixed, 3f);
Check("混包时旧 tie-break 会挑 ActorId 大者（锁住修复前行为成因）", mixedPlan.Selected?.ActorId == 1);
var seekPreview = new List<SeekEvent>
{
    new() { Id = 2, ActorId = 1, Start = 2f, Duration = 4f, Command = "/wave motion", Type = "action" },
    new() { Id = 3, ActorId = -1, Start = 0f, Duration = 2f, Command = "", Type = "lyric" },
};
var previewPlan = SeekPlanner.Plan(seekPreview, 3f);
Check("预览 payload 的 seek：本地定格 = 预览舞者(1)", previewPlan.Selected?.ActorId == 1 && previewPlan.Selected?.Action?.Id == 2);
Check("预览 payload 的 seek：各演员计划只剩一位", previewPlan.Actors.Count == 1);
var previewGap = SeekPlanner.Plan(seekPreview, 1f);
Check("预览 payload 落动作空隙 → 空白（停止定格，不回放）", previewGap.Selected == null);

// ==================== FIX-C（AUD2-007）：录制计时精度与判静窗口 ====================

// 老判据用 float 绝对秒：开机约 12.14 天（2^20=1048576 秒）起 float 步长 125ms，30fps 的 33.3ms 采样判断直接丢失；
// 新判据 double 相对秒在这些开机时长下必须无损。同一批"开机时长 + 33.3ms 增量"逐点验证
double[] uptimesA = { 0, 345600.0, 1048576.0, 8640000.0 }; // 0 / 4 天 / 约12.14天(2^20 整灭点) / 100 天
var oneSampleA = 1.0 / 30.0;
foreach (var up in uptimesA)
{
    var recoveredD = (up + oneSampleA) - up;
    Check($"double 绝对秒 {up / 86400.0:F1} 天时 33.3ms 增量无损",
        Math.Abs(recoveredD - oneSampleA) < 1e-9,
        $"差 {Math.Abs(recoveredD - oneSampleA):e2}");
    var recoveredF = ((float)up + (float)oneSampleA) - (float)up;
    if (up >= 1048576.0)
        Check($"float 绝对秒 {up / 86400.0:F1} 天时 33.3ms 增量确实丢失（锁住老 bug 的成因）",
            recoveredF == 0f, $"recover={recoveredF}");
}
Check("Stopwatch 单调钟 NowSeconds 非负且单调",
    RecordTiming.NowSeconds() >= 0
    && RecordTiming.NowSeconds() >= RecordTiming.NowSeconds() - 1e-9);
{
    var ts = Stopwatch.GetTimestamp();
    var e1 = RecordTiming.ElapsedSeconds(ts);
    var e2 = RecordTiming.ElapsedSeconds(ts);
    Check("ElapsedSeconds 同起点两次调用单调不减且接近 0", e2 >= e1 && e2 < 1.0, $"{e1} → {e2}");
}

// 判静参考帧按时间找 0.4 秒前（老代码固定倒数第 12 帧，随实际帧率漂移）
var timesA = new List<double> { 0.1, 0.5, 0.9, 1.3 };
Check("参考帧：0.9s 恰好在窗口边界（含等号）", RecordTiming.StillRefIndex(timesA, 1.3) == 2);
Check("参考帧：目标 0.8s 取最新更早帧", RecordTiming.StillRefIndex(timesA, 1.2) == 1);
Check("参考帧：未播满一个窗口 → -1", RecordTiming.StillRefIndex(timesA, 0.4) == -1);
Check("参考帧：空序列 → -1", RecordTiming.StillRefIndex(new List<double>(), 10) == -1);
Check("参考帧：边界等号入选（t==curT-window）",
    RecordTiming.StillRefIndex(new List<double> { 0.5 }, 1.0, 0.5) == 0); // 二进制精确边界：1.0-0.5==0.5 精确成立（0.1/0.5/0.4 的十进制等值在 binary64 下不成立）

// ==================== FIX-C（AUD2-006）：ClipQuality 与网页 recAmp 同口径 ====================
// 向量与 scripts\qc-crosstest.js 共用，数值两边必须一致（防两套质检口径漂移）
static AnimClipData QC(params float[][] frames)
{
    var c = new AnimClipData { name = "t", duration = 1f, type = "once" };
    var ch = new BoneChannel { q = new List<float[]>(frames) };
    c.bones["bone_0"] = ch;
    return c;
}
var qStillA = QC(new[] { 0f, 0f, 0f, 0f, 1f }, new[] { 0.033f, 0f, 0f, 0f, 1f });
var qBowA = QC(new[] { 0f, 0f, 0f, 0f, 1f }, new[] { 1f, 0.2f, 0f, 0f, 1f }, new[] { 2f, 0f, 0.3f, 0f, 0.9f });
var qSignA = QC(new[] { 0f, 0.1f, -0.2f, 0.3f, 0.9f }, new[] { 1f, -0.4f, 0.5f, -0.6f, -0.7f });
var qMidA = QC(new[] { 0f, 0f, 0f, 0f, 1f }, new[] { 1f, 0.5f, 0f, 0f, 1f }, new[] { 2f, 0.1f, 0f, 0f, 1f });
var qEdgeA = QC(new[] { 0f, 0f, 0f, 0f, 1f }, new[] { 1f, 0.31f, 0f, 0f, 1f });
Check("幅度：静止 clip = 0", ClipQuality.MaxRotationOffset(qStillA) == 0.0);
Check("幅度：bow 形向量 = 0.4（与 JS 一致）", Math.Abs(ClipQuality.MaxRotationOffset(qBowA) - 0.4) < 1e-6);
Check("幅度：负分量/符号翻转向量 = 3.7（与 JS 一致）", Math.Abs(ClipQuality.MaxRotationOffset(qSignA) - 3.7) < 1e-6);
Check("幅度：最大值在中间帧不被尾帧冲掉", Math.Abs(ClipQuality.MaxRotationOffset(qMidA) - 0.5) < 1e-6);
Check("幅度：0.31 在阈值上方（校准口径）", Math.Abs(ClipQuality.MaxRotationOffset(qEdgeA) - 0.31) < 1e-6);
Check("幅度：单帧骨骼跳过、空 clip = 0",
    ClipQuality.MaxRotationOffset(new AnimClipData()) == 0.0);
{
    var two = new AnimClipData { name = "t", duration = 1f, type = "once" };
    two.bones["a"] = new BoneChannel { q = new List<float[]> { new[] { 0f, 0f, 0f, 0f, 1f } } }; // 单帧
    two.bones["b"] = qBowA.bones["bone_0"];
    Check("幅度：多骨取最大、单帧骨不参与", Math.Abs(ClipQuality.MaxRotationOffset(two) - 0.4) < 1e-6);
}
Check("质检：0.4 判在动 / 0 判静止", !ClipQuality.IsStill(qBowA) && ClipQuality.IsStill(qStillA));

// ==================== FIX-C（AUD2-007）：录制计时精度与判静窗口 ====================

// 老判据用 float 绝对秒：开机约 12.14 天（2^20=1048576 秒）起 float 步长 125ms，30fps 的 33.3ms 采样判断直接丢失；
// 新判据 double 相对秒在这些开机时长下必须无损。同一批"开机时长 + 33.3ms 增量"逐点验证
double[] uptimes = { 0, 345600.0, 1048576.0, 8640000.0 }; // 0 / 4 天 / 约12.14天(2^20 整灭点) / 100 天
var oneSample = 1.0 / 30.0;
foreach (var up in uptimes)
{
    var recoveredD = (up + oneSample) - up;
    Check($"double 绝对秒 {up / 86400.0:F1} 天时 33.3ms 增量无损",
        Math.Abs(recoveredD - oneSample) < 1e-9,
        $"差 {Math.Abs(recoveredD - oneSample):e2}");
    var recoveredF = ((float)up + (float)oneSample) - (float)up;
    if (up >= 1048576.0)
        Check($"float 绝对秒 {up / 86400.0:F1} 天时 33.3ms 增量确实丢失（锁住老 bug 的成因）",
            recoveredF == 0f, $"recover={recoveredF}");
}
Check("Stopwatch 单调钟 NowSeconds 非负",
    RecordTiming.NowSeconds() >= 0);
{
    var ts = Stopwatch.GetTimestamp();
    var e1 = RecordTiming.ElapsedSeconds(ts);
    var e2 = RecordTiming.ElapsedSeconds(ts);
    Check("ElapsedSeconds 同起点两次调用单调不减且接近 0", e2 >= e1 && e2 < 1.0, $"{e1} → {e2}");
}

// 判静参考帧按时间找 0.4 秒前（老代码固定倒数第 12 帧，随实际帧率漂移）
var times = new List<double> { 0.1, 0.5, 0.9, 1.3 };
Check("参考帧：0.9s 恰好在窗口边界（含等号）", RecordTiming.StillRefIndex(times, 1.3) == 2);
Check("参考帧：目标 0.8s 取最新更早帧", RecordTiming.StillRefIndex(times, 1.2) == 1);
Check("参考帧：未播满一个窗口 → -1", RecordTiming.StillRefIndex(times, 0.4) == -1);
Check("参考帧：空序列 → -1", RecordTiming.StillRefIndex(new List<double>(), 10) == -1);
Check("参考帧：边界等号入选（t==curT-window）",
    RecordTiming.StillRefIndex(new List<double> { 0.5 }, 1.0, 0.5) == 0); // 二进制精确边界：1.0-0.5==0.5 精确成立（0.1/0.5/0.4 的十进制等值在 binary64 下不成立）

// ==================== FIX-C（AUD2-006）：ClipQuality 与网页 recAmp 同口径 ====================
// 向量与 scripts\qc-crosstest.js 共用，数值两边必须一致（防两套质检口径漂移）
var qStill = QC(new[] { 0f, 0f, 0f, 0f, 1f }, new[] { 0.033f, 0f, 0f, 0f, 1f });
var qBow = QC(new[] { 0f, 0f, 0f, 0f, 1f }, new[] { 1f, 0.2f, 0f, 0f, 1f }, new[] { 2f, 0f, 0.3f, 0f, 0.9f });
var qSign = QC(new[] { 0f, 0.1f, -0.2f, 0.3f, 0.9f }, new[] { 1f, -0.4f, 0.5f, -0.6f, -0.7f });
var qMid = QC(new[] { 0f, 0f, 0f, 0f, 1f }, new[] { 1f, 0.5f, 0f, 0f, 1f }, new[] { 2f, 0.1f, 0f, 0f, 1f });
var qEdge = QC(new[] { 0f, 0f, 0f, 0f, 1f }, new[] { 1f, 0.31f, 0f, 0f, 1f });
Check("幅度：静止 clip = 0", ClipQuality.MaxRotationOffset(qStill) == 0.0);
Check("幅度：bow 形向量 = 0.4（与 JS 一致）", Math.Abs(ClipQuality.MaxRotationOffset(qBow) - 0.4) < 1e-6);
Check("幅度：负分量/符号翻转向量 = 3.7（与 JS 一致）", Math.Abs(ClipQuality.MaxRotationOffset(qSign) - 3.7) < 1e-6);
Check("幅度：最大值在中间帧不被尾帧冲掉", Math.Abs(ClipQuality.MaxRotationOffset(qMid) - 0.5) < 1e-6);
Check("幅度：0.31 在阈值上方（校准口径）", Math.Abs(ClipQuality.MaxRotationOffset(qEdge) - 0.31) < 1e-6);
Check("幅度：空 clip = 0", ClipQuality.MaxRotationOffset(new AnimClipData()) == 0.0);
{
    var two = new AnimClipData { name = "t", duration = 1f, type = "once" };
    two.bones["a"] = new BoneChannel { q = new List<float[]> { new[] { 0f, 0f, 0f, 0f, 1f } } }; // 单帧骨
    two.bones["b"] = qBow.bones["bone_0"];
    Check("幅度：多骨取最大、单帧骨不参与", Math.Abs(ClipQuality.MaxRotationOffset(two) - 0.4) < 1e-6);
}
Check("质检：0.4 判在动 / 0 判静止", !ClipQuality.IsStill(qBow) && ClipQuality.IsStill(qStill));

// ==================== FIX-E（AUD2-010）：InFlightTracker 在途计数与排空 ====================
// 服务 Dispose 的契约：停接新请求 → WaitDrained（有限超时）→ 才释放下游依赖。
{
    var t = new InFlightTracker();
    Check("tracker：初始 0 在途、已排空", t.Count == 0 && t.WaitDrained(TimeSpan.Zero));

    // Begin 后计数上升、排空等待超时失败
    var h1 = t.Begin();
    var h2 = t.Begin();
    Check("tracker：Begin 两次计数=2", t.Count == 2);
    Check("tracker：未排空时短等待返回 false", !t.WaitDrained(TimeSpan.FromMilliseconds(50)));

    // 全部完成 → 归零、等待通过（模拟 handler try/finally 释放）
    h1.Dispose();
    h2.Dispose();
    Check("tracker：全部完成后归零且可等待", t.Count == 0 && t.WaitDrained(TimeSpan.Zero));

    // 幂等：同一句柄双 Dispose 不把计数减成负数
    h2.Dispose();
    Check("tracker：句柄双 Dispose 幂等（计数不为负）", t.Count == 0);

    // 可重复使用：排空后再次 Begin/Complete 循环（服务长期运行场景）
    using (var h3 = t.Begin())
    {
        Check("tracker：排空后可再次登记", t.Count == 1 && !t.WaitDrained(TimeSpan.FromMilliseconds(20)));
    }
    Check("tracker：using 释放后再次排空", t.Count == 0 && t.WaitDrained(TimeSpan.Zero));

    // 并发：多线程 Begin/Complete 后计数精确归零（HTTP 服务并发请求场景）
    const int N = 64;
    using (var barrier = new System.Threading.Barrier(N))
    {
        var handles = new IDisposable[N];
        for (var i = 0; i < N; i++) handles[i] = t.Begin();
        var threads = new System.Threading.Thread[N];
        for (var i = 0; i < N; i++)
        {
            var idx = i;
            threads[i] = new System.Threading.Thread(() =>
            {
                barrier.SignalAndWait();
                handles[idx]!.Dispose();
            });
            threads[i].Start();
        }
        foreach (var th in threads) th.Join();
    }
    Check("tracker：64 线程并发登记/完成后精确归零", t.Count == 0 && t.WaitDrained(TimeSpan.Zero));

    // 实例隔离：新实例不继承旧实例状态（热重载后新服务不继承旧 busy）
    var old = new InFlightTracker();
    var keep = old.Begin();
    var fresh = new InFlightTracker();
    Check("tracker：新实例不继承旧实例在途状态", old.Count == 1 && fresh.Count == 0 && fresh.WaitDrained(TimeSpan.Zero));
    keep.Dispose();
}

// ==================== SEC-1：ReadAuthPolicy 私有读配对分级 ====================
Console.WriteLine("== SEC-1 ReadAuthPolicy（私有读配对分级） ==");

// 48794：角色/会话/调试读要配对（/debug/poke 原本就当写管，收进同一张表）
Check("48794 /dancers 要配对", ReadAuthPolicy.IsPairedPlayRead("/dancers"));
Check("48794 /playback/status 要配对", ReadAuthPolicy.IsPairedPlayRead("/playback/status"));
Check("48794 /gpose/state 要配对", ReadAuthPolicy.IsPairedPlayRead("/gpose/state"));
// /bonerec/status 已随 BoneAnimator 死臂删除（2026-08-31 审计 P0/P1），配对断言一并移除
Check("48794 /debug/animstate 要配对", ReadAuthPolicy.IsPairedPlayRead("/debug/animstate"));
Check("48794 /debug/diag 要配对", ReadAuthPolicy.IsPairedPlayRead("/debug/diag"));
Check("48794 /debug/tlinfo 要配对", ReadAuthPolicy.IsPairedPlayRead("/debug/tlinfo"));
Check("48794 /debug/emotefamily 要配对", ReadAuthPolicy.IsPairedPlayRead("/debug/emotefamily"));
Check("48794 /debug/poke 维持当写管（要配对）", ReadAuthPolicy.IsPairedPlayRead("/debug/poke"));

// 48794：匿名清单——capabilities/health/version、公共动作目录、外部歌词搜索
Check("48794 / 匿名", !ReadAuthPolicy.IsPairedPlayRead("/"));
Check("48794 /health 匿名", !ReadAuthPolicy.IsPairedPlayRead("/health"));
Check("48794 /version 匿名", !ReadAuthPolicy.IsPairedPlayRead("/version"));
Check("48794 /capabilities 匿名", !ReadAuthPolicy.IsPairedPlayRead("/capabilities"));
Check("48794 /actions 匿名", !ReadAuthPolicy.IsPairedPlayRead("/actions"));
Check("48794 /actions/emotes 匿名", !ReadAuthPolicy.IsPairedPlayRead("/actions/emotes"));
Check("48794 /actions/emote-durations 匿名", !ReadAuthPolicy.IsPairedPlayRead("/actions/emote-durations"));
Check("48794 /actions/measured-durations 匿名", !ReadAuthPolicy.IsPairedPlayRead("/actions/measured-durations"));
Check("48794 /actions/races 匿名", !ReadAuthPolicy.IsPairedPlayRead("/actions/races"));
Check("48794 /classjobs 匿名", !ReadAuthPolicy.IsPairedPlayRead("/classjobs"));
Check("48794 /lyrics/search 匿名", !ReadAuthPolicy.IsPairedPlayRead("/lyrics/search"));
Check("48794 /lyrics 匿名", !ReadAuthPolicy.IsPairedPlayRead("/lyrics"));
Check("48794 路径判定 Ordinal 大小写敏感（/Dancers 不命中，路由层 404）", !ReadAuthPolicy.IsPairedPlayRead("/Dancers"));
Check("48794 未知路径不判私有（路由层 404 兜底）", !ReadAuthPolicy.IsPairedPlayRead("/nope"));
Check("48794 null 路径安全", !ReadAuthPolicy.IsPairedPlayRead(null));

// 48795：/export/* 全部个人数据（动作/骨架/录制与批量状态）
Check("48795 /export/list 要配对", ReadAuthPolicy.IsPairedExportRead("/export/list"));
Check("48795 /export/getclip 要配对", ReadAuthPolicy.IsPairedExportRead("/export/getclip"));
Check("48795 /export/skeleton 要配对", ReadAuthPolicy.IsPairedExportRead("/export/skeleton"));
Check("48795 /export/recstate 要配对", ReadAuthPolicy.IsPairedExportRead("/export/recstate"));
Check("48795 /export/progress 要配对", ReadAuthPolicy.IsPairedExportRead("/export/progress"));
Check("48795 /export/batchstatus 要配对", ReadAuthPolicy.IsPairedExportRead("/export/batchstatus"));
Check("48795 /export 前缀不误伤（/exportfoo 不是私有段，路由层 404）", !ReadAuthPolicy.IsPairedExportRead("/exportfoo"));
Check("48795 /capabilities 匿名", !ReadAuthPolicy.IsPairedExportRead("/capabilities"));
Check("48795 静态页路径匿名", !ReadAuthPolicy.IsPairedExportRead("/choreo-helper-app.html"));
Check("48795 null 路径安全", !ReadAuthPolicy.IsPairedExportRead(null));

// 48795 静态模型：按"解析后文件名"判，OrdinalIgnoreCase（Windows 文件系统大小写不敏感）
Check("模型 model.gltf 要配对", ReadAuthPolicy.IsPairedModelFile("model.gltf"));
Check("模型 model.glb 要配对", ReadAuthPolicy.IsPairedModelFile("model.glb"));
Check("模型 model.bin 要配对", ReadAuthPolicy.IsPairedModelFile("model.bin"));
Check("模型判定大小写不敏感（MODEL.GLTf / Model.Bin）",
    ReadAuthPolicy.IsPairedModelFile("MODEL.GLTf") && ReadAuthPolicy.IsPairedModelFile("Model.Bin"));
Check("stand-in 模型是公共内容，保持匿名", !ReadAuthPolicy.IsPairedModelFile("model-standin.gltf"));
Check("页面/脚本/库文件匿名", !ReadAuthPolicy.IsPairedModelFile("pose-viewer.html")
    && !ReadAuthPolicy.IsPairedModelFile("choreo-app.js") && !ReadAuthPolicy.IsPairedModelFile("libs-classic"));
Check("null 文件名安全", !ReadAuthPolicy.IsPairedModelFile(null));
// ServeStatic 契约：/./model.gltf 这类相对段经 GetFullPath 归一化后文件名不变，判定不吃亏
var secResolved = Path.GetFileName(Path.GetFullPath(Path.Combine(Path.GetTempPath(), "./model.gltf")));
Check("/./model.gltf 归一化后仍判私有", ReadAuthPolicy.IsPairedModelFile(secResolved));

// LocalApiSecurity 来源允许逻辑（SEC-1 后 CORS 只管传输，私有数据一律另有配对码）
Check("无 Origin 头放行（curl/同源）", LocalApiSecurity.IsOriginAllowed(null));
Check("file:// 的 null 来源在允许表（传输层放行，私有数据仍要配对码）", LocalApiSecurity.IsOriginAllowed("null"));
Check("本地 48795/48796/48797 来源放行",
    LocalApiSecurity.IsOriginAllowed("http://localhost:48795")
    && LocalApiSecurity.IsOriginAllowed("http://localhost:48796")
    && LocalApiSecurity.IsOriginAllowed("http://localhost:48797"));
Check("127.0.0.1 形态来源放行", LocalApiSecurity.IsOriginAllowed("http://127.0.0.1:48795"));
Check("陌生 https 来源拒绝", !LocalApiSecurity.IsOriginAllowed("https://evil.example"));

// v0.7.1 公开试用：出厂常量已定稿为 GitHub Pages origin（XHZZZ314 用户页仓库）
Check("公开站点常量已配置为 https://xhzzz314.github.io", LocalApiSecurity.PublicSiteOrigin == "https://xhzzz314.github.io");
Check("公开站点精确 origin 放行（出厂常量，非临时赋值）", LocalApiSecurity.IsOriginAllowed("https://xhzzz314.github.io"));
// 近似串逐一拒绝：IsOriginAllowed 是 Ordinal 精确比较，不做前缀/后缀/大小写折叠
Check("近似串拒绝：http 明文方案（降级）", !LocalApiSecurity.IsOriginAllowed("http://xhzzz314.github.io"));
Check("近似串拒绝：尾部斜杠", !LocalApiSecurity.IsOriginAllowed("https://xhzzz314.github.io/"));
Check("近似串拒绝：显式默认端口 :443", !LocalApiSecurity.IsOriginAllowed("https://xhzzz314.github.io:443"));
Check("近似串拒绝：后缀伪装主机", !LocalApiSecurity.IsOriginAllowed("https://xhzzz314.github.io.evil.example"));
Check("近似串拒绝：大小写混合主机", !LocalApiSecurity.IsOriginAllowed("https://XHZZZ314.github.io"));
Check("公开站点配置后其它陌生来源仍拒绝", !LocalApiSecurity.IsOriginAllowed("https://still-evil.example"));

var secSavedOrigin = LocalApiSecurity.PublicSiteOrigin;
try
{
    LocalApiSecurity.PublicSiteOrigin = "https://choreo-example.github.io";
    Check("official origin 临时赋值放行", LocalApiSecurity.IsOriginAllowed("https://choreo-example.github.io"));
    Check("official origin 临时赋值后出厂 origin 不再放行（单槽精确匹配）", !LocalApiSecurity.IsOriginAllowed("https://xhzzz314.github.io"));
    Check("official origin 临时赋值后陌生来源仍拒绝", !LocalApiSecurity.IsOriginAllowed("https://still-evil.example"));
}
finally { LocalApiSecurity.PublicSiteOrigin = secSavedOrigin; }

// TokenMatches（2026-08-31 审计 P1）：空配对码 fail-closed——旧实现空码放行是防御性死分支
//（PairingStore 所有路径返回非空码），死分支既然到不了就必须倒向安全侧
Check("配对判定：头码一致放行", LocalApiSecurity.TokenMatches("ABC123", "ABC123"));
Check("配对判定：头缺失拒绝", !LocalApiSecurity.TokenMatches(null, "ABC123"));
Check("配对判定：头不匹配拒绝", !LocalApiSecurity.TokenMatches("wrong", "ABC123"));
Check("配对判定：空码一律拒绝（fail-closed）", !LocalApiSecurity.TokenMatches("ABC123", "") && !LocalApiSecurity.TokenMatches(null, ""));
Check("official origin 测试后恢复为出厂常量（不影响后续行为）",
    LocalApiSecurity.PublicSiteOrigin == secSavedOrigin && LocalApiSecurity.PublicSiteOrigin == "https://xhzzz314.github.io");

// v0.7.1 公开试用：预检可观察契约——OPTIONS 零副作用，不允许来源 403、允许来源 204 + CORS 回显 + PNA 头。
// 本机回环起一个只接 OPTIONS 的 HttpListener（与生产 48794/48795 走同一条 HandlePreflight 路径）。
{
    int pfPort;
    var portProbe = new System.Net.Sockets.TcpListener(System.Net.IPAddress.Loopback, 0);
    portProbe.Start();
    pfPort = ((System.Net.IPEndPoint)portProbe.LocalEndpoint).Port;
    portProbe.Stop();
    using var pfServer = new HttpListener();
    pfServer.Prefixes.Add($"http://localhost:{pfPort}/");
    pfServer.Start();
    var pfThread = new Thread(() =>
    {
        try
        {
            while (pfServer.IsListening)
            {
                HttpListenerContext ctx;
                try { ctx = pfServer.GetContext(); } catch { break; }
                if (ctx.Request.HttpMethod == "OPTIONS") LocalApiSecurity.HandlePreflight(ctx);
                else { ctx.Response.StatusCode = 200; ctx.Response.Close(); }
            }
        }
        catch { }
    });
    pfThread.Start();
    try
    {
        using var pfClient = new HttpClient { Timeout = TimeSpan.FromSeconds(5) };
        HttpRequestMessage Preflight(string? origin)
        {
            var req = new HttpRequestMessage(HttpMethod.Options, $"http://localhost:{pfPort}/preflight-probe");
            if (origin != null) req.Headers.Add("Origin", origin);
            return req;
        }
        using (var r = pfClient.Send(Preflight("https://xhzzz314.github.io")))
        {
            Check("预检：公开站点 origin → 204 + 回显 ACAO + PNA 头",
                r.StatusCode == System.Net.HttpStatusCode.NoContent
                && r.Headers.TryGetValues("Access-Control-Allow-Origin", out var aco) && aco.Contains("https://xhzzz314.github.io")
                && r.Headers.TryGetValues("Access-Control-Allow-Private-Network", out var pna) && pna.Contains("true"));
        }
        using (var r = pfClient.Send(Preflight("https://still-evil.example")))
        {
            Check("预检：陌生 origin → 403 且无 CORS 头（真请求发不出来）",
                r.StatusCode == System.Net.HttpStatusCode.Forbidden
                && !r.Headers.TryGetValues("Access-Control-Allow-Origin", out _));
        }
        using (var r = pfClient.Send(Preflight(null)))
        {
            Check("预检：无 Origin（curl/同源）→ 204 放行", r.StatusCode == System.Net.HttpStatusCode.NoContent);
        }
    }
    finally
    {
        pfServer.Stop();
        pfThread.Join(2000);
    }
}

// ==================== CORE-HTTP：请求车道分级与并发调度 ====================
Console.WriteLine("== CORE-HTTP HttpDispatchPolicy（车道分级） ==");
Check("GET /lyrics/search → 出站慢车道", HttpDispatchPolicy.LaneFor("GET", "/lyrics/search") == RequestLane.Outbound);
Check("GET /lyrics → 出站慢车道", HttpDispatchPolicy.LaneFor("GET", "/lyrics") == RequestLane.Outbound);
Check("GET /playback/status → 快车道", HttpDispatchPolicy.LaneFor("GET", "/playback/status") == RequestLane.Fast);
Check("GET /health → 快车道", HttpDispatchPolicy.LaneFor("GET", "/health") == RequestLane.Fast);
Check("GET /dancers（游戏线程诊断）→ 快车道", HttpDispatchPolicy.LaneFor("GET", "/dancers") == RequestLane.Fast);
Check("GET /debug/animstate → 快车道", HttpDispatchPolicy.LaneFor("GET", "/debug/animstate") == RequestLane.Fast);
Check("POST /playback/stop → 快车道", HttpDispatchPolicy.LaneFor("POST", "/playback/stop") == RequestLane.Fast);
Check("HEAD /lyrics → 快车道（HEAD 不走出站歌词分支）", HttpDispatchPolicy.LaneFor("HEAD", "/lyrics") == RequestLane.Fast);
Check("null method/path 安全 → 快车道", HttpDispatchPolicy.LaneFor(null, null) == RequestLane.Fast);

// 核心回归：出站歌词（≈10s 外网请求）挂起期间，停止/seek/状态必须能完成——
// 旧实现接受循环内联 await handler，一条慢歌词把后续所有请求压住（队头阻塞），
// 这些工作体在旧模型下根本不会开始。此组断言直接锁死「分车道并发」的新契约。
Console.WriteLine("== CORE-HTTP RequestDispatcher（慢歌词挂起时停止/seek/状态可完成） ==");
{
    var d = new RequestDispatcher(8, 4);
    var releaseLyrics = new TaskCompletionSource();
    var lyricsDone = new TaskCompletionSource();
    Check("慢车道接受出站歌词", d.TryAccept(RequestLane.Outbound, async () =>
    {
        await releaseLyrics.Task;   // 模拟 NetEase 外网慢请求挂起
        lyricsDone.TrySetResult();
    }));
    Check("歌词工作体已登记在途", SpinWaitUntil(() => d.InFlight == 1));

    var stopDone = new TaskCompletionSource();
    var seekDone = new TaskCompletionSource();
    var statusDone = new TaskCompletionSource();
    Check("快车道接受 stop", d.TryAccept(RequestLane.Fast, () => { stopDone.TrySetResult(); return Task.CompletedTask; }));
    Check("快车道接受 seek", d.TryAccept(RequestLane.Fast, () => { seekDone.TrySetResult(); return Task.CompletedTask; }));
    Check("快车道接受 status", d.TryAccept(RequestLane.Fast, () => { statusDone.TrySetResult(); return Task.CompletedTask; }));
    Check("stop 完成（歌词仍挂起）", stopDone.Task.Wait(TimeSpan.FromSeconds(5)));
    Check("seek 完成（歌词仍挂起）", seekDone.Task.Wait(TimeSpan.FromSeconds(5)));
    Check("status 完成（歌词仍挂起）", statusDone.Task.Wait(TimeSpan.FromSeconds(5)));
    Check("歌词仍挂起（快车道不干扰慢车道）", !lyricsDone.Task.IsCompleted);

    releaseLyrics.TrySetResult();
    Check("放行后歌词完成", lyricsDone.Task.Wait(TimeSpan.FromSeconds(5)));
    Check("全部完成后排空归零", d.WaitDrained(TimeSpan.FromSeconds(5)));
    d.Dispose();
}

Console.WriteLine("== CORE-HTTP RequestDispatcher（满员拒绝：任何车道都不排队） ==");
{
    var d = new RequestDispatcher(2, 2);
    var release = new TaskCompletionSource();
    var dones = new TaskCompletionSource[2];
    for (var i = 0; i < 2; i++)
    {
        dones[i] = new TaskCompletionSource();
        var idx = i;
        Check($"出站第 {i + 1} 个接受", d.TryAccept(RequestLane.Outbound, async () =>
        {
            await release.Task;
            dones[idx]!.TrySetResult();
        }));
    }
    Check("出站满员后第三个被拒（不排队堆积）", !d.TryAccept(RequestLane.Outbound, () => Task.CompletedTask));
    Check("拒绝未登记在途（计数仍为 2）", d.InFlight == 2);
    Check("出站满员时快车道照常接受", d.TryAccept(RequestLane.Fast, () => Task.CompletedTask));
    release.TrySetResult();
    Check("出站全部完成", dones.All(t => t.Task.Wait(TimeSpan.FromSeconds(5))));
    Check("排空归零", d.WaitDrained(TimeSpan.FromSeconds(5)));
    d.Dispose();
}
{
    var d = new RequestDispatcher(1, 4);
    var gate = new TaskCompletionSource();
    var done = new TaskCompletionSource();
    Check("快车道占满", d.TryAccept(RequestLane.Fast, async () => { await gate.Task; done.TrySetResult(); }));
    Check("快车道满员拒绝（停止路径要么立即走、要么明确 503）", !d.TryAccept(RequestLane.Fast, () => Task.CompletedTask));
    Check("快车道满员不影响出站车道", d.TryAccept(RequestLane.Outbound, () => Task.CompletedTask));
    gate.TrySetResult();
    Check("放行后排空", done.Task.Wait(TimeSpan.FromSeconds(5)) && d.WaitDrained(TimeSpan.FromSeconds(5)));
    d.Dispose();
}

Console.WriteLine("== CORE-HTTP RequestDispatcher（异常回收与 Dispose 排空） ==");
{
    var d = new RequestDispatcher(1, 1);
    var gate = new TaskCompletionSource();
    Check("接受会抛异常的工作体", d.TryAccept(RequestLane.Fast, async () =>
    {
        await gate.Task;
        throw new InvalidOperationException("boom");
    }));
    Check("工作体挂起期间占满车道", !d.TryAccept(RequestLane.Fast, () => Task.CompletedTask));
    gate.TrySetResult();
    // 工作体异常不能泄漏槽位/计数（finally 成对回收），否则一次异常就打满并发额度
    Check("异常后槽位回收（可再次接受）", SpinWaitUntil(() => d.TryAccept(RequestLane.Fast, () => Task.CompletedTask)));
    Check("异常后排空归零", d.WaitDrained(TimeSpan.FromSeconds(5)));
    d.Dispose();
}
{
    var d = new RequestDispatcher(4, 4);
    var gate = new TaskCompletionSource();
    Check("接受挂起工作体", d.TryAccept(RequestLane.Outbound, async () => { await gate.Task; }));
    Check("在途已登记", SpinWaitUntil(() => d.InFlight == 1));
    Check("有在途时短等待排空返回 false", !d.WaitDrained(TimeSpan.FromMilliseconds(50)));
    gate.TrySetResult();
    Check("完成后排空返回 true", d.WaitDrained(TimeSpan.FromSeconds(5)));
    d.Dispose();
}
{
    // 并发压入：36 个请求（32 快 + 4 出站）全部接受且计数精确归零（服务长期运行场景）
    var d = new RequestDispatcher(32, 4);
    var counter = 0;
    const int N = 36;
    var accepted = 0;
    for (var i = 0; i < N; i++)
    {
        var lane = i % 9 == 0 ? RequestLane.Outbound : RequestLane.Fast;
        if (d.TryAccept(lane, () => { System.Threading.Interlocked.Increment(ref counter); return Task.CompletedTask; }))
            accepted++;
    }
    Check("36 个请求全部接受（32 快 + 4 出站）", accepted == N);
    Check("并发压入后全部完成且排空",
        d.WaitDrained(TimeSpan.FromSeconds(10)) && System.Threading.Volatile.Read(ref counter) == N);
    d.Dispose();
}

// ==================== FIX-J：插件线程、生命周期与恢复 ====================
// PLUG-7：命令节流抽成纯策略（GameCommandExecutor 内 DateTime.Now 墙钟无法在单测里
// 复现停摆/连发，故把判定抽为可测件，接线处只喂 Environment.TickCount64 单调毫秒）。
Console.WriteLine("== FIX-J PLUG-7 CommandThrottlePolicy（单调节流边界） ==");
{
    var p = new CommandThrottlePolicy(200);
    Check("首个命令立即放行（不受陈旧基准限制）", p.AllowNow(1_000_000));
    p.OnExecuted(1_000_000);
    Check("间隔内（199ms）拦截", !p.AllowNow(1_000_000 + 199));
    Check("恰好 200ms 放行（与旧 elapsed>=间隔口径一致）", p.AllowNow(1_000_000 + 200));
    p.OnExecuted(1_000_000 + 200);
    Check("紧邻下一窗口内（399ms）拦截", !p.AllowNow(1_000_000 + 399));
    Check("长间隔后放行", p.AllowNow(9_999_999));
    // 墙钟问题的单测等价物：时钟不动/倒退的 delta 永远不满足间隔（安全侧拦截）——
    // 单调轴上不存在“回拨 1 小时 = 节流停摆 1 小时、前跳 1 小时 = 瞬间连发”（PLUG-7 机制）
    var q = new CommandThrottlePolicy(200);
    q.OnExecuted(5_000);
    Check("时钟未前进（delta 0）→ 拦截不误放", !q.AllowNow(5_000));
    Check("时钟倒退（delta 负）→ 拦截不误放", !q.AllowNow(4_000));
    Check("零间隔策略恒放行", new CommandThrottlePolicy(0).AllowNow(42));
    Check("负间隔按 0 处理恒放行", new CommandThrottlePolicy(-5).AllowNow(42));
}

Console.WriteLine("== FIX-J PLUG-6 已接受请求的调度不可被取消跳过 ==");
{
    // 复现泄漏机制（ExportServer 旧 ListenLoop 的调度形态）：Task.Run(work, ct) 在 ct
    // 已取消时整体跳过工作体——Begin() 之后这样调度，finally 不会执行 → 在途计数泄漏，
    // Dispose 排空陪葬。契约（RequestDispatcher 同源）：已接受的请求绝不带取消令牌调度。
    using var cts = new CancellationTokenSource();
    cts.Cancel();
    var ran = false;
    var skipped = Task.Run(() => ran = true, cts.Token);
    var waitThrew = false;
    try { skipped.Wait(TimeSpan.FromSeconds(5)); } catch (AggregateException) { waitThrew = true; }
    Check("复现：已取消令牌的 Task.Run 整体跳过工作体（finally 不会执行）", !ran && (skipped.IsCanceled || waitThrew));

    var tr = new InFlightTracker();
    var h = tr.Begin();   // 模拟 Begin 后工作体被取消跳过：句柄永远无人释放
    Check("泄漏后果：句柄无人释放 → 排空永不归零", !tr.WaitDrained(TimeSpan.FromMilliseconds(50)));
    h.Dispose();

    // 修复契约：接受后不带令牌调度，工作体必达、finally 必执行、排空必归零
    var ran2 = false;
    var tr2 = new InFlightTracker();
    var h2 = tr2.Begin();
    var fixedRun = Task.Run(() => { try { ran2 = true; } finally { h2.Dispose(); } });
    Check("修复：无令牌调度工作体必达且排空归零",
        fixedRun.Wait(TimeSpan.FromSeconds(5)) && ran2 && tr2.WaitDrained(TimeSpan.FromSeconds(5)));
}

// PLUG-1 契约的可测面：HEAD 与 GET 同走快车道（真正的路由修复在 HttpServer 分支内，
// 需要 Dalamud 依赖无法单测——分支处 HEAD 已与 GET 同进框架线程调度路径，实机 curl 验证）
Check("PLUG-1 契约：HEAD 游戏线程诊断走快车道（不走出站分支）",
    HttpDispatchPolicy.LaneFor("HEAD", "/debug/animstate") == RequestLane.Fast
    && HttpDispatchPolicy.LaneFor("HEAD", "/dancers") == RequestLane.Fast);

// ==================== EXEC-CORE：安全演出执行器（docs/DESIGN-game-executor.md §10） ====================
// 设计文档要求先做游戏无关单测（假时钟调度、状态机、守卫），再接 Dalamud。以下全部纯逻辑：
// 协议解析/校验、调度不变式（帧率无关、每条一次、优先级）、状态机（倒计时/幂等停/故障停）、
// 五分钟虚拟演出无累计漂移。游戏适配器（GameShowDispatcher/HTTP 分支）是 Dalamud 绑定层，
// 与 FIX-J 同口径：从代码证据 + 已实机验证的模式复用建立机制，实机验收留给主人。
Console.WriteLine("== EXEC-CORE ShowProtocolParser（形状/整数毫秒/上限） ==");
{
    var pkgJson = "{\"protocolVersion\":1,\"compiler\":\"web-test\",\"projectId\":\"p1\",\"name\":\"测试演出\"," +
        "\"durationMs\":10000,\"timelineRevision\":7,\"projectHash\":\"abc\"," +
        "\"performers\":[{\"id\":\"p1\",\"name\":\"舞者\"}]," +
        "\"events\":[" +
        "{\"id\":\"e1\",\"performerId\":\"p1\",\"kind\":\"motion\",\"startMs\":1000,\"durationMs\":500,\"command\":\"/bow motion\",\"name\":\"鞠躬\"}," +
        "{\"id\":\"e2\",\"kind\":\"lyrics\",\"startMs\":2500,\"durationMs\":2000,\"command\":\"\"}]}";
    var r = ShowProtocolParser.Parse(System.Text.Json.JsonDocument.Parse(pkgJson).RootElement);
    Check("合法包解析成功", r.Error == null && r.Package != null);
    var p = r.Package!;
    Check("标量字段保留", p.ProtocolVersion == 1 && p.Name == "测试演出" && p.TimelineRevision == 7 && p.ProjectHash == "abc");
    Check("事件逐条解析（2 条）", p.Events.Count == 2 && p.Performers.Count == 1);
    Check("motion 命令保留", p.Events[0].Command == "/bow motion" && p.Events[0].PerformerId == "p1");
    Check("歌词事件无 performerId 合法", p.Events[1].PerformerId == "" && p.Events[1].Kind == "lyrics");

    ShowParseResult ParseErr(string json)
    {
        var rr = ShowProtocolParser.Parse(System.Text.Json.JsonDocument.Parse(json).RootElement);
        Check("拒绝：" + json.Substring(0, Math.Min(46, json.Length)) + "…", rr.Error != null && rr.Package == null);
        return rr;
    }
    ParseErr("{\"protocolVersion\":1,\"events\":[]}");
    ParseErr("{\"protocolVersion\":0,\"events\":[]}");
    ParseErr("{\"protocolVersion\":1.5,\"events\":[]}");
    ParseErr("{\"protocolVersion\":1}");
    ParseErr("{\"protocolVersion\":1,\"events\":{}}");
    ParseErr("{\"protocolVersion\":1,\"events\":[{\"id\":\"e1\",\"kind\":\"motion\",\"startMs\":1.5}]}");
    ParseErr("{\"protocolVersion\":1,\"events\":[{\"id\":\"e1\",\"kind\":\"motion\",\"startMs\":-5}]}");
    ParseErr("{\"protocolVersion\":1,\"events\":[{\"id\":\"e1\",\"kind\":\"motion\",\"durationMs\":-1}]}");
    ParseErr("{\"protocolVersion\":1,\"events\":[{\"id\":\"e1\",\"kind\":\"teleport\",\"startMs\":0}]}");
    ParseErr("{\"protocolVersion\":1,\"events\":[{\"id\":\"e1\",\"kind\":\"motion\",\"startMs\":0},{\"id\":\"e1\",\"kind\":\"cue\",\"startMs\":1}]}");
    ParseErr("{\"protocolVersion\":1,\"events\":[{\"kind\":\"motion\",\"startMs\":0}]}");
    var big = new System.Text.StringBuilder("{\"protocolVersion\":1,\"durationMs\":0,\"events\":[");
    for (var i = 0; i <= ShowProtocol.MaxEvents; i++)
        big.Append("{\"id\":\"e").Append(i).Append("\",\"kind\":\"cue\",\"startMs\":0,\"durationMs\":0},");
    big.Length--; big.Append("]}");
    var bigErr = ParseErr(big.ToString());
    Check("拒绝：事件数超过上限（" + ShowProtocol.MaxEvents + "）",
        bigErr.Error != null && bigErr.Error.Contains("上限"), bigErr.Error);
}

Console.WriteLine("== EXEC-CORE ShowValidator（能力/执行器面/单角色/命令闸） ==");
{
    ShowEvent Se(string id, string kind, long start, string cmd = "", string performer = "p1") =>
        new() { Id = id, Kind = kind, StartMs = start, DurationMs = 500, Command = cmd, PerformerId = performer };

    ShowPackage Pkg(params ShowEvent[] evs)
    {
        var p = new ShowPackage { ProtocolVersion = 1, DurationMs = 100000 };
        p.Events.AddRange(evs);
        return p;
    }
    ShowValidation V(ShowPackage p) => ShowValidator.Validate(p);

    var good = Pkg(Se("e1", "motion", 0, "/bow motion"), Se("e2", "lyrics", 1000), Se("e3", "cue", 2000));
    Check("动作+歌词+提示单演员包通过", V(good).Ok);

    var cap = new ShowPackage { ProtocolVersion = 1, DurationMs = 10000 };
    cap.Events.Add(Se("e1", "cue", 0));
    cap.Capabilities.Add(new ShowCapability { Name = "movement-control" });
    var vcap = V(cap);
    Check("能力要求 movement-control → 拒绝并说明未实装",
        !vcap.Ok && vcap.Issues.Any(i => i.Code == "E_CAPABILITY_UNSUPPORTED" && i.Message.Contains("移动")));
    cap.Capabilities.Clear();
    cap.Capabilities.Add(new ShowCapability { Name = "ability-execution" });
    Check("能力要求 ability-execution → 拒绝并说明未实装",
        !V(cap).Ok && V(cap).Issues.Any(i => i.Code == "E_CAPABILITY_UNSUPPORTED"));

    var proto = new ShowPackage { ProtocolVersion = 99, DurationMs = 10000 };
    proto.Events.Add(Se("e1", "cue", 0));
    Check("协议版本过新 → 拒绝", !V(proto).Ok && V(proto).Issues.Any(i => i.Code == "E_PROTOCOL_NEW"));

    Check("movement 事件 → 无执行器拒绝", !V(Pkg(Se("e1", "movement", 0))).Ok);
    Check("facing 事件 → 无执行器拒绝", !V(Pkg(Se("e1", "facing", 0))).Ok);
    Check("ability 事件 → 无执行器拒绝", !V(Pkg(Se("e1", "ability", 0))).Ok);
    Check("错误文案带事件数（2 条 movement）",
        V(Pkg(Se("e1", "movement", 0), Se("e2", "movement", 999))).FirstError!.Contains("2 条"));

    Check("两位演员的 motion 混包 → 拒绝（ACTOR 同口径）",
        !V(Pkg(Se("e1", "motion", 0, "/bow motion", "p1"), Se("e2", "motion", 500, "/wave motion", "p2"))).Ok);
    Check("motion 缺演员归属 → 拒绝", !V(Pkg(Se("e1", "motion", 0, "/bow motion", ""))).Ok);
    Check("motion 空命令 → 拒绝", !V(Pkg(Se("e1", "motion", 0, ""))).Ok);
    Check("motion 命令不过安全策略 → 拒绝", !V(Pkg(Se("e1", "motion", 0, "bow motion"))).Ok);
    Check("歌词空命令合法（本地显示语义）", V(Pkg(Se("e1", "lyrics", 0))).Ok);
    Check("歌词危险命令 → 拒绝", !V(Pkg(Se("e1", "lyrics", 0, "/say a;/say b"))).Ok);

    var over = new ShowPackage { ProtocolVersion = 1, DurationMs = 1000 };
    over.Events.Add(Se("e1", "motion", 900, "/bow motion"));
    over.Events[0].DurationMs = 500;
    Check("事件超出声明时长 → 拒绝", !V(over).Ok && V(over).Issues.Any(i => i.Code == "E_EVENT_OVEREND"));
    Check("校验结果 FirstError 是中文", V(Pkg(Se("e1", "movement", 0))).FirstError != null
        && V(Pkg(Se("e1", "movement", 0))).FirstError!.Any(ch => ch >= 0x4E00 && ch <= 0x9FFF));
}

Console.WriteLine("== EXEC-CORE EventScheduler（预编译队列/优先级/每条一次） ==");
{
    ShowEvent Se(string id, string kind, long start) =>
        new() { Id = id, Kind = kind, StartMs = start, DurationMs = 100 };
    List<string> DrainAll(EventScheduler s, long untilMs, long stepMs)
    {
        var order = new List<string>();
        var due = new List<ShowEvent>();
        for (var t = 0L; t <= untilMs; t += stepMs)
        {
            due.Clear();
            s.CollectDue(t, due);
            order.AddRange(due.Select(e => e.Id));
        }
        return order;
    }

    var evs = new List<ShowEvent>
    {
        Se("a-motion", "motion", 1000), Se("b-cue", "cue", 1000), Se("c-lyrics", "lyrics", 1000),
        Se("d-motion", "motion", 500), Se("e-ability", "ability", 1000),
        Se("f-movement", "movement", 1000), Se("g-facing", "facing", 1000), Se("h-motion", "motion", 3000),
    };
    var s1 = new EventScheduler(evs);
    var order60 = DrainAll(s1, untilMs: 5000, stepMs: 16);
    Check("到点事件每条恰好发送一次", order60.Count == evs.Count && order60.Distinct().Count() == evs.Count);
    Check("不同时刻按 startMs 升序", order60.IndexOf("d-motion") < order60.IndexOf("a-motion")
        && order60.IndexOf("a-motion") < order60.IndexOf("h-motion"));
    Check("同刻按优先级（朝向>移动>技能>动作>提示>歌词）",
        order60.GetRange(order60.IndexOf("g-facing"), 6).SequenceEqual(
            new[] { "g-facing", "f-movement", "e-ability", "a-motion", "b-cue", "c-lyrics" }));
    Check("游标余量归零", s1.Remaining == 0 && s1.NextDueMs == null);
    var dueAfterEnd = new List<ShowEvent>();
    s1.CollectDue(999999, dueAfterEnd);
    Check("结束后不再收集", dueAfterEnd.Count == 0);

    // 帧率无关（设计文档 §10）：同一批事件，60fps 步进 / 500ms 粗步进 / 一帧到底，发送序列完全一致
    var order500 = DrainAll(new EventScheduler(evs), 5000, 500);
    var orderOnce = DrainAll(new EventScheduler(evs), 60000, 60000); // 单帧采样到 60s：一帧收完全部
    Check("帧率无关：16ms/500ms/单帧的发送顺序一致",
        order60.SequenceEqual(order500) && order60.SequenceEqual(orderOnce));

    var sLead = new EventScheduler(new List<ShowEvent> { Se("x", "motion", 1000) }, dispatchLeadMs: 200);
    var dueLead = new List<ShowEvent>();
    sLead.CollectDue(799, dueLead);
    Check("提前量：799ms 未到（lead 200）", dueLead.Count == 0);
    sLead.CollectDue(800, dueLead);
    Check("提前量：800ms 恰好应发", dueLead.Count == 1);
    sLead.Reset();
    Check("Reset 后游标归零", sLead.Remaining == 1);
}

Console.WriteLine("== EXEC-CORE RuntimeGuard（停止条件判定与优先级） ==");
{
    GuardCode Eval(Action<GuardSnapshot> set)
    {
        var s = new GuardSnapshot();
        set(s);
        return RuntimeGuard.Evaluate(s);
    }
    Check("干净快照 → None", Eval(_ => { }) == GuardCode.None);
    Check("角色消失 → CharacterLost", Eval(s => s.CharacterPresent = false) == GuardCode.CharacterLost);
    Check("换图 → TerritoryChanged", Eval(s => s.TerritoryChanged = true) == GuardCode.TerritoryChanged);
    Check("过场 → Cutscene", Eval(s => s.InCutscene = true) == GuardCode.Cutscene);
    Check("战斗 → InCombat", Eval(s => s.InCombat = true) == GuardCode.InCombat);
    Check("不可控 → Uncontrollable", Eval(s => s.Uncontrollable = true) == GuardCode.Uncontrollable);
    Check("手动接管 → ManualTakeover", Eval(s => s.ManualTakeover = true) == GuardCode.ManualTakeover);
    Check("适配器失败 → AdapterFailure", Eval(s => s.AdapterFailure = true) == GuardCode.AdapterFailure);
    Check("移动误差超限 → MovementError", Eval(s => s.MovementErrorOverLimit = true) == GuardCode.MovementError);
    Check("时钟倒流 → ClockJump", Eval(s => s.FrameDeltaMs = -1) == GuardCode.ClockJump);
    Check("单帧跨度过大 → ClockJump", Eval(s => s.FrameDeltaMs = 5001) == GuardCode.ClockJump);
    Check("恰好阈值不算跳变（> 口径）", Eval(s => s.FrameDeltaMs = 5000) == GuardCode.None);
    Check("优先级：角色消失压过战斗",
        Eval(s => { s.CharacterPresent = false; s.InCombat = true; }) == GuardCode.CharacterLost);
    Check("优先级：战斗压过时钟跳变",
        Eval(s => { s.InCombat = true; s.FrameDeltaMs = 999999; }) == GuardCode.InCombat);
    Check("null 快照按适配器失败处理", RuntimeGuard.Evaluate(null) == GuardCode.AdapterFailure);
    Check("中文原因可读", RuntimeGuard.Describe(GuardCode.CharacterLost) == "本地角色消失");
}

Console.WriteLine("== EXEC-CORE ShowRunner（状态机/倒计时/守卫/幂等停） ==");
{
    ShowEvent Se(string id, string kind, long start, string cmd = "/bow motion") =>
        new() { Id = id, Kind = kind, StartMs = start, DurationMs = 500, Command = cmd, PerformerId = "p1" };
    ShowPackage Pkg(params ShowEvent[] evs)
    {
        var p = new ShowPackage { ProtocolVersion = 1, Name = "测试", DurationMs = 30000 };
        p.Events.AddRange(evs);
        return p;
    }
    ShowPackage SimpleShow() => Pkg(Se("e1", "motion", 500), Se("e2", "motion", 1500), Se("e3", "lyrics", 2000, ""));

    // ---- 状态规则（409 语义：只有 Armed 能开始）----
    var disp = new FakeShowDispatcher();
    var t = 1000L;
    var runner = new ShowRunner(disp, () => t);
    // X1 fail-closed 后，执行中采集不可用即故障停——夹具一律显式挂健康采集（下同）
    runner.SetGuardProvider(() => new GuardSnapshot());
    Check("初始 Idle", runner.State == ShowState.Idle);
    Check("Idle 不能 Start", !runner.Start().Ok);
    Check("Idle 不能 Arm", !runner.Arm().Ok);
    runner.RequestStop("Idle 停止");
    Check("Idle 可以 Stop（幂等无害）", runner.State == ShowState.Idle);
    var loadOk = runner.Load(SimpleShow());
    Check("Load 成功进入 Loaded", loadOk.Ok && runner.State == ShowState.Loaded);
    Check("Loaded 不能 Start（必须先 Arm）", !runner.Start().Ok);
    Check("Arm 成功进入 Armed", runner.Arm().Ok && runner.State == ShowState.Armed);
    var startR = runner.Start(1000);
    Check("Armed 才能 Start，进入 Countdown", startR.Ok && runner.State == ShowState.Countdown && startR.CountdownMs == 1000);
    Check("执行中 Load 被拒绝", !runner.Load(Pkg()).Ok);
    Check("执行中 Unload 被拒绝", !runner.Unload().Ok);

    // ---- 倒计时 → 播放 → 事件按计划时刻分发 → 完结 ----
    t += 999; runner.Tick();
    Check("倒计时未到不开演", runner.State == ShowState.Countdown && runner.DispatchedCount == 0);
    t += 1; runner.Tick(); // 恰好到点
    Check("倒计时到点进入 Playing", runner.State == ShowState.Playing);
    Check("开演时刻 showTime 从 0 起", runner.ShowTimeMs == 0);
    t += 499; runner.Tick();
    Check("showTime 499：早于首个事件不发送", runner.ShowTimeMs == 499 && runner.DispatchedCount == 0);
    t += 1; runner.Tick(); // showTime 500 = e1.startMs
    Check("showTime 500：e1 按计划时刻发送", runner.DispatchedCount == 1 && disp.Dispatched[^1].Id == "e1");
    t += 1000; runner.Tick(); // showTime 1500
    Check("showTime 1500：e2 发送", runner.DispatchedCount == 2 && disp.Dispatched[^1].Id == "e2");
    t += 500; runner.Tick(); // showTime 2000：e3 歌词
    Check("showTime 2000：歌词发送", runner.DispatchedCount == 3 && disp.Dispatched[^1].Id == "e3");
    for (var i = 0; i < 28; i++) { t += 1000; runner.Tick(); } // 分帧推进（单帧跨度过大会触守卫）
    Check("发完且到时长 → Completed", runner.State == ShowState.Completed);
    Check("完成也做清扫（清队列/退定格）", disp.StopCalls >= 1);
    Check("StatusJson 可解析且含执行进度",
        System.Text.Json.JsonDocument.Parse(runner.StatusJson()).RootElement.GetProperty("state").GetString() == "completed");

    // ---- 完成后重演：Arm 重置，Start 重发 ----
    Check("Completed 不能直接 Start（须重新 Arm）", !runner.Start().Ok);
    Check("Completed 可重新 Arm", runner.Arm().Ok && runner.DispatchedCount == 0);
    runner.Start(0); runner.Tick();
    Check("重演从零开始计时（倒计时 0 立即开演）", runner.State == ShowState.Playing);
    for (var i = 0; i < 30; i++) { t += 1000; runner.Tick(); }
    Check("重演再次完整发送（3 条）", runner.DispatchedCount == 3 && runner.State == ShowState.Completed);

    // ---- 倒计时中紧急停止 → Loaded（演出保留），停止幂等 ----
    runner.Arm(); runner.Start(10000);
    t += 100; runner.Tick();
    Check("倒计时中正在倒计时", runner.State == ShowState.Countdown);
    runner.RequestStop("网页紧急停止");
    Check("倒计时中停止 → Loaded（可重新就绪）", runner.State == ShowState.Loaded);
    var stopsAfterFirst = disp.StopCalls;
    runner.RequestStop("重复停止");
    Check("重复停止幂等（Loaded 无可停之物，清扫不重复触发）",
        runner.State == ShowState.Loaded && disp.StopCalls == stopsAfterFirst);
    Check("停止后可重新就绪", runner.Arm().Ok);
    Check("重新开演", runner.Start(0).Ok);
    runner.Tick();
    Check("倒计时 0 一帧即开演", runner.State == ShowState.Playing);

    // ---- 播放中紧急停止：已发的前缀保留、未发的事件取消 ----
    t += 400; runner.Tick(); // showTime 400 < 500：还没发
    runner.RequestStop("播放中停止");
    Check("播放中停止 → Loaded", runner.State == ShowState.Loaded);
    var dispatchedAtStop = disp.Dispatched.Count;
    t += 100000; runner.Tick();
    Check("停止后 Tick 不再发送事件", disp.Dispatched.Count == dispatchedAtStop);
    Check("清扫精确计数（完成 2 + 倒计时停 1 + 播放停 1）", disp.StopCalls == 4);

    // ---- 守卫触发 → Faulted（带中文原因）----
    {
        var guardState = new GuardSnapshot();
        var r2 = new ShowRunner(new FakeShowDispatcher(), () => t);
        r2.SetGuardProvider(() => guardState);
        r2.Load(Pkg(Se("e1", "motion", 0)));
        r2.Arm(); r2.Start(0); r2.Tick(); // 开演
        Check("守卫干净时正常执行", r2.State == ShowState.Playing);
        guardState.CharacterPresent = false;
        t += 100; r2.Tick();
        Check("角色消失 → Faulted", r2.State == ShowState.Faulted);
        Check("故障原因中文可读（角色消失）", r2.StopReason.Contains("本地角色消失"));
        Check("Faulted 后重新 Arm 可恢复", r2.Arm().Ok);
        guardState.CharacterPresent = true;
        guardState.InCombat = true;
        r2.Start(0); r2.Tick(); t += 100; r2.Tick();
        Check("进战斗 → Faulted（战斗原因）", r2.State == ShowState.Faulted && r2.StopReason.Contains("战斗"));
        guardState.InCombat = false;
        // 时钟跳变：单帧跨度过大
        r2.Arm(); r2.Start(0); r2.Tick();
        t += ShowRunner.ClockJumpThresholdMs + 1; r2.Tick();
        Check("时钟跳变 → Faulted", r2.State == ShowState.Faulted && r2.StopReason.Contains("时钟跳变"));
    }

    // ---- 执行器异常/失败策略 ----
    {
        var boom = new FakeShowDispatcher { OnDispatch = e => e.Kind == "motion" && e.Id == "e1"
            ? ShowDispatchResult.Fail("命令被游戏拒绝")
            : ShowDispatchResult.Success() };
        var r3 = new ShowRunner(boom, () => t);
        r3.SetGuardProvider(() => new GuardSnapshot());
        r3.Load(Pkg(Se("e1", "motion", 0), Se("e2", "motion", 1000)));
        r3.Arm(); r3.Start(0); r3.Tick(); // 倒计时 0：本帧只做 Countdown→Playing 转换
        t += 100; r3.Tick();              // 下一帧才分发：e1 失败 → 停整场
        Check("动作失败 → 停整场（Faulted）", r3.State == ShowState.Faulted && r3.StopReason.Contains("e1"));
        Check("动作失败不再发送后续", boom.Dispatched.Count == 1);

        var skipLyrics = new FakeShowDispatcher { OnDispatch = e => e.Kind == "lyrics"
            ? ShowDispatchResult.Fail("提示通道不可用")
            : ShowDispatchResult.Success() };
        var r4 = new ShowRunner(skipLyrics, () => t);
        r4.SetGuardProvider(() => new GuardSnapshot());
        r4.Load(Pkg(Se("e1", "motion", 0), Se("e2", "lyrics", 500, ""), Se("e3", "motion", 1000)));
        r4.Arm(); r4.Start(0); r4.Tick(); // 转换帧
        t += 1100; r4.Tick();             // 发送帧：三条全部到点
        Check("歌词/提示失败只跳过不停演", r4.State == ShowState.Playing && r4.DispatchedCount == 3);
        for (var i = 0; i < 30; i++) { t += 1000; r4.Tick(); }
        Check("跳过后照常完成", r4.State == ShowState.Completed);

        var throws = new FakeShowDispatcher { OnDispatch = _ => throw new InvalidOperationException("boom") };
        var r5 = new ShowRunner(throws, () => t);
        r5.SetGuardProvider(() => new GuardSnapshot());
        r5.Load(Pkg(Se("e1", "motion", 0)));
        r5.Arm(); r5.Start(0); r5.Tick(); // 转换帧
        t += 100; r5.Tick();              // 发送帧：e1 抛异常
        Check("执行器抛异常 → Faulted 不崩", r5.State == ShowState.Faulted);
        r5.Tick();
        Check("Faulted 后 Tick 兜底不再恶化", r5.State == ShowState.Faulted);
    }

    // ---- Unload / 重新装载 ----
    {
        var r6 = new ShowRunner(new FakeShowDispatcher(), () => t);
        r6.SetGuardProvider(() => new GuardSnapshot());
        r6.Load(Pkg(Se("e1", "motion", 0)));
        r6.Arm();
        var u = r6.Unload();
        Check("就绪未执行可卸载回 Idle", u.Ok && r6.State == ShowState.Idle);
        Check("卸载后可装载新演出", r6.Load(Pkg(Se("n1", "motion", 0))).Ok);
    }

    // ---- 五分钟虚拟演出：无累计漂移（设计文档 §10）----
    {
        var fiveMin = new ShowPackage { ProtocolVersion = 1, DurationMs = 300000 };
        for (var i = 1; i <= 300; i++)
            fiveMin.Events.Add(new ShowEvent { Id = "e" + i, Kind = "motion", PerformerId = "p1",
                StartMs = i * 1000, DurationMs = 900, Command = "/bow motion" });
        long vT = 0;
        var plannedAt = new List<long>();
        var dispatchAt = new List<long>();
        ShowRunner? vrRef = null;
        var vDisp = new FakeShowDispatcher { OnDispatch = e =>
        {
            plannedAt.Add(e.StartMs);
            dispatchAt.Add(vrRef!.ShowTimeMs); // Tick 重入锁（同线程），读到的就是本帧发送时刻
            return ShowDispatchResult.Success();
        } };
        var vr = new ShowRunner(vDisp, () => vT);
        vr.SetGuardProvider(() => new GuardSnapshot());
        vrRef = vr;
        vr.Load(fiveMin); vr.Arm(); vr.Start(0); vr.Tick(); // showTime 0
        for (var frame = 1; frame <= 20_000 && vr.State != ShowState.Completed; frame++)
        {
            vT += 16; // 60fps 假时钟：每帧只推 16ms，发送时刻永远由绝对时钟决定
            vr.Tick();
        }
        Check("300 秒/300 事件演出完整执行（Completed）", vr.State == ShowState.Completed);
        Check("全部 300 条恰好发送一次", vDisp.Dispatched.Count == 300
            && vDisp.Dispatched.Select(e => e.Id).Distinct().Count() == 300);
        Check("从不早发（发送时刻 ≥ 计划时刻）",
            dispatchAt.Zip(plannedAt, (at, pl) => at >= pl).All(x => x));
        Check("抖动有界（≤ 单帧 16ms，无链式延迟累计漂移）",
            dispatchAt.Zip(plannedAt, (at, pl) => at - pl).Max() <= 16);
        // 帧率无关复证：同一场演出用 200ms 粗帧重演，发送顺序完全一致
        long vT2 = 0;
        var vDisp2 = new FakeShowDispatcher();
        var vr2 = new ShowRunner(vDisp2, () => vT2);
        vr2.SetGuardProvider(() => new GuardSnapshot());
        vr2.Load(fiveMin); vr2.Arm(); vr2.Start(0); vr2.Tick();
        for (var frame = 1; frame <= 1_700 && vr2.State != ShowState.Completed; frame++)
        {
            vT2 += 200;
            vr2.Tick();
        }
        Check("粗帧（200ms）重演发送顺序与细帧一致",
            vDisp.Dispatched.Select(e => e.Id).SequenceEqual(vDisp2.Dispatched.Select(e => e.Id)));
        Check("粗帧同样完整完成", vr2.State == ShowState.Completed);
    }
}

// ---- GAMECLOCK：enriched /playback/status 纯构造（TASK-20260831 AC-1） ----
Console.WriteLine("== GAMECLOCK PlaybackStatusV2（enriched status 纯构造/能力注入） ==");
{
    var legacyShape = PlaybackStatusV2.BuildJson(false, 0f, 0, 1f, 0f, 0);
    Check("旧字段字节兼容：停止态前缀 = {\"playing\":false,\"time\":0.0",
        legacyShape.StartsWith("{\"playing\":false,\"time\":0.0,"), legacyShape);
    var j = PlaybackStatusV2.BuildJson(true, 12.34f, 7, 1.5f, 42.25f, 1234567890123L);
    Check("含 revision/speed/maxEnd/stampMs 新字段",
        j.Contains("\"revision\":7") && j.Contains("\"speed\":1.5") && j.Contains("\"maxEnd\":42.2")
        && j.Contains("\"stampMs\":1234567890123"), j);
    Check("time 保持 F1 精度（12.34 → 12.3）", j.Contains("\"time\":12.3,"), j);
    Check("毫秒精度单调戳原样入载荷（长整型不被截断）", j.EndsWith("1234567890123}"));
    Check("布尔小写字节兼容", PlaybackStatusV2.BuildJson(true, 1f, 1, 1f, 1f, 1).StartsWith("{\"playing\":true,"));
    Check("纯函数确定性：同输入同输出", PlaybackStatusV2.BuildJson(true, 3.45f, 2, 0.5f, 9f, 5)
        == PlaybackStatusV2.BuildJson(true, 3.45f, 2, 0.5f, 9f, 5));

    var caps = "{\"app\":\"ChoreoHelper\",\"capabilities\":[\"playback\",\"recording\"]}";
    var withV2 = PlaybackStatusV2.WithCapabilities(caps, "statusV2");
    Check("能力注入：statusV2 追加进 capabilities 数组", withV2.Contains("\"statusV2\"") && withV2.Contains("\"playback\""), withV2);
    Check("能力注入幂等：已有 statusV2 原样返回",
        PlaybackStatusV2.WithCapabilities(withV2, "statusV2") == withV2);
    Check("坏 JSON 原样返回不抛", PlaybackStatusV2.WithCapabilities("not-json{", "statusV2") == "not-json{");
    Check("无 capabilities 字段原样返回",
        PlaybackStatusV2.WithCapabilities("{\"app\":\"x\"}", "statusV2") == "{\"app\":\"x\"}");
}

// ---- GAMECLOCK：ClipCompare 纯比较器（AC-5）+ 审核报告整形（AC-6） ----
Console.WriteLine("== GAMECLOCK ClipCompare（归一化对齐/逐骨偏差/热点/报告） ==");
{
    // 造一份 2 骨 clip：主骨大幅摆动（0→1.2 rad），次骨静止
    static AnimClipData MakeClip(string name, float dur, float swing, int samples, float phase = 0f)
    {
        var q1 = new List<float[]>();
        var t1 = new List<float[]> { new float[] { 0f, 0f, 1.4f, 0f } };
        for (var i = 0; i < samples; i++)
        {
            var t = dur * i / (samples - 1);
            var ang = swing * MathF.Sin((t / dur) * MathF.PI + phase); // 起止同位、中间最大摆幅
            var q = Quaternion.CreateFromAxisAngle(Vector3.UnitX, ang);
            q1.Add(new[] { t, q.X, q.Y, q.Z, q.W });
        }
        return new AnimClipData
        {
            name = name,
            duration = dur,
            type = "once",
            bones = new Dictionary<string, BoneChannel>
            {
                ["bone_main"] = new() { q = q1, t = t1 },
                ["bone_still"] = new() { q = new List<float[]> { new[] { 0f, 0f, 0f, 0f, 1f }, new[] { dur, 0f, 0f, 0f, 1f } },
                    t = new List<float[]> { new[] { 0f, 0f, 0.1f, 0f }, new[] { dur, 0f, 0.1f, 0f } } },
            }
        };
    }

    // (a) 完全一致 → 偏差为 0
    var baseClip = MakeClip("a", 3f, 1.2f, 20);
    var rSame = ClipCompare.Compare(baseClip, MakeClip("a", 3f, 1.2f, 20));
    Check("完全一致 → verdict=match 且偏差为 0",
        rSame.Verdict == "match" && rSame.Aggregate == 0f && rSame.MaxRotDeltaRad == 0f && rSame.MaxTransDeltaM == 0f,
        $"agg={rSame.Aggregate}");

    // (b) 同动作小幅时间偏移（采样点错开）→ 容差内通过
    var rOffset = ClipCompare.Compare(baseClip, MakeClip("a", 3.06f, 1.2f, 23));
    Check("小幅时间偏移/不同采样率 → 容差内 match",
        rOffset.Verdict == "match", $"agg={rOffset.Aggregate} rot={rOffset.MaxRotDeltaRad}");

    // (c) 不同动作（另一根骨大幅动）→ fail 且热点骨点名
    var wrong = MakeClip("c", 3f, 1.2f, 20);
    wrong.bones["bone_still"] = new BoneChannel
    {
        q = new List<float[]> { new[] { 0f, 0f, 0f, 0f, 1f }, new[] { 1.5f, 0.3826834f, 0f, 0f, 0.9238795f }, new[] { 3f, 0f, 0f, 0f, 1f } },
        t = new List<float[]> { new[] { 0f, 0f, 0.1f, 0f }, new[] { 3f, 0f, 0.1f, 0f } },
    };
    var rWrong = ClipCompare.Compare(baseClip, wrong);
    Check("不同动作 → deviation", rWrong.Verdict == "deviation", $"agg={rWrong.Aggregate}");
    Check("热点骨点名（bone_still 在列且排前）",
        rWrong.Hotspots.Count > 0 && rWrong.Hotspots[0].Bone == "bone_still",
        string.Join(",", rWrong.Hotspots.Select(h => h.Bone)));

    // (d) 稀疏/不规则采样确定性：同形状两种采样各自与基准比 → 判定一致、无 NaN
    var sparseA = ClipCompare.Compare(baseClip, MakeClip("d", 3f, 1.2f, 5));
    var sparseB = ClipCompare.Compare(baseClip, MakeClip("d", 3f, 1.2f, 137));
    Check("稀疏/稠密采样判定一致（插值确定收敛）", sparseA.Verdict == sparseB.Verdict,
        $"{sparseA.Verdict}/{sparseB.Verdict} {sparseA.Aggregate:F3}/{sparseB.Aggregate:F3}");
    Check("无 NaN（aggregate/旋转/平移全有限）",
        float.IsFinite(sparseB.Aggregate) && float.IsFinite(sparseB.MaxRotDeltaRad) && float.IsFinite(sparseB.MaxTransDeltaM));

    // 无可比骨骼 → deviation（不抛不出 NaN）
    var emptyBones = new AnimClipData { name = "e", duration = 1f, type = "once", bones = new Dictionary<string, BoneChannel>() };
    Check("无可比骨骼 → deviation 且 aggregate 钳为有限值",
        ClipCompare.Compare(baseClip, emptyBones).Verdict == "deviation"
        && float.IsFinite(ClipCompare.Compare(baseClip, emptyBones).Aggregate));

    // q/-q 等价：同一旋转的取反四元数不算偏差
    var neg = MakeClip("f", 3f, 1.2f, 20);
    foreach (var nf in neg.bones["bone_main"].q!) { nf[1] = -nf[1]; nf[2] = -nf[2]; nf[3] = -nf[3]; nf[4] = -nf[4]; }
    Check("q 与 -q 等价（取反四元数 → match）", ClipCompare.Compare(baseClip, neg).Verdict == "match");

    // 报告整形：AC-6 契约键齐全，数值有限、JSON 合法
    var report = ClipCompare.VerifyReportJson("/bow motion", rWrong, 20, 14.25, true, "timeout");
    Check("报告含 ok/verdict/aggregate/maxRotDelta/hotspots/frames/sampleHz/persistent 契约键",
        report.Contains("\"ok\":true") && report.Contains("\"verdict\":\"deviation\"")
        && report.Contains("\"aggregate\":") && report.Contains("\"maxRotDelta\":")
        && report.Contains("\"hotspots\":[") && report.Contains("\"frames\":20")
        && report.Contains("\"sampleHz\":14.3") && report.Contains("\"persistent\":true"), report);
    Check("报告 JSON 可解析且无 NaN/Infinity",
        report.IndexOf("NaN", StringComparison.Ordinal) < 0 && report.IndexOf("Infinity", StringComparison.Ordinal) < 0
        && System.Text.Json.JsonDocument.Parse(report) != null);
}

// ==================== ARCH2（TASK-20260901）：插件 HTTP 边界收口——路由/校验策略与调度排空 ====================
// 契约：HttpServer/ExportServer 只留传输（OPTIONS/鉴权/CORS/序列化/委托），路由分级与请求校验
// 在 PlaybackApiPolicy/ShowApiPolicy/ExportApiPolicy；本组断言逐字节锁定全部既有端点、方法
// 白名单、错误形状与调度生命周期，重构不改变任何线上行为。

Console.WriteLine("== ARCH2 PlaybackApiPolicy（48794 端点清单与 405/404 分级） ==");
{
    string[] readPaths =
    {
        "/", "/health", "/actions", "/actions/emotes", "/actions/emote-durations",
        "/actions/measured-durations", "/actions/races", "/dancers", "/classjobs",
        "/version", "/capabilities", "/playback/status", "/settings/engine",
        "/gpose/state", "/lyrics/search", "/lyrics",
        "/debug/animstate", "/debug/diag", "/debug/tlinfo", "/debug/poke",
        "/debug/emotefamily", "/shows/status",
    };
    string[] writePaths =
    {
        "/preview", "/playback/start", "/playback/timeline", "/playback/seek",
        "/playback/freeze", "/playback/stop", "/gpose/toggle", "/settings/engine",
        "/shows/validate", "/shows/load", "/shows/arm", "/shows/start", "/shows/stop",
    };
    foreach (var p in readPaths.Where(p => p != "/settings/engine"))
        Check($"policy:route 只读清单 {p} 可读不可写", PlaybackApiPolicy.IsReadEndpoint(p) && !PlaybackApiPolicy.IsWriteEndpoint(p));
    foreach (var p in writePaths.Where(p => p != "/settings/engine"))
        Check($"policy:route 写清单 {p} 可写不可读", PlaybackApiPolicy.IsWriteEndpoint(p) && !PlaybackApiPolicy.IsReadEndpoint(p));
    Check("policy:route 两用端点 /settings/engine 双向在册",
        PlaybackApiPolicy.IsReadEndpoint("/settings/engine") && PlaybackApiPolicy.IsWriteEndpoint("/settings/engine"));
    Check("policy:route POST /health → 405 Allow=GET, HEAD", PlaybackApiPolicy.PostWrongMethodAllow("/health") == "GET, HEAD");
    Check("policy:route POST 打只读端点全表 405（两用端点 /settings/engine 除外）",
        readPaths.Where(p => p != "/settings/engine").All(p => PlaybackApiPolicy.PostWrongMethodAllow(p) == "GET, HEAD"));
    Check("policy:route POST /playback/start 合法放行（null）", PlaybackApiPolicy.PostWrongMethodAllow("/playback/start") == null);
    Check("policy:route POST 未知路径 → null（闸后 404，鉴权先于路由判定）",
        PlaybackApiPolicy.PostWrongMethodAllow("/nope") == null);
    Check("policy:route PUT /health → 405 Allow=GET, HEAD", PlaybackApiPolicy.OtherMethodAllow("/health") == "GET, HEAD");
    Check("policy:route PUT /preview → 405 Allow=POST", PlaybackApiPolicy.OtherMethodAllow("/preview") == "POST");
    Check("policy:route PUT 未知路径 → 裸 404（null）", PlaybackApiPolicy.OtherMethodAllow("/nope") == null);
    Check("policy:route null 路径安全（裸 404）",
        PlaybackApiPolicy.OtherMethodAllow(null) == null && !PlaybackApiPolicy.IsReadEndpoint(null) && !PlaybackApiPolicy.IsWriteEndpoint(null));
    Check("policy:route 大小写不敏感（与旧 HashSet 口径一致）", PlaybackApiPolicy.OtherMethodAllow("/HEALTH") == "GET, HEAD");
    Check("policy:route 分类幂等（GET 安全重试：纯函数无状态，重复判定逐字节一致）",
        PlaybackApiPolicy.OtherMethodAllow("/health") == PlaybackApiPolicy.OtherMethodAllow("/health")
        && PlaybackApiPolicy.PostWrongMethodAllow("/debug/poke") == PlaybackApiPolicy.PostWrongMethodAllow("/debug/poke")
        && PlaybackApiPolicy.IsReadEndpoint("/playback/status") == PlaybackApiPolicy.IsReadEndpoint("/playback/status"));
    Check("policy:limits 上限常量锁定（4MB 体 / 2000 条时间轴）",
        PlaybackApiPolicy.MaxPostBodyBytes == 4 * 1024 * 1024 && PlaybackApiPolicy.MaxTimelineClips == 2000);
}

Console.WriteLine("== ARCH2 PlaybackApiPolicy（请求体解析与时间轴负载校验） ==");
{
    System.Text.Json.JsonElement ElOf(string json) => System.Text.Json.JsonDocument.Parse(json).RootElement;

    Check("policy:body 合法 JSON 解析成功",
        PlaybackApiPolicy.TryParseBodyJson("{\"a\":1}", "/preview", out var okDoc, out var okRej) && okRej == null);
    okDoc?.Dispose();
    // 说明：该 400 体走 JsonSerializer.Serialize（默认编码器，非 ASCII 转义 \uXXXX）——与旧实现
    // 同一序列化口径；断言用解析比对 + 默认编码器确定性双重锁定
    Check("policy:body 坏 JSON → 400 稳定形状（message 带端点名）",
        !PlaybackApiPolicy.TryParseBodyJson("{bad", "/preview", out _, out var badRej)
        && badRej!.Value.Status == 400
        && System.Text.Json.JsonDocument.Parse(badRej.Value.Json).RootElement.GetProperty("error").GetString() == "invalid body"
        && System.Text.Json.JsonDocument.Parse(badRej.Value.Json).RootElement.GetProperty("message").GetString() == "/preview 的请求体必须是合法 JSON"
        && badRej.Value.Json == System.Text.Json.JsonSerializer.Serialize(new { error = "invalid body", message = "/preview 的请求体必须是合法 JSON" }));
    Check("policy:body 坏 JSON Debug 细节携带解析器消息（不落响应）",
        !PlaybackApiPolicy.TryParseBodyJson("[1,", "/playback/start", out _, out var dbgRej)
        && dbgRej!.Value.DebugDetail != null && !dbgRej.Value.Json.Contains(dbgRej.Value.DebugDetail));
    Check("policy:body 413/400 字节形状逐字锁定",
        PlaybackApiPolicy.BodyTooLargeJson == "{\"error\":\"request body too large\",\"message\":\"请求体超过上限（4MB）\"}"
        && PlaybackApiPolicy.BodyUnreadableJson == "{\"error\":\"request body unreadable\"}"
        && PlaybackApiPolicy.InternalErrorJson == "{\"error\":\"internal error\"}"
        && PlaybackApiPolicy.GameThreadBusyJson == "{\"error\":\"game thread busy\",\"message\":\"游戏线程忙，请稍后重试\"}");
    Check("policy:shapes 503 依赖缺失三件套逐字锁定",
        PlaybackApiPolicy.NoPlaybackJson == "{\"error\":\"no playback\",\"message\":\"播放管理器不可用（插件初始化未完成）\"}"
        && PlaybackApiPolicy.NoFreezerJson == "{\"error\":\"no freezer\",\"message\":\"定格器不可用（插件初始化未完成）\"}"
        && PlaybackApiPolicy.NoPreviewerJson == "{\"error\":\"previewer not available\",\"message\":\"预览器不可用（插件初始化未完成）\"}");
    Check("policy:shapes 400/409 播放契约逐字锁定",
        PlaybackApiPolicy.PreviewCommandRequiredJson == "{\"error\":\"invalid body\",\"message\":\"/preview 需要 command 字段\"}"
        && PlaybackApiPolicy.ClipsMustBeArrayJson == "{\"error\":\"invalid clips\",\"message\":\"clips 必须是数组\"}"
        && PlaybackApiPolicy.ClipFieldsIncompleteJson == "{\"error\":\"invalid clips\",\"message\":\"动作条字段不完整：每条需要 id/start/duration\"}"
        && PlaybackApiPolicy.EmptyTimelineJson == "{\"error\":\"empty timeline\",\"message\":\"时间轴为空：没有可播放的动作条\"}"
        && PlaybackApiPolicy.StartPlayingConflictJson == "{\"error\":\"playing\",\"message\":\"正在播放：先停止（/playback/stop）再开始新时间轴\"}"
        && PlaybackApiPolicy.TimelinePlayingConflictJson == "{\"error\":\"playing\",\"message\":\"正在播放：时间轴替换被拒绝，先停止再推送\"}"
        && PlaybackApiPolicy.CannotStartJson == "{\"error\":\"cannot start\",\"message\":\"无法开始播放（时间轴为空或播放器忙）\"}"
        && PlaybackApiPolicy.StaleTimelineJson == "{\"error\":\"stale timeline\",\"message\":\"网页时间轴与插件不同步（修订号过期），网页会自动重新同步后重试\"}");
    Check("policy:command 400 模板（预览/定格前缀）",
        PlaybackApiPolicy.InvalidCommandJson("预览", "空命令") == "{\"error\":\"invalid command\",\"message\":\"预览命令不合格：空命令\"}"
        && PlaybackApiPolicy.InvalidCommandJson("定格", "x") == "{\"error\":\"invalid command\",\"message\":\"定格命令不合格：x\"}");

    // ---- 时间轴负载：合法解析与字段映射 ----
    var clipsOk = PlaybackApiPolicy.ParseClips(ElOf(
        "[{\"id\":1,\"start\":0.5,\"duration\":2,\"command\":\"/bow motion\",\"type\":\"action\",\"name\":\"鞠躬\",\"actorId\":3}," +
        "{\"id\":2,\"start\":3,\"duration\":1,\"type\":\"lyric\",\"actorId\":3}]"), out var okClipsRej);
    Check("policy:clips 合法负载解析成功", clipsOk != null && okClipsRej == null && clipsOk!.Count == 2);
    Check("policy:clips 字段逐项映射（id/start/duration/command/type/name/actorId）",
        clipsOk![0] is { Id: 1, Start: 0.5f, Duration: 2f, Command: "/bow motion", Type: "action", Name: "鞠躬", ActorId: 3 });
    Check("policy:clips 缺省字段 = 缺省值（command/name 空，type 保留）",
        clipsOk![1].Command == "" && clipsOk[1].Type == "lyric" && clipsOk[1].Name == "");
    var lyricDefault = PlaybackApiPolicy.ParseClips(ElOf(
        "[{\"id\":5,\"start\":0,\"duration\":1,\"type\":\"lyric\"}]"), out _);
    Check("policy:clips 缺 actorId 按缺省 0（单演员时合法）",
        lyricDefault != null && lyricDefault.Count == 1 && lyricDefault[0].ActorId == 0);

    // ---- FIX-B 回归口径：空命令歌词条放行，非空命令过策略闸 ----
    var lyricOnly = PlaybackApiPolicy.ParseClips(ElOf(
        "[{\"id\":9,\"start\":0,\"duration\":2,\"type\":\"lyric\"}]"), out _);
    Check("policy:clips 空命令歌词条放行（importLyrics 口径）", lyricOnly != null && lyricOnly.Count == 1);
    var badCmd = PlaybackApiPolicy.ParseClips(ElOf(
        "[{\"id\":7,\"start\":0,\"duration\":1,\"command\":\"bow\",\"type\":\"action\",\"name\":\"鞠躬\"}]"), out var cmdRej);
    Check("policy:clips 命令不过策略 → 400 带序号与名称",
        badCmd == null && cmdRej!.Value.Status == 400
        && cmdRej.Value.Json.StartsWith("{\"error\":\"invalid command\",\"message\":\"")
        && cmdRej.Value.Json.Contains("第 1 条（鞠躬）命令不合格"));
    Check("policy:clips 拒绝细节带 clip id（Debug 日志用，不落响应）",
        cmdRej!.Value.DebugDetail != null && cmdRej.Value.DebugDetail.StartsWith("clip 7 command rejected: "));
    var lyricDanger = PlaybackApiPolicy.ParseClips(ElOf(
        "[{\"id\":8,\"start\":0,\"duration\":1,\"command\":\"/bow; /wave\",\"type\":\"lyric\",\"name\":\"歌词\"}]"), out var dangerRej);
    Check("policy:clips 非空命令的歌词条照样过闸（分号拼接拒绝）",
        lyricDanger == null && dangerRej!.Value.Status == 400 && dangerRej.Value.Json.Contains("命令不合格"));

    // ---- 条数上限 / 多演员 / 字段异常口径 ----
    var bigArr = new System.Text.StringBuilder("[");
    for (var i = 0; i <= PlaybackApiPolicy.MaxTimelineClips; i++)
        bigArr.Append("{\"id\":").Append(i).Append(",\"start\":0,\"duration\":1,\"type\":\"lyric\"},");
    bigArr.Length--; bigArr.Append("]");
    var tooMany = PlaybackApiPolicy.ParseClips(ElOf(bigArr.ToString()), out var manyRej);
    Check("policy:clips 超 2000 条 → 400 too many clips",
        tooMany == null && manyRej!.Value.Status == 400
        && manyRej.Value.Json == "{\"error\":\"too many clips\",\"message\":\"时间轴动作条超过上限（2000 条）\"}");
    var multi = PlaybackApiPolicy.ParseClips(ElOf(
        "[{\"id\":1,\"start\":0,\"duration\":4,\"command\":\"/bow motion\",\"type\":\"action\",\"actorId\":0}," +
        "{\"id\":2,\"start\":2,\"duration\":4,\"command\":\"/wave motion\",\"type\":\"action\",\"actorId\":1}]"), out var multiRej);
    Check("policy:clips 混入两位舞者 → 400 multi-actor（ACTOR 口径）",
        multi == null && multiRej!.Value.Status == 400
        && multiRej.Value.Json.StartsWith("{\"error\":\"multi-actor timeline\",\"message\":\"")
        && multiRej.Value.Json.Contains("预览舞者"));
    Check("policy:clips 多演员拒绝细节带条数",
        multiRej!.Value.DebugDetail == "multi-actor timeline rejected (2 clips)");
    Exception? missingId = null;
    try { PlaybackApiPolicy.ParseClips(ElOf("[{\"start\":0,\"duration\":1}]"), out _); }
    catch (Exception ex) { missingId = ex; }
    Check("policy:clips 缺 id 抛 KeyNotFound（上层统一 catch 回 400 动作条字段不完整）",
        missingId is KeyNotFoundException);
    Exception? stringId = null;
    try { PlaybackApiPolicy.ParseClips(ElOf("[{\"id\":\"7\",\"start\":0,\"duration\":1}]"), out _); }
    catch (Exception ex) { stringId = ex; }
    Check("policy:clips id 类型错误按旧口径逃出 400 过滤（上层 500，不吞）",
        stringId != null && stringId is not KeyNotFoundException && stringId is not System.Text.Json.JsonException);
}

Console.WriteLine("== ARCH2 policy:oversize（413 按 UTF-8 字节：声明长度与 chunked 同拦） ==");
{
    // 只读回环监听器：请求经同一生产读取核心 LocalApiSecurity.ReadBodyLimited，
    // 上限取 48795 的 64KB 常量，锁定 AUD-011 的「按 UTF-8 字节计数不按字符」契约
    int osPort;
    var osProbe = new System.Net.Sockets.TcpListener(System.Net.IPAddress.Loopback, 0);
    osProbe.Start();
    osPort = ((System.Net.IPEndPoint)osProbe.LocalEndpoint).Port;
    osProbe.Stop();
    using var osServer = new HttpListener();
    osServer.Prefixes.Add($"http://localhost:{osPort}/");
    osServer.Start();
    var osThread = new Thread(() =>
    {
        try
        {
            while (osServer.IsListening)
            {
                HttpListenerContext ctx;
                try { ctx = osServer.GetContext(); } catch { break; }
                try
                {
                    var max = int.Parse(ctx.Request.Headers["X-Max-Bytes"] ?? "65536");
                    var body = LocalApiSecurity.ReadBodyLimited(ctx.Request, max);
                    var respBytes = System.Text.Encoding.UTF8.GetBytes(body == null ? "null" : body.Length.ToString());
                    ctx.Response.ContentType = "text/plain";
                    ctx.Response.ContentLength64 = respBytes.Length;
                    ctx.Response.OutputStream.Write(respBytes, 0, respBytes.Length);
                    ctx.Response.Close();
                }
                catch { try { ctx.Response.Close(); } catch { } }
            }
        }
        catch { }
    });
    osThread.Start();
    try
    {
        Check("policy:oversize 48795 上限常量 = 64KB", ExportApiPolicy.MaxPostBodyBytes == 64 * 1024);
        using var osClient = new HttpClient { Timeout = TimeSpan.FromSeconds(10) };
        var url = $"http://localhost:{osPort}/body-probe";
        // 声明长度超限：65537 字节 > 64KB → null（上层 413）
        using (var r = osClient.PostAsync(url, new StringContent(new string('a', ExportApiPolicy.MaxPostBodyBytes + 1))).Result)
            Check("policy:oversize 声明长度超限 → null（413 判定）", r.Content.ReadAsStringAsync().Result == "null");
        // 恰好上限：64KB 通过且完整
        using (var r = osClient.PostAsync(url, new StringContent(new string('a', ExportApiPolicy.MaxPostBodyBytes))).Result)
            Check("policy:oversize 恰好 64KB 放行（长度完整）",
                r.Content.ReadAsStringAsync().Result == ExportApiPolicy.MaxPostBodyBytes.ToString());
        // UTF-8 字节口径：21846 个中文 = 65538 字节 > 64KB，字符数远小于 65536 也必须拒
        using (var r = osClient.PostAsync(url, new StringContent(new string('中', 21846))).Result)
            Check("policy:oversize 多字节中文按字节计超限（字符数口径拦不住）",
                r.Content.ReadAsStringAsync().Result == "null");
        // chunked 超限（无声明长度）：同样拦截（2026-08-31 审计 P2 回归）
        using (var r = osClient.PostAsync(url, new StreamContent(new BlindByteStream(new byte[70000]))).Result)
            Check("policy:oversize chunked 超限 → null", r.Content.ReadAsStringAsync().Result == "null");
        // chunked 限额内：完整到达
        using (var r = osClient.PostAsync(url, new StreamContent(new BlindByteStream(new byte[1000]))).Result)
            Check("policy:oversize chunked 限额内放行", r.Content.ReadAsStringAsync().Result == "1000");
    }
    finally
    {
        osServer.Stop();
        osThread.Join(2000);
    }
}

Console.WriteLine("== ARCH2 ShowApiPolicy（/shows/* 校验与响应字节形状） ==");
{
    Check("policy:show 写路径清单五端点",
        ShowApiPolicy.ValidatePath == "/shows/validate" && ShowApiPolicy.LoadPath == "/shows/load"
        && ShowApiPolicy.ArmPath == "/shows/arm" && ShowApiPolicy.StartPath == "/shows/start"
        && ShowApiPolicy.StopPath == "/shows/stop");
    Check("policy:show 状态读端点在册且只读",
        ShowApiPolicy.StatusPath == "/shows/status"
        && PlaybackApiPolicy.IsReadEndpoint(ShowApiPolicy.StatusPath)
        && !PlaybackApiPolicy.IsWriteEndpoint(ShowApiPolicy.StatusPath));
    Check("policy:show 演出路径都在 48794 分级表里",
        new[] { ShowApiPolicy.ValidatePath, ShowApiPolicy.LoadPath, ShowApiPolicy.ArmPath, ShowApiPolicy.StartPath, ShowApiPolicy.StopPath }
            .All(p => PlaybackApiPolicy.IsWriteEndpoint(p)));

    // 包元素：{package:{…}} 与裸包两种形状
    using (var wrapped = System.Text.Json.JsonDocument.Parse("{\"package\":{\"protocolVersion\":1,\"events\":[]},\"other\":1}"))
        Check("policy:show {package:{…}} 形状取内层",
            ShowApiPolicy.PackageElement(wrapped).TryGetProperty("protocolVersion", out _));
    using (var bare = System.Text.Json.JsonDocument.Parse("{\"protocolVersion\":1,\"events\":[]}"))
        Check("policy:show 裸包形状原样使用",
            ShowApiPolicy.PackageElement(bare).TryGetProperty("protocolVersion", out _));

    // 说明：show 错误体走 JsonSerializer.Serialize（默认编码器转义非 ASCII）——与旧实现同一
    // 序列化口径（含 JsonOptions 的 WhenWritingNull）；断言用解析比对 + 确定性序列化双重锁定
    Check("policy:show 解析失败 400 语义形状",
        ShowApiPolicy.InvalidShowJson(null).Contains("invalid show")
        && System.Text.Json.JsonDocument.Parse(ShowApiPolicy.InvalidShowJson(null)).RootElement.GetProperty("message").GetString() == "演出包无效"
        && System.Text.Json.JsonDocument.Parse(ShowApiPolicy.InvalidShowJson("协议版本必须是 1")).RootElement.GetProperty("message").GetString() == "协议版本必须是 1");
    var rejected = ShowValidator.Validate(new ShowPackage { ProtocolVersion = 1, DurationMs = 1000 });
    Check("policy:show 校验不过 400 带 show rejected 与 issues",
        ShowApiPolicy.LoadRejectedJson(rejected).StartsWith("{\"error\":\"show rejected\"")
        && ShowApiPolicy.LoadRejectedJson(rejected).Contains("\"issues\":["));
    Check("policy:show 状态冲突 409 语义与序列化确定性",
        System.Text.Json.JsonDocument.Parse(ShowApiPolicy.StateConflictJson("状态不允许")).RootElement.GetProperty("message").GetString() == "状态不允许"
        && ShowApiPolicy.StateConflictJson("状态不允许") == System.Text.Json.JsonSerializer.Serialize(new { error = "state", message = "状态不允许" },
            new System.Text.Json.JsonSerializerOptions { WriteIndented = false, DefaultIgnoreCondition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull }));
    Check("policy:show 503 依赖缺失字节形状",
        ShowApiPolicy.NoRunnerJson == "{\"error\":\"no show runner\",\"message\":\"演出执行器不可用（插件初始化未完成）\"}");

    // /shows/start 倒计时解析
    Check("policy:countdown 缺体 → 默认值",
        ShowApiPolicy.TryGetCountdownMs(null, out var cdDef, out var cdDefRej) && cdDef == ShowRunner.DefaultCountdownMs && cdDefRej == null);
    Check("policy:countdown 空白体 → 默认值",
        ShowApiPolicy.TryGetCountdownMs("  ", out var cdBlank, out _) && cdBlank == ShowRunner.DefaultCountdownMs);
    Check("policy:countdown countdownMs 字段生效",
        ShowApiPolicy.TryGetCountdownMs("{\"countdownMs\":1234}", out var cdVal, out _) && cdVal == 1234);
    Check("policy:countdown 非整数倒计时忽略（保持默认）",
        ShowApiPolicy.TryGetCountdownMs("{\"countdownMs\":1.5}", out var cdFrac, out _) && cdFrac == ShowRunner.DefaultCountdownMs);
    Check("policy:countdown 坏 JSON → 400 稳定形状（/shows/start 端点名）",
        !ShowApiPolicy.TryGetCountdownMs("{bad", out _, out var cdBad)
        && cdBad!.Value.Status == 400
        && System.Text.Json.JsonDocument.Parse(cdBad.Value.Json).RootElement.GetProperty("message").GetString() == "/shows/start 的请求体必须是合法 JSON");
}

Console.WriteLine("== ARCH2 ExportApiPolicy（48795 方法白名单、静态映射与请求体容错解析） ==");
{
    string[] exportGets =
    {
        "/export/progress", "/export/recstate", "/export/list", "/export/batchstatus",
        "/export/getclip", "/export/skeleton", "/export/verifystatus",
    };
    string[] exportPosts =
    {
        "/export/clip", "/export/clip/commit", "/export/clip/cancel",
        "/export/batch", "/export/batchcancel", "/export/walkreset", "/export/verify",
    };
    foreach (var p in exportGets)
        Check($"policy:export GET 白名单 {p}", ExportApiPolicy.AllowedMethodFor(p) == "GET");
    foreach (var p in exportPosts)
        Check($"policy:export POST 白名单 {p}", ExportApiPolicy.AllowedMethodFor(p) == "POST");
    Check("policy:export 未知/前缀路径不在白名单（路由层 404）",
        ExportApiPolicy.AllowedMethodFor("/export") == null
        && ExportApiPolicy.AllowedMethodFor("/exportfoo") == null
        && ExportApiPolicy.AllowedMethodFor("/export/list/x") == null
        && ExportApiPolicy.AllowedMethodFor("/capabilities") == null
        && ExportApiPolicy.AllowedMethodFor(null) == null);
    Check("policy:export 大小写敏感（与旧 switch 口径一致）", ExportApiPolicy.AllowedMethodFor("/EXPORT/LIST") == null);
    Check("policy:export 静态页映射（/ 与 /viewer 固定，其余相对名）",
        ExportApiPolicy.StaticFileNameFor("/") == "choreo-helper-app.html"
        && ExportApiPolicy.StaticFileNameFor("/viewer") == "pose-viewer.html"
        && ExportApiPolicy.StaticFileNameFor("/choreo-helper-app.html") == "choreo-helper-app.html"
        && ExportApiPolicy.StaticFileNameFor("/libs-classic/three.min.js") == "libs-classic/three.min.js");
    Check("policy:export 404/413 字节形状逐字锁定",
        ExportApiPolicy.UnknownEndpointJson == "{\"error\":\"unknown endpoint\"}"
        && ExportApiPolicy.BodyTooLargeJson == "{\"error\":\"request body too large\",\"message\":\"请求体超过上限（64KB）\"}");

    Check("policy:export clip 体解析（command+save）",
        ExportApiPolicy.ParseClipBody("{\"command\":\"/bow motion\",\"save\":true}") is { Command: "/bow motion", Save: true });
    Check("policy:export clip 体缺省（空体 → 空命令）",
        ExportApiPolicy.ParseClipBody(null).Command == "" && !ExportApiPolicy.ParseClipBody("").Save);
    Check("policy:export clip 体坏 JSON 容错（按缺省继续，端点回 command required）",
        ExportApiPolicy.ParseClipBody("{bad").Command == "" && !ExportApiPolicy.ParseClipBody("{bad").Save);
    Check("policy:export commit 体解析（recordingId+name）",
        ExportApiPolicy.ParseCommitBody("{\"recordingId\":\"" + new string('a', 32) + "\",\"name\":\"bow\"}")
            is { RecordingId: var rid, Name: "bow" } && rid.Length == 32);
    Check("policy:export cancel 体解析（recordingId）",
        ExportApiPolicy.ParseCancelBody("{\"recordingId\":\"abc\"}") == "abc");
    Check("policy:export batch 体解析（commands 数组）",
        ExportApiPolicy.ParseBatchCommands("{\"commands\":[\"/bow\",\"/wave\",\"\"]}").Count == 3);
    Check("policy:export batch 坏体 → 空清单（端点回 commands required）",
        ExportApiPolicy.ParseBatchCommands("{bad").Count == 0 && ExportApiPolicy.ParseBatchCommands(null).Count == 0);
    Check("policy:export verify 体解析（command）",
        ExportApiPolicy.ParseVerifyBody("{\"command\":\"/bow motion\"}") == "/bow motion");
}

Console.WriteLine("== ARCH2 policy:single-session（演出在途 409 重试不重复执行） ==");
{
    // 单会话约束的策略面：演出执行器同一时刻只有一场演出；在途时 Start/Load 一律 409，
    // 被拒的重试绝不重复分发事件（FakeShowDispatcher 纯假执行器，不碰游戏线程）
    var disp = new FakeShowDispatcher();
    long sT = 0;
    var runner = new ShowRunner(disp, () => sT);
    runner.SetGuardProvider(() => new GuardSnapshot());
    var pkg = new ShowPackage { ProtocolVersion = 1, DurationMs = 30000 };
    pkg.Events.AddRange(new[]
    {
        new ShowEvent { Id = "e1", Kind = "motion", PerformerId = "p1", StartMs = 500, DurationMs = 500, Command = "/bow motion" },
        new ShowEvent { Id = "e2", Kind = "motion", PerformerId = "p1", StartMs = 1500, DurationMs = 500, Command = "/wave motion" },
    });
    Check("policy:session 装载→就绪→开演", runner.Load(pkg).Ok && runner.Arm().Ok && runner.Start(0).Ok);
    runner.Tick();
    sT += 600; runner.Tick(); // e1 已发送，演出在途
    Check("policy:session 演出在途时重复 Start → 拒绝（409 语义）", !runner.Start(0).Ok);
    Check("policy:session 演出在途时 Load → 拒绝", !runner.Load(pkg).Ok);
    Check("policy:session 被拒重试不重复执行（分发数不变）",
        disp.Dispatched.Count == 1 && disp.Dispatched[0].Id == "e1");
    for (var i = 0; i < 31; i++) { sT += 1000; runner.Tick(); } // 分帧推进（单帧跨度过大会触守卫，同既有测试口径）
    Check("policy:session 拒绝的重试不影响原演出完成（2 条各一次）",
        runner.State == ShowState.Completed && disp.Dispatched.Count == 2
        && disp.Dispatched.Select(e => e.Id).Distinct().Count() == 2);
}

Console.WriteLine("== ARCH2 dispatch:inflight / dispatch:dispose（精确计数、恰好一次回收、Dispose 拒新） ==");
{
    // 精确在途计数：接受即在途、拒绝不登记、完成即减一（AC-2）
    var dIn = new RequestDispatcher(4, 2);
    var gates = new[] { new TaskCompletionSource(), new TaskCompletionSource(), new TaskCompletionSource(),
                        new TaskCompletionSource(), new TaskCompletionSource(), new TaskCompletionSource() };
    for (var i = 0; i < 4; i++)
    {
        var g = gates[i];
        Check($"dispatch:inflight 快车道第 {i + 1} 个接受", dIn.TryAccept(RequestLane.Fast, async () => await g.Task));
    }
    for (var i = 0; i < 2; i++)
    {
        var g = gates[4 + i];
        Check($"dispatch:inflight 出站第 {i + 1} 个接受", dIn.TryAccept(RequestLane.Outbound, async () => await g.Task));
    }
    Check("dispatch:inflight 6 个挂起 → 在途恰为 6（4 快 + 2 出站）", SpinWaitUntil(() => dIn.InFlight == 6));
    Check("dispatch:inflight 快车道满员拒绝且不登记在途",
        !dIn.TryAccept(RequestLane.Fast, () => Task.CompletedTask) && dIn.InFlight == 6);
    Check("dispatch:inflight 出站满员拒绝且不登记在途",
        !dIn.TryAccept(RequestLane.Outbound, () => Task.CompletedTask) && dIn.InFlight == 6);
    gates[0].TrySetResult();
    Check("dispatch:inflight 完成一个 → 在途恰为 5", SpinWaitUntil(() => dIn.InFlight == 5));
    Check("dispatch:inflight 释放的快车道槽位可立即再用（不排队、恰一名额）",
        dIn.TryAccept(RequestLane.Fast, () => Task.CompletedTask));
    gates[1].TrySetResult(); gates[2].TrySetResult(); gates[3].TrySetResult();
    gates[4].TrySetResult(); gates[5].TrySetResult();
    Check("dispatch:inflight 全部完成后排空归零", dIn.WaitDrained(TimeSpan.FromSeconds(5)));
    dIn.Dispose();

    // 恰好一次回收：容量 1 的车道完成一次占槽后必须恰好多出一名额——若槽位被双发，
    // 占槽期间并发接受就会成功（AC-5「semaphore slots release exactly once」）
    var dRel = new RequestDispatcher(1, 1);
    var g1 = new TaskCompletionSource();
    Check("dispatch:release 占槽工作体接受", dRel.TryAccept(RequestLane.Fast, async () => await g1.Task));
    g1.TrySetResult();
    Check("dispatch:release 完成后排空", SpinWaitUntil(() => dRel.WaitDrained(TimeSpan.Zero)));
    var g2 = new TaskCompletionSource();
    Check("dispatch:release 容量 1 恰好再接受一个", dRel.TryAccept(RequestLane.Fast, async () => await g2.Task));
    Check("dispatch:release 占槽期间必须拒绝（双发即在此暴露）",
        !SpinWaitUntil(() => dRel.TryAccept(RequestLane.Fast, () => Task.CompletedTask), 200));
    g2.TrySetResult();
    Check("dispatch:release 前一段完成后排空", SpinWaitUntil(() => dRel.WaitDrained(TimeSpan.Zero)));
    Check("dispatch:release 接受会抛异常的工体",
        dRel.TryAccept(RequestLane.Fast, async () => { await Task.Yield(); throw new InvalidOperationException("boom"); }));
    Check("dispatch:release 异常后槽位仍恰好回收（可再接受一名额）",
        SpinWaitUntil(() => dRel.TryAccept(RequestLane.Fast, () => Task.CompletedTask)));
    Check("dispatch:release 最终排空", dRel.WaitDrained(TimeSpan.FromSeconds(5)));
    dRel.Dispose();

    // 取消只在工体内 I/O 生效（调度不带令牌，PLUG-6 契约延续）；取消后排空不陪葬
    var dCxl = new RequestDispatcher(1, 1);
    using (var cts = new CancellationTokenSource())
    {
        var cancelledObserved = new TaskCompletionSource();
        Check("dispatch:cancel 接受等取消的工体", dCxl.TryAccept(RequestLane.Outbound, async () =>
        {
            try { await Task.Delay(Timeout.Infinite, cts.Token); }
            catch (OperationCanceledException) { cancelledObserved.TrySetResult(); }
        }));
        cts.Cancel();
        Check("dispatch:cancel 工体内取消被尊重", SpinWaitUntil(() => cancelledObserved.Task.IsCompleted));
        Check("dispatch:cancel 取消后立即排空", SpinWaitUntil(() => dCxl.WaitDrained(TimeSpan.Zero)));
    }
    dCxl.Dispose();

    // Dispose 后拒绝新请求（AC-5）：不碰已释放信号量、不登记在途、双 Dispose 安全
    var dOff = new RequestDispatcher(2, 1);
    dOff.Dispose();
    Check("dispatch:dispose 后快车道拒绝", !dOff.TryAccept(RequestLane.Fast, () => Task.CompletedTask));
    Check("dispatch:dispose 后出站车道拒绝", !dOff.TryAccept(RequestLane.Outbound, () => Task.CompletedTask));
    Check("dispatch:dispose 后无在途登记", dOff.InFlight == 0);
    Check("dispatch:dispose 后 WaitDrained 立即为真", dOff.WaitDrained(TimeSpan.Zero));
    dOff.Dispose();
    Check("dispatch:dispose 双 Dispose 安全", true);
}

// ---- ARCH2 pose:signature（TASK-20260901-ARCH2-POSE-LIFECYCLE AC-3：学习独占/归属/引入段
//      防污染/解析兜底策略直测；命令与 id 全部用本套件专用值，避免污染进程级缓存） ----
Console.WriteLine("== ARCH2 pose:signature（学习独占/表内归属/规范主轴防引入段污染） ==");
{
    PoseSignatureAccess.LearnTimeline("/psig-a", 0);
    PoseSignatureAccess.LearnTimeline("/psig-a", 3); // 3 = 标准待机，永不可学（曾把待机学进缓存 = 吞动作）
    PoseSignatureAccess.LearnTimeline(null, 7101);
    Check("pose:signature 拒学 id=0/待机3/空命令", !PoseSignatureAccess.LearnedTimelines.ContainsKey("/psig-a"));

    PoseSignatureAccess.LearnTimeline("/psig-a", 7101);
    PoseSignatureAccess.LearnTimeline("/psig-a", 7101); // 同命令同 id 去重
    Check("pose:signature 学习成功且去重",
        PoseSignatureAccess.LearnedTimelines.TryGetValue("/psig-a", out var psigLearned)
        && psigLearned.Count == 1 && psigLearned[0] == 7101);

    // 独占所有权：一个时间轴 id 只属于一个命令（motion 在途张冠李戴防线）
    PoseSignatureAccess.LearnTimeline("/psig-b", 7101);
    Check("pose:signature 跨命令独占拒学",
        !PoseSignatureAccess.LearnedTimelines.ContainsKey("/psig-b"));

    // 规范主轴：同表辅助变体（引入段）不学 —— 学到就永远定格在引入段
    PoseSignatureAccess.CanonicalTimelines["/psig-c"] = 7200;
    PoseSignatureAccess.CommandTimelineSets["/psig-c"] = new ushort[] { 7200, 7201 };
    PoseSignatureAccess.LearnTimeline("/psig-c", 7201);
    Check("pose:signature 引入段变体拒学",
        !PoseSignatureAccess.LearnedTimelines.TryGetValue("/psig-c", out var psigC) || !psigC.Contains(7201));
    PoseSignatureAccess.LearnTimeline("/psig-c", 7200);
    Check("pose:signature 规范主轴可学",
        PoseSignatureAccess.LearnedTimelines.TryGetValue("/psig-c", out var psigC2) && psigC2.Contains(7200));

    // 表内归属（TimelineOwners 由 Emote 表扫描回填；本套件手工种子化同形状）
    var psigOwners = new System.Collections.Concurrent.ConcurrentDictionary<ushort, HashSet<string>>();
    var psigSet = new HashSet<string> { "/psig-wave" };
    psigOwners[7301] = psigSet;
    PoseSignatureAccess.TimelineOwners = psigOwners;
    Check("pose:signature 表内归属：本命令放行", PoseSignatureAccess.OwnerAllows("/psig-wave", 7301));
    Check("pose:signature 表内归属：他命令拒绝", !PoseSignatureAccess.OwnerAllows("/psig-bow", 7301));
    Check("pose:signature 表外 id 放行（真变体）", PoseSignatureAccess.OwnerAllows("/psig-wave", 7999));
    Check("pose:signature 空命令放行", PoseSignatureAccess.OwnerAllows(null, 7301));
    Check("pose:signature OwnerUnknown 表内为 false", !PoseSignatureAccess.OwnerUnknown(7301));
    Check("pose:signature OwnerUnknown 表外为 true", PoseSignatureAccess.OwnerUnknown(7999));
    Check("pose:signature OwnerKnown 学习缓存命中",
        PoseSignatureAccess.OwnerKnown(7101) && !PoseSignatureAccess.OwnerKnown(7998));
    PoseSignatureAccess.TimelineOwners = null; // 还原为未扫描态，不泄漏给后续用例

    // 解析兜底：无表扫描（EmoteMap=null）失败关闭 → 调用方走聊天通道
    Check("pose:signature 未扫描时解析失败", !PoseSignatureAccess.TryResolve("/psig-wave", out _));
    Check("pose:signature 空命令解析失败", !PoseSignatureAccess.TryResolve("", out _));
    var psigMap = new System.Collections.Concurrent.ConcurrentDictionary<string, EmoteIds>();
    psigMap["/psig-empty"] = new EmoteIds(0, Array.Empty<ushort>(), false, Array.Empty<ushort>(), false);
    psigMap["/psig-ok"] = new EmoteIds(87, new ushort[] { 7401, 7402 }, true, new ushort[] { 87, 88 }, false);
    PoseSignatureAccess.EmoteMap = psigMap;
    Check("pose:signature 无时间轴行解析失败", !PoseSignatureAccess.TryResolve("/psig-empty", out _));
    Check("pose:signature 合法命令解析成功",
        PoseSignatureAccess.TryResolve("/psig-ok", out var psigIds) && psigIds.Emote == 87
        && psigIds.Timelines.Length == 2 && psigIds.EmoteFamily.Length == 2 && psigIds.AnyLoop && !psigIds.IsFacial);
    PoseSignatureAccess.EmoteMap = null; // 还原

    // 调试载荷纯形状：错误 JSON 双引号转单引号（与拆分前各 catch 分支逐字节一致）
    Check("pose:signature DebugErrorJson 字节形状",
        PoseSignatureAccess.DebugErrorJson("bad \"quote\"") == "{\"error\":\"bad 'quote'\"}");

    // /debug/emotefamily 的 owners 部分（纯缓存视图）
    psigOwners = new System.Collections.Concurrent.ConcurrentDictionary<ushort, HashSet<string>>();
    psigOwners[7501] = new HashSet<string> { "/psig-fam" };
    PoseSignatureAccess.TimelineOwners = psigOwners;
    var psigOwnersJson = System.Text.Json.JsonSerializer.Serialize(PoseSignatureAccess.DescribeOwners(new ushort[] { 7501, 7101 }));
    Check("pose:signature DescribeOwners 表内归属与学习归属",
        psigOwnersJson.Contains("\"id\":7501") && psigOwnersJson.Contains("/psig-fam")
        && psigOwnersJson.Contains("/psig-a"));
    PoseSignatureAccess.TimelineOwners = null; // 还原
}

// ---- ARCH2 pose:lifecycle（AC-1/AC-4：拖动流去抖、延迟停止、世代号、恰好一次结算；
//      注入时钟，全部确定性判定，无 wall-clock sleep） ----
Console.WriteLine("== ARCH2 pose:lifecycle（去抖/延迟停止/世代号/恰好一次结算） ==");
{
    var psigNow = 1000.0;
    var lc = new PreviewSessionLifecycle(() => psigNow);

    Check("pose:lifecycle 首个请求非拖动流", !lc.BeginRequest(false));
    psigNow += 0.05;
    Check("pose:lifecycle 150ms 内判定拖动流", lc.BeginRequest(false));
    psigNow += 0.20;
    Check("pose:lifecycle 流停 150ms 后脱离拖动流", !lc.BeginRequest(false));
    psigNow += 0.05;
    Check("pose:lifecycle force 绕过拖动流判定", !lc.BeginRequest(true));

    // 同命令冻结去重：拖动流中同命令实时拨时间（不延迟），命令变化/需重发才延迟
    Check("pose:lifecycle 拖动流命令变化→延迟", PreviewSessionLifecycle.ShouldDeferCommandChange(true, "/dance-a", "/dance-b", false));
    Check("pose:lifecycle 拖动流同命令→实时（去重）", !PreviewSessionLifecycle.ShouldDeferCommandChange(true, "/dance-a", "/dance-a", false));
    Check("pose:lifecycle 拖动流同命令+需重发→延迟", PreviewSessionLifecycle.ShouldDeferCommandChange(true, "/dance-a", "/dance-a", true));
    Check("pose:lifecycle 非拖动流→不延迟", !PreviewSessionLifecycle.ShouldDeferCommandChange(false, "/dance-a", "/dance-b", false));

    // 延迟结算：流停 150ms 才统一执行最新目标，且恰好执行一次
    lc = new PreviewSessionLifecycle(() => psigNow);
    psigNow = 2000.0;
    lc.BeginRequest(false);
    lc.DeferCommand("/dance-c", 2.5f);
    psigNow += 0.10;
    Check("pose:lifecycle 结算窗口内不执行", !lc.TryTakeSettled(out _, out _) && lc.HasDeferred);
    psigNow += 0.06; // 累计 0.16s > 0.15s
    Check("pose:lifecycle 流停后结算最新目标",
        lc.TryTakeSettled(out var psigCmd, out var psigT) && psigCmd == "/dance-c" && Math.Abs(psigT - 2.5f) < 1e-6);
    Check("pose:lifecycle 结算恰好一次（重复调用不再执行）", !lc.TryTakeSettled(out _, out _) && !lc.HasDeferred);

    // 延迟停止（拖动流空隙）：与命令同样延迟，结算产出 null 命令 → 调用方执行 StopPreview
    lc = new PreviewSessionLifecycle(() => psigNow);
    psigNow = 3000.0;
    lc.BeginRequest(false);
    Check("pose:lifecycle 拖动流中的停止请求延迟", lc.ShouldDeferStop());
    lc.DeferStop();
    psigNow += 0.16;
    Check("pose:lifecycle 延迟停止结算产出空命令",
        lc.TryTakeSettled(out var psigStopCmd, out _) && psigStopCmd == null);
    lc = new PreviewSessionLifecycle(() => psigNow);
    psigNow = 3000.5;
    lc.BeginRequest(false);
    psigNow += 0.16;
    Check("pose:lifecycle 非拖动流停止立即执行", !lc.ShouldDeferStop());

    // 世代号（停止竞态防护）：Stop 推进世代，仍在框架队列里的旧请求世代失效被丢弃
    lc = new PreviewSessionLifecycle(() => psigNow);
    var psigGen = lc.Generation;
    Check("pose:lifecycle 世代初始一致（请求放行）", psigGen == lc.Generation);
    lc.AdvanceGeneration();
    Check("pose:lifecycle 停止后旧世代请求被丢弃", psigGen != lc.Generation);
    lc.AdvanceGeneration();
    Check("pose:lifecycle 重复停止仍丢弃（幂等）", psigGen != lc.Generation);

    // Dispose 有界等待条件（AC-4：有界 2s 等待只在"曾在预览且不在框架线程"时发生）
    Check("pose:lifecycle Dispose 等待条件真值表",
        PreviewSessionLifecycle.DisposeShouldBoundedWait(true, false)
        && !PreviewSessionLifecycle.DisposeShouldBoundedWait(true, true)
        && !PreviewSessionLifecycle.DisposeShouldBoundedWait(false, false)
        && !PreviewSessionLifecycle.DisposeShouldBoundedWait(false, true));
}

// ---- ARCH2 pose:thread（AC-2：线程路由与错误处理决策——inline 判定、吞异常并上报、
//      公共入口字节形状、解堵/待机兜底策略；纯判定，无 Dalamud） ----
Console.WriteLine("== ARCH2 pose:thread（inline 路由/吞异常上报/入口形状/解堵门） ==");
{
    Check("pose:thread 框架线程就地执行", PoseSessionPolicy.RunInline(true));
    Check("pose:thread 非框架线程调度执行", !PoseSessionPolicy.RunInline(false));

    var psigRan = false;
    Check("pose:thread 动作成功返回 true", PoseSessionPolicy.TryRun(() => psigRan = true, _ => Check("pose:thread 成功不应上报", false)) && psigRan);
    Exception? psigSeen = null;
    var psigBomb = new InvalidOperationException("pose-thread-probe");
    Check("pose:thread 动作抛异常被吞并返回 false",
        !PoseSessionPolicy.TryRun(() => throw psigBomb, ex => psigSeen = ex));
    Check("pose:thread 异常原样上报（日志路径）", ReferenceEquals(psigSeen, psigBomb));

    Check("pose:thread gpose 开状态字节形状", PoseSessionPolicy.GposeStateJson(true) == "{\"gpose\":true}");
    Check("pose:thread gpose 关状态字节形状", PoseSessionPolicy.GposeStateJson(false) == "{\"gpose\":false}");

    Check("pose:thread 解堵门四条件缺一不可（僵尸绑定签名）",
        PoseSessionPolicy.ShouldUnblockForCommand(700, false, true, true)
        && !PoseSessionPolicy.ShouldUnblockForCommand(0, false, true, true)
        && !PoseSessionPolicy.ShouldUnblockForCommand(700, true, true, true)
        && !PoseSessionPolicy.ShouldUnblockForCommand(700, false, false, true)
        && !PoseSessionPolicy.ShouldUnblockForCommand(700, false, true, false));

    Check("pose:thread 待机兜底 id=3（学习集空）", PoseSessionPolicy.PickIdleId(Array.Empty<ushort>()) == 3);
    Check("pose:thread 待机取学习集首个", PoseSessionPolicy.PickIdleId(new ushort[] { 41, 42 }) == 41);

    Check("pose:thread 测时长队列 16 条上限（防积压）",
        PoseMeasureQueue.MaxQueued == 16 && PoseMeasureQueue.CanEnqueue(15) && !PoseMeasureQueue.CanEnqueue(16));
}

// X1 守卫采集不可用（TASK-20260910-X1-OFFLINE-GUARD）：三条离线守卫回归（命名用例，全量
// 套件同样执行）+ 手动接管/OnShowStart 语义特性化（REG-PARITY 保全目标）。断言本体在
// ShowGuardAvailabilityTests.cs，命名模式与全量模式共用同一批断言。
Console.WriteLine("== X1 守卫采集不可用（倒计时故障/演中取消/恢复重演/手动接管） ==");
ShowGuardAvailabilityCases.RunCountdownCase(Check);
ShowGuardAvailabilityCases.RunCancelCase(Check);
ShowGuardAvailabilityCases.RunReplayCase(Check);
ShowGuardAvailabilityCases.RunManualTakeoverCase(Check);

Console.WriteLine($"\n结果：{pass} 通过 / {fail} 失败");
return fail > 0 ? 1 : 0;

void PackageIndexTest(string root)
{
    var idxPath = PackWriter.CreatePackRoot(root, 4, 0, 21, 1); // 拉拉菲尔/男/战士/单手剑
    Check("index.json 生成", File.Exists(idxPath));
    Check("clips 三目录", 
        Directory.Exists(Path.Combine(root, "clips", "emotes"))
        && Directory.Exists(Path.Combine(root, "clips", "jobs"))
        && Directory.Exists(Path.Combine(root, "clips", "generic")));

    // AddClip：表情（无 jobId）
    var clip = new AnimClipData { name = "bow", duration = 1.6f, type = "once" };
    PackWriter.AddClip(root, "/bow", new PackWriter.ClipEntry { file = "", duration = 1.6f, type = "once" }, clip);
    Check("表情 clip 文件", File.Exists(Path.Combine(root, "clips", "emotes", "bow.json")));

    // AddClip：技能（带 jobId）
    var hs = new AnimClipData { name = "heavy-swing", duration = 2.1f, type = "once" };
    PackWriter.AddClip(root, "/ac \"重斩\"", new PackWriter.ClipEntry { file = "", duration = 2.1f, type = "once", jobId = 21, weapon = 1 }, hs);
    Check("技能 clip 目录（职业）", File.Exists(Path.Combine(root, "clips", "jobs", "21", "ac 重斩.json")));

    var idx = PackWriter.LoadIndexFile(Path.Combine(root, "index.json"));
    Check("index 含 bow", idx != null && idx!.clips.ContainsKey("bow"));
    Check("index 含重斩（jobId/weapon 落档）", idx!.clips.ContainsKey("ac 重斩") && idx.clips["ac 重斩"].jobId == 21 && idx.clips["ac 重斩"].weapon == 1);
    Check("index 路径正确（职业目录前缀）", idx.clips["ac 重斩"].file.StartsWith("clips/jobs/21/"));
    // 2026-08-31 审计 P1：_meta 占位已删——它指向从未生成的 jobs/{jobId}/_weapon_*.json
    Check("index 无 _meta 悬空占位", !idx.clips.ContainsKey("_meta"));

    // AnimWriter 原子落盘（2026-08-31 审计 P0）：WriteFile 走 .committing 两阶段，
    // 正常路径不留半成品，最终文件完整可解析
    var atomicClip = new AnimClipData { name = "atomic", duration = 1.0f, type = "once" };
    var atomicPath = Path.Combine(root, "clips", "generic", "atomic.json");
    AnimWriter.WriteFile(atomicClip, atomicPath);
    Check("原子写：最终文件生成且无 .committing 残留",
        File.Exists(atomicPath) && !File.Exists(atomicPath + ".committing")
        && System.Text.Json.JsonSerializer.Deserialize<AnimClipData>(File.ReadAllText(atomicPath))!.name == "atomic");
    AnimWriter.WriteFile(new AnimClipData { name = "atomic2", duration = 2.0f, type = "once" }, atomicPath);
    Check("原子写：覆盖路径走 File.Replace 也完整",
        !File.Exists(atomicPath + ".committing")
        && System.Text.Json.JsonSerializer.Deserialize<AnimClipData>(File.ReadAllText(atomicPath))!.name == "atomic2");
}
