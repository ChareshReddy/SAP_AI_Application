/**
 * Schema definition for SAP Interface Monitoring entity (CPI/AIF/SFTP flows).
 * Defines columns, primary key, and metadata for interface monitoring.
 */

export const INTERFACE_COLUMNS = [
  {
    name: 'interfaceId',
    label: 'Interface ID',
    type: 'string',
    odataField: 'InterfaceId',
    readOnly: true,
    editable: false,
    requiredForCreate: false,
    aliases: ['id', 'interface_id']
  },
  {
    name: 'interfaceName',
    label: 'Interface Name',
    type: 'string',
    odataField: 'InterfaceName',
    readOnly: true,
    editable: false,
    requiredForCreate: false,
    aliases: ['name', 'interface_name']
  },
  {
    name: 'sourceSystem',
    label: 'Source System',
    type: 'string',
    odataField: 'SourceSystem',
    readOnly: true,
    editable: false,
    requiredForCreate: false,
    aliases: ['source', 'from']
  },
  {
    name: 'targetSystem',
    label: 'Target System',
    type: 'string',
    odataField: 'TargetSystem',
    readOnly: true,
    editable: false,
    requiredForCreate: false,
    aliases: ['target', 'to']
  },
  {
    name: 'status',
    label: 'Status (SUCCESS=succeeded/healthy, FAILED=failed/error/errored, PENDING=running/waiting)',
    type: 'string',
    odataField: 'Status',
    readOnly: true,
    editable: false,
    requiredForCreate: false,
    allowedValues: ['SUCCESS', 'FAILED', 'PENDING'],
    aliases: ['state', 'interfaceStatus']
  },
  {
    name: 'lastRunTime',
    label: 'Last Run Time',
    type: 'string',
    odataField: 'LastRunTime',
    readOnly: true,
    editable: false,
    requiredForCreate: false,
    aliases: ['lastRun', 'timestamp', 'time']
  },
  {
    name: 'messageCount',
    label: 'Message Count',
    type: 'number',
    odataField: 'MessageCount',
    readOnly: true,
    editable: false,
    requiredForCreate: false,
    aliases: ['count', 'messages', 'volume']
  },
  {
    name: 'failureReason',
    label: 'Failure Reason',
    type: 'string',
    odataField: 'FailureReason',
    readOnly: true,
    editable: false,
    requiredForCreate: false,
    aliases: ['reason', 'error', 'errorMessage']
  }
];

export const interfaceMonitorSchema = {
  entityKey: 'interfaceMonitor',
  label: 'Interface Monitoring',
  singularLabel: 'Interface',
  description: "SAP integration middleware flows (CPI, AIF, SFTP, REST, OData). For Interface Monitoring: 'failed', 'error', 'errored' mean status = 'FAILED'. 'success', 'succeeded', 'healthy' mean status = 'SUCCESS'. 'pending', 'running' mean status = 'PENDING'. Always translate these synonyms to the exact stored value before building a filter.",
  odataEntitySet: 'A_InterfaceMonitor',
  idField: 'interfaceId',
  nameField: 'interfaceName',
  mockDataFile: 'interfaces.json',
  columns: INTERFACE_COLUMNS,
  editableColumns: [] // Retrigger executes via propose_retrigger_interface action
};

export default interfaceMonitorSchema;
