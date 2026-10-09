param([ValidateSet('configure', 'read', 'library')][string]$Mode = 'configure')
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
Add-Type -AssemblyName System.Security
$script:LoginPath = Join-Path $PSScriptRoot '.uooc-login.dat'

function Save-Login([string]$Account, [string]$Password) {
    if (-not $Account.Trim() -or -not $Password) { throw 'Both fields are required.' }
    $bytes = [Text.Encoding]::UTF8.GetBytes((@{ account = $Account.Trim(); password = $Password } | ConvertTo-Json -Compress))
    try {
        $encrypted = [Security.Cryptography.ProtectedData]::Protect($bytes, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)
        [IO.File]::WriteAllText($script:LoginPath, [Convert]::ToBase64String($encrypted), [Text.UTF8Encoding]::new($false))
    } finally { [Array]::Clear($bytes, 0, $bytes.Length) }
}

function Read-Login {
    if (-not (Test-Path -LiteralPath $script:LoginPath)) { return $null }
    $encrypted = [Convert]::FromBase64String([IO.File]::ReadAllText($script:LoginPath))
    $bytes = [Security.Cryptography.ProtectedData]::Unprotect($encrypted, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)
    try { return ([Text.Encoding]::UTF8.GetString($bytes) | ConvertFrom-Json) } finally { [Array]::Clear($bytes, 0, $bytes.Length) }
}

if ($Mode -eq 'library') { return }
if ($Mode -eq 'read') {
    try { Read-Login | ConvertTo-Json -Compress } catch { Write-Error 'Saved login could not be read; configure it again.' }
    return
}

$executable = Join-Path $PSScriptRoot 'credential-settings.exe'
if (-not (Test-Path -LiteralPath $executable)) {
    Add-Type -Path (Join-Path $PSScriptRoot 'credential-settings.cs') -ReferencedAssemblies System.Windows.Forms,System.Drawing,System.Security -OutputAssembly $executable -OutputType WindowsApplication
}
Start-Process -FilePath $executable
