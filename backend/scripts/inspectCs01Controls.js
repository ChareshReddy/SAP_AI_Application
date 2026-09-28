/**
 * Inspects all toolbar buttons and menus in CS01 on Relaxo Sandbox
 */
import { execFile } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const runnerPath = path.resolve(__dirname, '..', 'bin', 'DesktopRunner.cs');

const vbsInspect = `
Option Explicit
On Error Resume Next

Function JsonEscape(strVal)
    If IsNull(strVal) Or strVal = "" Then
        JsonEscape = ""
        Exit Function
    End If
    Dim res
    res = CStr(strVal)
    res = Replace(res, "\\", "\\\\")
    res = Replace(res, """", "'")
    res = Replace(res, vbCrLf, " ")
    res = Replace(res, vbCr, " ")
    res = Replace(res, vbLf, " ")
    res = Replace(res, vbTab, " ")
    JsonEscape = Trim(res)
End Function

Dim SapGuiAuto, app, conn, session, i, j
Set SapGuiAuto = GetObject("SAPGUI")
Set app = SapGuiAuto.GetScriptingEngine

Dim targetSession
Set targetSession = Nothing
For i = 0 To app.Children.Count - 1
    Set conn = app.Children(CInt(i))
    For j = 0 To conn.Children.Count - 1
        Set session = conn.Children(CInt(j))
        If InStr(LCase(conn.Description), "relaxo") > 0 Or InStr(LCase(session.Info.SystemName), "s4a") > 0 Then
            Set targetSession = session
            Exit For
        End If
    Next
    If Not targetSession Is Nothing Then Exit For
Next

If targetSession Is Nothing Then Set targetSession = app.Children(0).Children(0)
Set session = targetSession

' Navigate to CS01
session.findById("wnd[0]/tbar[0]/okcd").text = "/nCS01"
session.findById("wnd[0]").sendVKey 0
WScript.Sleep 500

WScript.Echo "=== SCREEN 0100 (Initial Screen) ==="
WScript.Echo "Window Title: " & session.ActiveWindow.Text

' Enumerate tbar[1] buttons on Screen 0100
On Error Resume Next
Dim tbar1
Set tbar1 = session.findById("wnd[0]/tbar[1]")
If Not tbar1 Is Nothing Then
    WScript.Echo "tbar[1] Children Count: " & tbar1.Children.Count
    For i = 0 To tbar1.Children.Count - 1
        Dim btn
        Set btn = tbar1.Children(CInt(i))
        WScript.Echo "  Button [" & i & "] ID: " & btn.Id & " | Text: '" & btn.Text & "' | Tooltip: '" & btn.Tooltip & "'"
    Next
End If

' Enumerate menu bar items on Screen 0100
Dim mbar
Set mbar = session.findById("wnd[0]/mbar")
If Not mbar Is Nothing Then
    WScript.Echo "mbar Children Count: " & mbar.Children.Count
    For i = 0 To mbar.Children.Count - 1
        Dim mItem
        Set mItem = mbar.Children(CInt(i))
        WScript.Echo "  Menu [" & i & "] Text: '" & mItem.Text & "' | ID: " & mItem.Id
    Next
End If

' Now enter Target Material into Screen 0100 and press Enter to go to Item Overview
session.findById("wnd[0]/usr/ctxtRC29N-MATNR").text = "A1BH0214C"
session.findById("wnd[0]/usr/ctxtRC29N-WERKS").text = "1001"
session.findById("wnd[0]/usr/ctxtRC29N-STLAN").text = "1"
session.findById("wnd[0]").sendVKey 0
WScript.Sleep 500

' Dismiss warning/info dialogs
Do While session.Children.Count > 1
    session.findById("wnd[1]").sendVKey 0
    WScript.Sleep 300
Loop

WScript.Echo ""
WScript.Echo "=== SCREEN 0152 (Item Overview) ==="
WScript.Echo "Window Title: " & session.ActiveWindow.Text
WScript.Echo "Status Bar: [" & session.findById("wnd[0]/sbar").messageType & "] " & session.findById("wnd[0]/sbar").text

Set tbar1 = Nothing
Set tbar1 = session.findById("wnd[0]/tbar[1]")
If Not tbar1 Is Nothing Then
    WScript.Echo "tbar[1] Children Count: " & tbar1.Children.Count
    For i = 0 To tbar1.Children.Count - 1
        Set btn = tbar1.Children(CInt(i))
        WScript.Echo "  Button [" & i & "] ID: " & btn.Id & " | Text: '" & btn.Text & "' | Tooltip: '" & btn.Tooltip & "'"
    Next
End If

Set mbar = Nothing
Set mbar = session.findById("wnd[0]/mbar")
If Not mbar Is Nothing Then
    WScript.Echo "mbar Children Count: " & mbar.Children.Count
    For i = 0 To mbar.Children.Count - 1
        Set mItem = mbar.Children(CInt(i))
        WScript.Echo "  Menu [" & i & "] Text: '" & mItem.Text & "' | ID: " & mItem.Id
    Next
End If

' Reset screen back to /n
session.findById("wnd[0]/tbar[0]/okcd").text = "/n"
session.findById("wnd[0]").sendVKey 0
`;

const tempFile = path.join(os.tmpdir(), `sap_inspect_${Date.now()}.vbs`);
fs.writeFileSync(tempFile, vbsInspect, 'utf-8');

const psCommand = `Add-Type -Path '${runnerPath.replace(/'/g, "''")}'; [DesktopRunner]::RunScript('${tempFile.replace(/'/g, "''")}', 20000)`;

execFile(
  'powershell.exe',
  ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', psCommand],
  { timeout: 30000, windowsHide: true },
  (error, stdout, stderr) => {
    try { fs.unlinkSync(tempFile); } catch {}
    if (error) console.error('Error:', error);
    console.log(stdout);
  }
);
