/**
 * ============================================================================
 * SAP GUI SCRIPTING CLIENT (CS01 BOM CREATION AUTOMATION)
 * ============================================================================
 * Automates the native Windows SAP GUI client using SAP GUI Scripting API
 * (SAPGUI -> GuiApplication -> GuiConnection -> GuiSession).
 *
 * SECURITY CONSTRAINTS:
 * - NEVER automates login or credentials entry.
 * - Attaches exclusively to an ALREADY-OPEN, already-authenticated SAP GUI session.
 * - If no active logged-in session exists, halts cleanly with actionable instructions.
 * - Windows-only (SAP GUI Scripting COM architecture).
 * ============================================================================
 */

import { execFile } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * ============================================================================
 * PLACEHOLDER FIELD IDs FOR CS01 (CREATE MATERIAL BOM)
 * ============================================================================
 * IMPORTANT: These placeholder IDs represent standard SAP CS01 screen controls.
 * Per Step 3, these will be replaced with exact IDs captured from the user's
 * recorded .vbs script (SAP GUI Local Layout -> Script Recording and Playback).
 * ============================================================================
 */
export const CS01_FIELD_IDS = {
  OK_CODE: 'wnd[0]/tbar[0]/okcd',
  MATERIAL: 'wnd[0]/usr/ctxtRC29N-MATNR',
  PLANT: 'wnd[0]/usr/ctxtRC29N-WERKS',
  BOM_USAGE: 'wnd[0]/usr/ctxtRC29N-STLAN',
  ALT_BOM: 'wnd[0]/usr/txtRC29N-STLAL',
  VALID_FROM: 'wnd[0]/usr/ctxtRC29N-DATUV',
  SAVE_BUTTON: 'wnd[0]/tbar[0]/btn[11]',
  STATUS_BAR: 'wnd[0]/sbar',

  // Component table — CONFIRMED real paths (indices [col,row] increment row per component added)
  TABLE_BASE: 'wnd[0]/usr/tabsTS_ITOV/tabpTCMA/ssubSUBPAGE:SAPLCSDI:0152/tblSAPLCSDITCMAT',
  ITEM_CATEGORY_FIELD: 'ctxtRC29P-POSTP',  // e.g. TABLE_BASE + '/ctxtRC29P-POSTP[1,0]'
  COMPONENT_FIELD: 'ctxtRC29P-IDNRK',      // e.g. TABLE_BASE + '/ctxtRC29P-IDNRK[2,0]'
  QUANTITY_FIELD: 'txtRC29P-MENGE',        // e.g. TABLE_BASE + '/txtRC29P-MENGE[4,0]'

  // Copy From controls in CS01
  COPY_BUTTON: 'wnd[0]/tbar[1]/btn[7]',
  COPY_POPUP: 'wnd[1]',
  COPY_REF_MATERIAL: 'wnd[1]/usr/ctxtRC29N-MATNR',
  COPY_REF_PLANT: 'wnd[1]/usr/ctxtRC29N-WERKS',
  COPY_REF_BOM_USAGE: 'wnd[1]/usr/ctxtRC29N-STLAN',
  COPY_REF_ALT_BOM: 'wnd[1]/usr/txtRC29N-STLAL',
  COPY_POPUP_CONFIRM: 'wnd[1]/tbar[0]/btn[0]'
};

/**
 * Verified Control IDs for transaction ZBOM_COPY (Program ZPP_BOM_COPY_CREATION)
 */
export const ZBOM_COPY_FIELD_IDS = {
  OK_CODE: 'wnd[0]/tbar[0]/okcd',
  RADIO_DELETE: 'wnd[0]/usr/radP_DEL',
  RADIO_COPY: 'wnd[0]/usr/radP_CREA',
  MATERIAL: 'wnd[0]/usr/ctxtP_MATNR',
  PLANT: 'wnd[0]/usr/ctxtP_WERKS',
  ALT_BOM: 'wnd[0]/usr/txtP_STLAL',
  BOM_USAGE: 'wnd[0]/usr/ctxtP_STLAN',
  EXECUTE_BUTTON: 'wnd[0]/tbar[1]/btn[8]',
  STATUS_BAR: 'wnd[0]/sbar',
  POPUP_WINDOW: 'wnd[1]',
  POPUP_CONFIRM: 'wnd[1]/tbar[0]/btn[0]',
  POPUP_CANCEL: 'wnd[1]/tbar[0]/btn[12]'
};

/**
 * Default mock BOM dataset for simulated testing and development.
 */
export const SAMPLE_A1BH0214C_COMPONENTS = [
  { item: '0010', material: 'B1BH0214C', description: 'CUT SOLE BAHAMAS 214', quantity: '100', unit: 'PAA', itemCategory: 'L', assembly: true },
  { item: '0020', material: 'C1BH0214C', description: 'FIN. STRAP BAHAMAS 214', quantity: '100', unit: 'PAA', itemCategory: 'L', assembly: true },
  { item: '0030', material: '11021735', description: 'INK EVA SCREEN PRINTING BLUE', quantity: '0.017', unit: 'KG', itemCategory: 'L', assembly: false },
  { item: '0050', material: '11021733', description: 'INK EVA SCREEN PRINTING COLOUR RED', quantity: '0.015', unit: 'KG', itemCategory: 'L', assembly: false },
  { item: '0070', material: '11021737', description: 'INK EVA SCREEN PRINTING ORIGINAL YELLOW', quantity: '0.002', unit: 'KG', itemCategory: 'L', assembly: false },
  { item: '0080', material: '11021734', description: 'INK EVA SCREEN PRINTING MIDYELLOW', quantity: '0.002', unit: 'KG', itemCategory: 'L', assembly: false },
  { item: '0090', material: '11021732', description: 'INK EVA SCREEN PRINTING COLOUR GREEN', quantity: '0.003', unit: 'KG', itemCategory: 'L', assembly: false },
  { item: '0100', material: '11022139', description: 'INK EVA SCREEN PRINTING PEVA FLORESCENT', quantity: '0.001', unit: 'KG', itemCategory: 'L', assembly: false },
  { item: '0110', material: '11021686', description: 'SILICONE EMULSION, (20-22% OIL CONTENT)', quantity: '0.125', unit: 'KG', itemCategory: 'L', assembly: false },
  { item: '0120', material: '11022154', description: 'CLEANER 6040', quantity: '0.100', unit: 'L', itemCategory: 'L', assembly: false },
  { item: '0130', material: '12000079', description: 'EVA PRIMER', quantity: '0.220', unit: 'KG', itemCategory: 'L', assembly: false },
  { item: '0140', material: 'PPBH0001C', description: 'PKG PAIR GRP FOR BAHAMAS CHILD -1', quantity: '100', unit: 'EA', itemCategory: 'L', assembly: true },
  { item: '0150', material: '11021698', description: 'REDUCER FARBATONE TP-65', quantity: '0.090', unit: 'L', itemCategory: 'L', assembly: false },
  { item: '0160', material: 'C1HL0003C', description: 'Fin. Strap Hi Lite 03 C', quantity: '100', unit: 'PAA', itemCategory: 'L', assembly: true },
  { item: '0170', material: '11031877', description: 'INK SCREEN PRINTING WHITE - EVA-S- 666', quantity: '0.018', unit: 'KG', itemCategory: 'L', assembly: false },
  { item: '0180', material: '11031874', description: 'INK SCREEN PRINT. EVA-PLUS BLACK-501', quantity: '0.017', unit: 'KG', itemCategory: 'L', assembly: false }
];

const defaultMockBomDataset = [
  { material: 'A1BH0214C', plant: '1001', bomUsage: '1', availableAlternatives: ['1', '2', '3', '4'], componentCount: 16, components: SAMPLE_A1BH0214C_COMPONENTS },
  { material: 'B1BH0214C', plant: '1001', bomUsage: '1', availableAlternatives: ['1'], componentCount: 5, components: [
    { item: '0010', material: 'RAW_EVA_01', description: 'EVA COMPOUND', quantity: '50', unit: 'KG', itemCategory: 'L', assembly: false },
    { item: '0020', material: 'RAW_CHEM_02', description: 'BLOWING AGENT', quantity: '2', unit: 'KG', itemCategory: 'L', assembly: false },
    { item: '0030', material: 'RAW_PIG_03', description: 'BLACK PIGMENT', quantity: '1', unit: 'KG', itemCategory: 'L', assembly: false },
    { item: '0040', material: 'RAW_ZINC_04', description: 'ZINC OXIDE', quantity: '0.5', unit: 'KG', itemCategory: 'L', assembly: false },
    { item: '0050', material: 'RAW_STEAR_05', description: 'STEARIC ACID', quantity: '0.5', unit: 'KG', itemCategory: 'L', assembly: false }
  ]},
  { material: 'B1BH0214C', plant: '1012', bomUsage: '1', availableAlternatives: ['1'], componentCount: 5, components: [
    { item: '0010', material: 'RAW_EVA_01', description: 'EVA COMPOUND', quantity: '50', unit: 'KG', itemCategory: 'L', assembly: false },
    { item: '0020', material: 'RAW_CHEM_02', description: 'BLOWING AGENT', quantity: '2', unit: 'KG', itemCategory: 'L', assembly: false },
    { item: '0030', material: 'RAW_PIG_03', description: 'BLACK PIGMENT', quantity: '1', unit: 'KG', itemCategory: 'L', assembly: false },
    { item: '0040', material: 'RAW_ZINC_04', description: 'ZINC OXIDE', quantity: '0.5', unit: 'KG', itemCategory: 'L', assembly: false },
    { item: '0050', material: 'RAW_STEAR_05', description: 'STEARIC ACID', quantity: '0.5', unit: 'KG', itemCategory: 'L', assembly: false }
  ]},
  { material: 'C1BH0214C', plant: '1001', bomUsage: '1', availableAlternatives: ['1'], componentCount: 1, components: [
    { item: '0010', material: 'C2BH0214C', description: 'CURED STRAP BAHAMAS 214', quantity: '1', unit: 'PAA', itemCategory: 'L', assembly: true }
  ]},
  { material: 'C2BH0214C', plant: '1001', bomUsage: '1', availableAlternatives: ['1'], componentCount: 4, components: [
    { item: '0010', material: 'RAW_RUBBER_01', description: 'SYNTHETIC RUBBER', quantity: '10', unit: 'KG', itemCategory: 'L', assembly: false },
    { item: '0020', material: 'RAW_SULFUR_02', description: 'SULFUR', quantity: '0.2', unit: 'KG', itemCategory: 'L', assembly: false },
    { item: '0030', material: 'RAW_ACCEL_03', description: 'ACCELERATOR', quantity: '0.1', unit: 'KG', itemCategory: 'L', assembly: false },
    { item: '0040', material: 'RAW_OIL_04', description: 'AROMATIC OIL', quantity: '0.5', unit: 'KG', itemCategory: 'L', assembly: false }
  ]},
  { material: 'C2BH0214C', plant: '1012', bomUsage: '1', availableAlternatives: ['1'], componentCount: 4, components: [
    { item: '0010', material: 'RAW_RUBBER_01', description: 'SYNTHETIC RUBBER', quantity: '10', unit: 'KG', itemCategory: 'L', assembly: false },
    { item: '0020', material: 'RAW_SULFUR_02', description: 'SULFUR', quantity: '0.2', unit: 'KG', itemCategory: 'L', assembly: false },
    { item: '0030', material: 'RAW_ACCEL_03', description: 'ACCELERATOR', quantity: '0.1', unit: 'KG', itemCategory: 'L', assembly: false },
    { item: '0040', material: 'RAW_OIL_04', description: 'AROMATIC OIL', quantity: '0.5', unit: 'KG', itemCategory: 'L', assembly: false }
  ]},
  { material: 'PPBH0001C', plant: '1001', bomUsage: '1', availableAlternatives: ['1'], componentCount: 5, components: [
    { item: '0010', material: 'PKG_BOX_01', description: 'INNER BOX', quantity: '1', unit: 'EA', itemCategory: 'L', assembly: false },
    { item: '0020', material: 'PKG_POLY_02', description: 'POLYBAG', quantity: '1', unit: 'EA', itemCategory: 'L', assembly: false },
    { item: '0030', material: 'PKG_LBL_03', description: 'SIZE LABEL', quantity: '1', unit: 'EA', itemCategory: 'L', assembly: false },
    { item: '0040', material: 'PKG_HANGER_04', description: 'PLASTIC HANGER', quantity: '1', unit: 'EA', itemCategory: 'L', assembly: false },
    { item: '0050', material: 'PKG_TAG_05', description: 'PRICE TAG', quantity: '1', unit: 'EA', itemCategory: 'L', assembly: false }
  ]},
  { material: 'PPBH0001C', plant: '1012', bomUsage: '1', availableAlternatives: ['1'], componentCount: 5, components: [
    { item: '0010', material: 'PKG_BOX_01', description: 'INNER BOX', quantity: '1', unit: 'EA', itemCategory: 'L', assembly: false },
    { item: '0020', material: 'PKG_POLY_02', description: 'POLYBAG', quantity: '1', unit: 'EA', itemCategory: 'L', assembly: false },
    { item: '0030', material: 'PKG_LBL_03', description: 'SIZE LABEL', quantity: '1', unit: 'EA', itemCategory: 'L', assembly: false },
    { item: '0040', material: 'PKG_HANGER_04', description: 'PLASTIC HANGER', quantity: '1', unit: 'EA', itemCategory: 'L', assembly: false },
    { item: '0050', material: 'PKG_TAG_05', description: 'PRICE TAG', quantity: '1', unit: 'EA', itemCategory: 'L', assembly: false }
  ]},
  { material: 'C1HL0003C', plant: '1001', bomUsage: '1', availableAlternatives: ['1'], componentCount: 1, components: [
    { item: '0010', material: 'RAW_STRAP_01', description: 'PVC STRAP COMPOUND', quantity: '1', unit: 'PAA', itemCategory: 'L', assembly: false }
  ]},
  { material: 'C1HL0003C', plant: '1012', bomUsage: '1', availableAlternatives: ['1'], componentCount: 1, components: [
    { item: '0010', material: 'RAW_STRAP_01', description: 'PVC STRAP COMPOUND', quantity: '1', unit: 'PAA', itemCategory: 'L', assembly: false }
  ]},
  { material: 'MAT-BOM-100', plant: '1000', bomUsage: '1', availableAlternatives: ['1'], componentCount: 5, components: [{ item: '0010', material: 'RAW-01', description: 'RAW 1', quantity: '1', unit: 'EA', itemCategory: 'L', assembly: false }] },
  { material: 'MAT-BOM-200', plant: '1000', bomUsage: '1', availableAlternatives: ['1', '2'], componentCount: 8, components: [{ item: '0010', material: 'RAW-02', description: 'RAW 2', quantity: '1', unit: 'EA', itemCategory: 'L', assembly: false }] }
];

let activeMockBomDataset = JSON.parse(JSON.stringify(defaultMockBomDataset));

/**
 * Returns the current active mock BOM dataset.
 * @returns {Array<object>}
 */
export function getMockBomDataset() {
  return activeMockBomDataset;
}

/**
 * Resets the active mock BOM dataset to its initial default state.
 * @returns {Array<object>}
 */
export function resetMockBomDataset() {
  activeMockBomDataset = JSON.parse(JSON.stringify(defaultMockBomDataset));
  return activeMockBomDataset;
}

/**
 * Sets or updates the available alternatives for a mock BOM record.
 * @param {string} material
 * @param {string} plant
 * @param {string} [bomUsage='1']
 * @param {string[]} [alternatives=['1']]
 * @param {number} [componentCount=10]
 */
export function setMockBomAlternatives(material, plant, bomUsage = '1', alternatives = ['1'], componentCount = 10, components = null) {
  const matUpper = String(material || '').trim().toUpperCase();
  const plantStr = String(plant || '').trim();
  const usageStr = String(bomUsage || '1').trim();
  const alts = Array.isArray(alternatives) ? [...alternatives].map(String) : [String(alternatives)];

  const existing = activeMockBomDataset.find(
    (b) => b.material.toUpperCase() === matUpper && b.plant === plantStr && b.bomUsage === usageStr
  );

  if (existing) {
    existing.availableAlternatives = alts;
    if (componentCount !== undefined) existing.componentCount = componentCount;
    if (components) {
      existing.components = components;
      if (!existing.alternativeComponents) existing.alternativeComponents = {};
      for (const a of alts) {
        if (!existing.alternativeComponents[a]) {
          existing.alternativeComponents[a] = JSON.parse(JSON.stringify(components));
        }
      }
    }
  } else {
    const altComps = {};
    if (components) {
      for (const a of alts) {
        altComps[a] = JSON.parse(JSON.stringify(components));
      }
    }
    activeMockBomDataset.push({
      material: matUpper,
      plant: plantStr,
      bomUsage: usageStr,
      availableAlternatives: alts,
      componentCount,
      components: components || [{ itemCategory: 'L' }],
      alternativeComponents: altComps
    });
  }
}

const desktopRunnerPath = path.resolve(__dirname, '..', 'bin', 'DesktopRunner.cs');

/**
 * Executes a dynamically generated VBScript on the interactive desktop (WinSta0\\Default)
 * via Windows Script Host (cscript.exe) through DesktopRunner.
 *
 * @param {string} scriptContent
 * @param {number} [timeoutMs=30000]
 * @returns {Promise<{ stdout: string, stderr: string }>}
 */
function runVbsScript(scriptContent, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const tempDir = os.tmpdir();
    const tempFile = path.join(tempDir, `sap_gui_script_${Date.now()}_${Math.random().toString(36).slice(2)}.vbs`);

    try {
      fs.writeFileSync(tempFile, scriptContent, 'utf-8');
    } catch (writeErr) {
      return reject(new Error(`Failed to write temporary GUI script file: ${writeErr.message}`));
    }

    const startTime = Date.now();
    console.log(`[sapGuiClient] Executing script on interactive desktop (WinSta0\\Default): ${tempFile} (timeout: ${timeoutMs}ms)`);

    const psCommand = `Add-Type -Path '${desktopRunnerPath.replace(/'/g, "''")}'; [DesktopRunner]::RunScript('${tempFile.replace(/'/g, "''")}', ${timeoutMs})`;

    execFile(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', psCommand],
      {
        timeout: timeoutMs + 15000,
        windowsHide: true,
        cwd: process.cwd(),
        env: process.env
      },
      (error, stdout, stderr) => {
        const elapsed = Date.now() - startTime;
        console.log(`[sapGuiClient] Execution finished in ${elapsed}ms (exit code: ${error ? (error.code ?? error.signal ?? 'ERR') : 0})`);
        if (stdout) {
          console.log(`[sapGuiClient] stdout: ${stdout.trim()}`);
        }
        if (stderr) {
          console.warn(`[sapGuiClient] stderr: ${stderr.trim()}`);
        }

        // Clean up temporary script
        try {
          if (fs.existsSync(tempFile)) {
            fs.unlinkSync(tempFile);
          }
        } catch {
          // ignore cleanup errors
        }

        if (error && error.killed) {
          console.error(`[sapGuiClient] Execution TIMED OUT after ${timeoutMs / 1000}s!`);
          return reject(new Error(`SAP GUI automation timed out after ${timeoutMs / 1000}s.`));
        }

        resolve({ stdout: stdout ? stdout.trim() : '', stderr: stderr ? stderr.trim() : '' });
      }
    );
  });
}

let activeMockSapSessionUser = null;
let mockSapSessions = null;

/**
 * Sets mock SAP sessions list for multi-session testing.
 * @param {Array<object>|null} sessions
 */
export function setMockSapSessions(sessions) {
  mockSapSessions = Array.isArray(sessions) ? JSON.parse(JSON.stringify(sessions)) : null;
}

/**
 * Resets mock SAP sessions list.
 */
export function resetMockSapSessions() {
  mockSapSessions = null;
  activeMockSapSessionUser = null;
  selectedSapSessionId = null;
  selectedSapUser = null;
}

/**
 * Sets the active mock SAP session user (for testing user switching).
 * @param {string|null} username
 */
export function setMockSapSessionUser(username) {
  activeMockSapSessionUser = username ? String(username).trim() : null;
  selectedSapSessionId = null;
  selectedSapUser = activeMockSapSessionUser;
}

/**
 * Resets the active mock SAP session user to default.
 */
export function resetMockSapSessionUser() {
  activeMockSapSessionUser = null;
  selectedSapSessionId = null;
  selectedSapUser = null;
}

let cachedActiveSapUser = null;

/**
 * Selected SAP session state in memory.
 * Never stores passwords or sensitive data.
 */
let selectedSapSessionId = null;
let selectedSapUser = null;

export function getSelectedSapSessionId() {
  return selectedSapSessionId;
}

export function getSelectedSapUser() {
  return selectedSapUser || activeMockSapSessionUser || cachedActiveSapUser || process.env.TEST_SAP_USER || null;
}

export function setSelectedSapSessionId(sessionId, username = null) {
  selectedSapSessionId = sessionId ? String(sessionId).trim() : null;
  if (username) {
    selectedSapUser = String(username).trim();
  }
  return selectedSapSessionId;
}

export function resetSelectedSapSession() {
  selectedSapSessionId = null;
  selectedSapUser = null;
}

/**
 * Returns the currently discovered active SAP user.
 * @returns {string|null}
 */
export function getActiveSapUser() {
  return getSelectedSapUser();
}

/**
 * Helper to escape string values for safe VBScript string literals.
 */
