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

WScript.Echo "Initial State: Session=" & session.Id & ", Sys=" & session.Info.SystemName & ", Client=" & session.Info.Client & ", Screen=" & session.Info.Program & ":" & session.Info.ScreenNumber & " (" & session.ActiveWindow.Text & ")"

' Dismiss any popups currently open
Dim pLoop
pLoop = 0
Do While session.Children.Count > 1 And pLoop < 5
    pLoop = pLoop + 1
    WScript.Echo "Dismissing popup: " & session.findById("wnd[1]").Text
    session.findById("wnd[1]").sendVKey 12 ' Cancel / F12
    WScript.Sleep 400
Loop

' Reset to main screen with /n
session.findById("wnd[0]/tbar[0]/okcd").text = "/n"
session.findById("wnd[0]").sendVKey 0
WScript.Sleep 500

WScript.Echo "After /n: Screen=" & session.Info.Program & ":" & session.Info.ScreenNumber & " (" & session.ActiveWindow.Text & ")"

' Navigate to CS03
session.findById("wnd[0]/tbar[0]/okcd").text = "/nCS03"
session.findById("wnd[0]").sendVKey 0
WScript.Sleep 600

WScript.Echo "After /nCS03: Screen=" & session.Info.Program & ":" & session.Info.ScreenNumber & " (" & session.ActiveWindow.Text & ")"

' Enter parameters: A1BH0214C, plant 1001, usage 1
session.findById("wnd[0]/usr/ctxtRC29N-MATNR").text = "A1BH0214C"
session.findById("wnd[0]/usr/ctxtRC29N-WERKS").text = "1001"
session.findById("wnd[0]/usr/ctxtRC29N-STLAN").text = "1"
session.findById("wnd[0]").sendVKey 0
WScript.Sleep 800

WScript.Echo "After Enter in CS03:"
WScript.Echo "  Screen=" & session.Info.Program & ":" & session.Info.ScreenNumber & " (" & session.ActiveWindow.Text & ")"
WScript.Echo "  Window Count=" & session.Children.Count
WScript.Echo "  Statusbar Type='" & session.findById("wnd[0]/sbar").messageType & "', Text='" & session.findById("wnd[0]/sbar").text & "'"

' Check if tblSAPLCSDITCALT exists (Alternative Overview)
Dim altTbl, r, maxR
Set altTbl = Nothing
Set altTbl = session.findById("wnd[0]/usr/tblSAPLCSDITCALT")
If Not altTbl Is Nothing Then
    WScript.Echo "  Alternative Overview Table FOUND: RowCount=" & altTbl.RowCount & ", VisibleRowCount=" & altTbl.VisibleRowCount
    maxR = altTbl.RowCount - 1
    If maxR > 15 Then maxR = 15
    For r = 0 To maxR
        Dim aNum, aText, aPlant
        aNum = ""
        aText = ""
        aPlant = ""
        On Error Resume Next
        aNum = Trim(session.findById("wnd[0]/usr/tblSAPLCSDITCALT/txtRC29K-STLAL[0," & r & "]").text)
        aText = Trim(session.findById("wnd[0]/usr/tblSAPLCSDITCALT/txtRC29K-ZTEXT[1," & r & "]").text)
        aPlant = Trim(session.findById("wnd[0]/usr/tblSAPLCSDITCALT/ctxtRC29K-WERKS[2," & r & "]").text)
        If aNum = "" Then
            aNum = Trim(altTbl.GetCell(r, 0).Text)
            aText = Trim(altTbl.GetCell(r, 1).Text)
            aPlant = Trim(altTbl.GetCell(r, 2).Text)
        End If
        On Error Goto 0
        If aNum <> "" Then
            WScript.Echo "    Row " & r & ": Alt='" & aNum & "', Text='" & aText & "', Plant='" & aPlant & "'"
        End If
    Next
Else
    WScript.Echo "  tblSAPLCSDITCALT NOT found."
End If

' Check if Item table exists (Screen 152)
Dim itemTbl
Set itemTbl = Nothing
Set itemTbl = session.findById("wnd[0]/usr/tabsTS_ITOV/tabpTCMA/ssubSUBPAGE:SAPLCSDI:0152/tblSAPLCSDITCMAT")
If Not itemTbl Is Nothing Then
    WScript.Echo "  Item Table (tblSAPLCSDITCMAT) FOUND: RowCount=" & itemTbl.RowCount
    Dim comp0
    comp0 = Trim(session.findById("wnd[0]/usr/tabsTS_ITOV/tabpTCMA/ssubSUBPAGE:SAPLCSDI:0152/tblSAPLCSDITCMAT/ctxtRC29P-IDNRK[2,0]").text)
    WScript.Echo "    Component [2,0]='" & comp0 & "'"
Else
    WScript.Echo "  Item Table NOT found on this screen."
End If

' Cleanup
session.findById("wnd[0]/tbar[0]/okcd").text = "/n"
session.findById("wnd[0]").sendVKey 0
WScript.Echo "Done!"
`;

const tmp = path.join(os.tmpdir(), 'inspect_cs03_live.vbs');
fs.writeFileSync(tmp, vbs);
const ps = `Add-Type -Path '${runnerPath.replace(/'/g, "''")}'; [DesktopRunner]::RunScript('${tmp.replace(/'/g, "''")}', 20000)`;
execFile('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', ps], (err, stdout, stderr) => {
  try { fs.unlinkSync(tmp); } catch {}
  console.log('--- OUTPUT ---');
  console.log(stdout);
  if (stderr) console.error('--- STDERR ---', stderr);
});
