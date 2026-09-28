/**
 * Display ZPP_BOM_COPY_CREATION code and find P_DEL logic
 */
import { execFile } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const runnerPath = path.resolve(__dirname, '..', 'bin', 'DesktopRunner.cs');

const vbs = `
Option Explicit
On Error Resume Next

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

session.findById("wnd[0]/tbar[0]/okcd").text = "/nSE38"
session.findById("wnd[0]").sendVKey 0
WScript.Sleep 500

session.findById("wnd[0]/usr/ctxtRS38M-PROGRAMM").text = "ZPP_BOM_COPY_CREATION"
session.findById("wnd[0]/usr/btnSHOP").press
WScript.Sleep 500

WScript.Echo "Title: " & session.ActiveWindow.Text
WScript.Echo "Status: " & session.findById("wnd[0]/sbar").text

' In ABAP Editor display screen, search for P_DEL
' Send Ctrl+F (or okcode = "FIND")
session.findById("wnd[0]/tbar[0]/okcd").text = "FIND"
session.findById("wnd[0]").sendVKey 0
WScript.Sleep 500

If session.Children.Count > 1 Then
    WScript.Echo "Find Dialog: " & session.findById("wnd[1]").Text
    session.findById("wnd[1]/usr/txtRS38M-FIND_STR").text = "P_DEL"
    session.findById("wnd[1]/tbar[0]/btn[0]").press
    WScript.Sleep 500
End If

' Dump editor lines if control is textedit
Dim ed
Set ed = session.findById("wnd[0]/usr/cntlEDITOR/shellcont/shell")
If Not ed Is Nothing Then
    WScript.Echo "Found Editor shell!"
    WScript.Echo "Selected Text: " & ed.SelectedText
    WScript.Echo "Line count: " & ed.LineCount
Else
    ' Or it might be classic editor
    WScript.Echo "Could not find shell editor, checking usr controls:"
    For i = 0 To session.findById("wnd[0]/usr").Children.Count - 1
        Dim c
        Set c = session.findById("wnd[0]/usr").Children(CInt(i))
        WScript.Echo "  usr: " & c.Id & " (" & c.Type & ")"
    Next
End If

' Exit back to Easy Access
session.findById("wnd[0]/tbar[0]/okcd").text = "/n"
session.findById("wnd[0]").sendVKey 0
`;

function run() {
  const tempFile = path.join(os.tmpdir(), `check_abap_editor_${Date.now()}.vbs`);
  fs.writeFileSync(tempFile, vbs, 'utf-8');

  const psCommand = `Add-Type -Path '${runnerPath.replace(/'/g, "''")}'; [DesktopRunner]::RunScript('${tempFile.replace(/'/g, "''")}', 30000)`;

  execFile(
    'powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', psCommand],
    { timeout: 45000, cwd: process.cwd() },
    (error, stdout, stderr) => {
      try { fs.unlinkSync(tempFile); } catch {}
      if (stdout) console.log(stdout);
      if (stderr) console.error('stderr:', stderr);
    }
  );
}

run();
