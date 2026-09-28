/**
 * Schema definition for SAP Business Partner entity.
 * Defines columns, validation rules, primary key, and OData mappings.
 */

export const BP_COLUMNS = [
  {
    name: 'BusinessPartner',
    label: 'Business Partner ID',
    type: 'string',
    odataField: 'BusinessPartner',
    readOnly: true,
    editable: false,
    requiredForCreate: false,
    aliases: ['id', 'fromId', 'toId', 'partnerId']
  },
  {
    name: 'BusinessPartnerName',
    label: 'Name',
    type: 'string',
    odataField: 'BusinessPartnerName',
    readOnly: false,
    editable: true,
    requiredForCreate: true,
    maxLength: 80,
    aliases: ['name', 'partnerName', 'companyName']
  },
  {
    name: 'Category',
    label: 'Category (1=Person, 2=Organization)',
    type: 'string',
    odataField: 'BusinessPartnerCategory',
    readOnly: false,
    editable: true,
    requiredForCreate: true,
    allowedValues: ['1', '2'],
    aliases: ['BusinessPartnerCategory', 'category']
  },
  {
    name: 'City',
    label: 'City',
    type: 'string',
    odataField: 'City',
    addressField: 'CityName',
    readOnly: false,
    editable: true,
    requiredForCreate: true,
    maxLength: 40,
    aliases: ['city', 'cityName']
  },
  {
    name: 'Country',
    label: 'Country',
    type: 'string',
    odataField: 'Country',
    addressField: 'Country',
    readOnly: false,
    editable: true,
    requiredForCreate: true,
    maxLength: 2,
    aliases: ['country', 'countryCode']
  },
  {
    name: 'PostalCode',
    label: 'Postal Code',
    type: 'string',
    odataField: 'PostalCode',
    addressField: 'PostalCode',
    readOnly: false,
    editable: true,
    requiredForCreate: false,
    maxLength: 10,
    aliases: ['postalCode', 'zipCode', 'pinCode']
  },
  {
    name: 'StreetAddress',
    label: 'Street Address',
    type: 'string',
    odataField: 'StreetName',
    addressField: 'StreetName',
    readOnly: false,
    editable: true,
    requiredForCreate: false,
    maxLength: 60,
    aliases: ['StreetName', 'street', 'streetAddress', 'address']
  }
];

export const businessPartnerSchema = {
  entityKey: 'businessPartner',
  label: 'Business Partner Records',
  singularLabel: 'Business Partner',
  description: 'SAP Business Partners including customers, suppliers, persons, and organizations with associated addresses.',
  odataEntitySet: 'A_BusinessPartner',
  idField: 'BusinessPartner',
  nameField: 'BusinessPartnerName',
  defaultExpand: 'to_BusinessPartnerAddress',
  mockDataFile: 'businessPartners.json',
  columns: BP_COLUMNS,
  editableColumns: BP_COLUMNS.filter((c) => c.editable).map((c) => c.name)
};

export default businessPartnerSchema;