function escapeVbsString(str) {
  if (str === undefined || str === null) return '';
  return String(str).replace(/"/g, '""');
}

/**
 * Shared VBScript snippet for dynamic SAP GUI session discovery.
 * Enumerates all connections and all sessions without hardcoding connection or session index.
 * Never assumes con[0] or ses[0].
 * Matches intended environment (preferring S4A / 500).
 * If expectedUser is provided, binds ONLY to a session belonging to expectedUser.
 * Isolates broken/dead connections so that dead sessions cannot poison the discovery of active sessions.
 *
 * @param {string} [targetSessionPath=''] - Optional session path discovered in preflight (e.g. '/app/con[1]/ses[0]')
 * @param {string} [expectedUser=''] - Optional expected SAP username (e.g. 'ACCESS1' or 'LEELAM_EXT')
 * @returns {string} VBScript code snippet that sets conn and session
 */
function getSessionDiscoveryVbs(targetSessionPath = '', expectedUser = '') {
  const cleanExpUser = expectedUser ? String(expectedUser).trim() : '';

  return `
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

` + (targetSessionPath ? `
' Step 1: Preflight direct lookup if valid session path was supplied
On Error Resume Next
Err.Clear
Dim preflightSess
Set preflightSess = app.findById("${escapeVbsString(targetSessionPath)}")
If Err.Number = 0 And Not preflightSess Is Nothing Then
    Dim pfUser
    pfUser = Trim(CStr(preflightSess.Info.User))
    ${cleanExpUser ? `If UCase(pfUser) = UCase("${escapeVbsString(cleanExpUser)}") And preflightSess.Info.Client <> "" Then` : `If pfUser <> "" And preflightSess.Info.Client <> "" Then`}
        Set targetSession = preflightSess
        Set targetConn = preflightSess.Parent
    End If
End If
On Error Goto 0
` : '') + `

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
                        ${cleanExpUser ? `If UCase(sUser) = UCase("${escapeVbsString(cleanExpUser)}") Then` : ''}
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
                        ${cleanExpUser ? `End If` : ''}
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
`;
}

/**
 * Discovers all active, usable SAP GUI sessions across all connections on the desktop.
 * Never hardcodes connection index, session index, username, or credentials.
 *
 * @param {object} [options]
 * @param {number} [options.timeoutMs=10000]
 * @returns {Promise<{ ok: boolean, code?: string, message?: string, hasBrokenSession?: boolean, sessions: Array<object> }>}
 */
export async function discoverSapSessions({ timeoutMs = 10000 } = {}) {
  // Support mock mode for deterministic unit & integration tests
  if (process.env.USE_MOCK_SAP === 'true') {
    if (process.env.TEST_SAP_SESSION_HEALTH === 'SERVER_UNAVAILABLE') {
      return {
        ok: false,
        code: 'SERVER_UNAVAILABLE',
        hasBrokenSession: true,
        sessions: [],
        message: 'The SAP server is currently unavailable. Please start/reconnect SAP and try again.'
      };
    }
    if (process.env.TEST_SAP_SESSION_HEALTH === 'SESSION_NOT_FOUND' || process.env.TEST_SIMULATE_NO_SESSION === 'true') {
      return {
        ok: true,
        code: 'SESSION_NOT_FOUND',
        sessions: [],
        message: 'Please log in to SAP GUI again. The application will automatically detect the session.'
      };
    }

    if (Array.isArray(mockSapSessions)) {
      return {
        ok: true,
        code: 'OK',
        sessions: JSON.parse(JSON.stringify(mockSapSessions)).map((s, idx) => ({
          id: s.id || `sess_${(s.system || 'sap').toLowerCase()}_${s.client || '000'}_${(s.user || 'usr').toLowerCase()}_${s.connectionIndex ?? 0}_${s.sessionIndex ?? idx}`,
          system: s.system || 'S4A',
          client: s.client || '500',
          user: s.user || 'USER',
          transaction: s.transaction || 'SESSION_MANAGER',
          title: s.title || 'SAP Easy Access',
          busy: Boolean(s.busy),
          sessionPath: s.sessionPath || `/app/con[${s.connectionIndex ?? 0}]/ses[${s.sessionIndex ?? idx}]`,
          connectionIndex: s.connectionIndex ?? 0,
          sessionIndex: s.sessionIndex ?? idx
        }))
      };
    }

    if (activeMockSapSessionUser) {
      const u = activeMockSapSessionUser;
      const isBusy = process.env.TEST_SAP_SESSION_HEALTH === 'BUSY' || process.env.TEST_SIMULATE_BUSY === 'true';
      return {
        ok: true,
        code: 'OK',
        sessions: [
          {
            id: `sess_s4a_500_${u.toLowerCase()}_0_0`,
            system: 'S4A',
            client: '500',
            user: u,
            transaction: 'SESSION_MANAGER',
            title: 'SAP Easy Access',
            busy: isBusy,
            sessionPath: '/app/con[0]/ses[0]',
            connectionIndex: 0,
            sessionIndex: 0
          }
        ]
      };
    }

    // Default mock response: healthy
    const mockUser = getActiveSapUser() || 'LEELAM_EXT';
    const isBusy = process.env.TEST_SAP_SESSION_HEALTH === 'BUSY' || process.env.TEST_SIMULATE_BUSY === 'true';
    return {
      ok: true,
      code: 'OK',
      sessions: [
        {
          id: `sess_s4a_500_${mockUser.toLowerCase()}_0_0`,
          system: 'S4A',
          client: '500',
          user: mockUser,
          transaction: 'SESSION_MANAGER',
          title: 'SAP Easy Access',
          busy: isBusy,
          sessionPath: '/app/con[0]/ses[0]',
          connectionIndex: 0,
          sessionIndex: 0
        }
      ]
    };
  }

  if (process.platform !== 'win32') {
    return {
      ok: false,
      code: 'PLATFORM_UNSUPPORTED',
      sessions: [],
      message: 'SAP GUI Scripting is only supported on Windows operating systems.'
    };
  }

  const vbsDiscover = `
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

    For attempt = 1 To 2
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

        If attempt < 2 Then WScript.Sleep 300
    Next

    rawErrDetails = "COM Err " & lastErrNum & " (0x" & Hex(lastErrNum) & "): " & lastErrDesc
    Set GetSapGuiObject = Nothing
End Function

Dim rawErrInfo, sapAuto, app, connCount, cIdx, sIdx, sessionsJson, hasBrokenSession
sessionsJson = ""
hasBrokenSession = False

Set sapAuto = GetSapGuiObject(rawErrInfo)
If sapAuto Is Nothing Then
    WScript.Echo "{""ok"":false,""code"":""SESSION_NOT_FOUND"",""sessions"":[],""message"":""Please log in to SAP GUI again. The application will automatically detect the session."",""rawError"":""" & JsonEscape(rawErrInfo) & """}"
    WScript.Quit 0
End If

Set app = sapAuto.GetScriptingEngine
If Err.Number <> 0 Or app Is Nothing Then
    WScript.Echo "{""ok"":false,""code"":""SCRIPTING_DISABLED"",""sessions"":[],""message"":""SAP GUI Scripting is disabled. Ensure scripting is enabled in SAP GUI Options and RZ11.""}"
    WScript.Quit 0
End If

connCount = app.Children.Count
If connCount = 0 Then
    WScript.Echo "{""ok"":true,""code"":""NO_CONNECTION"",""sessions"":[],""message"":""SAP GUI is open, but no active system connection found.""}"
    WScript.Quit 0
End If

For cIdx = 0 To connCount - 1
    Dim cConn
    Set cConn = Nothing
    On Error Resume Next
    Set cConn = app.Children(CInt(cIdx))
    On Error Goto 0

    If Not cConn Is Nothing Then
        Dim sessCount, cDesc
        sessCount = 0
        cDesc = ""
        On Error Resume Next
        sessCount = cConn.Children.Count
        cDesc = cConn.Description
        On Error Goto 0

        For sIdx = 0 To sessCount - 1
            Dim cSess
            Set cSess = Nothing
            On Error Resume Next
            Set cSess = cConn.Children(CInt(sIdx))
            On Error Goto 0

            If Not cSess Is Nothing Then
                Dim sUser, sSys, sCli, sTrans, sProg, sScreen, sTitle, sId, sBusy, isBroken, sessErr
                sUser = "" : sSys = "" : sCli = "" : sTrans = "" : sProg = "" : sScreen = "" : sTitle = "" : sId = ""
                sBusy = False : isBroken = False

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

                If Not isBroken And sUser <> "" And sCli <> "" Then
                    If sessionsJson <> "" Then sessionsJson = sessionsJson & ","
                    sessionsJson = sessionsJson & "{" & _
                        """connectionIndex"":" & cIdx & "," & _
                        """sessionIndex"":" & sIdx & "," & _
                        """sessionPath"":""" & JsonEscape(sId) & """," & _
                        """system"":""" & JsonEscape(sSys) & """," & _
                        """client"":""" & JsonEscape(sCli) & """," & _
                        """user"":""" & JsonEscape(sUser) & """," & _
                        """transaction"":""" & JsonEscape(sTrans) & """," & _
                        """title"":""" & JsonEscape(sTitle) & """," & _
                        """busy"":" & LCase(CStr(sBusy)) & "}"
                End If
            End If
        Next
    End If
Next

WScript.Echo "{""ok"":true,""code"":""OK"",""hasBrokenSession"":" & LCase(CStr(hasBrokenSession)) & ",""sessions"":[" & sessionsJson & "]}"
`;

  try {
    const { stdout } = await runVbsScript(vbsDiscover, timeoutMs);
    if (!stdout) {
      return { ok: false, code: 'SERVER_UNAVAILABLE', sessions: [], message: 'The SAP server is currently unavailable.' };
    }
    const parsed = JSON.parse(stdout);
    if (!parsed.ok && parsed.code === 'SESSION_NOT_FOUND') {
      return { ok: true, code: 'SESSION_NOT_FOUND', sessions: [], message: parsed.message };
    }
    if (!parsed.ok) {
      return { ok: false, code: parsed.code || 'ERROR', sessions: [], message: parsed.message };
    }

    const discovered = (parsed.sessions || []).map((s) => ({
      id: `sess_${(s.system || 'sap').toLowerCase()}_${s.client || '000'}_${(s.user || 'usr').toLowerCase()}_${s.connectionIndex}_${s.sessionIndex}`,
      system: s.system,
      client: s.client,
      user: s.user,
      transaction: s.transaction,
      title: s.title,
      busy: Boolean(s.busy),
      sessionPath: s.sessionPath,
      connectionIndex: s.connectionIndex,
      sessionIndex: s.sessionIndex
    }));

    return {
      ok: true,
      code: 'OK',
      hasBrokenSession: parsed.hasBrokenSession,
      sessions: discovered
    };
  } catch (err) {
    return {
      ok: false,
      code: 'SERVER_UNAVAILABLE',
      sessions: [],
      message: `Failed to discover SAP GUI sessions: ${err.message}`
    };
  }
}

/**
 * Dynamic SAP GUI session health and connectivity probe.
 * Safely inspects session availability, session.Info, active popups/broken connection dialogs, and busy state.
 * Never hardcodes connection index, session index, username, or password.
 * Supports explicit session selection and multi-session discovery.
 *
 * @param {object} [options]
 * @param {number} [options.maxRetries=1]
 * @param {number} [options.timeoutMs=10000]
 * @returns {Promise<{ connected: boolean, status: 'CONNECTED'|'CHECKING'|'BUSY'|'DISCONNECTED'|'SERVER_UNAVAILABLE'|'SESSION_NOT_FOUND'|'ERROR', system?: string, client?: string, user?: string, message: string, code?: string, transaction?: string, sessionTitle?: string, sessionPath?: string, selectedSessionId?: string, sessions?: Array<object> }>}
 */
export async function checkSapSessionHealth({ maxRetries = 1, timeoutMs = 10000 } = {}) {
  // Support mock mode for deterministic unit & integration tests
  if (process.env.USE_MOCK_SAP === 'true') {
    if (process.env.TEST_SAP_SESSION_HEALTH === 'SERVER_UNAVAILABLE') {
      return {
        connected: false,
        status: 'SERVER_UNAVAILABLE',
        code: 'SAP_SERVER_UNAVAILABLE',
        message: 'The SAP server is currently unavailable. Please start/reconnect SAP and try again.',
        sessions: []
      };
    }
    if (process.env.TEST_SAP_SESSION_HEALTH === 'SESSION_NOT_FOUND' || process.env.TEST_SIMULATE_NO_SESSION === 'true') {
      return {
        connected: false,
        status: 'SESSION_NOT_FOUND',
        code: 'SAP_SESSION_NOT_FOUND',
        message: 'Please log in to SAP GUI again. The application will automatically detect the session.',
        sessions: []
      };
    }
    if (process.env.TEST_SAP_SESSION_HEALTH === 'ERROR') {
      return {
        connected: false,
        status: 'ERROR',
        code: 'SAP_SCRIPT_ERROR',
        message: 'SAP GUI session probe encountered an unexpected error.',
        sessions: []
      };
    }
    if (process.env.TEST_SAP_SESSION_HEALTH === 'DISCONNECTED') {
      return {
        connected: false,
        status: 'DISCONNECTED',
        code: 'NO_CONNECTION',
        message: 'SAP GUI is open, but no active system connection found. Please log in first.',
        sessions: []
      };
    }
  }

  const discovery = await discoverSapSessions({ timeoutMs });
  if (!discovery.ok) {
    if (discovery.code === 'SERVER_UNAVAILABLE') {
      return {
        connected: false,
        status: 'SERVER_UNAVAILABLE',
        code: 'SAP_SERVER_UNAVAILABLE',
        message: 'The SAP server is currently unavailable. Please start/reconnect SAP and try again.',
        sessions: []
      };
    }
    if (discovery.code === 'PLATFORM_UNSUPPORTED') {
      return {
        connected: false,
        status: 'ERROR',
        code: 'PLATFORM_UNSUPPORTED',
        message: discovery.message,
        sessions: []
      };
    }
  }

  const sessions = discovery.sessions || [];
  const publicSessions = sessions.map(({ sessionPath, connectionIndex, sessionIndex, ...rest }) => rest);

  if (sessions.length === 0) {
    if (discovery.hasBrokenSession) {
      return {
        connected: false,
        status: 'SERVER_UNAVAILABLE',
        code: 'SAP_SERVER_UNAVAILABLE',
        message: 'The SAP server is currently unavailable. Please start/reconnect SAP and try again.',
        sessions: []
      };
    }
    return {
      connected: false,
      status: 'SESSION_NOT_FOUND',
      code: 'SAP_SESSION_NOT_FOUND',
      message: 'Please log in to SAP GUI again. The application will automatically detect the session.',
      sessions: []
    };
  }

  // Determine selected session
  let target = null;
  if (selectedSapSessionId) {
    // Try exact ID match first
    target = sessions.find((s) => s.id === selectedSapSessionId);
    // If not found by ID, match by user (to handle connection/session index changes)
    if (!target && selectedSapUser) {
      target = sessions.find((s) => s.user.toUpperCase() === selectedSapUser.toUpperCase());
      if (target) {
        selectedSapSessionId = target.id;
      }
    }

    if (!target) {
      // Selected session is gone! Do NOT automatically switch to another session!
      return {
        connected: false,
        status: 'DISCONNECTED',
        code: 'SELECTED_SESSION_UNAVAILABLE',
        user: selectedSapUser,
        selectedUser: selectedSapUser,
        selectedSessionId: selectedSapSessionId,
        sessionsCount: sessions.length,
        sessions: publicSessions,
        message: `${selectedSapUser || 'The selected SAP session'} is no longer available. Please select another SAP session.`
      };
    }
  } else {
    // No session selected yet. Default to the best candidate: S4A & 500
    target = [...sessions].sort((a, b) => {
      let scoreA = (a.system === 'S4A' ? 50 : 0) + (a.client === '500' ? 50 : 0) + (!a.busy ? 10 : 0);
      let scoreB = (b.system === 'S4A' ? 50 : 0) + (b.client === '500' ? 50 : 0) + (!b.busy ? 10 : 0);
      return scoreB - scoreA;
    })[0];

    selectedSapSessionId = target.id;
    selectedSapUser = target.user;
  }

  selectedSapUser = target.user;
  cachedActiveSapUser = target.user;

  if (target.busy) {
    return {
      connected: false,
      status: 'BUSY',
      code: 'SAP_SESSION_BUSY',
      system: target.system,
      client: target.client,
      user: target.user,
      selectedUser: target.user,
      sessionPath: target.sessionPath,
      selectedSessionId: target.id,
      selectedSession: target,
      sessionsCount: sessions.length,
      sessions: publicSessions,
      message: `SAP GUI session (${target.user}) is currently processing another operation. Retrying...`
    };
  }

  return {
    connected: true,
    status: 'CONNECTED',
    code: 'CONNECTED',
    system: target.system,
    client: target.client,
    user: target.user,
    selectedUser: target.user,
    transaction: target.transaction,
    sessionTitle: target.title,
    sessionPath: target.sessionPath,
    selectedSessionId: target.id,
    selectedSession: target,
    sessionsCount: sessions.length,
    sessions: publicSessions,
    message: `SAP GUI session (${target.user}) connected and ready.`
  };
}

/**
 * Preflight check: Ensures an active, usable SAP GUI session is available before an operation starts.
 * Retries briefly if the session is temporarily BUSY.
 *
 * @param {object} [options]
 * @param {number} [options.retries=2]
 * @param {number} [options.delayMs=500]
 * @returns {Promise<{ ok: boolean, health: object, session?: object, status: string, code?: string, sessionPath?: string, user?: string, system?: string, client?: string, message: string }>}
 */
export async function ensureSelectedSapSession({ retries = 2, delayMs = 500 } = {}) {
  let lastHealth = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    lastHealth = await checkSapSessionHealth();
    if (lastHealth.connected && lastHealth.status === 'CONNECTED') {
      return {
        ok: true,
        status: lastHealth.status,
        code: lastHealth.code || 'CONNECTED',
        health: lastHealth,
        session: lastHealth.selectedSession,
        sessionPath: lastHealth.sessionPath,
        user: lastHealth.user,
        system: lastHealth.system,
        client: lastHealth.client,
        message: lastHealth.message
      };
    }

    if (lastHealth.status === 'BUSY' && attempt < retries) {
      await new Promise((r) => setTimeout(r, delayMs));
      continue;
    }

    if (attempt < retries && (lastHealth.status === 'ERROR' || lastHealth.status === 'CHECKING')) {
      await new Promise((r) => setTimeout(r, delayMs));
      continue;
    }

    break;
  }

  return {
    ok: false,
    health: lastHealth,
    status: lastHealth?.status || 'SERVER_UNAVAILABLE',
    code: lastHealth?.code || lastHealth?.status || 'SAP_SERVER_UNAVAILABLE',
    message: lastHealth?.message || 'The selected SAP session is currently unavailable. Please start/reconnect SAP and try again.'
  };
}

export const ensureSapSession = ensureSelectedSapSession;



export const getSapConnectionStatus = checkSapSessionHealth;

/**
 * STEP 1: Connects to an already-open, already-logged-in SAP GUI session.
 * Dynamically discovers all open connections and sessions across any SAP environment (e.g. Relaxo Sandbox).
 * Does NOT automate login/password entry.
 *
 * @param {number} [maxRetries=2]
 * @returns {Promise<{ success: boolean, code?: string, message: string, user?: string, system?: string, client?: string, connectionName?: string, sessionTitle?: string, sessionPath?: string, allConnections?: Array<object> }>}
 */
