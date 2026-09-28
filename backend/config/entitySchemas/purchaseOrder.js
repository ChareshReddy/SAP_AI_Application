/**
 * Schema definition for SAP Purchase Order entity (MM-PUR).
 * Supports Level 3 Sensitive Release Workflows (ME28 / ME29N).
 */

export const PO_COLUMNS = [
  {
    name: 'poNumber',
    label: 'PO Number',
    type: 'string',
    odataField: 'PurchaseOrder',
    readOnly: true,
    editable: false,
    requiredForCreate: false,
    aliases: ['id', 'po_number', 'ponumber', 'orderNumber']
  },
  {
    name: 'vendor',
    label: 'Vendor ID',
    type: 'string',
    odataField: 'Supplier',
    readOnly: true,
    editable: false,
    requiredForCreate: true,
    aliases: ['supplier', 'vendorId']
  },
  {
    name: 'vendorName',
    label: 'Vendor Name',
    type: 'string',
    odataField: 'SupplierName',
    readOnly: true,
    editable: false,
    requiredForCreate: false,
    aliases: ['supplierName', 'name']
  },
  {
    name: 'totalAmount',
    label: 'Total Net Amount',
    type: 'number',
    odataField: 'TotalNetAmount',
    readOnly: true,
    editable: false,
    requiredForCreate: true,
    aliases: ['amount', 'netAmount', 'price']
  },
  {
    name: 'currency',
    label: 'Currency',
    type: 'string',
    odataField: 'DocumentCurrency',
    readOnly: true,
    editable: false,
    requiredForCreate: true,
    aliases: ['curr', 'documentCurrency']
  },
  {
    name: 'status',
    label: 'Status',
    type: 'string',
    odataField: 'Status',
    readOnly: true,
    editable: false,
    requiredForCreate: false,
    allowedValues: ['AWAITING_RELEASE', 'RELEASED', 'REJECTED'],
    aliases: ['poStatus', 'state']
  },
  {
    name: 'releaseStatus',
    label: 'Release Status',
    type: 'string',
    odataField: 'ReleaseStatus',
    readOnly: true,
    editable: false,
    requiredForCreate: false,
    allowedValues: ['BLOCKED', 'APPROVED', 'REJECTED'],
    aliases: ['approvalStatus', 'releaseState']
  },
  {
    name: 'releaseCode',
    label: 'Release Code',
    type: 'string',
    odataField: 'ReleaseCode',
    readOnly: true,
    editable: false,
    requiredForCreate: false,
    aliases: ['code', 'approvalCode']
  }
];

export const purchaseOrderSchema = {
  entityKey: 'purchaseOrder',
  label: 'Purchase Orders',
  singularLabel: 'Purchase Order',
  description: 'SAP MM Purchase Orders subject to Level 3 sensitive approval workflows (ME28/ME29N). Releasing requires mandatory human confirmation and business justification.',
  odataEntitySet: 'A_PurchaseOrder',
  idField: 'poNumber',
  nameField: 'vendorName',
  mockDataFile: 'purchaseOrders.json',
  columns: PO_COLUMNS,
  editableColumns: [] // Modifying/releasing executes via propose_release_purchase_order action
};

export default purchaseOrderSchema;
