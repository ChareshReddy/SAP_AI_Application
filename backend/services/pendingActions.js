import crypto from 'crypto';

class PendingActionStore {
  constructor() {
    this.actions = new Map();
    this.DEFAULT_TTL_MS = 5 * 60 * 1000; // 5 minutes TTL

    // Periodic cleanup of expired pending actions every 60 seconds
    this.cleanupInterval = setInterval(() => {
      this.cleanupExpiredActions();
    }, 60 * 1000);

    if (this.cleanupInterval.unref) {
      this.cleanupInterval.unref();
    }
  }

  /**
   * Generates a unique actionId with timestamp and random hex.
   * e.g. act_1726980000000_a1b2c3d4
   */
  generateActionId() {
    const timestamp = Date.now();
    const randomHex = crypto.randomBytes(4).toString('hex');
    return `act_${timestamp}_${randomHex}`;
  }

  /**
   * Stores a new proposed write action in-memory with a 5-minute TTL.
   * @param {object} params
   * @param {'update'|'create'|'delete'} params.type
   * @param {string} [params.entityKey='businessPartner']
   * @param {string} [params.recordId]
   * @param {string} [params.businessPartnerId] - legacy alias for recordId
   * @param {object} params.payload - raw or normalized write payload
   * @param {object} params.preview - human-readable change preview
   * @param {string} params.sapUsername
   * @param {string} [params.sourcePrompt]
   * @param {number} [params.ttlMs]
   * @returns {object} Stored action metadata including actionId, expiresAt
   */
  createPendingAction({
    type,
    entityKey = 'businessPartner',
    recordId = null,
    businessPartnerId = null,
    payload = {},
    preview = {},
    sapUsername = 'SYSTEM',
    sourcePrompt = '',
    ttlMs = this.DEFAULT_TTL_MS,
    riskLevel = null,
    requiresReason = false,
    reason = '',
    systemKey = 'DEV',
    category = null,
    ...rest
  }) {
    const actionId = this.generateActionId();
    const now = Date.now();
    const expiresAt = now + ttlMs;
    const resolvedRecordId = recordId || businessPartnerId;

    const action = {
      actionId,
      type,
      entityKey,
      recordId: resolvedRecordId,
      businessPartnerId: resolvedRecordId,
      payload,
      preview,
      sapUsername,
      sourcePrompt,
      createdAt: now,
      expiresAt,
      riskLevel: riskLevel ?? preview.riskLevel ?? 2,
      requiresReason: Boolean(requiresReason || preview.requiresReason),
      reason: reason || preview.reason || '',
      systemKey: systemKey || preview.systemKey || 'DEV',
      category: category || preview.diagnosis?.category || null,
      ...rest
    };

    this.actions.set(actionId, action);
    return action;
  }

  /**
   * Retrieves an active pending action. Returns null if missing or expired.
   * @param {string} actionId
   * @returns {object|null}
   */
  getPendingAction(actionId) {
    if (!actionId || !this.actions.has(actionId)) {
      return null;
    }

    const action = this.actions.get(actionId);
    if (Date.now() > action.expiresAt) {
      this.actions.delete(actionId);
      return null;
    }

    return action;
  }

  /**
   * Removes a pending action after execution or cancellation.
   * @param {string} actionId
   * @returns {boolean}
   */
  clearPendingAction(actionId) {
    if (!actionId) return false;
    return this.actions.delete(actionId);
  }

  /**
   * Cleans up all expired pending actions.
   */
  cleanupExpiredActions() {
    const now = Date.now();
    for (const [actionId, action] of this.actions.entries()) {
      if (now > action.expiresAt) {
        this.actions.delete(actionId);
      }
    }
  }

  /**
   * Test utility to clear all pending actions.
   */
  clearAllPendingActions() {
    this.actions.clear();
  }

  /**
   * Total number of currently active actions.
   */
  size() {
    this.cleanupExpiredActions();
    return this.actions.size;
  }
}

export const pendingActionStore = new PendingActionStore();