export async function connectToSapGui(maxRetries = 2) {
  if (process.platform !== 'win32') {
    return {
      success: false,
      code: 'PLATFORM_UNSUPPORTED',
      message: 'SAP GUI Scripting is only supported on Windows operating systems.'
    };
  }

  const vbsCheck = `
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
Dim connCount, cIdx, sIdx, foundTarget, allConnsJson

Set sapAuto = GetSapGuiObject(rawErrInfo)

If sapAuto Is Nothing Then
    Dim safeRawErr
    safeRawErr = JsonEscape(rawErrInfo)
    WScript.Echo "{""success"":false,""code"":""SESSION_NOT_FOUND"",""message"":""No running SAP GUI instance found on the desktop. Please ensure SAP GUI is open and logged in."",""rawError"":""" & safeRawErr & """}"
    WScript.Quit 0
End If

Set app = sapAuto.GetScriptingEngine
If Err.Number <> 0 Or app Is Nothing Then
    WScript.Echo "{""success"":false,""code"":""SCRIPTING_DISABLED"",""message"":""SAP GUI Scripting is disabled. Ensure scripting is enabled in SAP GUI Options and RZ11.""}"
    WScript.Quit 0
End If

connCount = app.Children.Count
If connCount = 0 Then
    WScript.Echo "{""success"":false,""code"":""NO_CONNECTION"",""message"":""SAP GUI is open, but no active system connection found. Please log in first.""}"
    WScript.Quit 0
End If

allConnsJson = "["
foundTarget = False
Dim bestScore, bestUser, bestSys, bestCli, bestTrans, bestPath, bestConnName, bestTitle, bestProg, bestScreen
bestScore = -1

For cIdx = 0 To connCount - 1
    Set conn = Nothing
    On Error Resume Next
    Set conn = app.Children(CInt(cIdx))
    On Error Goto 0

    Dim sessCount, cDesc
    sessCount = 0
    cDesc = ""
    If Not conn Is Nothing Then
        On Error Resume Next
        cDesc = conn.Description
        sessCount = conn.Children.Count
        On Error Goto 0
    End If
    
    If cIdx > 0 Then allConnsJson = allConnsJson & ","
    allConnsJson = allConnsJson & "{""connectionIndex"":" & cIdx & ",""description"":""" & JsonEscape(cDesc) & """,""sessionCount"":" & sessCount & ",""sessions"":["

    If sessCount > 0 Then
        For sIdx = 0 To sessCount - 1
            Set sess = Nothing
            On Error Resume Next
            Set sess = conn.Children(CInt(sIdx))
            On Error Goto 0

            Dim sUser, sSys, sCli, sTrans, sProg, sScreen, sTitle, sId, sBusy, sErr, score
            sUser = "" : sSys = "" : sCli = "" : sTrans = "" : sProg = "" : sScreen = "" : sTitle = "" : sId = ""
            sBusy = False
            sErr = 0
            score = 0

            If Not sess Is Nothing Then
                On Error Resume Next
                sId = sess.Id
                sBusy = sess.Busy
                sUser = Trim(CStr(sess.Info.User))
                sSys = Trim(CStr(sess.Info.SystemName))
                sCli = Trim(CStr(sess.Info.Client))
                sTrans = Trim(CStr(sess.Info.Transaction))
                sProg = Trim(CStr(sess.Info.Program))
                sScreen = Trim(CStr(sess.Info.ScreenNumber))
                sErr = Err.Number
                On Error Goto 0

                On Error Resume Next
                sTitle = sess.ActiveWindow.Text
                On Error Goto 0

                If sIdx > 0 Then allConnsJson = allConnsJson & ","
                allConnsJson = allConnsJson & "{""sessionIndex"":" & sIdx & ",""sessionId"":""" & JsonEscape(sId) & """,""systemName"":""" & JsonEscape(sSys) & """,""client"":""" & JsonEscape(sCli) & """,""user"":""" & JsonEscape(sUser) & """,""transaction"":""" & JsonEscape(sTrans) & """,""program"":""" & JsonEscape(sProg) & """,""screen"":""" & JsonEscape(sScreen) & """,""title"":""" & JsonEscape(sTitle) & """}"

                If sErr = 0 And sUser <> "" And sCli <> "" Then
                    score = 10
                    If UCase(sSys) = "S4A" And sCli = "500" Then
                        score = score + 100
                    ElseIf UCase(sSys) = "S4A" Then
                        score = score + 60
                    ElseIf InStr(LCase(cDesc), "relaxo") > 0 Then
                        score = score + 40
                    End If
                    If Not sBusy Then score = score + 20

                    If score > bestScore Then
                        bestScore = score
                        foundTarget = True
                        bestUser = sUser
                        bestSys = sSys
                        bestCli = sCli
                        bestTrans = sTrans
                        bestPath = sId
                        bestConnName = cDesc
                        bestTitle = sTitle
                        bestProg = sProg
                        bestScreen = sScreen
                    End If
                End If
            End If
        Next
    End If
    allConnsJson = allConnsJson & "]}"
Next
allConnsJson = allConnsJson & "]"

If foundTarget Then
    user = bestUser
    sys = bestSys
    client = bestCli
    trans = bestTrans
    sessionPath = bestPath
    connectionName = bestConnName
    sessionTitle = bestTitle
    prog = bestProg
    screenNum = bestScreen
End If

WScript.Echo "{""success"":true," & _
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

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const { stdout, stderr } = await runVbsScript(vbsCheck, 15000);
      if (!stdout) {
        if (attempt < maxRetries) {
          await new Promise((r) => setTimeout(r, 1000));
          continue;
        }
        return {
          success: false,
          code: 'NO_RESPONSE',
          message: 'No response received from SAP GUI Scripting engine.',
          rawStderr: stderr
        };
      }

      const parsed = JSON.parse(stdout);
      if (parsed.success) {
        return parsed;
      }
      if (attempt < maxRetries && parsed.code === 'SESSION_NOT_FOUND') {
        console.log(`[sapGuiClient] connectToSapGui attempt ${attempt} got SESSION_NOT_FOUND. Retrying in 1s...`);
        await new Promise((r) => setTimeout(r, 1000));
        continue;
      }
      return parsed;
    } catch (err) {
      if (attempt < maxRetries) {
        await new Promise((r) => setTimeout(r, 1000));
        continue;
      }
      return {
        success: false,
        code: 'PROBE_FAILED',
        message: `Failed to probe SAP GUI session: ${err.message}`
      };
    }
  }
}



/**
 * STEP 2: Automates CS01 BOM creation via the active SAP GUI session.
 * Uses placeholder field IDs (to be finalized in Step 3 via user's recorded script).
 *
 * @param {object} params
 * @param {string} params.material - Material Number (e.g. '100-100')
 * @param {string} params.plant - Plant Code (e.g. '1000')
 * @param {string} [params.bomUsage='1'] - BOM Usage (1 = Production)
 * @param {string} [params.validFrom] - Valid From Date (DD.MM.YYYY or as formatted in SAP GUI)
 * @param {string} [params.alternativeBom='1'] - Alternative BOM number
 * @param {Array<{ component: string, quantity: number|string, itemCategory?: string, unit?: string }>} [params.components=[]] - BOM items
 * @returns {Promise<{ success: boolean, bomNumber?: string, message: string, before: null, after: object }>}
 */
export async function createBomViaGui(params) {
  const {
    material,
    plant,
    bomUsage = '1',
    validFrom = '',
    alternativeBom = '',
    components = []
  } = params || {};

  if (!material || !String(material).trim()) {
    throw new Error('Material number is required for BOM creation in CS01.');
  }
  if (!plant || !String(plant).trim()) {
    throw new Error('Plant code is required for BOM creation in CS01.');
  }

  // Live preflight check
  let targetSessionPath = '';
  let expectedUser = '';
  if (process.env.USE_MOCK_SAP !== 'true') {
    const preflight = await ensureSapSession();
    if (!preflight.ok) {
      return {
        success: false,
        verified: false,
        code: preflight.status === 'SERVER_UNAVAILABLE' ? 'SAP_SERVER_UNAVAILABLE' : (preflight.code || 'SESSION_NOT_FOUND'),
        message: preflight.message,
        before: null,
        after: null
      };
    }
    targetSessionPath = preflight.sessionPath || '';
    expectedUser = preflight.user || '';
  }

  if (process.env.USE_MOCK_SAP === 'true') {
    const cleanMat = String(material).trim().toUpperCase();
    const cleanPlt = String(plant).trim();
    const cleanUsg = String(bomUsage || '1').trim();
    const cleanAlt = String(alternativeBom || '').trim();

    let targetRecord = activeMockBomDataset.find(
      b => b.material.toUpperCase() === cleanMat && b.plant === cleanPlt && b.bomUsage === cleanUsg
    );

    const resolvedAlt = cleanAlt || (targetRecord ? resolveNextAvailableAlternative(targetRecord.availableAlternatives || ['1'], '') : '1');

    const normalizedComps = (Array.isArray(components) ? components : []).map((c, idx) => ({
      item: c.item || c.posnr || String((idx + 1) * 10).padStart(4, '0'),
      material: c.component || c.material || '',
      description: c.description || '',
      quantity: String(c.quantity || c.qty || '1'),
      unit: c.unit || 'KG',
      itemCategory: c.itemCategory || c.postp || 'L',
      assembly: Boolean(c.assembly)
    }));

    if (targetRecord) {
      if (!targetRecord.availableAlternatives.includes(resolvedAlt)) {
        targetRecord.availableAlternatives.push(resolvedAlt);
      }
      if (!targetRecord.alternativeComponents) {
        targetRecord.alternativeComponents = {};
        const firstAlt = targetRecord.availableAlternatives[0] || '1';
        targetRecord.alternativeComponents[firstAlt] = JSON.parse(JSON.stringify(targetRecord.components || []));
      }
      targetRecord.alternativeComponents[resolvedAlt] = JSON.parse(JSON.stringify(normalizedComps));
      targetRecord.components = normalizedComps;
      targetRecord.componentCount = normalizedComps.length;
    } else {
      targetRecord = {
        material: cleanMat,
        plant: cleanPlt,
        bomUsage: cleanUsg,
        availableAlternatives: [resolvedAlt],
        componentCount: normalizedComps.length,
        components: normalizedComps,
        alternativeComponents: {
          [resolvedAlt]: JSON.parse(JSON.stringify(normalizedComps))
        }
      };
      activeMockBomDataset.push(targetRecord);
    }

    const firstComp = normalizedComps[0] || {};
    return {
      success: true,
      verified: true,
      code: 'BOM_CREATED_AND_VERIFIED',
      message: `BOM for material ${cleanMat} in plant ${cleanPlt} (Alt ${resolvedAlt}) created successfully (Mock).`,
      alternativeBom: resolvedAlt,
      verifiedComponent: firstComp.material || '',
      verifiedQty: firstComp.quantity || '1',
      verifiedItemCategory: firstComp.itemCategory || 'L',
      before: null,
      after: {
        material: cleanMat,
        plant: cleanPlt,
        bomUsage: cleanUsg,
        alternativeBom: resolvedAlt,
        validFrom: validFrom || '',
        components: normalizedComps,
        verifiedInSap: true,
        status: 'CREATED_AND_VERIFIED_VIA_GUI',
        guiMessage: 'Mock creation successful',
        createdAt: new Date().toISOString()
      }
    };
  }

  // 1. Build component data array assignments for VBScript
  const normalizedComponents = Array.isArray(components) ? components : [];
  const validComponents = normalizedComponents.filter(c => Boolean(c.component || c.material || c.id));

  if (validComponents.length === 0) {
    return {
      success: false,
      verified: false,
      code: 'SOURCE_BOM_EMPTY',
      message: `Cannot create BOM: No valid components supplied for material ${cleanMat} in plant ${cleanPlt}.`
    };
  }

  const compDataAssignments = validComponents.map((item, idx) => {
    const compPos = escapeVbsString(item.item || item.posnr || '');
    const compMaterial = escapeVbsString(item.component || item.material || item.id || '');
    const compQty = escapeVbsString(item.quantity || item.qty || '1');
    const compItemCat = escapeVbsString(item.itemCategory || item.postp || 'L');
    return `compsData(${idx}, 0) = "${compMaterial}"\r\ncompsData(${idx}, 1) = "${compQty}"\r\ncompsData(${idx}, 2) = "${compItemCat}"\r\ncompsData(${idx}, 3) = "${compPos}"`;
  }).join('\r\n');

  // 2. Assemble complete automation VBScript
  const vbsScript = `
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

Function FindTableControlRecursive(container)
    Set FindTableControlRecursive = Nothing
    On Error Resume Next
    Dim i, child, res
    If container Is Nothing Then Exit Function
    For i = 0 To container.Children.Count - 1
        Set child = container.Children(CInt(i))
        If Not child Is Nothing Then
            If child.Type = "GuiTableControl" Then
                Set FindTableControlRecursive = child
                Exit Function
            ElseIf child.ContainerType Then
                Set res = FindTableControlRecursive(child)
                If Not res Is Nothing Then
                    Set FindTableControlRecursive = res
                    Exit Function
                End If
            End If
        End If
    Next
    On Error Goto 0
End Function

Function FindComponentTable(sessionObj)
    Set FindComponentTable = Nothing
    On Error Resume Next
    Dim t, usrObj
    ' 1. Check known Screen 2150 tabstrip path
    Set t = sessionObj.findById("wnd[0]/usr/tabsTS_ITOV/tabpTCMA/ssubSUBPAGE:SAPLCSDI:0152/tblSAPLCSDITCMAT")
    If Not t Is Nothing Then
        Set FindComponentTable = t
        Exit Function
    End If
    ' 2. Check direct / fallback paths
    Set t = sessionObj.findById("wnd[0]/usr/tblSAPLCSDITCMAT")
    If Not t Is Nothing Then
        Set FindComponentTable = t
        Exit Function
    End If
    Set t = sessionObj.findById("wnd[0]/usr/tblSAPLCSDITCPG")
    If Not t Is Nothing Then
        Set FindComponentTable = t
        Exit Function
    End If
    ' 3. Recursive discovery from wnd[0]/usr
    Set usrObj = sessionObj.findById("wnd[0]/usr")
    If Not usrObj Is Nothing Then
        Set t = FindTableControlRecursive(usrObj)
        If Not t Is Nothing Then
            Set FindComponentTable = t
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

${getSessionDiscoveryVbs(targetSessionPath, expectedUser)}

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

' Check if modal dialog appeared upon entering transaction
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

' 2. Fill Initial Screen
session.findById("${CS01_FIELD_IDS.MATERIAL}").text = "${escapeVbsString(material)}"
session.findById("${CS01_FIELD_IDS.PLANT}").text = "${escapeVbsString(plant)}"
session.findById("${CS01_FIELD_IDS.BOM_USAGE}").text = "${escapeVbsString(bomUsage)}"

${alternativeBom ? `session.findById("${CS01_FIELD_IDS.ALT_BOM}").text = "${escapeVbsString(alternativeBom)}"` : ''}
${validFrom ? `session.findById("${CS01_FIELD_IDS.VALID_FROM}").text = "${escapeVbsString(validFrom)}"` : ''}

Dim createdAltBom
createdAltBom = "${escapeVbsString(alternativeBom)}"

' Press Enter to go to component screen
session.findById("wnd[0]").sendVKey 0
WScript.Sleep 500

' Check if warning/info dialog appeared (e.g. "BOM already exists" or "Alternative BOM")
Dim popupLoopCount, postEnterPopup, safePostEnterPopup, regEx, matches
popupLoopCount = 0

Do While session.Children.Count > 1 And popupLoopCount < 5
    popupLoopCount = popupLoopCount + 1
    postEnterPopup = GetWindowText(session.findById("wnd[1]"))
    safePostEnterPopup = JsonEscape(postEnterPopup)
    
    If IsHardError(postEnterPopup) Then
        WScript.Echo "{""success"":false,""verified"":false,""code"":""INITIAL_SCREEN_ERROR"",""message"":""Initial Screen Error: " & safePostEnterPopup & """}"
        session.findById("wnd[1]").sendVKey 12
        session.findById("wnd[0]/tbar[0]/okcd").text = "/n"
        session.findById("wnd[0]").sendVKey 0
        WScript.Quit 0
    Else
        ' Informational/warning popup about existing BOM or alternative — extract alt if mentioned, dismiss it (Enter) and continue
        If createdAltBom = "" And InStr(LCase(postEnterPopup), "alternative") > 0 Then
            On Error Resume Next
            Set regEx = CreateObject("VBScript.RegExp")
            regEx.Pattern = "alternative\s*0?(\d+)"
            regEx.IgnoreCase = True
            Set matches = regEx.Execute(postEnterPopup)
            If matches.Count > 0 Then
                createdAltBom = matches(0).SubMatches(0)
            End If
            On Error Goto 0
        End If

        session.findById("wnd[1]").sendVKey 0
        WScript.Sleep 500
    End If
Loop

' Check status bar on initial screen
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

' In SAP CS01, if a status bar warning/info was displayed on screen 0100 (or after dismissing an informational popup),
' an additional Enter is required to advance to the Item Overview screen.
Dim tblCtrl, tblId
Set tblCtrl = FindComponentTable(session)

If tblCtrl Is Nothing Then
    session.findById("wnd[0]").sendVKey 0
    WScript.Sleep 500

    popupLoopCount = 0
    Do While session.Children.Count > 1 And popupLoopCount < 5
        popupLoopCount = popupLoopCount + 1
        postEnterPopup = GetWindowText(session.findById("wnd[1]"))
        safePostEnterPopup = JsonEscape(postEnterPopup)
        
        If IsHardError(postEnterPopup) Then
            WScript.Echo "{""success"":false,""verified"":false,""code"":""INITIAL_SCREEN_ERROR"",""message"":""Initial Screen Error: " & safePostEnterPopup & """}"
            session.findById("wnd[1]").sendVKey 12
            session.findById("wnd[0]/tbar[0]/okcd").text = "/n"
            session.findById("wnd[0]").sendVKey 0
            WScript.Quit 0
        Else
            If createdAltBom = "" And InStr(LCase(postEnterPopup), "alternative") > 0 Then
                On Error Resume Next
                Set regEx = CreateObject("VBScript.RegExp")
                regEx.Pattern = "alternative\s*0?(\d+)"
                regEx.IgnoreCase = True
                Set matches = regEx.Execute(postEnterPopup)
                If matches.Count > 0 Then
                    createdAltBom = matches(0).SubMatches(0)
                End If
                On Error Goto 0
            End If

            session.findById("wnd[1]").sendVKey 0
            WScript.Sleep 500
        End If
    Loop
    Set tblCtrl = FindComponentTable(session)
End If

' Delay to ensure component table screen is fully loaded
WScript.Sleep 400

' Confirm table control is present before attempting to populate components
If tblCtrl Is Nothing Then
    Dim navErrText, safeNavErr
    navErrText = session.findById("${CS01_FIELD_IDS.STATUS_BAR}").text
    If navErrText = "" Then navErrText = "Could not navigate to CS01 Item Overview table."
    safeNavErr = JsonEscape(navErrText)
    WScript.Echo "{""success"":false,""verified"":false,""code"":""NAVIGATION_FAILED"",""message"":""Navigation Failed: " & safeNavErr & """}"
    session.findById("wnd[0]/tbar[0]/okcd").text = "/n"
    session.findById("wnd[0]").sendVKey 0
    WScript.Quit 0
End If

tblId = tblCtrl.Id

' 3. Populate Components Safely with Dynamic Row Detection and Multi-Page Scrolling
Dim compsCount
compsCount = ${validComponents.length}

Dim compsData(${Math.max(0, validComponents.length - 1)}, 3)
${compDataAssignments}

Dim cIdx, curMat, curQty, curCat, curPos
Dim visRow, visMax, compCell, insertedCount, lastInserted
Dim draftMat, draftQty, draftCat
Dim diagTx, diagScreen, diagTitle, diagSbar

insertedCount = 0
lastInserted = ""
visRow = 0

For cIdx = 0 To compsCount - 1
    curMat = compsData(cIdx, 0)
    curQty = compsData(cIdx, 1)
    curCat = compsData(cIdx, 2)
    curPos = compsData(cIdx, 3)

    If curCat = "" Then curCat = "L"
    If curQty = "" Then curQty = "1"

    ' Refresh table reference and check visible capacity
    Set tblCtrl = FindComponentTable(session)
    If tblCtrl Is Nothing Then
        WScript.Echo "{""success"":false,""verified"":false,""code"":""TABLE_LOST"",""message"":""Lost table control during component entry for ${escapeVbsString(material)}.""}"
        session.findById("wnd[0]/tbar[0]/okcd").text = "/n"
        session.findById("wnd[0]").sendVKey 0
        WScript.Quit 0
    End If

    tblId = tblCtrl.Id
    visMax = tblCtrl.VisibleRowCount
    If visMax <= 0 Then visMax = 16

    ' If current visible rows on this page are exhausted, commit page and advance to New Entries
    If visRow >= visMax Then
        session.findById("wnd[0]").sendVKey 0
        WScript.Sleep 400

        popupLoopCount = 0
        Do While session.Children.Count > 1 And popupLoopCount < 5
            popupLoopCount = popupLoopCount + 1
            session.findById("wnd[1]").sendVKey 0
            WScript.Sleep 300
        Loop

        If session.findById("${CS01_FIELD_IDS.STATUS_BAR}").messageType = "W" Or session.findById("${CS01_FIELD_IDS.STATUS_BAR}").messageType = "I" Then
            session.findById("wnd[0]").sendVKey 0
            WScript.Sleep 300
        End If

        ' Advance to fresh empty rows via New Entries (btn[5] / F5)
        session.findById("wnd[0]/tbar[1]/btn[5]").press
        WScript.Sleep 400

        Set tblCtrl = FindComponentTable(session)
        If tblCtrl Is Nothing Then
            WScript.Echo "{""success"":false,""verified"":false,""code"":""TABLE_LOST"",""message"":""Lost table control after advancing to new entries for ${escapeVbsString(material)}.""}"
            session.findById("wnd[0]/tbar[0]/okcd").text = "/n"
            session.findById("wnd[0]").sendVKey 0
            WScript.Quit 0
        End If
        tblId = tblCtrl.Id
        visRow = 0
    End If

    ' Verify cell control exists BEFORE accessing
    Set compCell = Nothing
    On Error Resume Next
    Set compCell = session.findById(tblId & "/ctxtRC29P-IDNRK[2," & visRow & "]")
    On Error Goto 0

    If compCell Is Nothing Then
        diagTx = session.Info.Transaction
        diagScreen = session.Info.ScreenNumber
        diagTitle = JsonEscape(session.findById("wnd[0]").text)
        diagSbar = JsonEscape(session.findById("${CS01_FIELD_IDS.STATUS_BAR}").text)

        WScript.Echo "{""success"":false,""verified"":false,""code"":""CONTROL_NOT_FOUND"",""message"":""Table control row not found by id at row " & visRow & " on screen " & diagScreen & " (last inserted: " & JsonEscape(lastInserted) & "): " & diagSbar & """,""diagnostics"":{""transaction"":""" & diagTx & """,""screenNumber"":""" & diagScreen & """,""windowTitle"":""" & diagTitle & """,""tableControlId"":""" & JsonEscape(tblId) & """,""requestedRowIndex"":" & visRow & ",""visibleRowCount"":" & visMax & ",""lastInsertedComponent"":""" & JsonEscape(lastInserted) & """,""material"":""${escapeVbsString(material)}"",""targetAlternative"":""" & createdAltBom & """}}"
        session.findById("wnd[0]/tbar[0]/okcd").text = "/n"
        session.findById("wnd[0]").sendVKey 0
        WScript.Quit 0
    End If

    ' Check if existing row in current draft already has this component (Section C)
    draftMat = Trim(compCell.text)
    draftQty = ""
    draftCat = ""
    On Error Resume Next
    draftQty = Trim(session.findById(tblId & "/txtRC29P-MENGE[4," & visRow & "]").text)
    draftCat = Trim(session.findById(tblId & "/ctxtRC29P-POSTP[1," & visRow & "]").text)
    On Error Goto 0

    If draftMat <> "" And UCase(draftMat) = UCase(curMat) And draftQty = curQty And UCase(draftCat) = UCase(curCat) Then
        ' Already present with matching attributes in current draft — do not re-insert
        lastInserted = curMat
        insertedCount = insertedCount + 1
        visRow = visRow + 1
    Else
        If curPos <> "" Then
            On Error Resume Next
            session.findById(tblId & "/txtRC29P-POSNR[0," & visRow & "]").text = curPos
            On Error Goto 0
        End If
        session.findById(tblId & "/ctxtRC29P-POSTP[1," & visRow & "]").text = curCat
        session.findById(tblId & "/ctxtRC29P-IDNRK[2," & visRow & "]").text = curMat
        session.findById(tblId & "/txtRC29P-MENGE[4," & visRow & "]").text = curQty
        session.findById(tblId & "/txtRC29P-MENGE[4," & visRow & "]").setFocus

        lastInserted = curMat
        insertedCount = insertedCount + 1
        visRow = visRow + 1
    End If
Next

' Explicitly send Enter (sendVKey 0) to commit the component row BEFORE moving to Save
session.findById("wnd[0]").sendVKey 0
WScript.Sleep 500

' Check for any error popups after entering components
popupLoopCount = 0
Do While session.Children.Count > 1 And popupLoopCount < 5
    popupLoopCount = popupLoopCount + 1
    Dim itemPopup, safeItemPopup
    itemPopup = GetWindowText(session.findById("wnd[1]"))
    safeItemPopup = JsonEscape(itemPopup)
    If IsHardError(itemPopup) Then
        WScript.Echo "{""success"":false,""verified"":false,""code"":""ITEM_ERROR"",""message"":""Component Validation Error: " & safeItemPopup & """}"
        session.findById("wnd[1]").sendVKey 12
        session.findById("wnd[0]/tbar[0]/okcd").text = "/n"
        session.findById("wnd[0]").sendVKey 0
        WScript.Quit 0
    Else
        session.findById("wnd[1]").sendVKey 0
        WScript.Sleep 300
    End If
Loop

' Check status bar for item validation issues
Dim itemSbarType, itemSbarText, safeItemSbar
itemSbarType = session.findById("${CS01_FIELD_IDS.STATUS_BAR}").messageType
itemSbarText = session.findById("${CS01_FIELD_IDS.STATUS_BAR}").text
safeItemSbar = JsonEscape(itemSbarText)

If itemSbarType = "E" Or itemSbarType = "A" Then
    WScript.Echo "{""success"":false,""verified"":false,""code"":""ITEM_ERROR"",""message"":""Component Validation Error: " & safeItemSbar & """}"
    session.findById("wnd[0]/tbar[0]/okcd").text = "/n"
    session.findById("wnd[0]").sendVKey 0
    WScript.Quit 0
End If

' Clear any warning/info before pressing Save
Dim sbarAck, curSbarType
For sbarAck = 1 To 5
    curSbarType = session.findById("${CS01_FIELD_IDS.STATUS_BAR}").messageType
    If curSbarType = "W" Or curSbarType = "I" Then
        session.findById("wnd[0]").sendVKey 0
        WScript.Sleep 300
    Else
        Exit For
    End If
Next

' 4. Save BOM (Ctrl+S / btn[11])
session.findById("${CS01_FIELD_IDS.SAVE_BUTTON}").press
WScript.Sleep 600

' Check if a confirmation or warning popup appeared upon Save
popupLoopCount = 0
Do While session.Children.Count > 1 And popupLoopCount < 5
    popupLoopCount = popupLoopCount + 1
    Dim savePopup, safeSavePopup
    savePopup = GetWindowText(session.findById("wnd[1]"))
    safeSavePopup = JsonEscape(savePopup)
    If IsHardError(savePopup) Then
        WScript.Echo "{""success"":false,""verified"":false,""code"":""BOM_SAVE_FAILED"",""message"":""Save Error: " & safeSavePopup & """}"
        session.findById("wnd[1]").sendVKey 12
        session.findById("wnd[0]/tbar[0]/okcd").text = "/n"
        session.findById("wnd[0]").sendVKey 0
        WScript.Quit 0
    Else
        session.findById("wnd[1]").sendVKey 0
        WScript.Sleep 300
    End If
Loop

' Dismiss any warning/info on main screen after save (confirm with Enter)
For sbarAck = 1 To 5
    curSbarType = session.findById("${CS01_FIELD_IDS.STATUS_BAR}").messageType
    If curSbarType = "W" Or curSbarType = "I" Then
        session.findById("wnd[0]").sendVKey 0
        WScript.Sleep 500
    Else
        Exit For
    End If
Next

' 5. Read Status Bar after save
Dim sbarText, sbarType, safeSaveSbar
sbarText = session.findById("${CS01_FIELD_IDS.STATUS_BAR}").text
sbarType = session.findById("${CS01_FIELD_IDS.STATUS_BAR}").messageType
safeSaveSbar = JsonEscape(sbarText)

If sbarType = "E" Or sbarType = "A" Then
    WScript.Echo "{""success"":false,""verified"":false,""code"":""BOM_SAVE_FAILED"",""message"":""Save Error: " & safeSaveSbar & """}"
    session.findById("wnd[0]/tbar[0]/okcd").text = "/n"
    session.findById("wnd[0]").sendVKey 0
    WScript.Quit 0
End If

Dim safeSaveMsg
safeSaveMsg = safeSaveSbar
If safeSaveMsg = "" Then safeSaveMsg = "BOM created in CS01 via SAP GUI Scripting."

' If createdAltBom was not yet detected, check if status bar mentions it
If createdAltBom = "" And InStr(LCase(sbarText), "alternative") > 0 Then
    On Error Resume Next
    Set regEx = CreateObject("VBScript.RegExp")
    regEx.Pattern = "alternative\s*0?(\d+)"
    regEx.IgnoreCase = True
    Set matches = regEx.Execute(sbarText)
    If matches.Count > 0 Then
        createdAltBom = matches(0).SubMatches(0)
    End If
    On Error Goto 0
End If

' 6. POST-SAVE VERIFICATION (CS03)
' STANDING RULE: Verify written data in SAP GUI before reporting success!
session.findById("wnd[0]/tbar[0]/okcd").text = "/nCS03"
session.findById("wnd[0]").sendVKey 0
WScript.Sleep 500

popupLoopCount = 0
Do While session.Children.Count > 1 And popupLoopCount < 5
    popupLoopCount = popupLoopCount + 1
    session.findById("wnd[1]").sendVKey 0
    WScript.Sleep 300
Loop

