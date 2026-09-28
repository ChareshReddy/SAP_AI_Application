/**
 * Entity Schema Registry
 * Central registry and generic helper functions for all SAP entities.
 * Adding a new entity requires only:
 *  1. Creating an entity schema file in this directory.
 *  2. Adding its mock data file in backend/mock/.
 *  3. Registering it here in ENTITY_REGISTRY.
 */

import { businessPartnerSchema } from './businessPartner.js';
import { backgroundJobSchema } from './backgroundJob.js';
import { idocSchema } from './idoc.js';
import { applicationLogSchema } from './applicationLog.js';
import { interfaceMonitorSchema } from './interfaceMonitor.js';
import { purchaseOrderSchema } from './purchaseOrder.js';
import { financialDocumentSchema } from './financialDocument.js';
import { knowledgeBaseSchema } from './knowledgeBase.js';
import { bomSchema } from './bom.js';

export const ENTITY_REGISTRY = {
  businessPartner: businessPartnerSchema,
  backgroundJob: backgroundJobSchema,
  idoc: idocSchema,
  applicationLog: applicationLogSchema,
  interfaceMonitor: interfaceMonitorSchema,
  purchaseOrder: purchaseOrderSchema,
  financialDocument: financialDocumentSchema,
  knowledgeBase: knowledgeBaseSchema,
  bom: bomSchema
};

export const ENTITY_ALIASES = {
  // BOM aliases
  bom: 'bom',
  boms: 'bom',
  billofmaterial: 'bom',
  billofmaterials: 'bom',
  bill_of_material: 'bom',
  bill_of_materials: 'bom',
  bills_of_materials: 'bom',
  bills_of_material: 'bom',
  cs01: 'bom',
  cs02: 'bom',
  cs03: 'bom',

  // Business Partner aliases
  bp: 'businessPartner',
  bps: 'businessPartner',
  businesspartner: 'businessPartner',
  businesspartners: 'businessPartner',
  business_partner: 'businessPartner',
  business_partners: 'businessPartner',
  customer: 'businessPartner',
  customers: 'businessPartner',
  vendor: 'businessPartner',
  vendors: 'businessPartner',

  // Background Job aliases
  job: 'backgroundJob',
  jobs: 'backgroundJob',
  backgroundjob: 'backgroundJob',
  backgroundjobs: 'backgroundJob',
  background_job: 'backgroundJob',
  background_jobs: 'backgroundJob',
  batchjob: 'backgroundJob',
  batchjobs: 'backgroundJob',
  sm37: 'backgroundJob',

  // IDoc aliases
  idoc: 'idoc',
  idocs: 'idoc',
  we02: 'idoc',
  we05: 'idoc',

  // Application Log aliases
  applog: 'applicationLog',
  applogs: 'applicationLog',
  log: 'applicationLog',
  logs: 'applicationLog',
  applicationlog: 'applicationLog',
  applicationlogs: 'applicationLog',
  application_log: 'applicationLog',
  application_logs: 'applicationLog',
  slg1: 'applicationLog',

  // Interface Monitor aliases
  interface: 'interfaceMonitor',
  interfaces: 'interfaceMonitor',
  interfacemonitor: 'interfaceMonitor',
  interface_monitor: 'interfaceMonitor',
  cpi: 'interfaceMonitor',
  aif: 'interfaceMonitor',

  // Purchase Order aliases
  po: 'purchaseOrder',
  pos: 'purchaseOrder',
  purchaseorder: 'purchaseOrder',
  purchaseorders: 'purchaseOrder',
  purchase_order: 'purchaseOrder',
  purchase_orders: 'purchaseOrder',
  me21n: 'purchaseOrder',
  me28: 'purchaseOrder',
  me29n: 'purchaseOrder',

  // Financial Document aliases
  fi: 'financialDocument',
  fidoc: 'financialDocument',
  financialdoc: 'financialDocument',
  financialdocument: 'financialDocument',
  financialdocuments: 'financialDocument',
  financial_document: 'financialDocument',
  financial_documents: 'financialDocument',
  fb01: 'financialDocument',
  fb50: 'financialDocument',

  // Knowledge Base aliases
  kb: 'knowledgeBase',
  knowledgebase: 'knowledgeBase',
  knowledge_base: 'knowledgeBase'
};

export const ALLOWED_OPERATORS = ['eq', 'ge', 'le', 'contains'];

