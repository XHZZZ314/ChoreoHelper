// dump-action-refs — TASK-20260917-SKILL-ANIM-CHANNEL 阶段二：Action 表动画引用离线导出器。
// 干嘛的：游戏不开，用 XIVLauncherCN dev SDK 的 Lumina 反射（口径=p0 lumina-export 同源）只读
//        dump Action 表的 ActionTimeline 引用（AnimationEnd=出招 / AnimationStart=施放起手），
//        写出 action-refs.tsv（rowId\tname\tjobName\tjobId\tendKey\tstartKey）供 make-anim-pack.js 用。
// 语言要点：Action 是本地化表，国服数据须 DefaultExcelLanguage=ChineseSimplified（调研实证）；
//         生成表列为属性，逐属性反射读取；AnimationStart 是间接引用（.Value.Name 才是 RowRef<ActionTimeline>）。
// 怎么跑（PowerShell，SDK 10 跑 net8 需前滚）：
//   $env:DOTNET_ROLL_FORWARD='Major'
//   dotnet run --project scripts/anim-pack/dump-action-refs/dump-action-refs.csproj -c Release -- scripts/anim-pack/action-refs.tsv
//   Remove-Item Env:DOTNET_ROLL_FORWARD
using System;
using System.Collections.Generic;
using System.IO;
using System.Reflection;
using System.Text;

class Program {
  static int Main(string[] args) {
    var dev = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "XIVLauncherCN/addon/Hooks/dev");
    AppDomain.CurrentDomain.AssemblyResolve += (s, e) => {
      var p = Path.Combine(dev, new AssemblyName(e.Name).Name + ".dll");
      return File.Exists(p) ? Assembly.LoadFrom(p) : null;
    };
    var outPath = args.Length > 0 ? args[0] : "scripts/anim-pack/action-refs.tsv";
    var lumina = Assembly.LoadFrom(Path.Combine(dev, "Lumina.dll"));
    var excelAsm = Assembly.LoadFrom(Path.Combine(dev, "Lumina.Excel.dll"));
    var rowType = excelAsm.GetType("Lumina.Excel.Sheets.Action");
    if (rowType == null) { Console.WriteLine("FAIL: Action type not found"); return 3; }
    var gdt = lumina.GetType("Lumina.GameData");
    var ctor = gdt.GetConstructor(new[] { typeof(string), lumina.GetType("Lumina.LuminaOptions") });
    var gdDef = ctor.Invoke(new[] { "D:/Program Files/上海数龙科技有限公司/最终幻想XIV/game/sqpack", Activator.CreateInstance(lumina.GetType("Lumina.LuminaOptions")) });
    var excelMod = gdDef.GetType().GetProperty("Excel").GetValue(gdDef);
    var getSheet = Array.Find(excelMod.GetType().GetMethods(), m => m.Name == "GetSheet" && m.IsGenericMethodDefinition && m.GetParameters().Length == 2);
    if (getSheet == null) { Console.WriteLine("FAIL: GetSheet(Language?,string) not found"); return 3; }
    var langEnum = Nullable.GetUnderlyingType(getSheet.GetParameters()[0].ParameterType) ?? getSheet.GetParameters()[0].ParameterType;
    var zh = Enum.Parse(langEnum, "ChineseSimplified");
    // 调研实证：显式传语言在默认 options（English）下会被拒；须把 ChineseSimplified 落在
    // LuminaOptions.DefaultExcelLanguage 上，再以 null 语言调 GetSheet（null=用 DefaultExcelLanguage）。
    var lo = Activator.CreateInstance(lumina.GetType("Lumina.LuminaOptions"));
    lo.GetType().GetProperty("DefaultExcelLanguage").SetValue(lo, zh);
    var gd = ctor.Invoke(new[] { "D:/Program Files/上海数龙科技有限公司/最终幻想XIV/game/sqpack", lo });
    var excelMod2 = gd.GetType().GetProperty("Excel").GetValue(gd);
    object sheet;
    try { sheet = getSheet.MakeGenericMethod(rowType).Invoke(excelMod2, new object[] { null, "Action" }); }
    catch (Exception ex) { Console.WriteLine("FAIL: ChineseSimplified 不被支持：" + (ex.InnerException?.Message ?? ex.Message)); return 3; }

