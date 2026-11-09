# dsh-free-search 引擎切换工具（PowerShell 版）
#
# 只改 profile patch 里 `web-search-free` 条目的 provider（引擎名），
# 绝不触碰 searchProvider（provider id）、绝不新增 `- id: web`。
#
# 用法：
#   .\switch-engine.ps1 -Engine bing
#   .\switch-engine.ps1 -Engine auto -Profile desktop
#   .\switch-engine.ps1 -List

param(
    [string]$Engine,
    [string]$Profile,
    [switch]$List
)

$ErrorActionPreference = 'Stop'

# 插件 lib/index.js 里 ALL_ENGINES 的真实取值 + 路由模式
$ValidEngines = @(
    'ddg','ddg-lite','bing','searxng','degoog','anysearch',
    'exa','tavily','keenable','firecrawl','parallel','perplexity',
    'serpbase','serply','outcrawl','deepseek-official','deepseek-tools','you',
    'baidu','kimi','aliyun','doubao','tinyfish','jina',
    'zhihu_global','zhihu_site','agy','openai','gemini','claude',
    'so360','sogou','wechat','toutiao'
)
$ValidModes = @('auto','multi')
$EntryId = 'web-search-free'
$PackageName = 'dsh-free-search'

if ($List) {
    Write-Host ""
    Write-Host "可用引擎（免 key 优先）:" -ForegroundColor Cyan
    ($ValidEngines) | ForEach-Object { Write-Host ("  {0}" -f $_) }
    Write-Host ""
    Write-Host "路由模式:" -ForegroundColor Cyan
    $ValidModes | ForEach-Object { Write-Host ("  {0}" -f $_) }
    Write-Host ""
    exit 0
}

if (-not $Engine) {
    Write-Host "ERROR: 需要指定 -Engine <名称>，或用 -List 查看全部。" -ForegroundColor Red
    exit 1
}

if (-not ($ValidModes -contains $Engine) -and -not ($ValidEngines -contains $Engine)) {
    Write-Host "ERROR: 未知引擎 '$Engine'。用 -List 查看可用值。" -ForegroundColor Red
    exit 1
}

# ── 定位 profile（不再硬编码 profiles\web） ────────────────────────────────
$dshHome = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $env:USERPROFILE '.dsh' }
$profilesRoot = Join-Path $dshHome 'profiles'

$profileName = $Profile
if (-not $profileName) { $profileName = $env:DSH_PROFILE }

if (-not $profileName) {
    # 只在「唯一装了本插件」的 profile 里自动定位；多个都装时必须显式指定，
    # 绝不默认写 desktop（否则 web 环境的操作会串写到桌面版）。
    $withPlugin = @()
    if (Test-Path $profilesRoot) {
        $withPlugin = Get-ChildItem $profilesRoot -Directory -ErrorAction SilentlyContinue | Where-Object {
            (Test-Path (Join-Path $_.FullName 'cordis.patch.yml')) -and (
                (Test-Path (Join-Path $_.FullName "node_modules\$PackageName")) -or
                ((Get-Content (Join-Path $_.FullName 'package.json') -Raw -ErrorAction SilentlyContinue) -match [regex]::Escape($PackageName))
            )
        } | Select-Object -ExpandProperty Name
    }

    if ($withPlugin.Count -eq 1) {
        $profileName = $withPlugin[0]
    }
    elseif ($withPlugin.Count -gt 1) {
        Write-Host "ERROR: 多个 profile 都装了 ${PackageName}：" -ForegroundColor Red
        $withPlugin | ForEach-Object { Write-Host "  $_" -ForegroundColor Yellow }
        Write-Host ""
        Write-Host "为避免写到错误的环境，请显式指定 -Profile，例如：" -ForegroundColor Yellow
        Write-Host "  .\switch-engine.ps1 -Engine $Engine -Profile desktop"
        Write-Host "  .\switch-engine.ps1 -Engine $Engine -Profile web"
        exit 1
    }
    else {
        Write-Host "ERROR: 没有找到安装了 $PackageName 的 profile。" -ForegroundColor Red
        Write-Host "请先安装，或用 -Profile 指定 profile 名。" -ForegroundColor Yellow
        exit 1
    }
}

$patchFile = Join-Path $profilesRoot (Join-Path $profileName 'cordis.patch.yml')

