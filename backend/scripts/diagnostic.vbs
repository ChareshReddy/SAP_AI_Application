' ==============================================================================
' MINIMAL SAP GUI SCRIPTING COM DIAGNOSTIC (VBScript)
' ==============================================================================
Option Explicit

Dim sapAuto, rotWrapper, app, conn, sess, i, j
Dim getObjectErrNum, getObjectErrDesc
Dim rotWrapperErrNum, rotWrapperErrDesc
Dim rotEntryErrNum, rotEntryErrDesc
Dim engineErrNum, engineErrDesc

Set sapAuto = Nothing
Set rotWrapper = Nothing

WScript.Echo "=== 1. Windows OLE GetObject(""SAPGUI"") ==="
On Error Resume Next
Err.Clear
Set sapAuto = GetObject("SAPGUI")
getObjectErrNum = Err.Number
getObjectErrDesc = Err.Description
On Error Goto 0

If getObjectErrNum <> 0 Then
    WScript.Echo "GetObject(""SAPGUI"") FAILED:"
    WScript.Echo "  Error Number (Dec): " & getObjectErrNum
    WScript.Echo "  Error Number (Hex): 0x" & Hex(getObjectErrNum)
    WScript.Echo "  Error Description : " & getObjectErrDesc
ElseIf sapAuto Is Nothing Then
    WScript.Echo "GetObject(""SAPGUI"") returned Nothing without error."
Else
    WScript.Echo "GetObject(""SAPGUI"") SUCCEEDED!"
    WScript.Echo "  Type: " & TypeName(sapAuto)
End If

WScript.Echo ""
WScript.Echo "=== 2. SapROTWr.SapROTWrapper ==="
On Error Resume Next
Err.Clear
Set rotWrapper = CreateObject("SapROTWr.SapROTWrapper")
rotWrapperErrNum = Err.Number
rotWrapperErrDesc = Err.Description
On Error Goto 0

If rotWrapperErrNum <> 0 Then
    WScript.Echo "CreateObject(""SapROTWr.SapROTWrapper"") FAILED:"
    WScript.Echo "  Error Number (Dec): " & rotWrapperErrNum
    WScript.Echo "  Error Number (Hex): 0x" & Hex(rotWrapperErrNum)
    WScript.Echo "  Error Description : " & rotWrapperErrDesc
Else
    WScript.Echo "CreateObject(""SapROTWr.SapROTWrapper"") SUCCEEDED."
    On Error Resume Next
    Err.Clear
    Dim rotObj
    Set rotObj = rotWrapper.GetROTEntry("SAPGUI")
    rotEntryErrNum = Err.Number
    rotEntryErrDesc = Err.Description
    On Error Goto 0

    If rotEntryErrNum <> 0 Then
        WScript.Echo "  GetROTEntry(""SAPGUI"") FAILED:"
        WScript.Echo "    Error Number (Dec): " & rotEntryErrNum
        WScript.Echo "    Error Number (Hex): 0x" & Hex(rotEntryErrNum)
        WScript.Echo "    Error Description : " & rotEntryErrDesc
    ElseIf rotObj Is Nothing Then
        WScript.Echo "  GetROTEntry(""SAPGUI"") returned Nothing (no entry in ROT)."
    Else
        WScript.Echo "  GetROTEntry(""SAPGUI"") SUCCEEDED!"
        WScript.Echo "    Type: " & TypeName(rotObj)
        If sapAuto Is Nothing Then
            Set sapAuto = rotObj
        End If
    End If
End If

WScript.Echo ""
WScript.Echo "=== 3. SAP GUI Scripting Engine Inspection ==="
If sapAuto Is Nothing Then
    WScript.Echo "ABORTED: No SapGuiAuto COM instance available."
    WScript.Quit 1
End If

On Error Resume Next
Err.Clear
Set app = sapAuto.GetScriptingEngine
engineErrNum = Err.Number
engineErrDesc = Err.Description
On Error Goto 0

If engineErrNum <> 0 Or app Is Nothing Then
    WScript.Echo "GetScriptingEngine FAILED:"
    WScript.Echo "  Error Number (Dec): " & engineErrNum
    WScript.Echo "  Error Number (Hex): 0x" & Hex(engineErrNum)
    WScript.Echo "  Error Description : " & engineErrDesc
    WScript.Echo "  Note: Verify sapgui/user_scripting=TRUE in RZ11 and 'Enable Scripting' in SAP GUI Options."
    WScript.Quit 2
End If

WScript.Echo "GetScriptingEngine SUCCEEDED!"
WScript.Echo "Connections Count: " & app.Children.Count

If app.Children.Count = 0 Then
    WScript.Echo "WARNING: Connection count is 0. SAP GUI is running, but no system connection is open."
    WScript.Quit 3
End If

For i = 0 To app.Children.Count - 1
    Set conn = app.Children(CInt(i))
    WScript.Echo ""
    WScript.Echo "--- Connection [" & i & "] ---"
    WScript.Echo "  Description : " & conn.Description
    WScript.Echo "  Sessions Count: " & conn.Children.Count

    If conn.Children.Count = 0 Then
        WScript.Echo "  WARNING: Session count is 0 on this connection."
    Else
        For j = 0 To conn.Children.Count - 1
            Set sess = conn.Children(CInt(j))
            WScript.Echo "  --- Session [" & j & "] ---"
            WScript.Echo "    Session ID    : " & sess.Id
            WScript.Echo "    System Name   : " & sess.Info.SystemName
            WScript.Echo "    Client        : " & sess.Info.Client
            WScript.Echo "    User          : " & sess.Info.User
            WScript.Echo "    Transaction   : " & sess.Info.Transaction
            WScript.Echo "    Program Name  : " & sess.Info.Program
            WScript.Echo "    Screen Number : " & sess.Info.ScreenNumber
            WScript.Echo "    Is Active     : " & sess.ActiveWindow.Text
        Next
    End If
Next

WScript.Echo ""
WScript.Echo "=== DIAGNOSTIC FINISHED SUCCESSFULLY ==="
