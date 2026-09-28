import { getEntitySchema } from '../config/entitySchemas/index.js';

/**
 * Compares an entity's schema definition against a real or mock record returned by SAP Gateway.
 * Identifies:
 * - Matched fields (present in both schema and SAP response)
 * - Missing in SAP (defined in schema but not present in SAP response)
 * - Extra in SAP (present in SAP response but not mapped in schema)
 *
 * @param {string} entityKey Target entity key (e.g. 'businessPartner', 'backgroundJob')
 * @param {object} sapRecord Raw object returned by SAP Gateway or mock layer
 * @returns {object} Diagnostic comparison summary
 */
export function compareEntitySchemaWithSapRecord(entityKey, sapRecord) {
  const schema = getEntitySchema(entityKey);
  if (!schema) {
    throw new Error(`Unregistered entity key: "${entityKey}"`);
  }

  if (!sapRecord || typeof sapRecord !== 'object') {
    return {
      entityKey,
      odataEntitySet: schema.odataEntitySet,
      isMatch: false,
      error: 'No sample record provided or record is empty',
      sampleRecordId: null,
      matchedFields: [],
      missingInSap: schema.columns.map((c) => ({
        schemaColumn: c.name,
        expectedOdataField: c.odataField || c.name,
        label: c.label
      })),
      extraInSap: [],
      totalSchemaColumns: schema.columns.length,
      totalMatched: 0
    };
  }

  // Flatten top-level keys and nested navigation keys (e.g., to_BusinessPartnerAddress)
  const rootKeys = new Set(Object.keys(sapRecord));
  const nestedKeys = new Map(); // navigationProperty -> Set of keys

  for (const [key, val] of Object.entries(sapRecord)) {
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      if (Array.isArray(val.results) && val.results.length > 0 && typeof val.results[0] === 'object') {
        nestedKeys.set(key, new Set(Object.keys(val.results[0])));
      } else if (val.results === undefined) {
        nestedKeys.set(key, new Set(Object.keys(val)));
      }
    }
  }

  const matchedFields = [];
  const missingInSap = [];
  const matchedSapKeys = new Set();

  for (const col of schema.columns) {
    let found = false;
    let matchedKeyName = null;
    let location = 'root';

    // 1. Check direct odataField or name on root
    const candidates = [col.odataField, col.name, ...(col.aliases || [])].filter(Boolean);

    for (const cand of candidates) {
      if (rootKeys.has(cand)) {
        found = true;
        matchedKeyName = cand;
        location = 'root';
        matchedSapKeys.add(cand);
        break;
      }
    }

    // 2. Check addressField in expanded navigation properties
    if (!found && col.addressField && schema.defaultExpand) {
      const navKeys = nestedKeys.get(schema.defaultExpand);
      if (navKeys && navKeys.has(col.addressField)) {
        found = true;
        matchedKeyName = `${schema.defaultExpand}.${col.addressField}`;
        location = schema.defaultExpand;
        matchedSapKeys.add(col.addressField);
      }
    }

    if (found) {
      matchedFields.push({
        schemaColumn: col.name,
        expectedOdataField: col.odataField || col.name,
        matchedOn: matchedKeyName,
        location,
        type: col.type,
        readOnly: col.readOnly
      });
    } else {
      missingInSap.push({
        schemaColumn: col.name,
        expectedOdataField: col.odataField || col.name,
        label: col.label,
        type: col.type
      });
    }
  }

  // Find extra fields in SAP response not accounted for in schema
  const ignoredKeys = new Set(['__metadata', '__count', '__next', '__deferred']);
  const extraInSap = [];

  for (const key of rootKeys) {
    if (ignoredKeys.has(key)) continue;
    if (nestedKeys.has(key)) continue; // Navigation property accounted for
    if (!matchedSapKeys.has(key)) {
      // Double check if any column aliases or fields mapped to it
      const isMapped = schema.columns.some(
        (c) => c.name === key || c.odataField === key || c.aliases?.includes(key)
      );
      if (!isMapped) {
        const val = sapRecord[key];
        extraInSap.push({
          fieldName: key,
          sampleValue: typeof val === 'object' ? JSON.stringify(val) : String(val ?? ''),
          detectedType: typeof val
        });
      }
    }
  }

  // Check nested extra fields
  for (const [navProp, navKeySet] of nestedKeys.entries()) {
    for (const key of navKeySet) {
      if (ignoredKeys.has(key)) continue;
      const isMapped = schema.columns.some(
        (c) => c.addressField === key || c.name === key || c.odataField === key || c.aliases?.includes(key)
      );
      if (!isMapped) {
        extraInSap.push({
          fieldName: `${navProp}.${key}`,
          sampleValue: '',
          detectedType: 'nested string'
        });
      }
    }
  }

  const sampleRecordId = sapRecord[schema.idField] || sapRecord[schema.columns.find((c) => c.name === schema.idField)?.odataField] || 'unknown';

  return {
    entityKey,
    odataEntitySet: schema.odataEntitySet,
    sampleRecordId: String(sampleRecordId),
    isMatch: missingInSap.length === 0,
    matchedFields,
    missingInSap,
    extraInSap,
    totalSchemaColumns: schema.columns.length,
    totalMatched: matchedFields.length
  };
}
