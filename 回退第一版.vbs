Option Explicit
Dim shell, files, root, command
Set shell = CreateObject("WScript.Shell")
Set files = CreateObject("Scripting.FileSystemObject")
root = files.GetParentFolderName(WScript.ScriptFullName)
command = """" & shell.ExpandEnvironmentStrings("%WINDIR%") & "\System32\WindowsPowerShell\v1.0\powershell.exe"" -NoProfile -STA -WindowStyle Hidden -ExecutionPolicy Bypass -File """ & root & "\rollback.ps1"""
WScript.Quit shell.Run(command, 0, True)
