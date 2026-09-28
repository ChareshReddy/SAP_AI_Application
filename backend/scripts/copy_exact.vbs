
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

Function GetWindowText(wnd)
    Dim fullText, i, child
    fullText = ""
    On Error Resume Next
    fullText = wnd.text
    If Not wnd.usr Is Nothing Then
        For i = 0 To wnd.usr.Children.Count - 1
            Set child = wnd.usr.Children(CInt(i))
            If Not child Is Nothing Then
                If child.text <> "" Then
                    fullText = fullText & " " & child.text
                End If
            End If
        Next
    End If
    On Error Goto 0
    GetWindowText = Trim(fullText)
End Function

Function IsHardError(popupText)
    Dim lowerText
    lowerText = LCase(popupText)
    
    If InStr(lowerText, "already exist") > 0 Or _
       InStr(lowerText, "alternative") > 0 Or _
       InStr(lowerText, "information") > 0 Or _
       InStr(lowerText, "warning") > 0 Or _
       InStr(lowerText, "caution") > 0 Or _
       InStr(lowerText, "added to") > 0 Or _
       InStr(lowerText, "will be created") > 0 Or _
       InStr(lowerText, "next alternative") > 0 Or _
       InStr(lowerText, "confirm") > 0 Then
        IsHardError = False
        Exit Function
    End If

    If InStr(lowerText, "error") > 0 Or _
       InStr(lowerText, "not authorized") > 0 Or _
       InStr(lowerText, "no authorization") > 0 Or _
       InStr(lowerText, "does not exist") > 0 Or _
       InStr(lowerText, "not maintained") > 0 Or _
       InStr(lowerText, "locked") > 0 Or _
       InStr(lowerText, "cannot be") > 0 Then
        IsHardError = True
        Exit Function
    End If

    IsHardError = False
End Function

Function IsStorageLocationValidation(msg)
    If IsNull(msg) Or msg = "" Then
        IsStorageLocationValidation = False
        Exit Function
    End If
    Dim m
    m = LCase(Trim(msg))
    If InStr(m, "storage location") > 0 And InStr(m, "not supported") > 0 And InStr(m, "for material") > 0 Then
        IsStorageLocationValidation = True
    Else
        IsStorageLocationValidation = False
    End If
End Function

Function CheckStorageLocValidation(sessionObj)
    CheckStorageLocValidation = ""
    On Error Resume Next
    Dim sbText
    sbText = sessionObj.findById("${CS01_FIELD_IDS.STATUS_BAR}").text
    If IsStorageLocationValidation(sbText) Then
        CheckStorageLocValidation = sbText
        Exit Function
    End If
    If sessionObj.Children.Count > 1 Then
        Dim popText
        popText = GetWindowText(sessionObj.findById("wnd[1]"))
        If IsStorageLocationValidation(popText) Then
            CheckStorageLocValidation = popText
            Exit Function
        End If
    End If
    On Error Goto 0
End Function


