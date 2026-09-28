import fs from 'fs';

const content = fs.readFileSync('./services/sapGuiClient.js', 'utf-8');

function extractVbs(fnName) {
  const fnIdx = content.indexOf(`export async function ${fnName}`);
  const vbsStart = content.indexOf('const vbsScript = `', fnIdx);
  const vbsEnd = content.indexOf('`;', vbsStart);
  return content.slice(vbsStart + 19, vbsEnd);
}

const discoveryStart = content.indexOf('function getSessionDiscoveryVbs(');
const discoveryEnd = content.indexOf('export async function discoverSapSessions');
let discoveryFnCode = content.slice(discoveryStart, discoveryEnd).trim();
// remove any trailing export or comments
const lastBrace = discoveryFnCode.lastIndexOf('}');
discoveryFnCode = discoveryFnCode.slice(0, lastBrace + 1);

const evalCode = `
${discoveryFnCode}
globalThis.getSessionDiscoveryVbs = getSessionDiscoveryVbs;
`;
eval(evalCode);

const cs03Template = extractVbs('verifyBomInCs03');

const CS01_FIELD_IDS = {
  OK_CODE: 'wnd[0]/tbar[0]/okcd',
  MATERIAL: 'wnd[0]/usr/ctxtRC29N-MATNR',
  PLANT: 'wnd[0]/usr/ctxtRC29N-WERKS',
  BOM_USAGE: 'wnd[0]/usr/ctxtRC29N-STLAN',
  ALT_BOM: 'wnd[0]/usr/txtRC29N-STLAL',
  STATUS_BAR: 'wnd[0]/sbar',
  TABLE_BASE: 'wnd[0]/usr/tblSAPLCSDITCMAT',
  COMPONENT_FIELD: 'ctxtRC29P-IDNRK',
  QUANTITY_FIELD: 'txtRC29P-MENGE',
  ITEM_CATEGORY_FIELD: 'ctxtRC29P-POSTP'
};

function escapeVbsString(str) {
  if (!str) return '';
  return String(str).replace(/"/g, '""');
}

let targetSessionPath = '/app/con[0]/ses[0]';
let expectedUser = 'LEELAM_EXT';
let material = 'A1BH0214C';
let plant = '1001';
let bomUsage = '1';
let alternativeBom = '';

let script = cs03Template
  .replace(/\$\{getSessionDiscoveryVbs\(targetSessionPath, expectedUser\)\}/g, globalThis.getSessionDiscoveryVbs(targetSessionPath, expectedUser))
  .replace(/\$\{escapeVbsString\(material\)\}/g, escapeVbsString(material))
  .replace(/\$\{escapeVbsString\(plant\)\}/g, escapeVbsString(plant))
  .replace(/\$\{escapeVbsString\(bomUsage\)\}/g, escapeVbsString(bomUsage))
  .replace(/\$\{escapeVbsString\(alternativeBom\)\}/g, escapeVbsString(alternativeBom))
  .replace(/\$\{alternativeBom \? `session\.findById\(\"\$\{CS01_FIELD_IDS\.ALT_BOM\}\"\)\.text = \"\$\{escapeVbsString\(alternativeBom\)\}\"` : ''\}/g, '');

for (const [k, v] of Object.entries(CS01_FIELD_IDS)) {
  script = script.replace(new RegExp('\\$\\{CS01_FIELD_IDS\\.' + k + '\\}', 'g'), v);
}

const lines = script.split('\n');
console.log('CS03 script total lines:', lines.length);
for (let i = 245; i <= 275; i++) {
  console.log(`${i}: ${lines[i - 1]}`);
}
