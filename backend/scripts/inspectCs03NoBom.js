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

Sub TestCs03(mat, werks, usage)
    session.findById("wnd[0]/tbar[0]/okcd").text = "/nCS03"
    session.findById("wnd[0]").sendVKey 0
    WScript.Sleep 400

    session.findById("wnd[0]/usr/ctxtRC29N-MATNR").text = mat
    session.findById("wnd[0]/usr/ctxtRC29N-WERKS").text = werks
    session.findById("wnd[0]/usr/ctxtRC29N-STLAN").text = usage
    session.findById("wnd[0]/usr/txtRC29N-STLAL").text = ""
    session.findById("wnd[0]").sendVKey 0
    WScript.Sleep 500

    WScript.Echo "Test [" & mat & ", " & werks & ", " & usage & "]:"
    WScript.Echo "  Screen=" & session.Info.Program & ":" & session.Info.ScreenNumber & " (" & session.ActiveWindow.Text & ")"
    WScript.Echo "  Sbar MsgType=" & session.findById("wnd[0]/sbar").messageType & ", Text=" & session.findById("wnd[0]/sbar").text
End Sub

TestCs03 "A1BH0214C", "1002", "1"
TestCs03 "A1BH0214C", "1003", "1"
TestCs03 "A1BH0214C", "9999", "1"

session.findById("wnd[0]/tbar[0]/okcd").text = "/n"
session.findById("wnd[0]").sendVKey 0
`;

const tmp = path.join(os.tmpdir(), 'inspect_cs03_nobom.vbs');
fs.writeFileSync(tmp, vbs);
const ps = `Add-Type -Path '${runnerPath.replace(/'/g, "''")}'; [DesktopRunner]::RunScript('${tmp.replace(/'/g, "''")}', 20000)`;
execFile('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', ps], (err, stdout, stderr) => {
  try { fs.unlinkSync(tmp); } catch {}
  console.log('--- OUTPUT ---');
  console.log(stdout);
  if (stderr) console.error('--- STDERR ---', stderr);
});
