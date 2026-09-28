/**
 * Schema definition for SAP Bill of Materials (BOM) entity (PP-BD-BOM).
 * Supports CS01 automated creation via SAP GUI Scripting.
 */

export const BOM_COLUMNS = [
  {
    name: 'material',
    label: 'Material Number',
    type: 'string',
    readOnly: false,
    editable: false,
    requiredForCreate: true,
    aliases: ['matnr', 'materialNumber', 'materialId', 'partNumber']
  },
  {
    name: 'plant',
    label: 'Plant Code',
    type: 'string',
    readOnly: false,
    editable: false,
    requiredForCreate: true,
    aliases: ['werks', 'plantCode', 'facility']
  },
  {
    name: 'bomUsage',
    label: 'BOM Usage',
    type: 'string',
    readOnly: false,
    editable: false,
    requiredForCreate: true,
    aliases: ['usage', 'stlan', 'bom_usage']
  },
  {
    name: 'alternativeBom',
    label: 'Alternative BOM',
    type: 'string',
    readOnly: false,
    editable: false,
    requiredForCreate: false,
    aliases: ['altBom', 'stlal', 'alternative']
  },
  {
    name: 'validFrom',
    label: 'Valid From Date',
    type: 'string',
    readOnly: false,
    editable: false,
    requiredForCreate: false,
    aliases: ['datuv', 'startDate', 'validDate']
  },
  {
    name: 'description',
    label: 'Description / Base Text',
    type: 'string',
    readOnly: false,
    editable: false,
    requiredForCreate: false,
    aliases: ['text', 'bomText']
  },
  {
    name: 'components',
    label: 'BOM Components',
    type: 'array',
    readOnly: false,
    editable: false,
    requiredForCreate: true,
    aliases: ['items', 'bomItems', 'lineItems']
  }
];

export const bomSchema = {
  entityKey: 'bom',
  label: 'Bills of Materials',
  singularLabel: 'Bill of Materials',
  description: 'SAP Production & Engineering Bills of Materials (CS01). Automated directly via SAP GUI Scripting.',
  guiScriptBased: true,
  tcode: 'CS01',
  idField: 'material',
  nameField: 'description',
  mockDataFile: 'boms.json',
  columns: BOM_COLUMNS,
  editableColumns: []
};

export default bomSchema;
