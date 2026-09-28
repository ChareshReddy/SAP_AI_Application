import assert from 'assert';
import http from 'http';
import app from '../server.js';
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

async function runSourceBomValidationTests() {
  console.log('\n======================================================');
  console.log('--- Starting Source BOM Validation & Gates Test Suite ---');
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
    // 1. Valid source BOM
    console.log('\n1. Testing Valid Source BOM (A1BH0214C, Plant 1001, Usage 1, Alt 1):');
    const validRes = await makeRequest('POST', '/api/bom/validate-source', {
      material: 'A1BH0214C',
      plant: '1001',
      bomUsage: '1',
      alternativeBom: '1'
    });
    assert.strictEqual(validRes.status, 200);
    assert.strictEqual(validRes.data.success, true);
    assert.strictEqual(validRes.data.materialExists, true);
    assert.strictEqual(validRes.data.plantValid, true);
    assert.strictEqual(validRes.data.bomExists, true);
    assert.strictEqual(validRes.data.alternativeValid, true);
    assert.strictEqual(validRes.data.componentCount, 16);
    console.log('   ✓ Valid source BOM validated successfully with 16 components');

    // 2. Material does not exist
    console.log('\n2. Testing Material Does Not Exist:');
    const noMatRes = await makeRequest('POST', '/api/bom/validate-source', {
      material: 'NON_EXISTENT_MATERIAL',
      plant: '1001',
      bomUsage: '1'
    });
    assert.strictEqual(noMatRes.status, 200);
    assert.strictEqual(noMatRes.data.success, false);
    assert.strictEqual(noMatRes.data.errorCode, 'MATERIAL_NOT_FOUND');
    assert.match(noMatRes.data.message, /does not exist or is not activated/i);
    console.log('   ✓ Non-existent material rejected with MATERIAL_NOT_FOUND');

    // 3. Material exists but BOM does not exist in requested plant
    console.log('\n3. Testing Material exists but BOM does not exist in requested plant (1012):');
    const noBomRes = await makeRequest('POST', '/api/bom/validate-source', {
      material: 'A1BH0214C',
      plant: '1012',
      bomUsage: '1'
    });
    assert.strictEqual(noBomRes.status, 200);
    assert.strictEqual(noBomRes.data.success, false);
    assert.strictEqual(noBomRes.data.errorCode, 'BOM_NOT_FOUND');
    assert.match(noBomRes.data.message, /No BOM exists for material A1BH0214C in plant 1012 with BOM usage 1/i);
    console.log('   ✓ Missing BOM in requested plant rejected with BOM_NOT_FOUND');

    // 4. Wrong plant must NOT fall back to another plant
    console.log('\n4. Testing Wrong Plant NO Fallback Rule:');
    // Ensure that even though A1BH0214C has a BOM in plant 1001, validating plant 1012 strictly returns failure
    assert.notStrictEqual(noBomRes.data.success, true);
    assert.strictEqual(noBomRes.data.errorCode, 'BOM_NOT_FOUND');
    console.log('   ✓ Confirmed: validation never silently fell back to plant 1001');

    // 5. Valid specific Alternative BOM
    console.log('\n5. Testing Valid Specific Alternative BOM (Alt 2):');
    const alt2Res = await makeRequest('POST', '/api/bom/validate-source', {
      material: 'A1BH0214C',
      plant: '1001',
      bomUsage: '1',
      alternativeBom: '2'
    });
    assert.strictEqual(alt2Res.status, 200);
    assert.strictEqual(alt2Res.data.success, true);
    assert.strictEqual(alt2Res.data.alternativeValid, true);
    assert.ok(alt2Res.data.availableAlternatives.includes('2'));
    console.log('   ✓ Valid specific alternative BOM (Alt 2) confirmed');

    // 6. Invalid Alternative BOM
    console.log('\n6. Testing Invalid Alternative BOM (Alt 9):');
    const alt9Res = await makeRequest('POST', '/api/bom/validate-source', {
      material: 'A1BH0214C',
      plant: '1001',
      bomUsage: '1',
      alternativeBom: '9'
    });
    assert.strictEqual(alt9Res.status, 200);
    assert.strictEqual(alt9Res.data.success, false);
    assert.strictEqual(alt9Res.data.errorCode, 'ALTERNATIVE_NOT_FOUND');
    assert.deepStrictEqual(alt9Res.data.availableAlternatives, ['1', '2', '3', '4']);
    assert.match(alt9Res.data.message, /Alternative BOM 9 does not exist/i);
    console.log('   ✓ Invalid alternative BOM rejected with ALTERNATIVE_NOT_FOUND');

    // 7. No Alternative BOM supplied (determines available alternatives)
    console.log('\n7. Testing No Alternative BOM supplied:');
    const noAltRes = await makeRequest('POST', '/api/bom/validate-source', {
      material: 'A1BH0214C',
      plant: '1001',
      bomUsage: '1',
      alternativeBom: ''
    });
    assert.strictEqual(noAltRes.status, 200);
    assert.strictEqual(noAltRes.data.success, true);
    assert.strictEqual(noAltRes.data.bomExists, true);
    assert.deepStrictEqual(noAltRes.data.availableAlternatives, ['1', '2', '3', '4']);
    assert.strictEqual(noAltRes.data.componentCount, 16);
    console.log('   ✓ Succeeded and correctly enumerated available alternatives: [1, 2, 3, 4]');

    // 8. Source = Target rejection rule
    console.log('\n8. Testing Source = Target rejection rule:');
    const sameRes = await makeRequest('POST', '/api/chat', {
      actionType: 'copy_bom',
      copyBomParams: {
        sourceMaterial: 'A1BH0214C',
        sourcePlant: '1001',
        sourceUsage: '1',
        sourceAltBom: '1',
        targetMaterial: 'A1BH0214C',
        targetPlant: '1001',
        targetUsage: '1',
        targetAltBom: '1',
        validFrom: '27.09.2026'
      }
    }, authHeaders);
    assert.strictEqual(sameRes.status, 200);
    assert.strictEqual(sameRes.data.error, true);
    assert.match(sameRes.data.reply, /Source and target BOM are the same\. A BOM cannot be copied onto itself\./i);
    console.log('   ✓ Enforced: Identical source and target BOM rejected');

    // 9. SAP GUI session unavailable
    console.log('\n9. Testing SAP GUI session unavailable:');
    process.env.TEST_SIMULATE_NO_SESSION = 'true';
    const noSessionRes = await makeRequest('POST', '/api/bom/validate-source', {
      material: 'A1BH0214C',
      plant: '1001',
      bomUsage: '1'
    });
    delete process.env.TEST_SIMULATE_NO_SESSION;
    assert.strictEqual(noSessionRes.status, 200);
    assert.strictEqual(noSessionRes.data.success, false);
    assert.strictEqual(noSessionRes.data.errorCode, 'SAP_SESSION_NOT_FOUND');
    assert.match(noSessionRes.data.message, /No active SAP GUI session found/i);
    console.log('   ✓ Handled SAP_SESSION_NOT_FOUND properly');

    // 10. SAP GUI temporarily busy
    console.log('\n10. Testing SAP GUI temporarily busy:');
    process.env.TEST_SIMULATE_BUSY = 'true';
    const busyRes = await makeRequest('POST', '/api/bom/validate-source', {
      material: 'A1BH0214C',
      plant: '1001',
      bomUsage: '1'
    });
    delete process.env.TEST_SIMULATE_BUSY;
    assert.strictEqual(busyRes.status, 200);
    assert.strictEqual(busyRes.data.success, false);
    assert.strictEqual(busyRes.data.errorCode, 'SAP_VALIDATION_ERROR');
    assert.match(busyRes.data.message, /session is temporarily busy/i);
    console.log('   ✓ Handled SAP GUI busy state gracefully');

    // 11. Successful validation allows Create BOM to continue
    console.log('\n11. Testing Successful Validation allows Create BOM proposal:');
    const validProposalRes = await makeRequest('POST', '/api/chat', {
      actionType: 'copy_bom',
      copyBomParams: {
        sourceMaterial: 'A1BH0214C',
        sourcePlant: '1001',
        sourceUsage: '1',
        sourceAltBom: '2',
        targetMaterial: 'A1BH0214C',
        targetPlant: '1012',
        targetUsage: '1',
        targetAltBom: '2',
        validFrom: '27.09.2026'
      }
    }, authHeaders);
    assert.strictEqual(validProposalRes.status, 200);
    assert.strictEqual(validProposalRes.data.error, false);
    assert.ok(validProposalRes.data.proposedAction);
    assert.strictEqual(validProposalRes.data.proposedAction.type, 'copy_bom');
    const pendingAction = pendingActionStore.getPendingAction(validProposalRes.data.proposedAction.actionId);
    assert.ok(pendingAction);
    console.log('   ✓ Verified: Proposal created and waiting at human confirmation gate');

    // 12. Failed validation blocks Create BOM
    console.log('\n12. Testing Failed Validation blocks Create BOM execution:');
    const blockedProposalRes = await makeRequest('POST', '/api/chat', {
      actionType: 'copy_bom',
      copyBomParams: {
        sourceMaterial: 'A1BH0214C',
        sourcePlant: '1012',
        sourceUsage: '1',
        sourceAltBom: '1',
        targetMaterial: 'A1BH0214C',
        targetPlant: '1001',
        targetUsage: '1',
        targetAltBom: '1',
        validFrom: '27.09.2026'
      }
    }, authHeaders);
    assert.strictEqual(blockedProposalRes.status, 200);
    assert.strictEqual(blockedProposalRes.data.error, true);
    assert.strictEqual(blockedProposalRes.data.proposedAction, null);
    assert.match(blockedProposalRes.data.reply, /Cannot copy BOM: No BOM exists/i);
    console.log('   ✓ Verified: Failed validation strictly blocks Create BOM proposal');

    // 13. Test that Proceed works without clicking "Validate BOM" (Optional UI validation skipped)
    console.log('\n13. Testing Proceed works without clicking "Validate BOM" (Optional UI button skipped):');
    const proceedWithoutValidateRes = await makeRequest('POST', '/api/chat', {
      actionType: 'copy_bom',
      copyBomParams: {
        sourceMaterial: 'A1BH0214C',
        sourcePlant: '1001',
        sourceUsage: '1',
        sourceAltBom: '',
        targetMaterial: 'A1BH0214C',
        targetPlant: '1012',
        targetUsage: '1',
        targetAltBom: '',
        validFrom: '27.09.2026'
      }
    }, authHeaders);
    assert.strictEqual(proceedWithoutValidateRes.status, 200);
    assert.strictEqual(proceedWithoutValidateRes.data.error, false);
    assert.ok(proceedWithoutValidateRes.data.proposedAction);
    assert.strictEqual(proceedWithoutValidateRes.data.proposedAction.type, 'copy_bom');
    console.log('   ✓ Verified: Proceed succeeded directly without prior UI validation button click');

    // 14. Test that clicking "Validate BOM (Optional)" still performs the SAP validation
    console.log('\n14. Testing clicking "Validate BOM (Optional)" still performs SAP CS03 validation:');
    const clickValidateRes = await makeRequest('POST', '/api/bom/validate-source', {
      material: 'A1BH0214C',
      plant: '1001',
      bomUsage: '1',
      alternativeBom: '3'
    });
    assert.strictEqual(clickValidateRes.status, 200);
    assert.strictEqual(clickValidateRes.data.success, true);
    assert.strictEqual(clickValidateRes.data.alternativeValid, true);
    assert.strictEqual(clickValidateRes.data.componentCount, 16);
    console.log('   ✓ Verified: Optional validation button still performs full SAP verification');

    // 15. Test that failed optional validation does not leave stale validation state
    console.log('\n15. Testing failed optional validation followed by updated valid query clears stale state:');
    const failedInitialCheck = await makeRequest('POST', '/api/bom/validate-source', {
      material: 'A1BH0214C',
      plant: '1012',
      bomUsage: '1'
    });
    assert.strictEqual(failedInitialCheck.data.success, false);
    assert.strictEqual(failedInitialCheck.data.errorCode, 'BOM_NOT_FOUND');

    // User updates field to plant 1001 and validates again
    const updatedCheck = await makeRequest('POST', '/api/bom/validate-source', {
      material: 'A1BH0214C',
      plant: '1001',
      bomUsage: '1'
    });
    assert.strictEqual(updatedCheck.data.success, true);
    assert.strictEqual(updatedCheck.data.errorCode, undefined);
    assert.strictEqual(updatedCheck.data.bomExists, true);
    console.log('   ✓ Verified: Fresh validation query cleanly resets and does not retain stale error');

    // 16. Test that backend execution still rejects an invalid/non-existent source BOM when user skips optional button
    console.log('\n16. Testing backend execution strictly rejects invalid source BOM even when optional button was skipped:');
    const bypassAttemptRes = await makeRequest('POST', '/api/chat', {
      actionType: 'copy_bom',
      copyBomParams: {
        sourceMaterial: 'A1BH0214C',
        sourcePlant: '1002', // Not maintained in plant 1002
        sourceUsage: '1',
        sourceAltBom: '',
        targetMaterial: 'A1BH0214C',
        targetPlant: '1001',
        targetUsage: '1',
        targetAltBom: '',
        validFrom: '27.09.2026'
      }
    }, authHeaders);
    assert.strictEqual(bypassAttemptRes.status, 200);
    assert.strictEqual(bypassAttemptRes.data.error, true);
    assert.strictEqual(bypassAttemptRes.data.proposedAction, null);
    assert.match(bypassAttemptRes.data.reply, /Cannot copy BOM/i);
    console.log('   ✓ Verified: Backend security gate prevented bypass of source BOM validation');

    console.log('\n======================================================');
    console.log('✅ ALL 16 SOURCE BOM VALIDATION TESTS PASSED!');
    console.log('======================================================\n');
  } finally {
    server.close();
  }
}

runSourceBomValidationTests().catch((err) => {
  console.error('Test suite failed:', err);
  if (server) server.close();
  process.exit(1);
});
