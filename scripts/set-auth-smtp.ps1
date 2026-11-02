param([ValidateSet('Gmail', 'QQ')][string]$Provider = 'Gmail')
$ErrorActionPreference = 'Stop'
# Check the module before asking for credentials. Use PowerShell 7 when launched
# from Codex: Windows PowerShell 5 can inherit incompatible module paths.
Import-Module Microsoft.PowerShell.Security -ErrorAction Stop
$Host.UI.RawUI.WindowTitle = 'Neptune - Gmail SMTP setup (hidden password)'
$taskSmtpRoot = Split-Path -Parent $PSScriptRoot
$taskSmtpDirectory = Join-Path $taskSmtpRoot '.local/auth-smtp'
$taskSmtpAccount = (Read-Host 'Project sender email address').Trim()
if ($Provider -eq 'Gmail' -and $taskSmtpAccount -notmatch '^[^\s@]+@gmail\.com$') { throw 'Use the dedicated Gmail address.' }
if ($Provider -eq 'QQ' -and $taskSmtpAccount -notmatch '^[^\s@]+@(qq|foxmail)\.com$') { throw 'Use the dedicated QQ/Foxmail address.' }
$taskSmtpSecret = Read-Host 'App password / SMTP authorization code (hidden; never your account password)' -AsSecureString
$taskSmtpPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($taskSmtpSecret)
$taskSmtpPayload = $null
try {
  $taskSmtpPassword = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($taskSmtpPointer).Replace(' ', '')
  if ($taskSmtpPassword -notmatch '^[A-Za-z0-9]{16}$') { throw 'Expected a 16-character app password / authorization code.' }
  $taskSmtpJson = @{ provider=$Provider; host=$(if ($Provider -eq 'Gmail') {'smtp.gmail.com'} else {'smtp.qq.com'}); port=465; user=$taskSmtpAccount; password=$taskSmtpPassword } | ConvertTo-Json -Compress
  $taskSmtpPayload = ConvertTo-SecureString $taskSmtpJson -AsPlainText -Force
  New-Item -ItemType Directory -Path $taskSmtpDirectory -Force | Out-Null
  [IO.File]::WriteAllText((Join-Path $taskSmtpDirectory 'config.dpapi'), (ConvertFrom-SecureString $taskSmtpPayload))
  Write-Host 'Saved encrypted for the current Windows user. No cloud configuration or email was sent.'
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($taskSmtpPointer)
  $taskSmtpSecret.Dispose()
  if ($taskSmtpPayload) { $taskSmtpPayload.Dispose() }
  Remove-Variable taskSmtpPassword,taskSmtpJson -ErrorAction SilentlyContinue
}
