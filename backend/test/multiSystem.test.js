import assert from 'assert';
import http from 'http';
import axios from 'axios';
import app from '../server.js';
import {
  SYSTEM_REGISTRY,
  DEFAULT_SYSTEM,
  listSystems,
  isValidSystemKey,
  getSystemConfig
} from '../config/systemRegistry.js';
import { resolveSapBaseUrl } from '../services/sapClient.js';
import { pendingActionStore } from '../services/pendingActions.js';
import { auditLogger } from '../services/auditLog.js';
import { resetMockData } from '../services/sapClient.js';

let server;
let baseUrl;

function makeRequest(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    const headers = {};

    if (body) {
      headers['Content-Type'] = 'application/json';
    }

    const req = http.request(url, { method, headers }, (res) => {
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

async function runMultiSystemTests() {
  console.log('\n--- Starting Multi-System Routing & Environment Safeguards Test Suite ---\n');

  await new Promise((resolve) => {
    server = app.listen(0, () => {
      const port = server.address().port;
      baseUrl = `http://localhost:${port}`;
      resolve();
    });
  });

  const prevMock = process.env.USE_MOCK_SAP;
  process.env.USE_MOCK_SAP = 'true';
  process.env.OPENROUTER_API_KEY = 'test_key';
  process.env.OPENROUTER_MODEL = 'test_model';
  const originalPost = axios.post;

  try {
    pendingActionStore.clearAllPendingActions();
    auditLogger.clearAuditLogs();
    resetMockData();

    // 1. System Registry Configuration
    console.log('1. Testing System Registry Configuration:');
    assert.strictEqual(DEFAULT_SYSTEM, 'DEV');
    const systems = listSystems();
    assert.strictEqual(systems.length, 3, 'Must support 3 standard environments (DEV, QA, PROD)');
    assert(isValidSystemKey('DEV'));
    assert(isValidSystemKey('QA'));
    assert(isValidSystemKey('PROD'));
    assert(!isValidSystemKey('INVALID_SYS'));

    const prodConfig = getSystemConfig('PROD');
    assert.strictEqual(prodConfig.isProd, true);
    assert.strictEqual(prodConfig.requiresDoubleConfirmation, true);
    console.log('   ✓ DEV, QA, and PROD configurations validated');

    // 2. Multi-System Base URL Resolution
    console.log('2. Testing Base URL Resolution:');
    const devUrl = resolveSapBaseUrl('DEV');
    const qaUrl = resolveSapBaseUrl('QA');
    const prodUrl = resolveSapBaseUrl('PROD');
    assert(Boolean(devUrl) && (devUrl.includes('dev') || devUrl.includes('sandbox') || devUrl.startsWith('http')));
    assert(qaUrl.includes('qa') || qaUrl.includes('staging') || qaUrl.includes('s4hanaqa'));
    assert(prodUrl.includes('prod') || prodUrl.includes('s4hanaprod'));
    assert.notStrictEqual(devUrl, prodUrl, 'DEV and PROD URLs must be distinct');
    console.log('   ✓ Environments resolve to isolated target endpoints');

    // 3. Public GET /api/systems endpoint
    console.log('3. Testing GET /api/systems API:');
    const sysRes = await makeRequest('GET', '/api/systems');
    assert.strictEqual(sysRes.status, 200);
    assert.strictEqual(sysRes.data.defaultSystem, 'DEV');
    assert.strictEqual(sysRes.data.systems.length, 3);
    console.log('   ✓ /api/systems returned registered system environments');

    // 4. PROD Safeguard: Double-Confirmation Keyword 'CONFIRM'
    console.log('4. Testing PROD Double-Confirmation Safeguard on Level 3 Action:');
    axios.post = async (url, payload) => {
      if (url.includes('chat/completions')) {
        return {
          data: {
            choices: [
              {
                message: {
                  role: 'assistant',
                  content: null,
                  tool_calls: [
                    {
                      id: 'call_prod_po_1',
                      type: 'function',
                      function: {
                        name: 'propose_release_purchase_order',
                        arguments: JSON.stringify({
                          poNumber: '4500000002'
                        })
                      }
                    }
                  ]
                }
              }
            ]
          }
        };
      }
      return originalPost(url, payload);
    };

    // Send proposal request targeted to PROD
    const prodChatRes = await makeRequest('POST', '/api/chat', {
      message: 'Release PO 4500000002 in Production',
      systemKey: 'PROD'
    });

    assert.strictEqual(prodChatRes.status, 200);
    const prodAction = prodChatRes.data.proposedAction;
    assert.strictEqual(prodAction.systemKey, 'PROD');
    assert.strictEqual(prodAction.riskLevel, 3);

    // Attempt 1: Confirm with valid reason BUT without prodConfirmation keyword -> Rejection
    const noConfirmWordRes = await makeRequest('POST', '/api/chat', {
      confirmAction: prodAction.actionId,
      reason: 'Urgent production shipment required',
      systemKey: 'PROD'
    });
    assert.strictEqual(noConfirmWordRes.status, 400, 'Must reject when CONFIRM keyword is missing in PROD');
    assert.strictEqual(noConfirmWordRes.data.requiresProdConfirm, true);

    // Attempt 2: Confirm with wrong keyword (e.g. 'yes' or lowercase 'confirm') -> Rejection
    const wrongWordRes = await makeRequest('POST', '/api/chat', {
      confirmAction: prodAction.actionId,
      reason: 'Urgent production shipment required',
      prodConfirmation: 'confirm', // lowercase
      systemKey: 'PROD'
    });
    assert.strictEqual(wrongWordRes.status, 400, 'Must reject lowercase confirm');
    assert.strictEqual(wrongWordRes.data.requiresProdConfirm, true);

    // Attempt 3: Confirm with exact uppercase 'CONFIRM' and mandatory reason -> Success
    const successConfirmRes = await makeRequest('POST', '/api/chat', {
      confirmAction: prodAction.actionId,
      reason: 'Urgent production shipment verified by VP Operations',
      prodConfirmation: 'CONFIRM',
      systemKey: 'PROD'
    });
    assert.strictEqual(successConfirmRes.status, 200);
    assert.strictEqual(successConfirmRes.data.error, false);
    assert(successConfirmRes.data.reply.includes('PROD'));

    // Verify Audit log records PROD system
    const logs = auditLogger.getAuditLogs();
    const prodLog = logs.find((l) => l.actionId === prodAction.actionId);
    assert(prodLog);
    assert.strictEqual(prodLog.system, 'PROD');
    assert.strictEqual(prodLog.reason, 'Urgent production shipment verified by VP Operations');

    console.log('   ✓ PROD double-confirmation enforced: requires explicit "CONFIRM" keyword');

    // 5. DEV does NOT require typing "CONFIRM"
    console.log('5. Testing Non-PROD (DEV) does not require double confirmation:');
    axios.post = async (url, payload) => {
      if (url.includes('chat/completions')) {
        return {
          data: {
            choices: [
              {
                message: {
                  role: 'assistant',
                  content: null,
                  tool_calls: [
                    {
                      id: 'call_dev_po_1',
                      type: 'function',
                      function: {
                        name: 'propose_release_purchase_order',
                        arguments: JSON.stringify({
                          poNumber: '4500000001'
                        })
                      }
                    }
                  ]
                }
              }
            ]
          }
        };
      }
      return originalPost(url, payload);
    };

    const devChatRes = await makeRequest('POST', '/api/chat', {
      message: 'Release PO 4500000001 in DEV',
      systemKey: 'DEV'
    });

    assert.strictEqual(devChatRes.status, 200);
    const devAction = devChatRes.data.proposedAction;

    const devConfirmRes = await makeRequest('POST', '/api/chat', {
      confirmAction: devAction.actionId,
      reason: 'DEV testing release cycle',
      systemKey: 'DEV'
      // No prodConfirmation provided
    });

    assert.strictEqual(devConfirmRes.status, 200, 'DEV should confirm with reason without typing CONFIRM');
    assert.strictEqual(devConfirmRes.data.error, false);

    console.log('   ✓ DEV confirmed without requiring PROD double-confirmation keyword');

    console.log('\n======================================================');
    console.log('✅ ALL MULTI-SYSTEM ROUTING & SAFEGUARD TESTS PASSED');
    console.log('======================================================\n');
  } finally {
    process.env.USE_MOCK_SAP = prevMock;
    axios.post = originalPost;
    if (server) {
      server.close();
    }
  }
}

runMultiSystemTests().catch((err) => {
  console.error('\n❌ Multi-System Test Suite Failed:', err);
  if (server) server.close();
  process.exit(1);
});
