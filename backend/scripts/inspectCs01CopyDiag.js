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

session.findById("wnd[0]/tbar[0]/okcd").text = "/nCS01"
session.findById("wnd[0]").sendVKey 0
WScript.Sleep 500

session.findById("wnd[0]/usr/ctxtRC29N-MATNR").text = "A1BH0214C"
session.findById("wnd[0]/usr/ctxtRC29N-WERKS").text = "1001"
session.findById("wnd[0]/usr/ctxtRC29N-STLAN").text = "1"
session.findById("wnd[0]/tbar[1]/btn[7]").press
WScript.Sleep 500

WScript.Echo "After F7: Windows=" & session.Children.Count & " Sbar=[" & session.findById("wnd[0]/sbar").messageType & "] " & session.findById("wnd[0]/sbar").text

If session.findById("wnd[0]/sbar").messageType = "W" Then
    session.findById("wnd[0]").sendVKey 0
    WScript.Sleep 500
    WScript.Echo "After Enter on warning: Windows=" & session.Children.Count
    If session.Children.Count <= 1 Then
        session.findById("wnd[0]/tbar[1]/btn[7]").press
        WScript.Sleep 500
        WScript.Echo "After 2nd F7: Windows=" & session.Children.Count
    End If
End If

If session.Children.Count > 1 Then
    WScript.Echo "Copy dialog title: " & session.findById("wnd[1]").text
    session.findById("wnd[1]/usr/ctxtRC29N-MATNR").text = "A1BH0214C"
    session.findById("wnd[1]/usr/ctxtRC29N-WERKS").text = "1012"
    session.findById("wnd[1]/usr/ctxtRC29N-STLAN").text = "1"
    session.findById("wnd[1]/tbar[0]/btn[0]").press
    WScript.Sleep 500
    
    WScript.Echo "After btn[0] in Copy dialog: Windows=" & session.Children.Count
    WScript.Echo "Main Sbar: [" & session.findById("wnd[0]/sbar").messageType & "] " & session.findById("wnd[0]/sbar").text
    If session.Children.Count > 1 Then
        WScript.Echo "wnd[1] text: " & session.findById("wnd[1]").text
        On Error Resume Next
        WScript.Echo "wnd[1]/sbar text: " & session.findById("wnd[1]/sbar").text
        On Error Goto 0
    End If
End If

' Cleanup
session.findById("wnd[0]/tbar[0]/okcd").text = "/n"
session.findById("wnd[0]").sendVKey 0
`;

const tmp = path.join(os.tmpdir(), 'test_cs01_copy_diag.vbs');
fs.writeFileSync(tmp, vbs);
const ps = `Add-Type -Path '${runnerPath.replace(/'/g, "''")}'; [DesktopRunner]::RunScript('${tmp.replace(/'/g, "''")}', 20000)`;
execFile('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', ps], (err, stdout, stderr) => {
  try { fs.unlinkSync(tmp); } catch {}
  console.log('stdout:', stdout);
  if (stderr) console.error('stderr:', stderr);
});
