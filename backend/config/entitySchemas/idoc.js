/**
 * Schema definition for SAP IDoc entity (WE02/WE05 monitoring).
 * Defines columns, primary key, and metadata for IDoc monitoring.
 */

export const IDOC_COLUMNS = [
  {
    name: 'idocNumber',
    label: 'IDoc Number',
    type: 'string',
    odataField: 'IdocNumber',
    readOnly: true,
    editable: false,
    requiredForCreate: false,
    aliases: ['id', 'idoc_number', 'idocNo']
  },
  {
    name: 'idocType',
    label: 'IDoc Type',
    type: 'string',
    odataField: 'IdocType',
    readOnly: true,
    editable: false,
    requiredForCreate: false,
    aliases: ['type', 'idoc_type', 'messageType']
  },
  {
    name: 'direction',
    label: 'Direction',
    type: 'string',
    odataField: 'Direction',
    readOnly: true,
    editable: false,
    requiredForCreate: false,
    allowedValues: ['INBOUND', 'OUTBOUND'],
    aliases: ['dir']
  },
  {
    name: 'status',
    label: 'Status (51-Error=failed/errored, 53-Successful=succeeded/processed, 64-Waiting, 03-Sent)',
    type: 'string',
    odataField: 'Status',
    readOnly: true,
    editable: false,
    requiredForCreate: false,
    allowedValues: ['53-Successful', '51-Error', '64-Waiting', '03-Sent'],
    aliases: ['idocStatus', 'state']
  },
  {
    name: 'partner',
    label: 'Partner',
    type: 'string',
    odataField: 'Partner',
    readOnly: true,
    editable: false,
    requiredForCreate: false,
    aliases: ['partnerNumber', 'partnerId', 'vendor', 'customer']
  },
  {
    name: 'createdAt',
    label: 'Created At',
    type: 'string',
    odataField: 'CreatedAt',
    readOnly: true,
    editable: false,
    requiredForCreate: false,
    aliases: ['created', 'createdTime', 'timestamp']
  }
];

export const idocSchema = {
  entityKey: 'idoc',
  label: 'IDoc Monitoring',
  singularLabel: 'IDoc',
  description: "SAP IDoc messages with processing status, direction, partner, and error segments. For IDocs: 'failed', 'error', 'errored' mean status = '51-Error'. 'success', 'succeeded', 'processed' mean status = '53-Successful'. 'waiting', 'ready' mean '64-Waiting'. 'sent' means '03-Sent'. Always translate these synonyms to the exact stored value before building a filter.",
  odataEntitySet: 'A_IDoc',
  idField: 'idocNumber',
  nameField: 'idocType',
  mockDataFile: 'idocs.json',
  columns: IDOC_COLUMNS,
  editableColumns: [] // Reprocessing executes via propose_reprocess_idoc action
};

export default idocSchema;
