import express from 'express';
import {
  getAllKnowledgeBaseEntries,
  addKnowledgeBaseEntry,
  updateKnowledgeBaseEntry,
  deleteKnowledgeBaseEntry,
  recordErrorOccurrence
} from '../config/errorKnowledgeBase.js';

const router = express.Router();

/**
 * GET /api/knowledge-base
 * Retrieves all runbook error pattern definitions and resolution statistics.
 */
router.get('/', (req, res) => {
  const entries = getAllKnowledgeBaseEntries();
  return res.status(200).json({
    success: true,
    total: entries.length,
    entries,
    rules: entries
  });
});

/**
 * POST /api/knowledge-base
 * Creates a new error runbook pattern entry.
 */
router.post('/', (req, res) => {
  const { category, patternStr, recommendedAction, riskLevel, description } = req.body || {};

  if (!category || !patternStr || !recommendedAction) {
    return res.status(400).json({
      error: 'category, patternStr, and recommendedAction are required fields.'
    });
  }

  const newEntry = addKnowledgeBaseEntry({
    category,
    patternStr,
    recommendedAction,
    riskLevel: riskLevel || 2,
    description: description || ''
  });

  return res.status(201).json({
    success: true,
    entry: newEntry,
    rule: newEntry
  });
});

/**
 * PUT /api/knowledge-base/:id
 * Updates an existing error runbook pattern.
 */
router.put('/:id', (req, res) => {
  const { id } = req.params;
  const updated = updateKnowledgeBaseEntry(id, req.body || {});

  if (!updated) {
    return res.status(404).json({
      error: `Knowledge Base entry "${id}" not found.`
    });
  }

  return res.status(200).json({
    success: true,
    entry: updated,
    rule: updated
  });
});

/**
 * DELETE /api/knowledge-base/:id
 * Removes a runbook pattern from the catalogue.
 */
router.delete('/:id', (req, res) => {
  const { id } = req.params;
  const deleted = deleteKnowledgeBaseEntry(id);

  if (!deleted) {
    return res.status(404).json({
      error: `Knowledge Base entry "${id}" not found.`
    });
  }

  return res.status(200).json({
    success: true,
    message: `Knowledge Base entry "${id}" deleted.`
  });
});

/**
 * POST /api/knowledge-base/record-occurrence
 * Records occurrence and resolution success of an error pattern.
 */
router.post('/record-occurrence', (req, res) => {
  const { category, resolved = true } = req.body || {};

  if (!category) {
    return res.status(400).json({ error: 'Category is required to record occurrence.' });
  }

  const updated = recordErrorOccurrence(category, resolved);
  if (!updated) {
    return res.status(404).json({ error: `Category "${category}" not found in knowledge base.` });
  }

  return res.status(200).json({
    success: true,
    entry: updated,
    rule: updated
  });
});

export default router;
