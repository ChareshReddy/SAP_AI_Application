import assert from 'assert';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import app from '../server.js';
import {
  ERROR_CATALOGUE,
  classifyError,
  recordErrorOccurrence,
  getKnowledgeBaseRuleById,
  createKnowledgeBaseRule,
  updateKnowledgeBaseRule,
  deleteKnowledgeBaseRule
} from '../config/errorKnowledgeBase.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const KB_FILE = path.join(__dirname, '..', 'mock', 'errorKnowledgeBase.json');

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

async function runKnowledgeBaseTests() {
  console.log('\n--- Starting Error Knowledge Base & Maturity Lifecycle Test Suite ---\n');

  await new Promise((resolve) => {
    server = app.listen(0, () => {
      const port = server.address().port;
      baseUrl = `http://localhost:${port}`;
      resolve();
    });
  });

  try {
    // 1. Verify JSON file persistence
    console.log('1. Testing Error Knowledge Base File Persistence:');
    assert(fs.existsSync(KB_FILE), 'errorKnowledgeBase.json must exist in backend/mock/');
    const rawContent = fs.readFileSync(KB_FILE, 'utf-8');
    const parsed = JSON.parse(rawContent);
    assert(Array.isArray(parsed), 'errorKnowledgeBase.json must contain an array of rules');
    assert(parsed.length >= 13, `Knowledge base must contain at least 13 rules (found ${parsed.length})`);
    console.log(`   ✓ Persistent knowledge base loaded successfully with ${parsed.length} rules`);

    // 2. Testing Occurrence Tracking & Metric Updates
    console.log('2. Testing Occurrence & Resolution Metrics:');
    const initialRule = parsed.find((r) => r.category === 'DATABASE_TIMEOUT');
    assert(initialRule, 'DATABASE_TIMEOUT rule must exist');
    const startOccurrences = initialRule.occurrenceCount || 0;
    const startResolutions = initialRule.successfulResolutionCount || 0;

    // Record an occurrence without resolution
    const updatedRule1 = recordErrorOccurrence('DATABASE_TIMEOUT', false);
    assert.strictEqual(updatedRule1.occurrenceCount, startOccurrences + 1);
    assert.strictEqual(updatedRule1.successfulResolutionCount, startResolutions);
    assert(updatedRule1.lastSeen, 'lastSeen timestamp must be updated');

    // Record an occurrence with successful resolution
    const updatedRule2 = recordErrorOccurrence('DATABASE_TIMEOUT', true);
    assert.strictEqual(updatedRule2.occurrenceCount, startOccurrences + 2);
    assert.strictEqual(updatedRule2.successfulResolutionCount, startResolutions + 1);

    // Verify disk persistence
    const reloaded = JSON.parse(fs.readFileSync(KB_FILE, 'utf-8'));
    const reloadedRule = reloaded.find((r) => r.category === 'DATABASE_TIMEOUT');
    assert.strictEqual(reloadedRule.occurrenceCount, startOccurrences + 2);
    assert.strictEqual(reloadedRule.successfulResolutionCount, startResolutions + 1);
    console.log('   ✓ Occurrence and resolution counts updated and saved to disk');

    // 3. Testing classifyError returns occurrence metrics
    console.log('3. Testing classifyError returns maturity metrics:');
    const sampleLogs = [
      { message: 'RFC communication failure with partner gateway timeout', severity: 'ERROR' }
    ];
    const diagnosis = classifyError(sampleLogs);
    assert.strictEqual(diagnosis.category, 'RFC_COMMUNICATION_FAILURE');
    assert(typeof diagnosis.occurrenceCount === 'number');
    assert(typeof diagnosis.successfulResolutionCount === 'number');
    console.log(`   ✓ Diagnosis enriched with empirical usage metrics: occurrences=${diagnosis.occurrenceCount}, resolved=${diagnosis.successfulResolutionCount}`);

    // 4. Testing Admin API GET /api/knowledge-base
    console.log('4. Testing GET /api/knowledge-base API:');
    const getRes = await makeRequest('GET', '/api/knowledge-base');
    assert.strictEqual(getRes.status, 200);
    assert.strictEqual(getRes.data.success, true);
    assert(Array.isArray(getRes.data.rules));
    assert(getRes.data.total >= 13);
    console.log(`   ✓ GET /api/knowledge-base returned ${getRes.data.total} rules with metrics`);

    // 5. Testing Admin API POST /api/knowledge-base (Create Rule)
    console.log('5. Testing POST /api/knowledge-base (Create Rule):');
    const newRulePayload = {
      category: 'CUSTOM_GATEWAY_OOM',
      patternStr: 'out of memory|heap exhausted',
      recommendedAction: 'ESCALATE',
      riskLevel: 3,
      description: 'SAP Gateway Java Stack JVM out of memory'
    };

    const postRes = await makeRequest('POST', '/api/knowledge-base', newRulePayload);
    assert.strictEqual(postRes.status, 201);
    assert.strictEqual(postRes.data.success, true);
    const createdRule = postRes.data.rule;
    assert.strictEqual(createdRule.category, 'CUSTOM_GATEWAY_OOM');
    assert.strictEqual(createdRule.occurrenceCount, 0);

    // Verify it is now diagnosable
    const testDiag = classifyError([{ message: 'Server killed: JVM heap exhausted in gateway worker' }]);
    assert.strictEqual(testDiag.category, 'CUSTOM_GATEWAY_OOM');
    assert.strictEqual(testDiag.riskLevel, 3);
    console.log('   ✓ New runbook rule dynamically registered and active in diagnosis engine');

    // 6. Testing Admin API PUT /api/knowledge-base/:id (Update Rule)
    console.log('6. Testing PUT /api/knowledge-base/:id (Update Rule):');
    const putRes = await makeRequest('PUT', `/api/knowledge-base/${createdRule.id}`, {
      description: 'Updated JVM heap troubleshooting guidelines',
      recommendedAction: 'RETRY',
      riskLevel: 2
    });
    assert.strictEqual(putRes.status, 200);
    assert.strictEqual(putRes.data.rule.recommendedAction, 'RETRY');
    assert.strictEqual(putRes.data.rule.riskLevel, 2);
    console.log('   ✓ Rule successfully updated');

    // 7. Testing Admin API DELETE /api/knowledge-base/:id (Delete Rule)
    console.log('7. Testing DELETE /api/knowledge-base/:id:');
    const delRes = await makeRequest('DELETE', `/api/knowledge-base/${createdRule.id}`);
    assert.strictEqual(delRes.status, 200);
    assert.strictEqual(delRes.data.success, true);

    const checkGet = await makeRequest('GET', `/api/knowledge-base/${createdRule.id}`);
    assert.strictEqual(checkGet.status, 404);
    console.log('   ✓ Rule successfully deleted and cleaned from catalogue');

    // 8. Testing POST /api/knowledge-base/record-occurrence endpoint
    console.log('8. Testing POST /api/knowledge-base/record-occurrence:');
    const occRes = await makeRequest('POST', '/api/knowledge-base/record-occurrence', {
      category: 'DATABASE_TIMEOUT',
      resolved: true
    });
    assert.strictEqual(occRes.status, 200);
    assert.strictEqual(occRes.data.success, true);
    console.log('   ✓ Occurrence recording endpoint verified');

    console.log('\n======================================================');
    console.log('✅ ALL ERROR KNOWLEDGE BASE & MATURITY TESTS PASSED');
    console.log('======================================================\n');
  } finally {
    if (server) {
      server.close();
    }
  }
}

runKnowledgeBaseTests().catch((err) => {
  console.error('\n❌ Knowledge Base Test Suite Failed:', err);
  if (server) server.close();
  process.exit(1);
});
