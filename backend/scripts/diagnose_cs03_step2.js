process.env.USE_MOCK_SAP = 'false';

import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFile } from 'child_process';

const desktopRunnerPath = path.resolve('./bin/DesktopRunner.cs');

function runTestVbs(vbsContent, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const tempFile = path.join(os.tmpdir(), `diag_cs03_items_${Date.now()}.vbs`);
    fs.writeFileSync(tempFile, vbsContent, 'utf-8');

    const psCommand = `Add-Type -Path '${desktopRunnerPath.replace(/'/g, "''")}'; [DesktopRunner]::RunScript('${tempFile.replace(/'/g, "''")}', ${timeoutMs})`;

    execFile(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', psCommand],
      { timeout: timeoutMs + 5000, cwd: process.cwd() },
      (error, stdout, stderr) => {
        try { fs.unlinkSync(tempFile); } catch {}
        resolve({ error, stdout, stderr });
      }
    );
  });
}

async function runStep2() {
  const script = `
Option Explicit
On Error Resume Next

Dim SapGuiAuto, app, conn, session
Set SapGuiAuto = GetObject("SAPGUI")
Set app = SapGuiAuto.GetScriptingEngine
Set conn = app.Children(0)
Set session = conn.Children(0)

' Navigate to CS03
session.findById("wnd[0]/tbar[0]/okcd").text = "/nCS03"
session.findById("wnd[0]").sendVKey 0
WScript.Sleep 500

' Fill fields
session.findById("wnd[0]/usr/ctxtRC29N-MATNR").text = "A1BH0214C"
session.findById("wnd[0]/usr/ctxtRC29N-WERKS").text = "1001"
session.findById("wnd[0]/usr/ctxtRC29N-STLAN").text = "1"
session.findById("wnd[0]").sendVKey 0
WScript.Sleep 500

WScript.Echo "Screen=" & session.Info.ScreenNumber & ", Title=" & session.findById("wnd[0]").text

' Select Alternative row 0
Dim tblAlt
Set tblAlt = session.findById("wnd[0]/usr/tblSAPLCSDITCALT")
If Not tblAlt Is Nothing Then
    WScript.Echo "Selecting row 0 on tblSAPLCSDITCALT..."
    tblAlt.getAbsoluteRow(0).selected = True
    session.findById("wnd[0]").sendVKey 2
    WScript.Sleep 600
End If

WScript.Echo "After F2: Screen=" & session.Info.ScreenNumber & ", Title=" & session.findById("wnd[0]").text

Dim tblMat
Set tblMat = session.findById("wnd[0]/usr/tblSAPLCSDITCMAT")
If tblMat Is Nothing Then
    WScript.Echo "tblSAPLCSDITCMAT not found!"
Else
    WScript.Echo "tblSAPLCSDITCMAT found! RowCount=" & tblMat.RowCount & ", VisibleRowCount=" & tblMat.VisibleRowCount
    
    ' Check VerticalScrollbar
    Dim hasVScroll
    hasVScroll = False
    On Error Resume Next
    If Not tblMat.VerticalScrollbar Is Nothing Then
        hasVScroll = True
        WScript.Echo "VerticalScrollbar: Max=" & tblMat.VerticalScrollbar.Maximum & ", Pos=" & tblMat.VerticalScrollbar.Position
    Else
        WScript.Echo "VerticalScrollbar is Nothing!"
    End If
    On Error Goto 0
    
    ' Inspect row 0 fields
    Dim cPos, cComp, cQty, cCat, cAsm
    On Error Resume Next
    cPos = session.findById("wnd[0]/usr/tblSAPLCSDITCMAT/txtRC29P-POSNR[0,0]").text
    cComp = session.findById("wnd[0]/usr/tblSAPLCSDITCMAT/ctxtRC29P-IDNRK[2,0]").text
    cQty = session.findById("wnd[0]/usr/tblSAPLCSDITCMAT/txtRC29P-MENGE[4,0]").text
    cCat = session.findById("wnd[0]/usr/tblSAPLCSDITCMAT/ctxtRC29P-POSTP[1,0]").text
    cAsm = session.findById("wnd[0]/usr/tblSAPLCSDITCMAT/chkRC29P-STLKZ[7,0]").selected
    WScript.Echo "Row 0: Pos=" & cPos & ", Comp=" & cComp & ", Qty=" & cQty & ", Cat=" & cCat & ", Asm=" & cAsm & " (Err=" & Err.Number & ": " & Err.Description & ")"
    On Error Goto 0
End If

session.findById("wnd[0]/tbar[0]/okcd").text = "/n"
session.findById("wnd[0]").sendVKey 0
WScript.Echo "Done"
`;

  console.log('Running Step 2 Diagnostic...');
  const res = await runTestVbs(script);
  console.log('stdout:', res.stdout);
  if (res.stderr) console.log('stderr:', res.stderr);
  if (res.error) console.log('error:', res.error);
}

runStep2().catch(console.error);
