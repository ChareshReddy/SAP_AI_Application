import assert from 'assert';
import http from 'http';
import axios from 'axios';
import app from '../server.js';
import { getEntitySchema, resolveEntityKey } from '../config/entitySchemas/index.js';
import { pendingActionStore } from '../services/pendingActions.js';
import { resetMockData } from '../services/sapClient.js';
import { TOOLS } from '../routes/chat.js';

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

async function runBomChatFixTests() {
  console.log('\n--- Starting BOM Routing & Slot-Filling Bug Fix Verification ---\n');

  await new Promise((resolve) => {
    server = app.listen(0, () => {
      const port = server.address().port;
      baseUrl = `http://localhost:${port}`;
      resolve();
    });
  });

  const originalPost = axios.post;
  process.env.OPENROUTER_API_KEY = 'test_key';
  process.env.OPENROUTER_MODEL = 'test_model';
  process.env.USE_MOCK_SAP = 'true';

  try {
    resetMockData();
    pendingActionStore.clearAllPendingActions();

    // -------------------------------------------------------------
    // Test 1: Helper resolution: resolveEntityKey
    // -------------------------------------------------------------
    console.log('1. Testing resolveEntityKey helper for BOM synonyms:');
    assert.strictEqual(resolveEntityKey('bom'), 'bom');
    assert.strictEqual(resolveEntityKey('boms'), 'bom');
    assert.strictEqual(resolveEntityKey('billOfMaterials'), 'bom');
    assert.strictEqual(resolveEntityKey('bills_of_materials'), 'bom');
    assert.strictEqual(resolveEntityKey('CS01'), 'bom');
    assert.strictEqual(resolveEntityKey(null, 'Show me Bills of Materials'), 'bom');
    assert.strictEqual(resolveEntityKey('businessPartner', 'Can you display the BOM list?'), 'bom');
    assert.strictEqual(resolveEntityKey('businessPartner', 'Show me Business Partners'), 'businessPartner');
    console.log('   ✓ resolveEntityKey correctly maps all BOM aliases and message intents');

    // -------------------------------------------------------------
    // Test 2: BUG 1 Fix — Bills of Materials query returns BOM schema & data
    // -------------------------------------------------------------
    console.log('2. Testing BUG 1 Fix: "Bills of Materials" query routing & schema:');
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
                      id: 'call_get_bom_1',
                      type: 'function',
                      function: {
                        name: 'get_entity_data',
                        arguments: JSON.stringify({ entityKey: 'bom' })
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
                content: 'Here are the Bills of Materials.'
              }
            }
          ]
        }
      };
    };

    const bomQueryRes = await makeRequest('POST', '/api/chat', {
      message: 'Bills of Materials'
    });

    assert.strictEqual(bomQueryRes.status, 200);
    assert.strictEqual(bomQueryRes.data.error, false);
    assert.strictEqual(bomQueryRes.data.entityKey, 'bom');
    assert(bomQueryRes.data.schema, 'Response must include schema object');
    assert.strictEqual(bomQueryRes.data.schema.entityKey, 'bom');
    assert.strictEqual(bomQueryRes.data.schema.label, 'Bills of Materials');
    assert(Array.isArray(bomQueryRes.data.data), 'Data must be an array of records');
    assert(bomQueryRes.data.data.length > 0, 'Must return BOM mock records');
    assert(bomQueryRes.data.data[0].material, 'First record must have material');
    assert(bomQueryRes.data.data[0].components, 'First record must have components array');
    console.log(`   ✓ "Bills of Materials" query returns ${bomQueryRes.data.data.length} BOM records with schema.label = "${bomQueryRes.data.schema.label}"`);

    // -------------------------------------------------------------
    // Test 3: BUG 1 Fix — AI defaults to businessPartner but message says "Bills of Materials"
    // -------------------------------------------------------------
    console.log('3. Testing BUG 1 Fix: AI defaults entityKey to businessPartner on a BOM message:');
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
                      id: 'call_get_bom_default_bp',
                      type: 'function',
                      function: {
                        name: 'get_entity_data',
                        arguments: JSON.stringify({ entityKey: 'businessPartner' }) // AI erroneously defaulted
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
                content: 'Here are the requested BOM records.'
              }
            }
          ]
        }
      };
    };

    const bomQueryFallbackRes = await makeRequest('POST', '/api/chat', {
      message: 'Show me Bills of Materials'
    });

    assert.strictEqual(bomQueryFallbackRes.status, 200);
    assert.strictEqual(bomQueryFallbackRes.data.error, false);
    assert.strictEqual(bomQueryFallbackRes.data.entityKey, 'bom', 'Must resolve to bom because message mentions Bills of Materials');
    assert.strictEqual(bomQueryFallbackRes.data.schema.entityKey, 'bom');
    console.log('   ✓ Fallback message intent override correctly routed to BOM schema');

    // -------------------------------------------------------------
    // Test 4: BUG 2 Fix — Slot-filling when required fields (components) are missing
    // -------------------------------------------------------------
    console.log('4. Testing BUG 2 Fix: Missing required fields (components) triggers slot-filling prompt:');
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
                      id: 'call_create_bom_partial',
                      type: 'function',
                      function: {
                        name: 'propose_create_entity_record',
                        arguments: JSON.stringify({
                          entityKey: 'bom',
                          fields: {
                            material: 'SG22',
                            plant: '1710',
                            bomUsage: '1'
                            // components missing!
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
      throw new Error('Call #2 should NOT be called on slot-filling direct prompt!');
    };

    const partialCreateRes = await makeRequest('POST', '/api/chat', {
      message: 'Material Number: SG22, Plant Code: 1710 BOM Usage: 1'
    });

    assert.strictEqual(partialCreateRes.status, 200, 'Must return HTTP 200');
    assert.strictEqual(partialCreateRes.data.error, false, 'error must be false (not a generic error/crash)');
    assert.strictEqual(partialCreateRes.data.proposedAction, null, 'No action proposed yet (waiting for missing slots)');
    assert.strictEqual(partialCreateRes.data.entityKey, 'bom');
    assert(partialCreateRes.data.schema, 'Schema must be returned');
    assert(
      partialCreateRes.data.reply.includes('BOM Components') || partialCreateRes.data.reply.includes('components'),
      `Reply must specifically ask for missing Components. Received: "${partialCreateRes.data.reply}"`
    );
    console.log(`   ✓ Slot-filling prompted specifically for missing components: "${partialCreateRes.data.reply}"`);

    // -------------------------------------------------------------
    // Test 5: Complete BOM Creation succeeds when all required fields are given
    // -------------------------------------------------------------
    console.log('5. Testing complete BOM creation proposal when components are included:');
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
                      id: 'call_create_bom_complete',
                      type: 'function',
                      function: {
                        name: 'propose_create_entity_record',
                        arguments: JSON.stringify({
                          entityKey: 'bom',
                          fields: {
                            material: 'SG22',
                            plant: '1710',
                            bomUsage: '1',
                            components: [
                              { itemCategory: 'L', component: 'COMP-MOTOR-01', quantity: 1, unit: 'EA' }
                            ]
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
                content: "I've prepared a proposal to create Bill of Materials SG22."
              }
            }
          ]
        }
      };
    };

    const completeCreateRes = await makeRequest('POST', '/api/chat', {
      message: 'Create BOM Material SG22 Plant 1710 Usage 1 with component COMP-MOTOR-01'
    });

    assert.strictEqual(completeCreateRes.status, 200);
    assert.strictEqual(completeCreateRes.data.error, false);
    assert(completeCreateRes.data.proposedAction, 'Must return proposedAction');
    assert.strictEqual(completeCreateRes.data.proposedAction.type, 'create');
    assert.strictEqual(completeCreateRes.data.proposedAction.entityKey, 'bom');
    assert.strictEqual(completeCreateRes.data.proposedAction.preview.fields.material, 'SG22');
    console.log('   ✓ Complete BOM creation generates proper dry-run proposal card');

    // -------------------------------------------------------------
    // Test 6: Conversational message without tool calls ("create bom") does NOT crash
    // -------------------------------------------------------------
    console.log('6. Testing conversational message without tool calls ("create bom"):');
    axios.post = async () => {
      return {
        data: {
          choices: [
            {
              message: {
                role: 'assistant',
                content: 'To create a Bill of Materials, please provide the Material Number, Plant Code, BOM Usage, and Components list.'
              }
            }
          ]
        }
      };
    };

    const conversationalRes = await makeRequest('POST', '/api/chat', {
      message: 'create bom'
    });

    assert.strictEqual(conversationalRes.status, 200, 'Must return HTTP 200 without ReferenceError crash');
    assert.strictEqual(conversationalRes.data.error, false);
    assert.strictEqual(conversationalRes.data.entityKey, 'bom');
    assert(conversationalRes.data.schema, 'Schema must be in scope and returned');
    assert.strictEqual(conversationalRes.data.schema.entityKey, 'bom');
    assert(conversationalRes.data.reply.includes('Bill of Materials'));
    console.log('   ✓ Fresh "create bom" message succeeds cleanly without ReferenceError');

    // -------------------------------------------------------------
    // Test 7: propose_copy_bom Tool Exists with Correct Parameters
    // -------------------------------------------------------------
    console.log('7. Testing propose_copy_bom tool registration:');
    const copyBomTool = TOOLS.find((t) => t.function?.name === 'propose_copy_bom');
    assert(copyBomTool, 'propose_copy_bom tool must be registered in TOOLS');
    assert.deepStrictEqual(copyBomTool.function.parameters.required, ['sourceMaterial', 'sourcePlant', 'targetMaterial', 'targetPlant']);
    console.log('   ✓ propose_copy_bom tool registered with all required parameters');

    // -------------------------------------------------------------
    // -------------------------------------------------------------
    // Test 8: Pre-validation Rejection when Source BOM Does Not Exist
    // -------------------------------------------------------------
    console.log('8. Testing propose_copy_bom rejection when source BOM does not exist in plant 1012:');
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
                    id: 'call_propose_copy_bom_1',
                    type: 'function',
                    function: {
                      name: 'propose_copy_bom',
                      arguments: JSON.stringify({
                        sourceMaterial: 'A1BH0214C',
                        sourcePlant: '1012',
                        sourceUsage: '1',
                        targetMaterial: 'A1BH0214C',
                        targetPlant: '1001',
                        targetUsage: '1'
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

    const copyBomRes = await makeRequest('POST', '/api/chat', {
      message: 'create a new BOM for A1BH0214C in plant 1001 by copying from plant 1012'
    });

    assert.strictEqual(copyBomRes.status, 200);
    assert.strictEqual(copyBomRes.data.error, true, 'Must flag error when source BOM does not exist');
    assert.strictEqual(copyBomRes.data.proposedAction, null, 'Must NOT generate a proposal card when source BOM does not exist');
    assert.strictEqual(copyBomRes.data.reply, 'Cannot copy BOM: No BOM exists for material A1BH0214C in plant 1012 with BOM usage 1.');
    console.log('   ✓ propose_copy_bom correctly rejected nonexistent source BOM with clear error message');

    // -------------------------------------------------------------
    // Test 8b: Rule 7 Rejection when Source and Target BOM are Identical
    // -------------------------------------------------------------
    console.log('8b. Testing Rule 7 rejection when source and target BOM are the same:');
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
                    id: 'call_propose_copy_same',
                    type: 'function',
                    function: {
                      name: 'propose_copy_bom',
                      arguments: JSON.stringify({
                        sourceMaterial: 'A1BH0214C',
                        sourcePlant: '1001',
                        sourceUsage: '1',
                        targetMaterial: 'A1BH0214C',
                        targetPlant: '1001',
                        targetUsage: '1'
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

    const sameBomRes = await makeRequest('POST', '/api/chat', {
      message: 'copy BOM for A1BH0214C in plant 1001 to plant 1001'
    });

    assert.strictEqual(sameBomRes.status, 200);
    assert.strictEqual(sameBomRes.data.error, true);
    assert.strictEqual(sameBomRes.data.proposedAction, null);
    assert.strictEqual(sameBomRes.data.reply, 'Source and target BOM are the same. A BOM cannot be copied onto itself.');
    console.log('   ✓ Rule 7 enforced: prevented copying BOM onto itself');

    // -------------------------------------------------------------
    // Test 8c: Successful Proposal when Source BOM Exists
    // -------------------------------------------------------------
    console.log('8c. Testing successful propose_copy_bom when source BOM exists in plant 1001:');
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
                    id: 'call_propose_copy_valid',
                    type: 'function',
                    function: {
                      name: 'propose_copy_bom',
                      arguments: JSON.stringify({
                        sourceMaterial: 'A1BH0214C',
                        sourcePlant: '1001',
                        sourceUsage: '1',
                        targetMaterial: 'A1BH0214C',
                        targetPlant: '1002',
                        targetUsage: '1'
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

    const validCopyRes = await makeRequest('POST', '/api/chat', {
      message: 'create a new BOM for A1BH0214C in plant 1002 by copying from plant 1001'
    });

    assert.strictEqual(validCopyRes.status, 200);
    assert.strictEqual(validCopyRes.data.error, false);
    assert(validCopyRes.data.proposedAction, 'Must return proposedAction object');
    assert.strictEqual(validCopyRes.data.proposedAction.type, 'copy_bom');
    assert.strictEqual(validCopyRes.data.proposedAction.summary, 'Copy BOM from Material A1BH0214C Plant 1001 Usage 1 → to Material A1BH0214C Plant 1002 Usage 1');
    assert.strictEqual(validCopyRes.data.proposedAction.preview.sourcePlant, '1001');
    assert.strictEqual(validCopyRes.data.proposedAction.preview.targetPlant, '1002');
    console.log('   ✓ Valid copy request successfully created pending action card');

    // -------------------------------------------------------------
    // Test 8d: Rejection when requested alternative BOM does not exist
    // -------------------------------------------------------------
    console.log('8d. Testing propose_copy_bom rejection when alternative BOM 9 does not exist:');
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
                    id: 'call_propose_copy_bad_alt',
                    type: 'function',
                    function: {
                      name: 'propose_copy_bom',
                      arguments: JSON.stringify({
                        sourceMaterial: 'A1BH0214C',
                        sourcePlant: '1001',
                        sourceUsage: '1',
                        sourceAltBom: '9',
                        targetMaterial: 'A1BH0214C',
                        targetPlant: '1002',
                        targetUsage: '1'
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

    const badAltCopyRes = await makeRequest('POST', '/api/chat', {
      message: 'create a new BOM for A1BH0214C in plant 1002 by copying alternative BOM 9 from plant 1001'
    });

    assert.strictEqual(badAltCopyRes.status, 200);
    assert.strictEqual(badAltCopyRes.data.error, true);
    assert.strictEqual(badAltCopyRes.data.proposedAction, null);
    assert(badAltCopyRes.data.reply.includes('Alternative 9 does not exist'), `Expected error message about Alternative 9, got: ${badAltCopyRes.data.reply}`);
    console.log('   ✓ propose_copy_bom correctly rejected non-existent alternative BOM');

    // -------------------------------------------------------------
    // Test 8e: Successful Proposal when specific alternative BOM exists (Alt 2)
    // -------------------------------------------------------------
    console.log('8e. Testing propose_copy_bom when alternative BOM 2 exists:');
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
                      id: 'call_propose_copy_alt2',
                      type: 'function',
                      function: {
                        name: 'propose_copy_bom',
                        arguments: JSON.stringify({
                          sourceMaterial: 'A1BH0214C',
                          sourcePlant: '1001',
                          sourceUsage: '1',
                          sourceAltBom: '2',
                          targetMaterial: 'A1BH0214C',
                          targetPlant: '1002',
                          targetUsage: '1'
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
                content: 'Proposal to copy alternative BOM 2 ready.'
              }
            }
          ]
        }
      };
    };

    const goodAltCopyRes = await makeRequest('POST', '/api/chat', {
      message: 'create a new BOM for A1BH0214C in plant 1002 by copying alternative BOM 2 from plant 1001'
    });

    assert.strictEqual(goodAltCopyRes.status, 200);
    assert.strictEqual(goodAltCopyRes.data.error, false);
    assert(goodAltCopyRes.data.proposedAction, 'Must return proposedAction object');
    assert.strictEqual(goodAltCopyRes.data.proposedAction.preview.sourceAltBom, '2');
    console.log('   ✓ propose_copy_bom successfully created proposal for specific alternative BOM 2');

    // -------------------------------------------------------------
    // Test 9: Interceptor when LLM accidentally calls get_entity_data
    // -------------------------------------------------------------
    console.log('9. Testing interceptor if LLM calls get_entity_data on copy-from request with missing source BOM:');
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
                    id: 'call_accidental_read',
                    type: 'function',
                    function: {
                      name: 'get_entity_data',
                      arguments: JSON.stringify({ entityKey: 'bom', filters: [{ column: 'material', value: 'A1BH0214C' }] })
                    }
                  }
                ]
              }
            }
          ]
        }
      };
    };

    const interceptedRes = await makeRequest('POST', '/api/chat', {
      message: 'create a new BOM for A1BH0214C in plant 1001 by copying from plant 1012'
    });

    assert.strictEqual(interceptedRes.status, 200);
    assert.strictEqual(interceptedRes.data.error, true);
    assert.strictEqual(interceptedRes.data.proposedAction, null);
    assert.strictEqual(interceptedRes.data.reply, 'Cannot copy BOM: No BOM exists for material A1BH0214C in plant 1012 with BOM usage 1.');
    console.log('   ✓ Interceptor correctly validated source BOM and rejected nonexistent source with clear error');

    // -------------------------------------------------------------
    // Test 10: propose_delete_bom Tool Exists with Correct Parameters
    // -------------------------------------------------------------
    console.log('10. Testing propose_delete_bom tool registration:');
    const deleteBomTool = TOOLS.find((t) => t.function?.name === 'propose_delete_bom');
    assert(deleteBomTool, 'propose_delete_bom tool must be registered in TOOLS');
    assert.deepStrictEqual(deleteBomTool.function.parameters.required, ['material', 'plant', 'alternativeBom']);
    console.log('   ✓ propose_delete_bom tool registered with all required parameters');

    // -------------------------------------------------------------
    // Test 11: Propose Delete BOM Workflow (ZBOM_COPY)
    // -------------------------------------------------------------
    console.log('11. Testing propose_delete_bom workflow ("delete BOM for A1BH0214C in plant 1001 alternative BOM 2"):');
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
                      id: 'call_propose_del_bom_1',
                      type: 'function',
                      function: {
                        name: 'propose_delete_bom',
                        arguments: JSON.stringify({
                          material: 'A1BH0214C',
                          plant: '1001',
                          alternativeBom: '2',
                          bomUsage: '1'
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
                content: 'I have prepared a proposal to delete BOM for Material A1BH0214C in Plant 1001 (Alternative BOM 2). Please review and confirm the action card.'
              }
            }
          ]
        }
      };
    };

    const delBomRes = await makeRequest('POST', '/api/chat', {
      message: 'delete BOM for A1BH0214C in plant 1001 alternative BOM 2'
    });

    assert.strictEqual(delBomRes.status, 200);
    assert.strictEqual(delBomRes.data.error, false);
    assert.strictEqual(delBomRes.data.entityKey, 'bom');
    assert(delBomRes.data.proposedAction, 'Must return proposedAction object');
    assert.strictEqual(delBomRes.data.proposedAction.type, 'delete_bom');
    assert.strictEqual(delBomRes.data.proposedAction.preview.material, 'A1BH0214C');
    assert.strictEqual(delBomRes.data.proposedAction.preview.plant, '1001');
    assert.strictEqual(delBomRes.data.proposedAction.preview.alternativeBom, '2');
    assert.strictEqual(delBomRes.data.proposedAction.preview.riskLevel, 3);
    assert(delBomRes.data.proposedAction.preview.warning.includes('permanently delete'));
    console.log('   ✓ propose_delete_bom generated pending action card with danger warning and exact test values');

    // -------------------------------------------------------------
    // Test 12: Interceptor when LLM calls propose_delete_entity_record on BOM
    // -------------------------------------------------------------
    console.log('12. Testing interceptor if LLM calls propose_delete_entity_record on BOM:');
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
                      id: 'call_generic_del_bom',
                      type: 'function',
                      function: {
                        name: 'propose_delete_entity_record',
                        arguments: JSON.stringify({
                          entityKey: 'bom',
                          recordId: 'A1BH0214C',
                          plant: '1001',
                          alternativeBom: '2'
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
                content: 'I have prepared a proposal to delete BOM A1BH0214C.'
              }
            }
          ]
        }
      };
    };

    const interceptedDelRes = await makeRequest('POST', '/api/chat', {
      message: 'delete BOM for A1BH0214C in plant 1001 alternative BOM 2'
    });

    assert.strictEqual(interceptedDelRes.status, 200);
    assert.strictEqual(interceptedDelRes.data.error, false);
    assert(interceptedDelRes.data.proposedAction, 'Interceptor must generate delete proposal card');
    assert.strictEqual(interceptedDelRes.data.proposedAction.type, 'delete_bom');
    console.log('   ✓ Interceptor correctly routed generic delete to delete_bom proposal');

    // -------------------------------------------------------------
    // Test 13: Confirmation Gate Enforced — No Execution Occurs on Proposal
    // -------------------------------------------------------------
    console.log('13. Testing confirmation gate safety: proposal does NOT execute delete:');
    assert.strictEqual(delBomRes.data.actionExecuted, undefined, 'Must not execute action during proposal phase');
    const storedPending = pendingActionStore.getPendingAction(delBomRes.data.proposedAction.actionId);
    assert(storedPending, 'Action must remain pending awaiting human confirmation');
    assert.strictEqual(storedPending.type, 'delete_bom');
    console.log('   ✓ Confirmation gate verified: pending action remains in store without premature execution');

    console.log('\n=============================================');
    console.log('  ALL BOM ROUTING, DELETE & SLOT TESTS PASSED!  ');
    console.log('=============================================\n');
  } finally {
    axios.post = originalPost;
    server.close();
  }
}

runBomChatFixTests().catch((err) => {
  console.error('\n❌ BOM Chat Fix Test Suite Failed:', err);
  if (server) server.close();
  process.exit(1);
});
