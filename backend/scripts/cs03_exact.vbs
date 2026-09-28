
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
        ' Primary method: Standard Windows OLE ROT lookup
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

        ' Secondary method: Official SAP ROT Wrapper (SapROTWr.SapROTWrapper)
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

Dim rawErrInfo, SapGuiAuto, app, conn, session
Set SapGuiAuto = GetSapGuiObject(rawErrInfo)
If SapGuiAuto Is Nothing Then
    Dim safeRawErr
    safeRawErr = JsonEscape(rawErrInfo)
    WScript.Echo "{""success"":false,""exists"":false,""code"":""SESSION_NOT_FOUND"",""message"":""No running SAP GUI instance found. Please open SAP GUI, log into your SAP system, and try again."",""rawError"":""" & safeRawErr & """}"
    WScript.Quit 0
End If

Set app = SapGuiAuto.GetScriptingEngine
If Err.Number <> 0 Or app Is Nothing Then
    WScript.Echo "{""success"":false,""exists"":false,""code"":""SCRIPTING_DISABLED"",""message"":""SAP GUI Scripting is disabled.""}"
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
    WScript.Echo "{""success"":false,""exists"":false,""code"":""NO_SESSION"",""message"":""No active SAP GUI session found.""}"
    WScript.Quit 0
End If

session.findById("wnd[0]").maximize
session.findById("wnd[0]/tbar[0]/okcd").text = "/nCS03"
session.findById("wnd[0]").sendVKey 0
WScript.Sleep 500

Dim popLoop1
popLoop1 = 0
Do While session.Children.Count > 1 And popLoop1 < 3
    popLoop1 = popLoop1 + 1
    session.findById("wnd[1]").sendVKey 0
    WScript.Sleep 300
Loop

session.findById("wnd[0]/usr/ctxtRC29N-MATNR").text = "A1BH0214C"
session.findById("wnd[0]/usr/ctxtRC29N-WERKS").text = "1001"
session.findById("wnd[0]/usr/ctxtRC29N-STLAN").text = "1"
${alternativeBom ? `session.findById("wnd[0]/usr/txtRC29N-STLAL").text = ""` : ''}

session.findById("wnd[0]").sendVKey 0
WScript.Sleep 500

Dim popLoop2
popLoop2 = 0
Do While session.Children.Count > 1 And popLoop2 < 3
    popLoop2 = popLoop2 + 1
    session.findById("wnd[1]").sendVKey 0
    WScript.Sleep 300
Loop

Dim cs03SbarType, cs03SbarText, safeCs03Sbar
cs03SbarType = session.findById("wnd[0]/sbar").messageType
cs03SbarText = session.findById("wnd[0]/sbar").text
safeCs03Sbar = JsonEscape(cs03SbarText)

If cs03SbarType = "E" Or cs03SbarType = "A" Then
    session.findById("wnd[0]/tbar[0]/okcd").text = "/n"
    session.findById("wnd[0]").sendVKey 0
    WScript.Echo "{""success"":true,""exists"":false,""hasComponents"":false,""componentCount"":0,""message"":""" & safeCs03Sbar & """}"
    WScript.Quit 0
End If

If cs03SbarType = "W" Or cs03SbarType = "I" Then
    session.findById("wnd[0]").sendVKey 0
    WScript.Sleep 500
End If

' Check if we are on Screen 187 (Alternative Overview)
Dim tbl187, rIdx, aVal, selectedRow, targetAlt
Set tbl187 = Nothing
On Error Resume Next
Set tbl187 = session.findById("wnd[0]/usr/tblSAPLCSDITCALT")
On Error Goto 0

Dim availableAlts, foundRequestedAlt
availableAlts = ""
foundRequestedAlt = False
selectedRow = -1
targetAlt = "${escapeVbsString(alternativeBom)}"

If Not tbl187 Is Nothing Then
    Dim maxR
    maxR = tbl187.RowCount - 1
    If maxR > 25 Then maxR = 25
    For rIdx = 0 To maxR
        aVal = ""
        On Error Resume Next
        aVal = Trim(tbl187.GetCell(rIdx, 0).Text)
        On Error Goto 0
        If aVal <> "" Then
            If availableAlts <> "" Then availableAlts = availableAlts & ","
            availableAlts = availableAlts & """" & JsonEscape(aVal) & """"
            If targetAlt <> "" And aVal = targetAlt Then
                selectedRow = rIdx
                foundRequestedAlt = True
            End If
        End If
    Next
    
    If targetAlt <> "" And Not foundRequestedAlt Then
        ' Requested alternative does not exist in available alternatives
        session.findById("wnd[0]/tbar[0]/okcd").text = "/n"
        session.findById("wnd[0]").sendVKey 0
        WScript.Echo "{""success"":true,""exists"":false,""hasComponents"":false,""componentCount"":0,""availableAlternatives"":[" & availableAlts & "],""message"":""Alternative " & JsonEscape(targetAlt) & " does not exist for BOM ${escapeVbsString(material)} in plant ${escapeVbsString(plant)}.""}"
        WScript.Quit 0
    End If
    
    ' Select target row (or row 0 if none specified) and press F2 / sendVKey 2 to enter Item Overview
    If selectedRow < 0 Then selectedRow = 0
    tbl187.getAbsoluteRow(selectedRow).selected = True
    session.findById("wnd[0]").sendVKey 2
    WScript.Sleep 600
End If

Dim tblCs03
Set tblCs03 = Nothing
On Error Resume Next
Set tblCs03 = session.findById("wnd[0]/usr/tblSAPLCSDITCMAT")
If tblCs03 Is Nothing Then
    Set tblCs03 = session.findById("wnd[0]/usr/tblSAPLCSDITCMAT")
End If
On Error Goto 0

Dim compsJson, seenKeys, totalComps, firstComp, firstQty, firstCat
compsJson = ""
seenKeys = ";"
totalComps = 0
firstComp = ""
firstQty = ""
firstCat = ""

If Not tblCs03 Is Nothing Then
    Dim vScrollMax, vPageSize, sPos, iRow
    vScrollMax = tblCs03.VerticalScrollbar.Maximum
    vPageSize = tblCs03.VisibleRowCount
    If vPageSize <= 0 Then vPageSize = 16
    
    For sPos = 0 To vScrollMax Step vPageSize
        tblCs03.VerticalScrollbar.Position = sPos
        WScript.Sleep 100
        
        For iRow = 0 To vPageSize - 1
            Dim posnr, idnrk, ktext, menge, meins, postp, stlkz, itemKey
            posnr = "" : idnrk = "" : ktext = "" : menge = "" : meins = "" : postp = "" : stlkz = False
            
            On Error Resume Next
            posnr = Trim(session.findById("wnd[0]/usr/tblSAPLCSDITCMAT/txtRC29P-POSNR[0," & iRow & "]").text)
            idnrk = Trim(session.findById("wnd[0]/usr/tblSAPLCSDITCMAT/ctxtRC29P-IDNRK[2," & iRow & "]").text)
            If idnrk = "" Then
                idnrk = Trim(session.findById("wnd[0]/usr/tblSAPLCSDITCMAT/txtRC29P-IDNRK[2," & iRow & "]").text)
            End If
            ktext = Trim(session.findById("wnd[0]/usr/tblSAPLCSDITCMAT/txtRC29P-KTEXT[3," & iRow & "]").text)
            menge = Trim(session.findById("wnd[0]/usr/tblSAPLCSDITCMAT/txtRC29P-MENGE[4," & iRow & "]").text)
            meins = Trim(session.findById("wnd[0]/usr/tblSAPLCSDITCMAT/ctxtRC29P-MEINS[5," & iRow & "]").text)
            postp = Trim(session.findById("wnd[0]/usr/tblSAPLCSDITCMAT/ctxtRC29P-POSTP[1," & iRow & "]").text)
            stlkz = session.findById("wnd[0]/usr/tblSAPLCSDITCMAT/chkRC29P-STLKZ[7," & iRow & "]").selected
            On Error Goto 0
            
            If idnrk <> "" And Left(idnrk, 1) <> "_" Then
                itemKey = posnr & "_" & idnrk
                If InStr(seenKeys, ";" & itemKey & ";") = 0 Then
                    seenKeys = seenKeys & itemKey & ";"
                    totalComps = totalComps + 1
                    If firstComp = "" Then
                        firstComp = idnrk
                        firstQty = menge
                        firstCat = postp
                    End If
                    If compsJson <> "" Then compsJson = compsJson & ","
                    compsJson = compsJson & "{" & _
                        """item"":""" & JsonEscape(posnr) & """," & _
                        """material"":""" & JsonEscape(idnrk) & """," & _
                        """description"":""" & JsonEscape(ktext) & """," & _
                        """quantity"":""" & JsonEscape(menge) & """," & _
                        """unit"":""" & JsonEscape(meins) & """," & _
                        """itemCategory"":""" & JsonEscape(postp) & """," & _
                        """assembly"":" & LCase(CStr(stlkz)) & "}"
                End If
            End If
        Next
    Next
