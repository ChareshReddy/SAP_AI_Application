/**
 * Automated end-to-end test for CS01 BOM creation via SAP GUI Scripting
 *
 * Target:
 * Material: SG30
 * Plant: 1710
 * BOM Usage: 1
 * Component: SG21, Qty: 1, Item Category: L
 */

import { createBomViaGui, connectToSapGui, CS01_FIELD_IDS } from '../services/sapGuiClient.js';

async function runTest() {
  console.log('===============================================================');
  console.log('SAP GUI Scripting: CS01 Automated BOM Creation Test');
  console.log('===============================================================');
  console.log('Configured Field IDs:', CS01_FIELD_IDS);
  console.log('---------------------------------------------------------------');

  console.log('\n[1/2] Probing for active SAP GUI session...');
  const sessionCheck = await connectToSapGui();
  console.log('Session Status:', JSON.stringify(sessionCheck, null, 2));

  if (!sessionCheck.success) {
    console.log('\n⚠️ SAP GUI is not currently open and logged into an SAP system.');
    console.log('Action: Please open SAP GUI, connect to your system (A4H), log in, and re-run this script:');
    console.log('   node scripts/testRealBomGui.js');
    process.exit(1);
  }

  console.log(`\n[2/2] Connected to User: ${sessionCheck.user} | System: ${sessionCheck.system} | Client: ${sessionCheck.client}`);
  console.log('Executing automated CS01 BOM creation...');

  const testPayload = {
    material: 'SG30',
    plant: '1710',
    bomUsage: '1',
    components: [
      { component: 'SG21', quantity: 1, itemCategory: 'L' }
    ]
  };

  const startTime = Date.now();
  const result = await createBomViaGui(testPayload);
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);

  console.log(`\nExecution finished in ${elapsed}s:`);
  console.log(JSON.stringify(result, null, 2));

  if (result.success) {
    console.log('\n✅ CS01 BOM creation SUCCEEDED completely without manual intervention!');
  } else {
    console.log(`\n❌ CS01 BOM creation failed: [${result.code}] ${result.message}`);
  }
}

runTest().catch((err) => {
  console.error('Fatal Test Exception:', err);
  process.exit(1);
});
