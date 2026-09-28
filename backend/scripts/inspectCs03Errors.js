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

Dim SapGuiAuto, app, session
Set SapGuiAuto = GetObject("SAPGUI")
Set app = SapGuiAuto.GetScriptingEngine
Set session = app.Children(0).Children(0)

Sub TestCs03(mat, werks, usage, alt)
    ' Dismiss popups
    Dim pLoop
    pLoop = 0
    Do While session.Children.Count > 1 And pLoop < 5
        pLoop = pLoop + 1
        session.findById("wnd[1]").sendVKey 12
        WScript.Sleep 200
    Loop

    session.findById("wnd[0]/tbar[0]/okcd").text = "/nCS03"
    session.findById("wnd[0]").sendVKey 0
    WScript.Sleep 400

    session.findById("wnd[0]/usr/ctxtRC29N-MATNR").text = mat
    session.findById("wnd[0]/usr/ctxtRC29N-WERKS").text = werks
    session.findById("wnd[0]/usr/ctxtRC29N-STLAN").text = usage
    session.findById("wnd[0]/usr/txtRC29N-STLAL").text = alt
    session.findById("wnd[0]").sendVKey 0
    WScript.Sleep 500

    WScript.Echo "Test [" & mat & ", " & werks & ", " & usage & ", " & alt & "]:"
    WScript.Echo "  Screen=" & session.Info.Program & ":" & session.Info.ScreenNumber & " (" & session.ActiveWindow.Text & ")"
    WScript.Echo "  Sbar MsgType=" & session.findById("wnd[0]/sbar").messageType & ", Text=" & session.findById("wnd[0]/sbar").text
    
    If session.Children.Count > 1 Then
        WScript.Echo "  Modal popup: " & session.findById("wnd[1]").Text
    End If
End Sub

TestCs03 "NONEXISTENT_MAT_999", "1001", "1", ""
TestCs03 "A1BH0214C", "1012", "1", ""
TestCs03 "A1BH0214C", "1001", "1", "9"
TestCs03 "A1BH0214C", "1001", "1", ""

session.findById("wnd[0]/tbar[0]/okcd").text = "/n"
session.findById("wnd[0]").sendVKey 0
`;

const tmp = path.join(os.tmpdir(), 'inspect_cs03_errs.vbs');
fs.writeFileSync(tmp, vbs);
const ps = `Add-Type -Path '${runnerPath.replace(/'/g, "''")}'; [DesktopRunner]::RunScript('${tmp.replace(/'/g, "''")}', 25000)`;
execFile('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', ps], (err, stdout, stderr) => {
  try { fs.unlinkSync(tmp); } catch {}
  console.log('--- OUTPUT ---');
  console.log(stdout);
  if (stderr) console.error('--- STDERR ---', stderr);
});