Dim rawErrInfo, SapGuiAuto, app, conn, session
Set SapGuiAuto = GetSapGuiObject(rawErrInfo)
If SapGuiAuto Is Nothing Then
    Dim safeRawErr
    safeRawErr = JsonEscape(rawErrInfo)
    WScript.Echo "{""success"":false,""verified"":false,""code"":""SESSION_NOT_FOUND"",""message"":""No running SAP GUI instance found. Please open SAP GUI, log into your SAP system, and try again."",""rawError"":""" & safeRawErr & """}"
    WScript.Quit 0
End If

Set app = SapGuiAuto.GetScriptingEngine
If Err.Number <> 0 Or app Is Nothing Then
    WScript.Echo "{""success"":false,""verified"":false,""code"":""SCRIPTING_DISABLED"",""message"":""SAP GUI Scripting is disabled. Ensure scripting is enabled in SAP GUI Options and RZ11.""}"
    WScript.Quit 0
End If


' --- Begin Dynamic Session Discovery ---
Dim cIdx, sIdx, connCount, targetConn, targetSession
Dim bestConn, bestSess, bestScore
Dim hasBrokenSession, hasBusySession, hasUnauthenticatedSession
Dim diagJson

Set targetConn = Nothing
Set targetSession = Nothing
Set bestConn = Nothing
Set bestSess = Nothing
bestScore = -1
hasBrokenSession = False
hasBusySession = False
hasUnauthenticatedSession = False
diagJson = ""


' Step 1: Preflight direct lookup if valid session path was supplied
On Error Resume Next
Err.Clear
Dim preflightSess
Set preflightSess = app.findById("/app/con[0]/ses[0]")
If Err.Number = 0 And Not preflightSess Is Nothing Then
    Dim pfUser
    pfUser = Trim(CStr(preflightSess.Info.User))
    If UCase(pfUser) = UCase("LEELAM_EXT") And preflightSess.Info.Client <> "" Then
        Set targetSession = preflightSess
        Set targetConn = preflightSess.Parent
    End If
End If
On Error Goto 0


' Step 2: Dynamic enumeration of all connections and all sessions
If targetSession Is Nothing Then
    connCount = app.Children.Count
    For cIdx = 0 To connCount - 1
        Dim cConn
        Set cConn = Nothing
        On Error Resume Next
        Set cConn = app.Children(CInt(cIdx))
        On Error Goto 0

        If Not cConn Is Nothing Then
            Dim cDesc, sessCount
            cDesc = ""
            sessCount = 0
            On Error Resume Next
            cDesc = cConn.Description
            sessCount = cConn.Children.Count
            On Error Goto 0

            For sIdx = 0 To sessCount - 1
                Dim cSess
                Set cSess = Nothing
                On Error Resume Next
                Set cSess = cConn.Children(CInt(sIdx))
                On Error Goto 0

                If Not cSess Is Nothing Then
                    Dim sUser, sSys, sCli, sTrans, sProg, sScreen, sTitle, sId, sBusy
                    Dim sessErr, isBroken, score
                    sUser = "" : sSys = "" : sCli = "" : sTrans = "" : sProg = "" : sScreen = "" : sTitle = "" : sId = ""
                    sBusy = False
                    isBroken = False
                    score = 0

                    On Error Resume Next
                    sId = cSess.Id
                    sBusy = cSess.Busy
                    sUser = Trim(CStr(cSess.Info.User))
                    sSys = Trim(CStr(cSess.Info.SystemName))
                    sCli = Trim(CStr(cSess.Info.Client))
                    sTrans = Trim(CStr(cSess.Info.Transaction))
                    sProg = Trim(CStr(cSess.Info.Program))
                    sScreen = Trim(CStr(cSess.Info.ScreenNumber))
                    sessErr = Err.Number
                    On Error Goto 0

                    If sessErr <> 0 Then
                        isBroken = True
                        hasBrokenSession = True
                    End If

                    On Error Resume Next
                    sTitle = cSess.ActiveWindow.Text
                    On Error Goto 0

                    Dim lowTitle
                    lowTitle = LCase(sTitle)
                    If InStr(lowTitle, "connection to partner") > 0 Or _
                       InStr(lowTitle, "partner not reached") > 0 Or _
                       InStr(lowTitle, "wsaeconnreset") > 0 Or _
                       InStr(lowTitle, "10054") > 0 Or _
                       InStr(lowTitle, "connection lost") > 0 Or _
                       InStr(lowTitle, "connection reset") > 0 Or _
                       InStr(lowTitle, "connection broken") > 0 Or _
                       InStr(lowTitle, "connection closed") > 0 Then
                        isBroken = True
                        hasBrokenSession = True
                    End If

                    If sBusy Then hasBusySession = True

                    ' Build diagnostic entry for logging
                    If diagJson <> "" Then diagJson = diagJson & ","
                    diagJson = diagJson & "{" & _
                        """connectionIndex"":" & cIdx & "," & _
                        """sessionIndex"":" & sIdx & "," & _
                        """sessionPath"":""" & JsonEscape(sId) & """," & _
                        """system"":""" & JsonEscape(sSys) & """," & _
                        """client"":""" & JsonEscape(sCli) & """," & _
                        """user"":""" & JsonEscape(sUser) & """," & _
                        """transaction"":""" & JsonEscape(sTrans) & """," & _
                        """busy"":" & LCase(CStr(sBusy)) & "," & _
                        """broken"":" & LCase(CStr(isBroken)) & "}"

                    ' Candidate scoring:
                    ' Must be logged-in (sUser <> "" and sCli <> "") and not broken
                    If Not isBroken And sUser <> "" And sCli <> "" Then
                        If UCase(sUser) = UCase("LEELAM_EXT") Then
                        score = 10

                        ' Priority matching for target environment (S4A / 500)
                        If UCase(sSys) = "S4A" And sCli = "500" Then
                            score = score + 100
                        ElseIf UCase(sSys) = "S4A" Then
                            score = score + 60
                        ElseIf InStr(LCase(cDesc), "relaxo") > 0 Then
                            score = score + 40
                        End If

                        If Not sBusy Then
                            score = score + 20
                        End If

                        If score > bestScore Then
                            bestScore = score
                            Set bestConn = cConn
                            Set bestSess = cSess
                        End If
                        End If
                    ElseIf Not isBroken And (sUser = "" Or sCli = "") Then
                        hasUnauthenticatedSession = True
                    End If
                End If
            Next
        End If
    Next

    If Not bestSess Is Nothing Then
        Set targetConn = bestConn
        Set targetSession = bestSess
    End If
