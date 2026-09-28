import assert from 'assert';
import http from 'http';
import axios from 'axios';
import app from '../server.js';
import { TOOLS } from '../routes/chat.js';
import { verifyAllToolsSafety, requiresChangeReason } from '../config/riskLevels.js';
import { pendingActionStore } from '../services/pendingActions.js';
import { auditLogger } from '../services/auditLog.js';
import { getMockDataCache, resetMockData } from '../services/sapClient.js';

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

async function runSensitiveActionsTests() {
  console.log('\n--- Starting Level 3 Sensitive Actions & Startup Safety Gate Test Suite ---\n');

  await new Promise((resolve) => {
    server = app.listen(0, () => {
      const port = server.address().port;
      baseUrl = `http://localhost:${port}`;
      resolve();
    });
  });

  process.env.OPENROUTER_API_KEY = 'test_key';
  process.env.OPENROUTER_MODEL = 'test_model';
  const originalPost = axios.post;

  try {
    pendingActionStore.clearAllPendingActions();
    auditLogger.clearAuditLogs();
    resetMockData();

    // 1. Startup Safety Integrity Gate
    console.log('1. Testing Startup Safety Integrity Gate:');
    assert.doesNotThrow(() => {
      verifyAllToolsSafety(TOOLS);
    }, 'Active TOOLS registry must pass safety gate verification');
    console.log('   ✓ Active tools pass security verification cleanly');

    // 2. Safety gate strictly rejects any Risk Level 4 tool injection
    console.log('2. Testing Level 4 Tool Rejection:');
    const dangerousTools = [
      ...TOOLS,
      {
        type: 'function',
        function: {
          name: 'kernel_memory_purge',
          description: 'Purges kernel buffers directly',
          riskLevel: 4
        }
      }
    ];

    assert.throws(
      () => verifyAllToolsSafety(dangerousTools),
      /Critical Level 4 tool detected/,
      'Must throw when a Level 4 tool is detected'
    );
    console.log('   ✓ Injected Level 4 tool strictly blocked with security exception');

    // 3. Safety gate strictly rejects any tool with autoExecute: true
    console.log('3. Testing autoExecute: true Rejection:');
    const autoExecuteTool = [
      ...TOOLS,
      {
        type: 'function',
        function: {
          name: 'autonomous_data_mutation',
          description: 'Mutates without human in the loop',
          autoExecute: true
        }
      }
    ];

    assert.throws(
      () => verifyAllToolsSafety(autoExecuteTool),
      /autoExecute: true/,
      'Must throw when autoExecute: true is present'
    );
    console.log('   ✓ Autonomous autoExecute bypass detected and strictly blocked');

    // 4. Propose Release Purchase Order requires mandatory Reason for Change
    console.log('4. Testing Release Purchase Order Proposal & Mandatory Reason:');
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
                      id: 'call_rel_po_1',
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

    const chatRes = await makeRequest('POST', '/api/chat', {
      message: 'Please release Purchase Order 4500000001'
    });

    assert.strictEqual(chatRes.status, 200);
    assert(chatRes.data.proposedAction, 'Must return proposedAction card');
    const action = chatRes.data.proposedAction;
    assert.strictEqual(action.type, 'release_po');
    assert.strictEqual(action.riskLevel, 3, 'Must be classified as Risk Level 3');
    assert.strictEqual(action.requiresReason, true, 'Must flag requiresReason: true');

    // Attempt confirmation WITHOUT reason -> Must be rejected with HTTP 400
    const rejectRes = await makeRequest('POST', '/api/chat', {
      confirmAction: action.actionId,
      reason: '' // Empty reason
    });

    assert.strictEqual(rejectRes.status, 400, 'Must return 400 when reason is missing');
    assert.strictEqual(rejectRes.data.requiresReason, true);
    assert(pendingActionStore.getPendingAction(action.actionId) !== null, 'Pending action must remain pending');

    // Attempt confirmation WITH valid reason
    const confirmRes = await makeRequest('POST', '/api/chat', {
      confirmAction: action.actionId,
      reason: 'Approved by Head of Sourcing under PO-EXEC-8891'
    });

    assert.strictEqual(confirmRes.status, 200);
    assert.strictEqual(confirmRes.data.error, false);
    assert(confirmRes.data.reply.includes('Successfully released Purchase Order 4500000001'));

    // Verify PO state updated to APPROVED (Released)
    const allPos = getMockDataCache('purchaseOrder');
    const po = allPos.find((p) => p.poNumber === '4500000001');
    assert.strictEqual(po.releaseStatus, 'APPROVED', 'PO releaseStatus must be updated to APPROVED');

    // Verify Audit Log captured reason and before/after
    const logs = auditLogger.getAuditLogs();
    const poLog = logs.find((l) => l.actionId === action.actionId);
    assert(poLog, 'Audit log entry must exist for confirmed action');
    assert.strictEqual(poLog.actionType, 'release_po');
    assert.strictEqual(poLog.reason, 'Approved by Head of Sourcing under PO-EXEC-8891');
    assert.strictEqual(poLog.beforeValues.releaseStatus, 'BLOCKED');
    assert.strictEqual(poLog.afterValues.releaseStatus, 'APPROVED');

    console.log('   ✓ Reason enforcement succeeded and audit log captured business justification');

    // 5. Propose Change Master Data enforces business reason and records audit diff
    console.log('5. Testing Master Data Change Proposal & Justification:');
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
                      id: 'call_cmd_1',
                      type: 'function',
                      function: {
                        name: 'propose_change_master_data',
                        arguments: JSON.stringify({
                          entityKey: 'businessPartner',
                          recordId: '1000',
                          changes: { City: 'Bangalore Tech Park' }
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

    const cmdChatRes = await makeRequest('POST', '/api/chat', {
      message: 'Change Business Partner 1000 city to Bangalore Tech Park'
    });

    assert.strictEqual(cmdChatRes.status, 200);
    const cmdAction = cmdChatRes.data.proposedAction;
    assert.strictEqual(cmdAction.type, 'change_master_data');
    assert.strictEqual(cmdAction.riskLevel, 3);
    assert.strictEqual(cmdAction.requiresReason, true);

    // Confirm with justification
    const cmdConfirmRes = await makeRequest('POST', '/api/chat', {
      confirmAction: cmdAction.actionId,
      reason: 'Office headquarters relocation approved by Legal'
    });

    assert.strictEqual(cmdConfirmRes.status, 200);
    assert.strictEqual(cmdConfirmRes.data.error, false);

    const cmdLogs = auditLogger.getAuditLogs();
    const auditEntry = cmdLogs.find((l) => l.actionId === cmdAction.actionId);
    assert(auditEntry);
    assert.strictEqual(auditEntry.reason, 'Office headquarters relocation approved by Legal');
    assert.strictEqual(auditEntry.afterValues.City, 'Bangalore Tech Park');

    console.log('   ✓ Master data change successfully verified and logged with justification');

    // 6. Propose Post Financial Document enforces reason and records audit
    console.log('6. Testing Financial Document Posting Proposal:');
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
                      id: 'call_fi_1',
                      type: 'function',
                      function: {
                        name: 'propose_post_financial_document',
                        arguments: JSON.stringify({
                          companyCode: '1000',
                          documentType: 'SA',
                          currency: 'EUR',
                          headerText: 'Consulting Fee Accrual',
                          items: [
                            { glAccount: '400000', amount: 5000, debitCredit: 'S', itemText: 'Consulting Expense' },
                            { glAccount: '113100', amount: 5000, debitCredit: 'H', itemText: 'Bank Account' }
                          ]
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

    const fiChatRes = await makeRequest('POST', '/api/chat', {
      message: 'Post financial document for 5000 EUR consulting accrual'
    });

    assert.strictEqual(fiChatRes.status, 200);
    const fiAction = fiChatRes.data.proposedAction;
    assert.strictEqual(fiAction.type, 'post_fi_doc');
    assert.strictEqual(fiAction.riskLevel, 3);

    // Confirm with justification
    const fiConfirmRes = await makeRequest('POST', '/api/chat', {
      confirmAction: fiAction.actionId,
      reason: 'Monthly closing accrual verified by Finance Controller'
    });

    assert.strictEqual(fiConfirmRes.status, 200);
    assert.strictEqual(fiConfirmRes.data.error, false);

    const fiLogs = auditLogger.getAuditLogs();
    const fiLog = fiLogs.find((l) => l.actionId === fiAction.actionId);
    assert(fiLog);
    assert.strictEqual(fiLog.actionType, 'post_fi_doc');
    assert.strictEqual(fiLog.reason, 'Monthly closing accrual verified by Finance Controller');
    assert.strictEqual(fiLog.afterValues.currency, 'EUR');

    console.log('   ✓ Financial Document posted and logged with controller justification');

    console.log('\n======================================================');
    console.log('✅ ALL LEVEL 3 SENSITIVE ACTION TESTS PASSED');
    console.log('======================================================\n');
  } finally {
    axios.post = originalPost;
    if (server) {
      server.close();
    }
  }
}

runSensitiveActionsTests().catch((err) => {
  console.error('\n❌ Sensitive Actions Test Suite Failed:', err);
  if (server) server.close();
  process.exit(1);
});
