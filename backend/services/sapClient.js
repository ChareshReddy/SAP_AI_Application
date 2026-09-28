import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import axios from 'axios';
import {
  ENTITY_REGISTRY,
  getEntitySchema,
  getColumnByName,
  isValidColumn,
  isValidOperator,
  getODataFieldName
} from '../config/entitySchemas/index.js';
import { getSystemConfig } from '../config/systemRegistry.js';
import { createBomViaGui, copyBomViaGui, deleteBomViaGui } from './sapGuiClient.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// In-memory mutable dataset cache map: entityKey -> Array<object>
const mockDataCaches = new Map();

/**
 * Loads mock dataset from file for a given entity schema.
 * @param {string} entityKey
 * @returns {Array<object>}
 */
function loadMockData(entityKey) {
  const schema = getEntitySchema(entityKey);
  if (!schema) {
    console.error(`[sapClient] Unregistered entity "${entityKey}"`);
    return [];
  }

  const mockFilePath = path.join(__dirname, '..', 'mock', schema.mockDataFile);
  try {
    if (!fs.existsSync(mockFilePath)) {
      console.warn(`[sapClient] Mock data file not found: ${mockFilePath}`);
      return [];
    }
    const raw = fs.readFileSync(mockFilePath, 'utf-8');
    const parsed = JSON.parse(raw);
    const results = parsed.d?.results || (Array.isArray(parsed) ? parsed : []);
    return JSON.parse(JSON.stringify(results));
  } catch (err) {
    console.error(`[sapClient] Error reading mock data for entity "${entityKey}":`, err.message);
    return [];
  }
}

/**
 * Returns current mock data cache for an entity (initializes if empty).
 * @param {string} [entityKey='businessPartner']
 * @returns {Array<object>}
 */
export function getMockDataCache(entityKey = 'businessPartner') {
  const schema = getEntitySchema(entityKey);
  const key = schema ? schema.entityKey : 'businessPartner';

  if (!mockDataCaches.has(key)) {
    mockDataCaches.set(key, loadMockData(key));
  }
  return mockDataCaches.get(key);
}

/**
 * Resets in-memory mock data caches back to disk contents.
 * @param {string|null} [entityKey=null] If provided, resets that entity; if null, resets all.
 */
export function resetMockData(entityKey = null) {
  if (entityKey) {
    const schema = getEntitySchema(entityKey);
    const key = schema ? schema.entityKey : entityKey;
    mockDataCaches.set(key, loadMockData(key));
    return mockDataCaches.get(key);
  }

  mockDataCaches.clear();
  for (const key of Object.keys(ENTITY_REGISTRY)) {
    mockDataCaches.set(key, loadMockData(key));
  }
  return mockDataCaches.get('businessPartner') || [];
}

/**
 * Checks if mock mode is enabled.
 */
export function isMockMode() {
  return process.env.USE_MOCK_SAP !== 'false';
}

/**
 * Builds Basic Auth header for SAP Gateway requests.
 * @param {object} credentials { username, password }
 * @returns {string}
 */
export function buildBasicAuthHeader(credentials) {
  if (!credentials || !credentials.username || !credentials.password) {
    throw new Error('Valid SAP credentials (username and password) are required.');
  }
  return `Basic ${Buffer.from(`${credentials.username}:${credentials.password}`).toString('base64')}`;
}

/**
 * Extracts and formats detailed SAP Gateway errors without swallowing backend business messages.
 * @param {Error|object} error
 * @param {string} [defaultContext='SAP request failed']
 * @returns {Error}
 */
export function parseSapError(error, defaultContext = 'SAP request failed') {
  const status = error.response?.status || error.status || 500;
  const sapErrorObj = error.response?.data?.error;

  let message = '';
  if (typeof sapErrorObj?.message === 'string') {
    message = sapErrorObj.message;
  } else if (sapErrorObj?.message?.value) {
    message = sapErrorObj.message.value;
  } else if (error.response?.data?.message) {
    message = error.response.data.message;
  } else if (error.message) {
    message = error.message;
  }

  // Extract nested error details if present
  const innerDetails = sapErrorObj?.innererror?.errordetails;
  let detailStr = '';
  if (Array.isArray(innerDetails) && innerDetails.length > 0) {
    const details = innerDetails
      .filter((d) => d && d.message && d.message !== message)
      .map((d) => d.message.trim());
    if (details.length > 0) {
      detailStr = ` (${details.join('; ')})`;
    }
  }

  const fullMsg = (message + detailStr).trim() || 'Unknown error from SAP Gateway';

  let customMsg = '';
  switch (status) {
    case 400:
      customMsg = `SAP validation error (400): ${fullMsg}`;
      break;
    case 401:
      customMsg = `Invalid or expired SAP credentials (401). Please log in again.`;
      break;
    case 403:
      customMsg = `Access denied (403): User lacks authorization in SAP for this operation. ${fullMsg}`;
      break;
    case 404:
      customMsg = `SAP endpoint or entity not found (404): ${fullMsg}`;
      break;
    case 409:
      customMsg = `SAP concurrency or lock conflict (409): The record is locked by another user or session. ${fullMsg}`;
      break;
    case 500:
      customMsg = `SAP Gateway internal server error (500): ${fullMsg}`;
      break;
    case 502:
    case 503:
    case 504:
      customMsg = `SAP Gateway connection error (${status}): Gateway unavailable or timed out. ${fullMsg}`;
      break;
    default:
      customMsg = `${defaultContext} (${status}): ${fullMsg}`;
  }

  const err = new Error(customMsg);
  err.status = status;
  err.sapError = sapErrorObj || error.response?.data || null;
  err.realStatusCode = status;
  return err;
}

/**
 * Resolves the target SAP OData Base URL for a given system environment.
 * Evaluates systemKey against SYSTEM_REGISTRY via getSystemConfig.
 * @param {string|null} [systemKey=null]
 * @returns {string}
 */
export function resolveSapBaseUrl(systemKey = null) {
  const targetKey = systemKey || 'DEV';
  const config = getSystemConfig(targetKey);
  return config?.baseUrl || getSystemConfig('DEV')?.baseUrl || '';
}

/**
 * Validates SAP credentials against metadata endpoint or mock simulator.
 * Never logs credentials.
 * @param {string} username 
 * @param {string} password 
 * @param {string|null} [systemKey=null]
 * @returns {Promise<{ success: boolean, username: string, mode: string, systemKey?: string }>}
 */