' Fill CS03 Initial Screen
session.findById("${CS01_FIELD_IDS.MATERIAL}").text = "${escapeVbsString(material)}"
session.findById("${CS01_FIELD_IDS.PLANT}").text = "${escapeVbsString(plant)}"
session.findById("${CS01_FIELD_IDS.BOM_USAGE}").text = "${escapeVbsString(bomUsage)}"
If createdAltBom <> "" Then
    session.findById("${CS01_FIELD_IDS.ALT_BOM}").text = createdAltBom
End If

' Press Enter into CS03 Item Overview
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

' If CS03 shows Alternative Overview (Screen 187/0187) because multiple alternatives exist:
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
Dim verifiedComp, verifiedQty, verifiedItemCat
verifiedComp = ""
verifiedQty = ""
verifiedItemCat = ""

On Error Resume Next
verifiedComp = Trim(session.findById("${CS01_FIELD_IDS.TABLE_BASE}/${CS01_FIELD_IDS.COMPONENT_FIELD}[2,0]").text)
If Err.Number <> 0 Or verifiedComp = "" Then
    Err.Clear
    verifiedComp = Trim(session.findById("${CS01_FIELD_IDS.TABLE_BASE}/txtRC29P-IDNRK[2,0]").text)
End If
verifiedQty = Trim(session.findById("${CS01_FIELD_IDS.TABLE_BASE}/${CS01_FIELD_IDS.QUANTITY_FIELD}[4,0]").text)
verifiedItemCat = Trim(session.findById("${CS01_FIELD_IDS.TABLE_BASE}/${CS01_FIELD_IDS.ITEM_CATEGORY_FIELD}[1,0]").text)
On Error Goto 0

' Always navigate back to main screen (/n)
session.findById("wnd[0]/tbar[0]/okcd").text = "/n"
session.findById("wnd[0]").sendVKey 0

Dim safeComp, safeQty, safeCat, safeEmptyMsg
safeComp = JsonEscape(verifiedComp)
safeQty = JsonEscape(verifiedQty)
safeCat = JsonEscape(verifiedItemCat)
safeEmptyMsg = JsonEscape(safeSaveMsg)

' VERIFICATION CHECK: Treat empty component table as FAILURE
If verifiedComp = "" Then
    WScript.Echo "{""success"":false,""verified"":false,""code"":""VERIFICATION_FAILED_EMPTY_COMPONENTS"",""message"":""Verification failed in CS03: BOM was saved in CS01 (" & safeEmptyMsg & "), but the component table is EMPTY. No component rows were saved in SAP."",""material"":""${escapeVbsString(material)}"",""plant"":""${escapeVbsString(plant)}""}"
    WScript.Quit 0
End If

' VERIFICATION PASSED: Confirmed in CS03
WScript.Echo "{""success"":true,""verified"":true,""message"":""" & safeEmptyMsg & " [Verified in CS03: Component " & safeComp & " (Qty " & safeQty & ", Category " & safeCat & ") confirmed saved]"",""verifiedComponent"":""" & safeComp & """,""verifiedQty"":""" & safeQty & """,""verifiedItemCategory"":""" & safeCat & """,""alternativeBom"":""" & createdAltBom & """,""material"":""${escapeVbsString(material)}"",""plant"":""${escapeVbsString(plant)}""}"
`;

  try {
    const { stdout, stderr } = await runVbsScript(vbsScript, 45000);

    if (stderr) {
      console.warn('[sapGuiClient] Script stderr:', stderr);
    }

    if (!stdout) {
      return {
        success: false,
        verified: false,
        code: 'EMPTY_OUTPUT',
        message: 'No status returned from SAP GUI automation. Please check SAP GUI window.',
        before: null,
        after: null
      };
    }

    let parsedResult;
    try {
      parsedResult = JSON.parse(stdout);
    } catch (parseErr) {
      return {
        success: false,
        verified: false,
        code: 'PARSE_ERROR',
        message: `SAP GUI Scripting completed with unparsed response: ${stdout}`,
        before: null,
        after: null
      };
    }

    if (!parsedResult.success || parsedResult.verified === false) {
      return {
        success: false,
        verified: false,
        code: parsedResult.code || 'GUI_CREATION_FAILED',
        message: parsedResult.message || 'BOM creation failed or could not be verified in SAP GUI.',
        before: null,
        after: null
      };
    }

    // Build standard entity record response for chat / audit flow
    const createdRecord = {
      material,
      plant,
      bomUsage,
      alternativeBom: parsedResult.alternativeBom || alternativeBom || '1',
      validFrom,
      components: normalizedComponents,
      verifiedInSap: true,
      verifiedComponent: parsedResult.verifiedComponent,
      verifiedQty: parsedResult.verifiedQty,
      verifiedItemCategory: parsedResult.verifiedItemCategory,
      status: 'CREATED_AND_VERIFIED_VIA_GUI',
      guiMessage: parsedResult.message,
      createdAt: new Date().toISOString()
    };

    return {
      success: true,
      verified: true,
      bomNumber: parsedResult.bomNumber || material,
      message: parsedResult.message,
      before: null,
      after: createdRecord
    };
  } catch (err) {
    return {
      success: false,
      verified: false,
      code: 'AUTOMATION_ERROR',
      message: `SAP GUI Scripting execution error: ${err.message}`,
      before: null,
      after: null
    };
  }
}

/**
 * Automates CS01 BOM creation by copying an existing/reference BOM via SAP GUI Scripting.
 *
 * @param {object} params
 * @param {object} params.source
 * @param {string} params.source.material - Source/Reference Material
 * @param {string} params.source.plant - Source Plant
 * @param {string} [params.source.bomUsage='1'] - Source BOM Usage
 * @param {string} [params.source.alternativeBom=''] - Source Alternative BOM
 * @param {object} params.target
 * @param {string} params.target.material - Target Material
 * @param {string} params.target.plant - Target Plant
 * @param {string} [params.target.bomUsage='1'] - Target BOM Usage
 * @param {string} [params.target.alternativeBom=''] - Target Alternative BOM
 * @param {string} [params.target.validFrom=''] - Target Valid From Date
 * @returns {Promise<{ success: boolean, verified: boolean, code?: string, message: string, before?: object, after?: object, capturedControls?: object }>}
 */
export async function copyBomViaGui(params) {
  const { source, target } = params || {};

  if (!source?.material || !source?.plant) {
    throw new Error('Source Material and Plant are required for Copy From BOM workflow.');
  }
  if (!target?.material || !target?.plant) {
    throw new Error('Target Material and Plant are required for Copy From BOM workflow.');
  }

  const cleanSourceMat = String(source.material || '').trim().toUpperCase();
  const cleanTargetMat = String(target.material || '').trim().toUpperCase();
  const cleanSourcePlant = String(source.plant || '').trim();
  const cleanTargetPlant = String(target.plant || '').trim();
  const cleanSourceUsage = String(source.bomUsage || '1').trim();
  const cleanTargetUsage = String(target.bomUsage || '1').trim();
  const cleanSourceAlt = String(source.alternativeBom || '').trim();
  const cleanTargetAlt = String(target.alternativeBom || '').trim();

  // Operation preflight check
  const preflight = await ensureSapSession();
  if (!preflight.ok) {
    return {
      success: false,
      verified: false,
      code: preflight.status === 'SERVER_UNAVAILABLE' ? 'SAP_SERVER_UNAVAILABLE' : (preflight.code || 'SAP_SESSION_NOT_FOUND'),
      status: preflight.status,
      message: preflight.message
    };
  }

  if (process.env.USE_MOCK_SAP === 'true' && process.env.TEST_SIMULATE_DISCONNECT_DURING_OP === 'true') {
    return {
      success: false,
      verified: false,
      code: 'SAP_CONNECTION_LOST',
      message: 'Connection to SAP was lost during BOM creation. The final state could not be verified. Please check the target BOM in CS03 before retrying.'
    };
  }

  // Rule 7: Prevent copying when source and target refer to the same BOM
  if (
    cleanSourceMat === cleanTargetMat &&
    cleanSourcePlant === cleanTargetPlant &&
    cleanSourceUsage === cleanTargetUsage &&
    cleanSourceAlt === cleanTargetAlt
  ) {
    return {
      success: false,
      verified: false,
      code: 'SAME_SOURCE_TARGET',
      message: 'Source and target BOM are the same. A BOM cannot be copied onto itself.'
    };
  }

  // Rule 1, 2, 3, 4, 9: Validate source BOM exists in CS03 before opening CS01
  let sourceCheck;
  if (params.skipSourceCheck && params.sourceComponents && params.sourceComponents.length > 0) {
    sourceCheck = {
      success: true,
      exists: true,
      components: params.sourceComponents,
      componentCount: params.sourceComponents.length,
      availableAlternatives: params.availableAlternatives || [cleanSourceAlt || '1']
    };
  } else {
    sourceCheck = await verifyBomInCs03({
      material: cleanSourceMat,
      plant: cleanSourcePlant,
      bomUsage: cleanSourceUsage,
      alternativeBom: cleanSourceAlt
    });
  }

  if (!sourceCheck.success) {
    return {
      success: false,
      verified: false,
      code: sourceCheck.code || 'SOURCE_LOOKUP_UNAVAILABLE',
      status: sourceCheck.status,
      message: sourceCheck.message || 'Cannot verify source BOM: SAP GUI session not available. Workflow stopped.'
    };
  }

  if (!sourceCheck.exists) {
    return {
      success: false,
      verified: false,
      code: 'SOURCE_BOM_NOT_FOUND',
      message: sourceCheck.message && sourceCheck.message.includes('Alternative')
        ? `Cannot copy BOM: ${sourceCheck.message}`
        : `Cannot copy BOM: No BOM exists for material ${cleanSourceMat} in plant ${cleanSourcePlant} with BOM usage ${cleanSourceUsage}.`
    };
  }

  if (process.env.USE_MOCK_SAP === 'true') {
    // Look up source components in activeMockBomDataset
    const srcMatch = activeMockBomDataset.find(
      (b) => b.material.toUpperCase() === cleanSourceMat && b.plant === cleanSourcePlant && b.bomUsage === cleanSourceUsage
    );
    const srcComps = (sourceCheck.components && sourceCheck.components.length > 0)
      ? JSON.parse(JSON.stringify(sourceCheck.components))
      : (srcMatch ? JSON.parse(JSON.stringify(srcMatch.components || [])) : []);

    // Insert or update target in activeMockBomDataset
    const existingTargetIndex = activeMockBomDataset.findIndex(
      (b) => b.material.toUpperCase() === cleanTargetMat && b.plant === cleanTargetPlant && b.bomUsage === cleanTargetUsage
    );

    const targetAlreadyExists = existingTargetIndex >= 0;
    const isCrossPlantExistingBom = (cleanSourcePlant !== cleanTargetPlant) && targetAlreadyExists;
    const executionPath = isCrossPlantExistingBom ? 'CROSS_PLANT_DIRECT_ENTRY' : 'NATIVE_COPY_FROM';

    let resolvedTargetAlt = cleanTargetAlt;
    if (existingTargetIndex >= 0) {
      const existing = activeMockBomDataset[existingTargetIndex];
      const existingAlts = existing.availableAlternatives || ['1'];
      resolvedTargetAlt = resolveNextAvailableAlternative(existingAlts, cleanTargetAlt);

      if (!existing.availableAlternatives.includes(resolvedTargetAlt)) {
        existing.availableAlternatives.push(resolvedTargetAlt);
      }

      // Preserve per-alternative components so existing alternatives are NOT overwritten
      if (!existing.alternativeComponents) {
        existing.alternativeComponents = {};
        const firstAlt = existingAlts[0] || '1';
        existing.alternativeComponents[firstAlt] = JSON.parse(JSON.stringify(existing.components || []));
      }
      existing.alternativeComponents[resolvedTargetAlt] = JSON.parse(JSON.stringify(srcComps));
      existing.components = srcComps;
      existing.componentCount = srcComps.length;
    } else {
      resolvedTargetAlt = resolveNextAvailableAlternative([], cleanTargetAlt);
      activeMockBomDataset.push({
        material: cleanTargetMat,
        plant: cleanTargetPlant,
        bomUsage: cleanTargetUsage,
        availableAlternatives: [resolvedTargetAlt],
        componentCount: srcComps.length || 1,
        components: srcComps,
        alternativeComponents: {
          [resolvedTargetAlt]: JSON.parse(JSON.stringify(srcComps))
        }
      });
    }

    // Verify target in CS03 (evaluating dynamic assembly indicators)
    const targetCs03 = await verifyBomInCs03({
      material: cleanTargetMat,
      plant: cleanTargetPlant,
      bomUsage: cleanTargetUsage,
      alternativeBom: resolvedTargetAlt
    });

    // Run structural comparison replacing count-only check
    const comparison = compareBomStructures({
      sourceComponents: sourceCheck.components || srcComps,
      targetComponents: targetCs03.components || [],
      targetPlant: cleanTargetPlant,
      missingSubBomMaterials: params.missingSubBomMaterials || [],
      copiedMainOnly: params.copiedMainOnly !== undefined ? Boolean(params.copiedMainOnly) : true,
      allowMissingSubBoms: Boolean(params.allowMissingSubBoms)
    });

    if (!comparison.match) {
      return {
        success: false,
        verified: false,
        code: 'STRUCTURAL_VERIFICATION_FAILED',
        message: comparison.summary,
        differences: comparison.differences,
        before: null,
        after: null
      };
    }

    const createdRecord = {
      material: cleanTargetMat,
      plant: cleanTargetPlant,
      bomUsage: cleanTargetUsage,
      alternativeBom: resolvedTargetAlt,
      validFrom: target.validFrom || '',
      components: targetCs03.components || [],
      warnings: comparison.warnings,
      executionPath,
      isCrossPlantExistingBom,
      status: comparison.status === 'SUCCESS_WITH_WARNINGS' ? 'COPIED_WITH_WARNINGS_VIA_GUI' : 'COPIED_AND_VERIFIED_VIA_GUI'
    };

    return {
      success: true,
      verified: true,
      status: comparison.status,
      warnings: comparison.warnings,
      executionPath,
      isCrossPlantExistingBom,
      code: comparison.status === 'SUCCESS_WITH_WARNINGS' ? 'BOM_COPIED_WITH_WARNINGS' : 'BOM_COPIED_AND_VERIFIED',
      message: comparison.status === 'SUCCESS_WITH_WARNINGS'
        ? `BOM for material ${cleanTargetMat} created in plant ${cleanTargetPlant} (Usage ${cleanTargetUsage}, Alt ${resolvedTargetAlt}) copied from ${cleanSourceMat}/${cleanSourcePlant}. [SUCCESS_WITH_WARNINGS: ${comparison.warnings.map(w => w.reason).join('; ')}]`
        : `BOM for material ${cleanTargetMat} created in plant ${cleanTargetPlant} (Usage ${cleanTargetUsage}, Alt ${resolvedTargetAlt}) copied from ${cleanSourceMat}/${cleanSourcePlant} and verified in CS03.`,
      before: null,
      after: createdRecord,
      alternativeBom: resolvedTargetAlt
    };
  }

  // Resolve target alternative if target BOM already exists and alternative is not specified
  let targetCheck = null;
  targetCheck = await verifyBomInCs03({
    material: cleanTargetMat,
    plant: cleanTargetPlant,
    bomUsage: cleanTargetUsage
  });

  const targetAlreadyExists = Boolean(targetCheck?.success && targetCheck?.exists);
  const resolvedTargetAlt = targetAlreadyExists
    ? resolveNextAvailableAlternative(targetCheck.availableAlternatives || ['1'], cleanTargetAlt)
    : resolveNextAvailableAlternative([], cleanTargetAlt);

  const isCrossPlantExistingBom = (cleanSourcePlant !== cleanTargetPlant) && targetAlreadyExists;

  if (isCrossPlantExistingBom) {
    // PATH B: Cross-Plant Existing BOM
    // When target material already has existing alternatives in target plant and sourcePlant !== targetPlant,
    // SAP CS01 Copy From popup locks the reference plant to target plant.
    // Therefore, do NOT use the Copy From popup; populate target alternative directly from verified source components.
    const sourceComps = sourceCheck.components || [];
    if (!sourceComps || sourceComps.length === 0) {
      return {
        success: false,
        verified: false,
        code: 'SOURCE_BOM_EMPTY',
        message: `Cannot copy BOM: Source BOM for material ${cleanSourceMat} in plant ${cleanSourcePlant} (Alt ${cleanSourceAlt || '1'}) has no components.`
      };
    }

    const createParams = {
      material: cleanTargetMat,
      plant: cleanTargetPlant,
      bomUsage: cleanTargetUsage,
      validFrom: target.validFrom || '',
      alternativeBom: resolvedTargetAlt,
      components: sourceComps.map((c, idx) => ({
        item: c.item || c.posnr || String((idx + 1) * 10).padStart(4, '0'),
        material: c.material || c.component || '',
        component: c.material || c.component || '',
        quantity: c.quantity || c.qty || '1',
        unit: c.unit || 'KG',
        itemCategory: c.itemCategory || c.postp || 'L',
        description: c.description || '',
        assembly: Boolean(c.assembly)
      }))
    };

    const createRes = await createBomViaGui(createParams);
    if (!createRes.success || createRes.verified === false) {
      return {
        success: false,
        verified: false,
        code: createRes.code || 'BOM_CREATE_FAILED',
        message: `Failed to create Alternative ${resolvedTargetAlt} for material ${cleanTargetMat} in plant ${cleanTargetPlant}: ${createRes.message || 'Operation failed'}.`
      };
    }

    // Verify exact newly created target alternative in CS03
    const targetCs03 = await verifyBomInCs03({
      material: cleanTargetMat,
      plant: cleanTargetPlant,
      bomUsage: cleanTargetUsage,
      alternativeBom: resolvedTargetAlt
    });

    // Run structural comparison
    const comparison = compareBomStructures({
      sourceComponents: sourceComps,
      targetComponents: targetCs03.components || [],
      targetPlant: cleanTargetPlant,
      missingSubBomMaterials: params.missingSubBomMaterials || [],
      copiedMainOnly: params.copiedMainOnly !== undefined ? Boolean(params.copiedMainOnly) : true,
      allowMissingSubBoms: Boolean(params.allowMissingSubBoms)
    });

    if (!comparison.match) {
      return {
        success: false,
        verified: false,
        code: 'STRUCTURAL_VERIFICATION_FAILED',
        message: comparison.summary,
        differences: comparison.differences,
        before: null,
        after: null
      };
    }

    const createdRecord = {
      material: cleanTargetMat,
      plant: cleanTargetPlant,
      bomUsage: cleanTargetUsage,
      alternativeBom: resolvedTargetAlt,
      validFrom: target.validFrom || '',
      components: targetCs03.components || [],
      warnings: comparison.warnings,
      executionPath: 'CROSS_PLANT_DIRECT_ENTRY',
      isCrossPlantExistingBom: true,
      status: comparison.status === 'SUCCESS_WITH_WARNINGS' ? 'COPIED_WITH_WARNINGS_VIA_GUI' : 'COPIED_AND_VERIFIED_VIA_GUI'
    };

    return {
      success: true,
      verified: true,
      status: comparison.status,
      warnings: comparison.warnings,
      executionPath: 'CROSS_PLANT_DIRECT_ENTRY',
      isCrossPlantExistingBom: true,
      code: comparison.status === 'SUCCESS_WITH_WARNINGS' ? 'BOM_COPIED_WITH_WARNINGS' : 'BOM_COPIED_AND_VERIFIED',
      message: comparison.status === 'SUCCESS_WITH_WARNINGS'
        ? `BOM for material ${cleanTargetMat} created in plant ${cleanTargetPlant} (Usage ${cleanTargetUsage}, Alt ${resolvedTargetAlt}) created directly from source components ${cleanSourceMat}/${cleanSourcePlant} (cross-plant alternative). [SUCCESS_WITH_WARNINGS: ${comparison.warnings.map(w => w.reason).join('; ')}]`
        : `BOM for material ${cleanTargetMat} created in plant ${cleanTargetPlant} (Usage ${cleanTargetUsage}, Alt ${resolvedTargetAlt}) created directly from source components ${cleanSourceMat}/${cleanSourcePlant} (cross-plant alternative) and verified in CS03.`,
      before: null,
      after: createdRecord,
      alternativeBom: resolvedTargetAlt
    };
  }

  const sourceMaterial = escapeVbsString(source.material);
  const sourcePlant = escapeVbsString(source.plant);
  const sourceBomUsage = escapeVbsString(source.bomUsage || '1');
  const sourceAltBom = escapeVbsString(source.alternativeBom || '');

  const targetMaterial = escapeVbsString(target.material);
  const targetPlant = escapeVbsString(target.plant);
  const targetBomUsage = escapeVbsString(target.bomUsage || '1');
  const targetAltBom = escapeVbsString(resolvedTargetAlt || target.alternativeBom || '');
  const targetValidFrom = escapeVbsString(target.validFrom || '');
  const targetSessionPath = preflight.sessionPath || '';
  const expectedUser = preflight.user || '';

  const vbsScript = `
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

${getSessionDiscoveryVbs(targetSessionPath, expectedUser)}

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
session.findById("${CS01_FIELD_IDS.MATERIAL}").text = "${targetMaterial}"
session.findById("${CS01_FIELD_IDS.PLANT}").text = "${targetPlant}"
session.findById("${CS01_FIELD_IDS.BOM_USAGE}").text = "${targetBomUsage}"
${targetAltBom ? `session.findById("${CS01_FIELD_IDS.ALT_BOM}").text = "${targetAltBom}"` : ''}
${targetValidFrom ? `session.findById("${CS01_FIELD_IDS.VALID_FROM}").text = "${targetValidFrom}"` : ''}

Dim createdAltBom
createdAltBom = "${targetAltBom}"

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
Dim wnd1, fldRefMat, fldRefPlt, fldRefUsg, fldRefAlt
Set wnd1 = session.findById("wnd[1]")
Set fldRefMat = Nothing
Set fldRefPlt = Nothing
Set fldRefUsg = Nothing
Set fldRefAlt = Nothing

On Error Resume Next
Set fldRefMat = wnd1.findById("usr/ctxtRC29N-MATNR")
Set fldRefPlt = wnd1.findById("usr/ctxtRC29N-WERKS")
Set fldRefUsg = wnd1.findById("usr/ctxtRC29N-STLAN")
Set fldRefAlt = wnd1.findById("usr/txtRC29N-STLAL")
On Error Goto 0

' Safely assign only changeable fields to avoid SAP Frontend Server invalid argument COM error 613
If Not fldRefMat Is Nothing Then
    If fldRefMat.changeable Then fldRefMat.text = "${sourceMaterial}"
End If
If Not fldRefPlt Is Nothing Then
    If fldRefPlt.changeable Then fldRefPlt.text = "${sourcePlant}"
End If
If Not fldRefUsg Is Nothing Then
    If fldRefUsg.changeable Then fldRefUsg.text = "${sourceBomUsage}"
End If
If Not fldRefAlt Is Nothing Then
    If fldRefAlt.changeable And "${sourceAltBom}" <> "" Then
        fldRefAlt.text = "${sourceAltBom}"
    End If
End If

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
    matchAlt = "${sourceAltBom}"
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
        ' If matchAlt was not found or sourceAltBom was not explicitly specified, pick the first available non-empty row
        If foundAltRow < 0 Then
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
        WScript.Echo "{""success"":false,""verified"":false,""code"":""SOURCE_BOM_NOT_FOUND"",""message"":""Cannot copy BOM: Alternative " & matchAlt & " does not exist for material ${sourceMaterial} in plant ${sourcePlant}."",""sourceMaterial"":""${sourceMaterial}"",""sourcePlant"":""${sourcePlant}""}"
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

' Check status bar and dialogs after copy operation
' Handle known SAP component validation sequence (e.g. Storage location not supported in target plant)
Dim validationEnterCount, curValMsg, postPopTxt
validationEnterCount = 0

Do While validationEnterCount < 20
    curValMsg = CheckStorageLocValidation(session)
    If curValMsg <> "" Then
        validationEnterCount = validationEnterCount + 1
        If session.Children.Count > 1 Then
            session.findById("wnd[1]").sendVKey 0
        Else
            session.findById("wnd[0]").sendVKey 0
        End If
        WScript.Sleep 400
    ElseIf session.Children.Count > 1 Then
        postPopTxt = GetWindowText(session.findById("wnd[1]"))
        If IsHardError(postPopTxt) Then
            WScript.Echo "{""success"":false,""verified"":false,""code"":""COPY_FAILED"",""message"":""Copy Error: " & JsonEscape(postPopTxt) & """}"
            session.findById("wnd[1]").sendVKey 12
            session.findById("wnd[0]/tbar[0]/okcd").text = "/n"
            session.findById("wnd[0]").sendVKey 0
            WScript.Quit 0
        Else
            validationEnterCount = validationEnterCount + 1
            session.findById("wnd[1]").sendVKey 0
            WScript.Sleep 400
        End If
    ElseIf session.findById("${CS01_FIELD_IDS.STATUS_BAR}").messageType = "W" Or session.findById("${CS01_FIELD_IDS.STATUS_BAR}").messageType = "I" Then
        validationEnterCount = validationEnterCount + 1
        session.findById("wnd[0]").sendVKey 0
        WScript.Sleep 400
    Else
        Exit Do
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

