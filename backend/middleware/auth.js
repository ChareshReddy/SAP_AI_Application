import { sessionStore } from '../services/sessionStore.js';
import { decryptCredentials } from '../services/encryption.js';
import { getActiveSapUser } from '../services/sapGuiClient.js';

/**
 * Authentication middleware.
 * Validates the HttpOnly session cookie, verifies session validity in-memory,
 * decrypts the stored SAP credentials, and attaches them to req.sapSession.
 * Never exposes raw passwords or logs credentials.
 */
export function requireAuth(req, res, next) {
  if (process.env.SKIP_GATEWAY_AUTH === 'true') {
    req.sapSession = {
      sessionId: 'dev-bypass-session',
      username: process.env.GATEWAY_BYPASS_USER || getActiveSapUser() || 'LEELAM_EXT',
      credentials: null,
      skipGatewayAuth: true
    };
    return next();
  }

  const sessionId = req.cookies?.sap_session_id;

  if (!sessionId) {
    return res.status(401).json({
      error: 'Authentication required. No active session found.'
    });
  }

  const session = sessionStore.getSession(sessionId);
  if (!session) {
    // Clear stale cookie
    res.clearCookie('sap_session_id', {
      httpOnly: true,
      secure: process.env.COOKIE_SECURE === 'true' || process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/'
    });

    return res.status(401).json({
      error: 'Session expired or invalid. Please log in again.'
    });
  }

  try {
    const decryptedCreds = decryptCredentials(session.encryptedCredentials);
    req.sapSession = {
      sessionId: session.sessionId,
      username: session.username,
      credentials: decryptedCreds
    };
    next();
  } catch (err) {
    console.error('Session decryption failure:', err.message);
    sessionStore.deleteSession(sessionId);
    return res.status(401).json({
      error: 'Session corrupted. Please log in again.'
    });
  }
}
