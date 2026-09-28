import express from 'express';
import { loginRateLimiter } from '../middleware/security.js';
import { requireAuth } from '../middleware/auth.js';
import { validateSapCredentials } from '../services/sapClient.js';
import { encryptCredentials } from '../services/encryption.js';
import { sessionStore } from '../services/sessionStore.js';
import { getActiveSapUser } from '../services/sapGuiClient.js';

const router = express.Router();

const COOKIE_NAME = 'sap_session_id';
const SESSION_TTL_MS = 30 * 60 * 1000; // 30 minutes

/**
 * Returns cookie options based on current environment
 */
function getCookieOptions() {
  const isSecure = process.env.COOKIE_SECURE === 'true' || process.env.NODE_ENV === 'production';
  return {
    httpOnly: true,
    secure: isSecure,
    sameSite: 'strict',
    maxAge: SESSION_TTL_MS,
    path: '/'
  };
}

/**
 * POST /api/auth/login
 * Validates SAP Gateway credentials, encrypts them with AES-256-GCM,
 * stores them in-memory, and returns an HttpOnly session cookie.
 */
router.post('/login', loginRateLimiter, async (req, res) => {
  const { username, password } = req.body || {};

  if (!username || !password) {
    return res.status(400).json({
      error: 'Username and password are required.'
    });
  }

  try {
    // 1. Validate credentials against SAP Gateway (or mock layer)
    const validationResult = await validateSapCredentials(username, password);

    // 2. Encrypt credentials with AES-256-GCM (server secret key from env)
    const encrypted = encryptCredentials({
      username: validationResult.username,
      password: password
    });

    // 3. Store in server-side session store with 30-minute TTL
    const sessionId = sessionStore.createSession(
      encrypted,
      validationResult.username,
      SESSION_TTL_MS
    );

    // 4. Return session ID as HttpOnly, Secure, SameSite=Strict cookie
    res.cookie(COOKIE_NAME, sessionId, getCookieOptions());

    // 5. Respond with user info (Never expose raw password or encrypted token)
    return res.status(200).json({
      success: true,
      username: validationResult.username,
      sapMode: validationResult.mode || (process.env.USE_MOCK_SAP !== 'false' ? 'mock' : 'real')
    });
  } catch (err) {
    const statusCode = err.status || (err.message.includes('Invalid') ? 401 : 500);
    return res.status(statusCode).json({
      error: err.message || 'Authentication failed'
    });
  }
});

/**
 * POST /api/auth/logout
 * Destroys session in store and clears HttpOnly session cookie.
 */
router.post('/logout', (req, res) => {
  const sessionId = req.cookies?.[COOKIE_NAME];
  if (sessionId) {
    sessionStore.deleteSession(sessionId);
  }

  const isSecure = process.env.COOKIE_SECURE === 'true' || process.env.NODE_ENV === 'production';
  res.clearCookie(COOKIE_NAME, {
    httpOnly: true,
    secure: isSecure,
    sameSite: 'strict',
    path: '/'
  });
  return res.status(200).json({
    success: true,
    message: 'Logged out successfully'
  });
});

/**
 * GET /api/auth/config
 * Returns public auth configuration flags (e.g. bypass status, mock mode).
 * Never exposes credentials or secrets.
 */
router.get('/config', (req, res) => {
  const isBypassed = process.env.SKIP_GATEWAY_AUTH === 'true';
  return res.status(200).json({
    skipGatewayAuth: isBypassed,
    bypassUser: process.env.GATEWAY_BYPASS_USER || getActiveSapUser() || 'LEELAM_EXT',
    mockMode: process.env.USE_MOCK_SAP !== 'false'
  });
});

/**
 * GET /api/auth/me
 * Checks session status and returns current user identity.
 */
router.get('/me', requireAuth, (req, res) => {
  const isBypassed = process.env.SKIP_GATEWAY_AUTH === 'true';
  return res.status(200).json({
    authenticated: true,
    username: req.sapSession.username,
    sapMode: isBypassed ? 'gui-only' : (process.env.USE_MOCK_SAP !== 'false' ? 'mock' : 'real'),
    skipGatewayAuth: isBypassed
  });
});

export default router;
