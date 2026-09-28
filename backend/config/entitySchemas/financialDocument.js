/**
 * Schema definition for SAP Financial Document entity (FI-GL).
 * Subject to Level 3 Sensitive Posting Scrutiny (FB01 / FB50).
 */

export const FI_COLUMNS = [
  {
    name: 'documentNumber',
    label: 'Document Number',
    type: 'string',
    odataField: 'AccountingDocument',
    readOnly: true,
    editable: false,
    requiredForCreate: false,
    aliases: ['id', 'docNumber', 'belnr']
  },
  {
    name: 'companyCode',
    label: 'Company Code',
    type: 'string',
    odataField: 'CompanyCode',
    readOnly: true,
    editable: false,
    requiredForCreate: true,
    aliases: ['bukrs', 'cocode']
  },
  {
    name: 'fiscalYear',
    label: 'Fiscal Year',
    type: 'string',
    odataField: 'FiscalYear',
    readOnly: true,
    editable: false,
    requiredForCreate: false,
    aliases: ['gjahr', 'year']
  },
  {
    name: 'docType',
    label: 'Document Type',
    type: 'string',
    odataField: 'AccountingDocumentType',
    readOnly: true,
    editable: false,
    requiredForCreate: true,
    aliases: ['blart', 'type']
  },
  {
    name: 'postingDate',
    label: 'Posting Date',
    type: 'string',
    odataField: 'PostingDate',
    readOnly: true,
    editable: false,
    requiredForCreate: true,
    aliases: ['budat', 'date']
  },
  {
    name: 'totalAmount',
    label: 'Total Amount',
    type: 'number',
    odataField: 'TotalAmountInTransactionCurrency',
    readOnly: true,
    editable: false,
    requiredForCreate: true,
    aliases: ['amount', 'wrbtr']
  },
  {
    name: 'currency',
    label: 'Currency',
    type: 'string',
    odataField: 'TransactionCurrency',
    readOnly: true,
    editable: false,
    requiredForCreate: true,
    aliases: ['waers', 'curr']
  },
  {
    name: 'headerText',
    label: 'Header Text',
    type: 'string',
    odataField: 'DocumentHeaderText',
    readOnly: true,
    editable: false,
    requiredForCreate: false,
    aliases: ['bktxt', 'text', 'narrative']
  },
  {
    name: 'status',
    label: 'Status',
    type: 'string',
    odataField: 'Status',
    readOnly: true,
    editable: false,
    requiredForCreate: false,
    allowedValues: ['POSTED', 'PARKED', 'REVERSED'],
    aliases: ['docStatus', 'state']
  }
];

export const financialDocumentSchema = {
  entityKey: 'financialDocument',
  label: 'Financial Documents',
  singularLabel: 'Financial Document',
  description: 'SAP General Ledger journal entries and accounting documents (FB01/FB50). Financial postings are Level 3 sensitive actions requiring explicit human confirmation and reason for change.',
  odataEntitySet: 'A_OperationalAcctgDocItem',
  idField: 'documentNumber',
  nameField: 'headerText',
  mockDataFile: 'financialDocuments.json',
  columns: FI_COLUMNS,
  editableColumns: [] // Postings execute via propose_post_financial_document action
};

export default financialDocumentSchema;