End If

Set conn = targetConn
Set session = targetSession
' --- End Dynamic Session Discovery ---


If session Is Nothing Then
    WScript.Echo "{""success"":false,""verified"":false,""code"":""NO_SESSION"",""message"":""No active SAP GUI session found. Please log into your SAP system client.""}"
    WScript.Quit 0
End If

' Ensure main window is active
session.findById("wnd[0]").maximize

' 1. Navigate to CS01
session.findById("${CS01_FIELD_IDS.OK_CODE}").text = "/nCS01"
session.findById("wnd[0]").sendVKey 0
WScript.Sleep 500

' Check modal popups upon navigation
Do While session.Children.Count > 1
    Dim modalText, safeModalText
    modalText = GetWindowText(session.findById("wnd[1]"))
    safeModalText = JsonEscape(modalText)
    If IsHardError(modalText) Then
        WScript.Echo "{""success"":false,""verified"":false,""code"":""SAP_MODAL_ERROR"",""message"":""SAP Dialog Error: " & safeModalText & """}"
        session.findById("wnd[1]").sendVKey 12
        WScript.Quit 0
    Else
        session.findById("wnd[1]").sendVKey 0
        WScript.Sleep 300
    End If
Loop

' 2. Fill TARGET BOM Header
session.findById("${CS01_FIELD_IDS.MATERIAL}").text = "A1BH0214C"
session.findById("${CS01_FIELD_IDS.PLANT}").text = "1012"
session.findById("${CS01_FIELD_IDS.BOM_USAGE}").text = "1"
${targetAltBom ? `session.findById("${CS01_FIELD_IDS.ALT_BOM}").text = ""` : ''}
${targetValidFrom ? `session.findById("${CS01_FIELD_IDS.VALID_FROM}").text = "28.09.2026"` : ''}

Dim createdAltBom
createdAltBom = ""

' 3. Click "Copy From ... (F7)" on Initial Screen
session.findById("${CS01_FIELD_IDS.COPY_BUTTON}").press
WScript.Sleep 500

' Check status bar immediately for errors or warnings (e.g. "Alternative 2 added to BOM", or material not maintained)
Dim initSbarType, initSbarText, safeInitSbar
initSbarType = session.findById("${CS01_FIELD_IDS.STATUS_BAR}").messageType
initSbarText = session.findById("${CS01_FIELD_IDS.STATUS_BAR}").text
safeInitSbar = JsonEscape(initSbarText)

If initSbarType = "E" Or initSbarType = "A" Then
    WScript.Echo "{""success"":false,""verified"":false,""code"":""INITIAL_SCREEN_ERROR"",""message"":""Initial Screen Error: " & safeInitSbar & """}"
    session.findById("wnd[0]/tbar[0]/okcd").text = "/n"
    session.findById("wnd[0]").sendVKey 0
    WScript.Quit 0
End If

