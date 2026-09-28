import fs from 'fs';

const content = fs.readFileSync('./services/sapGuiClient.js', 'utf-8');

function escapeVbsString(str) {
  if (!str) return '';
  return String(str).replace(/"/g, '""');
}

const discStart = content.indexOf('function getSessionDiscoveryVbs(');
const discEnd = content.indexOf('\n}\n\n/**', discStart);
const discFnCode = content.slice(discStart, discEnd + 2);

const fn = new Function('escapeVbsString', 'targetSessionPath', 'expectedUser', `
${discFnCode};
return getSessionDiscoveryVbs(targetSessionPath, expectedUser);
`);

const discoveryVbs = fn(escapeVbsString, '/app/con[0]/ses[0]', 'LEELAM_EXT');

// Find copyBomViaGui template
const copyIdx = content.indexOf('export async function copyBomViaGui');
const vbsStart = content.indexOf('const vbsScript = `', copyIdx);
const vbsEnd = content.indexOf('`;', vbsStart);
const copyTemplate = content.slice(vbsStart + 19, vbsEnd);

let script = copyTemplate
  .replace(/\$\{getSessionDiscoveryVbs\(targetSessionPath, expectedUser\)\}/g, discoveryVbs)
  .replace(/\$\{sourceMaterial\}/g, 'A1BH0214C')
  .replace(/\$\{sourcePlant\}/g, '1001')
  .replace(/\$\{sourceBomUsage\}/g, '1')
  .replace(/\$\{sourceAltBom\}/g, '')
  .replace(/\$\{targetMaterial\}/g, 'A1BH0214C')
  .replace(/\$\{targetPlant\}/g, '1012')
  .replace(/\$\{targetBomUsage\}/g, '1')
  .replace(/\$\{targetAltBom\}/g, '')
  .replace(/\$\{targetValidFrom\}/g, '28.09.2026');

fs.writeFileSync('./scripts/copy_exact.vbs', script, 'utf-8');

const lines = script.split('\n');
console.log('Total lines in copy_exact.vbs:', lines.length);
console.log('--- Lines 390 to 445 ---');
for (let i = 390; i <= 445; i++) {
  console.log(`${i}: ${lines[i-1]}`);
}
