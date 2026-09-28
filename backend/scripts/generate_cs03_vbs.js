import fs from 'fs';

const content = fs.readFileSync('./services/sapGuiClient.js', 'utf-8');

function escapeVbsString(str) {
  if (!str) return '';
  return String(str).replace(/"/g, '""');
}

const cs03Idx = content.indexOf('export async function verifyBomInCs03(');
const vbsStart = content.indexOf('const vbsScript = `', cs03Idx);
const vbsEnd = content.indexOf('`;', vbsStart);
const template = content.slice(vbsStart + 19, vbsEnd);

const discStart = content.indexOf('function getSessionDiscoveryVbs(');
const discEnd = content.indexOf('\n}\n\n/**', discStart);
const discFnCode = content.slice(discStart, discEnd + 2);

const fn = new Function('escapeVbsString', 'targetSessionPath', 'expectedUser', `
${discFnCode};
return getSessionDiscoveryVbs(targetSessionPath, expectedUser);
`);

const discoveryVbs = fn(escapeVbsString, '/app/con[0]/ses[0]', 'LEELAM_EXT');

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

let script = template
  .replace('${getSessionDiscoveryVbs(targetSessionPath, expectedUser)}', discoveryVbs)
  .replace('${escapeVbsString(material)}', 'A1BH0214C')
  .replace('${escapeVbsString(plant)}', '1001')
  .replace('${escapeVbsString(bomUsage)}', '1')
  .replace('${escapeVbsString(alternativeBom)}', '')
  .replace('${alternativeBom ? `session.findById("${CS01_FIELD_IDS.ALT_BOM}").text = "${escapeVbsString(alternativeBom)}"` : \'\'}', '');

for (const [k, v] of Object.entries(CS01_FIELD_IDS)) {
  script = script.replace(new RegExp('\\$\\{CS01_FIELD_IDS\\.' + k + '\\}', 'g'), v);
}

fs.writeFileSync('./scripts/cs03_exact.vbs', script, 'utf-8');

const lines = script.split('\n');
console.log('Written ./scripts/cs03_exact.vbs with', lines.length, 'lines.');
console.log('--- Lines 245 to 265 ---');
for (let i = 245; i <= Math.min(265, lines.length); i++) {
  console.log(`${i}: ${lines[i-1]}`);
}