' If status bar has warning (e.g. "Alternative 2 added to BOM"), extract alternative number and dismiss warning with Enter
If initSbarType = "W" Then
    If createdAltBom = "" And InStr(LCase(initSbarText), "alternative") > 0 Then
        Dim regExInit, matchesInit
        Set regExInit = CreateObject("VBScript.RegExp")
        regExInit.Pattern = "alternative\\s*0?(\\d+)"
        regExInit.IgnoreCase = True
        Set matchesInit = regExInit.Execute(initSbarText)
        If matchesInit.Count > 0 Then
            createdAltBom = matchesInit(0).SubMatches(0)
        End If
    End If
    session.findById("wnd[0]").sendVKey 0
    WScript.Sleep 500
    
    ' If Copy dialog (wnd[1]) is not yet open after dismissing warning, press Copy From again
    If session.Children.Count <= 1 Then
        session.findById("${CS01_FIELD_IDS.COPY_BUTTON}").press
        WScript.Sleep 500
    End If
End If

' 4. Verify Copy From Popup (wnd[1]) appeared
If session.Children.Count <= 1 Then
    Dim copyBtnErr
    copyBtnErr = session.findById("${CS01_FIELD_IDS.STATUS_BAR}").text
    If copyBtnErr = "" Then copyBtnErr = "Copy From dialog (wnd[1]) did not appear after clicking Copy From."
    WScript.Echo "{""success"":false,""verified"":false,""code"":""COPY_DIALOG_NOT_FOUND"",""message"":""Copy From Error: " & JsonEscape(copyBtnErr) & """}"
    session.findById("wnd[0]/tbar[0]/okcd").text = "/n"
    session.findById("wnd[0]").sendVKey 0
    WScript.Quit 0
End If

' Record captured Copy From popup info
Dim copyPopupTitle, capturedRefMatId, capturedRefPlantId, capturedRefUsageId, capturedRefAltId
copyPopupTitle = session.findById("wnd[1]").text
capturedRefMatId = "${CS01_FIELD_IDS.COPY_REF_MATERIAL}"
capturedRefPlantId = "${CS01_FIELD_IDS.COPY_REF_PLANT}"
capturedRefUsageId = "${CS01_FIELD_IDS.COPY_REF_BOM_USAGE}"
capturedRefAltId = "${CS01_FIELD_IDS.COPY_REF_ALT_BOM}"

' 5. Fill Reference/Source BOM in Copy From popup
Dim wnd1
Set wnd1 = session.findById("wnd[1]")
wnd1.findById("usr/ctxtRC29N-MATNR").text = "A1BH0214C"
wnd1.findById("usr/ctxtRC29N-WERKS").text = "1001"
wnd1.findById("usr/ctxtRC29N-STLAN").text = "1"
${sourceAltBom ? `wnd1.findById("usr/txtRC29N-STLAL").text = ""` : ''}

' Confirm Copy From Dialog (Green check tick: btn[0] / Enter)
wnd1.findById("tbar[0]/btn[0]").press
WScript.Sleep 600

' Dismiss any modal dialogs (check if error)
Dim popupLoopCount, copyPopupText, safeCopyPopupText
popupLoopCount = 0
Do While session.Children.Count > 1 And popupLoopCount < 5
    popupLoopCount = popupLoopCount + 1
    copyPopupText = GetWindowText(session.findById("wnd[1]"))
    safeCopyPopupText = JsonEscape(copyPopupText)
    If IsHardError(copyPopupText) Then
        WScript.Echo "{""success"":false,""verified"":false,""code"":""COPY_REFERENCE_ERROR"",""message"":""Source BOM Error: " & safeCopyPopupText & """}"
        session.findById("wnd[1]").sendVKey 12
        session.findById("wnd[0]/tbar[0]/okcd").text = "/n"
        session.findById("wnd[0]").sendVKey 0
        WScript.Quit 0
    Else
        session.findById("wnd[1]").sendVKey 0
        WScript.Sleep 300
    End If
Loop

