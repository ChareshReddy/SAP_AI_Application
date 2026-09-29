import assert from 'assert';
import {
  checkMaterialMaintenance,
  validateMaterialInput,
  validatePlantInput,
  getMockMaterialPlants,
  setMockMaterialPlants,
  resetMockMaterialPlants
} from '../services/materialCheck.js';
import {
  checkMaterialPlantExtension,
  discoverBomHierarchy,
  setMockBomAlternatives,
  resetMockBomDataset
} from '../services/sapGuiClient.js';
import { TOOLS } from '../routes/chat.js';
import { verifyAllToolsSafety } from '../config/riskLevels.js';
import app from '../server.js';
import http from 'http';

console.log('======================================================');
console.log('--- Starting MARC Material Maintenance Check Test Suite ---');
console.log('======================================================');

async function runTests() {
  process.env.USE_MOCK_SAP = 'true';
  let serverInstance = null;
  let serverPort = 0;

  try {
    // 1. UNIT TEST: OK Status
    console.log('\n1. Testing OK Status:');
    const okRes = await checkMaterialMaintenance(['MAT-OK'], '1000');
    assert.strictEqual(okRes.success, true);
    assert.strictEqual(okRes.results.length, 1);
    assert.strictEqual(okRes.results[0].status, 'OK');
    assert.strictEqual(okRes.results[0].maintained, true);
    assert.strictEqual(okRes.summary.OK, 1);
    assert.strictEqual(okRes.summary.ok, 1);
    console.log('   ✓ Material maintained in plant returns status OK and maintained=true');

    // 2. UNIT TEST: NOT_EXTENDED Status
    console.log('\n2. Testing NOT_EXTENDED Status:');
    const notExtRes = await checkMaterialMaintenance(['MAT-NOT-EXTENDED'], '1000');
    assert.strictEqual(notExtRes.results[0].status, 'NOT_EXTENDED');
    assert.strictEqual(notExtRes.results[0].maintained, false);
    assert.ok(notExtRes.results[0].reason.includes('not extended'));
    assert.strictEqual(notExtRes.summary.NOT_EXTENDED, 1);
    console.log('   ✓ Material in MARA without MARC for plant returns NOT_EXTENDED');

    // 3. UNIT TEST: NOT_FOUND Status
    console.log('\n3. Testing NOT_FOUND Status:');
    const notFoundRes = await checkMaterialMaintenance(['NONEXISTENT_MATERIAL_999'], '1000');
    assert.strictEqual(notFoundRes.results[0].status, 'NOT_FOUND');
    assert.strictEqual(notFoundRes.results[0].maintained, false);
    assert.ok(notFoundRes.results[0].reason.includes('does not exist'));
    assert.strictEqual(notFoundRes.summary.NOT_FOUND, 1);
    console.log('   ✓ Material missing from MARA and MARC returns NOT_FOUND');

    // 4. UNIT TEST: DELETION_FLAG Status (Plant level & Client level)
    console.log('\n4. Testing DELETION_FLAG Status:');
    const delPlantRes = await checkMaterialMaintenance(['MAT-DELETED'], '1000');
    assert.strictEqual(delPlantRes.results[0].status, 'DELETION_FLAG');
    assert.strictEqual(delPlantRes.results[0].maintained, false);
    assert.ok(delPlantRes.results[0].reason.includes('MARC-LVORM'));

    const delMaraRes = await checkMaterialMaintenance(['MAT-MARA-DELETED'], '1000');
    assert.strictEqual(delMaraRes.results[0].status, 'DELETION_FLAG');
    assert.strictEqual(delMaraRes.results[0].maintained, false);
    assert.ok(delMaraRes.results[0].reason.includes('MARA-LVORM'));
    console.log('   ✓ Both plant-level (MARC) and client-level (MARA) deletion flags return DELETION_FLAG');

    // 5. UNIT TEST: BLOCKED Status (MMSTA set & PSTAT empty)
    console.log('\n5. Testing BLOCKED Status:');
    const blockedRes = await checkMaterialMaintenance(['MAT-BLOCKED'], '1000');
    assert.strictEqual(blockedRes.results[0].status, 'BLOCKED');
    assert.strictEqual(blockedRes.results[0].maintained, false);
    assert.ok(blockedRes.results[0].reason.includes('MMSTA'));

    const blockedStatRes = await checkMaterialMaintenance(['MAT-BLOCKED-STATUS'], '1000');
    assert.strictEqual(blockedStatRes.results[0].status, 'BLOCKED');

    const incompleteRes = await checkMaterialMaintenance(['MAT-INCOMPLETE'], '1000');
    assert.strictEqual(incompleteRes.results[0].status, 'BLOCKED');
    assert.ok(incompleteRes.results[0].reason.includes('PSTAT'));
    console.log('   ✓ Plant status (MMSTA) and missing maintenance views (PSTAT) return BLOCKED');

    // 6. UNIT TEST: UNKNOWN on SAP failure (Session lost, server unavailable, busy)
    console.log('\n6. Testing UNKNOWN Status on SAP Failure:');
    const originalHealth = process.env.TEST_SAP_SESSION_HEALTH;
    const originalFail = process.env.TEST_SIMULATE_SAP_FAILURE;

    try {
      process.env.TEST_SAP_SESSION_HEALTH = 'SERVER_UNAVAILABLE';
      const unavailRes = await checkMaterialMaintenance(['MAT-OK'], '1000');
      assert.strictEqual(unavailRes.results[0].status, 'UNKNOWN');
      assert.strictEqual(unavailRes.results[0].maintained, false);
      assert.strictEqual(unavailRes.success, false);

      process.env.TEST_SAP_SESSION_HEALTH = 'BUSY';
      const busyRes = await checkMaterialMaintenance(['MAT-OK'], '1000');
      assert.strictEqual(busyRes.results[0].status, 'UNKNOWN');
      assert.strictEqual(busyRes.results[0].maintained, false);

      process.env.TEST_SAP_SESSION_HEALTH = 'SESSION_NOT_FOUND';
      const noSessRes = await checkMaterialMaintenance(['MAT-OK'], '1000');
      assert.strictEqual(noSessRes.results[0].status, 'UNKNOWN');
      assert.strictEqual(noSessRes.results[0].maintained, false);

      process.env.TEST_SAP_SESSION_HEALTH = '';
      process.env.TEST_SIMULATE_SAP_FAILURE = 'true';
      const simFailRes = await checkMaterialMaintenance(['MAT-OK'], '1000');
      assert.strictEqual(simFailRes.results[0].status, 'UNKNOWN');
      assert.strictEqual(simFailRes.results[0].maintained, false);
    } finally {
      process.env.TEST_SAP_SESSION_HEALTH = originalHealth || '';
      process.env.TEST_SIMULATE_SAP_FAILURE = originalFail || '';
    }
    console.log('   ✓ SAP failures (server down, session lost, busy) return UNKNOWN');

    // 7. PROVING: SAP Error NEVER Returns OK (Fail-Closed Integrity)
    console.log('\n7. Proving Fail-Closed Integrity (Errors never return OK or extended=true):');
    try {
      process.env.TEST_SAP_SESSION_HEALTH = 'SERVER_UNAVAILABLE';
      const extCheck = await checkMaterialPlantExtension({ material: 'MAT-OK', plant: '1000' });
      assert.strictEqual(extCheck.extended, false);
      assert.strictEqual(extCheck.status, 'UNKNOWN');
      assert.ok(extCheck.errorCode);
    } finally {
      process.env.TEST_SAP_SESSION_HEALTH = originalHealth || '';
    }
    console.log('   ✓ checkMaterialPlantExtension strictly fails closed on error (extended: false, status: UNKNOWN)');

    // 8. INPUT VALIDATION & ALLOWLIST REJECTION
    console.log('\n8. Testing Input Validation and Strict Allowlist Rejection:');
    const validCheck = validateMaterialInput('MAT-123_ABC/01');
    assert.strictEqual(validCheck.valid, true);
    assert.strictEqual(validCheck.normalized, 'MAT-123_ABC/01');

    const invalidCharCheck = validateMaterialInput("MAT'; DROP TABLE MARC;--");
    assert.strictEqual(invalidCharCheck.valid, false);

    const emptyCheck = validateMaterialInput('   ');
    assert.strictEqual(emptyCheck.valid, false);

    const invalidPlantCheck = validatePlantInput('PLANT_TOO_LONG_123');
    assert.strictEqual(invalidPlantCheck.valid, false);

    const batchWithInvalid = await checkMaterialMaintenance(["MAT-OK", "INVALID '; DROP--"], '1000');
    assert.strictEqual(batchWithInvalid.results.length, 2);
    const validItem = batchWithInvalid.results.find(r => r.material === 'MAT-OK');
    const invalidItem = batchWithInvalid.results.find(r => r.material.includes('INVALID'));
    assert.strictEqual(validItem.status, 'OK');
    assert.strictEqual(invalidItem.status, 'UNKNOWN');
    assert.ok(invalidItem.reason.includes('validation rejected'));
    console.log('   ✓ Invalid inputs are rejected by allowlist before reaching SAP');

    // 9. BATCHING: Single Batched Call Returning All Statuses and Summary Counts
    console.log('\n9. Testing Batched Multi-Material Check with Accurate Summary:');
    const batchInput = [
      'MAT-OK',
      'MAT-NOT-EXTENDED',
      'NONEXISTENT_XYZ',
      'MAT-DELETED',
      'MAT-BLOCKED',
      'MAT-OK' // Duplicate test
    ];
    const batchRes = await checkMaterialMaintenance(batchInput, '1000');
    assert.strictEqual(batchRes.results.length, 5); // Deduped to 5
    assert.strictEqual(batchRes.summary.total, 5);
    assert.strictEqual(batchRes.summary.OK, 1);
    assert.strictEqual(batchRes.summary.NOT_EXTENDED, 1);
    assert.strictEqual(batchRes.summary.NOT_FOUND, 1);
    assert.strictEqual(batchRes.summary.DELETION_FLAG, 1);
    assert.strictEqual(batchRes.summary.BLOCKED, 1);
    assert.strictEqual(batchRes.summary.UNKNOWN, 0);
    console.log('   ✓ Single batched call correctly dedupes, resolves all statuses, and counts summary');

    // 10. BOM FLOW INTEGRATION: Non-Assembly Components are Checked in Hierarchy
    console.log('\n10. Testing BOM Flow Integration (Checking non-assembly components):');
    resetMockBomDataset();
    // Create a mock source BOM with an unextended non-assembly component
    setMockBomAlternatives('TEST-PARENT-BOM', '1001', '1', ['1'], 2, [
      { item: '0010', material: 'MAT-OK-1012', description: 'Valid Component', quantity: '1', unit: 'EA', itemCategory: 'L', assembly: false },
      { item: '0020', material: 'MAT-UNEXTENDED', description: 'Unextended Raw Component', quantity: '1', unit: 'EA', itemCategory: 'L', assembly: false }
    ]);

    const hierarchy = await discoverBomHierarchy({
      source: { material: 'TEST-PARENT-BOM', plant: '1001', bomUsage: '1' },
      target: { material: 'TEST-PARENT-BOM', plant: '1000', bomUsage: '1' } // Target plant 1000 where MAT-UNEXTENDED is NOT extended
    });

    assert.ok(hierarchy.unextendedMaterials.length > 0);
    const unextendedComp = hierarchy.unextendedMaterials.find(u => u.material === 'MAT-UNEXTENDED');
    assert.ok(unextendedComp, 'Non-assembly component MAT-UNEXTENDED must be caught and reported in unextendedMaterials');
    assert.strictEqual(unextendedComp.plant, '1000');
    assert.strictEqual(unextendedComp.status, 'NOT_EXTENDED');
    console.log('   ✓ Non-assembly BOM components are strictly checked and unextended items blocked');

    // 11. CHAT TOOL INTEGRITY & STARTUP SAFETY CHECK
    console.log('\n11. Testing Chat Tool Registration & Security Gate:');
    const toolDef = TOOLS.find(t => t.function?.name === 'check_material_maintenance');
    assert.ok(toolDef, 'check_material_maintenance tool must be registered in TOOLS');
    assert.strictEqual(toolDef.type, 'function');
    assert.strictEqual(toolDef.function.parameters.required.includes('plant'), true);

    // Verify all tools pass the security integrity audit (Level 4 blocked, no autoExecute bypass)
    const safetyPass = verifyAllToolsSafety(TOOLS);
    assert.strictEqual(safetyPass, true);
    console.log('   ✓ check_material_maintenance passes verifyAllToolsSafety and startup security audit');

    // 12. HTTP API ENDPOINT: POST /api/materials/check
    console.log('\n12. Testing HTTP REST Endpoint POST /api/materials/check:');
    serverInstance = http.createServer(app);
    await new Promise((resolve) => {
      serverInstance.listen(0, () => {
        serverPort = serverInstance.address().port;
        resolve();
      });
    });

    const postData = JSON.stringify({
      materials: ['MAT-OK', 'MAT-NOT-EXTENDED'],
      plant: '1000'
    });

    const apiRes = await new Promise((resolve, reject) => {
      const req = http.request(
        {
          hostname: '127.0.0.1',
          port: serverPort,
          path: '/api/materials/check',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(postData)
          }
        },
        (res) => {
          let body = '';
          res.on('data', chunk => { body += chunk; });
          res.on('end', () => {
            resolve({ statusCode: res.statusCode, data: JSON.parse(body) });
          });
        }
      );
      req.on('error', reject);
      req.write(postData);
      req.end();
    });

    assert.strictEqual(apiRes.statusCode, 200);
    assert.strictEqual(apiRes.data.success, true);
    assert.strictEqual(apiRes.data.plant, '1000');
    assert.strictEqual(apiRes.data.results.length, 2);
    assert.strictEqual(apiRes.data.summary.total, 2);
    console.log('   ✓ POST /api/materials/check responds with status 200 and verified JSON payload');

    console.log('\n======================================================');
    console.log('✅ ALL 12 MARC MATERIAL MAINTENANCE CHECK TESTS PASSED!');
    console.log('======================================================\n');
  } finally {
    if (serverInstance) {
      serverInstance.close();
    }
  }
}

runTests().catch((err) => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
