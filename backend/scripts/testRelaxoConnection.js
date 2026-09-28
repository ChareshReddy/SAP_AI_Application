/**
 * Standalone Connection & Discovery Test for Relaxo Sandbox SAP GUI Session
 */
import { execFile } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const runnerPath = path.resolve(__dirname, '..', 'bin', 'DesktopRunner.cs');

const vbsDiscovery = `
Option Explicit
On Error Resume Next

Function JsonEscape(strVal)
    If IsNull(strVal) Or strVal = "" Then
        JsonEscape = ""
        Exit Function
    End If
    Dim res
    res = CStr(strVal)
    res = Replace(res, "\\", "\\\\")
    res = Replace(res, """", "'")
    res = Replace(res, vbCrLf, " ")
    res = Replace(res, vbCr, " ")
    res = Replace(res, vbLf, " ")
    res = Replace(res, vbTab, " ")
    JsonEscape = Trim(res)
End Function

Function GetSapGuiObject(ByRef rawErrDetails)
    Dim sapAuto, rotWrapper, attempt, lastErrNum, lastErrDesc
    Set sapAuto = Nothing
    lastErrNum = 0
    lastErrDesc = "No error"
    rawErrDetails = ""

    For attempt = 1 To 3
        On Error Resume Next
        Err.Clear
        Set sapAuto = GetObject("SAPGUI")
        lastErrNum = Err.Number
        lastErrDesc = Err.Description
        On Error Goto 0

        If lastErrNum = 0 And Not sapAuto Is Nothing Then
            Set GetSapGuiObject = sapAuto
            Exit Function
        End If

        On Error Resume Next
        Err.Clear
        Set rotWrapper = CreateObject("SapROTWr.SapROTWrapper")
        If Err.Number = 0 And Not rotWrapper Is Nothing Then
            Set sapAuto = rotWrapper.GetROTEntry("SAPGUI")
            If Not sapAuto Is Nothing Then
                On Error Goto 0
                Set GetSapGuiObject = sapAuto
                Exit Function
            End If
            If Err.Number <> 0 Then
                lastErrNum = Err.Number
                lastErrDesc = Err.Description
            End If
        End If
        On Error Goto 0

        If attempt < 3 Then WScript.Sleep 1000
    Next

    rawErrDetails = "COM Err " & lastErrNum & " (0x" & Hex(lastErrNum) & "): " & lastErrDesc
    Set GetSapGuiObject = Nothing
End Function

Dim rawErrInfo, sapAuto, app, conn, sess
Dim user, sys, client, trans, prog, screenNum, sessionTitle, sessionPath, connectionName
Dim connCount, cIdx, sIdx, foundRelaxo, allConnsJson

Set sapAuto = GetSapGuiObject(rawErrInfo)

If sapAuto Is Nothing Then
    WScript.Echo "{""success"":false,""code"":""SESSION_NOT_FOUND"",""message"":""No running SAP GUI instance found."",""rawError"":""" & JsonEscape(rawErrInfo) & """}"
    WScript.Quit 0
End If

Set app = sapAuto.GetScriptingEngine
If Err.Number <> 0 Or app Is Nothing Then
    WScript.Echo "{""success"":false,""code"":""SCRIPTING_DISABLED"",""message"":""SAP GUI Scripting is disabled.""}"
    WScript.Quit 0
End If

connCount = app.Children.Count
If connCount = 0 Then
    WScript.Echo "{""success"":false,""code"":""NO_CONNECTION"",""message"":""SAP GUI is open, but no active system connection found.""}"
    WScript.Quit 0
End If

allConnsJson = "["
foundRelaxo = False

For cIdx = 0 To connCount - 1
    Set conn = app.Children(CInt(cIdx))
    Dim sessCount, cDesc
    sessCount = conn.Children.Count
    cDesc = conn.Description
    
    If cIdx > 0 Then allConnsJson = allConnsJson & ","
    allConnsJson = allConnsJson & "{""connectionIndex"":" & cIdx & ",""description"":""" & JsonEscape(cDesc) & """,""sessionCount"":" & sessCount & ",""sessions"":["

    For sIdx = 0 To sessCount - 1
        Set sess = conn.Children(CInt(sIdx))
        Dim sUser, sSys, sCli, sTrans, sProg, sScreen, sTitle, sId
        sId = sess.Id
        sUser = sess.Info.User
        sSys = sess.Info.SystemName
        sCli = sess.Info.Client
        sTrans = sess.Info.Transaction
        sProg = sess.Info.Program
        sScreen = sess.Info.ScreenNumber
        sTitle = ""
        On Error Resume Next
        sTitle = sess.ActiveWindow.Text
        On Error Goto 0

        If sIdx > 0 Then allConnsJson = allConnsJson & ","
        allConnsJson = allConnsJson & "{""sessionIndex"":" & sIdx & ",""sessionId"":""" & JsonEscape(sId) & """,""systemName"":""" & JsonEscape(sSys) & """,""client"":""" & JsonEscape(sCli) & """,""user"":""" & JsonEscape(sUser) & """,""transaction"":""" & JsonEscape(sTrans) & """,""program"":""" & JsonEscape(sProg) & """,""screen"":""" & JsonEscape(sScreen) & """,""title"":""" & JsonEscape(sTitle) & """}"

        ' Prefer session matching relaxo or s4a, or any active logged in session
        If Not foundRelaxo Then
            If InStr(LCase(cDesc), "relaxo") > 0 Or InStr(LCase(sSys), "s4a") > 0 Or (sCli <> "" And sUser <> "") Then
                user = sUser
                sys = sSys
                client = sCli
                trans = sTrans
                sessionPath = sId
                connectionName = cDesc
                sessionTitle = sTitle
                prog = sProg
                screenNum = sScreen
                If InStr(LCase(cDesc), "relaxo") > 0 Or InStr(LCase(sSys), "s4a") > 0 Then
                    foundRelaxo = True
                End If
            End If
        End If
    Next
    allConnsJson = allConnsJson & "]}"
Next
allConnsJson = allConnsJson & "]"

WScript.Echo "{""success"":true," & _
    """detectedRelaxo"":" & (LCase(CStr(foundRelaxo))) & "," & _
    """connectionName"":""" & JsonEscape(connectionName) & """," & _
    """system"":""" & JsonEscape(sys) & """," & _
    """client"":""" & JsonEscape(client) & """," & _
    """user"":""" & JsonEscape(user) & """," & _
    """transaction"":""" & JsonEscape(trans) & """," & _
    """sessionTitle"":""" & JsonEscape(sessionTitle) & """," & _
    """sessionPath"":""" & JsonEscape(sessionPath) & """," & _
    """program"":""" & JsonEscape(prog) & """," & _
    """screen"":""" & JsonEscape(screenNum) & """," & _
    """connectionCount"":" & connCount & "," & _
    """allConnections"":" & allConnsJson & "}"
`;

