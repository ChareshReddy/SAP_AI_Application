import React from 'react';
import EntityTable from './EntityTable';

/**
 * BusinessPartnerTable is a backward-compatible wrapper around generic EntityTable.
 */
export default function BusinessPartnerTable(props) {
  return <EntityTable {...props} />;
}
