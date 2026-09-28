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

WScript.Echo "Starting CS01 Copy Template Inspection (ReadOnly, will cancel with /n)..."

session.findById("wnd[0]").maximize
session.findById("wnd[0]/tbar[0]/okcd").text = "/nCS01"
session.findById("wnd[0]").sendVKey 0
WScript.Sleep 500

' Fill TARGET BOM Header
session.findById("wnd[0]/usr/ctxtRC29N-MATNR").text = "A1BH0214C"
session.findById("wnd[0]/usr/ctxtRC29N-WERKS").text = "1012"
session.findById("wnd[0]/usr/ctxtRC29N-STLAN").text = "1"

' Click Copy From
session.findById("wnd[0]/tbar[1]/btn[7]").press
WScript.Sleep 500

If session.findById("wnd[0]/sbar").messageType = "W" Then
    session.findById("wnd[0]").sendVKey 0
    WScript.Sleep 500
    If session.Children.Count <= 1 Then
        session.findById("wnd[0]/tbar[1]/btn[7]").press
        WScript.Sleep 500
    End If
End If

WScript.Echo "Popup window count: " & session.Children.Count
If session.Children.Count > 1 Then
    WScript.Echo "Copy From popup title: " & session.findById("wnd[1]").Text
    session.findById("wnd[1]/usr/ctxtRC29N-MATNR").text = "A1BH0214C"
    session.findById("wnd[1]/usr/ctxtRC29N-WERKS").text = "1001"
    session.findById("wnd[1]/usr/ctxtRC29N-STLAN").text = "1"
    session.findById("wnd[1]/tbar[0]/btn[0]").press
    WScript.Sleep 600
End If

WScript.Echo "Current Screen: " & session.Info.Program & ":" & session.Info.ScreenNumber & " (" & session.ActiveWindow.Text & ")"

Dim tbl, r, c
Set tbl = session.findById("wnd[0]/usr/tblSAPLCSDITCALT")
If Not tbl Is Nothing Then
    WScript.Echo "tblSAPLCSDITCALT found on Screen 187! Rows: " & tbl.RowCount & ", VisibleRows: " & tbl.VisibleRowCount
    For c = 0 To tbl.Columns.Count - 1
        WScript.Echo "  Col " & c & " Title: '" & tbl.Columns.Item(c).Title & "', Name: '" & tbl.Columns.Item(c).Name & "'"
    Next
    Dim maxR
    maxR = tbl.RowCount - 1
    If maxR > 9 Then maxR = 9
    For r = 0 To maxR
        Dim c0, c1, c2, c3
        c0 = "" : c1 = "" : c2 = "" : c3 = ""
        On Error Resume Next
        c0 = tbl.GetCell(r, 0).Text
        c1 = tbl.GetCell(r, 1).Text
        c2 = tbl.GetCell(r, 2).Text
        c3 = tbl.GetCell(r, 3).Text
        On Error Goto 0
        WScript.Echo "  Row " & r & ": cell(0)='" & c0 & "' cell(1)='" & c1 & "' cell(2)='" & c2 & "' cell(3)='" & c3 & "'"
    Next
Else
    WScript.Echo "tblSAPLCSDITCALT NOT found. Current window title: " & session.ActiveWindow.Text
    WScript.Echo "Status bar: " & session.findById("wnd[0]/sbar").Text
End If

' Cancel and clean up WITHOUT saving
session.findById("wnd[0]/tbar[0]/okcd").text = "/n"
session.findById("wnd[0]").sendVKey 0
WScript.Echo "Safely cancelled with /n. No changes made."
`;

const tmp = path.join(os.tmpdir(), 'inspect_cs01_copy_template.vbs');
fs.writeFileSync(tmp, vbs);
const ps = `Add-Type -Path '${runnerPath.replace(/'/g, "''")}'; [DesktopRunner]::RunScript('${tmp.replace(/'/g, "''")}', 20000)`;
execFile('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', ps], (err, stdout, stderr) => {
  try { fs.unlinkSync(tmp); } catch {}
  console.log('--- OUTPUT ---');
  console.log(stdout);
  if (stderr) console.error('--- STDERR ---', stderr);
});
