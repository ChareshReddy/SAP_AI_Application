import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const AUDIT_LOG_FILE = path.join(__dirname, '..', 'mock', 'auditLog.json');

class AuditLogger {
  constructor() {
    this.logs = [];
    this.loadPersistedLogs();
  }

  loadPersistedLogs() {
    try {
      if (fs.existsSync(AUDIT_LOG_FILE)) {
        const raw = fs.readFileSync(AUDIT_LOG_FILE, 'utf-8');
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          this.logs = parsed;
        }
      }
    } catch (err) {
      console.warn('Could not read existing audit log file:', err.message);
      this.logs = [];
    }
  }

  persistLogs() {
    try {
      const dir = path.dirname(AUDIT_LOG_FILE);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(AUDIT_LOG_FILE, JSON.stringify(this.logs, null, 2), 'utf-8');
    } catch (err) {
      console.error('Failed to persist audit log to disk:', err.message);
    }
  }

  /**
   * Logs an executed write action for any entity.
   * @param {object} params
   * @param {string} [params.sapUsername='SYSTEM']
   * @param {string} [params.entityKey='businessPartner']
   * @param {'create'|'update'|'delete'} params.actionType
   * @param {string} [params.recordId]
   * @param {string} [params.businessPartnerId] - legacy alias
   * @param {object|null} [params.beforeValues]
   * @param {object|null} [params.afterValues]
   * @param {string} [params.sourcePrompt]
   * @param {string} [params.actionId]
   * @returns {object} The logged entry
   */
  logAction({
    sapUsername = 'SYSTEM',
    entityKey = 'businessPartner',
    actionType,
    recordId = null,
    businessPartnerId = null,
    beforeValues = null,
    afterValues = null,
    sourcePrompt = '',
    actionId = null,
    system = 'SAP-S4H-MOCK',
    task = null,
    steps = null,
    result = 'SUCCESS',
    ticketId = null,
    reason = null
  }) {
    const resolvedId = String(recordId || businessPartnerId || 'UNKNOWN');
    const isOpsAction = ['backgroundJob', 'idoc', 'interfaceMonitor'].includes(entityKey) ||
      ['retry', 'reprocess', 'retrigger'].includes(actionType);
    const autoTicketId = ticketId || (isOpsAction
      ? `INC-${Math.floor(100000 + Math.random() * 900000)}`
      : null);

    let defaultTask = `${actionType.toUpperCase()} Record`;
    if (actionType === 'retry') defaultTask = 'Background Job Remediation';
    else if (actionType === 'reprocess') defaultTask = 'IDoc Reprocessing';
    else if (actionType === 'retrigger') defaultTask = 'Interface Retrigger';
    else if (actionType === 'release_po') defaultTask = 'Purchase Order Release';
    else if (actionType === 'post_fi_doc') defaultTask = 'Financial Document Posting';
    else if (actionType === 'change_master_data') defaultTask = 'Master Data Modification';

    const logEntry = {
      logId: `audit_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
      sapUsername,
      user: sapUsername,
      system,
      entityKey,
      actionType,
      recordId: resolvedId,
      businessPartnerId: resolvedId, // legacy field preserved
      task: task || defaultTask,
      reason: reason || null,
      steps: steps || [
        `Initiated ${actionType} action for ${entityKey} ${resolvedId}`,
        'Human confirmation verified',
        `Executed ${actionType} successfully`
      ],
      result,
      ticketId: autoTicketId,
      beforeValues,
      afterValues,
      sourcePrompt,
      actionId,
      timestamp: new Date().toISOString()
    };

    this.logs.push(logEntry);
    this.persistLogs();

    console.log(
      `[AUDIT] Action: ${actionType.toUpperCase()} | Entity: ${entityKey} | ID: ${resolvedId} | System: ${system} | User: ${sapUsername} | Reason: ${reason || 'N/A'} | Ticket: ${autoTicketId || 'N/A'} | Time: ${logEntry.timestamp}`
    );

    return logEntry;
  }

  /**
   * Retrieves all audit logs (most recent first).
   * @returns {Array<object>}
   */
  getAuditLogs() {
    return [...this.logs].reverse();
  }

  /**
   * Retrieves audit logs for a specific entity and record.
   * @param {string} id
   * @param {string} [entityKey]
   * @returns {Array<object>}
   */
  getLogsForPartner(id, entityKey = null) {
    const targetId = String(id);
    return this.logs.filter((entry) => {
      const matchId = String(entry.recordId || entry.businessPartnerId) === targetId;
      if (!matchId) return false;
      if (entityKey && entry.entityKey !== entityKey) return false;
      return true;
    });
  }

  /**
   * Clears audit logs (for automated testing).
   */
  clearAuditLogs() {
    this.logs = [];
    try {
      if (fs.existsSync(AUDIT_LOG_FILE)) {
        fs.unlinkSync(AUDIT_LOG_FILE);
      }
    } catch {
      // ignore
    }
  }
}

export const auditLogger = new AuditLogger();
