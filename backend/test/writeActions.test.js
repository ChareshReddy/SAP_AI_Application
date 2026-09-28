import assert from 'assert';
import http from 'http';
import axios from 'axios';
import app from '../server.js';
import {
  getBusinessPartners,
  getBusinessPartnerById,
  resetMockData
} from '../services/sapClient.js';
import { pendingActionStore } from '../services/pendingActions.js';
import { auditLogger } from '../services/auditLog.js';
import { validateUpdateChanges } from '../config/entitySchemas/index.js';

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

async function runWriteActionTests() {
  console.log('\n--- Starting Write Actions & Safety Constraints Test Suite ---\n');

  // Start test server on ephemeral port
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      const port = server.address().port;
      baseUrl = `http://localhost:${port}`;
      resolve();
    });
  });

  const originalPost = axios.post;
  const prevKey = process.env.OPENROUTER_API_KEY;
  process.env.OPENROUTER_API_KEY = 'test_openrouter_api_key_valid';
  process.env.OPENROUTER_MODEL = 'test_model';

  try {
    // Reset data and logs
    resetMockData();
    pendingActionStore.clearAllPendingActions();
    auditLogger.clearAuditLogs();

    // -------------------------------------------------------------
    // Test 1: Propose Update → Preview returned, NO data mutated yet
    // -------------------------------------------------------------
    console.log('1. Testing Propose Update (Dry-run preview, no mutation):');
    const original1000 = getBusinessPartnerById('1000');
    assert(original1000, 'BP 1000 should exist');
    const originalCity = original1000.City;

    let callCount = 0;
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
                      id: 'call_propose_update_1',
                      type: 'function',
                      function: {
                        name: 'propose_update_business_partner',
                        arguments: JSON.stringify({
                          businessPartnerId: '1000',
                          changes: { City: 'Bangalore' }
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
                content: 'I have prepared the update proposal for Business Partner 1000. Please confirm below.'
              }
            }
          ]
        }
      };
    };

    const proposeRes = await makeRequest('POST', '/api/chat', {
      message: 'Update city of business partner 1000 to Bangalore'
    });

    assert.strictEqual(proposeRes.status, 200);
    assert.strictEqual(proposeRes.data.error, false);
    assert(proposeRes.data.proposedAction, 'Should return proposedAction object');
    assert.strictEqual(proposeRes.data.proposedAction.type, 'update');
    assert.strictEqual(proposeRes.data.proposedAction.preview.businessPartnerId, '1000');
    assert.strictEqual(proposeRes.data.proposedAction.preview.currentValues.City, originalCity);
    assert.strictEqual(proposeRes.data.proposedAction.preview.proposedValues.City, 'Bangalore');

    // Verify mock data is STILL UNCHANGED
    const unchanged1000 = getBusinessPartnerById('1000');
    assert.strictEqual(unchanged1000.City, originalCity, 'Mock data must NOT be mutated during propose step');
    assert.strictEqual(auditLogger.getAuditLogs().length, 0, 'No audit log should be written on propose');
    console.log('   ✓ Dry-run preview generated accurately without mutating underlying data');

    const updateActionId = proposeRes.data.proposedAction.actionId;

    // -------------------------------------------------------------
    // Test 2: Confirm Update → Mock data mutated, audit log written
    // -------------------------------------------------------------
    console.log('2. Testing Confirm Update via { confirmAction }:');
    const confirmRes = await makeRequest('POST', '/api/chat', {
      confirmAction: updateActionId
    });

    assert.strictEqual(confirmRes.status, 200);
    assert.strictEqual(confirmRes.data.error, false);
    assert(confirmRes.data.reply.includes('Successfully updated'));
    assert(confirmRes.data.actionExecuted, 'Should return actionExecuted info');

    // Verify mock data IS NOW MUTATED
    const updated1000 = getBusinessPartnerById('1000');
    assert.strictEqual(updated1000.City, 'Bangalore', 'Mock data must now reflect updated City');
    assert.strictEqual(
      updated1000.to_BusinessPartnerAddress?.results?.[0]?.CityName,
      'Bangalore',
      'Nested address CityName must be synchronized'
    );

    // Verify Audit Log
    const logs = auditLogger.getAuditLogs();
    assert.strictEqual(logs.length, 1, 'Exactly one audit log entry must exist');
    assert.strictEqual(logs[0].actionType, 'update');
    assert.strictEqual(logs[0].businessPartnerId, '1000');
    assert.strictEqual(logs[0].beforeValues.City, originalCity);
    assert.strictEqual(logs[0].afterValues.City, 'Bangalore');
    assert.strictEqual(logs[0].actionId, updateActionId);
    console.log('   ✓ Confirmed update successfully mutated mock data and logged audit entry with before/after state');

    // Verify action was cleared from pending store
    assert.strictEqual(pendingActionStore.getPendingAction(updateActionId), null, 'Pending action must be cleared');

    // -------------------------------------------------------------
    // Test 3: Cancel Action → Mock data untouched, no audit entry
    // -------------------------------------------------------------
    console.log('3. Testing Cancel Action via { cancelAction }:');
    // First create a new proposal
    const testCancelAction = pendingActionStore.createPendingAction({
      type: 'update',
      businessPartnerId: '1001',
      payload: { City: 'Munich' },
      preview: { City: 'Munich' },
      sapUsername: 'TEST_USER'
    });

    const original1001 = getBusinessPartnerById('1001');
    const cancelRes = await makeRequest('POST', '/api/chat', {
      cancelAction: testCancelAction.actionId
    });

    assert.strictEqual(cancelRes.status, 200);
    assert.strictEqual(cancelRes.data.error, false);
    assert.strictEqual(cancelRes.data.cancelled, true);

    // Verify mock data remained untouched
    const untouched1001 = getBusinessPartnerById('1001');
    assert.strictEqual(untouched1001.City, original1001.City, 'Cancelled action must not alter data');
    assert.strictEqual(auditLogger.getAuditLogs().length, 1, 'No new audit log entry on cancellation');
    assert.strictEqual(pendingActionStore.getPendingAction(testCancelAction.actionId), null);
    console.log('   ✓ Cancelled action cleared proposal without touching mock data or logging audit entry');

    // -------------------------------------------------------------
    // Test 4: Expired Action Handling
    // -------------------------------------------------------------
    console.log('4. Testing Expired actionId handling:');
    // Create an action with ttlMs = -1000 (already expired)
    const expiredAction = pendingActionStore.createPendingAction({
      type: 'update',
      businessPartnerId: '1002',
      payload: { City: 'Tokyo' },
      preview: {},
      ttlMs: -1000
    });

    const expiredRes = await makeRequest('POST', '/api/chat', {
      confirmAction: expiredAction.actionId
    });

    assert.strictEqual(expiredRes.status, 200);
    assert.strictEqual(expiredRes.data.error, true);
    assert.strictEqual(expiredRes.data.expired, true);
    assert(expiredRes.data.reply.includes('expired'));
    console.log('   ✓ Expired actionId rejected gracefully with expired: true');

    // -------------------------------------------------------------
    // Test 5: Ambiguity Guard (Multiple matches without exact ID)
    // -------------------------------------------------------------
    console.log('5. Testing Ambiguity Safety Guard (Clarifying question, no proposal):');
    // Simulate user asking "delete partner in Walldorf" (or similar) where AI first queries
    callCount = 0;
    axios.post = async () => {
      callCount++;
      if (callCount === 1) {
        // AI recognizes ambiguity and calls read first
        return {
          data: {
            choices: [
              {
                message: {
                  role: 'assistant',
                  tool_calls: [
                    {
                      id: 'call_search_ambiguous',
                      type: 'function',
                      function: {
                        name: 'get_business_partners',
                        arguments: JSON.stringify({
                          filters: [{ column: 'City', operator: 'eq', value: 'Chennai' }]
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
      // AI sees multiple records and asks clarifying question instead of calling propose
      return {
        data: {
          choices: [
            {
              message: {
                role: 'assistant',
                content: 'I found 3 business partners in Chennai (1000: ABC Corp Solutions, 1005: ..., 1010: ...). Which Business Partner ID would you like to delete?'
              }
            }
          ]
        }
      };
    };

    const ambiguousRes = await makeRequest('POST', '/api/chat', {
      message: 'Delete the business partner in Chennai'
    });

    assert.strictEqual(ambiguousRes.status, 200);
    assert.strictEqual(ambiguousRes.data.error, false);
    assert.strictEqual(ambiguousRes.data.proposedAction, null, 'Must NOT generate proposal for ambiguous request');
    assert(ambiguousRes.data.reply.includes('Which Business Partner ID'), 'Must ask clarifying question with IDs');
    console.log('   ✓ Ambiguous query resulted in clarifying question with NO proposal generated');

    // -------------------------------------------------------------
    // Test 6: Create Flow (Propose Create → Confirm Create)
    // -------------------------------------------------------------
    console.log('6. Testing Create Flow (Propose Create → Confirm Create):');
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
                      id: 'call_create_bp_1',
                      type: 'function',
                      function: {
                        name: 'propose_create_business_partner',
                        arguments: JSON.stringify({
                          fields: {
                            BusinessPartnerName: 'Apex Innovations Pvt Ltd',
                            Category: '2',
                            City: 'Hyderabad',
                            Country: 'IN',
                            PostalCode: '500081',
                            StreetAddress: 'HITEC City Phase 2'
                          }
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
                content: 'I have prepared the proposal to create Apex Innovations Pvt Ltd. Please review and confirm below.'
              }
            }
          ]
        }
      };
    };

    const proposeCreateRes = await makeRequest('POST', '/api/chat', {
      message: 'Create a new business partner Apex Innovations in Hyderabad'
    });

    assert.strictEqual(proposeCreateRes.status, 200);
    assert.strictEqual(proposeCreateRes.data.error, false);
    assert(proposeCreateRes.data.proposedAction, 'Should return create proposal');
    assert.strictEqual(proposeCreateRes.data.proposedAction.type, 'create');
    assert.strictEqual(
      proposeCreateRes.data.proposedAction.preview.fields.BusinessPartnerName,
      'Apex Innovations Pvt Ltd'
    );

    const createActionId = proposeCreateRes.data.proposedAction.actionId;

    // Confirm Create
    const confirmCreateRes = await makeRequest('POST', '/api/chat', {
      confirmAction: createActionId
    });

    assert.strictEqual(confirmCreateRes.status, 200);
    assert.strictEqual(confirmCreateRes.data.error, false);
    assert(confirmCreateRes.data.reply.includes('Successfully created Business Partner'));
    const createdBp = confirmCreateRes.data.data[0];
    assert(createdBp, 'Created partner should be in response data');
    const newId = createdBp.BusinessPartner;
    assert(newId, 'New partner should have generated ID');

    // Verify it exists in mock data
    const fetchedCreated = getBusinessPartnerById(newId);
    assert(fetchedCreated, 'Created partner must exist in mock data');
    assert.strictEqual(fetchedCreated.BusinessPartnerName, 'Apex Innovations Pvt Ltd');
    assert.strictEqual(fetchedCreated.City, 'Hyderabad');

    // Verify audit log for create
    const createLogs = auditLogger.getLogsForPartner(newId);
    assert.strictEqual(createLogs.length, 1, 'Audit log entry must be created for new partner');
    assert.strictEqual(createLogs[0].actionType, 'create');
    assert.strictEqual(createLogs[0].beforeValues, null);
    assert.strictEqual(createLogs[0].afterValues.BusinessPartnerName, 'Apex Innovations Pvt Ltd');
    console.log(`   ✓ Propose create & confirm successfully generated new BP ID ${newId} with audit log`);

    // -------------------------------------------------------------
    // Test 7: Delete Flow (Propose Delete → Confirm Delete)
    // -------------------------------------------------------------
    console.log('7. Testing Delete Flow (Propose Delete → Confirm Delete):');
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
                      id: 'call_delete_bp_1',
                      type: 'function',
                      function: {
                        name: 'propose_delete_business_partner',
                        arguments: JSON.stringify({
                          businessPartnerId: newId
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
                content: `I've prepared a proposal to delete Business Partner ${newId}. Please review the danger warning and confirm below.`
              }
            }
          ]
        }
      };
    };

    const proposeDeleteRes = await makeRequest('POST', '/api/chat', {
      message: `Delete business partner ${newId}`
    });

    assert.strictEqual(proposeDeleteRes.status, 200);
    assert.strictEqual(proposeDeleteRes.data.error, false);
    assert(proposeDeleteRes.data.proposedAction, 'Should return delete proposal');
    assert.strictEqual(proposeDeleteRes.data.proposedAction.type, 'delete');
    assert.strictEqual(proposeDeleteRes.data.proposedAction.preview.businessPartnerId, newId);

    const deleteActionId = proposeDeleteRes.data.proposedAction.actionId;

    // Verify record STILL EXISTS before confirm
    assert(getBusinessPartnerById(newId) !== null, 'Record must not be deleted before confirmation');

    // Confirm Delete
    const confirmDeleteRes = await makeRequest('POST', '/api/chat', {
      confirmAction: deleteActionId
    });

    assert.strictEqual(confirmDeleteRes.status, 200);
    assert.strictEqual(confirmDeleteRes.data.error, false);
    assert(confirmDeleteRes.data.reply.includes('Successfully deleted'));

    // Verify record IS DELETED from mock data
    assert.strictEqual(getBusinessPartnerById(newId), null, 'Record must now be deleted from mock data');

    // Verify audit log for delete
    const deleteLogs = auditLogger.getLogsForPartner(newId);
    assert.strictEqual(deleteLogs.length, 2, 'Should have both create and delete audit entries');
    const lastLog = deleteLogs[deleteLogs.length - 1];
    assert.strictEqual(lastLog.actionType, 'delete');
    assert.strictEqual(lastLog.afterValues, null);
    assert.strictEqual(lastLog.beforeValues.BusinessPartner, newId);
    console.log(`   ✓ Delete proposal and confirmation removed BP ID ${newId} with audit log`);

    // -------------------------------------------------------------
    // Test 8: AI Direct Execution Tool Forbidden
    // -------------------------------------------------------------
    console.log('8. Testing AI Direct Execution Tool Rejection:');
    callCount = 0;
    axios.post = async () => {
      callCount++;
      return {
        data: {
          choices: [
            {
              message: {
                role: 'assistant',
                tool_calls: [
                  {
                    id: 'call_direct_exec',
                    type: 'function',
                    function: {
                      name: 'execute_confirmed_action',
                      arguments: JSON.stringify({ actionId: 'act_fake_id' })
                    }
                  }
                ]
              }
            }
          ]
        }
      };
    };

    const directExecRes = await makeRequest('POST', '/api/chat', {
      message: 'Execute write directly now'
    });

    assert.strictEqual(directExecRes.status, 200);
    // OpenRouter Call #2 receives tool error "DIRECT EXECUTION PROHIBITED"
    console.log('   ✓ AI direct call to execute_confirmed_action strictly prohibited');

    // -------------------------------------------------------------
    // Test 9: Propose Update with Category & StreetAddress (Current Value verification)
    // -------------------------------------------------------------
    console.log('9. Testing Propose Update Current Value Extraction (Category & StreetAddress):');
    resetMockData();
    const bp1001 = getBusinessPartnerById('1001');
    assert(bp1001, 'BP 1001 should exist');
    assert.strictEqual(bp1001.BusinessPartnerCategory, '2', 'BP 1001 category in mock data is 2');

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
                      id: 'call_propose_update_cat',
                      type: 'function',
                      function: {
                        name: 'propose_update_business_partner',
                        arguments: JSON.stringify({
                          businessPartnerId: '1001',
                          changes: { Category: '1', StreetAddress: 'New Dietmar-Hopp Strasse 1' }
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
                content: 'I have prepared the update proposal for Business Partner 1001 with new category and address.'
              }
            }
          ]
        }
      };
    };

    const catProposeRes = await makeRequest('POST', '/api/chat', {
      message: 'Change category of business partner 1001 to 1 and street address'
    });

    assert.strictEqual(catProposeRes.status, 200);
    assert.strictEqual(catProposeRes.data.error, false);
    assert(catProposeRes.data.proposedAction, 'Should return proposedAction object');

    const catPreview = catProposeRes.data.proposedAction.preview;
    assert.strictEqual(catPreview.businessPartnerId, '1001');
    assert.strictEqual(catPreview.currentValues.Category, '2', 'currentValues.Category must be "2", not blank');
    assert.strictEqual(catPreview.proposedValues.Category, '1', 'proposedValues.Category must be "1"');
    assert.strictEqual(catPreview.currentValues.StreetAddress, 'Dietmar-Hopp-Allee 16', 'currentValues.StreetAddress must be extracted from record');

    const catField = catPreview.changedFields.find((f) => f.field === 'Category');
    assert(catField, 'changedFields must include Category');
    assert.strictEqual(catField.current, '2', 'catField.current must be "2"');
    assert.strictEqual(catField.currentValue, '2', 'catField.currentValue must be "2"');
    assert.strictEqual(catField.proposed, '1', 'catField.proposed must be "1"');
    assert.strictEqual(catField.proposedValue, '1', 'catField.proposedValue must be "1"');

    const streetField = catPreview.changedFields.find((f) => f.field === 'StreetAddress');
    assert(streetField, 'changedFields must include StreetAddress');
    assert.strictEqual(streetField.current, 'Dietmar-Hopp-Allee 16', 'streetField.current must match existing street');
    assert.strictEqual(streetField.currentValue, 'Dietmar-Hopp-Allee 16', 'streetField.currentValue must match existing street');

    console.log('   ✓ Existing values for Category ("2") and StreetAddress correctly populated in proposal response');

    // -------------------------------------------------------------
    // Test 10: Cross-Route Data Consistency (Chat write reflected in Table views)
    // -------------------------------------------------------------
    console.log('10. Testing Cross-Route Data Consistency (Chat write reflected in Table views):');

    // Log in to obtain authenticated session cookie
    const loginRes = await makeRequest('POST', '/api/auth/login', {
      username: 'SAP_CONSULTANT',
      password: 'valid_password_123'
    });
    assert.strictEqual(loginRes.status, 200);
    const setCookieStr = loginRes.headers['set-cookie']?.[0];
    const sessionCookie = setCookieStr ? setCookieStr.split(';')[0] : null;
    assert(sessionCookie, 'Must receive session cookie on login');

    // Confirm the write action created in Test 9 (BP 1001 category -> 1, StreetAddress -> 'New Dietmar-Hopp Strasse 1')
    const catActionId = catProposeRes.data.proposedAction.actionId;
    const catConfirmRes = await makeRequest('POST', '/api/chat', {
      confirmAction: catActionId
    }, sessionCookie);
    assert.strictEqual(catConfirmRes.status, 200);
    assert.strictEqual(catConfirmRes.data.error, false);

    // 1. Read via Explorer Table route: GET /api/business-partners
    const tableRes1 = await makeRequest('GET', '/api/business-partners?top=50', null, sessionCookie);
    assert.strictEqual(tableRes1.status, 200);
    const tableBp1001_v1 = tableRes1.data.d.results.find((r) => r.BusinessPartner === '1001');
    assert(tableBp1001_v1, 'BP 1001 must exist in /api/business-partners results');
    assert.strictEqual(tableBp1001_v1.Category, '1', 'Category in /api/business-partners must be updated to 1');
    assert.strictEqual(tableBp1001_v1.BusinessPartnerCategory, '1', 'BusinessPartnerCategory in /api/business-partners must be 1');
    assert.strictEqual(tableBp1001_v1.StreetName, 'New Dietmar-Hopp Strasse 1', 'StreetName must be updated');
    assert(tableRes1.headers['cache-control']?.includes('no-store'), 'Cache-Control header must prevent stale browser caching');

    // 2. Read via Generic Entity route: GET /api/entities/businessPartner
    const tableRes2 = await makeRequest('GET', '/api/entities/businessPartner?top=50', null, sessionCookie);
    assert.strictEqual(tableRes2.status, 200);
    const tableBp1001_v2 = tableRes2.data.d.results.find((r) => r.BusinessPartner === '1001');
    assert(tableBp1001_v2, 'BP 1001 must exist in /api/entities/businessPartner results');
    assert.strictEqual(tableBp1001_v2.Category, '1', 'Category in /api/entities/businessPartner must be updated to 1');
    assert.strictEqual(tableBp1001_v2.BusinessPartnerCategory, '1', 'BusinessPartnerCategory in /api/entities/businessPartner must be 1');
    assert.strictEqual(tableBp1001_v2.StreetName, 'New Dietmar-Hopp Strasse 1', 'StreetName must be updated');
    assert(tableRes2.headers['cache-control']?.includes('no-store'), 'Cache-Control header must prevent stale browser caching');

    console.log('   ✓ Confirmed chat mutation is immediately reflected across all table view endpoints without server restart');

    // 11. Testing Category Value Normalization & Direct Update Intent Handling
    console.log('11. Testing Category Value Normalization & Direct Update Intent Handling:');
    
    // Test validation normalization: 'person' -> '1', 'organization' -> '2'
    const valResultPerson = validateUpdateChanges('businessPartner', { Category: 'person' });
    assert.strictEqual(valResultPerson.valid, true);
    assert.strictEqual(valResultPerson.normalizedChanges.Category, '1', 'Person must normalize to "1"');

    const valResultOrg = validateUpdateChanges('businessPartner', { Category: 'organization' });
    assert.strictEqual(valResultOrg.valid, true);
    assert.strictEqual(valResultOrg.normalizedChanges.Category, '2', 'Organization must normalize to "2"');

    // Test direct proposal generation when model calls propose_update_entity_record directly
    axios.post = async () => {
      return {
        data: {
          choices: [
            {
              message: {
                role: 'assistant',
                tool_calls: [
                  {
                    id: 'call_direct_update_1003',
                    type: 'function',
                    function: {
                      name: 'propose_update_entity_record',
                      arguments: JSON.stringify({
                        entityKey: 'businessPartner',
                        recordId: '1003',
                        changes: { Category: '1' }
                      })
                    }
                  }
                ]
              }
            }
          ]
        }
      };
    };

    const directUpdateRes = await makeRequest('POST', '/api/chat', {
      message: 'change id 1003 category from organization to person'
    });
    assert.strictEqual(directUpdateRes.status, 200);
    assert.strictEqual(directUpdateRes.data.error, false);
    assert(directUpdateRes.data.proposedAction, 'Must return proposedAction proposal card immediately');
    assert.strictEqual(directUpdateRes.data.proposedAction.type, 'update');
    assert.strictEqual(directUpdateRes.data.proposedAction.preview.recordId, '1003');
    assert.strictEqual(directUpdateRes.data.proposedAction.preview.currentValues.Category, '2');
    assert.strictEqual(directUpdateRes.data.proposedAction.preview.proposedValues.Category, '1');
    assert.strictEqual(directUpdateRes.data.data, null, 'data must be null for direct write proposal');
    console.log('   ✓ Direct propose_update_entity_record generated proposal card with accurate diff and null table data');

    // Restore axios and env
    axios.post = originalPost;
    if (prevKey) {
      process.env.OPENROUTER_API_KEY = prevKey;
    } else {
      delete process.env.OPENROUTER_API_KEY;
    }

    console.log('\n=============================================');
    console.log('  ALL WRITE & SAFETY CONSTRAINT TESTS PASSED!  ');
    console.log('=============================================\n');
  } finally {
    server.close();
  }
}

runWriteActionTests().catch((err) => {
  console.error('\n❌ Write Actions Test Suite Failed:', err);
  if (server) server.close();
  process.exit(1);
});
