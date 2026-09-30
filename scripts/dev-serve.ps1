# 这个脚本是干嘛的：开发期临时静态文件服务器（默认 48796 端口，服务 web\dist\ChoreoHelper）。
# 用途：在游戏插件未更新、48795 不能发 libs/ 新资产的过渡期，本地验证网页。
# 注意：只在本机开发测试用，验完就关；48795 永远归插件 ExportServer 管。
param(
  [string]$Root = (Join-Path $PSScriptRoot '..\web\dist\ChoreoHelper'),
  [int]$Port = 48796
)
$Root = [System.IO.Path]::GetFullPath($Root)
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")
$listener.Start()
Write-Output "serving $Root at http://localhost:$Port/ (Ctrl+C 退出)"
$mime = @{
  '.html'='text/html; charset=utf-8'; '.js'='application/javascript; charset=utf-8'
  '.mjs'='application/javascript; charset=utf-8'; '.css'='text/css; charset=utf-8'
  '.json'='application/json; charset=utf-8'; '.gltf'='model/gltf'; '.glb'='model/gltf-binary'
  '.png'='image/png'; '.jpg'='image/jpeg'; '.svg'='image/svg+xml'
}
try {
  while ($listener.IsListening) {
    $ctx = $listener.GetContext()
    try {
      $rel = $ctx.Request.Url.AbsolutePath.TrimStart('/')
      if ($rel -eq '') { $rel = 'pose-viewer.html' }
      $file = Join-Path $Root ($rel -replace '/', '\')
      $full = [System.IO.Path]::GetFullPath($file)
      if (-not $full.StartsWith($Root, [System.StringComparison]::OrdinalIgnoreCase) -or -not (Test-Path $full -PathType Leaf)) {
        $ctx.Response.StatusCode = 404
        $ctx.Response.Close()
        continue
      }
      $bytes = [System.IO.File]::ReadAllBytes($full)
      $ext = [System.IO.Path]::GetExtension($full).ToLowerInvariant()
      if ($mime.ContainsKey($ext)) { $ctx.Response.ContentType = $mime[$ext] } else { $ctx.Response.ContentType = 'application/octet-stream' }
      $ctx.Response.Headers.Add('Access-Control-Allow-Origin', '*')
      $ctx.Response.ContentLength64 = $bytes.Length
      $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
      $ctx.Response.Close()
    } catch { try { $ctx.Response.Close() } catch {} }
  }
} finally { $listener.Stop() }
