/**
 * SAP AI Operations Agent - 4-Tier Risk Classification System
 *
 * Tier 1: Read Only (autonomous execution permitted: queries, log analysis, status checks)
 * Tier 2: Low Risk (automated per established runbook rules; requires human confirmation in Phase 1)
 * Tier 3: Sensitive (security/reconciliation conflicts; requires human authorization or functional review)
 * Tier 4: Critical (infrastructure/data corruption faults; strictly blocked - no autonomous tool exists)
 */

export const RISK_LEVELS = {
  1: {
    level: 1,
    name: 'Read Only',
    description: 'Autonomous execution allowed. Queries, log inspections, status monitoring.',
    requiresConfirmation: false,
    blocked: false
  },
  2: {
    level: 2,
    name: 'Low Risk',
    description: 'Safe transient error remediation per runbook. Requires human confirmation in Phase 1.',
    requiresConfirmation: true, // Configured for Phase 1: human review required before retry executes
    blocked: false
  },
  3: {
    level: 3,
    name: 'Sensitive',
    description: 'Authorization or reconciliation conflicts. Human authorization/functional review strictly required.',
    requiresConfirmation: true,
    blocked: false
  },
  4: {
    level: 4,
    name: 'Critical',
    description: 'System critical faults or database corruption. Autonomous remediation is strictly forbidden; no tool exists.',
    requiresConfirmation: true,
    requiresHumanLead: true,
    blocked: true
  }
};

/**
 * Returns risk level definition for a given numeric tier (1 to 4).
 * @param {number} level
 * @returns {object}
 */
export function getRiskLevel(level) {
  return RISK_LEVELS[level] || RISK_LEVELS[3];
}

/**
 * Checks whether autonomous execution is permitted for a given risk tier.
 * Only Tier 1 (Read Only) allows autonomous execution.
 * Tiers 2, 3, 4 require explicit human confirmation.
 * @param {number} level
 * @returns {boolean}
 */
export function isAutoExecuteAllowed(level) {
  return Number(level) === 1;
}

/**
 * Checks whether an action requires an explicit, non-empty Reason for Change.
 * Tier 3 (Sensitive) and Tier 4 (Critical) actions mandate business justification.
 * @param {number} level
 * @returns {boolean}
 */
export function requiresChangeReason(level) {
  return Number(level) >= 3;
}

/**
 * Startup integrity verification scanning all registered AI tools.
 * Enforces that:
 * 1. NO tool is classified or tagged as Risk Level 4 (Critical).
 * 2. NO tool has autoExecute enabled without explicit human confirmation.
 * 3. NO direct execution tools exist that bypass the propose -> confirm pattern.
 *
 * @param {Array<object>} tools List of function tools registered for AI model
 * @throws {Error} If any safety gate violation is detected
 * @returns {boolean} True if all tools pass security audit
 */
export function verifyAllToolsSafety(tools) {
  if (!Array.isArray(tools)) {
    throw new Error('[SafetyGate] Tools registry must be an array.');
  }

  const criticalKeywords = ['hard_delete', 'drop_table', 'database_corrupt', 'kill_instance', 'kernel_panic'];

  for (const tool of tools) {
    const fn = tool?.function || tool;
    const name = fn.name || 'unnamed_tool';
    const riskLevel = fn.riskLevel || tool.riskLevel;

    // Rule 1: No Level 4 tools allowed in active registry
    if (riskLevel === 4) {
      throw new Error(
        `[SafetyGate VIOLATION] Critical Level 4 tool detected: "${name}". Autonomous Level 4 tools are strictly forbidden by enterprise policy.`
      );
    }

    // Rule 2: No auto-execute bypass flags
    if (fn.autoExecute === true || tool.autoExecute === true) {
      throw new Error(
        `[SafetyGate VIOLATION] Tool "${name}" is configured with autoExecute: true. All mutating tools require explicit human confirmation.`
      );
    }

    // Rule 3: Keyword check for critical destructive operations
    for (const kw of criticalKeywords) {
      if (name.toLowerCase().includes(kw)) {
        throw new Error(
          `[SafetyGate VIOLATION] Tool "${name}" contains prohibited critical operation keyword "${kw}".`
        );
      }
    }
  }

  return true;
}

export default RISK_LEVELS;
