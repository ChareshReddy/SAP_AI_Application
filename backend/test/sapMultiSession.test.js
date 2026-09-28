import assert from 'assert';
import http from 'http';
import app from '../server.js';
import {
  checkSapSessionHealth,
  ensureSapSession,
  discoverSapSessions,
  getSelectedSapSessionId,
  getSelectedSapUser,
  setSelectedSapSessionId,
  resetSelectedSapSession,
  setMockSapSessions,
  resetMockSapSessions
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

async function runSapMultiSessionTests() {
  console.log('\n======================================================');
  console.log('--- Starting Multi-Session SAP GUI & Selection Tests ---');
  console.log('======================================================');

  process.env.USE_MOCK_SAP = 'true';
  process.env.OPENROUTER_API_KEY = 'test_key';
  process.env.OPENROUTER_MODEL = 'test_model';
  delete process.env.TEST_SAP_SESSION_HEALTH;
  delete process.env.TEST_SIMULATE_NO_SESSION;
  delete process.env.TEST_SIMULATE_BUSY;

  // Start internal test server
  server = http.createServer(app);
  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });

  try {
    // Authenticate test session
    const loginRes = await makeRequest('POST', '/api/auth/login', {
      username: 'LEELAM_EXT',
      password: 'MockPassword123'
    });
    assert.strictEqual(loginRes.status, 200);
    const setCookie = loginRes.headers['set-cookie'];
    const authHeaders = {
      Cookie: Array.isArray(setCookie) ? setCookie[0] : setCookie
    };

    // -------------------------------------------------------------
    // Scenario 1: Two sessions open (ACCESS1, LEELAM_EXT)
    // -------------------------------------------------------------
    console.log('\n1. Testing two sessions open (ACCESS1, LEELAM_EXT):');
    resetSelectedSapSession();
    setMockSapSessions([
      { user: 'ACCESS1', system: 'S4A', client: '500', connectionIndex: 0, sessionIndex: 0, title: 'SAP Easy Access' },
      { user: 'LEELAM_EXT', system: 'S4A', client: '500', connectionIndex: 0, sessionIndex: 1, title: 'SAP Easy Access' }
    ]);

    const res1 = await makeRequest('GET', '/api/sap/sessions', null, authHeaders);
    assert.strictEqual(res1.status, 200);
    assert.strictEqual(res1.data.success, true);
    assert.strictEqual(res1.data.sessions.length, 2);
    assert.ok(res1.data.selectedSessionId, 'Expected selectedSessionId to be set');
    assert.strictEqual(res1.data.selectedUser, 'ACCESS1');

    const health1 = await checkSapSessionHealth();
    assert.strictEqual(health1.connected, true);
    assert.strictEqual(health1.user, 'ACCESS1');
    console.log('   ✓ Both sessions discovered, ACCESS1 automatically selected and active');

    // -------------------------------------------------------------
    // Scenario 2: Switching session ACCESS1 -> LEELAM_EXT
    // -------------------------------------------------------------
    console.log('\n2. Testing session switching ACCESS1 -> LEELAM_EXT:');
    const leelamSession = res1.data.sessions.find(s => s.user === 'LEELAM_EXT');
    assert.ok(leelamSession, 'Expected LEELAM_EXT session in list');

    const switchRes = await makeRequest('POST', '/api/sap/sessions/select', {
      sessionId: leelamSession.id
    }, authHeaders);
    assert.strictEqual(switchRes.status, 200);
    assert.strictEqual(switchRes.data.success, true);
    assert.strictEqual(switchRes.data.selectedUser, 'LEELAM_EXT');
    assert.match(switchRes.data.message, /switched to LEELAM_EXT/i);

    const health2 = await checkSapSessionHealth();
    assert.strictEqual(health2.connected, true);
    assert.strictEqual(health2.user, 'LEELAM_EXT');
    assert.strictEqual(getSelectedSapUser(), 'LEELAM_EXT');
    console.log('   ✓ Successfully switched active session to LEELAM_EXT without restart');

    // -------------------------------------------------------------
    // Scenario 3: Selected session closed (NO silent auto-switch)
    // -------------------------------------------------------------
    console.log('\n3. Testing selected session closed (NO silent auto-switch):');
    // LEELAM_EXT closes their session, leaving only ACCESS1
    setMockSapSessions([
      { user: 'ACCESS1', system: 'S4A', client: '500', connectionIndex: 0, sessionIndex: 0 }
    ]);

    const health3 = await checkSapSessionHealth();
    assert.strictEqual(health3.connected, false);
    assert.strictEqual(health3.status, 'DISCONNECTED');
    assert.strictEqual(health3.code, 'SELECTED_SESSION_UNAVAILABLE');
    assert.strictEqual(health3.selectedUser, 'LEELAM_EXT');
    assert.match(health3.message, /LEELAM_EXT is no longer available/i);
    // Strict safety check: Must NOT have automatically switched to ACCESS1!
    assert.strictEqual(getSelectedSapUser(), 'LEELAM_EXT');
    console.log('   ✓ Selected session loss detected; strictly prevented silent fallback to remaining session');

    // -------------------------------------------------------------
    // Scenario 4: Re-selecting another session after loss
    // -------------------------------------------------------------
    console.log('\n4. Testing re-selecting another session after loss:');
    const accessSession = health3.sessions.find(s => s.user === 'ACCESS1');
    assert.ok(accessSession, 'Expected ACCESS1 in remaining sessions list');

    const reselectRes = await makeRequest('POST', '/api/sap/sessions/select', {
      sessionId: accessSession.id
    }, authHeaders);
    assert.strictEqual(reselectRes.status, 200);
    assert.strictEqual(reselectRes.data.success, true);
    assert.strictEqual(reselectRes.data.selectedUser, 'ACCESS1');

    const ensure4 = await ensureSapSession();
    assert.strictEqual(ensure4.ok, true);
    assert.strictEqual(ensure4.user, 'ACCESS1');
    console.log('   ✓ User explicitly re-selected ACCESS1 and operations resumed successfully');

    // -------------------------------------------------------------
    // Scenario 5: Index shifting resilience
    // -------------------------------------------------------------
    console.log('\n5. Testing connection/session index shifting resilience:');
    // Previously ACCESS1 was con[0]/ses[0]. Now SAP internal connection shift moves ACCESS1 to con[1]/ses[2].
    setMockSapSessions([
      { user: 'OTHER', system: 'S4A', client: '500', connectionIndex: 0, sessionIndex: 0 },
      { user: 'ACCESS1', system: 'S4A', client: '500', connectionIndex: 1, sessionIndex: 2 }
    ]);

    const health5 = await checkSapSessionHealth();
    assert.strictEqual(health5.connected, true);
    assert.strictEqual(health5.user, 'ACCESS1');
    assert.strictEqual(health5.selectedSession.connectionIndex, 1);
    assert.strictEqual(health5.selectedSession.sessionIndex, 2);
    console.log('   ✓ User resolved seamlessly despite SAP GUI internal connection/session index shifting');

    // -------------------------------------------------------------
    // Scenario 6: Human confirmation session change safety
    // -------------------------------------------------------------
    console.log('\n6. Testing human confirmation session change safety:');
    // Set active session to ACCESS1
    setMockSapSessions([
      { user: 'ACCESS1', system: 'S4A', client: '500', connectionIndex: 0, sessionIndex: 0 },
      { user: 'LEELAM_EXT', system: 'S4A', client: '500', connectionIndex: 0, sessionIndex: 1 }
    ]);
    setSelectedSapSessionId('sess_s4a_500_access1_0_0', 'ACCESS1');

    // Create a pending action under ACCESS1
    const propRes6 = await makeRequest('POST', '/api/chat', {
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
    assert.strictEqual(propRes6.data.error, false);
    const actionId6 = propRes6.data.proposedAction.actionId;
    assert.ok(actionId6);

    // Now switch active session to LEELAM_EXT before confirming
    await makeRequest('POST', '/api/sap/sessions/select', {
      sessionId: 'sess_s4a_500_leelam_ext_0_1'
    }, authHeaders);

    // Confirm under LEELAM_EXT
    const confirmRes6 = await makeRequest('POST', '/api/chat', {
      confirmAction: actionId6
    }, authHeaders);
    assert.strictEqual(confirmRes6.status, 200);
    assert.strictEqual(confirmRes6.data.error, true);
    assert.strictEqual(confirmRes6.data.sessionChanged, true);
    assert.match(confirmRes6.data.reply, /Active SAP session changed from ACCESS1 to LEELAM_EXT/i);
    console.log('   ✓ Confirmation safely blocked when active session user changed in between');

    // -------------------------------------------------------------
    // Scenario 7: Human confirmation session closed
    // -------------------------------------------------------------
    console.log('\n7. Testing human confirmation session closed:');
    // Set active session to LEELAM_EXT
    setSelectedSapSessionId('sess_s4a_500_leelam_ext_0_1', 'LEELAM_EXT');

    const propRes7 = await makeRequest('POST', '/api/chat', {
      actionType: 'delete_bom',
      deleteBomParams: {
        material: 'A1BH0214C',
        plant: '1001',
        alternativeBom: '2',
        bomUsage: '1'
      }
    }, authHeaders);
    assert.strictEqual(propRes7.data.error, false);
    const actionId7 = propRes7.data.proposedAction.actionId;

    // Simulate session closing entirely
    setMockSapSessions([]);

    const confirmRes7 = await makeRequest('POST', '/api/chat', {
      confirmAction: actionId7,
      reason: 'Testing session loss rejection'
    }, authHeaders);
    assert.strictEqual(confirmRes7.status, 200);
    assert.strictEqual(confirmRes7.data.error, true);
    assert.strictEqual(confirmRes7.data.sessionError, true);
    assert.match(confirmRes7.data.reply, /session used to prepare this action is no longer available/i);
    console.log('   ✓ Confirmation strictly rejected when preparing session was closed');

    // -------------------------------------------------------------
    // Scenario 8: Busy session handling
    // -------------------------------------------------------------
    console.log('\n8. Testing busy session handling and retry:');
    setMockSapSessions([
      { user: 'ACCESS1', system: 'S4A', client: '500', busy: true, connectionIndex: 0, sessionIndex: 0 }
    ]);
    setSelectedSapSessionId('sess_s4a_500_access1_0_0', 'ACCESS1');

    const health8 = await checkSapSessionHealth();
    assert.strictEqual(health8.connected, false);
    assert.strictEqual(health8.status, 'BUSY');
    assert.strictEqual(health8.code, 'SAP_SESSION_BUSY');
    assert.match(health8.message, /processing another operation/i);

    const ensure8 = await ensureSapSession({ retries: 1, delayMs: 10 });
    assert.strictEqual(ensure8.ok, false);
    assert.strictEqual(ensure8.status, 'BUSY');
    console.log('   ✓ Busy state accurately reported with retries and proper status');

    // -------------------------------------------------------------
    // Scenario 9: COM path protection (never expose internal paths)
    // -------------------------------------------------------------
    console.log('\n9. Testing COM path protection in public API responses:');
    setMockSapSessions([
      { user: 'ACCESS1', system: 'S4A', client: '500', sessionPath: '/app/con[0]/ses[0]' }
    ]);
    setSelectedSapSessionId('sess_s4a_500_access1_0_0', 'ACCESS1');

    const sessApiRes = await makeRequest('GET', '/api/sap/sessions', null, authHeaders);
    const serializedSessions = JSON.stringify(sessApiRes.data);
    assert.ok(!serializedSessions.includes('/app/con'), 'API leaked /app/con session path!');
    assert.ok(!serializedSessions.includes('ses['), 'API leaked ses[ session index!');

    const statusApiRes = await makeRequest('GET', '/api/sap/session-status', null, authHeaders);
    const serializedStatus = JSON.stringify(statusApiRes.data.sessions);
    assert.ok(!serializedStatus.includes('/app/con'), 'Session status leaked /app/con path!');
    console.log('   ✓ Public APIs strictly protect internal SAP GUI COM paths');

    // -------------------------------------------------------------
    // Scenario 10: Single session auto-selection
    // -------------------------------------------------------------
    console.log('\n10. Testing single session auto-selection:');
    resetSelectedSapSession();
    setMockSapSessions([
      { user: 'SOLO_USER', system: 'S4A', client: '500', connectionIndex: 0, sessionIndex: 0 }
    ]);

    const health10 = await checkSapSessionHealth();
    assert.strictEqual(health10.connected, true);
    assert.strictEqual(health10.user, 'SOLO_USER');
    assert.strictEqual(getSelectedSapUser(), 'SOLO_USER');
    console.log('   ✓ Lone active session automatically selected without manual intervention');

    // -------------------------------------------------------------
    // Scenario 11: Zero sessions open
    // -------------------------------------------------------------
    console.log('\n11. Testing zero sessions open:');
    resetSelectedSapSession();
    setMockSapSessions([]);

    const health11 = await checkSapSessionHealth();
    assert.strictEqual(health11.connected, false);
    assert.strictEqual(health11.status, 'SESSION_NOT_FOUND');
    assert.strictEqual(health11.sessions.length, 0);
    console.log('   ✓ Zero sessions reported cleanly as SESSION_NOT_FOUND');

    // -------------------------------------------------------------
    // Scenario 12: Server disconnected (all sessions)
    // -------------------------------------------------------------
    console.log('\n12. Testing SAP server disconnected (SERVER_UNAVAILABLE):');
    process.env.TEST_SAP_SESSION_HEALTH = 'SERVER_UNAVAILABLE';

    const health12 = await checkSapSessionHealth();
    assert.strictEqual(health12.connected, false);
    assert.strictEqual(health12.status, 'SERVER_UNAVAILABLE');
    assert.strictEqual(health12.code, 'SAP_SERVER_UNAVAILABLE');

    const statusRes12 = await makeRequest('GET', '/api/sap/session-status', null, authHeaders);
    assert.strictEqual(statusRes12.data.status, 'SERVER_UNAVAILABLE');
    delete process.env.TEST_SAP_SESSION_HEALTH;
    console.log('   ✓ Server disconnection immediately triggers SERVER_UNAVAILABLE');

    // -------------------------------------------------------------
    // Scenario 13: Session titles with special characters
    // -------------------------------------------------------------
    console.log('\n13. Testing session titles with special characters:');
    resetSelectedSapSession();
    setMockSapSessions([
      {
        user: 'SPECIAL_USER',
        system: 'S4A',
        client: '500',
        title: 'BOM "Copy & Paste" \\ Special / Tab:\tNewline\r\n (Test)'
      }
    ]);

    const sessRes13 = await makeRequest('GET', '/api/sap/sessions', null, authHeaders);
    assert.strictEqual(sessRes13.status, 200);
    assert.strictEqual(sessRes13.data.sessions[0].user, 'SPECIAL_USER');
    assert.ok(sessRes13.data.sessions[0].title.includes('BOM'));
    console.log('   ✓ Special characters in titles handled safely without JSON parsing issues');

    // -------------------------------------------------------------
    // Scenario 14: Cross-client sessions
    // -------------------------------------------------------------
    console.log('\n14. Testing cross-client sessions (distinct IDs):');
    resetSelectedSapSession();
    setMockSapSessions([
      { user: 'ACCESS1', system: 'S4A', client: '100', connectionIndex: 0, sessionIndex: 0 },
      { user: 'ACCESS1', system: 'S4A', client: '500', connectionIndex: 0, sessionIndex: 1 }
    ]);

    const sessRes14 = await makeRequest('GET', '/api/sap/sessions', null, authHeaders);
    assert.strictEqual(sessRes14.data.sessions.length, 2);
    const id1 = sessRes14.data.sessions[0].id;
    const id2 = sessRes14.data.sessions[1].id;
    assert.notStrictEqual(id1, id2, 'Cross-client sessions must have distinct IDs');
    assert.ok(id1.includes('100') && id2.includes('500'));
    console.log('   ✓ Same user across different SAP clients generates distinct, unambiguous session IDs');

    // -------------------------------------------------------------
    // Scenario 15: Cross-system sessions
    // -------------------------------------------------------------
    console.log('\n15. Testing cross-system sessions:');
    resetSelectedSapSession();
    setMockSapSessions([
      { user: 'ACCESS1', system: 'S4A', client: '500', connectionIndex: 0, sessionIndex: 0 },
      { user: 'ACCESS1', system: 'ECC', client: '500', connectionIndex: 1, sessionIndex: 0 }
    ]);

    const sessRes15 = await makeRequest('GET', '/api/sap/sessions', null, authHeaders);
    assert.strictEqual(sessRes15.data.sessions.length, 2);
    const sysId1 = sessRes15.data.sessions[0].id;
    const sysId2 = sessRes15.data.sessions[1].id;
    assert.notStrictEqual(sysId1, sysId2, 'Cross-system sessions must have distinct IDs');
    assert.ok(sysId1.includes('s4a') && sysId2.includes('ecc'));
    console.log('   ✓ Cross-system sessions safely distinguished by system key in session ID');

    // -------------------------------------------------------------
    // Scenario 16: Concurrent API calls use selected session consistently
    // -------------------------------------------------------------
    console.log('\n16. Testing concurrent API calls consistency:');
    resetSelectedSapSession();
    setMockSapSessions([
      { user: 'CONCURRENT_1', system: 'S4A', client: '500', connectionIndex: 0, sessionIndex: 0 },
      { user: 'CONCURRENT_2', system: 'S4A', client: '500', connectionIndex: 0, sessionIndex: 1 }
    ]);
    setSelectedSapSessionId('sess_s4a_500_concurrent_2_0_1', 'CONCURRENT_2');

    const promises = Array.from({ length: 6 }, () =>
      makeRequest('GET', '/api/sap/sessions', null, authHeaders)
    );
    const results = await Promise.all(promises);
    for (const r of results) {
      assert.strictEqual(r.status, 200);
      assert.strictEqual(r.data.selectedUser, 'CONCURRENT_2');
    }
    console.log('   ✓ Concurrent requests consistently target and return the selected session');

    console.log('\n======================================================');
    console.log('✅ ALL 16 MULTI-SESSION SAP GUI TESTS PASSED!');
    console.log('======================================================\n');
  } catch (err) {
    console.error('\n❌ Multi-Session SAP GUI Test Suite Failed:', err);
    process.exit(1);
  } finally {
    resetMockSapSessions();
    if (server) {
      server.close();
    }
  }
}

runSapMultiSessionTests();
