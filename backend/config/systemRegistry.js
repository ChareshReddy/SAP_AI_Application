/**
 * SAP Multi-System Registry
 * Configures endpoints, SAP clients, and production safeguards for multi-tier environments.
 */

export const SYSTEM_REGISTRY = {
  DEV: {
    key: 'DEV',
    label: 'Development (DEV)',
    description: 'Development sandbox and unit testing environment',
    get baseUrl() {
      return process.env.SAP_DEV_URL;
    },
    client: '100',
    isProd: false,
    requiresDoubleConfirmation: false
  },
  QA: {
    key: 'QA',
    label: 'Quality Assurance (QA)',
    description: 'Quality and staging regression environment',
    baseUrl: process.env.SAP_QA_URL || 'https://sap-qa.corp.internal/sap/opu/odata/sap',
    client: '200',
    isProd: false,
    requiresDoubleConfirmation: false
  },
  PROD: {
    key: 'PROD',
    label: 'Production (PROD)',
    description: 'Live business production system (Level 3+ actions require CONFIRM keyword)',
    baseUrl: process.env.SAP_PROD_URL || 'https://sap-prod.corp.internal/sap/opu/odata/sap',
    client: '500',
    isProd: true,
    requiresDoubleConfirmation: true
  }
};

export const DEFAULT_SYSTEM = 'DEV';

/**
 * Retrieves configuration for a target SAP system. Defaults to DEV if unknown.
 * @param {string} systemKey
 * @returns {object}
 */
export function getSystemConfig(systemKey) {
  if (!systemKey) return SYSTEM_REGISTRY[DEFAULT_SYSTEM];
  const upper = String(systemKey).trim().toUpperCase();
  return SYSTEM_REGISTRY[upper] || SYSTEM_REGISTRY[DEFAULT_SYSTEM];
}

/**
 * Validates whether a systemKey is registered.
 * @param {string} systemKey
 * @returns {boolean}
 */
export function isValidSystemKey(systemKey) {
  if (!systemKey) return false;
  const upper = String(systemKey).trim().toUpperCase();
  return Boolean(SYSTEM_REGISTRY[upper]);
}

/**
 * Returns list of available systems for frontend selectors.
 * @returns {Array<object>}
 */
export function listSystems() {
  return Object.values(SYSTEM_REGISTRY).map((sys) => ({
    key: sys.key,
    label: sys.label,
    description: sys.description,
    isProd: sys.isProd
  }));
}

export default SYSTEM_REGISTRY;
