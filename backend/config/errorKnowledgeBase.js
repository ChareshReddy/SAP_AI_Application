/**
 * SAP AI Operations Agent - Error Knowledge Base & Classification Catalogue
 * Maps operational error patterns in SAP background job, IDoc, and interface logs
 * to runbook categories, risk levels, and recommended remediation actions.
 *
 * Persisted in backend/mock/errorKnowledgeBase.json with occurrence tracking.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const KB_FILE_PATH = path.join(__dirname, '..', 'mock', 'errorKnowledgeBase.json');

// In-memory runtime cache of knowledge base entries
let knowledgeBaseCache = [];

/**
 * Loads and compiles error knowledge base entries from JSON file.
 */
export function loadKnowledgeBase() {
  try {
    if (fs.existsSync(KB_FILE_PATH)) {
      const raw = fs.readFileSync(KB_FILE_PATH, 'utf-8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        knowledgeBaseCache = parsed.map((item) => {
          let compiledRegex = null;
          try {
            compiledRegex = new RegExp(item.patternStr || '', 'i');
          } catch {
            compiledRegex = /$.^/; // Matches nothing if regex invalid
          }
          return {
            ...item,
            pattern: compiledRegex
          };
        });
        return knowledgeBaseCache;
      }
    }
  } catch (err) {
    console.warn('[errorKnowledgeBase] Failed to read errorKnowledgeBase.json:', err.message);
  }

  knowledgeBaseCache = [];
  return knowledgeBaseCache;
}

/**
 * Persists knowledge base entries to disk (without compiled RegExp objects).
 */
export function persistKnowledgeBase() {
  try {
    const dataToSave = knowledgeBaseCache.map(({ pattern, ...rest }) => rest);
    fs.writeFileSync(KB_FILE_PATH, JSON.stringify(dataToSave, null, 2), 'utf-8');
    return true;
  } catch (err) {
    console.error('[errorKnowledgeBase] Failed to save errorKnowledgeBase.json:', err.message);
    return false;
  }
}

// Initial load
loadKnowledgeBase();

// Export ERROR_CATALOGUE getter/array for backward compatibility
export const ERROR_CATALOGUE = knowledgeBaseCache;

/**
 * Records an occurrence of an error pattern, updating usage frequency and resolution metrics.
 * @param {string} category Category name or Rule ID
 * @param {boolean} [resolved=true] Whether the error was remediated successfully
 * @returns {object|null} Updated knowledge base entry
 */
export function recordErrorOccurrence(category, resolved = true) {
  if (!category) return null;
  const cleanCategory = String(category).trim().toLowerCase();

  const entry = knowledgeBaseCache.find(
    (e) => e.category.toLowerCase() === cleanCategory || e.id?.toLowerCase() === cleanCategory
  );

  if (entry) {
    entry.occurrenceCount = (entry.occurrenceCount || 0) + 1;
    entry.lastSeen = new Date().toISOString();
    if (resolved) {
      entry.successfulResolutionCount = (entry.successfulResolutionCount || 0) + 1;
    }
    persistKnowledgeBase();
    return { ...entry };
  }

  return null;
}

/**
 * Classifies an error from a log message against the runbook catalogue.
 * @param {Array<object|string>|string} jobLogMessages - Log entries or message strings
 * @returns {{ category: string, recommendedAction: 'RETRY'|'ESCALATE', riskLevel: number, description: string, matchedMessage: string|null, occurrenceCount: number, successfulResolutionCount: number, lastSeen: string|null }}
 */
