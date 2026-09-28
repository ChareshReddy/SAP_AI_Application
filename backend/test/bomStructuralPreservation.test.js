import assert from 'assert';
import http from 'http';
import app from '../server.js';
import { auditLogger } from '../services/auditLog.js';
import {
  discoverBomHierarchy,
  resolveNextAvailableAlternative,
  formatHierarchyTree,
  verifyHierarchyStructure,
  compareBomStructures,
  checkMaterialPlantExtension,
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
    // TEST 1: Single-level BOM copy (no sub-BOMs) -> creates 1 BOM, verifies structure
    // -------------------------------------------------------------------------
    console.log('\n1. Testing Single-Level BOM Copy (no sub-BOMs):');
    resetMockBomDataset();
    setMockBomAlternatives('MAT_SINGLE_01', '1001', '1', ['1'], 2, [
      { item: '0010', material: 'RAW_01', description: 'Raw material 1', quantity: '10', unit: 'KG', itemCategory: 'L', assembly: false },
      { item: '0020', material: 'RAW_02', description: 'Raw material 2', quantity: '20', unit: 'KG', itemCategory: 'L', assembly: false }
    ]);

    const proposeRes1 = await makeRequest(
      'POST',
      '/api/chat',
      {
        message: 'Copy BOM from MAT_SINGLE_01 plant 1001 to plant 1012',
        actionType: 'copy_bom',
        copyBomParams: {
          sourceMaterial: 'MAT_SINGLE_01',
          sourcePlant: '1001',
          sourceUsage: '1',
          targetMaterial: 'MAT_SINGLE_01',
          targetPlant: '1012',
          targetUsage: '1'
        }
      },
      authHeaders
    );

    assert.strictEqual(proposeRes1.status, 200);
    assert.ok(proposeRes1.data.proposedAction, 'Proposed action must be returned');
    const actionId1 = proposeRes1.data.proposedAction.actionId;
    const copyOrder1 = proposeRes1.data.proposedAction.preview.copyOrder;
    assert.strictEqual(copyOrder1.length, 1, 'Single-level BOM should have copyOrder length 1');

    const confirmRes1 = await makeRequest('POST', '/api/chat', { confirmAction: actionId1 }, authHeaders);
    assert.strictEqual(confirmRes1.status, 200);
    assert.strictEqual(confirmRes1.data.actionResult.success, true);
    assert.strictEqual(confirmRes1.data.actionResult.verified, true);
    assert.strictEqual(confirmRes1.data.actionResult.status, 'SUCCESS');

    const cs03Res1 = await verifyBomInCs03({ material: 'MAT_SINGLE_01', plant: '1012', bomUsage: '1', alternativeBom: '1' });
    assert.strictEqual(cs03Res1.exists, true);
    assert.strictEqual(cs03Res1.components.length, 2);
    console.log('   ✓ Single-level BOM copied and verified in CS03 with 100% parity');

    // -------------------------------------------------------------------------
    // TEST 2: Multi-level BOM hierarchy copy (2 levels) -> creates sub-BOM first, then main BOM
    // -------------------------------------------------------------------------
    console.log('\n2. Testing Multi-Level BOM Hierarchy Copy (2 levels):');
    resetMockBomDataset();

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

    assert.strictEqual(proposeRes2.status, 200);
    const actionId2 = proposeRes2.data.proposedAction.actionId;
    const copyOrder2 = proposeRes2.data.proposedAction.preview.copyOrder;
    assert.ok(copyOrder2.length >= 2, 'Hierarchy copy order must contain sub-BOMs and main BOM');

    // Sub-BOM C1BH0214C is missing in 1012 initially
    const subBomOrderIndex = copyOrder2.findIndex((b) => b.material === 'C1BH0214C');
    const mainBomOrderIndex = copyOrder2.findIndex((b) => b.material === 'A1BH0214C');
    assert.ok(subBomOrderIndex < mainBomOrderIndex, 'Sub-BOM C1BH0214C must precede main BOM A1BH0214C in copy order');

    const confirmRes2 = await makeRequest('POST', '/api/chat', { confirmAction: actionId2 }, authHeaders);
    assert.strictEqual(confirmRes2.status, 200);
    assert.strictEqual(confirmRes2.data.actionResult.success, true);
    assert.strictEqual(confirmRes2.data.actionResult.status, 'SUCCESS');

    // Verify sub-BOM exists in target plant
    const targetSubRes2 = await verifyBomInCs03({ material: 'C1BH0214C', plant: '1012', bomUsage: '1' });
    assert.strictEqual(targetSubRes2.exists, true);

    // Verify main BOM in target plant preserves assembly=true for C1BH0214C
    const targetMainRes2 = await verifyBomInCs03({ material: 'A1BH0214C', plant: '1012', bomUsage: '1' });
    assert.strictEqual(targetMainRes2.exists, true);
    const compC1 = targetMainRes2.components.find((c) => c.material === 'C1BH0214C');
    assert.ok(compC1, 'Component C1BH0214C must exist in target BOM');
    assert.strictEqual(compC1.assembly, true, 'Component C1BH0214C must have assembly=true in target plant');
    console.log('   ✓ Multi-level BOM hierarchy transferred completely with assembly relationships preserved');

    // -------------------------------------------------------------------------
    // TEST 3: Deep hierarchy copy (3+ levels) -> creates deepest first, bottom-up order verified
    // -------------------------------------------------------------------------
    console.log('\n3. Testing Deep Hierarchy Copy (3+ levels, bottom-up verified):');
    resetMockBomDataset();
    setMockBomAlternatives('L3_DEEP', '1001', '1', ['1'], 1, [
      { item: '0010', material: 'RAW_BASE', description: 'Base Raw', quantity: '5', unit: 'KG', itemCategory: 'L', assembly: false }
    ]);
    setMockBomAlternatives('L2_SUB', '1001', '1', ['1'], 1, [
      { item: '0010', material: 'L3_DEEP', description: 'Deep sub component', quantity: '1', unit: 'EA', itemCategory: 'L', assembly: true }
    ]);
    setMockBomAlternatives('L1_MAIN', '1001', '1', ['1'], 1, [
      { item: '0010', material: 'L2_SUB', description: 'Mid sub component', quantity: '1', unit: 'EA', itemCategory: 'L', assembly: true }
    ]);

    const hierarchy3 = await discoverBomHierarchy({
      source: { material: 'L1_MAIN', plant: '1001', bomUsage: '1' },
      target: { material: 'L1_MAIN', plant: '1012', bomUsage: '1' }
    });

    assert.strictEqual(hierarchy3.copyOrder.length, 3);
    assert.strictEqual(hierarchy3.copyOrder[0].material, 'L3_DEEP', 'Depth 2 (L3_DEEP) must be first');
    assert.strictEqual(hierarchy3.copyOrder[1].material, 'L2_SUB', 'Depth 1 (L2_SUB) must be second');
    assert.strictEqual(hierarchy3.copyOrder[2].material, 'L1_MAIN', 'Depth 0 (L1_MAIN) must be last');
    assert.strictEqual(hierarchy3.metrics.totalLevels, 3);
    console.log('   ✓ 3-level deep hierarchy correctly discovered and sorted bottom-up (L3_DEEP -> L2_SUB -> L1_MAIN)');

    // -------------------------------------------------------------------------
    // TEST 4: Target alternative resolution when target already exists -> finds next available
    // -------------------------------------------------------------------------
    console.log('\n4. Testing Target Alternative Resolution (Target already exists):');
    resetMockBomDataset();
    setMockBomAlternatives('MAT_ALT_01', '1012', '1', ['1'], 5);

    const resolvedAlt4 = resolveNextAvailableAlternative(['1'], '1');
    assert.strictEqual(resolvedAlt4, '2', 'When alternative 1 exists and alternative 1 is requested, next available must be 2');

    const hierarchy4 = await discoverBomHierarchy({
      source: { material: 'MAT_SINGLE_01', plant: '1001', bomUsage: '1' },
      target: { material: 'MAT_ALT_01', plant: '1012', bomUsage: '1', alternativeBom: '1' }
    });
    assert.strictEqual(hierarchy4.mainBom.targetAlt, '2');
    console.log('   ✓ Target BOM with alternative 1 correctly resolves next available alternative: 2');

    // -------------------------------------------------------------------------
    // TEST 5: Target already has alternatives 1, 2, 3, 4 -> creates alternative 5
    // -------------------------------------------------------------------------
    console.log('\n5. Testing Target Has Alternatives 1, 2, 3, 4 -> Resolves Alternative 5:');
    const resolvedAlt5 = resolveNextAvailableAlternative(['1', '2', '3', '4'], '1');
    assert.strictEqual(resolvedAlt5, '5', 'When alternatives 1, 2, 3, 4 exist, next available must be 5');

    resetMockBomDataset();
    setMockBomAlternatives('A1BH0214C', '1012', '1', ['1', '2', '3', '4'], 10);
    const hierarchy5 = await discoverBomHierarchy({
      source: { material: 'A1BH0214C', plant: '1001', bomUsage: '1' },
      target: { material: 'A1BH0214C', plant: '1012', bomUsage: '1', alternativeBom: '1' }
    });
    assert.strictEqual(hierarchy5.mainBom.targetAlt, '5', 'Main BOM targetAlt must resolve to 5');
    console.log('   ✓ Existing alternatives [1, 2, 3, 4] correctly resolve to alternative 5');

    // -------------------------------------------------------------------------
    // TEST 6: Per-sub-BOM alternative resolution -> each sub-BOM independently resolves
    // -------------------------------------------------------------------------
    console.log('\n6. Testing Per-Sub-BOM Alternative Resolution (Independent per material):');
    resetMockBomDataset();
    // Sub-BOM B1BH0214C already has alternatives 1 and 2 in target plant 1012
    setMockBomAlternatives('B1BH0214C', '1012', '1', ['1', '2'], 5);
    // Sub-BOM C1BH0214C has no BOM in target plant 1012
    // Main BOM A1BH0214C has alternative 1 in target plant 1012
    setMockBomAlternatives('A1BH0214C', '1012', '1', ['1'], 16);

    const hierarchy6 = await discoverBomHierarchy({
      source: { material: 'A1BH0214C', plant: '1001', bomUsage: '1' },
      target: { material: 'A1BH0214C', plant: '1012', bomUsage: '1' }
    });

    const b1Item = hierarchy6.copyOrder.find((b) => b.material === 'B1BH0214C');
    const c1Item = hierarchy6.copyOrder.find((b) => b.material === 'C1BH0214C');
    const a1Item = hierarchy6.mainBom;

    assert.ok(b1Item, 'B1BH0214C should be in copy order');
    assert.strictEqual(b1Item.targetAlt, '3', 'B1BH0214C has alternatives [1, 2], so next available must be 3');
    assert.strictEqual(c1Item.targetAlt, '1', 'C1BH0214C has no BOM, so next available must be 1');
    assert.strictEqual(a1Item.targetAlt, '2', 'A1BH0214C has alternative [1], so next available must be 2');
    console.log('   ✓ Each sub-BOM independently resolved its own next available alternative (B1->3, C1->1, Main->2)');

    // -------------------------------------------------------------------------
    // TEST 7: Existing target BOMs are NEVER overwritten
    // -------------------------------------------------------------------------
    console.log('\n7. Testing Non-Overwriting Protection of Existing Target BOMs:');
    resetMockBomDataset();
    const originalAlt1Comps = [
      { item: '0010', material: 'ORIGINAL_COMP', description: 'Original Component', quantity: '99', unit: 'EA', itemCategory: 'L', assembly: false }
    ];
    setMockBomAlternatives('MAT_SAFE_01', '1012', '1', ['1'], 1, originalAlt1Comps);

    // Source BOM has different components
    setMockBomAlternatives('MAT_SAFE_01', '1001', '1', ['1'], 1, [
      { item: '0010', material: 'NEW_COPIED_COMP', description: 'New Copied Component', quantity: '5', unit: 'KG', itemCategory: 'L', assembly: false }
    ]);

    // Propose copy to plant 1012
    const proposeRes7 = await makeRequest(
      'POST',
      '/api/chat',
      {
        message: 'Copy BOM from MAT_SAFE_01 plant 1001 to plant 1012',
        actionType: 'copy_bom',
        copyBomParams: {
          sourceMaterial: 'MAT_SAFE_01',
          sourcePlant: '1001',
          sourceUsage: '1',
          targetMaterial: 'MAT_SAFE_01',
          targetPlant: '1012',
          targetUsage: '1'
        }
      },
      authHeaders
    );

    const actionId7 = proposeRes7.data.proposedAction.actionId;
    const confirmRes7 = await makeRequest('POST', '/api/chat', { confirmAction: actionId7 }, authHeaders);
    assert.strictEqual(confirmRes7.status, 200);

    // Verify Alternative 1 in target plant is completely UNTOUCHED
    const targetAlt1Res = await verifyBomInCs03({ material: 'MAT_SAFE_01', plant: '1012', bomUsage: '1', alternativeBom: '1' });
    assert.strictEqual(targetAlt1Res.exists, true);
    assert.strictEqual(targetAlt1Res.components[0].material, 'ORIGINAL_COMP', 'Alternative 1 must retain its original component');

    // Verify Alternative 2 in target plant has the newly copied component
    const targetAlt2Res = await verifyBomInCs03({ material: 'MAT_SAFE_01', plant: '1012', bomUsage: '1', alternativeBom: '2' });
    assert.strictEqual(targetAlt2Res.exists, true);
    assert.strictEqual(targetAlt2Res.components[0].material, 'NEW_COPIED_COMP', 'Alternative 2 must contain the copied component');
    console.log('   ✓ Target Alternative 1 remained completely untouched while Alternative 2 was created');

    // -------------------------------------------------------------------------
    // TEST 8: Execution order is strictly bottom-up
    // -------------------------------------------------------------------------
    console.log('\n8. Testing Strict Bottom-Up Execution Sequence:');
    resetMockBomDataset();
    const hierarchy8 = await discoverBomHierarchy({
      source: { material: 'A1BH0214C', plant: '1001', bomUsage: '1' },
      target: { material: 'A1BH0214C', plant: '1012', bomUsage: '1' }
    });

    const depths = hierarchy8.copyOrder.map((b) => b.depth);
    for (let i = 0; i < depths.length - 1; i++) {
      assert.ok(depths[i] >= depths[i + 1], `Depth at index ${i} (${depths[i]}) must be >= depth at index ${i + 1} (${depths[i + 1]})`);
    }
    assert.strictEqual(depths[depths.length - 1], 0, 'Main BOM at the end must have depth 0');
    console.log('   ✓ Execution order strictly follows bottom-up sequence:', depths);

    // -------------------------------------------------------------------------
    // TEST 9: Fail-stop behavior: if any sub-BOM creation fails, execution halts immediately
    // -------------------------------------------------------------------------
    console.log('\n9. Testing Fail-Stop Behavior (Halts on First Failure):');
    resetMockBomDataset();
    // Simulate invalid source sub-BOM that cannot be found
    const invalidCopyOrder = [
      { material: 'MISSING_SOURCE_SUB', sourceMaterial: 'NON_EXISTENT', sourcePlant: '1001', targetPlant: '1012', bomUsage: '1', depth: 1, components: [] },
      { material: 'SHOULD_NOT_BE_ATTEMPTED', sourceMaterial: 'A1BH0214C', sourcePlant: '1001', targetPlant: '1012', bomUsage: '1', depth: 0, components: [] }
    ];

    const pendingFail = pendingActionStore.createPendingAction({
      type: 'copy_bom',
      entityKey: 'bom',
      recordId: 'SHOULD_NOT_BE_ATTEMPTED',
      payload: {
        source: { material: 'NON_EXISTENT', plant: '1001', bomUsage: '1' },
        target: { material: 'SHOULD_NOT_BE_ATTEMPTED', plant: '1012', bomUsage: '1' },
        copyOrder: invalidCopyOrder
      },
      preview: { summary: 'Fail stop test', copyOrder: invalidCopyOrder },
      sapUsername: 'LEELAM_EXT',
      sourcePrompt: 'Test fail stop'
    });

    const failConfirmRes = await makeRequest('POST', '/api/chat', { confirmAction: pendingFail.actionId }, authHeaders);
    assert.strictEqual(failConfirmRes.status, 200);
    assert.strictEqual(failConfirmRes.data.error, true);
    assert.ok(failConfirmRes.data.reply.includes('MISSING_SOURCE_SUB') || failConfirmRes.data.reply.includes('failed'), 'Must report exact failing BOM');

    // Verify SHOULD_NOT_BE_ATTEMPTED was never created in target plant
    const shouldNotRes = await verifyBomInCs03({ material: 'SHOULD_NOT_BE_ATTEMPTED', plant: '1012', bomUsage: '1' });
    assert.strictEqual(shouldNotRes.exists, false, 'Remaining BOMs must not be attempted after a failure');
    console.log('   ✓ Execution halted immediately on sub-BOM failure; subsequent BOMs were not attempted');

    // -------------------------------------------------------------------------
    // TEST 10: Cycle detection: circular references detected and prevented
    // -------------------------------------------------------------------------
    console.log('\n10. Testing Cycle Detection (Circular BOM References):');
    resetMockBomDataset();
    setMockBomAlternatives('CYCLE_A', '1001', '1', ['1'], 1, [
      { item: '0010', material: 'CYCLE_B', description: 'Cycle B', quantity: '1', unit: 'EA', itemCategory: 'L', assembly: true }
    ]);
    setMockBomAlternatives('CYCLE_B', '1001', '1', ['1'], 1, [
      { item: '0010', material: 'CYCLE_A', description: 'Cycle A', quantity: '1', unit: 'EA', itemCategory: 'L', assembly: true }
    ]);

    const cycleRes = await discoverBomHierarchy({
      source: { material: 'CYCLE_A', plant: '1001', bomUsage: '1' },
      target: { material: 'CYCLE_A', plant: '1012', bomUsage: '1' }
    });

    assert.strictEqual(cycleRes.cycleDetected, true, 'Circular reference must be detected');
    assert.ok(cycleRes.copyOrder.length <= 2, 'Circular reference must not cause infinite explosion');
    console.log('   ✓ Cycle detected successfully without infinite recursion');

    // -------------------------------------------------------------------------
    // TEST 11: Max depth 5 enforcement
    // -------------------------------------------------------------------------
    console.log('\n11. Testing Max Depth 5 Enforcement:');
    resetMockBomDataset();
    // Build a 7-level chain: D0 -> D1 -> D2 -> D3 -> D4 -> D5 -> D6 -> D7
    for (let d = 0; d < 7; d++) {
      setMockBomAlternatives(`MAT_D${d}`, '1001', '1', ['1'], 1, [
        { item: '0010', material: `MAT_D${d + 1}`, description: `Depth ${d + 1}`, quantity: '1', unit: 'EA', itemCategory: 'L', assembly: true }
      ]);
    }
    setMockBomAlternatives('MAT_D7', '1001', '1', ['1'], 1, [
      { item: '0010', material: 'RAW_LEAF', description: 'Leaf', quantity: '1', unit: 'EA', itemCategory: 'L', assembly: false }
    ]);

    const depthRes = await discoverBomHierarchy({
      source: { material: 'MAT_D0', plant: '1001', bomUsage: '1' },
      target: { material: 'MAT_D0', plant: '1012', bomUsage: '1' },
      maxDepth: 5
    });

    const maxObservedDepth = depthRes.copyOrder.reduce((max, b) => Math.max(max, b.depth), 0);
    assert.ok(maxObservedDepth <= 5, `Max depth must not exceed 5 (observed: ${maxObservedDepth})`);
    console.log(`   ✓ Max depth 5 enforced (explored up to depth ${maxObservedDepth})`);

    // -------------------------------------------------------------------------
    // TEST 12: Recursive CS03 structural verification
    // -------------------------------------------------------------------------
    console.log('\n12. Testing Recursive CS03 Structural Verification:');
    resetMockBomDataset();
    const copyOrder12 = [
      {
        material: 'B1BH0214C',
        sourceMaterial: 'B1BH0214C',
        sourcePlant: '1001',
        targetPlant: '1012',
        bomUsage: '1',
        targetAlt: '1',
        depth: 1,
        components: [
          { item: '0010', material: 'RAW_EVA_01', description: 'EVA COMPOUND', quantity: '50', unit: 'KG', itemCategory: 'L', assembly: false }
        ]
      }
    ];

    setMockBomAlternatives('B1BH0214C', '1012', '1', ['1'], 1, copyOrder12[0].components);

    const verifyRes12 = await verifyHierarchyStructure({
      copyOrder: copyOrder12,
      targetPlant: '1012',
      bomUsage: '1'
    });

    assert.strictEqual(verifyRes12.match, true);
    assert.strictEqual(verifyRes12.status, 'SUCCESS');
    assert.strictEqual(verifyRes12.verifiedCount, 1);
    console.log('   ✓ Recursive CS03 verification succeeded with 100% parity across hierarchy');

    // -------------------------------------------------------------------------
    // TEST 13: Verification failure on quantity / unit / category mismatch
    // -------------------------------------------------------------------------
    console.log('\n13. Testing Verification Failure on Quantity, Unit, and Category Mismatches:');
    const sourceComps13 = [
      { item: '0010', material: 'RAW_01', quantity: '10', unit: 'KG', itemCategory: 'L', assembly: false }
    ];

    // Quantity mismatch
    const compQtyFail = compareBomStructures({
      sourceComponents: sourceComps13,
      targetComponents: [{ item: '0010', material: 'RAW_01', quantity: '25', unit: 'KG', itemCategory: 'L', assembly: false }]
    });
    assert.strictEqual(compQtyFail.match, false);
    assert.strictEqual(compQtyFail.status, 'FAILURE');
    assert.ok(compQtyFail.differences.some((d) => d.includes('Quantity mismatch')));

    // Unit mismatch
    const compUnitFail = compareBomStructures({
      sourceComponents: sourceComps13,
      targetComponents: [{ item: '0010', material: 'RAW_01', quantity: '10', unit: 'EA', itemCategory: 'L', assembly: false }]
    });
    assert.strictEqual(compUnitFail.match, false);
    assert.strictEqual(compUnitFail.status, 'FAILURE');
    assert.ok(compUnitFail.differences.some((d) => d.includes('Unit mismatch')));

    // Category mismatch
    const compCatFail = compareBomStructures({
      sourceComponents: sourceComps13,
      targetComponents: [{ item: '0010', material: 'RAW_01', quantity: '10', unit: 'KG', itemCategory: 'N', assembly: false }]
    });
    assert.strictEqual(compCatFail.match, false);
    assert.strictEqual(compCatFail.status, 'FAILURE');
    assert.ok(compCatFail.differences.some((d) => d.includes('Item category mismatch')));
    console.log('   ✓ Quantity, unit, and item category mismatches correctly rejected with status FAILURE');

    // -------------------------------------------------------------------------
    // TEST 14: Verification failure on assembly indicator mismatch
    // -------------------------------------------------------------------------
    console.log('\n14. Testing Verification Failure on Assembly Indicator Mismatch:');
    const compAsmFail = compareBomStructures({
      sourceComponents: [
        { item: '0010', material: 'SUB_01', quantity: '1', unit: 'EA', itemCategory: 'L', assembly: true }
      ],
      targetComponents: [
        { item: '0010', material: 'SUB_01', quantity: '1', unit: 'EA', itemCategory: 'L', assembly: false }
      ],
      copiedMainOnly: false
    });

    assert.strictEqual(compAsmFail.match, false);
    assert.strictEqual(compAsmFail.status, 'FAILURE');
    assert.ok(compAsmFail.differences.some((d) => d.includes('Assembly indicator mismatch')));
    console.log('   ✓ Assembly indicator mismatch rejected with status FAILURE and explicit reason');

    // -------------------------------------------------------------------------
    // TEST 15: Comprehensive audit logging for EVERY created BOM in hierarchy
    // -------------------------------------------------------------------------
    console.log('\n15. Testing Comprehensive Audit Logging (Entry for Every BOM Created):');
    resetMockBomDataset();
    auditLogger.clearAuditLogs();

    setMockBomAlternatives('AUDIT_SUB', '1001', '1', ['1'], 1, [
      { item: '0010', material: 'RAW_A', quantity: '1', unit: 'KG', itemCategory: 'L', assembly: false }
    ]);
    setMockBomAlternatives('AUDIT_MAIN', '1001', '1', ['1'], 1, [
      { item: '0010', material: 'AUDIT_SUB', quantity: '1', unit: 'EA', itemCategory: 'L', assembly: true }
    ]);

    const proposeRes15 = await makeRequest(
      'POST',
      '/api/chat',
      {
        message: 'Copy BOM from AUDIT_MAIN plant 1001 to plant 1012',
        actionType: 'copy_bom',
        copyBomParams: {
          sourceMaterial: 'AUDIT_MAIN',
          sourcePlant: '1001',
          sourceUsage: '1',
          targetMaterial: 'AUDIT_MAIN',
          targetPlant: '1012',
          targetUsage: '1'
        }
      },
      authHeaders
    );

    const actionId15 = proposeRes15.data.proposedAction.actionId;
    const confirmRes15 = await makeRequest('POST', '/api/chat', { confirmAction: actionId15 }, authHeaders);
    assert.strictEqual(confirmRes15.status, 200);

    const logs = auditLogger.getAuditLogs().filter((l) => l.actionType === 'copy_bom');
    assert.strictEqual(logs.length, 2, 'Exactly 2 audit log entries must be created (1 sub-BOM + 1 main BOM)');
    assert.ok(logs.some((l) => l.recordId === 'AUDIT_SUB'), 'Sub-BOM audit entry must exist');
    assert.ok(logs.some((l) => l.recordId === 'AUDIT_MAIN'), 'Main BOM audit entry must exist');
    console.log('   ✓ Comprehensive audit log entries recorded for every created BOM in the hierarchy');

    console.log('\n======================================================');
    console.log('✅ ALL 15 BOM HIERARCHY STRUCTURAL PRESERVATION TESTS PASSED!');
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