/**
 * Resolves an entity key from a raw tool argument and/or user message.
 * Inspects explicit entityKey with aliases, and falls back to natural language intent detection.
 * @param {string|null} requestedKey
 * @param {string|null} [userMessage='']
 * @returns {string} The canonical entityKey
 */
export function resolveEntityKey(requestedKey, userMessage = '') {
  // If user message explicitly mentions a distinct entity (e.g. BOM, PO, IDoc), prioritize that if requestedKey was omitted or defaulted to 'businessPartner'
  if (userMessage && typeof userMessage === 'string') {
    const msg = userMessage.toLowerCase();
    const mentionsBp = /\b(business\s+partners?|bp\b|customers?|vendors?)/i.test(msg);
    if (!mentionsBp) {
      if (/\b(bom|boms|bill\s+of\s+materials?|bills\s+of\s+materials?|cs01|cs02|cs03)\b/i.test(msg)) {
        return 'bom';
      }
      if (/\b(purchase\s+orders?|po\s+number|po\s+\d+|me21n|me28|me29n)\b/i.test(msg)) {
        return 'purchaseOrder';
      }
      if (/\b(financial\s+documents?|fi\s+docs?|accounting\s+documents?|fb01|fb50)\b/i.test(msg)) {
        return 'financialDocument';
      }
      if (/\b(background\s+jobs?|sm37|batch\s+jobs?)\b/i.test(msg)) {
        return 'backgroundJob';
      }
      if (/\b(idocs?|we02|we05)\b/i.test(msg)) {
        return 'idoc';
      }
      if (/\b(application\s+logs?|slg1)\b/i.test(msg)) {
        return 'applicationLog';
      }
      if (/\b(interfaces?|cpi|aif)\b/i.test(msg)) {
        return 'interfaceMonitor';
      }
    }
  }

  if (requestedKey && typeof requestedKey === 'string') {
    const clean = requestedKey.trim().toLowerCase().replace(/[-_\s]/g, '');
    if (ENTITY_ALIASES[clean]) {
      return ENTITY_ALIASES[clean];
    }
    if (ENTITY_ALIASES[requestedKey.trim().toLowerCase()]) {
      return ENTITY_ALIASES[requestedKey.trim().toLowerCase()];
    }
    const directSchema = getEntitySchema(requestedKey);
    if (directSchema) {
      return directSchema.entityKey;
    }
  }

  // If message mentions BP specifically
  if (userMessage && typeof userMessage === 'string') {
    const msg = userMessage.toLowerCase();
    if (/\b(business\s+partners?|bp\b|customers?|vendors?)/i.test(msg)) {
      return 'businessPartner';
    }
  }

  return requestedKey || 'businessPartner';
}

/**
 * Retrieves the schema for an entity by key.
 * If entityKey is omitted and only one entity exists in registry, returns that entity.
 * @param {string} entityKey
 * @returns {object|null}
 */
export function getEntitySchema(entityKey) {
  if (!entityKey) {
    const keys = Object.keys(ENTITY_REGISTRY);
    return keys.length > 0 ? ENTITY_REGISTRY[keys[0]] : null;
  }

  const cleanKey = String(entityKey).trim();
  // Direct match or case-insensitive match
  if (ENTITY_REGISTRY[cleanKey]) {
    return ENTITY_REGISTRY[cleanKey];
  }

  const foundKey = Object.keys(ENTITY_REGISTRY).find(
    (k) => k.toLowerCase() === cleanKey.toLowerCase()
  );
  if (foundKey) return ENTITY_REGISTRY[foundKey];

  // Normalized alias match
  const normalized = cleanKey.toLowerCase().replace(/[-_\s]/g, '');
  const aliasTarget = ENTITY_ALIASES[normalized] || ENTITY_ALIASES[cleanKey.toLowerCase()];
  if (aliasTarget && ENTITY_REGISTRY[aliasTarget]) {
    return ENTITY_REGISTRY[aliasTarget];
  }

  return null;
}

/**
 * Lists all currently available entities with public metadata.
 * @returns {Array<object>}
 */
export function listAvailableEntities() {
  return Object.values(ENTITY_REGISTRY).map((schema) => ({
    entityKey: schema.entityKey,
    label: schema.label,
    singularLabel: schema.singularLabel,
    description: schema.description,
    odataEntitySet: schema.odataEntitySet,
    idField: schema.idField,
    nameField: schema.nameField,
    columns: schema.columns
  }));
}