session.findById("${CS01_FIELD_IDS.MATERIAL}").text = "${targetMaterial}"
session.findById("${CS01_FIELD_IDS.PLANT}").text = "${targetPlant}"
session.findById("${CS01_FIELD_IDS.BOM_USAGE}").text = "${targetBomUsage}"
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
    WScript.Echo "{""success"":false,""verified"":false,""code"":""VERIFICATION_FAILED_EMPTY_COMPONENTS"",""message"":""Verification failed in CS03: Target BOM was saved (" & safeSaveMsg & "), but the component table is EMPTY in CS03."",""targetMaterial"":""${targetMaterial}"",""targetPlant"":""${targetPlant}""}"
    WScript.Quit 0
End If

Dim valEntersMsg
If validationEnterCount > 0 Then
    valEntersMsg = " (Acknowledged " & validationEnterCount & " storage location validation messages)"
Else
    valEntersMsg = ""
End If

' SUCCESS
WScript.Echo "{""success"":true,""verified"":true,""message"":""" & safeSaveMsg & valEntersMsg & " [Verified in CS03: Component " & safeCs03Comp & " (Qty " & safeCs03Qty & ", Category " & safeCs03Cat & ") confirmed saved]"",""verifiedComponent"":""" & safeCs03Comp & """,""verifiedQty"":""" & safeCs03Qty & """,""verifiedItemCategory"":""" & safeCs03Cat & """,""alternativeBom"":""" & createdAltBom & """,""targetMaterial"":""${targetMaterial}"",""targetPlant"":""${targetPlant}"",""sourceMaterial"":""${sourceMaterial}"",""sourcePlant"":""${sourcePlant}"",""validationEntersCount"":" & validationEnterCount & ",""copiedComponents"":" & copiedComponentsJson & ",""capturedControls"":{""copyButton"":""${CS01_FIELD_IDS.COPY_BUTTON}"",""popupTitle"":""" & JsonEscape(copyPopupTitle) & """,""refMaterialField"":""" & JsonEscape(capturedRefMatId) & """,""refPlantField"":""" & JsonEscape(capturedRefPlantId) & """,""refUsageField"":""" & JsonEscape(capturedRefUsageId) & """,""refAltBomField"":""" & JsonEscape(capturedRefAltId) & """,""popupConfirmButton"":""${CS01_FIELD_IDS.COPY_POPUP_CONFIRM}""}}"
`;

  try {
    const { stdout, stderr } = await runVbsScript(vbsScript, 45000);

    if (stderr) {
      console.warn('[sapGuiClient] Copy BOM stderr:', stderr);
    }

    if (!stdout) {
      return {
        success: false,
        verified: false,
        code: 'EMPTY_OUTPUT',
        message: 'No status returned from SAP GUI automation. Please check SAP GUI window.',
        before: null,
        after: null
      };
    }

    let parsedResult;
    try {
      parsedResult = JSON.parse(stdout);
    } catch (parseErr) {
      if (stdout.includes('Microsoft VBScript compilation error') || stdout.includes('compilation error')) {
        const compErrMatch = stdout.match(/Microsoft VBScript compilation error:\s*([^\r\n]+)/i) ||
                             stdout.match(/compilation error:\s*([^\r\n]+)/i);
        const errDetail = compErrMatch ? compErrMatch[1].trim() : 'Compilation error';
        const lineMatch = stdout.match(/\((\d+),\s*(\d+)\)/);
        const lineInfo = lineMatch ? ` (line ${lineMatch[1]}, column ${lineMatch[2]})` : '';
        return {
          success: false,
          verified: false,
          code: 'VBSCRIPT_COMPILATION_ERROR',
          message: `Copy failed before SAP execution: generated VBScript compilation error — ${errDetail}${lineInfo}.`,
          before: null,
          after: null
        };
      }

      if (stdout.includes('Microsoft VBScript runtime error') || stdout.includes('runtime error')) {
        const rtErrMatch = stdout.match(/Microsoft VBScript runtime error:\s*([^\r\n]+)/i) ||
                           stdout.match(/runtime error:\s*([^\r\n]+)/i);
        const errDetail = rtErrMatch ? rtErrMatch[1].trim() : 'Runtime error';
        const lineMatch = stdout.match(/\((\d+),\s*(\d+)\)/);
        const lineInfo = lineMatch ? ` (line ${lineMatch[1]}, column ${lineMatch[2]})` : '';
        return {
          success: false,
          verified: false,
          code: 'VBSCRIPT_RUNTIME_ERROR',
          message: `Copy failed during SAP execution: VBScript runtime error — ${errDetail}${lineInfo}.`,
          before: null,
          after: null
        };
      }

      return {
        success: false,
        verified: false,
        code: 'PARSE_ERROR',
        message: `SAP GUI Scripting completed with unparsed response: ${stdout}`,
        before: null,
        after: null
      };
    }

    if (!parsedResult.success || parsedResult.verified === false) {
      return {
        success: false,
        verified: false,
        code: parsedResult.code || 'GUI_COPY_FAILED',
        message: parsedResult.message || 'Copy From BOM failed or could not be verified in SAP GUI.',
        before: null,
        after: null,
        capturedControls: parsedResult.capturedControls || null
      };
    }

    const targetCs03 = await verifyBomInCs03({
      material: cleanTargetMat,
      plant: cleanTargetPlant,
      bomUsage: cleanTargetUsage,
      alternativeBom: parsedResult.alternativeBom || cleanTargetAlt || '1'
    });

    const comparison = compareBomStructures({
      sourceComponents: sourceCheck.components || [],
      targetComponents: targetCs03.components || parsedResult.copiedComponents || [],
      targetPlant: cleanTargetPlant,
      missingSubBomMaterials: params.missingSubBomMaterials || [],
      copiedMainOnly: params.copiedMainOnly !== undefined ? Boolean(params.copiedMainOnly) : true,
      allowMissingSubBoms: Boolean(params.allowMissingSubBoms)
    });

    if (!comparison.match) {
      return {
        success: false,
        verified: false,
        code: 'STRUCTURAL_VERIFICATION_FAILED',
        message: comparison.summary,
        differences: comparison.differences,
        before: null,
        after: null
      };
    }

    const createdRecord = {
      material: target.material,
      plant: target.plant,
      bomUsage: target.bomUsage || '1',
      alternativeBom: parsedResult.alternativeBom || target.alternativeBom || '1',
      sourceReference: {
        material: source.material,
        plant: source.plant,
        bomUsage: source.bomUsage || '1',
        alternativeBom: source.alternativeBom || ''
      },
      components: targetCs03.components || parsedResult.copiedComponents || [],
      warnings: comparison.warnings,
      verifiedInSap: true,
      verifiedComponent: parsedResult.verifiedComponent,
      verifiedQty: parsedResult.verifiedQty,
      verifiedItemCategory: parsedResult.verifiedItemCategory,
      validationEntersCount: parsedResult.validationEntersCount || 0,
      executionPath: 'NATIVE_COPY_FROM',
      isCrossPlantExistingBom: false,
      status: comparison.status === 'SUCCESS_WITH_WARNINGS' ? 'COPIED_WITH_WARNINGS_VIA_GUI' : 'COPIED_AND_VERIFIED_VIA_GUI',
      guiMessage: parsedResult.message,
      capturedControls: parsedResult.capturedControls,
      createdAt: new Date().toISOString()
    };

    if (parsedResult.validationEntersCount > 0) {
      console.log(`[sapGuiClient] Acknowledged ${parsedResult.validationEntersCount} storage location validation messages via Enter during Copy-From.`);
    }

    return {
      success: true,
      verified: true,
      status: comparison.status,
      warnings: comparison.warnings,
      executionPath: 'NATIVE_COPY_FROM',
      isCrossPlantExistingBom: false,
      alternativeBom: parsedResult.alternativeBom || target.alternativeBom || '1',
      bomNumber: parsedResult.bomNumber || target.material,
      message: comparison.status === 'SUCCESS_WITH_WARNINGS'
        ? `${parsedResult.message} [SUCCESS_WITH_WARNINGS: ${comparison.warnings.map(w => w.reason).join('; ')}]`
        : parsedResult.message,
      validationEntersCount: parsedResult.validationEntersCount || 0,
      capturedControls: parsedResult.capturedControls,
      before: null,
      after: createdRecord
    };
  } catch (err) {
    const health = await checkSapSessionHealth();
    if (!health.connected) {
      return {
        success: false,
        verified: false,
        code: 'SAP_CONNECTION_LOST',
        status: health.status,
        message: 'Connection to SAP was lost during BOM creation. The final state could not be verified. Please check the target BOM in CS03 before retrying.',
        before: null,
        after: null
      };
    }
    return {
      success: false,
      verified: false,
      code: 'AUTOMATION_ERROR',
      message: `SAP GUI Scripting execution error: ${err.message}`,
      before: null,
      after: null
    };
  }
}

/**
 * Standalone verification function: inspects CS03 to verify if a BOM and its components exist.
 *
 * @param {object} params
 * @param {string} params.material
 * @param {string} params.plant
 * @param {string} [params.bomUsage='1']
 * @param {string} [params.alternativeBom='']
 * @returns {Promise<{ success: boolean, exists: boolean, hasComponents: boolean, componentCount: number, firstComponent?: string, firstQty?: string, firstItemCat?: string, message: string, code?: string }>}
 */
export async function verifyBomInCs03(params) {
  const {
    material,
    plant,
    bomUsage = '1',
    alternativeBom = ''
  } = params || {};

  if (!material || !plant) {
    throw new Error('Material and Plant are required for CS03 verification.');
  }

  if (process.env.USE_MOCK_SAP === 'true') {
    if (process.env.TEST_SAP_SESSION_HEALTH === 'SERVER_UNAVAILABLE') {
      return {
        success: false,
        exists: false,
        hasComponents: false,
        componentCount: 0,
        code: 'SAP_SERVER_UNAVAILABLE',
        status: 'SERVER_UNAVAILABLE',
        message: 'The SAP server is currently unavailable. Please start/reconnect SAP and try again.'
      };
    }
    if (process.env.TEST_SAP_SESSION_HEALTH === 'SESSION_NOT_FOUND' || process.env.TEST_SIMULATE_NO_SESSION === 'true') {
      return {
        success: false,
        exists: false,
        hasComponents: false,
        componentCount: 0,
        code: 'SAP_SESSION_NOT_FOUND',
        status: 'SESSION_NOT_FOUND',
        message: 'Please log in to SAP GUI again. The application will automatically detect the session.'
      };
    }
    if (process.env.TEST_SAP_SESSION_HEALTH === 'BUSY' || process.env.TEST_SIMULATE_BUSY === 'true') {
      return {
        success: false,
        exists: false,
        hasComponents: false,
        componentCount: 0,
        code: 'SAP_SESSION_BUSY',
        status: 'BUSY',
        message: 'SAP is currently processing another operation. Retrying...'
      };
    }
    if (process.env.TEST_SAP_SESSION_HEALTH === 'DISCONNECTED') {
      return {
        success: false,
        exists: false,
        hasComponents: false,
        componentCount: 0,
        code: 'NO_CONNECTION',
        status: 'DISCONNECTED',
        message: 'SAP GUI is open, but no active system connection found. Please log in first.'
      };
    }

    const match = activeMockBomDataset.find(b => 
      b.material.toUpperCase() === String(material || '').trim().toUpperCase() &&
      b.plant === String(plant || '').trim() &&
      b.bomUsage === String(bomUsage || '1').trim()
    );
    if (match) {
      const cleanAlt = String(alternativeBom || '').trim();
      if (cleanAlt && match.availableAlternatives && !match.availableAlternatives.includes(cleanAlt)) {
        return {
          success: true,
          exists: false,
          hasComponents: false,
          componentCount: 0,
          components: [],
          availableAlternatives: [...match.availableAlternatives],
          message: `Alternative ${cleanAlt} does not exist for BOM ${material} in plant ${plant}.`
        };
      }

      // Dynamically evaluate assembly indicators based on plant-level sub-BOM existence
      const rawComps = (cleanAlt && match.alternativeComponents && match.alternativeComponents[cleanAlt])
        ? match.alternativeComponents[cleanAlt]
        : (match.components || []);
      const evaluatedComps = rawComps.map(c => {
        let asm = Boolean(c.assembly);
        if (asm && c.material) {
          const subExists = activeMockBomDataset.some(
            b => b.material.toUpperCase() === String(c.material).trim().toUpperCase() &&
                 b.plant === String(plant).trim() &&
                 String(b.bomUsage || '1') === String(bomUsage || '1')
          );
          asm = subExists;
        }
        return {
          ...c,
          assembly: asm
        };
      });

      const compCount = evaluatedComps.length || match.componentCount || 1;
      const first = evaluatedComps[0] || {};

      return {
        success: true,
        exists: true,
        hasComponents: compCount > 0,
        componentCount: compCount,
        components: evaluatedComps,
        firstComponent: first.material || 'B1BH0214C',
        firstQty: first.quantity || '100',
        firstItemCat: first.itemCategory || 'L',
        availableAlternatives: [...(match.availableAlternatives || ['1'])],
        message: 'BOM exists in mock dataset.'
      };
    } else {
      return { success: true, exists: false, hasComponents: false, componentCount: 0, components: [], message: `BOM not found for material ${material} in plant ${plant} with usage ${bomUsage}` };
    }
  }

  // Live SAP GUI operation preflight check
  const preflight = await ensureSapSession();
  if (!preflight.ok) {
    return {
      success: false,
      exists: false,
      hasComponents: false,
      componentCount: 0,
      code: preflight.status === 'SERVER_UNAVAILABLE' ? 'SAP_SERVER_UNAVAILABLE' : (preflight.code || 'SAP_SESSION_NOT_FOUND'),
      status: preflight.status,
      message: preflight.message
    };
  }

  const targetSessionPath = preflight.sessionPath || '';
  const expectedUser = preflight.user || '';

  const vbsScript = `
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

${getSessionDiscoveryVbs(targetSessionPath, expectedUser)}

If session Is Nothing Then
    WScript.Echo "{""success"":false,""exists"":false,""code"":""NO_SESSION"",""message"":""No active SAP GUI session found.""}"
    WScript.Quit 0
End If

session.findById("wnd[0]").maximize
session.findById("${CS01_FIELD_IDS.OK_CODE}").text = "/nCS03"
session.findById("wnd[0]").sendVKey 0
WScript.Sleep 500

Dim popLoop1
popLoop1 = 0
Do While session.Children.Count > 1 And popLoop1 < 3
    popLoop1 = popLoop1 + 1
    session.findById("wnd[1]").sendVKey 0
    WScript.Sleep 300
Loop

session.findById("${CS01_FIELD_IDS.MATERIAL}").text = "${escapeVbsString(material)}"
session.findById("${CS01_FIELD_IDS.PLANT}").text = "${escapeVbsString(plant)}"
session.findById("${CS01_FIELD_IDS.BOM_USAGE}").text = "${escapeVbsString(bomUsage)}"
${alternativeBom ? `session.findById("${CS01_FIELD_IDS.ALT_BOM}").text = "${escapeVbsString(alternativeBom)}"` : ''}

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
cs03SbarType = session.findById("${CS01_FIELD_IDS.STATUS_BAR}").messageType
cs03SbarText = session.findById("${CS01_FIELD_IDS.STATUS_BAR}").text
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
Set tblCs03 = session.findById("${CS01_FIELD_IDS.TABLE_BASE}")
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
            posnr = Trim(session.findById("${CS01_FIELD_IDS.TABLE_BASE}/txtRC29P-POSNR[0," & iRow & "]").text)
            idnrk = Trim(session.findById("${CS01_FIELD_IDS.TABLE_BASE}/${CS01_FIELD_IDS.COMPONENT_FIELD}[2," & iRow & "]").text)
            If idnrk = "" Then
                idnrk = Trim(session.findById("${CS01_FIELD_IDS.TABLE_BASE}/txtRC29P-IDNRK[2," & iRow & "]").text)
            End If
            ktext = Trim(session.findById("${CS01_FIELD_IDS.TABLE_BASE}/txtRC29P-KTEXT[3," & iRow & "]").text)
            menge = Trim(session.findById("${CS01_FIELD_IDS.TABLE_BASE}/${CS01_FIELD_IDS.QUANTITY_FIELD}[4," & iRow & "]").text)
            meins = Trim(session.findById("${CS01_FIELD_IDS.TABLE_BASE}/ctxtRC29P-MEINS[5," & iRow & "]").text)
            postp = Trim(session.findById("${CS01_FIELD_IDS.TABLE_BASE}/${CS01_FIELD_IDS.ITEM_CATEGORY_FIELD}[1," & iRow & "]").text)
            stlkz = session.findById("${CS01_FIELD_IDS.TABLE_BASE}/chkRC29P-STLKZ[7," & iRow & "]").selected
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
`;

  try {
    const { stdout, stderr } = await runVbsScript(vbsScript, 30000);
    if (stderr) console.warn('[sapGuiClient] CS03 verify stderr:', stderr);
    if (!stdout) {
      const health = await checkSapSessionHealth();
      if (!health.connected) {
        if (health.status === 'SERVER_UNAVAILABLE') {
          return {
            success: false,
            exists: false,
            hasComponents: false,
            componentCount: 0,
            code: 'SAP_SERVER_UNAVAILABLE',
            status: 'SERVER_UNAVAILABLE',
            message: 'The SAP server is currently unavailable. Please start/reconnect SAP and try again.'
          };
        }
        if (health.status === 'SESSION_NOT_FOUND' || health.status === 'DISCONNECTED') {
          return {
            success: false,
            exists: false,
            hasComponents: false,
            componentCount: 0,
            code: 'SAP_SESSION_NOT_FOUND',
            status: health.status,
            message: 'Please log in to SAP GUI again. The application will automatically detect the session.'
          };
        }
        if (health.status === 'BUSY') {
          return {
            success: false,
            exists: false,
            hasComponents: false,
            componentCount: 0,
            code: 'SAP_SESSION_BUSY',
            status: 'BUSY',
            message: 'SAP is currently processing another operation. Retrying...'
          };
        }
      }
      return {
        success: false,
        exists: false,
        hasComponents: false,
        componentCount: 0,
        code: 'SAP_SCRIPT_ERROR',
        message: 'No response received from SAP GUI Scripting engine during CS03 verification.'
      };
    }
    const parsed = JSON.parse(stdout);
    if (!parsed.success && parsed.code) {
      if (parsed.code === 'SERVER_UNAVAILABLE') {
        return {
          success: false,
          exists: false,
          hasComponents: false,
          componentCount: 0,
          code: 'SAP_SERVER_UNAVAILABLE',
          status: 'SERVER_UNAVAILABLE',
          message: 'The SAP server is currently unavailable. Please start/reconnect SAP and try again.'
        };
      }
      if (parsed.code === 'SESSION_NOT_FOUND') {
        return {
          success: false,
          exists: false,
          hasComponents: false,
          componentCount: 0,
          code: 'SAP_SESSION_NOT_FOUND',
          status: 'SESSION_NOT_FOUND',
          message: 'Please log in to SAP GUI again. The application will automatically detect the session.'
        };
      }
    }
    return parsed;
  } catch (err) {
    const health = await checkSapSessionHealth();
    if (!health.connected) {
      return {
        success: false,
        exists: false,
        hasComponents: false,
        componentCount: 0,
        code: health.status === 'SERVER_UNAVAILABLE' ? 'SAP_SERVER_UNAVAILABLE' : (health.code || 'SAP_SESSION_NOT_FOUND'),
        status: health.status,
        message: health.message
      };
    }
    return {
      success: false,
      exists: false,
      hasComponents: false,
      componentCount: 0,
      code: 'SAP_SCRIPT_ERROR',
      message: `CS03 verification failed: ${err.message}`
    };
  }
}

/**
 * Alias for verifyBomInCs03 to support standard naming across modules and tests.
 */
export const verifyBom = verifyBomInCs03;

/**
 * Checks whether a material is extended and maintained in a specific plant.
 * In live mode, uses CS03 validation. In mock mode, validates plant maintenance rules.
 *
 * @param {object} params
 * @param {string} params.material
 * @param {string} params.plant
 * @returns {Promise<{ extended: boolean, errorCode?: string, message: string }>}
 */
export async function checkMaterialPlantExtension({ material, plant }) {
  const cleanMat = String(material || '').trim().toUpperCase();
  const cleanPlant = String(plant || '').trim();

  if (!cleanMat || !cleanPlant) {
    return { extended: false, errorCode: 'MISSING_FIELDS', message: 'Material and plant are required.' };
  }

  if (process.env.USE_MOCK_SAP === 'true') {
    if (cleanPlant === '9999') {
      return { extended: false, errorCode: 'MATERIAL_PLANT_INVALID', message: `Plant ${cleanPlant} not defined (please check your entry)` };
    }
    if (cleanPlant === '1002' || cleanPlant === '1003' || cleanMat.includes('NOT_IN_PLANT') || cleanMat.includes('UNEXTENDED')) {
      return { extended: false, errorCode: 'MATERIAL_PLANT_INVALID', message: `Material ${cleanMat} not maintained in plant ${cleanPlant}` };
    }
    if (cleanMat.startsWith('NON') || cleanMat === 'MAT_NOT_FOUND') {
      return { extended: false, errorCode: 'MATERIAL_NOT_FOUND', message: `The material ${cleanMat} does not exist or is not activated` };
    }
    return { extended: true, message: `Material ${cleanMat} is maintained in plant ${cleanPlant}` };
  }

  try {
    const check = await validateSourceBom({ material: cleanMat, plant: cleanPlant, bomUsage: '1' });
    if (!check.success && check.errorCode === 'MATERIAL_PLANT_INVALID') {
      return { extended: false, errorCode: 'MATERIAL_PLANT_INVALID', message: check.message || `Material ${cleanMat} not maintained in plant ${cleanPlant}` };
    }
    if (!check.success && check.errorCode === 'MATERIAL_NOT_FOUND') {
      return { extended: false, errorCode: 'MATERIAL_NOT_FOUND', message: check.message || `Material ${cleanMat} does not exist in SAP` };
    }
    // If BOM exists or BOM_NOT_FOUND, the material IS maintained in the plant
    return { extended: true, message: `Material ${cleanMat} is maintained in plant ${cleanPlant}` };
  } catch (err) {
    return { extended: true, message: `Could not verify plant extension: ${err.message}` };
  }
}

/**
 * Resolves the next available BOM alternative number.
 * If requestedAlternative is specified and not present in existingAlternatives, it is returned.
 * If requestedAlternative is already used or not specified, finds the lowest positive integer alternative (1, 2, 3...)
 * that is not currently present in existingAlternatives.
 *
 * @param {Array<string|number>} existingAlternatives - List of already existing alternative numbers (e.g. ['1', '2', '3', '4'])
 * @param {string|number} [requestedAlternative=''] - Desired alternative number (e.g. '1' or '2')
 * @returns {string} The resolved alternative number (e.g. '5')
 */
export function resolveNextAvailableAlternative(existingAlternatives = [], requestedAlternative = '') {
  const cleanRequested = String(requestedAlternative ?? '').trim();
  const existingSet = new Set((existingAlternatives || []).map((a) => String(a).trim()));

  if (cleanRequested && !existingSet.has(cleanRequested)) {
    return cleanRequested;
  }

  let candidate = 1;
  while (existingSet.has(String(candidate))) {
    candidate++;
  }
  return String(candidate);
}

/**
 * Formats a hierarchical BOM tree node into a clean text representation for display.
 *
 * @param {object} node
 * @param {string} [prefix='']
 * @param {boolean} [isTail=true]
 * @returns {string}
 */
export function formatHierarchyTree(node, prefix = '', isTail = true) {
  if (!node) return '';
  const lines = [];
  const connector = prefix ? (isTail ? ' └── ' : ' ├── ') : '';
  const altText = node.targetAlt ? `Alt ${node.targetAlt}` : '';
  const plantText = node.targetPlant ? `Plant ${node.targetPlant}` : '';
  const compsText = `${node.componentCount || 0} component${node.componentCount === 1 ? '' : 's'}`;
  const details = [plantText, altText, compsText].filter(Boolean).join(', ');
  lines.push(`${prefix}${connector}${node.material} (${details})`);

  const children = node.children || [];
  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    const childIsTail = i === children.length - 1;
    const childPrefix = prefix ? prefix + (isTail ? '     ' : ' │   ') : '';
    lines.push(formatHierarchyTree(child, childPrefix, childIsTail));
  }
  return lines.join('\n');
}

/**
 * Discovers and builds the complete BOM hierarchy from source to target.
 * Resolves next available alternatives in the target plant, detects cycles,
 * enforces maxDepth (5), and builds a strict bottom-up copy execution order.
 *
 * @param {object} params
 * @param {object} params.source - { material, plant, bomUsage, alternativeBom }
 * @param {object} params.target - { material, plant, bomUsage, alternativeBom }
 * @param {number} [params.maxDepth=5]
 * @returns {Promise<{
 *   mainBom: object,
 *   tree: object,
 *   copyOrder: Array<object>,
 *   metrics: { totalLevels: number, totalBomsToCreate: number, totalComponents: number, totalAssemblies: number },
 *   unextendedMaterials: Array<object>,
 *   cycleDetected: boolean
 * }>}
 */
export async function discoverBomHierarchy({
  source,
  target,
  maxDepth = 5
}) {
  const cleanSrcMat = String(source?.material || '').trim().toUpperCase();
  const cleanSrcPlant = String(source?.plant || '').trim();
  const cleanSrcUsage = String(source?.bomUsage || '1').trim();
  const cleanSrcAlt = String(source?.alternativeBom || '').trim();

  const cleanTgtMat = String(target?.material || '').trim().toUpperCase();
  const cleanTgtPlant = String(target?.plant || '').trim();
  const cleanTgtUsage = String(target?.bomUsage || '1').trim();
  const cleanTgtAlt = String(target?.alternativeBom || '').trim();

  const unextendedMaterials = [];
  let cycleDetected = false;
  const bomsMap = new Map();

  // Read source main BOM
  const srcBomRes = await verifyBomInCs03({
    material: cleanSrcMat,
    plant: cleanSrcPlant,
    bomUsage: cleanSrcUsage,
    alternativeBom: cleanSrcAlt
  });

  const srcComponents = srcBomRes.components || [];

  // Read target main BOM to find existing alternatives
  const targetBomRes = await verifyBomInCs03({
    material: cleanTgtMat,
    plant: cleanTgtPlant,
    bomUsage: cleanTgtUsage
  });

  const targetMainAlts = targetBomRes.availableAlternatives || [];
  const mainTargetAlt = resolveNextAvailableAlternative(targetMainAlts, cleanTgtAlt);

  // Root tree node
  const rootTree = {
    material: cleanTgtMat,
    sourceMaterial: cleanSrcMat,
    sourcePlant: cleanSrcPlant,
    targetPlant: cleanTgtPlant,
    bomUsage: cleanTgtUsage,
    sourceAlt: cleanSrcAlt || srcBomRes.availableAlternatives?.[0] || '1',
    targetAlt: mainTargetAlt,
    depth: 0,
    componentCount: srcComponents.length,
    components: srcComponents,
    children: [],
    existingTargetAlternatives: targetMainAlts
  };

  async function inspectLevel(components, currentSrcPlant, currentTgtPlant, currentUsage, depth, ancestorPath, parentNode) {
    if (depth > maxDepth) return;

    for (const comp of components) {
      if (!toBool(comp.assembly)) continue;
      const compMat = String(comp.material || '').trim().toUpperCase();
      if (!compMat) continue;

      // Cycle detection
      if (ancestorPath.has(compMat)) {
        cycleDetected = true;
        continue;
      }

      // Material plant extension check
      const extCheck = await checkMaterialPlantExtension({ material: compMat, plant: currentTgtPlant });
      if (!extCheck.extended) {
        unextendedMaterials.push({
          material: compMat,
          plant: currentTgtPlant,
          reason: `cannot copy: material not in plant ${currentTgtPlant}`,
          description: comp.description || ''
        });
        continue;
      }

      // Check sub-BOM source definition
      const sourceSubRes = await verifyBomInCs03({
        material: compMat,
        plant: currentSrcPlant,
        bomUsage: currentUsage
      });

      const subComps = sourceSubRes.components || [];

      // Check target alternatives for sub-BOM
      const targetSubRes = await verifyBomInCs03({
        material: compMat,
        plant: currentTgtPlant,
        bomUsage: currentUsage
      });

      const targetSubAlts = targetSubRes.availableAlternatives || [];
      const subTargetAlt = resolveNextAvailableAlternative(targetSubAlts, '');

      const childNode = {
        material: compMat,
        sourceMaterial: compMat,
        sourcePlant: currentSrcPlant,
        targetPlant: currentTgtPlant,
        bomUsage: currentUsage,
        sourceAlt: sourceSubRes.availableAlternatives?.[0] || '1',
        targetAlt: subTargetAlt,
        depth,
        componentCount: subComps.length,
        components: subComps,
        children: [],
        description: comp.description || '',
        existingTargetAlternatives: targetSubAlts
      };

      if (parentNode && parentNode.children) {
        parentNode.children.push(childNode);
      }

      const existingBom = bomsMap.get(compMat);
      if (!existingBom || depth > existingBom.depth) {
        bomsMap.set(compMat, childNode);
      }

      if (depth < maxDepth && subComps.length > 0) {
        const nextAncestors = new Set(ancestorPath);
        nextAncestors.add(compMat);
        await inspectLevel(subComps, currentSrcPlant, currentTgtPlant, currentUsage, depth + 1, nextAncestors, childNode);
      }
    }
  }

  const initialAncestors = new Set([cleanSrcMat]);
  await inspectLevel(srcComponents, cleanSrcPlant, cleanTgtPlant, cleanSrcUsage, 1, initialAncestors, rootTree);

  // Sub-BOMs sorted by depth descending (deepest first)
  const subBoms = Array.from(bomsMap.values()).sort((a, b) => b.depth - a.depth);

  const mainBomItem = {
    material: cleanTgtMat,
    sourceMaterial: cleanSrcMat,
    sourcePlant: cleanSrcPlant,
    targetPlant: cleanTgtPlant,
    bomUsage: cleanTgtUsage,
    sourceAlt: cleanSrcAlt || srcBomRes.availableAlternatives?.[0] || '1',
    targetAlt: mainTargetAlt,
    depth: 0,
    componentCount: srcComponents.length,
    components: srcComponents,
    existingTargetAlternatives: targetMainAlts
  };

  // Bottom-up copy order: deepest sub-BOMs first, main BOM last
  const copyOrder = [...subBoms, mainBomItem];

  const maxLevel = copyOrder.reduce((max, b) => Math.max(max, (b.depth || 0) + 1), 1);
  const totalComponents = copyOrder.reduce((sum, b) => sum + (b.componentCount || 0), 0);
  const totalAssemblies = copyOrder.reduce((sum, b) => sum + (b.components || []).filter(c => toBool(c.assembly)).length, 0);

  return {
    mainBom: mainBomItem,
    tree: rootTree,
    copyOrder,
    metrics: {
      totalLevels: maxLevel,
      totalBomsToCreate: copyOrder.length,
      totalComponents,
      totalAssemblies
    },
    unextendedMaterials,
    cycleDetected
  };
}

/**
 * Recursively verifies all BOMs in the hierarchy in CS03 after creation.
 * Checks component count, item, material, quantity, unit, item category, and assembly indicator.
 *
 * @param {object} params
 * @param {Array<object>} params.copyOrder - Ordered list of BOMs created in hierarchy
 * @param {string} [params.targetPlant]
 * @param {string} [params.bomUsage]
 * @returns {Promise<{
 *   match: boolean,
 *   status: 'SUCCESS' | 'FAILURE',
 *   differences: Array<string>,
 *   verifiedBoms: Array<object>,
 *   verifiedCount: number,
 *   totalExpected: number,
 *   summary: string
 * }>}
 */
export async function verifyHierarchyStructure({
  copyOrder = [],
  targetPlant = '',
  bomUsage = '1'
}) {
  const verifiedBoms = [];
  const allDifferences = [];

  for (const bomItem of copyOrder) {
    const tgtMat = bomItem.material;
    const tgtPlt = bomItem.targetPlant || targetPlant;
    const tgtUsg = bomItem.bomUsage || bomUsage;
    const tgtAlt = bomItem.targetAlt || '1';

    const cs03Res = await verifyBomInCs03({
      material: tgtMat,
      plant: tgtPlt,
      bomUsage: tgtUsg,
      alternativeBom: tgtAlt
    });

    if (!cs03Res.exists) {
      allDifferences.push(`Target BOM ${tgtMat} (Plant ${tgtPlt}, Alt ${tgtAlt}) does not exist in CS03 after creation.`);
      continue;
    }

    const compResult = compareBomStructures({
      sourceComponents: bomItem.components || [],
      targetComponents: cs03Res.components || [],
      targetPlant: tgtPlt,
      copiedMainOnly: false
    });

    if (!compResult.match) {
      allDifferences.push(
        `Structural mismatch in BOM ${tgtMat} (Plant ${tgtPlt}, Alt ${tgtAlt}): ${compResult.differences.join('; ')}`
      );
    } else {
      verifiedBoms.push({
        material: tgtMat,
        plant: tgtPlt,
        alternativeBom: tgtAlt,
        componentCount: cs03Res.components?.length || 0,
        status: 'VERIFIED_100_PERCENT'
      });
    }
  }

  const match = allDifferences.length === 0;
  return {
    match,
    status: match ? 'SUCCESS' : 'FAILURE',
    differences: allDifferences,
    verifiedBoms,
    verifiedCount: verifiedBoms.length,
    totalExpected: copyOrder.length,
    summary: match
      ? `All ${verifiedBoms.length} BOM(s) in hierarchy verified with 100% component and assembly parity in CS03.`
      : `Hierarchy verification failed with ${allDifferences.length} difference(s): ${allDifferences.join(' | ')}`
  };
}

/**
 * Recursively inspects and compares the Source and Target BOM hierarchies up to maxDepth (5).
 * Detects missing sub-BOMs, structural differences (components, quantities, units, item categories),
 * and assembly indicator (Asm) states. Protects against circular references.
 *
 * @param {object} params
 * @param {object} params.source - { material, plant, bomUsage, alternativeBom }
 * @param {object} params.target - { material, plant, bomUsage, alternativeBom }
 * @param {number} [params.maxDepth=5]
 * @param {boolean} [params.isReverify=false]
 * @returns {Promise<{
 *   match: boolean,
 *   status: string,
 *   missingSubBoms: Array<{ material: string, sourceMaterial: string, sourcePlant: string, targetPlant: string, bomUsage: string, depth: number, parentMaterial: string }>,
 *   discrepancies: Array<string>,
 *   verifiedBoms: Array<object>,
 *   maxDepthReached: number,
 *   levelsVerified: number,
 *   cycleDetected: boolean,
 *   summary: string
 * }>}
 */
export async function inspectAndVerifyHierarchy({
  source,
  target,
  targetAltMap = null,
  maxDepth = 5,
  isReverify = false
}) {
  const cleanSrcMat = String(source?.material || '').trim().toUpperCase();
  const cleanSrcPlant = String(source?.plant || '').trim();
  const cleanSrcUsage = String(source?.bomUsage || '1').trim();
  const cleanSrcAlt = String(source?.alternativeBom || '').trim();

  const cleanTgtMat = String(target?.material || '').trim().toUpperCase();
  const cleanTgtPlant = String(target?.plant || '').trim();
  const cleanTgtUsage = String(target?.bomUsage || '1').trim();
  const cleanTgtAlt = String(target?.alternativeBom || '').trim();

  const missingSubBoms = [];
  const discrepancies = [];
  const verifiedBoms = [];
  const visited = new Set();
  let maxDepthReached = 0;
  let cycleDetected = false;

  function addMissingSubBom(entry) {
    const existing = missingSubBoms.find((m) => m.material.toUpperCase() === entry.material.toUpperCase() && m.targetPlant === entry.targetPlant);
    if (!existing) {
      missingSubBoms.push(entry);
    } else if (existing.depth < entry.depth) {
      existing.depth = entry.depth;
    }
  }

  async function traverse(currentSrcMat, currentSrcPlant, currentSrcUsage, currentSrcAlt, currentTgtMat, currentTgtPlant, currentTgtUsage, currentTgtAlt, depth, parentMaterial = '') {
    maxDepthReached = Math.max(maxDepthReached, depth);

    const visitKey = `${currentSrcMat}:${currentSrcPlant}:${currentSrcUsage}`;
    if (visited.has(visitKey)) {
      cycleDetected = true;
      return;
    }
    visited.add(visitKey);

    // 1. Fetch Source BOM in CS03
    const srcRes = await verifyBomInCs03({
      material: currentSrcMat,
      plant: currentSrcPlant,
      bomUsage: currentSrcUsage,
      alternativeBom: currentSrcAlt
    });

    if (!srcRes.exists) {
      discrepancies.push(`Source BOM ${currentSrcMat} in plant ${currentSrcPlant} (Usage ${currentSrcUsage}) does not exist.`);
      return;
    }

    const srcComps = srcRes.components || [];

    // 2. Fetch Target BOM in CS03 using exact target alternative
    const tgtRes = await verifyBomInCs03({
      material: currentTgtMat,
      plant: currentTgtPlant,
      bomUsage: currentTgtUsage,
      alternativeBom: currentTgtAlt
    });

    if (!tgtRes.exists) {
      if (depth === 0) {
        discrepancies.push(`Target main BOM ${currentTgtMat} in plant ${currentTgtPlant} (Alt ${currentTgtAlt || '1'}) does not exist in CS03.`);
      } else {
        addMissingSubBom({
          material: currentTgtMat,
          sourceMaterial: currentSrcMat,
          sourcePlant: currentSrcPlant,
          targetPlant: currentTgtPlant,
          bomUsage: currentTgtUsage,
          depth,
          parentMaterial
        });
      }

      // If target doesn't exist, still traverse source's child assemblies to discover any deeper missing sub-BOMs
      if (depth + 1 < maxDepth) {
        for (const sc of srcComps) {
          if (toBool(sc.assembly)) {
            const scMat = String(sc.material || '').trim().toUpperCase();
            const childTargetKey = `${scMat}:${currentTgtPlant}:${currentTgtUsage}`;
            const recordedTgtAlt = targetAltMap
              ? (targetAltMap instanceof Map ? targetAltMap.get(childTargetKey) : targetAltMap[childTargetKey])
              : null;
            await traverse(
              scMat,
              currentSrcPlant,
              currentSrcUsage,
              '',
              scMat,
              currentTgtPlant,
              currentTgtUsage,
              recordedTgtAlt || '',
              depth + 1,
              currentSrcMat
            );
          }
        }
      }
      return;
    }

    const tgtComps = tgtRes.components || [];

    // 3. Compare structure using material-first deterministic matching
    const tgtMap = new Map();
    tgtComps.forEach((tc, idx) => {
      const matKey = String(tc.material || '').trim().toUpperCase();
      if (!tgtMap.has(matKey)) {
        tgtMap.set(matKey, []);
      }
      tgtMap.get(matKey).push({ comp: tc, matched: false, index: idx });
    });

    if (srcComps.length !== tgtComps.length) {
      discrepancies.push(`Component count mismatch for BOM ${currentTgtMat}: source has ${srcComps.length}, target has ${tgtComps.length}`);
    }

    for (const sc of srcComps) {
      const scMat = String(sc.material || '').trim().toUpperCase();
      const scItem = String(sc.item || '').trim();

      const candidates = tgtMap.get(scMat) || [];
      let candidate = candidates.find(
        (c) => !c.matched && Math.abs(parseFloat(sc.quantity) - parseFloat(c.comp.quantity)) < 0.0001
      );
      if (!candidate) {
        candidate = candidates.find((c) => !c.matched);
      }

      if (!candidate) {
        discrepancies.push(`Component material ${scMat} (item ${scItem || '?'}) is missing in target BOM ${currentTgtMat}`);
        continue;
      }

      candidate.matched = true;
      const tc = candidate.comp;
      const tcItem = String(tc.item || '').trim();

      const sQty = parseFloat(sc.quantity);
      const tQty = parseFloat(tc.quantity);
      if (!isNaN(sQty) && !isNaN(tQty) && Math.abs(sQty - tQty) > 0.0001) {
        discrepancies.push(`Quantity mismatch for Item ${scItem || tcItem} (${scMat}) in BOM ${currentTgtMat}: source has ${sc.quantity}, target has ${tc.quantity}`);
      }

      const sUnit = String(sc.unit || '').trim().toUpperCase();
      const tUnit = String(tc.unit || '').trim().toUpperCase();
      if (sUnit && tUnit && sUnit !== tUnit) {
        discrepancies.push(`Unit mismatch for Item ${scItem || tcItem} (${scMat}) in BOM ${currentTgtMat}: source has ${sc.unit}, target has ${tc.unit}`);
      }

      const sCat = String(sc.itemCategory || '').trim().toUpperCase();
      const tCat = String(tc.itemCategory || '').trim().toUpperCase();
      if (sCat && tCat && sCat !== tCat) {
        discrepancies.push(`Item category mismatch for Item ${scItem || tcItem} (${scMat}) in BOM ${currentTgtMat}: source has ${sc.itemCategory}, target has ${tc.itemCategory}`);
      }

      const sAsm = toBool(sc.assembly);
      const tAsm = toBool(tc.assembly);

      let childExistsInTarget = false;
      let targetChildCheck = null;
      let nextTgtAlt = '';

      if (sAsm) {
        const childTargetKey = `${scMat}:${currentTgtPlant}:${currentTgtUsage}`;
        const recordedTgtAlt = targetAltMap
          ? (targetAltMap instanceof Map ? targetAltMap.get(childTargetKey) : targetAltMap[childTargetKey])
          : null;

        targetChildCheck = await verifyBomInCs03({
          material: scMat,
          plant: currentTgtPlant,
          bomUsage: currentTgtUsage,
          alternativeBom: recordedTgtAlt || ''
        });

        childExistsInTarget = Boolean(targetChildCheck.success && targetChildCheck.exists);
        nextTgtAlt = recordedTgtAlt || (targetChildCheck?.availableAlternatives && targetChildCheck.availableAlternatives[0]) || '';

        if (!childExistsInTarget) {
          addMissingSubBom({
            material: scMat,
            sourceMaterial: scMat,
            sourcePlant: currentSrcPlant,
            targetPlant: currentTgtPlant,
            bomUsage: currentTgtUsage,
            depth: depth + 1,
            parentMaterial: currentTgtMat
          });

          if (isReverify) {
            discrepancies.push(`Sub-BOM for ${scMat} is still missing in target plant ${currentTgtPlant} after repair.`);
          }
        } else {
          if (!tAsm) {
            discrepancies.push(`Assembly indicator mismatch for Item ${scItem || tcItem} (${scMat}) in BOM ${currentTgtMat}: child BOM exists in plant ${currentTgtPlant} but Asm is unchecked`);
          }
        }
      } else {
        if (tAsm) {
          discrepancies.push(`Assembly indicator mismatch for Item ${scItem || tcItem} (${scMat}) in BOM ${currentTgtMat}: source Asm=false, target Asm=true`);
        }
      }

      // Recurse into child BOM if sAsm is true
      if (sAsm && depth + 1 < maxDepth) {
        await traverse(
          scMat,
          currentSrcPlant,
          currentSrcUsage,
          '',
          scMat,
          currentTgtPlant,
          currentTgtUsage,
          nextTgtAlt,
          depth + 1,
          currentTgtMat
        );
      }
    }

    // Flag extra components in target
    for (const [matKey, candidates] of tgtMap.entries()) {
      for (const c of candidates) {
        if (!c.matched) {
          discrepancies.push(`Extra component in target BOM ${currentTgtMat}: material ${matKey} (item ${c.comp.item || '?'})`);
        }
      }
    }

    verifiedBoms.push({
      material: currentTgtMat,
      plant: currentTgtPlant,
      alternativeBom: currentTgtAlt || '1',
      componentCount: tgtComps.length,
      status: 'VERIFIED'
    });
  }

  const resolvedMainTgtAlt = targetAltMap
    ? (targetAltMap instanceof Map ? targetAltMap.get(`${cleanTgtMat}:${cleanTgtPlant}:${cleanTgtUsage}`) : targetAltMap[`${cleanTgtMat}:${cleanTgtPlant}:${cleanTgtUsage}`])
    : cleanTgtAlt;

  await traverse(
    cleanSrcMat,
    cleanSrcPlant,
    cleanSrcUsage,
    cleanSrcAlt,
    cleanTgtMat,
    cleanTgtPlant,
    cleanTgtUsage,
    resolvedMainTgtAlt || cleanTgtAlt,
    0
  );

  const match = discrepancies.length === 0 && (isReverify ? missingSubBoms.length === 0 : true);

  return {
    match,
    status: match ? 'SUCCESS' : 'FAILURE',
    missingSubBoms,
    discrepancies,
    verifiedBoms,
    maxDepthReached,
    levelsVerified: maxDepthReached + 1,
    cycleDetected,
    summary: match
      ? (missingSubBoms.length > 0
          ? `Structure matches so far, but ${missingSubBoms.length} sub-BOM(s) missing in target plant ${cleanTgtPlant}.`
          : `All ${verifiedBoms.length} BOM(s) verified with 100% component and assembly parity.`)
      : `Hierarchy verification failed with ${discrepancies.length} discrepancy(s): ${discrepancies.join(' | ')}`
  };
}

/**
 * Repairs missing sub-BOMs by copying them from source plant to target plant
 * in strict bottom-up order (deepest sub-BOMs first). If a sub-BOM already exists
 * in the target plant, it is created under the next available alternative.
 *
 * @param {object} params
 * @param {Array<object>} params.missingSubBoms
 * @param {Function} [params.onProgress]
 * @param {Function} [params.auditHook]
 * @returns {Promise<Array<object>>}
 */
export async function repairHierarchyBottomUp({
  missingSubBoms = [],
  onProgress,
  auditHook
}) {
  if (!missingSubBoms || missingSubBoms.length === 0) {
    return [];
  }

  // Deduplicate by material + targetPlant + bomUsage, keeping highest depth
  const dedupMap = new Map();
  for (const item of missingSubBoms) {
    const key = `${item.material.toUpperCase()}:${item.targetPlant}:${item.bomUsage || '1'}`;
    if (!dedupMap.has(key) || dedupMap.get(key).depth < item.depth) {
      dedupMap.set(key, item);
    }
  }

  // Strict bottom-up sort: deepest sub-BOMs first (e.g. depth 3 -> 2 -> 1)
  const sorted = Array.from(dedupMap.values()).sort((a, b) => b.depth - a.depth);
  const createdSubBoms = [];

  for (let i = 0; i < sorted.length; i++) {
    const sub = sorted[i];
    onProgress?.(`Repairing missing sub-BOM (${i + 1} of ${sorted.length}): ${sub.material}...`);

    // Target alternative selection:
    // Check existing alternatives in target plant for this sub-BOM
    const targetCheck = await verifyBomInCs03({
      material: sub.material,
      plant: sub.targetPlant,
      bomUsage: sub.bomUsage || '1'
    });

    const existingAlts = (targetCheck.success && targetCheck.exists)
      ? (targetCheck.availableAlternatives || ['1'])
      : [];

    const resolvedAlt = resolveNextAvailableAlternative(existingAlts, '');

    // Copy sub-BOM into target plant under resolvedAlt
    const copyRes = await copyBomViaGui({
      source: {
        material: sub.sourceMaterial || sub.material,
        plant: sub.sourcePlant,
        bomUsage: sub.bomUsage || '1',
        alternativeBom: sub.sourceAlternative || ''
      },
      target: {
        material: sub.material,
        plant: sub.targetPlant,
        bomUsage: sub.bomUsage || '1',
        alternativeBom: resolvedAlt
      },
      copiedMainOnly: true,
      allowMissingSubBoms: true
    });

    if (!copyRes.success || copyRes.verified === false) {
      const err = new Error(`BOM copy failed for material ${sub.material} in plant ${sub.targetPlant} (Alternative ${resolvedAlt}): ${copyRes.message || 'Operation failed'}. Execution stopped.`);
      err.code = copyRes.code || 'COPY_BOM_FAILED';
      err.failedBom = { material: sub.material, plant: sub.targetPlant, alternative: resolvedAlt };
      throw err;
    }

    const createdRecord = {
      material: sub.material,
      sourceMaterial: sub.sourceMaterial || sub.material,
      sourcePlant: sub.sourcePlant,
      sourceAlternative: sub.sourceAlternative || '1',
      targetPlant: sub.targetPlant,
      targetAlternative: resolvedAlt,
      alternativeBom: resolvedAlt,
      bomUsage: sub.bomUsage || '1',
      depth: sub.depth,
      isMain: false,
      after: copyRes.after
    };

    auditHook?.(createdRecord, resolvedAlt, copyRes);
    createdSubBoms.push(createdRecord);
  }

  return createdSubBoms;
}

/**
 * Executes the complete COPY → VERIFY → REPAIR → VERIFY workflow.
 *
 * STEP 1: Copies full hierarchy recursively using native CS01 Copy From.
 *         Existing target alternatives are preserved; new copies are created under next available alternative.
 * STEP 2: Verifies hierarchy against the exact newly-created target alternatives.
 * STEP 3: Repairs any missing sub-BOMs in bottom-up order if needed.
 * STEP 4: Re-verifies complete hierarchy until 100% parity is confirmed.
 *
 * @param {object} params
 * @param {object} params.source - { material, plant, bomUsage, alternativeBom }
 * @param {object} params.target - { material, plant, bomUsage, alternativeBom, validFrom }
 * @param {string} [params.validFrom='']
 * @param {number} [params.maxDepth=5]
 * @param {Function} [params.onProgress]
 * @param {Function} [params.auditHook]
 * @returns {Promise<object>}
 */
export async function copyBomHierarchyWithRepair({
  source,
  target,
  validFrom = '',
  maxDepth = 5,
  onProgress,
  auditHook
}) {
  const cleanSrcMat = String(source?.material || '').trim().toUpperCase();
  const cleanSrcPlant = String(source?.plant || '').trim();
  const cleanSrcUsage = String(source?.bomUsage || '1').trim();
  const cleanSrcAlt = String(source?.alternativeBom || '').trim();

  const cleanTgtMat = String(target?.material || '').trim().toUpperCase();
  const cleanTgtPlant = String(target?.plant || '').trim();
  const cleanTgtUsage = String(target?.bomUsage || '1').trim();
  const cleanTgtAlt = String(target?.alternativeBom || '').trim();

  const createdBoms = [];
  const targetAltMap = new Map();
  const visited = new Set();
  let maxDepthReached = 0;

  async function copyRecursive(srcMat, srcPlant, srcUsage, srcAlt, tgtMat, tgtPlant, tgtUsage, tgtAlt, depth, isMain = false) {
    maxDepthReached = Math.max(maxDepthReached, depth);
    if (depth > maxDepth) return;

    const cycleKey = `${srcMat}:${srcPlant}:${srcUsage}`;
    if (visited.has(cycleKey)) return;
    visited.add(cycleKey);

    // Target alternative selection:
    // Check existing alternatives in target plant for this BOM
    const targetCheck = await verifyBomInCs03({
      material: tgtMat,
      plant: tgtPlant,
      bomUsage: tgtUsage
    });

    const existingTargetAlts = (targetCheck.success && targetCheck.exists)
      ? (targetCheck.availableAlternatives || ['1'])
      : [];

    const resolvedTargetAlt = resolveNextAvailableAlternative(existingTargetAlts, tgtAlt);

    onProgress?.(isMain
      ? `Copying Main BOM ${tgtMat} to plant ${tgtPlant} (Alternative ${resolvedTargetAlt})...`
      : `Copying Sub-BOM (depth ${depth}) ${tgtMat} to plant ${tgtPlant} (Alternative ${resolvedTargetAlt})...`
    );

    const copyRes = await copyBomViaGui({
      source: {
        material: srcMat,
        plant: srcPlant,
        bomUsage: srcUsage,
        alternativeBom: srcAlt
      },
      target: {
        material: tgtMat,
        plant: tgtPlant,
        bomUsage: tgtUsage,
        alternativeBom: resolvedTargetAlt,
        validFrom: validFrom || target.validFrom || ''
      },
      copiedMainOnly: true,
      allowMissingSubBoms: true
    });

    if (!copyRes.success || copyRes.verified === false) {
      const err = new Error(`${isMain ? 'Main' : 'Sub-'} BOM copy failed for material ${tgtMat} in plant ${tgtPlant} (Alternative ${resolvedTargetAlt}): ${copyRes.message || 'Operation failed'}.`);
      err.code = copyRes.code || 'COPY_BOM_FAILED';
      err.failedBom = { material: tgtMat, plant: tgtPlant, alternative: resolvedTargetAlt };
      throw err;
    }

    const record = {
      material: tgtMat,
      sourceMaterial: srcMat,
      sourcePlant: srcPlant,
      sourceAlternative: srcAlt || '1',
      targetPlant: tgtPlant,
      targetAlternative: resolvedTargetAlt,
      alternativeBom: resolvedTargetAlt,
      bomUsage: tgtUsage,
      depth,
      isMain,
      after: copyRes.after
    };

    targetAltMap.set(`${tgtMat}:${tgtPlant}:${tgtUsage}`, resolvedTargetAlt);
    auditHook?.(record, resolvedTargetAlt, copyRes);
    createdBoms.push(record);

    // Identify assemblies from the source BOM
    const srcRes = await verifyBomInCs03({
      material: srcMat,
      plant: srcPlant,
      bomUsage: srcUsage,
      alternativeBom: srcAlt
    });

    const components = srcRes.components || copyRes.after?.components || [];

    // Recurse into every assembly component
    for (const comp of components) {
      if (toBool(comp.assembly)) {
        const childMat = String(comp.material || '').trim().toUpperCase();
        if (!childMat) continue;

        const childTargetKey = `${childMat}:${tgtPlant}:${tgtUsage}`;
        if (targetAltMap.has(childTargetKey)) {
          continue;
        }

        await copyRecursive(
          childMat,
          srcPlant,
          srcUsage,
          '',
          childMat,
          tgtPlant,
          tgtUsage,
          '',
          depth + 1,
          false
        );
      }
    }
  }

  // STEP 1: Execute recursive copy starting at Main BOM (depth 0)
  onProgress?.('Copying BOM hierarchy...');
  await copyRecursive(
    cleanSrcMat,
    cleanSrcPlant,
    cleanSrcUsage,
    cleanSrcAlt,
    cleanTgtMat,
    cleanTgtPlant,
    cleanTgtUsage,
    cleanTgtAlt,
    0,
    true
  );

  const mainRecord = createdBoms[0];
  const mainTargetAlt = targetAltMap.get(`${cleanTgtMat}:${cleanTgtPlant}:${cleanTgtUsage}`) || '1';

  // STEP 2: VERIFY complete hierarchy using exact created target alternatives
  onProgress?.('Verifying complete structure...');
  const initialVerify = await inspectAndVerifyHierarchy({
    source: {
      material: cleanSrcMat,
      plant: cleanSrcPlant,
      bomUsage: cleanSrcUsage,
      alternativeBom: cleanSrcAlt
    },
    target: {
      material: cleanTgtMat,
      plant: cleanTgtPlant,
      bomUsage: cleanTgtUsage,
      alternativeBom: mainTargetAlt
    },
    targetAltMap,
    maxDepth,
    isReverify: false
  });

  // STEP 3: REPAIR missing sub-BOMs if any
  if (initialVerify.missingSubBoms && initialVerify.missingSubBoms.length > 0) {
    const repaired = await repairHierarchyBottomUp({
      missingSubBoms: initialVerify.missingSubBoms,
      onProgress,
      auditHook
    });
    for (const rep of repaired) {
      targetAltMap.set(`${rep.material}:${rep.plant}:${rep.bomUsage}`, rep.alternativeBom);
    }
    createdBoms.push(...repaired);
  }

  // STEP 4: RE-VERIFY complete hierarchy
  onProgress?.('Verifying complete structure...');
  const finalVerify = await inspectAndVerifyHierarchy({
    source: {
      material: cleanSrcMat,
      plant: cleanSrcPlant,
      bomUsage: cleanSrcUsage,
      alternativeBom: cleanSrcAlt
    },
    target: {
      material: cleanTgtMat,
      plant: cleanTgtPlant,
      bomUsage: cleanTgtUsage,
      alternativeBom: mainTargetAlt
    },
    targetAltMap,
    maxDepth,
    isReverify: true
  });

  if (!finalVerify.match) {
    const err = new Error(`Structural verification failed for BOM hierarchy: ${finalVerify.summary}`);
    err.code = 'STRUCTURAL_VERIFICATION_FAILED';
    err.differences = finalVerify.discrepancies;
    err.verification = finalVerify;
    throw err;
  }

  const totalBomsCreated = createdBoms.length;
  onProgress?.(`BOM copy complete: ${totalBomsCreated} BOM${totalBomsCreated > 1 ? 's' : ''} created, structure fully verified`);

  return {
    success: true,
    verified: true,
    status: 'SUCCESS',
    code: 'BOM_HIERARCHY_COPIED_AND_VERIFIED',
    message: `Successfully copied complete BOM hierarchy for ${cleanTgtMat} (${totalBomsCreated} BOM${totalBomsCreated > 1 ? 's' : ''} created and verified in CS03).`,
    totalBomsCreated,
    createdBoms,
    mainBom: mainRecord,
    repairedBoms: createdBoms.slice(1),
    hierarchyDepth: finalVerify.maxDepthReached,
    levelsVerified: finalVerify.levelsVerified,
    verification: finalVerify
  };
}

/**
 * Pre-flight sub-BOM dependency check (retained for backward compatibility).
 * Delegates directly to discoverBomHierarchy and maps results to the expected shape.
 *
 * @param {object} params
 * @returns {Promise<object>}
 */
export async function checkBomSubDependencies({
  source,
  target,
  maxDepth = 5
}) {
  const hierarchy = await discoverBomHierarchy({ source, target, maxDepth });
  const missingSubBoms = hierarchy.copyOrder.filter((b) => b.depth > 0);
  const existingSubBoms = [];

  const cleanTgtPlant = String(target?.plant || '').trim();
  const cleanTgtUsage = String(target?.bomUsage || '1').trim();

  for (const comp of hierarchy.mainBom.components || []) {
    if (!toBool(comp.assembly)) continue;
    const compMat = String(comp.material || '').trim().toUpperCase();
    if (compMat && !missingSubBoms.some((b) => b.material === compMat)) {
      const tgtRes = await verifyBomInCs03({ material: compMat, plant: cleanTgtPlant, bomUsage: cleanTgtUsage });
      if (tgtRes.exists) {
        existingSubBoms.push({
          material: compMat,
          plant: cleanTgtPlant,
          bomUsage: cleanTgtUsage,
          componentCount: tgtRes.componentCount || tgtRes.components?.length || 0,
          description: comp.description || ''
        });
      }
    }
  }

  return {
    ...hierarchy,
    mainBom: {
      material: hierarchy.mainBom.material,
      sourcePlant: hierarchy.mainBom.sourcePlant,
      targetPlant: hierarchy.mainBom.targetPlant,
      bomUsage: hierarchy.mainBom.bomUsage,
      alternativeBom: hierarchy.mainBom.targetAlt || '1',
      componentCount: hierarchy.mainBom.componentCount
    },
    missingSubBoms,
    existingSubBoms,
    unextendedMaterials: hierarchy.unextendedMaterials,
    totalBomsMainOnly: 1,
    totalBomsWithSub: hierarchy.copyOrder.length
  };
}

function toBool(val) {
  if (typeof val === 'boolean') return val;
  if (typeof val === 'string') {
    const s = val.trim().toLowerCase();
    return s === 'true' || s === 'x' || s === '1';
  }
  if (typeof val === 'number') return val !== 0;
  return false;
}

/**
 * Structural comparison between source BOM and target BOM components.
 * Replaces the count-only check.
 * Compares: item, component, quantity, unit, item category, and Asm.
 *
 * Rules:
 * - Asm differences EXPLAINED by a missing sub-BOM in the target plant (because user chose "main BOM only")
 *   are reported as a WARNING with the reason, result status: SUCCESS_WITH_WARNINGS.
 * - Any other difference, or an Asm difference with no explanation, is a FAILURE.
 *
 * @param {object} params
 * @param {Array<object>} params.sourceComponents
 * @param {Array<object>} params.targetComponents
 * @param {Array<string>} [params.missingSubBomMaterials=[]]
 * @param {boolean} [params.copiedMainOnly=false]
 * @returns {{ match: boolean, status: 'SUCCESS'|'SUCCESS_WITH_WARNINGS'|'FAILURE', differences: Array<string>, warnings: Array<{ item: string, material: string, reason: string }>, summary: string }}
 */
export function compareBomStructures({
  sourceComponents = [],
  targetComponents = [],
  targetPlant = '',
  missingSubBomMaterials = [],
  copiedMainOnly = false,
  allowMissingSubBoms = false
}) {
  const differences = [];
  const warnings = [];

  const missingSet = new Set(
    (missingSubBomMaterials || []).map((m) => String(m).trim().toUpperCase())
  );

  // Component count comparison
  if (sourceComponents.length !== targetComponents.length) {
    differences.push(
      `Component count mismatch: Source BOM has ${sourceComponents.length} components, Target BOM has ${targetComponents.length} components`
    );
  }

  // Material-first deterministic component matching:
  // Item numbers (POSNR) are attributes, NOT primary identity keys.
  const targetMap = new Map();
  targetComponents.forEach((tc, idx) => {
    const matKey = String(tc.material || '').trim().toUpperCase();
    if (!targetMap.has(matKey)) {
      targetMap.set(matKey, []);
    }
    targetMap.get(matKey).push({ comp: tc, matched: false, index: idx });
  });

  for (const sc of sourceComponents) {
    const scMat = String(sc.material || '').trim().toUpperCase();
    const scItem = String(sc.item || '').trim();

    const candidates = targetMap.get(scMat) || [];
    // Deterministic matching: find first unmatched candidate with matching quantity, else first unmatched
    let candidate = candidates.find(
      (c) => !c.matched && Math.abs(parseFloat(sc.quantity) - parseFloat(c.comp.quantity)) < 0.0001
    );
    if (!candidate) {
      candidate = candidates.find((c) => !c.matched);
    }

    if (!candidate) {
      differences.push(`Component material ${scMat} (item ${scItem || '?'}) is missing in target BOM`);
      continue;
    }

    candidate.matched = true;
    const tc = candidate.comp;
    const tcItem = String(tc.item || '').trim();

    // Compare quantity
    const sQty = parseFloat(sc.quantity);
    const tQty = parseFloat(tc.quantity);
    if (!isNaN(sQty) && !isNaN(tQty) && Math.abs(sQty - tQty) > 0.0001) {
      differences.push(
        `Quantity mismatch for Item ${scItem || tcItem} (${scMat}): source has ${sc.quantity}, target has ${tc.quantity}`
      );
    }

    // Compare unit of measure
    const sUnit = String(sc.unit || '').trim().toUpperCase();
    const tUnit = String(tc.unit || '').trim().toUpperCase();
    if (sUnit && tUnit && sUnit !== tUnit) {
      differences.push(
        `Unit mismatch for Item ${scItem || tcItem} (${scMat}): source has ${sc.unit}, target has ${tc.unit}`
      );
    }

    // Compare item category
    const sCat = String(sc.itemCategory || '').trim().toUpperCase();
    const tCat = String(tc.itemCategory || '').trim().toUpperCase();
    if (sCat && tCat && sCat !== tCat) {
      differences.push(
        `Item category mismatch for Item ${scItem || tcItem} (${scMat}): source has ${sc.itemCategory}, target has ${tc.itemCategory}`
      );
    }

    // Compare Assembly indicator (Asm)
    const sAsm = toBool(sc.assembly);
    const tAsm = toBool(tc.assembly);

    if (sAsm !== tAsm) {
      const isMissingInTarget =
        missingSet.has(scMat) ||
        (targetPlant &&
          (process.env.USE_MOCK_SAP === 'true'
            ? !activeMockBomDataset.some(
                (b) =>
                  b.material.toUpperCase() === scMat &&
                  b.plant === String(targetPlant).trim()
              )
            : false));

      const isExplained = Boolean(
        sAsm && !tAsm && (
          allowMissingSubBoms ||
          (copiedMainOnly && isMissingInTarget)
        )
      );

      if (isExplained) {
        // EXPLAINED difference: sub-BOM does not exist in target plant yet
        warnings.push({
          item: scItem,
          material: scMat,
          reason: `Component ${scMat} (Item ${scItem}): Asm is unchecked in target plant ${targetPlant ? `(${targetPlant}) ` : ''}because its sub-BOM does not exist in target plant.`
        });
      } else {
        // UNEXPLAINED difference: FAILURE!
        differences.push(
          `Assembly indicator mismatch for Item ${scItem || tcItem} (${scMat}): source Asm=${sAsm}, target Asm=${tAsm}`
        );
      }
    }
  }

  // Flag any unmatched target components as extra
  for (const [matKey, candidates] of targetMap.entries()) {
    for (const c of candidates) {
      if (!c.matched) {
        differences.push(`Extra component in target BOM: material ${matKey} (item ${c.comp.item || '?'})`);
      }
    }
  }

  let status = 'SUCCESS';
  let match = true;

  if (differences.length > 0) {
    status = 'FAILURE';
    match = false;
  } else if (warnings.length > 0) {
    status = 'SUCCESS_WITH_WARNINGS';
    match = true;
  }

  return {
    match,
    status,
    differences,
    warnings,
    summary:
      status === 'FAILURE'
        ? `Structural verification failed: ${differences.join('; ')}`
        : status === 'SUCCESS_WITH_WARNINGS'
        ? `Structural verification passed with warnings: ${warnings.map((w) => w.reason).join('; ')}`
        : 'Structural verification passed: 100% component and assembly parity.'
  };
}

/**
 * STEP 9: Deletes a Bill of Materials (BOM) or Alternative BOM using SAP GUI transaction ZBOM_COPY.
 * Attaches exclusively to an already-open, authenticated SAP GUI session (Relaxo Sandbox / S4A).
 * Post-execution, navigates to /nCS03 to verify that the BOM / Alternative BOM no longer exists.
 * Cleanly resets the session to /n upon completion.
 *
 * @param {object} params
 * @param {string} params.material - Material number (e.g. 'A1BH0214C')
 * @param {string} params.plant - Plant code (e.g. '1001')
 * @param {string} [params.alternativeBom='1'] - Alternative BOM number (e.g. '2')
 * @param {string} [params.bomUsage='1'] - BOM Usage (e.g. '1')
 * @returns {Promise<{ success: boolean, verified: boolean, message: string, code?: string, sbar?: string, cs03Status?: string, material?: string, plant?: string, alternativeBom?: string, bomUsage?: string }>}
 */
export async function deleteBomViaGui({
  material,
  plant,
  alternativeBom = '1',
  bomUsage = '1'
}) {
  if (process.platform !== 'win32') {
    return {
      success: false,
      verified: false,
      code: 'PLATFORM_UNSUPPORTED',
      message: 'SAP GUI Scripting is only supported on Windows operating systems.'
    };
  }

  const cleanMat = String(material || '').trim();
  const cleanPlant = String(plant || '').trim();
  const cleanAlt = String(alternativeBom || '1').trim();
  const cleanUsage = String(bomUsage || '1').trim();

  if (!cleanMat || !cleanPlant) {
    return {
      success: false,
      verified: false,
      code: 'MISSING_REQUIRED_FIELDS',
      message: 'Material and Plant are required to delete a BOM.'
    };
  }

  if (process.env.USE_MOCK_SAP === 'true') {
    if (process.env.TEST_SAP_SESSION_HEALTH === 'SERVER_UNAVAILABLE') {
      return {
        success: false,
        verified: false,
        code: 'SAP_SERVER_UNAVAILABLE',
        status: 'SERVER_UNAVAILABLE',
        message: 'The SAP server is currently unavailable. Please start/reconnect SAP and try again.'
      };
    }
    if (process.env.TEST_SAP_SESSION_HEALTH === 'SESSION_NOT_FOUND' || process.env.TEST_SIMULATE_NO_SESSION === 'true') {
      return {
        success: false,
        verified: false,
        code: 'SAP_SESSION_NOT_FOUND',
        status: 'SESSION_NOT_FOUND',
        message: 'Please log in to SAP GUI again. The application will automatically detect the session.'
      };
    }
    if (process.env.TEST_SIMULATE_DISCONNECT_DURING_OP === 'true') {
      return {
        success: false,
        verified: false,
        code: 'SAP_CONNECTION_LOST',
        message: 'Connection to SAP was lost during the operation. The final SAP state could not be verified. Please check CS03 before retrying.'
      };
    }

    // 1. Pre-verification via CS03
    const preCheck = await verifyBomInCs03({
      material: cleanMat,
      plant: cleanPlant,
      bomUsage: cleanUsage,
      alternativeBom: cleanAlt
    });

    if (!preCheck.success) {
      return {
        success: false,
        verified: false,
        code: preCheck.code || 'SAP_SCRIPT_ERROR',
        status: preCheck.status,
        message: preCheck.message || 'CS03 pre-verification failed.'
      };
    }

    if (!preCheck.exists) {
      if (preCheck.availableAlternatives && !preCheck.availableAlternatives.includes(cleanAlt)) {
        return {
          success: false,
          verified: false,
          code: 'ALTERNATIVE_NOT_FOUND',
          availableAlternatives: [...preCheck.availableAlternatives],
          message: `Alternative BOM ${cleanAlt} does not exist.`
        };
      }
      return {
        success: false,
        verified: false,
        code: 'BOM_NOT_FOUND',
        message: preCheck.message || `BOM for material ${cleanMat} in plant ${cleanPlant} does not exist.`
      };
    }

    const match = activeMockBomDataset.find(
      (b) => b.material.toUpperCase() === cleanMat.toUpperCase() &&
             b.plant === cleanPlant &&
             b.bomUsage === cleanUsage
    );

    const beforeAlternatives = [...(match.availableAlternatives || ['1'])];

    // Wrong-alternative protection: delete ONLY cleanAlt
    match.availableAlternatives = match.availableAlternatives.filter((a) => a !== cleanAlt);

    // 2. Post-delete verification in CS03
    const postCheck = await verifyBomInCs03({
      material: cleanMat,
      plant: cleanPlant,
      bomUsage: cleanUsage,
      alternativeBom: cleanAlt
    });

    if (postCheck.exists) {
      match.availableAlternatives = beforeAlternatives;
      return {
        success: false,
        verified: false,
        code: 'DELETE_VERIFICATION_FAILED',
        message: `Deletion could not be verified: Alternative BOM ${cleanAlt} still exists in CS03.`
      };
    }

    const remainingAlternatives = [...(match.availableAlternatives || [])];
    const expectedRemaining = beforeAlternatives.filter((a) => a !== cleanAlt);
    const areRemainingEqual =
      remainingAlternatives.length === expectedRemaining.length &&
      remainingAlternatives.every((val, idx) => val === expectedRemaining[idx]);

    if (!areRemainingEqual) {
      match.availableAlternatives = beforeAlternatives;
      return {
        success: false,
        verified: false,
        code: 'DELETE_VERIFICATION_FAILED',
        message: 'Deletion verification failed: Non-targeted alternatives were altered.'
      };
    }

    return {
      success: true,
      verified: true,
      bomNumber: cleanMat,
      material: cleanMat,
      plant: cleanPlant,
      alternativeBom: cleanAlt,
      bomUsage: cleanUsage,
      availableAlternatives: remainingAlternatives,
      message: `BOM for material ${cleanMat} in plant ${cleanPlant} (Alternative BOM ${cleanAlt}) deleted successfully and verified via CS03 (Mock).`,
      before: {
        material: cleanMat,
        plant: cleanPlant,
        alternativeBom: cleanAlt,
        bomUsage: cleanUsage,
        alternatives: beforeAlternatives
      },
      after: {
        material: cleanMat,
        plant: cleanPlant,
        bomUsage: cleanUsage,
        remainingAlternatives
      }
    };
  }

  // Live operation preflight check
  const preflight = await ensureSapSession();
  if (!preflight.ok) {
    return {
      success: false,
      verified: false,
      code: preflight.status === 'SERVER_UNAVAILABLE' ? 'SAP_SERVER_UNAVAILABLE' : (preflight.code || 'SAP_SESSION_NOT_FOUND'),
      status: preflight.status,
      message: preflight.message
    };
  }

  const targetSessionPath = preflight.sessionPath || '';
  const expectedUser = preflight.user || '';

  // Pre-verification in CS03 for live SAP session
  const preCheck = await verifyBomInCs03({
    material: cleanMat,
    plant: cleanPlant,
    bomUsage: cleanUsage,
    alternativeBom: cleanAlt
  });

  if (!preCheck.success) {
    return {
      success: false,
      verified: false,
      code: preCheck.code || 'SAP_SCRIPT_ERROR',
      status: preCheck.status,
      message: `Cannot verify BOM before deletion: ${preCheck.message}`
    };
  }

  if (!preCheck.exists) {
    if (preCheck.availableAlternatives && !preCheck.availableAlternatives.includes(cleanAlt)) {
      return {
        success: false,
        verified: false,
        code: 'ALTERNATIVE_NOT_FOUND',
        availableAlternatives: [...preCheck.availableAlternatives],
        message: `Alternative BOM ${cleanAlt} does not exist.`
      };
    }
    return {
      success: false,
      verified: false,
      code: 'BOM_NOT_FOUND',
      message: preCheck.message || `BOM for material ${cleanMat} in plant ${cleanPlant} does not exist.`
    };
  }

  const vbsScript = `
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

${getSessionDiscoveryVbs(targetSessionPath, expectedUser)}

If session Is Nothing Then
    WScript.Echo "{""success"":false,""verified"":false,""code"":""NO_SESSION"",""message"":""No active SAP GUI session found. Please log into your SAP system client.""}"
    WScript.Quit 0
End If

session.findById("wnd[0]").maximize

' 1. Open transaction ZBOM_COPY
session.findById("${ZBOM_COPY_FIELD_IDS.OK_CODE}").text = "/nZBOM_COPY"
session.findById("wnd[0]").sendVKey 0
WScript.Sleep 500

' Dismiss any modal windows on entry
Do While session.Children.Count > 1
    session.findById("wnd[1]").sendVKey 0
    WScript.Sleep 300
Loop

' 2. Select Delete radio button
session.findById("${ZBOM_COPY_FIELD_IDS.RADIO_DELETE}").select
WScript.Sleep 300

' 3. Populate FROM fields
session.findById("${ZBOM_COPY_FIELD_IDS.MATERIAL}").text = "${escapeVbsString(cleanMat)}"
session.findById("${ZBOM_COPY_FIELD_IDS.PLANT}").text = "${escapeVbsString(cleanPlant)}"
session.findById("${ZBOM_COPY_FIELD_IDS.ALT_BOM}").text = "${escapeVbsString(cleanAlt)}"
session.findById("${ZBOM_COPY_FIELD_IDS.BOM_USAGE}").text = "${escapeVbsString(cleanUsage)}"
WScript.Sleep 300

' 4. Execute / F8
session.findById("${ZBOM_COPY_FIELD_IDS.EXECUTE_BUTTON}").press
WScript.Sleep 800

' 5. Handle any confirmation popup (wnd[1])
Dim popupText
popupText = ""
If session.Children.Count > 1 Then
    On Error Resume Next
    popupText = session.findById("wnd[1]").text
    session.findById("${ZBOM_COPY_FIELD_IDS.POPUP_CONFIRM}").press
    If Err.Number <> 0 Then
        Err.Clear
        session.findById("wnd[1]").sendVKey 0
    End If
    On Error Goto 0
    WScript.Sleep 800
End If

Do While session.Children.Count > 1
    On Error Resume Next
    popupText = popupText & " | " & session.findById("wnd[1]").text
    session.findById("wnd[1]").sendVKey 0
    On Error Goto 0
    WScript.Sleep 400
Loop

' 6. Read status bar from ZBOM_COPY
Dim zbomSbarText, zbomSbarType, safeZbomSbar
zbomSbarText = session.findById("${ZBOM_COPY_FIELD_IDS.STATUS_BAR}").text
zbomSbarType = session.findById("${ZBOM_COPY_FIELD_IDS.STATUS_BAR}").messageType
safeZbomSbar = JsonEscape(zbomSbarText)

If zbomSbarType = "E" Or zbomSbarType = "A" Then
    session.findById("wnd[0]/tbar[0]/okcd").text = "/n"
    session.findById("wnd[0]").sendVKey 0
    WScript.Echo "{""success"":false,""verified"":false,""code"":""ZBOM_COPY_ERROR"",""message"":""SAP ZBOM_COPY Error: " & safeZbomSbar & """}"
    WScript.Quit 0
