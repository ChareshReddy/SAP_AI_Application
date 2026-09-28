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

// Find all template strings that start with const vbsScript = `
const vbsMatches = [];
const regex = /const\s+(vbs\w*|vbsScript)\s*=\s*`([\s\S]*?)`;/g;
let m;
while ((m = regex.exec(content)) !== null) {
  vbsMatches.push({
    name: m[1],
    index: m.index,
    template: m[2]
  });
}

console.log('Found', vbsMatches.length, 'VBScript templates:');

for (const item of vbsMatches) {
  // Find preceding function name
  const sub = content.slice(Math.max(0, item.index - 500), item.index);
  const fnMatch = sub.match(/export\s+async\s+function\s+(\w+)/g);
  const fnName = fnMatch ? fnMatch[fnMatch.length - 1] : 'unknown';

  let script = item.template
    .replace(/\$\{getSessionDiscoveryVbs\(targetSessionPath, expectedUser\)\}/g, discoveryVbs)
    .replace(/\$\{sourceMaterial\}/g, 'A1BH0214C')
    .replace(/\$\{sourcePlant\}/g, '1001')
    .replace(/\$\{sourceBomUsage\}/g, '1')
    .replace(/\$\{sourceAltBom\}/g, '')
    .replace(/\$\{targetMaterial\}/g, 'A1BH0214C')
    .replace(/\$\{targetPlant\}/g, '1012')
    .replace(/\$\{targetBomUsage\}/g, '1')
    .replace(/\$\{targetAltBom\}/g, '')
    .replace(/\$\{targetValidFrom\}/g, '28.09.2026')
    .replace(/\$\{escapeVbsString\(material\)\}/g, 'A1BH0214C')
    .replace(/\$\{escapeVbsString\(plant\)\}/g, '1001')
    .replace(/\$\{escapeVbsString\(bomUsage\)\}/g, '1')
    .replace(/\$\{escapeVbsString\(alternativeBom\)\}/g, '')
    .replace(/\$\{cleanMaterial\}/g, 'A1BH0214C')
    .replace(/\$\{cleanPlant\}/g, '1001')
    .replace(/\$\{cleanBomUsage\}/g, '1')
    .replace(/\$\{cleanAltBom\}/g, '');

  const lines = script.split('\n');
  console.log(`\nFunction: ${fnName} (Variable: ${item.name}) -> ${lines.length} lines`);
  if (lines.length >= 420) {
    console.log(`Line 424: ${lines[423]}`);
    console.log(`Line 425: ${lines[424]}`);
    console.log(`Line 426: >>> ${lines[425]} <<<`);
    console.log(`Line 427: ${lines[426]}`);
    console.log(`Line 428: ${lines[427]}`);
  }
}
