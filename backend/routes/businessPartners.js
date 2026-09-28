import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import { getEntityData } from '../services/sapClient.js';

const router = express.Router();

/**
 * GET /api/business-partners
 * Fetches Business Partner data with address information.
 * Uses shared in-memory mockDataCaches single source of truth via getEntityData().
 * Supports:
 * - OData range filtering via 'from' and 'to' params (BusinessPartner ID range)
 * - OData pagination via 'top' (default 50) and 'skip' (default 0)
 * - City filtering
 * - Protected by requireAuth session middleware
 */
router.get('/', requireAuth, async (req, res) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');

  try {
    const { from, to, top, skip, city } = req.query;

    const parsedTop = top ? Math.min(Math.max(parseInt(top, 10) || 50, 1), 500) : 50;
    const parsedSkip = skip ? Math.max(parseInt(skip, 10) || 0, 0) : 0;

    const oDataResponse = await getEntityData('businessPartner', {
      from: from || null,
      to: to || null,
      city: city || null,
      top: parsedTop,
      skip: parsedSkip
    }, req.sapSession?.credentials);

    const totalCount = parseInt(oDataResponse.d?.__count || oDataResponse.d?.results?.length || 0, 10);

    return res.status(200).json({
      d: oDataResponse.d || { results: [] },
      pagination: {
        top: parsedTop,
        skip: parsedSkip,
        total: totalCount
      }
    });
  } catch (err) {
    console.error('Error fetching Business Partners:', err.message);
    const statusCode = err.status || 500;
    return res.status(statusCode).json({
      error: err.message || 'Failed to fetch Business Partner records'
    });
  }
});

export default router;