export function classifyError(jobLogMessages) {
  if (!jobLogMessages) {
    return {
      category: 'UNKNOWN_ERROR',
      recommendedAction: 'ESCALATE',
      riskLevel: 3,
      description: 'No log messages available for diagnosis. Human escalation required.',
      matchedMessage: null,
      occurrenceCount: 1,
      successfulResolutionCount: 0,
      lastSeen: new Date().toISOString()
    };
  }

  // Normalize into an array of string messages
  const messages = [];
  if (Array.isArray(jobLogMessages)) {
    for (const item of jobLogMessages) {
      if (typeof item === 'string') {
        messages.push(item);
      } else if (item && typeof item === 'object' && item.message) {
        messages.push(item.message);
      }
    }
  } else if (typeof jobLogMessages === 'string') {
    messages.push(jobLogMessages);
  }

  // Reverse so we check most recent / terminal error messages first
  const reversedMessages = [...messages].reverse();

  for (const entry of knowledgeBaseCache) {
    for (const msg of reversedMessages) {
      if (entry.pattern && entry.pattern.test(msg)) {
        return {
          id: entry.id,
          category: entry.category,
          recommendedAction: entry.recommendedAction,
          riskLevel: entry.riskLevel,
          description: entry.description,
          matchedMessage: msg,
          occurrenceCount: entry.occurrenceCount || 1,
          successfulResolutionCount: entry.successfulResolutionCount || 0,
          lastSeen: entry.lastSeen || null
        };
      }
    }
  }

  // Default fallback if no pattern matched
  return {
    category: 'UNKNOWN_ERROR',
    recommendedAction: 'ESCALATE',
    riskLevel: 3,
    description: 'Unclassified error condition. Does not match automated runbook catalogue; human escalation required.',
    matchedMessage: messages.length > 0 ? messages[messages.length - 1] : null,
    occurrenceCount: 1,
    successfulResolutionCount: 0,
    lastSeen: new Date().toISOString()
  };
}

/**
 * Returns all knowledge base entries for admin inspection.
 */
export function getAllKnowledgeBaseEntries() {
  return knowledgeBaseCache.map(({ pattern, ...rest }) => ({ ...rest }));
}

/**
 * Adds a new error pattern entry to the knowledge base.
 */
export function addKnowledgeBaseEntry(entry) {
  const newId = entry.id || `KB_${String(knowledgeBaseCache.length + 1).padStart(3, '0')}`;
  const newEntry = {
    id: newId,
    category: entry.category || 'CUSTOM_ERROR',
    patternStr: entry.patternStr || '',
    recommendedAction: entry.recommendedAction || 'ESCALATE',
    riskLevel: Number(entry.riskLevel) || 3,
    description: entry.description || '',
    occurrenceCount: entry.occurrenceCount || 0,
    successfulResolutionCount: entry.successfulResolutionCount || 0,
    lastSeen: new Date().toISOString()
  };

  newEntry.pattern = new RegExp(newEntry.patternStr, 'i');
  knowledgeBaseCache.push(newEntry);
  persistKnowledgeBase();
  return { ...newEntry };
}

/**
 * Updates an existing entry in the knowledge base.
 */
export function updateKnowledgeBaseEntry(id, changes) {
  const index = knowledgeBaseCache.findIndex((e) => e.id === id);
  if (index === -1) return null;

  const current = knowledgeBaseCache[index];
  const updated = {
    ...current,
    ...changes,
    id: current.id // ID cannot be changed
  };

  if (changes.patternStr) {
    updated.pattern = new RegExp(changes.patternStr, 'i');
  }

  knowledgeBaseCache[index] = updated;
  persistKnowledgeBase();
  const { pattern, ...clean } = updated;
  return clean;
}

/**
 * Deletes an entry from the knowledge base.
 */
export function deleteKnowledgeBaseEntry(id) {
  const index = knowledgeBaseCache.findIndex((e) => e.id === id);
  if (index === -1) return false;

  knowledgeBaseCache.splice(index, 1);
  persistKnowledgeBase();
  return true;
}

export const createKnowledgeBaseRule = addKnowledgeBaseEntry;
export const updateKnowledgeBaseRule = updateKnowledgeBaseEntry;
export const deleteKnowledgeBaseRule = deleteKnowledgeBaseEntry;
export function getKnowledgeBaseRuleById(id) {
  const entry = knowledgeBaseCache.find((e) => e.id === id);
  if (!entry) return null;
  const { pattern, ...clean } = entry;
  return clean;
}

export default {
  ERROR_CATALOGUE,
  loadKnowledgeBase,
  recordErrorOccurrence,
  classifyError,
  getAllKnowledgeBaseEntries,
  addKnowledgeBaseEntry,
  updateKnowledgeBaseEntry,
  deleteKnowledgeBaseEntry
};
