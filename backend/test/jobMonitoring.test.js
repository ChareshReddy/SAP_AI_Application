import assert from 'assert';
import http from 'http';
import axios from 'axios';
import app from '../server.js';
import { getEntitySchema } from '../config/entitySchemas/index.js';
import {
  getEntityData,
  getEntityRecordById,
  retryBackgroundJob,
  resetMockData,
  getMockDataCache
} from '../services/sapClient.js';
import { classifyError, ERROR_CATALOGUE } from '../config/errorKnowledgeBase.js';
import { RISK_LEVELS, getRiskLevel, isAutoExecuteAllowed } from '../config/riskLevels.js';
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

async function runJobMonitoringTests() {
  console.log('\n--- Starting SAP AI Operations Agent: Job Monitoring Test Suite ---\n');

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
    // Test 1: check_failed_jobs returns ONLY CANCELLED jobs
    // -------------------------------------------------------------
    console.log('1. Testing check_failed_jobs returns only CANCELLED jobs:');
    const failedJobsResult = await getEntityData('backgroundJob', {
      filters: [{ column: 'status', operator: 'eq', value: 'CANCELLED' }]
    });

    const failedJobs = failedJobsResult.d?.results || failedJobsResult;
    assert(Array.isArray(failedJobs) && failedJobs.length > 0, 'Failed jobs list should not be empty');

    failedJobs.forEach((job) => {
      assert.strictEqual(job.status, 'CANCELLED', `Job ${job.jobId} must have status CANCELLED`);
    });

    const failedJobIds = failedJobs.map((j) => j.jobId);
    assert(failedJobIds.includes('JOB_1001'), 'JOB_1001 must be in CANCELLED list');
    assert(failedJobIds.includes('JOB_1002'), 'JOB_1002 must be in CANCELLED list');
    assert(failedJobIds.includes('JOB_1003'), 'JOB_1003 must be in CANCELLED list');
    assert(failedJobIds.includes('JOB_1004'), 'JOB_1004 must be in CANCELLED list');
    assert(failedJobIds.includes('JOB_1005'), 'JOB_1005 must be in CANCELLED list');

    // Verify non-cancelled jobs are NOT included
    assert(!failedJobIds.includes('JOB_1006'), 'JOB_1006 (FINISHED) must not be returned');
    assert(!failedJobIds.includes('JOB_1007'), 'JOB_1007 (FINISHED) must not be returned');
    assert(!failedJobIds.includes('JOB_1008'), 'JOB_1008 (RUNNING) must not be returned');
    console.log('   ✓ check_failed_jobs returned exactly the 5 CANCELLED jobs, excluding FINISHED/RUNNING');

    // -------------------------------------------------------------
    // Test 2: classifyError correctly classifies each error pattern
    // -------------------------------------------------------------
    console.log('2. Testing classifyError catalogue classification (recoverable vs non-recoverable):');

    // 2a. Database connection timeout (recoverable, Risk Level 2, RETRY)
    const dbErrLog = [{ timestamp: '2026-09-23T04:00:00Z', message: 'SQL error 3114: Connection to SAP HANA database lost', severity: 'ERROR' }];
    const dbDiag = classifyError(dbErrLog);
    assert.strictEqual(dbDiag.category, 'DATABASE_TIMEOUT');
    assert.strictEqual(dbDiag.recommendedAction, 'RETRY');
    assert.strictEqual(dbDiag.riskLevel, 2);

    // 2b. RFC communication failure (recoverable, Risk Level 2, RETRY)
    const rfcErrLog = [{ timestamp: '2026-09-23T04:00:00Z', message: 'RFC_ERROR_COMMUNICATION: CPIC-CALL: CMRCV on conv', severity: 'ERROR' }];
    const rfcDiag = classifyError(rfcErrLog);
    assert.strictEqual(rfcDiag.category, 'RFC_COMMUNICATION_FAILURE');
    assert.strictEqual(rfcDiag.recommendedAction, 'RETRY');
    assert.strictEqual(rfcDiag.riskLevel, 2);

    // 2c. Remote system unavailable (recoverable, Risk Level 2, RETRY)
    const httpErrLog = [{ timestamp: '2026-09-23T04:00:00Z', message: 'HTTP 503 Service Unavailable: Remote endpoint /sap/opu/odata/ unreachable', severity: 'ERROR' }];
    const httpDiag = classifyError(httpErrLog);
    assert.strictEqual(httpDiag.category, 'REMOTE_SYSTEM_UNAVAILABLE');
    assert.strictEqual(httpDiag.recommendedAction, 'RETRY');
    assert.strictEqual(httpDiag.riskLevel, 2);

    // 2d. Missing authorization (non-recoverable, Risk Level 3, ESCALATE)
    const authErrLog = [{ timestamp: '2026-09-23T04:00:00Z', message: 'No authorization for authorization object S_TABU_DIS with ACTVT 02', severity: 'ERROR' }];
    const authDiag = classifyError(authErrLog);
    assert.strictEqual(authDiag.category, 'AUTHORIZATION_MISSING');
    assert.strictEqual(authDiag.recommendedAction, 'ESCALATE');
    assert.strictEqual(authDiag.riskLevel, 3);

    // 2e. Data inconsistency / duplicate key (non-recoverable, Risk Level 3, ESCALATE)
    const dupErrLog = [{ timestamp: '2026-09-23T04:00:00Z', message: 'CX_SY_OPEN_SQL_DB: Duplicate key error inserting into BSEG', severity: 'ERROR' }];
    const dupDiag = classifyError(dupErrLog);
    assert.strictEqual(dupDiag.category, 'DATA_INTEGRITY_CONFLICT');
    assert.strictEqual(dupDiag.recommendedAction, 'ESCALATE');
    assert.strictEqual(dupDiag.riskLevel, 3);

    // 2f. Unknown / Unclassified error (non-recoverable, Risk Level 3, ESCALATE)
    const unknownErrLog = [{ timestamp: '2026-09-23T04:00:00Z', message: 'Something completely unpredicted happened in ABAP stack', severity: 'ERROR' }];
    const unknownDiag = classifyError(unknownErrLog);
    assert.strictEqual(unknownDiag.category, 'UNKNOWN_ERROR');
    assert.strictEqual(unknownDiag.recommendedAction, 'ESCALATE');
    assert.strictEqual(unknownDiag.riskLevel, 3);

    // 2g. Test mock records from dataset
    const job1001 = getEntityRecordById('backgroundJob', 'JOB_1001');
    const diag1001 = classifyError(job1001.jobLog);
    assert.strictEqual(diag1001.category, 'DATABASE_TIMEOUT');
    assert.strictEqual(diag1001.recommendedAction, 'RETRY');
    assert.strictEqual(diag1001.riskLevel, 2);

    const job1003 = getEntityRecordById('backgroundJob', 'JOB_1003');
    const diag1003 = classifyError(job1003.jobLog);
    assert.strictEqual(diag1003.category, 'AUTHORIZATION_MISSING');
    assert.strictEqual(diag1003.recommendedAction, 'ESCALATE');
    assert.strictEqual(diag1003.riskLevel, 3);

    const job1004 = getEntityRecordById('backgroundJob', 'JOB_1004');
    const diag1004 = classifyError(job1004.jobLog);
    assert.strictEqual(diag1004.category, 'DATA_INTEGRITY_CONFLICT');
    assert.strictEqual(diag1004.recommendedAction, 'ESCALATE');
    assert.strictEqual(diag1004.riskLevel, 3);

    console.log('   ✓ classifyError accurately differentiates recoverable (RETRY, Risk 2) vs non-recoverable (ESCALATE, Risk 3)');

    // -------------------------------------------------------------
    // Test 3: propose_retry_job rejected when diagnosis is ESCALATE
    // -------------------------------------------------------------
    console.log('3. Testing propose_retry_job rejected when diagnosis is ESCALATE:');
    let callCount = 0;
    let toolCallCapture = null;

    axios.post = async (_url, payload) => {
      callCount++;
      if (callCount === 1) {
        return {
          data: {
            choices: [
              {
                message: {
                  role: 'assistant',
                  tool_calls: [
                    {
                      id: 'call_propose_retry_nonrec',
                      type: 'function',
                      function: {
                        name: 'propose_retry_job',
                        arguments: JSON.stringify({ jobId: 'JOB_1003' })
                      }
                    }
                  ]
                }
              }
            ]
          }
        };
      }
      // Second call receives tool output
      toolCallCapture = payload?.messages?.slice(-1)[0];
      return {
        data: {
          choices: [
            {
              message: {
                role: 'assistant',
                content: 'Cannot retry JOB_1003 due to missing authorization.'
              }
            }
          ]
        }
      };
    };

    const escalateRes = await makeRequest('POST', '/api/chat', {
      message: 'Retry job JOB_1003'
    });

    assert.strictEqual(escalateRes.status, 200);
    assert.strictEqual(escalateRes.data.proposedAction, null, 'proposedAction must be null when diagnosis is ESCALATE');
    assert(toolCallCapture, 'Second call should have captured tool result');
    assert(
      toolCallCapture.content.includes('SAFETY GATE: Cannot propose retry'),
      `Tool message should contain safety gate rejection. Got: ${toolCallCapture.content}`
    );
    assert(
      toolCallCapture.content.includes('AUTHORIZATION_MISSING'),
      'Tool message should specify AUTHORIZATION_MISSING error category'
    );
    assert.strictEqual(pendingActionStore.size(), 0, 'No pending action should be created');
    console.log('   ✓ Safety gate strictly blocked retry proposal for non-recoverable job JOB_1003');

    // -------------------------------------------------------------
    // Test 4: propose_retry_job creates pendingAction for recoverable error
    // -------------------------------------------------------------
    console.log('4. Testing propose_retry_job creates pendingAction for recoverable error (JOB_1001):');
    callCount = 0;
    toolCallCapture = null;

    axios.post = async (_url, payload) => {
      callCount++;
      if (callCount === 1) {
        return {
          data: {
            choices: [
              {
                message: {
                  role: 'assistant',
                  tool_calls: [
                    {
                      id: 'call_propose_retry_rec',
                      type: 'function',
                      function: {
                        name: 'propose_retry_job',
                        arguments: JSON.stringify({ jobId: 'JOB_1001' })
                      }
                    }
                  ]
                }
              }
            ]
          }
        };
      }
      toolCallCapture = payload?.messages?.slice(-1)[0];
      return {
        data: {
          choices: [
            {
              message: {
                role: 'assistant',
                content: 'I have prepared a proposal to retry JOB_1001. Please confirm in the card above.'
              }
            }
          ]
        }
      };
    };

    const proposeRes = await makeRequest('POST', '/api/chat', {
      message: 'Retry job JOB_1001'
    });

    assert.strictEqual(proposeRes.status, 200);
    const proposedAction = proposeRes.data.proposedAction;
    assert(proposedAction, 'proposedAction should be returned for recoverable job');
    assert.strictEqual(proposedAction.type, 'retry');
    assert.strictEqual(proposedAction.entityKey, 'backgroundJob');
    assert.strictEqual(proposedAction.preview.jobId, 'JOB_1001');
    assert.strictEqual(proposedAction.preview.currentStatus, 'CANCELLED');
    assert.strictEqual(proposedAction.preview.diagnosis.category, 'DATABASE_TIMEOUT');
    assert.strictEqual(proposedAction.preview.diagnosis.riskLevel, 2);
    assert.strictEqual(proposedAction.preview.diagnosis.recommendedAction, 'RETRY');

    // Verify job in cache is STILL CANCELLED before confirmation
    const preConfirmJob = getEntityRecordById('backgroundJob', 'JOB_1001');
    assert.strictEqual(preConfirmJob.status, 'CANCELLED', 'Data must not mutate prior to human confirmation');
    console.log('   ✓ Dry-run retry proposal created pendingAction with Risk Level 2 diagnosis without premature execution');

    // -------------------------------------------------------------
    // Test 5: Confirming retry transitions status, increments retryCount, logs audit entry
    // -------------------------------------------------------------
    console.log('5. Testing confirmation of retry proposal (execution & audit logging):');
    const initialRetryCount = preConfirmJob.retryCount || 0;
    const actionId = proposedAction.actionId;

    const confirmRes = await makeRequest('POST', '/api/chat', {
      confirmAction: actionId
    });

    assert.strictEqual(confirmRes.status, 200);
    assert.strictEqual(confirmRes.data.error, false);
    assert(confirmRes.data.reply.includes('Successfully retried Background Job JOB_1001'));
    assert(confirmRes.data.reply.includes('FINISHED'));

    // Verify cache mutation
    const postConfirmJob = getEntityRecordById('backgroundJob', 'JOB_1001');
    assert.strictEqual(postConfirmJob.status, 'FINISHED', 'Job status must be FINISHED post-execution');
    assert.strictEqual(postConfirmJob.retryCount, initialRetryCount + 1, 'retryCount must be incremented by 1');

    // Verify pending action was cleared
    assert.strictEqual(pendingActionStore.getPendingAction(actionId), null, 'Pending action must be cleared');

    // Verify audit log
    const auditLogs = auditLogger.getAuditLogs();
    const retryLog = auditLogs.find((l) => l.actionType === 'retry' && l.recordId === 'JOB_1001');
    assert(retryLog, 'Audit log entry for retry action must exist');
    assert.strictEqual(retryLog.entityKey, 'backgroundJob');
    assert.strictEqual(retryLog.result, 'SUCCESS');
    assert(typeof retryLog.ticketId === 'string' && /^INC-\d+$/.test(retryLog.ticketId), `ticketId must match INC-xxxxxx pattern. Got: ${retryLog.ticketId}`);
    assert.strictEqual(retryLog.beforeValues.status, 'CANCELLED');
    assert.strictEqual(retryLog.afterValues.status, 'FINISHED');
    console.log(`   ✓ Execution confirmed: status CANCELLED → FINISHED, retryCount ${initialRetryCount} → ${postConfirmJob.retryCount}, Ticket: ${retryLog.ticketId}`);

    // -------------------------------------------------------------
    // Test 6: Risk Level 4 actions have NO tool implementation
    // -------------------------------------------------------------
    console.log('6. Testing that Risk Level 4 actions have NO tool implementation:');
    const toolNames = TOOLS.map((t) => t.function?.name);

    // Verify no destructive or critical execution tools exist
    const forbiddenTools = [
      'delete_job',
      'force_cancel_job',
      'terminate_job',
      'kill_job',
      'emergency_stop',
      'modify_database',
      'drop_table',
      'truncate_table',
      'purge_job_logs'
    ];

    forbiddenTools.forEach((forbidden) => {
      assert(!toolNames.includes(forbidden), `Forbidden tool "${forbidden}" must not exist in TOOLS`);
    });

    // Check riskLevel definitions
    const level4 = getRiskLevel(4);
    assert.strictEqual(level4.level, 4);
    assert.strictEqual(level4.name, 'Critical');
    assert.strictEqual(level4.requiresHumanLead, true);

    // Verify auto-execution is strictly false for Level 2 & Level 4
    assert.strictEqual(isAutoExecuteAllowed(2), false, 'Risk Level 2 must not auto-execute');
    assert.strictEqual(isAutoExecuteAllowed(4), false, 'Risk Level 4 must not auto-execute');

    console.log('   ✓ Verified: NO Risk Level 4 tools exist in TOOLS registry, and Level 2 requires human confirmation');

    // -------------------------------------------------------------
    // Test 7: Cancel Retry Proposal
    // -------------------------------------------------------------
    console.log('7. Testing cancellation of retry proposal:');
    callCount = 0;
    axios.post = async () => {
      callCount++;
      if (callCount === 1) {
        return {
          data: {
            choices: [
              {
                message: {
                  role: 'assistant',
                  tool_calls: [
                    {
                      id: 'call_propose_retry_cancel',
                      type: 'function',
                      function: {
                        name: 'propose_retry_job',
                        arguments: JSON.stringify({ jobId: 'JOB_1002' })
                      }
                    }
                  ]
                }
              }
            ]
          }
        };
      }
      return {
        data: {
          choices: [
            {
              message: {
                role: 'assistant',
                content: 'I have proposed a retry for JOB_1002.'
              }
            }
          ]
        }
      };
    };

    const cancelProposeRes = await makeRequest('POST', '/api/chat', {
      message: 'Retry job JOB_1002'
    });
    const cancelActionId = cancelProposeRes.data.proposedAction.actionId;

    const cancelRes = await makeRequest('POST', '/api/chat', {
      cancelAction: cancelActionId
    });

    assert.strictEqual(cancelRes.status, 200);
    assert.strictEqual(cancelRes.data.cancelled, true);
    assert.strictEqual(pendingActionStore.getPendingAction(cancelActionId), null);

    const untouchedJob = getEntityRecordById('backgroundJob', 'JOB_1002');
    assert.strictEqual(untouchedJob.status, 'CANCELLED', 'Cancelled proposal must leave job CANCELLED');
    console.log('   ✓ Cancel proposal safely cleared pendingAction without modifying job status');

    // -------------------------------------------------------------
    // Test 8: Natural language synonym mapping: "previous run failed" → JOB_1005
    // -------------------------------------------------------------
    console.log('8. Testing natural language synonym mapping: "previous run failed" → returns JOB_1005:');
    resetMockData('backgroundJob');
    
    // 8a: Direct query with synonym 'failed' against previousRunStatus
    const synonymRes = await getEntityData('backgroundJob', {
      filters: [{ column: 'previousRunStatus', operator: 'eq', value: 'failed' }]
    });
    const synonymResults = synonymRes.d?.results || synonymRes;
    assert.strictEqual(synonymResults.length, 1, 'Should find exactly 1 job with previousRunStatus failed');
    assert.strictEqual(synonymResults[0].jobId, 'JOB_1005', 'Should return JOB_1005');
    assert.strictEqual(synonymResults[0].previousRunStatus, 'CANCELLED');
    console.log('   ✓ Direct getEntityData with synonym "failed" successfully resolved to CANCELLED and returned JOB_1005');

    // 8b: Chat flow simulation: model translating "failed" to CANCELLED per SYSTEM_PROMPT
    callCount = 0;
    axios.post = async () => {
      callCount++;
      if (callCount === 1) {
        return {
          data: {
            choices: [
              {
                message: {
                  role: 'assistant',
                  tool_calls: [
                    {
                      id: 'call_get_failed_prev',
                      type: 'function',
                      function: {
                        name: 'get_entity_data',
                        arguments: JSON.stringify({
                          entityKey: 'backgroundJob',
                          filters: [{ column: 'previousRunStatus', operator: 'eq', value: 'CANCELLED' }]
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
      return {
        data: {
          choices: [
            {
              message: {
                role: 'assistant',
                content: 'I found 1 job where the previous run failed (CANCELLED): JOB_1005 (Z_INVENTORY_SYNC_WMS).'
              }
            }
          ]
        }
      };
    };

    const chatPrevFailedRes = await makeRequest('POST', '/api/chat', {
      message: 'I want previous run failed'
    });

    assert.strictEqual(chatPrevFailedRes.status, 200);
    assert.strictEqual(chatPrevFailedRes.data.error, false);
    assert(Array.isArray(chatPrevFailedRes.data.data), 'Chat should return matching data records');
    assert.strictEqual(chatPrevFailedRes.data.data.length, 1);
    assert.strictEqual(chatPrevFailedRes.data.data[0].jobId, 'JOB_1005');
    assert.strictEqual(chatPrevFailedRes.data.data[0].previousRunStatus, 'CANCELLED');
    console.log('   ✓ Chat query "I want previous run failed" correctly returned JOB_1005 matching CANCELLED status');

    console.log('\n=============================================');
    console.log('  ALL JOB MONITORING TESTS PASSED!');
    console.log('=============================================\n');
  } finally {
    axios.post = originalPost;
    resetMockData();
    server.close();
  }
}

runJobMonitoringTests().catch((err) => {
  console.error('\n❌ Job Monitoring Test Suite Failed:', err);
  if (server) server.close();
  process.exit(1);
});
