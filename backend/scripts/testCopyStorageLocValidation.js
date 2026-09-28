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

WScript.Echo "Starting Copy-From validation test (ReadOnly, cancels with /n)..."

session.findById("wnd[0]").maximize
session.findById("wnd[0]/tbar[0]/okcd").text = "/nCS01"
session.findById("wnd[0]").sendVKey 0
WScript.Sleep 500

session.findById("wnd[0]/usr/ctxtRC29N-MATNR").text = "A1BH0214C"
session.findById("wnd[0]/usr/ctxtRC29N-WERKS").text = "1012"
session.findById("wnd[0]/usr/ctxtRC29N-STLAN").text = "1"

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

If session.Children.Count > 1 Then
    session.findById("wnd[1]/usr/ctxtRC29N-MATNR").text = "A1BH0214C"
    session.findById("wnd[1]/usr/ctxtRC29N-WERKS").text = "1001"
    session.findById("wnd[1]/usr/ctxtRC29N-STLAN").text = "1"
    session.findById("wnd[1]/tbar[0]/btn[0]").press
    WScript.Sleep 600
End If

' Handle Screen 187 if appears
If session.Info.ScreenNumber = "0187" Or session.Info.ScreenNumber = "187" Then
    Dim copyAltTbl
    Set copyAltTbl = session.findById("wnd[0]/usr/tblSAPLCSDITCALT")
    copyAltTbl.getAbsoluteRow(0).selected = True
    session.findById("wnd[0]/tbar[1]/btn[7]").press
    WScript.Sleep 500
End If

WScript.Echo "Screen after template selection: " & session.Info.Program & ":" & session.Info.ScreenNumber & " (" & session.ActiveWindow.Text & ")"

' If Screen 157 (Item Selection: Copy From):
If session.Info.ScreenNumber = "0157" Or session.Info.ScreenNumber = "157" Or InStr(LCase(session.findById("wnd[0]").Text), "copy from") > 0 Then
    WScript.Echo "Screen 157 found. Selecting all items..."
    session.findById("wnd[0]/tbar[1]/btn[27]").press
    WScript.Sleep 400
    WScript.Echo "Pressing Copy (btn[5])..."
    session.findById("wnd[0]/tbar[1]/btn[5]").press
    WScript.Sleep 600
End If

WScript.Echo "Screen after Copy press: " & session.Info.Program & ":" & session.Info.ScreenNumber & " (" & session.ActiveWindow.Text & ")"
WScript.Echo "Statusbar after Copy: Type='" & session.findById("wnd[0]/sbar").messageType & "', Text='" & session.findById("wnd[0]/sbar").text & "'"
WScript.Echo "Window count: " & session.Children.Count

' Test loop for validation Enters
Dim vLoop, sText, sType
vLoop = 0
Do While vLoop < 20
    sText = session.findById("wnd[0]/sbar").text
    sType = session.findById("wnd[0]/sbar").messageType
    WScript.Echo "Loop " & vLoop & ": Type='" & sType & "' Text='" & sText & "' Screen=" & session.Info.ScreenNumber
    
    If InStr(LCase(sText), "storage location") > 0 And InStr(LCase(sText), "not supported") > 0 Then
        vLoop = vLoop + 1
        WScript.Echo "  -> Sending Enter #" & vLoop
        session.findById("wnd[0]").sendVKey 0
        WScript.Sleep 500
    Else
        WScript.Echo "  -> Validation cleared or different message!"
        Exit Do
    End If
Loop

WScript.Echo "Final Status after Loop: Type='" & session.findById("wnd[0]/sbar").messageType & "', Text='" & session.findById("wnd[0]/sbar").text & "'"
WScript.Echo "Final Screen: " & session.Info.Program & ":" & session.Info.ScreenNumber & " (" & session.ActiveWindow.Text & ")"

' Check table items
Dim row0Comp
row0Comp = ""
On Error Resume Next
row0Comp = Trim(session.findById("wnd[0]/usr/tabsTS_ITOV/tabpTCMA/ssubSUBPAGE:SAPLCSDI:0152/tblSAPLCSDITCMAT/ctxtRC29P-IDNRK[2,0]").text)
If row0Comp = "" Then
    row0Comp = Trim(session.findById("wnd[0]/usr/tabsTS_ITOV/tabpTCMA/ssubSUBPAGE:SAPLCSDI:0152/tblSAPLCSDITCMAT/txtRC29P-IDNRK[2,0]").text)
End If
On Error Goto 0
WScript.Echo "Item Table Row 0 Component: '" & row0Comp & "'"

' Safely CANCEL with /n - DO NOT SAVE!
session.findById("wnd[0]/tbar[0]/okcd").text = "/n"
session.findById("wnd[0]").sendVKey 0
WScript.Echo "Safely cancelled with /n. No BOM saved."
`;

const tmp = path.join(os.tmpdir(), 'test_copy_storage_loc_validation.vbs');
fs.writeFileSync(tmp, vbs);
const ps = `Add-Type -Path '${runnerPath.replace(/'/g, "''")}'; [DesktopRunner]::RunScript('${tmp.replace(/'/g, "''")}', 25000)`;
execFile('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', ps], (err, stdout, stderr) => {
  try { fs.unlinkSync(tmp); } catch {}
  console.log('--- OUTPUT ---');
  console.log(stdout);
  if (stderr) console.error('--- STDERR ---', stderr);
});
