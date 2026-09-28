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

session.findById("wnd[0]/usr/ctxtRC29N-MATNR").text = "A1BH0214C"
session.findById("wnd[0]/usr/ctxtRC29N-WERKS").text = "1012"
session.findById("wnd[0]/usr/ctxtRC29N-STLAN").text = "1"
session.findById("wnd[0]/usr/txtRC29N-STLAL").text = ""
session.findById("wnd[0]").sendVKey 0
WScript.Sleep 500

WScript.Echo "Screen=" & session.Info.Program & ":" & session.Info.ScreenNumber & " (" & session.ActiveWindow.Text & ")"
WScript.Echo "Sbar MsgType=" & session.findById("wnd[0]/sbar").messageType & ", Text=" & session.findById("wnd[0]/sbar").text

' Inspect screen controls and header
Dim cHeaderMat, cHeaderPlant, cHeaderUsage
cHeaderMat = session.findById("wnd[0]/usr/subSUB_HEADER:SAPLCSDI:0151/ctxtRC29K-MATNR").text
cHeaderPlant = session.findById("wnd[0]/usr/subSUB_HEADER:SAPLCSDI:0151/ctxtRC29K-WERKS").text
cHeaderUsage = session.findById("wnd[0]/usr/subSUB_HEADER:SAPLCSDI:0151/ctxtRC29K-STLAN").text
WScript.Echo "Header: Mat=" & cHeaderMat & ", Plant=" & cHeaderPlant & ", Usage=" & cHeaderUsage

Dim altTbl, r, maxR
Set altTbl = session.findById("wnd[0]/usr/tblSAPLCSDITCALT")
If Not altTbl Is Nothing Then
    WScript.Echo "altTbl RowCount=" & altTbl.RowCount
    For r = 0 To 5
        WScript.Echo "  Row " & r & ": Alt=" & Trim(altTbl.GetCell(r, 0).Text) & ", Text=" & Trim(altTbl.GetCell(r, 1).Text)
    Next
End If

session.findById("wnd[0]/tbar[0]/okcd").text = "/n"
session.findById("wnd[0]").sendVKey 0
`;

const tmp = path.join(os.tmpdir(), 'inspect_cs03_1012.vbs');
fs.writeFileSync(tmp, vbs);
const ps = `Add-Type -Path '${runnerPath.replace(/'/g, "''")}'; [DesktopRunner]::RunScript('${tmp.replace(/'/g, "''")}', 20000)`;
execFile('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', ps], (err, stdout, stderr) => {
  try { fs.unlinkSync(tmp); } catch {}
  console.log('--- OUTPUT ---');
  console.log(stdout);
  if (stderr) console.error('--- STDERR ---', stderr);
});
