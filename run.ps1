param(
    [ValidateSet('login', 'setup', 'run', 'test', 'install-task', 'remove-task')]
    [string]$Mode = 'run',
    [string]$At = '08:00',
    [switch]$Visible
)
$ErrorActionPreference = 'Stop'
$taskName = 'UoocDailyCheckin'
$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
$nodePath = if ($nodeCommand) { $nodeCommand.Source } else {
    Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
}
if (-not (Test-Path -LiteralPath $nodePath)) { throw 'Node.js was not found. Install Node.js 20 or newer.' }
$scriptPath = Join-Path $PSScriptRoot 'uooc.js'
$launcherPath = Join-Path $PSScriptRoot 'launch.vbs'
$existingTask = if ($Mode -in @('install-task', 'remove-task')) { Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue }
if ($existingTask) {
    $ownedArguments = @(('"{0}" run' -f $scriptPath), ('"{0}" run' -f $launcherPath))
    if (-not @($existingTask.Actions | Where-Object { $_.Arguments -in $ownedArguments }).Count) {
        throw 'This task name belongs to another project. It will not be changed.'
    }
}
if ($Mode -eq 'install-task') {
    if ($At -notmatch '^([01]\d|2[0-3]):[0-5]\d$') { throw 'Use HH:mm, for example 08:00.' }
    $courses = (Get-Content -LiteralPath (Join-Path $PSScriptRoot 'config.json') -Raw | ConvertFrom-Json).courses
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
} elseif ($Mode -eq 'remove-task') {
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
    Write-Host "Removed $taskName."
} elseif ($Mode -eq 'test') {
    & $nodePath (Join-Path $PSScriptRoot 'test.js')
    exit $LASTEXITCODE
} else {
    $nodeArgs = @($scriptPath, $Mode)
    if ($Visible) { $nodeArgs += '--visible' }
    & $nodePath @nodeArgs
    exit $LASTEXITCODE
}