End If

' 7. Post-delete verification in CS03
session.findById("${CS01_FIELD_IDS.OK_CODE}").text = "/nCS03"
session.findById("wnd[0]").sendVKey 0
WScript.Sleep 500

Do While session.Children.Count > 1
    session.findById("wnd[1]").sendVKey 0
    WScript.Sleep 300
Loop

session.findById("${CS01_FIELD_IDS.MATERIAL}").text = "${escapeVbsString(cleanMat)}"
session.findById("${CS01_FIELD_IDS.PLANT}").text = "${escapeVbsString(cleanPlant)}"
session.findById("${CS01_FIELD_IDS.BOM_USAGE}").text = "${escapeVbsString(cleanUsage)}"
session.findById("${CS01_FIELD_IDS.ALT_BOM}").text = "${escapeVbsString(cleanAlt)}"

session.findById("wnd[0]").sendVKey 0
WScript.Sleep 500

Do While session.Children.Count > 1
    session.findById("wnd[1]").sendVKey 0
    WScript.Sleep 300
Loop

Dim cs03SbarType, cs03SbarText, safeCs03Sbar
cs03SbarType = session.findById("${CS01_FIELD_IDS.STATUS_BAR}").messageType
cs03SbarText = session.findById("${CS01_FIELD_IDS.STATUS_BAR}").text
safeCs03Sbar = JsonEscape(cs03SbarText)

