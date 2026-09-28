process.env.USE_MOCK_SAP = 'false';

import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFile } from 'child_process';
import { checkSapSessionHealth } from '../services/sapGuiClient.js';

const desktopRunnerPath = path.resolve('./bin/DesktopRunner.cs');

function runTestVbs(vbsContent, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const tempFile = path.join(os.tmpdir(), `diag_cs03_${Date.now()}.vbs`);
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

async function runDiagnosis() {
  console.log('1. Checking SAP Session Health...');
  const health = await checkSapSessionHealth();
  console.log('Session health:', health);

  const diagScript = `
Option Explicit
On Error Resume Next

Dim SapGuiAuto, app, conn, session
Set SapGuiAuto = GetObject("SAPGUI")
Set app = SapGuiAuto.GetScriptingEngine
Set conn = app.Children(0)
Set session = conn.Children(0)

WScript.Echo "Session Initial State: Trans=" & session.Info.Transaction & ", Program=" & session.Info.Program & ", Screen=" & session.Info.ScreenNumber & ", Title=" & session.findById("wnd[0]").text

' Navigate to CS03
session.findById("wnd[0]/tbar[0]/okcd").text = "/nCS03"
session.findById("wnd[0]").sendVKey 0
WScript.Sleep 500

WScript.Echo "After /nCS03: Screen=" & session.Info.ScreenNumber & ", Title=" & session.findById("wnd[0]").text

' Fill fields
session.findById("wnd[0]/usr/ctxtRC29N-MATNR").text = "A1BH0214C"
session.findById("wnd[0]/usr/ctxtRC29N-WERKS").text = "1001"
session.findById("wnd[0]/usr/ctxtRC29N-STLAN").text = "1"
session.findById("wnd[0]").sendVKey 0
WScript.Sleep 500

WScript.Echo "After Enter in CS03: Screen=" & session.Info.ScreenNumber & ", Title=" & session.findById("wnd[0]").text
WScript.Echo "wnd Children Count=" & session.Children.Count

' Check if status bar has message
Dim sbarMsg, sbarType
sbarMsg = session.findById("wnd[0]/sbar").text
sbarType = session.findById("wnd[0]/sbar").messageType
WScript.Echo "Status Bar: [" & sbarType & "] " & sbarMsg

' Check Screen 187 (Alternative Overview) or Screen 150/152 (Item Overview)
Dim tblAlt, tblMat
Set tblAlt = session.findById("wnd[0]/usr/tblSAPLCSDITCALT")
If Not tblAlt Is Nothing Then
    WScript.Echo "Screen 187 Table tblSAPLCSDITCALT found! RowCount=" & tblAlt.RowCount & ", VisibleRowCount=" & tblAlt.VisibleRowCount
End If

Set tblMat = session.findById("wnd[0]/usr/tblSAPLCSDITCMAT")
If Not tblMat Is Nothing Then
    WScript.Echo "Item Table tblSAPLCSDITCMAT found! RowCount=" & tblMat.RowCount & ", VisibleRowCount=" & tblMat.VisibleRowCount
End If

' Return to SMEN
session.findById("wnd[0]/tbar[0]/okcd").text = "/n"
session.findById("wnd[0]").sendVKey 0
WScript.Echo "Returned to /n"
`;

  console.log('\n2. Executing Diagnostic Script...');
  const res = await runTestVbs(diagScript);
  console.log('stdout:', res.stdout);
  if (res.stderr) console.log('stderr:', res.stderr);
  if (res.error) console.log('error:', res.error);
}

runDiagnosis().catch(console.error);