' 6. Handle intermediate screens:
' If Screen 187 appears (Source has multiple alternatives: Alternative Overview):
If session.Info.ScreenNumber = "0187" Or session.Info.ScreenNumber = "187" Then
    Dim copyAltTbl, copyAltRow, foundAltRow, matchAlt, rAlt
    Set copyAltTbl = session.findById("wnd[0]/usr/tblSAPLCSDITCALT")
    foundAltRow = -1
    matchAlt = ""
    If matchAlt = "" Then matchAlt = "1"
    
    If Not copyAltTbl Is Nothing Then
        For copyAltRow = 0 To copyAltTbl.RowCount - 1
            rAlt = ""
            On Error Resume Next
            rAlt = Trim(copyAltTbl.GetCell(copyAltRow, 0).Text)
            On Error Goto 0
            If rAlt = matchAlt Then
                foundAltRow = copyAltRow
                Exit For
            End If
        Next
        ' If sourceAltBom was not explicitly specified and "1" was not found, pick the first available alternative
        If foundAltRow < 0 And "" = "" Then
            For copyAltRow = 0 To copyAltTbl.RowCount - 1
                rAlt = ""
                On Error Resume Next
                rAlt = Trim(copyAltTbl.GetCell(copyAltRow, 0).Text)
                On Error Goto 0
                If rAlt <> "" Then
                    foundAltRow = copyAltRow
                    Exit For
                End If
            Next
        End If
    End If
    
    If foundAltRow >= 0 Then
        copyAltTbl.getAbsoluteRow(foundAltRow).selected = True
        session.findById("wnd[0]/tbar[1]/btn[7]").press
        WScript.Sleep 500
    Else
        ' No matching alternative found in Screen 187!
        session.findById("wnd[0]/tbar[0]/btn[12]").press
        session.findById("wnd[0]/tbar[0]/okcd").text = "/n"
        session.findById("wnd[0]").sendVKey 0
        WScript.Echo "{""success"":false,""verified"":false,""code"":""SOURCE_BOM_NOT_FOUND"",""message"":""Cannot copy BOM: Alternative " & matchAlt & " does not exist for material A1BH0214C in plant 1001."",""sourceMaterial"":""A1BH0214C"",""sourcePlant"":""1001""}"
        WScript.Quit 0
    End If
End If

' If Screen 157 appears (Item Selection: Copy From):
If session.Info.ScreenNumber = "0157" Or session.Info.ScreenNumber = "157" Or InStr(LCase(session.findById("wnd[0]").Text), "copy from") > 0 Then
    ' Press Select All (btn[27] / Ctrl+F3)
    session.findById("wnd[0]/tbar[1]/btn[27]").press
    WScript.Sleep 400
    ' Press Copy (btn[5] / F5)
    session.findById("wnd[0]/tbar[1]/btn[5]").press
    WScript.Sleep 600
End If

' Check status bar after copy operation
' Handle known SAP component validation sequence (e.g. Storage location not supported in target plant)
Dim validationEnterCount, maxValidationEnters, curValMsg
validationEnterCount = 0
maxValidationEnters = 20

Do While validationEnterCount < maxValidationEnters
    curValMsg = CheckStorageLocValidation(session)
    If curValMsg <> "" Then
        validationEnterCount = validationEnterCount + 1
        If session.Children.Count > 1 Then
            session.findById("wnd[1]").sendVKey 0
        Else
            session.findById("wnd[0]").sendVKey 0
        End If
        WScript.Sleep 500
    Else
        Exit Do
    End If
Loop

' After Enter sequence: re-check if validation safety limit was reached
curValMsg = CheckStorageLocValidation(session)
If curValMsg <> "" And validationEnterCount >= maxValidationEnters Then
    WScript.Echo "{""success"":false,""verified"":false,""code"":""VALIDATION_LIMIT_EXCEEDED"",""message"":""Safety limit reached: SAP validation still active after " & maxValidationEnters & " Enters. Last message: " & JsonEscape(curValMsg) & """}"
    session.findById("wnd[0]/tbar[0]/okcd").text = "/n"
    session.findById("wnd[0]").sendVKey 0
    WScript.Quit 0
End If

' Dismiss any modal dialogs (check if error)
Dim postCopyPopLoop, postCopyPopText
postCopyPopLoop = 0
Do While session.Children.Count > 1 And postCopyPopLoop < 5
    postCopyPopLoop = postCopyPopLoop + 1
    postCopyPopText = GetWindowText(session.findById("wnd[1]"))
    If IsHardError(postCopyPopText) Then
        WScript.Echo "{""success"":false,""verified"":false,""code"":""COPY_FAILED"",""message"":""Copy Error: " & JsonEscape(postCopyPopText) & """}"
        session.findById("wnd[1]").sendVKey 12
        session.findById("wnd[0]/tbar[0]/okcd").text = "/n"
        session.findById("wnd[0]").sendVKey 0
        WScript.Quit 0
    Else
        session.findById("wnd[1]").sendVKey 0
        WScript.Sleep 300
    End If
Loop

