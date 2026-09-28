import assert from 'assert';
import http from 'http';
import app from '../server.js';
import { auditLogger } from '../services/auditLog.js';
import {
  resolveNextAvailableAlternative,
  compareBomStructures,
  inspectAndVerifyHierarchy,
  repairHierarchyBottomUp,
  copyBomHierarchyWithRepair,
  verifyBomInCs03,
  copyBomViaGui,
  resetMockBomDataset,
  setMockBomAlternatives,
  getMockBomDataset,
  SAMPLE_A1BH0214C_COMPONENTS
} from '../services/sapGuiClient.js';
import { pendingActionStore } from '../services/pendingActions.js';

let server;
let baseUrl;

function makeRequest(method, path, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    const reqHeaders = { ...headers };

    if (body) {
      reqHeaders['Content-Type'] = 'application/json';
    }

    const req = http.request(url, { method, headers: reqHeaders }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        let json = null;
        try {
          json = JSON.parse(data);
        } catch {
          json = data;
        }

        resolve({
          status: res.statusCode,
          headers: res.headers,
          data: json
        });
      });
    });

    req.on('error', reject);

    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

async function runBomStructuralPreservationTests() {
  console.log('\n======================================================');
  console.log('--- Starting Complete BOM Hierarchy Copy & Preservation Test Suite ---');
  console.log('======================================================');

  process.env.USE_MOCK_SAP = 'true';
  process.env.OPENROUTER_API_KEY = 'test_key';
  process.env.OPENROUTER_MODEL = 'test_model';

  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  baseUrl = `http://127.0.0.1:${port}`;

  // Log in to obtain authenticated cookie for chat endpoints
  const loginRes = await makeRequest('POST', '/api/auth/login', {
    username: 'LEELAM_EXT',
    password: 'MockPassword123!'
  });
  const cookie = loginRes.headers['set-cookie']?.[0]?.split(';')[0] || '';
  const authHeaders = { Cookie: cookie };

  try {
    // -------------------------------------------------------------------------
    // TEST 1: Target Alternative Selection - auto-increments when requested exists (1..4 -> 5)
    // -------------------------------------------------------------------------
    console.log('\n1. Testing Target Alternative Selection (auto-increments 1..4 -> 5):');
    const alt1 = resolveNextAvailableAlternative(['1', '2', '3', '4'], '1');
    assert.strictEqual(alt1, '5', 'When alternatives 1..4 exist, requested alternative 1 must resolve to 5');
    console.log('   ✓ Existing alternatives [1, 2, 3, 4] correctly resolved to alternative 5');

    // -------------------------------------------------------------------------
    // TEST 2: Target Alternative Selection - uses 1 when no BOM exists in target
    // -------------------------------------------------------------------------
    console.log('\n2. Testing Target Alternative Selection (uses 1 when no BOM exists):');
    const alt2 = resolveNextAvailableAlternative([], '');
    assert.strictEqual(alt2, '1', 'When no BOM exists in target, alternative must resolve to 1');
    console.log('   ✓ Target with no BOM correctly resolved to alternative 1');

    // -------------------------------------------------------------------------
    // TEST 3: Target Alternative Selection - uses specified alternative when it doesn\'t exist
    // -------------------------------------------------------------------------
    console.log('\n3. Testing Target Alternative Selection (uses specified when it doesn\'t exist):');
    const alt3 = resolveNextAvailableAlternative(['1', '2'], '3');
    assert.strictEqual(alt3, '3', 'When specified alternative 3 does not exist, must use alternative 3');
    console.log('   ✓ Specified alternative 3 preserved when it does not yet exist in target');

    // -------------------------------------------------------------------------
    // TEST 4: Target Alternative Selection - gaps handled (e.g. 1, 3 exist -> uses 2 or 4)
    // -------------------------------------------------------------------------
    console.log('\n4. Testing Target Alternative Selection (gaps handled):');
    const alt4 = resolveNextAvailableAlternative(['1', '3'], '');
    assert.ok(alt4 === '2' || alt4 === '4', `Gap in alternatives [1, 3] must resolve to 2 or 4, got: ${alt4}`);
    console.log(`   ✓ Gap in alternatives [1, 3] correctly resolved to next available alternative: ${alt4}`);

    // -------------------------------------------------------------------------
    // TEST 5: Non-overwriting - existing BOMs untouched when new alternative created
    // -------------------------------------------------------------------------
    console.log('\n5. Testing Non-Overwriting Protection (existing BOMs untouched):');
    resetMockBomDataset();
    setMockBomAlternatives('MAT_SAFE_01', '1012', '1', ['1'], 1, [
      { item: '0010', material: 'ORIGINAL_COMP', description: 'Original', quantity: '10', unit: 'EA', itemCategory: 'L', assembly: false }
    ]);
    setMockBomAlternatives('MAT_SOURCE_01', '1001', '1', ['1'], 1, [
      { item: '0010', material: 'NEW_COPIED_COMP', description: 'New', quantity: '20', unit: 'EA', itemCategory: 'L', assembly: false }
    ]);

    const copyRes5 = await copyBomViaGui({
      source: { material: 'MAT_SOURCE_01', plant: '1001', bomUsage: '1' },
      target: { material: 'MAT_SAFE_01', plant: '1012', bomUsage: '1', alternativeBom: '2' }
    });
    assert.strictEqual(copyRes5.success, true);

    const targetAlt1 = await verifyBomInCs03({ material: 'MAT_SAFE_01', plant: '1012', bomUsage: '1', alternativeBom: '1' });
    assert.strictEqual(targetAlt1.exists, true);
    assert.strictEqual(targetAlt1.components[0].material, 'ORIGINAL_COMP', 'Alternative 1 must retain its original component');

    const targetAlt2 = await verifyBomInCs03({ material: 'MAT_SAFE_01', plant: '1012', bomUsage: '1', alternativeBom: '2' });
    assert.strictEqual(targetAlt2.exists, true);
    assert.strictEqual(targetAlt2.components[0].material, 'NEW_COPIED_COMP', 'Alternative 2 must contain the newly copied component');
    console.log('   ✓ Target Alternative 1 remained completely untouched while Alternative 2 was created');

    // -------------------------------------------------------------------------
    // TEST 6: Verify Phase - detects missing sub-BOM at depth 1
    // -------------------------------------------------------------------------
    console.log('\n6. Testing Verify Phase (detects missing sub-BOM at depth 1):');
    resetMockBomDataset();
    setMockBomAlternatives('MAIN_D1', '1001', '1', ['1'], 1, [
      { item: '0010', material: 'SUB_D1', quantity: '1', unit: 'EA', itemCategory: 'L', assembly: true }
    ]);
    setMockBomAlternatives('SUB_D1', '1001', '1', ['1'], 1, [
      { item: '0010', material: 'RAW_1', quantity: '5', unit: 'KG', itemCategory: 'L', assembly: false }
    ]);
    setMockBomAlternatives('MAIN_D1', '1012', '1', ['1'], 1, [
      { item: '0010', material: 'SUB_D1', quantity: '1', unit: 'EA', itemCategory: 'L', assembly: false }
    ]);

    const verify6 = await inspectAndVerifyHierarchy({
      source: { material: 'MAIN_D1', plant: '1001', bomUsage: '1' },
      target: { material: 'MAIN_D1', plant: '1012', bomUsage: '1' }
    });
    assert.ok(verify6.missingSubBoms.some((m) => m.material === 'SUB_D1' && m.depth === 1), 'Must detect missing sub-BOM at depth 1');
    console.log('   ✓ Verify phase correctly detected missing sub-BOM SUB_D1 at depth 1');

    // -------------------------------------------------------------------------
    // TEST 7: Verify Phase - detects missing sub-BOM at depth 2 (grandchild)
    // -------------------------------------------------------------------------
    console.log('\n7. Testing Verify Phase (detects missing sub-BOM at depth 2 grandchild):');
    resetMockBomDataset();
    setMockBomAlternatives('MAIN_D2', '1001', '1', ['1'], 1, [
      { item: '0010', material: 'SUB_D2', quantity: '1', unit: 'EA', itemCategory: 'L', assembly: true }
    ]);
    setMockBomAlternatives('SUB_D2', '1001', '1', ['1'], 1, [
      { item: '0010', material: 'GRANDCHILD_D2', quantity: '1', unit: 'EA', itemCategory: 'L', assembly: true }
    ]);
    setMockBomAlternatives('GRANDCHILD_D2', '1001', '1', ['1'], 1, [
      { item: '0010', material: 'RAW_2', quantity: '5', unit: 'KG', itemCategory: 'L', assembly: false }
    ]);
    setMockBomAlternatives('MAIN_D2', '1012', '1', ['1'], 1, [
      { item: '0010', material: 'SUB_D2', quantity: '1', unit: 'EA', itemCategory: 'L', assembly: false }
    ]);

    const verify7 = await inspectAndVerifyHierarchy({
      source: { material: 'MAIN_D2', plant: '1001', bomUsage: '1' },
      target: { material: 'MAIN_D2', plant: '1012', bomUsage: '1' }
    });
    assert.ok(verify7.missingSubBoms.some((m) => m.material === 'GRANDCHILD_D2' && m.depth === 2), 'Must detect missing sub-BOM at depth 2');
    console.log('   ✓ Verify phase correctly detected missing grandchild sub-BOM at depth 2');

    // -------------------------------------------------------------------------
    // TEST 8: Verify Phase - detects missing sub-BOM at depth 3+
    // -------------------------------------------------------------------------
    console.log('\n8. Testing Verify Phase (detects missing sub-BOM at depth 3+):');
    resetMockBomDataset();
    setMockBomAlternatives('MAIN_D3', '1001', '1', ['1'], 1, [
      { item: '0010', material: 'SUB_D3', quantity: '1', unit: 'EA', itemCategory: 'L', assembly: true }
    ]);
    setMockBomAlternatives('SUB_D3', '1001', '1', ['1'], 1, [
      { item: '0010', material: 'GC_D3', quantity: '1', unit: 'EA', itemCategory: 'L', assembly: true }
    ]);
    setMockBomAlternatives('GC_D3', '1001', '1', ['1'], 1, [
      { item: '0010', material: 'GGC_D3', quantity: '1', unit: 'EA', itemCategory: 'L', assembly: true }
    ]);
    setMockBomAlternatives('GGC_D3', '1001', '1', ['1'], 1, [
      { item: '0010', material: 'RAW_3', quantity: '2', unit: 'KG', itemCategory: 'L', assembly: false }
    ]);
    setMockBomAlternatives('MAIN_D3', '1012', '1', ['1'], 1, [
      { item: '0010', material: 'SUB_D3', quantity: '1', unit: 'EA', itemCategory: 'L', assembly: false }
    ]);

    const verify8 = await inspectAndVerifyHierarchy({
      source: { material: 'MAIN_D3', plant: '1001', bomUsage: '1' },
      target: { material: 'MAIN_D3', plant: '1012', bomUsage: '1' }
    });
    assert.ok(verify8.missingSubBoms.some((m) => m.material === 'GGC_D3' && m.depth === 3), 'Must detect missing sub-BOM at depth 3');
    console.log('   ✓ Verify phase correctly detected missing deep sub-BOM GGC_D3 at depth 3');

    // -------------------------------------------------------------------------
    // TEST 9: Verify Phase - detects Asm=false when child BOM missing
    // -------------------------------------------------------------------------
    console.log('\n9. Testing Verify Phase (detects Asm=false when child BOM is missing):');
    resetMockBomDataset();
    setMockBomAlternatives('ASM_PARENT', '1001', '1', ['1'], 1, [
      { item: '0010', material: 'ASM_CHILD', quantity: '1', unit: 'EA', itemCategory: 'L', assembly: true }
    ]);
    setMockBomAlternatives('ASM_CHILD', '1001', '1', ['1'], 1, [
      { item: '0010', material: 'RAW_M', quantity: '1', unit: 'KG', itemCategory: 'L', assembly: false }
    ]);

    await copyBomViaGui({
      source: { material: 'ASM_PARENT', plant: '1001', bomUsage: '1' },
      target: { material: 'ASM_PARENT', plant: '1012', bomUsage: '1' },
      copiedMainOnly: true,
      allowMissingSubBoms: true
    });

    const cs03Parent = await verifyBomInCs03({ material: 'ASM_PARENT', plant: '1012', bomUsage: '1' });
    assert.strictEqual(cs03Parent.components[0].assembly, false, 'Target component assembly must evaluate to false when child BOM is missing');

    const verify9 = await inspectAndVerifyHierarchy({
      source: { material: 'ASM_PARENT', plant: '1001', bomUsage: '1' },
      target: { material: 'ASM_PARENT', plant: '1012', bomUsage: '1' }
    });
    assert.strictEqual(verify9.missingSubBoms.length, 1);
    assert.strictEqual(verify9.missingSubBoms[0].material, 'ASM_CHILD');
    console.log('   ✓ CS03 dynamically evaluated Asm=false for parent when child BOM is missing in plant');

    // -------------------------------------------------------------------------
    // TEST 10: Verify Phase - reports 100% match when all sub-BOMs exist
    // -------------------------------------------------------------------------
    console.log('\n10. Testing Verify Phase (reports 100% match when all sub-BOMs exist):');
    resetMockBomDataset();
    setMockBomAlternatives('FULL_PARENT', '1001', '1', ['1'], 1, [
      { item: '0010', material: 'FULL_CHILD', quantity: '2', unit: 'EA', itemCategory: 'L', assembly: true }
    ]);
    setMockBomAlternatives('FULL_CHILD', '1001', '1', ['1'], 1, [
      { item: '0010', material: 'FULL_RAW', quantity: '5', unit: 'KG', itemCategory: 'L', assembly: false }
    ]);
    setMockBomAlternatives('FULL_CHILD', '1012', '1', ['1'], 1, [
      { item: '0010', material: 'FULL_RAW', quantity: '5', unit: 'KG', itemCategory: 'L', assembly: false }
    ]);
    setMockBomAlternatives('FULL_PARENT', '1012', '1', ['1'], 1, [
      { item: '0010', material: 'FULL_CHILD', quantity: '2', unit: 'EA', itemCategory: 'L', assembly: true }
    ]);

    const verify10 = await inspectAndVerifyHierarchy({
      source: { material: 'FULL_PARENT', plant: '1001', bomUsage: '1' },
      target: { material: 'FULL_PARENT', plant: '1012', bomUsage: '1' }
    });
    assert.strictEqual(verify10.match, true);
    assert.strictEqual(verify10.status, 'SUCCESS');
    assert.strictEqual(verify10.missingSubBoms.length, 0);
    assert.strictEqual(verify10.discrepancies.length, 0);
    console.log('   ✓ Verify phase reported 100% match with zero discrepancies when all sub-BOMs exist');

    // -------------------------------------------------------------------------
    // TEST 11: Verify Phase - cycle protection prevents infinite loops
    // -------------------------------------------------------------------------
    console.log('\n11. Testing Verify Phase (cycle protection prevents infinite loops):');
    resetMockBomDataset();
    setMockBomAlternatives('CYCLE_A', '1001', '1', ['1'], 1, [
      { item: '0010', material: 'CYCLE_B', quantity: '1', unit: 'EA', itemCategory: 'L', assembly: true }
    ]);
    setMockBomAlternatives('CYCLE_B', '1001', '1', ['1'], 1, [
      { item: '0010', material: 'CYCLE_A', quantity: '1', unit: 'EA', itemCategory: 'L', assembly: true }
    ]);
    setMockBomAlternatives('CYCLE_A', '1012', '1', ['1'], 1, [
      { item: '0010', material: 'CYCLE_B', quantity: '1', unit: 'EA', itemCategory: 'L', assembly: false }
    ]);

    const verify11 = await inspectAndVerifyHierarchy({
      source: { material: 'CYCLE_A', plant: '1001', bomUsage: '1' },
      target: { material: 'CYCLE_A', plant: '1012', bomUsage: '1' }
    });
    assert.strictEqual(verify11.cycleDetected, true);
    console.log('   ✓ Cycle detected successfully and infinite traversal safely prevented');

    // -------------------------------------------------------------------------
    // TEST 12: Verify Phase - max depth 5 respected
    // -------------------------------------------------------------------------
    console.log('\n12. Testing Verify Phase (max depth 5 respected):');
    resetMockBomDataset();
    for (let d = 0; d < 6; d++) {
      setMockBomAlternatives(`LEVEL_${d}`, '1001', '1', ['1'], 1, [
        { item: '0010', material: `LEVEL_${d + 1}`, quantity: '1', unit: 'EA', itemCategory: 'L', assembly: true }
      ]);
    }
    setMockBomAlternatives('LEVEL_6', '1001', '1', ['1'], 1, [
      { item: '0010', material: 'BASE_RAW', quantity: '1', unit: 'KG', itemCategory: 'L', assembly: false }
    ]);
    setMockBomAlternatives('LEVEL_0', '1012', '1', ['1'], 1, [
      { item: '0010', material: 'LEVEL_1', quantity: '1', unit: 'EA', itemCategory: 'L', assembly: false }
    ]);

    const verify12 = await inspectAndVerifyHierarchy({
      source: { material: 'LEVEL_0', plant: '1001', bomUsage: '1' },
      target: { material: 'LEVEL_0', plant: '1012', bomUsage: '1' },
      maxDepth: 5
    });
    assert.ok(verify12.maxDepthReached <= 4, `Max depth reached must not exceed 4 (5 levels), got: ${verify12.maxDepthReached}`);
    console.log(`   ✓ Max depth 5 strictly respected (explored up to depth ${verify12.maxDepthReached})`);

    // -------------------------------------------------------------------------
    // TEST 13: Repair Phase - bottom-up order (deepest first: D -> C -> B)
    // -------------------------------------------------------------------------
    console.log('\n13. Testing Repair Phase (bottom-up order deepest first: D -> C -> B):');
    resetMockBomDataset();
    setMockBomAlternatives('MAT_B', '1001', '1', ['1'], 1, [{ item: '0010', material: 'RAW_B', quantity: '1', unit: 'EA', itemCategory: 'L', assembly: false }]);
    setMockBomAlternatives('MAT_C', '1001', '1', ['1'], 1, [{ item: '0010', material: 'RAW_C', quantity: '1', unit: 'EA', itemCategory: 'L', assembly: false }]);
    setMockBomAlternatives('MAT_D', '1001', '1', ['1'], 1, [{ item: '0010', material: 'RAW_D', quantity: '1', unit: 'EA', itemCategory: 'L', assembly: false }]);

    const missing13 = [
      { material: 'MAT_B', sourcePlant: '1001', targetPlant: '1012', bomUsage: '1', depth: 1 },
      { material: 'MAT_D', sourcePlant: '1001', targetPlant: '1012', bomUsage: '1', depth: 3 },
      { material: 'MAT_C', sourcePlant: '1001', targetPlant: '1012', bomUsage: '1', depth: 2 }
    ];
    const executionOrder13 = [];
    const repaired13 = await repairHierarchyBottomUp({
      missingSubBoms: missing13,
      onProgress: (msg) => {
        const m = msg.match(/:\s*([A-Za-z0-9_-]+)\.\.\./);
        if (m) executionOrder13.push(m[1]);
      }
    });
    assert.strictEqual(repaired13.length, 3);
    assert.deepStrictEqual(executionOrder13, ['MAT_D', 'MAT_C', 'MAT_B']);
    console.log('   ✓ Repair execution order strictly followed bottom-up sequence: D -> C -> B');

    // -------------------------------------------------------------------------
    // TEST 14: Repair Phase - creates new alternative if sub-BOM exists in target
    // -------------------------------------------------------------------------
    console.log('\n14. Testing Repair Phase (creates new alternative if sub-BOM exists in target):');
    resetMockBomDataset();
    setMockBomAlternatives('SUB_ALTS', '1001', '1', ['1'], 1, [{ item: '0010', material: 'RAW_SRC', quantity: '1', unit: 'EA', itemCategory: 'L', assembly: false }]);
    setMockBomAlternatives('SUB_ALTS', '1012', '1', ['1'], 1, [{ item: '0010', material: 'RAW_TGT', quantity: '1', unit: 'EA', itemCategory: 'L', assembly: false }]);

    const repaired14 = await repairHierarchyBottomUp({
      missingSubBoms: [{ material: 'SUB_ALTS', sourcePlant: '1001', targetPlant: '1012', bomUsage: '1', depth: 1 }]
    });
    assert.strictEqual(repaired14.length, 1);
    assert.strictEqual(repaired14[0].alternativeBom, '2', 'Must create under Alternative 2 when Alternative 1 exists');
    console.log('   ✓ Repair phase created sub-BOM under next available Alternative 2 without overwriting');

    // -------------------------------------------------------------------------
    // TEST 15: Repair Phase - creates under alternative 1 if sub-BOM does not exist
    // -------------------------------------------------------------------------
    console.log('\n15. Testing Repair Phase (creates under alternative 1 if sub-BOM does not exist):');
    resetMockBomDataset();
    setMockBomAlternatives('SUB_FRESH', '1001', '1', ['1'], 1, [{ item: '0010', material: 'RAW_FRESH', quantity: '1', unit: 'EA', itemCategory: 'L', assembly: false }]);

    const repaired15 = await repairHierarchyBottomUp({
      missingSubBoms: [{ material: 'SUB_FRESH', sourcePlant: '1001', targetPlant: '1012', bomUsage: '1', depth: 1 }]
    });
    assert.strictEqual(repaired15.length, 1);
    assert.strictEqual(repaired15[0].alternativeBom, '1', 'Must create under Alternative 1 when no BOM exists in target');
    console.log('   ✓ Repair phase created sub-BOM under Alternative 1 when no BOM exists in target plant');

    // -------------------------------------------------------------------------
    // TEST 16: Repair Phase - fail-stop halts execution on first error
    // -------------------------------------------------------------------------
    console.log('\n16. Testing Repair Phase (fail-stop halts execution on first error):');
    resetMockBomDataset();
    setMockBomAlternatives('VALID_SUB', '1001', '1', ['1'], 1, [{ item: '0010', material: 'RAW_OK', quantity: '1', unit: 'EA', itemCategory: 'L', assembly: false }]);

    let failError16 = null;
    try {
      await repairHierarchyBottomUp({
        missingSubBoms: [
          { material: 'FAILING_SUB', sourceMaterial: 'NON_EXISTENT_SOURCE', sourcePlant: '1001', targetPlant: '1012', bomUsage: '1', depth: 2 },
          { material: 'VALID_SUB', sourcePlant: '1001', targetPlant: '1012', bomUsage: '1', depth: 1 }
        ]
      });
    } catch (err) {
      failError16 = err;
    }
    assert.ok(failError16, 'Must throw fail-stop error on sub-BOM failure');
    assert.ok(failError16.message.includes('FAILING_SUB'), 'Error message must report failing material');
    const validCheck16 = await verifyBomInCs03({ material: 'VALID_SUB', plant: '1012', bomUsage: '1' });
    assert.strictEqual(validCheck16.exists, false, 'Subsequent sub-BOMs must not be attempted after first failure');
    console.log('   ✓ Fail-stop behavior strictly halted execution on first failure');

    // -------------------------------------------------------------------------
    // TEST 17: Re-Verify Phase - confirms Asm=true after child created
    // -------------------------------------------------------------------------
    console.log('\n17. Testing Re-Verify Phase (confirms Asm=true after child created):');
    resetMockBomDataset();
    setMockBomAlternatives('RV_PARENT', '1001', '1', ['1'], 1, [
      { item: '0010', material: 'RV_CHILD', quantity: '1', unit: 'EA', itemCategory: 'L', assembly: true }
    ]);
    setMockBomAlternatives('RV_CHILD', '1001', '1', ['1'], 1, [
      { item: '0010', material: 'RV_RAW', quantity: '3', unit: 'KG', itemCategory: 'L', assembly: false }
    ]);

    await copyBomViaGui({
      source: { material: 'RV_PARENT', plant: '1001', bomUsage: '1' },
      target: { material: 'RV_PARENT', plant: '1012', bomUsage: '1' },
      copiedMainOnly: true,
      allowMissingSubBoms: true
    });

    const beforeVerify17 = await inspectAndVerifyHierarchy({
      source: { material: 'RV_PARENT', plant: '1001', bomUsage: '1' },
      target: { material: 'RV_PARENT', plant: '1012', bomUsage: '1' },
      isReverify: false
    });
    assert.strictEqual(beforeVerify17.missingSubBoms.length, 1);

    await repairHierarchyBottomUp({ missingSubBoms: beforeVerify17.missingSubBoms });

    const cs03After17 = await verifyBomInCs03({ material: 'RV_PARENT', plant: '1012', bomUsage: '1' });
    assert.strictEqual(cs03After17.components[0].assembly, true, 'Assembly indicator must evaluate to true after child created');

    const afterVerify17 = await inspectAndVerifyHierarchy({
      source: { material: 'RV_PARENT', plant: '1001', bomUsage: '1' },
      target: { material: 'RV_PARENT', plant: '1012', bomUsage: '1' },
      isReverify: true
    });
    assert.strictEqual(afterVerify17.match, true);
    assert.strictEqual(afterVerify17.missingSubBoms.length, 0);
    assert.strictEqual(afterVerify17.discrepancies.length, 0);
    console.log('   ✓ Re-verify phase confirmed Asm=true and 100% hierarchy parity after child created');

    // -------------------------------------------------------------------------
    // TEST 18: End-to-End - single BOM (no sub-BOMs): copy -> verify (match) -> done (1 created)
    // -------------------------------------------------------------------------
    console.log('\n18. Testing End-to-End Single BOM (copy -> verify -> done, 1 created):');
    resetMockBomDataset();
    setMockBomAlternatives('SINGLE_E2E', '1001', '1', ['1'], 2, [
      { item: '0010', material: 'PART_A', quantity: '10', unit: 'KG', itemCategory: 'L', assembly: false },
      { item: '0020', material: 'PART_B', quantity: '20', unit: 'KG', itemCategory: 'L', assembly: false }
    ]);

    const prop18 = await makeRequest('POST', '/api/chat', {
      actionType: 'copy_bom',
      copyBomParams: {
        sourceMaterial: 'SINGLE_E2E',
        sourcePlant: '1001',
        sourceUsage: '1',
        targetMaterial: 'SINGLE_E2E',
        targetPlant: '1012',
        targetUsage: '1'
      }
    }, authHeaders);
    assert.strictEqual(prop18.status, 200);
    assert.ok(prop18.data.proposedAction);
    const actionId18 = prop18.data.proposedAction.actionId;

    const conf18 = await makeRequest('POST', '/api/chat', { confirmAction: actionId18 }, authHeaders);
    assert.strictEqual(conf18.status, 200);
    assert.strictEqual(conf18.data.actionResult.success, true);
    assert.strictEqual(conf18.data.actionResult.totalBomsCreated, 1);

    const cs03Single = await verifyBomInCs03({ material: 'SINGLE_E2E', plant: '1012', bomUsage: '1', alternativeBom: '1' });
    assert.strictEqual(cs03Single.exists, true);
    assert.strictEqual(cs03Single.components.length, 2);
    console.log('   ✓ End-to-End single BOM completed with 1 BOM created and verified');

    // -------------------------------------------------------------------------
    // TEST 19: End-to-End - multi-level hierarchy: copy -> verify (missing) -> repair -> re-verify (match) -> done (N created)
    // -------------------------------------------------------------------------
    console.log('\n19. Testing End-to-End Multi-Level Hierarchy (copy -> verify -> repair -> re-verify, N created):');
    resetMockBomDataset();
    auditLogger.clearAuditLogs();

    const prop19 = await makeRequest('POST', '/api/chat', {
      actionType: 'copy_bom',
      copyBomParams: {
        sourceMaterial: 'A1BH0214C',
        sourcePlant: '1001',
        sourceUsage: '1',
        targetMaterial: 'A1BH0214C',
        targetPlant: '1012',
        targetUsage: '1'
      }
    }, authHeaders);
    assert.strictEqual(prop19.status, 200);
    assert.ok(prop19.data.proposedAction);
    const actionId19 = prop19.data.proposedAction.actionId;

    const conf19 = await makeRequest('POST', '/api/chat', { confirmAction: actionId19 }, authHeaders);
    assert.strictEqual(conf19.status, 200);
    assert.strictEqual(conf19.data.actionResult.success, true);
    assert.ok(conf19.data.actionResult.totalBomsCreated >= 2, 'Multiple BOMs must be created across hierarchy');

    const targetMain19 = await verifyBomInCs03({ material: 'A1BH0214C', plant: '1012', bomUsage: '1' });
    assert.strictEqual(targetMain19.exists, true);
    const hasAsm19 = targetMain19.components.some((c) => c.assembly === true);
    assert.strictEqual(hasAsm19, true, 'Assembly indicators must be preserved in target plant');

    const logs19 = auditLogger.getAuditLogs().filter((l) => l.actionType === 'copy_bom');
    assert.strictEqual(logs19.length, conf19.data.actionResult.totalBomsCreated, 'Audit log entry must be recorded for every created BOM');
    console.log(`   ✓ Multi-level hierarchy copied, repaired, and verified: ${conf19.data.actionResult.totalBomsCreated} BOMs created with audit trails`);

    // -------------------------------------------------------------------------
    // TEST 20: End-to-End - existing target BOMs get new alternative, not overwritten
    // -------------------------------------------------------------------------
    console.log('\n20. Testing End-to-End Existing Target BOMs (new alternative, not overwritten):');
    resetMockBomDataset();
    setMockBomAlternatives('EXISTING_MAT', '1012', '1', ['1'], 1, [
      { item: '0010', material: 'TARGET_ORIGINAL_COMP', description: 'Original in Target', quantity: '100', unit: 'EA', itemCategory: 'L', assembly: false }
    ]);
    setMockBomAlternatives('EXISTING_MAT', '1001', '1', ['1'], 1, [
      { item: '0010', material: 'SOURCE_COPIED_COMP', description: 'Copied from Source', quantity: '200', unit: 'EA', itemCategory: 'L', assembly: false }
    ]);

    const prop20 = await makeRequest('POST', '/api/chat', {
      actionType: 'copy_bom',
      copyBomParams: {
        sourceMaterial: 'EXISTING_MAT',
        sourcePlant: '1001',
        sourceUsage: '1',
        targetMaterial: 'EXISTING_MAT',
        targetPlant: '1012',
        targetUsage: '1'
      }
    }, authHeaders);
    assert.strictEqual(prop20.status, 200);
    const actionId20 = prop20.data.proposedAction.actionId;

    const conf20 = await makeRequest('POST', '/api/chat', { confirmAction: actionId20 }, authHeaders);
    assert.strictEqual(conf20.status, 200);
    assert.strictEqual(conf20.data.actionResult.success, true);

    const alt1Check = await verifyBomInCs03({ material: 'EXISTING_MAT', plant: '1012', bomUsage: '1', alternativeBom: '1' });
    assert.strictEqual(alt1Check.exists, true);
    assert.strictEqual(alt1Check.components[0].material, 'TARGET_ORIGINAL_COMP', 'Existing Alternative 1 must remain untouched');

    const alt2Check = await verifyBomInCs03({ material: 'EXISTING_MAT', plant: '1012', bomUsage: '1', alternativeBom: '2' });
    assert.strictEqual(alt2Check.exists, true);
    assert.strictEqual(alt2Check.components[0].material, 'SOURCE_COPIED_COMP', 'New Alternative 2 must contain the copied components');
    console.log('   ✓ Existing target Alternative 1 remained completely untouched while Alternative 2 was created');

    console.log('\n======================================================');
    console.log('✅ ALL 20 BOM HIERARCHY STRUCTURAL PRESERVATION TESTS PASSED!');
    console.log('======================================================\n');
  } finally {
    if (server) {
      server.close();
    }
  }
}

runBomStructuralPreservationTests().catch((err) => {
  console.error('\n❌ Test suite failed:', err);
  if (server) server.close();
  process.exit(1);
});