' Check if on Screen 187 (Alternative Overview)
Dim tblPost187, rPostIdx, aPostVal, foundDeletedAlt, postAlts
Set tblPost187 = Nothing
On Error Resume Next
Set tblPost187 = session.findById("wnd[0]/usr/tblSAPLCSDITCALT")
On Error Goto 0

foundDeletedAlt = False
postAlts = ""

If Not tblPost187 Is Nothing Then
    Dim maxPostR
    maxPostR = tblPost187.RowCount - 1
    If maxPostR > 25 Then maxPostR = 25
    For rPostIdx = 0 To maxPostR
        aPostVal = ""
        On Error Resume Next
        aPostVal = Trim(tblPost187.GetCell(rPostIdx, 0).Text)
        On Error Goto 0
        If aPostVal <> "" Then
            If postAlts <> "" Then postAlts = postAlts & ","
            postAlts = postAlts & """" & JsonEscape(aPostVal) & """"
            If aPostVal = "${escapeVbsString(cleanAlt)}" Then
                foundDeletedAlt = True
            End If
        End If
    Next
End If

' Always reset session cleanly to /n
session.findById("wnd[0]/tbar[0]/okcd").text = "/n"
session.findById("wnd[0]").sendVKey 0

Dim isVerified, returnMsg
isVerified = False

