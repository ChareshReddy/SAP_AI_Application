import assert from 'assert';
import http from 'http';
import axios from 'axios';
import app from '../server.js';
import { getEntitySchema } from '../config/entitySchemas/index.js';
import {
  getEntityData,
  getEntityRecordById,
  retriggerInterface,
  resetMockData,
  getMockDataCache
} from '../services/sapClient.js';
import { classifyError } from '../config/errorKnowledgeBase.js';
import { pendingActionStore } from '../services/pendingActions.js';
import { auditLogger } from '../services/auditLog.js';
import { TOOLS } from '../routes/chat.js';

let server;
let baseUrl;

function makeRequest(method, path, body = null, cookie = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    const headers = {};

    if (body) {
      headers['Content-Type'] = 'application/json';
    }
    if (cookie) {
      headers['Cookie'] = cookie;
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

async function runInterfaceMonitoringTests() {
  console.log('\n--- Starting SAP AI Operations Agent: Interface & Application Log Test Suite ---\n');

  // Start test server on ephemeral port
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      const port = server.address().port;
      baseUrl = `http://localhost:${port}`;
      resolve();
    });
  });

  const originalPost = axios.post;
  process.env.OPENROUTER_API_KEY = 'test_openrouter_api_key_valid';
  process.env.OPENROUTER_MODEL = 'test_model';

  try {
    resetMockData();
    pendingActionStore.clearAllPendingActions();
    auditLogger.clearAuditLogs();

    // -------------------------------------------------------------
    // Test 1: Schema registration and query for failed interfaces
    // -------------------------------------------------------------
    console.log('1. Testing interfaceMonitor schema registration and check_failed_interfaces query:');
    const ifaceSchema = getEntitySchema('interfaceMonitor');
    assert(ifaceSchema !== null, 'interfaceMonitor entity must be registered in ENTITY_REGISTRY');
    assert.strictEqual(ifaceSchema.idField, 'interfaceId');
    assert.strictEqual(ifaceSchema.nameField, 'interfaceName');

    const failedRes = await getEntityData('interfaceMonitor', {
      filters: [{ column: 'status', operator: 'eq', value: 'FAILED' }]
    });
    const failedIfaces = failedRes.d?.results || failedRes;
    assert(Array.isArray(failedIfaces) && failedIfaces.length > 0, 'Failed interfaces should not be empty');

    failedIfaces.forEach((iface) => {
      assert.strictEqual(iface.status, 'FAILED', `Interface ${iface.interfaceId} must have status FAILED`);
      assert(iface.failureReason !== null, `Failed interface ${iface.interfaceId} must have failureReason`);
    });

    const failedIds = failedIfaces.map((i) => i.interfaceId);
    assert(failedIds.includes('IF_101'), 'IF_101 must be in failed list');
    assert(failedIds.includes('IF_102'), 'IF_102 must be in failed list');
    assert(failedIds.includes('IF_103'), 'IF_103 must be in failed list');
    assert(failedIds.includes('IF_104'), 'IF_104 must be in failed list');
    assert(failedIds.includes('IF_108'), 'IF_108 must be in failed list');
    assert(!failedIds.includes('IF_105'), 'IF_105 (SUCCESS) must not be in failed list');
    assert(!failedIds.includes('IF_106'), 'IF_106 (SUCCESS) must not be in failed list');
    assert(!failedIds.includes('IF_107'), 'IF_107 (PENDING) must not be in failed list');
    console.log('   ✓ check_failed_interfaces returns only the 5 FAILED interfaces');

    // -------------------------------------------------------------
    // Test 2: Status synonym mapping for interfaces
    // -------------------------------------------------------------
    console.log('2. Testing interface status synonym mapping ("failed" -> "FAILED", "healthy" -> "SUCCESS"):');
    const synFailed = await getEntityData('interfaceMonitor', {
      filters: [{ column: 'status', operator: 'eq', value: 'failed' }]
    });
    const synFailedList = synFailed.d?.results || synFailed;
    assert.strictEqual(synFailedList.length, failedIfaces.length);

    const synSuccess = await getEntityData('interfaceMonitor', {
      filters: [{ column: 'status', operator: 'eq', value: 'healthy' }]
    });
    const synSuccessList = synSuccess.d?.results || synSuccess;
    assert(synSuccessList.length >= 2);
    synSuccessList.forEach((i) => assert.strictEqual(i.status, 'SUCCESS'));
    console.log('   ✓ Status synonyms normalized correctly for interface queries');

    // -------------------------------------------------------------
    // Test 3: classifyError on interface failure reasons
    // -------------------------------------------------------------
    console.log('3. Testing classifyError on interface failure reasons (recoverable vs non-recoverable):');

    // 3a. Recoverable: Gateway timeout HTTP 504
    const t504 = classifyError('Temporary HTTP 504 Gateway Timeout while contacting SAP CPI');
    assert.strictEqual(t504.category, 'TEMPORARY_CONNECTION_LOSS');
    assert.strictEqual(t504.recommendedAction, 'RETRY');
    assert.strictEqual(t504.riskLevel, 2);

    // 3b. Recoverable: SFTP drop
    const sftp = classifyError('SFTP connection lost to bank clearing house during payment file transfer');
    assert.strictEqual(sftp.category, 'SFTP_CONNECTION_FAILURE');
    assert.strictEqual(sftp.recommendedAction, 'RETRY');
    assert.strictEqual(sftp.riskLevel, 2);

    // 3c. Non-recoverable: SSL certificate expired
    const cert = classifyError('Certificate expired on target endpoint: SSL handshake failed');
    assert.strictEqual(cert.category, 'SECURITY_CERTIFICATE_ERROR');
    assert.strictEqual(cert.recommendedAction, 'ESCALATE');
    assert.strictEqual(cert.riskLevel, 3);

    // 3d. Non-recoverable: Payload schema validation failed
    const schemaErr = classifyError('Schema validation failed: Missing tax jurisdiction code in invoice payload');
    assert.strictEqual(schemaErr.category, 'PAYLOAD_VALIDATION_ERROR');
    assert.strictEqual(schemaErr.recommendedAction, 'ESCALATE');
    assert.strictEqual(schemaErr.riskLevel, 3);
    console.log('   ✓ classifyError accurately separates transient connection errors from security/schema faults');

    // -------------------------------------------------------------
    // Test 4: propose_retrigger_interface safety gate blocks non-recoverable interface
    // -------------------------------------------------------------
    console.log('4. Testing propose_retrigger_interface safety gate on non-recoverable interface:');
    let toolCallCapture = null;
    axios.post = async (url, data) => {
      if (url.includes('chat/completions') && data.messages.length === 2) {
        return {
          data: {
            choices: [{
              message: {
                role: 'assistant',
                content: null,
                tool_calls: [{
                  id: 'call_iface_block',
                  type: 'function',
                  function: {
                    name: 'propose_retrigger_interface',
                    arguments: JSON.stringify({ interfaceId: 'IF_103' }) // SSL Cert expired
                  }
                }]
              }
            }]
          }
        };
      }
      if (url.includes('chat/completions') && data.messages.length > 2) {
        toolCallCapture = data.messages.find((m) => m.role === 'tool');
        return {
          data: {
            choices: [{
              message: {
                role: 'assistant',
                content: 'Cannot retrigger IF_103 because endpoint SSL certificate is expired.'
              }
            }]
          }
        };
      }
      return originalPost(url, data);
    };

    const blockRes = await makeRequest('POST', '/api/chat', {
      message: 'Retrigger interface IF_103'
    });

    assert.strictEqual(blockRes.status, 200);
    assert(toolCallCapture !== null);
    const toolResult = JSON.parse(toolCallCapture.content);
    assert(toolResult.error && toolResult.error.includes('SAFETY GATE'));
    assert.strictEqual(blockRes.data.proposedAction, null);
    console.log('   ✓ Safety gate blocked retrigger for IF_103 with SECURITY_CERTIFICATE_ERROR');

    // -------------------------------------------------------------
    // Test 5: propose_retrigger_interface creates dry-run proposal for recoverable interface
    // -------------------------------------------------------------
    console.log('5. Testing propose_retrigger_interface generates dry-run proposal for recoverable interface:');
    axios.post = async (url, data) => {
      if (url.includes('chat/completions') && data.messages.length === 2) {
        return {
          data: {
            choices: [{
              message: {
                role: 'assistant',
                content: null,
                tool_calls: [{
                  id: 'call_iface_allow',
                  type: 'function',
                  function: {
                    name: 'propose_retrigger_interface',
                    arguments: JSON.stringify({ interfaceId: 'IF_101' }) // HTTP 504 Timeout
                  }
                }]
              }
            }]
          }
        };
      }
      if (url.includes('chat/completions') && data.messages.length > 2) {
        return {
          data: {
            choices: [{
              message: {
                role: 'assistant',
                content: 'I have prepared a proposal to retrigger Interface IF_101. Please confirm in the UI.'
              }
            }]
          }
        };
      }
      return originalPost(url, data);
    };

    const allowRes = await makeRequest('POST', '/api/chat', {
      message: 'Retrigger interface IF_101'
    });

    assert.strictEqual(allowRes.status, 200);
    assert(allowRes.data.proposedAction !== null);
    assert.strictEqual(allowRes.data.proposedAction.type, 'retrigger');
    assert.strictEqual(allowRes.data.proposedAction.entityKey, 'interfaceMonitor');
    assert.strictEqual(allowRes.data.proposedAction.preview.interfaceId, 'IF_101');

    const createdActionId = allowRes.data.proposedAction.actionId;
    const currentIfaceBefore = getEntityRecordById('interfaceMonitor', 'IF_101');
    assert.strictEqual(currentIfaceBefore.status, 'FAILED');
    console.log('   ✓ Proposal created, pending action saved, interface status untouched before confirmation');

    // -------------------------------------------------------------
    // Test 6: Human confirmation executes retrigger and creates INC ticket
    // -------------------------------------------------------------
    console.log('6. Testing human confirmation executes retrigger and creates INC ticket:');
    const confirmRes = await makeRequest('POST', '/api/chat', {
      confirmAction: createdActionId
    });

    assert.strictEqual(confirmRes.status, 200);
    assert.strictEqual(confirmRes.data.error, false);
    assert(confirmRes.data.reply.includes('Successfully retriggered Interface IF_101'));

    // Verify Interface status mutated
    const currentIfaceAfter = getEntityRecordById('interfaceMonitor', 'IF_101');
    assert.strictEqual(currentIfaceAfter.status, 'SUCCESS');
    assert.strictEqual(currentIfaceAfter.failureReason, null);

    // Verify Audit log
    const auditLogs = auditLogger.getAuditLogs();
    const retriggerLog = auditLogs.find((l) => l.actionId === createdActionId);
    assert(retriggerLog, 'Audit log entry must exist for retrigger action');
    assert.strictEqual(retriggerLog.actionType, 'retrigger');
    assert.strictEqual(retriggerLog.entityKey, 'interfaceMonitor');
    assert(retriggerLog.ticketId && retriggerLog.ticketId.startsWith('INC-'));
    assert.strictEqual(pendingActionStore.getPendingAction(createdActionId), null);
    console.log(`   ✓ Interface status updated to SUCCESS, ticket generated: ${retriggerLog.ticketId}`);

    // -------------------------------------------------------------
    // Test 7: Application Logs inspection and filtering
    // -------------------------------------------------------------
    console.log('7. Testing applicationLog schema and check_application_logs filtering:');
    const logSchema = getEntitySchema('applicationLog');
    assert(logSchema !== null, 'applicationLog entity must be registered in ENTITY_REGISTRY');
    assert.strictEqual(logSchema.idField, 'logId');
    assert.strictEqual(logSchema.nameField, 'object');

    // Filter by severity ERROR
    const errLogsRes = await getEntityData('applicationLog', {
      filters: [{ column: 'severity', operator: 'eq', value: 'ERROR' }]
    });
    const errLogs = errLogsRes.d?.results || errLogsRes;
    assert(Array.isArray(errLogs) && errLogs.length > 0);
    errLogs.forEach((l) => assert.strictEqual(l.severity, 'ERROR'));

    // Filter by object SD_ORDER
    const sdLogsRes = await getEntityData('applicationLog', {
      filters: [{ column: 'object', operator: 'eq', value: 'SD_ORDER' }]
    });
    const sdLogs = sdLogsRes.d?.results || sdLogsRes;
    assert(sdLogs.length >= 2);
    sdLogs.forEach((l) => assert.strictEqual(l.object, 'SD_ORDER'));

    // Filter by transactionCode VA01
    const va01Res = await getEntityData('applicationLog', {
      filters: [{ column: 'transactionCode', operator: 'eq', value: 'VA01' }]
    });
    const va01Logs = va01Res.d?.results || va01Res;
    assert(va01Logs.length >= 1);
    va01Logs.forEach((l) => assert.strictEqual(l.transactionCode, 'VA01'));

    // Verify applicationLog is read-only (editableColumns is empty)
    assert.deepStrictEqual(logSchema.editableColumns, []);
    console.log('   ✓ Application logs filterable by severity, object, transactionCode and strictly read-only');

    console.log('\n--- All Interface & Application Log tests passed successfully! ---\n');
  } finally {
    axios.post = originalPost;
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  }
}

runInterfaceMonitoringTests().catch((err) => {
  console.error('\n❌ Interface Monitoring Test Suite FAILED:');
  console.error(err);
  if (server) server.close();
  process.exit(1);
});