' Check status bar after copy operation for hard error (E or A)
Dim postCopySbarType, postCopySbarText
postCopySbarType = session.findById("${CS01_FIELD_IDS.STATUS_BAR}").messageType
postCopySbarText = session.findById("${CS01_FIELD_IDS.STATUS_BAR}").text

If postCopySbarType = "E" Or postCopySbarType = "A" Then
    WScript.Echo "{""success"":false,""verified"":false,""code"":""COPY_FAILED"",""message"":""Copy Error: " & JsonEscape(postCopySbarText) & """}"
    session.findById("wnd[0]/tbar[0]/okcd").text = "/n"
    session.findById("wnd[0]").sendVKey 0
    WScript.Quit 0
End If

' 7. VERIFY COPIED COMPONENTS IN TARGET BOM TABLE (Screen 2150 / 0152)
Dim verifiedComp, verifiedQty, verifiedItemCat, copiedComponentsJson, rowIdx, compCount
verifiedComp = ""
verifiedQty = ""
verifiedItemCat = ""
copiedComponentsJson = "["
compCount = 0

For rowIdx = 0 To 19
    Dim rComp, rQty, rCat, rPos
    rComp = ""
    rQty = ""
    rCat = ""
    rPos = ""
    On Error Resume Next
    rPos = Trim(session.findById("${CS01_FIELD_IDS.TABLE_BASE}/txtRC29P-POSNR[0," & rowIdx & "]").text)
    rComp = Trim(session.findById("${CS01_FIELD_IDS.TABLE_BASE}/${CS01_FIELD_IDS.COMPONENT_FIELD}[2," & rowIdx & "]").text)
    If rComp = "" Then
        rComp = Trim(session.findById("${CS01_FIELD_IDS.TABLE_BASE}/txtRC29P-IDNRK[2," & rowIdx & "]").text)
    End If
    rQty = Trim(session.findById("${CS01_FIELD_IDS.TABLE_BASE}/${CS01_FIELD_IDS.QUANTITY_FIELD}[4," & rowIdx & "]").text)
    rCat = Trim(session.findById("${CS01_FIELD_IDS.TABLE_BASE}/${CS01_FIELD_IDS.ITEM_CATEGORY_FIELD}[1," & rowIdx & "]").text)
    On Error Goto 0

    If rComp <> "" And Left(rComp, 1) <> "_" Then
        If verifiedComp = "" Then
            verifiedComp = rComp
            verifiedQty = rQty
            verifiedItemCat = rCat
        End If
        If compCount > 0 Then copiedComponentsJson = copiedComponentsJson & ","
        compCount = compCount + 1
        copiedComponentsJson = copiedComponentsJson & "{""pos"":""" & JsonEscape(rPos) & """,""component"":""" & JsonEscape(rComp) & """,""quantity"":""" & JsonEscape(rQty) & """,""itemCategory"":""" & JsonEscape(rCat) & """}"
    End If
Next
copiedComponentsJson = copiedComponentsJson & "]"

' STRICT VERIFICATION CHECK: Do NOT assume copy succeeded if table is empty!
If verifiedComp = "" Then
    Dim emptyCopyErr
    emptyCopyErr = session.findById("${CS01_FIELD_IDS.STATUS_BAR}").text
    If emptyCopyErr = "" Then emptyCopyErr = "Copy From executed, but NO components appeared in the target BOM table."
    WScript.Echo "{""success"":false,""verified"":false,""code"":""COPY_FAILED_EMPTY_COMPONENTS"",""message"":""Verification failed: " & JsonEscape(emptyCopyErr) & """}"
    session.findById("wnd[0]/tbar[0]/okcd").text = "/n"
    session.findById("wnd[0]").sendVKey 0
    WScript.Quit 0
End If

' 8. SAVE TARGET BOM (Ctrl+S / btn[11])
' If status bar has warning/info (e.g. BADI deviation quantity), clear with Enter before Save
If session.findById("${CS01_FIELD_IDS.STATUS_BAR}").messageType = "W" Then
    session.findById("wnd[0]").sendVKey 0
    WScript.Sleep 300
End If

session.findById("${CS01_FIELD_IDS.SAVE_BUTTON}").press
WScript.Sleep 600

