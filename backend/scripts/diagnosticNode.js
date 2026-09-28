/**
 * Minimal Standalone Node.js Diagnostic for SAP GUI COM Visibility
 */
import { execFile } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const vbsSource = `
Option Explicit
On Error Resume Next

Function JsonEscape(strVal)
    If IsNull(strVal) Or strVal = "" Then
        JsonEscape = ""
        Exit Function
    End If
    Dim res
    res = CStr(strVal)
    res = Replace(res, "\", "\\")
    res = Replace(res, """", "'")
    res = Replace(res, vbCrLf, " ")
    res = Replace(res, vbCr, " ")
    res = Replace(res, vbLf, " ")
    res = Replace(res, vbTab, " ")
    JsonEscape = Trim(res)
End Function

Dim sapAuto, rotWrapper, app, conn, sess, i, j
Dim getObjectErrNum, getObjectErrDesc
Dim rotWrapperErrNum, rotWrapperErrDesc
Dim rotEntryErrNum, rotEntryErrDesc
Dim engineErrNum, engineErrDesc

Set sapAuto = Nothing
Set rotWrapper = Nothing

' 1. Try standard GetObject("SAPGUI")
Err.Clear
Set sapAuto = GetObject("SAPGUI")
getObjectErrNum = Err.Number
getObjectErrDesc = Err.Description

' 2. If that failed, try SapROTWr.SapROTWrapper
If sapAuto Is Nothing Then
    Err.Clear
    Set rotWrapper = CreateObject("SapROTWr.SapROTWrapper")
    rotWrapperErrNum = Err.Number
    rotWrapperErrDesc = Err.Description

    If rotWrapperErrNum = 0 And Not rotWrapper Is Nothing Then
        Err.Clear
        Set sapAuto = rotWrapper.GetROTEntry("SAPGUI")
        rotEntryErrNum = Err.Number
        rotEntryErrDesc = Err.Description
    End If
End If

' Report COM failure if still nothing
If sapAuto Is Nothing Then
    WScript.Echo "{" & _
        """step"": ""GetObject""," & _
        """success"": false," & _
        """getObjectError"": {""num"": " & getObjectErrNum & ", ""hex"": ""0x" & Hex(getObjectErrNum) & """, ""desc"": """ & JsonEscape(getObjectErrDesc) & """}," & _
        """rotWrapperError"": {""num"": " & rotWrapperErrNum & ", ""hex"": ""0x" & Hex(rotWrapperErrNum) & """, ""desc"": """ & JsonEscape(rotWrapperErrDesc) & """}," & _
        """rotEntryError"": {""num"": " & rotEntryErrNum & ", ""hex"": ""0x" & Hex(rotEntryErrNum) & """, ""desc"": """ & JsonEscape(rotEntryErrDesc) & """}" & _
        "}"
    WScript.Quit 0
End If

' 3. GetScriptingEngine
Err.Clear
Set app = sapAuto.GetScriptingEngine
engineErrNum = Err.Number
engineErrDesc = Err.Description

If engineErrNum <> 0 Or app Is Nothing Then
    WScript.Echo "{" & _
        """step"": ""GetScriptingEngine""," & _
        """success"": false," & _
        """error"": {""num"": " & engineErrNum & ", ""hex"": ""0x" & Hex(engineErrNum) & """, ""desc"": """ & JsonEscape(engineErrDesc) & """}" & _
        "}"
    WScript.Quit 0
End If

' 4. Enumerate Connections & Sessions
Dim connCount
connCount = app.Children.Count

Dim outJson
outJson = "{" & _
    """step"": ""complete""," & _
    """success"": true," & _
    """connectionCount"": " & connCount & "," & _
    """connections"": ["

For i = 0 To connCount - 1
    Set conn = app.Children(CInt(i))
    Dim sessCount
    sessCount = conn.Children.Count
    
    If i > 0 Then outJson = outJson & ","
    outJson = outJson & "{" & _
        """connectionIndex"": " & i & "," & _
        """description"": """ & JsonEscape(conn.Description) & """," & _
        """sessionCount"": " & sessCount & "," & _
        """sessions"": ["

    For j = 0 To sessCount - 1
        Set sess = conn.Children(CInt(j))
        If j > 0 Then outJson = outJson & ","
        outJson = outJson & "{" & _
            """sessionIndex"": " & j & "," & _
            """sessionId"": """ & JsonEscape(sess.Id) & """," & _
            """systemName"": """ & JsonEscape(sess.Info.SystemName) & """," & _
            """client"": """ & JsonEscape(sess.Info.Client) & """," & _
            """user"": """ & JsonEscape(sess.Info.User) & """," & _
            """transaction"": """ & JsonEscape(sess.Info.Transaction) & """," & _
            """program"": """ & JsonEscape(sess.Info.Program) & """," & _
            """screenNumber"": """ & JsonEscape(sess.Info.ScreenNumber) & """," & _
            """activeWindowTitle"": """ & JsonEscape(sess.ActiveWindow.Text) & """" & _
            "}"
    Next

    outJson = outJson & "]}"
Next

outJson = outJson & "]}"
WScript.Echo outJson
`;

const desktopRunnerPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'DesktopRunner.cs');

export async function runDiagnostic() {
  const tempFile = path.join(os.tmpdir(), `sap_diag_${Date.now()}.vbs`);
  fs.writeFileSync(tempFile, vbsSource, 'utf-8');

  return new Promise((resolve, reject) => {
    const psCommand = `Add-Type -Path '${desktopRunnerPath.replace(/'/g, "''")}'; [DesktopRunner]::RunScript('${tempFile.replace(/'/g, "''")}', 15000)`;

    execFile(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', psCommand],
      { cwd: process.cwd(), env: process.env, windowsHide: true, timeout: 25000 },
      (error, stdout, stderr) => {
        try { fs.unlinkSync(tempFile); } catch {}
        if (error && error.killed) {
          return reject(new Error('Diagnostic timed out.'));
        }
        resolve({ stdout: stdout ? stdout.trim() : '', stderr: stderr ? stderr.trim() : '', error });
      }
    );
  });
}

// If run directly: node scripts/diagnosticNode.js
if (process.argv[1] && process.argv[1].endsWith('diagnosticNode.js')) {
  (async () => {
    console.log('====================================================');
    console.log('SAP GUI COM Visibility Diagnostic (Node.js standalone)');
    console.log('Process PID:', process.pid);
    console.log('Node Version:', process.version);
    console.log('Architecture:', process.arch);
    console.log('Platform:', process.platform);
    console.log('====================================================');

    const result = await runDiagnostic();
    console.log('Raw stdout:');
    console.log(result.stdout);
    if (result.stderr) {
      console.log('Raw stderr:', result.stderr);
    }

    try {
      const parsed = JSON.parse(result.stdout);
      console.log('\n--- Parsed Diagnostic Output ---');
      console.log(JSON.stringify(parsed, null, 2));
    } catch {
      console.log('Failed to parse stdout as JSON.');
    }
  })().catch(console.error);
}