async function runTest() {
  console.log('===============================================================');
  console.log('Relaxo Sandbox: Dynamic SAP GUI Session Detection');
  console.log('===============================================================');

  const tempFile = path.join(os.tmpdir(), `sap_relaxo_probe_${Date.now()}.vbs`);
  fs.writeFileSync(tempFile, vbsDiscovery, 'utf-8');

  const psCommand = `Add-Type -Path '${runnerPath.replace(/'/g, "''")}'; [DesktopRunner]::RunScript('${tempFile.replace(/'/g, "''")}', 15000)`;

  execFile(
    'powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', psCommand],
    { timeout: 25000, windowsHide: true },
    (error, stdout, stderr) => {
      try { fs.unlinkSync(tempFile); } catch {}

      if (error) {
        console.error('Execution failed:', error.message);
        return;
      }

      console.log('Raw output:');
      console.log(stdout.trim());

      try {
        const parsed = JSON.parse(stdout.trim());
        console.log('\n--- Parsed Detection Result ---');
        console.log(JSON.stringify(parsed, null, 2));

        if (parsed.success) {
          console.log('\n✅ RELAXO SANDBOX SESSION CONFIRMED ACCESSIBLE!');
          console.log(`1. Relaxo Sandbox Detected: ${parsed.detectedRelaxo ? 'YES' : 'NO'}`);
          console.log(`2. Connection Description/Name: "${parsed.connectionName}"`);
          console.log(`3. Client: ${parsed.client} (System: ${parsed.system}, User: ${parsed.user})`);
          console.log(`4. Current Transaction: ${parsed.transaction}`);
          console.log(`5. Session Title: "${parsed.sessionTitle}"`);
          console.log(`6. Scripting Session Object/Path: "${parsed.sessionPath}"`);
        } else {
          console.log('\n❌ DETECTION FAILED:', parsed.message);
        }
      } catch (e) {
        console.error('Failed to parse output as JSON:', e.message);
      }
    }
  );
}

runTest();
