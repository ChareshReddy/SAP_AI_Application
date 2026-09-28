#!/usr/bin/env node
/**
 * CLI Schema Diagnostic Tool for SAP Entities
 * Compares an entity schema against the payload returned by SAP Gateway (or mock layer).
 *
 * Usage:
 *   node backend/scripts/schemaCheck.js [entityKey] [--mock] [--user=NAME] [--pass=SECRET]
 *   node backend/scripts/schemaCheck.js --entity=businessPartner
 *   node backend/scripts/schemaCheck.js --entity=backgroundJob --mock
 */

import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { getEntitySchema, isValidEntityKey, listAvailableEntities } from '../config/entitySchemas/index.js';
import { getMockDataCache, fetchRealSapEntityData, isMockMode, resolveSapBaseUrl } from '../services/sapClient.js';
import { compareEntitySchemaWithSapRecord } from '../services/schemaValidator.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load backend/.env
dotenv.config({ path: path.join(__dirname, '..', '.env') });

function parseArgs() {
  const args = process.argv.slice(2);
  let entityKey = 'businessPartner';
  let forceMock = false;
  let username = process.env.SAP_USERNAME || '';
  let password = process.env.SAP_PASSWORD || '';
  let systemKey = 'DEV';

  for (const arg of args) {
    if (arg.startsWith('--entity=')) {
      entityKey = arg.split('=')[1].trim();
    } else if (arg.startsWith('--system=')) {
      systemKey = arg.split('=')[1].trim().toUpperCase();
    } else if (arg.startsWith('--user=')) {
      username = arg.split('=')[1].trim();
    } else if (arg.startsWith('--pass=')) {
      password = arg.split('=')[1].trim();
    } else if (arg === '--mock') {
      forceMock = true;
    } else if (!arg.startsWith('--')) {
      entityKey = arg.trim();
    }
  }

  return { entityKey, forceMock, username, password, systemKey };
}

async function run() {
  const { entityKey, forceMock, username, password, systemKey } = parseArgs();

  console.log('\n======================================================');
  console.log('       SAP AI AGENT — SCHEMA DIAGNOSTIC TOOL          ');
  console.log('======================================================');

  if (!isValidEntityKey(entityKey)) {
    console.error(`\n❌ Unknown entity: "${entityKey}"`);
    console.log(`Available entities: ${listAvailableEntities().map((e) => e.entityKey).join(', ')}\n`);
    process.exit(1);
  }

  const schema = getEntitySchema(entityKey);
  console.log(`Entity Key      : ${schema.entityKey}`);
  console.log(`Entity Label    : ${schema.label}`);
  console.log(`OData EntitySet : ${schema.odataEntitySet}`);
  console.log(`Primary Key ID  : ${schema.idField}`);

  const useMock = forceMock || isMockMode() || (!username && !password);
  const targetBaseUrl = resolveSapBaseUrl(systemKey);
  console.log(`Data Source     : ${useMock ? 'MOCK DATA' : 'REAL SAP GATEWAY'}`);
  console.log(`SAP Base URL (${systemKey}) : ${targetBaseUrl || '(not configured)'}`);
  console.log('------------------------------------------------------');

  let sampleRecord = null;

  try {
    if (useMock) {
      const mockData = getMockDataCache(entityKey);
      sampleRecord = mockData[0] || null;
    } else {
      console.log(`Fetching 1 record from SAP Gateway using user "${username}"...`);
      const res = await fetchRealSapEntityData(entityKey, { username, password }, { top: 1 }, systemKey);
      const records = res?.d?.results || (Array.isArray(res?.d) ? res.d : (Array.isArray(res) ? res : []));
      sampleRecord = records[0] || null;
    }

    if (!sampleRecord) {
      console.warn(`⚠️ No records found in ${useMock ? 'mock' : 'real'} dataset to compare against.`);
      process.exit(0);
    }

    const report = compareEntitySchemaWithSapRecord(entityKey, sampleRecord);

    console.log(`\nSample Record ID: ${report.sampleRecordId}`);
    console.log(`Schema Columns  : ${report.totalSchemaColumns}`);
    console.log(`Matched Columns : ${report.totalMatched}`);

    console.log('\n--- 1. MATCHED FIELDS (Present in Schema & SAP) ---');
    if (report.matchedFields.length === 0) {
      console.log('  (None)');
    } else {
      for (const m of report.matchedFields) {
        console.log(`  ✓ ${m.schemaColumn.padEnd(20)} -> ${m.matchedOn.padEnd(25)} [type: ${m.type || 'string'}]`);
      }
    }

    console.log('\n--- 2. MISSING IN SAP (Defined in Schema but NOT returned by SAP) ---');
    if (report.missingInSap.length === 0) {
      console.log('  ✓ None! All schema columns matched in the SAP payload.');
    } else {
      for (const miss of report.missingInSap) {
        console.log(`  ❌ ${miss.schemaColumn.padEnd(20)} (expected: ${miss.expectedOdataField}) - "${miss.label}"`);
      }
    }

    console.log('\n--- 3. EXTRA FIELDS IN SAP (Returned by SAP but NOT mapped in Schema) ---');
    if (report.extraInSap.length === 0) {
      console.log('  (None)');
    } else {
      for (const extra of report.extraInSap.slice(0, 15)) {
        console.log(`  + ${extra.fieldName.padEnd(25)} = "${String(extra.sampleValue).slice(0, 35)}"`);
      }
      if (report.extraInSap.length > 15) {
        console.log(`  ... and ${report.extraInSap.length - 15} more fields.`);
      }
    }

    console.log('\n======================================================');
    if (report.isMatch) {
      console.log('  RESULT: ✅ PERFECT SCHEMA MATCH');
    } else {
      console.log('  RESULT: ⚠️ SCHEMA MISMATCH DETECTED (check missing fields above)');
    }
    console.log('======================================================\n');
  } catch (err) {
    console.error('\n❌ Diagnostic failed:', err.message);
    if (err.sapError) {
      console.error('SAP Error Body:', JSON.stringify(err.sapError, null, 2));
    }
    process.exit(1);
  }
}

run();
