import React from 'react';
import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Building2,
  UserCircle,
  Database,
  FileSpreadsheet,
  Activity,
  FileText,
  ListOrdered,
  Network
} from 'lucide-react';

const DEFAULT_BP_COLUMNS = [
  { name: 'BusinessPartner', label: 'BP ID', readOnly: true },
  { name: 'BusinessPartnerName', label: 'Partner Name' },
  { name: 'Category', label: 'Category', odataField: 'BusinessPartnerCategory' },
  { name: 'City', label: 'City', addressField: 'CityName' },
  { name: 'Country', label: 'Country', addressField: 'Country' },
  { name: 'StreetAddress', label: 'Address & Postal Code', addressField: 'StreetName' }
];

const DEFAULT_JOB_COLUMNS = [
  { name: 'jobId', label: 'Job ID', readOnly: true },
  { name: 'jobName', label: 'Job Name' },
  { name: 'status', label: 'Status' },
  { name: 'startTime', label: 'Start Time' },
  { name: 'endTime', label: 'End Time' },
  { name: 'executedBy', label: 'Executed By' },
  { name: 'retryCount', label: 'Retries' },
  { name: 'previousRunStatus', label: 'Previous Run' }
];

const DEFAULT_IDOC_COLUMNS = [
  { name: 'idocNumber', label: 'IDoc Number', readOnly: true },
  { name: 'idocType', label: 'IDoc Type' },
  { name: 'direction', label: 'Direction' },
  { name: 'status', label: 'Status' },
  { name: 'partner', label: 'Partner' },
  { name: 'createdAt', label: 'Created At' }
];

const DEFAULT_APP_LOG_COLUMNS = [
  { name: 'logId', label: 'Log ID', readOnly: true },
  { name: 'object', label: 'Object' },
  { name: 'subObject', label: 'Sub-Object' },
  { name: 'severity', label: 'Severity' },
  { name: 'message', label: 'Message' },
  { name: 'transactionCode', label: 'T-Code' },
  { name: 'user', label: 'User' },
  { name: 'timestamp', label: 'Timestamp' }
];

const DEFAULT_INTERFACE_COLUMNS = [
  { name: 'interfaceId', label: 'Interface ID', readOnly: true },
  { name: 'interfaceName', label: 'Interface Name' },
  { name: 'sourceSystem', label: 'Source' },
  { name: 'targetSystem', label: 'Target' },
  { name: 'status', label: 'Status' },
  { name: 'lastRunTime', label: 'Last Run' },
  { name: 'messageCount', label: 'Messages' },
  { name: 'failureReason', label: 'Failure Reason' }
];

const DEFAULT_BOM_COLUMNS = [
  { name: 'material', label: 'Material', readOnly: true },
  { name: 'plant', label: 'Plant' },
  { name: 'bomUsage', label: 'BOM Usage' },
  { name: 'alternativeBom', label: 'Alternative', aliases: ['targetAlternative', 'alternative', 'altBom'] },
  { name: 'validFrom', label: 'Valid From' },
  { name: 'description', label: 'Description' }
];