/**
 * Checks whether an entityKey is valid and registered.
 * @param {string} entityKey
 * @returns {boolean}
 */
export function isValidEntityKey(entityKey) {
  return getEntitySchema(entityKey) !== null;
}

/**
 * Finds a column definition for a specific entity by primary name or alias.
 * @param {string} entityKey
 * @param {string} columnName
 * @returns {object|null}
 */
export function getColumnByName(entityKey, columnName) {
  if (!columnName || typeof columnName !== 'string') return null;
  const schema = getEntitySchema(entityKey);
  if (!schema || !Array.isArray(schema.columns)) return null;

  const target = columnName.trim().toLowerCase();
  const targetClean = target.replace(/[-_\s]/g, '');

  return (
    schema.columns.find((col) => {
      if (col.name.toLowerCase() === target || col.name.toLowerCase().replace(/[-_\s]/g, '') === targetClean) return true;
      if (col.odataField && (col.odataField.toLowerCase() === target || col.odataField.toLowerCase().replace(/[-_\s]/g, '') === targetClean)) return true;
      if (col.label && (col.label.toLowerCase() === target || col.label.toLowerCase().replace(/[-_\s]/g, '') === targetClean)) return true;
      if (Array.isArray(col.aliases)) {
        return col.aliases.some((alias) => alias.toLowerCase() === target || alias.toLowerCase().replace(/[-_\s]/g, '') === targetClean);
      }
      return false;
    }) || null
  );
}

/**
 * Validates if the given column name is recognized for the entity.
 * @param {string} entityKey
 * @param {string} columnName
 * @returns {boolean}
 */
export function isValidColumn(entityKey, columnName) {
  return getColumnByName(entityKey, columnName) !== null;
}

/**
 * Validates if a column for the entity is editable.
 * @param {string} entityKey
 * @param {string} columnName
 * @returns {boolean}
 */
export function isEditableColumn(entityKey, columnName) {
  const col = getColumnByName(entityKey, columnName);
  return Boolean(col && col.editable);
}

/**
 * Validates if the given operator is one of the supported query operators.
 * @param {string} op
 * @returns {boolean}
 */
export function isValidOperator(op) {
  if (!op || typeof op !== 'string') return false;
  return ALLOWED_OPERATORS.includes(op.trim().toLowerCase());
}

/**
 * Resolves the underlying OData property name for query generation.
 * @param {string} entityKey
 * @param {string} columnName
 * @returns {string}
 */
export function getODataFieldName(entityKey, columnName) {
  const col = getColumnByName(entityKey, columnName);
  return col ? (col.odataField || col.name) : columnName;
}

/**
 * Extracts the existing value of a column from a record object.
 * Handles schema column name, odataField, aliases, case-insensitivity, and nested expanded entities (e.g. to_BusinessPartnerAddress).
 *
 * @param {string} entityKey - The entity key (e.g. 'businessPartner')
 * @param {object} record - The full record object from data source
 * @param {string} columnName - The column or field name
 * @returns {string} The resolved field value, or empty string if not found
 */
