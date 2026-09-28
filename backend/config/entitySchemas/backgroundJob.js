/**
 * Schema definition for SAP Background Job entity (SM37-style monitoring).
 * Defines columns, primary key, and metadata for job monitoring.
 */

export const JOB_COLUMNS = [
  {
    name: 'jobId',
    label: 'Job ID',
    type: 'string',
    odataField: 'JobId',
    readOnly: true,
    editable: false,
    requiredForCreate: false,
    aliases: ['id', 'job_id', 'jobID']
  },
  {
    name: 'jobName',
    label: 'Job Name',
    type: 'string',
    odataField: 'JobName',
    readOnly: true,
    editable: false,
    requiredForCreate: false,
    aliases: ['name', 'job_name']
  },
  {
    name: 'status',
    label: 'Status (CANCELLED=failed/unsuccessful/errored, FINISHED=succeeded/completed, RUNNING=in progress/active, SCHEDULED)',
    type: 'string',
    odataField: 'Status',
    readOnly: true,
    editable: false,
    requiredForCreate: false,
    allowedValues: ['SCHEDULED', 'RUNNING', 'FINISHED', 'CANCELLED'],
    aliases: ['jobStatus', 'state']
  },
  {
    name: 'startTime',
    label: 'Start Time',
    type: 'string',
    odataField: 'StartTime',
    readOnly: true,
    editable: false,
    requiredForCreate: false,
    aliases: ['start', 'startedAt']
  },
  {
    name: 'endTime',
    label: 'End Time',
    type: 'string',
    odataField: 'EndTime',
    readOnly: true,
    editable: false,
    requiredForCreate: false,
    aliases: ['end', 'endedAt']
  },
  {
    name: 'executedBy',
    label: 'Executed By',
    type: 'string',
    odataField: 'ExecutedBy',
    readOnly: true,
    editable: false,
    requiredForCreate: false,
    aliases: ['user', 'author', 'scheduledBy']
  },
  {
    name: 'retryCount',
    label: 'Retry Count',
    type: 'number',
    odataField: 'RetryCount',
    readOnly: true,
    editable: false,
    requiredForCreate: false,
    aliases: ['retries', 'retry_count']
  },
  {
    name: 'previousRunStatus',
    label: 'Previous Run Status (CANCELLED=failed/unsuccessful/errored, FINISHED=succeeded/completed, RUNNING, SCHEDULED)',
    type: 'string',
    odataField: 'PreviousRunStatus',
    readOnly: true,
    editable: false,
    requiredForCreate: false,
    allowedValues: ['SCHEDULED', 'RUNNING', 'FINISHED', 'CANCELLED'],
    aliases: ['prevStatus', 'previousRun', 'previousStatus']
  }
];

export const backgroundJobSchema = {
  entityKey: 'backgroundJob',
  label: 'Job Monitoring',
  singularLabel: 'Background Job',
  description: "SAP SM37 Background Jobs with execution status, timestamps, and error logs. For Job Monitoring: 'failed', 'unsuccessful', 'errored' all mean status/previousRunStatus = 'CANCELLED'. 'succeeded', 'successful', 'completed' mean 'FINISHED'. 'in progress', 'active' mean 'RUNNING'. Always translate these synonyms to the exact stored value before building a filter.",
  odataEntitySet: 'A_BackgroundJob',
  idField: 'jobId',
  nameField: 'jobName',
  mockDataFile: 'backgroundJobs.json',
  columns: JOB_COLUMNS,
  editableColumns: [] // Read-focused; no direct field edits. Retries execute via propose_retry_job action
};

export default backgroundJobSchema;
