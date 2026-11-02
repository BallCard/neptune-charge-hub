$ErrorActionPreference = 'Stop'
$taskMsRoot = Split-Path -Parent $PSScriptRoot
$taskMsDirectory = Join-Path $taskMsRoot '.local/modelscope'
$taskMsSecret = Read-Host 'Paste the ModelScope access token (input is hidden)' -AsSecureString
if ($taskMsSecret.Length -lt 16) { throw 'Token not saved: input is too short.' }
New-Item -ItemType Directory -Path $taskMsDirectory -Force | Out-Null
$taskMsEncrypted = ConvertFrom-SecureString -SecureString $taskMsSecret
[IO.File]::WriteAllText((Join-Path $taskMsDirectory 'token.dpapi'), $taskMsEncrypted)
$taskMsSecret.Dispose()
Write-Host 'Saved for this Windows user only. The token was not printed.'
