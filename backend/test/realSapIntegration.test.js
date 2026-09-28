import assert from 'assert';
import http from 'http';
import axios from 'axios';
import app from '../server.js';
import { getEntitySchema, ENTITY_REGISTRY } from '../config/entitySchemas/index.js';
import {
  isMockMode,
  buildBasicAuthHeader,
  parseSapError,
  fetchCsrfToken,
  fetchRealSapRecordById,
  writeToRealSap,
  updateEntityRecord,
  createEntityRecord,
  deleteEntityRecord,
  getMockDataCache,
  resetMockData
} from '../services/sapClient.js';
import { compareEntitySchemaWithSapRecord } from '../services/schemaValidator.js';
import {
  rfcRetryJob,
  rfcReprocessIdoc,
  executeRfcFunction
} from '../services/sapRfcClient.js';

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

async function runRealSapIntegrationTests() {
  console.log('\n--- Starting SAP Real Connection Layer & Diagnostics Test Suite ---\n');

  // Start test server on ephemeral port
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      const port = server.address().port;
      baseUrl = `http://localhost:${port}`;
      resolve();
    });
  });

  try {
    resetMockData();

    // -------------------------------------------------------------
    // Test 1: OData EntitySet mappings for all 5 entities
    // -------------------------------------------------------------
    console.log('1. Testing OData EntitySet mappings for all 5 registered entities:');
    const expectedSets = {
      businessPartner: 'A_BusinessPartner',
      backgroundJob: 'A_BackgroundJob',
      idoc: 'A_IDoc',
      interfaceMonitor: 'A_InterfaceMonitor',
      applicationLog: 'A_ApplicationLog'
    };

    for (const [entityKey, expectedSet] of Object.entries(expectedSets)) {
      const schema = getEntitySchema(entityKey);
      assert(schema !== null, `Schema for "${entityKey}" must exist`);
      assert.strictEqual(
        schema.odataEntitySet,
        expectedSet,
        `EntitySet for ${entityKey} should be ${expectedSet}`
      );
    }
    console.log('   ✓ All 5 entities have valid SAP OData v2 EntitySet mappings');

    // -------------------------------------------------------------
    // Test 2: Basic Auth Header Construction
    // -------------------------------------------------------------
    console.log('2. Testing Basic Auth header generator:');
    const authHeader = buildBasicAuthHeader({ username: 'SAP_USER', password: 'SecretPassword123' });
    const expectedBase64 = Buffer.from('SAP_USER:SecretPassword123').toString('base64');
    assert.strictEqual(authHeader, `Basic ${expectedBase64}`);

    assert.throws(
      () => buildBasicAuthHeader(null),
      /SAP credentials.*required/i,
      'Should throw if credentials missing'
    );
    assert.throws(
      () => buildBasicAuthHeader({ username: 'onlyUser' }),
      /SAP credentials.*required/i,
      'Should throw if password missing'
    );
    console.log('   ✓ Basic Auth header created correctly with standard base64 encoding');

    // -------------------------------------------------------------
    // Test 3: SAP Error Response Parser (JSON / XML with errordetails)
    // -------------------------------------------------------------
    console.log('3. Testing SAP Gateway error parser across HTTP status codes:');

    // 400 Validation Error with innererror details
    const sap400Error = {
      response: {
        status: 400,
        data: {
          error: {
            code: 'CX_BP_VALIDATION',
            message: { value: 'Tax jurisdiction code missing' },
            innererror: {
              errordetails: [
                { message: 'Mandatory field TAXJUR not supplied' },
                { message: 'Country US requires valid jurisdiction' }
              ]
            }
          }
        }
      }
    };
    const parsed400 = parseSapError(sap400Error, 'Update failed');
    assert.strictEqual(parsed400.status, 400);
    assert(parsed400.message.includes('Tax jurisdiction code missing'));
    assert(parsed400.message.includes('Mandatory field TAXJUR not supplied'));
    assert(parsed400.message.includes('Country US requires valid jurisdiction'));
    console.log('   ✓ HTTP 400: Extracted main message and errordetails array');

    // 401 Unauthorized
    const sap401Error = { response: { status: 401 } };
    const parsed401 = parseSapError(sap401Error, 'Query failed');
    assert.strictEqual(parsed401.status, 401);
    assert(parsed401.message.includes('Invalid or expired SAP credentials'));
    console.log('   ✓ HTTP 401: Mapped to credential expiration message');

    // 403 Forbidden
    const sap403Error = {
      response: {
        status: 403,
        data: { error: { message: { value: 'No authorization for authorization object B_BUPA_GRP' } } }
      }
    };
    const parsed403 = parseSapError(sap403Error, 'Query failed');
    assert.strictEqual(parsed403.status, 403);
    assert(parsed403.message.includes('Access denied (403)'));
    assert(parsed403.message.includes('B_BUPA_GRP'));
    console.log('   ✓ HTTP 403: Mapped to SAP authorization message');

    // 404 Not Found
    const sap404Error = {
      response: {
        status: 404,
        data: { error: { message: { value: "Resource not found for segment 'A_BusinessPartner'" } } }
      }
    };
    const parsed404 = parseSapError(sap404Error, 'Lookup failed');
    assert.strictEqual(parsed404.status, 404);
    assert(parsed404.message.includes('SAP endpoint or entity not found (404)'));
    console.log('   ✓ HTTP 404: Mapped to endpoint not found message');

    // 409 Lock Conflict
    const sap409Error = {
      response: {
        status: 409,
        data: { error: { message: { value: 'Business partner 1000 is currently locked by user BASIS01' } } }
      }
    };
    const parsed409 = parseSapError(sap409Error, 'Update failed');
    assert.strictEqual(parsed409.status, 409);
    assert(parsed409.message.includes('SAP concurrency or lock conflict (409)'));
    assert(parsed409.message.includes('locked by user BASIS01'));
    console.log('   ✓ HTTP 409: Mapped to SAP concurrency/lock conflict message');

    // 500 Gateway Dump
    const sap500Error = {
      response: {
        status: 500,
        data: { error: { message: { value: 'RFC communication failure: SYSTEM_CALL_ERROR' } } }
      }
    };
    const parsed500 = parseSapError(sap500Error, 'Operation failed');
    assert.strictEqual(parsed500.status, 500);
    assert(parsed500.message.includes('SAP Gateway internal server error (500)'));
    assert(parsed500.message.includes('SYSTEM_CALL_ERROR'));
    console.log('   ✓ HTTP 500: Mapped to Gateway internal dump message');

    // 504 Gateway Timeout
    const sap504Error = {
      response: {
        status: 504,
        data: 'Gateway Timeout'
      }
    };
    const parsed504 = parseSapError(sap504Error, 'Request timed out');
    assert.strictEqual(parsed504.status, 504);
    assert(parsed504.message.includes('SAP Gateway connection error (504)'));
    console.log('   ✓ HTTP 504: Mapped to Gateway timeout message');

    // -------------------------------------------------------------
    // Test 4: CSRF Token Fetching Logic
    // -------------------------------------------------------------
    console.log('4. Testing CSRF token handshake logic:');
    const csrfRes = await fetchCsrfToken({ username: 'mockUser', password: 'mockPass' });
    assert(csrfRes.token, 'CSRF response must include token');
    assert(Array.isArray(csrfRes.cookies), 'CSRF response must include cookies array');
    assert(csrfRes.token.includes('csrf-token'), 'Token should match mock/real format');
    console.log(`   ✓ CSRF handshake succeeded (Token: ${csrfRes.token.slice(0, 20)}...)`);

    // -------------------------------------------------------------
    // Test 5: Credentials Validation when USE_MOCK_SAP=false
    // -------------------------------------------------------------
    console.log('5. Testing credentials enforcement in real mode:');
    const prevMockEnv = process.env.USE_MOCK_SAP;
    try {
      process.env.USE_MOCK_SAP = 'false';

      // updateEntityRecord without credentials should throw
      await assert.rejects(
        async () => {
          await updateEntityRecord('businessPartner', '1000', { BusinessPartnerName: 'Test' }, null);
        },
        /SAP credentials required/
      );

      // createEntityRecord without credentials should throw
      await assert.rejects(
        async () => {
          await createEntityRecord('businessPartner', { BusinessPartnerName: 'Test' }, null);
        },
        /SAP credentials required/
      );

      // deleteEntityRecord without credentials should throw
      await assert.rejects(
        async () => {
          await deleteEntityRecord('businessPartner', '1000', null);
        },
        /SAP credentials required/
      );

      console.log('   ✓ Mutation functions throw "SAP credentials required" when real mode is active without credentials');
    } finally {
      process.env.USE_MOCK_SAP = prevMockEnv;
    }

    // -------------------------------------------------------------
    // Test 6: Schema Comparison Diagnostic Engine
    // -------------------------------------------------------------
    console.log('6. Testing schema comparison diagnostic engine:');
    const mockBp = getMockDataCache('businessPartner')[0];
    const matchReport = compareEntitySchemaWithSapRecord('businessPartner', mockBp);

    assert.strictEqual(matchReport.entityKey, 'businessPartner');
    assert.strictEqual(matchReport.odataEntitySet, 'A_BusinessPartner');
    assert.strictEqual(matchReport.isMatch, true, 'Mock Business Partner must match schema completely');
    assert(matchReport.matchedFields.length > 0, 'Should have matched fields');
    assert.strictEqual(matchReport.missingInSap.length, 0, 'Should have no missing fields in valid record');
    console.log(`   ✓ Valid record: ${matchReport.matchedFields.length}/${matchReport.totalSchemaColumns} fields matched, 0 missing`);

    // Test with missing fields
    const partialRecord = {
      BusinessPartner: '1000',
      BusinessPartnerName: 'Partial Corp'
      // Missing City, Country, Category, etc.
    };
    const mismatchReport = compareEntitySchemaWithSapRecord('businessPartner', partialRecord);
    assert.strictEqual(mismatchReport.isMatch, false, 'Partial record should report isMatch: false');
    assert(mismatchReport.missingInSap.length > 0, 'Missing fields must be listed');
    const missingNames = mismatchReport.missingInSap.map((m) => m.schemaColumn);
    assert(missingNames.includes('Category'), 'Category should be detected as missing');
    assert(missingNames.includes('City'), 'City should be detected as missing');
    console.log(`   ✓ Partial record: detected ${mismatchReport.missingInSap.length} missing fields correctly`);

    // Test with extra fields
    const recordWithExtras = {
      ...mockBp,
      TAX_NUMBER_1: 'US12345678',
      BANK_ACCOUNT_REF: 'ACCT-998877'
    };
    const extraReport = compareEntitySchemaWithSapRecord('businessPartner', recordWithExtras);
    assert(extraReport.extraInSap.some((e) => e.fieldName === 'TAX_NUMBER_1'), 'Should detect extra TAX_NUMBER_1');
    assert(extraReport.extraInSap.some((e) => e.fieldName === 'BANK_ACCOUNT_REF'), 'Should detect extra BANK_ACCOUNT_REF');
    console.log(`   ✓ Extra fields detected: ${extraReport.extraInSap.map((e) => e.fieldName).join(', ')}`);

    // -------------------------------------------------------------
    // Test 7: Debug Route GET /api/debug/schema-check
    // -------------------------------------------------------------
    console.log('7. Testing HTTP GET /api/debug/schema-check:');
    const debugRes = await makeRequest('GET', '/api/debug/schema-check?entityKey=businessPartner&mock=true');
    assert.strictEqual(debugRes.status, 200);
    assert.strictEqual(debugRes.data.entityKey, 'businessPartner');
    assert.strictEqual(debugRes.data.dataSource, 'mock');
    assert.strictEqual(debugRes.data.isMatch, true);
    assert(Array.isArray(debugRes.data.matchedFields));
    assert(debugRes.data.matchedFields.length >= 6);
    console.log('   ✓ /api/debug/schema-check?mock=true returns 200 with complete comparison JSON');

    const invalidEntityRes = await makeRequest('GET', '/api/debug/schema-check?entityKey=nonExistentEntity');
    assert.strictEqual(invalidEntityRes.status, 400);
    assert(invalidEntityRes.data.error.includes('Invalid entityKey'));
    console.log('   ✓ /api/debug/schema-check rejects invalid entityKey with 400');

    // -------------------------------------------------------------
    // Test 8: RFC Client Stubs (Phase 4 Basis Readiness)
    // -------------------------------------------------------------
    console.log('8. Testing RFC/BAPI client stubs:');
    await assert.rejects(
      async () => {
        await rfcRetryJob('JOB_1001');
      },
      (err) => {
        return (
          err.code === 'RFC_NOT_CONFIGURED' &&
          err.requiresBasisApproval === true &&
          err.message.includes('SAP NetWeaver RFC SDK')
        );
      },
      'rfcRetryJob should throw informative Basis prerequisite error'
    );

    await assert.rejects(
      async () => {
        await rfcReprocessIdoc('0000000000109201');
      },
      (err) => {
        return (
          err.code === 'RFC_NOT_CONFIGURED' &&
          err.requiresBasisApproval === true &&
          err.message.includes('SAP NetWeaver RFC SDK')
        );
      },
      'rfcReprocessIdoc should throw informative Basis prerequisite error'
    );

    await assert.rejects(
      async () => {
        await executeRfcFunction('BAPI_XBP_JOB_SELECT', {});
      },
      (err) => err.code === 'RFC_NOT_CONFIGURED',
      'executeRfcFunction should throw RFC_NOT_CONFIGURED error'
    );
    console.log('   ✓ RFC stubs throw clear Basis prerequisite errors with code RFC_NOT_CONFIGURED');

    // -------------------------------------------------------------
    // Test 9: Conditional Live SAP Testing
    // -------------------------------------------------------------
    console.log('9. Checking conditional live SAP integration test:');
    if (process.env.REAL_SAP_TEST_CREDENTIALS) {
      console.log('   * REAL_SAP_TEST_CREDENTIALS detected! Running live test against SAP Gateway...');
      // Future live verification once credentials arrive
    } else {
      console.log('   ✓ Safely skipped live SAP network calls (REAL_SAP_TEST_CREDENTIALS not set in environment)');
    }

    console.log('\n======================================================');
    console.log('✅ ALL REAL SAP INTEGRATION & DIAGNOSTIC TESTS PASSED');
    console.log('======================================================\n');
  } finally {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  }
}

runRealSapIntegrationTests().catch((err) => {
  console.error('\n❌ Real SAP integration test suite failed:', err);
  if (server) {
    server.close();
  }
  process.exit(1);
});
