/**
 * Automated end-to-end test for CS01 BOM creation and CS03 post-save verification
 *
 * Target:
 * Material: BOLT13430
 * Plant: 1000
 * BOM Usage: 1
 * Alternative BOM: 3 (since 1 and 2 were previously created)
 * Component: BOLT36010, Qty: 1, Item Category: L
 */

import { createBomViaGui, connectToSapGui, verifyBomInCs03, CS01_FIELD_IDS } from '../services/sapGuiClient.js';

async function runTest() {
  console.log('===============================================================');
  console.log('SAP GUI Scripting: CS01 BOM Creation & CS03 Verification Test');
  console.log('===============================================================');
  console.log('Field IDs configured:');
  console.log(JSON.stringify(CS01_FIELD_IDS, null, 2));
  console.log('---------------------------------------------------------------');

  console.log('\n[1/4] Probing for active SAP GUI session...');
  const sessionCheck = await connectToSapGui();
  console.log('Session Status:', JSON.stringify(sessionCheck, null, 2));

  if (!sessionCheck.success) {
    console.log('\n⚠️ SAP GUI is not currently open and logged into an SAP system.');
    console.log('Action: Please open SAP GUI, log into system A4H (client 800), and run:');
    console.log('   node scripts/testRealBomVerification.js\n');
    process.exit(1);
  }

  console.log(`\n[2/4] Connected to SAP GUI (User: ${sessionCheck.user} | System: ${sessionCheck.system} | Client: ${sessionCheck.client})`);

  // Step 3: Inspect existing BOM 00000119 (BOLT13430, Plant 1000, Alt BOM 1 or 2)
  console.log('\n[3/4] Verifying empty BOM behavior in CS03 on previously created BOM (Alternative 1)...');
  const prevBomCheck = await verifyBomInCs03({
    material: 'BOLT13430',
    plant: '1000',
    bomUsage: '1',
    alternativeBom: '1'
  });
  console.log('CS03 inspection of Alternative 1:');
  console.log(JSON.stringify(prevBomCheck, null, 2));

  // Step 4: Execute creation with Alternative BOM 3 and verify
  console.log('\n[4/4] Executing createBomViaGui with explicit delays, row commit, and CS03 verification:');
  console.log('Parameters: Material=BOLT13430, Plant=1000, Usage=1, AltBOM=3, Component=BOLT36010, Qty=1');

  const payload = {
    material: 'BOLT13430',
    plant: '1000',
    bomUsage: '1',
    alternativeBom: '3',
    components: [
      { component: 'BOLT36010', quantity: 1, itemCategory: 'L' }
    ]
  };

  const startTime = Date.now();
  const result = await createBomViaGui(payload);
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);

  console.log(`\nResult after ${elapsed}s:`);
  console.log(JSON.stringify(result, null, 2));

  if (result.success && result.verified) {
    console.log('\n✅ SUCCESS: BOM creation SUCCEEDED and component row was explicitly VERIFIED in CS03!');
    console.log(`Verified Component: ${result.after.verifiedComponent}`);
    console.log(`Verified Quantity: ${result.after.verifiedQty}`);
  } else {
    console.log(`\n❌ FAILED: [${result.code}] ${result.message}`);
  }
}

runTest().catch((err) => {
  console.error('Fatal Test Exception:', err);
  process.exit(1);
});
