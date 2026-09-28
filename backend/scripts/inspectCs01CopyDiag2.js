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
    WScript.Echo "Program: " & session.Info.Program
    WScript.Echo "ActiveWindow Text: " & session.ActiveWindow.Text
    
    Dim tbl
    Set tbl = session.findById("wnd[0]/usr/tabsTS_ITOV/tabpTCMA/ssubSUBPAGE:SAPLCSDI:0152/tblSAPLCSDITCMAT")
    If Not tbl Is Nothing Then
        WScript.Echo "Table found, row count: " & tbl.RowCount & ", visible rows: " & tbl.VisibleRowCount
        WScript.Echo "Row 0 component: '" & tbl.GetCell(0, 1).Text & "'"
        WScript.Echo "Row 0 text: '" & session.findById("wnd[0]/usr/tabsTS_ITOV/tabpTCMA/ssubSUBPAGE:SAPLCSDI:0152/tblSAPLCSDITCMAT/ctxtRC29P-IDNRK[2,0]").text & "'"
    Else
        WScript.Echo "Table NOT found on this screen."
    End If
End If

' Cleanup without saving!
session.findById("wnd[0]/tbar[0]/okcd").text = "/n"
session.findById("wnd[0]").sendVKey 0
`;

const tmp = path.join(os.tmpdir(), 'test_cs01_copy_diag2.vbs');
fs.writeFileSync(tmp, vbs);
const ps = `Add-Type -Path '${runnerPath.replace(/'/g, "''")}'; [DesktopRunner]::RunScript('${tmp.replace(/'/g, "''")}', 20000)`;
execFile('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', ps], (err, stdout, stderr) => {
  try { fs.unlinkSync(tmp); } catch {}
  console.log('stdout:', stdout);
  if (stderr) console.error('stderr:', stderr);
});
