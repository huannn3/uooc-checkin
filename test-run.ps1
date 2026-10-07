$ErrorActionPreference = 'Stop'
$testRoot = Join-Path ([IO.Path]::GetTempPath()) ('uooc-test-' + [Guid]::NewGuid().ToString('N'))
$originalEncoding = [Console]::OutputEncoding
try {
    $null = New-Item -ItemType Directory -Path $testRoot
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'run.ps1') -Destination $testRoot
    $null = New-Item -ItemType Directory -Path (Join-Path $testRoot 'runtime')
    # A placeholder is enough: installing a task resolves Node but does not execute it.
    [IO.File]::WriteAllText((Join-Path $testRoot 'runtime\node.exe'), '')
    function Get-Command { throw 'Portable runtime must work without an installed Node.js.' }
    # UTF-8 without BOM, including characters that break JSON under legacy decoding.
    $courseName = -join ([char[]]@(0x827A, 0x672F, 0x7684, 0x661F, 0x7A7A, 0xFF1A, 0x827A, 0x672F, 0x7F8E, 0x5B66, 0x5341, 0x4E8C, 0x8BB2))
    $url = 'https://www.uooc.net.cn/home/course/123'
    $json = @{ courses = @($url); courseNames = @{ $url = $courseName } } | ConvertTo-Json
    [IO.File]::WriteAllText((Join-Path $testRoot 'config.json'), $json, [Text.UTF8Encoding]::new($false))
    [IO.File]::WriteAllText((Join-Path $testRoot '.uooc-auth.json'), '{}')

    # Exercise the real install path without creating a Windows scheduled task.
    $fakeTask = $null
    function Get-ScheduledTask { param($TaskName, $ErrorAction) return $fakeTask }
    function New-ScheduledTaskAction { param($Execute, $Argument, $WorkingDirectory) return @{ Execute = $Execute; Arguments = $Argument; WorkingDirectory = $WorkingDirectory } }
    function New-ScheduledTaskTrigger { param([switch]$Daily, $At, [switch]$AtLogOn, $User) return @{ Daily = $Daily.IsPresent; At = $At; AtLogOn = $AtLogOn.IsPresent; User = $User } }
    function New-ScheduledTaskSettingsSet { param([switch]$StartWhenAvailable, $MultipleInstances, $ExecutionTimeLimit) return @{} }
    function New-ScheduledTaskPrincipal { param($UserId, $LogonType, $RunLevel) return @{ UserId = $UserId; LogonType = $LogonType; RunLevel = $RunLevel } }
    function Register-ScheduledTask {
        param($TaskName, $Action, $Trigger, $Settings, $Principal, $Description, [switch]$Force)
        $testRegistration.Name = $TaskName
        $testRegistration.Action = $Action
        $testRegistration.Trigger = $Trigger
        $testRegistration.Principal = $Principal
    }
    function Unregister-ScheduledTask { param($TaskName, $Confirm) $testRegistration.Removed = $TaskName }
    $testRegistration = @{}
    [Console]::OutputEncoding = [Text.Encoding]::GetEncoding(936)
    & (Join-Path $testRoot 'run.ps1') install-task -At '22:00'
    if ($testRegistration.Name -ne 'UoocDailyCheckin') { throw 'Task registration did not complete.' }
    if ($testRegistration.Trigger.At -ne '22:00' -or -not $testRegistration.Trigger.Daily) { throw 'Daily trigger does not match.' }
    if ($testRegistration.Action.Arguments -ne ('"{0}" run' -f (Join-Path $testRoot 'launch.vbs')) -or $testRegistration.Action.WorkingDirectory -ne $testRoot) { throw 'Task does not use the current project launcher.' }
    if ([Console]::OutputEncoding.CodePage -ne 65001) { throw 'Child process output must use UTF-8.' }
    & (Join-Path $testRoot 'run.ps1') install-startup
    if ($testRegistration.Name -ne 'UoocCheckinStartup' -or -not $testRegistration.Trigger.AtLogOn) { throw 'Startup must use a separate user logon task.' }
    if ($testRegistration.Principal.RunLevel -ne 'Limited' -or $testRegistration.Principal.LogonType -ne 'Interactive') { throw 'Startup must use normal interactive user permissions.' }
    $startupArgument = '"{0}"' -f (Join-Path $testRoot 'launch.vbs')
    if ($testRegistration.Action.Arguments -ne $startupArgument) { throw 'Startup must open the assistant without immediately signing in.' }
    $fakeTask = [PSCustomObject]@{ Actions = @([PSCustomObject]@{ Arguments = '"C:\Other\launch.vbs"' }) }
    $rejected = $false
    try { & (Join-Path $testRoot 'run.ps1') install-startup } catch { $rejected = $_.Exception.Message -like '*another project*' }
    if (-not $rejected) { throw 'A foreign startup task must never be overwritten.' }
    $fakeTask = [PSCustomObject]@{ Actions = @([PSCustomObject]@{ Arguments = $startupArgument }) }
    & (Join-Path $testRoot 'run.ps1') remove-startup
    if ($testRegistration.Removed -ne 'UoocCheckinStartup') { throw 'Owned startup task was not removed.' }

    # Exercise rollback in the fixture directory and verify personal files survive.
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'previous-v1.0.0') -Destination $testRoot -Recurse
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'rollback.ps1') -Destination $testRoot
    foreach ($file in (Get-ChildItem -LiteralPath (Join-Path $testRoot 'previous-v1.0.0') -File | Where-Object { $_.Name -ne '.gitignore' })) {
        if (-not (Test-Path -LiteralPath (Join-Path $testRoot $file.Name))) { Copy-Item -LiteralPath $file.FullName -Destination $testRoot }
    }
    $null = New-Item -ItemType Directory -Path (Join-Path $testRoot '.uooc-profile')
    [IO.File]::WriteAllText((Join-Path $testRoot '.uooc-profile\fixture.txt'), 'keep profile')
    $configHash = (Get-FileHash -LiteralPath (Join-Path $testRoot 'config.json')).Hash
    $authHash = (Get-FileHash -LiteralPath (Join-Path $testRoot '.uooc-auth.json')).Hash
    & (Join-Path $testRoot 'rollback.ps1') -SelfTest
    if ($configHash -ne (Get-FileHash -LiteralPath (Join-Path $testRoot 'config.json')).Hash -or $authHash -ne (Get-FileHash -LiteralPath (Join-Path $testRoot '.uooc-auth.json')).Hash) { throw 'Rollback changed personal configuration or credentials.' }
    if ([IO.File]::ReadAllText((Join-Path $testRoot '.uooc-profile\fixture.txt')) -ne 'keep profile') { throw 'Rollback changed browser data.' }
    if ((Get-FileHash -LiteralPath (Join-Path $testRoot 'run.ps1')).Hash -ne (Get-FileHash -LiteralPath (Join-Path $testRoot 'previous-v1.0.0\run.ps1')).Hash) { throw 'Rollback did not restore v1.0.0 code.' }
    Write-Output 'Passed: portable runtime, Chinese UTF-8 configuration and UTF-8 process output (mock task, no real credentials).'
    Write-Output 'Passed: user startup, foreign task protection and rollback preserving personal data (isolated fixture).'
} finally {
    [Console]::OutputEncoding = $originalEncoding
    # Only remove the unique test directory created above, under the system temp directory.
    $resolvedTestRoot = [IO.Path]::GetFullPath($testRoot)
    $tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
    if ($resolvedTestRoot.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase) -and (Split-Path $resolvedTestRoot -Leaf) -like 'uooc-test-*') {
        Remove-Item -LiteralPath $resolvedTestRoot -Recurse -Force -ErrorAction SilentlyContinue
    }
}
