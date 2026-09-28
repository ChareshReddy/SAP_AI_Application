import fs from 'fs';
import path from 'path';

// Let's inspect getSessionDiscoveryVbs
function getSessionDiscoveryVbs(targetSessionPath = '', expectedUser = '') {
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
On Error Resume Next
Set targetSession = app.findById("${targetSessionPath}")
On Error Goto 0
` : '') + `
If Not targetSession Is Nothing Then
    Set session = targetSession
End If
' --- End Dynamic Session Discovery ---
`;
}

// Extract vbsScript from verifyBomInCs03
const content = fs.readFileSync('./services/sapGuiClient.js', 'utf-8');

function extractVbs(fnName) {
  const fnIdx = content.indexOf(`export async function ${fnName}`);
  const vbsStart = content.indexOf('const vbsScript = `', fnIdx);
  const vbsEnd = content.indexOf('`;', vbsStart);
  return content.slice(vbsStart + 19, vbsEnd);
}

const cs03Template = extractVbs('verifyBomInCs03');
const copyTemplate = extractVbs('copyBomViaGui');
const validateTemplate = extractVbs('validateSourceBom');

// Let's render verifyBomInCs03
let cs03Rendered = cs03Template
  .replace(/\$\{getSessionDiscoveryVbs\(targetSessionPath, expectedUser\)\}/g, getSessionDiscoveryVbs('/app/con[0]/ses[0]', 'ACCESS1'))
  .replace(/\$\{escapeVbsString\(material\)\}/g, 'A1BH0214C')
  .replace(/\$\{escapeVbsString\(plant\)\}/g, '1001')
  .replace(/\$\{escapeVbsString\(bomUsage\)\}/g, '1')
  .replace(/\$\{escapeVbsString\(alternativeBom\)\}/g, '')
  .replace(/\$\{alternativeBom \? [^}]+\}/g, '');

const cs03Lines = cs03Rendered.split('\n');
console.log('verifyBomInCs03 rendered lines:', cs03Lines.length);

// Let's render validateSourceBom
let valRendered = validateTemplate
  .replace(/\$\{getSessionDiscoveryVbs\(targetSessionPath, expectedUser\)\}/g, getSessionDiscoveryVbs('/app/con[0]/ses[0]', 'ACCESS1'))
  .replace(/\$\{cleanMaterial\}/g, 'A1BH0214C')
  .replace(/\$\{cleanPlant\}/g, '1001')
  .replace(/\$\{cleanBomUsage\}/g, '1')
  .replace(/\$\{cleanAltBom\}/g, '');

const valLines = valRendered.split('\n');
console.log('validateSourceBom rendered lines:', valLines.length);
if (valLines.length >= 420) {
  console.log('--- validateSourceBom lines 420-430 ---');
  for (let i = 420; i <= Math.min(430, valLines.length); i++) {
    console.log(`${i}: ${valLines[i-1]}`);
  }
}

// Let's render copyBomViaGui
let copyRendered = copyTemplate
  .replace(/\$\{getSessionDiscoveryVbs\(targetSessionPath, expectedUser\)\}/g, getSessionDiscoveryVbs('/app/con[0]/ses[0]', 'ACCESS1'))
  .replace(/\$\{sourceMaterial\}/g, 'A1BH0214C')
  .replace(/\$\{sourcePlant\}/g, '1001')
  .replace(/\$\{sourceBomUsage\}/g, '1')
  .replace(/\$\{sourceAltBom\}/g, '')
  .replace(/\$\{targetMaterial\}/g, 'A1BH0214C')
  .replace(/\$\{targetPlant\}/g, '1012')
  .replace(/\$\{targetBomUsage\}/g, '1')
  .replace(/\$\{targetAltBom\}/g, '')
  .replace(/\$\{targetValidFrom\}/g, '28.09.2026');

const copyLines = copyRendered.split('\n');
console.log('copyBomViaGui rendered lines:', copyLines.length);
if (copyLines.length >= 420) {
  console.log('\n--- copyBomViaGui lines 420-435 ---');
  for (let i = 420; i <= 435; i++) {
    console.log(`${i}: ${copyLines[i-1]}`);
  }
}
