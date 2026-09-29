import assert from 'assert';
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
  getMockBomDataset
} from '../services/sapGuiClient.js';

async function runDiscrepancyFixTests() {
  console.log('\n======================================================');
  console.log('--- Starting 605-Discrepancy Root Cause Verification Test Suite ---');
  console.log('======================================================\n');

  process.env.USE_MOCK_SAP = 'true';

  // ---------------------------------------------------------------------------
  // TEST 1: existing target Alt 1 -> new copy goes to Alt 2
  // ---------------------------------------------------------------------------
  console.log('1. Proving: existing target Alt 1 -> new copy goes to Alt 2');
  resetMockBomDataset();
  const altT1 = resolveNextAvailableAlternative(['1'], '');
  assert.strictEqual(altT1, '2', 'When target has Alt 1, next alternative must resolve to 2');

  setMockBomAlternatives('MAT_ALT1_EXIST', '1012', '1', ['1'], 1, [
    { item: '0010', material: 'OLD_COMP_1', quantity: '10', unit: 'KG', itemCategory: 'L', assembly: false }
  ]);
  setMockBomAlternatives('MAT_ALT1_EXIST', '1001', '1', ['1'], 1, [
    { item: '0010', material: 'NEW_COMP_1', quantity: '20', unit: 'KG', itemCategory: 'L', assembly: false }
  ]);

  const copyRes1 = await copyBomViaGui({
    source: { material: 'MAT_ALT1_EXIST', plant: '1001', bomUsage: '1' },
    target: { material: 'MAT_ALT1_EXIST', plant: '1012', bomUsage: '1' }
  });
  assert.strictEqual(copyRes1.success, true);
  assert.strictEqual(copyRes1.after.alternativeBom, '2', 'Copy must be created under Alternative 2');

  const checkAlt1 = await verifyBomInCs03({ material: 'MAT_ALT1_EXIST', plant: '1012', bomUsage: '1', alternativeBom: '1' });
  assert.strictEqual(checkAlt1.components[0].material, 'OLD_COMP_1', 'Alternative 1 must remain untouched');

  const checkAlt2 = await verifyBomInCs03({ material: 'MAT_ALT1_EXIST', plant: '1012', bomUsage: '1', alternativeBom: '2' });
  assert.strictEqual(checkAlt2.components[0].material, 'NEW_COMP_1', 'Alternative 2 must contain new components');
  console.log('   ✓ PROVEN: Existing target Alt 1 preserved; new copy created under Alt 2.\n');

  // ---------------------------------------------------------------------------
  // TEST 2: existing Alt 1/2/3 -> new copy goes to Alt 4
  // ---------------------------------------------------------------------------
  console.log('2. Proving: existing Alt 1/2/3 -> new copy goes to Alt 4');
  resetMockBomDataset();
  const altT2 = resolveNextAvailableAlternative(['1', '2', '3'], '');
  assert.strictEqual(altT2, '4', 'When target has Alt 1, 2, 3, next alternative must resolve to 4');

  setMockBomAlternatives('MAT_ALT3_EXIST', '1012', '1', ['1', '2', '3'], 1, [
    { item: '0010', material: 'OLD_COMP_3', quantity: '10', unit: 'KG', itemCategory: 'L', assembly: false }
  ]);
  setMockBomAlternatives('MAT_ALT3_EXIST', '1001', '1', ['1'], 1, [
    { item: '0010', material: 'NEW_COMP_4', quantity: '40', unit: 'KG', itemCategory: 'L', assembly: false }
  ]);

  const copyRes2 = await copyBomViaGui({
    source: { material: 'MAT_ALT3_EXIST', plant: '1001', bomUsage: '1' },
    target: { material: 'MAT_ALT3_EXIST', plant: '1012', bomUsage: '1' }
  });
  assert.strictEqual(copyRes2.success, true);
  assert.strictEqual(copyRes2.after.alternativeBom, '4', 'Copy must be created under Alternative 4');

  const checkAlt4 = await verifyBomInCs03({ material: 'MAT_ALT3_EXIST', plant: '1012', bomUsage: '1', alternativeBom: '4' });
  assert.strictEqual(checkAlt4.exists, true);
  assert.strictEqual(checkAlt4.components[0].material, 'NEW_COMP_4');
  console.log('   ✓ PROVEN: Existing target Alt 1/2/3 preserved; new copy created under Alt 4.\n');

  // ---------------------------------------------------------------------------
  // TEST 3: existing child BOM is never reused
  // ---------------------------------------------------------------------------
  console.log('3. Proving: existing child BOM is never reused or skipped');
  resetMockBomDataset();
  // Parent in source
  setMockBomAlternatives('PARENT_HIER', '1001', '1', ['1'], 1, [
    { item: '0010', material: 'CHILD_ASM', quantity: '1', unit: 'EA', itemCategory: 'L', assembly: true }
  ]);
  // Child in source (has RAW_FROM_SOURCE)
  setMockBomAlternatives('CHILD_ASM', '1001', '1', ['1'], 1, [
    { item: '0010', material: 'RAW_FROM_SOURCE', quantity: '5.5', unit: 'KG', itemCategory: 'L', assembly: false }
  ]);
  // Pre-existing legacy child BOM in target plant 1012 (has RAW_LEGACY_TARGET)
  setMockBomAlternatives('CHILD_ASM', '1012', '1', ['1'], 1, [
    { item: '0010', material: 'RAW_LEGACY_TARGET', quantity: '99', unit: 'KG', itemCategory: 'L', assembly: false }
  ]);

  const copyHierarchyRes = await copyBomHierarchyWithRepair({
    source: { material: 'PARENT_HIER', plant: '1001', bomUsage: '1' },
    target: { material: 'PARENT_HIER', plant: '1012', bomUsage: '1' }
  });

  assert.strictEqual(copyHierarchyRes.success, true);
  assert.strictEqual(copyHierarchyRes.totalBomsCreated, 2, 'Must create both Parent and Child BOMs');

  // Verify that CHILD_ASM Alternative 1 in target plant 1012 was NOT overwritten or reused
  const targetChildAlt1 = await verifyBomInCs03({ material: 'CHILD_ASM', plant: '1012', bomUsage: '1', alternativeBom: '1' });
  assert.strictEqual(targetChildAlt1.exists, true);
  assert.strictEqual(targetChildAlt1.components[0].material, 'RAW_LEGACY_TARGET', 'Legacy Alternative 1 must remain untouched');

  // Verify that CHILD_ASM was copied into Alternative 2 in target plant 1012
  const targetChildAlt2 = await verifyBomInCs03({ material: 'CHILD_ASM', plant: '1012', bomUsage: '1', alternativeBom: '2' });
  assert.strictEqual(targetChildAlt2.exists, true);
  assert.strictEqual(targetChildAlt2.components[0].material, 'RAW_FROM_SOURCE', 'Alternative 2 must contain source components');
  console.log('   ✓ PROVEN: Existing child BOM Alt 1 is never reused/overwritten; copied as Alt 2.\n');

  // ---------------------------------------------------------------------------
  // TEST 4: exact created alternative is propagated into recursive verification
  // ---------------------------------------------------------------------------
  console.log('4. Proving: exact created alternative is propagated into recursive verification');
  // Check copyHierarchyRes from Test 3
  const childRecord = copyHierarchyRes.createdBoms.find((b) => b.material === 'CHILD_ASM');
  assert.ok(childRecord, 'CHILD_ASM must be in createdBoms');
  assert.strictEqual(childRecord.targetAlternative, '2', 'Child target alternative must be recorded as 2');
  assert.strictEqual(childRecord.alternativeBom, '2', 'Child alternativeBom must be recorded as 2');

  const verifiedChild = copyHierarchyRes.verification.verifiedBoms.find((b) => b.material === 'CHILD_ASM');
  assert.ok(verifiedChild, 'CHILD_ASM must be in verifiedBoms');
  assert.strictEqual(verifiedChild.alternativeBom, '2', 'Recursive verification must verify Alternative 2, not default Alt 1');
  assert.strictEqual(copyHierarchyRes.verification.match, true, 'Verification must succeed with 100% parity');
  console.log('   ✓ PROVEN: Exact created alternative (Alt 2) was verified recursively with 0 discrepancies.\n');

  // ---------------------------------------------------------------------------
  // TEST 5: source/target component order can differ without producing false mismatches
  // ---------------------------------------------------------------------------
  console.log('5. Proving: source/target component order can differ without producing false material mismatches');
  const srcCompsReordered = [
    { item: '0010', material: 'MAT_ALPHA', description: 'Alpha', quantity: '10.0', unit: 'KG', itemCategory: 'L', assembly: false },
    { item: '0020', material: 'MAT_BETA', description: 'Beta', quantity: '20.0', unit: 'KG', itemCategory: 'L', assembly: false },
    { item: '0030', material: 'MAT_GAMMA', description: 'Gamma', quantity: '30.0', unit: 'KG', itemCategory: 'L', assembly: false }
  ];

  // Target has exact same components in reverse order and with different POSNR
  const tgtCompsReordered = [
    { item: '0010', material: 'MAT_GAMMA', description: 'Gamma', quantity: '30.0', unit: 'KG', itemCategory: 'L', assembly: false },
    { item: '0020', material: 'MAT_ALPHA', description: 'Alpha', quantity: '10.0', unit: 'KG', itemCategory: 'L', assembly: false },
    { item: '0030', material: 'MAT_BETA', description: 'Beta', quantity: '20.0', unit: 'KG', itemCategory: 'L', assembly: false }
  ];

  const orderCompareRes = compareBomStructures({
    sourceComponents: srcCompsReordered,
    targetComponents: tgtCompsReordered
  });

  assert.strictEqual(orderCompareRes.match, true, 'Different order must NOT produce mismatch');
  assert.strictEqual(orderCompareRes.differences.length, 0, 'Must have 0 differences when materials and quantities match');
  console.log('   ✓ PROVEN: Source and target component order differences produce 0 false mismatches.\n');

  // ---------------------------------------------------------------------------
  // TEST 6: same material with different POSNR is considered the same component
  // ---------------------------------------------------------------------------
  console.log('6. Proving: same material with different POSNR is considered the same component (exact H1SOTAN0031 scenario)');
  // Exact scenario from the live investigation:
  // Source has Calcium Carbonate at 0020 and Natural Rubber at 0120
  // Target has Natural Rubber at 0020 and Calcium Carbonate at 0110
  const srcLiveScenario = [
    { item: '0010', material: '11021483', quantity: '26.500', unit: 'KG', itemCategory: 'L', assembly: false },
    { item: '0020', material: '11021328', quantity: '49.700', unit: 'KG', itemCategory: 'L', assembly: false }, // CALCIUM CARBONATE
    { item: '0030', material: '11021495', quantity: '13.400', unit: 'KG', itemCategory: 'L', assembly: false }, // ALUMINIUM SILICATE
    { item: '0110', material: '11021487', quantity: '0.880', unit: 'KG', itemCategory: 'L', assembly: false },  // DCP
    { item: '0120', material: '11021480', quantity: '16.000', unit: 'KG', itemCategory: 'L', assembly: false }  // NATURAL RUBBER
  ];

  const tgtLiveScenario = [
    { item: '0010', material: '11021483', quantity: '26.500', unit: 'KG', itemCategory: 'L', assembly: false },
    { item: '0020', material: '11021480', quantity: '16.000', unit: 'KG', itemCategory: 'L', assembly: false }, // NATURAL RUBBER at 0020
    { item: '0030', material: '11021487', quantity: '0.880', unit: 'KG', itemCategory: 'L', assembly: false },  // DCP at 0030
    { item: '0110', material: '11021328', quantity: '49.700', unit: 'KG', itemCategory: 'L', assembly: false }, // CALCIUM CARBONATE at 0110
    { item: '0140', material: '11021495', quantity: '13.400', unit: 'KG', itemCategory: 'L', assembly: false }  // ALUMINIUM SILICATE at 0140
  ];

  const posnrCompareRes = compareBomStructures({
    sourceComponents: srcLiveScenario,
    targetComponents: tgtLiveScenario
  });

  assert.strictEqual(posnrCompareRes.match, true, 'Same components with different POSNR must match 100%');
  assert.strictEqual(posnrCompareRes.differences.length, 0, 'No material mismatches should be reported');
  const falseMismatchFound = posnrCompareRes.differences.some((d) => d.includes('Material mismatch at Item 0020'));
  assert.strictEqual(falseMismatchFound, false, 'Must NOT produce false mismatch comparing 11021328 against 11021480 at Item 0020');
  console.log('   ✓ PROVEN: Same materials with differing POSNR match with 0 differences; no false mismatches at Item 0020.\n');

  console.log('======================================================');
  console.log('✅ ALL 6 DISCREPANCY ROOT-CAUSE UNIT TESTS PASSED!');
  console.log('======================================================\n');
}

runDiscrepancyFixTests().catch((err) => {
  console.error('\n❌ Discrepancy test suite failed:', err);
  process.exit(1);
});
