/**
 * Schema definition for SAP Error Knowledge Base entity.
 * Supports viewing and managing operational error categories, recommended actions,
 * risk levels, and learning statistics (occurrenceCount, successfulResolutionCount).
 */

export const KB_COLUMNS = [
  {
    name: 'id',
    label: 'Rule ID',
    type: 'string',
    odataField: 'RuleId',
    readOnly: true,
    editable: false,
    requiredForCreate: false,
    aliases: ['ruleId', 'kbId']
  },
  {
    name: 'category',
    label: 'Error Category',
    type: 'string',
    odataField: 'Category',
    readOnly: false,
    editable: true,
    requiredForCreate: true,
    aliases: ['name', 'errorCategory']
  },
  {
    name: 'recommendedAction',
    label: 'Recommended Action',
    type: 'string',
    odataField: 'RecommendedAction',
    readOnly: false,
    editable: true,
    requiredForCreate: true,
    allowedValues: ['RETRY', 'ESCALATE'],
    aliases: ['action']
  },
  {
    name: 'riskLevel',
    label: 'Risk Level',
    type: 'number',
    odataField: 'RiskLevel',
    readOnly: false,
    editable: true,
    requiredForCreate: true,
    allowedValues: [1, 2, 3, 4],
    aliases: ['tier', 'level']
  },
  {
    name: 'occurrenceCount',
    label: 'Occurrences',
    type: 'number',
    odataField: 'OccurrenceCount',
    readOnly: true,
    editable: false,
    requiredForCreate: false,
    aliases: ['occurrences', 'frequency', 'count']
  },
  {
    name: 'successfulResolutionCount',
    label: 'Resolved Count',
    type: 'number',
    odataField: 'SuccessfulResolutionCount',
    readOnly: true,
    editable: false,
    requiredForCreate: false,
    aliases: ['resolvedCount', 'successCount']
  },
  {
    name: 'lastSeen',
    label: 'Last Seen',
    type: 'string',
    odataField: 'LastSeen',
    readOnly: true,
    editable: false,
    requiredForCreate: false,
    aliases: ['lastSeenAt', 'timestamp']
  },
  {
    name: 'description',
    label: 'Description & Runbook Guidance',
    type: 'string',
    odataField: 'Description',
    readOnly: false,
    editable: true,
    requiredForCreate: true,
    aliases: ['runbook', 'details']
  },
  {
    name: 'patternStr',
    label: 'Regex Pattern',
    type: 'string',
    odataField: 'PatternStr',
    readOnly: false,
    editable: true,
    requiredForCreate: true,
    aliases: ['regex', 'pattern']
  }
];

export const knowledgeBaseSchema = {
  entityKey: 'knowledgeBase',
  label: 'Knowledge Base',
  singularLabel: 'Knowledge Base Entry',
  description: 'SAP Error Knowledge Base and runbook catalogue. Tracks operational error frequencies, resolution success rates, and recommended remediation actions.',
  odataEntitySet: 'A_ErrorKnowledgeBase',
  idField: 'id',
  nameField: 'category',
  mockDataFile: 'errorKnowledgeBase.json',
  columns: KB_COLUMNS,
  editableColumns: ['category', 'recommendedAction', 'riskLevel', 'description', 'patternStr']
};

export default knowledgeBaseSchema;
