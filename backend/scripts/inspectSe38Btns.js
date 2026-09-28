/**
 * Inspect controls of SE38 Initial Screen
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

' Enumerate tbar[1] buttons
Dim tbar1, btn
Set tbar1 = session.findById("wnd[0]/tbar[1]")
For i = 0 To tbar1.Children.Count - 1
    Set btn = tbar1.Children(CInt(i))
    WScript.Echo "tbar[1] [" & i & "] ID: " & btn.Id & " | Text: '" & btn.Text & "' | Tooltip: '" & btn.Tooltip & "'"
Next

' Check Display button on usr if any
Dim usr
Set usr = session.findById("wnd[0]/usr")
For i = 0 To usr.Children.Count - 1
    Dim c
    Set c = usr.Children(CInt(i))
    If c.Type = "GuiButton" Then
        WScript.Echo "usr Button: " & c.Id & " | Text: '" & c.Text & "' | Tooltip: '" & c.Tooltip & "'"
    End If
Next

' Return to Easy Access
session.findById("wnd[0]/tbar[0]/okcd").text = "/n"
session.findById("wnd[0]").sendVKey 0
`;

function run() {
  const tempFile = path.join(os.tmpdir(), `check_se38_btns_${Date.now()}.vbs`);
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
