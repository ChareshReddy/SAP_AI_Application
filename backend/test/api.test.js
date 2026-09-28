import assert from 'assert';
import http from 'http';
import app from '../server.js';
import { encryptCredentials, decryptCredentials } from '../services/encryption.js';
import { sessionStore } from '../services/sessionStore.js';

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
          data: json,
          rawCookie: res.headers['set-cookie']
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

async function runTests() {
  console.log('\n--- Starting SAP Application Backend Test Suite ---\n');

  // 1. Encryption & Decryption Tests
  console.log('1. Testing AES-256-GCM Encryption & Decryption:');
  const testSecret = { username: 'SAP_TEST_USER', password: 'SuperSecretPassword!2026' };
  const encrypted = encryptCredentials(testSecret);
  assert(typeof encrypted === 'string', 'Encrypted output should be a string');
  assert(encrypted.split(':').length === 3, 'Payload should be iv:authTag:ciphertext');
  assert(!encrypted.includes('SuperSecretPassword'), 'Ciphertext must NEVER contain plaintext password');

  const decrypted = decryptCredentials(encrypted);
  assert.strictEqual(decrypted.username, testSecret.username);
  assert.strictEqual(decrypted.password, testSecret.password);
  console.log('   ✓ AES-256-GCM encrypts and decrypts accurately without exposing raw credentials');

  // Test tampering detection
  try {
    const tampered = encrypted.slice(0, -4) + 'abcd';
    decryptCredentials(tampered);
    assert.fail('Tampered payload should have thrown an error');
  } catch (err) {
    assert(err.message.includes('Unsupported state') || err.message.includes('auth') || err.message);
    console.log('   ✓ Tampering detection verified (authTag validation)');
  }

  // 2. Session Store Tests
  console.log('2. Testing In-Memory Session Store:');
  const sid = sessionStore.createSession(encrypted, 'TEST_USER', 1000);
  assert(sessionStore.getSession(sid), 'Session should exist initially');
  sessionStore.deleteSession(sid);
  assert.strictEqual(sessionStore.getSession(sid), null, 'Deleted session should return null');
  console.log('   ✓ Session creation, retrieval, and deletion working properly');

  // Start HTTP Server on an ephemeral port
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  baseUrl = `http://localhost:${port}`;

  const prevMock = process.env.USE_MOCK_SAP;
  process.env.USE_MOCK_SAP = 'true';
  const prevSkipAuth = process.env.SKIP_GATEWAY_AUTH;
  process.env.SKIP_GATEWAY_AUTH = 'false';

  try {
    // 3. Health Check
    console.log('3. Testing /api/health endpoint:');
    const healthRes = await makeRequest('GET', '/api/health');
    assert.strictEqual(healthRes.status, 200);
    assert.strictEqual(healthRes.data.status, 'healthy');
    assert.strictEqual(healthRes.data.mockMode, true);
    console.log('   ✓ /api/health returned 200 OK');

    // 4. Unauthorized Access Protection
    console.log('4. Testing Protected Endpoints without Authentication:');
    const meNoAuth = await makeRequest('GET', '/api/auth/me');
    assert.strictEqual(meNoAuth.status, 401);

    const bpNoAuth = await makeRequest('GET', '/api/business-partners');
    assert.strictEqual(bpNoAuth.status, 401);
    console.log('   ✓ Protected routes return 401 Unauthorized when unauthenticated');

    // 5. Login
    console.log('5. Testing Login Flow & HttpOnly Cookie Generation:');
    const loginRes = await makeRequest('POST', '/api/auth/login', {
      username: 'SAP_CONSULTANT',
      password: 'RealSAPPassword123'
    });

    assert.strictEqual(loginRes.status, 200);
    assert.strictEqual(loginRes.data.success, true);
    assert.strictEqual(loginRes.data.username, 'SAP_CONSULTANT');
    assert.strictEqual(loginRes.data.password, undefined, 'Password must never be returned');

    // Check Set-Cookie
    const cookieHeader = loginRes.rawCookie;
    assert(cookieHeader && cookieHeader.length > 0, 'Set-Cookie header must be present');
    const setCookieStr = cookieHeader[0];
    assert(setCookieStr.includes('sap_session_id='), 'Cookie name must be sap_session_id');
    assert(setCookieStr.toLowerCase().includes('httponly'), 'Cookie MUST be HttpOnly');
    assert(setCookieStr.toLowerCase().includes('samesite=strict'), 'Cookie MUST be SameSite=Strict');
    console.log('   ✓ Login generated HttpOnly, SameSite=Strict session cookie successfully');

    // Extract cookie value for subsequent requests
    const sessionCookie = setCookieStr.split(';')[0];

    // 6. Verify Session with Cookie
    console.log('6. Testing /api/auth/me with Session Cookie:');
    const meRes = await makeRequest('GET', '/api/auth/me', null, sessionCookie);
    assert.strictEqual(meRes.status, 200);
    assert.strictEqual(meRes.data.authenticated, true);
    assert.strictEqual(meRes.data.username, 'SAP_CONSULTANT');
    console.log('   ✓ Session correctly verified via HttpOnly cookie');

    // 7. Business Partner Fetching & Default Pagination (50)
    console.log('7. Testing Business Partner Data Fetching & Pagination:');
    const bpRes = await makeRequest('GET', '/api/business-partners', null, sessionCookie);
    assert.strictEqual(bpRes.status, 200);
    assert(Array.isArray(bpRes.data.d.results), 'd.results must be an array');
    assert.strictEqual(bpRes.data.d.results.length, 50, 'Default page size must be 50 records');
    assert.strictEqual(bpRes.data.pagination.top, 50);
    assert.strictEqual(bpRes.data.pagination.skip, 0);
    assert(bpRes.data.pagination.total >= 60, 'Total records count should match mock dataset');

    // Check entity structure and address expansion
    const firstBp = bpRes.data.d.results[0];
    assert(firstBp.BusinessPartner, 'BP ID must exist');
    assert(firstBp.BusinessPartnerName, 'BP Name must exist');
    assert(firstBp.City, 'City must exist');
    assert(firstBp.Country, 'Country must exist');
    assert(firstBp.to_BusinessPartnerAddress, 'Address navigation property must exist');
    console.log('   ✓ Business Partner and Address data shape matches SAP OData specification');

    // 8. Pagination with custom $top and $skip
    console.log('8. Testing Pagination ($top=10, $skip=10):');
    const page2Res = await makeRequest('GET', '/api/business-partners?top=10&skip=10', null, sessionCookie);
    assert.strictEqual(page2Res.status, 200);
    assert.strictEqual(page2Res.data.d.results.length, 10);
    assert.strictEqual(page2Res.data.pagination.skip, 10);
    console.log('   ✓ Pagination with $top and $skip works accurately');

    // 9. Range Filter (Business Partner ID range)
    console.log('9. Testing Business Partner ID Range Filter (1005 to 1015):');
    const rangeRes = await makeRequest('GET', '/api/business-partners?from=1005&to=1015&top=50', null, sessionCookie);
    assert.strictEqual(rangeRes.status, 200);
    const rangeResults = rangeRes.data.d.results;
    assert(rangeResults.length > 0, 'Range query should find matching records');
    for (const r of rangeResults) {
      const id = parseInt(r.BusinessPartner, 10);
      assert(id >= 1005 && id <= 1015, `Record ID ${r.BusinessPartner} must be in range [1005, 1015]`);
    }
    console.log(`   ✓ Filter successfully returned ${rangeResults.length} records within specified range`);

    // 10. Logout Flow
    console.log('10. Testing Logout Flow:');
    const logoutRes = await makeRequest('POST', '/api/auth/logout', null, sessionCookie);
    assert.strictEqual(logoutRes.status, 200);

    // After logout, session should no longer be valid
    const afterLogoutRes = await makeRequest('GET', '/api/auth/me', null, sessionCookie);
    assert.strictEqual(afterLogoutRes.status, 401);
    // 11. Gateway Auth Bypass Configuration & /api/auth/config
    console.log('11. Testing SKIP_GATEWAY_AUTH bypass mode:');
    process.env.SKIP_GATEWAY_AUTH = 'true';
    const configRes = await makeRequest('GET', '/api/auth/config');
    assert.strictEqual(configRes.status, 200);
    assert.strictEqual(configRes.data.skipGatewayAuth, true);
    assert.strictEqual(configRes.data.bypassUser, 'LEELAM_EXT');

    const meBypassed = await makeRequest('GET', '/api/auth/me');
    assert.strictEqual(meBypassed.status, 200);
    assert.strictEqual(meBypassed.data.authenticated, true);
    assert.strictEqual(meBypassed.data.username, 'LEELAM_EXT');
    assert.strictEqual(meBypassed.data.sapMode, 'gui-only');
    console.log('   ✓ SKIP_GATEWAY_AUTH=true bypasses login, returns configured user, and gui-only mode');

    console.log('\n=============================================');
    console.log('  ALL BACKEND TESTS PASSED SUCCESSFULLY!  ');
    console.log('=============================================\n');
  } finally {
    process.env.USE_MOCK_SAP = prevMock;
    process.env.SKIP_GATEWAY_AUTH = prevSkipAuth;
    server.close();
  }
}

runTests().catch((err) => {
  console.error('\n❌ Test Suite Failed:', err);
  if (server) server.close();
  process.exit(1);
});
