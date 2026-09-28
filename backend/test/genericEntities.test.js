import assert from 'assert';
import http from 'http';
import axios from 'axios';
import app from '../server.js';
import {
  ENTITY_REGISTRY,
  getEntitySchema,
  listAvailableEntities,
  getColumnByName,
  isValidColumn,
  isEditableColumn,
  getSystemPromptEntitiesDescription
} from '../config/entitySchemas/index.js';
import {
  getEntityData,
  getEntityRecordById,
  updateEntityRecord,
  createEntityRecord,
  deleteEntityRecord,
  resetMockData,
  getMockDataCache
} from '../services/sapClient.js';
import { pendingActionStore } from '../services/pendingActions.js';
import { auditLogger } from '../services/auditLog.js';

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

async function runGenericEntitiesTests() {
  console.log('\n--- Starting Generic Multi-Entity Architecture Test Suite ---\n');

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
    resetMockData();
    pendingActionStore.clearAllPendingActions();
    auditLogger.clearAuditLogs();

    // -------------------------------------------------------------
    // Test 1: Schema Registry Integrity
    // -------------------------------------------------------------
    console.log('1. Testing Schema Registry Lookups & Helpers:');
    const entities = listAvailableEntities();
    assert(Array.isArray(entities), 'Entities must be an array');
    assert(entities.length >= 1, 'At least businessPartner entity must be registered');

    const bpSchema = getEntitySchema('businessPartner');
    assert(bpSchema, 'businessPartner schema must exist');
    assert.strictEqual(bpSchema.entityKey, 'businessPartner');
    assert.strictEqual(bpSchema.idField, 'BusinessPartner');
    assert.strictEqual(bpSchema.odataEntitySet, 'A_BusinessPartner');

    // Column lookups
    const nameCol = getColumnByName('businessPartner', 'BusinessPartnerName');
    assert(nameCol, 'Should find BusinessPartnerName column');
    assert.strictEqual(nameCol.editable, true);

    const idCol = getColumnByName('businessPartner', 'BusinessPartner');
    assert(idCol, 'Should find BusinessPartner column');
    assert.strictEqual(idCol.readOnly, true);
    assert.strictEqual(isEditableColumn('businessPartner', 'BusinessPartner'), false);

    const promptText = getSystemPromptEntitiesDescription();
    assert(promptText.includes('businessPartner'), 'Prompt should describe businessPartner');
    assert(promptText.includes('A_BusinessPartner'), 'Prompt should describe odataEntitySet');
    console.log('   ✓ Schema registry and column helpers resolved accurately');

    // -------------------------------------------------------------
    // Test 2: GET /api/entities endpoint
    // -------------------------------------------------------------
    console.log('2. Testing GET /api/entities public endpoint:');
    const entitiesRes = await makeRequest('GET', '/api/entities');
    assert.strictEqual(entitiesRes.status, 200);
    assert(Array.isArray(entitiesRes.data.entities));
    assert(entitiesRes.data.entities.some((e) => e.entityKey === 'businessPartner'));
    console.log(`   ✓ /api/entities returned ${entitiesRes.data.entities.length} registered entity definition(s)`);

    // -------------------------------------------------------------
    // Test 3: Generic Data Layer: getEntityData & getEntityRecordById
    // -------------------------------------------------------------
    console.log('3. Testing Generic getEntityData & getEntityRecordById:');
    const dataRes = await getEntityData('businessPartner', { top: 5, skip: 0 });
    assert(dataRes.d?.results?.length === 5, 'Should return 5 records');
    const firstId = dataRes.d.results[0].BusinessPartner;

    const singleRec = getEntityRecordById('businessPartner', firstId);
    assert(singleRec, `Should find record with ID ${firstId}`);
    assert.strictEqual(singleRec.BusinessPartner, firstId);
    console.log(`   ✓ Generic data layer retrieved records accurately for businessPartner`);

    // -------------------------------------------------------------
    // Test 4: Generic AI Tools: get_entity_data via /api/chat
    // -------------------------------------------------------------
    console.log('4. Testing Generic AI Read Tool (get_entity_data):');
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
                      id: 'call_generic_read_1',
                      type: 'function',
                      function: {
                        name: 'get_entity_data',
                        arguments: JSON.stringify({
                          entityKey: 'businessPartner',
                          filters: [{ column: 'City', operator: 'eq', value: 'Walldorf' }]
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
                content: 'Here are the partners located in Walldorf.'
              }
            }
          ]
        }
      };
    };

    const chatReadRes = await makeRequest('POST', '/api/chat', {
      message: 'Show me partners in Walldorf'
    });

    assert.strictEqual(chatReadRes.status, 200);
    assert.strictEqual(chatReadRes.data.error, false);
    assert(Array.isArray(chatReadRes.data.data));
    assert(chatReadRes.data.data.length > 0);
    console.log(`   ✓ get_entity_data successfully returned ${chatReadRes.data.data.length} records`);

    // -------------------------------------------------------------
    // Test 5: Generic Propose Update & Confirm
    // -------------------------------------------------------------
    console.log('5. Testing Generic propose_update_entity_record & Confirmation:');
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
                      id: 'call_generic_update_1',
                      type: 'function',
                      function: {
                        name: 'propose_update_entity_record',
                        arguments: JSON.stringify({
                          entityKey: 'businessPartner',
                          recordId: '1001',
                          changes: { City: 'Heidelberg' }
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
                content: 'I have prepared the update proposal for Business Partner 1001.'
              }
            }
          ]
        }
      };
    };

    const proposeUpdateRes = await makeRequest('POST', '/api/chat', {
      message: 'Update city of partner 1001 to Heidelberg'
    });

    assert.strictEqual(proposeUpdateRes.status, 200);
    assert(proposeUpdateRes.data.proposedAction, 'Should return proposedAction');
    assert.strictEqual(proposeUpdateRes.data.proposedAction.entityKey, 'businessPartner');
    assert.strictEqual(proposeUpdateRes.data.proposedAction.type, 'update');

    const updateActionId = proposeUpdateRes.data.proposedAction.actionId;

    // Confirm execution
    const confirmUpdateRes = await makeRequest('POST', '/api/chat', {
      confirmAction: updateActionId
    });

    assert.strictEqual(confirmUpdateRes.status, 200);
    assert.strictEqual(confirmUpdateRes.data.error, false);
    assert.strictEqual(confirmUpdateRes.data.actionExecuted.entityKey, 'businessPartner');

    const updatedRec = getEntityRecordById('businessPartner', '1001');
    assert.strictEqual(updatedRec.City, 'Heidelberg');

    const updateAudit = auditLogger.getLogsForPartner('1001', 'businessPartner');
    assert(updateAudit.length >= 1);
    assert.strictEqual(updateAudit[0].entityKey, 'businessPartner');
    console.log('   ✓ Generic propose_update_entity_record confirmed, mutated data, and logged with entityKey');

    // -------------------------------------------------------------
    // Test 6: Generic Propose Create & Confirm
    // -------------------------------------------------------------
    console.log('6. Testing Generic propose_create_entity_record & Confirmation:');
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
                      id: 'call_generic_create_1',
                      type: 'function',
                      function: {
                        name: 'propose_create_entity_record',
                        arguments: JSON.stringify({
                          entityKey: 'businessPartner',
                          fields: {
                            BusinessPartnerName: 'Global Cloud Systems GmbH',
                            Category: '2',
                            City: 'Frankfurt',
                            Country: 'DE'
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
                content: 'I have prepared the creation proposal.'
              }
            }
          ]
        }
      };
    };

    const proposeCreateRes = await makeRequest('POST', '/api/chat', {
      message: 'Create partner Global Cloud Systems in Frankfurt'
    });

    assert.strictEqual(proposeCreateRes.status, 200);
    assert.strictEqual(proposeCreateRes.data.proposedAction.type, 'create');
    assert.strictEqual(proposeCreateRes.data.proposedAction.entityKey, 'businessPartner');

    const createActionId = proposeCreateRes.data.proposedAction.actionId;
    const confirmCreateRes = await makeRequest('POST', '/api/chat', {
      confirmAction: createActionId
    });

    assert.strictEqual(confirmCreateRes.status, 200);
    const createdBp = confirmCreateRes.data.data[0];
    assert(createdBp);
    const createdId = createdBp.BusinessPartner;
    assert.strictEqual(confirmCreateRes.data.actionExecuted.entityKey, 'businessPartner');
    console.log(`   ✓ Generic propose_create_entity_record created new record #${createdId}`);

    // -------------------------------------------------------------
    // Test 7: Generic Propose Delete & Confirm
    // -------------------------------------------------------------
    console.log('7. Testing Generic propose_delete_entity_record & Confirmation:');
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
                      id: 'call_generic_delete_1',
                      type: 'function',
                      function: {
                        name: 'propose_delete_entity_record',
                        arguments: JSON.stringify({
                          entityKey: 'businessPartner',
                          recordId: createdId
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
                content: 'I have prepared the deletion proposal.'
              }
            }
          ]
        }
      };
    };

    const proposeDeleteRes = await makeRequest('POST', '/api/chat', {
      message: `Delete partner ${createdId}`
    });

    assert.strictEqual(proposeDeleteRes.status, 200);
    assert.strictEqual(proposeDeleteRes.data.proposedAction.type, 'delete');

    const deleteActionId = proposeDeleteRes.data.proposedAction.actionId;
    const confirmDeleteRes = await makeRequest('POST', '/api/chat', {
      confirmAction: deleteActionId
    });

    assert.strictEqual(confirmDeleteRes.status, 200);
    assert.strictEqual(getEntityRecordById('businessPartner', createdId), null);
    console.log(`   ✓ Generic propose_delete_entity_record deleted record #${createdId}`);

    // -------------------------------------------------------------
    // Test 8: Proof of Genericity: Register a Mock 2nd Entity dynamically
    // -------------------------------------------------------------
    console.log('8. Testing Extensibility: Adding a 2nd entity (mockSalesOrder) at runtime:');
    const mockSalesOrderSchema = {
      entityKey: 'mockSalesOrder',
      label: 'Sales Orders',
      singularLabel: 'Sales Order',
      description: 'SAP Sales Order header documents and fulfillment statuses.',
      odataEntitySet: 'A_SalesOrder',
      idField: 'SalesOrder',
      nameField: 'SoldToParty',
      mockDataFile: 'salesOrders.json',
      columns: [
        { name: 'SalesOrder', label: 'Order ID', readOnly: true },
        { name: 'SoldToParty', label: 'Customer', editable: true, requiredForCreate: true },
        { name: 'TotalNetAmount', label: 'Net Amount', editable: true, requiredForCreate: true },
        { name: 'TransactionCurrency', label: 'Currency', editable: true, requiredForCreate: true }
      ]
    };

    // 1. Add to registry
    ENTITY_REGISTRY['mockSalesOrder'] = mockSalesOrderSchema;

    // 2. Initialize in-memory cache directly
    const mockOrderData = [
      { SalesOrder: '50001', SoldToParty: 'ABC Corp', TotalNetAmount: '12500.00', TransactionCurrency: 'USD' },
      { SalesOrder: '50002', SoldToParty: 'SAP SE', TotalNetAmount: '98000.00', TransactionCurrency: 'EUR' }
    ];
    getMockDataCache('mockSalesOrder').length = 0;
    getMockDataCache('mockSalesOrder').push(...mockOrderData);

    // Verify listAvailableEntities includes it
    const allEntities = listAvailableEntities();
    assert(allEntities.some((e) => e.entityKey === 'mockSalesOrder'), 'Registry must include mockSalesOrder');

    // Verify dynamic prompt includes it
    const updatedPrompt = getSystemPromptEntitiesDescription();
    assert(updatedPrompt.includes('Sales Orders'), 'Prompt must dynamically document Sales Orders');
    assert(updatedPrompt.includes('A_SalesOrder'), 'Prompt must document A_SalesOrder');

    // Verify getEntityData works for the 2nd entity
    const orderDataRes = await getEntityData('mockSalesOrder', { top: 10 });
    assert.strictEqual(orderDataRes.d.results.length, 2);
    assert.strictEqual(orderDataRes.d.results[0].SalesOrder, '50001');

    // Verify getEntityRecordById works for 2nd entity
    const order50001 = getEntityRecordById('mockSalesOrder', '50001');
    assert(order50001);
    assert.strictEqual(order50001.SoldToParty, 'ABC Corp');

    // Verify updateEntityRecord works for 2nd entity
    const updateOrderRes = await updateEntityRecord('mockSalesOrder', '50001', { TotalNetAmount: '15000.00' });
    assert.strictEqual(updateOrderRes.after.TotalNetAmount, '15000.00');

    // Clean up runtime entity
    delete ENTITY_REGISTRY['mockSalesOrder'];
    console.log('   ✓ 2nd Entity proved 100% plug-and-play with ZERO changes to core client or route logic!');

    // Restore axios and env
    axios.post = originalPost;
    if (prevKey) {
      process.env.OPENROUTER_API_KEY = prevKey;
    } else {
      delete process.env.OPENROUTER_API_KEY;
    }

    console.log('\n=============================================');
    console.log('  ALL GENERIC MULTI-ENTITY TESTS PASSED!  ');
    console.log('=============================================\n');
  } finally {
    server.close();
  }
}

runGenericEntitiesTests().catch((err) => {
  console.error('\n❌ Generic Multi-Entity Test Suite Failed:', err);
  if (server) server.close();
  process.exit(1);
});
