import assert from 'assert';
import http from 'http';
import app from '../server.js';
import { auditLogger } from '../services/auditLog.js';
import {
  checkBomSubDependencies,
  checkMaterialPlantExtension,
  compareBomStructures,
  verifyBomInCs03,
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
  console.log('--- Starting BOM Structural Preservation Test Suite ---');
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
    // TEST 1: Pre-flight sub-BOM dependency check: existing vs missing sub-BOMs
    // -------------------------------------------------------------------------
    console.log('\n1. Testing Pre-Flight Sub-BOM Dependency Check (A1BH0214C 1001 -> 1012):');
    resetMockBomDataset();

    const depsResult = await checkBomSubDependencies({
      source: { material: 'A1BH0214C', plant: '1001', bomUsage: '1' },
      target: { material: 'A1BH0214C', plant: '1012', bomUsage: '1' }
    });

    assert.ok(depsResult, 'Dependency check result must be returned');
    assert.strictEqual(depsResult.mainBom.material, 'A1BH0214C');
    assert.strictEqual(depsResult.mainBom.sourcePlant, '1001');
    assert.strictEqual(depsResult.mainBom.targetPlant, '1012');

    // Existing sub-BOMs in 1012 (skipped, never overwritten)
    const existingMaterials = depsResult.existingSubBoms.map((b) => b.material);
    console.log('   Existing sub-BOMs in plant 1012:', existingMaterials);
    assert.ok(existingMaterials.includes('B1BH0214C'), 'B1BH0214C should already exist in 1012');
    assert.ok(existingMaterials.includes('PPBH0001C'), 'PPBH0001C should already exist in 1012');
    assert.ok(existingMaterials.includes('C1HL0003C'), 'C1HL0003C should already exist in 1012');

    // Missing sub-BOMs in 1012
    const missingMaterials = depsResult.missingSubBoms.map((b) => b.material);
    console.log('   Missing sub-BOMs in plant 1012:', missingMaterials);
    assert.ok(missingMaterials.includes('C1BH0214C'), 'C1BH0214C should be missing in 1012');
    assert.strictEqual(depsResult.missingSubBoms.length, 1, 'Only C1BH0214C should be missing in 1012');

    console.log('   ✓ Pre-flight dependency check accurately identifies existing and missing sub-BOMs');

    // -------------------------------------------------------------------------
    // TEST 2: Sub-BOM missing, user chooses "Copy main BOM only"
    // -------------------------------------------------------------------------
    console.log('\n2. Testing User Choosing "Copy main BOM only" (copySubBoms: false):');
    resetMockBomDataset();
    auditLogger.clearAuditLogs();

    // Trigger proposal via structured copy_bom action
    const proposeRes = await makeRequest(
      'POST',
      '/api/chat',
      {
        message: 'Copy BOM from A1BH0214C plant 1001 to plant 1012',
        actionType: 'copy_bom',
        copyBomParams: {
          sourceMaterial: 'A1BH0214C',
          sourcePlant: '1001',
          sourceUsage: '1',
          targetMaterial: 'A1BH0214C',
          targetPlant: '1012',
          targetUsage: '1'
        }
      },
      authHeaders
    );

    assert.strictEqual(proposeRes.status, 200);
    assert.ok(proposeRes.data.proposedAction, 'Proposed action should be returned');
    assert.strictEqual(proposeRes.data.proposedAction.type, 'copy_bom');

    const actionId = proposeRes.data.proposedAction.actionId;
    const subDepsInPreview = proposeRes.data.proposedAction.preview.subBomDependencies;
    assert.ok(subDepsInPreview, 'Sub-BOM dependencies must be included in action preview');
    assert.strictEqual(subDepsInPreview.missingSubBoms.length, 1);
    assert.strictEqual(subDepsInPreview.missingSubBoms[0].material, 'C1BH0214C');

    // Confirm with copySubBoms: false (main BOM only)
    const confirmRes = await makeRequest(
      'POST',
      '/api/chat',
      {
        confirmAction: actionId,
        copySubBoms: false
      },
      authHeaders
    );

    assert.strictEqual(confirmRes.status, 200);
    assert.ok(confirmRes.data.actionResult, 'actionResult must be present');
    assert.strictEqual(confirmRes.data.actionResult.success, true);
    assert.strictEqual(confirmRes.data.actionResult.verified, true);
    assert.strictEqual(confirmRes.data.actionResult.status, 'SUCCESS_WITH_WARNINGS');

    // Verification check in CS03: C1BH0214C is missing in 1012, so Asm is unchecked, which is EXPLAINED
    const warnings = confirmRes.data.actionResult.warnings || [];
    assert.ok(warnings.length > 0, 'Should contain warnings for explained Asm mismatch');
    assert.ok(
      warnings.some((w) => w.material === 'C1BH0214C' && w.reason.includes('user selected main BOM only')),
      'Warning must clearly explain that C1BH0214C Asm is unchecked due to missing sub-BOM'
    );

    // Verify sub-BOM C1BH0214C was NOT created in plant 1012
    const subBomInTarget = await verifyBomInCs03({ material: 'C1BH0214C', plant: '1012', bomUsage: '1' });
    assert.strictEqual(subBomInTarget.exists, false, 'C1BH0214C should NOT be created when main BOM only is chosen');

    // Verify main BOM was created in plant 1012
    const mainBomInTarget = await verifyBomInCs03({ material: 'A1BH0214C', plant: '1012', bomUsage: '1' });
    assert.strictEqual(mainBomInTarget.exists, true, 'Main BOM A1BH0214C must be created in plant 1012');

    // Audit log should have 1 entry (for main BOM)
    const auditLogs = auditLogger.getAuditLogs();
    const bomAuditEntries = auditLogs.filter((l) => l.actionType === 'copy_bom');
    assert.strictEqual(bomAuditEntries.length, 1, 'Only 1 audit log entry should exist for main BOM copy');

    console.log('   ✓ User choosing "main BOM only" creates 1 BOM, explains Asm differences, returns SUCCESS_WITH_WARNINGS');

    // -------------------------------------------------------------------------
    // TEST 3: Sub-BOM missing, user chooses "Copy main BOM + missing sub-BOMs"
    // -------------------------------------------------------------------------
    console.log('\n3. Testing User Choosing "Copy main BOM + missing sub-BOMs" (copySubBoms: true):');
    resetMockBomDataset();
    auditLogger.clearAuditLogs();

    // Trigger proposal again
    const proposeRes2 = await makeRequest(
      'POST',
      '/api/chat',
      {
        message: 'Copy BOM from A1BH0214C plant 1001 to plant 1012',
        actionType: 'copy_bom',
        copyBomParams: {
          sourceMaterial: 'A1BH0214C',
          sourcePlant: '1001',
          sourceUsage: '1',
          targetMaterial: 'A1BH0214C',
          targetPlant: '1012',
          targetUsage: '1'
        }
      },
      authHeaders
    );

    const actionId2 = proposeRes2.data.proposedAction.actionId;

    // Confirm with copySubBoms: true (copy sub-BOMs first, then main BOM)
    const confirmRes2 = await makeRequest(
      'POST',
      '/api/chat',
      {
        confirmAction: actionId2,
        copySubBoms: true
      },
      authHeaders
    );

    assert.strictEqual(confirmRes2.status, 200);
    assert.strictEqual(confirmRes2.data.actionResult.success, true);
    assert.strictEqual(confirmRes2.data.actionResult.verified, true);
    assert.strictEqual(confirmRes2.data.actionResult.status, 'SUCCESS');

    // Verify sub-BOM C1BH0214C WAS created in plant 1012
    const subBomInTarget2 = await verifyBomInCs03({ material: 'C1BH0214C', plant: '1012', bomUsage: '1' });
    assert.strictEqual(subBomInTarget2.exists, true, 'C1BH0214C sub-BOM must now exist in plant 1012');

    // Verify main BOM A1BH0214C in plant 1012 has 100% component and Asm parity
    const mainBomInTarget2 = await verifyBomInCs03({ material: 'A1BH0214C', plant: '1012', bomUsage: '1' });
    assert.strictEqual(mainBomInTarget2.exists, true, 'Main BOM A1BH0214C must exist in plant 1012');

    const c1Comp = mainBomInTarget2.components.find((c) => c.material === 'C1BH0214C');
    assert.ok(c1Comp, 'C1BH0214C component must be present in target BOM');
    assert.strictEqual(c1Comp.assembly, true, 'C1BH0214C must have assembly=true in plant 1012');

    // Check created sub-BOMs in response summary
    assert.ok(confirmRes2.data.actionResult.createdSubBoms, 'createdSubBoms list must be present in response');
    assert.strictEqual(confirmRes2.data.actionResult.createdSubBoms.length, 1);
    assert.strictEqual(confirmRes2.data.actionResult.createdSubBoms[0].material, 'C1BH0214C');

    // Audit logs: must have entries for both sub-BOM and main BOM
    const auditLogs2 = auditLogger.getAuditLogs();
    const bomAuditEntries2 = auditLogs2.filter((l) => l.actionType === 'copy_bom');
    assert.strictEqual(bomAuditEntries2.length, 2, '2 audit entries must exist (1 sub-BOM + 1 main BOM)');
    const auditMats = bomAuditEntries2.map((a) => a.recordId);
    assert.ok(auditMats.includes('C1BH0214C'), 'Audit log must record C1BH0214C sub-BOM creation');
    assert.ok(auditMats.includes('A1BH0214C'), 'Audit log must record A1BH0214C main BOM creation');

    console.log('   ✓ User choosing "main + sub-BOMs" copies sub-BOM first, preserves Asm=true, returns SUCCESS, logs audit entries');

    // -------------------------------------------------------------------------
    // TEST 4: Material plant extension check blocks sub-BOM copy
    // -------------------------------------------------------------------------
    console.log('\n4. Testing Material Plant Extension Check:');
    
    // (a) Directly test checkMaterialPlantExtension
    const validExt = await checkMaterialPlantExtension({ material: 'B1BH0214C', plant: '1012' });
    assert.strictEqual(validExt.extended, true, 'B1BH0214C in 1012 should be extended');

    const unextendedExt = await checkMaterialPlantExtension({ material: 'MAT_UNEXTENDED_ITEM', plant: '1012' });
    assert.strictEqual(unextendedExt.extended, false, 'MAT_UNEXTENDED_ITEM should not be extended');
    assert.strictEqual(unextendedExt.errorCode, 'MATERIAL_PLANT_INVALID');

    // (b) Test checkBomSubDependencies with an unextended sub-assembly material
    resetMockBomDataset();
    setMockBomAlternatives('TEST_PARENT_MAT', '1001', '1', ['1'], 1);
    setMockBomAlternatives('MAT_UNEXTENDED_CHILD', '1001', '1', ['1'], 2);
    const mockDataset = getMockBomDataset();
    const parentBom = mockDataset.find((b) => b.material === 'TEST_PARENT_MAT' && b.plant === '1001');
    parentBom.components = [
      {
        item: '0010',
        material: 'MAT_UNEXTENDED_CHILD',
        description: 'Unextended Subassembly',
        quantity: '1',
        unit: 'EA',
        itemCategory: 'L',
        assembly: true
      }
    ];

    const unextCheckResult = await checkBomSubDependencies({
      source: { material: 'TEST_PARENT_MAT', plant: '1001', bomUsage: '1' },
      target: { material: 'TEST_PARENT_MAT', plant: '1012', bomUsage: '1' }
    });

    assert.strictEqual(unextCheckResult.unextendedMaterials.length, 1);
    assert.strictEqual(unextCheckResult.unextendedMaterials[0].material, 'MAT_UNEXTENDED_CHILD');
    assert.strictEqual(
      unextCheckResult.unextendedMaterials[0].reason,
      'cannot copy: material not in plant 1012'
    );
    // Crucial: unextended material must NOT be offered in missingSubBoms
    assert.strictEqual(unextCheckResult.missingSubBoms.length, 0, 'Unextended material must not be in missingSubBoms');

    console.log('   ✓ Unextended material is reported as "cannot copy: material not in plant X" and excluded from sub-BOM copy');

    // -------------------------------------------------------------------------
    // TEST 5: Sub-BOM copy failure stops the main copy (fail-safe)
    // -------------------------------------------------------------------------
    console.log('\n5. Testing Fail-Safe: Sub-BOM Copy Failure Stops Main Copy:');
    resetMockBomDataset();
    auditLogger.clearAuditLogs();

    // Create a pending action with a sub-BOM that cannot be copied (e.g. source sub-BOM doesn't exist)
    const failPending = pendingActionStore.createPendingAction({
      type: 'copy_bom',
      entityKey: 'bom',
      recordId: 'FAIL_TEST_MAT',
      payload: {
        source: { material: 'FAIL_TEST_SRC', plant: '1001', bomUsage: '1' },
        target: { material: 'FAIL_TEST_MAT', plant: '1012', bomUsage: '1' },
        subBomDependencies: {
          missingSubBoms: [
            {
              material: 'NON_EXISTENT_SUB_BOM',
              sourcePlant: '1001',
              targetPlant: '1012',
              bomUsage: '1',
              componentCount: 0,
              depth: 1
            }
          ]
        }
      }
    });

    const failConfirmRes = await makeRequest(
      'POST',
      '/api/chat',
      {
        confirmAction: failPending.actionId,
        copySubBoms: true
      },
      authHeaders
    );

    assert.strictEqual(failConfirmRes.status, 200);
    assert.ok(failConfirmRes.data.error, 'Operation should report error when sub-BOM copy fails');
    assert.ok(
      failConfirmRes.data.reply.includes('Sub-BOM copy failed') || failConfirmRes.data.reply.includes('Failed to copy sub-BOM') || failConfirmRes.data.reply.includes('Sub-BOM copy aborted'),
      'Reply must explain sub-BOM failure'
    );

    // Verify main BOM was NOT created
    const mainBomCheck = await verifyBomInCs03({ material: 'FAIL_TEST_MAT', plant: '1012', bomUsage: '1' });
    assert.strictEqual(mainBomCheck.exists, false, 'Main BOM must NOT be created when sub-BOM copy fails');

    console.log('   ✓ Sub-BOM failure immediately stops execution and prevents main BOM creation');

    // -------------------------------------------------------------------------
    // TEST 6: compareBomStructures - Explained Asm mismatch gives SUCCESS_WITH_WARNINGS
    // -------------------------------------------------------------------------
    console.log('\n6. Testing compareBomStructures with Explained Asm Mismatch:');
    const compSrc = [
      { item: '0010', material: 'SUB_PART_1', quantity: '10', unit: 'EA', itemCategory: 'L', assembly: true },
      { item: '0020', material: 'RAW_PART_2', quantity: '5', unit: 'KG', itemCategory: 'L', assembly: false }
    ];
    const compTgtExplained = [
      { item: '0010', material: 'SUB_PART_1', quantity: '10', unit: 'EA', itemCategory: 'L', assembly: false }, // Asm false because missing sub-BOM
      { item: '0020', material: 'RAW_PART_2', quantity: '5', unit: 'KG', itemCategory: 'L', assembly: false }
    ];

    const explainedRes = compareBomStructures({
      sourceComponents: compSrc,
      targetComponents: compTgtExplained,
      targetPlant: '1012',
      missingSubBomMaterials: ['SUB_PART_1'],
      copiedMainOnly: true
    });

    assert.strictEqual(explainedRes.status, 'SUCCESS_WITH_WARNINGS');
    assert.strictEqual(explainedRes.match, true);
    assert.strictEqual(explainedRes.differences.length, 0);
    assert.strictEqual(explainedRes.warnings.length, 1);
    assert.ok(explainedRes.warnings[0].reason.includes('user selected main BOM only'));

    console.log('   ✓ compareBomStructures yields SUCCESS_WITH_WARNINGS when Asm difference is explained');

    // -------------------------------------------------------------------------
    // TEST 7: compareBomStructures - Unexplained mismatches result in FAILURE
    // -------------------------------------------------------------------------
    console.log('\n7. Testing compareBomStructures with Unexplained Mismatches (FAILURE):');

    // 7a. Unexplained Asm mismatch (user copied both, or sub-BOM exists, but target Asm is false)
    const unexplainedAsmRes = compareBomStructures({
      sourceComponents: compSrc,
      targetComponents: compTgtExplained,
      targetPlant: '1012',
      missingSubBomMaterials: [],
      copiedMainOnly: false
    });
    assert.strictEqual(unexplainedAsmRes.status, 'FAILURE');
    assert.strictEqual(unexplainedAsmRes.match, false);
    assert.ok(unexplainedAsmRes.differences.some((d) => d.includes('Unexplained Assembly indicator mismatch')));

    // 7b. Quantity mismatch
    const qtyMismatchTgt = [
      { item: '0010', material: 'SUB_PART_1', quantity: '99', unit: 'EA', itemCategory: 'L', assembly: true },
      { item: '0020', material: 'RAW_PART_2', quantity: '5', unit: 'KG', itemCategory: 'L', assembly: false }
    ];
    const qtyRes = compareBomStructures({
      sourceComponents: compSrc,
      targetComponents: qtyMismatchTgt
    });
    assert.strictEqual(qtyRes.status, 'FAILURE');
    assert.strictEqual(qtyRes.match, false);
    assert.ok(qtyRes.differences.some((d) => d.includes('Quantity mismatch')));

    // 7c. Unit mismatch
    const unitMismatchTgt = [
      { item: '0010', material: 'SUB_PART_1', quantity: '10', unit: 'KG', itemCategory: 'L', assembly: true },
      { item: '0020', material: 'RAW_PART_2', quantity: '5', unit: 'KG', itemCategory: 'L', assembly: false }
    ];
    const unitRes = compareBomStructures({
      sourceComponents: compSrc,
      targetComponents: unitMismatchTgt
    });
    assert.strictEqual(unitRes.status, 'FAILURE');
    assert.strictEqual(unitRes.match, false);
    assert.ok(unitRes.differences.some((d) => d.includes('Unit mismatch')));

    // 7d. Item category mismatch
    const catMismatchTgt = [
      { item: '0010', material: 'SUB_PART_1', quantity: '10', unit: 'EA', itemCategory: 'N', assembly: true },
      { item: '0020', material: 'RAW_PART_2', quantity: '5', unit: 'KG', itemCategory: 'L', assembly: false }
    ];
    const catRes = compareBomStructures({
      sourceComponents: compSrc,
      targetComponents: catMismatchTgt
    });
    assert.strictEqual(catRes.status, 'FAILURE');
    assert.strictEqual(catRes.match, false);
    assert.ok(catRes.differences.some((d) => d.includes('Item category mismatch')));

    // 7e. Missing component
    const missingCompTgt = [
      { item: '0010', material: 'SUB_PART_1', quantity: '10', unit: 'EA', itemCategory: 'L', assembly: true }
    ];
    const missingRes = compareBomStructures({
      sourceComponents: compSrc,
      targetComponents: missingCompTgt
    });
    assert.strictEqual(missingRes.status, 'FAILURE');
    assert.strictEqual(missingRes.match, false);
    assert.ok(missingRes.differences.some((d) => d.includes('Component count mismatch') || d.includes('missing in target BOM')));

    console.log('   ✓ compareBomStructures correctly fails on any unexplained difference');

    console.log('\n======================================================');
    console.log('--- ALL 7 BOM Structural Preservation Tests Passed! ---');
    console.log('======================================================\n');
  } finally {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  }
}

runBomStructuralPreservationTests().catch((err) => {
  console.error('\n❌ Test suite failed with error:', err);
  process.exit(1);
});
