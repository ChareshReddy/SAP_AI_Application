/**
 * Inspect ABAP source of ZPP_BOM_COPY_CREATION (Display only)
 */
import { execFile } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const runnerPath = path.resolve(__dirname, '..', 'bin', 'DesktopRunner.cs');

const vbsInspectCode = `
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

' Try opening SE38 to display ZPP_BOM_COPY_CREATION
session.findById("wnd[0]/tbar[0]/okcd").text = "/nSE38"
session.findById("wnd[0]").sendVKey 0
WScript.Sleep 500

WScript.Echo "SE38 Window: " & session.ActiveWindow.Text
WScript.Echo "Status: " & session.findById("wnd[0]/sbar").text

If InStr(session.ActiveWindow.Text, "ABAP Editor") > 0 Then
    session.findById("wnd[0]/usr/ctxtRS38M-PROGRAMM").text = "ZPP_BOM_COPY_CREATION"
    ' Click Display (F7 or btn[7])
    session.findById("wnd[0]/tbar[1]/btn[7]").press
    WScript.Sleep 500
    WScript.Echo "Display Window: " & session.ActiveWindow.Text
    WScript.Echo "Program: " & session.Info.Program & " | Screen: " & session.Info.ScreenNumber
Else
    WScript.Echo "No SE38 access or different screen: " & session.findById("wnd[0]/sbar").text
End If

' Return to Easy Access / clean state
session.findById("wnd[0]/tbar[0]/okcd").text = "/n"
session.findById("wnd[0]").sendVKey 0
`;

function run() {
  const tempFile = path.join(os.tmpdir(), `check_abap_${Date.now()}.vbs`);
  fs.writeFileSync(tempFile, vbsInspectCode, 'utf-8');

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
