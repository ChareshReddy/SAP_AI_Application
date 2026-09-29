import assert from 'assert';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

import {
  CS01_FIELD_IDS,
  SAMPLE_A1BH0214C_COMPONENTS,
  ZBOM_COPY_FIELD_IDS
} from '../services/sapGuiClient.js';

function checkUndeclaredVariables(vbsContent, testName) {
  const declared = new Set([
    'wscript', 'err', 'nothing', 'true', 'false', 'empty', 'null',
    'vbtrue', 'vbfalse', 'vbcr', 'vblf', 'vbcrlf', 'vbtab',
    'lcase', 'ucase', 'trim', 'cstr', 'cint', 'clng', 'cdbl', 'cdate',
    'isnull', 'isempty', 'isnumeric', 'isarray', 'isobject',
    'instr', 'replace', 'createobject', 'getobject', 'hex', 'space',
    'left', 'right', 'mid', 'len', 'split', 'join', 'ubound', 'lbound',
    'date', 'now', 'time'
  ]);

  // Extract all Dim variables
  const dimRegex = /^\s*Dim\s+([^\r\n']+)/gim;
  let match;
  while ((match = dimRegex.exec(vbsContent)) !== null) {
    const vars = match[1].split(',');
    for (const v of vars) {
      const clean = v.trim().toLowerCase();
      if (clean) declared.add(clean);
    }
  }

  // Extract all Function / Sub names and parameters
  const funcRegex = /^\s*(?:Function|Sub)\s+([a-zA-Z0-9_]+)\s*(?:\(([^)]*)\))?/gim;
  while ((match = funcRegex.exec(vbsContent)) !== null) {
    declared.add(match[1].trim().toLowerCase());
    if (match[2]) {
      const params = match[2].split(',');
      for (const p of params) {
        const cleanP = p.replace(/\b(ByVal|ByRef)\b/gi, '').trim().toLowerCase();
        if (cleanP) declared.add(cleanP);
      }
    }
  }

  // Check assignments and conditions
  const lines = vbsContent.split(/\r?\n/);
  for (let lineNum = 1; lineNum <= lines.length; lineNum++) {
    const rawLine = lines[lineNum - 1];
    const line = rawLine.split("'")[0].trim();
    if (!line) continue;

    const forMatch = line.match(/^For\s+([a-zA-Z0-9_]+)\s*=/i);
    if (forMatch) {
      const v = forMatch[1].toLowerCase();
      assert.ok(declared.has(v), `Undeclared variable '${forMatch[1]}' in For loop on line ${lineNum} in ${testName}`);
    }

    const setMatch = line.match(/^Set\s+([a-zA-Z0-9_]+)\s*=/i);
    if (setMatch) {
      const v = setMatch[1].toLowerCase();
      assert.ok(declared.has(v), `Undeclared variable '${setMatch[1]}' in Set assignment on line ${lineNum} in ${testName}`);
    }

    const assignMatch = line.match(/^([a-zA-Z0-9_]+)\s*=(?!=)/i);
    if (assignMatch && !['if', 'elseif', 'while', 'select', 'case', 'set', 'const', 'dim', 'redim', 'exit'].includes(assignMatch[1].toLowerCase())) {
      const v = assignMatch[1].toLowerCase();
      assert.ok(declared.has(v), `Undeclared variable '${assignMatch[1]}' in assignment on line ${lineNum} in ${testName}`);
    }

    const ifMatch = line.match(/^(?:If|ElseIf)\s+([a-zA-Z0-9_]+)\s*(?:[><=]|<>)/i);
    if (ifMatch && !['not', 'len', 'instr', 'isnull', 'isempty', 'isnumeric'].includes(ifMatch[1].toLowerCase())) {
      const v = ifMatch[1].toLowerCase();
      assert.ok(declared.has(v), `Undeclared variable '${ifMatch[1]}' in condition on line ${lineNum} in ${testName}`);
    }
  }
  console.log(`   ✓ [Variables OK] All assigned/condition variables declared in ${testName}`);
}

function validateVbsSyntax(vbsContent, testName) {
  // Ensure Option Explicit is present and prepend WScript.Quit 0 right after it
  // This forces cscript to compile the entire file for syntax errors without executing runtime COM commands
  assert.ok(vbsContent.includes('Option Explicit'), `${testName} must start with Option Explicit`);
  
  checkUndeclaredVariables(vbsContent, testName);

  const testScript = vbsContent.replace('Option Explicit', 'Option Explicit\r\nWScript.Quit 0\r\n');
  const tempPath = path.join(os.tmpdir(), `vbs_syntax_test_${Date.now()}_${Math.random().toString(36).slice(2)}.vbs`);
  
  fs.writeFileSync(tempPath, testScript, 'utf-8');
  
  try {
    execFileSync('cscript.exe', ['//Nologo', tempPath], {
      encoding: 'utf-8',
      timeout: 10000
    });
    console.log(`   ✓ [Syntax OK] ${testName} compiled successfully (0 errors)`);
  } catch (err) {
    const errorMsg = (err.stderr || err.stdout || err.message || '').trim();
    console.error(`   ✗ [Syntax Error] ${testName} failed compilation:\n${errorMsg}`);
    throw new Error(`VBScript compilation failed for ${testName}: ${errorMsg}`);
  } finally {
    try {
      if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    } catch (_) {}
  }
}

async function runVbsSyntaxTests() {
  console.log('\n======================================================');
  console.log('--- Starting Generated VBScript Syntax Validation Suite ---');
  console.log('======================================================');

  const sapGuiClientPath = path.resolve(__dirname, '../services/sapGuiClient.js');
  const code = fs.readFileSync(sapGuiClientPath, 'utf-8').replace(/\r\n/g, '\n');

  // 1. TEST DIRECT-CREATE VBSCRIPT (createBomViaGui) WITH 16 COMPONENTS FOR A1BH0214C ALT 2
  console.log('\n1. Validating createBomViaGui VBScript (A1BH0214C Alt 2 with 16 components):');
  const createStart = code.indexOf('export async function createBomViaGui');
  const createVbsStart = code.indexOf('const vbsScript = `', createStart);
  const createVbsEnd = code.indexOf('`;\n\n  try {', createVbsStart);
  const createTemplate = code.substring(createVbsStart + 'const vbsScript = `'.length, createVbsEnd);

  const BATCH_SIZE = 10;
  function buildTestComponentStatements(comps) {
    const stmts = [];
    comps.forEach((item, idx) => {
      const relIdx = idx % BATCH_SIZE;
      const isBatchTransition = idx > 0 && relIdx === 0;
      if (isBatchTransition) {
        stmts.push(`
    ' Commit batch and advance table scroll position for component ${idx + 1}
    session.findById("wnd[0]").sendVKey 0
    WScript.Sleep 400

    popupLoopCount = 0
    Do While session.Children.Count > 1 And popupLoopCount < 5
        popupLoopCount = popupLoopCount + 1
        batchPopup = GetWindowText(session.findById("wnd[1]"))
        If IsHardError(batchPopup) Then
            WScript.Echo "{""success"":false,""verified"":false,""code"":""ITEM_ERROR"",""message"":""Component Error: " & JsonEscape(batchPopup) & """}"
            session.findById("wnd[1]").sendVKey 12
            session.findById("wnd[0]/tbar[0]/okcd").text = "/n"
            session.findById("wnd[0]").sendVKey 0
            WScript.Quit 0
        Else
            session.findById("wnd[1]").sendVKey 0
            WScript.Sleep 300
        End If
    Loop

    For sbarAck = 1 To 5
        curSbarType = session.findById("${CS01_FIELD_IDS.STATUS_BAR}").messageType
        If curSbarType = "E" Or curSbarType = "A" Then
            batchErrTxt = session.findById("${CS01_FIELD_IDS.STATUS_BAR}").text
            WScript.Echo "{""success"":false,""verified"":false,""code"":""ITEM_ERROR"",""message"":""Component Error: " & JsonEscape(batchErrTxt) & """}"
            session.findById("wnd[0]/tbar[0]/okcd").text = "/n"
            session.findById("wnd[0]").sendVKey 0
            WScript.Quit 0
        ElseIf curSbarType = "W" Or curSbarType = "I" Then
            session.findById("wnd[0]").sendVKey 0
            WScript.Sleep 300
        Else
            Exit For
        End If
    Next

    On Error Resume Next
    session.findById("${CS01_FIELD_IDS.TABLE_BASE}").verticalScrollbar.position = ${idx}
    On Error Goto 0
    WScript.Sleep 300
        `);
      }

      stmts.push(`
    ' Component Row ${idx + 1} (relative visible row index ${relIdx})
    session.findById("${CS01_FIELD_IDS.TABLE_BASE}/${CS01_FIELD_IDS.ITEM_CATEGORY_FIELD}[1,${relIdx}]").text = "${item.itemCategory}"
    session.findById("${CS01_FIELD_IDS.TABLE_BASE}/${CS01_FIELD_IDS.COMPONENT_FIELD}[2,${relIdx}]").text = "${item.material}"
    session.findById("${CS01_FIELD_IDS.TABLE_BASE}/${CS01_FIELD_IDS.QUANTITY_FIELD}[4,${relIdx}]").text = "${item.quantity}"
    session.findById("${CS01_FIELD_IDS.TABLE_BASE}/${CS01_FIELD_IDS.UNIT_FIELD}[5,${relIdx}]").text = "${item.unit || 'KG'}"
    session.findById("${CS01_FIELD_IDS.TABLE_BASE}/${CS01_FIELD_IDS.QUANTITY_FIELD}[4,${relIdx}]").setFocus
    WScript.Sleep 200
      `);
    });
    return stmts;
  }

  const componentStatements = buildTestComponentStatements(SAMPLE_A1BH0214C_COMPONENTS);

  const renderedCreateVbs = createTemplate
    .replace(/\$\{getSessionDiscoveryVbs\(targetSessionPath, expectedUser\)\}/g, 'Set session = app.FindById("/app/con[0]/ses[0]")')
    .replace(/\$\{CS01_FIELD_IDS\.OK_CODE\}/g, CS01_FIELD_IDS.OK_CODE)
    .replace(/\$\{CS01_FIELD_IDS\.MATERIAL\}/g, CS01_FIELD_IDS.MATERIAL)
    .replace(/\$\{CS01_FIELD_IDS\.PLANT\}/g, CS01_FIELD_IDS.PLANT)
    .replace(/\$\{CS01_FIELD_IDS\.BOM_USAGE\}/g, CS01_FIELD_IDS.BOM_USAGE)
    .replace(/\$\{CS01_FIELD_IDS\.ALT_BOM\}/g, CS01_FIELD_IDS.ALT_BOM)
    .replace(/\$\{CS01_FIELD_IDS\.VALID_FROM\}/g, CS01_FIELD_IDS.VALID_FROM)
    .replace(/\$\{CS01_FIELD_IDS\.SAVE_BUTTON\}/g, CS01_FIELD_IDS.SAVE_BUTTON)
    .replace(/\$\{CS01_FIELD_IDS\.STATUS_BAR\}/g, CS01_FIELD_IDS.STATUS_BAR)
    .replace(/\$\{CS01_FIELD_IDS\.TABLE_BASE\}/g, CS01_FIELD_IDS.TABLE_BASE)
    .replace(/\$\{CS01_FIELD_IDS\.ITEM_CATEGORY_FIELD\}/g, CS01_FIELD_IDS.ITEM_CATEGORY_FIELD)
    .replace(/\$\{CS01_FIELD_IDS\.COMPONENT_FIELD\}/g, CS01_FIELD_IDS.COMPONENT_FIELD)
    .replace(/\$\{CS01_FIELD_IDS\.QUANTITY_FIELD\}/g, CS01_FIELD_IDS.QUANTITY_FIELD)
    .replace(/\$\{CS01_FIELD_IDS\.UNIT_FIELD \|\| 'ctxtRC29P-MEINS'\}/g, CS01_FIELD_IDS.UNIT_FIELD)
    .replace(/\$\{componentStatements\.join\('\\n'\)\}/g, componentStatements.join('\n'))
    .replace(/\$\{escapeVbsString\(material\)\}/g, 'A1BH0214C')
    .replace(/\$\{escapeVbsString\(plant\)\}/g, '1012')
    .replace(/\$\{escapeVbsString\(bomUsage\)\}/g, '1')
    .replace(/\$\{escapeVbsString\(alternativeBom\)\}/g, '2')
    .replace(/\$\{escapeVbsString\(validFrom\)\}/g, '28.09.2026')
    .replace(/\$\{alternativeBom \? [^:]+ : ''\}/g, 'session.findById("wnd[0]/usr/txtRC29N-STLAL").text = "2"')
    .replace(/\$\{validFrom \? [^:]+ : ''\}/g, 'session.findById("wnd[0]/usr/ctxtRC29N-DATUV").text = "28.09.2026"')
    .replace(/\$\{createdAltBom \? [^:]+ : ''\}/g, '');

  validateVbsSyntax(renderedCreateVbs, 'createBomViaGui (A1BH0214C Alt 2 with 16 components)');

  // 1b. TEST DIRECT-CREATE VBSCRIPT WITH 25 COMPONENTS (Multi-Page Scroll)
  console.log('\n1b. Validating createBomViaGui VBScript (25 components multi-page scrolling):');
  const sample25Comps = Array.from({ length: 25 }, (_, i) => ({
    item: String((i + 1) * 10).padStart(4, '0'),
    material: `COMP_MAT_${i + 1}`,
    quantity: '1.500',
    itemCategory: 'L'
  }));
  const componentStatements25 = buildTestComponentStatements(sample25Comps);
  const renderedCreate25Vbs = createTemplate
    .replace(/\$\{getSessionDiscoveryVbs\(targetSessionPath, expectedUser\)\}/g, 'Set session = app.FindById("/app/con[0]/ses[0]")')
    .replace(/\$\{CS01_FIELD_IDS\.OK_CODE\}/g, CS01_FIELD_IDS.OK_CODE)
    .replace(/\$\{CS01_FIELD_IDS\.MATERIAL\}/g, CS01_FIELD_IDS.MATERIAL)
    .replace(/\$\{CS01_FIELD_IDS\.PLANT\}/g, CS01_FIELD_IDS.PLANT)
    .replace(/\$\{CS01_FIELD_IDS\.BOM_USAGE\}/g, CS01_FIELD_IDS.BOM_USAGE)
    .replace(/\$\{CS01_FIELD_IDS\.ALT_BOM\}/g, CS01_FIELD_IDS.ALT_BOM)
    .replace(/\$\{CS01_FIELD_IDS\.VALID_FROM\}/g, CS01_FIELD_IDS.VALID_FROM)
    .replace(/\$\{CS01_FIELD_IDS\.SAVE_BUTTON\}/g, CS01_FIELD_IDS.SAVE_BUTTON)
    .replace(/\$\{CS01_FIELD_IDS\.STATUS_BAR\}/g, CS01_FIELD_IDS.STATUS_BAR)
    .replace(/\$\{CS01_FIELD_IDS\.TABLE_BASE\}/g, CS01_FIELD_IDS.TABLE_BASE)
    .replace(/\$\{CS01_FIELD_IDS\.ITEM_CATEGORY_FIELD\}/g, CS01_FIELD_IDS.ITEM_CATEGORY_FIELD)
    .replace(/\$\{CS01_FIELD_IDS\.COMPONENT_FIELD\}/g, CS01_FIELD_IDS.COMPONENT_FIELD)
    .replace(/\$\{CS01_FIELD_IDS\.QUANTITY_FIELD\}/g, CS01_FIELD_IDS.QUANTITY_FIELD)
    .replace(/\$\{CS01_FIELD_IDS\.UNIT_FIELD \|\| 'ctxtRC29P-MEINS'\}/g, CS01_FIELD_IDS.UNIT_FIELD)
    .replace(/\$\{componentStatements\.join\('\\n'\)\}/g, componentStatements25.join('\n'))
    .replace(/\$\{escapeVbsString\(material\)\}/g, 'H1SOTAN0031')
    .replace(/\$\{escapeVbsString\(plant\)\}/g, '1012')
    .replace(/\$\{escapeVbsString\(bomUsage\)\}/g, '1')
    .replace(/\$\{escapeVbsString\(alternativeBom\)\}/g, '3')
    .replace(/\$\{escapeVbsString\(validFrom\)\}/g, '29.09.2026')
    .replace(/\$\{alternativeBom \? [^:]+ : ''\}/g, 'session.findById("wnd[0]/usr/txtRC29N-STLAL").text = "3"')
    .replace(/\$\{validFrom \? [^:]+ : ''\}/g, 'session.findById("wnd[0]/usr/ctxtRC29N-DATUV").text = "29.09.2026"')
    .replace(/\$\{createdAltBom \? [^:]+ : ''\}/g, '');

  validateVbsSyntax(renderedCreate25Vbs, 'createBomViaGui (25 components multi-page scrolling)');

  // 2. TEST COPY BOM VBSCRIPT (copyBomViaGui)
  console.log('\n2. Validating copyBomViaGui VBScript:');
  const copyStart = code.indexOf('export async function copyBomViaGui');
  const copyVbsStart = code.indexOf('const vbsScript = `', copyStart);
  const copyVbsEnd = code.indexOf('`;\n\n  try {', copyVbsStart);
  const copyTemplate = code.substring(copyVbsStart + 'const vbsScript = `'.length, copyVbsEnd);

  const renderedCopyVbs = copyTemplate
    .replace(/\$\{getSessionDiscoveryVbs\(targetSessionPath, expectedUser\)\}/g, 'Set session = app.FindById("/app/con[0]/ses[0]")')
    .replace(/\$\{CS01_FIELD_IDS\.OK_CODE\}/g, CS01_FIELD_IDS.OK_CODE)
    .replace(/\$\{CS01_FIELD_IDS\.MATERIAL\}/g, CS01_FIELD_IDS.MATERIAL)
    .replace(/\$\{CS01_FIELD_IDS\.PLANT\}/g, CS01_FIELD_IDS.PLANT)
    .replace(/\$\{CS01_FIELD_IDS\.BOM_USAGE\}/g, CS01_FIELD_IDS.BOM_USAGE)
    .replace(/\$\{CS01_FIELD_IDS\.ALT_BOM\}/g, CS01_FIELD_IDS.ALT_BOM)
    .replace(/\$\{CS01_FIELD_IDS\.VALID_FROM\}/g, CS01_FIELD_IDS.VALID_FROM)
    .replace(/\$\{CS01_FIELD_IDS\.SAVE_BUTTON\}/g, CS01_FIELD_IDS.SAVE_BUTTON)
    .replace(/\$\{CS01_FIELD_IDS\.STATUS_BAR\}/g, CS01_FIELD_IDS.STATUS_BAR)
    .replace(/\$\{CS01_FIELD_IDS\.TABLE_BASE\}/g, CS01_FIELD_IDS.TABLE_BASE)
    .replace(/\$\{CS01_FIELD_IDS\.ITEM_CATEGORY_FIELD\}/g, CS01_FIELD_IDS.ITEM_CATEGORY_FIELD)
    .replace(/\$\{CS01_FIELD_IDS\.COMPONENT_FIELD\}/g, CS01_FIELD_IDS.COMPONENT_FIELD)
    .replace(/\$\{CS01_FIELD_IDS\.QUANTITY_FIELD\}/g, CS01_FIELD_IDS.QUANTITY_FIELD)
    .replace(/\$\{CS01_FIELD_IDS\.COPY_BUTTON\}/g, CS01_FIELD_IDS.COPY_BUTTON)
    .replace(/\$\{CS01_FIELD_IDS\.COPY_REF_MATERIAL\}/g, CS01_FIELD_IDS.COPY_REF_MATERIAL)
    .replace(/\$\{CS01_FIELD_IDS\.COPY_REF_PLANT\}/g, CS01_FIELD_IDS.COPY_REF_PLANT)
    .replace(/\$\{CS01_FIELD_IDS\.COPY_REF_BOM_USAGE\}/g, CS01_FIELD_IDS.COPY_REF_BOM_USAGE)
    .replace(/\$\{CS01_FIELD_IDS\.COPY_REF_ALT_BOM\}/g, CS01_FIELD_IDS.COPY_REF_ALT_BOM)
    .replace(/\$\{CS01_FIELD_IDS\.COPY_POPUP_CONFIRM\}/g, CS01_FIELD_IDS.COPY_POPUP_CONFIRM)
    .replace(/\$\{sourceMaterial\}/g, 'A1BH0214C')
    .replace(/\$\{sourcePlant\}/g, '1001')
    .replace(/\$\{sourceBomUsage\}/g, '1')
    .replace(/\$\{sourceAltBom\}/g, '2')
    .replace(/\$\{targetMaterial\}/g, 'A1BH0214C')
    .replace(/\$\{targetPlant\}/g, '1012')
    .replace(/\$\{targetBomUsage\}/g, '1')
    .replace(/\$\{targetAltBom\}/g, '2')
    .replace(/\$\{targetValidFrom\}/g, '28.09.2026')
    .replace(/\$\{targetAltBom \? [^:]+ : ''\}/g, 'session.findById("wnd[0]/usr/txtRC29N-STLAL").text = "2"')
    .replace(/\$\{targetValidFrom \? [^:]+ : ''\}/g, 'session.findById("wnd[0]/usr/ctxtRC29N-DATUV").text = "28.09.2026"');

  validateVbsSyntax(renderedCopyVbs, 'copyBomViaGui VBScript');

  // 3. TEST CS03 VERIFICATION VBSCRIPT (verifyBomInCs03)
  console.log('\n3. Validating verifyBomInCs03 VBScript:');
  const verifyStart = code.indexOf('export async function verifyBomInCs03');
  const verifyVbsStart = code.indexOf('const vbsScript = `', verifyStart);
  const verifyVbsEnd = code.indexOf('`;\n\n  try {', verifyVbsStart);
  const verifyTemplate = code.substring(verifyVbsStart + 'const vbsScript = `'.length, verifyVbsEnd);

  const renderedVerifyVbs = verifyTemplate
    .replace(/\$\{getSessionDiscoveryVbs\(targetSessionPath, expectedUser\)\}/g, 'Set session = app.FindById("/app/con[0]/ses[0]")')
    .replace(/\$\{CS01_FIELD_IDS\.OK_CODE\}/g, CS01_FIELD_IDS.OK_CODE)
    .replace(/\$\{CS01_FIELD_IDS\.MATERIAL\}/g, CS01_FIELD_IDS.MATERIAL)
    .replace(/\$\{CS01_FIELD_IDS\.PLANT\}/g, CS01_FIELD_IDS.PLANT)
    .replace(/\$\{CS01_FIELD_IDS\.BOM_USAGE\}/g, CS01_FIELD_IDS.BOM_USAGE)
    .replace(/\$\{CS01_FIELD_IDS\.ALT_BOM\}/g, CS01_FIELD_IDS.ALT_BOM)
    .replace(/\$\{CS01_FIELD_IDS\.STATUS_BAR\}/g, CS01_FIELD_IDS.STATUS_BAR)
    .replace(/\$\{CS01_FIELD_IDS\.TABLE_BASE\}/g, CS01_FIELD_IDS.TABLE_BASE)
    .replace(/\$\{CS01_FIELD_IDS\.ITEM_CATEGORY_FIELD\}/g, CS01_FIELD_IDS.ITEM_CATEGORY_FIELD)
    .replace(/\$\{CS01_FIELD_IDS\.COMPONENT_FIELD\}/g, CS01_FIELD_IDS.COMPONENT_FIELD)
    .replace(/\$\{CS01_FIELD_IDS\.QUANTITY_FIELD\}/g, CS01_FIELD_IDS.QUANTITY_FIELD)
    .replace(/\$\{escapeVbsString\(material\)\}/g, 'A1BH0214C')
    .replace(/\$\{escapeVbsString\(plant\)\}/g, '1012')
    .replace(/\$\{escapeVbsString\(bomUsage\)\}/g, '1')
    .replace(/\$\{escapeVbsString\(alternativeBom\)\}/g, '2')
    .replace(/\$\{alternativeBom \? [^:]+ : ''\}/g, 'session.findById("wnd[0]/usr/txtRC29N-STLAL").text = "2"');

  validateVbsSyntax(renderedVerifyVbs, 'verifyBomInCs03 VBScript');

  // 4. TEST DELETE BOM VBSCRIPT (deleteBomViaGui)
  console.log('\n4. Validating deleteBomViaGui VBScript (ZBOM_COPY):');
  const deleteStart = code.indexOf('export async function deleteBomViaGui');
  const deleteVbsStart = code.indexOf('const vbsScript = `', deleteStart);
  const deleteVbsEnd = code.indexOf('`;\n\n  try {', deleteVbsStart);
  const deleteTemplate = code.substring(deleteVbsStart + 'const vbsScript = `'.length, deleteVbsEnd);

  const renderedDeleteVbs = deleteTemplate
    .replace(/\$\{getSessionDiscoveryVbs\(targetSessionPath, expectedUser\)\}/g, 'Set session = app.FindById("/app/con[0]/ses[0]")')
    .replace(/\$\{ZBOM_COPY_FIELD_IDS\.OK_CODE\}/g, ZBOM_COPY_FIELD_IDS.OK_CODE)
    .replace(/\$\{ZBOM_COPY_FIELD_IDS\.RADIO_DELETE\}/g, ZBOM_COPY_FIELD_IDS.RADIO_DELETE)
    .replace(/\$\{ZBOM_COPY_FIELD_IDS\.MATERIAL\}/g, ZBOM_COPY_FIELD_IDS.MATERIAL)
    .replace(/\$\{ZBOM_COPY_FIELD_IDS\.PLANT\}/g, ZBOM_COPY_FIELD_IDS.PLANT)
    .replace(/\$\{ZBOM_COPY_FIELD_IDS\.ALT_BOM\}/g, ZBOM_COPY_FIELD_IDS.ALT_BOM)
    .replace(/\$\{ZBOM_COPY_FIELD_IDS\.BOM_USAGE\}/g, ZBOM_COPY_FIELD_IDS.BOM_USAGE)
    .replace(/\$\{ZBOM_COPY_FIELD_IDS\.EXECUTE_BUTTON\}/g, ZBOM_COPY_FIELD_IDS.EXECUTE_BUTTON)
    .replace(/\$\{ZBOM_COPY_FIELD_IDS\.POPUP_CONFIRM\}/g, ZBOM_COPY_FIELD_IDS.POPUP_CONFIRM)
    .replace(/\$\{ZBOM_COPY_FIELD_IDS\.STATUS_BAR\}/g, ZBOM_COPY_FIELD_IDS.STATUS_BAR)
    .replace(/\$\{CS01_FIELD_IDS\.OK_CODE\}/g, CS01_FIELD_IDS.OK_CODE)
    .replace(/\$\{CS01_FIELD_IDS\.MATERIAL\}/g, CS01_FIELD_IDS.MATERIAL)
    .replace(/\$\{CS01_FIELD_IDS\.PLANT\}/g, CS01_FIELD_IDS.PLANT)
    .replace(/\$\{CS01_FIELD_IDS\.BOM_USAGE\}/g, CS01_FIELD_IDS.BOM_USAGE)
    .replace(/\$\{CS01_FIELD_IDS\.ALT_BOM\}/g, CS01_FIELD_IDS.ALT_BOM)
    .replace(/\$\{CS01_FIELD_IDS\.STATUS_BAR\}/g, CS01_FIELD_IDS.STATUS_BAR)
    .replace(/\$\{escapeVbsString\(cleanMat\)\}/g, 'A1BH0214C')
    .replace(/\$\{escapeVbsString\(cleanPlant\)\}/g, '1012')
    .replace(/\$\{escapeVbsString\(cleanAlt\)\}/g, '2')
    .replace(/\$\{escapeVbsString\(cleanUsage\)\}/g, '1');

  validateVbsSyntax(renderedDeleteVbs, 'deleteBomViaGui VBScript');

  console.log('\n======================================================');
  console.log('✅ ALL GENERATED VBSCRIPT SYNTAX VALIDATION TESTS PASSED!');
  console.log('======================================================');
}

runVbsSyntaxTests().catch((err) => {
  console.error('\n❌ VBScript syntax test failed:', err);
  process.exit(1);
});