    object getVal(object o, MemberInfo m) => m is PropertyInfo p ? p.GetValue(o) : ((FieldInfo)m).GetValue(o);
    MemberInfo mem(string name) {
      foreach (var m in rowType.GetMembers(BindingFlags.Public | BindingFlags.Instance))
        if ((m is PropertyInfo || m is FieldInfo) && m.Name == name) return m;
      return null;
    }
    var hitMem = mem("ActionTimelineHit"); var endMem = mem("AnimationEnd"); var startMem = mem("AnimationStart");
    var nameMem = mem("Name"); var jobMem = mem("ClassJob");
    var sb = new StringBuilder();
    sb.Append("# action-refs.tsv - Action 表出招/施放引用导出（dump-action-refs 生成，勿手改；游戏大版本更新后重跑）\n");
    sb.Append("# rowId\tname\tjobName\tjobId\tendKey(AnimationEnd)\tstartKey(AnimationStart)\n");
    long rows = 0, withRef = 0;
    foreach (var row in (System.Collections.IEnumerable)sheet) {
      rows++;
      var rt = row.GetType();
      var rowId = (uint)rt.GetProperty("RowId").GetValue(row);
      var name = (getVal(row, nameMem) ?? "").ToString();
      var classJobRef = getVal(row, jobMem);
      string jobName = ""; uint jobId = 0;
      if (classJobRef != null && (bool)classJobRef.GetType().GetProperty("IsValid").GetValue(classJobRef)) {
        jobId = (uint)classJobRef.GetType().GetProperty("RowId").GetValue(classJobRef);
        var cjv = classJobRef.GetType().GetProperty("Value").GetValue(classJobRef);
        jobName = (cjv.GetType().GetProperty("Name")?.GetValue(cjv) ?? "").ToString();
      }
      if (string.IsNullOrEmpty(name) || string.IsNullOrEmpty(jobName)) continue;
      string KeyOf(object rv) {
        if (rv == null) return "";
        var rid = (uint)rv.GetType().GetProperty("RowId").GetValue(rv);
        if (!(bool)rv.GetType().GetProperty("IsValid").GetValue(rv) || rid == 0) return "";
        var v = rv.GetType().GetProperty("Value").GetValue(rv);
        var k = v.GetType().GetField("Key")?.GetValue(v) ?? v.GetType().GetProperty("Key")?.GetValue(v);
        return k == null ? "" : k.ToString();
      }
      var endKey = KeyOf(getVal(row, endMem));
      string startKey = "";
      var asRef = getVal(row, startMem);
      if (asRef != null && (bool)asRef.GetType().GetProperty("IsValid").GetValue(asRef) && (uint)asRef.GetType().GetProperty("RowId").GetValue(asRef) != 0) {
        try {
          var asv = asRef.GetType().GetProperty("Value").GetValue(asRef);
          var nameRef = asv.GetType().GetProperty("Name")?.GetValue(asv);
          startKey = KeyOf(nameRef);
        } catch (Exception) { startKey = ""; }
      }
      if (string.IsNullOrEmpty(endKey) && string.IsNullOrEmpty(startKey)) continue;
      withRef++;
      sb.Append(rowId).Append('\t').Append(name.Replace('\t', ' ')).Append('\t').Append(jobName.Replace('\t', ' ')).Append('\t').Append(jobId).Append('\t').Append(endKey).Append('\t').Append(startKey).Append('\n');
    }
    File.WriteAllText(outPath, sb.ToString(), new UTF8Encoding(false));
    Console.WriteLine($"ROWS {rows} WITHREF {withRef} WRITTEN {Path.GetFullPath(outPath)}");
    return 0;
  }
}
