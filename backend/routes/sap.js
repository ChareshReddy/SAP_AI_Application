import express from 'express';
import {
  checkSapSessionHealth,
  discoverSapSessions,
  getSelectedSapSessionId,
  getSelectedSapUser,
  setSelectedSapSessionId
} from '../services/sapGuiClient.js';

const router = express.Router();

/**
 * GET /api/sap/sessions
 * Returns all active SAP GUI sessions and the currently selected session.
 */
router.get('/sessions', async (req, res) => {
  try {
    const health = await checkSapSessionHealth();
    const sessions = (health.sessions || []).map((s) => ({
      ...s,
      selected: Boolean(health.selectedSessionId && s.id === health.selectedSessionId)
    }));

    return res.status(200).json({
      success: true,
      selectedSessionId: health.selectedSessionId || null,
      selectedUser: health.selectedUser || health.user || null,
      sessions,
      status: health.status,
      connected: health.connected,
      message: health.message
    });
  } catch (err) {
    return res.status(200).json({
      success: false,
      selectedSessionId: null,
      selectedUser: null,
      sessions: [],
      status: 'SERVER_UNAVAILABLE',
      connected: false,
      message: `Failed to retrieve SAP GUI sessions: ${err.message}`
    });
  }
});

/**
 * POST /api/sap/sessions/select
 * Selects an active SAP GUI session to be used for all SAP operations.
 */
router.post('/sessions/select', async (req, res) => {
  try {
    const { sessionId } = req.body || {};
    if (!sessionId || typeof sessionId !== 'string') {
      return res.status(400).json({
        success: false,
        code: 'INVALID_SESSION_ID',
        message: 'A valid sessionId string is required.'
      });
    }

    const discovery = await discoverSapSessions();
    const sessions = discovery.sessions || [];
    const matched = sessions.find((s) => s.id === sessionId.trim());

    if (!matched) {
      return res.status(404).json({
        success: false,
        code: 'SESSION_NOT_FOUND',
        message: 'The requested SAP session was not found or is no longer available.'
      });
    }

    setSelectedSapSessionId(matched.id, matched.user);
    const health = await checkSapSessionHealth();

    return res.status(200).json({
      success: true,
      message: `Active SAP session switched to ${matched.user}.`,
      selectedSessionId: matched.id,
      selectedUser: matched.user,
      session: {
        id: matched.id,
        user: matched.user,
        system: matched.system,
        client: matched.client,
        transaction: matched.transaction,
        title: matched.title,
        busy: matched.busy
      },
      health
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      code: 'SELECTION_ERROR',
      message: `Failed to select SAP GUI session: ${err.message}`
    });
  }
});

/**
 * GET /api/sap/session-status
 * Health check endpoint for dynamic SAP GUI session monitoring.
 */
router.get('/session-status', async (req, res) => {
  try {
    const health = await checkSapSessionHealth();
    return res.status(200).json(health);
  } catch (err) {
    return res.status(200).json({
      connected: false,
      status: 'SERVER_UNAVAILABLE',
      code: 'SAP_SERVER_UNAVAILABLE',
      message: `The SAP server is currently unavailable: ${err.message}`
    });
  }
});

export default router;
