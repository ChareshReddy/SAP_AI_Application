import { execFile } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const runnerPath = path.resolve(__dirname, '..', 'bin', 'DesktopRunner.cs');

function runVbs(vbsContent) {
  return new Promise((resolve, reject) => {
    const tmp = path.join(os.tmpdir(), `test_val_${Date.now()}.vbs`);
    fs.writeFileSync(tmp, vbsContent);
    const ps = `Add-Type -Path '${runnerPath.replace(/'/g, "''")}'; [DesktopRunner]::RunScript('${tmp.replace(/'/g, "''")}', 25000)`;
    execFile('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', ps], (err, stdout, stderr) => {
      try { fs.unlinkSync(tmp); } catch {}
      if (err) return reject(err);
      resolve(stdout.trim());
    });
  });
}

function buildValidationVbs(material, plant, bomUsage, alternativeBom) {
  return `
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

Dim SapGuiAuto, app, conn, session
Set SapGuiAuto = GetObject("SAPGUI")
If SapGuiAuto Is Nothing Then
    WScript.Echo "{""success"":false,""errorCode"":""SAP_SESSION_NOT_FOUND"",""message"":""No running SAP GUI instance found. Please open SAP GUI and log into Relaxo Sandbox (S4A).""}"
    WScript.Quit 0
End If

Set app = SapGuiAuto.GetScriptingEngine
If Err.Number <> 0 Or app Is Nothing Then
    WScript.Echo "{""success"":false,""errorCode"":""SAP_SESSION_NOT_FOUND"",""message"":""SAP GUI Scripting is disabled or unavailable.""}"
    WScript.Quit 0
End If

Dim cIdx, sIdx, targetSession, targetConn
Set targetSession = Nothing
Set targetConn = Nothing

For cIdx = 0 To app.Children.Count - 1
    Dim cConn
    Set cConn = app.Children(CInt(cIdx))
    For sIdx = 0 To cConn.Children.Count - 1
        Dim cSess
        Set cSess = cConn.Children(CInt(sIdx))
        If InStr(LCase(cConn.Description), "relaxo") > 0 Or InStr(LCase(cSess.Info.SystemName), "s4a") > 0 Or (cSess.Info.User <> "" And cSess.Info.Client <> "") Then
            Set targetConn = cConn
            Set targetSession = cSess
            Exit For
        End If
    Next
    If Not targetSession Is Nothing Then Exit For
Next

If targetSession Is Nothing And app.Children.Count > 0 And app.Children(0).Children.Count > 0 Then
    Set targetConn = app.Children(0)
    Set targetSession = app.Children(0).Children(0)
End If

If targetSession Is Nothing Then
    WScript.Echo "{""success"":false,""errorCode"":""SAP_SESSION_NOT_FOUND"",""message"":""No active SAP GUI session found. Please ensure SAP GUI is open and logged into system S4A (Client 500).""}"
    WScript.Quit 0
End If

Set conn = targetConn
Set session = targetSession

' Dismiss any modal dialogs
Dim pLoop
pLoop = 0
Do While session.Children.Count > 1 And pLoop < 5
    pLoop = pLoop + 1
    session.findById("wnd[1]").sendVKey 12
    WScript.Sleep 250
Loop

' Reset to /nCS03
session.findById("wnd[0]/tbar[0]/okcd").text = "/nCS03"
session.findById("wnd[0]").sendVKey 0
WScript.Sleep 400

' Fill Initial Screen without alternative so Screen 187 can enumerate all alternatives
session.findById("wnd[0]/usr/ctxtRC29N-MATNR").text = "${material}"
session.findById("wnd[0]/usr/ctxtRC29N-WERKS").text = "${plant}"
session.findById("wnd[0]/usr/ctxtRC29N-STLAN").text = "${bomUsage}"
session.findById("wnd[0]/usr/txtRC29N-STLAL").text = ""

session.findById("wnd[0]").sendVKey 0
WScript.Sleep 500

' Check status bar for immediate error
Dim sbarType, sbarText, safeSbar
sbarType = session.findById("wnd[0]/sbar").messageType
sbarText = session.findById("wnd[0]/sbar").text
safeSbar = JsonEscape(sbarText)

If sbarType = "E" Or sbarType = "A" Then
    session.findById("wnd[0]/tbar[0]/okcd").text = "/n"
    session.findById("wnd[0]").sendVKey 0
    
    Dim errCode
    If InStr(LCase(sbarText), "does not exist or is not activated") > 0 Or (InStr(LCase(sbarText), "material") > 0 And InStr(LCase(sbarText), "not exist") > 0) Then
        errCode = "MATERIAL_NOT_FOUND"
    ElseIf InStr(LCase(sbarText), "not maintained in plant") > 0 Or (InStr(LCase(sbarText), "plant") > 0 And InStr(LCase(sbarText), "not defined") > 0) Then
        errCode = "MATERIAL_PLANT_INVALID"
    ElseIf InStr(LCase(sbarText), "alternative") > 0 And InStr(LCase(sbarText), "does not exist") > 0 Then
        errCode = "ALTERNATIVE_NOT_FOUND"
    ElseIf InStr(LCase(sbarText), "bom not found") > 0 Or InStr(LCase(sbarText), "no bom exists") > 0 Then
        errCode = "BOM_NOT_FOUND"
    Else
        errCode = "SAP_VALIDATION_ERROR"
    End If
    
    WScript.Echo "{""success"":false,""errorCode"":""" & errCode & """,""message"":""" & safeSbar & """}"
    WScript.Quit 0
End If

If sbarType = "W" Or sbarType = "I" Then
    session.findById("wnd[0]").sendVKey 0
    WScript.Sleep 400
End If

' Check if we landed on Screen 187 (Alternative Overview)
Dim tbl187, rIdx, aVal, selectedRow, targetAlt
Set tbl187 = Nothing
On Error Resume Next
Set tbl187 = session.findById("wnd[0]/usr/tblSAPLCSDITCALT")
On Error Goto 0

Dim availableAlts, foundRequestedAlt
availableAlts = ""
foundRequestedAlt = False
selectedRow = -1
targetAlt = "${alternativeBom}"

If Not tbl187 Is Nothing Then
    Dim maxR
    maxR = tbl187.RowCount - 1
    If maxR > 25 Then maxR = 25
    For rIdx = 0 To maxR
        aVal = ""
        On Error Resume Next
        aVal = Trim(tbl187.GetCell(rIdx, 0).Text)
        On Error Goto 0
        If aVal <> "" And aVal <> "__" And InStr(aVal, "_") = 0 Then
            If availableAlts <> "" Then availableAlts = availableAlts & ","
            availableAlts = availableAlts & """" & JsonEscape(aVal) & """"
            If targetAlt <> "" And aVal = targetAlt Then
                selectedRow = rIdx
                foundRequestedAlt = True
            End If
        End If
    Next

    If targetAlt <> "" And Not foundRequestedAlt Then
        session.findById("wnd[0]/tbar[0]/okcd").text = "/n"
        session.findById("wnd[0]").sendVKey 0
        WScript.Echo "{""success"":false,""errorCode"":""ALTERNATIVE_NOT_FOUND"",""availableAlternatives"":[" & availableAlts & "],""message"":""Alternative BOM " & JsonEscape(targetAlt) & " does not exist for material ${material} in plant ${plant} with BOM usage ${bomUsage}.""}"
        WScript.Quit 0
    End If

    ' Select row and press F2 / sendVKey 2 to enter Item Overview
    If selectedRow < 0 Then selectedRow = 0
    tbl187.getAbsoluteRow(selectedRow).selected = True
    session.findById("wnd[0]").sendVKey 2
    WScript.Sleep 500
Else
    ' Landed directly on single Alternative Overview (Screen 2150)
    Dim singleAlt
    singleAlt = ""
    On Error Resume Next
    singleAlt = Trim(session.findById("wnd[0]/usr/subSUB_HEADER:SAPLCSDI:0151/txtRC29K-STLAL").text)
    On Error Goto 0
    If singleAlt <> "" Then
        availableAlts = """" & JsonEscape(singleAlt) & """"
        If targetAlt <> "" And targetAlt <> singleAlt Then
            session.findById("wnd[0]/tbar[0]/okcd").text = "/n"
            session.findById("wnd[0]").sendVKey 0
            WScript.Echo "{""success"":false,""errorCode"":""ALTERNATIVE_NOT_FOUND"",""availableAlternatives"":[" & availableAlts & "],""message"":""Alternative BOM " & JsonEscape(targetAlt) & " does not exist for material ${material} in plant ${plant} with BOM usage ${bomUsage}.""}"
            WScript.Quit 0
        End If
    End If
End If

' Now on Item Overview screen (Screen 2150 / Screen 152)
Dim itemTbl, totalComps
Set itemTbl = Nothing
totalComps = 0

On Error Resume Next
Set itemTbl = session.findById("wnd[0]/usr/tabsTS_ITOV/tabpTCMA/ssubSUBPAGE:SAPLCSDI:0152/tblSAPLCSDITCMAT")
If itemTbl Is Nothing Then
    Set itemTbl = session.findById("wnd[0]/usr/tblSAPLCSDITCMAT")
End If
On Error Goto 0

If Not itemTbl Is Nothing Then
    Dim vScrollMax, vPageSize, sPos, iRow, compId
    vScrollMax = itemTbl.VerticalScrollbar.Maximum
    vPageSize = itemTbl.VisibleRowCount
    If vPageSize <= 0 Then vPageSize = 15

    For sPos = 0 To vScrollMax Step vPageSize
        itemTbl.VerticalScrollbar.Position = sPos
        WScript.Sleep 80
        For iRow = 0 To vPageSize - 1
            compId = ""
            On Error Resume Next
            compId = Trim(session.findById("wnd[0]/usr/tabsTS_ITOV/tabpTCMA/ssubSUBPAGE:SAPLCSDI:0152/tblSAPLCSDITCMAT/ctxtRC29P-IDNRK[2," & iRow & "]").text)
            If compId = "" Then compId = Trim(itemTbl.GetCell(iRow, 2).Text)
            On Error Goto 0
            If compId <> "" And compId <> "__" And InStr(compId, "_") = 0 Then
                totalComps = totalComps + 1
            End If
        Next
    Next
End If

' Clean up session back to main screen
session.findById("wnd[0]/tbar[0]/okcd").text = "/n"
session.findById("wnd[0]").sendVKey 0

Dim altsJson
If availableAlts <> "" Then
    altsJson = "[" & availableAlts & "]"
ElseIf targetAlt <> "" Then
    altsJson = "[""" & JsonEscape(targetAlt) & """]"
Else
    altsJson = "[]"
End If

WScript.Echo "{""success"":true,""materialExists"":true,""plantValid"":true,""bomExists"":true,""alternativeValid"":true,""availableAlternatives"":" & altsJson & ",""componentCount"":" & totalComps & ",""message"":""Source BOM validated successfully.""}"
`;
}

