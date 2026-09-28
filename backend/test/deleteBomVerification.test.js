import assert from 'assert';
import http from 'http';
import app from '../server.js';
import {
  deleteBomViaGui,
  verifyBomInCs03,
  setMockBomAlternatives,
  resetMockBomDataset
} from '../services/sapGuiClient.js';

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

async function runDeleteBomVerificationTests() {
  console.log('\n======================================================');
  console.log('--- Starting Delete BOM Verification & Protection Test Suite ---');
  console.log('======================================================');

  process.env.USE_MOCK_SAP = 'true';
  process.env.OPENROUTER_API_KEY = 'test_key';
  process.env.OPENROUTER_MODEL = 'test_model';

  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  baseUrl = `http://127.0.0.1:${port}`;

  // Log in to obtain authenticated cookie
  const loginRes = await makeRequest('POST', '/api/auth/login', {
    username: 'LEELAM_EXT',
    password: 'MockPassword123!'
  });
  const cookie = loginRes.headers['set-cookie']?.[0]?.split(';')[0] || '';
  const authHeaders = { Cookie: cookie };

  try {
    const testMaterial = 'A1BH0214C';
    const testPlant = '1001';
    const testUsage = '1';

    // Initial Setup: Alt 1, 2, 3, 4, 5, 6, 7
    console.log('\nSetup: Initializing mock BOM with Alternatives 1, 2, 3, 4, 5, 6, 7...');
    setMockBomAlternatives(testMaterial, testPlant, testUsage, ['1', '2', '3', '4', '5', '6', '7'], 16);

    const initialCs03 = await verifyBomInCs03({
      material: testMaterial,
      plant: testPlant,
      bomUsage: testUsage
    });
    assert.strictEqual(initialCs03.success, true);
    assert.strictEqual(initialCs03.exists, true);
    assert.deepStrictEqual(initialCs03.availableAlternatives, ['1', '2', '3', '4', '5', '6', '7']);
    console.log('   ✓ Initial state verified in CS03: Alternatives 1, 2, 3, 4, 5, 6, 7 exist');

    // -----------------------------------------------------------------
    // TEST STEP 1: Delete Alt 7 and verify it is gone
    // -----------------------------------------------------------------
    console.log('\nStep 1: Deleting Alternative BOM 7 and verifying deletion via CS03...');
    const delete7Result = await deleteBomViaGui({
      material: testMaterial,
      plant: testPlant,
      alternativeBom: '7',
      bomUsage: testUsage
    });

    assert.strictEqual(delete7Result.success, true, 'Delete operation must succeed');
    assert.strictEqual(delete7Result.verified, true, 'Deletion must be verified via CS03');
    assert.strictEqual(delete7Result.alternativeBom, '7');
    console.log('   ✓ deleteBomViaGui returned success=true and verified=true');

    // Post-delete verification in CS03: Alt 7 must be confirmed absent
    const cs03CheckAlt7 = await verifyBomInCs03({
      material: testMaterial,
      plant: testPlant,
      bomUsage: testUsage,
      alternativeBom: '7'
    });
    assert.strictEqual(cs03CheckAlt7.exists, false, 'Alternative BOM 7 must be confirmed absent in CS03');
    assert.ok(
      !cs03CheckAlt7.availableAlternatives.includes('7'),
      'Alternative 7 must no longer be present in CS03 available alternatives'
    );
    console.log('   ✓ CS03 explicitly confirmed: Alternative 7 is gone');

    // -----------------------------------------------------------------
    // TEST STEP 2: Verify Alt 1-6 remain
    // -----------------------------------------------------------------
    console.log('\nStep 2: Verifying Alternatives 1 through 6 remain unchanged in CS03...');
    const cs03OverviewAfter7 = await verifyBomInCs03({
      material: testMaterial,
      plant: testPlant,
      bomUsage: testUsage
    });

    assert.strictEqual(cs03OverviewAfter7.exists, true, 'BOM must still exist in CS03');
    assert.deepStrictEqual(
      cs03OverviewAfter7.availableAlternatives,
      ['1', '2', '3', '4', '5', '6'],
      'CS03 available alternatives must strictly equal [1, 2, 3, 4, 5, 6]'
    );

    // Verify each alternative 1 to 6 individually
    for (const alt of ['1', '2', '3', '4', '5', '6']) {
      const singleAltCheck = await verifyBomInCs03({
        material: testMaterial,
        plant: testPlant,
        bomUsage: testUsage,
        alternativeBom: alt
      });
      assert.strictEqual(singleAltCheck.exists, true, `Alternative BOM ${alt} must still exist in CS03`);
    }
    console.log('   ✓ CS03 explicitly confirmed: Alternatives 1, 2, 3, 4, 5, 6 remain intact');

    // -----------------------------------------------------------------
    // TEST STEP 3: Attempt to delete non-existent alternative (Alt 9)
    // Confirm error + nothing deleted
    // -----------------------------------------------------------------
    console.log('\nStep 3: Attempting to delete non-existent Alternative BOM 9...');
    // Direct service call
    const delete9Result = await deleteBomViaGui({
      material: testMaterial,
      plant: testPlant,
      alternativeBom: '9',
      bomUsage: testUsage
    });

    assert.strictEqual(delete9Result.success, false, 'Deleting non-existent alternative must not succeed');
    assert.strictEqual(delete9Result.verified, false, 'Verified flag must be false');
    assert.strictEqual(delete9Result.code, 'ALTERNATIVE_NOT_FOUND');
    assert.match(
      delete9Result.message,
      /Alternative BOM 9 does not exist/i,
      'Error message must clearly state Alternative BOM 9 does not exist'
    );
    console.log('   ✓ Direct deleteBomViaGui rejected Alt 9 with ALTERNATIVE_NOT_FOUND and clear error');

    // HTTP Chat / Structured Form call
    const httpDelete9Res = await makeRequest('POST', '/api/chat', {
      actionType: 'delete_bom',
      deleteBomParams: {
        material: testMaterial,
        plant: testPlant,
        alternativeBom: '9',
        bomUsage: testUsage
      }
    }, authHeaders);

    assert.strictEqual(httpDelete9Res.status, 200);
    assert.strictEqual(httpDelete9Res.data.error, true);
    assert.strictEqual(httpDelete9Res.data.proposedAction, null, 'No action proposal must be created for non-existent alternative');
    assert.match(
      httpDelete9Res.data.reply,
      /Alternative BOM 9 does not exist/i,
      'HTTP response must report "Alternative BOM 9 does not exist."'
    );
    console.log('   ✓ HTTP structured submission rejected Alt 9 without creating pending action proposal');

    // Verify nothing was deleted: CS03 must still have Alt 1-6
    const cs03After9Attempt = await verifyBomInCs03({
      material: testMaterial,
      plant: testPlant,
      bomUsage: testUsage
    });
    assert.deepStrictEqual(
      cs03After9Attempt.availableAlternatives,
      ['1', '2', '3', '4', '5', '6'],
      'CS03 alternatives must remain completely unchanged [1, 2, 3, 4, 5, 6]'
    );
    console.log('   ✓ Confirmed: Nothing was deleted; Alternatives 1-6 remain unchanged');

    // -----------------------------------------------------------------
    // TEST STEP 4: Test deleting Alt 6 and verify Alt 1 remains untouched
    // -----------------------------------------------------------------
    console.log('\nStep 4: Testing Wrong-Alternative Protection (Delete Alt 6, verify Alt 1 untouched)...');
    const delete6Result = await deleteBomViaGui({
      material: testMaterial,
      plant: testPlant,
      alternativeBom: '6',
      bomUsage: testUsage
    });

    assert.strictEqual(delete6Result.success, true);
    assert.strictEqual(delete6Result.verified, true);
    assert.strictEqual(delete6Result.alternativeBom, '6');
    console.log('   ✓ deleteBomViaGui successfully deleted Alt 6');

    // Verify Alt 6 is gone in CS03
    const cs03CheckAlt6 = await verifyBomInCs03({
      material: testMaterial,
      plant: testPlant,
      bomUsage: testUsage,
      alternativeBom: '6'
    });
    assert.strictEqual(cs03CheckAlt6.exists, false, 'Alternative BOM 6 must be confirmed absent in CS03');
    console.log('   ✓ CS03 confirmed: Alt 6 is gone');

    // Verify Alt 1 remains untouched in CS03
    const cs03CheckAlt1 = await verifyBomInCs03({
      material: testMaterial,
      plant: testPlant,
      bomUsage: testUsage,
      alternativeBom: '1'
    });
    assert.strictEqual(cs03CheckAlt1.exists, true, 'Alternative BOM 1 must remain present and untouched');
    console.log('   ✓ CS03 confirmed: Alt 1 remains untouched');

    // Verify remaining alternatives: must strictly be Alt 1, 2, 3, 4, 5
    const cs03FinalOverview = await verifyBomInCs03({
      material: testMaterial,
      plant: testPlant,
      bomUsage: testUsage
    });
    assert.deepStrictEqual(
      cs03FinalOverview.availableAlternatives,
      ['1', '2', '3', '4', '5'],
      'Remaining alternatives must strictly be [1, 2, 3, 4, 5]'
    );
    console.log('   ✓ Remaining alternatives verified: [1, 2, 3, 4, 5]');

    console.log('\n======================================================');
    console.log('✅ ALL DELETE BOM VERIFICATION & PROTECTION TESTS PASSED');
    console.log('======================================================\n');
  } finally {
    resetMockBomDataset();
    if (server) {
      server.close();
    }
  }
}

runDeleteBomVerificationTests().catch((err) => {
  console.error('\n❌ Test suite failed:', err);
  resetMockBomDataset();
  if (server) server.close();
  process.exit(1);
});
