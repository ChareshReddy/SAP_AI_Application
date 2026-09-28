process.env.USE_MOCK_SAP = 'false';

import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFile } from 'child_process';

const desktopRunnerPath = path.resolve('./bin/DesktopRunner.cs');

function runTestVbs(vbsContent, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const tempFile = path.join(os.tmpdir(), `dump_controls_${Date.now()}.vbs`);
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

async function dumpScreen2150Controls() {
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

' Select Alternative row 0
Dim tblAlt
Set tblAlt = session.findById("wnd[0]/usr/tblSAPLCSDITCALT")
If Not tblAlt Is Nothing Then
    tblAlt.getAbsoluteRow(0).selected = True
    session.findById("wnd[0]").sendVKey 2
    WScript.Sleep 600
End If

WScript.Echo "Screen=" & session.Info.ScreenNumber & ", Title=" & session.findById("wnd[0]").text

Sub DumpChildren(parentObj, prefix)
    Dim i, child
    If parentObj Is Nothing Then Exit Sub
    For i = 0 To parentObj.Children.Count - 1
        Set child = parentObj.Children(CInt(i))
        If Not child Is Nothing Then
            WScript.Echo prefix & child.Id & " (" & child.Type & ") Name=" & child.Name
            If child.Type = "GuiTableControl" Or child.Type = "GuiTabStrip" Or child.Type = "GuiTab" Or child.Type = "GuiSubScreen" Or child.Type = "GuiUserArea" Then
                DumpChildren child, prefix & "  "
            End If
        End If
    Next
End Sub

DumpChildren session.findById("wnd[0]/usr"), ""

session.findById("wnd[0]/tbar[0]/okcd").text = "/n"
session.findById("wnd[0]").sendVKey 0
`;

  console.log('Dumping Screen 2150 controls...');
  const res = await runTestVbs(script);
  console.log('stdout:', res.stdout);
  if (res.stderr) console.log('stderr:', res.stderr);
  if (res.error) console.log('error:', res.error);
}

dumpScreen2150Controls().catch(console.error);