async function main() {
  console.log('Testing live validateSourceBom VBScript generation...\n');

  console.log('1. Testing A1BH0214C / 1001 / Usage 1 / Alt 2:');
  const res1 = await runVbs(buildValidationVbs('A1BH0214C', '1001', '1', '2'));
  console.log('Result 1:', res1);

  console.log('\n2. Testing A1BH0214C / 1001 / Usage 1 / Alt "" (no alt provided):');
  const res2 = await runVbs(buildValidationVbs('A1BH0214C', '1001', '1', ''));
  console.log('Result 2:', res2);

  console.log('\n3. Testing A1BH0214C / 1001 / Usage 1 / Alt 9 (non-existent alt):');
  const res3 = await runVbs(buildValidationVbs('A1BH0214C', '1001', '1', '9'));
  console.log('Result 3:', res3);

  console.log('\n4. Testing NONEXISTENT_MAT_999 / 1001 / Usage 1:');
  const res4 = await runVbs(buildValidationVbs('NONEXISTENT_MAT_999', '1001', '1', ''));
  console.log('Result 4:', res4);

  console.log('\n5. Testing A1BH0214C / 1002 (unmaintained plant):');
  const res5 = await runVbs(buildValidationVbs('A1BH0214C', '1002', '1', ''));
  console.log('Result 5:', res5);

  console.log('\n6. Testing A1BH0214C / 1001 / Usage 2 (unmaintained usage):');
  const res6 = await runVbs(buildValidationVbs('A1BH0214C', '1001', '2', ''));
  console.log('Result 6:', res6);
}

main().catch(console.error);
