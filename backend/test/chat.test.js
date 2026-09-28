import assert from 'assert';
import http from 'http';
import axios from 'axios';
import app from '../server.js';
import { getBusinessPartners } from '../services/sapClient.js';
import { BP_COLUMNS, getSystemPromptColumnDescription } from '../config/businessPartnerSchema.js';
import { isPseudoToolCallContent, validateToolArgs } from '../routes/chat.js';

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

async function runChatTests() {
  console.log('\n--- Starting Dynamic Schema-Aware Chat & Tool Test Suite ---\n');

  // 1. Schema integrity & prompt check
  console.log('1. Testing Schema Definition & Dynamic Prompt Generation:');
  const promptSummary = getSystemPromptColumnDescription();
  for (const col of BP_COLUMNS) {
    assert(promptSummary.includes(col.name), `Prompt description should include column ${col.name}`);
    assert(promptSummary.includes(col.label), `Prompt description should include label for ${col.name}`);
  }
  console.log(`   ✓ All ${BP_COLUMNS.length} schema columns dynamically rendered in prompt description`);

  // 2. Legacy parameter support
  console.log('2. Testing getBusinessPartners backward compatibility (legacy params):');
  const legacyCityRes = await getBusinessPartners({ city: 'Chennai' });
  const legacyCityPartners = legacyCityRes.d?.results || [];
  assert(legacyCityPartners.length > 0, 'Legacy city query should return results');

  const legacyRangeRes = await getBusinessPartners({ fromId: '1000', toId: '1004' });
  const legacyRangePartners = legacyRangeRes.d?.results || [];
  assert.strictEqual(legacyRangePartners.length, 5, 'Legacy range query should return 5 partners');
  console.log('   ✓ Legacy parameters { city } and { fromId, toId } work seamlessly');

  // 3. Dynamic Filter: City exact match (Requirement 7)
  console.log('3. Testing getBusinessPartners with dynamic City eq filter:');
  const dynamicCityRes = await getBusinessPartners({
    filters: [{ column: 'City', operator: 'eq', value: 'Chennai' }]
  });
  const dynamicCityPartners = dynamicCityRes.d?.results || [];
  assert(dynamicCityPartners.length > 0, 'Should find partners in Chennai');
  for (const p of dynamicCityPartners) {
    const directCity = (p.City || '').toLowerCase();
    const addrCity = (p.to_BusinessPartnerAddress?.results?.[0]?.CityName || '').toLowerCase();
    assert(directCity === 'chennai' || addrCity === 'chennai', 'Must be in Chennai');
  }
  console.log(`   ✓ Successfully returned ${dynamicCityPartners.length} partners via City eq filter`);

  // 4. Dynamic Filter: ID Range ge/le filters (Requirement 7)
  console.log('4. Testing getBusinessPartners with dynamic ID range ge/le filters:');
  const dynamicRangeRes = await getBusinessPartners({
    filters: [
      { column: 'BusinessPartner', operator: 'ge', value: '1000' },
      { column: 'BusinessPartner', operator: 'le', value: '1004' }
    ]
  });
  const dynamicRangePartners = dynamicRangeRes.d?.results || [];
  assert.strictEqual(dynamicRangePartners.length, 5, 'Should return exactly 5 partners (1000 to 1004)');
  assert.strictEqual(dynamicRangePartners[0].BusinessPartner, '1000');
  assert.strictEqual(dynamicRangePartners[4].BusinessPartner, '1004');
  console.log('   ✓ Successfully returned partners 1000 through 1004 via ge/le filters');

  // 5. Dynamic Filter: Name contains partial text (Requirement 8)
  console.log('5. Testing getBusinessPartners with Name contains "Tech" (Requirement 8):');
  const nameContainsRes = await getBusinessPartners({
    filters: [{ column: 'BusinessPartnerName', operator: 'contains', value: 'Tech' }]
  });
  const nameContainsPartners = nameContainsRes.d?.results || [];
  assert(nameContainsPartners.length > 0, 'Should find partners with "Tech" in their name');
  for (const p of nameContainsPartners) {
    assert(p.BusinessPartnerName.toLowerCase().includes('tech'), `Partner ${p.BusinessPartner} must have Tech in name`);
  }
  console.log(`   ✓ Successfully returned ${nameContainsPartners.length} partners matching Name contains "Tech"`);

  // 6. Dynamic Filter: PostalCode eq match (Requirement 8)
  console.log('6. Testing getBusinessPartners with PostalCode eq "600002" (Requirement 8):');
  const postalRes = await getBusinessPartners({
    filters: [{ column: 'PostalCode', operator: 'eq', value: '600002' }]
  });
  const postalPartners = postalRes.d?.results || [];
  assert(postalPartners.length > 0, 'Should find partners with postal code 600002');
  for (const p of postalPartners) {
    const postal = p.PostalCode || p.to_BusinessPartnerAddress?.results?.[0]?.PostalCode;
    assert.strictEqual(postal, '600002', `Partner ${p.BusinessPartner} must match postal code 600002`);
  }
  console.log(`   ✓ Successfully returned ${postalPartners.length} partners matching PostalCode 600002`);

  // 7. Dynamic Filter: Category + Country combined (Requirement 8)
  console.log('7. Testing getBusinessPartners with Category eq "2" and Country eq "DE" (Requirement 8):');
  const combinedRes = await getBusinessPartners({
    filters: [
      { column: 'Category', operator: 'eq', value: '2' },
      { column: 'Country', operator: 'eq', value: 'DE' }
    ]
  });
  const combinedPartners = combinedRes.d?.results || [];
  assert(combinedPartners.length > 0, 'Should find Category 2 partners in Germany');
  for (const p of combinedPartners) {
    assert.strictEqual(p.BusinessPartnerCategory, '2', 'Must be category 2');
    const country = p.Country || p.to_BusinessPartnerAddress?.results?.[0]?.Country;
    assert.strictEqual(country, 'DE', 'Must be in DE');
  }
  console.log(`   ✓ Successfully returned ${combinedPartners.length} partners matching combined Category + Country filters`);

  // Start HTTP server for /api/chat endpoint testing
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  baseUrl = `http://localhost:${port}`;

  try {
    // 8. Test missing message payload
    console.log('8. Testing /api/chat validation (empty payload):');
    const emptyRes = await makeRequest('POST', '/api/chat', {});
    assert.strictEqual(emptyRes.status, 400);
    assert.strictEqual(emptyRes.data.error, true);
    assert.strictEqual(typeof emptyRes.data.reply, 'string');
    console.log('   ✓ Returned 400 Bad Request with consistent shape { reply, data: null, error: true }');

    // 9. Test missing API key graceful handling
    console.log('9. Testing /api/chat graceful response when OPENROUTER_API_KEY is unset:');
    const prevKey = process.env.OPENROUTER_API_KEY;
    delete process.env.OPENROUTER_API_KEY;

    const noKeyRes = await makeRequest('POST', '/api/chat', { message: 'Show me partners in Chennai' });
    assert.strictEqual(noKeyRes.status, 200);
    assert.strictEqual(noKeyRes.data.notConfigured, true);
    assert.strictEqual(noKeyRes.data.error, true);
    assert(noKeyRes.data.reply.includes('OpenRouter API key is not configured'));
    console.log('   ✓ Returned polite setup guidance without crashing');

    // Set mock key for mock OpenRouter tests
    process.env.OPENROUTER_API_KEY = 'mock-test-key';
    process.env.OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || 'test-model';
    const originalPost = axios.post;

    // 10. Test malformed JSON tool arguments handling
    console.log('10. Testing tool_call with malformed JSON arguments:');
    axios.post = async () => ({
      data: {
        choices: [
          {
            message: {
              role: 'assistant',
              tool_calls: [
                {
                  id: 'call_123',
                  type: 'function',
                  function: {
                    name: 'get_business_partners',
                    arguments: '{ filters: [ { bad_json '
                  }
                }
              ]
            }
          }
        ]
      }
    });

    const malformedRes = await makeRequest('POST', '/api/chat', { message: 'Find partners in Chennai' });
    assert.strictEqual(malformedRes.status, 200);
    assert.strictEqual(malformedRes.data.error, true);
    assert.strictEqual(malformedRes.data.data, null);
    assert.strictEqual(malformedRes.data.reply, 'I had trouble understanding that request — could you rephrase it?');
    console.log('   ✓ Gracefully caught malformed JSON and returned fallback reply');

    // 11. Test dynamic filter validation: all invalid filters
    console.log('11. Testing tool_call with all invalid filters:');
    axios.post = async () => ({
      data: {
        choices: [
          {
            message: {
              role: 'assistant',
              tool_calls: [
                {
                  id: 'call_456',
                  type: 'function',
                  function: {
                    name: 'get_business_partners',
                    arguments: JSON.stringify({
                      filters: [
                        { column: 'NonExistentColumn', operator: 'eq', value: '123' },
                        { column: 'City', operator: 'invalid_op', value: 'Chennai' },
                        { column: 'City', operator: 'eq', value: 'null' }
                      ]
                    })
                  }
                }
              ]
            }
          }
        ]
      }
    });

    const allInvalidRes = await makeRequest('POST', '/api/chat', { message: 'Find partners' });
    assert.strictEqual(allInvalidRes.status, 200);
    assert.strictEqual(allInvalidRes.data.error, true);
    assert.strictEqual(allInvalidRes.data.data, null);
    assert.strictEqual(allInvalidRes.data.reply, 'I had trouble understanding that request — could you rephrase it?');
    console.log('   ✓ Dropped invalid filters and gracefully returned fallback reply when no valid filters remained');

    // 12. Test dynamic filter execution via /api/chat
    console.log('12. Testing successful dynamic tool execution via /api/chat:');
    let callCount = 0;
    axios.post = async (url, payload) => {
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
                      id: 'call_dynamic_1',
                      type: 'function',
                      function: {
                        name: 'get_business_partners',
                        arguments: JSON.stringify({
                          filters: [
                            { column: 'City', operator: 'eq', value: 'Chennai' },
                            { column: 'IgnoredBogusCol', operator: 'eq', value: 'xyz' } // Dropped with warning
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
      return {
        data: {
          choices: [
            {
              message: {
                role: 'assistant',
                content: 'Found 3 business partners located in Chennai.'
              }
            }
          ]
        }
      };
    };

    const dynamicChatRes = await makeRequest('POST', '/api/chat', { message: 'Find partners in Chennai' });
    assert.strictEqual(dynamicChatRes.status, 200);
    assert.strictEqual(dynamicChatRes.data.error, false);
    assert(Array.isArray(dynamicChatRes.data.data), 'Should return fetched records');
    assert.strictEqual(dynamicChatRes.data.data.length, 3, 'Should return 3 Chennai records');
    assert.strictEqual(dynamicChatRes.data.reply, 'Found 3 business partners located in Chennai.');
    console.log('   ✓ Executed dynamic filter tool call, dropped unrecognized column, and returned data + short reply');

    // 13. Test second OpenRouter call failure fallback
    console.log('13. Testing second OpenRouter call failure fallback:');
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
                      id: 'call_fail_test',
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
      const err = new Error('Second call failure');
      err.response = { status: 500, data: { error: 'Internal server error' } };
      throw err;
    };

    const secondCallFailRes = await makeRequest('POST', '/api/chat', { message: 'Find partners in Chennai' });
    assert.strictEqual(secondCallFailRes.status, 200);
    assert.strictEqual(secondCallFailRes.data.error, false);
    assert(Array.isArray(secondCallFailRes.data.data), 'Should return fetched records even if second call failed');
    assert(secondCallFailRes.data.data.length > 0);
    assert(secondCallFailRes.data.reply.includes("Here's what I found"));
    console.log('   ✓ Gracefully fell back to raw data with generic message when second call failed');

    // 14. Test Rate Limit (429) Handling
    console.log('14. Testing rate limit 429 response formatting:');
    axios.post = async () => {
      const err = new Error('Rate limit exceeded');
      err.response = { status: 429, data: { error: 'Rate limit' } };
      throw err;
    };

    const rateLimitRes = await makeRequest('POST', '/api/chat', { message: 'Query' });
    assert.strictEqual(rateLimitRes.status, 429);
    assert.strictEqual(rateLimitRes.data.error, true);
    assert.strictEqual(rateLimitRes.data.isRateLimit, true);
    assert(rateLimitRes.data.reply.includes('rate limit reached'));
    console.log('   ✓ Returned 429 with consistent shape { reply, data: null, error: true, isRateLimit: true }');

    // 15. Test Pseudo-Tool-Call Detection & Graceful Fallback Interception
    console.log('15. Testing pseudo-tool-call text detection and interception:');

    // Unit checks for isPseudoToolCallContent
    assert.strictEqual(
      isPseudoToolCallContent('<tool_call><function=propose_update_entity_record>{"entityKey":"businessPartner","recordId":"1000","changes":{"City":"Bangalore"}}</tool_call>'),
      true,
      'Should detect <tool_call> and <function= tags'
    );
    assert.strictEqual(
      isPseudoToolCallContent('<tool_calls><function_calls></function_calls></tool_calls>'),
      true,
      'Should detect plural tool_calls tags'
    );
    assert.strictEqual(
      isPseudoToolCallContent('[tool_call]function_name()[/tool_call]'),
      true,
      'Should detect bracketed [tool_call] tags'
    );
    assert.strictEqual(
      isPseudoToolCallContent('<tool>{"name":"get_entity_data"}</tool>'),
      true,
      'Should detect <tool> tags'
    );
    assert.strictEqual(
      isPseudoToolCallContent('Here are the business partners located in Chennai.'),
      false,
      'Should not flag standard conversational text'
    );
    assert.strictEqual(
      isPseudoToolCallContent(null),
      false,
      'Should handle null gracefully'
    );
    console.log('   ✓ isPseudoToolCallContent correctly matches pseudo syntax and passes clean text');

    // Integration check: model emits pseudo-syntax in message.content with no tool_calls
    axios.post = async () => {
      return {
        data: {
          choices: [
            {
              message: {
                role: 'assistant',
                content: '<tool_call><function=propose_update_entity_record>{"entityKey":"businessPartner","recordId":"1000","changes":{"City":"Bangalore"}}</tool_call>'
              }
            }
          ]
        }
      };
    };

    const pseudoToolRes = await makeRequest('POST', '/api/chat', { message: 'Change BP 1000 city to Bangalore' });
    assert.strictEqual(pseudoToolRes.status, 200);
    assert.strictEqual(pseudoToolRes.data.error, true);
    assert.strictEqual(pseudoToolRes.data.data, null);
    assert.strictEqual(
      pseudoToolRes.data.reply,
      'I had trouble understanding that request — could you rephrase it?',
      'Should intercept pseudo-syntax and return friendly fallback'
    );
    assert(!pseudoToolRes.data.reply.includes('<tool_call>'), 'Must not leak raw tool call tags to user');
    console.log('   ✓ Intercepted raw pseudo-tool-call text and returned graceful fallback without tag leakage');

    // 16. Test Empty/Omitted Filters Validation & Short Confirmation Context ('show'/'yes')
    console.log('16. Testing empty/omitted filters validation & context confirmation:');

    // Unit tests for validateToolArgs
    const resOmitted = validateToolArgs('businessPartner', { entityKey: 'businessPartner' });
    assert.strictEqual(resOmitted.valid, true, 'Omitted filters should be valid');
    assert.strictEqual(resOmitted.filters.length, 0);

    const resEmptyArray = validateToolArgs('businessPartner', { entityKey: 'businessPartner', filters: [] });
    assert.strictEqual(resEmptyArray.valid, true, 'Empty filters array should be valid');
    assert.strictEqual(resEmptyArray.filters.length, 0);

    const resEmptyObj = validateToolArgs('businessPartner', {});
    assert.strictEqual(resEmptyObj.valid, true, 'Empty object should be valid');

    const resTopOnly = validateToolArgs('businessPartner', { top: 10 });
    assert.strictEqual(resTopOnly.valid, true, 'Top only should be valid');

    const resBadType = validateToolArgs('businessPartner', { filters: 'invalid_string' });
    assert.strictEqual(resBadType.valid, false, 'Non-array filters must be invalid');

    console.log('   ✓ validateToolArgs accepts omitted or empty filters and rejects malformed types');

    // Integration test: User replies "show" with prior conversation history
    callCount = 0;
    axios.post = async (url, payload) => {
      callCount++;
      if (callCount === 1) {
        // Assert history is passed into OpenRouter messages
        const assistantTurn = payload.messages.find(
          (m) => m.role === 'assistant' && m.content.includes('Want me to pull a few records')
        );
        assert(assistantTurn, 'OpenRouter messages payload must contain the prior assistant offer');

        // Verify trailing message deduplication: user message "show" should only appear once
        const userTurns = payload.messages.filter((m) => m.role === 'user' && m.content === 'show');
        assert.strictEqual(userTurns.length, 1, 'User turn "show" must appear exactly once');

        return {
          data: {
            choices: [
              {
                message: {
                  role: 'assistant',
                  tool_calls: [
                    {
                      id: 'call_show_default',
                      type: 'function',
                      function: {
                        name: 'get_entity_data',
                        arguments: JSON.stringify({
                          entityKey: 'businessPartner',
                          filters: []
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
                content: 'Here are the business partners you requested.'
              }
            }
          ]
        }
      };
    };

    const confirmRes = await makeRequest('POST', '/api/chat', {
      message: 'show',
      history: [
        { role: 'assistant', content: 'Want me to pull a few records to browse?' }
      ]
    });

    assert.strictEqual(confirmRes.status, 200);
    assert.strictEqual(confirmRes.data.error, false);
    assert(Array.isArray(confirmRes.data.data), 'Must return records for empty filter query');
    assert(confirmRes.data.data.length > 0, 'Must return default mock records');
    assert.strictEqual(confirmRes.data.reply, 'Here are the business partners you requested.');
    console.log('   ✓ Short response "show" successfully returned default records using multi-turn context');

    // Restore axios and env
    axios.post = originalPost;
    if (prevKey) {
      process.env.OPENROUTER_API_KEY = prevKey;
    } else {
      delete process.env.OPENROUTER_API_KEY;
    }

    console.log('\n=============================================');
    console.log('  ALL DYNAMIC SCHEMA CHAT TESTS PASSED!  ');
    console.log('=============================================\n');
  } finally {
    server.close();
  }
}

runChatTests().catch((err) => {
  console.error('\n❌ Chat Test Suite Failed:', err);
  if (server) server.close();
  process.exit(1);
});