export async function validateSapCredentials(username, password, systemKey = null) {
  if (!username || !password || typeof username !== 'string' || typeof password !== 'string') {
    throw new Error('Username and password are required.');
  }

  const cleanUsername = username.trim();
  const cleanPassword = password.trim();

  if (cleanUsername.length === 0 || cleanPassword.length === 0) {
    throw new Error('Username and password cannot be empty.');
  }

  if (isMockMode()) {
    await new Promise((resolve) => setTimeout(resolve, 150));
    return {
      success: true,
      username: cleanUsername,
      mode: 'mock',
      systemKey: systemKey || 'DEV'
    };
  }

  const sapBaseUrl = resolveSapBaseUrl(systemKey);
  if (!sapBaseUrl) {
    throw new Error(`Target SAP system "${systemKey || 'DEV'}" does not have a valid baseUrl configured in systemRegistry.`);
  }

  const authMethod = (process.env.SAP_AUTH_METHOD || 'basic').toLowerCase();
  const metadataUrl = `${sapBaseUrl.replace(/\/$/, '')}/$metadata`;
  const basicAuthHeader = `Basic ${Buffer.from(`${cleanUsername}:${cleanPassword}`).toString('base64')}`;

  try {
    const response = await axios.get(metadataUrl, {
      headers: {
        Authorization: basicAuthHeader,
        Accept: 'application/xml, text/xml, application/json'
      },
      timeout: 10000
    });

    if (response.status === 200) {
      return {
        success: true,
        username: cleanUsername,
        mode: 'real',
        authMethod,
        systemKey: systemKey || 'DEV'
      };
    }

    throw new Error('Failed to validate credentials against SAP Gateway');
  } catch (error) {
    if (error.response?.status === 401 || error.response?.status === 403) {
      const err = new Error('Invalid SAP Gateway username or password.');
      err.status = 401;
      throw err;
    }
    const err = new Error(`SAP Gateway connection failed: ${error.message}`);
    err.status = error.response?.status || 502;
    throw err;
  }
}

/**
 * Fetches CSRF token and session cookies from SAP Gateway.
 * Makes a GET / HEAD request with 'x-csrf-token: fetch' header.
 *
 * @param {object} credentials { username, password }
 * @param {string|null} [customUrl=null] Optional override for metadata or service root URL
 * @param {string|null} [systemKey=null] Target SAP system key
 * @returns {Promise<{ token: string, cookies: string[] }>}
 */
export async function fetchCsrfToken(credentials, customUrl = null, systemKey = null) {
  if (isMockMode()) {
    return {
      token: `mock-csrf-token-${Date.now()}`,
      cookies: ['SAP_SESSIONID_MOCK=1; path=/; HttpOnly']
    };
  }

  const sapBaseUrl = resolveSapBaseUrl(systemKey);
  if (!sapBaseUrl && !customUrl) {
    throw new Error(`Target SAP system "${systemKey || 'DEV'}" does not have a valid baseUrl configured in systemRegistry.`);
  }

  const targetUrl = customUrl || `${sapBaseUrl.replace(/\/$/, '')}/$metadata`;
  const basicAuthHeader = buildBasicAuthHeader(credentials);

  try {
    const response = await axios.get(targetUrl, {
      headers: {
        Authorization: basicAuthHeader,
        'x-csrf-token': 'fetch',
        Accept: 'application/xml, text/xml, application/json'
      },
      timeout: 10000
    });

    const token = response.headers['x-csrf-token'] || response.headers['X-CSRF-Token'];
    if (!token) {
      throw new Error('SAP Gateway did not return an X-CSRF-Token header.');
    }

    let cookies = response.headers['set-cookie'] || [];
    if (typeof cookies === 'string') {
      cookies = [cookies];
    }

    return { token, cookies };
  } catch (error) {
    throw parseSapError(error, 'Failed to fetch CSRF token from SAP Gateway');
  }
}

/**
 * Fetches a single record by primary key directly from real SAP Gateway via OData v2.
 *
 * @param {string} entityKey
 * @param {string} id
 * @param {object} credentials { username, password }
 * @param {string|null} [systemKey=null]
 * @returns {Promise<object|null>} The parsed single entity record or null if not found
 */
