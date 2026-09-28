import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import { listAvailableEntities, getEntitySchema } from '../config/entitySchemas/index.js';
import { getEntityData } from '../services/sapClient.js';

const router = express.Router();

/**
 * GET /api/entities
 * Returns metadata of all registered entities in the registry.
 * Publicly accessible so UI can render dynamic tabs/selectors.
 */
router.get('/', (req, res) => {
  const entities = listAvailableEntities();
  return res.status(200).json({ entities });
});

/**
 * GET /api/entities/:entityKey
 * Protected endpoint to fetch records for a specific entity.
 * Supports:
 * - OData range filtering via 'from' and 'to'
 * - OData pagination via 'top' and 'skip'
 * - Generic column filtering
 */
router.get('/:entityKey', requireAuth, async (req, res) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');

  const { entityKey } = req.params;
  const schema = getEntitySchema(entityKey);

  if (!schema) {
    return res.status(404).json({
      error: `Entity "${entityKey}" not found in registry.`
    });
  }

  try {
    const { from, to, top, skip, city, systemKey } = req.query;
    const parsedTop = top ? Math.min(Math.max(parseInt(top, 10) || 50, 1), 500) : 50;
    const parsedSkip = skip ? Math.max(parseInt(skip, 10) || 0, 0) : 0;
    const effectiveSystem = systemKey || req.sapSession?.systemKey || 'DEV';

    const oDataResponse = await getEntityData(schema.entityKey, {
      from: from || null,
      to: to || null,
      city: city || null,
      top: parsedTop,
      skip: parsedSkip,
      systemKey: effectiveSystem
    }, req.sapSession?.credentials, effectiveSystem);

    const totalCount = parseInt(oDataResponse.d?.__count || oDataResponse.d?.results?.length || 0, 10);

    return res.status(200).json({
      entityKey: schema.entityKey,
      label: schema.label,
      d: oDataResponse.d || { results: [] },
      pagination: {
        top: parsedTop,
        skip: parsedSkip,
        total: totalCount
      }
    });
  } catch (err) {
    console.error(`Error fetching data for entity "${entityKey}":`, err.message);
    const statusCode = err.status || 500;
    return res.status(statusCode).json({
      error: err.message || `Failed to fetch records for ${schema.label}`
    });
  }
});

export default router;
