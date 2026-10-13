param([string]$RuntimeRoot = '')
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new()
$taskRoot = if ($RuntimeRoot) { $RuntimeRoot } else { $PSScriptRoot }
$latestPath = Join-Path $taskRoot '.local\latest-reservation.txt'
$reservationPath = if (Test-Path -LiteralPath $latestPath) { (Get-Content -LiteralPath $latestPath -Raw -Encoding UTF8).Trim() } else { '' }
$result = @{}
foreach ($item in @(@('charge', 'NeptuneCharge-OneMorning', 'neptune_charge.py'), @('watch', 'NeptuneCharge-FailureWatch', 'failure_email.py'))) {
    $task = Get-ScheduledTask -TaskName $item[1] -ErrorAction SilentlyContinue
    if (-not $task) { $result[$item[0]] = @{exists=$false}; continue }
    $info = Get-ScheduledTaskInfo -TaskName $item[1]
    $source = Join-Path $taskRoot $item[2]
    $owned = $task.Actions.Arguments.Contains($source)
    $matches = $owned -and $reservationPath -and $task.Actions.Arguments.Contains(('"' + $reservationPath + '"'))
    $result[$item[0]] = @{exists=$true; owned=[bool]$owned; matches_latest=[bool]$matches; enabled=[bool]$task.Settings.Enabled;
        state=[string]$task.State; start_at=$task.Triggers[0].StartBoundary; last_result=$info.LastTaskResult}
}
ConvertTo-Json -InputObject $result -Depth 4 -Compress
