import assert from 'assert';
import http from 'http';
import axios from 'axios';
import app from '../server.js';
import { getEntitySchema } from '../config/entitySchemas/index.js';
import {
  getEntityData,
  getEntityRecordById,
  reprocessIdoc,
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

async function runIdocMonitoringTests() {
  console.log('\n--- Starting SAP AI Operations Agent: IDoc Monitoring Test Suite ---\n');

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
    // Test 1: Schema registration and query for IDocs
    // -------------------------------------------------------------
    console.log('1. Testing IDoc schema registration and check_failed_idocs query:');
    const idocSchema = getEntitySchema('idoc');
    assert(idocSchema !== null, 'idoc entity must be registered in ENTITY_REGISTRY');
    assert.strictEqual(idocSchema.idField, 'idocNumber');
    assert.strictEqual(idocSchema.nameField, 'idocType');

    const failedRes = await getEntityData('idoc', {
      filters: [{ column: 'status', operator: 'eq', value: '51-Error' }]
    });
    const failedIdocs = failedRes.d?.results || failedRes;
    assert(Array.isArray(failedIdocs) && failedIdocs.length > 0, 'Failed IDocs should not be empty');

    failedIdocs.forEach((idoc) => {
      assert.strictEqual(idoc.status, '51-Error', `IDoc ${idoc.idocNumber} must have status 51-Error`);
    });

    const failedIds = failedIdocs.map((i) => i.idocNumber);
    assert(failedIds.includes('0000000000109201'), '0000000000109201 must be in failed list');
    assert(failedIds.includes('0000000000109202'), '0000000000109202 must be in failed list');
    assert(failedIds.includes('0000000000109203'), '0000000000109203 must be in failed list');
    assert(!failedIds.includes('0000000000109205'), '0000000000109205 (53-Successful) must not be in failed list');
    assert(!failedIds.includes('0000000000109206'), '0000000000109206 (64-Waiting) must not be in failed list');
    assert(!failedIds.includes('0000000000109207'), '0000000000109207 (03-Sent) must not be in failed list');
    console.log('   ✓ check_failed_idocs filters correctly for 51-Error status');

    // -------------------------------------------------------------
    // Test 2: Natural language status synonym translation
    // -------------------------------------------------------------
    console.log('2. Testing IDoc status synonym mapping ("failed" -> "51-Error", "success" -> "53-Successful"):');
    const synonymRes = await getEntityData('idoc', {
      filters: [{ column: 'status', operator: 'eq', value: 'failed' }]
    });
    const synonymIdocs = synonymRes.d?.results || synonymRes;
    assert.strictEqual(synonymIdocs.length, failedIdocs.length, 'Filter with "failed" must match 51-Error records');

    const successRes = await getEntityData('idoc', {
      filters: [{ column: 'status', operator: 'eq', value: 'success' }]
    });
    const successIdocs = successRes.d?.results || successRes;
    assert(successIdocs.length >= 1, 'Filter with "success" must match 53-Successful records');
    assert.strictEqual(successIdocs[0].status, '53-Successful');
    console.log('   ✓ Natural language synonyms translated to exact IDoc status values');

    // -------------------------------------------------------------
    // Test 3: classifyError on IDoc error patterns
    // -------------------------------------------------------------
    console.log('3. Testing IDoc error classification (recoverable vs non-recoverable):');

    // 3a. Recoverable: Gateway connection loss
    const connLossLog = [{ segment: 'EDI_DC40', message: 'Temporary connection loss to SAP gateway during IDoc packet receipt' }];
    const connDiag = classifyError(connLossLog);
    assert.strictEqual(connDiag.category, 'TEMPORARY_CONNECTION_LOSS');
    assert.strictEqual(connDiag.recommendedAction, 'RETRY');
    assert.strictEqual(connDiag.riskLevel, 2);

    // 3b. Recoverable: Lock wait timeout
    const lockLog = [{ segment: 'E1EDK01', message: 'Lock wait timeout exceeded during material reservation; partner system busy' }];
    const lockDiag = classifyError(lockLog);
    assert.strictEqual(lockDiag.category, 'TRANSIENT_SYSTEM_BUSY');
    assert.strictEqual(lockDiag.recommendedAction, 'RETRY');
    assert.strictEqual(lockDiag.riskLevel, 2);

    // 3c. Non-recoverable: Missing partner profile in WE20
    const partnerLog = [{ segment: 'EDI_DC40', message: 'Partner profile missing in WE20 for partner VEND_BOSCH message INVOIC' }];
    const partnerDiag = classifyError(partnerLog);
    assert.strictEqual(partnerDiag.category, 'PARTNER_PROFILE_MISSING');
    assert.strictEqual(partnerDiag.recommendedAction, 'ESCALATE');
    assert.strictEqual(partnerDiag.riskLevel, 3);

    // 3d. Non-recoverable: IDoc segment mapping error
    const segmentLog = [{ segment: 'E1EDL20', message: 'Segment mapping error: Segment E1EDL20 missing mandatory field VBELN' }];
    const segmentDiag = classifyError(segmentLog);
    assert.strictEqual(segmentDiag.category, 'IDOC_SEGMENT_MAPPING_ERROR');
    assert.strictEqual(segmentDiag.recommendedAction, 'ESCALATE');
    assert.strictEqual(segmentDiag.riskLevel, 3);
    console.log('   ✓ Error classifications correctly distinguish RETRY (Level 2) from ESCALATE (Level 3)');

    // -------------------------------------------------------------
    // Test 4: propose_reprocess_idoc Safety Gate blocks non-recoverable IDoc
    // -------------------------------------------------------------
    console.log('4. Testing propose_reprocess_idoc safety gate on non-recoverable IDoc:');
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
                  id: 'call_idoc_block',
                  type: 'function',
                  function: {
                    name: 'propose_reprocess_idoc',
                    arguments: JSON.stringify({ idocNumber: '0000000000109202' }) // WE20 missing
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
                content: 'Cannot reprocess IDoc 0000000000109202 because WE20 partner profile is missing.'
              }
            }]
          }
        };
      }
      return originalPost(url, data);
    };

    const blockRes = await makeRequest('POST', '/api/chat', {
      message: 'Reprocess IDoc 0000000000109202'
    });

    assert.strictEqual(blockRes.status, 200);
    assert(toolCallCapture !== null, 'Tool call message must be sent to LLM');
    const toolResult = JSON.parse(toolCallCapture.content);
    assert(toolResult.error && toolResult.error.includes('SAFETY GATE'), 'Tool response must trigger SAFETY GATE rejection');
    assert.strictEqual(blockRes.data.proposedAction, null, 'No proposal must be created for non-recoverable error');
    console.log('   ✓ Safety gate blocked automated reprocessing of IDoc with PARTNER_PROFILE_MISSING error');

    // -------------------------------------------------------------
    // Test 5: propose_reprocess_idoc allows recoverable IDoc and creates pending action
    // -------------------------------------------------------------
    console.log('5. Testing propose_reprocess_idoc generates dry-run proposal for recoverable IDoc:');
    axios.post = async (url, data) => {
      if (url.includes('chat/completions') && data.messages.length === 2) {
        return {
          data: {
            choices: [{
              message: {
                role: 'assistant',
                content: null,
                tool_calls: [{
                  id: 'call_idoc_allow',
                  type: 'function',
                  function: {
                    name: 'propose_reprocess_idoc',
                    arguments: JSON.stringify({ idocNumber: '0000000000109201' }) // Transient connection loss
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
                content: 'I have prepared a proposal to reprocess IDoc 0000000000109201. Please confirm in the UI.'
              }
            }]
          }
        };
      }
      return originalPost(url, data);
    };

    const allowRes = await makeRequest('POST', '/api/chat', {
      message: 'Reprocess IDoc 0000000000109201'
    });

    assert.strictEqual(allowRes.status, 200);
    assert(allowRes.data.proposedAction !== null, 'Proposal must be returned');
    assert.strictEqual(allowRes.data.proposedAction.type, 'reprocess');
    assert.strictEqual(allowRes.data.proposedAction.entityKey, 'idoc');
    assert.strictEqual(allowRes.data.proposedAction.preview.idocNumber, '0000000000109201');

    const createdActionId = allowRes.data.proposedAction.actionId;
    const storedPending = pendingActionStore.getPendingAction(createdActionId);
    assert(storedPending !== null, 'Action must be stored in pendingActionStore');

    // Verify record is NOT yet modified
    const currentIdocBefore = getEntityRecordById('idoc', '0000000000109201');
    assert.strictEqual(currentIdocBefore.status, '51-Error', 'IDoc status must remain 51-Error before human confirmation');
    console.log('   ✓ Dry-run proposal created, pending action recorded, IDoc status untouched before confirmation');

    // -------------------------------------------------------------
    // Test 6: Human confirmation executes reprocessing and logs audit entry with ticketId
    // -------------------------------------------------------------
    console.log('6. Testing human confirmation executes reprocess and creates INC ticket:');
    const confirmRes = await makeRequest('POST', '/api/chat', {
      confirmAction: createdActionId
    });

    assert.strictEqual(confirmRes.status, 200);
    assert.strictEqual(confirmRes.data.error, false);
    assert(confirmRes.data.reply.includes('Successfully reprocessed IDoc 0000000000109201'));

    // Verify IDoc status mutated in mock store
    const currentIdocAfter = getEntityRecordById('idoc', '0000000000109201');
    assert.strictEqual(currentIdocAfter.status, '53-Successful', 'IDoc status must be updated to 53-Successful');
    assert(currentIdocAfter.errorLog.some((e) => e.message.includes('Status changed to 53-Successful')));

    // Verify Audit log and ticketId
    const auditLogs = auditLogger.getAuditLogs();
    const reprocessLog = auditLogs.find((l) => l.actionId === createdActionId);
    assert(reprocessLog, 'Audit log entry must exist for reprocess action');
    assert.strictEqual(reprocessLog.actionType, 'reprocess');
    assert.strictEqual(reprocessLog.entityKey, 'idoc');
    assert(reprocessLog.ticketId && reprocessLog.ticketId.startsWith('INC-'), `Ticket ID must follow INC-xxxxxx format: ${reprocessLog.ticketId}`);
    assert.strictEqual(pendingActionStore.getPendingAction(createdActionId), null, 'Pending action must be cleared');
    console.log(`   ✓ IDoc status updated to 53-Successful, audit log recorded with ticket: ${reprocessLog.ticketId}`);

    // -------------------------------------------------------------
    // Test 7: Cancellation clears pending proposal without modifying data
    // -------------------------------------------------------------
    console.log('7. Testing proposal cancellation:');
    const cancelAction = pendingActionStore.createPendingAction({
      type: 'reprocess',
      entityKey: 'idoc',
      recordId: '0000000000109204',
      payload: { idocNumber: '0000000000109204' },
      preview: { idocNumber: '0000000000109204' },
      sapUsername: 'TEST_USER',
      sourcePrompt: 'reprocess 0000000000109204'
    });

    const cancelRes = await makeRequest('POST', '/api/chat', {
      cancelAction: cancelAction.actionId
    });

    assert.strictEqual(cancelRes.status, 200);
    assert.strictEqual(cancelRes.data.cancelled, true);
    assert.strictEqual(pendingActionStore.getPendingAction(cancelAction.actionId), null);
    const untouchedIdoc = getEntityRecordById('idoc', '0000000000109204');
    assert.strictEqual(untouchedIdoc.status, '51-Error');
    console.log('   ✓ Proposal cancelled without modifying IDoc status');

    console.log('\n--- All IDoc Monitoring tests passed successfully! ---\n');
  } finally {
    axios.post = originalPost;
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  }
}

runIdocMonitoringTests().catch((err) => {
  console.error('\n❌ IDoc Monitoring Test Suite FAILED:');
  console.error(err);
  if (server) server.close();
  process.exit(1);
});
