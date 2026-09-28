/**
 * Live Discovery of ZBOM_COPY screen structure and control IDs in Relaxo Sandbox.
 * Does NOT execute delete.
 */
import { execFile } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const runnerPath = path.resolve(__dirname, '..', 'bin', 'DesktopRunner.cs');

const vbsInspect = `
Option Explicit
On Error Resume Next

Dim SapGuiAuto, app, conn, session, i, j
Set SapGuiAuto = GetObject("SAPGUI")
If Err.Number <> 0 Or SapGuiAuto Is Nothing Then
    WScript.Echo "ERROR: Cannot get SAPGUI object"
    WScript.Quit 1
End If

Set app = SapGuiAuto.GetScriptingEngine
If Err.Number <> 0 Or app Is Nothing Then
    WScript.Echo "ERROR: Cannot get Scripting Engine"
    WScript.Quit 1
End If

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

If targetSession Is Nothing Then
    Set targetSession = app.Children(0).Children(0)
End If
Set session = targetSession

WScript.Echo "Connected Session: " & session.Id & " | User: " & session.Info.User & " | System: " & session.Info.SystemName & " | Client: " & session.Info.Client

' 1. Navigate to ZBOM_COPY
session.findById("wnd[0]/tbar[0]/okcd").text = "/nZBOM_COPY"
session.findById("wnd[0]").sendVKey 0
WScript.Sleep 1000

' Check if transaction opened or returned error
Dim sbarText, sbarType
sbarText = session.findById("wnd[0]/sbar").text
sbarType = session.findById("wnd[0]/sbar").messageType

WScript.Echo "=== ZBOM_COPY INITIAL SCREEN ==="
WScript.Echo "Active Window Title: " & session.ActiveWindow.Text
WScript.Echo "Program: " & session.Info.Program
WScript.Echo "Screen Number: " & session.Info.ScreenNumber
WScript.Echo "Transaction: " & session.Info.Transaction
WScript.Echo "Status Bar: [" & sbarType & "] " & sbarText

' Subroutine to recursively dump all controls
Sub DumpControls(container, indent)
    Dim k, child, childCount
    childCount = 0
    On Error Resume Next
    Err.Clear
    childCount = container.Children.Count
    If Err.Number <> 0 Then Exit Sub

    For k = 0 To childCount - 1
        Err.Clear
        Set child = container.Children(CInt(k))
        If Err.Number = 0 And Not child Is Nothing Then
            Dim cType, cId, cName, cText, cTooltip, cSelected, cSubCount
            cType = child.Type
            cId = child.Id
            cName = child.Name
            cText = ""
            cTooltip = ""
            cSelected = ""
            
            cText = child.Text
            cTooltip = child.Tooltip
            If cType = "GuiRadioButton" Or cType = "GuiCheckBox" Then
                cSelected = " | Selected=" & child.Selected
            End If

            WScript.Echo indent & "[" & cType & "] Name: '" & cName & "' | ID: " & cId & " | Text: '" & cText & "' | Tooltip: '" & cTooltip & "'" & cSelected

            ' Recurse into children if any
            Err.Clear
            cSubCount = 0
            cSubCount = child.Children.Count
            If Err.Number = 0 And cSubCount > 0 Then
                DumpControls child, indent & "    "
            End If
        End If
    Next
End Sub

WScript.Echo ""
WScript.Echo "--- DUMPING TOOLBAR 0 (tbar[0]) ---"
DumpControls session.findById("wnd[0]/tbar[0]"), "  "

WScript.Echo ""
WScript.Echo "--- DUMPING TOOLBAR 1 (tbar[1]) ---"
DumpControls session.findById("wnd[0]/tbar[1]"), "  "

WScript.Echo ""
WScript.Echo "--- DUMPING USER AREA (usr) ---"
DumpControls session.findById("wnd[0]/usr"), "  "

WScript.Echo ""
WScript.Echo "=== DISCOVERY COMPLETED ==="
`;

function runDiscovery() {
  const tempFile = path.join(os.tmpdir(), `inspect_zbom_copy_${Date.now()}.vbs`);
  fs.writeFileSync(tempFile, vbsInspect, 'utf-8');

  const psCommand = `Add-Type -Path '${runnerPath.replace(/'/g, "''")}'; [DesktopRunner]::RunScript('${tempFile.replace(/'/g, "''")}', 30000)`;

  execFile(
    'powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', psCommand],
    { timeout: 45000, cwd: process.cwd() },
    (error, stdout, stderr) => {
      try { fs.unlinkSync(tempFile); } catch {}
      if (error) {
        console.error('Error executing script:', error.message);
      }
      if (stdout) {
        console.log(stdout);
      }
      if (stderr) {
        console.error('stderr:', stderr);
      }
    }
  );
}

runDiscovery();