export async function fetchRealSapRecordById(entityKey, id, credentials = null, systemKey = null) {
  if (!id) return null;
  const schema = getEntitySchema(entityKey);
  if (!schema) {
    throw new Error(`Unregistered entity "${entityKey}".`);
  }

  if (!credentials) {
    throw new Error('SAP credentials required for real Gateway operations.');
  }

  const sapBaseUrl = resolveSapBaseUrl(systemKey);
  if (!sapBaseUrl) {
    throw new Error(`Target SAP system "${systemKey || 'DEV'}" does not have a valid baseUrl configured in systemRegistry.`);
  }

  const cleanBase = sapBaseUrl.replace(/\/$/, '');
  const cleanId = String(id).trim().replace(/'/g, "''");
  const url = `${cleanBase}/${schema.odataEntitySet}('${cleanId}')`;

  const queryParams = {
    $format: 'json'
  };
  if (schema.defaultExpand) {
    queryParams.$expand = schema.defaultExpand;
  }

  const basicAuthHeader = buildBasicAuthHeader(credentials);

  try {
    const response = await axios.get(url, {
      params: queryParams,
      headers: {
        Authorization: basicAuthHeader,
        Accept: 'application/json'
      },
      timeout: 15000
    });

    const data = response.data;
    if (data?.d) {
      return data.d;
    }
    return data || null;
  } catch (error) {
    if (error.response?.status === 404) {
      return null;
    }
    throw parseSapError(error, `Failed to fetch ${schema.singularLabel || schema.label} #${id} from SAP`);
  }
}

/**
 * Executes a write mutation (create, update, delete) against real SAP Gateway.
 * Handles 2-step CSRF handshake, header propagation, PATCH fallback to MERGE, and detailed error mapping.
 *
 * @param {string} entityKey
 * @param {'create'|'update'|'delete'} operation
 * @param {string|null} id
 * @param {object|null} payload
 * @param {object} credentials
 * @param {string|null} [systemKey=null]
 * @returns {Promise<{ success: boolean, before: object|null, after: object|null }>}
 */
export async function writeToRealSap(entityKey, operation, id, payload, credentials, systemKey = null) {
  const schema = getEntitySchema(entityKey);
  if (!schema) {
    throw new Error(`Unregistered entity "${entityKey}".`);
  }

  if (!credentials) {
    throw new Error('SAP credentials required for real Gateway operations.');
  }

  const sapBaseUrl = resolveSapBaseUrl(systemKey);
  if (!sapBaseUrl) {
    throw new Error(`Target SAP system "${systemKey || 'DEV'}" does not have a valid baseUrl configured in systemRegistry.`);
  }

  const cleanBase = sapBaseUrl.replace(/\/$/, '');

  // 1. Fetch CSRF token & cookies
  const { token, cookies } = await fetchCsrfToken(credentials, null, systemKey);
  const cookieHeader = Array.isArray(cookies)
    ? cookies.map((c) => c.split(';')[0]).join('; ')
    : (cookies || '');

  const basicAuthHeader = buildBasicAuthHeader(credentials);

  // 2. Map payload fields to OData fields
  const odataPayload = {};
  if (payload && typeof payload === 'object') {
    for (const [colName, val] of Object.entries(payload)) {
      const colDef = getColumnByName(entityKey, colName);
      const odataKey = colDef?.odataField || colName;
      odataPayload[odataKey] = val;
    }
  }

  // 3. Execute requested operation
  if (operation === 'create') {
    const url = `${cleanBase}/${schema.odataEntitySet}`;

    // Handle nested address deep insert for Business Partner if provided
    if (
      schema.defaultExpand === 'to_BusinessPartnerAddress' &&
      (payload?.City || payload?.Country || payload?.StreetAddress || payload?.PostalCode) &&
      !odataPayload.to_BusinessPartnerAddress
    ) {
      odataPayload.to_BusinessPartnerAddress = [
        {
          CityName: String(payload.City || '').trim(),
          Country: String(payload.Country || '').trim().toUpperCase(),
          StreetName: String(payload.StreetAddress || '').trim(),
          PostalCode: String(payload.PostalCode || '').trim()
        }
      ];
    }

    try {
      const response = await axios.post(url, odataPayload, {
        headers: {
          Authorization: basicAuthHeader,
          'x-csrf-token': token,
          'Content-Type': 'application/json',
          Accept: 'application/json',
          ...(cookieHeader ? { Cookie: cookieHeader } : {})
        },
        timeout: 20000
      });

      return {
        success: true,
        before: null,
        after: response.data?.d || response.data || payload
      };
    } catch (err) {
      throw parseSapError(err, `Real SAP create on ${schema.odataEntitySet} failed`);
    }
  }

  if (operation === 'update') {
    if (!id) {
      throw new Error(`${schema.singularLabel || schema.label} ID is required for update.`);
    }

    const cleanId = String(id).trim().replace(/'/g, "''");
    const url = `${cleanBase}/${schema.odataEntitySet}('${cleanId}')`;

    let before = null;
    try {
      before = await fetchRealSapRecordById(entityKey, id, credentials);
    } catch {
      // Continue even if pre-read fails
    }

    const writeHeaders = {
      Authorization: basicAuthHeader,
      'x-csrf-token': token,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'If-Match': '*',
      ...(cookieHeader ? { Cookie: cookieHeader } : {})
    };

    let response;
    try {
      response = await axios.patch(url, odataPayload, {
        headers: writeHeaders,
        timeout: 20000
      });
    } catch (patchErr) {
      // Fallback to MERGE if Gateway version rejects PATCH (HTTP 405 Method Not Allowed)
      if (patchErr.response?.status === 405) {
        try {
          response = await axios({
            method: 'MERGE',
            url,
            data: odataPayload,
            headers: writeHeaders,
            timeout: 20000
          });
        } catch (mergeErr) {
          try {
            response = await axios.post(url, odataPayload, {
              headers: { ...writeHeaders, 'X-HTTP-Method': 'MERGE' },
              timeout: 20000
            });
          } catch (tunnelErr) {
            throw parseSapError(tunnelErr, `Real SAP update (MERGE) on ${schema.odataEntitySet} failed`);
          }
        }
      } else {
        throw parseSapError(patchErr, `Real SAP update on ${schema.odataEntitySet} failed`);
      }
    }

    const after = response?.data?.d || response?.data || (before ? { ...before, ...payload } : payload);
    return { success: true, before, after };
  }

  if (operation === 'delete') {
    if (!id) {
      throw new Error(`${schema.singularLabel || schema.label} ID is required for deletion.`);
    }

    const cleanId = String(id).trim().replace(/'/g, "''");
    const url = `${cleanBase}/${schema.odataEntitySet}('${cleanId}')`;

    let before = null;
    try {
      before = await fetchRealSapRecordById(entityKey, id, credentials);
    } catch {
      // Continue even if pre-read fails
    }

    const deleteHeaders = {
      Authorization: basicAuthHeader,
      'x-csrf-token': token,
      Accept: 'application/json',
      'If-Match': '*',
      ...(cookieHeader ? { Cookie: cookieHeader } : {})
    };

    try {
      await axios.delete(url, {
        headers: deleteHeaders,
        timeout: 20000
      });

      return {
        success: true,
        before,
        after: null
      };
    } catch (delErr) {
      throw parseSapError(delErr, `Real SAP delete on ${schema.odataEntitySet} failed`);
    }
  }

  throw new Error(`Unsupported write operation: "${operation}"`);
}

/**
 * Retrieves a single record by primary key for any registered entity.
 * In mock mode: synchronous memory lookup from cache.
 * In real mode: fetches from SAP Gateway.
 * @param {string} entityKey
 * @param {string} id
 * @param {object} [credentials=null]
 * @param {string|null} [systemKey=null]
 * @returns {object|Promise<object>|null}
 */
export function getEntityRecordById(entityKey, id, credentials = null, systemKey = null) {
  if (!id) return null;
  const schema = getEntitySchema(entityKey);
  if (!schema) return null;

  if (isMockMode() || schema.guiScriptBased) {
    const targetId = String(id).trim();
    const cleanTarget = targetId.replace(/^0+/, '');
    const dataset = getMockDataCache(schema.entityKey);

    const found = dataset.find((item) => {
      const rawVal = item[schema.idField];
      if (rawVal !== undefined && rawVal !== null) {
        const itemStr = String(rawVal).trim();
        if (itemStr === targetId) return true;
        if (cleanTarget && itemStr.replace(/^0+/, '') === cleanTarget) return true;
      }
      // Check aliases if defined
      const idCol = schema.columns?.find((c) => c.name === schema.idField);
      if (idCol && Array.isArray(idCol.aliases)) {
        for (const alias of idCol.aliases) {
          if (item[alias] !== undefined && item[alias] !== null) {
            const aliasStr = String(item[alias]).trim();
            if (aliasStr === targetId) return true;
            if (cleanTarget && aliasStr.replace(/^0+/, '') === cleanTarget) return true;
          }
        }
      }
      return false;
    });

    return found ? JSON.parse(JSON.stringify(found)) : null;
  }

  return fetchRealSapRecordById(entityKey, id, credentials, systemKey);
}

/**
 * Updates an existing record for any registered entity.
 * @param {string} entityKey
 * @param {string} id
 * @param {object} changes
 * @param {object} [credentials=null]
 * @param {string|null} [systemKey=null]
 * @returns {Promise<{ success: boolean, before: object, after: object }>}
 */
export async function updateEntityRecord(entityKey, id, changes, credentials = null, systemKey = null) {
  const schema = getEntitySchema(entityKey);
  if (!schema) {
    throw new Error(`Unregistered entity "${entityKey}".`);
  }

  if (!id) {
    throw new Error(`${schema.singularLabel || schema.label} ID is required for update.`);
  }

  if (isMockMode()) {
    const dataset = getMockDataCache(schema.entityKey);
    const targetId = String(id).trim();
    const index = dataset.findIndex((item) => String(item[schema.idField]) === targetId);

    if (index === -1) {
      throw new Error(`${schema.singularLabel || schema.label} with ID "${id}" was not found.`);
    }

    const before = JSON.parse(JSON.stringify(dataset[index]));
    const item = dataset[index];

    // Apply changes generically based on column mappings
    for (const [colName, val] of Object.entries(changes)) {
      const colDef = getColumnByName(schema.entityKey, colName);
      const strVal = String(val).trim();

      // Update on root object (both schema name and odataField name)
      item[colName] = strVal;
      if (colDef?.odataField) {
        item[colDef.odataField] = strVal;
      }

      // If mapped to nested address field, update expanded address sub-object
      if (colDef?.addressField && schema.defaultExpand) {
        if (item[schema.defaultExpand]?.results?.[0]) {
          item[schema.defaultExpand].results[0][colDef.addressField] = strVal;
        }
      }
    }

    const after = JSON.parse(JSON.stringify(item));
    return { success: true, before, after };
  }

  return writeToRealSap(entityKey, 'update', id, changes, credentials, systemKey);
}

/**
 * Creates a new record for any registered entity.
 * @param {string} entityKey
 * @param {object} fields
 * @param {object} [credentials=null]
 * @param {string|null} [systemKey=null]
 * @returns {Promise<{ success: boolean, before: null, after: object }>}
 */
export async function createEntityRecord(entityKey, fields, credentials = null, systemKey = null) {
  const schema = getEntitySchema(entityKey);
  if (!schema) {
    throw new Error(`Unregistered entity "${entityKey}".`);
  }

  if (isMockMode()) {
    const dataset = getMockDataCache(schema.entityKey);

    // Compute next sequential ID (numeric max + 1)
    let maxId = 1000;
    for (const item of dataset) {
      const num = parseInt(item[schema.idField], 10);
      if (!isNaN(num) && num > maxId) {
        maxId = num;
      }
    }
    const newId = String(maxId + 1);

    // Construct new entity record
    const newRecord = {
      [schema.idField]: newId
    };

    // Populate fields defined in schema
    for (const col of schema.columns) {
      if (col.readOnly) continue;
      const rawVal = fields[col.name] !== undefined ? fields[col.name] : '';
      const strVal = String(rawVal).trim();
      newRecord[col.name] = strVal;
      if (col.odataField) {
        newRecord[col.odataField] = strVal;
      }
    }

    // Set up nested expansion if entity uses address or sub-entity
    if (schema.defaultExpand === 'to_BusinessPartnerAddress') {
      newRecord.to_BusinessPartnerAddress = {
        results: [
          {
            AddressID: `ADDR-${newId}`,
            CityName: String(fields.City || '').trim(),
            Country: String(fields.Country || '').trim().toUpperCase(),
            StreetName: String(fields.StreetAddress || '').trim(),
            PostalCode: String(fields.PostalCode || '').trim()
          }
        ]
      };
    }

    // Prepend to dataset so it appears on first page
    dataset.unshift(newRecord);

    return {
      success: true,
      before: null,
      after: JSON.parse(JSON.stringify(newRecord))
    };
  }

  // GUI Scripting based entities (e.g. BOM creation in CS01)
  if (schema.guiScriptBased) {
    if (fields.sourceReference || fields.copyFrom) {
      const source = fields.sourceReference || fields.copyFrom;
      const copyResult = await copyBomViaGui({
        source: {
          material: source.material || source.matnr,
          plant: source.plant || source.werks,
          bomUsage: source.bomUsage || source.stlan || '1',
          alternativeBom: source.alternativeBom || source.stlal || ''
        },
        target: {
          material: fields.material || fields.matnr || fields.id,
          plant: fields.plant || fields.werks || '1000',
          bomUsage: fields.bomUsage || fields.stlan || '1',
          alternativeBom: fields.alternativeBom || fields.stlal || '',
          validFrom: fields.validFrom || fields.datuv || ''
        }
      });

      if (!copyResult.success || copyResult.verified === false) {
        const err = new Error(copyResult.message || 'Copy From BOM failed or could not be verified in SAP GUI.');
        err.code = copyResult.code || 'GUI_COPY_FAILED';
        throw err;
      }

      return copyResult;
    }

    const guiResult = await createBomViaGui({
      material: fields.material || fields.matnr || fields.id,
      plant: fields.plant || fields.werks || '1000',
      bomUsage: fields.bomUsage || fields.stlan || '1',
      validFrom: fields.validFrom || fields.datuv,
      alternativeBom: fields.alternativeBom || fields.stlal || '',
      components: fields.components || fields.items || []
    });

    if (!guiResult.success || guiResult.verified === false) {
      const err = new Error(guiResult.message || 'BOM creation failed or could not be verified in SAP GUI.');
      err.code = guiResult.code || 'GUI_SCRIPT_ERROR';
      throw err;
    }

    return guiResult;
  }

  return writeToRealSap(entityKey, 'create', null, fields, credentials, systemKey);
}

/**
 * Deletes an existing record for any registered entity.
 * @param {string} entityKey
 * @param {string} id
 * @param {object} [credentials=null]
 * @param {string|null} [systemKey=null]
 * @returns {Promise<{ success: boolean, before: object, after: null }>}
 */
export async function deleteEntityRecord(entityKey, id, credentials = null, systemKey = null) {
  const schema = getEntitySchema(entityKey);
  if (!schema) {
    throw new Error(`Unregistered entity "${entityKey}".`);
  }

  if (!id) {
    throw new Error(`${schema.singularLabel || schema.label} ID is required for deletion.`);
  }

  // GUI Scripting based entities (e.g. BOM deletion via ZBOM_COPY in SAP GUI)
  if (schema.guiScriptBased || entityKey === 'bom') {
    let material = id;
    let plant = credentials?.plant || '1001';
    let alternativeBom = credentials?.alternativeBom || '1';
    let bomUsage = credentials?.bomUsage || '1';

    if (typeof id === 'object' && id !== null) {
      material = id.material || id.matnr || id.id;
      plant = id.plant || id.werks || plant;
      alternativeBom = id.alternativeBom || id.stlal || alternativeBom;
      bomUsage = id.bomUsage || id.stlan || bomUsage;
    }

    const deleteResult = await deleteBomViaGui({
      material,
      plant,
      alternativeBom,
      bomUsage
    });

    if (!deleteResult.success || deleteResult.verified === false) {
      const err = new Error(deleteResult.message || 'Delete BOM failed or could not be verified in SAP GUI.');
      err.code = deleteResult.code || 'GUI_DELETE_FAILED';
      throw err;
    }

    return deleteResult;
  }

  if (isMockMode()) {
    const dataset = getMockDataCache(schema.entityKey);
    const targetId = String(id).trim();
    const index = dataset.findIndex((item) => String(item[schema.idField]) === targetId);

    if (index === -1) {
      throw new Error(`${schema.singularLabel || schema.label} with ID "${id}" was not found.`);
    }

    const before = JSON.parse(JSON.stringify(dataset[index]));
    dataset.splice(index, 1);

    return {
      success: true,
      before,
      after: null
    };
  }

  return writeToRealSap(entityKey, 'delete', id, null, credentials, systemKey);
}

/**
 * Helper to get all comparable values for a given column from a mock item.
 * Checks root item properties as well as nested expansion objects.
 */
function getRecordFieldValues(entityKey, item, column) {
  const schema = getEntitySchema(entityKey);
  const colDef = getColumnByName(entityKey, column);
  const values = [];

  if (colDef) {
    if (item[colDef.name] !== undefined && item[colDef.name] !== null) {
      values.push(item[colDef.name]);
    }
    if (colDef.odataField && item[colDef.odataField] !== undefined && item[colDef.odataField] !== null) {
      values.push(item[colDef.odataField]);
    }
    if (Array.isArray(colDef.aliases)) {
      for (const alias of colDef.aliases) {
        if (item[alias] !== undefined && item[alias] !== null) {
          values.push(item[alias]);
        }
      }
    }
    if (schema?.defaultExpand && colDef.addressField) {
      const nested = item[schema.defaultExpand]?.results?.[0];
      if (nested && nested[colDef.addressField] !== undefined && nested[colDef.addressField] !== null) {
        values.push(nested[colDef.addressField]);
      }
    }
  } else {
    if (item[column] !== undefined && item[column] !== null) {
      values.push(item[column]);
    }
  }

  return values;
}

/**
 * Evaluates a single filter condition against a mock record.
 */
function evaluateFilterOnItem(entityKey, item, filter) {
  const { column, operator, value } = filter;
  const values = getRecordFieldValues(entityKey, item, column);
  if (values.length === 0) return false;

  let targetStr = String(value).trim().toLowerCase();
  if (entityKey === 'backgroundJob' && (column === 'status' || column === 'previousRunStatus')) {
    if (['failed', 'unsuccessful', 'errored', 'fail', 'error', 'cancelled', 'canceled'].includes(targetStr)) {
      targetStr = 'cancelled';
    } else if (['succeeded', 'successful', 'completed', 'success', 'done', 'finished'].includes(targetStr)) {
      targetStr = 'finished';
    } else if (['in progress', 'in-progress', 'active', 'running'].includes(targetStr)) {
      targetStr = 'running';
    } else if (['scheduled', 'queued', 'pending'].includes(targetStr)) {
      targetStr = 'scheduled';
    }
  } else if (entityKey === 'idoc' && column === 'status') {
    if (['failed', 'error', 'errored', '51', '51-error'].includes(targetStr)) {
      targetStr = '51-error';
    } else if (['success', 'succeeded', 'processed', 'successful', '53', '53-successful'].includes(targetStr)) {
      targetStr = '53-successful';
    } else if (['waiting', 'ready', 'queued', '64', '64-waiting'].includes(targetStr)) {
      targetStr = '64-waiting';
    } else if (['sent', 'dispatched', '03', '03-sent'].includes(targetStr)) {
      targetStr = '03-sent';
    }
  } else if (entityKey === 'interfaceMonitor' && column === 'status') {
    if (['failed', 'error', 'errored', 'fail', 'failing'].includes(targetStr)) {
      targetStr = 'failed';
    } else if (['success', 'succeeded', 'healthy', 'successful', 'done', 'ok'].includes(targetStr)) {
      targetStr = 'success';
    } else if (['pending', 'running', 'in progress', 'queued'].includes(targetStr)) {
      targetStr = 'pending';
    }
  } else if (entityKey === 'applicationLog' && column === 'severity') {
    if (['err', 'error', 'errors'].includes(targetStr)) {
      targetStr = 'error';
    } else if (['warn', 'warning', 'warnings'].includes(targetStr)) {
      targetStr = 'warning';
    } else if (['info', 'information'].includes(targetStr)) {
      targetStr = 'info';
    }
  }

  const op = String(operator).trim().toLowerCase();

  return values.some((val) => {
    const valStr = String(val).trim();
    const valLower = valStr.toLowerCase();

    switch (op) {
      case 'eq': {
        if (valLower === targetStr) return true;
        const nVal = Number(valStr);
        const nTarget = Number(targetStr);
        if (!isNaN(nVal) && !isNaN(nTarget) && nVal === nTarget) return true;
        return false;
      }
      case 'contains': {
        return valLower.includes(targetStr);
      }
      case 'ge': {
        const nVal = parseInt(valStr, 10);
        const nTarget = parseInt(targetStr, 10);
        if (!isNaN(nVal) && !isNaN(nTarget)) {
          return nVal >= nTarget;
        }
        return valStr >= targetStr;
      }
      case 'le': {
        const nVal = parseInt(valStr, 10);
        const nTarget = parseInt(targetStr, 10);
        if (!isNaN(nVal) && !isNaN(nTarget)) {
          return nVal <= nTarget;
        }
        return valStr <= targetStr;
      }
      default:
        return false;
    }
  });
}

/**
 * Queries entity records (Mock mode).
 */
function fetchMockEntityData(entityKey, { filters, from, to, city, top, skip }) {
  const schema = getEntitySchema(entityKey);
  const allRecords = getMockDataCache(schema.entityKey);
  let filtered = allRecords;

  // 1. Dynamic filters evaluation
  if (Array.isArray(filters) && filters.length > 0) {
    filtered = filtered.filter((item) => {
      return filters.every((f) => evaluateFilterOnItem(schema.entityKey, item, f));
    });
  }

  // 2. Legacy city filter if specified without filters array
  if (city) {
    const cityLower = String(city).trim().toLowerCase();
    filtered = filtered.filter((item) => {
      const directCity = String(item.City || '').toLowerCase();
      const addrCity = String(item.to_BusinessPartnerAddress?.results?.[0]?.CityName || '').toLowerCase();
      return directCity.includes(cityLower) || addrCity.includes(cityLower);
    });
  }

  // 3. ID range filtering on primary key
  if (from || to) {
    const idField = schema.idField;
    const fromNum = from ? parseInt(from, 10) : null;
    const toNum = to ? parseInt(to, 10) : null;
    const isNumericRange = !isNaN(fromNum) && !isNaN(toNum);

    filtered = filtered.filter((item) => {
      const recId = String(item[idField] || '');
      const recNum = parseInt(recId, 10);

      if (isNumericRange && !isNaN(recNum)) {
        if (fromNum !== null && recNum < fromNum) return false;
        if (toNum !== null && recNum > toNum) return false;
        return true;
      }

      if (from && recId < from) return false;
      if (to && recId > to) return false;
      return true;
    });
  }

  const totalCount = filtered.length;
  const pagedResults = filtered.slice(skip, skip + top);

  return {
    d: {
      results: pagedResults,
      __count: totalCount.toString()
    }
  };
}

/**
 * Builds an OData v2 $filter clause for a given column filter.
 */
function buildODataFilterClause(entityKey, filter) {
  const { column, operator, value } = filter;
  const odataField = getODataFieldName(entityKey, column);
  const safeVal = String(value).replace(/'/g, "''");
  const op = String(operator).trim().toLowerCase();

  switch (op) {
    case 'eq':
      return `${odataField} eq '${safeVal}'`;
    case 'ge':
      return `${odataField} ge '${safeVal}'`;
    case 'le':
      return `${odataField} le '${safeVal}'`;
    case 'contains':
      return `substringof('${safeVal}', ${odataField}) eq true`;
    default:
      return null;
  }
}

/**
 * Real SAP Gateway OData querying for any entity.
 * @param {string} entityKey
 * @param {object} credentials { username, password }
 * @param {object} params { filters, from, to, top, skip, expand }
 * @returns {Promise<object>} Standard OData v2 response shape { d: { results: [...], __count: "..." } }
 */
export async function fetchRealSapEntityData(entityKey, credentials, { filters, from, to, top, skip, expand } = {}, systemKey = null) {
  const schema = getEntitySchema(entityKey);
  if (!schema) {
    throw new Error(`Unregistered entity "${entityKey}".`);
  }

  const sapBaseUrl = resolveSapBaseUrl(systemKey);
  if (!sapBaseUrl) {
    throw new Error(`Target SAP system "${systemKey || 'DEV'}" does not have a valid baseUrl configured in systemRegistry.`);
  }

  const cleanBase = sapBaseUrl.replace(/\/$/, '');
  const url = `${cleanBase}/${schema.odataEntitySet}`;

  const parsedTop = top ? Math.min(Math.max(parseInt(top, 10) || 50, 1), 500) : 50;
  const parsedSkip = skip ? Math.max(parseInt(skip, 10) || 0, 0) : 0;

  const queryParams = {
    $top: parsedTop,
    $skip: parsedSkip,
    $inlinecount: 'allpages',
    $format: 'json'
  };

  if (expand || schema.defaultExpand) {
    queryParams.$expand = expand || schema.defaultExpand;
  }

  const filterClauses = [];

  if (Array.isArray(filters) && filters.length > 0) {
    for (const f of filters) {
      const clause = buildODataFilterClause(schema.entityKey, f);
      if (clause) filterClauses.push(clause);
    }
  }

  if (from) {
    filterClauses.push(`${schema.idField} ge '${from}'`);
  }
  if (to) {
    filterClauses.push(`${schema.idField} le '${to}'`);
  }

  if (filterClauses.length > 0) {
    queryParams.$filter = filterClauses.join(' and ');
  }

  const basicAuthHeader = buildBasicAuthHeader(credentials);

  try {
    const response = await axios.get(url, {
      params: queryParams,
      headers: {
        Authorization: basicAuthHeader,
        Accept: 'application/json'
      },
      timeout: 15000
    });

    const data = response.data;
    if (data?.d?.results) {
      return data;
    }
    if (Array.isArray(data?.d)) {
      return {
        d: {
          results: data.d,
          __count: (data.d.length).toString()
        }
      };
    }
    if (Array.isArray(data)) {
      return {
        d: {
          results: data,
          __count: (data.length).toString()
        }
      };
    }
    return {
      d: {
        results: data?.d ? [data.d] : [],
        __count: data?.d ? '1' : '0'
      }
    };
  } catch (error) {
    throw parseSapError(error, `SAP OData query for ${schema.odataEntitySet} failed`);
  }
}

/**
 * Primary generic data-fetch function for any entity.
 * Points to mock data or real target SAP system baseUrl dynamically based on USE_MOCK_SAP.
 * 
 * @param {string} [entityKey='businessPartner']
 * @param {object} [options={}] { filters, from, to, city, top, skip, expand }
 * @param {object} [credentials=null]
 * @param {string|null} [systemKey=null]
 * @returns {Promise<object>} SAP OData formatted response { d: { results: [...], __count: ... } }
 */
export async function getEntityData(entityKey = 'businessPartner', options = {}, credentials = null, systemKey = null) {
  const schema = getEntitySchema(entityKey);
  if (!schema) {
    throw new Error(`Unrecognized entity key: "${entityKey}"`);
  }

  const top = options.top ? Math.min(Math.max(parseInt(options.top, 10) || 50, 1), 500) : 50;
  const skip = options.skip ? Math.max(parseInt(options.skip, 10) || 0, 0) : 0;
  const from = options.from ? String(options.from).trim() : (options.fromId ? String(options.fromId).trim() : null);
  const to = options.to ? String(options.to).trim() : (options.toId ? String(options.toId).trim() : null);
  const city = options.city ? String(options.city).trim() : null;
  const expand = options.expand || schema.defaultExpand;

  // Process filters
  let filters = [];
  if (Array.isArray(options.filters)) {
    filters = options.filters.filter((f) => {
      if (!f || !f.column || !f.operator || f.value === undefined || f.value === null) return false;
      if (!isValidColumn(schema.entityKey, f.column)) {
        console.warn(`[sapClient] Unknown column "${f.column}" for entity "${schema.entityKey}" ignored.`);
        return false;
      }
      if (!isValidOperator(f.operator)) {
        console.warn(`[sapClient] Unsupported operator "${f.operator}" ignored.`);
        return false;
      }
      return true;
    });
  }

  // Convert legacy parameters to filters if needed
  if (filters.length === 0) {
    if (options.city) {
      filters.push({ column: 'City', operator: 'eq', value: String(options.city) });
    }
    if (from) {
      filters.push({ column: schema.idField, operator: 'ge', value: String(from) });
    }
    if (to) {
      filters.push({ column: schema.idField, operator: 'le', value: String(to) });
    }
    if (options.category) {
      filters.push({ column: 'Category', operator: 'eq', value: String(options.category) });
    }
  }

  if (isMockMode() || schema.guiScriptBased) {
    return fetchMockEntityData(schema.entityKey, { filters, from, to, city, top, skip });
  }

  return fetchRealSapEntityData(schema.entityKey, credentials, { filters, from, to, top, skip, expand }, systemKey);
}

// =========================================================================
// BACKWARD COMPATIBILITY FACADES
// Preserves zero-breaking-change behavior for existing routes and tests.
// =========================================================================

export async function getBusinessPartners(options = {}, credentials = null) {
  return getEntityData('businessPartner', options, credentials);
}

export function getBusinessPartnerById(id, credentials = null) {
  return getEntityRecordById('businessPartner', id, credentials);
}

export async function updateBusinessPartner(id, changes, credentials = null) {
  return updateEntityRecord('businessPartner', id, changes, credentials);
}

export async function createBusinessPartner(fields, credentials = null) {
  return createEntityRecord('businessPartner', fields, credentials);
}

export async function deleteBusinessPartner(id, credentials = null) {
  return deleteEntityRecord('businessPartner', id, credentials);
}

export async function fetchBusinessPartners(credentials, params = {}) {
  return getEntityData('businessPartner', params, credentials);
}

/**
 * Retrieves the error and execution log for a specific background job.
 * @param {string} jobId
 * @returns {Array<object>}
 */
export function getBackgroundJobLog(jobId) {
  const job = getEntityRecordById('backgroundJob', jobId);
  return job?.jobLog || [];
}

/**
 * Retries a cancelled background job following confirmed human approval.
 * Transitions status: CANCELLED -> RUNNING -> FINISHED, increments retryCount, and updates log.
 * @param {string} jobId
 * @returns {Promise<{ success: boolean, before: object, after: object }>}
 */
export async function retryBackgroundJob(jobId) {
  const cleanId = String(jobId).trim();
  const dataset = getMockDataCache('backgroundJob');
  const jobIndex = dataset.findIndex(
    (j) => String(j.jobId).trim().toLowerCase() === cleanId.toLowerCase()
  );

  if (jobIndex === -1) {
    throw new Error(`Background Job "${jobId}" not found in SAP job catalog.`);
  }

  const job = dataset[jobIndex];
  if (job.status !== 'CANCELLED') {
    throw new Error(`Job "${jobId}" is currently in status "${job.status}". Only CANCELLED jobs can be retried.`);
  }

  const before = JSON.parse(JSON.stringify(job));

  // Simulate execution: transition to FINISHED and record remediation
  const now = new Date().toISOString();
  job.previousRunStatus = 'CANCELLED';
  job.retryCount = (job.retryCount || 0) + 1;
  job.status = 'FINISHED';
  job.endTime = now;

  if (!Array.isArray(job.jobLog)) {
    job.jobLog = [];
  }

  job.jobLog.push({
    timestamp: now,
    severity: 'INFO',
    message: `Job retried successfully by Operations Agent following confirmed human approval (Retry #${job.retryCount}).`
  });

  const after = JSON.parse(JSON.stringify(job));
  return { success: true, before, after };
}

/**
 * Retrieves a single IDoc by IDoc number.
 * @param {string} idocNumber
 * @returns {object|null}
 */
export function getIdocById(idocNumber) {
  return getEntityRecordById('idoc', idocNumber);
}

/**
 * Reprocesses a failed IDoc (status 51-Error) following confirmed human approval.
 * Transitions status: 51-Error -> 53-Successful, appends audit trail entry to errorLog.
 * @param {string} idocNumber
 * @returns {Promise<{ success: boolean, before: object, after: object }>}
 */
export async function reprocessIdoc(idocNumber) {
  const cleanId = String(idocNumber).trim();
  const dataset = getMockDataCache('idoc');
  const idocIndex = dataset.findIndex(
    (item) => String(item.idocNumber).trim().toLowerCase() === cleanId.toLowerCase()
  );

  if (idocIndex === -1) {
    throw new Error(`IDoc "${idocNumber}" not found in SAP IDoc system.`);
  }

  const idoc = dataset[idocIndex];
  if (idoc.status !== '51-Error') {
    throw new Error(`IDoc "${idocNumber}" is currently in status "${idoc.status}". Only IDocs in status "51-Error" can be reprocessed.`);
  }

  const before = JSON.parse(JSON.stringify(idoc));
  const now = new Date().toISOString();

  idoc.status = '53-Successful';
  if (!Array.isArray(idoc.errorLog)) {
    idoc.errorLog = [];
  }

  idoc.errorLog.push({
    segment: 'EDI_STATUS',
    message: `IDoc reprocessed successfully by Operations Agent following confirmed human approval at ${now}. Status changed to 53-Successful.`
  });

  const after = JSON.parse(JSON.stringify(idoc));
  return { success: true, before, after };
}

/**
 * Retrieves a single Interface flow by interfaceId.
 * @param {string} interfaceId
 * @returns {object|null}
 */
export function getInterfaceById(interfaceId) {
  return getEntityRecordById('interfaceMonitor', interfaceId);
}

/**
 * Retriggers a failed integration interface flow following confirmed human approval.
 * Transitions status: FAILED -> SUCCESS, clears failureReason, updates lastRunTime.
 * @param {string} interfaceId
 * @returns {Promise<{ success: boolean, before: object, after: object }>}
 */
export async function retriggerInterface(interfaceId) {
  const cleanId = String(interfaceId).trim();
  const dataset = getMockDataCache('interfaceMonitor');
  const ifaceIndex = dataset.findIndex(
    (item) => String(item.interfaceId).trim().toLowerCase() === cleanId.toLowerCase()
  );

  if (ifaceIndex === -1) {
    throw new Error(`Interface "${interfaceId}" not found in SAP integration monitor.`);
  }

  const iface = dataset[ifaceIndex];
  if (iface.status !== 'FAILED') {
    throw new Error(`Interface "${interfaceId}" is currently in status "${iface.status}". Only FAILED interfaces can be retriggered.`);
  }

  const before = JSON.parse(JSON.stringify(iface));
  const now = new Date().toISOString();

  iface.status = 'SUCCESS';
  iface.failureReason = null;
  iface.lastRunTime = now;

  const after = JSON.parse(JSON.stringify(iface));
  return { success: true, before, after };
}

/**
 * Releases a purchase order (Level 3 Sensitive Action).
 * Requires mandatory human confirmation and business justification.
 *
 * @param {string} poNumber
 * @param {string} [releaseCode='L3']
 * @param {string} [reason='']
 * @returns {Promise<{ success: boolean, before: object, after: object }>}
 */
export async function releasePurchaseOrder(poNumber, releaseCode = 'L3', reason = '') {
  const cleanId = String(poNumber).trim();
  const dataset = getMockDataCache('purchaseOrder');
  const index = dataset.findIndex(
    (item) => String(item.poNumber).trim().toLowerCase() === cleanId.toLowerCase()
  );

  if (index === -1) {
    throw new Error(`Purchase Order "${poNumber}" not found in SAP purchasing system.`);
  }

  const po = dataset[index];
  if (po.status === 'RELEASED') {
    throw new Error(`Purchase Order "${poNumber}" is already in RELEASED status.`);
  }

  const before = JSON.parse(JSON.stringify(po));
  po.status = 'RELEASED';
  po.releaseStatus = 'APPROVED';
  po.releaseCode = releaseCode || 'L3';
  po.releasedAt = new Date().toISOString();
  po.releaseReason = reason || 'Operational approval';

  const after = JSON.parse(JSON.stringify(po));
  return { success: true, before, after };
}

/**
 * Posts a financial accounting document (Level 3 Sensitive Action).
 * Clearly flagged as highest scrutiny.
 *
 * @param {object} documentDetails
 * @param {string} [reason='']
 * @returns {Promise<{ success: boolean, before: null, after: object }>}
 */
export async function postFinancialDocument(documentDetails, reason = '') {
  if (!documentDetails || typeof documentDetails !== 'object') {
    throw new Error('Valid financial document details are required for posting.');
  }

  const dataset = getMockDataCache('financialDocument');
  let maxNum = 1900000000;
  for (const doc of dataset) {
    const num = parseInt(doc.documentNumber, 10);
    if (!isNaN(num) && num > maxNum) maxNum = num;
  }

  const newDocNumber = String(maxNum + 1);
  const now = new Date().toISOString().slice(0, 10);

  const newDoc = {
    documentNumber: newDocNumber,
    companyCode: documentDetails.companyCode || '1000',
    fiscalYear: documentDetails.fiscalYear || '2026',
    docType: documentDetails.docType || 'SA',
    postingDate: documentDetails.postingDate || now,
    documentDate: documentDetails.documentDate || now,
    currency: documentDetails.currency || 'EUR',
    totalAmount: Number(documentDetails.totalAmount) || 0,
    headerText: documentDetails.headerText || 'AI Financial Posting',
    status: 'POSTED',
    enteredBy: 'AI_SAP_AGENT',
    postingReason: reason || 'Business journal entry',
    items: documentDetails.items || [
      {
        itemNumber: '001',
        glAccount: documentDetails.glAccount || '400100',
        debitCredit: 'S',
        amount: Number(documentDetails.totalAmount) || 0,
        costCenter: documentDetails.costCenter || 'CC-IT-OPS'
      }
    ]
  };

  dataset.unshift(newDoc);
  return {
    success: true,
    before: null,
    after: JSON.parse(JSON.stringify(newDoc))
  };
}

/**
 * Changes sensitive master data (Level 3 Sensitive Action).
 *
 * @param {string} entityKey
 * @param {string} recordId
 * @param {object} changes
 * @param {string} [reason='']
 * @returns {Promise<{ success: boolean, before: object, after: object }>}
 */
export async function changeMasterData(entityKey, recordId, changes, reason = '') {
  const result = await updateEntityRecord(entityKey, recordId, changes);
  if (result.after) {
    result.after.lastMasterDataChangeReason = reason || 'Authorized sensitive update';
  }
  return result;
}

export { deleteBomViaGui };
