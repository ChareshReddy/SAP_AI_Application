import express from 'express';
import { getEntitySchema, isValidEntityKey, listAvailableEntities } from '../config/entitySchemas/index.js';
import { getMockDataCache, fetchRealSapEntityData, isMockMode } from '../services/sapClient.js';
import { compareEntitySchemaWithSapRecord } from '../services/schemaValidator.js';
import { sessionStore } from '../services/sessionStore.js';
import { decryptCredentials } from '../services/encryption.js';

const router = express.Router();

/**
 * Extracts session credentials from cookie if available
 */
function getCredentialsFromRequest(req) {
  const sessionId = req.cookies?.sap_session_id;
  if (!sessionId) return null;
  const session = sessionStore.getSession(sessionId);
  if (!session) return null;
  try {
    return decryptCredentials(session.encryptedCredentials);
  } catch {
    return null;
  }
}

/**
 * GET /api/debug/schema-check?entityKey=businessPartner&mock=false
 * Diagnostic endpoint to compare SAP returned payload fields against our schema definition.
 * Helps Basis and development teams immediately detect OData property mismatches.
 */
router.get('/schema-check', async (req, res) => {
  const entityKey = req.query.entityKey || 'businessPartner';
  const forceMock = req.query.mock === 'true';

  if (!isValidEntityKey(entityKey)) {
    return res.status(400).json({
      error: `Invalid entityKey "${entityKey}". Available entities: ${listAvailableEntities().map((e) => e.entityKey).join(', ')}`
    });
  }

  const schema = getEntitySchema(entityKey);

  try {
    let sampleRecord = null;
    let dataSource = 'mock';

    if (forceMock || isMockMode()) {
      const mockData = getMockDataCache(entityKey);
      sampleRecord = mockData[0] || null;
      dataSource = 'mock';
    } else {
      const credentials = getCredentialsFromRequest(req);
      if (!credentials) {
        return res.status(401).json({
          error: 'Authentication required to inspect real SAP schema. Please log in or pass ?mock=true.'
        });
      }

      dataSource = 'real';
      const sapRes = await fetchRealSapEntityData(entityKey, credentials, { top: 1 });
      const records = sapRes?.d?.results || (Array.isArray(sapRes?.d) ? sapRes.d : (Array.isArray(sapRes) ? sapRes : []));
      sampleRecord = records[0] || null;
    }

    if (!sampleRecord) {
      return res.status(200).json({
        entityKey,
        dataSource,
        odataEntitySet: schema.odataEntitySet,
        isMatch: false,
        warning: `No records were returned from ${dataSource} source for entity "${entityKey}". Cannot compare fields without a sample record.`
      });
    }

    const comparison = compareEntitySchemaWithSapRecord(entityKey, sampleRecord);

    return res.status(200).json({
      ...comparison,
      dataSource,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.error(`[debug/schema-check] Error inspecting schema for ${entityKey}:`, err.message);
    const status = err.status || 500;
    return res.status(status).json({
      error: err.message,
      entityKey,
      realStatusCode: err.realStatusCode || null,
      sapError: err.sapError || null
    });
  }
});

/**
 * GET /api/debug/sapgui-diagnostic
 * Runs the COM diagnostic from within the running backend server process context.
 */
router.get('/sapgui-diagnostic', async (req, res) => {
  try {
    const { runDiagnostic } = await import('../scripts/diagnosticNode.js');
    const result = await runDiagnostic();
    let parsed = null;
    try {
      parsed = JSON.parse(result.stdout);
    } catch {
      parsed = { rawStdout: result.stdout };
    }
    return res.status(200).json({
      context: 'backend-process',
      pid: process.pid,
      nodeVersion: process.version,
      platform: process.platform,
      diagnostic: parsed,
      stderr: result.stderr
    });
  } catch (err) {
    return res.status(500).json({
      context: 'backend-process',
      error: err.message
    });
  }
});

export default router;
