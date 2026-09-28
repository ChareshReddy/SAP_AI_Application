/**
 * Schema definition for SAP Application Log entity (SLG1 monitoring).
 * Defines columns, primary key, and metadata for log inspection.
 */

export const APPLICATION_LOG_COLUMNS = [
  {
    name: 'logId',
    label: 'Log ID',
    type: 'string',
    odataField: 'LogId',
    readOnly: true,
    editable: false,
    requiredForCreate: false,
    aliases: ['id', 'log_id']
  },
  {
    name: 'object',
    label: 'Object',
    type: 'string',
    odataField: 'Object',
    readOnly: true,
    editable: false,
    requiredForCreate: false,
    aliases: ['logObject', 'area']
  },
  {
    name: 'subObject',
    label: 'Sub-Object',
    type: 'string',
    odataField: 'SubObject',
    readOnly: true,
    editable: false,
    requiredForCreate: false,
    aliases: ['sub_object', 'subarea']
  },
  {
    name: 'severity',
    label: 'Severity (ERROR, WARNING, INFO)',
    type: 'string',
    odataField: 'Severity',
    readOnly: true,
    editable: false,
    requiredForCreate: false,
    allowedValues: ['ERROR', 'WARNING', 'INFO'],
    aliases: ['level', 'type']
  },
  {
    name: 'message',
    label: 'Message',
    type: 'string',
    odataField: 'Message',
    readOnly: true,
    editable: false,
    requiredForCreate: false,
    aliases: ['text', 'msg', 'logMessage']
  },
  {
    name: 'timestamp',
    label: 'Timestamp',
    type: 'string',
    odataField: 'Timestamp',
    readOnly: true,
    editable: false,
    requiredForCreate: false,
    aliases: ['time', 'date', 'created']
  },
  {
    name: 'transactionCode',
    label: 'Transaction Code',
    type: 'string',
    odataField: 'TransactionCode',
    readOnly: true,
    editable: false,
    requiredForCreate: false,
    aliases: ['tcode', 'transaction', 'tCode']
  },
  {
    name: 'user',
    label: 'User',
    type: 'string',
    odataField: 'User',
    readOnly: true,
    editable: false,
    requiredForCreate: false,
    aliases: ['userName', 'author', 'executedBy']
  }
];

export const applicationLogSchema = {
  entityKey: 'applicationLog',
  label: 'Application Logs',
  singularLabel: 'Application Log',
  description: "SAP SLG1 Application Logs recording system warnings, errors, and business transaction logs across modules (SD, FI, MM, BC). Filterable by severity (ERROR, WARNING, INFO), object, transactionCode, and user.",
  odataEntitySet: 'A_ApplicationLog',
  idField: 'logId',
  nameField: 'object',
  mockDataFile: 'applicationLogs.json',
  columns: APPLICATION_LOG_COLUMNS,
  editableColumns: [] // Read-only log inspection
};

export default applicationLogSchema;
