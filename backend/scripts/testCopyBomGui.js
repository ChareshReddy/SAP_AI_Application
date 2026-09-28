/**
 * Dedicated test script for CS01 Copy From BOM automation workflow.
 *
 * Source:
 * - Material: A1BH0214C
 * - Plant: 1012
 * - BOM Usage: 1
 *
 * Target:
 * - Material: A1BH0214C
 * - Plant: 1002
 * - BOM Usage: 1
 */

import { copyBomViaGui, connectToSapGui, CS01_FIELD_IDS } from '../services/sapGuiClient.js';

async function main() {
  console.log('===============================================================');
  console.log('SAP GUI CS01: Copy-From BOM Automation Workflow');
  console.log('===============================================================');
  console.log('CS01 Configured Control IDs:');
  console.log('  OK_CODE            :', CS01_FIELD_IDS.OK_CODE);
  console.log('  MATERIAL           :', CS01_FIELD_IDS.MATERIAL);
  console.log('  PLANT              :', CS01_FIELD_IDS.PLANT);
  console.log('  BOM_USAGE          :', CS01_FIELD_IDS.BOM_USAGE);
  console.log('  COPY_BUTTON        :', CS01_FIELD_IDS.COPY_BUTTON);
  console.log('  COPY_REF_MATERIAL  :', CS01_FIELD_IDS.COPY_REF_MATERIAL);
  console.log('  COPY_REF_PLANT     :', CS01_FIELD_IDS.COPY_REF_PLANT);
  console.log('  COPY_REF_BOM_USAGE :', CS01_FIELD_IDS.COPY_REF_BOM_USAGE);
  console.log('  TABLE_BASE         :', CS01_FIELD_IDS.TABLE_BASE);
  console.log('  SAVE_BUTTON        :', CS01_FIELD_IDS.SAVE_BUTTON);
  console.log('  STATUS_BAR         :', CS01_FIELD_IDS.STATUS_BAR);
  console.log('---------------------------------------------------------------');

  const testParams = {
    source: {
      material: 'A1BH0214C',
      plant: '1012',
      bomUsage: '1',
      alternativeBom: ''
    },
    target: {
      material: 'A1BH0214C',
      plant: '1001',
      bomUsage: '1',
      alternativeBom: '',
      validFrom: ''
    }
  };

  console.log('Workflow Parameters:');
  console.log('  SOURCE BOM -> Material:', testParams.source.material, '| Plant:', testParams.source.plant, '| Usage:', testParams.source.bomUsage);
  console.log('  TARGET BOM -> Material:', testParams.target.material, '| Plant:', testParams.target.plant, '| Usage:', testParams.target.bomUsage);
  console.log('---------------------------------------------------------------');

  console.log('\n[1/3] Probing for active SAP GUI session...');
  const probe = await connectToSapGui(1);
  console.log('Session Status:', JSON.stringify(probe, null, 2));

  if (!probe.success) {
    console.log('\n⚠️ SAP GUI is not currently attached to an active, logged-in session.');
    console.log('Details:', probe.message);
    if (probe.rawError) console.log('Raw COM Error:', probe.rawError);
    process.exit(1);
  }

  console.log(`\n[2/3] Connected to SAP GUI (User: ${probe.user} | System: ${probe.system} | Client: ${probe.client})`);
  console.log('Executing copyBomViaGui automation...');

  const startTime = Date.now();
  const result = await copyBomViaGui(testParams);
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);

  console.log(`\n[3/3] Execution finished in ${elapsed}s:`);
  console.log(JSON.stringify(result, null, 2));

  if (result.success && result.verified) {
    console.log('\n✅ SUCCESS: BOM Copy-From workflow SUCCEEDED and was verified in CS03!');
    console.log(`Target Material: ${result.after.material} | Plant: ${result.after.plant} | Alt: ${result.after.alternativeBom}`);
    console.log(`Verified Component: ${result.after.verifiedComponent} (Qty: ${result.after.verifiedQty}, Cat: ${result.after.verifiedItemCategory})`);
    console.log(`Total Copied Items: ${result.after.components?.length || 0}`);
    console.log('Captured SAP Control IDs:', JSON.stringify(result.capturedControls, null, 2));
  } else {
    console.log(`\n❌ WORKFLOW FAILED: [${result.code}] ${result.message}`);
  }
}

main().catch((err) => {
  console.error('Fatal execution error:', err);
  process.exit(1);
});
