/**
 * Test script for SG22 BOM creation via SAP GUI Scripting
 * Verifies both fixes:
 * 1. Proper JSON error message without broken VBS code if an error occurs.
 * 2. Proper handling/dismissal of the "BOM already exists" / Alternative BOM popup on screen 0100.
 *
 * Target:
 * Material: SG22
 * Plant: 1710
 * BOM Usage: 1
 * Component: SG21, Qty: 1, Item Category: L
 */

import { createBomViaGui, connectToSapGui, verifyBomInCs03, CS01_FIELD_IDS } from '../services/sapGuiClient.js';

async function runTest() {
  console.log('===============================================================');
  console.log('Testing SG22 BOM Creation & Error Handling / Popup Handling');
  console.log('===============================================================');

  console.log('\n[1/3] Probing for active SAP GUI session...');
  const sessionCheck = await connectToSapGui();
  console.log('Session Status:', JSON.stringify(sessionCheck, null, 2));

  if (!sessionCheck.success) {
    console.log('\n⚠️ SAP GUI is not currently open and logged into an SAP system.');
    console.log('Action: Please open SAP GUI, log into system A4H (client 800), and run:');
    console.log('   node scripts/testSg22Bom.js\n');
    process.exit(1);
  }

  console.log(`\n[2/3] Connected to SAP GUI (User: ${sessionCheck.user} | System: ${sessionCheck.system} | Client: ${sessionCheck.client})`);

  console.log('\n[3/3] Executing createBomViaGui for SG22 (Plant 1710, Component SG21)...');
  const payload = {
    material: 'SG22',
    plant: '1710',
    bomUsage: '1',
    // alternativeBom is omitted so SAP automatically creates the next alternative (e.g. Alt 2)
    components: [
      { component: 'SG21', quantity: 1, itemCategory: 'L' }
    ]
  };

  const startTime = Date.now();
  const result = await createBomViaGui(payload);
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);

  console.log(`\nExecution finished in ${elapsed}s:`);
  console.log(JSON.stringify(result, null, 2));

  if (result.success && result.verified) {
    console.log('\n✅ SUCCESS: BOM creation SUCCEEDED and was verified in CS03!');
    console.log(`BOM Number: ${result.bomNumber}`);
    console.log(`Alternative BOM: ${result.after.alternativeBom}`);
    console.log(`Verified Component: ${result.after.verifiedComponent} (Qty: ${result.after.verifiedQty})`);
  } else {
    console.log(`\nResult Status: FAILED`);
    console.log(`Code: ${result.code}`);
    console.log(`Message: ${result.message}`);
    // Check if broken VBS code exists
    if (result.message && (result.message.includes('Replace(') || result.message.includes('&') || result.message.includes('""'))) {
      console.log('❌ CRITICAL: Raw VBS code detected in error message!');
    } else {
      console.log('✅ Error message is clean and readable (no broken VBS code)!');
    }
  }
}

runTest().catch((err) => {
  console.error('Fatal Test Exception:', err);
  process.exit(1);
});
