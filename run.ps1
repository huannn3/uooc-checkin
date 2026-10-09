param(
    [ValidateSet('login', 'setup', 'run', 'test', 'install-task', 'remove-task', 'install-startup', 'remove-startup')]
    [string]$Mode = 'run',
    [string]$At = '08:00',
    [switch]$Visible,
    [switch]$NotifyOnLoginExpiry
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$taskName = if ($Mode -in @('install-startup', 'remove-startup')) { 'UoocCheckinStartup' } else { 'UoocDailyCheckin' }
$nodePath = Join-Path $PSScriptRoot 'runtime\node.exe'
if (-not (Test-Path -LiteralPath $nodePath)) {
    $nodeCommand = Get-Command node -ErrorAction SilentlyContinue
    $nodePath = if ($nodeCommand) { $nodeCommand.Source } else {
        Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
    }
}
if (-not (Test-Path -LiteralPath $nodePath)) { throw 'Node.js was not found. Install Node.js 20 or newer.' }
$scriptPath = Join-Path $PSScriptRoot 'uooc.js'
$launcherPath = Join-Path $PSScriptRoot 'launch.vbs'
$existingTask = if ($Mode -in @('install-task', 'remove-task', 'install-startup', 'remove-startup')) { Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue }
if ($existingTask) {
    $ownedArguments = @(('"{0}" run' -f $scriptPath), ('"{0}" run' -f $launcherPath))
    if ($Mode -in @('install-startup', 'remove-startup')) { $ownedArguments = @(('"{0}"' -f $launcherPath)) }
    if (-not @($existingTask.Actions | Where-Object { $_.Arguments -in $ownedArguments }).Count) {
        throw 'This task name belongs to another project. It will not be changed.'
    }
}
if ($Mode -eq 'install-task') {
    if ($At -notmatch '^([01]\d|2[0-3]):[0-5]\d$') { throw 'Use HH:mm, for example 08:00.' }
    $courses = (Get-Content -LiteralPath (Join-Path $PSScriptRoot 'config.json') -Encoding UTF8 -Raw | ConvertFrom-Json).courses
    if (-not $courses -or -not (Test-Path -LiteralPath (Join-Path $PSScriptRoot '.uooc-auth.json'))) {
        throw 'Run setup first and visit your courses.'
    }
    $action = New-ScheduledTaskAction -Execute (Join-Path $env:WINDIR 'System32\wscript.exe') -Argument ('"{0}" run' -f $launcherPath) -WorkingDirectory $PSScriptRoot
    $trigger = New-ScheduledTaskTrigger -Daily -At $At
    $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 30)
    $userId = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
    $principal = New-ScheduledTaskPrincipal -UserId $userId -LogonType Interactive -RunLevel Limited
    # Only an existing task with this workspace's exact command may be updated.
    Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Description "Uooc daily check-in: $PSScriptRoot" -Force | Out-Null
    Write-Host "Installed $taskName at $At (Windows local time). The PC must be on and this user signed in."
} elseif ($Mode -eq 'install-startup') {
    $action = New-ScheduledTaskAction -Execute (Join-Path $env:WINDIR 'System32\wscript.exe') -Argument ('"{0}"' -f $launcherPath) -WorkingDirectory $PSScriptRoot
    $userId = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
    $trigger = New-ScheduledTaskTrigger -AtLogOn -User $userId
    $settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero)
    $principal = New-ScheduledTaskPrincipal -UserId $userId -LogonType Interactive -RunLevel Limited
    Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Description "Uooc assistant startup: $PSScriptRoot" -Force | Out-Null
    Write-Host "Installed $taskName. Opens the assistant after this user signs in to Windows."
} elseif ($Mode -in @('remove-task', 'remove-startup')) {
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
    Write-Host "Removed $taskName."
} elseif ($Mode -eq 'test') {
    & $nodePath (Join-Path $PSScriptRoot 'test.js')
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    & (Join-Path $PSScriptRoot 'test-run.ps1')
    & (Join-Path $PSScriptRoot 'test-ui.ps1')
    & (Join-Path $PSScriptRoot 'test-login.ps1')
} else {
    $hash = [System.Security.Cryptography.SHA256]::Create()
    $instanceId = [BitConverter]::ToString($hash.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($PSScriptRoot))).Replace('-', '')
    $hash.Dispose()
    $workMutex = [System.Threading.Mutex]::new($false, ('Local\UoocCheckinWork_' + $instanceId))
    $acquired = $false
    try {
        try { $acquired = $workMutex.WaitOne(0) } catch [System.Threading.AbandonedMutexException] { $acquired = $true }
        if (-not $acquired) { throw 'Another Uooc login or check-in is still running. Try again after it finishes.' }
        $nodeArgs = @($scriptPath, $Mode)
        if ($Visible) { $nodeArgs += '--visible' }
        & $nodePath @nodeArgs
        $exitCode = $LASTEXITCODE
    } finally {
        if ($acquired) { $workMutex.ReleaseMutex() }
        $workMutex.Dispose()
    }
    if ($exitCode -eq 2 -and $NotifyOnLoginExpiry) {
        $powershell = Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'
        Start-Process -FilePath $powershell -ArgumentList ('-NoProfile -STA -ExecutionPolicy Bypass -File "{0}"' -f (Join-Path $PSScriptRoot 'notify.ps1')) -WindowStyle Hidden
    }
    exit $exitCode
}
