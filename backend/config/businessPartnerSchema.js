/**
 * Backward compatibility bridge for businessPartnerSchema.js
 * Forwards to backend/config/entitySchemas/index.js and businessPartner.js
 */

import { BP_COLUMNS, businessPartnerSchema } from './entitySchemas/businessPartner.js';
import {
  ENTITY_REGISTRY,
  ALLOWED_OPERATORS,
  getColumnByName as getGenericColumnByName,
  isValidColumn as isGenericValidColumn,
  isEditableColumn as isGenericIsEditableColumn,
  isValidOperator,
  getODataFieldName as getGenericODataFieldName,
  validateFieldValue as validateGenericFieldValue,
  validateCreateFields as validateGenericCreateFields,
  validateUpdateChanges as validateGenericUpdateChanges,
  getRecordColumnValue as getGenericRecordColumnValue
} from './entitySchemas/index.js';

export { BP_COLUMNS, ALLOWED_OPERATORS, businessPartnerSchema };

export function getRecordColumnValue(record, columnName) {
  return getGenericRecordColumnValue('businessPartner', record, columnName);
}

export function getColumnByName(columnName) {
  return getGenericColumnByName('businessPartner', columnName);
}

export function isValidColumn(columnName) {
  return isGenericValidColumn('businessPartner', columnName);
}

export function isEditableColumn(columnName) {
  return isGenericIsEditableColumn('businessPartner', columnName);
}

export { isValidOperator };

export function getODataFieldName(columnName) {
  return getGenericODataFieldName('businessPartner', columnName);
}

export function validateFieldValue(columnName, value) {
  return validateGenericFieldValue('businessPartner', columnName, value);
}

export function validateCreateFields(fields) {
  return validateGenericCreateFields('businessPartner', fields);
}

export function validateUpdateChanges(changes) {
  return validateGenericUpdateChanges('businessPartner', changes);
}

export function getSystemPromptColumnDescription() {
  return BP_COLUMNS.map((col) => {
    const editStatus = col.readOnly ? '[READ-ONLY / System Generated]' : '[EDITABLE]';
    const reqStatus = col.requiredForCreate ? '(Required for create)' : '';
    return `- ${col.name}: ${col.label} ${editStatus} ${reqStatus}`.trim();
  }).join('\n');
}

export default businessPartnerSchema;