export default function EntityTable({
  schema = null,
  data = [],
  totalCount,
  pageSize: controlledPageSize = 50,
  currentPage: controlledPage = 1,
  isLoading = false,
  title = null,
  onPageChange,
  onPageSizeChange
}) {
  const isControlled = typeof onPageChange === 'function';
  const [internalPage, setInternalPage] = React.useState(1);
  const [internalPageSize, setInternalPageSize] = React.useState(10);

  const currentPage = isControlled ? controlledPage : internalPage;
  const pageSize = isControlled ? controlledPageSize : internalPageSize;
  const effectiveTotal = (totalCount !== undefined && totalCount !== null) ? totalCount : data.length;

  const totalPages = Math.max(1, Math.ceil(effectiveTotal / pageSize));
  const startRecord = effectiveTotal === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const endRecord = Math.min(currentPage * pageSize, effectiveTotal);

  const handlePageChange = (p) => {
    if (isControlled) {
      onPageChange(p);
    } else {
      setInternalPage(p);
    }
  };

  const handlePageSizeChange = (s) => {
    if (isControlled && onPageSizeChange) {
      onPageSizeChange(s);
    } else {
      setInternalPageSize(s);
      setInternalPage(1);
    }
  };

  const displayData = isControlled ? data : data.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  // Active columns to render
  const isJobData = schema?.entityKey === 'backgroundJob' || (data.length > 0 && Boolean(data[0]?.jobId));
  const isIdocData = schema?.entityKey === 'idoc' || (data.length > 0 && Boolean(data[0]?.idocNumber));
  const isLogData = schema?.entityKey === 'applicationLog' || (data.length > 0 && Boolean(data[0]?.logId));
  const isInterfaceData = schema?.entityKey === 'interfaceMonitor' || (data.length > 0 && Boolean(data[0]?.interfaceId));
  const isBomData = schema?.entityKey === 'bom' || (data.length > 0 && Boolean(data[0]?.material && (data[0]?.bomUsage !== undefined || data[0]?.components !== undefined)));

  let defaultCols = DEFAULT_BP_COLUMNS;
  if (isJobData) defaultCols = DEFAULT_JOB_COLUMNS;
  else if (isIdocData) defaultCols = DEFAULT_IDOC_COLUMNS;
  else if (isLogData) defaultCols = DEFAULT_APP_LOG_COLUMNS;
  else if (isInterfaceData) defaultCols = DEFAULT_INTERFACE_COLUMNS;
  else if (isBomData) defaultCols = DEFAULT_BOM_COLUMNS;

  const columns = schema?.columns || defaultCols;
  const idField = schema?.idField || (isJobData ? 'jobId' : isIdocData ? 'idocNumber' : isLogData ? 'logId' : isInterfaceData ? 'interfaceId' : isBomData ? 'material' : 'BusinessPartner');
  const nameField = schema?.nameField || (isJobData ? 'jobName' : isIdocData ? 'idocType' : isLogData ? 'object' : isInterfaceData ? 'interfaceName' : isBomData ? 'description' : 'BusinessPartnerName');
  const entityLabel = schema?.label || (isJobData ? 'Background Jobs' : isIdocData ? 'IDoc Monitoring' : isLogData ? 'Application Logs' : isInterfaceData ? 'Interface Monitoring' : isBomData ? 'Bills of Materials' : 'Business Partner Records');
  const odataEntitySet = schema?.odataEntitySet || (isJobData ? 'SM37_Jobs' : isIdocData ? 'A_IDoc' : isLogData ? 'A_ApplicationLog' : isInterfaceData ? 'A_InterfaceMonitor' : isBomData ? 'CS01_BOM' : 'A_BusinessPartner');

  /**
   * Extracts value for a specific column from a record.
   * Handles root properties, odataField mappings, and nested address expansions.
   */
  const getCellValue = (item, col) => {
    if (!item) return '—';

    // Special composite for StreetAddress + PostalCode if applicable
    if (col.name === 'StreetAddress' || col.name === 'Address') {
      const nested = item.to_BusinessPartnerAddress?.results?.[0];
      const street = item.StreetName || item.StreetAddress || nested?.StreetName || '';
      const postal = item.PostalCode || nested?.PostalCode || '';
      if (street && postal) return `${street}, ${postal}`;
      if (street) return street;
      if (postal) return postal;
      return '—';
    }

    let val = undefined;

    // 1. Direct match on col.name
    if (item[col.name] !== undefined && item[col.name] !== null) {
      val = item[col.name];
    }
    // 2. Match on col.odataField
    else if (col.odataField && item[col.odataField] !== undefined && item[col.odataField] !== null) {
      val = item[col.odataField];
    }
    // 3. Match on nested address if defined
    else if (col.addressField && item.to_BusinessPartnerAddress?.results?.[0]) {
      val = item.to_BusinessPartnerAddress.results[0][col.addressField];
    }
    // 4. Aliases
    else if (Array.isArray(col.aliases)) {
      for (const alias of col.aliases) {
        if (item[alias] !== undefined && item[alias] !== null) {
          val = item[alias];
          break;
        }
      }
    }

    if (val === undefined || val === null || val === '') {
      return '—';
    }

    // Format array values (e.g. BOM components)
    if (Array.isArray(val)) {
      if (val.length === 0) return '—';
      return val.map((c) => {
        if (typeof c === 'object' && c !== null) {
          const comp = c.component || c.material || c.id || c.idnrk || '';
          const qty = c.quantity || c.menge || '';
          const unit = c.unit || c.meins || 'EA';
          return `${comp}${qty ? ` (${qty} ${unit})` : ''}`.trim() || JSON.stringify(c);
        }
        return String(c);
      }).join(', ');
    }

    return val;
  };

  /**
   * Formats cell rendering with appropriate icons and badges
   */
  const renderCellContent = (item, col) => {
    const rawVal = getCellValue(item, col);

    // Primary Key Column
    if (col.name === idField || col.readOnly) {
      return <span className="sap-code-pill">{rawVal}</span>;
    }

    // Name / Title Column
    if (col.name === nameField) {
      if (isJobData) {
        return (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Activity size={16} color="#0070f2" style={{ flexShrink: 0 }} />
            <span style={{ fontWeight: 500 }}>{rawVal}</span>
          </div>
        );
      }
      if (isIdocData) {
        return (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <FileText size={16} color="#0284c7" style={{ flexShrink: 0 }} />
            <span style={{ fontWeight: 500 }}>{rawVal}</span>
          </div>
        );
      }
      if (isLogData) {
        return (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <ListOrdered size={16} color="#7c3aed" style={{ flexShrink: 0 }} />
            <span style={{ fontWeight: 500 }}>{rawVal}</span>
          </div>
        );
      }
      if (isInterfaceData) {
        return (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Network size={16} color="#059669" style={{ flexShrink: 0 }} />
            <span style={{ fontWeight: 500 }}>{rawVal}</span>
          </div>
        );
      }
      if (isBomData) {
        return (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <FileSpreadsheet size={16} color="#059669" style={{ flexShrink: 0 }} />
            <span style={{ fontWeight: 500 }}>{rawVal}</span>
          </div>
        );
      }
      const isOrg = item.Category === '2' || item.BusinessPartnerCategory === '2';
      return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {isOrg ? (
            <Building2 size={16} color="#0369a1" style={{ flexShrink: 0 }} />
          ) : (
            <UserCircle size={16} color="#7e22ce" style={{ flexShrink: 0 }} />
          )}
          <span style={{ fontWeight: 500 }}>{rawVal}</span>
        </div>
      );
    }

    // Status Column
    if (col.name === 'status' || col.name === 'previousRunStatus') {
      const statusStr = String(rawVal).toUpperCase();
      let badgeClass = 'sap-badge-neutral';
      if (statusStr === 'CANCELLED' || statusStr === 'FAILED' || statusStr.includes('51-ERROR')) {
        badgeClass = 'sap-badge-danger';
      } else if (statusStr === 'FINISHED' || statusStr === 'COMPLETED' || statusStr === 'SUCCESS' || statusStr.includes('53-SUCCESSFUL')) {
        badgeClass = 'sap-badge-success';
      } else if (statusStr === 'RUNNING') {
        badgeClass = 'sap-badge-running';
      } else if (statusStr === 'SCHEDULED' || statusStr === 'PENDING' || statusStr.includes('64-WAITING')) {
        badgeClass = 'sap-badge-scheduled';
      } else if (statusStr.includes('03-SENT')) {
        badgeClass = 'sap-badge-org';
      }

      return (
        <span className={`sap-badge ${badgeClass}`}>
          {rawVal}
        </span>
      );
    }

    // Severity Column (Application Logs)
    if (col.name === 'severity') {
      const sevStr = String(rawVal).toUpperCase();
      let badgeClass = 'sap-badge-neutral';
      if (sevStr === 'ERROR') badgeClass = 'sap-badge-danger';
      else if (sevStr === 'WARNING' || sevStr === 'WARN') badgeClass = 'sap-badge-scheduled';
      else if (sevStr === 'INFO') badgeClass = 'sap-badge-org';

      return (
        <span className={`sap-badge ${badgeClass}`}>
          {rawVal}
        </span>
      );
    }

    // Retry Count Column
    if (col.name === 'retryCount') {
      const num = Number(rawVal) || 0;
      return (
        <span style={{ fontWeight: 600, color: num > 0 ? '#b45309' : 'var(--sap-text-muted)' }}>
          {rawVal}
        </span>
      );
    }

    // Category / Enum Column
    if (col.name === 'Category' || col.allowedValues) {
      const isOrg = String(rawVal) === '2';
      return (
        <span className={`sap-badge ${isOrg ? 'sap-badge-org' : 'sap-badge-person'}`}>
          {isOrg ? 'Organization' : String(rawVal) === '1' ? 'Person' : rawVal}
        </span>
      );
    }

    return <span>{rawVal}</span>;
  };

  return (
    <div className="sap-card sap-table-card">
      {/* Table Title Bar */}
      <div className="sap-table-title-bar">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {isBomData ? (
            <FileSpreadsheet size={18} color="#059669" />
          ) : (
            <Database size={18} color="#0070f2" />
          )}
          <h3 style={{ fontSize: '16px', fontWeight: 600 }}>
            {title || entityLabel}
          </h3>
          <span className="sap-badge sap-badge-org" style={{ marginLeft: 4 }}>
            Entity: {odataEntitySet}
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: '13px', color: 'var(--sap-text-muted)' }}>
          <span>Page Size:</span>
          <select
            className="sap-input"
            style={{ height: 32, padding: '0 8px', fontSize: '13px' }}
            value={pageSize}
            onChange={(e) => handlePageSizeChange(Number(e.target.value))}
            disabled={isLoading}
          >
            <option value={10}>10</option>
            <option value={25}>25</option>
            <option value={50}>50 (Default)</option>
            <option value={100}>100</option>
          </select>
        </div>
      </div>

      {/* Table Body */}
      <div className="sap-table-container">
        {isLoading ? (
          <div className="sap-loading-state">
            <span className="sap-spinner sap-spinner-blue" style={{ width: 32, height: 32, borderWidth: 3 }} />
            <p>Loading {entityLabel.toLowerCase()}...</p>
          </div>
        ) : data.length === 0 ? (
          <div className="sap-empty-state">
            <FileSpreadsheet size={40} color="#94a3b8" />
            <p style={{ fontWeight: 600, fontSize: '15px' }}>No Records Found</p>
            <p style={{ fontSize: '13px' }}>
              No {entityLabel.toLowerCase()} match the current criteria.
            </p>
          </div>
        ) : (
          <table className="sap-table">
            <thead>
              <tr>
                {columns.map((col) => (
                  <th key={col.name}>{col.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {displayData.map((item, index) => {
                const rowKey = item[idField] || index;
                return (
                  <tr key={rowKey}>
                    {columns.map((col) => (
                      <td key={col.name} data-label={col.label}>
                        {renderCellContent(item, col)}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination Controls */}
      <div className="sap-pagination">
        <div style={{ fontSize: '13px', color: 'var(--sap-text-muted)' }}>
          {effectiveTotal > 0 ? (
            <>
              Showing <strong>{startRecord}</strong> - <strong>{endRecord}</strong> of{' '}
              <strong>{effectiveTotal}</strong> records
            </>
          ) : (
            '0 records'
          )}
        </div>

        <div className="sap-pagination-controls">
          <button
            type="button"
            className="sap-btn sap-btn-secondary"
            style={{ width: 32, height: 32, padding: 0 }}
            onClick={() => handlePageChange(1)}
            disabled={currentPage <= 1 || isLoading}
            title="First Page"
          >
            <ChevronsLeft size={16} />
          </button>

          <button
            type="button"
            className="sap-btn sap-btn-secondary"
            style={{ width: 32, height: 32, padding: 0 }}
            onClick={() => handlePageChange(currentPage - 1)}
            disabled={currentPage <= 1 || isLoading}
            title="Previous Page"
          >
            <ChevronLeft size={16} />
          </button>

          <span style={{ fontSize: '13px', margin: '0 4px', color: 'var(--sap-text)' }}>
            Page <strong>{currentPage}</strong> of <strong>{totalPages}</strong>
          </span>

          <button
            type="button"
            className="sap-btn sap-btn-secondary"
            style={{ width: 32, height: 32, padding: 0 }}
            onClick={() => handlePageChange(currentPage + 1)}
            disabled={currentPage >= totalPages || isLoading}
            title="Next Page"
          >
            <ChevronRight size={16} />
          </button>

          <button
            type="button"
            className="sap-btn sap-btn-secondary"
            style={{ width: 32, height: 32, padding: 0 }}
            onClick={() => handlePageChange(totalPages)}
            disabled={currentPage >= totalPages || isLoading}
            title="Last Page"
          >
            <ChevronsRight size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}
