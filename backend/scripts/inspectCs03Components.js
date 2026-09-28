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

' Dismiss any popups currently open
Dim pLoop
pLoop = 0
Do While session.Children.Count > 1 And pLoop < 5
    pLoop = pLoop + 1
    session.findById("wnd[1]").sendVKey 12
    WScript.Sleep 300
Loop

' Reset to main screen with /nCS03
session.findById("wnd[0]/tbar[0]/okcd").text = "/nCS03"
session.findById("wnd[0]").sendVKey 0
WScript.Sleep 500

session.findById("wnd[0]/usr/ctxtRC29N-MATNR").text = "A1BH0214C"
session.findById("wnd[0]/usr/ctxtRC29N-WERKS").text = "1001"
session.findById("wnd[0]/usr/ctxtRC29N-STLAN").text = "1"
session.findById("wnd[0]/usr/txtRC29N-STLAL").text = "2"
session.findById("wnd[0]").sendVKey 0
WScript.Sleep 600

WScript.Echo "Screen after entering Alt 2: " & session.Info.Program & ":" & session.Info.ScreenNumber & " (" & session.ActiveWindow.Text & ")"

Dim itemTbl, rIdx, compCount, cName, cQty, cUnit, cCat
Set itemTbl = Nothing
On Error Resume Next
Set itemTbl = session.findById("wnd[0]/usr/tabsTS_ITOV/tabpTCMA/ssubSUBPAGE:SAPLCSDI:0152/tblSAPLCSDITCMAT")
If itemTbl Is Nothing Then
    Set itemTbl = session.findById("wnd[0]/usr/tblSAPLCSDITCMAT")
End If
On Error Goto 0

If Not itemTbl Is Nothing Then
    WScript.Echo "Item Table found! RowCount=" & itemTbl.RowCount & ", VisibleRowCount=" & itemTbl.VisibleRowCount
    
    compCount = 0
    ' Count non-empty component rows
    ' A GuiTableControl in SAP often has VerticalScrollbar.Maximum + VisibleRowCount, or RowCount
    Dim maxRowsToInspect, iRow
    maxRowsToInspect = itemTbl.RowCount
    If maxRowsToInspect > 100 Then maxRowsToInspect = 100
    
    ' In SAP GuiTableControl, visible rows are indexed 0 to VisibleRowCount - 1
    ' If RowCount > VisibleRowCount, VerticalScrollbar is used, or RowCount represents the actual data rows
    WScript.Echo "VerticalScrollbar Position=" & itemTbl.VerticalScrollbar.Position & ", Maximum=" & itemTbl.VerticalScrollbar.Maximum
    
    ' If VerticalScrollbar.Maximum > 0, total data rows = VerticalScrollbar.Maximum + VisibleRowCount or similar
    ' Let's inspect rows by scrolling if needed, or check if getAbsoluteRow works
    Dim curPos, totalDataRows
    totalDataRows = 0
    
    ' Method 1: Scroll through table to count all valid components
    Dim vScrollMax, vPageSize, sPos, compId
    vScrollMax = itemTbl.VerticalScrollbar.Maximum
    vPageSize = itemTbl.VisibleRowCount
    
    For sPos = 0 To vScrollMax Step vPageSize
        itemTbl.VerticalScrollbar.Position = sPos
        WScript.Sleep 100
        For iRow = 0 To vPageSize - 1
            compId = ""
            On Error Resume Next
            compId = Trim(session.findById("wnd[0]/usr/tabsTS_ITOV/tabpTCMA/ssubSUBPAGE:SAPLCSDI:0152/tblSAPLCSDITCMAT/ctxtRC29P-IDNRK[2," & iRow & "]").text)
            If compId = "" Then
                compId = Trim(itemTbl.GetCell(iRow, 2).Text)
            End If
            On Error Goto 0
            If compId <> "" And compId <> "__" And InStr(compId, "_") = 0 Then
                totalDataRows = totalDataRows + 1
                If totalDataRows <= 5 Or totalDataRows >= 15 Then
                    WScript.Echo "  Component #" & totalDataRows & ": " & compId
                End If
            End If
        Next
    Next
    WScript.Echo "Total Component Count found: " & totalDataRows
Else
    WScript.Echo "Item Table NOT found. Status bar: " & session.findById("wnd[0]/sbar").text
End If

' Reset to /n
session.findById("wnd[0]/tbar[0]/okcd").text = "/n"
session.findById("wnd[0]").sendVKey 0
WScript.Echo "Reset done."
`;

const tmp = path.join(os.tmpdir(), 'inspect_cs03_comps.vbs');
fs.writeFileSync(tmp, vbs);
const ps = `Add-Type -Path '${runnerPath.replace(/'/g, "''")}'; [DesktopRunner]::RunScript('${tmp.replace(/'/g, "''")}', 20000)`;
execFile('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', ps], (err, stdout, stderr) => {
  try { fs.unlinkSync(tmp); } catch {}
  console.log('--- OUTPUT ---');
  console.log(stdout);
  if (stderr) console.error('--- STDERR ---', stderr);
});