export function getRecordColumnValue(entityKey, record, columnName) {
  if (!record || typeof record !== 'object') return '';
  const schema = getEntitySchema(entityKey);
  const colDef = getColumnByName(entityKey, columnName);

  const candidateKeys = [];
  if (colDef) {
    candidateKeys.push(colDef.name);
    if (colDef.odataField && !candidateKeys.includes(colDef.odataField)) {
      candidateKeys.push(colDef.odataField);
    }
    if (Array.isArray(colDef.aliases)) {
      for (const alias of colDef.aliases) {
        if (!candidateKeys.includes(alias)) candidateKeys.push(alias);
      }
    }
  }
  if (columnName && !candidateKeys.includes(columnName)) {
    candidateKeys.push(columnName);
  }

  // 1. Direct match on root record
  for (const k of candidateKeys) {
    if (record[k] !== undefined && record[k] !== null && String(record[k]).trim() !== '') {
      return String(record[k]);
    }
  }

  // 2. Case-insensitive match on root record
  const recordKeys = Object.keys(record);
  for (const k of candidateKeys) {
    const kLower = k.toLowerCase();
    const matched = recordKeys.find((rk) => rk.toLowerCase() === kLower);
    if (matched && record[matched] !== undefined && record[matched] !== null && String(record[matched]).trim() !== '') {
      return String(record[matched]);
    }
  }

  // 3. Nested address / expansion match
  if (schema?.defaultExpand && record[schema.defaultExpand]) {
    const expandObj = record[schema.defaultExpand];
    const nestedItem = Array.isArray(expandObj?.results)
      ? expandObj.results[0]
      : Array.isArray(expandObj)
      ? expandObj[0]
      : typeof expandObj === 'object'
      ? expandObj
      : null;

    if (nestedItem && typeof nestedItem === 'object') {
      const nestedCandidateKeys = [];
      if (colDef?.addressField) {
        nestedCandidateKeys.push(colDef.addressField);
      }
      for (const k of candidateKeys) {
        if (!nestedCandidateKeys.includes(k)) nestedCandidateKeys.push(k);
      }

      for (const nk of nestedCandidateKeys) {
        if (nestedItem[nk] !== undefined && nestedItem[nk] !== null && String(nestedItem[nk]).trim() !== '') {
          return String(nestedItem[nk]);
        }
      }

      const nestedKeys = Object.keys(nestedItem);
      for (const nk of nestedCandidateKeys) {
        const nkLower = nk.toLowerCase();
        const matched = nestedKeys.find((rk) => rk.toLowerCase() === nkLower);
        if (matched && nestedItem[matched] !== undefined && nestedItem[matched] !== null && String(nestedItem[matched]).trim() !== '') {
          return String(nestedItem[matched]);
        }
      }
    }
  }

  return '';
}

/**
 * Validates a single field value against column rules for an entity.
 * @param {string} entityKey
 * @param {string} columnName
 * @param {any} value
 * @returns {{ valid: boolean, error?: string, normalizedValue?: any }}
 */
export function validateFieldValue(entityKey, columnName, value) {
  const col = getColumnByName(entityKey, columnName);
  if (!col) {
    return { valid: false, error: `Unknown column "${columnName}" for entity "${entityKey}".` };
  }

  if (col.readOnly) {
    return { valid: false, error: `Column "${col.name}" is read-only / system-generated and cannot be modified.` };
  }

  if (col.type === 'array') {
    if (Array.isArray(value)) {
      return { valid: true, normalizedValue: value };
    }
    if (typeof value === 'string' && value.trim()) {
      try {
        const parsed = JSON.parse(value);
        if (Array.isArray(parsed)) return { valid: true, normalizedValue: parsed };
      } catch {}
    }
    return { valid: true, normalizedValue: [] };
  }

  if (value === undefined || value === null || value === '') {
    return { valid: true, normalizedValue: '' };
  }

  const strVal = String(value).trim();
  let normalizedVal = strVal;

  // Category mapping: 'person' -> '1', 'organization' -> '2'
  if (col.name === 'Category' || (col.aliases && col.aliases.includes('category'))) {
    const lower = strVal.toLowerCase();
    if (lower === 'person' || lower === '1') {
      normalizedVal = '1';
    } else if (lower === 'organization' || lower === '2') {
      normalizedVal = '2';
    }
  }

  // Allowed values validation (e.g. Category = '1' or '2')
  if (Array.isArray(col.allowedValues)) {
    if (!col.allowedValues.includes(normalizedVal)) {
      return {
        valid: false,
        error: `${col.label} must be one of [${col.allowedValues.join(', ')}]. Received: "${value}"`
      };
    }
  }

  // Country code validation (2-letter ISO)
  if (col.name === 'Country' || (col.aliases && col.aliases.includes('countryCode'))) {
    if (!/^[A-Za-z]{2}$/.test(strVal)) {
      return {
        valid: false,
        error: `${col.label} must be a 2-letter ISO country code (e.g., US, IN, DE). Received: "${value}"`
      };
    }
    return { valid: true, normalizedValue: strVal.toUpperCase() };
  }

  // Postal code validation
  if (col.name === 'PostalCode' || (col.aliases && col.aliases.includes('zipCode'))) {
    if (!/^[A-Za-z0-9\s\-]{1,10}$/.test(strVal)) {
      return {
        valid: false,
        error: `${col.label} must be alphanumeric and up to 10 characters. Received: "${value}"`
      };
    }
  }

  // Length check
  if (col.maxLength && strVal.length > col.maxLength) {
    return {
      valid: false,
      error: `Field "${col.name}" exceeds maximum allowed length of ${col.maxLength} characters.`
    };
  }

  return { valid: true, normalizedValue: normalizedVal };
}

