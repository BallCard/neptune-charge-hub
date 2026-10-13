param([ValidateSet('Reserve', 'Check', 'Cancel', 'Setup', 'MailWatch')][string]$Mode = 'Reserve', [switch]$NoPause, [switch]$ConfirmedPlug, [string]$RuntimeRoot = '')
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()
$env:PYTHONIOENCODING = 'utf-8'
$taskRoot = if ($RuntimeRoot) { $RuntimeRoot } else { $PSScriptRoot }
$pythonPath = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe'
if (-not (Test-Path -LiteralPath $pythonPath)) { $pythonPath = (Get-Command python -ErrorAction Stop).Source }
$sourcePath = Join-Path $taskRoot 'neptune_charge.py'
$mailSourcePath = Join-Path $taskRoot 'failure_email.py'
. (Join-Path $taskRoot 'task_helpers.ps1')
function Register-FailureWatch([string]$reservationPath) {
    $emailConfigPath = Join-Path $taskRoot '.local\email.json'
    if (-not (Test-Path -LiteralPath $emailConfigPath)) { return }
    $emailConfig = Get-Content -LiteralPath $emailConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json
    if (-not $emailConfig.enabled) { return }
    $existingWatch = Get-ScheduledTask -TaskName 'NeptuneCharge-FailureWatch' -ErrorAction SilentlyContinue
    if ($existingWatch -and -not ($existingWatch.Actions.Arguments -like "*$mailSourcePath*")) { throw '同名邮件检查任务不属于本工具，未作更改。' }
    $reservation = Get-Content -LiteralPath $reservationPath -Raw -Encoding UTF8 | ConvertFrom-Json
    $pythonwPath = Join-Path (Split-Path -Parent $pythonPath) 'pythonw.exe'
    if (-not (Test-Path -LiteralPath $pythonwPath)) { throw '找不到后台 Python 程序。' }
    $watchArguments = Get-FailureWatchArguments $mailSourcePath $reservationPath $reservation.scheduled_at
    $action = New-ScheduledTaskAction -Execute $pythonwPath -Argument $watchArguments -WorkingDirectory $taskRoot
    $watchAt = (Get-ReservationTime $reservation.scheduled_at).AddMinutes(15)
    $trigger = New-ScheduledTaskTrigger -Once -At $watchAt.LocalDateTime `
        -RepetitionInterval (New-TimeSpan -Minutes 5) -RepetitionDuration (New-TimeSpan -Minutes 11)
    $trigger.StartBoundary = $watchAt.ToString('yyyy-MM-ddTHH:mm:sszzz')
    $settings = New-ScheduledTaskSettingsSet -WakeToRun -StartWhenAvailable -AllowStartIfOnBatteries `
        -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 2) -MultipleInstances IgnoreNew
    $principal = New-ScheduledTaskPrincipal -UserId ([System.Security.Principal.WindowsIdentity]::GetCurrent().Name) `
        -LogonType Interactive -RunLevel Limited
    Register-ScheduledTask -TaskName 'NeptuneCharge-FailureWatch' -Action $action -Trigger $trigger `
        -Settings $settings -Principal $principal -Description '单次充电预约结果检查；失败、结果不明或漏跑时发QQ邮件；只检查，不启动充电。' -Force | Out-Null
    $verifiedWatch = Get-ScheduledTask -TaskName 'NeptuneCharge-FailureWatch'
    if ($verifiedWatch.Actions.Execute -ne $pythonwPath -or $verifiedWatch.Actions.Arguments -ne $watchArguments) { throw '邮件检查任务核验失败。' }
    Write-Host ('失败邮件：{0}；{1:yyyy-MM-dd HH:mm}再次核对结果。' -f $emailConfig.recipient, $watchAt.ToOffset([TimeSpan]::FromHours(8)))
}
try {
    if ($Mode -eq 'MailWatch') {
        $reservationPath = (Get-Content -LiteralPath (Join-Path $taskRoot '.local\latest-reservation.txt') -Raw -Encoding UTF8).Trim()
        Register-FailureWatch $reservationPath
    } elseif ($Mode -eq 'Setup') {
        & $pythonPath $sourcePath setup
        if ($LASTEXITCODE -ne 0) { throw '导入失败。' }
    } elseif ($Mode -eq 'Check') {
        & $pythonPath $sourcePath check
        if ($LASTEXITCODE -ne 0) { throw '检查未通过。' }
        $bookedTask = Get-ScheduledTask -TaskName 'NeptuneCharge-OneMorning' -ErrorAction SilentlyContinue
        if ($bookedTask) {
            $bookedAt = [DateTimeOffset]::Parse($bookedTask.Triggers[0].StartBoundary)
            Write-Host ('系统已登记一次预约：{0:yyyy-MM-dd HH:mm}（北京时间）' -f $bookedAt.ToOffset([TimeSpan]::FromHours(8)))
        } else { Write-Host '系统尚未登记早晨预约。' }
        $watchTask = Get-ScheduledTask -TaskName 'NeptuneCharge-FailureWatch' -ErrorAction SilentlyContinue
        if ($watchTask) { Write-Host '失败邮件检查已登记；成功充电或已取消时保持静默。' }
    } elseif ($Mode -eq 'Cancel') {
        $existing = Get-ScheduledTask -TaskName 'NeptuneCharge-OneMorning' -ErrorAction SilentlyContinue
        if ($existing) {
            if (-not ($existing.Actions.Arguments -like "*$sourcePath*")) { throw '同名任务不属于本工具，未作更改。' }
            Unregister-ScheduledTask -TaskName 'NeptuneCharge-OneMorning' -Confirm:$false
        }
        $existingWatch = Get-ScheduledTask -TaskName 'NeptuneCharge-FailureWatch' -ErrorAction SilentlyContinue
        if ($existingWatch) {
            if (-not ($existingWatch.Actions.Arguments -like "*$mailSourcePath*")) { throw '同名邮件检查任务不属于本工具，未作更改。' }
            Unregister-ScheduledTask -TaskName 'NeptuneCharge-FailureWatch' -Confirm:$false
        }
        & $pythonPath $sourcePath cancel
        if ($LASTEXITCODE -ne 0) { throw '取消本地预约失败。' }
    } else {
        & $pythonPath $sourcePath check
        if ($LASTEXITCODE -ne 0) { throw '检查未通过，尚未预约。' }
        Write-Host ''
        Write-Host '预约仅执行下一次早上6点，不会每天自动启动。'
        if (-not $ConfirmedPlug) {
            $plugAnswer = Read-Host '确认你的车辆和充电器已接到上方显示的插座，并希望下一个6点充电？输入 Y 预约'
            if ($plugAnswer -ne 'Y') { throw '尚未预约。' }
        }
        $existing = Get-ScheduledTask -TaskName 'NeptuneCharge-OneMorning' -ErrorAction SilentlyContinue
        if ($existing -and -not ($existing.Actions.Arguments -like "*$sourcePath*")) { throw '同名任务不属于本工具，未作更改。' }
        $reservationPath = (& $pythonPath $sourcePath reserve --confirmed-plug | Select-Object -Last 1)
        if ($LASTEXITCODE -ne 0) { throw '创建预约失败。' }
        $reservation = Get-Content -LiteralPath $reservationPath -Raw -Encoding UTF8 | ConvertFrom-Json
        $pythonwPath = Join-Path (Split-Path -Parent $pythonPath) 'pythonw.exe'
        if (-not (Test-Path -LiteralPath $pythonwPath)) { throw '找不到后台 Python 程序，尚未登记系统任务。' }
        $runArguments = '"{0}" run --reservation "{1}"' -f $sourcePath, $reservationPath
        $action = New-ScheduledTaskAction -Execute $pythonwPath -Argument $runArguments -WorkingDirectory $taskRoot
        $scheduledAt = Get-ReservationTime $reservation.scheduled_at
        $runAt = $scheduledAt.LocalDateTime
        $trigger = New-ScheduledTaskTrigger -Once -At $runAt
        $trigger.StartBoundary = $scheduledAt.ToString('yyyy-MM-ddTHH:mm:sszzz')
        $settings = New-ScheduledTaskSettingsSet -WakeToRun -StartWhenAvailable -AllowStartIfOnBatteries `
            -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 15) -MultipleInstances IgnoreNew
        $principal = New-ScheduledTaskPrincipal -UserId ([System.Security.Principal.WindowsIdentity]::GetCurrent().Name) `
            -LogonType Interactive -RunLevel Limited
        Register-ScheduledTask -TaskName 'NeptuneCharge-OneMorning' -Action $action -Trigger $trigger `
            -Settings $settings -Principal $principal -Description '本人尼普顿充电预约：下一次6点，单次执行，结果写入本机日志。' -Force | Out-Null
        $verified = Get-ScheduledTask -TaskName 'NeptuneCharge-OneMorning'
        if ($verified.Actions.Execute -ne $pythonwPath -or $verified.Actions.Arguments -ne $runArguments) { throw '系统任务核验失败，请取消预约后重试。' }
        Register-FailureWatch $reservationPath
        Write-Host ('已预约：{0:yyyy-MM-dd HH:mm}，设备 {1}，插座 {2}。' -f $runAt, $reservation.device, $reservation.port)
        Write-Host '请保持电脑登录并联网；可以锁屏。睡眠唤醒还取决于电脑的唤醒计时器设置。关机或注销后不能执行。'
        Write-Host '执行结果：logs\latest.log。取消预约：双击 cancel-reservation.cmd。'
    }
} catch {
    Write-Host $_.Exception.Message -ForegroundColor Red
    if (-not $NoPause) { Read-Host '按回车关闭' | Out-Null }
    exit 1
}
if (-not $NoPause) { Read-Host '按回车关闭' | Out-Null }