if (-not (Test-Path $patchFile)) {
    Write-Host "ERROR: 找不到 patch 文件 $patchFile" -ForegroundColor Red
    Write-Host "提示：profile 名可用 -Profile 指定；当前可用：" -ForegroundColor Yellow
    if (Test-Path $profilesRoot) {
        Get-ChildItem $profilesRoot -Directory | Select-Object -ExpandProperty Name | ForEach-Object { Write-Host "  $_" }
    }
    exit 1
}

# ── 读取（保留 BOM 与换行风格） ────────────────────────────────────────────
$bytes = [System.IO.File]::ReadAllBytes($patchFile)
$hasBom = ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF)
$text = [System.IO.File]::ReadAllText($patchFile, [System.Text.Encoding]::UTF8)
if ($text.Length -gt 0 -and $text[0] -eq [char]0xFEFF) { $text = $text.Substring(1) }

$crlfCount = ([regex]::Matches($text, "`r`n")).Count
$lfCount = ([regex]::Matches($text, "(?<!`r)`n")).Count
$eol = if ($crlfCount -gt $lfCount) { "`r`n" } else { "`n" }

$lines = [System.Collections.ArrayList]::new()
foreach ($l in ($text -split "`r?`n")) { [void]$lines.Add($l) }

# ── 定位 `- id: web-search-free` 块 ────────────────────────────────────────
$start = -1
for ($i = 0; $i -lt $lines.Count; $i++) {
    if ($lines[$i] -match ("^-\s+id:\s*[""']?" + [regex]::Escape($EntryId) + "[""']?\s*$")) { $start = $i; break }
}

$changed = $false
if ($start -ge 0) {
    $end = $lines.Count
    for ($i = $start + 1; $i -lt $lines.Count; $i++) {
        if ($lines[$i] -match '^-\s') { $end = $i; break }
    }

    $found = $false
    for ($i = $start; $i -lt $end; $i++) {
        if ($lines[$i] -match '^(\s{2,})provider:\s*(.*?)\s*$') {
            $indent = $Matches[1]
            $lines[$i] = "$indent" + "provider: $Engine"
            $found = $true
            $changed = $true
            break
        }
    }

    if (-not $found) {
        # 没有 provider 字段：插到 config: 之后
        $anchor = $start
        for ($i = $start; $i -lt $end; $i++) {
            if ($lines[$i] -match '^\s{2}config:\s*$') { $anchor = $i; break }
        }
        $lines.Insert($anchor + 1, "    provider: $Engine")
        $changed = $true
    }
    Write-Host "已切换引擎: ${Engine}（profile: ${profileName}）" -ForegroundColor Green
}
else {
    # 条目不存在：追加完整条目（含 name，绝不只写 - id: web）
    while ($lines.Count -gt 0 -and $lines[$lines.Count - 1].Trim() -eq '') { $lines.RemoveAt($lines.Count - 1) }
    [void]$lines.Add('')
    [void]$lines.Add("- id: $EntryId")
    [void]$lines.Add("  name: $PackageName")
    [void]$lines.Add('  config:')
    [void]$lines.Add("    provider: $Engine")
    [void]$lines.Add('')
    $changed = $true
    Write-Host "已新增 $EntryId 条目并设置引擎: $Engine" -ForegroundColor Green
}

if (-not $changed) {
    Write-Host "无需改动：当前已是 $Engine" -ForegroundColor Yellow
    exit 0
}

# ── 备份 + 写回 ────────────────────────────────────────────────────────────
$backup = "$patchFile.bak-" + [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
Copy-Item $patchFile $backup
$out = ($lines -join $eol)
[System.IO.File]::WriteAllText($patchFile, $out, (New-Object System.Text.UTF8Encoding($hasBom)))

Write-Host ""
Write-Host "已写入: $patchFile" -ForegroundColor Cyan
Write-Host "已备份: $backup" -ForegroundColor DarkGray
Write-Host ""
Write-Host "注意：本工具只改 web-search-free 条目的 provider（引擎名），" -ForegroundColor DarkGray
Write-Host "      不会改动 searchProvider（provider id），也不会新增 - id: web。" -ForegroundColor DarkGray
Write-Host ""
Write-Host "若 DSH 未自动热载，重新打开设置页或重启 DSH 生效。" -ForegroundColor Yellow
