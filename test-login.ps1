$ErrorActionPreference = 'Stop'
$taskRoot = Join-Path ([IO.Path]::GetTempPath()) ('uooc-login-' + [Guid]::NewGuid().ToString('N'))
try {
    $null = New-Item -ItemType Directory -Path $taskRoot
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'credentials.ps1') -Destination $taskRoot
    . (Join-Path $taskRoot 'credentials.ps1') -Mode library
    Save-Login 'fixture@example.invalid' 'fixture-private-password'
    $cipher = [IO.File]::ReadAllText($script:LoginPath)
    if ($cipher.Contains('fixture@example.invalid') -or $cipher.Contains('fixture-private-password')) { throw 'Saved login contains plaintext.' }
    $restored = Read-Login
    if ($restored.account -ne 'fixture@example.invalid' -or $restored.password -ne 'fixture-private-password') { throw 'DPAPI restore failed.' }
    [IO.File]::WriteAllText($script:LoginPath, 'broken fixture')
    $rejected = $false
    try { $null = Read-Login } catch { $rejected = $true }
    if (-not $rejected) { throw 'Corrupted credentials must be rejected.' }
    Write-Output 'Passed: Windows user encryption, credential restoration and damaged data rejection (isolated fixture).'
} finally {
    $resolved = [IO.Path]::GetFullPath($taskRoot)
    $temp = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
    if ($resolved.StartsWith($temp, [StringComparison]::OrdinalIgnoreCase) -and (Split-Path $resolved -Leaf) -like 'uooc-login-*') { Remove-Item -LiteralPath $resolved -Recurse -Force }
}
