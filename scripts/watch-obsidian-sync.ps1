[CmdletBinding()]
param(
  [string]$Workspace,
  [string]$NodeExecutable
)

$ErrorActionPreference = 'Stop'
if (-not $Workspace) { $Workspace = Split-Path -Parent $PSScriptRoot }
$Workspace = (Resolve-Path -LiteralPath $Workspace).Path
$agent = Join-Path $Workspace 'dist\desktop-sync.mjs'
if (-not (Test-Path -LiteralPath $agent)) { throw 'dist\desktop-sync.mjs is missing. Run npm run build first.' }

if (-not $NodeExecutable) {
  $command = Get-Command node -ErrorAction SilentlyContinue
  if ($command) { $NodeExecutable = $command.Source }
}
if (-not $NodeExecutable -or -not (Test-Path -LiteralPath $NodeExecutable)) { throw 'Node.js was not found. Pass -NodeExecutable or install Node.js 24+.' }

$logDirectory = Join-Path $Workspace '.vault-terminal'
New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
$log = Join-Path $logDirectory 'obsidian-sync.log'
function Write-SyncLog([string]$message) { Add-Content -LiteralPath $log -Value "$(Get-Date -Format o) $message" }
function Invoke-ObsidianSync {
  try {
    Push-Location -LiteralPath $Workspace
    try { & $NodeExecutable $agent; $exitCode = $LASTEXITCODE }
    finally { Pop-Location }
    if ($exitCode -ne 0) { throw "desktop-sync exited with code $exitCode" }
    Write-SyncLog 'sync completed while Obsidian is open'
  } catch {
    Write-SyncLog "sync failed: $($_.Exception.Message)"
  }
}

function Sync-WhileObsidianOpen {
  $nextRun = [DateTime]::UtcNow
  while (Get-Process -Name Obsidian -ErrorAction SilentlyContinue) {
    Invoke-ObsidianSync
    # Poll only while Obsidian is open. Measure from the previous start so a
    # network request does not silently turn a 15-second interval into 17 seconds.
    $nextRun = $nextRun.AddSeconds(15)
    $delay = [Math]::Max(0, [Math]::Round(($nextRun - [DateTime]::UtcNow).TotalMilliseconds))
    if ($delay -gt 0) { Start-Sleep -Milliseconds $delay }
  }
}

# A shared mutex makes manual starts and the Windows logon task safe together.
# Without it, two processes can race over a single vault and hide the useful
# result of the sync behind interleaved log entries.
$mutex = New-Object System.Threading.Mutex($false, 'Local\VaultTerminalObsidianSync')
if (-not $mutex.WaitOne(0, $false)) {
  Write-SyncLog 'watcher already running; second instance skipped'
  exit 0
}
try {
  # Polling is deliberately used instead of a WMI start-event subscription:
  # it keeps watching even if the subscription service is restarted.
  while ($true) {
    if (Get-Process -Name Obsidian -ErrorAction SilentlyContinue) {
      Sync-WhileObsidianOpen
    } else {
      Start-Sleep -Seconds 2
    }
  }
} finally {
  $mutex.ReleaseMutex() | Out-Null
  $mutex.Dispose()
}
