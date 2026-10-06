Option Explicit
Dim shell, files, root, scriptFile, command
Set shell = CreateObject("WScript.Shell")
Set files = CreateObject("Scripting.FileSystemObject")
root = files.GetParentFolderName(WScript.ScriptFullName)
scriptFile = root & "\ui.ps1"
If WScript.Arguments.Count > 0 Then
    If WScript.Arguments(0) <> "run" Then WScript.Quit 1
    scriptFile = root & "\run.ps1"
End If
command = """" & shell.ExpandEnvironmentStrings("%WINDIR%") & "\System32\WindowsPowerShell\v1.0\powershell.exe"" -NoProfile -STA -WindowStyle Hidden -ExecutionPolicy Bypass -File """ & scriptFile & """"
If WScript.Arguments.Count > 0 Then command = command & " run"
If WScript.Arguments.Count > 0 Then
    WScript.Quit shell.Run(command, 0, True)
Else
    shell.Run command, 0, False
End If