If cs03SbarType = "E" Or cs03SbarType = "A" Or _
   InStr(LCase(cs03SbarText), "not found") > 0 Or _
   InStr(LCase(cs03SbarText), "does not exist") > 0 Or _
   InStr(LCase(cs03SbarText), "no bom") > 0 Or _
   InStr(LCase(cs03SbarText), "not maintained") > 0 Then
    isVerified = True
ElseIf Not tblPost187 Is Nothing And Not foundDeletedAlt Then
    isVerified = True
End If

Dim altsJsonPart
If postAlts <> "" Then
    altsJsonPart = """remainingAlternatives"":[" & postAlts & "],"
Else
    altsJsonPart = """remainingAlternatives"":[],"
End If

If isVerified Then
    returnMsg = "BOM successfully deleted via ZBOM_COPY and verified in CS03 (" & safeCs03Sbar & ")."
    If safeZbomSbar <> "" Then returnMsg = returnMsg & " [Status: " & safeZbomSbar & "]"
    WScript.Echo "{""success"":true,""verified"":true,""message"":""" & returnMsg & """,""sbar"":""" & safeZbomSbar & """,""cs03Status"":""" & safeCs03Sbar & """,""material"":""${escapeVbsString(cleanMat)}"",""plant"":""${escapeVbsString(cleanPlant)}"",""alternativeBom"":""${escapeVbsString(cleanAlt)}"",""bomUsage"":""${escapeVbsString(cleanUsage)}""," & altsJsonPart & """before"":{""material"":""${escapeVbsString(cleanMat)}"",""plant"":""${escapeVbsString(cleanPlant)}"",""alternativeBom"":""${escapeVbsString(cleanAlt)}"",""bomUsage"":""${escapeVbsString(cleanUsage)}""},""after"":{""material"":""${escapeVbsString(cleanMat)}"",""plant"":""${escapeVbsString(cleanPlant)}"",""bomUsage"":""${escapeVbsString(cleanUsage)}""}}"
Else
    returnMsg = "ZBOM_COPY executed, but BOM or Alternative ${escapeVbsString(cleanAlt)} was still found in CS03 (" & safeCs03Sbar & "). Deletion could not be verified."
    WScript.Echo "{""success"":false,""verified"":false,""code"":""DELETE_VERIFICATION_FAILED"",""message"":""" & returnMsg & """,""sbar"":""" & safeZbomSbar & """,""cs03Status"":""" & safeCs03Sbar & """}"
End If
`;

  try {
    const { stdout, stderr } = await runVbsScript(vbsScript, 45000);
    if (stderr) console.warn('[sapGuiClient] deleteBomViaGui stderr:', stderr);
    if (!stdout) {
      const health = await checkSapSessionHealth();
      if (!health.connected) {
        return {
          success: false,
          verified: false,
          code: 'SAP_CONNECTION_LOST',
          status: health.status,
          message: 'Connection to SAP was lost during the operation. The final SAP state could not be verified. Please check CS03 before retrying.'
        };
      }
      return {
        success: false,
        verified: false,
        code: 'NO_OUTPUT',
        message: 'No output from SAP GUI script for ZBOM_COPY delete.'
      };
    }
    const result = JSON.parse(stdout);
    if (!result.success || !result.verified) {
      return result;
    }

    // Secondary explicit verification in CS03 via verifyBomInCs03
    const postCheck = await verifyBomInCs03({
      material: cleanMat,
      plant: cleanPlant,
      bomUsage: cleanUsage,
      alternativeBom: cleanAlt
    });

    if (postCheck.exists) {
      return {
        success: false,
        verified: false,
        code: 'DELETE_VERIFICATION_FAILED',
        message: `Deletion could not be verified: Alternative BOM ${cleanAlt} still exists in CS03.`
      };
    }

    result.availableAlternatives = postCheck.availableAlternatives || result.remainingAlternatives || [];
    return result;
  } catch (err) {
    const health = await checkSapSessionHealth();
    if (!health.connected) {
      return {
        success: false,
        verified: false,
        code: 'SAP_CONNECTION_LOST',
        status: health.status,
        message: 'Connection to SAP was lost during the operation. The final SAP state could not be verified. Please check CS03 before retrying.'
      };
    }
    return {
      success: false,
      verified: false,
      code: 'EXECUTION_ERROR',
      message: `Failed to execute BOM delete in SAP GUI: ${err.message}`
    };
  }
}

/**
 * Standalone Source BOM validation: inspects CS03 to validate:
 * - Material existence
 * - Plant validity
 * - BOM Usage existence
 * - Alternative BOM validity (if provided) or available alternatives enumeration (if not provided)
 * - Component count in Item Overview
 *
 * @param {object} params
 * @param {string} params.material - Material Number (e.g. 'A1BH0214C')
 * @param {string} params.plant - Plant Code (e.g. '1001')
 * @param {string} [params.bomUsage='1'] - BOM Usage (default: '1')
 * @param {string} [params.alternativeBom=''] - Alternative BOM (optional)
 * @returns {Promise<{ success: boolean, materialExists?: boolean, plantValid?: boolean, bomExists?: boolean, alternativeValid?: boolean, availableAlternatives?: string[], componentCount?: number, message: string, errorCode?: string }>}
 */
export async function validateSourceBom(params) {
  const {
    material,
    plant,
    bomUsage = '1',
    alternativeBom = ''
  } = params || {};

  const cleanMat = String(material || '').trim().toUpperCase();
  const cleanPlant = String(plant || '').trim();
  const cleanUsage = String(bomUsage || '1').trim();
  const cleanAlt = String(alternativeBom || '').trim();

  if (!cleanMat) {
    return {
      success: false,
      errorCode: 'MATERIAL_NOT_FOUND',
      message: 'Material number is required for source BOM validation.'
    };
  }

  if (!cleanPlant) {
    return {
      success: false,
      errorCode: 'MATERIAL_PLANT_INVALID',
      message: 'Plant code is required for source BOM validation.'
    };
  }

  // Handle mock mode for automated unit tests
  if (process.env.USE_MOCK_SAP === 'true') {
    if (process.env.TEST_SAP_SESSION_HEALTH === 'SERVER_UNAVAILABLE') {
      return {
        success: false,
        errorCode: 'SAP_SERVER_UNAVAILABLE',
        status: 'SERVER_UNAVAILABLE',
        message: 'The SAP server is currently unavailable. Please start/reconnect SAP and try again.'
      };
    }

    if (process.env.TEST_SAP_SESSION_HEALTH === 'SESSION_NOT_FOUND' || process.env.TEST_SIMULATE_NO_SESSION === 'true') {
      return {
        success: false,
        errorCode: 'SAP_SESSION_NOT_FOUND',
        status: 'SESSION_NOT_FOUND',
        message: 'No active SAP GUI session found. Please ensure SAP GUI is open and logged into system S4A (Client 500).'
      };
    }

    if (process.env.TEST_SIMULATE_BUSY === 'true') {
      return {
        success: false,
        errorCode: 'SAP_VALIDATION_ERROR',
        status: 'BUSY',
        message: 'SAP GUI session is temporarily busy. Please retry.'
      };
    }

    if (process.env.TEST_SAP_SESSION_HEALTH === 'BUSY') {
      return {
        success: false,
        errorCode: 'SAP_SESSION_BUSY',
        status: 'BUSY',
        message: 'SAP GUI session is temporarily busy. Please retry.'
      };
    }

    if (cleanMat.startsWith('NON') || cleanMat === 'MAT_NOT_FOUND') {
      return {
        success: false,
        errorCode: 'MATERIAL_NOT_FOUND',
        message: `The material ${cleanMat} does not exist or is not activated`
      };
    }

    if (cleanPlant === '9999') {
      return {
        success: false,
        errorCode: 'MATERIAL_PLANT_INVALID',
        message: `Plant ${cleanPlant} not defined (please check your entry)`
      };
    }

    if (cleanPlant === '1002' || cleanPlant === '1003') {
      return {
        success: false,
        errorCode: 'MATERIAL_PLANT_INVALID',
        message: `Material ${cleanMat} not maintained in plant ${cleanPlant}`
      };
    }

    const match = activeMockBomDataset.find(b =>
      b.material.toUpperCase() === cleanMat &&
      b.plant === cleanPlant &&
      b.bomUsage === cleanUsage
    );

    if (!match) {
      return {
        success: false,
        errorCode: 'BOM_NOT_FOUND',
        message: `No BOM exists for material ${cleanMat} in plant ${cleanPlant} with BOM usage ${cleanUsage}.`
      };
    }

    if (cleanAlt) {
      if (!match.availableAlternatives.includes(cleanAlt)) {
        return {
          success: false,
          errorCode: 'ALTERNATIVE_NOT_FOUND',
          availableAlternatives: [...match.availableAlternatives],
          message: `Alternative BOM ${cleanAlt} does not exist for material ${cleanMat} in plant ${cleanPlant} with BOM usage ${cleanUsage}.`
        };
      }
      return {
        success: true,
        materialExists: true,
        plantValid: true,
        bomExists: true,
        alternativeValid: true,
        availableAlternatives: [...match.availableAlternatives],
        componentCount: match.componentCount || 1,
        message: 'Source BOM validated successfully.'
      };
    }

    return {
      success: true,
      materialExists: true,
      plantValid: true,
      bomExists: true,
      alternativeValid: true,
      availableAlternatives: [...match.availableAlternatives],
      componentCount: match.componentCount || 1,
      message: 'Source BOM validated successfully.'
    };
  }

  // Live SAP GUI execution preflight check
  const preflight = await ensureSapSession();
  if (!preflight.ok) {
    return {
      success: false,
      errorCode: preflight.status === 'SERVER_UNAVAILABLE' ? 'SAP_SERVER_UNAVAILABLE' : (preflight.code || 'SAP_SESSION_NOT_FOUND'),
      status: preflight.status,
      message: preflight.message
    };
  }

  const targetSessionPath = preflight.sessionPath || '';
  const expectedUser = preflight.user || '';

  const vbsScript = `
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
    WScript.Echo "{""success"":false,""errorCode"":""SAP_SESSION_NOT_FOUND"",""message"":""No running SAP GUI instance found.""}"
    WScript.Quit 0
End If

Set app = SapGuiAuto.GetScriptingEngine
If Err.Number <> 0 Or app Is Nothing Then
    WScript.Echo "{""success"":false,""errorCode"":""SAP_SESSION_NOT_FOUND"",""message"":""SAP GUI Scripting is disabled or unavailable.""}"
    WScript.Quit 0
End If

${getSessionDiscoveryVbs(targetSessionPath, expectedUser)}

If session Is Nothing Then
    WScript.Echo "{""success"":false,""errorCode"":""SAP_SESSION_NOT_FOUND"",""message"":""No active SAP GUI session found.""}"
    WScript.Quit 0
End If

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
session.findById("wnd[0]/usr/ctxtRC29N-MATNR").text = "${escapeVbsString(cleanMat)}"
session.findById("wnd[0]/usr/ctxtRC29N-WERKS").text = "${escapeVbsString(cleanPlant)}"
session.findById("wnd[0]/usr/ctxtRC29N-STLAN").text = "${escapeVbsString(cleanUsage)}"
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
targetAlt = "${escapeVbsString(cleanAlt)}"

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
        WScript.Echo "{""success"":false,""errorCode"":""ALTERNATIVE_NOT_FOUND"",""availableAlternatives"":[" & availableAlts & "],""message"":""Alternative BOM " & JsonEscape(targetAlt) & " does not exist for material ${escapeVbsString(cleanMat)} in plant ${escapeVbsString(cleanPlant)} with BOM usage ${escapeVbsString(cleanUsage)}.""}"
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
            WScript.Echo "{""success"":false,""errorCode"":""ALTERNATIVE_NOT_FOUND"",""availableAlternatives"":[" & availableAlts & "],""message"":""Alternative BOM " & JsonEscape(targetAlt) & " does not exist for material ${escapeVbsString(cleanMat)} in plant ${escapeVbsString(cleanPlant)} with BOM usage ${escapeVbsString(cleanUsage)}.""}"
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

  try {
    const { stdout, stderr } = await runVbsScript(vbsScript, 30000);
    if (stderr) console.warn('[sapGuiClient] validateSourceBom stderr:', stderr);
    if (!stdout) {
      const health = await checkSapSessionHealth();
      if (!health.connected) {
        return {
          success: false,
          errorCode: health.status === 'SERVER_UNAVAILABLE' ? 'SAP_SERVER_UNAVAILABLE' : (health.code || 'SAP_SESSION_NOT_FOUND'),
          status: health.status,
          message: health.message
        };
      }
      return {
        success: false,
        errorCode: 'SAP_VALIDATION_ERROR',
        message: 'No response received from SAP GUI Scripting engine during source validation.'
      };
    }
    const result = JSON.parse(stdout);
    return result;
  } catch (err) {
    const health = await checkSapSessionHealth();
    if (!health.connected) {
      return {
        success: false,
        errorCode: health.status === 'SERVER_UNAVAILABLE' ? 'SAP_SERVER_UNAVAILABLE' : (health.code || 'SAP_SESSION_NOT_FOUND'),
        status: health.status,
        message: health.message
      };
    }
    return {
      success: false,
      errorCode: 'SAP_VALIDATION_ERROR',
      message: `Source BOM validation failed: ${err.message}`
    };
  }
}

export default {
  CS01_FIELD_IDS,
  ZBOM_COPY_FIELD_IDS,
  connectToSapGui,
  checkSapSessionHealth,
  ensureSapSession,
  ensureSelectedSapSession,
  getSapConnectionStatus,
  discoverSapSessions,
  getSelectedSapSessionId,
  setSelectedSapSessionId,
  getSelectedSapUser,
  resetSelectedSapSession,
  createBomViaGui,
  copyBomViaGui,
  deleteBomViaGui,
  verifyBomInCs03,
  verifyBom,
  checkMaterialPlantExtension,
  checkBomSubDependencies,
  discoverBomHierarchy,
  resolveNextAvailableAlternative,
  formatHierarchyTree,
  verifyHierarchyStructure,
  inspectAndVerifyHierarchy,
  repairHierarchyBottomUp,
  copyBomHierarchyWithRepair,
  compareBomStructures,
  validateSourceBom,
  getMockBomDataset,
  resetMockBomDataset,
  setMockBomAlternatives,
  setMockSapSessionUser,
  resetMockSapSessionUser,
  getActiveSapUser,
  setMockSapSessions,
  resetMockSapSessions
};


