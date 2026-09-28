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

If session.findById("wnd[0]/sbar").messageType = "W" Then
    session.findById("wnd[0]").sendVKey 0
    WScript.Sleep 500
End If

If session.Children.Count > 1 Then
    session.findById("wnd[1]/usr/ctxtRC29N-MATNR").text = "A1BH0214C"
    session.findById("wnd[1]/usr/ctxtRC29N-WERKS").text = "1012"
    session.findById("wnd[1]/usr/ctxtRC29N-STLAN").text = "1"
    session.findById("wnd[1]/tbar[0]/btn[0]").press
    WScript.Sleep 500
    
    WScript.Echo "Screen: " & session.Info.ScreenNumber
    
    Dim tbl, r
    Set tbl = session.findById("wnd[0]/usr/tblSAPLCSDITCALT")
    If Not tbl Is Nothing Then
        WScript.Echo "Alternative Table Rows: " & tbl.RowCount
        For r = 0 To tbl.RowCount - 1
            Dim altNum, plantVal
            altNum = tbl.GetCell(r, 0).Text
            plantVal = tbl.GetCell(r, 1).Text
            WScript.Echo "Row " & r & " Alt: '" & altNum & "' Plant: '" & plantVal & "'"
        Next
    End If
End If

' Cleanup
session.findById("wnd[0]/tbar[0]/okcd").text = "/n"
session.findById("wnd[0]").sendVKey 0
`;

const tmp = path.join(os.tmpdir(), 'test_cs01_copy_alt.vbs');
fs.writeFileSync(tmp, vbs);
const ps = `Add-Type -Path '${runnerPath.replace(/'/g, "''")}'; [DesktopRunner]::RunScript('${tmp.replace(/'/g, "''")}', 20000)`;
execFile('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', ps], (err, stdout, stderr) => {
  try { fs.unlinkSync(tmp); } catch {}
  console.log('stdout:', stdout);
  if (stderr) console.error('stderr:', stderr);
});