' Dismiss save popups / warnings
popupLoopCount = 0
Do While session.Children.Count > 1 And popupLoopCount < 5
    popupLoopCount = popupLoopCount + 1
    Dim savePopupText
    savePopupText = GetWindowText(session.findById("wnd[1]"))
    If IsHardError(savePopupText) Then
        WScript.Echo "{""success"":false,""verified"":false,""code"":""BOM_SAVE_FAILED"",""message"":""Save Error: " & JsonEscape(savePopupText) & """}"
        session.findById("wnd[1]").sendVKey 12
        session.findById("wnd[0]/tbar[0]/okcd").text = "/n"
        session.findById("wnd[0]").sendVKey 0
        WScript.Quit 0
    Else
        session.findById("wnd[1]").sendVKey 0
        WScript.Sleep 300
    End If
Loop

' 9. Read Status Bar after Save
Dim sbarText, sbarType, safeSaveSbar
sbarText = session.findById("${CS01_FIELD_IDS.STATUS_BAR}").text
sbarType = session.findById("${CS01_FIELD_IDS.STATUS_BAR}").messageType

' If warning/info on main screen after save, confirm with Enter
If sbarType = "W" Or sbarType = "I" Then
    session.findById("wnd[0]").sendVKey 0
    WScript.Sleep 500
    sbarText = session.findById("${CS01_FIELD_IDS.STATUS_BAR}").text
    sbarType = session.findById("${CS01_FIELD_IDS.STATUS_BAR}").messageType
End If

safeSaveSbar = JsonEscape(sbarText)

If sbarType = "E" Or sbarType = "A" Then
    WScript.Echo "{""success"":false,""verified"":false,""code"":""BOM_SAVE_FAILED"",""message"":""Save Error: " & safeSaveSbar & """}"
    session.findById("wnd[0]/tbar[0]/okcd").text = "/n"
    session.findById("wnd[0]").sendVKey 0
    WScript.Quit 0
End If

Dim safeSaveMsg
safeSaveMsg = safeSaveSbar
If safeSaveMsg = "" Then safeSaveMsg = "BOM created by copying from reference BOM."

' Check alternative BOM in status bar if not yet extracted
If createdAltBom = "" And InStr(LCase(sbarText), "alternative") > 0 Then
    On Error Resume Next
    Dim regExSave, matchesSave
    Set regExSave = CreateObject("VBScript.RegExp")
    regExSave.Pattern = "alternative\\s*0?(\\d+)"
    regExSave.IgnoreCase = True
    Set matchesSave = regExSave.Execute(sbarText)
    If matchesSave.Count > 0 Then createdAltBom = matchesSave(0).SubMatches(0)
    On Error Goto 0
End If

' 10. POST-SAVE CS03 VERIFICATION
session.findById("wnd[0]/tbar[0]/okcd").text = "/nCS03"
session.findById("wnd[0]").sendVKey 0
WScript.Sleep 500

session.findById("${CS01_FIELD_IDS.MATERIAL}").text = "A1BH0214C"
session.findById("${CS01_FIELD_IDS.PLANT}").text = "1012"
session.findById("${CS01_FIELD_IDS.BOM_USAGE}").text = "1"
If createdAltBom <> "" Then
    session.findById("${CS01_FIELD_IDS.ALT_BOM}").text = createdAltBom
End If

session.findById("wnd[0]").sendVKey 0
WScript.Sleep 500

popupLoopCount = 0
Do While session.Children.Count > 1 And popupLoopCount < 5
    popupLoopCount = popupLoopCount + 1
    session.findById("wnd[1]").sendVKey 0
    WScript.Sleep 300
Loop

' Clear any status bar warning on CS03 initial screen
If session.findById("${CS01_FIELD_IDS.STATUS_BAR}").messageType = "W" Or session.findById("${CS01_FIELD_IDS.STATUS_BAR}").messageType = "I" Then
    session.findById("wnd[0]").sendVKey 0
    WScript.Sleep 500
End If

