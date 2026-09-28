import React, { useState } from 'react';
import { Filter, RotateCcw, ArrowRight } from 'lucide-react';

export default function FilterRange({ currentFilter, onApplyFilter, isLoading }) {
  const [fromVal, setFromVal] = useState(currentFilter?.from || '');
  const [toVal, setToVal] = useState(currentFilter?.to || '');
  const [validationError, setValidationError] = useState('');

  const handleApply = (e) => {
    e?.preventDefault();
    setValidationError('');

    const fromTrimmed = fromVal.trim();
    const toTrimmed = toVal.trim();

    if (fromTrimmed && toTrimmed) {
      const fromNum = parseInt(fromTrimmed, 10);
      const toNum = parseInt(toTrimmed, 10);
      if (!isNaN(fromNum) && !isNaN(toNum) && fromNum > toNum) {
        setValidationError('"From" ID cannot be greater than "To" ID.');
        return;
      }
    }

    onApplyFilter({
      from: fromTrimmed || null,
      to: toTrimmed || null
    });
  };

  const handleReset = () => {
    setFromVal('');
    setToVal('');
    setValidationError('');
    onApplyFilter({ from: null, to: null });
  };

  const hasActiveFilter = Boolean(currentFilter?.from || currentFilter?.to);

  return (
    <div className="sap-card">
      <form onSubmit={handleApply} className="sap-filter-bar">
        <div className="sap-filter-fields">
          <div className="sap-filter-field">
            <label className="sap-form-label" htmlFor="filter-from">
              From Business Partner ID
            </label>
            <input
              id="filter-from"
              type="text"
              className="sap-input"
              placeholder="e.g. 1000"
              value={fromVal}
              onChange={(e) => {
                setFromVal(e.target.value);
                setValidationError('');
              }}
              disabled={isLoading}
            />
          </div>

          <div style={{ paddingBottom: 8, color: '#94a3b8' }}>
            <ArrowRight size={18} />
          </div>

          <div className="sap-filter-field">
            <label className="sap-form-label" htmlFor="filter-to">
              To Business Partner ID
            </label>
            <input
              id="filter-to"
              type="text"
              className="sap-input"
              placeholder="e.g. 1030"
              value={toVal}
              onChange={(e) => {
                setToVal(e.target.value);
                setValidationError('');
              }}
              disabled={isLoading}
            />
          </div>

          <div style={{ display: 'flex', gap: 8, paddingBottom: 2 }}>
            <button
              type="submit"
              className="sap-btn sap-btn-primary"
              disabled={isLoading}
              title="Apply OData $filter on Business Partner ID"
            >
              <Filter size={15} />
              <span>Apply Range Filter</span>
            </button>

            {hasActiveFilter && (
              <button
                type="button"
                className="sap-btn sap-btn-secondary"
                onClick={handleReset}
                disabled={isLoading}
                title="Clear filter and show all records"
              >
                <RotateCcw size={15} />
                <span>Reset Filter</span>
              </button>
            )}
          </div>
        </div>

        {hasActiveFilter && (
          <div style={{
            fontSize: '12px',
            color: '#0070f2',
            background: '#e6f4ff',
            padding: '6px 12px',
            borderRadius: '4px',
            fontWeight: 500
          }}>
            Active OData $filter: BusinessPartner range
            {currentFilter.from ? ` ge '${currentFilter.from}'` : ''}
            {currentFilter.from && currentFilter.to ? ' and' : ''}
            {currentFilter.to ? ` le '${currentFilter.to}'` : ''}
          </div>
        )}
      </form>

      {validationError && (
        <div style={{
          padding: '8px 24px 14px',
          color: 'var(--sap-error)',
          fontSize: '13px',
          fontWeight: 500
        }}>
          ⚠️ {validationError}
        </div>
      )}
    </div>
  );
}
