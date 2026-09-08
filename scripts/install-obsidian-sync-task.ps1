[CmdletBinding()]
param(
  [string]$Workspace,
  [string]$NodeExecutable
)

$ErrorActionPreference = 'Stop'
if (-not $Workspace) { $Workspace = Split-Path -Parent $PSScriptRoot }
$Workspace = (Resolve-Path -LiteralPath $Workspace).Path
$watcher = Join-Path $Workspace 'scripts\watch-obsidian-sync.ps1'
if (-not (Test-Path -LiteralPath $watcher)) { throw 'The Obsidian watcher script was not found.' }
if (-not $NodeExecutable) {
  $command = Get-Command node -ErrorAction SilentlyContinue
  if ($command) { $NodeExecutable = $command.Source }
}
if (-not $NodeExecutable -or -not (Test-Path -LiteralPath $NodeExecutable)) { throw 'Node.js was not found. Pass -NodeExecutable with the full node.exe path.' }

$taskName = 'VaultTerminal Obsidian Sync'
$powershell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$arguments = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$watcher`" -Workspace `"$Workspace`" -NodeExecutable `"$NodeExecutable`""
$action = New-ScheduledTaskAction -Execute $powershell -Argument $arguments
$trigger = New-ScheduledTaskTrigger -AtLogOn
$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit (New-TimeSpan -Days 365)
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Description 'Syncs Vault Terminal every 15 seconds only while Obsidian is open.' -Force | Out-Null
Start-ScheduledTask -TaskName $taskName
Write-Output "Task '$taskName' was installed and started."
