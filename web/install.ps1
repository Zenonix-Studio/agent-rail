# Installs the agent-rail web viewer on Windows: Node.js if missing (via winget, after asking), the
# viewer in %LOCALAPPDATA%\agent-rail\web, a Start menu and a startup shortcut, then starts the tray.
# Install or update:  irm https://raw.githubusercontent.com/Zenonix-Studio/agent-rail/main/web/install.ps1 | iex
# Uninstall:          & ([scriptblock]::Create((irm https://raw.githubusercontent.com/Zenonix-Studio/agent-rail/main/web/install.ps1))) -Uninstall
param([switch]$Uninstall)
$ErrorActionPreference = 'Stop'

$dir = Join-Path $env:LOCALAPPDATA 'agent-rail'
$web = Join-Path $dir 'web'
$startMenuLink = Join-Path ([Environment]::GetFolderPath('Programs')) 'agent-rail.lnk'
$startupLink = Join-Path ([Environment]::GetFolderPath('Startup')) 'agent-rail.lnk'
$links = @($startMenuLink, $startupLink)
# Start with Windows is on for a first install only: an update keeps what the tray menu or Task Manager set.
$firstInstall = -not (Test-Path $dir)

# A running tray and its server, found by our install path in their command lines (an update replaces their files).
Get-CimInstance Win32_Process -Filter "Name='powershell.exe' OR Name='node.exe'" |
  Where-Object { $_.CommandLine -like "*$web*" } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

if ($Uninstall) {
  foreach ($l in $links) { Remove-Item $l -Force -ErrorAction SilentlyContinue }
  Remove-Item $dir -Recurse -Force -ErrorAction SilentlyContinue
  Write-Host 'agent-rail web viewer removed.'
  return
}

function Get-NodeMajor {
  if (-not (Get-Command node -ErrorAction SilentlyContinue)) { return 0 }
  return [int](node -p "process.versions.node.split('.')[0]")
}

if ((Get-NodeMajor) -lt 18) {
  if (Get-Command winget -ErrorAction SilentlyContinue) {
    $answer = Read-Host 'agent-rail needs Node.js 18 or later. Install Node.js LTS with winget now? [Y/n]'
    if ($answer -notmatch '^[nN]') {
      winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
      $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
    }
  }
  if ((Get-NodeMajor) -lt 18) { throw 'agent-rail needs Node.js 18 or later: install it from https://nodejs.org, then run this command again.' }
}

Write-Host 'Downloading agent-rail...'
$zip = Join-Path $env:TEMP 'agent-rail.zip'
$tmp = Join-Path $env:TEMP "agent-rail-$(Get-Random)"
Invoke-WebRequest 'https://github.com/Zenonix-Studio/agent-rail/archive/refs/heads/main.zip' -OutFile $zip -UseBasicParsing
Expand-Archive $zip $tmp -Force
Remove-Item $web -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory $dir -Force | Out-Null
Copy-Item (Join-Path $tmp 'agent-rail-main\web') $dir -Recurse
Remove-Item $zip, $tmp -Recurse -Force -ErrorAction SilentlyContinue

# The tray runs under Windows PowerShell (WinForms) from the Start menu and (first install) at sign-in,
# through conhost --headless: with Windows Terminal as the default terminal, -WindowStyle Hidden alone leaves a window.
$conhost = Join-Path $env:SystemRoot 'System32\conhost.exe'
$ps = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$arguments = "--headless `"$ps`" -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$web\tray.ps1`""
$shell = New-Object -ComObject WScript.Shell
# An existing startup shortcut is rewritten too, so older installs lose their window; a removed one stays removed.
foreach ($l in @($startMenuLink) + @($startupLink | Where-Object { $firstInstall -or (Test-Path $_) })) {
  $s = $shell.CreateShortcut($l)
  $s.TargetPath = $conhost
  $s.Arguments = $arguments
  $s.WorkingDirectory = $web
  $s.Description = 'agent-rail: a live view of your Claude Code and Codex jobs'
  $s.Save()
}
Start-Process $conhost -ArgumentList $arguments -WindowStyle Hidden

Write-Host ''
Write-Host 'agent-rail is running. Click its icon in the taskbar tray (it may be under the ^ arrow) to open it.'
Write-Host 'It is in the Start menu as "agent-rail". Right-click the tray icon to turn "Start with Windows" on or off.'
Write-Host 'Run the same command again to update.'