End If

session.findById("wnd[0]/tbar[0]/okcd").text = "/n"
session.findById("wnd[0]").sendVKey 0

Dim safeFirstComp, safeFirstQty, safeFirstCat
safeFirstComp = JsonEscape(firstComp)
safeFirstQty = JsonEscape(firstQty)
safeFirstCat = JsonEscape(firstCat)

Dim altsPart
If availableAlts <> "" Then
    altsPart = """availableAlternatives"":[" & availableAlts & "],"
ElseIf targetAlt <> "" Then
    altsPart = """availableAlternatives"":[""" & JsonEscape(targetAlt) & """],"
Else
    altsPart = ""
End If

If totalComps = 0 Then
    WScript.Echo "{""success"":true,""exists"":true,""hasComponents"":false,""componentCount"":0," & altsPart & """components"":[],""message"":""BOM exists in CS03, but component table is EMPTY.""}"
Else
    WScript.Echo "{""success"":true,""exists"":true,""hasComponents"":true,""componentCount"":" & totalComps & "," & altsPart & """components"":[" & compsJson & "],""firstComponent"":""" & safeFirstComp & """,""firstQty"":""" & safeFirstQty & """,""firstItemCat"":""" & safeFirstCat & """,""message"":""BOM exists with " & totalComps & " components (first: " & safeFirstComp & ").""}"
End If
