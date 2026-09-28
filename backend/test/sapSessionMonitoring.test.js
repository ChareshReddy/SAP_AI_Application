import assert from 'assert';
import http from 'http';
import app from '../server.js';
import {
  checkSapSessionHealth,
  ensureSapSession,
  verifyBomInCs03,
  copyBomViaGui,
  deleteBomViaGui,
  validateSourceBom,
  setMockSapSessionUser,
  resetMockSapSessionUser,
  getActiveSapUser
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

async function runSapSessionMonitoringTests() {
  console.log('\n======================================================');
  console.log('--- Starting SAP Session Monitoring & Health Test Suite ---');
  console.log('======================================================');

  process.env.USE_MOCK_SAP = 'true';
  process.env.OPENROUTER_API_KEY = 'test_key';
  process.env.OPENROUTER_MODEL = 'test_model';
  delete process.env.TEST_SAP_SESSION_HEALTH;
  delete process.env.TEST_SIMULATE_NO_SESSION;
  delete process.env.TEST_SIMULATE_BUSY;
  delete process.env.TEST_SIMULATE_DISCONNECT_DURING_OP;

  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  baseUrl = `http://127.0.0.1:${port}`;

  // Log in to obtain authenticated cookie for chat endpoints
  const loginRes = await makeRequest('POST', '/api/auth/login', {
    username: 'LEELAM_EXT',
    password: 'MockPassword123'
  });
  assert.strictEqual(loginRes.status, 200);
  const cookie = loginRes.headers['set-cookie']?.[0]?.split(';')[0] || '';
  const authHeaders = cookie ? { Cookie: cookie } : {};

  try {
    // -------------------------------------------------------------
    // Test 1: SAP session available
    // -------------------------------------------------------------
    console.log('\n1. Testing SAP session available:');
    delete process.env.TEST_SAP_SESSION_HEALTH;
    const health1 = await checkSapSessionHealth();
    assert.strictEqual(health1.connected, true);
    assert.strictEqual(health1.status, 'CONNECTED');
    assert.strictEqual(health1.system, 'S4A');
    assert.strictEqual(health1.client, '500');
    assert.strictEqual(health1.user, 'LEELAM_EXT');

    const apiRes1 = await makeRequest('GET', '/api/sap/session-status');
    assert.strictEqual(apiRes1.status, 200);
    assert.strictEqual(apiRes1.data.connected, true);
    assert.strictEqual(apiRes1.data.status, 'CONNECTED');
    console.log('   ✓ SAP session available verified via internal probe and GET /api/sap/session-status');

    // -------------------------------------------------------------
    // Test 2: SAP session not found
    // -------------------------------------------------------------
    console.log('\n2. Testing SAP session not found:');
    process.env.TEST_SAP_SESSION_HEALTH = 'SESSION_NOT_FOUND';
    const health2 = await checkSapSessionHealth();
    assert.strictEqual(health2.connected, false);
    assert.strictEqual(health2.status, 'SESSION_NOT_FOUND');
    assert.match(health2.message, /log in to SAP GUI again/i);

    const apiRes2 = await makeRequest('GET', '/api/sap/session-status');
    assert.strictEqual(apiRes2.status, 200);
    assert.strictEqual(apiRes2.data.connected, false);
    assert.strictEqual(apiRes2.data.status, 'SESSION_NOT_FOUND');
    console.log('   ✓ SAP session not found correctly reported and classified');

    // -------------------------------------------------------------
    // Test 3: SAP server unavailable
    // -------------------------------------------------------------
    console.log('\n3. Testing SAP server unavailable:');
    process.env.TEST_SAP_SESSION_HEALTH = 'SERVER_UNAVAILABLE';
    const health3 = await checkSapSessionHealth();
    assert.strictEqual(health3.connected, false);
    assert.strictEqual(health3.status, 'SERVER_UNAVAILABLE');
    assert.strictEqual(health3.code, 'SAP_SERVER_UNAVAILABLE');
    assert.match(health3.message, /SAP server is currently unavailable/i);

    const apiRes3 = await makeRequest('GET', '/api/sap/session-status');
    assert.strictEqual(apiRes3.status, 200);
    assert.strictEqual(apiRes3.data.connected, false);
    assert.strictEqual(apiRes3.data.status, 'SERVER_UNAVAILABLE');
    console.log('   ✓ SAP server unavailable correctly classified and returned');

    // -------------------------------------------------------------
    // Test 4: SAP session busy
    // -------------------------------------------------------------
    console.log('\n4. Testing SAP session busy:');
    process.env.TEST_SAP_SESSION_HEALTH = 'BUSY';
    const health4 = await checkSapSessionHealth();
    assert.strictEqual(health4.connected, false);
    assert.strictEqual(health4.status, 'BUSY');
    assert.strictEqual(health4.code, 'SAP_SESSION_BUSY');
    assert.match(health4.message, /processing another operation/i);

    const apiRes4 = await makeRequest('GET', '/api/sap/session-status');
    assert.strictEqual(apiRes4.status, 200);
    assert.strictEqual(apiRes4.data.status, 'BUSY');
    console.log('   ✓ SAP session busy state gracefully reported');

    // -------------------------------------------------------------
    // Test 5: SAP session recovers
    // -------------------------------------------------------------
    console.log('\n5. Testing SAP session recovers:');
    process.env.TEST_SAP_SESSION_HEALTH = 'CONNECTED';
    const health5 = await checkSapSessionHealth();
    assert.strictEqual(health5.connected, true);
    assert.strictEqual(health5.status, 'CONNECTED');
    const ensure5 = await ensureSapSession();
    assert.strictEqual(ensure5.ok, true);
    assert.strictEqual(ensure5.status, 'CONNECTED');
    console.log('   ✓ SAP session recovers dynamically without restart');

    // -------------------------------------------------------------
    // Test 6: Heartbeat changes CONNECTED -> SERVER_UNAVAILABLE
    // -------------------------------------------------------------
    console.log('\n6. Testing Heartbeat changes CONNECTED → SERVER_UNAVAILABLE:');
    process.env.TEST_SAP_SESSION_HEALTH = 'CONNECTED';
    const pollConnected = await makeRequest('GET', '/api/sap/session-status');
    assert.strictEqual(pollConnected.data.status, 'CONNECTED');

    // Server goes down while app is running
    process.env.TEST_SAP_SESSION_HEALTH = 'SERVER_UNAVAILABLE';
    const pollUnavailable = await makeRequest('GET', '/api/sap/session-status');
    assert.strictEqual(pollUnavailable.data.connected, false);
    assert.strictEqual(pollUnavailable.data.status, 'SERVER_UNAVAILABLE');
    assert.match(pollUnavailable.data.message, /server is currently unavailable/i);
    console.log('   ✓ Heartbeat poll accurately transitions from CONNECTED to SERVER_UNAVAILABLE');

    // -------------------------------------------------------------
    // Test 7: Heartbeat changes SERVER_UNAVAILABLE -> CONNECTED
    // -------------------------------------------------------------
    console.log('\n7. Testing Heartbeat changes SERVER_UNAVAILABLE → CONNECTED:');
    // User restarts/logs into SAP
    process.env.TEST_SAP_SESSION_HEALTH = 'CONNECTED';
    const pollRestored = await makeRequest('GET', '/api/sap/session-status');
    assert.strictEqual(pollRestored.data.connected, true);
    assert.strictEqual(pollRestored.data.status, 'CONNECTED');
    console.log('   ✓ Heartbeat poll automatically returns to CONNECTED when SAP comes back online');

    // -------------------------------------------------------------
    // Test 8: Create BOM blocked when SAP unavailable
    // -------------------------------------------------------------
    console.log('\n8. Testing Create BOM blocked when SAP unavailable:');
    process.env.TEST_SAP_SESSION_HEALTH = 'SERVER_UNAVAILABLE';

    // Attempt via structured form
    const createRes = await makeRequest('POST', '/api/chat', {
      actionType: 'copy_bom',
      copyBomParams: {
        sourceMaterial: 'A1BH0214C',
        sourcePlant: '1001',
        sourceUsage: '1',
        targetMaterial: 'A1BH0214C',
        targetPlant: '1012',
        targetUsage: '1'
      }
    }, authHeaders);

    assert.strictEqual(createRes.status, 200);
    assert.strictEqual(createRes.data.error, true);
    assert.strictEqual(createRes.data.proposedAction, null);
    // Crucial requirement: must NOT say "No output from CS03 verification"
    assert.doesNotMatch(createRes.data.reply, /No output from CS03/i);
    assert.match(createRes.data.reply, /server is currently unavailable/i);
    console.log('   ✓ Create BOM strictly blocked when SAP is unavailable with connectivity error');

    // -------------------------------------------------------------
    // Test 9: Delete BOM blocked when SAP unavailable
    // -------------------------------------------------------------
    console.log('\n9. Testing Delete BOM blocked when SAP unavailable:');
    process.env.TEST_SAP_SESSION_HEALTH = 'SERVER_UNAVAILABLE';

    const deleteRes = await makeRequest('POST', '/api/chat', {
      actionType: 'delete_bom',
      deleteBomParams: {
        material: 'A1BH0214C',
        plant: '1001',
        alternativeBom: '1',
        bomUsage: '1'
      }
    }, authHeaders);

    assert.strictEqual(deleteRes.status, 200);
    assert.strictEqual(deleteRes.data.error, true);
    assert.strictEqual(deleteRes.data.proposedAction, null);
    assert.match(deleteRes.data.reply, /server is currently unavailable/i);
    console.log('   ✓ Delete BOM strictly blocked before execution when SAP is unavailable');

    // -------------------------------------------------------------
    // Test 10: CS03 no-output caused by connectivity failure
    // -------------------------------------------------------------
    console.log('\n10. Testing CS03 connectivity failure classification (eliminating generic no-output error):');
    process.env.TEST_SAP_SESSION_HEALTH = 'SERVER_UNAVAILABLE';
    const cs03Fail = await verifyBomInCs03({
      material: 'A1BH0214C',
      plant: '1001',
      bomUsage: '1'
    });

    assert.strictEqual(cs03Fail.success, false);
    assert.strictEqual(cs03Fail.code, 'SAP_SERVER_UNAVAILABLE');
    assert.strictEqual(cs03Fail.status, 'SERVER_UNAVAILABLE');
    assert.doesNotMatch(cs03Fail.message, /No output from CS03/i);
    assert.match(cs03Fail.message, /server is currently unavailable/i);
    console.log('   ✓ CS03 failure accurately classified as SAP_SERVER_UNAVAILABLE instead of generic no-output');

    // -------------------------------------------------------------
    // Test 11: CS03 genuine BOM_NOT_FOUND remains BOM_NOT_FOUND
    // -------------------------------------------------------------
    console.log('\n11. Testing CS03 genuine BOM_NOT_FOUND remains BOM_NOT_FOUND:');
    process.env.TEST_SAP_SESSION_HEALTH = 'CONNECTED';
    const cs03Missing = await verifyBomInCs03({
      material: 'MAT-NONEXISTENT',
      plant: '1001',
      bomUsage: '1'
    });

    assert.strictEqual(cs03Missing.success, true);
    assert.strictEqual(cs03Missing.exists, false);
    assert.match(cs03Missing.message, /BOM not found/i);
    console.log('   ✓ Genuine BOM_NOT_FOUND preserved when SAP connection is healthy');

    // -------------------------------------------------------------
    // Test 12: SAP disconnect during operation does not report false success
    // -------------------------------------------------------------
    console.log('\n12. Testing SAP disconnect during operation does not report false success:');
    process.env.TEST_SAP_SESSION_HEALTH = 'CONNECTED';
    process.env.TEST_SIMULATE_DISCONNECT_DURING_OP = 'true';

    const copyMidFail = await copyBomViaGui({
      source: { material: 'A1BH0214C', plant: '1001', bomUsage: '1' },
      target: { material: 'A1BH0214C', plant: '1012', bomUsage: '1' }
    });
    assert.strictEqual(copyMidFail.success, false);
    assert.strictEqual(copyMidFail.verified, false);
    assert.strictEqual(copyMidFail.code, 'SAP_CONNECTION_LOST');
    assert.match(copyMidFail.message, /Connection to SAP was lost during BOM creation.*Please check.*CS03/i);

    const deleteMidFail = await deleteBomViaGui({
      material: 'A1BH0214C',
      plant: '1001',
      alternativeBom: '1'
    });
    assert.strictEqual(deleteMidFail.success, false);
    assert.strictEqual(deleteMidFail.verified, false);
    assert.strictEqual(deleteMidFail.code, 'SAP_CONNECTION_LOST');
    assert.match(deleteMidFail.message, /Connection to SAP was lost during the operation.*Please check CS03/i);

    delete process.env.TEST_SIMULATE_DISCONNECT_DURING_OP;
    console.log('   ✓ Mid-operation disconnect handled safely: warns user and prevents false success claim');

    // -------------------------------------------------------------
    // Test 13: Existing 16 source validation tests compatibility
    // -------------------------------------------------------------
    console.log('\n13. Testing Source BOM validation API handles SERVER_UNAVAILABLE:');
    process.env.TEST_SAP_SESSION_HEALTH = 'SERVER_UNAVAILABLE';
    const validateRes = await makeRequest('POST', '/api/bom/validate-source', {
      material: 'A1BH0214C',
      plant: '1001'
    });
    assert.strictEqual(validateRes.status, 200);
    assert.strictEqual(validateRes.data.success, false);
    assert.strictEqual(validateRes.data.errorCode, 'SAP_SERVER_UNAVAILABLE');
    assert.match(validateRes.data.message, /server is currently unavailable/i);

    delete process.env.TEST_SAP_SESSION_HEALTH;
    console.log('   ✓ Source BOM validation API gracefully returns SAP_SERVER_UNAVAILABLE');

    // -------------------------------------------------------------
    // Test 14: Execution confirmation blocks when SAP disconnected
    // -------------------------------------------------------------
    console.log('\n14. Testing human confirmation execution blocked when SAP server goes down:');
    // First propose an action while online
    process.env.TEST_SAP_SESSION_HEALTH = 'CONNECTED';
    const propRes = await makeRequest('POST', '/api/chat', {
      actionType: 'copy_bom',
      copyBomParams: {
        sourceMaterial: 'A1BH0214C',
        sourcePlant: '1001',
        sourceUsage: '1',
        targetMaterial: 'A1BH0214C',
        targetPlant: '1012',
        targetUsage: '1'
      }
    }, authHeaders);

    assert.strictEqual(propRes.data.error, false);
    const actionId = propRes.data.proposedAction.actionId;
    assert(actionId, 'Expected actionId in proposedAction');

    // Now simulate SAP server failure before user confirms
    process.env.TEST_SAP_SESSION_HEALTH = 'SERVER_UNAVAILABLE';
    const confirmRes = await makeRequest('POST', '/api/chat', {
      confirmAction: actionId
    }, authHeaders);

    assert.strictEqual(confirmRes.status, 200);
    assert.strictEqual(confirmRes.data.error, true);
    assert.match(confirmRes.data.reply, /server is currently unavailable/i);
    console.log('   ✓ Human confirmation execution strictly blocked when SAP drops before confirmation');

    delete process.env.TEST_SAP_SESSION_HEALTH;

    // -------------------------------------------------------------
    // Test 15: Discovers user ACCESS1 dynamically
    // -------------------------------------------------------------
    console.log('\n15. Testing dynamic discovery of user ACCESS1:');
    setMockSapSessionUser('ACCESS1');
    const health15 = await checkSapSessionHealth();
    assert.strictEqual(health15.connected, true);
    assert.strictEqual(health15.status, 'CONNECTED');
    assert.strictEqual(health15.user, 'ACCESS1');

    const apiRes15 = await makeRequest('GET', '/api/sap/session-status');
    assert.strictEqual(apiRes15.status, 200);
    assert.strictEqual(apiRes15.data.connected, true);
    assert.strictEqual(apiRes15.data.user, 'ACCESS1');
    console.log('   ✓ User ACCESS1 dynamically discovered and returned in health check and session-status API');

    // -------------------------------------------------------------
    // Test 16: Discovers arbitrary user TESTUSER dynamically
    // -------------------------------------------------------------
    console.log('\n16. Testing dynamic discovery of arbitrary user TESTUSER:');
    setMockSapSessionUser('TESTUSER');
    const health16 = await checkSapSessionHealth();
    assert.strictEqual(health16.connected, true);
    assert.strictEqual(health16.status, 'CONNECTED');
    assert.strictEqual(health16.user, 'TESTUSER');

    const apiRes16 = await makeRequest('GET', '/api/sap/session-status');
    assert.strictEqual(apiRes16.status, 200);
    assert.strictEqual(apiRes16.data.user, 'TESTUSER');
    console.log('   ✓ Arbitrary user TESTUSER discovered dynamically without hardcoding');

    // -------------------------------------------------------------
    // Test 17: User switching LEELAM_EXT -> ACCESS1 without restart
    // -------------------------------------------------------------
    console.log('\n17. Testing user switching LEELAM_EXT → ACCESS1 without server restart:');
    setMockSapSessionUser('LEELAM_EXT');
    const beforeSwitch = await makeRequest('GET', '/api/sap/session-status');
    assert.strictEqual(beforeSwitch.data.user, 'LEELAM_EXT');

    // User switches to ACCESS1
    setMockSapSessionUser('ACCESS1');
    const afterSwitch = await makeRequest('GET', '/api/sap/session-status');
    assert.strictEqual(afterSwitch.data.user, 'ACCESS1');
    assert.strictEqual(afterSwitch.data.connected, true);
    console.log('   ✓ User switching from LEELAM_EXT to ACCESS1 immediately reflected in status API');

    // -------------------------------------------------------------
    // Test 18: Unauthenticated / login screen returns DISCONNECTED
    // -------------------------------------------------------------
    console.log('\n18. Testing unauthenticated SAP GUI session (login screen):');
    process.env.TEST_SAP_SESSION_HEALTH = 'DISCONNECTED';
    const health18 = await checkSapSessionHealth();
    assert.strictEqual(health18.connected, false);
    assert.strictEqual(health18.status, 'DISCONNECTED');
    assert.strictEqual(health18.code, 'NO_CONNECTION');

    const apiRes18 = await makeRequest('GET', '/api/sap/session-status');
    assert.strictEqual(apiRes18.status, 200);
    assert.strictEqual(apiRes18.data.connected, false);
    assert.strictEqual(apiRes18.data.status, 'DISCONNECTED');
    delete process.env.TEST_SAP_SESSION_HEALTH;
    console.log('   ✓ Unauthenticated SAP session correctly reported as DISCONNECTED');

    // -------------------------------------------------------------
    // Test 19: ensureSapSession returns discovered sessionPath, user, system, client
    // -------------------------------------------------------------
    console.log('\n19. Testing ensureSapSession returns discovered session details:');
    setMockSapSessionUser('ACCESS1');
    const sessionDetails = await ensureSapSession();
    assert.strictEqual(sessionDetails.ok, true);
    assert.strictEqual(sessionDetails.status, 'CONNECTED');
    assert.strictEqual(sessionDetails.user, 'ACCESS1');
    assert.strictEqual(sessionDetails.system, 'S4A');
    assert.strictEqual(sessionDetails.client, '500');
    assert(sessionDetails.sessionPath, 'Expected sessionPath to be defined');
    console.log('   ✓ ensureSapSession successfully returned path, user, system, and client');

    // -------------------------------------------------------------
    // Test 20: Workflows execute with dynamic user
    // -------------------------------------------------------------
    console.log('\n20. Testing automation workflows operate with dynamically discovered user:');
    setMockSapSessionUser('ACCESS1');

    const cs03Check = await verifyBomInCs03({
      material: 'A1BH0214C',
      plant: '1001',
      bomUsage: '1'
    });
    assert.strictEqual(cs03Check.success, true);
    assert.strictEqual(cs03Check.exists, true);

    const valSourceCheck = await validateSourceBom({
      material: 'A1BH0214C',
      plant: '1001',
      bomUsage: '1'
    });
    assert.strictEqual(valSourceCheck.success, true);

    const copyCheck = await copyBomViaGui({
      source: { material: 'A1BH0214C', plant: '1001', bomUsage: '1' },
      target: { material: 'A1BH0214C', plant: '1012', bomUsage: '1' }
    });
    assert.strictEqual(copyCheck.success, true);
    assert.strictEqual(copyCheck.verified, true);

    resetMockSapSessionUser();
    console.log('   ✓ CS03 verification, Source BOM validation, and Copy BOM all execute with dynamic user');

    console.log('\n======================================================');
    console.log('✅ ALL 20 SAP SESSION MONITORING TESTS PASSED!');
    console.log('======================================================\n');
  } finally {
    delete process.env.TEST_SAP_SESSION_HEALTH;
    delete process.env.TEST_SIMULATE_NO_SESSION;
    delete process.env.TEST_SIMULATE_BUSY;
    delete process.env.TEST_SIMULATE_DISCONNECT_DURING_OP;
    server.close();
  }
}

runSapSessionMonitoringTests().catch((err) => {
  console.error('\n❌ SAP Session Monitoring Test Suite Failed:', err);
  process.exit(1);
});
