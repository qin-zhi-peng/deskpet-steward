# DeskPet Steward · 启停脚本（Windows）
#
# 用法：
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\start.ps1
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\steward.ps1 start|stop|restart|status|logs [-NoPet]
#
# 桌宠需要先装依赖：cd pet; npm install
param(
  [Parameter(Position = 0)][ValidateSet('start', 'stop', 'restart', 'status', 'logs')][string]$Action = 'start',
  [switch]$NoPet
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$DataDir = Join-Path $Root 'data'
$LogDir = Join-Path $Root 'logs'
$ServerPidFile = Join-Path $DataDir 'server.pid'
$PetPidFile = Join-Path $DataDir 'pet.pid'
$PetDir = Join-Path $Root 'pet'
New-Item -ItemType Directory -Force -Path $DataDir, $LogDir | Out-Null

# 端口：环境变量 > config.json > 8795
$Port = 8795
if ($env:STEWARD_PORT) {
  $Port = [int]$env:STEWARD_PORT
} else {
  $cfgFile = Join-Path $Root 'config.json'
  if (Test-Path $cfgFile) {
    try {
      $cfg = Get-Content $cfgFile -Raw -Encoding UTF8 | ConvertFrom-Json
      if ($cfg.server -and $cfg.server.port) { $Port = [int]$cfg.server.port }
    } catch {}
  }
}

function Get-ProcessByPidFile($file) {
  if (-not (Test-Path $file)) { return $null }
  $pidText = (Get-Content $file -Raw).Trim()
  if (-not $pidText) { return $null }
  try { return Get-Process -Id ([int]$pidText) -ErrorAction Stop } catch { return $null }
}

function Get-ListeningPid($port) {
  try {
    $conn = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction Stop | Select-Object -First 1
    if ($conn) { return [int]$conn.OwningProcess }
  } catch {}
  return $null
}

function Start-Server {
  $existing = Get-ListeningPid $Port
  if ($existing) {
    Write-Host "[i] 端口 $Port 已在监听（PID $existing），不重复启动"
    return
  }
  $node = (Get-Command node -ErrorAction Stop).Source
  $out = Join-Path $LogDir 'server.out.log'
  $err = Join-Path $LogDir 'server.err.log'
  $p = Start-Process -FilePath $node -ArgumentList @('server/index.mjs') -WorkingDirectory $Root `
    -WindowStyle Hidden -RedirectStandardOutput $out -RedirectStandardError $err -PassThru
  Set-Content -Path $ServerPidFile -Value $p.Id -Encoding ascii
  Write-Host "[+] 服务启动 PID $($p.Id)  http://127.0.0.1:$Port"
}

function Start-Pet {
  if ($NoPet) { Write-Host '[i] 跳过桌宠（-NoPet）'; return }
  $existing = Get-ProcessByPidFile $PetPidFile
  if ($existing) { Write-Host "[i] 桌宠已在运行（PID $($existing.Id)）"; return }
  if (-not (Test-Path (Join-Path $PetDir 'package.json'))) { Write-Host '[i] 没有 pet/package.json，跳过桌宠'; return }

  $electron = Join-Path $PetDir 'node_modules\electron\dist\electron.exe'
  if (-not (Test-Path $electron)) {
    Write-Host '[!] 没找到 Electron：先在 pet 目录跑一次 npm install'
    return
  }

  # 关键：有的终端/IDE 带着 ELECTRON_RUN_AS_NODE=1，会让 Electron 退化成纯 Node 秒退
  $old = $env:ELECTRON_RUN_AS_NODE
  Remove-Item Env:\ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
  $env:STEWARD_AGENT_URL = "http://127.0.0.1:$Port"
  $out = Join-Path $LogDir 'pet.out.log'
  $err = Join-Path $LogDir 'pet.err.log'
  try {
    $p = Start-Process -FilePath $electron -ArgumentList @($PetDir) -WorkingDirectory $PetDir `
      -RedirectStandardOutput $out -RedirectStandardError $err -PassThru
    Set-Content -Path $PetPidFile -Value $p.Id -Encoding ascii
    Write-Host "[+] 桌宠启动 PID $($p.Id)"
  } catch {
    Write-Host "[!] 桌宠启动失败：$($_.Exception.Message)"
  } finally {
    if ($null -ne $old) { $env:ELECTRON_RUN_AS_NODE = $old }
    else { Remove-Item Env:\ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue }
  }
}

function Stop-All {
  foreach ($pair in @(@{ Name = '桌宠'; File = $PetPidFile }, @{ Name = '服务'; File = $ServerPidFile })) {
    $p = Get-ProcessByPidFile $pair.File
    if ($p) { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue; Write-Host "[-] 已停止$($pair.Name) PID $($p.Id)" }
    Remove-Item $pair.File -ErrorAction SilentlyContinue
  }
  $portPid = Get-ListeningPid $Port
  if ($portPid) { Stop-Process -Id $portPid -Force -ErrorAction SilentlyContinue; Write-Host "[-] 已停止占用 $Port 的进程 $portPid" }
  # 只清理命令行里带本项目 pet 目录的 electron，不误杀别的 Electron 应用
  try {
    Get-CimInstance Win32_Process -Filter "Name = 'electron.exe'" -ErrorAction SilentlyContinue |
      Where-Object { $_.CommandLine -and $_.CommandLine -like "*deskpet-steward\pet*" } |
      ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  } catch {}
}

function Show-Status {
  $srv = Get-ListeningPid $Port
  $pet = Get-ProcessByPidFile $PetPidFile
  $health = $null
  try { $health = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/health" -TimeoutSec 3 } catch {}
  Write-Host '=== DeskPet Steward ==='
  Write-Host ("服务 : " + $(if ($srv) { "运行中 (PID $srv)  http://127.0.0.1:$Port" } else { '未运行' }))
  if ($health) {
    Write-Host ("状态 : " + $health.agent.status + "  模型 " + $health.agent.model + "  项目 " + $health.counts.projects + "  工单 " + $health.counts.tasks + "（运行中 " + $health.counts.running + "）")
    Write-Host ("密钥 : " + $(if ($health.agent.hasKey) { '已配置' } else { '未配置（聊天会失败，往 .env 里写 DEEPSEEK_API_KEY）' }))
  }
  Write-Host ("桌宠 : " + $(if ($pet) { "运行中 (PID $($pet.Id))" } else { '未运行' }))
}

switch ($Action.ToLower()) {
  'start' { Start-Server; Start-Sleep -Milliseconds 800; Start-Pet; Start-Sleep -Milliseconds 400; Show-Status }
  'stop' { Stop-All }
  'restart' { Stop-All; Start-Sleep -Milliseconds 500; Start-Server; Start-Sleep -Milliseconds 900; Start-Pet; Start-Sleep -Milliseconds 400; Show-Status }
  'status' { Show-Status }
  'logs' {
    foreach ($f in @('server.err.log', 'server.out.log', 'pet.err.log', 'pet.out.log')) {
      $p = Join-Path $LogDir $f
      if (Test-Path $p) { Write-Host "--- $f ---"; Get-Content $p -Tail 25 }
    }
  }
}