' If CS03 shows Alternative Overview (Screen 187/120) because multiple alternatives exist:
If session.Info.ScreenNumber = "0187" Or session.Info.ScreenNumber = "187" Then
    On Error Resume Next
    Dim cs03AltTbl, arIdx, targetRowIdx, curAltVal
    Set cs03AltTbl = session.findById("wnd[0]/usr/tblSAPLCSDITCALT")
    targetRowIdx = 0
    If Not cs03AltTbl Is Nothing Then
        For arIdx = 0 To cs03AltTbl.VisibleRowCount - 1
            curAltVal = Trim(session.findById("wnd[0]/usr/tblSAPLCSDITCALT/txtRC29K-STLAL[0," & arIdx & "]").text)
            If curAltVal <> "" Then
                targetRowIdx = arIdx
                If createdAltBom <> "" And curAltVal = createdAltBom Then
                    Exit For
                End If
            End If
        Next
        session.findById("wnd[0]/usr/tblSAPLCSDITCALT/txtRC29K-STLAL[0," & targetRowIdx & "]").setFocus
        session.findById("wnd[0]").sendVKey 2
    End If
    On Error Goto 0
    WScript.Sleep 500
End If

' Read row 0 of component table in CS03
Dim cs03Comp, cs03Qty, cs03Cat
cs03Comp = ""
cs03Qty = ""
cs03Cat = ""

On Error Resume Next
cs03Comp = Trim(session.findById("${CS01_FIELD_IDS.TABLE_BASE}/${CS01_FIELD_IDS.COMPONENT_FIELD}[2,0]").text)
If Err.Number <> 0 Or cs03Comp = "" Then
    Err.Clear
    cs03Comp = Trim(session.findById("${CS01_FIELD_IDS.TABLE_BASE}/txtRC29P-IDNRK[2,0]").text)
End If
cs03Qty = Trim(session.findById("${CS01_FIELD_IDS.TABLE_BASE}/${CS01_FIELD_IDS.QUANTITY_FIELD}[4,0]").text)
cs03Cat = Trim(session.findById("${CS01_FIELD_IDS.TABLE_BASE}/${CS01_FIELD_IDS.ITEM_CATEGORY_FIELD}[1,0]").text)
On Error Goto 0

' Always navigate back to /n
session.findById("wnd[0]/tbar[0]/okcd").text = "/n"
session.findById("wnd[0]").sendVKey 0

Dim safeCs03Comp, safeCs03Qty, safeCs03Cat
safeCs03Comp = JsonEscape(cs03Comp)
safeCs03Qty = JsonEscape(cs03Qty)
safeCs03Cat = JsonEscape(cs03Cat)

If cs03Comp = "" Or Left(cs03Comp, 1) = "_" Then
    WScript.Echo "{""success"":false,""verified"":false,""code"":""VERIFICATION_FAILED_EMPTY_COMPONENTS"",""message"":""Verification failed in CS03: Target BOM was saved (" & safeSaveMsg & "), but the component table is EMPTY in CS03."",""targetMaterial"":""A1BH0214C"",""targetPlant"":""1012""}"
    WScript.Quit 0
End If

Dim valEntersMsg
If validationEnterCount > 0 Then
    valEntersMsg = " (Acknowledged " & validationEnterCount & " storage location validation messages)"
Else
    valEntersMsg = ""
End If

' SUCCESS
WScript.Echo "{""success"":true,""verified"":true,""message"":""" & safeSaveMsg & valEntersMsg & " [Verified in CS03: Component " & safeCs03Comp & " (Qty " & safeCs03Qty & ", Category " & safeCs03Cat & ") confirmed saved]"",""verifiedComponent"":""" & safeCs03Comp & """,""verifiedQty"":""" & safeCs03Qty & """,""verifiedItemCategory"":""" & safeCs03Cat & """,""alternativeBom"":""" & createdAltBom & """,""targetMaterial"":""A1BH0214C"",""targetPlant"":""1012"",""sourceMaterial"":""A1BH0214C"",""sourcePlant"":""1001"",""validationEntersCount"":" & validationEnterCount & ",""copiedComponents"":" & copiedComponentsJson & ",""capturedControls"":{""copyButton"":""${CS01_FIELD_IDS.COPY_BUTTON}"",""popupTitle"":""" & JsonEscape(copyPopupTitle) & """,""refMaterialField"":""" & JsonEscape(capturedRefMatId) & """,""refPlantField"":""" & JsonEscape(capturedRefPlantId) & """,""refUsageField"":""" & JsonEscape(capturedRefUsageId) & """,""refAltBomField"":""" & JsonEscape(capturedRefAltId) & """,""popupConfirmButton"":""${CS01_FIELD_IDS.COPY_POPUP_CONFIRM}""}}"
