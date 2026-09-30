// 从已安装国服游戏的只读 Action 表导出技能基础值；不启动游戏、不读取人物、不连接插件。
using System.Collections;
using System.Reflection;
using System.Security.Cryptography;
using System.Text.Json;

if (args.Length != 3)
{
    Console.Error.WriteLine("用法：dump-catalog-metadata <game目录> <Dalamud dev目录> <新输出JSON>");
    return 2;
}
var gameRoot = Path.GetFullPath(args[0]);
var devRoot = Path.GetFullPath(args[1]);
var output = Path.GetFullPath(args[2]);
if (File.Exists(output)) throw new IOException("输出已存在，请使用新文件以保留旧证据");
var gameVersion = File.ReadAllText(Path.Combine(gameRoot, "ffxivgame.ver")).Trim();
AppDomain.CurrentDomain.AssemblyResolve += (_, ev) =>
{
    var file = Path.Combine(devRoot, new AssemblyName(ev.Name).Name + ".dll");
    return File.Exists(file) ? Assembly.LoadFrom(file) : null;
};
var luminaPath = Path.Combine(devRoot, "Lumina.dll");
var excelPath = Path.Combine(devRoot, "Lumina.Excel.dll");
var lumina = Assembly.LoadFrom(luminaPath);
var excel = Assembly.LoadFrom(excelPath);
var rowType = excel.GetType("Lumina.Excel.Sheets.Action", true)!;
var optionsType = lumina.GetType("Lumina.LuminaOptions", true)!;
var gameDataType = lumina.GetType("Lumina.GameData", true)!;
var options = Activator.CreateInstance(optionsType)!;
var language = optionsType.GetProperty("DefaultExcelLanguage")!;
language.SetValue(options, Enum.Parse(language.PropertyType, "ChineseSimplified"));
var gameData = Activator.CreateInstance(gameDataType, Path.Combine(gameRoot, "sqpack"), options)!;
try
{
    var module = gameDataType.GetProperty("Excel")!.GetValue(gameData)!;
    var sheetMethod = module.GetType().GetMethods().Single(m => m.Name == "GetSheet" && m.IsGenericMethodDefinition && m.GetParameters().Length == 2);
    var sheet = (IEnumerable)sheetMethod.MakeGenericMethod(rowType).Invoke(module, [null, "Action"])!;
    object Field(object obj, string name)
    {
        var prop = obj.GetType().GetProperty(name) ?? throw new InvalidDataException("Action 表缺少字段：" + name);
        return prop.GetValue(obj) ?? throw new InvalidDataException("Action 字段为空：" + name);
    }
    long Number(object row, string name) => Convert.ToInt64(Field(row, name));
    var rows = new List<object>();
    foreach (var row in sheet)
    {
        var id = Number(row, "RowId");
        var name = Field(row, "Name").ToString()!;
        var jobRef = Field(row, "ClassJob");
        if (id <= 0 || string.IsNullOrWhiteSpace(name) || !(bool)Field(jobRef, "IsValid")) continue;
        var job = Field(jobRef, "Value");
        var jobName = Field(job, "Name").ToString()!;
        if (string.IsNullOrWhiteSpace(jobName)) continue;
        rows.Add(new
        {
            id, name, jobId = Number(jobRef, "RowId"), jobName,
            type = "action",
            staticMetadata = new
            {
                version = 1, actionId = id,
                castMs = checked(Number(row, "Cast100ms") * 100),
                recastMs = checked(Number(row, "Recast100ms") * 100),
                requiredLevel = Number(row, "ClassJobLevel"),
                maxCharges = Number(row, "MaxCharges"),
                range = Number(row, "Range"), effectRange = Number(row, "EffectRange")
            }
        });
    }
    string Hash(string file) => Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(file))).ToLowerInvariant();
    var payload = new
    {
        schemaVersion = 1, source = "local-game-action-sheet", gameVersion,
        language = "ChineseSimplified", generatedAt = DateTimeOffset.UtcNow,
        luminaSha256 = Hash(luminaPath), excelSha256 = Hash(excelPath), actions = rows
    };
    if (File.ReadAllText(Path.Combine(gameRoot, "ffxivgame.ver")).Trim() != gameVersion)
        throw new InvalidDataException("导出期间游戏版本变化，未写入输出，请更新完成后重试");
    using var stream = new FileStream(output, FileMode.CreateNew, FileAccess.Write, FileShare.None);
    JsonSerializer.Serialize(stream, payload, new JsonSerializerOptions { WriteIndented = true });
    Console.WriteLine($"Exported {rows.Count} Action metadata rows; gameVersion={gameVersion}; output={output}");
}
finally { (gameData as IDisposable)?.Dispose(); }
return 0;
