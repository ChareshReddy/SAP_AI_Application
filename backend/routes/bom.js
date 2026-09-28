import express from 'express';
import { validateSourceBom } from '../services/sapGuiClient.js';

const router = express.Router();

/**
 * POST /api/bom/validate-source
 * Validates a source / reference BOM in SAP GUI (CS03) or mock mode.
 * 
 * Request body:
 * {
 *   material: string,
 *   plant: string,
 *   bomUsage?: string,
 *   alternativeBom?: string
 * }
 * 
 * Response on success:
 * {
 *   success: true,
 *   materialExists: true,
 *   plantValid: true,
 *   bomExists: true,
 *   alternativeValid: true,
 *   availableAlternatives: string[],
 *   componentCount: number,
 *   message: string
 * }
 * 
 * Response on failure:
 * {
 *   success: false,
 *   errorCode: string,
 *   message: string,
 *   availableAlternatives?: string[]
 * }
 */
router.post('/validate-source', async (req, res) => {
  try {
    const { material, plant, bomUsage, alternativeBom } = req.body || {};

    if (!material || !String(material).trim()) {
      return res.status(200).json({
        success: false,
        errorCode: 'MATERIAL_NOT_FOUND',
        message: 'Material is required for source BOM validation.'
      });
    }

    if (!plant || !String(plant).trim()) {
      return res.status(200).json({
        success: false,
        errorCode: 'MATERIAL_PLANT_INVALID',
        message: 'Plant is required for source BOM validation.'
      });
    }

    const result = await validateSourceBom({
      material,
      plant,
      bomUsage,
      alternativeBom
    });

    return res.status(200).json(result);
  } catch (err) {
    console.error('[bom.js] validate-source error:', err.message);
    return res.status(200).json({
      success: false,
      errorCode: 'SAP_VALIDATION_ERROR',
      message: `Source BOM validation failed: ${err.message}`
    });
  }
});

export default router;
