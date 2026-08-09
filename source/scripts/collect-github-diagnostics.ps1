$ErrorActionPreference = "Stop"

$repo = Split-Path $PSScriptRoot -Parent

$userData = "$env:APPDATA\Codex Web GPT"

$latestDir  = Join-Path $repo "diagnostics\latest"
$historyDir = Join-Path $repo "diagnostics\history"

New-Item -ItemType Directory -Force -Path $latestDir  | Out-Null
New-Item -ItemType Directory -Force -Path $historyDir | Out-Null

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"

$latest = Join-Path $latestDir `
    "CODEX_WEB_GPT_ERROR_DIAGNOSTIC.txt"

$history = Join-Path $historyDir `
    "CODEX_WEB_GPT_ERROR_DIAGNOSTIC_$stamp.txt"

$utf8 = New-Object System.Text.UTF8Encoding($false)

$sb = New-Object System.Text.StringBuilder

function Add-Line {
    param([AllowNull()][object]$Text = "")

    if ($null -eq $Text) {
        [void]$sb.AppendLine("")
    }
    else {
        [void]$sb.AppendLine([string]$Text)
    }
}

function Redact-Line {
    param([AllowNull()][string]$Text)

    if ($null -eq $Text) {
        return ""
    }

    $x = $Text

    $x = $x `
        -replace '(?i)(authorization\s*[:=]\s*bearer\s+)[^\s"]+', '$1[REDACTED]' `
        -replace '(?i)(api[_-]?key\s*[:=]\s*)[^\s",]+', '$1[REDACTED]' `
        -replace '(?i)(access[_-]?token\s*[:=]\s*)[^\s",]+', '$1[REDACTED]' `
        -replace '(?i)(refresh[_-]?token\s*[:=]\s*)[^\s",]+', '$1[REDACTED]' `
        -replace '(?i)(id[_-]?token\s*[:=]\s*)[^\s",]+', '$1[REDACTED]' `
        -replace '(?i)(cookie\s*[:=]\s*)[^\r\n]+', '$1[REDACTED]' `
        -replace '(?i)(set-cookie\s*[:=]\s*)[^\r\n]+', '$1[REDACTED]'

    return $x
}

Add-Line "============================================================"
Add-Line "CODEX WEB GPT GITHUB DIAGNOSTIC"
Add-Line "Generated: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss.fff')"
Add-Line "============================================================"

Add-Line ""
Add-Line "===== ENVIRONMENT ====="

Add-Line "Computer: $env:COMPUTERNAME"
Add-Line "UserData: $userData"
Add-Line "Repo: $repo"

Add-Line ""
Add-Line "===== PORTS ====="

foreach ($port in @(4178,17841)) {

    $p = Get-NetTCPConnection `
        -LocalPort $port `
        -State Listen `
        -ErrorAction SilentlyContinue |
        Select-Object -First 1

    if ($p) {
        Add-Line "$port = LISTENING / PID $($p.OwningProcess)"
    }
    else {
        Add-Line "$port = NOT LISTENING"
    }
}

Add-Line ""
Add-Line "===== PROCESSES ====="

$processes = Get-CimInstance Win32_Process |
    Where-Object {
        $_.CommandLine -match `
        'codex-chatgpt-web|browser-helper|electron|src\\cli.ts'
    }

foreach ($p in $processes) {

    Add-Line ""
    Add-Line "PID: $($p.ProcessId)"
    Add-Line "NAME: $($p.Name)"
    Add-Line (Redact-Line "CMD: $($p.CommandLine)")
}

Add-Line ""
Add-Line "===== LAUNCHER LOG ====="

$launcherLogs = @(
    Get-ChildItem `
        -LiteralPath $userData `
        -Filter "launcher.jsonl" `
        -File `
        -Recurse `
        -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending
)

$sourceFiles = New-Object System.Collections.Generic.List[string]

if ($launcherLogs.Count -gt 0) {

    foreach ($log in $launcherLogs) {

        [void]$sourceFiles.Add($log.FullName)

        Add-Line ""
        Add-Line "FILE: $($log.FullName)"
        Add-Line "SIZE: $($log.Length)"
        Add-Line "MODIFIED: $($log.LastWriteTime)"
        Add-Line "----- LAST 1000 LINES -----"

        Get-Content `
            -LiteralPath $log.FullName `
            -Tail 1000 `
            -ErrorAction SilentlyContinue |
            ForEach-Object {
                Add-Line (Redact-Line $_)
            }
    }
}
else {
    Add-Line "launcher.jsonl NOT FOUND"
}

Add-Line ""
Add-Line "===== CODEX TEXT LOOP LOG ====="

$tempLog = Get-ChildItem `
    "$env:LOCALAPPDATA\Temp" `
    -Filter "JDCLOUD_TEXT_LOOP_*.log" `
    -File `
    -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1

if ($tempLog) {

    [void]$sourceFiles.Add($tempLog.FullName)

    Add-Line "FILE: $($tempLog.FullName)"
    Add-Line "SIZE: $($tempLog.Length)"
    Add-Line "MODIFIED: $($tempLog.LastWriteTime)"
    Add-Line "----- FULL / LAST 1000 LINES -----"

    Get-Content `
        -LiteralPath $tempLog.FullName `
        -Tail 1000 `
        -ErrorAction SilentlyContinue |
        ForEach-Object {
            Add-Line (Redact-Line $_)
        }
}
else {
    Add-Line "JDCLOUD_TEXT_LOOP LOG NOT FOUND"
}

Add-Line ""
Add-Line "===== IMPORTANT ERROR MATCHES ====="

$patterns = @(
    "Something went wrong",
    "stream disconnected",
    "Reconnecting",
    "failed to refresh",
    "metadata",
    "browser",
    "exception",
    "error",
    "response",
    "turn"
)

foreach ($file in ($sourceFiles | Select-Object -Unique)) {

    Add-Line ""
    Add-Line "SEARCH FILE: $file"

    $matches = Select-String `
        -LiteralPath $file `
        -Pattern $patterns `
        -SimpleMatch `
        -ErrorAction SilentlyContinue

    foreach ($m in $matches) {

        Add-Line (
            Redact-Line (
                "LINE $($m.LineNumber): $($m.Line)"
            )
        )
    }
}

Add-Line ""
Add-Line "===== END ====="

# 删除任何意外的 NUL 字符
$text = $sb.ToString().Replace(([char]0).ToString(), "")

# 统一 LF，避免 Windows/Git 编码与换行问题
$text = $text.Replace("`r`n", "`n").Replace("`r", "`n")

# 一次性写入纯 UTF-8，无 BOM
[System.IO.File]::WriteAllText(
    $latest,
    $text,
    $utf8
)

[System.IO.File]::WriteAllText(
    $history,
    $text,
    $utf8
)

Write-Host ""
Write-Host "==========================================" -ForegroundColor Green
Write-Host "GitHub 诊断文件生成完成" -ForegroundColor Green
Write-Host "==========================================" -ForegroundColor Green

Write-Host ""
Write-Host "LATEST:"
Write-Host $latest -ForegroundColor Cyan

Write-Host ""
Write-Host "HISTORY:"
Write-Host $history -ForegroundColor Cyan

Write-Host ""
Write-Host "Encoding = UTF-8 / NO BOM / NO NUL" -ForegroundColor Green