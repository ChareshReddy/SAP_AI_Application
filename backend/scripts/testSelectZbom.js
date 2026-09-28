/**
 * Live test of selecting Delete radio button and setting field values in ZBOM_COPY
 * (WITHOUT pressing execute)
 */
import { execFile } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const runnerPath = path.resolve(__dirname, '..', 'bin', 'DesktopRunner.cs');

const vbsTestSelect = `
Option Explicit
On Error Resume Next

Dim SapGuiAuto, app, conn, session, i, j
Set SapGuiAuto = GetObject("SAPGUI")
Set app = SapGuiAuto.GetScriptingEngine

Dim targetSession
Set targetSession = Nothing
For i = 0 To app.Children.Count - 1
    Set conn = app.Children(CInt(i))
    For j = 0 To conn.Children.Count - 1
        Set session = conn.Children(CInt(j))
        If InStr(LCase(conn.Description), "relaxo") > 0 Or InStr(LCase(session.Info.SystemName), "s4a") > 0 Then
            Set targetSession = session
            Exit For
        End If
    Next
    If Not targetSession Is Nothing Then Exit For
Next

If targetSession Is Nothing Then Set targetSession = app.Children(0).Children(0)
Set session = targetSession

' Navigate fresh to ZBOM_COPY
session.findById("wnd[0]/tbar[0]/okcd").text = "/nZBOM_COPY"
session.findById("wnd[0]").sendVKey 0
WScript.Sleep 500

WScript.Echo "1. Selecting Delete radio button (wnd[0]/usr/radP_DEL)..."
session.findById("wnd[0]/usr/radP_DEL").select
WScript.Sleep 300

WScript.Echo "   radP_DEL.Selected = " & session.findById("wnd[0]/usr/radP_DEL").Selected
WScript.Echo "   radP_CREA.Selected = " & session.findById("wnd[0]/usr/radP_CREA").Selected

' Check if TO fields are still enabled or disabled
WScript.Echo "   P_MATTO.Changeable = " & session.findById("wnd[0]/usr/ctxtP_MATTO").Changeable
WScript.Echo "   P_WERTO.Changeable = " & session.findById("wnd[0]/usr/ctxtP_WERTO").Changeable

' Now populate the test values into FROM fields:
WScript.Echo "2. Populating fields:"
session.findById("wnd[0]/usr/ctxtP_MATNR").text = "A1BH0214C"
session.findById("wnd[0]/usr/ctxtP_WERKS").text = "1001"
session.findById("wnd[0]/usr/txtP_STLAL").text = "2"
session.findById("wnd[0]/usr/ctxtP_STLAN").text = "1"

WScript.Echo "   P_MATNR text = '" & session.findById("wnd[0]/usr/ctxtP_MATNR").text & "'"
WScript.Echo "   P_WERKS text = '" & session.findById("wnd[0]/usr/ctxtP_WERKS").text & "'"
WScript.Echo "   P_STLAL text = '" & session.findById("wnd[0]/usr/txtP_STLAL").text & "'"
WScript.Echo "   P_STLAN text = '" & session.findById("wnd[0]/usr/ctxtP_STLAN").text & "'"

' Check status bar
WScript.Echo "3. Status bar: [" & session.findById("wnd[0]/sbar").messageType & "] " & session.findById("wnd[0]/sbar").text

' Check if any popup window exists
WScript.Echo "4. Windows count: " & session.Children.Count

WScript.Echo "=== TEST SELECT COMPLETED (NO EXECUTE PRESSED) ==="
`;

function runTest() {
  const tempFile = path.join(os.tmpdir(), `test_select_zbom_${Date.now()}.vbs`);
  fs.writeFileSync(tempFile, vbsTestSelect, 'utf-8');

  const psCommand = `Add-Type -Path '${runnerPath.replace(/'/g, "''")}'; [DesktopRunner]::RunScript('${tempFile.replace(/'/g, "''")}', 30000)`;

  execFile(
    'powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', psCommand],
    { timeout: 45000, cwd: process.cwd() },
    (error, stdout, stderr) => {
      try { fs.unlinkSync(tempFile); } catch {}
      if (error) console.error('Error:', error.message);
      if (stdout) console.log(stdout);
      if (stderr) console.error('stderr:', stderr);
    }
  );
}

runTest();
