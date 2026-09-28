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

async function runStructuredBomFormTests() {
  console.log('\n--- Starting Structured BOM Forms Integration Test Suite ---');

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

  // 1. Test Rule 7: Copy BOM with identical Source and Target
  console.log('\n1. Testing Copy BOM structured submission: Source and Target identical');
  const sameBomRes = await makeRequest('POST', '/api/chat', {
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
      validFrom: '26.09.2026'
    }
  }, authHeaders);

  assert.strictEqual(sameBomRes.status, 200);
  assert.strictEqual(sameBomRes.data.error, true);
  assert.match(sameBomRes.data.reply, /Source and target BOM are the same/i);
  assert.strictEqual(sameBomRes.data.proposedAction, null);
  console.log('   ✓ Rule 7 correctly rejected identical source and target BOM');

  // 2. Test Pre-validation: Non-existent Source BOM in Plant 1012
  console.log('\n2. Testing Copy BOM structured submission: Non-existent source in plant 1012');
  const nonexistentSrcRes = await makeRequest('POST', '/api/chat', {
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
      validFrom: '26.09.2026'
    }
  }, authHeaders);

  assert.strictEqual(nonexistentSrcRes.status, 200);
  assert.strictEqual(nonexistentSrcRes.data.error, true);
  assert.match(nonexistentSrcRes.data.reply, /Cannot copy BOM: No BOM exists for material A1BH0214C in plant 1012/i);
  assert.strictEqual(nonexistentSrcRes.data.proposedAction, null);
  console.log('   ✓ Non-existent source BOM rejected with clear error message');

  // 3. Test Successful Copy BOM Proposal from Existing Plant 1001 to Plant 1012
  console.log('\n3. Testing Copy BOM structured submission: Valid source in plant 1001 to plant 1012');
  const validCopyRes = await makeRequest('POST', '/api/chat', {
    actionType: 'copy_bom',
    copyBomParams: {
      sourceMaterial: 'A1BH0214C',
      sourcePlant: '1001',
      sourceUsage: '1',
      sourceAltBom: '1',
      targetMaterial: 'A1BH0214C',
      targetPlant: '1012',
      targetUsage: '1',
      targetAltBom: '1',
      validFrom: '26.09.2026'
    }
  }, authHeaders);

  assert.strictEqual(validCopyRes.status, 200);
  assert.strictEqual(validCopyRes.data.error, false);
  assert.ok(validCopyRes.data.proposedAction);
  assert.strictEqual(validCopyRes.data.proposedAction.type, 'copy_bom');
  assert.strictEqual(validCopyRes.data.proposedAction.preview.sourcePlant, '1001');
  assert.strictEqual(validCopyRes.data.proposedAction.preview.targetPlant, '1012');
  console.log('   ✓ Valid copy request generated pendingAction proposal card');

  // Verify pending action in store without premature execution
  const pendingCopy = pendingActionStore.getPendingAction(validCopyRes.data.proposedAction.actionId);
  assert.ok(pendingCopy);
  assert.strictEqual(pendingCopy.type, 'copy_bom');
  console.log('   ✓ Safety confirmation gate verified: Copy action is waiting for confirmation');

  // 3b. Test Copy BOM structured submission with optional fields omitted
  console.log('\n3b. Testing Copy BOM structured submission with optional fields omitted (no alt, no validFrom):');
  const optionalFieldsCopyRes = await makeRequest('POST', '/api/chat', {
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
      validFrom: ''
    }
  }, authHeaders);

  assert.strictEqual(optionalFieldsCopyRes.status, 200);
  assert.strictEqual(optionalFieldsCopyRes.data.error, false);
  assert.ok(optionalFieldsCopyRes.data.proposedAction);
  assert.strictEqual(optionalFieldsCopyRes.data.proposedAction.type, 'copy_bom');
  assert.strictEqual(optionalFieldsCopyRes.data.proposedAction.preview.sourceMaterial, 'A1BH0214C');
  assert.strictEqual(optionalFieldsCopyRes.data.proposedAction.preview.sourcePlant, '1001');
  assert.strictEqual(optionalFieldsCopyRes.data.proposedAction.preview.targetPlant, '1012');
  console.log('   ✓ Copy BOM succeeded when alternative BOM and valid from are omitted');

  // 4. Test Delete BOM Structured Form Submission
  console.log('\n4. Testing Delete BOM structured submission: ZBOM_COPY');
  const validDeleteRes = await makeRequest('POST', '/api/chat', {
    actionType: 'delete_bom',
    deleteBomParams: {
      material: 'A1BH0214C',
      plant: '1001',
      alternativeBom: '2',
      bomUsage: '1'
    }
  }, authHeaders);

  assert.strictEqual(validDeleteRes.status, 200);
  assert.strictEqual(validDeleteRes.data.error, false);
  assert.ok(validDeleteRes.data.proposedAction);
  assert.strictEqual(validDeleteRes.data.proposedAction.type, 'delete_bom');
  assert.strictEqual(validDeleteRes.data.proposedAction.riskLevel, 3);
  assert.strictEqual(validDeleteRes.data.proposedAction.preview.material, 'A1BH0214C');
  assert.strictEqual(validDeleteRes.data.proposedAction.preview.plant, '1001');
  assert.strictEqual(validDeleteRes.data.proposedAction.preview.alternativeBom, '2');
  assert.strictEqual(validDeleteRes.data.proposedAction.preview.bomUsage, '1');
  console.log('   ✓ Delete BOM generated high-risk pendingAction proposal card with warning');

  const pendingDelete = pendingActionStore.getPendingAction(validDeleteRes.data.proposedAction.actionId);
  assert.ok(pendingDelete);
  assert.strictEqual(pendingDelete.type, 'delete_bom');
  console.log('   ✓ Safety confirmation gate verified: Delete action is waiting for confirmation');

  server.close();
  console.log('\n======================================================');
  console.log('✅ ALL STRUCTURED BOM FORMS INTEGRATION TESTS PASSED');
  console.log('======================================================\n');
}

runStructuredBomFormTests().catch((err) => {
  console.error('Test suite failed:', err);
  if (server) server.close();
  process.exit(1);
});
