# Windows tray for agent-rail: runs the viewer, left-click opens it as a small popover window,
# and a balloon tells when a job finishes, waits for you or starts failing (the window may be closed).
# Usage: powershell -WindowStyle Hidden -ExecutionPolicy Bypass -File tray.ps1
Add-Type -AssemblyName System.Windows.Forms, System.Drawing

$port = if ($env:PORT) { $env:PORT } else { 4317 }
$url = "http://127.0.0.1:$port"
$server = Start-Process node -ArgumentList "`"$PSScriptRoot\server.mjs`"" -WindowStyle Hidden -PassThru

$tr = (Get-Culture).TwoLetterISOLanguageName -eq 'tr'
$T = if ($tr) {
  @{ Open = 'Aç'; Quit = 'Çık'; Jobs = '{0} iş çalışıyor'; Done = 'Bitti'; Waiting = 'Seni bekliyor'; Failing = 'Hata veriyor' }
} else {
  @{ Open = 'Open'; Quit = 'Quit'; Jobs = '{0} running'; Done = 'Done'; Waiting = 'Needs you'; Failing = 'Failing' }
}

$tray = New-Object System.Windows.Forms.NotifyIcon
$tray.Icon = [System.Drawing.SystemIcons]::Application
$tray.Text = 'agent-rail'
$tray.Visible = $true

# ponytail: Edge app window instead of an embedded WebView; Edge ships with Windows 10/11.
# ?tray=1 leaves the notifications to this script, so they do not show twice.
$open = {
  $area = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea
  $w = 400; $h = 600
  Start-Process msedge "--app=$url/?tray=1 --window-size=$w,$h --window-position=$($area.Right - $w),$($area.Bottom - $h)"
}
$tray.add_MouseClick({ if ($_.Button -eq 'Left') { & $open } })
$tray.add_BalloonTipClicked({ & $open })

$menu = New-Object System.Windows.Forms.ContextMenuStrip
[void]$menu.Items.Add($T.Open, $null, { & $open })
[void]$menu.Items.Add($T.Quit, $null, { [System.Windows.Forms.Application]::Exit() })
$tray.ContextMenuStrip = $menu

# Every 5 s: the tooltip shows the running count, and status changes become balloons.
# The first poll only records the statuses: jobs already done at launch never notify.
$script:seen = $null
$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 5000
$timer.add_Tick({
  try { $jobs = @(Invoke-RestMethod "$url/api/jobs" -TimeoutSec 2) } catch { return }
  $running = @($jobs | Where-Object { $_.status -eq 'running' }).Count
  $tray.Text = "agent-rail - " + ($T.Jobs -f $running)
  $prev = $script:seen
  $script:seen = @{}
  foreach ($j in $jobs) { $script:seen[$j.id] = $j.status }
  if ($null -eq $prev) { return }
  foreach ($j in $jobs) {
    if ($prev[$j.id] -eq $j.status) { continue }
    $body = switch ($j.status) {
      'done' { $first = ($j.progress -split '(?<=[.!?])\s', 2)[0]; if ($first) { "$($T.Done) · $first" } else { $T.Done } }
      'waiting' { $T.Waiting }
      'error' { if ($j.warn) { "$($T.Failing) · $($j.warn)" } else { $T.Failing } }
      default { $null }
    }
    # ponytail: one balloon at a time, so a later change in the same poll replaces an earlier one.
    if ($body) { $tray.ShowBalloonTip(5000, $j.title, $body, [System.Windows.Forms.ToolTipIcon]::Info) }
  }
})
$timer.Start()

[System.Windows.Forms.Application]::Run()
$tray.Dispose()
Stop-Process -Id $server.Id -ErrorAction SilentlyContinue