/**
 * Validates fields for creating a new record for the entity.
 * @param {string} entityKey
 * @param {object} fields
 * @returns {{ valid: boolean, errors: string[], normalizedFields: object }}
 */
export function validateCreateFields(entityKey, fields) {
  const schema = getEntitySchema(entityKey);
  if (!schema) {
    return { valid: false, errors: [`Unregistered entity: "${entityKey}"`], normalizedFields: {} };
  }

  const errors = [];
  const normalizedFields = {};

  if (!fields || typeof fields !== 'object') {
    return { valid: false, errors: ['Fields payload must be a valid object'], normalizedFields: {} };
  }

  // Check required fields
  const requiredCols = schema.columns.filter((col) => col.requiredForCreate);
  for (const col of requiredCols) {
    let rawVal = undefined;
    if (fields[col.name] !== undefined) {
      rawVal = fields[col.name];
    } else {
      // Find matching key via getColumnByName
      for (const [k, v] of Object.entries(fields)) {
        const matched = getColumnByName(entityKey, k);
        if (matched && matched.name === col.name) {
          rawVal = v;
          break;
        }
      }
    }

    if (
      rawVal === undefined ||
      rawVal === null ||
      (Array.isArray(rawVal) && rawVal.length === 0) ||
      (typeof rawVal === 'string' && String(rawVal).trim() === '')
    ) {
      errors.push(`Missing required field: "${col.name}" (${col.label})`);
    }
  }

  // Validate all provided fields
  for (const [key, val] of Object.entries(fields)) {
    const col = getColumnByName(entityKey, key);
    if (!col) {
      errors.push(`Unrecognized field "${key}" for entity "${schema.label}".`);
      continue;
    }
    if (col.readOnly) {
      errors.push(`Field "${col.name}" is system-generated / read-only and cannot be specified.`);
      continue;
    }

    const validation = validateFieldValue(entityKey, col.name, val);
    if (!validation.valid) {
      errors.push(validation.error);
    } else {
      normalizedFields[col.name] = validation.normalizedValue;
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    normalizedFields
  };
}

/**
 * Validates changes for updating an existing record for the entity.
 * @param {string} entityKey
 * @param {object} changes
 * @returns {{ valid: boolean, errors: string[], normalizedChanges: object }}
 */
export function validateUpdateChanges(entityKey, changes) {
  const schema = getEntitySchema(entityKey);
  if (!schema) {
    return { valid: false, errors: [`Unregistered entity: "${entityKey}"`], normalizedChanges: {} };
  }

  const errors = [];
  const normalizedChanges = {};

  if (!changes || typeof changes !== 'object' || Object.keys(changes).length === 0) {
    return { valid: false, errors: ['Changes payload must contain at least one field to update'], normalizedChanges: {} };
  }

  for (const [key, val] of Object.entries(changes)) {
    const col = getColumnByName(entityKey, key);
    if (!col) {
      errors.push(`Unrecognized column "${key}" for entity "${schema.label}".`);
      continue;
    }
    if (col.readOnly) {
      errors.push(`Column "${col.name}" is read-only and cannot be modified.`);
      continue;
    }

    const validation = validateFieldValue(entityKey, col.name, val);
    if (!validation.valid) {
      errors.push(validation.error);
    } else {
      normalizedChanges[col.name] = validation.normalizedValue;
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    normalizedChanges
  };
}

/**
 * Generates dynamic system prompt documentation covering ALL registered entities and their columns.
 * Enables the AI to identify data domains and select the appropriate entityKey.
 * @returns {string}
 */
export function getSystemPromptEntitiesDescription() {
  const sections = [];

  for (const schema of Object.values(ENTITY_REGISTRY)) {
    const colLines = schema.columns.map((col) => {
      const editStatus = col.readOnly ? '[READ-ONLY / ID]' : '[EDITABLE]';
      const reqStatus = col.requiredForCreate ? '(Required for create)' : '';
      return `    - ${col.name}: ${col.label} ${editStatus} ${reqStatus}`.trim();
    });

    sections.push(
      `• Entity: "${schema.entityKey}" (${schema.label})
  OData EntitySet: ${schema.odataEntitySet}
  Description: ${schema.description || schema.label}
  Primary Key: ${schema.idField}
  Columns:
${colLines.join('\n')}`
    );
  }

  return sections.join('\n\n');
}
